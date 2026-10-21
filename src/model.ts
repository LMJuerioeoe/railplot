// The layout document and the operations the editor performs on it.
import {
  DEG, Pose, Prim, Seg, Vec, add, dist, mergeSegs, minRadius, normAngle, pointInPoly,
  primBounds, primOf, rot, segLength, sub, walk,
} from "./geom";
import { Part, getPart, routeLength } from "./library";
import type { ControlConfig } from "./control/types";
import type { Proposal } from "./proposals";
import { MODULES, ModulePlacement, TrackGuide, endsTouch, facesMatching, getModule, moduleCorners, moduleEnds, moduleGuides, moduleMembers, modulePorts, moduleToWorld, placementAtEnd } from "./modules";

export const FILE_FORMAT = "railplot";
export const FILE_VERSION = 1;
export const JOIN_TOL = 0.5;          // mm: ends closer than this are treated as touching
export const ALIGN_TOL = 1.5 * DEG;   // touching ends must face each other within this angle

export interface Layer { id: string; name: string; visible: boolean }
export interface Board { id: string; name: string; pts: Vec[]; module?: ModulePlacement }
export interface StartPoint { id: string; x: number; y: number; h: number }
export interface Item {
  id: string;
  layer: string;
  part: string;       // "<libraryId>/<partId>"
  x: number; y: number; rot: number; mirror: boolean;
  z: number[];        // height of each endpoint above baseboard, mm
  segs?: Seg[];       // flex track shape, local frame
}
export interface Project {
  format: typeof FILE_FORMAT;
  version: number;
  name: string;
  units: "mm" | "in";
  gridStep: number;
  layers: Layer[];
  activeLayer: string;
  boards: Board[];
  starts: StartPoint[];
  items: Item[];
  nextId: number;
  /** How the real layout is wired for control (optional). */
  control?: ControlConfig;
  /** Changes suggested through the Claude connector, waiting to be accepted or rejected. */
  proposals?: Proposal[];
}

export function newProject(name = "Untitled layout"): Project {
  return {
    format: FILE_FORMAT, version: FILE_VERSION, name, units: "mm", gridStep: 50,
    layers: [{ id: "L1", name: "Main line", visible: true }], activeLayer: "L1",
    boards: [], starts: [], items: [], nextId: 1,
  };
}

export function uid(p: Project, prefix: string): string {
  return `${prefix}${p.nextId++}`;
}

// ---------- geometry of items ----------

export interface WorldEnd { x: number; y: number; h: number; z: number }
export interface ItemGeom {
  part: Part;
  routes: { prims: Prim[]; length: number }[];
  ends: WorldEnd[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  length: number;
}

const cache = new Map<string, { sig: string; g: ItemGeom }>();

export function toWorld(it: Item, p: Pose): Pose {
  const lx = p.x, ly = it.mirror ? -p.y : p.y, lh = it.mirror ? -p.h : p.h;
  const w = rot({ x: lx, y: ly }, it.rot);
  return { x: w.x + it.x, y: w.y + it.y, h: normAngle(it.rot + lh) };
}

function mirrorSeg(s: Seg, m: boolean): Seg {
  return m && s.kind === "a" ? { ...s, deg: -s.deg } : s;
}

export function partOf(it: Item): Part {
  const p = getPart(it.part);
  if (!p) throw new Error(`Unknown track part ${it.part}`);
  return p;
}

/** Local routes of an item (flex items carry their own shape). */
export function itemRoutes(it: Item) {
  const part = partOf(it);
  if (part.def.type === "flex") return [{ from: { x: 0, y: 0, h: 0 }, segs: it.segs ?? [] }];
  return part.routes;
}

export function geom(it: Item): ItemGeom {
  const sig = `${it.part}|${it.x}|${it.y}|${it.rot}|${it.mirror}|${it.z.join(",")}|${it.segs ? JSON.stringify(it.segs) : ""}`;
  const hit = cache.get(it.id);
  if (hit && hit.sig === sig) return hit.g;
  const part = partOf(it);
  const routes = itemRoutes(it).map((r) => {
    let p = toWorld(it, r.from);
    const prims: Prim[] = [];
    for (const s0 of r.segs) {
      const s = mirrorSeg(s0, it.mirror);
      prims.push(primOf(p, s));
      p = walk(p, s);
    }
    return { prims, length: r.segs.reduce((a, s) => a + segLength(s), 0) };
  });
  let ends: WorldEnd[];
  if (part.def.type === "flex") {
    const segs = it.segs ?? [];
    let e: Pose = { x: 0, y: 0, h: 0 };
    for (const s of segs) e = walk(e, s);
    const a = toWorld(it, { x: 0, y: 0, h: Math.PI }), b = toWorld(it, e);
    ends = [{ ...a, z: it.z[0] ?? 0 }, { ...b, z: it.z[1] ?? 0 }];
  } else {
    ends = part.ends.map((e, i) => ({ ...toWorld(it, e), z: it.z[i] ?? 0 }));
  }
  const g: ItemGeom = {
    part, routes, ends,
    bounds: primBounds(routes.flatMap((r) => r.prims), part.lib.profile.sleeperLength / 2),
    length: routes[0]?.length ?? 0,
  };
  cache.set(it.id, { sig, g });
  return g;
}

export function endCount(it: Item): number {
  return partOf(it).def.type === "flex" ? 2 : partOf(it).ends.length;
}

// ---------- connectivity ----------

export interface EndRef { item: string; end: number }
export interface Analysis {
  ends: (WorldEnd & EndRef)[];
  partner: Map<string, EndRef>;      // "item:end" -> joined end
  free: (WorldEnd & EndRef)[];
  bad: (WorldEnd & EndRef)[];        // touching but misaligned
}

export const endKey = (r: EndRef) => `${r.item}:${r.end}`;

export function analyze(p: Project): Analysis {
  const ends: (WorldEnd & EndRef)[] = [];
  for (const it of p.items) geom(it).ends.forEach((e, i) => ends.push({ ...e, item: it.id, end: i }));
  const grid = new Map<string, number[]>();
  const cell = (x: number) => Math.floor(x / 2);
  ends.forEach((e, i) => {
    const k = `${cell(e.x)},${cell(e.y)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const partner = new Map<string, EndRef>();
  const badSet = new Set<number>();
  ends.forEach((e, i) => {
    const cx = cell(e.x), cy = cell(e.y);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (j <= i) continue;
        const o = ends[j];
        if (o.item === e.item) continue;
        if (dist(e, o) > JOIN_TOL) continue;
        if (Math.abs(normAngle(e.h - o.h - Math.PI)) <= ALIGN_TOL) {
          partner.set(endKey(e), { item: o.item, end: o.end });
          partner.set(endKey(o), { item: e.item, end: e.end });
        } else { badSet.add(i); badSet.add(j); }
      }
    }
  });
  const free = ends.filter((e, i) => !partner.has(endKey(e)) && !badSet.has(i));
  const bad = ends.filter((_, i) => badSet.has(i) && !partner.has(endKey(ends[i])));
  return { ends, partner, free, bad };
}

// ---------- placing track ----------

export type Anchor = { kind: "end"; item: string; end: number } | { kind: "start"; id: string } | { kind: "port"; x: number; y: number; h: number };

export function anchorPose(p: Project, a: Anchor): (Pose & { z: number }) | null {
  if (a.kind === "port") return { x: a.x, y: a.y, h: a.h, z: 0 };
  if (a.kind === "start") {
    const s = p.starts.find((s) => s.id === a.id);
    return s ? { x: s.x, y: s.y, h: s.h, z: 0 } : null;
  }
  const it = p.items.find((i) => i.id === a.item);
  if (!it) return null;
  const e = geom(it).ends[a.end];
  return e ? { x: e.x, y: e.y, h: e.h, z: e.z } : null;
}

/** Transform that puts local end `k` of `part` (optionally mirrored) onto a world pose facing it. */
export function placementFor(part: Part, k: number, mirror: boolean, at: Pose) {
  const e = part.ends[k];
  const ly = mirror ? -e.y : e.y, lh = mirror ? -e.h : e.h;
  const r = normAngle(at.h + Math.PI - lh);
  const w = rot({ x: e.x, y: ly }, r);
  return { x: at.x - w.x, y: at.y - w.y, rot: r };
}

export function placePart(p: Project, partKey: string, at: Pose & { z?: number }, k = 0, mirror = false): Item {
  const part = getPart(partKey);
  if (!part) throw new Error(`Unknown part ${partKey}`);
  if (part.def.type === "flex") throw new Error("Use the flex tool for flexible track");
  k = Math.max(0, Math.min(k, part.ends.length - 1));
  const t = placementFor(part, k, mirror, at);
  const it: Item = {
    id: uid(p, "t"), layer: p.activeLayer, part: partKey,
    x: t.x, y: t.y, rot: t.rot, mirror, z: part.ends.map(() => at.z ?? 0),
  };
  p.items.push(it);
  return it;
}

/** The end a new piece should continue from after being joined at end k. */
export function continuationEnd(part: Part, k: number): number {
  if (part.def.type === "flex") return k === 0 ? 1 : 0;
  const e = part.ends[k];
  const r = part.routes[e.route];
  const target = e.atStart ? (() => { let q = r.from; for (const s of r.segs) q = walk(q, s); return q; })() : r.from;
  const idx = part.ends.findIndex((o, i) => i !== k && dist(o, target) < 0.05);
  return idx >= 0 ? idx : (k + 1) % part.ends.length;
}

export function addStart(p: Project, x: number, y: number, h = 0): StartPoint {
  const s = { id: uid(p, "s"), x, y, h };
  p.starts.push(s);
  return s;
}

export function createFlex(p: Project, partKey: string, at: Pose & { z?: number }, segs: Seg[]): Item {
  const it: Item = {
    id: uid(p, "t"), layer: p.activeLayer, part: partKey,
    x: at.x, y: at.y, rot: normAngle(at.h), mirror: false,
    z: [at.z ?? 0, at.z ?? 0], segs: mergeSegs(segs),
  };
  p.items.push(it);
  return it;
}

// ---------- editing ----------

export function itemsById(p: Project, ids: Iterable<string>): Item[] {
  const set = new Set(ids);
  return p.items.filter((i) => set.has(i.id));
}

export function deleteItems(p: Project, ids: Iterable<string>) {
  const set = new Set(ids);
  p.items = p.items.filter((i) => !set.has(i.id));
  p.boards = p.boards.filter((b) => !set.has(b.id));
  p.starts = p.starts.filter((s) => !set.has(s.id));
}

export function moveItems(p: Project, ids: Iterable<string>, dx: number, dy: number) {
  const set = new Set(ids);
  for (const it of p.items) if (set.has(it.id)) { it.x += dx; it.y += dy; }
  for (const b of p.boards) if (set.has(b.id)) {
    b.pts = b.pts.map((q) => ({ x: q.x + dx, y: q.y + dy }));
    if (b.module) { b.module.cx += dx; b.module.cy += dy; }
  }
  for (const s of p.starts) if (set.has(s.id)) { s.x += dx; s.y += dy; }
}

export function rotateItems(p: Project, ids: Iterable<string>, angle: number, about: Vec) {
  const set = new Set(ids);
  const rp = (q: Vec) => add(about, rot(sub(q, about), angle));
  for (const it of p.items) if (set.has(it.id)) {
    const q = rp(it); it.x = q.x; it.y = q.y; it.rot = normAngle(it.rot + angle);
  }
  for (const b of p.boards) if (set.has(b.id)) {
    b.pts = b.pts.map(rp);
    if (b.module) { const c = rp({ x: b.module.cx, y: b.module.cy }); b.module.cx = c.x; b.module.cy = c.y; b.module.rot = normAngle(b.module.rot + angle); }
  }
  for (const s of p.starts) if (set.has(s.id)) { const q = rp(s); s.x = q.x; s.y = q.y; s.h = normAngle(s.h + angle); }
}

/** Mirror the selection left-to-right about a vertical line through `cx`. */
export function mirrorItems(p: Project, ids: Iterable<string>, cx: number) {
  const set = new Set(ids);
  for (const it of p.items) if (set.has(it.id)) {
    it.x = 2 * cx - it.x; it.rot = normAngle(Math.PI - it.rot); it.mirror = !it.mirror;
  }
  for (const b of p.boards) if (set.has(b.id)) {
    b.pts = b.pts.map((q) => ({ x: 2 * cx - q.x, y: q.y })).reverse();
    const m = b.module && getModule(b.module.preset);
    if (b.module && m) {
      // a mirrored module is the mirror-image board (a left-hand corner becomes a right-hand one)
      b.module.cx = 2 * cx - b.module.cx; b.module.rot = normAngle(Math.PI - b.module.rot);
      if (b.module.mirror) delete b.module.mirror; else b.module.mirror = true;
      b.pts = moduleCorners(m, b.module);
    }
  }
  for (const s of p.starts) if (set.has(s.id)) { s.x = 2 * cx - s.x; s.h = normAngle(Math.PI - s.h); }
}

export function selectionBounds(p: Project, ids: Iterable<string>) {
  const set = new Set(ids);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (b: { minX: number; minY: number; maxX: number; maxY: number }) => {
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  };
  for (const it of p.items) if (set.has(it.id)) take(geom(it).bounds);
  for (const b of p.boards) if (set.has(b.id)) take(boardBounds(b));
  for (const s of p.starts) if (set.has(s.id)) take({ minX: s.x - 10, minY: s.y - 10, maxX: s.x + 10, maxY: s.y + 10 });
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function boardBounds(b: Board) {
  const xs = b.pts.map((q) => q.x), ys = b.pts.map((q) => q.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export function projectBounds(p: Project) {
  const ids = [...p.items.map((i) => i.id), ...p.boards.map((b) => b.id), ...p.starts.map((s) => s.id)];
  return selectionBounds(p, ids);
}

/**
 * When a moved selection has a free end close to a free end outside it, return the rigid motion
 * (rotation about the selected end, then translation) that joins them exactly.
 */
export function findSnap(p: Project, ids: Iterable<string>, tol: number, angTol = 12 * DEG) {
  const set = new Set(ids);
  const an = analyze(p);
  const mine = an.free.filter((e) => set.has(e.item));
  const others = an.free.filter((e) => !set.has(e.item));
  let best: { from: WorldEnd; to: WorldEnd; d: number } | null = null;
  for (const a of mine) for (const b of others) {
    const d = dist(a, b);
    if (d > tol) continue;
    if (Math.abs(normAngle(a.h - b.h - Math.PI)) > angTol) continue;
    if (!best || d < best.d) best = { from: a, to: b, d };
  }
  // track ends snap onto the track positions marked on baseboard modules
  for (const a of mine) for (const port of trackPorts(p)) {
    if (set.has(port.board)) continue;
    const d = dist(a, port);
    if (d > tol || Math.abs(normAngle(a.h - port.h - Math.PI)) > angTol) continue;
    if (!best || d < best.d) best = { from: a, to: { ...port, z: 0 } as WorldEnd, d };
  }
  // baseboard modules join end to end
  const ends = freeModuleEnds(p);
  for (const a of ends.filter((e) => set.has(e.board))) for (const b of ends.filter((e) => !set.has(e.board))) {
    const d = dist(a, b);
    if (d > tol * 1.5 || Math.abs(a.width - b.width) > 1) continue;
    if (Math.abs(normAngle(a.h - b.h - Math.PI)) > angTol) continue;
    if (!best || d < best.d) best = { from: { ...a, z: 0 }, to: { ...b, z: 0 }, d };
  }
  if (!best) return null;
  return { about: { x: best.from.x, y: best.from.y }, angle: normAngle(best.to.h + Math.PI - best.from.h), dx: best.to.x - best.from.x, dy: best.to.y - best.from.y };
}

// ---------- baseboard modules ----------

export function addModule(p: Project, presetId: string, pl: Omit<ModulePlacement, "preset">, name?: string): Board {
  const m = getModule(presetId);
  if (!m) throw new Error(`Unknown baseboard module ${presetId}`);
  const placement = { preset: presetId, ...pl };
  const n = p.boards.filter((b) => b.module).length + 1;
  const b: Board = { id: uid(p, "b"), name: name ?? `Module ${n}`, pts: moduleCorners(m, placement), module: placement };
  p.boards.push(b);
  return b;
}

/** Module ends with the board they belong to. */
export function allModuleEnds(p: Project) {
  const out: { board: string; end: number; x: number; y: number; h: number; width: number }[] = [];
  for (const b of p.boards) {
    const m = b.module && getModule(b.module.preset);
    if (!m) continue;
    moduleEnds(m, b.module!).forEach((e, i) => out.push({ board: b.id, end: i, ...e }));
  }
  return out;
}

export function freeModuleEnds(p: Project) {
  const all = allModuleEnds(p);
  return all.filter((a) => !all.some((b) => b.board !== a.board && endsTouch(a, b)));
}

/** Number of module-to-module joints. */
export function moduleJoints(p: Project): number {
  const all = allModuleEnds(p);
  let n = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (all[i].board !== all[j].board && endsTouch(all[i], all[j])) n++;
  return n;
}

/** The free face of a module to build on from: the one opposite a face already joined, or else the one facing most to the right. */
export function nextFreeEnd(p: Project, boardId: string, width?: number) {
  const all = allModuleEnds(p);
  const mine = all.filter((e) => e.board === boardId);
  const joined = mine.filter((e) => all.some((o) => o.board !== boardId && endsTouch(e, o)));
  let free = mine.filter((e) => !joined.includes(e));
  if (width !== undefined && free.some((e) => Math.abs(e.width - width) < 1)) free = free.filter((e) => Math.abs(e.width - width) < 1);
  if (!free.length) return undefined;
  if (joined.length) return free.sort((a, b) => dist(b, joined[0]) - dist(a, joined[0]))[0];
  return free.sort((a, b) => Math.cos(b.h) - Math.cos(a.h))[0];
}

/**
 * Add a module after a free face of an existing module (the last one by default), or beside the layout.
 * `face` picks which of the new module's faces joins (a corner joined by its other face turns the other way).
 */
export function appendModule(p: Project, presetId: string, after?: string, face?: number): Board {
  const m = getModule(presetId)!;
  const target = after ?? [...p.boards].reverse().find((b) => b.module && getModule(b.module.preset))?.id;
  const widths = [...new Set(m.faces.map((f) => f.width))];
  let end: ReturnType<typeof nextFreeEnd>;
  if (target) for (const w of [undefined, ...widths]) { end = nextFreeEnd(p, target, w); if (end && m.faces.some((f) => Math.abs(f.width - end!.width) < 1)) break; end = undefined; }
  if (end) {
    const ok = facesMatching(m, end.width);
    // by default: after the same kind of module, join face to the other face, so a run of curves keeps
    // turning the same way; otherwise the face that needs the least turning (a straight run stays the right way up)
    const prev = p.boards.find((b) => b.id === end.board)?.module;
    const turn = (i: number) => Math.abs(normAngle(placementAtEnd(m, end, i).rot));
    let fi = face !== undefined && ok.includes(face) ? face : [...ok].sort((a, b) => turn(a) - turn(b))[0];
    if (face === undefined && prev && getModule(prev.preset)?.id === m.id && ok.length > 1 && ok.includes(end.end) && fi === end.end)
      fi = ok.find((i) => i !== end.end)!;
    const b = addModule(p, presetId, placementAtEnd(m, end, fi, face === undefined && !!prev?.mirror && getModule(prev.preset)?.id === m.id));
    // the same tracks carry on across the new module
    if (prev?.tracks !== undefined) b.module!.tracks = prev.tracks;
    if (prev?.spacing !== undefined) b.module!.spacing = prev.spacing;
    if (prev?.edge !== undefined) b.module!.edge = prev.edge;
    return b;
  }
  const b = projectBounds(p);
  const x = b ? b.maxX + 100 : 0;
  return addModule(p, presetId, { cx: x + m.length / 2, cy: m.width / 2, rot: 0 });
}

/** Turn a module round so it joins its neighbour by its next matching face (a corner then turns the other way). */
export function rejoinModule(p: Project, boardId: string): boolean {
  const b = p.boards.find((x) => x.id === boardId);
  const m = b?.module && getModule(b.module.preset);
  if (!b || !m) return false;
  const all = allModuleEnds(p);
  const mine = all.filter((e) => e.board === boardId);
  let joinedFace = -1, other: (typeof all)[number] | undefined;
  for (const e of mine) { const o = all.find((x) => x.board !== boardId && endsTouch(e, x)); if (o) { joinedFace = e.end; other = o; break; } }
  if (!other) {
    // not joined: turn it a quarter round on the spot
    b.module!.rot = normAngle(b.module!.rot + Math.PI / 2);
    b.pts = moduleCorners(m, b.module!);
    return true;
  }
  const ok = facesMatching(m, other.width);
  if (ok.length < 2) {
    // only one face fits: flip the module over the joint instead (mirror image of a symmetric board is itself)
    return false;
  }
  const next = ok[(ok.indexOf(joinedFace) + 1) % ok.length];
  const pl = placementAtEnd(m, other, next, b.module!.mirror);
  b.module = { ...pl, preset: b.module!.preset };
  b.pts = moduleCorners(m, b.module);
  return true;
}

export { MODULES };

// ---------- track positions on modules ----------

export interface BoardPort { board: string; face: number; index: number; x: number; y: number; h: number }

/** Every track position on every module's faces. Where two modules meet, each has its own, facing into it. */
export function trackPorts(p: Project): BoardPort[] {
  const out: BoardPort[] = [];
  for (const b of p.boards) {
    const m = b.module && getModule(b.module.preset);
    if (!m) continue;
    for (const q of modulePorts(m, b.module!)) out.push({ board: b.id, face: q.face, index: q.index, x: q.x, y: q.y, h: q.h });
  }
  return out;
}

/** Is there a track end at this position already? */
export function portUsed(p: Project, q: { x: number; y: number }, an = analyze(p)) {
  return an.ends.some((e) => dist(e, q) < 1);
}

export function boardGuides(p: Project, boardId: string): TrackGuide[] {
  const b = p.boards.find((x) => x.id === boardId);
  const m = b?.module && getModule(b.module.preset);
  return m ? moduleGuides(m, b!.module!) : [];
}

/**
 * Lay flexible track along a module's guides, one length per track, skipping tracks already laid and
 * curves tighter than the flexible track allows. Returns what was laid and what was too tight.
 */
export function layGuides(p: Project, boardId: string, flexKey: string): { laid: Item[]; tooTight: number; already: number } {
  const part = getPart(flexKey);
  const minR = part?.def.minRadius ?? 0;
  const an = analyze(p);
  const laid: Item[] = [];
  let tooTight = 0, already = 0;
  for (const g of boardGuides(p, boardId)) {
    // already laid: a track end at the start of the guide, belonging to track on this board
    if (an.ends.some((e) => dist(e, g.from) < 1 && Math.cos(e.h - g.from.h) < -0.9)) { already++; continue; }
    if (g.minRadius < minR - 0.01) { tooTight++; continue; }
    laid.push(createFlex(p, flexKey, { ...g.from, z: 0 }, g.segs));
  }
  return { laid, tooTight, already };
}

/** Where a point's motor sits: a little past the toe, along the straight road. */
export function motorPoint(it: Item): Vec | null {
  const part = partOf(it);
  if (part.def.type !== "turnout") return null;
  const toe = toWorld(it, { x: 0, y: 0, h: 0 });
  return { x: toe.x + Math.cos(toe.h) * 20, y: toe.y + Math.sin(toe.h) * 20 };
}

/** Points whose motor position lands on a frame member of a baseboard module. */
export function motorsOverFrame(p: Project): { item: string; board: string; member: string }[] {
  const out: { item: string; board: string; member: string }[] = [];
  const mods = p.boards.filter((b) => b.module && getModule(b.module.preset));
  if (!mods.length) return out;
  for (const it of p.items) {
    const q = motorPoint(it);
    if (!q) continue;
    for (const b of mods) {
      if (!pointInPoly(q, b.pts)) continue;
      const m = getModule(b.module!.preset)!;
      for (const mem of moduleMembers(m)) {
        const a = moduleToWorld(m, b.module!, mem.a), c = moduleToWorld(m, b.module!, mem.b);
        const ab = sub(c, a), l2 = ab.x * ab.x + ab.y * ab.y;
        const t = Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.y - a.y) * ab.y) / l2));
        const d = dist(q, { x: a.x + ab.x * t, y: a.y + ab.y * t });
        if (d < mem.thickness / 2 + 12) { out.push({ item: it.id, board: b.id, member: mem.kind }); break; }
      }
    }
  }
  return out;
}

export function applySnap(p: Project, ids: Iterable<string>, s: NonNullable<ReturnType<typeof findSnap>>) {
  const list = [...ids];
  rotateItems(p, list, s.angle, s.about);
  moveItems(p, list, s.dx, s.dy);
}

// ---------- heights ----------

/** Set the height of every end touching `at`, carrying the change through turnouts and crossings. */
export function setHeightAt(p: Project, at: Vec, z: number) {
  z = Math.round(z * 10) / 10;
  const queue: Vec[] = [at];
  const seen: Vec[] = [];
  while (queue.length) {
    const q = queue.shift()!;
    if (seen.some((s) => dist(s, q) < JOIN_TOL)) continue;
    seen.push(q);
    for (const it of p.items) {
      const g = geom(it);
      g.ends.forEach((e, i) => {
        if (dist(e, q) > JOIN_TOL) return;
        it.z[i] = z;
        if (g.part.rigid) g.ends.forEach((o, j) => { it.z[j] = z; queue.push(o); });
      });
    }
  }
}

export function shiftHeights(p: Project, ids: Iterable<string>, dz: number) {
  const set = new Set(ids);
  for (const it of p.items) if (set.has(it.id)) it.z = it.z.map((z) => Math.max(0, Math.round((z + dz) * 10) / 10));
}

/** Gradient of a two-ended track in percent (positive climbing from end 0 to end 1), or null. */
export function gradient(it: Item): number | null {
  const g = geom(it);
  if (g.part.rigid || g.ends.length !== 2 || g.length <= 0) return null;
  return ((g.ends[1].z - g.ends[0].z) / g.length) * 100;
}

export type GradeBand = "flat" | "ok" | "steep" | "too-steep";
export function gradeBand(pct: number | null): GradeBand {
  const a = Math.abs(pct ?? 0);
  if (a < 0.05) return "flat";
  if (a <= 2.5) return "ok";
  if (a <= 4) return "steep";
  return "too-steep";
}

// ---------- layers ----------

export function addLayer(p: Project, name?: string): Layer {
  const l = { id: uid(p, "L"), name: name ?? `Layer ${p.layers.length + 1}`, visible: true };
  p.layers.push(l);
  p.activeLayer = l.id;
  return l;
}

export function deleteLayer(p: Project, id: string) {
  if (p.layers.length <= 1) return;
  p.items = p.items.filter((i) => i.layer !== id);
  p.layers = p.layers.filter((l) => l.id !== id);
  if (p.activeLayer === id) p.activeLayer = p.layers[0].id;
}

export function isVisible(p: Project, it: Item): boolean {
  return p.layers.find((l) => l.id === it.layer)?.visible !== false;
}

// ---------- baseboards ----------

export function addRectBoard(p: Project, x: number, y: number, w: number, d: number, name?: string): Board {
  const b = { id: uid(p, "b"), name: name ?? `Board ${p.boards.length + 1}`, pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + d }, { x, y: y + d }] };
  p.boards.push(b);
  return b;
}

export function addPolyBoard(p: Project, pts: Vec[], name?: string): Board {
  const b = { id: uid(p, "b"), name: name ?? `Board ${p.boards.length + 1}`, pts };
  p.boards.push(b);
  return b;
}

export function boardAt(p: Project, q: Vec): Board | undefined {
  for (let i = p.boards.length - 1; i >= 0; i--) if (pointInPoly(q, p.boards[i].pts)) return p.boards[i];
  return undefined;
}

// ---------- summary ----------

export interface Summary {
  pieces: number; flexLength: number; trackLength: number;
  minRadius: number; maxGradient: number; freeEnds: number; badJoints: number;
  boardArea: number; modules: number; moduleWeight: number; motorsOverFrame: number;
}

export function summarize(p: Project): Summary {
  let trackLength = 0, flexLength = 0, minR = Infinity, maxG = 0, pieces = 0;
  for (const it of p.items) {
    const g = geom(it);
    const routes = itemRoutes(it);
    trackLength += g.length;
    if (g.part.def.type === "flex") flexLength += g.length; else pieces++;
    for (const r of routes) minR = Math.min(minR, minRadius(r.segs));
    const gr = gradient(it);
    if (gr !== null) maxG = Math.max(maxG, Math.abs(gr));
  }
  const an = analyze(p);
  let area = 0;
  for (const b of p.boards) {
    let a = 0;
    for (let i = 0, j = b.pts.length - 1; i < b.pts.length; j = i++) a += (b.pts[j].x + b.pts[i].x) * (b.pts[j].y - b.pts[i].y);
    area += Math.abs(a / 2);
  }
  let modules = 0, moduleWeight = 0;
  for (const b of p.boards) { const m = b.module && getModule(b.module.preset); if (m) { modules++; moduleWeight += m.weightKg; } }
  return { pieces, flexLength, trackLength, minRadius: minR, maxGradient: maxG, freeEnds: an.free.length, badJoints: an.bad.length, boardArea: area,
    modules, moduleWeight, motorsOverFrame: motorsOverFrame(p).length };
}

/** The track system most of the plan's sectional track comes from. */
export function mainLibrary(p: Project): string {
  const n = new Map<string, number>();
  for (const it of p.items) { const part = getPart(it.part); if (part && part.def.type !== "flex") n.set(part.lib.id, (n.get(part.lib.id) ?? 0) + 1); }
  if (!n.size) for (const it of p.items) { const part = getPart(it.part); if (part) n.set(part.lib.id, (n.get(part.lib.id) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "peco-setrack-oo";
}

// ---------- parts list ----------

export interface PartsRow { key: string; producer: string; library: string; id: string; name: string; count: number; length?: number; layer?: string }

export function partsList(p: Project, opts: { visibleOnly?: boolean; byLayer?: boolean } = {}): PartsRow[] {
  const rows = new Map<string, PartsRow>();
  for (const it of p.items) {
    if (opts.visibleOnly && !isVisible(p, it)) continue;
    const part = partOf(it);
    const layerName = opts.byLayer ? p.layers.find((l) => l.id === it.layer)?.name ?? "" : undefined;
    const key = `${opts.byLayer ? it.layer + "|" : ""}${it.part}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, producer: part.lib.producer, library: part.lib.name, id: part.def.id, name: part.def.name, count: 0, layer: layerName };
      if (part.def.type === "flex") row.length = 0;
      rows.set(key, row);
    }
    if (part.def.type === "flex") {
      row.length! += geom(it).length;
      row.count = Math.ceil(row.length! / part.def.maxLength!);
    } else row.count++;
  }
  const mods = new Map<string, number>();
  for (const b of p.boards) { const m = b.module && getModule(b.module.preset); if (m) mods.set(m.id, (mods.get(m.id) ?? 0) + 1); }
  const joints = moduleJoints(p);
  for (const [id, count] of mods) {
    const m = getModule(id)!;
    rows.set(`board|${id}`, { key: `board|${id}`, producer: "Laser-cut", library: "~ Baseboards", id: m.size, name: `${m.name} (${m.material}, ${m.weightKg} kg)`, count });
    // extra hardware some modules need (slides, bearings, uprights); joint hardware is counted below
    if (!/^per joint/i.test(m.hardware))
      rows.set(`hwm|${id}`, { key: `hwm|${id}`, producer: "Hardware", library: "~ Baseboards", id: "module", name: `For each ${m.name.toLowerCase()}: ${m.hardware.replace(/;?\s*joining hardware( as standard modules)?\.?$/i, "")}`, count });
  }
  const hwJoint = [...mods.keys()].map((id) => getModule(id)!)[0]?.hardwarePerJoint ?? [];
  if (joints) for (const hw of hwJoint)
    rows.set(`hw|${hw.item}`, { key: `hw|${hw.item}`, producer: "Hardware", library: "~ Baseboards", id: "joint", name: `${hw.item}, ${hw.count} per joint`, count: hw.count * joints });
  return [...rows.values()].sort((a, b) =>
    (a.layer ?? "").localeCompare(b.layer ?? "") || a.library.localeCompare(b.library) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function partsCsv(rows: PartsRow[]): string {
  const esc = (s: string | number) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const head = ["Layer", "Producer", "Part", "Name", "Quantity", "Flex length (mm)"];
  return [head, ...rows.map((r) => [r.layer ?? "", r.producer, r.id, r.name, r.count, r.length ? Math.round(r.length) : ""])]
    .map((r) => r.map(esc).join(",")).join("\n");
}

// ---------- flex helpers ----------

export function flexMinRadius(it: Item): number { return partOf(it).def.minRadius ?? 0; }
export function flexLength(segs: Seg[]): number { return segs.reduce((a, s) => a + segLength(s), 0); }
export { routeLength };
