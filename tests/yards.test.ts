import { describe, expect, test } from "bun:test";
import { analyze, newProject, geom, partOf } from "../src/model";
import { buildYard, minYardLength, roadSpacings, yardParts, YardOptions } from "../src/yards";

const base: YardOptions = { kind: "fiddle", roads: 4, side: 1, length: 1500, wagon: 80, headshunt: 300 };
const libs = ["peco-setrack-oo", "hornby-oo", "piko-a-h0", "piko-a-roadbed-h0"];

/** Lateral offsets of the free ends at the far end of a yard. */
function farEnds(p: ReturnType<typeof newProject>, minX: number) {
  return analyze(p).free.filter((e) => e.x > minX).map((e) => Math.round(e.y * 100) / 100).sort((a, b) => a - b);
}

describe("yard parts", () => {
  test("every track system has points, a matching curve and flexible track", () => {
    for (const id of libs) {
      const k = yardParts(id)!;
      expect(k).not.toBeNull();
      expect(k.curve).toBeDefined();
    }
    expect(yardParts("peco-setrack-oo")!.left).toBe("peco-setrack-oo/ST-241");
    expect(yardParts("hornby-oo")!.flex).toBe("peco-setrack-oo/SL-100");
  });
  test("PIKO A's points ladder at exactly its track spacing", () => {
    const k = yardParts("piko-a-h0")!;
    expect(k.naturalSpacing[0]).toBeCloseTo(61.88, 1);
    expect(k.naturalSpacing[1]).toBeCloseTo(61.88, 1);
  });
});

describe("fiddle yards", () => {
  test("a four-road ladder: roads parallel, ends lined up, every joint aligned", () => {
    for (const id of libs) {
      const p = newProject();
      const r = buildYard(p, id, base, { x: 0, y: 0, h: 0 });
      const an = analyze(p);
      expect(an.bad.length).toBe(0);
      const ends = an.free.filter((e) => e.x > 100);
      expect(ends.length).toBe(4);
      for (const e of ends) { expect(e.x).toBeCloseTo(1500, 6); expect(Math.cos(e.h)).toBeCloseTo(1, 9); }
      const ys = ends.map((e) => e.y).sort((a, b) => a - b);
      const gaps = ys.slice(1).map((y, i) => y - ys[i]);
      const k = yardParts(id)!;
      expect(gaps.map((g) => Math.round(g * 10) / 10)).toEqual(roadSpacings(k, 4).map((g) => Math.round(g * 10) / 10));
      expect(r.items.filter((i) => partOf(i).def.type === "turnout").length).toBe(3);
    }
  });
  test("roads go on the side asked for", () => {
    const p = newProject();
    buildYard(p, "peco-setrack-oo", { ...base, side: -1 }, { x: 0, y: 0, h: 0 });
    expect(farEnds(p, 100).every((y) => y <= 1e-6)).toBe(true);
  });
  test("exact spacing puts short flexible track between the points", () => {
    const p = newProject();
    buildYard(p, "peco-setrack-oo", { ...base, spacing: 80 }, { x: 0, y: 0, h: 0 });
    const ys = farEnds(p, 100);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(80, 6);
    expect(analyze(p).bad.length).toBe(0);
  });
  test("a double-ended yard joins every road at both ends", () => {
    for (const id of libs) {
      const p = newProject();
      const o = { ...base, kind: "fiddle2" as const, roads: 5 };
      const len = minYardLength(o, id);
      buildYard(p, id, { ...o, length: len }, { x: 0, y: 0, h: 0 });
      const an = analyze(p);
      expect(an.bad.length).toBe(0);
      expect(an.free.length).toBe(2);
      expect(an.free.map((e) => Math.round(e.x))).toEqual(expect.arrayContaining([0, len]));
    }
  });
  test("a run-round loop has a headshunt at each end", () => {
    const p = newProject();
    buildYard(p, "hornby-oo", { ...base, kind: "runround", length: 1000, headshunt: 250 }, { x: 0, y: 0, h: 0 });
    const an = analyze(p);
    expect(an.free.map((e) => Math.round(e.x)).sort((a, b) => a - b)).toEqual([0, 1500]);
    expect(an.bad.length).toBe(0);
  });
  test("a yard built at an angle stays square to where it started", () => {
    const p = newProject();
    buildYard(p, "piko-a-h0", base, { x: 300, y: 200, h: Math.PI / 3 });
    const ends = analyze(p).free.filter((e) => Math.hypot(e.x - 300, e.y - 200) > 100);
    for (const e of ends) expect(Math.cos(e.h - Math.PI / 3)).toBeCloseTo(1, 9);
  });
});

describe("Inglenook sidings", () => {
  test("headshunt, two points, sidings for 5, 3 and 3 wagons", () => {
    const p = newProject();
    const r = buildYard(p, "peco-setrack-oo", { ...base, kind: "inglenook", wagon: 80, headshunt: 0 }, { x: 0, y: 0, h: 0 });
    expect(r.items.filter((i) => partOf(i).def.type === "turnout").length).toBe(2);
    const flex = r.items.filter((i) => partOf(i).def.type === "flex").map((i) => Math.round(geom(i).length));
    expect(flex).toEqual([408, 440, 280, 280]);
    const an = analyze(p);
    expect(an.bad.length).toBe(0);
    expect(an.free.length).toBe(4);   // the headshunt end and the three siding ends
  });
});

describe("lengths", () => {
  test("the shortest yard for 5 roads is longer with PIKO's 15° points than with Setrack's 22.5°", () => {
    const a = minYardLength({ kind: "fiddle2", roads: 5 }, "peco-setrack-oo"), b = minYardLength({ kind: "fiddle2", roads: 5 }, "piko-a-h0");
    expect(b).toBeGreaterThan(a);
    const p = newProject();
    expect(buildYard(p, "piko-a-h0", { ...base, kind: "fiddle2", roads: 5, length: b - 200 }, { x: 0, y: 0, h: 0 }).notes.length).toBe(1);
  });
});
