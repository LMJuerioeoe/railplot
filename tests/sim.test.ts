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
