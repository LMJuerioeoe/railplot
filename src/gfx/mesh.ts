// A small mesh builder for the 3D view: positions in millimetres with z up, a colour and a material per vertex,
// and a transform stack so models can be written in their own frame.
import { triangulate } from "../geom";

export type V3 = [number, number, number];
export type RGB = [number, number, number];

/** Materials the renderer knows how to shade. The number is stored per vertex. */
export const MAT = {
  paint: 0,      // satin paint, plastic
  steel: 1,      // polished metal (rail heads, tyres)
  ply: 2,        // birch plywood, grain along x
  ballast: 3,    // granite chippings
  grass: 4,      // static grass and ground cover
  glass: 5,      // glazing: dark and glossy
  glow: 6,       // lamps and signal aspects: lit from inside
  foliage: 7,    // leaves
  brick: 8,      // brickwork, 4 mm scale courses
  slate: 9,      // roof slates
  timber: 10,    // sawn timber: sleepers, fences, decking
  concrete: 11,  // concrete, tarmac, stone
  floor: 12,     // room floor: laminate planks
  wall: 13,      // room walls: only seen from the inside
  window: 14,    // building windows: glass by day, lit in the evening
  matte: 15,     // flat, unshiny surfaces (fabric, card, backscene)
  water: 16,     // still water
  rust: 17,      // weathered iron (rail sides, wagon underframes)
} as const;

export const rgb = (hex: string): RGB => {
  const s = hex.replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const shade = (c: RGB, k: number): RGB => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** 3 x 4 affine transform, row major: [r00 r01 r02 tx, r10 r11 r12 ty, r20 r21 r22 tz]. */
type Xf = number[];
const IDENT: Xf = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function xfMul(a: Xf, b: Xf): Xf {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}

export const STRIDE = 10; // floats per vertex: position 3, normal 3, colour 3, material 1

export class Mesh {
  data: number[] = [];
  idx: number[] = [];
  private xf: Xf = IDENT;
  private stack: Xf[] = [];
  /** Bounds of everything added while `track` is on (the ground and room are left out). */
  min: V3 = [Infinity, Infinity, Infinity];
  max: V3 = [-Infinity, -Infinity, -Infinity];
  track = true;

  get vertexCount() { return this.data.length / STRIDE; }

  push() { this.stack.push(this.xf); return this; }
  pop() { this.xf = this.stack.pop() ?? IDENT; return this; }
  /** Move the local frame. */
  move(x: number, y: number, z = 0) { this.xf = xfMul(this.xf, [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]); return this; }
  /** Turn the local frame about z (radians, counter-clockwise from above). */
  turn(a: number) { const c = Math.cos(a), s = Math.sin(a); this.xf = xfMul(this.xf, [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]); return this; }
  /** Tilt the local frame about y (nose up for positive angles). */
  pitch(a: number) { const c = Math.cos(a), s = Math.sin(a); this.xf = xfMul(this.xf, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0]); return this; }
  /** Roll the local frame about x. */
  roll(a: number) { const c = Math.cos(a), s = Math.sin(a); this.xf = xfMul(this.xf, [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]); return this; }
  scale(k: number, ky = k, kz = k) { this.xf = xfMul(this.xf, [k, 0, 0, 0, 0, ky, 0, 0, 0, 0, kz, 0]); return this; }
  /** Run `f` in a moved and turned frame. */
  at(x: number, y: number, z: number, heading: number, f: () => void) { this.push().move(x, y, z).turn(heading); f(); this.pop(); }

  private P(p: V3): V3 {
    const m = this.xf;
    return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
  }
  private N(n: V3): V3 {
    const m = this.xf;
    return norm([m[0] * n[0] + m[1] * n[1] + m[2] * n[2], m[4] * n[0] + m[5] * n[1] + m[6] * n[2], m[8] * n[0] + m[9] * n[1] + m[10] * n[2]]);
  }

  /** Add a vertex given in the local frame. */
  v(p: V3, n: V3, c: RGB, mat: number): number {
    const w = this.P(p), wn = this.N(n);
    if (this.track) for (let i = 0; i < 3; i++) { if (w[i] < this.min[i]) this.min[i] = w[i]; if (w[i] > this.max[i]) this.max[i] = w[i]; }
    this.data.push(w[0], w[1], w[2], wn[0], wn[1], wn[2], c[0], c[1], c[2], mat);
    return this.data.length / STRIDE - 1;
  }

  tri(a: V3, b: V3, c: V3, col: RGB, mat: number) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const i = this.v(a, n, col, mat); this.v(b, n, col, mat); this.v(c, n, col, mat);
    this.idx.push(i, i + 1, i + 2);
  }

  /** A flat four-sided face; corners counter-clockwise seen from outside. */
  quad(a: V3, b: V3, c: V3, d: V3, col: RGB, mat: number, n?: V3) {
    const nn = n ?? norm(cross(sub(b, a), sub(d, a)));
    const i = this.v(a, nn, col, mat); this.v(b, nn, col, mat); this.v(c, nn, col, mat); this.v(d, nn, col, mat);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** A box between two corners. `skip` lists faces to leave out: "x-", "x+", "y-", "y+", "z-", "z+". */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: RGB, mat: number = MAT.paint, skip = "") {
    if (!skip.includes("z+")) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, mat);
    if (!skip.includes("z-")) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], col, mat);
    if (!skip.includes("y-")) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col, mat);
    if (!skip.includes("y+")) this.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], col, mat);
    if (!skip.includes("x-")) this.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], col, mat);
    if (!skip.includes("x+")) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], col, mat);
  }
  /** A box given by its centre on the ground plane, its size and its base height. */
  block(cx: number, cy: number, z0: number, sx: number, sy: number, sz: number, col: RGB, mat: number = MAT.paint, skip = "") {
    this.box(cx - sx / 2, cy - sy / 2, z0, cx + sx / 2, cy + sy / 2, z0 + sz, col, mat, skip);
  }

  /** A cylinder (or cone, with r1 != r0) along an axis from `a`. Smooth sides, optional caps. */
  cyl(a: V3, axis: "x" | "y" | "z", len: number, r0: number, r1: number, col: RGB, mat: number = MAT.paint, seg = 16, caps = 3, capCol?: RGB) {
    const pt = (t: number, r: number, ang: number): V3 => {
      const c = Math.cos(ang) * r, s = Math.sin(ang) * r;
      if (axis === "x") return [a[0] + t, a[1] + c, a[2] + s];
      if (axis === "y") return [a[0] - c, a[1] + t, a[2] + s];
      return [a[0] + c, a[1] + s, a[2] + t];
    };
    const nr = (ang: number): V3 => {
      const c = Math.cos(ang), s = Math.sin(ang), k = (r0 - r1) / (len || 1);
      if (axis === "x") return norm([k, c, s]);
      if (axis === "y") return norm([-c, k, s]);
      return norm([c, s, k]);
    };
    const base = this.vertexCount;
    for (let i = 0; i <= seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      this.v(pt(0, r0, ang), nr(ang), col, mat);
      this.v(pt(len, r1, ang), nr(ang), col, mat);
    }
    for (let i = 0; i < seg; i++) {
      const k = base + i * 2;
      this.idx.push(k, k + 2, k + 3, k, k + 3, k + 1);
    }
    const cc = capCol ?? col;
    const cap = (t: number, r: number, flip: boolean) => {
      if (r <= 0) return;
      const n: V3 = axis === "x" ? [flip ? -1 : 1, 0, 0] : axis === "y" ? [0, flip ? -1 : 1, 0] : [0, 0, flip ? -1 : 1];
      const c = this.v(pt(t, 0, 0), n, cc, mat);
      for (let i = 0; i <= seg; i++) this.v(pt(t, r, (i / seg) * Math.PI * 2), n, cc, mat);
      for (let i = 0; i < seg; i++) flip ? this.idx.push(c, c + 2 + i, c + 1 + i) : this.idx.push(c, c + 1 + i, c + 2 + i);
    };
    if (caps & 1) cap(0, r0, true);
    if (caps & 2) cap(len, r1, false);
  }

  /** A polygon outline (plan coordinates) between two heights: top, sides and optionally the underside. */
  prism(pts: { x: number; y: number }[], z0: number, z1: number, top: RGB, side: RGB, matTop: number, matSide: number = matTop, bottom = false) {
    if (pts.length < 3) return;
    const area = pts.reduce((s, q, k) => { const r = pts[(k + 1) % pts.length]; return s + q.x * r.y - r.x * q.y; }, 0);
    const p = area < 0 ? [...pts].reverse() : pts;
    const tri = triangulate(p);
    const t0 = this.vertexCount;
    for (const q of p) this.v([q.x, q.y, z1], [0, 0, 1], top, matTop);
    for (let i = 0; i < tri.length; i += 3) this.idx.push(t0 + tri[i], t0 + tri[i + 1], t0 + tri[i + 2]);
    if (bottom) {
      const b0 = this.vertexCount;
      for (const q of p) this.v([q.x, q.y, z0], [0, 0, -1], side, matSide);
      for (let i = 0; i < tri.length; i += 3) this.idx.push(b0 + tri[i], b0 + tri[i + 2], b0 + tri[i + 1]);
    }
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      this.quad([a.x, a.y, z0], [c.x, c.y, z0], [c.x, c.y, z1], [a.x, a.y, z1], side, matSide);
    }
  }

  /**
   * Sweep a cross-section along a path. `section` is a list of [across, up] points (across: left of travel is positive);
   * each consecutive pair becomes a strip. `cols` gives the colour and material of each strip.
   */
  sweep(path: { x: number; y: number; z: number; h: number }[], section: [number, number][], cols: { c: RGB; m: number }[], closed = false) {
    if (path.length < 2) return;
    const nSeg = closed ? section.length : section.length - 1;
    for (let s = 0; s < nSeg; s++) {
      const [u0, v0] = section[s], [u1, v1] = section[(s + 1) % section.length];
      const du = u1 - u0, dv = v1 - v0, l = Math.hypot(du, dv) || 1;
      // outward normal of the strip in the section plane (the section runs clockwise seen from behind)
      const nu = dv / l, nv = -du / l;
      const col = cols[Math.min(s, cols.length - 1)];
      const base = this.vertexCount;
      for (const p of path) {
        const lx = -Math.sin(p.h), ly = Math.cos(p.h);
        const n: V3 = [lx * nu, ly * nu, nv];
        this.v([p.x + lx * u0, p.y + ly * u0, p.z + v0], n, col.c, col.m);
        this.v([p.x + lx * u1, p.y + ly * u1, p.z + v1], n, col.c, col.m);
      }
      for (let i = 0; i + 1 < path.length; i++) {
        const k = base + i * 2;
        this.idx.push(k, k + 1, k + 3, k, k + 3, k + 2);
      }
    }
  }

  /** A lumpy ball (tree crowns, bushes). */
  blob(c: V3, rx: number, ry: number, rz: number, col: RGB, mat: number, seed = 1, lumps = 0.22) {
    const U = 10, V = 7;
    const rnd = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
    const base = this.vertexCount;
    for (let j = 0; j <= V; j++) {
      const th = (j / V) * Math.PI;
      for (let i = 0; i <= U; i++) {
        const ph = (i / U) * Math.PI * 2;
        const k = 1 + (rnd(i % U, j) - 0.5) * 2 * lumps * Math.sin(th);
        const n: V3 = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        const shadeK = 0.82 + 0.3 * rnd(i % U + 9, j + 5) * Math.sin(th) + 0.12 * n[2];
        this.v([c[0] + n[0] * rx * k, c[1] + n[1] * ry * k, c[2] + n[2] * rz * k], n, shade(col, shadeK), mat);
      }
    }
    for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) {
      const a = base + j * (U + 1) + i, b = a + U + 1;
      this.idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }

  /** A body shell: a cross-section [across, up] (closed, clockwise seen from the front) extruded along x from x0 to x1, with flat ends. */
  shell(x0: number, x1: number, section: [number, number][], col: RGB, mat: number = MAT.paint, endCol: RGB = col, stripCols?: (RGB | null)[]) {
    const n = section.length;
    for (let s = 0; s < n; s++) {
      const [y0, z0] = section[s], [y1, z1] = section[(s + 1) % n];
      const c = stripCols?.[s] ?? col;
      this.quad([x0, y0, z0], [x0, y1, z1], [x1, y1, z1], [x1, y0, z0], c, mat);
    }
    const pts = section.map(([y, z]) => ({ x: y, y: z }));
    const area = pts.reduce((s, q, k) => { const r = pts[(k + 1) % n]; return s + q.x * r.y - r.x * q.y; }, 0);
    const tri = triangulate(area < 0 ? [...pts].reverse() : pts);
    const src = area < 0 ? [...section].reverse() : section;
    for (const [x, nx] of [[x0, -1], [x1, 1]] as const) {
      const b = this.vertexCount;
      for (const [y, z] of src) this.v([x, y, z], [nx, 0, 0], endCol, mat);
      for (let i = 0; i < tri.length; i += 3) nx > 0 ? this.idx.push(b + tri[i], b + tri[i + 1], b + tri[i + 2]) : this.idx.push(b + tri[i], b + tri[i + 2], b + tri[i + 1]);
    }
  }

  /** Copy another mesh in, through the current transform. */
  add(o: Mesh) {
    const base = this.vertexCount;
    const d = o.data;
    for (let i = 0; i < d.length; i += STRIDE) this.v([d[i], d[i + 1], d[i + 2]], [d[i + 3], d[i + 4], d[i + 5]], [d[i + 6], d[i + 7], d[i + 8]], d[i + 9]);
    for (const k of o.idx) this.idx.push(base + k);
  }
}

/** A rounded-roof cross-section for vehicle bodies: flat floor, straight (slightly tumbled) sides, arc roof. Clockwise seen from the front. */
export function bodySection(width: number, floor: number, eaves: number, top: number, tumble = 0, seg = 6): [number, number][] {
  const w = width / 2, out: [number, number][] = [];
  out.push([-w + tumble, floor], [-w, floor + (eaves - floor) * 0.35], [-w, eaves]);
  for (let i = 1; i < seg; i++) {
    const a = Math.PI - (i / seg) * Math.PI;
    out.push([Math.cos(a) * w, eaves + Math.sin(a) * (top - eaves)]);
  }
  out.push([w, eaves], [w, floor + (eaves - floor) * 0.35], [w - tumble, floor]);
  return out.reverse();
}
