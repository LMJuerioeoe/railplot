// Scenery placed on a plan, and the room the layout stands in.
// (Trains are not scenery: the drive view has its own rolling stock, see src/sim.)
import { Pose, Vec, normAngle, pointInPoly, rot } from "./geom";
import { MAT, Mesh, RGB, rgb } from "./gfx/mesh";
import { BuildOpts, SCENERY } from "./models/scenery";
import { Project, analyze, geom, isVisible, mainLibrary, uid } from "./model";
import { getLibrary } from "./library";
import { poseAt, routeHeights } from "./trackdetail";

/** A scenery item on the plan. Sizes are stored only when changed from the catalogue's. */
export interface PlanObject {
  id: string;
  kind: string;                 // "scenery/<id>"
  x: number; y: number; rot: number;
  z?: number;                   // height of its base above the baseboard, mm
  w?: number; d?: number; hgt?: number;
  color?: string;
  name?: string;
  /** Sitting on track (set when it was dropped on a piece of track). */
  onTrack?: boolean;
}

/** The room around the layout: a floor outline in plan coordinates and the heights that go with it. */
export interface Room {
  pts: Vec[];
  /** Floor to ceiling, mm. */
  height: number;
  /** Floor to the top of the baseboards, mm. */
  boardHeight: number;
  wall: string;
  floor: "wood" | "carpet" | "concrete";
  /** Indices of walls (the edge from pts[i] to pts[i + 1]) left open: a railing, a doorway, the open side of a loft. */
  open?: number[];
}

export interface ObjDef {
  key: string; id: string; name: string; group: string;
  w: number; d: number; hgt: number;
  sizes: { w?: string; d?: string; hgt?: string };
  color: string; colors: string[];
  stock: boolean; onTrack: boolean; flat: boolean; real: boolean; floor: boolean;
  build: (m: Mesh, o: BuildOpts) => void;
}

export const OBJECTS: ObjDef[] = [
  ...SCENERY.map((s): ObjDef => ({
    key: `scenery/${s.id}`, id: s.id, name: s.name, group: s.group, w: s.w, d: s.d, hgt: s.hgt, sizes: s.sizes, color: s.color, colors: s.colors ?? [s.color],
    stock: false, onTrack: !!s.onTrack, flat: !!s.flat, real: !!s.real, floor: !!s.floor, build: s.build,
  })),
];
const index = new Map(OBJECTS.map((o) => [o.key, o]));
export const objectDef = (kind: string) => index.get(kind);
export const SCENERY_GROUPS = [...new Set(SCENERY.map((s) => s.group))];

/** Height of the rail head above the baseboard for vehicles standing on track, mm. */
export const RAIL_TOP = 4.2;

/** Models are drawn for OO (1:76); H0 layouts (1:87) get them a little smaller. */
export function objectScale(p: Project): number {
  const lib = getLibrary(mainLibrary(p));
  return lib && /h0|ho/i.test(lib.scale) ? 76.2 / 87 : 1;
}

export interface ObjBox { w: number; d: number; hgt: number; k: number }
/** Size of an object on the plan, in millimetres, and the scale its model is built at. */
export function objectBox(p: Project, o: PlanObject): ObjBox {
  const def = objectDef(o.kind);
  if (!def) return { w: o.w ?? 50, d: o.d ?? 50, hgt: o.hgt ?? 50, k: 1 };
  const k = def.real ? 1 : objectScale(p);
  return { w: (o.w ?? def.w) * k, d: (o.d ?? def.d) * k, hgt: (o.hgt ?? def.hgt) * k, k };
}
export function objectCorners(p: Project, o: PlanObject, pad = 0): Vec[] {
  const b = objectBox(p, o), hw = b.w / 2 + pad, hd = b.d / 2 + pad;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => { const q = rot({ x, y }, o.rot); return { x: q.x + o.x, y: q.y + o.y }; });
}
export function objectBounds(p: Project, o: PlanObject) {
  const c = objectCorners(p, o);
  return { minX: Math.min(...c.map((q) => q.x)), minY: Math.min(...c.map((q) => q.y)), maxX: Math.max(...c.map((q) => q.x)), maxY: Math.max(...c.map((q) => q.y)) };
}

/** The object under a point: vehicles first, then things standing up, then flat ground cover. */
export function objectAt(p: Project, q: Vec, pad = 0, which: "stock" | "upright" | "flat" | "floor" | "any" = "any"): PlanObject | undefined {
  const list = p.objects ?? [];
  const rank = (o: PlanObject) => { const d = objectDef(o.kind); return d?.stock ? 0 : d?.floor ? 3 : d?.flat ? 2 : 1; };
  const want = which === "stock" ? 0 : which === "upright" ? 1 : which === "flat" ? 2 : which === "floor" ? 3 : -1;
  let best: PlanObject | undefined, bestRank = 9, bestArea = Infinity;
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i], r = rank(o);
    if (want >= 0 && r !== want) continue;
    const small = Math.min(objectBox(p, o).w, objectBox(p, o).d) < 14 ? 6 : 0;
    if (!pointInPoly(q, objectCorners(p, o, pad + small))) continue;
    const b = objectBox(p, o), area = b.w * b.d;
    if (r < bestRank || (r === bestRank && area < bestArea)) { best = o; bestRank = r; bestArea = area; }
  }
  return best;
}
export function objectsInRect(p: Project, a: Vec, b: Vec): string[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return (p.objects ?? []).filter((o) => { const bb = objectBounds(p, o); return bb.minX >= x0 && bb.maxX <= x1 && bb.minY >= y0 && bb.maxY <= y1; }).map((o) => o.id);
}
export const objectById = (p: Project, id: string) => (p.objects ?? []).find((o) => o.id === id);

export function addObject(p: Project, kind: string, x: number, y: number, rotation = 0): PlanObject {
  const def = objectDef(kind);
  if (!def) throw new Error(`Unknown scenery or vehicle "${kind}"`);
  const o: PlanObject = { id: uid(p, "o"), kind, x, y, rot: rotation };
  (p.objects ??= []).push(o);
  return o;
}

/** The nearest point on any visible track: where it is, which way the track runs and how high it is. */
export function nearestTrack(p: Project, q: Vec, tol: number): (Pose & { z: number; item: string; dist: number }) | null {
  let best: (Pose & { z: number; item: string; dist: number }) | null = null;
  for (const it of p.items) {
    if (!isVisible(p, it)) continue;
    const g = geom(it);
    if (q.x < g.bounds.minX - tol || q.x > g.bounds.maxX + tol || q.y < g.bounds.minY - tol || q.y > g.bounds.maxY + tol) continue;
    g.routes.forEach((r, ri) => {
      const n = Math.max(2, Math.ceil(r.length / 4));
      const [z0, z1] = routeHeights(it, ri);
      for (let i = 0; i <= n; i++) {
        const t = (r.length * i) / n, s = poseAt(r.prims, t), d = Math.hypot(s.x - q.x, s.y - q.y);
        if (d <= tol && (!best || d < best.dist)) best = { ...s, z: z0 + (z1 - z0) * (t / (r.length || 1)), item: it.id, dist: d };
      }
    });
  }
  return best;
}

/** Put an object that belongs on track onto the nearest track (or track end, for buffer stops). Returns whether it snapped. */
export function snapObjectToTrack(p: Project, o: PlanObject, tol = 45): boolean {
  const def = objectDef(o.kind);
  if (!def?.onTrack) return false;
  if (def.id === "buffer-stop") {
    const an = analyze(p);
    let best: { x: number; y: number; h: number; z: number } | null = null, bd = tol * 1.5;
    for (const e of an.free) { const d = Math.hypot(e.x - o.x, e.y - o.y); if (d < bd) { bd = d; best = e; } }
    if (best) { o.x = best.x; o.y = best.y; o.rot = normAngle(best.h); o.z = best.z || undefined; o.onTrack = true; return true; }
  }
  const t = nearestTrack(p, o, tol);
  if (!t) { if (o.onTrack) { delete o.onTrack; delete o.z; } return false; }
  // keep facing the way it already faces, as far as the track allows
  const flip = Math.cos(normAngle(o.rot - t.h)) < 0;
  o.x = t.x; o.y = t.y; o.rot = normAngle(t.h + (flip ? Math.PI : 0));
  o.z = t.z || undefined; o.onTrack = true;
  return true;
}

function seedOf(id: string): number { let s = 0; for (const c of id) s = (s * 31 + c.charCodeAt(0)) % 9973; return s % 5; }

/** Add an object's model to a mesh, in plan coordinates. */
export function buildObject(m: Mesh, p: Project, o: PlanObject, at?: Pose & { z: number }, floorZ = 0) {
  const def = objectDef(o.kind);
  if (!def) return;
  const b = objectBox(p, o);
  const base = (at?.z ?? o.z ?? 0) + (def.stock && (at || o.onTrack) ? RAIL_TOP : 0) + (def.floor ? floorZ : 0);
  m.push().move(at?.x ?? o.x, at?.y ?? o.y, base).turn(at?.h ?? o.rot).scale(b.k);
  def.build(m, { w: b.w / b.k, d: b.d / b.k, hgt: b.hgt / b.k, col: rgb(o.color ?? def.color), seed: seedOf(o.id) });
  m.pop();
}

// ---------- top views for the plan ----------

const sprites = new Map<string, HTMLCanvasElement>();
/** A picture of an object seen from straight above, lit from the top left. `s` is pixels per millimetre. */
export function objectSprite(p: Project, o: PlanObject, s: number): { img: HTMLCanvasElement; w: number; d: number; s: number } | null {
  const def = objectDef(o.kind);
  if (!def) return null;
  const b = objectBox(p, o);
  const pad = def.flat ? 0 : Math.min(40, b.hgt * 0.35) + 2;
  const W = b.w + pad * 2, D = b.d + pad * 2;
  // sprite scale: a power of two near the zoom, capped so big things stay cheap
  let ss = Math.pow(2, Math.ceil(Math.log2(Math.max(0.05, s))));
  ss = Math.min(ss, 8, 1400 / Math.max(W, D));
  const key = `${o.kind}|${b.w.toFixed(1)}|${b.d.toFixed(1)}|${b.hgt.toFixed(1)}|${o.color ?? ""}|${seedOf(o.id)}|${ss.toFixed(3)}`;
  let img = sprites.get(key);
  if (!img) {
    const m = new Mesh();
    m.scale(b.k);
    def.build(m, { w: b.w / b.k, d: b.d / b.k, hgt: b.hgt / b.k, col: rgb(o.color ?? def.color), seed: seedOf(o.id) });
    img = document.createElement("canvas");
    img.width = Math.max(2, Math.ceil(W * ss)); img.height = Math.max(2, Math.ceil(D * ss));
    const ctx = img.getContext("2d")!;
    const d = m.data, ix = m.idx, tris: { z: number; i: number }[] = [];
    for (let i = 0; i < ix.length; i += 3) {
      const nz = d[ix[i] * 10 + 5] + d[ix[i + 1] * 10 + 5] + d[ix[i + 2] * 10 + 5];
      if (nz < -0.3) continue;
      tris.push({ z: Math.max(d[ix[i] * 10 + 2], d[ix[i + 1] * 10 + 2], d[ix[i + 2] * 10 + 2]) + (nz > 2 ? 0.01 : 0), i });
    }
    tris.sort((a, c) => a.z - c.z);
    const L = [-0.38, 0.46, 0.8];
    const X = (v: number) => (d[v * 10] + W / 2) * ss, Y = (v: number) => (D / 2 - d[v * 10 + 1]) * ss;
    ctx.lineJoin = "round"; ctx.lineWidth = 0.8;
    for (const t of tris) {
      const a = ix[t.i], bb = ix[t.i + 1], c = ix[t.i + 2];
      let nx = d[a * 10 + 3], ny = d[a * 10 + 4], nz = d[a * 10 + 5];
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const mat = d[a * 10 + 9];
      let k = 0.5 + 0.62 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      if (mat === MAT.glow) k = 1.25; else if (mat === MAT.glass || mat === MAT.window) k *= 0.75; else if (mat === MAT.steel) k *= 1.12;
      const r = Math.min(255, Math.round(255 * Math.pow(d[a * 10 + 6], 0.92) * k)), g = Math.min(255, Math.round(255 * Math.pow(d[a * 10 + 7], 0.92) * k)), bl = Math.min(255, Math.round(255 * Math.pow(d[a * 10 + 8], 0.92) * k));
      ctx.fillStyle = ctx.strokeStyle = `rgb(${r},${g},${bl})`;
      ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(bb), Y(bb)); ctx.lineTo(X(c), Y(c)); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (!def.flat) {
      // bake a soft shadow round the object into the picture once, so drawing the plan stays fast
      const lit = img;
      img = document.createElement("canvas");
      img.width = lit.width; img.height = lit.height;
      const c2 = img.getContext("2d")!;
      c2.shadowColor = "rgba(0,0,0,0.42)"; c2.shadowBlur = Math.max(2, 4 * ss); c2.shadowOffsetX = 0; c2.shadowOffsetY = Math.max(1, 1.5 * ss);
      c2.drawImage(lit, 0, 0);
    }
    if (sprites.size > 400) sprites.clear();
    sprites.set(key, img);
  }
  return { img, w: W, d: D, s: ss };
}

/** A three-quarter picture of an object for the library list. */
export function objectThumb(p: Project, kind: string, wpx: number, hpx: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = wpx; cv.height = hpx;
  const def = objectDef(kind);
  if (!def) return cv;
  const m = new Mesh();
  def.build(m, { w: def.w, d: def.d, hgt: def.hgt, col: rgb(def.color), seed: 2 });
  const d = m.data, ix = m.idx;
  const yaw = def.stock ? -0.5 : -0.42, el = def.flat ? 0.95 : 0.5;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ce = Math.cos(el), se = Math.sin(el);
  const n = d.length / 10, sx = new Float32Array(n), sz = new Float32Array(n), dep = new Float32Array(n);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const X = d[i * 10] * cy - d[i * 10 + 1] * sy, Y = d[i * 10] * sy + d[i * 10 + 1] * cy, Z = d[i * 10 + 2];
    sx[i] = X; sz[i] = Y * se + Z * ce; dep[i] = Y * ce - Z * se;
    if (X < x0) x0 = X; if (X > x1) x1 = X; if (sz[i] < y0) y0 = sz[i]; if (sz[i] > y1) y1 = sz[i];
  }
  const k = Math.min((wpx - 8) / Math.max(1, x1 - x0), (hpx - 8) / Math.max(1, y1 - y0));
  const ox = wpx / 2 - ((x0 + x1) / 2) * k, oy = hpx / 2 + ((y0 + y1) / 2) * k;
  const tris: { z: number; i: number }[] = [];
  for (let i = 0; i < ix.length; i += 3) tris.push({ z: (dep[ix[i]] + dep[ix[i + 1]] + dep[ix[i + 2]]) / 3, i });
  tris.sort((a, b) => b.z - a.z);
  const ctx = cv.getContext("2d")!;
  ctx.lineJoin = "round"; ctx.lineWidth = 0.7;
  const L = [-0.45, -0.5, 0.74];
  // view direction (towards the viewer), to light faces from the side they are seen from
  const vx = sy * ce * -1, vy = -cy * ce, vz = se;
  for (const t of tris) {
    const a = ix[t.i], b = ix[t.i + 1], c = ix[t.i + 2];
    let nx = d[a * 10 + 3], ny = d[a * 10 + 4], nz = d[a * 10 + 5];
    if (nx * vx + ny * vy + nz * vz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const mat = d[a * 10 + 9];
    let sh = 0.42 + 0.7 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
    if (mat === MAT.glow) sh = 1.3; else if (mat === MAT.glass || mat === MAT.window) sh *= 0.8; else if (mat === MAT.steel) sh *= 1.15;
    const ch = (v: number) => Math.min(255, Math.round(255 * Math.pow(v, 0.9) * sh));
    ctx.fillStyle = ctx.strokeStyle = `rgb(${ch(d[a * 10 + 6])},${ch(d[a * 10 + 7])},${ch(d[a * 10 + 8])})`;
    ctx.beginPath(); ctx.moveTo(ox + sx[a] * k, oy - sz[a] * k); ctx.lineTo(ox + sx[b] * k, oy - sz[b] * k); ctx.lineTo(ox + sx[c] * k, oy - sz[c] * k); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  return cv;
}

/** Draw an object on a 2D canvas whose transform maps millimetres (y up) to the screen through `toScreen`. */
export function drawObject2d(ctx: CanvasRenderingContext2D, p: Project, o: PlanObject, toScreen: (q: Vec) => Vec, s: number) {
  const sp = objectSprite(p, o, s);
  if (!sp) return;
  const c = toScreen({ x: o.x, y: o.y });
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(-o.rot);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sp.img, (-sp.w / 2) * s, (-sp.d / 2) * s, sp.w * s, sp.d * s);
  ctx.restore();
}

// ---------- the room ----------

export function roomFromBoards(p: Project, margin = 300): Room | null {
  if (!p.boards.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of p.boards) for (const q of b.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const r = (v: number) => Math.round(v / 10) * 10;
  return { pts: [{ x: r(x0 - margin), y: r(y0 - margin) }, { x: r(x1 + margin), y: r(y0 - margin) }, { x: r(x1 + margin), y: r(y1 + margin) }, { x: r(x0 - margin), y: r(y1 + margin) }], height: 2400, boardHeight: 1000, wall: "#e9e6df", floor: "wood" };
}
export function rectRoom(x: number, y: number, w: number, d: number, base?: Partial<Room>): Room {
  return { height: 2400, boardHeight: 1000, wall: "#e9e6df", floor: "wood", ...base, pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }] };
}
export function roomBox(r: Room) {
  const xs = r.pts.map((q) => q.x), ys = r.pts.map((q) => q.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
}

/** Move, turn and mirror objects together with the rest of a selection. */
export function moveObjects(p: Project, ids: Iterable<string>, dx: number, dy: number) {
  const set = new Set(ids);
  for (const o of p.objects ?? []) if (set.has(o.id)) { o.x += dx; o.y += dy; }
}
export function rotateObjects(p: Project, ids: Iterable<string>, angle: number, about: Vec) {
  const set = new Set(ids);
  for (const o of p.objects ?? []) if (set.has(o.id)) {
    const q = rot({ x: o.x - about.x, y: o.y - about.y }, angle);
    o.x = q.x + about.x; o.y = q.y + about.y; o.rot = normAngle(o.rot + angle);
  }
}
export function mirrorObjects(p: Project, ids: Iterable<string>, cx: number) {
  const set = new Set(ids);
  for (const o of p.objects ?? []) if (set.has(o.id)) { o.x = 2 * cx - o.x; o.rot = normAngle(Math.PI - o.rot); }
}
export function deleteObjects(p: Project, ids: Iterable<string>) {
  const set = new Set(ids);
  if (p.objects) p.objects = p.objects.filter((o) => !set.has(o.id));
}
