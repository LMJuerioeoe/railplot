// Plane geometry for track: poses, straight and arc segments, world primitives.
// World units are millimetres, y points up, angles are radians, positive = counter-clockwise (left turn).

export interface Vec { x: number; y: number }
export interface Pose { x: number; y: number; h: number }

/** A segment in a part's local route description. */
export type Seg =
  | { kind: "s"; len: number }               // straight
  | { kind: "a"; r: number; deg: number };   // arc, deg > 0 turns left, < 0 turns right

/** A world-space drawing primitive (centre line of track). */
export type Prim =
  | { kind: "line"; a: Vec; b: Vec; len: number; h: number }
  | { kind: "arc"; c: Vec; r: number; a0: number; sweep: number; len: number };

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const dir = (h: number): Vec => ({ x: Math.cos(h), y: Math.sin(h) });
export const rot = (p: Vec, a: number): Vec => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

/** Normalise an angle to (-PI, PI]. */
export function normAngle(a: number): number {
  a = a % TAU;
  if (a <= -Math.PI) a += TAU;
  if (a > Math.PI) a -= TAU;
  return a;
}

export function segLength(s: Seg): number {
  return s.kind === "s" ? s.len : Math.abs(s.deg * DEG) * s.r;
}

/** Walk one segment from a pose, returning the end pose. */
export function walk(p: Pose, s: Seg): Pose {
  if (s.kind === "s") return { x: p.x + Math.cos(p.h) * s.len, y: p.y + Math.sin(p.h) * s.len, h: p.h };
  const th = s.deg * DEG;
  const sign = Math.sign(th) || 1;
  const n = { x: -Math.sin(p.h), y: Math.cos(p.h) };
  const c = { x: p.x + sign * s.r * n.x, y: p.y + sign * s.r * n.y };
  const e = add(c, rot(sub(p, c), th));
  return { x: e.x, y: e.y, h: p.h + th };
}

/** Pose at distance d along a segment starting at pose p. */
export function walkPartial(p: Pose, s: Seg, d: number): Pose {
  if (s.kind === "s") return walk(p, { kind: "s", len: d });
  const total = segLength(s);
  return walk(p, { kind: "a", r: s.r, deg: s.deg * (total === 0 ? 0 : d / total) });
}

/** Turn a local segment (starting at pose p, already in world space) into a world primitive. */
export function primOf(p: Pose, s: Seg): Prim {
  if (s.kind === "s") {
    const b = walk(p, s);
    return { kind: "line", a: { x: p.x, y: p.y }, b: { x: b.x, y: b.y }, len: s.len, h: p.h };
  }
  const th = s.deg * DEG;
  const sign = Math.sign(th) || 1;
  const n = { x: -Math.sin(p.h), y: Math.cos(p.h) };
  const c = { x: p.x + sign * s.r * n.x, y: p.y + sign * s.r * n.y };
  const a0 = Math.atan2(p.y - c.y, p.x - c.x);
  return { kind: "arc", c, r: s.r, a0, sweep: th, len: Math.abs(th) * s.r };
}

/** Point and heading at distance t (0..len) along a primitive. */
export function primAt(pr: Prim, t: number): Pose {
  if (pr.kind === "line") {
    const k = pr.len === 0 ? 0 : t / pr.len;
    return { x: pr.a.x + (pr.b.x - pr.a.x) * k, y: pr.a.y + (pr.b.y - pr.a.y) * k, h: pr.h };
  }
  const k = pr.len === 0 ? 0 : t / pr.len;
  const a = pr.a0 + pr.sweep * k;
  const sign = Math.sign(pr.sweep) || 1;
  return { x: pr.c.x + pr.r * Math.cos(a), y: pr.c.y + pr.r * Math.sin(a), h: a + sign * Math.PI / 2 };
}

/** Sample a primitive into poses no further apart than `step` mm. Includes both ends. */
export function samplePrim(pr: Prim, step: number): Pose[] {
  const n = Math.max(1, Math.ceil(pr.len / step));
  const out: Pose[] = [];
  for (let i = 0; i <= n; i++) out.push(primAt(pr, (pr.len * i) / n));
  return out;
}

/** Shortest distance from point q to a primitive. */
export function distToPrim(pr: Prim, q: Vec): number {
  if (pr.kind === "line") {
    const ab = sub(pr.b, pr.a);
    const l2 = dot(ab, ab);
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(q, pr.a), ab) / l2));
    return dist(q, add(pr.a, mul(ab, t)));
  }
  const ang = Math.atan2(q.y - pr.c.y, q.x - pr.c.x);
  // is ang within the swept range?
  const mod = (a: number) => ((a % TAU) + TAU) % TAU;
  const rel = pr.sweep >= 0 ? mod(ang - pr.a0) : mod(pr.a0 - ang);
  const inRange = rel <= Math.abs(pr.sweep) + 1e-9;
  if (inRange) return Math.abs(dist(q, pr.c) - pr.r);
  const s = primAt(pr, 0), e = primAt(pr, pr.len);
  return Math.min(dist(q, s), dist(q, e));
}

/** Axis-aligned bounds of a list of primitives, padded by `pad`. */
export function primBounds(prims: Prim[], pad = 0) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (p: Vec) => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  };
  for (const pr of prims) for (const p of samplePrim(pr, 20)) take(p);
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * The arc (or straight) that leaves pose p tangentially and passes through point q.
 * Returns a segment in p's local frame. If the needed radius is below minR, the radius is clamped
 * and the arc stops where it crosses the ray from its centre towards q.
 */
export function tangentSegThrough(p: Pose, q: Vec, minR = 0): Seg | null {
  const local = rot(sub(q, p), -p.h);
  const { x, y } = local;
  if (x * x + y * y < 1e-6) return null;
  if (Math.abs(y) < 1e-6 * Math.max(1, Math.abs(x)) || Math.abs(y) < 0.05) {
    return x > 0 ? { kind: "s", len: x } : null;
  }
  let r = (x * x + y * y) / (2 * Math.abs(y));
  const sign = Math.sign(y);
  if (r < minR) r = minR;
  // centre in local frame is (0, sign*r). Angle of q around the centre, measured like the start point (0,0).
  const cy = sign * r;
  const a0 = Math.atan2(0 - cy, 0);
  const aq = Math.atan2(y - cy, x);
  let sweep = aq - a0;
  if (sign > 0) { while (sweep < 0) sweep += TAU; } else { while (sweep > 0) sweep -= TAU; }
  if (Math.abs(sweep) < 1e-6) return null;
  return { kind: "a", r, deg: sweep / DEG };
}

/**
 * Connect pose p0 (travel direction h0) to point p1, arriving with travel direction h1, using a biarc.
 * Returns up to two segments in p0's local frame, or null when no sensible solution exists.
 */
export function biarc(p0: Pose, p1: Vec, h1: number): Seg[] | null {
  const t0 = dir(p0.h), t1 = dir(h1);
  const vv = sub(p1, p0);
  const t = add(t0, t1);
  const vt = dot(vv, t);
  const denom = 2 * (1 - dot(t0, t1));
  let d: number;
  if (Math.abs(denom) < 1e-9) {
    // parallel tangents
    const vt1 = dot(vv, t1);
    if (Math.abs(vt1) < 1e-9) return null;
    // straight line case: points aligned on the tangent
    if (Math.abs(cross(t0, vv)) < 1e-6 && dot(vv, t0) > 0) return [{ kind: "s", len: len(vv) }];
    d = dot(vv, vv) / (4 * vt1);
  } else {
    d = (-vt + Math.sqrt(vt * vt + denom * dot(vv, vv))) / denom;
  }
  if (!(d > 0) || !isFinite(d)) return null;
  const q1 = add(p0, mul(t0, d));
  const q2 = sub(p1, mul(t1, d));
  const pm = mul(add(q1, q2), 0.5);
  const s1 = tangentSegThrough(p0, pm, 0);
  if (!s1) return null;
  const mid = walk({ x: 0, y: 0, h: 0 }, s1); // local end
  const midWorld: Pose = { ...add(p0, rot(mid, p0.h)), h: p0.h + mid.h };
  const s2 = tangentSegThrough(midWorld, p1, 0);
  if (!s2) return [s1];
  const end = walk(midWorld, s2);
  if (Math.abs(normAngle(end.h - h1)) > 0.5 * DEG || dist(end, p1) > 0.05) return null;
  return mergeSegs([s1, s2]);
}

/** Merge consecutive straights and arcs with identical radius and turn direction. */
export function mergeSegs(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (segLength(s) < 1e-6) continue;
    const last = out[out.length - 1];
    if (last && last.kind === "s" && s.kind === "s") { last.len += s.len; continue; }
    if (last && last.kind === "a" && s.kind === "a" && Math.abs(last.r - s.r) < 1e-6 && Math.sign(last.deg) === Math.sign(s.deg)) {
      last.deg += s.deg; continue;
    }
    out.push({ ...s });
  }
  return out;
}

/** Minimum radius used by a list of segments (Infinity when all straight). */
export function minRadius(segs: Seg[]): number {
  let r = Infinity;
  for (const s of segs) if (s.kind === "a") r = Math.min(r, s.r);
  return r;
}

/** Point-in-polygon (even-odd). */
export function pointInPoly(q: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polyArea(pts: Vec[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return a / 2;
}

/** Ear-clipping triangulation of a simple polygon. Returns index triples. */
export function triangulate(pts: Vec[]): number[] {
  const n = pts.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  if (polyArea(pts) < 0) idx.reverse();
  const out: number[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(sub(b, a), sub(c, b)) <= 1e-9) continue; // reflex
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTri(pts[j], a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

function pointInTri(p: Vec, a: Vec, b: Vec, c: Vec) {
  const d1 = cross(sub(b, a), sub(p, a)), d2 = cross(sub(c, b), sub(p, b)), d3 = cross(sub(a, c), sub(p, c));
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
}
