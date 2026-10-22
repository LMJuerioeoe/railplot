// European rolling stock at H0 scale (1:87): electric locomotives with their cab fronts, roof gear and
// pantographs, the DB class 218 diesel, and a bogie open wagon. Steam, coaches, vans and tank wagons
// use the shared builders.
import {
  BLACK, DARK_STEEL, GLASS, RGB, SIDES, STEEL, Shapes, UNDER, WHITE, barX, barZ, coal, darker, discWheels,
  headstocks, lettering, pane, step, strip,
} from "./parts";
import { bogie } from "./coaches";

const ROOF_GREY: RGB = [0.45, 0.46, 0.46];

/** A body cross-section: straight sides, rounded shoulders of radius r, a flat top. */
function section(half: number, z0: number, top: number, r: number): [number, number][] {
  const out: [number, number][] = [[-half, z0], [half, z0]];
  for (let k = 0; k <= 5; k++) { const t = (k / 5) * (Math.PI / 2); out.push([half - r + Math.cos(t) * r, top - r + Math.sin(t) * r]); }
  for (let k = 0; k <= 5; k++) { const t = Math.PI / 2 + (k / 5) * (Math.PI / 2); out.push([-half + r + Math.cos(t) * r, top - r + Math.sin(t) * r]); }
  return out;
}

/**
 * A pantograph, folded down on its insulators on the roof at x: a diamond (two pairs of arms meeting
 * at the head) or a single arm (one knuckle), with the pan head across the top.
 */
export function pantograph(s: Shapes, x: number, roof: number, kind: "diamond" | "single", dir = 1) {
  const z0 = roof + 2.4, zh = roof + 4.2;
  for (const y of [-5.5, 5.5]) for (const dx of [-5, 5]) { barZ(s, x + dx, y, roof, z0 - 0.6, 0.9, [0.7, 0.62, 0.45]); s.cyl("z", z0 - 0.6, z0, x + dx, y, 1.1, 1.1, DARK_STEEL); }   // insulators
  s.box(x - 6, x + 6, -6.2, 6.2, z0, z0 + 0.5, DARK_STEEL);                                       // base frame
  if (kind === "diamond") {
    for (const y of [-4.5, 4.5]) {
      s.beam(x - 6.5, z0 + 0.5, x, zh, y - 0.3, y + 0.3, 0.45, DARK_STEEL);
      s.beam(x + 6.5, z0 + 0.5, x, zh, y - 0.3, y + 0.3, 0.45, DARK_STEEL);
      s.beam(x - 6.5, z0 + 0.8, x + 6.5, z0 + 0.8, y - 0.25, y + 0.25, 0.35, DARK_STEEL);
    }
  } else {
    const knee = x + dir * 9, foot = x - dir * 5;
    for (const y of [-2.5, 2.5]) s.beam(foot, z0 + 0.6, knee, z0 + 1.4, y - 0.3, y + 0.3, 0.6, DARK_STEEL);
    s.beam(knee, z0 + 1.4, x, zh, -0.3, 0.3, 0.45, DARK_STEEL);
  }
  // the pan head: a bow across the roof with its contact strips
  s.box(x - 1.4, x + 1.4, -8.5, 8.5, zh, zh + 0.5, DARK_STEEL);
  s.box(x - 1.2, x + 1.2, -7, 7, zh + 0.5, zh + 0.8, [0.75, 0.6, 0.35]);
  for (const e of SIDES) s.beam(x - 1.4, zh + 0.2, x + 1.4, zh + 0.2, Math.min(e * 8.5, e * 9.6), Math.max(e * 8.5, e * 9.6), 0.5, DARK_STEEL);   // the horns
}

export interface ElectricSpec {
  length: number; width: number; height: number;
  /** Bottom of the body (top of the frame), and the roof's eaves. */
  floor: number; eave: number; roofRise: number;
  /** Where each cab's back wall stands, from the middle. */
  cabBack: number;
  /** The front in side view, from the buffer beam up: how far back each point stands from the face, and how high. */
  front: [number, number][];
  bogies: { centre: number; wheelbase: number; r: number; axles: 2 | 3 };
  pantographs: { x: number; kind: "diamond" | "single" }[];
  livery: { body: RGB; roof: RGB; frames: RGB; beams?: RGB; apron?: RGB; band?: { z0: number; z1: number; col: RGB }; lamps?: RGB; stripe?: { z: number; col: RGB } };
  /** Continuous fan grilles along both edges of the roof (ÖBB 1044's Klatte grilles). */
  roofGrilles?: boolean;
  /** An emblem on each side, in the middle: a white disc standing in for the railway's logo. */
  emblem?: RGB;
  /** A front made of several shapes stacked up it (nose, windscreen, brow), each from its bottom to its top. */
  frontParts?: [number, number][][];
  /** Which stretch of which part is the windscreen. */
  screen?: { part: number; seg: number };
  /** Heights of the low headlights and of the top one. */
  lampZ?: number; topLampZ?: number;
  /** Small fixed windows along the machine room, at these positions. */
  sideWindows?: number[];
  /** Round the cab front's corners in plan, with this radius (the ČSD "Bardotka"). */
  cornerR?: number;
  /** A diesel-electric on the same kind of body: radiator fans and exhausts on the roof instead of pantographs. */
  diesel?: { fans: number[]; exhausts: number[] };
  /** Side windows of the cab and grilles of the machine room. */
  cabWindow: [number, number, number, number];
  grilles: number[];
}

/** An electric locomotive: a cab at each end with a sloping or upright front, the machine room between. */
export function drawElectric(s: Shapes, p: ElectricSpec) {
  const half = p.length / 2, w = p.width / 2, L = p.livery;
  const face = headstocks(s, half, L.beams ?? L.frames, { z0: p.floor - 8, z1: p.floor - 1, width: w - 2.5 });
  // frame and skirt along the sides, a cowcatcher-like apron under each end
  s.box(-face, face, -w + 0.6, w - 0.6, p.floor - 2.4, p.floor, L.frames);
  for (const e of SIDES) {
    const a = e * (face - 0.6), b = e * (face - 8);
    s.prismY([[Math.min(a, b), p.floor - 8], [Math.max(a, b), p.floor - 8], [Math.max(a, b), p.floor - 1], [Math.min(a, b), p.floor - 1]], -w + 2, w - 2, L.apron ?? L.frames);
  }
  // bogies, with the middle axle of a Co bogie
  const B = p.bogies;
  for (const c of [B.centre, -B.centre]) {
    bogie(s, c, B.axles === 3 ? B.wheelbase : B.wheelbase, B.r, p.floor - 2.4, L.frames);
    if (B.axles === 3) discWheels(s, c, B.r);
  }
  // the machine room between the cabs: rounded shoulders, grilles, a roof with its gear
  const cb = p.cabBack, top = p.eave;
  s.prismX(section(w, p.floor, top, 2.6), -cb, cb, L.body, true);
  s.roof(-cb, cb, w - 1.6, top, p.roofRise, L.roof);
  for (const e of SIDES) {
    const f = e * w;
    for (const x of p.grilles) {
      s.box(x - 7, x + 7, Math.min(f, f + e * 0.12), Math.max(f, f + e * 0.12), top - 12, top - 4, darker(L.body, 0.55));
      for (let z = top - 11.5; z < top - 4; z += 0.9) strip(s, f, x - 6.6, z, x + 6.6, z, 0.35, darker(L.body, 0.3), 0.18);
    }
    const bandEnd = face - 0.6 - (p.cornerR ?? 0) - p.front[1][0];
    if (L.band) s.box(-bandEnd, bandEnd, Math.min(f, f + e * 0.1), Math.max(f, f + e * 0.1), L.band.z0, L.band.z1, L.band.col);
    if (p.emblem) s.cyl("y", Math.min(f, f + e * 0.3), Math.max(f, f + e * 0.3), 0, (p.floor + top) / 2 + 2, 3.2, 3.2, p.emblem);
    if (L.stripe) strip(s, f, -face, L.stripe.z, face, L.stripe.z, 0.7, L.stripe.col, 0.15);
    lettering(s, w, -8, 8, p.floor + 6, 2.2, WHITE, 6);
  }
  if (p.roofGrilles) for (const e of SIDES) {
    // a long louvred grille along each roof shoulder
    const rw = w - 1.6, u0 = (w - 5.2) / rw, u1 = (w - 2) / rw, z = (u: number) => top + p.roofRise * (1 - u * u);
    s.prismX([[e * (w - 5.2), z(u0) - 0.4], [e * (w - 2), z(u1) - 0.4], [e * (w - 2), z(u1) + 0.35], [e * (w - 5.2), z(u0) + 0.35]].map(([y, zz]) => [y, zz] as [number, number]), -cb + 4, cb - 4, darker(L.roof, 0.45));
    for (let x = -cb + 4.6; x < cb - 4.6; x += 1.3) s.box(x - 0.18, x + 0.18, Math.min(e * (w - 5), e * (w - 2.2)), Math.max(e * (w - 5), e * (w - 2.2)), (z(u0) + z(u1)) / 2 - 0.1, (z(u0) + z(u1)) / 2 + 0.55, darker(L.roof, 0.85));
  }
  if (p.diesel) {
    // radiator fans under round grilles, exhaust stacks
    const rz = top + p.roofRise - 0.5;
    for (const x of p.diesel.fans) { s.cyl("z", rz, rz + 0.9, x, 0, 5.2, 5.2, darker(L.roof, 0.8)); for (let k = -4; k <= 4; k += 1.3) s.box(x + k - 0.2, x + k + 0.2, -4.6, 4.6, rz + 0.9, rz + 1.1, darker(L.roof, 0.5)); }
    for (const x of p.diesel.exhausts) { s.cyl("z", rz, rz + 1.4, x, 0, 2, 1.7, DARK_STEEL); s.cyl("z", rz + 1.3, rz + 1.5, x, 0, 1.5, 1.5, BLACK); }
  } else {
    // roof gear: a main switch, cables along the roof
    barX(s, -cb + 6, cb - 6, 3, top + p.roofRise + 0.4, 0.35, DARK_STEEL);
    s.box(-4, 4, -3, 3, top + p.roofRise - 0.3, top + p.roofRise + 1.6, DARK_STEEL);
  }
  for (const pg of p.pantographs) pantograph(s, pg.x, top + p.roofRise - 0.4, pg.kind, Math.sign(pg.x) || 1);
  // the two cabs
  // the front may be several stacked shapes (a bulging nose, a recessed windscreen, an overhanging brow),
  // each a run of (back from the face, height) points from its bottom to its top
  const parts = p.frontParts ?? [p.front];
  const allPts = parts.flat();
  for (const d of [1, -1]) {
    const xf = d * (face - 0.6), xb = d * cb, cr = p.cornerR ?? 0;
    const at = (pt: [number, number]): [number, number] => [xf - d * pt[0], pt[1]];
    for (const part of parts) {
      const prof = part.map(at), z0 = prof[0][1], zN = prof[prof.length - 1][1];
      if (cr > 0) {
        // the front across the middle, the sides stopping short of it, and a vertical curve joining them
        s.prismY([[xb, z0], ...prof, [xb, zN]], -w + cr, w - cr, L.body);
        s.prismY([[xb, z0], ...prof.map(([x, z]) => [x - d * cr, z] as [number, number]), [xb, zN]], -w + 0.3, w - 0.3, L.body);
        const xAt = (z: number) => { for (let i = 0; i + 1 < prof.length; i++) { const [xa, za] = prof[i], [xc, zc] = prof[i + 1]; if (z >= za && z <= zc) return xa + ((xc - xa) * (z - za)) / (zc - za || 1); } return prof[prof.length - 1][0]; };
        for (let z = z0; z < zN - 0.01; z += 0.4) {
          const z1 = Math.min(zN, z + 0.4), xm = xAt((z + z1) / 2) - d * cr;
          for (const e of SIDES) s.cyl("z", z, z1, xm, e * (w - cr), cr, cr, L.body, false);
        }
      } else s.prismY([[xb, z0], ...prof, [xb, zN]], -w + 0.3, w - 0.3, L.body);
    }
    // the cab's roof, carried over to where the front leans back
    const roofEnd = xf - d * Math.max(...allPts.filter(([, z]) => z >= top - 0.5).map(([b]) => b), 0);
    s.roof(Math.min(xb, roofEnd), Math.max(xb, roofEnd), w - 1.6, top, p.roofRise, L.roof);
    // the windscreen: a given stretch of the front, or the longest one above the buffer beam
    let sp = 0, best = parts[0].length - 2;
    if (p.screen) { sp = p.screen.part; best = p.screen.seg; }
    else {
      let bl = 0;
      parts.forEach((part, pi) => { for (let i = 0; i + 1 < part.length; i++) { const [b0, z0] = part[i], [b1, z1] = part[i + 1]; if (z0 < p.floor + 8) continue; const l = Math.hypot(b1 - b0, z1 - z0); if (l > bl) { bl = l; best = i; sp = pi; } } });
    }
    const [ga, gb] = [parts[sp][best], parts[sp][best + 1]].map(at), gz0 = ga[1] + 0.8, gz1 = gb[1] - 0.8;
    const gx = (z: number) => ga[0] + ((gb[0] - ga[0]) * (z - ga[1])) / (gb[1] - ga[1] || 1);
    for (const e of SIDES) {
      const ya = e * 1, yb = e * (w - Math.max(2.5, cr + 0.8));
      s.beam(gx(gz0) + d * 0.25, gz0, gx(gz1) + d * 0.25, gz1, Math.min(ya, yb), Math.max(ya, yb), 0.3, GLASS);
    }
    // headlights: two low, one high; tail lights beside them
    const frontAt = (z: number) => {
      let x = xb;
      for (const part of parts) for (let i = 0; i + 1 < part.length; i++) {
        const [pa, pb] = [at(part[i]), at(part[i + 1])];
        if (z >= pa[1] && z <= pb[1]) { const xx = pa[0] + ((pb[0] - pa[0]) * (z - pa[1])) / (pb[1] - pa[1] || 1); if (d * xx > d * x) x = xx; }
      }
      return x;
    };
    const lz = p.lampZ ?? p.floor + 3.5, fx = frontAt(lz), ly = w - Math.max(5, cr + 2.5);
    for (const y of [-ly, ly]) {
      s.cyl("x", Math.min(fx - d * 0.3, fx + d * 0.7), Math.max(fx - d * 0.3, fx + d * 0.7), y, lz, 1.5, 1.5, L.lamps ?? [0.92, 0.92, 0.82]);
      s.ring("x", Math.min(fx - d * 0.3, fx + d * 0.8), Math.max(fx - d * 0.3, fx + d * 0.8), y, lz, 1.9, 1.5, darker(L.body, 0.6));
      s.cyl("x", Math.min(fx - d * 0.3, fx + d * 0.5), Math.max(fx - d * 0.3, fx + d * 0.5), y * 0.66, lz, 0.9, 0.9, [0.55, 0.1, 0.08]);
    }
    const tz = p.topLampZ ?? gb[1] - 0.3, tx = frontAt(tz);
    s.cyl("x", Math.min(tx - d * 0.3, tx + d * 0.6), Math.max(tx - d * 0.3, tx + d * 0.6), 0, tz, 1.2, 1.2, L.lamps ?? [0.92, 0.92, 0.82]);
    // cab side windows and door, handrails and steps up to it
    const [c0, c1, z0, z1] = p.cabWindow;
    const wx0 = d > 0 ? xb + c0 : xb - c1, wx1 = d > 0 ? xb + c1 : xb - c0;
    pane(s, w, wx0, z0, wx1, z1, 1.2, GLASS, darker(L.body, 0.6));
    for (const e of SIDES) {
      const dx = d > 0 ? xb + 1.5 : xb - 1.5;
      strip(s, e * w, dx, p.floor + 1.5, dx, top - 2, 0.3, darker(L.body, 0.45), 0.1);
      barZ(s, dx + d * 1.2, e * (w - 0.2), p.floor + 1, top - 10, 0.3, STEEL);
      step(s, dx + d * 3, e * (w - 0.3), p.floor - 0.4, L.frames);
    }
    // wipers
    for (const e of SIDES) s.beam(gx(gz0 + 1), gz0 + 1, gx(gz0 + 4), gz0 + 4, e * 6 - 0.2, e * 6 + 0.2, 0.25, BLACK);
  }
  // windows along the machine room
  for (const x of p.sideWindows ?? []) pane(s, w, x - 3.2, top - 11, x + 3.2, top - 5, 0.8, GLASS, darker(L.body, 0.6));
}

/** DB class 218: a centre cab between two long bonnets, on two B bogies, in DB wine red. */
export function drawClass218(s: Shapes, p: { length: number; width: number; body: RGB; stripe: RGB }) {
  const half = p.length / 2, w = p.width / 2, floor = 16.5, hood = 43.5, cabTop = 46.5, hw = 15.3;
  const face = headstocks(s, half, BLACK, { z0: floor - 8, z1: floor - 1, width: w - 2.5 });
  s.box(-face, face, -w + 0.4, w - 0.4, floor - 2.4, floor, BLACK);                                  // frame and walkways
  for (const e of SIDES) { strip(s, e * (w - 0.4), -face, floor - 1.2, face, floor - 1.2, 1.4, p.stripe, 0.1); barX(s, -face + 4, face - 4, e * (w - 0.6), floor + 9, 0.3, STEEL); for (const x of [-face + 4, -40, -20, 20, 40, face - 4]) barZ(s, x, e * (w - 0.6), floor, floor + 9, 0.25, STEEL); }
  for (const c of [49.4, -49.4]) bogie(s, c, 31, 5.75, floor - 2.4, BLACK);
  // the two bonnets: rounded shoulders, rounded ends, doors and grilles along them
  const cab0 = 14.5;
  for (const d of [1, -1]) {
    const a = d * cab0, b = d * (face - 6);
    s.prismX(section(hw, floor, hood, 4), Math.min(a, b), Math.max(a, b), p.body, true);
    // the bonnet's nose: its top slopes down to the front, its corners are rounded in plan
    const nose = d * (face - 2.5), r = 2.5;
    s.prismY([[b, floor], [nose, floor], [nose, hood - 7], [b, hood]], -hw + r, hw - r, p.body, true);
    for (const e of SIDES) {
      s.cyl("z", floor, hood - 7.5, nose - d * r, e * (hw - r), r, r, p.body);
      s.prismY([[b, floor], [nose - d * r, floor], [nose - d * r, hood - 6.5], [b, hood - 0.5]], Math.min(e * (hw - r), e * hw), Math.max(e * (hw - r), e * hw), p.body);
    }
    const bf = nose;
    for (const e of SIDES) {
      const f = e * hw;
      for (let x = cab0 + 8; x < face - 10; x += 12) strip(s, f, d * x, floor + 2, d * x, hood - 6, 0.3, darker(p.body, 0.5), 0.1);
      s.box(Math.min(d * (cab0 + 20), d * (cab0 + 44)), Math.max(d * (cab0 + 20), d * (cab0 + 44)), Math.min(f, f + e * 0.12), Math.max(f, f + e * 0.12), hood - 13, hood - 6.5, darker(p.body, 0.5));
      for (let z = hood - 12.5; z < hood - 6.5; z += 0.9) strip(s, f, d * (cab0 + 20.5), z, d * (cab0 + 43.5), z, 0.35, darker(p.body, 0.3), 0.2);
    }
    // the bonnet front: headlights, a light stripe, the exhaust and fan on top
    for (const y of [-9, 9]) s.cyl("x", Math.min(bf, bf + d * 0.9), Math.max(bf, bf + d * 0.9), y, floor + 4, 1.4, 1.4, [0.92, 0.92, 0.82]);
    s.cyl("x", Math.min(bf, bf + d * 0.9), Math.max(bf, bf + d * 0.9), 0, hood - 8.5, 1.2, 1.2, [0.92, 0.92, 0.82]);
    s.cyl("z", hood - 0.4, hood + 0.6, d * 34, 0, 4.5, 4.5, darker(p.body, 0.6));                   // radiator fan
    barZ(s, d * 62, 0, hood - 0.4, hood + 1.4, 1.6, BLACK);                                          // exhaust
  }
  // the centre cab: full width, windows all round, a curved roof
  s.prismX(section(w - 0.2, floor, cabTop, 3), -cab0, cab0, p.body, true);
  s.roof(-cab0, cab0, w - 1.4, cabTop - 0.2, 0.01, darker(p.body, 0.9));
  for (const d of [1, -1]) {
    const x = d * cab0;
    for (const e of SIDES) { const ya = e * 2, yb = e * (w - 3); s.box(Math.min(x, x + d * 0.15), Math.max(x, x + d * 0.15), Math.min(ya, yb), Math.max(ya, yb), hood - 1, cabTop - 3, GLASS); }
  }
  pane(s, w - 0.2, -cab0 + 2, hood - 4, -2, cabTop - 3.5, 1, GLASS, darker(p.body, 0.6));
  pane(s, w - 0.2, 2, hood - 4, cab0 - 2, cabTop - 3.5, 1, GLASS, darker(p.body, 0.6));
  for (const e of SIDES) { step(s, cab0 - 2, e * (w - 0.3), floor - 0.4, BLACK); step(s, -cab0 + 2, e * (w - 0.3), floor - 0.4, BLACK); }
  lettering(s, w - 0.2, -8, 8, floor + 6, 2.2, WHITE, 6);
}

/** A bogie open wagon (DB Eaos type): steel sides on stanchions, two doors a side, Y25 bogies, a load of coal. */
export function drawBogieOpen(s: Shapes, p: { length: number; width: number; height: number; body: RGB; load: boolean }) {
  const half = p.length / 2, w = p.width / 2, floor = 14.8, top = p.height - 1.2, face = half - 5.5;
  headstocks(s, half, UNDER, { width: w - 2 });
  s.box(-face + 1, face - 1, -w + 1.2, w - 1.2, floor - 3, floor, UNDER);                            // underframe
  for (const c of [51.7, -51.7]) bogie(s, c, 20.7, 5.3, floor - 3);
  const bh = face - 1;
  for (const e of SIDES) {
    const a = e * (w - 0.3), b = e * (w - 1.1), f = a;
    s.box(-bh, bh, Math.min(a, b), Math.max(a, b), floor, top, p.body);
    // stanchions (U-section posts) and the top rail
    for (let x = -bh + 0.6; x <= bh; x += (2 * bh - 1.2) / 10) s.box(x - 0.6, x + 0.6, Math.min(f, f + e * 0.6), Math.max(f, f + e * 0.6), floor, top, darker(p.body, 0.8));
    s.box(-bh, bh, Math.min(f, f + e * 0.7), Math.max(f, f + e * 0.7), top - 1, top, darker(p.body, 0.8));
    for (const c of [-bh / 2, bh / 2]) { strip(s, f + e * 0.6, c - 9, floor + 1, c - 9, top - 1.5, 0.4, BLACK, 0.1); strip(s, f + e * 0.6, c + 9, floor + 1, c + 9, top - 1.5, 0.4, BLACK, 0.1); }
    lettering(s, w + 0.3, -bh + 4, -bh + 22, floor + 3, 1.6, WHITE, 8);
  }
  for (const e of SIDES) { const a = e * (bh - 1), b = e * bh; s.box(Math.min(a, b), Math.max(a, b), -w + 0.3, w - 0.3, floor, top, p.body); }
  s.box(-bh + 1, bh - 1, -w + 1.2, w - 1.2, floor, floor + 0.4, darker(p.body, 0.5));
  if (p.load) coal(s, -bh + 1, bh - 1, w - 1.4, top - 3, 3, 13);
}

