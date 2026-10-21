import { describe, expect, test } from "bun:test";
import { DEG } from "../src/geom";
import { MODULES, MODULE_FAMILIES, getModule, maxTracks, moduleOpenings, moduleMembers } from "../src/modules";
import {
  addModule, appendModule, applySnap, findSnap, freeModuleEnds, mirrorItems, moduleJoints, motorsOverFrame,
  moveItems, newProject, partsList, placePart, rejoinModule, rotateItems, trackPorts, boardGuides, layGuides, portUsed,
} from "../src/model";
import { getPart, LIBRARIES, validateLibrary } from "../src/library";
import { parseProject, serialize } from "../src/io";

const ID = "std-1200x600";

describe("laser-cut baseboard range", () => {
  test("all 25 modules are there, in four families", () => {
    expect(MODULES.length).toBe(25);
    expect(MODULE_FAMILIES).toEqual(["Standard modules", "Corners and curves", "Fiddle yard", "Canopy modules"]);
  });
  test("the 1200 × 600 module matches the project design", () => {
    const m = getModule(ID)!;
    expect(m.depth).toBe(100);
    expect(m.weightKg).toBe(4.76);
    const o = moduleOpenings(m);
    expect(o.length).toBe(8);
    const xs = o.map((p) => Math.min(...p.map((q) => q.x))).sort((a, b) => a - b);
    expect(xs.filter((_, i) => i % 2 === 0)).toEqual([42, 332, 632, 932]);
    expect(moduleMembers(m).filter((l) => l.kind === "cross").map((l) => l.a.x)).toEqual([300, 600, 900]);
    const left = m.fixings.filter((f) => f.p.x < 100).sort((a, b) => a.p.y - b.p.y);
    expect(left.map((f) => [f.kind, f.p.y])).toEqual([["dowel", 100], ["bolt", 180], ["bolt", 420], ["dowel", 500]]);
  });
  test("every joining face has two dowels and two bolts, symmetric about its middle", () => {
    for (const m of MODULES) {
      for (const f of m.faces) {
        const near = m.fixings.filter((x) => distToSeg(x.p, f.a, f.b) < 10);
        expect(near.filter((x) => x.kind === "dowel").length).toBe(2);
        expect(near.filter((x) => x.kind === "bolt").length).toBe(2);
        const mid = { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
        const d = near.filter((x) => x.kind === "dowel").map((x) => Math.hypot(x.p.x - mid.x, x.p.y - mid.y));
        expect(Math.abs(d[0] - d[1])).toBeLessThan(1);
      }
    }
  });
  test("the old module id still opens", () => {
    expect(getModule("laser-torsion-1200x600")!.id).toBe(ID);
  });
  test("appending modules joins them end to end", () => {
    const p = newProject();
    appendModule(p, ID); appendModule(p, ID); appendModule(p, ID);
    expect(moduleJoints(p)).toBe(2);
    expect(freeModuleEnds(p).length).toBe(2);
    expect(Math.max(...p.boards[2].pts.map((q) => q.x))).toBeCloseTo(3600, 6);
  });
  test("a 90° corner turns the run, and the other face turns it the other way", () => {
    const p = newProject();
    appendModule(p, ID);
    const c = appendModule(p, "corner90-600");
    const b = appendModule(p, ID);
    expect(moduleJoints(p)).toBe(2);
    expect(Math.abs(Math.cos(b.module!.rot))).toBeLessThan(1e-9);
    const before = c.module!.rot;
    expect(rejoinModule(p, c.id)).toBe(true);
    // the corner is joined to the first board by its other face now: it turns the other way
    expect(c.module!.rot).not.toBeCloseTo(before, 3);
    expect(moduleJoints(p)).toBe(1);
  });
  test("six 60° curves make a circle", () => {
    const p = newProject();
    for (let i = 0; i < 6; i++) appendModule(p, "curve60-r600-1000");
    expect(moduleJoints(p)).toBe(6);
    expect(freeModuleEnds(p).length).toBe(0);
  });
  test("eight 45° corners make an octagon", () => {
    const p = newProject();
    for (let i = 0; i < 8; i++) appendModule(p, "corner45-600");
    expect(moduleJoints(p)).toBe(8);
  });
  test("faces of different widths don't join", () => {
    const p = newProject();
    appendModule(p, ID);
    appendModule(p, "std-1200x400");
    expect(moduleJoints(p)).toBe(0);
  });
  test("the headshunt turntable has three faces", () => {
    const p = newProject();
    const t = appendModule(p, "turntable-disc-400");
    appendModule(p, "std-400x400", t.id); appendModule(p, "std-400x400", t.id); appendModule(p, "std-400x400", t.id);
    expect(moduleJoints(p)).toBe(3);
  });
  test("a dragged module snaps back onto its neighbour", () => {
    const p = newProject();
    appendModule(p, ID);
    const b = appendModule(p, ID);
    moveItems(p, [b.id], 18, -9);
    rotateItems(p, [b.id], 3 * DEG, { x: b.module!.cx, y: b.module!.cy });
    expect(moduleJoints(p)).toBe(0);
    const s = findSnap(p, [b.id], 30);
    expect(s).not.toBeNull();
    applySnap(p, [b.id], s!);
    expect(moduleJoints(p)).toBe(1);
  });
  test("mirroring keeps modules joined, corners included", () => {
    const p = newProject();
    const a = appendModule(p, ID), c = appendModule(p, "corner45-600"), b = appendModule(p, ID);
    expect(moduleJoints(p)).toBe(2);
    mirrorItems(p, [a.id, b.id, c.id], 500);
    expect(moduleJoints(p)).toBe(2);
    expect(c.module!.mirror).toBe(true);
  });
  test("parts list counts modules, joint hardware and extra hardware", () => {
    const p = newProject();
    appendModule(p, ID); appendModule(p, "traverser-1200x600");
    const rows = partsList(p);
    expect(rows.find((r) => r.key === `board|${ID}`)!.count).toBe(1);
    expect(rows.filter((r) => r.id === "joint").map((r) => r.count)).toEqual([2, 2]);
    expect(rows.find((r) => r.id === "module")!.name).toMatch(/drawer slides/);
  });
  test("a point over a cross member is flagged, one in an opening is not", () => {
    const p = newProject();
    addModule(p, ID, { cx: 600, cy: 300, rot: 0 });
    // motor sits 20 mm past the toe: toe at x=280 puts it on the cross member at x=300
    placePart(p, "hornby-oo/R8072", { x: 280, y: 150, h: 0 });
    placePart(p, "hornby-oo/R8072", { x: 130, y: 450, h: 0 });
    const w = motorsOverFrame(p);
    expect(w.length).toBe(1);
    expect(w[0].member).toBe("cross");
  });
  test("modules survive a save and reopen", () => {
    const p = newProject();
    appendModule(p, ID); appendModule(p, "corner90-600");
    const q = parseProject(serialize(p));
    expect(moduleJoints(q)).toBe(1);
  });
});

function distToSeg(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

describe("new track", () => {
  test("libraries validate", () => { for (const l of LIBRARIES) expect(validateLibrary(l)).toEqual([]); });
  test("Hornby Y point legs and R628 make parallel tracks about 66 mm apart", () => {
    const y = getPart("hornby-oo/R8076")!;
    expect(y.ends.length).toBe(3);
    const p = newProject();
    const it = placePart(p, "hornby-oo/R8076", { x: 0, y: 0, h: 0 });
    const { geom } = require("../src/model");
    const e = geom(it).ends;
    const a = placePart(p, "hornby-oo/R628", e[1], 0, true);
    const b = placePart(p, "hornby-oo/R628", e[2], 0, false);
    const ea = geom(a).ends[1], eb = geom(b).ends[1];
    expect(Math.abs(Math.sin(ea.h))).toBeLessThan(1e-9);
    expect(Math.abs(ea.y - eb.y)).toBeCloseTo(65.5, 0);
  });
  test("PIKO roadbed track has the same geometry as plain A-Gleis", () => {
    expect(getPart("piko-a-roadbed-h0/55420")!.ends).toEqual(getPart("piko-a-h0/55220")!.ends);
    expect(getPart("piko-a-h0/55226")!.ends.length).toBe(3);
  });
});

describe("track positions on modules", () => {
  const two = (id: string, n = 2, spacing = 67, edge?: number) => {
    const p = newProject(); const b = appendModule(p, id);
    b.module!.tracks = n; b.module!.spacing = spacing; if (edge !== undefined) b.module!.edge = edge;
    return { p, b };
  };

  test("on 600 mm boards two tracks sit 200 mm in from each edge, a third of the way across", () => {
    const { p, b } = two("std-1200x600");
    const ys = trackPorts(p).filter((q) => q.board === b.id).map((q) => Math.round((q.y - b.module!.cy + 300) * 1000) / 1000);
    expect([...new Set(ys)].sort((a, c) => a - c)).toEqual([200, 400]);
    // three: 200, 300, 400; four would be closer than 67 mm, so three is the most
    b.module!.tracks = 3;
    const ys3 = trackPorts(p).filter((q) => q.board === b.id).map((q) => Math.round(q.y - b.module!.cy + 300));
    expect([...new Set(ys3)].sort((a, c) => a - c)).toEqual([200, 300, 400]);
    expect(maxTracks(getModule("std-1200x600")!, 67, 200)).toBe(3);
    b.module!.tracks = 1;
    expect(trackPorts(p).filter((q) => q.board === b.id).every((q) => Math.abs(q.y - b.module!.cy) < 1e-9)).toBe(true);
  });

  test("tracks cross each face centred, at the spacing, facing into the board", () => {
    const { p, b } = two("std-1200x600", 2, 67, 0);
    const ports = trackPorts(p).filter((q) => q.board === b.id);
    expect(ports.length).toBe(4);
    const ys = ports.map((q) => q.y - b.module!.cy).sort((a, c) => a - c);
    expect(ys[0]).toBeCloseTo(-33.5, 6); expect(ys[3]).toBeCloseTo(33.5, 6);
    for (const q of ports) {
      // the heading points towards the middle of the board
      expect(Math.cos(q.h) * (b.module!.cx - q.x)).toBeGreaterThan(0);
    }
  });

  test("how many fit: four on a 600 face, two on a 200 face, one on a traverser", () => {
    expect(maxTracks(getModule("std-1200x600")!)).toBe(4);   // together at 67 mm
    expect(maxTracks(getModule("std-1200x400")!, 67, 0)).toBe(4);
    expect(maxTracks(getModule("std-400x200")!)).toBe(2);
    expect(maxTracks(getModule("traverser-1200x600")!)).toBe(1);
    const { p } = two("std-400x200", 4);
    expect(trackPorts(p).length).toBe(4);   // clamped to 2 per face
  });

  test("guides run straight across a straight board", () => {
    const { p, b } = two("std-1200x600");
    const g = boardGuides(p, b.id);
    expect(g.length).toBe(2);
    for (const x of g) { expect(x.segs).toEqual([{ kind: "s", len: 1200 }]); }
  });

  test("guides round a 45° corner and the 60° curve are concentric arcs about the engraved centre", () => {
    const c = two("corner45-600");
    const r1 = boardGuides(c.p, c.b.id).map((g) => g.minRadius).sort((a, b) => a - b);
    expect(r1[0]).toBeCloseTo(500, 0); expect(r1[1]).toBeCloseTo(700, 0);
    const c2 = two("corner45-600", 2, 67, 0);
    const r3 = boardGuides(c2.p, c2.b.id).map((g) => g.minRadius).sort((a, b) => a - b);
    expect(r3[0]).toBeCloseTo(600 - 33.5, 0); expect(r3[1]).toBeCloseTo(600 + 33.5, 0);
    const k = two("curve60-r600-1000", 3);
    const r2 = boardGuides(k.p, k.b.id).map((g) => g.minRadius).sort((a, b) => a - b);
    expect(r2.map((r) => Math.round(r))).toEqual([733, 800, 867]);
  });

  test("tracks line up across a joint, and a new module carries the same tracks on", () => {
    const { p, b } = two("std-1200x600");
    const c = appendModule(p, "std-1200x600");
    expect(c.module!.tracks).toBe(2);
    const mine = trackPorts(p).filter((q) => q.board === b.id), theirs = trackPorts(p).filter((q) => q.board === c.id);
    const shared = mine.filter((q) => theirs.some((t) => Math.hypot(t.x - q.x, t.y - q.y) < 1e-6 && Math.abs(Math.cos(t.h - q.h) + 1) < 1e-9));
    expect(shared.length).toBe(2);
  });

  test("laying flexible track along the guides, once", () => {
    const { p, b } = two("std-1200x600");
    const r = layGuides(p, b.id, "peco-setrack-oo/SL-100");
    expect(r.laid.length).toBe(2);
    expect(trackPorts(p).every((q) => portUsed(p, q))).toBe(true);
    expect(layGuides(p, b.id, "peco-setrack-oo/SL-100").already).toBe(2);
  });

  test("curves too tight for the flexible track are left out", () => {
    const { p, b } = two("corner90-400");
    const r = layGuides(p, b.id, "peco-setrack-oo/SL-100");
    expect(r.tooTight).toBe(2);
    expect(r.laid.length).toBe(0);
  });

  test("a track piece dragged near a track position snaps onto it", () => {
    const { p, b } = two("std-1200x600", 1);
    const port = trackPorts(p).find((q) => q.board === b.id)!;
    // a straight lying just inside the board, slightly off, ending near the face
    const it = placePart(p, "peco-setrack-oo/ST-200", { x: port.x + Math.cos(port.h) * 180 + 6, y: port.y + 4, h: port.h + Math.PI + 0.05 });
    const s = findSnap(p, [it.id], 30);
    expect(s).not.toBeNull();
    applySnap(p, [it.id], s!);
    expect(portUsed(p, port)).toBe(true);
  });
});
