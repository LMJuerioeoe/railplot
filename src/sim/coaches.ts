// Coaches: a body drawn from its cross-section (with tumblehome), windows and doors laid out along it,
// a two-tone livery with lining, gangways, roof ventilators, bogies and the gear under the floor.
import { BLACK, BRASS, DARK_STEEL, GLASS, RGB, SIDES, STEEL, Shapes, UNDER, barX, barY, barZ, darker, discWheels, headstocks, strip } from "./parts";

export interface CoachSpec {
  length: number; width: number; height: number;
  /** Half the body's length (the gangways stand out beyond it). */
  bodyHalf: number;
  floor: number; waist: number; eave: number; rise: number;
  /** How far the sides curve in at the bottom. */
  tumblehome: number;
  bogieCentre: number; bogieWheelbase: number; wheelR: number;
  /**
   * Along the side, front to back: D a door with a droplight, W a big window, w a smaller one, T a frosted
   * toilet window, L luggage doors (a brake), - a gap of plain panelling. Widths in mm per letter.
   */
  layout: string;
  widths?: Partial<Record<string, number>>;
  livery: {
    lower: RGB; upper?: RGB; roof: RGB; ends?: RGB;
    /** Thin lines along the waist and at the cantrail. */
    lining?: RGB;
    /** Window frames: aluminium on BR Mk1, body colour on older stock. */
    frames?: RGB;
  };
  /** Truss rods under the floor (older stock). */
  truss?: boolean;
  /** Torpedo ventilators on the roof. */
  vents?: number;
}

const WIDTH: Record<string, number> = { D: 9, W: 18, w: 11, T: 6, L: 15, "-": 3 };

export function drawCoach(s: Shapes, p: CoachSpec) {
  const L = p.livery, half = p.length / 2, w = p.width / 2, bh = p.bodyHalf;
  const upper = L.upper ?? L.lower, frames = L.frames ?? darker(L.lower, 0.75);
  const tb = p.tumblehome, low = p.floor + (p.waist - p.floor) * 0.45;
  // the body: below the waist (curving in to the solebar), the window band, and the roof
  s.prismX([[-w + tb, p.floor], [w - tb, p.floor], [w - tb * 0.35, low - 3], [w, low], [w, p.waist], [-w, p.waist], [-w, low], [-w + tb * 0.35, low - 3]], -bh, bh, L.lower);
  s.prismX([[-w, p.waist], [w, p.waist], [w - 0.15, p.eave], [-w + 0.15, p.eave]], -bh, bh, upper);
  s.roof(-bh - 0.3, bh + 0.3, w - 0.1, p.eave, p.rise, L.roof);
  for (const e of SIDES) barX(s, -bh, bh, e * (w - 0.6), p.eave + p.rise * 0.25, 0.25, darker(L.roof, 0.75));   // rain strips
  // ends, a little darker, with the gangway bellows and a footstep
  for (const e of SIDES) {
    const a = e * bh, b = e * (bh + 0.4);
    s.box(Math.min(a, b), Math.max(a, b), -w + tb, w - tb, p.floor, p.eave, L.ends ?? darker(L.lower, 0.85));
    const g0 = e * (bh + 0.4), g1 = e * (half - 5.5 - 0.5);
    s.box(Math.min(g0, g1), Math.max(g0, g1), -5.2, 5.2, p.floor + 1, p.eave - 1.5, BLACK);                          // bellows
    for (let k = 1; k < 4; k++) { const x = g0 + ((g1 - g0) * k) / 4; s.box(x - 0.2, x + 0.2, -5.4, 5.4, p.floor + 0.8, p.eave - 1.2, darker(BLACK, 1.6)); }
    s.box(Math.min(g1, g1 + e * 0.6), Math.max(g1, g1 + e * 0.6), -5.6, 5.6, p.floor + 0.5, p.eave - 1, DARK_STEEL);    // face plate
  }
  // windows and doors along each side
  const toks = p.layout.replace(/\s+/g, "").split("");
  const widths = toks.map((t) => p.widths?.[t] ?? WIDTH[t] ?? 6);
  const total = widths.reduce((a, b) => a + b, 0), k = (2 * bh - 4) / total;
  for (const e of SIDES) {
    const f = e * w, glass = (x0: number, x1: number, z0: number, z1: number, col: RGB = GLASS) => {
      s.box(x0, x1, Math.min(f, f + e * 0.12), Math.max(f, f + e * 0.12), z0, z1, col);
      strip(s, f, x0, z0, x1, z0, 0.45, frames, 0.18); strip(s, f, x0, z1, x1, z1, 0.45, frames, 0.18);
      strip(s, f, x0, z0, x0, z1, 0.45, frames, 0.18); strip(s, f, x1, z0, x1, z1, 0.45, frames, 0.18);
    };
    let x = bh - 2;
    toks.forEach((t, i) => {
      const x1 = x, x0 = x - widths[i] * k;
      const top = p.eave - 2.6, bot = p.waist + 0.4;
      if (t === "W") glass(x0 + 0.8, x1 - 0.8, bot, top);
      else if (t === "w") glass(x0 + 0.8, x1 - 0.8, bot + 1.5, top);
      else if (t === "T") glass(x0 + 1.2, x1 - 1.2, bot + 3, top - 1, darker(STEEL, 0.75));
      else if (t === "D" || t === "L") {
        // the door: its outline, a droplight (or barred window on luggage doors), handle and grab rails
        const dz0 = p.floor + 1.2;
        strip(s, f, x0 + 0.3, dz0, x0 + 0.3, p.eave - 1, 0.3, darker(L.lower, 0.45), 0.1); strip(s, f, x1 - 0.3, dz0, x1 - 0.3, p.eave - 1, 0.3, darker(L.lower, 0.45), 0.1);
        if (t === "D") glass(x0 + 1.6, x1 - 1.6, bot + 1, top);
        else { glass(x0 + 2, x1 - 2, bot + 3, top - 1); for (let b = x0 + 3; b < x1 - 2; b += 1.6) strip(s, f, b, bot + 3, b, top - 1, 0.25, frames, 0.25); }
        s.box(x0 + 1.2, x0 + 2.6, Math.min(f, f + e * 0.5), Math.max(f, f + e * 0.5), p.waist - 1.8, p.waist - 1.2, BRASS);   // handle
        for (const xg of [x0 - 0.6, x1 + 0.6]) barZ(s, xg, e * (w + 0.35), p.waist - 6, p.waist - 1, 0.22, STEEL);
      }
      x = x0;
    });
    // lining along the waist and the cantrail
    if (L.lining) { strip(s, f, -bh, p.waist - 0.4, bh, p.waist - 0.4, 0.35, L.lining, 0.12); strip(s, f, -bh, p.eave - 1.2, bh, p.eave - 1.2, 0.35, L.lining, 0.12); }
    // solebar along the bottom of the side
    s.box(-bh + 1, bh - 1, Math.min(e * (w - tb - 0.6), e * (w - tb + 0.2)), Math.max(e * (w - tb - 0.6), e * (w - tb + 0.2)), p.floor - 2.2, p.floor + 0.3, UNDER);
  }
  // roof ventilators in a row
  const vents = p.vents ?? 8;
  for (let i = 0; i < vents; i++) {
    const x = -bh + ((2 * bh) * (i + 0.5)) / vents, y = (i % 2 ? 1 : -1) * w * 0.28;
    s.cyl("x", x - 2.2, x + 2.2, y, p.eave + p.rise - 0.2, 1.2, 1.2, darker(L.roof, 0.8));
  }

  // ---------- underneath ----------
  headstocks(s, half, UNDER, { z0: p.floor - 6, z1: p.floor, width: w - tb - 1 });
  s.box(-bh + 2, bh - 2, -w + tb + 1, w - tb - 1, p.floor - 3.2, p.floor, UNDER);
  // battery boxes, vacuum cylinders, dynamo between the bogies
  const mid = p.bogieCentre - p.bogieWheelbase / 2 - p.wheelR - 4;
  s.box(-mid * 0.5, mid * 0.2, -9, -3, p.floor - 8, p.floor - 3.2, BLACK);
  for (const x of [mid * 0.35, mid * 0.65]) barY(s, x, -6.5, 6.5, p.floor - 6.6, 3.2, BLACK);
  barX(s, -mid * 0.85, -mid * 0.65, 6, p.floor - 6, 2, BLACK);
  if (p.truss) for (const e of SIDES) {
    const y0 = e * (w - tb - 2), y1 = e * (w - tb - 1.2), zl = p.floor - 9;
    s.beam(-mid, p.floor - 2, -mid * 0.45, zl, Math.min(y0, y1), Math.max(y0, y1), 0.6, UNDER);
    s.beam(-mid * 0.45, zl, mid * 0.45, zl, Math.min(y0, y1), Math.max(y0, y1), 0.6, UNDER);
    s.beam(mid * 0.45, zl, mid, p.floor - 2, Math.min(y0, y1), Math.max(y0, y1), 0.6, UNDER);
    for (const x of [-mid * 0.45, mid * 0.45]) s.box(x - 0.4, x + 0.4, Math.min(y0, y1), Math.max(y0, y1), zl, p.floor - 2, UNDER);
  }
  for (const c of [p.bogieCentre, -p.bogieCentre]) bogie(s, c, p.bogieWheelbase, p.wheelR, p.floor - 3.2);
}

/** A two-axle bogie: side frames with axleboxes and springs, a bolster, the wheels. */
export function bogie(s: Shapes, x: number, wb: number, r: number, top: number, col: RGB = UNDER) {
  const a = wb / 2;
  for (const e of SIDES) {
    const y0 = e * 10.2, y1 = e * 11.4;
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    s.beam(x - a - r - 1, r + 2.6, x + a + r + 1, r + 2.6, lo, hi, 2.2, col);                    // side frame
    s.beam(x - a + 2, r + 1.2, x - 3, r - 1.6, lo, hi, 1.2, col);
    s.beam(x + 3, r - 1.6, x + a - 2, r + 1.2, lo, hi, 1.2, col);
    s.box(x - 3, x + 3, lo, hi, r - 2.2, r - 0.8, col);
    for (const ax of [x - a, x + a]) {
      s.box(ax - 2, ax + 2, lo - 0.6, hi + 0.6, r - 2.2, r + 2.2, col);                           // axlebox
      for (const sx of [-3.2, 3.2]) { barZ(s, ax + sx, e * 10.8, r + 2.2, r + 4.4, 1, DARK_STEEL); }   // coil springs
    }
    s.box(x - 5, x + 5, lo, hi, r + 2.6, top, col);                                                // bolster end
  }
  s.box(x - 4, x + 4, -10, 10, top - 1.8, top, col);
  for (const ax of [x - a, x + a]) discWheels(s, ax, r);
  for (const ax of [x - a, x + a]) for (const e of SIDES) s.box(ax - Math.sign(ax - x) * (r + 0.3) - 0.5, ax - Math.sign(ax - x) * (r + 0.3) + 0.5, Math.min(e * 6.8, e * 9.4), Math.max(e * 6.8, e * 9.4), r - 2.4, r + 2.4, BLACK);   // brake blocks
}

export { BLACK };
