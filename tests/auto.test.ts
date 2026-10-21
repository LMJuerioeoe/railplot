import { describe, expect, test } from "bun:test";
import { buildControlDemo } from "../src/sample";
import { ControlEngine, addAutomation, addController, addRoute, controlWarnings, topology, neighbours } from "../src/control/engine";
import { tripPaths, tripSteps, describeStep } from "../src/control/auto";
import { applyCommand, applySnapshot, snapshot } from "../src/control/remote";
import { parseProject, serialize } from "../src/io";
import { runSim } from "./helpers/sim";

const demo = () => { const p = buildControlDemo(); return { p, cfg: p.control!, e: new ControlEngine(p, p.control!) }; };
const B = (cfg: ReturnType<typeof demo>["cfg"], n: string) => cfg.blocks.find((b) => b.name === n)!.id;

describe("trip planning", () => {
  test("finds both ways round the oval, shortest first", () => {
    const { p, cfg, e } = demo();
    const ps = tripPaths(p, cfg, e.topo, B(cfg, "East"), B(cfg, "Station"));
    expect(ps.length).toBe(2);
    expect(ps[0].blocks).toEqual([B(cfg, "East"), B(cfg, "Station")]);
    expect(ps[1].blocks).toEqual([B(cfg, "East"), B(cfg, "West"), B(cfg, "Station")]);
    expect(ps[0].length).toBeLessThan(ps[1].length);
  });

  test("sets the point into the loop on the way there", () => {
    const { p, cfg, e } = demo();
    const [best] = tripPaths(p, cfg, e.topo, B(cfg, "East"), B(cfg, "Loop"));
    expect(best.blocks.map((b) => e.blockName(b))).toEqual(["East", "Station", "Loop"]);
    expect(best.points.length).toBe(1);
    expect(best.points[0].state).toBe(1);
  });

  test("no way to the block a train is already in", () => {
    const { p, cfg, e } = demo();
    expect(tripPaths(p, cfg, e.topo, B(cfg, "East"), B(cfg, "East"))).toEqual([]);
  });

  test("steps read in plain words", () => {
    const { p, cfg, e } = demo();
    const [best] = tripPaths(p, cfg, e.topo, B(cfg, "East"), B(cfg, "Loop"));
    const steps = tripSteps(best, { speed: 60, slow: 30, after: 2 });
    const words = steps.map((s) => describeStep(s, cfg, () => "point 1"));
    expect(words).toEqual(["Set point 1 to turn", "Drive forward at 60%", "Wait until it reaches Loop", "Slow to 30% and stop in this block after 2 s"]);
  });
});

describe("automations", () => {
  test("the demo's goods shuttle runs back and forth", async () => {
    const { p, cfg, e } = demo();
    const a = cfg.automations![0];
    expect(e.startAuto(a.id)).toBeNull();
    const seen: string[] = [];
    await runSim(p, 120, e, () => { const b = e.blockName(cfg.trains[0].block!); if (seen[seen.length - 1] !== b) seen.push(b); });
    expect(seen.slice(0, 5)).toEqual(["Loop", "Station", "West", "Station", "Loop"]);
    expect(e.autoRuns.get(a.id)!.running).toBe(true);
    // the express wasn't touched
    expect(cfg.trains[1].block).toBe(B(cfg, "East"));
  });

  test("a trip stops in its destination and powers nothing beyond", async () => {
    const { p, cfg, e } = demo();
    const ex = cfg.trains[1];
    const [path] = tripPaths(p, cfg, e.topo, ex.block!, B(cfg, "Station"));
    const a = addAutomation(cfg, "Express to the station", ex.id, tripSteps(path, { speed: 70, slow: 30, after: 1 }));
    expect(e.startAuto(a.id)).toBeNull();
    await runSim(p, 40, e);
    expect(ex.block).toBe(B(cfg, "Station"));
    expect(e.autoRuns.get(a.id)!.status).toBe("Finished");
    expect(e.run(ex.id).speed).toBe(0);
    expect(e.run(ex.id).hold).toBe(true);
    // held: only its own block is claimed
    expect([...e.claimedBy].filter(([, t]) => t === ex.id).map(([b]) => b)).toEqual([B(cfg, "Station")]);
  });

  test("taking the throttle stops the automation", () => {
    const { cfg, e } = demo();
    const a = cfg.automations![0];
    e.startAuto(a.id);
    e.step(0.1);
    e.setThrottle(cfg.trains[0].id, 0.3);
    expect(e.autoRuns.get(a.id)!.running).toBe(false);
    expect(e.autoRuns.get(a.id)!.status).toMatch(/took the throttle/);
  });

  test("won't start without a placed train or with power off", () => {
    const { cfg, e } = demo();
    const a = addAutomation(cfg, "Nobody", undefined, [{ do: "drive", speed: 50 }]);
    expect(e.startAuto(a.id)).toMatch(/Choose the train/);
    e.setPower(false);
    expect(e.startAuto(cfg.automations![0].id)).toMatch(/power is off/);
  });

  test("lights, signals and waits", () => {
    const { cfg, e } = demo();
    const l = cfg.lights[0], g = cfg.signals[0];
    const a = addAutomation(cfg, "Evening", undefined, [{ do: "light", light: l.id, on: true }, { do: "wait", sec: 2 }, { do: "signal", signal: g.id, mode: "stop" }]);
    e.startAuto(a.id);
    e.step(0.1);
    expect(l.on).toBe(true);
    expect(g.mode).toBe("auto");
    for (let i = 0; i < 25; i++) e.step(0.1);
    expect(g.mode).toBe("stop");
    expect(e.autoRuns.get(a.id)!.status).toBe("Finished");
  });
});

describe("routes, power and claims", () => {
  test("a route sets its points, and refuses under a moving train", () => {
    const { cfg, e } = demo();
    const loop = cfg.routes!.find((r) => r.name === "Into the loop")!;
    expect(e.setRoute(loop.id)).toBeNull();
    expect(e.routeSet(loop.id)).toBe(true);
    const main = cfg.routes!.find((r) => r.name === "Main line")!;
    expect(e.routeSet(main.id)).toBe(false);
    // the goods train is in the loop, not on the points: the points are in Station
    const r = addRoute(cfg, "x", [{ item: cfg.points[0].item, state: 0 }]);
    cfg.trains[1].block = B(cfg, "Station");
    e.assign();
    e.setThrottle(cfg.trains[1].id, 0.5);
    e.step(0.5);
    expect(e.setRoute(r.id)).toMatch(/Stop Express/);
  });

  test("power off stops everything and keeps blocks dead", () => {
    const { cfg, e } = demo();
    e.setThrottle(cfg.trains[1].id, 1);
    e.step(1);
    e.setPower(false);
    expect([...e.power.values()].every((d) => d === 0)).toBe(true);
    expect(e.run(cfg.trains[1].id).speed).toBe(0);
    e.setPower(true);
    expect(e.powerOn).toBe(true);
  });

  test("a train standing still doesn't hold the blocks around it", () => {
    const { cfg, e } = demo();
    const goods = cfg.trains[0], express = cfg.trains[1];
    e.setRoute(cfg.routes!.find((r) => r.name === "Into the loop")!.id);
    expect([...e.claimedBy].filter(([, t]) => t === express.id).length).toBe(1);
    e.setThrottle(goods.id, 0.5);
    e.step(0.5);
    // goods (in the loop) gets the station; the express, starting later, can't take it
    expect(e.claimedBy.get(B(cfg, "Station"))).toBe(goods.id);
    e.setThrottle(express.id, 0.5);
    e.step(0.5);
    expect(e.claimedBy.get(B(cfg, "Station"))).toBe(goods.id);
    expect(e.claimedBy.get(B(cfg, "West"))).toBe(express.id);
  });

  test("an emergency stop ignores momentum", () => {
    const { cfg, e } = demo();
    e.setThrottle(cfg.trains[1].id, 1);
    e.step(2);
    e.emergencyStop(cfg.trains[1].id);
    expect(e.run(cfg.trains[1].id).speed).toBe(0);
  });
});

describe("DCC-EX next to other systems", () => {
  test("trains never cross between DCC-EX and another controller", () => {
    const { p, cfg } = demo();
    const d = addController(cfg, "dccex", "192.168.4.1");
    const west = cfg.blocks.find((b) => b.name === "West")!;
    west.controller = d.id; west.channel = 0;
    const topo = topology(p, cfg);
    expect(topo.boundaries.filter((b) => b.isolated).length).toBe(2);
    expect(neighbours(p, cfg, topo, west.id)).toEqual([]);
    const w = controlWarnings(p, cfg, topo);
    expect(w.some((x) => /never be bridged/.test(x))).toBe(true);
    expect(d.cabBase).toBe(9001);
    expect(d.conn).toBe("net");
  });

  test("DCC-EX points become turnout commands; three-way points use two ids", () => {
    const { cfg, e } = demo();
    const d = addController(cfg, "dccex");
    cfg.points[0].controller = d.id; cfg.points[0].servo = 20; cfg.points[0].state = 1;
    e.assign();
    const f = e.frames().get(d.id)!;
    expect(f.turnouts).toEqual([[20, 1]]);
    expect(f.servos).toEqual([]);
  });
});

describe("snapshots and commands", () => {
  test("a snapshot copies the live state to another engine", () => {
    const a = demo(), b = demo();
    applyCommand(a.e, { c: "throttle", train: a.cfg.trains[1].id, v: 0.6 });
    a.e.step(0.5);
    applyCommand(a.e, { c: "point", item: a.cfg.points[0].item, state: 1 });
    applyCommand(a.e, { c: "light", id: a.cfg.lights[0].id, on: true, level: 40 });
    const s = JSON.parse(JSON.stringify(snapshot(a.e, 7, [])));
    applySnapshot(b.e, s);
    expect(b.e.run(b.cfg.trains[1].id).target).toBeCloseTo(0.6);
    expect(b.cfg.points[0].state).toBe(1);
    expect(b.cfg.lights[0]).toMatchObject({ on: true, level: 40 });
    expect([...b.e.claimedBy]).toEqual([...a.e.claimedBy]);
  });

  test("commands report problems in words", () => {
    const { e } = demo();
    expect(applyCommand(e, { c: "throttle", train: "nope", v: 1 })).toMatch(/isn't on this layout/);
    expect(applyCommand(e, { c: "route", id: "nope" })).toMatch(/doesn't exist/);
    applyCommand(e, { c: "power", on: false });
    expect(applyCommand(e, { c: "throttle", train: e.cfg.trains[0].id, v: 0.5 })).toMatch(/power is off/);
  });

  test("routes and automations survive saving", () => {
    const { p } = demo();
    const q = parseProject(serialize(p));
    expect(q.control!.routes!.length).toBe(2);
    expect(q.control!.automations![0].steps.length).toBe(p.control!.automations![0].steps.length);
  });
});
