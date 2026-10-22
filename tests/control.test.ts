import { describe, expect, test } from "bun:test";
import { newProject, placePart, geom, continuationEnd, Project, Item } from "../src/model";
import { getPart } from "../src/library";
import {
  ControlEngine, addBlock, addController, addSensorsAtBoundaries, addSignal, addTrain, duty, neighbours, quickStart,
  syncPoints, topology, wiringList,
} from "../src/control/engine";
import { SimLink } from "../src/control/link";
import { emptyControl } from "../src/control/types";

function line(n: number): { p: Project; items: Item[] } {
  const p = newProject();
  let at = { x: 0, y: 0, h: 0, z: 0 };
  const items: Item[] = [];
  for (let i = 0; i < n; i++) {
    const it = placePart(p, "piko-a-h0/55200", at);
    items.push(it);
    const e = geom(it).ends[continuationEnd(getPart("piko-a-h0/55200")!, 0)];
    at = { ...e };
  }
  return { p, items };
}

function threeBlocks() {
  const { p, items } = line(6);
  const cfg = emptyControl();
  addController(cfg, "sim");
  const A = addBlock(cfg, [items[0].id, items[1].id], "A");
  const B = addBlock(cfg, [items[2].id, items[3].id], "B");
  const C = addBlock(cfg, [items[4].id, items[5].id], "C");
  return { p, items, cfg, A, B, C };
}

describe("topology", () => {
  test("finds the joints between blocks", () => {
    const { p, cfg, A, B, C } = threeBlocks();
    const t = topology(p, cfg);
    expect(t.boundaries.length).toBe(2);
    expect(neighbours(p, cfg, t, B.id).sort()).toEqual([A.id, C.id].sort());
    expect(t.unassigned.length).toBe(0);
  });
  test("a point set against a block cuts it off", () => {
    const p = newProject();
    const t0 = placePart(p, "piko-a-h0/55220", { x: 0, y: 0, h: 0 });
    const g = geom(t0);
    const straight = placePart(p, "piko-a-h0/55200", g.ends[1]);
    const branch = placePart(p, "piko-a-h0/55200", g.ends[2]);
    const cfg = emptyControl();
    const M = addBlock(cfg, [t0.id], "Main"), S = addBlock(cfg, [straight.id], "Straight"), D = addBlock(cfg, [branch.id], "Branch");
    syncPoints(p, cfg);
    const topo = topology(p, cfg);
    expect(neighbours(p, cfg, topo, M.id)).toEqual([S.id]);
    cfg.points[0].state = 1;
    expect(neighbours(p, cfg, topo, M.id)).toEqual([D.id]);
  });
});

describe("block power", () => {
  test("a train powers its block and the free blocks next to it", () => {
    const { p, cfg, A, B, C } = threeBlocks();
    const t = addTrain(cfg, A.id);
    t.momentum = 0;
    const e = new ControlEngine(p, cfg);
    e.setThrottle(t.id, 1);
    e.step(0.1);
    expect(e.claimedBy.get(A.id)).toBe(t.id);
    expect(e.claimedBy.get(B.id)).toBe(t.id);
    expect(e.claimedBy.has(C.id)).toBe(false);
    expect(e.power.get(A.id)).toBeCloseTo(t.maxSpeed / 100, 6);
    expect(e.power.get(C.id)).toBe(0);
  });
  test("a sensor moves the train on, and the block behind stays live until it is clear", () => {
    const { p, cfg, A, B, C } = threeBlocks();
    const t = addTrain(cfg, A.id);
    addSensorsAtBoundaries(p, cfg);
    expect(cfg.sensors.length).toBe(2);
    const e = new ControlEngine(p, cfg);
    e.setThrottle(t.id, 0.5);
    const s = cfg.sensors.find((x) => x.blocks.includes(A.id) && x.blocks.includes(B.id))!;
    expect(e.sensorTripped(s.id)).toBe(t.id);
    expect(t.block).toBe(B.id);
    expect(e.claimedBy.get(C.id)).toBe(t.id);
    expect(e.claimedBy.get(A.id)).toBe(t.id);
  });
  test("two trains keep a dead block between them", () => {
    const { p, cfg, A, B, C } = threeBlocks();
    const t1 = addTrain(cfg, A.id), t2 = addTrain(cfg, C.id);
    const e = new ControlEngine(p, cfg);
    expect(e.claimedBy.has(B.id)).toBe(false);
    expect(e.claimedBy.get(A.id)).toBe(t1.id);
    expect(e.claimedBy.get(C.id)).toBe(t2.id);
  });
  test("a stop signal holds the train", () => {
    const { p, cfg, A, B } = threeBlocks();
    addTrain(cfg, A.id);
    const sig = addSignal(p, cfg, { x: 478, y: 0 }, A.id, B.id, 0);
    const e = new ControlEngine(p, cfg);
    expect(e.aspects.get(sig.id)).not.toBe("red");
    sig.mode = "stop";
    e.assign();
    expect(e.claimedBy.has(B.id)).toBe(false);
    expect(e.aspects.get(sig.id)).toBe("red");
  });
  test("automatic signal shows red with a train beyond it", () => {
    const { p, cfg, A, B } = threeBlocks();
    addTrain(cfg, B.id);
    const sig = addSignal(p, cfg, { x: 478, y: 0 }, A.id, B.id, 0);
    const e = new ControlEngine(p, cfg);
    expect(e.aspects.get(sig.id)).toBe("red");
  });
  test("momentum ramps speed", () => {
    const { p, cfg, A } = threeBlocks();
    const t = addTrain(cfg, A.id);
    t.momentum = 2;
    const e = new ControlEngine(p, cfg);
    e.setThrottle(t.id, 1);
    e.step(1);
    expect(e.run(t.id).speed).toBeCloseTo(0.5, 6);
    e.stopAll();
    expect(e.run(t.id).speed).toBe(0);
  });
  test("throttle maps onto the train's start and top speed", () => {
    const t = { id: "x", name: "x", color: "#000", minSpeed: 20, maxSpeed: 70, momentum: 0 };
    expect(duty(t, 0)).toBe(0);
    expect(duty(t, 1)).toBeCloseTo(0.7, 6);
    expect(duty(t, -0.5)).toBeCloseTo(-0.45, 6);
  });
  test("points can't be thrown under a moving train", () => {
    const p = newProject();
    const t0 = placePart(p, "piko-a-h0/55220", { x: 0, y: 0, h: 0 });
    const cfg = emptyControl();
    const M = addBlock(cfg, [t0.id], "Main");
    syncPoints(p, cfg);
    const tr = addTrain(cfg, M.id);
    tr.momentum = 0;
    const e = new ControlEngine(p, cfg);
    e.setThrottle(tr.id, 0.5); e.step(0.1);
    expect(e.setPoint(t0.id, 1)).toContain("Stop");
    e.stopAll();
    expect(e.setPoint(t0.id, 1)).toBeNull();
    expect(cfg.points[0].state).toBe(1);
  });
  test("a short circuit cuts the block and stops the train", () => {
    const { p, cfg, A } = threeBlocks();
    A.channel = 0;
    const t = addTrain(cfg, A.id);
    t.momentum = 0;
    const e = new ControlEngine(p, cfg);
    e.setThrottle(t.id, 1); e.step(0.1);
    e.updateCurrents(A.controller!, [1800]);
    expect(e.faults.has(A.id)).toBe(true);
    expect(e.power.get(A.id)).toBe(0);
  });
});

describe("frames and setup", () => {
  test("quick start makes one block, one train and servo numbers", () => {
    const { p } = line(3);
    placePart(p, "hornby-oo/R8072", { x: 0, y: 300, h: 0 });
    const cfg = quickStart(p, undefined, "esp32");
    expect(cfg.blocks.length).toBe(1);
    expect(cfg.blocks[0].items.length).toBe(4);
    expect(cfg.trains[0].block).toBe(cfg.blocks[0].id);
    expect(cfg.points[0].servo).toBe(0);
    const e = new ControlEngine(p, cfg);
    e.setThrottle(cfg.trains[0].id, 1); cfg.trains[0].momentum = 0; e.step(0.1);
    const f = e.frames().get(cfg.controllers[0].id)!;
    expect(f.blocks[0][0]).toBe(0);
    expect(f.blocks[0][1]).toBe(Math.round(0.8 * 1023));
    expect(f.servos).toEqual([[0, 1300]]);
    expect(wiringList(p, cfg).length).toBe(2);
  });
});

describe("simulator", () => {
  test("a simulated train runs from block to block, tripping sensors", async () => {
    const { p, cfg, A, B, C } = threeBlocks();
    const t = addTrain(cfg, A.id);
    t.momentum = 0;
    addSensorsAtBoundaries(p, cfg);
    for (const s of cfg.sensors) s.controller = cfg.controllers[0].id;
    const e = new ControlEngine(p, cfg);
    const sim = new SimLink(cfg.controllers[0], () => e);
    sim.fullSpeed = 2000;
    let clock = 0;
    const realNow = performance.now.bind(performance);
    (performance as any).now = () => clock;
    try {
      e.setThrottle(t.id, 1);
      const seen = new Set<string>();
      for (let i = 0; i < 80; i++) {
        e.step(0.1);
        clock += 100;
        const st = await sim.exchange(e.frames().get(cfg.controllers[0].id)!);
        e.updateSensors(cfg.controllers[0].id, st!.inputs);
        seen.add(t.block!);
      }
      expect([...seen]).toEqual([A.id, B.id, C.id]);
      expect(t.block).toBe(C.id);
    } finally { (performance as any).now = realNow; }
  });
});

describe("demo", () => {
  test("two-train demo has four blocks, sensors, signals and runs the express round", async () => {
    const { buildControlDemo } = await import("../src/sample");
    const p = buildControlDemo();
    const cfg = p.control!;
    expect(cfg.blocks.map((b) => b.name)).toEqual(["Station", "Loop", "East", "West"]);
    expect(cfg.blocks.every((b) => b.items.length > 0)).toBe(true);
    expect(topology(p, cfg).unassigned.length).toBe(0);
    expect(cfg.sensors.length).toBe(5);
    expect(cfg.signals.length).toBe(2);
    const e = new ControlEngine(p, cfg);
    const [goods, express] = cfg.trains;
    // points set straight: the goods train in the loop has nowhere to go
    expect([...e.claimedBy].filter(([, t]) => t === goods.id).length).toBe(1);
    const sim = new SimLink(cfg.controllers[0], () => e);
    // fast, to keep the test short: at this speed a train would fly off the curves, so derailments are off
    sim.fullSpeed = 3000;
    cfg.derailments = "off";
    let clock = 0;
    const realNow = performance.now.bind(performance);
    (performance as any).now = () => clock;
    try {
      express.momentum = 0;
      e.setThrottle(express.id, 1);
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        e.step(0.1); clock += 100;
        const st = await sim.exchange(e.frames().get(cfg.controllers[0].id)!);
        e.updateSensors(cfg.controllers[0].id, st!.inputs);
        seen.add(e.blockName(express.block!));
      }
      expect([...seen].sort()).toEqual(["East", "Station", "West"]);
      expect(goods.block).toBe(cfg.blocks[1].id);
    } finally { (performance as any).now = realNow; }
  });
});

describe("detecting trains by current", () => {
  function setup() {
    const s = threeBlocks();
    s.cfg.detection = { current: true, threshold: 3 };
    s.A.channel = 0; s.B.channel = 1; s.C.channel = 2;
    const c = s.cfg.controllers[0].id;
    for (const b of [s.A, s.B, s.C]) b.controller = c;
    const t = addTrain(s.cfg, s.A.id, "Goods");
    const e = new ControlEngine(s.p, s.cfg);
    // idle currents per channel, three readings to be believed
    const read = (idle: number[], mA: number[] = []) => { for (let i = 0; i < 3; i++) e.updateDetection(c, mA, idle); };
    return { ...s, t, e, read };
  }

  test("something in a block with no train booked stops trains going in, until it clears", () => {
    const { e, read, t, B } = setup();
    e.run(t.id).target = 0.5; e.assign();
    expect(e.claimedBy.get(B.id)).toBe(t.id);
    read([30, 0, 0]);
    expect(e.strays.size).toBe(0);           // the train's own block, and B is booked for it
    e.run(t.id).target = 0; e.assign();      // standing: B is no longer booked
    read([30, 6, 0]);
    expect([...e.strays]).toEqual([B.id]);
    expect(e.events.some((x) => x.includes("Something is in B"))).toBe(true);
    e.run(t.id).target = 0.5; e.assign();
    expect(e.claimedBy.get(B.id)).toBeUndefined();
    read([30, 0, 0]);
    expect(e.strays.size).toBe(0);
    expect(e.claimedBy.get(B.id)).toBe(t.id);
  });

  test("one reading isn't enough, and below the threshold is nothing", () => {
    const { e, t, cfg } = setup();
    e.run(t.id).target = 0; e.assign();
    e.updateDetection(cfg.controllers[0].id, [], [30, 50, 0]);
    expect(e.detected.size).toBe(0);
    for (let i = 0; i < 3; i++) e.updateDetection(cfg.controllers[0].id, [], [30, 2, 0]);
    expect([...e.detected]).toHaveLength(1);
  });

  test("a train whose sensor missed it moves on when its next block lights up and its own goes quiet", () => {
    const { e, read, t, A, B } = setup();
    read([30, 0, 0]);
    e.run(t.id).target = 0.5; e.step(0.1); e.assign();
    read([0, 0, 0], [0, 150, 0]);
    expect(t.block).toBe(B.id);
    expect(e.events.some((x) => x.includes("no sensor saw it"))).toBe(true);
    // the block it left isn't called a stray while its tail may still be there
    read([20, 0, 0], [0, 150, 0]);
    expect(e.strays.has(A.id)).toBe(false);
  });

  test("the simulator draws current where its trains are", async () => {
    const { p, cfg, A, B } = setup();
    const e = new ControlEngine(p, cfg);
    const link = new SimLink(cfg.controllers[0], () => e);
    let now = 0; link.clock = () => now;
    const st = await link.exchange(e.frames().get(cfg.controllers[0].id)!, false);
    expect(st!.idle![A.channel!]).toBeGreaterThan(cfg.detection!.threshold);
    expect(st!.idle![B.channel!]).toBe(0);
    link.strays.add(B.id);
    now += 100;
    const st2 = await link.exchange(e.frames().get(cfg.controllers[0].id)!, false);
    expect(st2!.idle![B.channel!]).toBeGreaterThan(cfg.detection!.threshold);
  });
});
