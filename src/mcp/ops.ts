// Plan operations the Claude connector can propose. Each works on a copy of the plan; the connector then
// turns the difference into a proposal. Steps can follow on from each other ("last": where the previous
// step's track ended).
import { DEG, Pose, Seg, biarc, dist, minRadius, normAngle } from "../geom";
import { LIBRARIES, getLibrary, getPart } from "../library";
import {
  Board, BoardPort, Item, Project, allModuleEnds, analyze, mainLibrary, appendModule, boardGuides, continuationEnd, createFlex, deleteItems, geom, layGuides,
  moveItems, partOf, placePart, projectBounds, rotateItems, selectionBounds, trackPorts, uid,
} from "../model";
import { DEFAULT_SPACING, MAX_TRACKS, endsTouch, getModule } from "../modules";
import { YardKind, buildYard, minYardLength, wagonLength } from "../yards";
import { EXAMPLES, buildExample } from "../examples";

export class OpError extends Error {}

export type AnchorSpec =
  | { end: string }                                         // "t12:1", an open end of a piece
  | { port: { board: string; index?: number; face?: number } }  // a track position on a module's face
  | { start: string }                                        // a start point
  | { x: number; y: number; heading?: number; z?: number }  // anywhere, heading in degrees (0 = +x, 90 = +y)
  | { last: true }                                           // where the previous step's track ended
  | { near: { x: number; y: number } };                     // the open end or free track position nearest a point

export interface OpContext {
  p: Project;
  /** Where the previous step's track ended, facing on. */
  last?: Pose & { z?: number };
  notes: string[];
  /** Ids of the objects the steps created. */
  created: string[];
}

const toDeg = (h: number) => Math.round(((normAngle(h) / DEG) + 360) % 360 * 10) / 10;

export function libraryOf(p: Project, id?: string): string {
  if (!id) return mainLibrary(p);
  const lib = getLibrary(id) ?? LIBRARIES.find((l) => l.name.toLowerCase().includes(id.toLowerCase()));
  if (!lib) throw new OpError(`No track system "${id}". Use one of: ${LIBRARIES.map((l) => l.id).join(", ")}.`);
  return lib.id;
}

/** The flexible track to use with a track system: its own, or one of the same scale. */
export function flexFor(libId: string): string {
  const lib = getLibrary(libId);
  const own = lib?.parts.find((d) => d.type === "flex");
  if (own) return `${libId}/${own.id}`;
  for (const l of LIBRARIES) if (l.scale === lib?.scale) { const f = l.parts.find((d) => d.type === "flex"); if (f) return `${l.id}/${f.id}`; }
  return "peco-setrack-oo/SL-100";
}

export function partKey(p: Project, ref: string, libId?: string): string {
  if (getPart(ref)) return ref;
  const lib = libraryOf(p, libId);
  if (getPart(`${lib}/${ref}`)) return `${lib}/${ref}`;
  const any = LIBRARIES.map((l) => `${l.id}/${ref}`).filter((k) => getPart(k));
  if (any.length === 1) return any[0];
  throw new OpError(`No part "${ref}" in ${lib}. list_parts shows the part numbers.`);
}

function board(p: Project, ref: string): Board {
  const b = p.boards.find((x) => x.id === ref) ?? p.boards.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!b) throw new OpError(`No baseboard "${ref}". list_boards shows them.`);
  return b;
}

export function resolveAnchor(ctx: OpContext, a: AnchorSpec | undefined): Pose & { z: number } {
  const p = ctx.p;
  if (!a) throw new OpError("Say where to start: an open end, a module track position, a start point or a position.");
  if ("last" in a && a.last) {
    if (!ctx.last) throw new OpError("\"last\" only works after a step that laid track.");
    return { ...ctx.last, z: ctx.last.z ?? 0 };
  }
  if ("end" in a) {
    const [id, k] = String(a.end).split(":");
    const it = p.items.find((i) => i.id === id);
    if (!it) throw new OpError(`No track piece ${id}.`);
    const an = analyze(p);
    const free = an.free.filter((e) => e.item === id);
    const e = k === undefined ? free[0] : free.find((x) => x.end === +k);
    if (!e) throw new OpError(k === undefined ? `${id} has no open end.` : `End ${a.end} isn't open (something is joined to it).`);
    return { x: e.x, y: e.y, h: e.h, z: e.z };
  }
  if ("port" in a) {
    const b = board(p, a.port.board);
    const an = analyze(p);
    const all = trackPorts(p).filter((q) => q.board === b.id && (a.port.face === undefined || q.face === a.port.face) && (a.port.index === undefined || q.index === a.port.index));
    if (!all.length) throw new OpError(`${b.name} has no such track position. Set tracks across it first (propose_module_tracks), or see list_boards.`);
    // unused positions first, and when no face is given, ones on faces with no module joined to them
    const ends = allModuleEnds(p);
    const outer = (q: BoardPort) => { const e = ends.find((x) => x.board === q.board && x.end === q.face); return !!e && !ends.some((o) => o.board !== q.board && endsTouch(e, o)); };
    const score = (q: BoardPort) => (an.ends.some((e) => dist(e, q) < 1) ? 2 : 0) + (a.port.face === undefined && !outer(q) ? 1 : 0);
    const q = [...all].sort((u, v) => score(u) - score(v))[0];
    return { x: q.x, y: q.y, h: q.h, z: 0 };
  }
  if ("start" in a) {
    const s = p.starts.find((x) => x.id === a.start);
    if (!s) throw new OpError(`No start point ${a.start}.`);
    return { x: s.x, y: s.y, h: s.h, z: 0 };
  }
  if ("near" in a) {
    const an = analyze(p);
    const cands: (Pose & { z: number })[] = an.free.map((e) => ({ x: e.x, y: e.y, h: e.h, z: e.z }));
    for (const q of trackPorts(p)) if (!an.ends.some((e) => dist(e, q) < 1)) cands.push({ x: q.x, y: q.y, h: q.h, z: 0 });
    if (!cands.length) throw new OpError("There are no open ends or free track positions.");
    return cands.sort((u, v) => dist(u, a.near) - dist(v, a.near))[0];
  }
  if ("x" in a && typeof a.x === "number" && typeof a.y === "number") return { x: a.x, y: a.y, h: (a.heading ?? 0) * DEG, z: a.z ?? 0 };
  throw new OpError("I don't understand that place to start.");
}

function created(ctx: OpContext, objs: { id: string }[]) { for (const o of objs) ctx.created.push(o.id); }

// ---------- the operations ----------

export interface AddModulesArgs { modules: string[]; after?: string; face?: number; tracks?: number; spacing?: number; edge?: number; library?: string }
export function addModules(ctx: OpContext, a: AddModulesArgs) {
  const p = ctx.p;
  if (!a.modules?.length) throw new OpError("List the modules to add.");
  let after = a.after ? board(p, a.after).id : undefined;
  const spacing = a.spacing ?? getLibrary(libraryOf(p, a.library))?.trackSpacing ?? DEFAULT_SPACING;
  const added: Board[] = [];
  a.modules.forEach((id, i) => {
    const m = getModule(id);
    if (!m) throw new OpError(`No baseboard module "${id}". list_baseboard_modules shows the range.`);
    const b = appendModule(p, m.id, after, i === 0 ? a.face : undefined);
    if (a.tracks !== undefined) b.module!.tracks = Math.max(0, Math.min(MAX_TRACKS, Math.round(a.tracks)));
    else b.module!.tracks ??= 1;
    b.module!.spacing ??= spacing;
    if (a.spacing !== undefined) b.module!.spacing = a.spacing;
    if (a.edge !== undefined) b.module!.edge = a.edge;
    after = b.id;
    added.push(b);
  });
  created(ctx, added);
  ctx.notes.push(`Added ${added.map((b) => `${b.name} (${b.id}, ${b.module!.preset})`).join(", ")}.`);
}

export interface ModuleTracksArgs { boards: string[] | "all"; tracks?: number; spacing?: number; edge?: number }
export function moduleTracks(ctx: OpContext, a: ModuleTracksArgs) {
  const p = ctx.p;
  const bs = a.boards === "all" ? p.boards.filter((b) => b.module) : a.boards.map((r) => board(p, r));
  for (const b of bs) {
    if (!b.module) throw new OpError(`${b.name} isn't a baseboard module.`);
    if (a.tracks !== undefined) b.module.tracks = Math.max(0, Math.min(MAX_TRACKS, Math.round(a.tracks)));
    if (a.spacing !== undefined) b.module.spacing = a.spacing;
    if (a.edge !== undefined) b.module.edge = a.edge;
  }
  ctx.notes.push(`Track positions set on ${bs.length} module${bs.length === 1 ? "" : "s"}.`);
}

export interface AddYardArgs { kind: YardKind; at: AnchorSpec; library?: string; roads?: number; side?: "left" | "right"; length?: number; spacing?: number; wagon?: number; headshunt?: number }
export function addYard(ctx: OpContext, a: AddYardArgs) {
  const p = ctx.p;
  const lib = libraryOf(p, a.library);
  const start = resolveAnchor(ctx, a.at);
  const kinds: YardKind[] = ["fiddle", "fiddle2", "runround", "inglenook"];
  if (!kinds.includes(a.kind)) throw new OpError(`The kind of yard is one of ${kinds.join(", ")}.`);
  const roads = a.kind === "runround" ? 2 : Math.max(2, Math.min(8, Math.round(a.roads ?? 3)));
  const min = a.kind === "inglenook" ? 0 : minYardLength({ kind: a.kind, roads, spacing: a.spacing }, lib);
  const length = a.length ?? (a.kind === "inglenook" ? 0 : Math.max(min, a.kind === "fiddle" ? 1200 : 1500));
  if (a.kind !== "inglenook" && length < min) throw new OpError(`That yard needs at least ${min} mm with ${lib} points.`);
  const before = new Set(p.items.map((i) => i.id));
  const r = buildYard(p, lib, {
    kind: a.kind, roads, side: a.side === "right" ? -1 : 1, length, spacing: a.spacing,
    wagon: a.wagon ?? wagonLength(lib), headshunt: a.headshunt ?? (a.kind === "runround" ? 150 : 0),
  }, start);
  const items = p.items.filter((i) => !before.has(i.id));
  created(ctx, items);
  ctx.last = farEnd(p, items, start);
  ctx.notes.push(`${items.length} pieces for the ${a.kind} yard.`, ...r.notes);
}

/** The open end of `items` furthest along from `start`. */
function farEnd(p: Project, items: Item[], start: Pose): (Pose & { z: number }) | undefined {
  const mine = new Set(items.map((i) => i.id));
  const along = (q: { x: number; y: number }) => (q.x - start.x) * Math.cos(start.h) + (q.y - start.y) * Math.sin(start.h);
  const e = analyze(p).free.filter((x) => mine.has(x.item)).sort((u, v) => along(v) - along(u))[0];
  return e ? { x: e.x, y: e.y, h: e.h, z: e.z } : undefined;
}

export interface PieceSpec { part: string; turn?: "left" | "right"; enter?: number; exit?: number }
export interface AddTrackArgs { at: AnchorSpec; pieces: (PieceSpec | string)[]; library?: string }
export function addTrack(ctx: OpContext, a: AddTrackArgs) {
  const p = ctx.p;
  let at = resolveAnchor(ctx, a.at);
  if (!a.pieces?.length) throw new OpError("List the pieces to lay.");
  const laid: Item[] = [];
  for (const raw of a.pieces) {
    const s: PieceSpec = typeof raw === "string" ? { part: raw } : raw;
    const key = partKey(p, s.part, a.library);
    const part = getPart(key)!;
    if (part.def.type === "flex") throw new OpError("Lay flexible track with propose_add_flex.");
    const k = Math.max(0, Math.min(part.ends.length - 1, s.enter ?? 0));
    let it = placePart(p, key, at, k, false);
    if (s.turn) {
      // which way does it turn as laid? mirror it if that's the other way
      const out = s.exit ?? continuationEnd(part, k);
      const dh = normAngle(geom(it).ends[out].h - at.h);
      if ((s.turn === "left" && dh < -1e-6) || (s.turn === "right" && dh > 1e-6)) {
        p.items = p.items.filter((i) => i !== it);
        it = placePart(p, key, at, k, true);
      }
    }
    laid.push(it);
    const out = s.exit ?? continuationEnd(part, k);
    const e = geom(it).ends[out];
    if (!e) throw new OpError(`${part.def.id} has no end ${out}.`);
    at = { x: e.x, y: e.y, h: e.h, z: e.z };
  }
  created(ctx, laid);
  ctx.last = at;
  ctx.notes.push(`${laid.length} piece${laid.length === 1 ? "" : "s"} laid (${laid.map((i) => i.id).join(", ")}); the track ends at (${Math.round(at.x)}, ${Math.round(at.y)}) facing ${toDeg(at.h)}°.`);
}

export type SectionSpec = { straight: number } | { radius: number; angle: number };
export interface AddFlexArgs { at: AnchorSpec; sections: SectionSpec[]; part?: string; library?: string }
export function addFlex(ctx: OpContext, a: AddFlexArgs) {
  const p = ctx.p;
  const at = resolveAnchor(ctx, a.at);
  const key = a.part ? partKey(p, a.part, a.library) : flexFor(libraryOf(p, a.library));
  if (getPart(key)?.def.type !== "flex") throw new OpError(`${key} isn't flexible track.`);
  const segs: Seg[] = (a.sections ?? []).map((s) => {
    if ("straight" in s) { if (!(s.straight > 0)) throw new OpError("Straight sections need a length in mm."); return { kind: "s", len: s.straight }; }
    if (!(s.radius > 0) || !s.angle) throw new OpError("Curved sections need a radius (mm) and an angle (degrees, + left, − right).");
    return { kind: "a", r: s.radius, deg: s.angle };
  });
  if (!segs.length) throw new OpError("Give at least one section.");
  layFlex(ctx, key, at, segs);
}

function layFlex(ctx: OpContext, key: string, at: Pose & { z: number }, segs: Seg[]) {
  const it = createFlex(ctx.p, key, at, segs);
  created(ctx, [it]);
  const g = geom(it);
  const e = g.ends[1];
  ctx.last = { x: e.x, y: e.y, h: e.h, z: e.z };
  const minR = getPart(key)?.def.minRadius ?? 0;
  const r = minRadius(segs);
  ctx.notes.push(`${Math.round(g.length)} mm of ${getPart(key)!.def.id} laid (${it.id}).${isFinite(r) && r < minR - 0.01 ? ` Its tightest curve, R${Math.round(r)}, is tighter than the track allows (R${minR}).` : ""}`);
}

export interface JoinArgs { from: AnchorSpec; to: AnchorSpec; part?: string; library?: string }
export function joinEnds(ctx: OpContext, a: JoinArgs) {
  const p = ctx.p;
  const from = resolveAnchor(ctx, a.from), to = resolveAnchor(ctx, a.to);
  if (dist(from, to) < 1) throw new OpError("Those two places are already together.");
  const segs = biarc(from, to, normAngle(to.h + Math.PI));
  if (!segs) throw new OpError("Those two can't be joined with a smooth curve: they face away from each other.");
  const key = a.part ? partKey(p, a.part, a.library) : flexFor(libraryOf(p, a.library));
  layFlex(ctx, key, from, segs);
}

export interface GuidesArgs { boards: string[] | "all"; library?: string; part?: string }
export function layOnGuides(ctx: OpContext, a: GuidesArgs) {
  const p = ctx.p;
  const key = a.part ? partKey(p, a.part, a.library) : flexFor(libraryOf(p, a.library));
  const bs = a.boards === "all" ? p.boards.filter((b) => b.module) : a.boards.map((r) => board(p, r));
  let laid = 0, tight = 0, already = 0;
  for (const b of bs) {
    if (!boardGuides(p, b.id).length) continue;
    const r = layGuides(p, b.id, key);
    created(ctx, r.laid); laid += r.laid.length; tight += r.tooTight; already += r.already;
  }
  ctx.notes.push(`${laid} length${laid === 1 ? "" : "s"} of flexible track laid on the guides${already ? `, ${already} already had track` : ""}${tight ? `, ${tight} curve${tight === 1 ? " is" : "s are"} too tight for ${getPart(key)!.def.id}` : ""}.`);
}

export interface MoveArgs { ids: string[]; dx?: number; dy?: number; rotate?: number; about?: { x: number; y: number } }
export function move(ctx: OpContext, a: MoveArgs) {
  const p = ctx.p;
  const ids = expandIds(p, a.ids);
  if (a.rotate) {
    const b = selectionBounds(p, ids);
    const about = a.about ?? (b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 });
    rotateItems(p, ids, a.rotate * DEG, about);
  }
  if (a.dx || a.dy) moveItems(p, ids, a.dx ?? 0, a.dy ?? 0);
  ctx.notes.push(`${ids.length} object${ids.length === 1 ? "" : "s"} moved.`);
}

export function remove(ctx: OpContext, a: { ids: string[] }) {
  const ids = expandIds(ctx.p, a.ids);
  deleteItems(ctx.p, ids);
  ctx.notes.push(`${ids.length} object${ids.length === 1 ? "" : "s"} removed.`);
}

function expandIds(p: Project, refs: string[]): string[] {
  if (!refs?.length) throw new OpError("List the ids.");
  return refs.map((r) => {
    if ([...p.items, ...p.starts].some((o) => o.id === r)) return r;
    return board(p, r).id;
  });
}

export interface ExampleArgs { example: string; library?: string; where?: "right" | "below" }
export function addExample(ctx: OpContext, a: ExampleArgs) {
  const p = ctx.p;
  const ex = EXAMPLES.find((e) => e.id === a.example);
  if (!ex) throw new OpError(`No example "${a.example}". Choose one of ${EXAMPLES.map((e) => e.id).join(", ")}.`);
  const lib = libraryOf(p, a.library);
  const q = buildExample(ex.id, lib);
  const b = projectBounds(p), eb = projectBounds(q);
  let dx = 0, dy = 0;
  if (b && eb) {
    if (a.where === "below") { dx = b.minX - eb.minX; dy = b.minY - 300 - eb.maxY; }
    else { dx = b.maxX + 300 - eb.minX; dy = b.minY - eb.minY; }
  }
  const layer = p.activeLayer;
  for (const bd of q.boards) {
    const id = uid(p, "b");
    const n = p.boards.filter((x) => x.module).length + 1;
    const copy: Board = JSON.parse(JSON.stringify(bd));
    copy.id = id;
    if (copy.module) copy.name = `Module ${n}`;
    p.boards.push(copy);
    moveItems(p, [id], dx, dy);
    ctx.created.push(id);
  }
  const before = new Set(p.items.map((i) => i.id));
  for (const it of q.items) {
    const copy: Item = JSON.parse(JSON.stringify(it));
    copy.id = uid(p, "t"); copy.layer = layer;
    p.items.push(copy);
  }
  const mine = p.items.filter((i) => !before.has(i.id));
  moveItems(p, mine.map((i) => i.id), dx, dy);
  created(ctx, mine);
  ctx.notes.push(`${ex.name}: ${q.boards.length} board${q.boards.length === 1 ? "" : "s"} and ${q.items.length} pieces of track, built for ${lib}.`);
}

export interface EditArgs { add?: { items?: Item[]; boards?: Board[] }; change?: { items?: Item[]; boards?: Board[] }; remove?: string[]; rename?: string }
/** Direct edits, for anything the other operations don't cover. Pieces are checked against the track libraries. */
export function editObjects(ctx: OpContext, a: EditArgs) {
  const p = ctx.p;
  const check = (it: Item) => {
    if (!getPart(it.part)) throw new OpError(`Unknown part ${it.part}.`);
    for (const k of ["x", "y", "rot"] as const) if (typeof it[k] !== "number" || !isFinite(it[k])) throw new OpError(`Piece ${it.id ?? ""} needs a number for ${k}.`);
    it.mirror = !!it.mirror;
    const part = getPart(it.part)!;
    if (!Array.isArray(it.z)) it.z = (part.def.type === "flex" ? [0, 0] : part.ends.map(() => 0));
    if (part.def.type === "flex" && !Array.isArray(it.segs)) throw new OpError(`Flexible track ${it.id ?? ""} needs segs.`);
    if (!p.layers.some((l) => l.id === it.layer)) it.layer = p.activeLayer;
  };
  const checkBoard = (b: Board) => {
    if (!Array.isArray(b.pts) || b.pts.length < 3) throw new OpError("A baseboard needs at least three corner points (pts).");
    if (b.module && !getModule(b.module.preset)) throw new OpError(`No baseboard module "${b.module.preset}".`);
    b.name ||= `Board ${p.boards.length + 1}`;
  };
  if (a.remove?.length) deleteItems(p, expandIds(p, a.remove));
  for (const it of a.change?.items ?? []) {
    const i = p.items.findIndex((x) => x.id === it.id);
    if (i < 0) throw new OpError(`No piece ${it.id} to change.`);
    const merged = { ...p.items[i], ...it };
    check(merged); p.items[i] = merged;
  }
  for (const b of a.change?.boards ?? []) {
    const i = p.boards.findIndex((x) => x.id === b.id);
    if (i < 0) throw new OpError(`No baseboard ${b.id} to change.`);
    const merged = { ...p.boards[i], ...b };
    checkBoard(merged); p.boards[i] = merged;
  }
  for (const it0 of a.add?.items ?? []) {
    const it = { ...it0, id: uid(p, "t") } as Item;
    check(it); p.items.push(it); ctx.created.push(it.id);
  }
  for (const b0 of a.add?.boards ?? []) {
    const b = { ...b0, id: uid(p, "b") } as Board;
    checkBoard(b); p.boards.push(b); ctx.created.push(b.id);
  }
  if (a.rename?.trim()) p.name = a.rename.trim();
  ctx.notes.push("Edits made.");
}

export const OPS = {
  add_modules: addModules,
  module_tracks: moduleTracks,
  add_yard: addYard,
  add_track: addTrack,
  add_flex: addFlex,
  join_ends: joinEnds,
  lay_guides: layOnGuides,
  move,
  remove,
  add_example: addExample,
  edit: editObjects,
} as const;
export type OpName = keyof typeof OPS;

/** Run steps one after another on the plan. */
export function runSteps(p: Project, steps: { op: string; [k: string]: unknown }[]): OpContext {
  const ctx: OpContext = { p, notes: [], created: [] };
  steps.forEach((s, i) => {
    const fn = (OPS as Record<string, (c: OpContext, a: any) => void>)[s.op];
    if (!fn) throw new OpError(`Step ${i + 1}: unknown operation "${s.op}". Use one of ${Object.keys(OPS).join(", ")}.`);
    try { fn(ctx, s); }
    catch (e) { throw new OpError(`Step ${i + 1} (${s.op}): ${(e as Error).message}`); }
  });
  return ctx;
}

export { toDeg, partOf, mainLibrary };
