import { expect, test } from "bun:test";
import { buildSample } from "../src/sample";
import { buildScene } from "../src/view3d";
import { ControlEngine, quickStart } from "../src/control/engine";
import { divideForTrains } from "../src/control/divide";
import { worldFor } from "../src/sim/world";
import { Project } from "../src/model";

/** Twenty sample ovals side by side: 540 pieces of track. */
function big(): Project {
  const base = buildSample(), p = buildSample();
  p.items = []; p.boards = [];
  let id = 1;
  for (let k = 0; k < 20; k++) {
    const dx = (k % 5) * 2300, dy = Math.floor(k / 5) * 1400;
    for (const b of base.boards) p.boards.push({ ...b, id: `b${id++}`, pts: b.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) });
    for (const it of base.items) p.items.push({ ...it, id: `i${id++}`, x: it.x + dx, y: it.y + dy });
  }
  p.nextId = id;
  return p;
}

test("a 540-piece layout's 3D scene stays small enough to draw smoothly", () => {
  const p = big();
  const t = performance.now();
  const m = buildScene(p, { supports: true, sleepers: true });
  expect(m.pos.length / 3).toBeLessThan(500_000);   // about 780 vertices a piece, most of them sleepers
  expect(performance.now() - t).toBeLessThan(3000);
});

test("ten simulated trains on a 540-piece layout run faster than real time", () => {
  const p = big();
  const cfg = quickStart(p, undefined, "sim");
  p.control = cfg;
  const e = new ControlEngine(p, cfg);
  const w = worldFor(e);
  w.advanceTo(0);
  divideForTrains(p, cfg, 10, { where: (id) => w.consistOf(id)?.at[0]?.item });
  e.setProject(p, cfg);
  for (const t of cfg.trains) e.setThrottle(t.id, 0.5);
  const t0 = performance.now();
  for (let k = 0; k < 50; k++) { e.step(0.1); w.advanceTo(100 + k * 100); }
  // five seconds of running in well under five seconds (in practice a small fraction)
  expect(performance.now() - t0).toBeLessThan(2500);
  expect(cfg.trains.length).toBe(10);
});
