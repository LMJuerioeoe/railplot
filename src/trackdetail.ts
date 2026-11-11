// The parts of a piece of track that both the plan and the 3D view draw: sleepers (long timbers under points),
// the crossing nose of a point, its check rails and tiebar.
import { Pose, Prim, primAt } from "./geom";
import { Item, geom } from "./model";

export interface Pose3 extends Pose { z: number }
/** A sleeper: centred on the track at a pose, reaching from `a` to `b` across it (left of travel is positive). */
export interface Tie extends Pose3 { a: number; b: number; w: number }
export interface PointDetail {
  /** Where the two inner rails cross. */
  frog: Pose3;
  /** Distance of the crossing along each route, and which side the second route leaves on (+1 left, -1 right). */
  tA: number; tB: number; side: number;
  /** Tiebar, across the toe. */
  tiebar: Pose3;
}

/** Heights of the two ends of a route. */
export function routeHeights(it: Item, _route: number): [number, number] {
  const g = geom(it);
  if (g.part.rigid) return [it.z[0] ?? 0, it.z[0] ?? 0];
  return [it.z[0] ?? 0, it.z[1] ?? 0];
}

export function poseAt(prims: Prim[], t: number): Pose {
  let acc = 0;
  for (const pr of prims) { if (t <= acc + pr.len + 1e-6) return primAt(pr, Math.max(0, t - acc)); acc += pr.len; }
  const last = prims[prims.length - 1];
  return last ? primAt(last, last.len) : { x: 0, y: 0, h: 0 };
}

/** Points along a route: the ends of straights, and curves split finely enough to look round. */
export function sampleRoute(prims: Prim[], z0: number, z1: number, maxAngle = 3 * Math.PI / 180, maxStep = 1e9): Pose3[] {
  const total = prims.reduce((a, p) => a + p.len, 0) || 1;
  const out: Pose3[] = [];
  let acc = 0;
  prims.forEach((pr, k) => {
    let n = pr.kind === "arc" ? Math.max(1, Math.ceil(Math.abs(pr.sweep) / maxAngle)) : 1;
    n = Math.max(n, Math.ceil(pr.len / maxStep));
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      const t = (pr.len * i) / n;
      out.push({ ...primAt(pr, t), z: z0 + (z1 - z0) * ((acc + t) / total) });
    }
    acc += pr.len;
  });
  return out;
}

const cache = new Map<string, { sig: string; ties: Tie[]; point: PointDetail | null }>();
const sigOf = (it: Item) => `${it.part}|${it.x}|${it.y}|${it.rot}|${it.mirror}|${it.z.join(",")}|${it.segs ? JSON.stringify(it.segs) : ""}`;

function build(it: Item) {
  const g = geom(it);
  const prof = g.part.lib.profile;
  const L = prof.sleeperLength, sp = prof.sleeperSpacing, w = prof.sleeperWidth;
  const reach = L * 1.25;
  const ties: Tie[] = [];
  const dense = g.routes.map((r) => {
    const n = Math.max(1, Math.ceil(r.length / 3));
    const pts: Pose[] = [];
    for (let i = 0; i <= n; i++) pts.push(poseAt(r.prims, (r.length * i) / n));
    return pts;
  });
  g.routes.forEach((r, ri) => {
    if (r.length < 0.5) return;
    const [z0, z1] = routeHeights(it, ri);
    const n = Math.max(1, Math.round(r.length / sp));
    const pitch = r.length / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * pitch;
      const p = poseAt(r.prims, t);
      // a sleeper already laid under an earlier route covers this one
      let covered = false;
      for (let j = 0; j < ri && !covered; j++) for (const q of dense[j]) if (Math.hypot(q.x - p.x, q.y - p.y) < reach) { covered = true; break; }
      if (covered) continue;
      const tx = Math.cos(p.h), ty = Math.sin(p.h), nx = -ty, ny = tx;
      let a = -L / 2, b = L / 2;
      for (let j = ri + 1; j < g.routes.length; j++) for (const q of dense[j]) {
        const dx = q.x - p.x, dy = q.y - p.y;
        const along = dx * tx + dy * ty, lat = dx * nx + dy * ny;
        if (Math.abs(along) <= pitch / 2 + 0.01 && Math.abs(lat) < reach) { a = Math.min(a, lat - L / 2); b = Math.max(b, lat + L / 2); }
      }
      ties.push({ ...p, z: z0 + (z1 - z0) * (t / r.length), a, b, w });
    }
  });

  let point: PointDetail | null = null;
  if (g.part.def.type === "turnout" && g.routes.length >= 2) {
    const A = g.routes[0], B = g.routes[1];
    const a0 = poseAt(A.prims, 0), b0 = poseAt(B.prims, 0);
    if (Math.hypot(a0.x - b0.x, a0.y - b0.y) < 1) {
      const half = g.part.lib.gauge / 2;
      const eA = poseAt(A.prims, A.length), eB = poseAt(B.prims, B.length);
      const side = Math.sign(-(eB.x - eA.x) * Math.sin(eA.h) + (eB.y - eA.y) * Math.cos(eA.h)) || 1;
      let best = Infinity, tA = 0, tB = 0;
      const nA = Math.ceil(A.length / 1.5), nB = Math.ceil(B.length / 1.5);
      const ra: { x: number; y: number; t: number }[] = [];
      for (let i = 0; i <= nA; i++) { const t = (A.length * i) / nA, p = poseAt(A.prims, t); ra.push({ x: p.x - Math.sin(p.h) * half * side, y: p.y + Math.cos(p.h) * half * side, t }); }
      for (let j = Math.floor(nB * 0.3); j <= nB; j++) {
        const t = (B.length * j) / nB, p = poseAt(B.prims, t);
        const qx = p.x + Math.sin(p.h) * half * side, qy = p.y - Math.cos(p.h) * half * side;
        for (const q of ra) { const d = Math.hypot(q.x - qx, q.y - qy); if (d < best) { best = d; tA = q.t; tB = t; } }
      }
      if (best < 2.5) {
        const [z0] = routeHeights(it, 0);
        const fa = poseAt(A.prims, tA);
        const tb = poseAt(A.prims, Math.min(A.length, 7));
        point = {
          frog: { x: fa.x - Math.sin(fa.h) * half * side, y: fa.y + Math.cos(fa.h) * half * side, h: fa.h, z: z0 },
          tA, tB, side, tiebar: { ...tb, z: z0 },
        };
      }
    }
  }
  return { ties, point };
}

function detail(it: Item) {
  const sig = sigOf(it);
  const hit = cache.get(it.id);
  if (hit && hit.sig === sig) return hit;
  const d = { sig, ...build(it) };
  cache.set(it.id, d);
  if (cache.size > 6000) cache.clear();
  return d;
}

/** Every sleeper of a piece of track. */
export const tiesOf = (it: Item): Tie[] => detail(it).ties;
/** The crossing and tiebar of an ordinary point (null for other track). */
export const pointOf = (it: Item): PointDetail | null => detail(it).point;
