// Diesel locomotives: the BR Class 08 shunter and the Class 37.
import { BLACK, DARK_STEEL, GLASS, RGB, SIDES, STEEL, Shapes, UNDER, WHEEL_FACE, YELLOW, barX, barZ, darker, discWheels, headstocks, step, strip } from "./parts";
import { bogie } from "./coaches";

const BR_GREEN: RGB = [0.11, 0.3, 0.19], BR_BLUE: RGB = [0.17, 0.3, 0.47], ROOF_GREY: RGB = [0.42, 0.43, 0.44];

/** A body cross-section: straight sides, rounded shoulders of radius r, a flat top. */
function shoulders(half: number, z0: number, top: number, r: number): [number, number][] {
  const out: [number, number][] = [[-half, z0], [half, z0]];
  for (let k = 0; k <= 5; k++) { const t = (k / 5) * (Math.PI / 2); out.push([half - r + Math.cos(t) * r, top - r + Math.sin(t) * r]); }
  for (let k = 0; k <= 5; k++) { const t = Math.PI / 2 + (k / 5) * (Math.PI / 2); out.push([-half + r + Math.cos(t) * r, top - r + Math.sin(t) * r]); }
  return out;
}

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
  // traced from Hornby's side view of D3760: the plate 18.3 mm up, the bonnet nearly as tall as the cab
  const half = 58.5, w = 17, plate = 18.3;
  const face = headstocks(s, half, BLACK, { z0: 10.5, z1: 17.5, width: 15.5 });
  for (const e of SIDES) wasp(s, e * face, e, -15.5, 15.5, 10.5, 17.5);
  s.box(-face, face, -w, w, 17.5, plate - 0.7, BLACK);
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
  const bx0 = -29, bx1 = 49.5, bt = 48.5, bw = 12.6;
  s.prismX(shoulders(bw, plate, bt, 4), bx0, bx1, BR_GREEN, true);
  // the wider boxes low on the bonnet sides: batteries and tool lockers, and the air tank cabinet behind the cab
  s.box(-4.2, 37.8, -w + 1.2, w - 1.2, plate, 25.5, BR_GREEN);
  s.box(bx0, -19.4, -w + 1.2, w - 1.2, plate, 35, BR_GREEN);
  // the front plate ahead of the radiator
  s.box(bx1, face - 0.5, -w, w, plate - 0.7, plate, BLACK);
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
    // the side: the door at the back with its drop light, a window ahead of it
    const sill = 31.4, top = 40.1;
    s.box(cx0, cx1, lo, hi, plate, sill, BR_GREEN);
    s.box(cx0, cx1, lo, hi, top, ct, BR_GREEN);
    for (const [x0, x1] of [[cx0, -45.5], [-41.4, -38], [-31.8, cx1]]) s.box(x0, x1, lo, hi, sill, top, BR_GREEN);
    for (const [x0, x1] of [[-45.5, -41.4], [-38, -31.8]]) s.box(x0, x1, Math.min(out, out - e * 0.3), Math.max(out, out - e * 0.3), sill, top, GLASS);
    strip(s, out, -47, plate + 0.5, -47, top + 1, 0.3, darker(BR_GREEN, 0.5)); strip(s, out, -40, plate + 0.5, -40, top + 1, 0.3, darker(BR_GREEN, 0.5));   // door edges
    barZ(s, cx1 - 1, e * (w - 0.3), plate + 2, 37, 0.28, STEEL);
    step(s, cx1 - 2.5, e * (w - 0.2), plate - 0.6);
  }
  for (const [x, d] of [[cx1, 1], [cx0, -1]] as const) {
    s.box(Math.min(x, x - d * 0.8), Math.max(x, x - d * 0.8), -w, w, plate, ct, BR_GREEN);
    for (const e of SIDES) s.box(Math.min(x, x + d * 0.12), Math.max(x, x + d * 0.12), Math.min(e * 3, e * 14), Math.max(e * 3, e * 14), 33, 41.5, GLASS);
  }
  s.box(cx0 + 1, cx1 - 1, -w + 1, w - 1, plate, ct - 1, [0.1, 0.11, 0.1]);
  s.roof(cx0 - 0.6, cx1 + 0.6, w + 0.2, ct, 2.4, ROOF_GREY);
  // the BR emblem on the bonnet side, and a number on the cab

}

/** BR Class 37 Co-Co diesel-electric, BR blue with full yellow ends: two noses, two cabs, the engine room between. */
export function drawClass37(s: Shapes) {
  // traced from Bachmann's side view of 37305: the body comes down to 12 mm, bogie centres 145 mm apart,
  // cab fronts at ±94.4 mm with the noses ahead of them
  const half = 122.5, w = 17.5, plate = 12;
  const face = headstocks(s, half, BLACK, { z0: 9.4, z1: 17, width: 16 });
  // underframe, fuel tank, battery boxes
  s.box(-face + 1, face - 1, -w + 0.6, w - 0.6, plate - 2, plate, BLACK);
  s.box(-33.6, 38.2, -12, 12, 3, plate - 0.5, darker(BLACK, 1.3));
  for (const x of [-20, 2, 24]) s.box(x - 0.3, x + 0.3, -12.2, 12.2, 3, plate - 0.5, BLACK);
  for (const c of [72.6, -72.6]) {
    bogie(s, c, 27, 7.1, plate - 2, BLACK, true);
    discWheels(s, c, 7.1);
  }
  // body: engine room between the cabs, cabs, noses
  const cab = 94.4, room = 73.6, top = 42.7, noseTop = 38.5, rise = 7.7;
  const profile = (t: number): [number, number][] => shoulders(w, plate, t, 3.5);
  s.prismX(profile(top), -room, room, BR_BLUE, true);
  s.roof(-room, room, w - 0.3, top, rise, BR_BLUE);
  for (const e of SIDES) {
    const f = e * w;
    // engine room grilles and doors, the BR arrow, the number
    for (const x of [-59.6, -20, 20, 59.6]) { s.box(x - 9.6, x + 9.6, Math.min(f, f + e * 0.15), Math.max(f, f + e * 0.15), 22, 37, darker(BR_BLUE, 0.75)); for (let x2 = x - 9; x2 < x + 9.6; x2 += 1.2) strip(s, f, x2, 22.5, x2, 36.5, 0.35, darker(BR_BLUE, 0.45), 0.22); }
    for (const x of [-45, 40]) { strip(s, f, x, plate + 2, x, top - 3, 0.3, darker(BR_BLUE, 0.5), 0.1); strip(s, f, x + 9, plate + 2, x + 9, top - 3, 0.3, darker(BR_BLUE, 0.5), 0.1); }

    barX(s, -room + 2, room - 2, e * (w - 0.1), plate + 3, 0.3, STEEL);
  }
  for (const d of [1, -1]) {
    const c0 = Math.min(d * room, d * cab), c1 = Math.max(d * room, d * cab);
    // the cab: full height, side windows and a door, yellow front with two windscreens
    s.prismX(profile(top), c0, c1, BR_BLUE, true);
    s.roof(c0, c1, w - 0.3, top, rise, BR_BLUE);
    for (const e of SIDES) {
      const f = e * w;
      s.box(d > 0 ? c0 + 9 : c0 + 1.5, d > 0 ? c1 - 1.5 : c1 - 9, Math.min(f, f + e * 0.15), Math.max(f, f + e * 0.15), 33, 41.5, GLASS);
      strip(s, f, d > 0 ? c1 - 7 : c0 + 7, plate + 2, d > 0 ? c1 - 7 : c0 + 7, top - 3, 0.35, darker(BR_BLUE, 0.4), 0.1);
      barZ(s, d > 0 ? c1 - 8 : c0 + 8, e * (w - 0.1), plate + 3, top - 12, 0.28, STEEL);
      step(s, d > 0 ? c1 - 6 : c0 + 6, e * (w - 0.2), plate);
    }
    const fx = d * cab;
    // the cab front above the nose: a yellow face with two windscreens and a centre pillar
    const f0 = Math.min(fx, fx + d * 0.4), f1 = Math.max(fx, fx + d * 0.4);
    s.box(f0, f1, -w + 1.2, w - 1.2, noseTop - 0.5, top + rise - 1.5, YELLOW);
    for (const e of SIDES) {
      const ya = e * 2, yb = e * 14;
      const g0 = Math.min(fx + d * 0.4, fx + d * 0.55), g1 = Math.max(fx + d * 0.4, fx + d * 0.55);
      s.box(g0, g1, Math.min(ya, yb), Math.max(ya, yb), noseTop + 2, top + 2, GLASS);
      // the yellow wraps round onto the cab side corner
      const c = e * w;
      s.box(Math.min(fx, fx - d * 1.5), Math.max(fx, fx - d * 1.5), Math.min(c, c + e * 0.12), Math.max(c, c + e * 0.12), noseTop - 0.5, top - 0.6, BR_BLUE);
    }
    s.box(Math.min(fx, fx - d * 6), Math.max(fx, fx - d * 6), -w + 0.2, w - 0.2, plate, noseTop, YELLOW);
    // the nose: lower, narrower, rounded, all yellow, split headcode boxes on its front
    const n0 = Math.min(d * cab, d * (face - 1)), n1 = Math.max(d * cab, d * (face - 1));
    s.prismX(shoulders(14, plate, noseTop, 5), n0, n1, YELLOW, true);
    // the nose's front edge is rounded too: a curved fairing round its top
    s.cyl("y", -9, 9, d > 0 ? n1 - 2.5 : n0 + 2.5, noseTop - 2.5, 2.5, 2.5, YELLOW);
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
