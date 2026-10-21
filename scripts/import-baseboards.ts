// Turns the baseboard range's design data (exported from the laser-cut baseboard generator,
// make_baseboards.py, as data/baseboard-range.json) into Railplot module presets in src/boards/.
//   bun scripts/import-baseboards.ts [data/baseboard-range.json]
// Every part comes with its flat cutting outline and where it sits in 3D. Railplot only needs the
// plan view: the outline, the joining faces with their dowel and bolt holes, the frame members under
// the top (for the point-motor check), the openings in the bottom skin, moving decks, canopies and
// the guide lines engraved on the top.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type V2 = [number, number];
type V3 = [number, number, number];
interface Part {
  name: string; code: string; role: string; group: string; qty: number; note: string;
  outer: V2[]; holes: V2[][]; engrave: [number, number, number, number][];
  placements: [V3, V3, V3, V3][]; bbox: [number, number, number, number];
}
interface Mod {
  id: string; name: string; family: string; blurb: string; hardware: string; size: string;
  stats: { kg: number; pieces: number; sheets: number; cut_m: number; sheet: [number, number]; largest: number };
  parts: Part[];
}

const root = join(import.meta.dir, "..");
const src = process.argv[2] ?? join(root, "data", "baseboard-range.json");
const data = JSON.parse(readFileSync(src, "utf8")) as { T: number; modules: Mod[] };
const T = data.T;
const outDir = join(root, "src", "boards");

const r1 = (n: number) => Math.round(n * 10) / 10;
const pt = (p: V2) => ({ x: r1(p[0]), y: r1(p[1]) });

/** A part's own 2D point to world xyz, for one placement. */
function tf(pl: [V3, V3, V3, V3], x: number, y: number): V3 {
  const [o, X, Y] = pl;
  return [o[0] + X[0] * x + Y[0] * y, o[1] + X[1] * x + Y[1] * y, o[2] + X[2] * x + Y[2] * y];
}
const vertical = (pl: [V3, V3, V3, V3]) => Math.abs(pl[3][2]) < 0.5;

function area(poly: V2[]) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); }

/** Ramer-Douglas-Peucker on a closed polygon: drops the 4 mm tab notches along the edges. */
function simplify(poly: V2[], eps: number): V2[] {
  const segDist = (p: V2, a: V2, b: V2) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const rdp = (pts: V2[]): V2[] => {
    if (pts.length < 3) return pts;
    let idx = 0, best = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], pts[0], pts[pts.length - 1]); if (d > best) { best = d; idx = i; } }
    if (best <= eps) return [pts[0], pts[pts.length - 1]];
    return [...rdp(pts.slice(0, idx + 1)).slice(0, -1), ...rdp(pts.slice(idx))];
  };
  // start from the vertex furthest from the centroid so the split point is a real corner
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  let s = 0, sd = -1;
  poly.forEach((p, i) => { const d = Math.hypot(p[0] - cx, p[1] - cy); if (d > sd) { sd = d; s = i; } });
  const ring = [...poly.slice(s), ...poly.slice(0, s), poly[s]];
  const out = rdp(ring).slice(0, -1);
  // merge nearly straight runs left over
  return out.filter((p, i) => {
    const a = out[(i - 1 + out.length) % out.length], b = out[(i + 1) % out.length];
    return segDist(p, a, b) > 0.5;
  });
}

/** Is a hole a circle? Returns centre and diameter. */
function circle(h: V2[]): { c: V2; d: number } | null {
  const cx = h.reduce((s, p) => s + p[0], 0) / h.length, cy = h.reduce((s, p) => s + p[1], 0) / h.length;
  const rs = h.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const r = rs.reduce((a, b) => a + b, 0) / rs.length;
  return Math.max(...rs) - Math.min(...rs) < 0.15 * r ? { c: [cx, cy], d: Math.round(r * 2 * 10) / 10 } : null;
}

const plan = (p: V3): V2 => [p[0], p[1]];

function convert(m: Mod) {
  const base = m.parts.filter((p) => p.group === "base");
  const bottom = base.find((p) => p.role === "bottom" && p.qty >= 1)!;
  const bottoms = base.filter((p) => p.role === "bottom");
  // outline: the bottom skin(s), notches removed
  const outlineParts = bottoms.flatMap((p) => p.placements.map((pl) => p.outer.map((q) => plan(tf(pl, q[0], q[1])))));
  let outline = simplify(outlineParts[0], 5);
  if (outlineParts.length > 1) {
    // a split skin: use the bounding rectangle of the pieces (split skins only occur on rectangular boards)
    const xs = outlineParts.flat().map((p) => p[0]), ys = outlineParts.flat().map((p) => p[1]);
    outline = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)], [Math.min(...xs), Math.max(...ys)]];
  }
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);

  // joining faces and their fixings
  const faces: { a: { x: number; y: number }; b: { x: number; y: number }; width: number }[] = [];
  const fixings: { p: { x: number; y: number }; kind: "dowel" | "bolt"; d: number }[] = [];
  for (const f of base.filter((p) => p.role === "face")) {
    for (const pl of f.placements) {
      const n = pl[3];
      const a = plan(tf(pl, f.bbox[0], 0)), b = plan(tf(pl, f.bbox[2], 0));
      // keep the outside of the board on the left of a→b (outward normal = −n)
      const left: V2 = [-(b[1] - a[1]), b[0] - a[0]];
      const [fa, fb] = left[0] * -n[0] + left[1] * -n[1] > 0 ? [a, b] : [b, a];
      // Track positions and curve guides are worked out from the faces, so tidy them: the design data rounds
      // its direction vectors to 0.001, which tilts a long face by a few hundredths of a degree. Faces are laid
      // out at whole half-degrees and whole millimetres wide, so snap to those, keeping the middle.
      const ang = Math.round((Math.atan2(fb[1] - fa[1], fb[0] - fa[0]) * 180) / Math.PI * 2) / 2 * Math.PI / 180;
      const w = Math.round(Math.hypot(fb[0] - fa[0], fb[1] - fa[1]));
      const mid: V2 = [(fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2];
      const fine = (q: V2) => ({ x: Math.round(q[0] * 1000) / 1000, y: Math.round(q[1] * 1000) / 1000 });
      faces.push({
        a: fine([mid[0] - (Math.cos(ang) * w) / 2, mid[1] - (Math.sin(ang) * w) / 2]),
        b: fine([mid[0] + (Math.cos(ang) * w) / 2, mid[1] + (Math.sin(ang) * w) / 2]),
        width: w,
      });
      for (const h of f.holes) {
        const c = circle(h);
        if (!c) continue;
        const w = tf(pl, c.c[0], c.c[1]);
        // the joining face is laminated to three thicknesses; mark the hole in the middle of it
        const p: V2 = [w[0] + n[0] * 1.5 * T, w[1] + n[1] * 1.5 * T];
        fixings.push({ p: pt(p), kind: c.d >= 9.5 ? "dowel" : "bolt", d: c.d });
      }
    }
  }

  // frame members under the top: faces, walls, ribs, seam ribs (centre lines)
  const members: { a: { x: number; y: number }; b: { x: number; y: number }; thickness: number; kind: string }[] = [];
  for (const p of base) {
    const kind = p.role === "face" ? "end" : p.role === "wall" ? "side" : p.role === "seam" ? "cross" : p.role === "rib" ? (/spine|runner|index/i.test(p.name) ? "spine" : "cross") : null;
    if (!kind) continue;
    for (const pl of p.placements) {
      if (!vertical(pl)) continue;
      const th = p.role === "face" ? 3 * T : T;
      const n = pl[3];
      const a = tf(pl, p.bbox[0], 0), b = tf(pl, p.bbox[2], 0);
      const sh = (q: V3): V2 => [q[0] + (n[0] * th) / 2, q[1] + (n[1] * th) / 2];
      members.push({ a: pt(sh(a)), b: pt(sh(b)), thickness: th, kind });
    }
  }

  // openings in the bottom skin (access for point motors and wiring); the slots for tabs are much smaller
  const openings = bottoms.flatMap((p) => p.placements.flatMap((pl) => p.holes.filter((h) => area(h) > 2000)
    .map((h) => simplify(h.map((q) => plan(tf(pl, q[0], q[1]))), 0.6).map(pt))));

  // moving decks, turntable discs, wells in the top, canopies and backscenes
  const features: { kind: string; label: string; outline?: { x: number; y: number }[]; line?: { x: number; y: number }[] }[] = [];
  const seen = new Set<string>();
  for (const p of m.parts) {
    for (const pl of p.placements) {
      const poly = () => simplify(p.outer.map((q) => plan(tf(pl, q[0], q[1]))), 1).map(pt);
      let f: (typeof features)[number] | null = null;
      if (p.group === "deck" && p.role === "top") f = { kind: "deck", label: /turntable/.test(m.id) ? "Turning deck" : "Sliding deck", outline: poly() };
      else if (p.group === "deck" && p.role === "disc") f = { kind: "disc", label: "Turntable disc", outline: poly() };
      else if (p.group === "canopy" && p.role === "top") f = { kind: "canopy", label: "Lighting pelmet above", outline: poly() };
      else if (p.group === "canopy" && p.role === "panel" && vertical(pl)) f = { kind: "backscene", label: "Backscene", line: [pt(plan(tf(pl, p.bbox[0], 0))), pt(plan(tf(pl, p.bbox[2], 0)))] };
      else if (p.group === "base" && p.role === "top") for (const h of p.holes.filter((x) => area(x) > 2000)) {
        const o = simplify(h.map((q) => plan(tf(pl, q[0], q[1]))), 1).map(pt);
        const k = JSON.stringify(o);
        if (!seen.has(k)) { seen.add(k); features.push({ kind: "well", label: "Opening in the top", outline: o }); }
      }
      if (!f) continue;
      const k = f.kind + JSON.stringify(f.outline ?? f.line);
      if (!seen.has(k)) { seen.add(k); features.push(f); }
    }
  }

  // guide lines engraved on the top skin(s) and the deck: centre lines, centre arcs, 100 mm ticks
  const marks: [number, number, number, number][] = [];
  for (const p of m.parts.filter((x) => x.role === "top" && x.group !== "canopy")) {
    for (const pl of p.placements) for (const e of p.engrave) {
      const a = tf(pl, e[0], e[1]), b = tf(pl, e[2], e[3]);
      marks.push([r1(a[0]), r1(a[1]), r1(b[0]), r1(b[1])]);
    }
  }

  const canopy = m.parts.some((p) => p.group === "canopy");
  return {
    format: 2,
    id: m.id,
    name: m.name.charAt(0).toUpperCase() + m.name.slice(1),
    family: m.family,
    size: m.size.replace(/ mm$/, " mm"),
    blurb: m.blurb,
    length: r1(maxX - minX),
    width: r1(maxY - minY),
    depth: 100,
    sheet: T,
    material: `${T} mm birch plywood`,
    weightKg: m.stats.kg,
    pieces: m.stats.pieces,
    sheets: { count: m.stats.sheets, size: m.stats.sheet },
    cutLengthM: m.stats.cut_m,
    outline: outline.map(pt),
    faces,
    fixings,
    members,
    openings,
    features,
    marks,
    canopyHeight: canopy ? 400 : undefined,
    hardware: m.hardware,
    hardwarePerJoint: [
      { item: "M8 bolt with wing nut and washers", count: 2 },
      { item: "10 mm alignment dowel (or pattern-makers' dowel, 8 mm pin)", count: 2 },
    ],
    source: "Laser-cut baseboard range from the OO/H0 layout project (make_baseboards.py), imported from data/baseboard-range.json.",
  };
}

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith(".json")) rmSync(join(outDir, f));
const ids: string[] = [];
for (const m of data.modules) {
  const out = convert(m);
  writeFileSync(join(outDir, `${m.id}.json`), JSON.stringify(out, null, 1) + "\n");
  ids.push(m.id);
  console.log(`${m.id.padEnd(22)} ${String(out.faces.length)} faces, ${out.fixings.length} fixings, ${out.members.length} members, ${out.openings.length} openings, ${out.features.length} features`);
}
const ident = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "_");
writeFileSync(join(outDir, "index.ts"), `// Generated by scripts/import-baseboards.ts: the laser-cut baseboard range.\n${ids.map((id) => `import ${ident(id)} from "./${id}.json";`).join("\n")}\n\nexport const BOARD_DATA: unknown[] = [${ids.map(ident).join(", ")}];\n`);
console.log(`Wrote ${ids.length} modules to src/boards/`);
