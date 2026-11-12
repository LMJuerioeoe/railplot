import { describe, expect, test } from "bun:test";
import { Mesh } from "../src/gfx/mesh";
import { parseProject, serialize } from "../src/io";
import { addStart, analyze, deleteItems, geom, moveItems, newProject, placePart, projectBounds, rotateItems } from "../src/model";
import { OBJECTS, addObject, buildObject, nearestTrack, objectAt, objectBox, objectCorners, objectDef, objectScale, rectRoom, roomFromBoards, snapObjectToTrack } from "../src/objects";
import { sceneryMesh } from "../src/roomscene";
import { buildScene } from "../src/view3d";
import { buildSample } from "../src/sample";
import { pointOf, tiesOf } from "../src/trackdetail";
import { DEFAULT_OUTLINE, outlinePdf, planOutline } from "../src/outline";
import { addRectBoard } from "../src/model";

function straightLine() {
  const p = newProject();
  addStart(p, 0, 0, 0);
  const a = placePart(p, "peco-setrack-oo/ST-201", { x: 0, y: 0, h: 0 });
  return { p, a };
}

describe("track detail", () => {
  test("a straight has evenly spaced sleepers square to the track", () => {
    const { a } = straightLine();
    const ties = tiesOf(a), g = geom(a);
    expect(ties.length).toBe(Math.round(g.length / g.part.lib.profile.sleeperSpacing));
    for (const t of ties) { expect(t.a).toBeCloseTo(-g.part.lib.profile.sleeperLength / 2); expect(t.b).toBeCloseTo(g.part.lib.profile.sleeperLength / 2); expect(t.y).toBeCloseTo(0); }
    expect(pointOf(a)).toBeNull();
  });
  test("a point has long timbers and a crossing between the two roads", () => {
    const p = newProject();
    const pt = placePart(p, "peco-setrack-oo/ST-240", { x: 0, y: 0, h: 0 });
    const ties = tiesOf(pt), L = geom(pt).part.lib.profile.sleeperLength;
    expect(ties.some((t) => t.b - t.a > L * 1.5)).toBe(true);
    // no two sleepers on top of each other
    for (let i = 0; i < ties.length; i++) for (let j = i + 1; j < ties.length; j++) expect(Math.hypot(ties[i].x - ties[j].x, ties[i].y - ties[j].y)).toBeGreaterThan(3);
    const d = pointOf(pt)!;
    expect(d).not.toBeNull();
    expect(d.side).toBe(-1);                       // a right-hand point leaves to the right
    expect(d.tA).toBeGreaterThan(60); expect(d.tA).toBeLessThan(168);
    const left = placePart(p, "peco-setrack-oo/ST-241", { x: 0, y: 500, h: 0 });
    expect(pointOf(left)!.side).toBe(1);
  });
  test("every point in every library gets a crossing", () => {
    const p = newProject();
    for (const key of ["hornby-oo/R8072", "hornby-oo/R8073", "piko-a-h0/55220", "piko-a-h0/55221"]) {
      const it = placePart(p, key, { x: 0, y: 0, h: 0 });
      expect(pointOf(it)).not.toBeNull();
    }
  });
});

describe("scenery and vehicles", () => {
  test("every catalogue entry builds a model that fits its footprint", () => {
    expect(OBJECTS.length).toBeGreaterThan(30);
    const p = newProject();
    for (const def of OBJECTS) {
      const m = new Mesh();
      const o = addObject(p, def.key, 0, 0, 0);
      buildObject(m, p, o);
      expect(m.idx.length).toBeGreaterThan(0);
      expect(m.data.every((v) => Number.isFinite(v))).toBe(true);
      expect(Math.max(...m.idx)).toBeLessThan(m.vertexCount);
    }
  });
  test("H0 layouts get smaller models than OO", () => {
    const oo = newProject(); placePart(oo, "peco-setrack-oo/ST-200", { x: 0, y: 0, h: 0 });
    const h0 = newProject(); placePart(h0, "piko-a-h0/55200", { x: 0, y: 0, h: 0 });
    expect(objectScale(oo)).toBe(1);
    expect(objectScale(h0)).toBeCloseTo(76.2 / 87);
    const o = addObject(h0, "scenery/station", 0, 0, 0);
    expect(objectBox(h0, o).w).toBeCloseTo(objectDef("scenery/station")!.w * 76.2 / 87);
    // furniture is full size whatever the scale
    expect(objectBox(h0, addObject(h0, "scenery/bed", 0, 0, 0)).w).toBe(2000);
  });
  test("an engine shed dropped near track sits on it and follows it; other scenery stays put", () => {
    const { p } = straightLine();
    const o = addObject(p, "scenery/engine-shed", 100, 18, 0.4);
    expect(snapObjectToTrack(p, o)).toBe(true);
    expect(o.y).toBeCloseTo(0); expect(o.onTrack).toBe(true);
    expect(Math.abs(Math.sin(o.rot))).toBeLessThan(1e-6);
    expect(Math.cos(o.rot)).toBeCloseTo(1);       // kept facing the way it was
    const far = addObject(p, "scenery/tunnel-portal", 100, 400, 0);
    expect(snapObjectToTrack(p, far)).toBe(false);
    expect(far.onTrack).toBeUndefined();
    const tree = addObject(p, "scenery/tree", 100, 5, 0);
    expect(snapObjectToTrack(p, tree)).toBe(false);
    expect(nearestTrack(p, { x: 100, y: 10 }, 20)!.dist).toBeCloseTo(10);
  });
  test("a buffer stop goes on the nearest open end, facing away from the track", () => {
    const { p } = straightLine();
    const free = analyze(p).free;
    const end = free.find((e) => e.x > 100)!;
    const o = addObject(p, "scenery/buffer-stop", end.x + 20, 10, 2);
    expect(snapObjectToTrack(p, o)).toBe(true);
    expect(o.x).toBeCloseTo(end.x); expect(o.y).toBeCloseTo(end.y); expect(Math.cos(o.rot)).toBeCloseTo(1);
  });
  test("objects move, turn and delete with the selection, and count in the plan's bounds", () => {
    const { p, a } = straightLine();
    const o = addObject(p, "scenery/station", 500, 300, 0);
    expect(objectAt(p, { x: 500, y: 300 })?.id).toBe(o.id);
    expect(objectAt(p, { x: 500, y: 300 }, 0, "flat")).toBeUndefined();
    expect(projectBounds(p)!.maxY).toBeGreaterThan(300);
    moveItems(p, [o.id, a.id], 10, -20);
    expect(o.x).toBe(510); expect(o.y).toBe(280);
    rotateItems(p, [o.id], Math.PI / 2, { x: 510, y: 280 });
    expect(o.rot).toBeCloseTo(Math.PI / 2);
    const c = objectCorners(p, o);
    expect(Math.max(...c.map((q) => q.y)) - Math.min(...c.map((q) => q.y))).toBeCloseTo(objectDef(o.kind)!.w);
    deleteItems(p, [o.id]);
    expect(p.objects!.length).toBe(0);
  });
  test("scenery and the room survive saving and opening", () => {
    const p = buildSample();
    addObject(p, "scenery/tree", 300, 500, 0).color = "#56803a";
    p.room = rectRoom(-300, -300, 3000, 2400, { boardHeight: 830, open: [0] });
    const q = parseProject(serialize(p));
    expect(q.objects).toEqual(p.objects);
    expect(q.room).toEqual(p.room);
    expect(addObject(q, "scenery/bush", 0, 0).id).not.toBe(q.objects![0].id);
    // old files without either still open
    const old = JSON.parse(serialize(buildSample())); delete old.objects; delete old.room;
    expect(parseProject(JSON.stringify(old)).items.length).toBe(p.items.length);
  });
});

describe("3D scene", () => {
  test("scenery adds to the layout's 3D mesh", () => {
    const p = buildSample();
    const bare = buildScene(p, { supports: true, sleepers: true });
    addObject(p, "scenery/station", 600, 500, 0);
    addObject(p, "scenery/tree", 300, 500, 0);
    const full = buildScene(p, { supports: true, sleepers: true });
    expect(full.idx.length).toBeGreaterThan(bare.idx.length + 1000);
    expect(full.pos.length).toBe(full.nrm.length); expect(full.pos.length / 3).toBe(full.mat.length);
    expect(full.pos.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.max(...full.idx)).toBeLessThan(full.pos.length / 3);
  });
  test("a room puts the floor at the baseboard height, furniture on the floor and walls that are see-through from outside", () => {
    const p = buildSample();
    p.room = roomFromBoards(p)!;
    p.room.boardHeight = 830;
    addObject(p, "scenery/bed", 0, 0, 0);
    const m = sceneryMesh(p, { room: true, legs: true });
    expect(m.idx.length).toBeGreaterThan(0);
    let minZ = Infinity; for (let i = 2; i < m.data.length; i += 10) minZ = Math.min(minZ, m.data[i]);
    expect(minZ).toBeCloseTo(-860);                 // the floor slab under the room, 30 mm thick
    const noLegs = sceneryMesh(p, { room: true, legs: false });
    expect(noLegs.idx.length).toBeLessThan(m.idx.length);
    expect(sceneryMesh(p, { room: false, legs: true }).idx.length).toBe(0);   // floor furniture needs a floor
    const scene = buildScene(p, { supports: true, sleepers: true });
    expect(scene.mat.filter((v) => v === -1).length).toBe(4 * 4 * 2);         // four walls and their skirting, as quads
    expect(buildScene(p, { supports: true, sleepers: true, room: false }).mat.some((v) => v === -1)).toBe(false);
  });
});

describe("baseboard outlines for scenery planning", () => {
  const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
  test("a small layout fits one page at a round scale", () => {
    const p = buildSample();
    const plan = planOutline(p, DEFAULT_OUTLINE)!;
    expect(plan.pages).toBe(1);
    expect([1, 2, 2.5, 4, 5, 8, 10, 12.5, 15, 20]).toContain(plan.scale);
    const w = plan.bounds.maxX - plan.bounds.minX, h = plan.bounds.maxY - plan.bounds.minY;
    expect(w / plan.scale).toBeLessThanOrEqual(plan.cellW + 1e-6); expect(h / plan.scale).toBeLessThanOrEqual(plan.cellH + 1e-6);
    expect(plan.landscape).toBe(w >= h);
  });
  test("a chosen scale tiles over as many pages as it needs", () => {
    const p = newProject();
    addRectBoard(p, 0, 0, 2400, 1200);
    const plan = planOutline(p, { ...DEFAULT_OUTLINE, scale: 5 })!;
    expect(plan.cols * plan.rows).toBe(plan.pages);
    expect(plan.cols * plan.cellW * 5).toBeGreaterThanOrEqual(2400); expect(plan.rows * plan.cellH * 5).toBeGreaterThanOrEqual(1200);
    expect(plan.pages).toBe(3);           // portrait A4: three sheets side by side
    expect(planOutline(newProject(), DEFAULT_OUTLINE)).toBeNull();
  });
  test("the PDF is well formed: page count, cross-reference table, true scale", () => {
    const p = newProject("Test (layout) ä");
    addRectBoard(p, 0, 0, 2400, 1200, "Main board");
    addStart(p, 100, 600, 0);
    placePart(p, "peco-setrack-oo/ST-201", { x: 100, y: 600, h: 0 });
    const r = outlinePdf(p, { ...DEFAULT_OUTLINE, scale: 10, paper: "a3" }, "2026-01-01")!;
    const s = text(r.pdf);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBe(r.plan.pages);
    expect(s).toContain(`/Count ${r.plan.pages}`);
    // every cross-reference entry points at its object
    const xref = +/startxref\n(\d+)/.exec(s)![1];
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const rows = s.slice(xref).split("\n").slice(3).filter((l) => /^\d{10} 00000 n/.test(l));
    rows.forEach((l, i) => expect(s.slice(+l.slice(0, 10)).startsWith(`${i + 1} 0 obj`)).toBe(true));
    // 1:10 means 2.83465 / 10 points per millimetre
    expect(s).toContain("0.283465 0 0 0.283465");
    // the board outline is in the drawing, brackets in the title are escaped
    expect(s).toContain("0 0 m 2400 0 l 2400 1200 l 0 1200 l h S");
    expect(s).toContain("Test \\(layout\\) \\344");
    expect(s).toContain("(Main board)");
    const none = text(outlinePdf(p, { ...DEFAULT_OUTLINE, scale: 10, paper: "a3", track: "none", grid: false, names: false }, "2026-01-01")!.pdf);
    expect(none.length).toBeLessThan(s.length);
    expect(none).not.toContain("(Main board)");
  });
});
