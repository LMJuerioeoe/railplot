// Wagons: vans, opens, minerals, tanks and brake vans, on the shared four-wheeled running gear.
import {
  BLACK, BRASS, COAL, DARK_STEEL, coal, GLASS, RGB, SIDES, STEEL, Shapes, UNDER, WHITE, barX, barZ, darker,
  headstocks, lettering, planking, step, strip, wagonGear,
} from "./parts";

const ROOF_WHITE: RGB = [0.85, 0.85, 0.82];

export interface VanSpec {
  length: number; width: number; height: number;
  bodyHalf: number; wheelbase: number; top: number; rise: number;
  body: RGB; roof?: RGB;
  /** Diagonal strapping either side of the doors (GWR), or plain (LMS). */
  diagonals?: boolean;
  /** Corrugated steel ends (LMS) instead of planked ones (GWR). */
  corrugatedEnds?: boolean;
  /** Doors along each side, as centre positions. */
  doors?: number[];
  doorWidth?: number;
  /** Shell ventilators along the roof, or louvres high on the ends. */
  shellVents?: number[];
  endVents?: boolean;
  emblem?: { x: number; z: number; r: number; col: RGB };
  marks?: { x0: number; x1: number; z: number; chars: number }[];
  wheelR?: number;
  /** Planks laid lengthways (the GWR's later vans) rather than upright. */
  horizontal?: boolean;
  /** Plywood sides: smooth, no planks. */
  plywood?: boolean;
  /** Braces from the top corners down to the foot of the door posts, rather than up to them. */
  braceDown?: boolean;
  /** Upright stanchions part way between the ends and the doors. */
  stanchions?: number[];
  /** X-braced panels between the doors: centre and half width. */
  crosses?: { x: number; half: number }[];
  /** Doors braced with an inverted V, two diagonals meeting at the top (the GWR's Bloaters). */
  doorChevron?: boolean;
}

/** A closed van: planked body, strapping, doors, ends and a white roof. */
export function drawVan(s: Shapes, p: VanSpec) {
  const half = p.length / 2, w = p.width / 2, bh = p.bodyHalf, z0 = 14.6, t = p.top;
  headstocks(s, half, UNDER, { width: w - 1.6 });
  wagonGear(s, bh, p.wheelbase, p.wheelR ?? 6.1, UNDER, w - 1.3);
  const strap = darker(p.body, 0.5);
  s.box(-bh, bh, -w + 0.6, w - 0.6, z0, t, p.body);
  for (const e of SIDES) {
    const f = e * (w - 0.6);
    if (p.plywood) { /* smooth sheets */ }
    else if (p.horizontal) planking(s, f, -bh, bh, z0, t, Math.round((t - z0) / 2.2), darker(p.body, 0.7), true);
    else planking(s, f, -bh, bh, z0, t, Math.round((2 * bh) / 4.2), darker(p.body, 0.7));
    for (const x of p.stanchions ?? []) strip(s, f, x, z0, x, t, 1.1, strap);
    strip(s, f, -bh, z0 + 0.6, bh, z0 + 0.6, 1.1, strap); strip(s, f, -bh, t - 0.6, bh, t - 0.6, 1.1, strap);   // bottom and top rails
    for (const x of [-bh + 0.6, bh - 0.6]) strip(s, f, x, z0, x, t, 1.2, strap);                              // corner pillars
    const doors = p.doors ?? [0], dw = p.doorWidth ?? 16;
    for (const c of doors) {
      strip(s, f, c - dw / 2, z0 + 0.5, c - dw / 2, t - 0.5, 1, strap); strip(s, f, c + dw / 2, z0 + 0.5, c + dw / 2, t - 0.5, 1, strap);
      strip(s, f, c, z0 + 0.5, c, t - 0.5, 0.5, strap);
      for (const z of [z0 + 4, t - 4]) strip(s, f, c - dw / 2, z, c + dw / 2, z, 0.8, strap);               // door bands
      s.box(c + 1, c + 2.6, Math.min(f, f + e * 0.6), Math.max(f, f + e * 0.6), (z0 + t) / 2 - 0.5, (z0 + t) / 2 + 0.5, DARK_STEEL);   // bolt
      if (p.doorChevron) { strip(s, f, c - dw / 2 + 1, z0 + 1, c, t - 1, 0.7, strap); strip(s, f, c + dw / 2 - 1, z0 + 1, c, t - 1, 0.7, strap); }
      else if (p.diagonals && !p.braceDown) strip(s, f, c - dw / 2 + 0.8, z0 + 1, c + dw / 2 - 0.8, t - 1, 0.7, strap);
    }
    for (const c of p.crosses ?? []) {
      strip(s, f, c.x - c.half, z0 + 1, c.x + c.half, t - 1, 0.8, strap); strip(s, f, c.x - c.half, t - 1, c.x + c.half, z0 + 1, 0.8, strap);
    }
    if (p.diagonals) {
      // diagonal braces either side of the doors, running up towards them
      const d0 = Math.min(...doors) - dw / 2, d1 = Math.max(...doors) + dw / 2;
      const [lo, hi] = p.braceDown ? [t - 1, z0 + 1] : [z0 + 1, t - 1];
      strip(s, f, -bh + 1.2, lo, d0 - 1, hi, 0.8, strap);
      strip(s, f, bh - 1.2, lo, d1 + 1, hi, 0.8, strap);
      if (!p.stanchions) {
        strip(s, f, (-bh + d0) / 2, z0 + 0.8, (-bh + d0) / 2, t - 0.8, 0.8, strap);
        strip(s, f, (bh + d1) / 2, z0 + 0.8, (bh + d1) / 2, t - 0.8, 0.8, strap);
      }
    }
  }
  for (const e of SIDES) {
    const a = e * bh, b = e * (bh + 0.7), lo = Math.min(a, b), hi = Math.max(a, b);
    s.box(lo, hi, -w + 1, w - 1, z0, t, darker(p.body, 0.85));
    if (p.corrugatedEnds) for (let z = z0 + 2; z < t - 1; z += 2.2) barY2(s, e * (bh + 0.75), z, w - 1.6, darker(p.body, 0.75));
    else for (let z = z0 + 2.2; z < t; z += 2.2) s.box(lo - 0.05, hi + 0.05, -w + 1, w - 1, z, z + 0.2, darker(p.body, 0.6));
    if (p.endVents) for (const y of [-w * 0.5, w * 0.5]) {
      s.box(lo - 0.15, hi + 0.15, y - 3.5, y + 3.5, t - 7, t - 2, darker(p.body, 0.4));
      for (let z = t - 6.6; z < t - 2; z += 1) s.box(lo - 0.25, hi + 0.25, y - 3.3, y + 3.3, z, z + 0.4, darker(p.body, 0.75));
    }
    for (const y of [-5, 0, 5]) s.box(e > 0 ? hi : lo - 0.5, e > 0 ? hi + 0.5 : lo, y - 0.4, y + 0.4, t - 4, t - 1.5, DARK_STEEL);   // lamp irons
  }
  s.roof(-bh - 0.8, bh + 0.8, w, t, p.rise, p.roof ?? ROOF_WHITE);
  for (const x of p.shellVents ?? []) { s.cyl("z", t + p.rise - 1.2, t + p.rise + 0.3, x, 0, 2.6, 2.1, darker(p.roof ?? ROOF_WHITE, 0.82)); s.dome(x, 0, t + p.rise + 0.3, 2.1, darker(p.roof ?? ROOF_WHITE, 0.82), 0.35); }
  if (p.emblem) for (const e of SIDES) {
    const f = e * (w - 0.6);
    s.cyl("y", Math.min(f, f + e * 0.4), Math.max(f, f + e * 0.4), p.emblem.x, p.emblem.z, p.emblem.r, p.emblem.r, p.emblem.col);
  }
  for (const m of p.marks ?? []) lettering(s, w - 0.6, m.x0, m.x1, m.z, 2.4, WHITE, m.chars);
}

/** A horizontal rib across an end: corrugated steel. */
function barY2(s: Shapes, x: number, z: number, half: number, col: RGB) {
  s.cyl("y", -half, half, x, z, 0.65, 0.65, col);
}

/** A seven-plank open wagon in a private owner's red, loaded with coal. */
export function drawPlankOpen(s: Shapes, p: { length: number; width: number; body: RGB; band: RGB; load: boolean }) {
  // traced from Hornby's side view: seven planks from 15.1 to 33.9 mm, a 10 ft wheelbase
  const half = p.length / 2, w = p.width / 2, bh = 35.1, z0 = 15.1, t = 33.9;
  headstocks(s, half, UNDER, { width: w - 1.4 });
  wagonGear(s, bh, 39.9, 6.1, UNDER, w - 1.2);
  const strap = BLACK;
  s.box(-bh, bh, -w + 0.4, w - 0.4, z0 - 0.4, z0 + 0.6, darker(p.body, 0.8));                    // floor
  for (const e of SIDES) {
    const a = e * (w - 0.4), b = e * (w - 1.4), f = a;
    s.box(-bh, bh, Math.min(a, b), Math.max(a, b), z0, t, p.body);                                // side, 1 mm planks
    planking(s, f, -bh, bh, z0, t, 7, darker(p.body, 0.55), true);
    for (const x of [-bh + 0.5, bh - 0.5, -10, 10]) strip(s, f, x, z0, x, t, 1.1, strap);         // corner and door stanchions
    for (const x of [-25, 25]) strip(s, f, x, z0 + 0.5, x + (x > 0 ? -6 : 6), t - 0.5, 0.8, strap);   // diagonal braces
    for (const z of [z0 + 2.5, t - 2.5]) strip(s, f, -10, z, 10, z, 0.7, strap);                  // door hinges and bands
    s.box(-bh + 3, bh - 3, Math.min(f, f + e * 0.2), Math.max(f, f + e * 0.2), z0 + 10, z0 + 15.6, p.band);   // the owner's name, on a lighter band
    lettering(s, w - 0.2, -bh + 5, bh - 5, z0 + 8.3, 2.4, WHITE, 9);
  }
  for (const e of SIDES) { const a = e * (bh - 1), b = e * bh; s.box(Math.min(a, b), Math.max(a, b), -w + 0.4, w - 0.4, z0, t, p.body); }
  if (p.load) coal(s, -bh + 1, bh - 1, w - 1.6, t - 2.5, 3.4, 3);
  else s.box(-bh + 1, bh - 1, -w + 1.5, w - 1.5, z0 + 0.6, z0 + 0.8, darker(p.body, 0.5));
}

/** A BR 16 ton steel mineral wagon: pressed steel sides with ribs, side and top doors, end door. */
export function drawMineral(s: Shapes, p: { length: number; width: number; body: RGB; load: boolean }) {
  // traced from Accurascale's drawing: sides 35.4 mm high, pressed stanchions only at the ends and the door
  const half = p.length / 2, w = p.width / 2, bh = 35, z0 = 15.2, t = 35.4;
  headstocks(s, half, UNDER, { width: w - 1.4 });
  wagonGear(s, bh, 36.9, 6.4, UNDER, w - 1.2);
  const rib = darker(p.body, 0.7);
  for (const e of SIDES) {
    const a = e * (w - 0.4), b = e * (w - 1.2), f = a;
    s.box(-bh, bh, Math.min(a, b), Math.max(a, b), z0, t, p.body);
    for (const x of [-bh + 1, -bh + 2.6, -9, 9, bh - 2.6, bh - 1]) strip(s, f, x, z0, x, t, 0.9, rib, 0.4);   // pressed stanchions
    strip(s, f, -bh, t - 0.5, bh, t - 0.5, 1, rib, 0.4);                                              // top rim
    strip(s, f, -9, z0 + 1, 9, z0 + 1, 0.6, rib, 0.45); strip(s, f, -9, t - 4, 9, t - 4, 0.6, rib, 0.45);       // side door and top flap
    for (const x of [-4.5, 4.5]) strip(s, f, x, z0 + 1.5, x, t - 5, 0.4, rib, 0.3);
    s.box(-2, 2, Math.min(f, f + e * 0.8), Math.max(f, f + e * 0.8), z0 + 1.5, z0 + 3, DARK_STEEL);
    lettering(s, w - 0.3, -bh + 3, -12, z0 + 3, 1.6, WHITE, 5);
  }
  for (const e of SIDES) { const a = e * (bh - 0.9), b = e * bh; s.box(Math.min(a, b), Math.max(a, b), -w + 0.4, w - 0.4, z0, t, p.body); }
  s.box(-bh + 1, bh - 1, -w + 1.2, w - 1.2, z0, z0 + 0.6, darker(p.body, 0.45));
  if (p.load) coal(s, -bh + 1, bh - 1, w - 1.6, t - 2.2, 3, 5);
}

/** A 14 ton tank wagon: barrel on cradles, dome with its lid, ladders and tie bars. */
export function drawTankWagon(s: Shapes, p: { length: number; width: number; body: RGB; bands?: RGB; bodyHalf?: number; r?: number; wheelbase?: number; wheelR?: number }) {
  const half = p.length / 2, w = p.width / 2, bh = p.bodyHalf ?? 36, z0 = 14.6, r = p.r ?? 12, zc = z0 + r + 1.2;
  headstocks(s, half, UNDER, { width: w - 1.4 });
  wagonGear(s, bh, p.wheelbase ?? 40, p.wheelR ?? 6.1, UNDER, w - 1.2);
  for (const x of [-bh * 0.6, bh * 0.6]) s.prismX([[-r * 0.85, z0], [r * 0.85, z0], [r * 0.75, z0 + 4], [-r * 0.75, z0 + 4]], x - 1.5, x + 1.5, UNDER);   // cradles
  s.cyl("x", -bh + 2.5, bh - 2.5, 0, zc, r, r, p.body, false);
  // the barrel ends, as squashed domes turned outward: drawn as discs with a rounded rim
  for (const e of SIDES) s.dish("x", e * (bh - 2.5), e, 0, zc, r, 2.6, p.body);                    // dished barrel ends
  for (const x of [-bh + 6, -12, 12, bh - 6]) s.ring("x", x - 0.4, x + 0.4, 0, zc, r + 0.3, r - 0.2, p.bands ?? darker(p.body, 0.7));
  s.cyl("z", zc + r - 1, zc + r + 3.6, 0, 0, 4.6, 4.2, p.body);                                     // dome
  s.cyl("z", zc + r + 3.6, zc + r + 4.4, 0, 0, 4.9, 4.9, darker(p.body, 0.8));
  barZ(s, 2.5, 2.5, zc + r + 4.4, zc + r + 5.6, 0.6, BRASS);                                        // valve
  for (const e of SIDES) {
    // ladder up the side to the dome, a walkway rail
    const y = e * (r + 0.6);
    for (const x of [-4, 0]) s.beam(x, z0 + 1, x + 2.5, zc + r - 2, Math.min(y, y + e * 0.4), Math.max(y, y + e * 0.4), 0.4, STEEL);
    for (let z = z0 + 3; z < zc + r - 3; z += 2.5) s.beam(-4 + ((z - z0 - 1) / (zc + r - 3 - z0)) * 2.5, z, ((z - z0 - 1) / (zc + r - 3 - z0)) * 2.5, z, Math.min(y, y + e * 0.4), Math.max(y, y + e * 0.4), 0.35, STEEL);
    // end stanchions up to the barrel's waist, and the tie rods running from their tops down to the middle of the underframe
    const ya = e * (w - 1.6), yb = e * (w - 0.9), zt = zc + 1;
    for (const d of SIDES) {
      s.box(d * (bh + 0.2) - 0.6, d * (bh + 0.2) + 0.6, Math.min(ya, yb), Math.max(ya, yb), z0 - 1, zt, UNDER);
      s.beam(d * (bh + 0.2), zt, 0, 5, Math.min(ya, yb), Math.max(ya, yb), 0.5, UNDER);
    }
    s.beam(-bh, zt - 0.3, bh, zt - 0.3, Math.min(e * (r + 0.2), e * (r + 0.7)), Math.max(e * (r + 0.2), e * (r + 0.7)), 0.4, UNDER);   // the band round the barrel's waist
    lettering(s, r - 0.5, -bh + 10, -10, zc - 2, 2.4, WHITE, 6);
  }
}

/** The BR standard 20 ton brake van: a body with a verandah at each end, end platforms and duckets. */
export function drawBRBrakeVan(s: Shapes, p: { length: number; width: number; body: RGB }) {
  // traced from Bachmann's side view: the body with its verandahs 65 mm long, a 63 mm wheelbase,
  // the long end platforms bare, the verandahs open above the platform
  const half = p.length / 2, w = p.width / 2, z0 = 15.8, t = 43.3, face = half - 5.5;
  headstocks(s, half, UNDER, { width: w - 1.4 });
  wagonGear(s, face - 1, 63, 6.2, UNDER, w - 1.2);
  const strap = darker(p.body, 0.55);
  s.box(-face + 1, face - 1, -w + 1, w - 1, z0 - 4.6, z0 - 0.4, UNDER);                           // deep solebars
  s.box(-face + 1, face - 1, -w + 1, w - 1, z0 - 0.4, z0 + 1.4, darker(p.body, 0.8));               // the long platform
  const b0 = -32.5, b1 = 32.5, v = 12;
  s.box(b0 + v, b1 - v, -w + 0.6, w - 0.6, z0, t, p.body);
  for (const e of SIDES) {
    const f = e * (w - 0.6);
    planking(s, f, b0 + v, b1 - v, z0, t, 16, darker(p.body, 0.72));
    // the ducket: a bay window standing out from the side, glazed at front and back
    s.prismY([[-6.3, z0 + 6.7], [5.5, z0 + 6.7], [5.5, 37.4], [-6.3, 37.4]], Math.min(f, f + e * 1.05), Math.max(f, f + e * 1.05), p.body);
    s.prismY([[-4.8, z0 + 8.5], [4, z0 + 8.5], [3, 35.5], [-3.8, 35.5]], Math.min(f + e * 1.05, f + e * 1.2), Math.max(f + e * 1.05, f + e * 1.2), darker(p.body, 0.85));
    for (const x of [-5.8, 5]) s.box(x - 0.5, x + 0.5, Math.min(f + e * 0.3, f + e * 1.1), Math.max(f + e * 0.3, f + e * 1.1), 30, 35, GLASS);
    strip(s, f, b0 + v, t - 1, b1 - v, t - 1, 0.8, strap);
    for (const x of [b0 + v + 0.6, b1 - v - 0.6]) s.box(x - 0.6, x + 0.6, Math.min(f, f + e * 0.3), Math.max(f, f + e * 0.3), z0, t - 1, strap);
    // white handrails: along the side below the ducket, up beside the verandah doors
    barX(s, b0 + v, b1 - v, e * (w + 0.1), 21.7, 0.35, WHITE);
    for (const x of [b0 + v + 0.3, b1 - v - 0.3]) barZ(s, x, e * (w + 0.1), z0 - 1, 33, 0.35, WHITE);
    for (const [x0, x1] of [[b0, b0 + v], [b1 - v, b1]]) {
      // verandah: corner posts carrying the roof, a low kerb
      const xo = x0 === b0 ? b0 : b1 - 1.2;
      s.box(xo, xo + 1.2, Math.min(f, f - e * 1.2), Math.max(f, f - e * 1.2), z0, t, p.body);
      s.box(x0, x1, Math.min(f, f - e * 0.8), Math.max(f, f - e * 0.8), z0, z0 + 1.6, p.body);
      barZ(s, x0 === b0 ? b0 + 1.6 : b1 - 1.6, e * (w - 0.2), z0 + 2, t - 3, 0.3, WHITE);
    }
    for (const x of [-face + 4, face - 4]) step(s, x, e * (w - 0.2), z0 - 4.8);
    lettering(s, w - 0.4, b0 + v + 2, b1 - v - 2, z0 + 3, 2, WHITE, 5);
  }
  // the verandahs' inner ends: the cabin's end walls with their doors
  for (const x of [b0 + v, b1 - v]) s.box(x - 0.4, x + 0.4, -w + 0.6, w - 0.6, z0, t, darker(p.body, 0.9));
  // low sandboxes on the end platforms
  for (const e of SIDES) s.box(Math.min(e * (b1 + 2), e * (face - 4)), Math.max(e * (b1 + 2), e * (face - 4)), -w + 3, w - 3, z0 + 1.4, z0 + 2.8, p.body);
  s.roof(b0 - 0.5, b1 + 0.5, w, t, 2.8, [0.55, 0.57, 0.58]);
  barZ(s, -12, -6, t + 1.8, t + 5.6, 0.9, BLACK);
}

/** The GWR Toad: a long closed body with one verandah, at the tail. */
export function drawToad(s: Shapes, p: { length: number; width: number; body: RGB; roof: RGB }) {
  // traced from Oxford Rail's side view: a 57.7 mm wheelbase, the body 43.4 mm to the eaves,
  // planked lengthways, and the verandah boarded up to waist height
  const half = p.length / 2, w = p.width / 2, z0 = 16.5, t = 43.4, face = half - 5.5;
  headstocks(s, half, UNDER, { width: w - 1.4 });
  wagonGear(s, face - 1, 57.7, 6.3, UNDER, w - 1.2);
  const strap = darker(p.body, 0.72);
  const v0 = -face + 1, v1 = -15.1, waist = 30.9;                                                    // verandah at the back
  s.box(-face + 1, face - 1, -w + 1, w - 1, z0 - 4, z0 + 0.6, UNDER);                               // solebars and floor
  s.box(v1, face - 1, -w + 0.6, w - 0.6, z0, t, p.body);
  for (const e of SIDES) {
    const f = e * (w - 0.6);
    planking(s, f, v1, face - 1, z0, t, 12, darker(p.body, 0.8), true);
    for (const x of [v1 + 0.6, 0.4, 15.8, 30.9, face - 1.6]) strip(s, f, x, z0, x, t, 1.1, strap);
    // white handrails framing the lower panels
    for (const z of [18.4, 25.7]) barX(s, v1 + 1, face - 2.5, e * (w + 0.1), z, 0.35, WHITE);
    for (const x of [v1 + 1, face - 2.5]) barZ(s, x, e * (w + 0.1), 18.4, 25.7, 0.35, WHITE);
    // verandah: boarded to the waist, open above, the corner post up to the roof
    s.box(v0, v1, Math.min(f, f - e * 0.8), Math.max(f, f - e * 0.8), z0, waist, p.body);
    planking(s, f, v0, v1, z0, waist, 6, darker(p.body, 0.8), true);
    s.box(v0, v0 + 1.6, Math.min(f, f - e * 1.4), Math.max(f, f - e * 1.4), z0, t, p.body);
    barX(s, v0 + 2, v1 - 1, e * (w + 0.1), 25.7, 0.35, WHITE); barX(s, v0 + 2, v1 - 1, e * (w + 0.1), 18.4, 0.35, WHITE);
    for (const x of [v0 + 2, v1 - 1]) barZ(s, x, e * (w + 0.1), 18.4, 25.7, 0.35, WHITE);
    step(s, v0 + 5, e * (w - 0.3), z0 - 4.4);
  }
  s.box(v0, v0 + 0.8, -w + 0.6, w - 0.6, z0, waist, p.body);
  barY3(s, v0 + 0.4, waist + 2, w - 1);
  s.box(v1 - 0.6, v1, -6, 6, z0 + 0.6, t - 4, darker(p.body, 0.8));                                // the door into the body
  s.box(v1 + 0.5, v1 + 6, w - 7, w - 1.5, waist - 1, waist, darker(p.body, 0.7));                  // the hand brake's column top
  s.roof(v0 - 0.6, face - 0.4, w, t, 4.4, p.roof);
  barZ(s, 23.9, 5, t + 3.6, t + 7, 0.9, BLACK);                                                   // stove chimney
}

function barY3(s: Shapes, x: number, z: number, half: number) { s.cyl("y", -half, half, x, z, 0.35, 0.35, WHITE); }

export { STEEL };
