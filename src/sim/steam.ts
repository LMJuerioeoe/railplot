// Steam locomotives and their tenders, built from a description of the prototype: where the wheels
// are, how big the boiler is, what the cab and tanks look like, and the livery.
import {
  BLACK, BRASS, CAB_INSIDE, COAL, COPPER, DARK_STEEL, GLASS, RGB, SIDES, STEEL, Shapes, UNDER,
  WHEEL_FACE, badge, barX, barY, barZ, darker, discWheels, headstocks, lining, spokedWheels, step, strip,
} from "./parts";

export interface SteamLivery {
  body: RGB;
  /** Lining on tanks, cab and splashers: an outer and an inner line. */
  lining?: [RGB, RGB?];
  smokebox: RGB;
  frames: RGB;
  wheels: RGB;
  beams: RGB;
  /** Chimney cap: copper on the GWR. */
  cap?: RGB;
  /** Safety valve bonnet: brass on the GWR. */
  bonnet?: RGB;
  roof?: RGB;
  /** Boiler bands. */
  bands?: RGB;
  /** Brass beading round the splashers and cab openings (GWR). */
  beading?: RGB;
  /** A crest, roundel or number plate on the tank or cab side. */
  emblem?: { x: number; z: number; r: number; col: RGB; ring?: RGB };
  /** A brass number plate on the cab side (GWR), or painted numbers. */
  numberPlate?: RGB;
  numbers?: { col: RGB; x0: number; x1: number; z: number };
}

export interface SteamSpec {
  length: number; width: number; height: number;
  /** Top of the running plate, its half width, and how far it runs. */
  plate: { z: number; half: number; x0: number; x1: number };
  /** Axles front to back: radius, and whether it's coupled (a driving wheel). */
  wheels: { x: number; r: number; driven?: boolean; spokes?: number }[];
  /** Cylinders: outside ones show with slidebars, crosshead and Walschaerts gear; inside ones are hidden. */
  cylinders: { x0: number; x1: number; z: number; r: number; outside: boolean; y?: number };
  /** Which coupled axle the connecting rods drive (index into the driven wheels). */
  mainDriver?: number;
  boiler: { x0: number; x1: number; z: number; rBack: number; rFront: number };
  smokebox: { x0: number; x1: number; r: number; saddle?: boolean };
  firebox: { x0: number; x1: number; top: number; half: number; belpaire: boolean };
  chimney: { x: number; top: number; r: number; tall?: boolean };
  dome?: { x: number; r: number; top: number; brass?: boolean };
  safety: { x: number; kind: "bonnet" | "pop" | "ramsbottom" };
  topFeed?: { x: number };
  cab: { x0: number; x1: number; eave: number; rise: number; half: number; window: "round" | "square" | "big"; back: "bunker" | "open" };
  tanks?: { kind: "side" | "pannier"; x0: number; x1: number; top: number; inner: number; bottom?: number };
  bunker?: { x0: number; top: number };
  /** Splashers over the driving wheels when they rise above the running plate. */
  splashers?: boolean;
  /** Smoke deflectors. */
  deflectors?: { x0: number; x1: number; top: number };
  livery: SteamLivery;
}

const CRANK = 0.75;   // where the cranks stand, radians from the horizontal

export function drawSteam(s: Shapes, p: SteamSpec) {
  const L = p.livery, half = p.length / 2, w = p.width / 2, pl = p.plate;
  const driven = p.wheels.filter((x) => x.driven);
  const body = L.body, line = L.lining;

  // ---------- underneath: frames, beams, buffers ----------
  // the buffer beam sits at buffer height; a high running plate stands above it on the frames
  const beamTop = Math.min(pl.z, 20.5);
  const face = headstocks(s, half, L.beams, { z0: Math.min(beamTop - 7.5, 9.5), z1: beamTop, width: Math.min(w - 1, 15) });
  for (const e of SIDES) {
    const y0 = e * 5.2, y1 = e * 6.4;
    s.box(-face + 2, face - 2, Math.min(y0, y1), Math.max(y0, y1), 5.5, pl.z - 0.8, L.frames);
    // lightening holes and hornguides as dark marks on the frames
    for (const wh of p.wheels) s.box(wh.x - 1.8, wh.x + 1.8, Math.min(e * 6.4, e * 6.6), Math.max(e * 6.4, e * 6.6), wh.r - 2.4, wh.r + 2.4, darker(L.frames, 0.6));
  }
  // running plate, with a valance along its edge
  s.box(pl.x0, pl.x1, -pl.half, pl.half, pl.z - 0.6, pl.z, L.frames);
  for (const e of SIDES) {
    const a = e * (pl.half - 0.5), b = e * pl.half;
    s.box(pl.x0, pl.x1, Math.min(a, b), Math.max(a, b), pl.z - 2.4, pl.z - 0.6, L.frames);
  }

  // ---------- wheels and motion ----------
  for (const wh of p.wheels) {
    const isDriven = !!wh.driven;
    spokedWheels(s, wh.x, wh.r, wh.spokes ?? (isDriven ? Math.max(12, Math.round(wh.r * 1.45)) : 10), L.wheels,
      isDriven ? { balance: CRANK + Math.PI, crank: CRANK } : {});
  }
  if (driven.length > 1) {
    const pin = (x: number, r: number) => [x + Math.cos(CRANK) * r * 0.42, r + Math.sin(CRANK) * r * 0.42] as const;
    for (const e of SIDES) {
      const ya = e * (WHEEL_FACE + 0.9), yb = e * (WHEEL_FACE + 1.9);
      for (let i = 0; i + 1 < driven.length; i++) {
        const [x0, z0] = pin(driven[i].x, driven[i].r), [x1, z1] = pin(driven[i + 1].x, driven[i + 1].r);
        s.beam(x0, z0, x1, z1, Math.min(ya, yb), Math.max(ya, yb), 1.5, STEEL);               // coupling rods
      }
    }
  }
  const cy = p.cylinders;
  if (cy.outside) {
    const yc = cy.y ?? Math.min(w - cy.r - 0.3, 12.6);
    const main = driven[p.mainDriver ?? Math.min(1, driven.length - 1)] ?? driven[0];
    const [px, pz] = [main.x + Math.cos(CRANK) * main.r * 0.42, main.r + Math.sin(CRANK) * main.r * 0.42];
    for (const e of SIDES) {
      const y = e * yc;
      s.cyl("x", cy.x0, cy.x1, y, cy.z, cy.r, cy.r, L.body === BLACK ? BLACK : darker(body, 0.95));           // cylinder, lagged in body colour
      s.ring("x", cy.x0 - 0.6, cy.x0, y, cy.z, cy.r + 0.4, cy.r - 1, BLACK);                   // covers
      s.ring("x", cy.x1, cy.x1 + 0.6, y, cy.z, cy.r + 0.4, cy.r - 1, BLACK);
      barX(s, cy.x0 + 2, cy.x1 - 2, y, cy.z + cy.r + 1.3, 1.6, BLACK);                         // valve chest
      // slidebars and crosshead, then the connecting rod to the main crankpin
      const xh = cy.x0 - 6.5, yo = e * (yc - 1.2), yi = e * (yc - 0.4);
      s.beam(cy.x0, cy.z + 1.4, cy.x0 - 12, cy.z + 1.4, Math.min(yo, yi), Math.max(yo, yi), 0.6, STEEL);
      s.beam(cy.x0, cy.z - 1.4, cy.x0 - 12, cy.z - 1.4, Math.min(yo, yi), Math.max(yo, yi), 0.6, STEEL);
      s.box(xh - 1.6, xh + 1.6, Math.min(yo, yi) - 0.3, Math.max(yo, yi) + 0.3, cy.z - 1.2, cy.z + 1.2, STEEL);
      const yr0 = e * (WHEEL_FACE + 2.0), yr1 = e * (WHEEL_FACE + 2.9);
      s.beam(xh, cy.z, px, pz, Math.min(yr0, yr1), Math.max(yr0, yr1), 1.6, STEEL);
      // Walschaerts gear: return crank to the expansion link, radius rod forward to the valve, combination lever
      const lx = (xh + main.x) / 2 + 2, lz = cy.z + 3.5;
      s.beam(px, pz, px + 1.5, pz + 2.8, Math.min(yr0, yr1), Math.max(yr0, yr1), 0.8, STEEL);
      s.beam(px + 1.5, pz + 2.8, lx, lz - 1, Math.min(yr0, yr1), Math.max(yr0, yr1), 0.8, STEEL);
      s.box(lx - 1, lx + 1, Math.min(yo, yi) - 0.2, Math.max(yo, yi) + 0.2, lz - 2.5, lz + 2.5, DARK_STEEL);
      s.beam(lx, lz + 1.2, cy.x0 + 1, cy.z + cy.r + 1.3, Math.min(yo, yi), Math.max(yo, yi), 0.7, STEEL);
      s.beam(xh, cy.z - 1, xh + 1.2, cy.z + cy.r + 1.3, Math.min(yo, yi), Math.max(yo, yi), 0.6, STEEL);
    }
  } else {
    // inside cylinders: the motion shows between the frames only as shadow
    s.box(cy.x0, cy.x1, -5, 5, cy.z - cy.r, cy.z + cy.r, BLACK);
  }

  // ---------- boiler, smokebox, firebox ----------
  const B = p.boiler, SB = p.smokebox, FB = p.firebox;
  s.cyl("x", B.x0, B.x1, 0, B.z, B.rBack, B.rFront, body);
  const bands = L.bands ?? darker(body, 0.75);
  for (let i = 0; i <= 3; i++) {
    const x = B.x0 + ((B.x1 - B.x0) * i) / 3, r = B.rBack + ((B.rFront - B.rBack) * i) / 3;
    s.ring("x", Math.max(B.x0, x - 0.35), Math.min(B.x1, x + 0.35), 0, B.z, r + 0.2, r - 0.2, bands);
  }
  s.cyl("x", SB.x0, SB.x1, 0, B.z, SB.r, SB.r, L.smokebox);
  s.ring("x", SB.x1 - 0.6, SB.x1, 0, B.z, SB.r + 0.35, SB.r - 0.6, L.smokebox);                    // front ring
  s.cyl("x", SB.x1, SB.x1 + 0.9, 0, B.z, SB.r * 0.86, SB.r * 0.8, darker(L.smokebox, 1.25));         // door
  barX(s, SB.x1 + 0.9, SB.x1 + 1.6, 0, B.z, 0.9, STEEL);                                           // dart
  s.beam(SB.x1 + 1.6, B.z - 1.6, SB.x1 + 1.6, B.z + 1.6, -0.3, 0.3, 0.4, STEEL);
  for (const dz of [-SB.r * 0.45, SB.r * 0.45]) s.box(SB.x1 + 0.6, SB.x1 + 1.1, -SB.r * 0.7, SB.r * 0.2, B.z + dz - 0.35, B.z + dz + 0.35, STEEL);   // hinge straps
  if (SB.saddle !== false) s.box(SB.x0 + 1, SB.x1 - 1, -SB.r * 0.75, SB.r * 0.75, pl.z - 0.5, B.z - SB.r * 0.5, L.smokebox);
  // the smokebox runs down to the frames as a saddle on outside-cylinder engines
  if (FB.belpaire) {
    const h = FB.half, t = FB.top, z0 = pl.z - 0.5;
    s.prismX([[-h + 1.5, z0], [h - 1.5, z0], [h, B.z - 2], [h, t - 3.2], [h - 1.4, t - 0.6], [h - 3.2, t], [-h + 3.2, t], [-h + 1.4, t - 0.6], [-h, t - 3.2], [-h, B.z - 2]], FB.x0, FB.x1, body);
  } else {
    s.cyl("x", FB.x0, FB.x1, 0, B.z, B.rBack, B.rBack, body);
    s.box(FB.x0, FB.x1, -FB.half, FB.half, pl.z - 0.5, B.z, body);
  }
  // handrails along the boiler on stanchions
  for (const e of SIDES) {
    const yr = e * (B.rFront + 1.4), zr = B.z + B.rFront * 0.55;
    barX(s, SB.x0 - 1, FB.x1, yr, zr, 0.3, STEEL);
    for (let x = SB.x0 + 2; x < FB.x1; x += 14) s.beam(x, zr, x, zr - 0.2, Math.min(yr, e * B.rFront * 0.95), Math.max(yr, e * B.rFront * 0.95), 0.5, STEEL);
  }
  barX(s, SB.x1 - 0.2, SB.x1 + 0.6, 0, B.z + SB.r * 0.6, 0.35, STEEL);

  // ---------- boiler mountings ----------
  const ch = p.chimney, zTop = (x: number) => B.z + (x > SB.x0 ? SB.r : B.rBack + ((B.rFront - B.rBack) * (x - B.x0)) / Math.max(1, B.x1 - B.x0));
  const zc = zTop(ch.x) - 1;
  s.cyl("z", zc, zc + 2.2, ch.x, 0, ch.r + 2.2, ch.r + 0.2, L.smokebox);                            // flared base
  s.cyl("z", zc + 2, ch.top - 1.4, ch.x, 0, ch.r, ch.r * (ch.tall ? 0.96 : 1.05), L.smokebox);
  s.cyl("z", ch.top - 1.4, ch.top, ch.x, 0, ch.r + 0.9, ch.r + 0.6, L.cap ?? L.smokebox);              // lip, copper on the GWR
  s.cyl("z", ch.top - 0.5, ch.top - 0.1, ch.x, 0, ch.r - 0.3, ch.r - 0.3, BLACK);                      // the dark inside
  if (p.dome) {
    const d = p.dome, z0 = zTop(d.x) - 1, col = d.brass ? BRASS : body;
    s.cyl("z", z0, d.top - d.r * 0.55, d.x, 0, d.r * 1.2, d.r, col);
    s.dome(d.x, 0, d.top - d.r * 0.55, d.r, col, 0.55);
  }
  const sv = p.safety, zs = sv.x < FB.x1 && sv.x > FB.x0 ? FB.top - 0.3 : zTop(sv.x) - 0.5;
  if (sv.kind === "bonnet") {
    s.cyl("z", zs, zs + 3.6, sv.x, 0, 3.1, 2.2, L.bonnet ?? BRASS);
    s.cyl("z", zs + 3.6, zs + 4.3, sv.x, 0, 1.0, 0.8, L.bonnet ?? BRASS);
  } else if (sv.kind === "pop") {
    for (const y of [-1.4, 1.4]) { barZ(s, sv.x, y, zs, zs + 2.6, 0.9, BRASS); s.cyl("z", zs + 2.6, zs + 3.0, sv.x, y, 1.1, 1.1, BRASS); }
  } else {
    s.box(sv.x - 2.5, sv.x + 2.5, -1.8, 1.8, zs, zs + 1.2, body);
    for (const y of [-1.0, 1.0]) barZ(s, sv.x, y, zs + 1.2, zs + 4.2, 0.6, BRASS);
  }
  if (p.topFeed) { const z0 = zTop(p.topFeed.x) - 0.5; s.prismX([[-2.6, z0], [2.6, z0], [1.8, z0 + 1.8], [-1.8, z0 + 1.8]], p.topFeed.x - 2.5, p.topFeed.x + 2.5, body); }
  barZ(s, FB.x0 + 1.5, 0, FB.top - 0.4, FB.top + 1.6, 0.45, BRASS);                                 // whistle
  s.dome(FB.x0 + 1.5, 0, FB.top + 1.6, 0.7, BRASS, 1.2);

  // ---------- tanks or splashers ----------
  const T = p.tanks;
  if (T?.kind === "side") {
    for (const e of SIDES) {
      const a = e * T.inner, b = e * (w - 0.1);
      s.prismX([[Math.min(a, b), pl.z], [Math.max(a, b), pl.z], [Math.max(a, b), T.top - (e > 0 ? 1.2 : 0)], [Math.max(a, b) - (e > 0 ? 1.2 : 0), T.top], [Math.min(a, b) + (e < 0 ? 1.2 : 0), T.top], [Math.min(a, b), T.top - (e < 0 ? 1.2 : 0)]], T.x0, T.x1, body);
      // a filler on top
      barZ(s, T.x0 + 5, e * (T.inner + 3), T.top, T.top + 1.2, 1.6, darker(body, 0.85));
    }
    if (line) lining(s, w - 0.1, T.x0 + 2.2, pl.z + 2.4, T.x1 - 2.2, T.top - 2.4, line[0], 0.45, line[1]);
  } else if (T?.kind === "pannier") {
    const z0 = T.bottom ?? B.z - 3;
    for (const e of SIDES) {
      const a = e * T.inner, b = e * (w - 0.3);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const outer = e > 0 ? hi : lo, inner = e > 0 ? lo : hi;
      s.prismX([[inner, z0], [outer - e * 1.2, z0], [outer, z0 + 1.5], [outer, T.top - 2.5], [outer - e * 1.2, T.top - 0.6], [outer - e * 3, T.top], [inner, T.top]], T.x0, T.x1, body);
      s.prismX([[inner, z0 - 0.01], [outer - e * 1.2, z0 - 0.01], [outer - e * 1.2, z0 - 0.6], [inner, z0 - 0.6]], T.x0 + 1, T.x1 - 1, darker(body, 0.6));   // shadow under the tank
    }
    if (line) lining(s, w - 0.3, T.x0 + 2, z0 + 2, T.x1 - 2, T.top - 2.4, line[0], 0.4, line[1]);
  } else if (p.splashers) {
    for (const wh of driven) {
      if (2 * wh.r + 0.8 <= pl.z) continue;
      for (const e of SIDES) {
        const pts: [number, number][] = [];
        const R = wh.r + 1.0, lo = Math.asin(Math.max(-1, Math.min(1, (pl.z - wh.r) / R)));
        for (let k = 0; k <= 12; k++) { const t = lo + ((Math.PI - 2 * lo) * k) / 12; pts.push([wh.x + Math.cos(t) * R, wh.r + Math.sin(t) * R]); }
        const a = e * (WHEEL_FACE - 1.8), b = e * (WHEEL_FACE + 0.4);
        s.prismY(pts, Math.min(a, b), Math.max(a, b), body);
        if (L.beading) {
          const pb = pts.map(([x, z]) => [wh.x + (x - wh.x) * 1.04, wh.r + (z - wh.r) * 1.04] as [number, number]);
          for (let k = 0; k + 1 < pb.length; k++) s.beam(pb[k][0], pb[k][1], pb[k + 1][0], pb[k + 1][1], Math.min(e * (WHEEL_FACE - 1.6), e * (WHEEL_FACE + 0.5)), Math.max(e * (WHEEL_FACE - 1.6), e * (WHEEL_FACE + 0.5)), 0.45, L.beading);
        }
      }
    }
  }
  // sandboxes on the running plate ahead of the drivers (tender engines)
  if (!T) for (const e of SIDES) { const y = e * (pl.half - 3); s.box(driven[0].x + driven[0].r + 1, driven[0].x + driven[0].r + 5, y - 1.6, y + 1.6, pl.z, pl.z + 3.2, body); }
  if (p.deflectors) for (const e of SIDES) { const a = e * (pl.half - 0.6), b = e * pl.half; s.box(p.deflectors.x0, p.deflectors.x1, Math.min(a, b), Math.max(a, b), pl.z, p.deflectors.top, body); }

  // ---------- cab ----------
  const C = p.cab, roofCol = L.roof ?? (body === BLACK ? BLACK : darker(body, 0.9));
  const wz0 = Math.max(pl.z + 9, C.eave - 13), wz1 = C.eave - 3;   // the side opening
  for (const e of SIDES) {
    const out = e * C.half, inn = e * (C.half - 0.7), lo = Math.min(out, inn), hi = Math.max(out, inn);
    s.box(C.x0, C.x1, lo, hi, pl.z, wz0, body);                                                   // below the opening
    s.box(C.x0, C.x1, lo, hi, wz1, C.eave, body);                                                 // above it
    s.box(C.x1 - 3.5, C.x1, lo, hi, wz0, wz1, body);                                              // front pillar
    s.box(C.x0, C.x0 + (C.back === "open" ? 2.2 : 3), lo, hi, wz0, wz1, body);                    // back pillar
    if (L.beading) { strip(s, out, C.x0 + 3, wz0, C.x1 - 3.5, wz0, 0.4, L.beading); strip(s, out, C.x1 - 3.5, wz0, C.x1 - 3.5, wz1, 0.4, L.beading); }
    if (C.window !== "big") s.box(C.x1 - 3.4, C.x1 - 0.5, Math.min(out, out + e * 0.05), Math.max(out, out + e * 0.05), wz1 - 0.1, C.eave - 0.8, GLASS);   // small side window
    if (L.numberPlate) s.box(C.x0 + 4, C.x0 + 11, Math.min(out, out + e * 0.35), Math.max(out, out + e * 0.35), pl.z + 4, pl.z + 6.8, L.numberPlate);
    // grab handles beside the opening, steps below
    barZ(s, C.x0 + 0.8, e * (C.half + 0.5), pl.z + 1, wz1, 0.28, STEEL);
    step(s, C.x0 + 3.5, e * (pl.half - 0.2), pl.z - 0.6);
  }
  s.box(C.x0 + 0.5, C.x1 - 0.5, -C.half + 0.7, C.half - 0.7, pl.z, C.eave - 0.5, CAB_INSIDE);        // the dark inside
  // cab front, with its spectacle windows either side of the firebox
  s.box(C.x1 - 0.8, C.x1, -C.half, C.half, pl.z, C.eave, body);
  for (const e of SIDES) {
    const y = e * (C.half - 4.2), z = C.eave - 5.5;
    if (C.window === "round") { s.cyl("x", C.x1, C.x1 + 0.15, y, z, 2.2, 2.2, GLASS); s.ring("x", C.x1, C.x1 + 0.3, y, z, 2.6, 2.2, L.beading ?? darker(body, 0.7)); }
    else s.box(C.x1, C.x1 + 0.15, y - 2.4, y + 2.4, z - 2.4, z + 2.2, GLASS);
  }
  s.roof(C.x0 - 1.5, C.x1 + 1, C.half + 0.6, C.eave, C.rise, roofCol);
  for (const e of SIDES) barX(s, C.x0 - 1.5, C.x1 + 1, e * (C.half - 1.2), C.eave + C.rise * 0.45, 0.25, darker(roofCol, 0.7));   // rain strips
  if (C.back === "bunker" && p.bunker) {
    const Bk = p.bunker;
    s.box(C.x0 - 0.8, C.x0, -C.half, C.half, pl.z, C.eave, body);
    for (const e of SIDES) { const y = e * (C.half - 4.2), z = C.eave - 5.5; s.cyl("x", C.x0 - 0.95, C.x0 - 0.8, y, z, 2.2, 2.2, GLASS); }
    s.box(Bk.x0, C.x0, -C.half, C.half, pl.z, Bk.top, body);
    s.roof(Bk.x0 + 1.5, C.x0 - 1.5, C.half - 1.5, Bk.top, 2.6, COAL);                                // coal heaped in the bunker
    if (line) lining(s, C.half, Bk.x0 + 2, pl.z + 2.4, C.x0 - 2, Bk.top - 2.2, line[0], 0.45, line[1]);
    // lamp irons and a ladder at the back
    for (const y of [-6, 0, 6]) s.box(Bk.x0 - 0.6, Bk.x0, y - 0.4, y + 0.4, Bk.top - 3, Bk.top - 0.5, DARK_STEEL);
  } else {
    // the fallplate and the cab's open back, with the reverser beside the firebox
    s.box(C.x0 - 3, C.x0, -C.half + 2, C.half - 2, pl.z - 0.3, pl.z, DARK_STEEL);
  }
  if (line) lining(s, C.half, C.x0 + 1.2, pl.z + 2.4, C.x1 - 1.2, wz0 - 1.2, line[0], 0.45, line[1]);
  if (L.emblem) badge(s, L.emblem.x < C.x0 ? C.half : (T ? w - 0.1 : C.half), L.emblem.x, L.emblem.z, L.emblem.r, L.emblem.col, L.emblem.ring);
  if (L.numbers) for (const e of SIDES) {
    const n = 4, wd = (L.numbers.x1 - L.numbers.x0) / (n * 1.4);
    for (let i = 0; i < n; i++) { const x = L.numbers.x0 + i * wd * 1.4; s.box(x, x + wd, e > 0 ? C.half : -C.half - 0.25, e > 0 ? C.half + 0.25 : -C.half, L.numbers.z, L.numbers.z + 2.6, L.numbers.col); }
  }

  // ---------- lamp irons, front steps ----------
  for (const y of [-7, 0, 7]) s.box(face - 0.6, face, y - 0.4, y + 0.4, pl.z, pl.z + 2.2, DARK_STEEL);
  s.box(SB.x1 + 0.2, SB.x1 + 0.8, -0.4, 0.4, B.z + SB.r * 0.75, B.z + SB.r * 0.75 + 2, DARK_STEEL);
  for (const e of SIDES) step(s, face - 4, e * (pl.half - 0.2), pl.z - 0.6);
}

// ---------- tenders ----------

export interface TenderSpec {
  length: number; width: number; height: number;
  wheels: number[]; r: number;
  body: { x0: number; x1: number; z0: number; top: number; flare?: boolean; coalRails?: boolean };
  /** Outside frames with axleboxes and springs showing. */
  outsideFrames: boolean;
  livery: { body: RGB; frames: RGB; beams: RGB; lining?: [RGB, RGB?]; emblem?: { x: number; z: number; r: number; col: RGB; ring?: RGB }; lettering?: { col: RGB; x0: number; x1: number; z: number; chars: number } };
}

export function drawTender(s: Shapes, p: TenderSpec) {
  const L = p.livery, half = p.length / 2, w = p.width / 2, b = p.body;
  headstocks(s, half, L.beams, { z0: 9.5, z1: b.z0 + 0.6, width: Math.min(w - 1, 15) });
  for (const e of SIDES) {
    // frames: outside ones carry the axleboxes and springs on show
    const fy0 = e * (p.outsideFrames ? 10.4 : 5.4), fy1 = e * (p.outsideFrames ? 11.6 : 6.6);
    const fz0 = p.outsideFrames ? p.r - 3.2 : 4.5;
    s.box(b.x0 + 2, b.x1 - 2, Math.min(fy0, fy1), Math.max(fy0, fy1), fz0, b.z0, L.frames);
    if (p.outsideFrames) for (const x of p.wheels) {
      const ya = e * 12.2;
      s.box(x - 2, x + 2, Math.min(fy1, ya), Math.max(fy1, ya), p.r - 2.6, p.r + 2, L.frames);
      for (let k = 0; k < 4; k++) { const l = 6 - k * 1.2, z = p.r + 2.2 + k * 0.45; s.box(x - l, x + l, Math.min(fy1, ya) + 0.2, Math.max(fy1, ya) - 0.2, z, z + 0.42, L.frames); }
      // cut-outs between axleboxes
      s.box(x - 7, x - 3, Math.min(fy1, fy1 + e * 0.05), Math.max(fy1, fy1 + e * 0.05), p.r - 2, b.z0 - 2.5, darker(L.frames, 0.5));
    }
    step(s, b.x1 - 3, e * (w - 1), b.z0 - 0.4);
    step(s, b.x0 + 3, e * (w - 1), b.z0 - 0.4);
  }
  for (const x of p.wheels) discWheels(s, x, p.r, darker(L.frames, 1.4));
  // the tank, the coal space at the front, and the fender round it
  const t = b.top;
  if (b.flare) {
    s.box(b.x0, b.x1, -w + 1.2, w - 1.2, b.z0, t - 4, L.body);
    for (const e of SIDES) { const a = e * (w - 1.2), c = e * w; s.prismX([[Math.min(a, c), t - 4], [Math.max(a, c), t - 4], [e > 0 ? w : -w + 0.8, t], [e > 0 ? w - 0.8 : -w, t]], b.x0 + 0.5, b.x1, L.body); }
  } else s.box(b.x0, b.x1, -w + 0.2, w - 0.2, b.z0, t, L.body);
  // coal heaped up at the front, the tank top and water filler behind
  s.roof(b.x1 - 30, b.x1 - 3, w - 2, t - 1, 5, COAL);
  s.box(b.x0 + 1, b.x1 - 30, -w + 2, w - 2, t - 0.2, t + 0.3, darker(L.body, 0.85));
  barZ(s, b.x0 + 9, 0, t, t + 1.6, 3, darker(L.body, 0.8)); s.cyl("z", t + 1.6, t + 2.1, b.x0 + 9, 0, 3.4, 3.4, darker(L.body, 0.7));
  if (b.coalRails) for (const e of SIDES) for (const z of [t + 1.5, t + 3]) barX(s, b.x1 - 30, b.x1 - 3, e * (w - 1), z, 0.3, L.body);
  // the front, with tool cupboards and the coal hole
  s.box(b.x1 - 0.8, b.x1, -w + 1, w - 1, b.z0, t - 3, darker(L.body, 0.92));
  s.box(b.x1, b.x1 + 0.1, -3.5, 3.5, b.z0 + 6, b.z0 + 13, COAL);
  for (const e of SIDES) { barZ(s, b.x1 - 0.5, e * (w - 0.5), b.z0 + 2, t - 1, 0.3, STEEL); barZ(s, b.x0 + 0.6, e * (w - 2.5), b.z0 + 2, t, 0.3, STEEL); }
  // lamp irons at the back
  for (const y of [-6, 0, 6]) s.box(b.x0 - 0.6, b.x0, y - 0.4, y + 0.4, t - 4, t - 1.5, DARK_STEEL);
  if (L.lining) lining(s, w - 0.2, b.x0 + 2.2, b.z0 + 2.4, b.x1 - 2.2, t - 2.6, L.lining[0], 0.45, L.lining[1]);
  if (L.emblem) badge(s, w - 0.2, L.emblem.x, L.emblem.z, L.emblem.r, L.emblem.col, L.emblem.ring);
  if (L.lettering) for (const e of SIDES) {
    const l = L.lettering, wd = (l.x1 - l.x0) / (l.chars * 1.5);
    for (let i = 0; i < l.chars; i++) { const x = l.x0 + i * wd * 1.5; s.box(x, x + wd, e > 0 ? w - 0.2 : -w - 0.05, e > 0 ? w + 0.05 : -w + 0.2, l.z, l.z + 3.4, l.col); }
  }
}

export { COPPER };
