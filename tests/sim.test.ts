import { describe, expect, test } from "bun:test";
import { buildControlDemo, buildSample } from "../src/sample";
import { ControlEngine } from "../src/control/engine";
import { analyze, geom, newProject, placePart, continuationEnd } from "../src/model";
import { getPart } from "../src/library";
import { TrackGraph } from "../src/sim/track";
import { scaleOf, worldFor } from "../src/sim/world";

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
