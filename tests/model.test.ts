import { describe, expect, test } from "bun:test";
import { DEG, biarc, distToPrim, primOf, tangentSegThrough, triangulate, walk } from "../src/geom";
import { LIBRARIES, getPart, validateLibrary } from "../src/library";
import {
  analyze, continuationEnd, createFlex, deleteItems, findSnap, applySnap, geom, gradient, mirrorItems,
  moveItems, newProject, partsList, partsCsv, costOf, costByBoard, addRectBoard, placePart, rotateItems, setHeightAt, summarize, Item, Project,
} from "../src/model";
import { parseProject, serialize } from "../src/io";
import { buildSample } from "../src/sample";
import { History } from "../src/history";

function chain(p: Project, keys: string[], start = { x: 0, y: 0, h: 0, z: 0 }) {
  let at = start;
  const items: Item[] = [];
  for (const k of keys) {
    const it = placePart(p, k, at);
    items.push(it);
    const e = geom(it).ends[continuationEnd(getPart(k)!, 0)];
    at = { ...e };
  }
  return { items, at };
}

describe("libraries", () => {
  test("every built-in library validates", () => {
    for (const lib of LIBRARIES) expect(validateLibrary(lib)).toEqual([]);
  });
  test("Setrack turnout diverging leg lands level with the straight leg", () => {
    const t = getPart("peco-setrack-oo/ST-241")!;
    expect(t.ends.length).toBe(3);
    expect(t.ends[2].x).toBeCloseTo(167.6, 0);
    expect(t.ends[2].y).toBeCloseTo(33.3, 0);
  });
  test("PIKO DKW has four ends", () => {
    expect(getPart("piko-a-h0/55224")!.ends.length).toBe(4);
  });
});

describe("placing and joining", () => {
  test("16 Setrack 2nd radius curves close a circle", () => {
    const p = newProject();
    chain(p, Array(16).fill("peco-setrack-oo/ST-225"));
    const an = analyze(p);
    expect(an.free.length).toBe(0);
    expect(an.bad.length).toBe(0);
  });
  test("Märklin C, Kato and Streamline curves close circles", () => {
    for (const [k, n] of [["maerklin-c-h0/24130", 12], ["maerklin-c-h0/24530", 12], ["kato-unitrack-ho/2-210", 16], ["kato-unitrack-ho/2-290", 36]] as const) {
      const p = newProject();
      chain(p, Array(n).fill(k));
      expect(analyze(p).free.length).toBe(0);
    }
  });
  test("a Märklin turnout and its counter-curve set the next track 77.5 mm over", () => {
    const t = getPart("maerklin-c-h0/24611")!;
    const p = newProject();
    const it = placePart(p, t.key, { x: 0, y: 0, h: 0 });
    const e = geom(it).ends[2];
    const c = placePart(p, "maerklin-c-h0/24224", { ...e }, 0, true);
    const out = geom(c).ends[1];
    expect(Math.abs(out.y)).toBeCloseTo(77.5, 0);
    expect(Math.cos(out.h)).toBeCloseTo(1, 4);
  });
  test("12 PIKO R1 curves close a circle", () => {
    const p = newProject();
    chain(p, Array(12).fill("piko-a-h0/55211"));
    expect(analyze(p).free.length).toBe(0);
  });
  test("oval of straights and curves closes", () => {
    const p = newProject();
    const half = ["piko-a-h0/55200", "piko-a-h0/55200", ...Array(6).fill("piko-a-h0/55212")];
    chain(p, [...half, ...half]);
    expect(analyze(p).free.length).toBe(0);
  });
  test("mirrored curve turns right", () => {
    const p = newProject();
    const it = placePart(p, "hornby-oo/R606", { x: 0, y: 0, h: 0 }, 0, true);
    expect(geom(it).ends[1].y).toBeLessThan(-10);
  });
  test("placing on the far end of a curve faces back along it", () => {
    const p = newProject();
    const a = placePart(p, "hornby-oo/R600", { x: 0, y: 0, h: 0 });
    const e = geom(a).ends[1];
    const b = placePart(p, "hornby-oo/R606", e, 1);
    expect(analyze(p).partner.size).toBe(2);
    expect(geom(b).ends[1].x).toBeCloseTo(168, 3);
  });
  test("sample layout has no gaps or bad joints", () => {
    const p = buildSample();
    const an = analyze(p);
    expect(an.bad.length).toBe(0);
    expect(an.free.length).toBe(0);
    expect(p.items.some((i) => i.part.endsWith("SL-100"))).toBe(true);
  });
});

describe("editing", () => {
  test("move then snap rejoins a piece", () => {
    const p = newProject();
    const { items } = chain(p, ["hornby-oo/R600", "hornby-oo/R600"]);
    moveItems(p, [items[1].id], 6, 3);
    rotateItems(p, [items[1].id], 4 * DEG, { x: 200, y: 0 });
    expect(analyze(p).free.length).toBe(4);
    const s = findSnap(p, [items[1].id], 15);
    expect(s).not.toBeNull();
    applySnap(p, [items[1].id], s!);
    expect(analyze(p).free.length).toBe(2);
  });
  test("mirror keeps a chain joined", () => {
    const p = newProject();
    const { items } = chain(p, ["hornby-oo/R600", "hornby-oo/R606", "hornby-oo/R8073"]);
    mirrorItems(p, items.map((i) => i.id), 100);
    const an = analyze(p);
    expect(an.bad.length).toBe(0);
    expect(an.partner.size).toBe(4);
  });
  test("delete removes items", () => {
    const p = newProject();
    const { items } = chain(p, ["hornby-oo/R600"]);
    deleteItems(p, [items[0].id]);
    expect(p.items.length).toBe(0);
  });
});

describe("heights", () => {
  test("raising a joint slopes both neighbours and passes through turnouts", () => {
    const p = newProject();
    const { items } = chain(p, ["hornby-oo/R601", "hornby-oo/R8072", "hornby-oo/R601"]);
    const joint = geom(items[1]).ends[0];
    setHeightAt(p, joint, 10);
    expect(items[0].z[1]).toBe(10);
    expect(items[1].z).toEqual([10, 10, 10]);
    expect(items[2].z[0]).toBe(10);
    expect(gradient(items[0])).toBeCloseTo((10 / 335) * 100, 5);
    expect(gradient(items[1])).toBeNull();
  });
});

describe("flex", () => {
  test("tangent arc through a point", () => {
    const s = tangentSegThrough({ x: 0, y: 0, h: 0 }, { x: 100, y: 100 })!;
    expect(s.kind).toBe("a");
    if (s.kind === "a") { expect(s.r).toBeCloseTo(100, 6); expect(s.deg).toBeCloseTo(90, 6); }
  });
  test("tangent arc clamps to minimum radius", () => {
    const s = tangentSegThrough({ x: 0, y: 0, h: 0 }, { x: 50, y: 50 }, 300)!;
    expect(s.kind === "a" && s.r).toBe(300);
  });
  test("biarc reaches the target pose", () => {
    const p0 = { x: 0, y: 0, h: 0 };
    const segs = biarc(p0, { x: 600, y: 200 }, 30 * DEG)!;
    expect(segs).not.toBeNull();
    let e = p0;
    for (const s of segs) e = walk(e, s);
    expect(e.x).toBeCloseTo(600, 3);
    expect(e.y).toBeCloseTo(200, 3);
    expect(e.h).toBeCloseTo(30 * DEG, 5);
  });
  test("flex closes a gap and counts as pieces", () => {
    const p = newProject();
    const a = placePart(p, "piko-a-h0/55200", { x: 0, y: 0, h: 0 });
    const b = placePart(p, "piko-a-h0/55200", { x: 1500, y: 300, h: 0 });
    const ea = geom(a).ends[1], eb = geom(b).ends[0];
    const segs = biarc(ea, eb, eb.h + Math.PI)!;
    createFlex(p, "piko-a-h0/55209", { ...ea, z: 0 }, segs);
    expect(analyze(p).free.length).toBe(2);
    const rows = partsList(p);
    const flex = rows.find((r) => r.id === "55209")!;
    expect(flex.count).toBe(2);
    expect(flex.length!).toBeGreaterThan(1200);
  });
});

describe("prices", () => {
  test("the parts list totals the prices, counts what isn't priced, and puts them in the CSV", () => {
    const p = newProject();
    addRectBoard(p, 0, -100, 600, 200, "Left"); addRectBoard(p, 600, -100, 600, 200, "Right");
    for (let i = 0; i < 6; i++) placePart(p, "hornby-oo/R600", { x: i * 168, y: 0, h: 0 });
    createFlex(p, "peco-setrack-oo/SL-100", { x: 1008, y: 0, h: 0, z: 0 }, [{ kind: "s", len: 100 }]);
    p.prices = { currency: "£", each: { "hornby-oo/R600": 2.5 } };
    const rows = partsList(p);
    expect(costOf(rows, p.prices)).toEqual({ total: 15, unpriced: 1 });
    p.prices.each["peco-setrack-oo/SL-100"] = 6;
    expect(costOf(partsList(p), p.prices).total).toBe(21);
    const csv = partsCsv(partsList(p), p.prices);
    expect(csv.split("\n")[0]).toContain("Price (£)");
    expect(csv.split("\n").at(-1)).toContain("21.00");
    // by board: four straights have their middles on the left board, two and the short piece of flex (100 of 914 mm) on the right
    const per = costByBoard(p);
    expect(per[0].track).toBeCloseTo(10, 5);
    expect(per[1].track).toBeCloseTo(5 + 6 * 100 / 914, 5);
    expect(parseProject(serialize(p)).prices).toEqual(p.prices);
  });
});

describe("files and history", () => {
  test("round trip", () => {
    const p = buildSample();
    const q = parseProject(serialize(p));
    expect(q.items.length).toBe(p.items.length);
    expect(analyze(q).free.length).toBe(0);
  });
  test("rejects other JSON", () => {
    expect(() => parseProject("{}")).toThrow();
    expect(() => parseProject("nope")).toThrow();
  });
  test("undo and redo", () => {
    const p = newProject();
    const h = new History();
    h.reset(p);
    placePart(p, "hornby-oo/R600", { x: 0, y: 0, h: 0 });
    h.commit(p);
    expect(h.undo()!.items.length).toBe(0);
    expect(h.redo()!.items.length).toBe(1);
  });
  test("summary", () => {
    const s = summarize(buildSample());
    expect(s.minRadius).toBeCloseTo(438, 3);
    expect(s.freeEnds).toBe(0);
    expect(s.boardArea).toBe(2050 * 1150);
  });
});

describe("geometry helpers", () => {
  test("distance to arc", () => {
    const pr = primOf({ x: 0, y: 0, h: 0 }, { kind: "a", r: 100, deg: 90 });
    expect(distToPrim(pr, { x: 70.71, y: 100 - 70.71 })).toBeCloseTo(0, 1);
    expect(distToPrim(pr, { x: -50, y: 0 })).toBeCloseTo(50, 3);
  });
  test("triangulate an L-shaped board", () => {
    const pts = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 0, y: 200 }];
    expect(triangulate(pts).length).toBe(12);
  });
});
