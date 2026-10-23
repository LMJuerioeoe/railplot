import { expect, test } from "bun:test";
import { buildSample } from "../src/sample";
import { buildExample } from "../src/examples";
import { ControlEngine, quickStart, topology } from "../src/control/engine";
import { divideForTrains, divideTrack } from "../src/control/divide";
import { geom, partOf } from "../src/model";
import { worldFor } from "../src/sim/world";
import { MODELS, modelById, withTravel } from "../src/sim/models";
import { modelMesh } from "../src/view3d";

test("divideTrack puts every piece in exactly one block, cuts the sample oval at its points, and keeps each point with its toe", () => {
  const p = buildSample();
  const groups = divideTrack(p, 400);
  const all = groups.flat();
  expect(all.length).toBe(p.items.length);
  expect(new Set(all).size).toBe(p.items.length);
  expect(groups.length).toBeGreaterThanOrEqual(4);
  const len = (ids: string[]) => ids.reduce((a, id) => a + geom(p.items.find((i) => i.id === id)!).length, 0);
  for (const g of groups) expect(len(g)).toBeGreaterThanOrEqual(400);
});

test("divideTrack leaves a shunting plank shorter than two trains as one block", () => {
  const p = buildExample("inglenook-shelf", "peco-setrack-oo");
  expect(divideTrack(p).length).toBe(1);
});

test("Dividing the sample for two trains: the first keeps its place, the second gets a block of its own, and both run without meeting", () => {
  const p = buildSample();
  const cfg = quickStart(p, undefined, "sim");
  p.control = cfg;
  const e = new ControlEngine(p, cfg);
  const w = worldFor(e);
  w.advanceTo(0);
  const t1 = cfg.trains[0], c1 = w.consistOf(t1.id)!;
  const here = c1.at[0].item, at = c1.at.map((a) => ({ ...a }));
  const blocks = divideForTrains(p, cfg, 2, { where: (id) => w.consistOf(id)?.at[0]?.item });
  expect(blocks).toBeGreaterThanOrEqual(4);
  expect(cfg.trains.length).toBe(2);
  const t2 = cfg.trains[1];
  expect(t1.block).toBe(topology(p, cfg).blockOfItem.get(here));
  expect(t2.block).toBeDefined();
  expect(t2.block).not.toBe(t1.block);
  e.setProject(p, cfg);
  w.advanceTo(100);
  expect(c1.at).toEqual(at);
  const c2 = w.consistOf(t2.id)!;
  expect(c2.at.length).toBeGreaterThan(0);
  for (const t of cfg.trains) e.setThrottle(t.id, 0.5);
  let both = 0;
  for (let k = 0; k < 600; k++) {
    e.step(0.1); w.advanceTo(k * 100 + 200);
    if (Math.abs(c1.speed) > 0 && Math.abs(c2.speed) > 0) both++;
  }
  expect([c1.derailed?.cause ?? null, c2.derailed?.cause ?? null]).toEqual([null, null]);
  expect(w.consists.filter((c) => c.train).length).toBe(2);   // never ran into each other and coupled
  expect(both).toBeGreaterThan(0);
  expect(Math.abs(c1.odo ?? 0)).toBeGreaterThan(1000);
  expect(Math.abs(c2.odo ?? 0)).toBeGreaterThan(1000);
  for (const t of cfg.trains) expect(cfg.blocks.some((b) => b.id === t.block)).toBe(true);
});

test("Every turnout ends up in a block with track at its toe", () => {
  const p = buildSample();
  const groups = divideTrack(p, 400);
  for (const it of p.items.filter((i) => partOf(i).def.type === "turnout")) {
    const g = groups.find((x) => x.includes(it.id))!;
    expect(g.some((id) => partOf(p.items.find((i) => i.id === id)!).def.type !== "turnout")).toBe(true);
  }
});

test("A loco's rods and valve gear move as it runs, and a full turn of the driving wheels brings everything back", () => {
  expect(modelById("lms-black5")!.motion).toBeGreaterThan(0);
  for (const md of MODELS.filter((m) => m.motion)) {
    const at = (mm: number) => { let m!: ReturnType<typeof modelMesh>; withTravel(mm, () => { m = modelMesh(md); }, md.motion); return [...m.pos]; };
    const still = at(0);
    expect(at(md.motion! * Math.PI / 2)).not.toEqual(still);
    const round = at(2 * Math.PI * md.motion!);
    expect(round.length).toBe(still.length);
    expect([md.id, Math.max(...round.map((v, i) => Math.abs(v - still[i]))) < 1e-6]).toEqual([md.id, true]);
  }
});
