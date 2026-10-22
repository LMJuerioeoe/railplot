// Diesel locomotives: the BR Class 08 shunter and the Class 37.
import { BLACK, DARK_STEEL, GLASS, RGB, SIDES, STEEL, Shapes, UNDER, WHEEL_FACE, YELLOW, barX, barZ, darker, discWheels, headstocks, step, strip } from "./parts";
import { bogie } from "./coaches";

const BR_GREEN: RGB = [0.11, 0.3, 0.19], BR_BLUE: RGB = [0.17, 0.3, 0.47], ROOF_GREY: RGB = [0.42, 0.43, 0.44];

/** Diagonal black and yellow stripes across a face (x = face, looking along x), between y and z limits. */
function wasp(s: Shapes, x: number, dir: number, y0: number, y1: number, z0: number, z1: number) {
  const a = Math.min(x, x + dir * 0.15), b = Math.max(x, x + dir * 0.15);
  s.box(a, b, y0, y1, z0, z1, YELLOW);
  const a2 = Math.min(x + dir * 0.15, x + dir * 0.3), b2 = Math.max(x + dir * 0.15, x + dir * 0.3);
  for (let y = y0 - (z1 - z0); y < y1; y += 4.2) {
    // a stripe from (y, z0) to (y + h, z1), clipped to the face
    const ya = Math.max(y0, y), yb = Math.min(y1, y + (z1 - z0));
    if (yb - ya < 0.5) continue;
    const za = z0 + (ya - y), zb = z0 + (yb - y);
    s.prismX([[ya, za], [ya + 1.8, za], [Math.min(y1, yb + 1.8), Math.min(z1, zb)], [yb, zb]].map(([yy, zz]) => [Math.min(y1, yy), Math.min(z1, zz)]) as [number, number][], a2, b2, BLACK);
  }
}

/** BR Class 08 0-6-0 diesel-electric shunter, BR green with wasp-striped ends. */
export function drawClass08(s: Shapes) {
  const half = 58.5, w = 17, plate = 15.6;
  const face = headstocks(s, half, BLACK, { z0: 9.4, z1: plate, width: 15.5 });
  for (const e of SIDES) wasp(s, e * face, e, -15.5, 15.5, 9.4, plate);
  // frames and the running plate
  for (const e of SIDES) { const a = e * 5.2, b = e * 6.4; s.box(-face + 2, face - 2, Math.min(a, b), Math.max(a, b), 5, plate, BLACK); }
  s.box(-face, face, -w, w, plate - 0.7, plate, BLACK);
  for (const e of SIDES) { const a = e * (w - 0.5), b = e * w; s.box(-face, face, Math.min(a, b), Math.max(a, b), plate - 2.6, plate - 0.7, BR_GREEN); }
  // wheels, coupling rods and the jackshaft
  const xs = [24, 1, -22], r = 8.9, CR = 0.9;
  for (const x of xs) {
    discWheels(s, x, r, BLACK);
    for (const e of SIDES) {
      const cx = x + Math.cos(CR) * r * 0.42, cz = r + Math.sin(CR) * r * 0.42;
      s.cyl("y", Math.min(e * WHEEL_FACE, e * (WHEEL_FACE + 0.9)), Math.max(e * WHEEL_FACE, e * (WHEEL_FACE + 0.9)), cx, cz, 1.1, 1.1, STEEL);
      // the balance weight, a raised crescent opposite the crank
      const pts: [number, number][] = [];
      for (let k = 0; k <= 8; k++) { const t = CR + Math.PI - 0.8 + (1.6 * k) / 8; pts.push([x + Math.cos(t) * (r - 1.3), r + Math.sin(t) * (r - 1.3)]); }
      s.prismY(pts, Math.min(e * (WHEEL_FACE - 0.6), e * WHEEL_FACE), Math.max(e * (WHEEL_FACE - 0.6), e * WHEEL_FACE), BLACK);
    }
  }
  for (const e of SIDES) {
    const ya = e * (WHEEL_FACE + 0.9), yb = e * (WHEEL_FACE + 1.9), pin = (x: number) => [x + Math.cos(CR) * r * 0.42, r + Math.sin(CR) * r * 0.42];
    const p0 = pin(xs[0]), p2 = pin(xs[2]), pj = [-36 + Math.cos(CR) * 3, r + 1 + Math.sin(CR) * 3];
    s.beam(p0[0], p0[1], p2[0], p2[1], Math.min(ya, yb), Math.max(ya, yb), 1.6, STEEL);
    s.beam(p2[0], p2[1], pj[0], pj[1], Math.min(ya, yb), Math.max(ya, yb), 1.6, STEEL);
    s.cyl("y", Math.min(e * 6.4, e * 10), Math.max(e * 6.4, e * 10), -36, r + 1, 3.4, 3.4, BLACK);     // jackshaft crank
    for (const x of xs) s.box(x - 2, x + 2, Math.min(e * 10.3, e * 12), Math.max(e * 10.3, e * 12), r - 2.5, r + 2.5, BLACK);   // axleboxes
  }
  // the long bonnet: doors, louvres, radiator, exhaust
  const bx0 = -21.5, bx1 = face - 2, bt = 38.5, bw = 12.6;
  s.prismX([[-bw, plate], [bw, plate], [bw, bt - 2], [bw - 2, bt], [-bw + 2, bt], [-bw, bt - 2]], bx0, bx1, BR_GREEN);
  for (const e of SIDES) {
    const f = e * bw;
    for (let x = bx0 + 9; x < bx1 - 2; x += 9.5) strip(s, f, x, plate + 1.5, x, bt - 3, 0.3, darker(BR_GREEN, 0.5), 0.08);   // door edges
    for (let z = bt - 9; z < bt - 4; z += 1.1) strip(s, f, bx1 - 14, z, bx1 - 4, z, 0.45, darker(BR_GREEN, 0.4), 0.15);    // louvres
    barX(s, bx0 + 2, bx1 - 3, e * (bw + 0.6), plate + 14, 0.3, STEEL);                                                      // handrail
    s.box(bx0, bx1, Math.min(e * (bw + 0.1), e * (w - 0.6)), Math.max(e * (bw + 0.1), e * (w - 0.6)), plate, plate + 0.3, DARK_STEEL);   // walkway
  }
  s.box(bx1, bx1 + 0.3, -bw + 1.5, bw - 1.5, plate + 4, bt - 4, darker(BR_GREEN, 0.55));                                       // radiator grille
  for (let z = plate + 5; z < bt - 4; z += 1.2) s.box(bx1 + 0.3, bx1 + 0.5, -bw + 2, bw - 2, z, z + 0.4, BLACK);
  for (const y of [-7, 7]) { s.cyl("x", bx1, bx1 + 1.2, y, plate + 3, 1.3, 1.3, STEEL); }                                  // lamps
  barZ(s, bx1 - 12, 0, bt, bt + 3, 1.7, BLACK); s.ring("z", bt + 2.6, bt + 3, bx1 - 12, 0, 2, 1.4, BLACK);                   // exhaust
  s.box(bx1 - 9, bx1 - 4, -3, 3, bt, bt + 0.6, darker(BR_GREEN, 0.7));                                                      // filler
  // the cab at the back, full width, windows all round
  const cx0 = -face + 2, cx1 = bx0, ct = 47.5;
  for (const e of SIDES) {
    const out = e * w, inn = e * (w - 0.8);
    const lo = Math.min(out, inn), hi = Math.max(out, inn);
    s.box(cx0, cx1, lo, hi, plate, ct - 9, BR_GREEN);
    s.box(cx0, cx1, lo, hi, ct - 2, ct, BR_GREEN);
    for (const [x0, x1] of [[cx0, cx0 + 3], [cx1 - 3, cx1], [(cx0 + cx1) / 2 - 1.2, (cx0 + cx1) / 2 + 1.2]]) s.box(x0, x1, lo, hi, ct - 9, ct - 2, BR_GREEN);
    s.box(cx0 + 3, cx1 - 3, Math.min(out, out - e * 0.3), Math.max(out, out - e * 0.3), ct - 9, ct - 2, GLASS);
    barZ(s, cx1 - 1, e * (w - 0.3), plate + 2, ct - 10, 0.28, STEEL);
    step(s, cx1 - 2.5, e * (w - 0.2), plate - 0.6);
  }
  for (const [x, d] of [[cx1, 1], [cx0, -1]] as const) {
    s.box(Math.min(x, x - d * 0.8), Math.max(x, x - d * 0.8), -w, w, plate, ct, BR_GREEN);
    for (const e of SIDES) s.box(Math.min(x, x + d * 0.12), Math.max(x, x + d * 0.12), Math.min(e * 3, e * 14), Math.max(e * 3, e * 14), ct - 10, ct - 2.5, GLASS);
  }
  s.box(cx0 + 1, cx1 - 1, -w + 1, w - 1, plate, ct - 1, [0.1, 0.11, 0.1]);
  s.roof(cx0 - 0.6, cx1 + 0.6, w + 0.2, ct, 2.4, ROOF_GREY);
  wasp(s, -face, -1, -15.5, 15.5, 9.4, plate);
  // the BR emblem on the bonnet side, and a number on the cab
  for (const e of SIDES) {
    s.cyl("y", Math.min(e * bw, e * (bw + 0.3)), Math.max(e * bw, e * (bw + 0.3)), 18, plate + 12, 3, 3, [0.85, 0.75, 0.45]);
    for (let i = 0; i < 5; i++) { const x = cx0 + 5 + i * 3.4; s.box(x, x + 2.4, e > 0 ? w : -w - 0.25, e > 0 ? w + 0.25 : -w, plate + 4, plate + 7, [0.92, 0.92, 0.9]); }
  }
}

/** BR Class 37 Co-Co diesel-electric, BR blue with full yellow ends: two noses, two cabs, the engine room between. */
export function drawClass37(s: Shapes) {
  const half = 122.5, w = 17.5, plate = 18;
  const face = headstocks(s, half, BLACK, { z0: 9.4, z1: plate, width: 16 });
  // underframe, fuel tank, battery boxes
  s.box(-face + 1, face - 1, -w + 0.6, w - 0.6, plate - 2, plate, BLACK);
  s.box(-34, 34, -12, 12, 6.5, plate - 2, darker(BLACK, 1.3));
  for (const x of [-28, 0, 28]) s.box(x - 0.3, x + 0.3, -12.2, 12.2, 6.5, plate - 2, BLACK);
  for (const c of [66, -66]) {
    bogie(s, c, 27, 7.1, plate - 2, BLACK);
    discWheels(s, c, 7.1);
  }
  // body: engine room between the cabs, cabs, noses
  const cab = 102, room = 82, top = 47.5, noseTop = 37;
  const profile = (t: number): [number, number][] => [[-w, plate], [w, plate], [w, t - 3], [w - 1.5, t - 0.8], [w - 3, t], [-w + 3, t], [-w + 1.5, t - 0.8], [-w, t - 3]];
  s.prismX(profile(top), -room, room, BR_BLUE);
  s.roof(-room, room, w - 1.5, top, 4, ROOF_GREY);
  for (const e of SIDES) {
    const f = e * w;
    // engine room grilles and doors, the BR arrow, the number
    for (const x of [-60, -30, 25, 55]) { s.box(x - 9, x + 9, Math.min(f, f + e * 0.15), Math.max(f, f + e * 0.15), top - 12, top - 4, darker(BR_BLUE, 0.6)); for (let z = top - 11.5; z < top - 4; z += 1.1) strip(s, f, x - 8.5, z, x + 8.5, z, 0.4, BLACK, 0.22); }
    for (const x of [-45, 40]) { strip(s, f, x, plate + 2, x, top - 3, 0.3, darker(BR_BLUE, 0.5), 0.1); strip(s, f, x + 9, plate + 2, x + 9, top - 3, 0.3, darker(BR_BLUE, 0.5), 0.1); }
    s.beam(-8, plate + 18, 8, plate + 18, Math.min(f, f + e * 0.25), Math.max(f, f + e * 0.25), 0.9, [0.92, 0.92, 0.9]);
    s.beam(-4, plate + 20.5, 4, plate + 15.5, Math.min(f, f + e * 0.25), Math.max(f, f + e * 0.25), 0.9, [0.92, 0.92, 0.9]);
    for (let i = 0; i < 5; i++) { const x = 66 + i * 3.4; s.box(x, x + 2.4, e > 0 ? w : -w - 0.25, e > 0 ? w + 0.25 : -w, plate + 4, plate + 7.5, [0.92, 0.92, 0.9]); }
    barX(s, -room + 2, room - 2, e * (w - 0.1), plate + 3, 0.3, STEEL);
  }
  for (const d of [1, -1]) {
    const c0 = Math.min(d * room, d * cab), c1 = Math.max(d * room, d * cab);
    // the cab: full height, side windows and a door, yellow front with two windscreens
    s.prismX(profile(top), c0, c1, BR_BLUE);
    s.roof(c0, c1, w - 1.5, top, 4, ROOF_GREY);
    for (const e of SIDES) {
      const f = e * w;
      s.box(d > 0 ? c0 + 3 : c0 + 9, d > 0 ? c1 - 9 : c1 - 3, Math.min(f, f + e * 0.15), Math.max(f, f + e * 0.15), top - 11, top - 3.5, GLASS);
      strip(s, f, d > 0 ? c1 - 7 : c0 + 7, plate + 2, d > 0 ? c1 - 7 : c0 + 7, top - 3, 0.35, darker(BR_BLUE, 0.4), 0.1);
      barZ(s, d > 0 ? c1 - 8 : c0 + 8, e * (w - 0.1), plate + 3, top - 12, 0.28, STEEL);
      step(s, d > 0 ? c1 - 6 : c0 + 6, e * (w - 0.2), plate);
    }
    const fx = d * cab;
    // the cab front above the nose: a yellow face with two windscreens and a centre pillar
    const f0 = Math.min(fx, fx + d * 0.4), f1 = Math.max(fx, fx + d * 0.4);
    s.box(f0, f1, -w + 1.2, w - 1.2, noseTop - 0.5, top - 0.6, YELLOW);
    for (const e of SIDES) {
      const ya = e * 2, yb = e * 14;
      const g0 = Math.min(fx + d * 0.4, fx + d * 0.55), g1 = Math.max(fx + d * 0.4, fx + d * 0.55);
      s.box(g0, g1, Math.min(ya, yb), Math.max(ya, yb), noseTop + 2, top - 3, GLASS);
      // the yellow wraps round onto the cab side corner
      const c = e * w;
      s.box(Math.min(fx, fx - d * 3), Math.max(fx, fx - d * 3), Math.min(c, c + e * 0.12), Math.max(c, c + e * 0.12), noseTop - 0.5, top - 0.6, YELLOW);
    }
    s.box(Math.min(fx, fx - d * 6), Math.max(fx, fx - d * 6), -w + 0.2, w - 0.2, plate, noseTop, YELLOW);
    // the nose: lower, narrower, rounded, all yellow, split headcode boxes on its front
    const n0 = Math.min(d * cab, d * (face - 1)), n1 = Math.max(d * cab, d * (face - 1));
    s.prismX([[-14, plate], [14, plate], [14, noseTop - 4], [12, noseTop - 1], [9, noseTop], [-9, noseTop], [-12, noseTop - 1], [-14, noseTop - 4]], n0, n1, YELLOW);
    const nf = d * (face - 1);
    for (const e of SIDES) {
      const ya = e * 2.5, yb = e * 11;
      s.box(Math.min(nf, nf + d * 0.2), Math.max(nf, nf + d * 0.2), Math.min(ya, yb), Math.max(ya, yb), noseTop - 9, noseTop - 3.5, BLACK);   // headcode box
      s.box(Math.min(nf, nf + d * 0.3), Math.max(nf, nf + d * 0.3), Math.min(ya, yb) + 0.6, Math.max(ya, yb) - 0.6, noseTop - 8.4, noseTop - 4.1, [0.85, 0.85, 0.82]);
      s.cyl("x", Math.min(nf, nf + d * 0.8), Math.max(nf, nf + d * 0.8), e * 9, plate + 3.5, 1.2, 1.2, STEEL);                                   // marker lamps
      // nose doors and louvres down the side
      strip(s, e * 14, d * (cab + 4), plate + 2, d * (cab + 4), noseTop - 5, 0.3, darker(YELLOW, 0.6), 0.1);
    }
    for (let z = plate + 4; z < noseTop - 11; z += 1.2) s.box(Math.min(nf, nf + d * 0.2), Math.max(nf, nf + d * 0.2), -5, 5, z, z + 0.5, darker(YELLOW, 0.55));
    s.box(Math.min(n0, n1), Math.max(n0, n1), -15, 15, plate - 0.4, plate, DARK_STEEL);
  }
  void UNDER;
}
