// Baseboard modules: ready-designed boards from the laser-cut baseboard range (standard boards,
// corners and curves, traversers, turntables, canopies) that join face to face.
// The presets are generated from the range's design data by scripts/import-baseboards.ts.
import { DEG, Pose, Seg, Vec, add, biarc, dist, minRadius, normAngle, rot, sub } from "./geom";
import { BOARD_DATA } from "./boards";

export type MemberKind = "side" | "end" | "cross" | "spine";
export interface MemberLine { a: Vec; b: Vec; thickness: number; kind: MemberKind }
export interface ModuleFace { a: Vec; b: Vec; width: number }      // the outside of the board is on the left of a → b
export interface ModuleFixing { p: Vec; kind: "dowel" | "bolt"; d: number }
export interface ModuleFeature { kind: "deck" | "disc" | "well" | "canopy" | "backscene"; label: string; outline?: Vec[]; line?: Vec[] }

export interface ModulePreset {
  format: 2;
  id: string;
  name: string;
  family: string;           // "Standard modules", "Corners and curves", "Fiddle yard", "Canopy modules"
  size: string;             // as the range describes it, e.g. "1200 × 600 mm" or "R600 – R1000 mm"
  blurb: string;
  length: number;           // bounding box of the outline, mm
  width: number;
  depth: number;            // overall height of the board, mm
  sheet: number;            // plywood thickness
  material: string;
  weightKg: number;
  pieces: number;
  sheets: { count: number; size: [number, number] };
  cutLengthM: number;
  outline: Vec[];           // footprint, local coordinates
  faces: ModuleFace[];
  fixings: ModuleFixing[];
  members: MemberLine[];
  openings: Vec[][];        // in the bottom skin
  features: ModuleFeature[];
  marks: [number, number, number, number][];   // guide lines engraved on the top
  canopyHeight?: number;
  hardware: string;         // what one module needs besides plywood and glue
  hardwarePerJoint: { item: string; count: number }[];
  source: string;
}

export const MODULES: ModulePreset[] = BOARD_DATA as ModulePreset[];
export const MODULE_FAMILIES = [...new Set(MODULES.map((m) => m.family))];

/** Earlier versions had one module under another id. */
const ALIASES: Record<string, string> = { "laser-torsion-1200x600": "std-1200x600" };
export const getModule = (id: string) => MODULES.find((m) => m.id === (ALIASES[id] ?? id));

/**
 * Where a module sits: the centre of its outline's bounding box, its rotation, and whether it is a mirror image.
 * `tracks` is how many tracks cross each joining face (0-4, default 1) and `spacing` their centre-to-centre distance.
 * `edge` spreads the tracks instead: the outermost ones sit this far in from the ends of the face, the rest evenly
 * between them (0 turns spreading off; unset uses the module's default, see defaultEdge).
 */
export interface ModulePlacement { preset: string; cx: number; cy: number; rot: number; mirror?: boolean; tracks?: number; spacing?: number; edge?: number }

/** Track centres for parallel sectional track: Peco Setrack and Hornby 67 mm, PIKO A-Gleis 61.88 mm. */
export const DEFAULT_SPACING = 67;
export const MAX_TRACKS = 4;
/** Closest a track centre line may come to the edge of a face: half a sleeper plus room for the ballast shoulder. */
export const EDGE_MARGIN = 40;

export const overallDepth = (m: ModulePreset) => m.depth;

const centreOf = (m: ModulePreset): Vec => {
  const xs = m.outline.map((p) => p.x), ys = m.outline.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};
const centres = new Map<string, Vec>();
export function moduleCentre(m: ModulePreset): Vec {
  return centres.get(m.id) ?? centres.set(m.id, centreOf(m)).get(m.id)!;
}

/** A local point to world coordinates. */
export function moduleToWorld(m: ModulePreset, pl: ModulePlacement, p: Vec): Vec {
  const q = sub(p, moduleCentre(m));
  return add({ x: pl.cx, y: pl.cy }, rot(pl.mirror ? { x: q.x, y: -q.y } : q, pl.rot));
}

/** The module's footprint in world coordinates. */
export function moduleCorners(m: ModulePreset, pl: ModulePlacement): Vec[] {
  return m.outline.map((p) => moduleToWorld(m, pl, p));
}

export const moduleMembers = (m: ModulePreset): MemberLine[] => m.members;
export const moduleOpenings = (m: ModulePreset): Vec[][] => m.openings;
export const moduleFixings = (m: ModulePreset): ModuleFixing[] => m.fixings;

/** Outward heading of a face in local coordinates. */
const faceHeading = (f: ModuleFace) => Math.atan2(f.b.x - f.a.x, -(f.b.y - f.a.y));
const faceMid = (f: ModuleFace): Vec => ({ x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 });

/** The joining faces: middle of each, heading outwards, and its width. */
export function moduleEnds(m: ModulePreset, pl: ModulePlacement) {
  return m.faces.map((f) => ({ ...moduleToWorld(m, pl, faceMid(f)), h: normAngle((pl.mirror ? -1 : 1) * faceHeading(f) + pl.rot), width: f.width }));
}

/** Faces of a module that can meet a face of the given width. */
export function facesMatching(m: ModulePreset, width?: number): number[] {
  return m.faces.map((f, i) => (width === undefined || Math.abs(f.width - width) < 1 ? i : -1)).filter((i) => i >= 0);
}

/** Placement of a new module whose face `face` meets the given end. */
export function placementAtEnd(m: ModulePreset, end: { x: number; y: number; h: number }, face = 0, mirror = false): ModulePlacement {
  const f = m.faces[face] ?? m.faces[0];
  const r = normAngle(end.h + Math.PI - (mirror ? -1 : 1) * faceHeading(f));
  const q = sub(faceMid(f), moduleCentre(m));
  const c = sub(end, rot(mirror ? { x: q.x, y: -q.y } : q, r));
  return { preset: m.id, cx: c.x, cy: c.y, rot: r, ...(mirror ? { mirror: true } : {}) };
}

/** Two faces meet: same place, facing each other, same width (so the dowels and bolts line up). */
export function endsTouch(a: { x: number; y: number; h: number; width?: number }, b: { x: number; y: number; h: number; width?: number }) {
  return dist(a, b) < 1 && Math.abs(normAngle(a.h - b.h - Math.PI)) < 1 * DEG && (a.width === undefined || b.width === undefined || Math.abs(a.width - b.width) < 1);
}

// ---------- track positions on the joining faces ----------

/** Moving decks (traversers, turntables) have one entry track, on the centre line. */
export const singleTrackOnly = (m: ModulePreset) => m.family === "Fiddle yard";

/** On 600 mm boards the tracks are spread 200 mm in from the edges (two tracks a third of the way across). */
export const SPREAD_600 = 200;
export function defaultEdge(m: ModulePreset): number {
  return !singleTrackOnly(m) && m.faces.length > 0 && m.faces.every((f) => Math.abs(f.width - 600) < 1) ? SPREAD_600 : 0;
}

/** How far in from the ends of a face the outermost tracks sit, or 0 when they are bunched at the spacing. */
export function edgeOf(m: ModulePreset, pl: Pick<ModulePlacement, "edge">): number {
  if (singleTrackOnly(m)) return 0;
  const e = pl.edge ?? defaultEdge(m);
  const w = Math.min(...m.faces.map((f) => f.width));
  return e > 0 ? Math.max(EDGE_MARGIN, Math.min(w / 2, e)) : 0;
}

/**
 * The most tracks that fit across the module's narrowest face: at least `spacing` apart, and no closer to
 * the edge than the margin (or, when spread, inside the edge distance).
 */
export function maxTracks(m: ModulePreset, spacing = DEFAULT_SPACING, edge = 0): number {
  if (singleTrackOnly(m)) return 1;
  const w = Math.min(...m.faces.map((f) => f.width));
  const room = w - 2 * (edge > 0 ? edge : EDGE_MARGIN);
  return Math.max(1, Math.min(MAX_TRACKS, Math.floor(room / spacing + 1e-9) + 1));
}

export const tracksOf = (m: ModulePreset, pl: ModulePlacement) =>
  Math.max(0, Math.min(pl.tracks ?? 1, maxTracks(m, pl.spacing ?? DEFAULT_SPACING, edgeOf(m, pl))));

export interface TrackPort { face: number; index: number; x: number; y: number; h: number; offset: number }

/**
 * Where tracks cross each joining face, centred on the face: n tracks at the given spacing (or spread out to
 * the edge distance), symmetric about
 * the middle, so they line up with the same number of tracks on the next module. `h` points into the module.
 */
export function modulePorts(m: ModulePreset, pl: ModulePlacement): TrackPort[] {
  const n = tracksOf(m, pl), s = pl.spacing ?? DEFAULT_SPACING, e = edgeOf(m, pl);
  const out: TrackPort[] = [];
  m.faces.forEach((f, fi) => {
    const L = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) || 1;
    const u = { x: (f.b.x - f.a.x) / L, y: (f.b.y - f.a.y) / L };
    const mid = { x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 };
    const inward = normAngle((pl.mirror ? -1 : 1) * Math.atan2(f.b.x - f.a.x, -(f.b.y - f.a.y)) + pl.rot + Math.PI);
    for (let i = 0; i < n; i++) {
      const step = e > 0 && n > 1 ? (f.width - 2 * e) / (n - 1) : s;
      const offset = (i - (n - 1) / 2) * step;
      const w = moduleToWorld(m, pl, { x: mid.x + u.x * offset, y: mid.y + u.y * offset });
      out.push({ face: fi, index: i, x: w.x, y: w.y, h: inward, offset });
    }
  });
  return out;
}

export interface TrackGuide { from: Pose; segs: Seg[]; minRadius: number }

/**
 * Suggested track centre lines across a module with two faces: from each port on the first face to the
 * matching port on the second (straight across a straight board, concentric arcs round a curve or corner).
 */
export function moduleGuides(m: ModulePreset, pl: ModulePlacement): TrackGuide[] {
  if (m.faces.length !== 2 || singleTrackOnly(m)) return [];
  const ports = modulePorts(m, pl);
  const a = ports.filter((q) => q.face === 0), b = ports.filter((q) => q.face === 1);
  const out: TrackGuide[] = [];
  // faces run with the outside on their left, so the first port on one face pairs with the last on the other
  a.forEach((p0, i) => {
    const p1 = b[b.length - 1 - i];
    if (!p1) return;
    const segs = biarc({ x: p0.x, y: p0.y, h: p0.h }, p1, normAngle(p1.h + Math.PI));
    if (segs) out.push({ from: { x: p0.x, y: p0.y, h: p0.h }, segs, minRadius: minRadius(segs) });
  });
  return out;
}

