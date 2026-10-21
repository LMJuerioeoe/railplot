// Ready-made yards: fiddle yards (one or both ends), a run-round loop and the Inglenook sidings shunting puzzle,
// built from the track system's own points and curves, with flexible track for the long roads.
import { Pose, dir, dist, dot, normAngle, sub } from "./geom";
import { getLibrary, getPart } from "./library";
import { Item, Project, createFlex, geom, placePart } from "./model";

/** The parts a yard is built from, chosen from a track library. */
export interface YardParts {
  left: string; right: string;     // ordinary points (straight road and one diverging road)
  curve?: string;                  // a curve matching the points' diverging road, to turn the last road parallel
  flex: string;                    // for the roads themselves
  pointLength: number;             // along the straight road
  angle: number;                   // diverging angle, radians
  radius: number;                  // of the diverging road
  /** Natural distance between roads when points are laid toe to toe along the ladder. */
  naturalSpacing: [number, number];  // between road 0 and 1, and between later roads
}

export function yardParts(libId: string): YardParts | null {
  const lib = getLibrary(libId);
  if (!lib) return null;
  const simple = (hand: string) => lib.parts.find((d) => d.type === "turnout" && d.hand === hand && d.routes?.length === 2
    && d.routes[0].segs.length === 1 && "straight" in d.routes[0].segs[0] && d.routes[1].segs.length === 1 && "radius" in d.routes[1].segs[0]
    && !d.routes[0].from && !d.routes[1].from);
  const l = simple("left"), r = simple("right");
  if (!l || !r) return null;
  const st = l.routes![0].segs[0] as { straight: number };
  const dv = l.routes![1].segs[0] as { radius: number; angle: number };
  const angle = Math.abs(dv.angle) * Math.PI / 180, R = dv.radius, L = st.straight;
  const curve = lib.parts.find((d) => d.type === "curve" && Math.abs((d.radius ?? 0) - R) < 0.01 && Math.abs(Math.abs(d.angle ?? 0) - Math.abs(dv.angle)) < 0.01);
  const flexDef = lib.parts.find((d) => d.type === "flex");
  return {
    left: `${lib.id}/${l.id}`, right: `${lib.id}/${r.id}`, curve: curve ? `${lib.id}/${curve.id}` : undefined,
    flex: flexDef ? `${lib.id}/${flexDef.id}` : "peco-setrack-oo/SL-100",
    pointLength: L, angle, radius: R,
    naturalSpacing: [2 * R * (1 - Math.cos(angle)), L * Math.sin(angle)],
  };
}

/** A typical four-wheel wagon over buffers: OO about 80 mm, H0 about 75 mm. */
export const wagonLength = (libId: string) => (getLibrary(libId)?.scale === "H0" ? 75 : 80);

const endPose = (it: Item, i: number): Pose => { const e = geom(it).ends[i]; return { x: e.x, y: e.y, h: e.h }; };
const ahead = (p: Pose, d: number): Pose => ({ x: p.x + Math.cos(p.h) * d, y: p.y + Math.sin(p.h) * d, h: p.h });

interface Ladder { items: Item[]; roads: Pose[] }

/**
 * A ladder of points: the first point's straight road is road 0; its diverging road becomes the ladder, and
 * each point along the ladder turns one road back parallel. A curve (or flexible track) turns the last road.
 * `side` +1 puts the roads on the left of the direction of travel, −1 on the right.
 * `spacing`, if given, inserts short lengths of flexible track between the points to space the roads exactly.
 */
function ladder(p: Project, k: YardParts, start: Pose, n: number, side: 1 | -1, spacing?: number): Ladder {
  const items: Item[] = [];
  const roads: Pose[] = [];
  if (n <= 1) { roads.push(start); return { items, roads }; }
  const first = side > 0 ? k.left : k.right, rest = side > 0 ? k.right : k.left;
  const sin = Math.sin(k.angle);
  const gap = (natural: number) => {
    if (spacing === undefined) return 0;
    const d = (spacing - natural) / sin;
    return d >= 5 ? d : 0;   // a few millimetres short isn't worth a sliver of flexible track
  };
  const p1 = placePart(p, first, start); items.push(p1);
  roads.push(endPose(p1, 1));
  let lad = endPose(p1, 2);
  for (let r = 1; r < n; r++) {
    const d = gap(r === 1 ? k.naturalSpacing[0] : k.naturalSpacing[1]);
    if (d > 0) { const f = createFlex(p, k.flex, { ...lad, z: 0 }, [{ kind: "s", len: d }]); items.push(f); lad = ahead(lad, d); }
    if (r < n - 1) {
      const pt = placePart(p, rest, lad); items.push(pt);
      roads.push(endPose(pt, 2));
      lad = endPose(pt, 1);
    } else if (k.curve) {
      const c = placePart(p, k.curve, lad, 0, side > 0); items.push(c);
      roads.push(endPose(c, 1));
    } else {
      // no matching curve in the library: an arc of flexible track of the same radius
      const f = createFlex(p, k.flex, { ...lad, z: 0 }, [{ kind: "a", r: k.radius, deg: -side * k.angle * 180 / Math.PI }]);
      items.push(f); roads.push(endPose(f, 1));
    }
  }
  return { items, roads };
}

/** How far a pose is along a line from `start` in its heading. */
const along = (start: Pose, q: { x: number; y: number }) => dot(sub(q, start), dir(start.h));

function road(p: Project, k: YardParts, from: Pose, len: number, items: Item[]) {
  if (len < 1) return;
  items.push(createFlex(p, k.flex, { ...from, z: 0 }, [{ kind: "s", len }]));
}

export type YardKind = "fiddle" | "fiddle2" | "runround" | "inglenook";

export interface YardOptions {
  kind: YardKind;
  roads: number;            // fiddle yards: 2-8
  side: 1 | -1;
  length: number;           // fiddle yards and the run-round loop: overall length, mm
  spacing?: number;         // exact distance between roads; natural if unset
  wagon: number;            // Inglenook: wagon length, mm
  headshunt: number;        // run-round loop: headshunt length at each end, mm
}

export interface YardResult { items: Item[]; notes: string[] }

/** Build a yard starting at `start` (the toe end, or the end of the headshunt), heading along start.h. */
export function buildYard(p: Project, libId: string, o: YardOptions, start: Pose): YardResult {
  const k = yardParts(libId);
  if (!k) throw new Error("This track system has no ordinary left and right points to build a yard from.");
  const items: Item[] = [];
  const notes: string[] = [];
  switch (o.kind) {
    case "fiddle": {
      const n = clampInt(o.roads, 2, 8);
      const L = ladder(p, k, start, n, o.side, o.spacing);
      items.push(...L.items);
      for (const r of L.roads) {
        const len = o.length - along(start, r);
        if (len < 100) notes.push("Some roads are very short: make the yard longer.");
        road(p, k, r, len, items);
      }
      break;
    }
    case "fiddle2":
    case "runround": {
      const n = o.kind === "runround" ? 2 : clampInt(o.roads, 2, 8);
      let s0 = start;
      const hs = o.kind === "runround" ? Math.max(0, o.headshunt) : 0;
      if (hs > 0) { road(p, k, s0, hs, items); s0 = ahead(s0, hs); }
      const A = ladder(p, k, s0, n, o.side, o.spacing);
      const farToe = ahead(s0, o.length);
      const B = ladder(p, k, { ...farToe, h: normAngle(s0.h + Math.PI) }, n, (-o.side) as 1 | -1, o.spacing);
      items.push(...A.items, ...B.items);
      A.roads.forEach((a, i) => {
        const b = B.roads[i];
        const len = dist(a, b);
        if (along(s0, b) - along(s0, a) < 100) { notes.push("The yard is too short for this many roads: make it longer."); return; }
        road(p, k, a, len, items);
      });
      if (hs > 0) road(p, k, { ...farToe, h: s0.h }, hs, items);
      break;
    }
    case "inglenook": {
      // the classic: a headshunt for the engine and three wagons, then sidings for five, three and three
      const w = Math.max(40, o.wagon);
      const head = o.headshunt > 0 ? Math.round(o.headshunt) : Math.round(3 * w + 1.6 * w + 40);
      road(p, k, start, head, items);
      const L = ladder(p, k, ahead(start, head), 3, o.side, o.spacing);
      items.push(...L.items);
      [5, 3, 3].forEach((wagons, i) => road(p, k, L.roads[i], Math.round(wagons * w + 40), items));
      notes.push(`Headshunt ${head} mm (an engine and three wagons is ${Math.round(4.6 * w)} mm), sidings for 5, 3 and 3 wagons of ${w} mm.`);
      break;
    }
  }
  return { items, notes: [...new Set(notes)] };
}

/** How far along the yard the last road starts: the length of the throat. */
export function throatLength(libId: string, roads: number, spacing?: number): number {
  const k = yardParts(libId);
  if (!k) return 0;
  const scratch: Project = { format: "railplot", version: 1, name: "", units: "mm", gridStep: 50, layers: [{ id: "L1", name: "", visible: true }], activeLayer: "L1", boards: [], starts: [], items: [], nextId: 1 } as Project;
  const start = { x: 0, y: 0, h: 0 };
  const L = ladder(scratch, k, start, Math.max(2, Math.min(8, roads)), 1, spacing);
  return Math.max(...L.roads.map((r) => r.x));
}

/** The shortest overall length that leaves every road at least 100 mm long. */
export function minYardLength(o: Pick<YardOptions, "kind" | "roads" | "spacing">, libId: string): number {
  const n = o.kind === "runround" ? 2 : o.roads;
  const t = throatLength(libId, n, o.spacing);
  return Math.ceil((o.kind === "fiddle" ? t + 100 : 2 * t + 100) / 10) * 10;
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v || lo)));

/** Distances between neighbouring roads where a ladder of `n` roads comes out, for showing in the dialog. */
export function roadSpacings(k: YardParts, n: number, spacing?: number): number[] {
  const out: number[] = [];
  for (let r = 1; r < n; r++) {
    const nat = r === 1 ? k.naturalSpacing[0] : k.naturalSpacing[1];
    if (spacing === undefined) { out.push(nat); continue; }
    const d = (spacing - nat) / Math.sin(k.angle);
    out.push(d >= 5 ? spacing : nat);
  }
  return out;
}

export function partName(key?: string) { return key ? (getPart(key)?.def.id ?? key) : ""; }
