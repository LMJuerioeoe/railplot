// What rolling stock models are made of: a handful of shapes, and the parts every vehicle shares
// (wheels, buffers, axleboxes, lining), at OO scale (1:76.2, 16.5 mm gauge).
// Coordinates in mm: x along the vehicle (+ is its front), y across it (+ is its left), z up from the rail top.

import type { Label } from "./decals";
export type { Label };

export type RGB = [number, number, number];
export type Axis = "x" | "y" | "z";

/** What a model is drawn with. The 3D view turns these into a mesh; the tests measure them. */
export interface Shapes {
  /** An upright box. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB): void;
  /**
   * A round bar along an axis from a0 to a1, its radius going from r0 to r1 (a cone when they differ):
   * boilers, chimneys, buffers, axles, wheels. (u, v) is its centre in the other two coordinates, in
   * order: along x that's (y, z); along y, (x, z); along z, (x, y).
   */
  cyl(axis: Axis, a0: number, a1: number, u: number, v: number, r0: number, r1: number, col: RGB, caps?: boolean): void;
  /** A ring: a tyre, a boiler band, a chimney lip. */
  ring(axis: Axis, a0: number, a1: number, u: number, v: number, rOut: number, rIn: number, col: RGB): void;
  /** A straight bar in a side view, from (x0, z0) to (x1, z1), t thick, between y0 and y1: rods, spokes, braces, handrails. */
  beam(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, t: number, col: RGB): void;
  /** A convex outline across the vehicle, as (y, z) points, run along it from x0 to x1: coach bodies, tank tops. Smooth: shaded as one curved surface. */
  prismX(profile: [number, number][], x0: number, x1: number, col: RGB, smooth?: boolean): void;
  /** A convex outline seen from the side, as (x, z) points, between y0 and y1: splashers, cab fronts, noses. */
  prismY(profile: [number, number][], y0: number, y1: number, col: RGB, smooth?: boolean): void;
  /**
   * A decal flat on the body: lettering, a number plate, an emblem. Along a side (axis "y") it sits at
   * y = ±face, from x u0 to u1, on both sides unless `side` picks one; on an end (axis "x") at x = face,
   * from y u0 to u1. Always reads the right way round from where it's seen.
   */
  decal(axis: "x" | "y", face: number, u0: number, u1: number, z0: number, z1: number, label: Label, side?: 1 | -1): void;
  /** A shallow curved cap facing along an axis (dir ±1) from a: a smokebox door, a buffer head, a tank end. */
  dish(axis: Axis, a: number, dir: 1 | -1, u: number, v: number, r: number, depth: number, col: RGB): void;
  /** An arched roof from x0 to x1, its eaves at ±half wide and zEave high, rising `rise` in the middle. */
  roof(x0: number, x1: number, half: number, zEave: number, rise: number, col: RGB): void;
  /** Half a ball, sitting on z: a dome, a whistle bell (squash flattens it). */
  dome(x: number, y: number, z: number, r: number, col: RGB, squash?: number): void;
}

/** The space a model takes up, as its shapes say. */
export function boundsOf(draw: (s: Shapes) => void) {
  const b = { x0: Infinity, x1: -Infinity, y: 0, z0: Infinity, z1: -Infinity };
  const see = (x0: number, x1: number, y: number, z0: number, z1: number) => {
    b.x0 = Math.min(b.x0, x0); b.x1 = Math.max(b.x1, x1); b.y = Math.max(b.y, y); b.z0 = Math.min(b.z0, z0); b.z1 = Math.max(b.z1, z1);
  };
  const round = (axis: Axis, a0: number, a1: number, u: number, v: number, r: number) =>
    axis === "x" ? see(a0, a1, Math.abs(u) + r, v - r, v + r) : axis === "y" ? see(u - r, u + r, Math.max(Math.abs(a0), Math.abs(a1)), v - r, v + r) : see(u - r, u + r, Math.abs(v) + r, a0, a1);
  draw({
    box: (x0, x1, y0, y1, z0, z1) => see(x0, x1, Math.max(Math.abs(y0), Math.abs(y1)), z0, z1),
    cyl: (axis, a0, a1, u, v, r0, r1) => round(axis, a0, a1, u, v, Math.max(r0, r1)),
    ring: (axis, a0, a1, u, v, r) => round(axis, a0, a1, u, v, r),
    beam: (x0, z0, x1, z1, y0, y1, t) => see(Math.min(x0, x1) - t / 2, Math.max(x0, x1) + t / 2, Math.max(Math.abs(y0), Math.abs(y1)), Math.min(z0, z1) - t / 2, Math.max(z0, z1) + t / 2),
    prismX: (p, x0, x1) => see(x0, x1, Math.max(...p.map(([y]) => Math.abs(y))), Math.min(...p.map(([, z]) => z)), Math.max(...p.map(([, z]) => z))),
    prismY: (p, y0, y1) => see(Math.min(...p.map(([x]) => x)), Math.max(...p.map(([x]) => x)), Math.max(Math.abs(y0), Math.abs(y1)), Math.min(...p.map(([, z]) => z)), Math.max(...p.map(([, z]) => z))),
    roof: (x0, x1, half, ze, rise) => see(x0, x1, half, ze, ze + rise),
    dome: (x, y, z, r, _c, sq = 1) => see(x - r, x + r, Math.abs(y) + r, z, z + r * sq),
    dish: (axis, a, dir, u, v, r, depth) => round(axis, Math.min(a, a + dir * depth), Math.max(a, a + dir * depth), u, v, r),
    decal: () => { /* flat on the body: takes no room */ },
  });
  return b;
}

// ---------- colours ----------

export const BLACK: RGB = [0.07, 0.07, 0.08];
export const UNDER: RGB = [0.09, 0.09, 0.09];      // underframes: black, a little dusty
export const STEEL: RGB = [0.6, 0.61, 0.62];
export const DARK_STEEL: RGB = [0.24, 0.24, 0.25];
export const BRASS: RGB = [0.8, 0.62, 0.26];
export const COPPER: RGB = [0.72, 0.38, 0.2];
export const COAL: RGB = [0.05, 0.05, 0.055];
export const GLASS: RGB = [0.16, 0.2, 0.24];
export const RED_BEAM: RGB = [0.72, 0.13, 0.07];
export const CAB_INSIDE: RGB = [0.12, 0.11, 0.1];
export const WHITE: RGB = [0.92, 0.92, 0.9];
export const YELLOW: RGB = [0.95, 0.78, 0.1];
export const darker = (c: RGB, k = 0.7): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const SIDES = [1, -1] as const;

// ---------- small conveniences ----------

export const barX = (s: Shapes, x0: number, x1: number, y: number, z: number, r: number, col: RGB) => s.cyl("x", x0, x1, y, z, r, r, col);
export const barY = (s: Shapes, x: number, y0: number, y1: number, z: number, r: number, col: RGB) => s.cyl("y", Math.min(y0, y1), Math.max(y0, y1), x, z, r, r, col);
export const barZ = (s: Shapes, x: number, y: number, z0: number, z1: number, r: number, col: RGB) => s.cyl("z", z0, z1, x, y, r, r, col);

/** A flat band on a side face (y = ±face), from one point to another: lining, beading, strapping. */
export function strip(s: Shapes, face: number, x0: number, z0: number, x1: number, z1: number, w: number, col: RGB, proud = 0.2) {
  const y1 = face + Math.sign(face) * proud;
  s.beam(x0, z0, x1, z1, Math.min(face, y1), Math.max(face, y1), w, col);
}

/** A lined panel on both sides: a rectangle of thin lines (GWR orange and black, LNER black and white...). */
export function lining(s: Shapes, half: number, x0: number, z0: number, x1: number, z1: number, col: RGB, w = 0.45, inner?: RGB) {
  for (const e of SIDES) {
    const f = e * half;
    strip(s, f, x0, z0, x1, z0, w, col); strip(s, f, x0, z1, x1, z1, w, col);
    strip(s, f, x0, z0, x0, z1, w, col); strip(s, f, x1, z0, x1, z1, w, col);
    if (inner) {
      const d = w * 1.6;
      strip(s, f, x0 + d, z0 + d, x1 - d, z0 + d, w * 0.6, inner, 0.25); strip(s, f, x0 + d, z1 - d, x1 - d, z1 - d, w * 0.6, inner, 0.25);
      strip(s, f, x0 + d, z0 + d, x0 + d, z1 - d, w * 0.6, inner, 0.25); strip(s, f, x1 - d, z0 + d, x1 - d, z1 - d, w * 0.6, inner, 0.25);
    }
  }
}

/** A disc on each side, flat against the body: a roundel, a crest, a works plate. */
export function badge(s: Shapes, half: number, x: number, z: number, r: number, col: RGB, ring?: RGB) {
  for (const e of SIDES) {
    s.cyl("y", Math.min(e * half, e * (half + 0.3)), Math.max(e * half, e * (half + 0.3)), x, z, r, r, col);
    if (ring) s.ring("y", Math.min(e * half, e * (half + 0.4)), Math.max(e * half, e * (half + 0.4)), x, z, r + 0.35, r - 0.1, ring);
  }
}

/** A row of pale marks standing in for lettering or a number, on both sides. */
export function lettering(s: Shapes, half: number, x0: number, x1: number, z: number, height: number, col: RGB, chars = 4) {
  // markings are decals now (see the models' marks); this only stood in for them
  return; // eslint-disable-line no-unreachable
  const w = (x1 - x0) / (chars * 1.35);
  for (let i = 0; i < chars; i++) {
    const x = x0 + i * w * 1.35;
    for (const e of SIDES) s.box(x, x + w, e > 0 ? half : -half - 0.25, e > 0 ? half + 0.25 : -half, z, z + height, col);
  }
}

/** A rectangle with rounded corners, as a convex outline: windows, cab cut-outs, panels. */
export function roundedRect(x0: number, z0: number, x1: number, z1: number, r: number, n = 4): [number, number][] {
  const out: [number, number][] = [];
  r = Math.min(r, (x1 - x0) / 2, (z1 - z0) / 2);
  const corner = (cx: number, cz: number, t0: number) => { for (let k = 0; k <= n; k++) { const t = t0 + (k / n) * (Math.PI / 2); out.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]); } };
  corner(x1 - r, z0 + r, -Math.PI / 2); corner(x1 - r, z1 - r, 0); corner(x0 + r, z1 - r, Math.PI / 2); corner(x0 + r, z0 + r, Math.PI);
  return out;
}

/** Points round an arc: centre (cx, cz), radius r, from angle t0 to t1. */
export function arc(cx: number, cz: number, r: number, t0: number, t1: number, n = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) { const t = t0 + ((t1 - t0) * k) / n; out.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]); }
  return out;
}

/** A window pane with rounded corners on both sides of a body (y = ±face), set just proud, with a frame round it. */
export function pane(s: Shapes, face: number, x0: number, z0: number, x1: number, z1: number, r: number, glass: RGB, frame?: RGB) {
  for (const e of SIDES) {
    const f = e * face;
    if (frame) s.prismY(roundedRect(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, r + 0.5), Math.min(f, f + e * 0.12), Math.max(f, f + e * 0.12), frame);
    s.prismY(roundedRect(x0, z0, x1, z1, r), Math.min(f, f + e * 0.18), Math.max(f, f + e * 0.18), glass);
  }
}

/**
 * Coal heaped up between x0 and x1: a mound, then lumps scattered over it so it catches the light
 * unevenly, the same every time for a given seed.
 */
export function coal(s: Shapes, x0: number, x1: number, half: number, z: number, rise: number, seed: number) {
  s.roof(x0, x1, half, z, rise * 0.85, COAL);
  let r = seed * 9301 + 49297;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  const n = Math.round(((x1 - x0) * half) / 9);
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, x = x0 + 1.2 + rnd() * (x1 - x0 - 2.4), size = 0.7 + rnd() * 0.9;
    const y = u * (half - size - 0.3), top = z + rise * 0.85 * (1 - u * u);
    s.dome(x, y, top - size * 0.55, size, rnd() > 0.5 ? COAL : [0.09, 0.09, 0.1], 0.8);
  }
}

// ---------- wheels ----------

// OO wheels: the tread rides on the rail head at y = ±8.25; the wheel runs from ±7.3 (back) to ±9.6 (face)
export const WHEEL_BACK = 7.3, WHEEL_FACE = 9.6;

/**
 * A spoked wheel pair on one axle at x, radius r (centre at z = r): tyres, rims, spokes, bosses and, for
 * driving wheels, a balance weight opposite the crank.
 */
export function spokedWheels(s: Shapes, x: number, r: number, spokes: number, col: RGB, opts: { tyre?: RGB; balance?: number; crank?: number } = {}) {
  const tyre = opts.tyre ?? DARK_STEEL;
  for (const e of SIDES) {
    const yb = e * WHEEL_BACK, yf = e * WHEEL_FACE, yfIn = e * (WHEEL_FACE - 0.5);
    s.ring("y", Math.min(yb, yf), Math.max(yb, yf), x, r, r, r - 1.1, tyre);
    const yfl = e * (WHEEL_BACK + 0.45);
    s.ring("y", Math.min(yb, yfl), Math.max(yb, yfl), x, r, r + 0.75, r - 0.4, tyre);               // the flange, inside the tread
    s.ring("y", Math.min(yb, yfIn), Math.max(yb, yfIn), x, r, r - 1.05, r - 1.9, col);
    for (let i = 0; i < spokes; i++) {
      const t = (i / spokes) * Math.PI * 2 + 0.2;
      const a = 1.9, b = r - 1.7;
      s.beam(x + Math.cos(t) * a, r + Math.sin(t) * a, x + Math.cos(t) * b, r + Math.sin(t) * b, Math.min(e * (WHEEL_FACE - 1.3), yfIn), Math.max(e * (WHEEL_FACE - 1.3), yfIn), Math.max(0.6, r * 0.075), col);
    }
    s.cyl("y", Math.min(yb, yf), Math.max(yb, yf), x, r, 2.2, 2.2, col);                         // boss
    s.dish("y", yf, e, x, r, 1.5, 0.5, col);                                                      // axle end
    if (opts.balance !== undefined) {
      // a crescent of solid metal on the far side of the crank
      const c = opts.balance, pts: [number, number][] = [];
      for (let k = 0; k <= 8; k++) { const t = c - 0.75 + (1.5 * k) / 8; pts.push([x + Math.cos(t) * (r - 1.8), r + Math.sin(t) * (r - 1.8)]); }
      s.prismY(pts, Math.min(e * (WHEEL_FACE - 1.2), yfIn), Math.max(e * (WHEEL_FACE - 1.2), yfIn), col);
    }
    if (opts.crank !== undefined) {
      const cr = r * 0.42, cx = x + Math.cos(opts.crank) * cr, cz = r + Math.sin(opts.crank) * cr;
      s.cyl("y", Math.min(yf, e * (WHEEL_FACE + 0.9)), Math.max(yf, e * (WHEEL_FACE + 0.9)), cx, cz, 1.1, 1.1, STEEL);   // crankpin
    }
  }
  barY(s, x, -WHEEL_BACK, WHEEL_BACK, r, 1.1, DARK_STEEL);                                       // axle
}

/** A disc (or three-hole disc) wheel pair: wagons, coaches, tenders and diesels. */
export function discWheels(s: Shapes, x: number, r: number, col: RGB = DARK_STEEL) {
  for (const e of SIDES) {
    const yb = e * WHEEL_BACK, yf = e * WHEEL_FACE;
    s.ring("y", Math.min(yb, yf), Math.max(yb, yf), x, r, r, r - 1.0, DARK_STEEL);
    const yfl = e * (WHEEL_BACK + 0.45);
    s.ring("y", Math.min(yb, yfl), Math.max(yb, yfl), x, r, r + 0.7, r - 0.4, DARK_STEEL);             // flange
    const yd = e * (WHEEL_FACE - 0.6);
    s.cyl("y", Math.min(yb, yd), Math.max(yb, yd), x, r, r - 1.0, r - 1.0, col);
    s.cyl("y", Math.min(yd, yf), Math.max(yd, yf), x, r, 1.6, 1.6, col);                         // hub
    s.dish("y", yf, e, x, r, 1.6, 0.45, col);
  }
  barY(s, x, -WHEEL_BACK, WHEEL_BACK, r, 0.9, DARK_STEEL);
}

// ---------- buffers, couplings, headstocks ----------

/** Centre height of buffers above the rail: 3 ft 5½ in. */
export const BUFFER_Z = 13.6;
/** European buffers: 1,060 mm, which is 12.2 mm in H0. */
export const BUFFER_Z_H0 = 12.2;
let bufferZ = BUFFER_Z;
/** Draw with buffers at another height (H0 stock), then put it back. */
export function withBufferHeight(z: number, draw: () => void) {
  const was = bufferZ; bufferZ = z;
  try { draw(); } finally { bufferZ = was; }
}
/** How far buffers stand out from the headstock (housing, shank and head). */
export const BUFFER_REACH = 5.5;

/**
 * A headstock (buffer beam) at each end of a vehicle `half` long over buffers, with buffers, a coupling
 * hook and a vacuum pipe. Returns where the headstocks' outer faces are.
 */
export function headstocks(s: Shapes, half: number, col: RGB, opts: { width?: number; depth?: number; z0?: number; z1?: number; oval?: boolean; spread?: number } = {}) {
  const face = half - BUFFER_REACH, depth = opts.depth ?? 2.6, w = opts.width ?? 14.5;
  const BZ = bufferZ, z0 = opts.z0 ?? BZ - 3.6, z1 = opts.z1 ?? BZ + 3.4, spread = opts.spread ?? 9.6;
  for (const e of SIDES) {
    const a = e * face, b = e * (face - depth);
    s.box(Math.min(a, b), Math.max(a, b), -w, w, z0, z1, col);
    for (const y of [-spread, spread]) buffer(s, a, e, y, BZ);
    // coupling hook and a loop of screw link hanging from it
    const h = e * (face + 1.6);
    s.box(Math.min(a, h), Math.max(a, h), -0.7, 0.7, BZ - 1.2, BZ + 0.4, DARK_STEEL);
    s.beam(h, BZ - 0.6, h + e * 0.8, BZ - 3.2, -1.1, 1.1, 0.5, DARK_STEEL);
    // vacuum brake pipe, standing up beside the hook
    s.cyl("z", z0 - 3, z1 - 1, e * (face + 0.8), 4.2, 0.55, 0.55, BLACK);
  }
  return face;
}

/** One buffer at the headstock face `x`, pointing outwards (dir ±1): a tapered housing, a shank and a head. */
export function buffer(s: Shapes, x: number, dir: number, y: number, z: number) {
  const p = (d: number) => x + dir * d;
  const [h0, h1] = [p(0), p(2.6)], [k0, k1] = [p(2.6), p(4.6)], [d0, d1] = [p(4.6), p(BUFFER_REACH)];
  s.cyl("x", Math.min(h0, h1), Math.max(h0, h1), y, z, dir > 0 ? 1.9 : 1.35, dir > 0 ? 1.35 : 1.9, BLACK);
  s.cyl("x", Math.min(k0, k1), Math.max(k0, k1), y, z, 0.85, 0.85, STEEL);
  // the head: a flat-sided disc with a gently curved face
  const hf = p(5.15);
  s.cyl("x", Math.min(d0, hf), Math.max(d0, hf), y, z, 2.3, 2.3, STEEL);
  s.dish("x", hf, dir > 0 ? 1 : -1, y, z, 2.3, BUFFER_REACH - 5.15, STEEL);
}

// ---------- wagon running gear ----------

/**
 * A four-wheeled wagon's running gear: solebars, W-irons, axleboxes, leaf springs, wheels and the brake
 * (V-hangers, shoes and lever).
 */
export function wagonGear(s: Shapes, bodyHalf: number, wheelbase: number, r = 6.1, col: RGB = UNDER, solebarFace = 15.2) {
  for (const e of SIDES) {
    const y0 = e * (solebarFace - 1.3), y1 = e * solebarFace;
    s.box(-bodyHalf, bodyHalf, Math.min(y0, y1), Math.max(y0, y1), 10.4, 14.4, col);           // solebar
    for (const x of [-wheelbase / 2, wheelbase / 2]) {
      const yo = e * (solebarFace - 0.2), yi = e * (solebarFace - 1.4);
      s.beam(x - 4.5, 10.6, x - 1.6, r - 1.5, Math.min(yi, yo), Math.max(yi, yo), 0.7, col);   // W-iron
      s.beam(x + 4.5, 10.6, x + 1.6, r - 1.5, Math.min(yi, yo), Math.max(yi, yo), 0.7, col);
      const ya = e * (solebarFace + 0.6);
      s.box(x - 1.7, x + 1.7, Math.min(yi, ya), Math.max(yi, ya), r - 2.2, r + 2.0, col);       // axlebox
      for (let k = 0; k < 4; k++) {                                                              // leaf spring
        const l = 6.2 - k * 1.2, z = r + 2.2 + k * 0.42;
        s.box(x - l, x + l, Math.min(yi, ya) + 0.2, Math.max(yi, ya) - 0.2, z, z + 0.4, col);
      }
      discWheels(s, x, r);
    }
    // brake: V-hanger in the middle, shoes on the wheels, the lever along the solebar
    const yv = e * (solebarFace - 2.2), yv2 = e * (solebarFace - 1.5);
    s.beam(-5, 10.5, 0, 4.6, Math.min(yv, yv2), Math.max(yv, yv2), 0.7, col);
    s.beam(5, 10.5, 0, 4.6, Math.min(yv, yv2), Math.max(yv, yv2), 0.7, col);
    for (const x of [-wheelbase / 2, wheelbase / 2]) s.box(x - Math.sign(x) * (r + 0.2) - 0.6, x - Math.sign(x) * (r + 0.2) + 0.6, Math.min(e * 6.8, e * 9.4), Math.max(e * 6.8, e * 9.4), r - 2.5, r + 2.5, DARK_STEEL);
    s.beam(-wheelbase / 2 + 3, 5.2, wheelbase / 2 - 8, 7.8, Math.min(e * (solebarFace + 0.1), e * (solebarFace + 0.7)), Math.max(e * (solebarFace + 0.1), e * (solebarFace + 0.7)), 0.6, col);
  }
  barX(s, -wheelbase / 2 + r, wheelbase / 2 - r, 0, 5, 0.6, col);                                   // brake cross shaft
  s.box(-bodyHalf, bodyHalf, -solebarFace + 1, solebarFace - 1, 13.6, 14.6, col);                   // floor
}

/** Vertical planks, as fine dark lines on a side between x0 and x1. */
export function planking(s: Shapes, face: number, x0: number, x1: number, z0: number, z1: number, n: number, col: RGB, horizontal = false) {
  for (let i = 1; i < n; i++) {
    if (horizontal) { const z = z0 + ((z1 - z0) * i) / n; strip(s, face, x0, z, x1, z, 0.22, col, 0.08); }
    else { const x = x0 + ((x1 - x0) * i) / n; strip(s, face, x, z0, x, z1, 0.22, col, 0.08); }
  }
}

/** A ladder of steps hanging below a cab door: two stiles and rungs, from zTop down to zBottom. */
export function ladder(s: Shapes, x: number, face: number, zTop: number, zBottom: number, col: RGB) {
  const yo = Math.sign(face) * (Math.abs(face) - 0.2), yi = Math.sign(face) * (Math.abs(face) - 1.6);
  const lo = Math.min(yo, yi), hi = Math.max(yo, yi);
  for (const dx of [-2.2, 2.2]) s.box(x + dx - 0.3, x + dx + 0.3, lo, hi, zBottom, zTop, col);
  for (let z = zBottom + 0.4; z < zTop - 0.5; z += 3.2) s.box(x - 2.2, x + 2.2, lo, hi, z, z + 0.5, col);
}

/** Steps: a hanging bracket and a tread, below a door or the cab. */
export function step(s: Shapes, x: number, face: number, zTop: number, col: RGB = UNDER) {
  const yo = Math.sign(face) * (Math.abs(face) - 0.4), yi = Math.sign(face) * (Math.abs(face) - 1.2);
  s.box(x - 0.5, x + 0.5, Math.min(yo, yi), Math.max(yo, yi), zTop - 5.5, zTop, col);
  s.box(x - 2.2, x + 2.2, Math.min(yo, yi) - 0.4, Math.max(yo, yi) + 0.2, zTop - 5.9, zTop - 5.2, col);
}
