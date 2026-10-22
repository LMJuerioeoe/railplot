import { describe, expect, test } from "bun:test";
import { buildControlDemo, buildSample } from "../src/sample";
import { ControlEngine } from "../src/control/engine";
import { analyze, geom, newProject, placePart, continuationEnd } from "../src/model";
import { getPart } from "../src/library";
import { TrackGraph } from "../src/sim/track";
import { scaleOf, worldFor } from "../src/sim/world";
import { newVehicle } from "../src/sim/stock";

const noPoints = () => 0;

describe("the track", () => {
  test("a lap of the sample oval comes back to where it started", () => {
    const p = buildSample();
    const g = new TrackGraph(p);
    const start = g.middleOf("t16")!;
    // the main line's length: every piece except the loop road, taking points straight
    const lap = p.items.filter((i) => !["t28", "t31", "t32"].includes(i.id)).reduce((a, i) => a + geom(i).length, 0);
    const r = g.advance(start, lap, noPoints);
    expect(r.stop).toBeNull();
    const a = g.pose(start), b = g.pose(r.pos);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.5);
    expect(Math.cos(a.h - b.h)).toBeCloseTo(1, 4);
  });

  test("a point sends a train down the road it's set for; trailing through one the wrong way is reported", () => {
    const p = buildSample();
    const g = new TrackGraph(p);
    // just before the left point's toe (t2, ST-241), heading into it from the west side
    const toe = geom(p.items.find((i) => i.id === "t2")!).ends[0];
    const before = g.nearest({ x: toe.x - 30, y: toe.y })!;
    const facing = g.pose(before).h;
    const into = Math.cos(facing) > 0 ? 1 : -1;
    const pos = { ...before, dir: into as 1 | -1 };
    const straight = g.advance(pos, 250, () => 0).pos, turn = g.advance(pos, 250, () => 1).pos;
    expect(straight.item).not.toBe(turn.item);
    // and back again over the point set the other way
    const back = g.advance(TrackGraph.reversed(turn), 250, () => 0);
    expect(back.trailed).toBe("t2");
  });

  test("an open end stops a move", () => {
    const p = newProject();
    const it = placePart(p, "hornby-oo/R600", { x: 0, y: 0, h: 0 });
    const g = new TrackGraph(p, analyze(p));
    const r = g.advance(g.middleOf(it.id)!, 500, noPoints);
    expect(r.stop).toBe("open-end");
    expect(r.moved).toBeCloseTo(84, 0);
  });
});

describe("the simulated world", () => {
  test("every control train gets a loco standing in its block", () => {
    const p = buildControlDemo();
    const e = new ControlEngine(p, p.control!);
    const w = worldFor(e);
    for (const t of p.control!.trains) {
      const c = w.consistOf(t.id)!;
      expect(c.vehicles[0].kind).toBe("loco");
      expect(w.blocksOf(c).has(t.block!)).toBe(true);
    }
  });

  test("a loco moves only with power in the block under it, and a speed shows at scale", () => {
    const p = buildControlDemo();
    const e = new ControlEngine(p, p.control!);
    const w = worldFor(e);
    const ex = p.control!.trains[1];
    const before = w.poseOf(ex.id)!;
    w.advanceTo(0); w.advanceTo(1000);
    expect(w.poseOf(ex.id)).toEqual(before);
    ex.momentum = 0;
    e.setThrottle(ex.id, 1); e.step(0.1);
    w.advanceTo(2000);
    const after = w.poseOf(ex.id)!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(100);
    expect(w.scaleKmh(ex.id)!).toBeGreaterThan(50);
    expect(scaleOf("peco-setrack-oo")).toBe(76.2);
    expect(scaleOf("piko-a-h0")).toBe(87);
  });
});

describe("derailments", () => {
  function demoWorld(mode?: "off" | "forgiving" | "realistic") {
    const p = buildControlDemo();
    const cfg = p.control!;
    if (mode) cfg.derailments = mode;
    const e = new ControlEngine(p, cfg);
    const w = worldFor(e);
    const ex = cfg.trains[1];
    ex.momentum = 0; ex.maxSpeed = 100;
    return { p, cfg, e, w, ex, c: w.consistOf(ex.id)! };
  }
  // the control loop, as the simulated controller runs it: power, move, then sensors back to the engine
  const drive = (e: ControlEngine, w: ReturnType<typeof worldFor>, secs: number) => {
    const ctrl = e.cfg.controllers[0].id;
    for (let t = 0; t < secs * 10; t++) {
      e.step(0.1); w.advanceTo(1100 + t * 100);
      const r = w.readings(ctrl);
      e.updateSensors(ctrl, (n) => r.inputs.has(n));
    }
  };

  test("too fast round a curve, it comes off; R re-rails it and the block's fault clears", () => {
    const { e, w, ex, c } = demoWorld();
    w.advanceTo(1000);
    e.setThrottle(ex.id, 1);
    drive(e, w, 15);
    expect(c.derailed?.cause).toBe("curve");
    expect(c.derailed!.speed).toBeGreaterThan(c.derailed!.limit);
    expect(c.derailed!.poses[0].tilt).not.toBe(0);
    expect(e.events.some((x) => x.includes("derailed"))).toBe(true);
    // its block shorts: the engine sees 2 A and cuts it
    const r = w.readings(e.cfg.controllers[0].id);
    e.updateCurrents(e.cfg.controllers[0].id, r.mA);
    expect(e.faults.size).toBe(1);
    expect(w.rerail(c.id)).toBe(true);
    expect(c.derailed).toBeUndefined();
    expect(e.faults.size).toBe(0);
  });

  test("with derailments off the train is held at the curve's limit instead", () => {
    const { e, w, ex, c } = demoWorld("off");
    w.advanceTo(1000);
    e.setThrottle(ex.id, 1);
    const ctrl = e.cfg.controllers[0].id;
    let held = 0, fastest = 0;
    for (let t = 0; t < 150; t++) {
      e.step(0.1); w.advanceTo(1100 + t * 100);
      const r = w.readings(ctrl); e.updateSensors(ctrl, (n) => r.inputs.has(n));
      // on a curve, never faster than the curve allows
      const tightest = Math.min(...c.at.map((a) => w.graph.pose(a).r));
      if (isFinite(tightest)) fastest = Math.max(fastest, Math.abs(c.speed) / w.curveLimit(tightest));
      if (c.held) held++;
    }
    expect(c.derailed).toBeUndefined();
    expect(held).toBeGreaterThan(0);
    expect(fastest).toBeLessThanOrEqual(1 + 1e-9);
  });

  test("out of the loop through a point set for the main line, the goods train comes off", () => {
    for (const [mode, off] of [["realistic", true], ["forgiving", false]] as const) {
      const { e, w, cfg } = demoWorld(mode);
      const goods = cfg.trains[0];
      goods.momentum = 0; goods.maxSpeed = 30; goods.minSpeed = 0;   // walking pace: 0.3 × 800 mm/s at most
      const c = w.consistOf(goods.id)!;
      w.advanceTo(1000);
      e.setThrottle(goods.id, 0.2);
      for (let t = 0; t < 100; t++) { e.step(0.1); w.advanceTo(1100 + t * 100); }
      expect(!!c.derailed).toBe(off);
      if (off) expect(c.derailed!.cause).toBe("trailing");
    }
  });

  test("forgiving takes curves half as fast again", () => {
    const { w } = demoWorld("forgiving");
    expect(w.curveLimit(438)).toBeCloseTo(Math.sqrt(800 * 438) * 1.5, 3);
    expect(w.curveLimit(Infinity)).toBe(Infinity);
  });

  test("running into the end of the line: gently it stops, hard it tips over", () => {
    for (const [speed, off] of [[0.1, false], [1, true]] as const) {
      const p = newProject();
      let at = { x: 0, y: 0, h: 0, z: 0 };
      for (let i = 0; i < 4; i++) { const it = placePart(p, "peco-setrack-oo/ST-200", at); at = { ...geom(it).ends[continuationEnd(getPart("peco-setrack-oo/ST-200")!, 0)] }; }
      const { quickStart } = require("../src/control/engine");
      const cfg = quickStart(p, undefined, "sim");
      p.control = cfg;
      const e = new ControlEngine(p, cfg);
      const w = worldFor(e);
      const t = cfg.trains[0]; t.momentum = 0; t.maxSpeed = 100; t.minSpeed = 0;
      const c = w.consistOf(t.id)!;
      w.advanceTo(0);
      e.setThrottle(t.id, speed);
      for (let k = 0; k < 150; k++) { e.step(0.1); w.advanceTo(k * 100 + 100); }
      expect(!!c.derailed).toBe(off);
      if (off) expect(c.derailed!.cause).toBe("open-end");
      else expect(c.speed).toBe(0);
    }
  });
});

describe("making up trains, placing, coupling", () => {
  /** A straight line of eight Setrack straights, one block, one train, nothing in the way. */
  function line(mode: "off" | "forgiving" | "realistic" = "realistic") {
    const p = newProject();
    let at = { x: 0, y: 0, h: 0, z: 0 };
    const items: string[] = [];
    for (let i = 0; i < 8; i++) {
      const it = placePart(p, "peco-setrack-oo/ST-200", at);
      items.push(it.id);
      at = { ...geom(it).ends[continuationEnd(getPart("peco-setrack-oo/ST-200")!, 0)] };
    }
    const { quickStart } = require("../src/control/engine");
    const cfg = quickStart(p, undefined, "sim");
    cfg.derailments = mode;
    p.control = cfg;
    const e = new ControlEngine(p, cfg);
    const w = worldFor(e);
    const t = cfg.trains[0]; t.momentum = 0; t.maxSpeed = 100; t.minSpeed = 0;
    const mid = (i: number) => w.graph.middleOf(items[i])!;
    const run = (secs: number, from = 0) => { for (let k = 0; k < secs * 10; k++) { e.step(0.1); w.advanceTo(from + k * 100 + 100); } return from + secs * 1000; };
    return { p, cfg, e, w, t, items, mid, run };
  }

  test("a train's stock becomes part of the layout; placing checks the track and the other trains", () => {
    const { cfg, w, t, items, mid } = line();
    const sc = w.stockOf(t.id);
    expect(cfg.consists!.map((x) => x.id)).toEqual([sc.id]);
    expect(sc.vehicles[0].kind).toBe("loco");
    expect(w.placeConsist(sc.id, mid(1))).toBeNull();
    expect(sc.at!.item).toBe(items[1]);
    const rake = w.newRake([0, 1, 2].map((i) => newVehicle("wagon", w.libId(), `w${i}`)));
    w.sync();
    // off the end of the line, on top of the loco, then somewhere free
    expect(w.placeConsist(rake.id, { ...mid(0), s: 5 })).toContain("won't fit");
    expect(w.placeConsist(rake.id, mid(1))).toContain("in the way");
    expect(w.placeConsist(rake.id, mid(5))).toBeNull();
    expect(w.consists.find((c) => c.id === rake.id)!.at).toHaveLength(3);
    // turning it round keeps it where it is
    const before = w.graph.pose(w.consists.find((c) => c.id === rake.id)!.at[0]);
    w.turnRound(rake.id);
    const after = w.graph.pose(w.consists.find((c) => c.id === rake.id)!.at[2]);
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(0.5);
  });

  test("buffers meeting gently couple up; the loco pulls the wagons back, then uncouples and leaves them", () => {
    const { cfg, e, w, t, mid, run } = line();
    const sc = w.stockOf(t.id);
    w.placeConsist(sc.id, mid(1));
    const rake = w.newRake([0, 1, 2].map((i) => newVehicle("van", w.libId(), `w${i}`)));
    w.sync();
    w.placeConsist(rake.id, mid(5));
    w.advanceTo(0);
    e.setThrottle(t.id, 0.05);            // 40 mm/s: buffers touch under the coupling speed
    let clock = run(20);
    const c = w.consistOf(t.id)!;
    expect(c.vehicles).toHaveLength(4);
    expect(c.vehicles[3].kind).toBe("loco");
    expect(cfg.consists!.some((x) => x.id === rake.id)).toBe(false);
    expect(e.events.some((x) => x.includes("coupled up"))).toBe(true);
    // back the other way: the whole train comes too
    e.setThrottle(t.id, 0); clock = run(1, clock);
    const front = w.graph.pose(c.at[0]).x;
    e.setThrottle(t.id, -0.1); clock = run(3, clock);
    expect(w.graph.pose(c.at[0]).x).toBeLessThan(front - 50);
    // stop, uncouple the loco, pull away: the vans stay
    e.setThrottle(t.id, 0); clock = run(2, clock);
    expect(w.uncoupleLoco(t.id)).toBeNull();
    const loco = w.consistOf(t.id)!;
    expect(loco.vehicles.map((v) => v.kind)).toEqual(["loco"]);
    const vans = w.consists.find((x) => !x.train)!;
    const vansAt = w.graph.pose(vans.at[0]).x;
    e.setThrottle(t.id, -0.1); clock = run(3, clock);
    expect(w.graph.pose(vans.at[0]).x).toBeCloseTo(vansAt, 3);
    expect(w.graph.pose(loco.at[0]).x).toBeLessThan(w.graph.pose(vans.at[2]).x - 50);
    expect(cfg.consists).toHaveLength(2);
  });

  test("too fast to couple, both stop; much too fast, both come off", () => {
    for (const [throttle, outcome] of [[0.15, "stopped"], [0.6, "collision"]] as const) {
      const { e, w, t, mid, run } = line();
      const sc = w.stockOf(t.id);
      w.placeConsist(sc.id, mid(1));
      const rake = w.newRake([newVehicle("tank", w.libId(), "w0")]);
      w.sync();
      w.placeConsist(rake.id, mid(6));
      w.advanceTo(0);
      e.setThrottle(t.id, throttle);
      const c = w.consistOf(t.id)!, r = w.consists.find((x) => x.id === rake.id)!;
      // run until the buffers meet: the first time the train stops (or comes off) while still on its own
      let k = 0;
      while (k < 1000 && c.vehicles.length === 1 && !c.derailed && !(k > 50 && c.speed === 0)) { e.step(0.01); w.advanceTo(++k * 10); }
      expect(c.vehicles).toHaveLength(1);
      if (outcome === "collision") {
        expect(c.derailed?.cause).toBe("collision");
        expect(r.derailed?.cause).toBe("collision");
        expect(w.describe(c.derailed!)).toContain("hit another train");
      } else {
        expect(c.derailed).toBeUndefined();
        expect(c.speed).toBe(0);
      }
    }
  });
});

describe("bugs found testing the drive view", () => {
  function demo() {
    const p = buildControlDemo(); const cfg = p.control!; cfg.derailments = "off";
    const e = new ControlEngine(p, cfg); const w = worldFor(e);
    return { p, cfg, e, w, ex: cfg.trains[1] };
  }

  test("BUG-001 a train with every vehicle taken out is off the track, and nothing breaks", () => {
    const { cfg, e, w, ex } = demo();
    w.stockOf(ex.id).vehicles = [];
    w.sync(); w.advanceTo(0);
    e.setThrottle(ex.id, 0.5); e.step(0.1);
    expect(() => { w.advanceTo(500); w.readings(cfg.controllers[0].id); w.vehiclePoses(); w.itemsUnder(); w.couplers(); w.curveMargin(ex.id); w.pointAhead(ex.id); }).not.toThrow();
    expect(w.consistOf(ex.id)!.at).toHaveLength(0);
    expect(w.poseOf(ex.id)).toBeNull();
  });

  test("BUG-002 uncoupling across a block joint leaves the loco where it stands", () => {
    const { w, ex } = demo();
    const sc = w.stockOf(ex.id);
    // eight coaches in front of the loco reach into the next block
    sc.vehicles = [...Array(8)].map((_, i) => newVehicle("coach", w.libId(), "c" + i)).concat(sc.vehicles);
    w.sync();
    const c = w.consistOf(ex.id)!;
    const loco = w.graph.pose(c.at[8]);
    expect(w.uncouple(c.id, 7)).toBeNull();
    w.sync();
    const now = w.poseOf(ex.id)!;
    expect(Math.hypot(now.x - loco.x, now.y - loco.y)).toBeLessThan(0.5);
    expect(w.blocksOf(w.consistOf(ex.id)!).has(ex.block!)).toBe(true);
  });

  test("BUG-003 a train put on the track stands still, whatever its throttle was", () => {
    const { cfg, e, w, ex } = demo();
    ex.momentum = 0;
    const sc = w.stockOf(ex.id);
    w.advanceTo(0); e.setThrottle(ex.id, 0.3); e.step(0.1); w.advanceTo(100);
    const spot = w.graph.middleOf(cfg.blocks.find((b) => b.name === "West")!.items[0])!;
    expect(w.placeConsist(sc.id, spot)).toBeNull();
    e.step(0.1); w.advanceTo(1100);
    expect(e.run(ex.id)!.target).toBe(0);
    expect(w.consistOf(ex.id)!.speed).toBe(0);
  });

  test("BUG-004 an automation stops, and says why, when its train derails", () => {
    const { e, w } = demo();
    const a = e.automations()[0];
    e.startAuto(a.id);
    for (let k = 0; k < 20; k++) { e.step(0.1); w.advanceTo(k * 100); }
    (w as unknown as { derail: (c: unknown, cause: string, v: number, l: number) => void }).derail(w.consistOf(a.train!)!, "curve", 0, 100);
    const r = e.autoRuns.get(a.id)!;
    expect(r.running).toBe(false);
    expect(r.status).toContain("derailed");
  });

  test("BUG-006 a deleted train's rolling stock stays on the layout as vehicles on their own", () => {
    const { cfg, w, ex } = demo();
    const sc = w.stockOf(ex.id);
    cfg.trains = cfg.trains.filter((t) => t !== ex);
    w.sync();
    expect(cfg.consists!.find((x) => x.id === sc.id)!.train).toBeUndefined();
    expect(w.consists.find((x) => x.id === sc.id)!.train).toBeUndefined();
  });

  test("a train longer than the loop it's put on is refused, not wrapped round onto itself", () => {
    const { cfg, w } = demo();
    for (const t of cfg.trains) w.remove(w.stockOf(t.id).id);
    cfg.trains = [];
    w.sync();
    const r = w.newRake([...Array(40)].map((_, i) => newVehicle("coach", w.libId(), "c" + i)));
    w.sync();
    const plain = cfg.blocks[0].items.find((i) => !cfg.points.some((q) => q.item === i))!;
    const err = w.placeConsist(r.id, w.graph.middleOf(plain)!);
    expect(err).toContain("longer than the loop");
  });
});
