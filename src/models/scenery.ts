// Scenery for the plan and the 3D view: stations, buildings, signals, bridges, trees, roads and things in the room.
// Sizes are OO-scale millimetres (1:76) unless a model is marked `real` (furniture, backscenes), which is full size.
// Frame: origin at the middle of the footprint on the baseboard, x along the length (w), y across (d), z up.
import { MAT, Mesh, RGB, V3, mix, shade } from "../gfx/mesh";

const BRICK: RGB = [0.6, 0.3, 0.22], STONE: RGB = [0.62, 0.6, 0.55], SLATE: RGB = [0.27, 0.29, 0.33], CONC: RGB = [0.66, 0.65, 0.62];
const TARMAC: RGB = [0.2, 0.2, 0.21], WHITE: RGB = [0.93, 0.93, 0.9], CREAM: RGB = [0.9, 0.86, 0.72], BLACK: RGB = [0.08, 0.08, 0.09];
const WOOD: RGB = [0.42, 0.3, 0.2], GREEN: RGB = [0.22, 0.42, 0.16], GLASS: RGB = [0.3, 0.38, 0.44], IRON: RGB = [0.2, 0.21, 0.22];
const GRASS: RGB = [0.33, 0.5, 0.2];

export interface BuildOpts { w: number; d: number; hgt: number; col: RGB; seed: number }
type Face = "y-" | "y+" | "x-" | "x+";

/** A window (or door) set into a wall face. `u` runs along the face, measured from the middle of the building. */
function opening(m: Mesh, face: Face, half: number, u: number, z: number, wu: number, hz: number, kind: "window" | "door" = "window", col: RGB = WHITE) {
  const put = (u0: number, u1: number, z0: number, z1: number, out: number, c: RGB, mat: number) => {
    const a = half + out - 0.25, b = half + out;
    if (face === "y-") m.box(u0, -b, z0, u1, -a, z1, c, mat);
    else if (face === "y+") m.box(u0, a, z0, u1, b, z1, c, mat);
    else if (face === "x-") m.box(-b, u0, z0, -a, u1, z1, c, mat);
    else m.box(a, u0, z0, b, u1, z1, c, mat);
  };
  if (kind === "door") {
    put(u - wu / 2 - 0.6, u + wu / 2 + 0.6, z, z + hz + 0.6, 0.12, WHITE, MAT.paint);
    put(u - wu / 2, u + wu / 2, z, z + hz, 0.28, col, MAT.paint);
    put(u - wu / 2 + 0.8, u + wu / 2 - 0.8, z + hz * 0.6, z + hz - 0.8, 0.36, GLASS, MAT.window);
    return;
  }
  put(u - wu / 2 - 0.5, u + wu / 2 + 0.5, z - 0.5, z + hz + 0.5, 0.12, col, MAT.paint);
  put(u - wu / 2, u + wu / 2, z, z + hz, 0.24, GLASS, MAT.window);
  put(u - 0.2, u + 0.2, z, z + hz, 0.34, col, MAT.paint);
  put(u - wu / 2, u + wu / 2, z + hz * 0.5 - 0.2, z + hz * 0.5 + 0.2, 0.34, col, MAT.paint);
  put(u - wu / 2 - 0.9, u + wu / 2 + 0.9, z - 1.1, z - 0.5, 0.5, STONE, MAT.concrete);
}

/** A pitched roof with the ridge along x, gable ends filled in the wall colour. */
function gableRoof(m: Mesh, w: number, d: number, z: number, rise: number, over: number, roof: RGB, wall: RGB, wallMat: number, roofMat: number = MAT.slate) {
  const hw = w / 2 + over, hd = d / 2 + over, t = 0.9;
  const zo = z - (over * rise) / (d / 2);
  for (const s of [-1, 1]) {
    m.quad([-hw, s * hd, zo], [hw, s * hd, zo], [hw, 0, z + rise], [-hw, 0, z + rise], roof, roofMat);
    m.quad([-hw, s * hd, zo - t], [hw, s * hd, zo - t], [hw, s * hd, zo], [-hw, s * hd, zo], shade(roof, 0.8), MAT.paint);
  }
  for (const e of [-1, 1]) {
    m.tri([e * w / 2, -d / 2, z], [e * w / 2, d / 2, z], [e * w / 2, 0, z + rise], wall, wallMat);
    m.quad([e * hw, -hd, zo - t], [e * hw, 0, z + rise - t], [e * hw, 0, z + rise], [e * hw, -hd, zo], WHITE, MAT.paint);
    m.quad([e * hw, hd, zo - t], [e * hw, 0, z + rise - t], [e * hw, 0, z + rise], [e * hw, hd, zo], WHITE, MAT.paint);
  }
  m.box(-hw, -0.7, z + rise - 0.2, hw, 0.7, z + rise + 0.7, shade(roof, 0.75), MAT.paint);
}
function chimney(m: Mesh, x: number, y: number, z0: number, z1: number, col: RGB = BRICK) {
  m.block(x, y, z0, 7, 5, z1 - z0, col, MAT.brick);
  m.block(x, y, z1, 8, 6, 1, STONE, MAT.concrete);
  for (const dx of [-1.8, 1.8]) m.cyl([x + dx, y, z1 + 1], "z", 3.2, 1.1, 0.9, [0.62, 0.34, 0.22], MAT.paint, 8);
}
function walls(m: Mesh, w: number, d: number, z0: number, z1: number, col: RGB, mat: number = MAT.brick) {
  m.box(-w / 2, -d / 2, z0, w / 2, d / 2, z1, col, mat, "z+z-");
}
function person(m: Mesh, x: number, y: number, z: number, col: RGB, seed: number) {
  const h = 21.5 + (seed % 3);  // about 1.7 m
  m.cyl([x, y, z], "z", h * 0.47, 1.9, 2.3, [0.16, 0.18, 0.26], MAT.matte, 8);
  m.cyl([x, y, z + h * 0.47], "z", h * 0.36, 2.6, 2.4, col, MAT.matte, 8);
  m.blob([x, y, z + h * 0.92], 1.9, 1.9, 2.1, [0.85, 0.65, 0.52], MAT.matte, seed, 0);
}
function post(m: Mesh, x: number, y: number, z0: number, z1: number, r = 0.7, col: RGB = IRON) { m.cyl([x, y, z0], "z", z1 - z0, r, r, col, MAT.paint, 8); }

// ---------- stations ----------
function platform(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h } = o, ramp = Math.min(55, w * 0.18), x0 = -w / 2 + ramp, x1 = w / 2 - ramp;
  m.box(x0, -d / 2 + 0.8, 0, x1, d / 2 - 0.8, h - 1.2, BRICK, MAT.brick, "z+z-");
  m.box(x0, -d / 2, h - 1.2, x1, d / 2, h, CONC, MAT.concrete);
  for (const s of [-1, 1]) m.box(x0, s * (d / 2 - 2.4) - 0.7, h, x1, s * (d / 2 - 2.4) + 0.7, h + 0.06, WHITE, MAT.matte, "z-");
  for (const e of [-1, 1]) {
    const xa = e > 0 ? x1 : x0, xb = e * w / 2;
    m.quad([xa, -d / 2, h], [xa, d / 2, h], [xb, d / 2, 0.2], [xb, -d / 2, 0.2], CONC, MAT.concrete);
    for (const s of [-1, 1]) m.tri([xa, s * (d / 2 - 0.4), 0], [xb, s * (d / 2 - 0.4), 0], [xa, s * (d / 2 - 0.4), h], BRICK, MAT.brick);
  }
  const n = Math.max(1, Math.round((x1 - x0) / 220));
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
    lampPost(m, x, 0, h, 48);
    if (d >= 40) { m.box(x + 30, -2.2, h + 5.6, x + 50, 2.2, h + 6.4, WOOD, MAT.timber); for (const bx of [x + 32, x + 48]) m.block(bx, 0, h, 1, 4.4, 5.6, IRON); }
  }
  for (let i = 0; i < Math.min(6, Math.floor(w / 130)); i++) person(m, x0 + 40 + i * 117, (i % 2 ? 1 : -1) * d * 0.22, h, [[0.6, 0.15, 0.12], [0.15, 0.3, 0.55], [0.8, 0.7, 0.2], [0.25, 0.45, 0.3]][i % 4] as RGB, o.seed + i);
}
function lampPost(m: Mesh, x: number, y: number, z: number, h: number) {
  post(m, x, y, z, z + h, 0.6, [0.12, 0.25, 0.18]);
  m.box(x - 5, y - 0.4, z + h - 0.5, x + 5, y + 0.4, z + h + 0.3, [0.12, 0.25, 0.18]);
  for (const s of [-1, 1]) m.block(x + s * 4.4, y, z + h - 2.4, 2.6, 2.2, 1.9, [1, 0.93, 0.7], MAT.glow);
}
function station(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o;
  walls(m, w, d * 0.72, 0, h, col);
  m.push().move(0, d * 0.14, 0);
  gableRoof(m, w, d * 0.72, h, d * 0.3, 3, SLATE, col, MAT.brick);
  m.pop();
  const wy = d * 0.14 - d * 0.36;   // front wall y
  const n = Math.max(3, Math.round(w / 34));
  m.push().move(0, d * 0.14, 0);
  for (let i = 0; i < n; i++) {
    const u = -w / 2 + ((i + 0.5) * w) / n;
    if (i === Math.floor(n / 2)) opening(m, "y-", d * 0.36, u, 0.5, 12, 27, "door", [0.14, 0.3, 0.2]);
    else opening(m, "y-", d * 0.36, u, 11, 11, 18);
    opening(m, "y+", d * 0.36, u, 11, 11, 18);
  }
  for (const e of ["x-", "x+"] as Face[]) opening(m, e, w / 2, 0, 11, 11, 18);
  chimney(m, -w * 0.3, 0, h + d * 0.2, h + d * 0.3 + 12, col); chimney(m, w * 0.3, 0, h + d * 0.2, h + d * 0.3 + 12, col);
  m.pop();
  // platform canopy along the front
  const cz = Math.min(h - 6, 42), cd = d * 0.28 + 6;
  m.quad([-w / 2 - 4, wy, cz + 4], [w / 2 + 4, wy, cz + 4], [w / 2 + 4, wy - cd, cz], [-w / 2 - 4, wy - cd, cz], [0.5, 0.52, 0.54], MAT.paint);
  m.box(-w / 2 - 4, wy - cd - 0.4, cz - 4, w / 2 + 4, wy - cd + 0.4, cz, CREAM, MAT.paint);
  for (let x = -w / 2 + 6; x <= w / 2 - 5; x += (w - 12) / Math.max(2, Math.round(w / 60))) { post(m, x, wy - cd + 4, 0, cz, 0.9, [0.14, 0.3, 0.2]); m.box(x - 0.4, wy - cd + 4, cz - 0.6, x + 0.4, wy, cz + 0.2, [0.14, 0.3, 0.2]); }
  m.box(-w * 0.28, wy - 0.5, 34, w * 0.28, wy - 0.2, 39, [0.1, 0.2, 0.42], MAT.matte); // nameboard
}
function shelter(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o;
  m.box(-w / 2, d / 2 - 1, 0, w / 2, d / 2, h, col, MAT.timber);
  for (const e of [-1, 1]) m.box(e * w / 2 - (e > 0 ? 1 : 0), -d / 2 + 4, 0, e * w / 2 + (e > 0 ? 0 : 1), d / 2, h, col, MAT.timber);
  m.quad([-w / 2 - 2, d / 2 + 2, h + 1], [w / 2 + 2, d / 2 + 2, h + 1], [w / 2 + 2, -d / 2 - 3, h + 5], [-w / 2 - 2, -d / 2 - 3, h + 5], SLATE, MAT.slate);
  m.box(-w / 2 + 4, d / 2 - 7, 5.5, w / 2 - 4, d / 2 - 2, 6.3, WOOD, MAT.timber);
  for (const x of [-w / 2 + 1, w / 2 - 1]) post(m, x, -d / 2 + 2, 0, h + 4, 0.8, shade(col, 0.6));
}
function signalBox(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o, base = h * 0.5;
  walls(m, w, d, 0, base, col);
  m.box(-w / 2 - 0.5, -d / 2 - 0.5, base, w / 2 + 0.5, d / 2 + 0.5, base + 1.2, CREAM, MAT.timber);
  walls(m, w, d, base + 1.2, base + 6, CREAM, MAT.timber);
  // glazed operating floor
  for (const f of ["y-", "y+"] as Face[]) for (let u = -w / 2 + 5; u < w / 2 - 4; u += 9) opening(m, f, d / 2 - 0.2, u + 2.5, base + 6.5, 8, h - base - 8, "window", CREAM);
  for (const f of ["x-", "x+"] as Face[]) for (let u = -d / 2 + 5; u < d / 2 - 4; u += 9) opening(m, f, w / 2 - 0.2, u + 2.5, base + 6.5, 8, h - base - 8, "window", CREAM);
  for (const x of [-w / 2 + 0.5, w / 2 - 0.5]) for (const y of [-d / 2 + 0.5, d / 2 - 0.5]) m.block(x, y, base + 6, 1.4, 1.4, h - base - 6, CREAM, MAT.timber);
  gableRoof(m, w, d, h, d * 0.28, 3.5, SLATE, CREAM, MAT.timber);
  for (const u of [-w / 4, w / 4]) opening(m, "y-", d / 2, u, 7, 8, 7);
  // outside stairs
  for (let i = 0; i < 9; i++) m.box(w / 2 + 1, -d / 2 + 2 + i * 3.2, base * (1 - (i + 1) / 9), w / 2 + 9, -d / 2 + 5.2 + i * 3.2, base * (1 - i / 9) + 0.6, WOOD, MAT.timber);
  opening(m, "x+", w / 2, -d / 2 + 6, base + 1.5, 9, 22, "door", [0.4, 0.12, 0.1]);
}
function footbridge(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o, dz = h, stair = Math.min(90, dz * 1.5), n = 14;
  m.box(-w / 2, -d / 2, dz, w / 2, d / 2, dz + 1.2, WOOD, MAT.timber);
  for (const s of [-1, 1]) {
    m.box(-w / 2, s * d / 2 - 0.4, dz - 2.5, w / 2, s * d / 2 + 0.4, dz + 14, col, MAT.paint);
    for (let x = -w / 2; x <= w / 2 + 0.1; x += w / Math.max(2, Math.round(w / 40))) m.block(x, s * d / 2, dz - 2.5, 1.2, 1.4, 17.5, shade(col, 0.8));
  }
  for (const e of [-1, 1]) {
    const x = e * (w / 2 - d / 2);
    for (const s of [-1, 1]) post(m, x + s * (d / 2 - 1), 0, 0, dz, 1.1, shade(col, 0.8));
    // stairs run down along y
    for (let i = 0; i < n; i++) {
      const y0 = d / 2 + (i * stair) / n, z = dz * (1 - (i + 1) / n);
      m.box(x - d / 2 + 1, y0, z, x + d / 2 - 1, y0 + stair / n + 0.2, z + dz / n, CONC, MAT.concrete);
    }
    for (const s of [-1, 1]) m.quad([x + s * (d / 2 - 0.6), d / 2, dz + 12], [x + s * (d / 2 - 0.6), d / 2 + stair, 12], [x + s * (d / 2 - 0.6), d / 2 + stair, 0], [x + s * (d / 2 - 0.6), d / 2, dz], col, MAT.paint);
  }
}
// ---------- buildings ----------
function house(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o, n = Math.max(1, Math.round(w / 58)), bw = w / n;
  walls(m, w, d, 0, h, col);
  gableRoof(m, w, d, h, d * 0.36, 2.5, o.seed % 2 ? SLATE : [0.52, 0.27, 0.2], col, MAT.brick);
  for (let i = 0; i < n; i++) {
    const c = -w / 2 + (i + 0.5) * bw;
    opening(m, "y-", d / 2, c - bw * 0.22, 0.5, 10, 26, "door", [[0.12, 0.25, 0.45], [0.5, 0.12, 0.1], [0.14, 0.32, 0.2], BLACK][(i + o.seed) % 4] as RGB);
    opening(m, "y-", d / 2, c + bw * 0.2, 10, 13, 16);
    for (const u of [-bw * 0.22, bw * 0.2]) opening(m, "y-", d / 2, c + u, h - 24, 11, 15);
    for (const u of [-bw * 0.2, bw * 0.2]) { opening(m, "y+", d / 2, c + u, 10, 11, 15); opening(m, "y+", d / 2, c + u, h - 24, 11, 15); }
    chimney(m, c + bw * 0.42 - 3.5, 0, h + d * 0.26, h + d * 0.36 + 11, col);
  }
}
function goodsShed(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o;
  walls(m, w, d, 0, h, col);
  gableRoof(m, w, d, h, d * 0.26, 4, SLATE, col, MAT.brick);
  for (const e of ["x-", "x+"] as Face[]) {
    const half = w / 2, c = -d * 0.18;
    const s = e === "x-" ? -1 : 1;
    m.box(s * (half + 0.05) - 0.2, c - 19, 0, s * (half + 0.05) + 0.2, c + 19, 46, [0.06, 0.06, 0.07], MAT.matte);   // rail doorway
    opening(m, e, half, d * 0.3, 22, 12, 16);
  }
  for (let u = -w / 2 + 22; u < w / 2 - 10; u += 40) { opening(m, "y+", d / 2, u, 20, 12, 18); opening(m, "y-", d / 2, u, 20, 12, 18); }
  m.box(-w * 0.2, -d / 2 - 0.4, 0, w * 0.2, -d / 2 + 0.2, 34, [0.25, 0.4, 0.3], MAT.timber);   // cart doors
  m.box(-w * 0.3, -d / 2 - 14, 0, w * 0.3, -d / 2, 14, CONC, MAT.concrete);                      // loading dock
}
function engineShed(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o, door = Math.min(52, d - 20), t = 2.5;
  // long walls
  for (const s of [-1, 1]) m.box(-w / 2, s * d / 2 - (s > 0 ? t : 0), 0, w / 2, s * d / 2 + (s > 0 ? 0 : t), h, col, MAT.brick);
  for (const e of [-1, 1]) {
    const x = e * w / 2;
    for (const s of [-1, 1]) m.box(x - (e > 0 ? t : 0), s > 0 ? door / 2 : -d / 2, 0, x + (e > 0 ? 0 : t), s > 0 ? d / 2 : -door / 2, h, col, MAT.brick);
    m.box(x - (e > 0 ? t : 0), -door / 2, 58, x + (e > 0 ? 0 : t), door / 2, h, col, MAT.brick);
    m.box(x - (e > 0 ? t : 0) - 0.2, -door / 2 - 1.5, 57, x + (e > 0 ? 0 : t) + 0.2, door / 2 + 1.5, 59.5, STONE, MAT.concrete);
  }
  gableRoof(m, w, d, h, d * 0.3, 3, SLATE, col, MAT.brick);
  for (let u = -w / 2 + 28; u < w / 2 - 14; u += 44) for (const f of ["y-", "y+"] as Face[]) opening(m, f, d / 2, u, 16, 14, 30);
  for (const x of [-w * 0.25, w * 0.25]) m.box(x - 9, -3, h + d * 0.3 - 2, x + 9, 3, h + d * 0.3 + 6, shade(SLATE, 0.8), MAT.paint);  // smoke vents
}
function warehouse(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o, bays = Math.max(2, Math.round(w / 70)), bw = w / bays;
  walls(m, w, d, 0, h, col);
  for (let i = 0; i < bays; i++) {
    const x0 = -w / 2 + i * bw, x1 = x0 + bw;
    m.quad([x0, -d / 2, h], [x0, d / 2, h], [x1, d / 2, h + 3], [x1, -d / 2, h + 3], SLATE, MAT.slate);
    m.quad([x0, -d / 2, h], [x0, d / 2, h], [x0, d / 2, h + 14], [x0, -d / 2, h + 14], GLASS, MAT.window);
    m.quad([x0, -d / 2, h + 14], [x0, d / 2, h + 14], [x1, d / 2, h + 3], [x1, -d / 2, h + 3], SLATE, MAT.slate);
    for (const s of [-1, 1]) m.tri([x0, s * d / 2, h], [x1, s * d / 2, h], [x0, s * d / 2, h + 14], col, MAT.brick);
    for (const f of ["y-", "y+"] as Face[]) { opening(m, f, d / 2, x0 + bw / 2, 12, bw * 0.5, 16); opening(m, f, d / 2, x0 + bw / 2, h - 26, bw * 0.5, 16); }
  }
  m.box(-12, -d / 2 - 0.4, 0, 12, -d / 2 + 0.2, 30, [0.2, 0.3, 0.42], MAT.paint);
  m.cyl([w / 2 - 12, d / 2 - 12, h], "z", 60, 5, 3.6, BRICK, MAT.brick, 14);
}
function waterTower(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o;
  walls(m, w * 0.8, d * 0.8, 0, h * 0.62, col);
  opening(m, "y-", d * 0.4, 0, 0.5, 9, 22, "door", [0.14, 0.3, 0.2]);
  m.box(-w / 2, -d / 2, h * 0.62, w / 2, d / 2, h, [0.2, 0.22, 0.24], MAT.paint);
  for (let x = -w / 2; x <= w / 2 + 0.1; x += w / 4) for (const s of [-1, 1]) m.block(x, s * (d / 2 + 0.2), h * 0.62, 0.8, 0.5, h * 0.38, [0.14, 0.15, 0.16]);
  m.box(-w / 2 + 1, -d / 2 + 1, h - 0.6, w / 2 - 1, d / 2 - 1, h - 0.3, [0.12, 0.2, 0.25], MAT.water);
  m.cyl([w / 2, 0, h * 0.5], "x", 14, 1.2, 1.2, IRON, MAT.paint, 8); m.cyl([w / 2 + 14, 0, h * 0.5 - 12], "z", 12, 1.6, 1.2, [0.3, 0.2, 0.14], MAT.matte, 8);
}
function hut(m: Mesh, o: BuildOpts) {
  walls(m, o.w, o.d, 0, o.hgt, o.col, MAT.timber);
  gableRoof(m, o.w, o.d, o.hgt, o.d * 0.3, 2, [0.2, 0.2, 0.22], o.col, MAT.timber, MAT.paint);
  opening(m, "y-", o.d / 2, -o.w * 0.2, 0.5, 9, 22, "door", shade(o.col, 0.6)); opening(m, "y-", o.d / 2, o.w * 0.22, 12, 8, 9);
}
// ---------- signals and lineside ----------
function colourLight(m: Mesh, o: BuildOpts) {
  const h = o.hgt;
  m.block(0, 0, 0, 5, 5, 1.2, CONC, MAT.concrete);
  post(m, 0, 0, 1.2, h - 14, 0.8, [0.7, 0.72, 0.74]);
  m.box(-2.4, -1.1, h - 16, 2.4, 1.1, h, BLACK);
  m.box(-3.6, -1.3, h - 17, 3.6, -1.1, h + 1, BLACK, MAT.matte);
  const cols: RGB[] = [[0.1, 0.9, 0.25], [1, 0.75, 0.05], [1, 0.1, 0.08]];
  cols.forEach((c, i) => {
    const lit = i === 2;
    m.cyl([0, -1.6, h - 3 - i * 5], "y", 0.5, 1.5, 1.5, lit ? c : shade(c, 0.22), lit ? MAT.glow : MAT.glass, 10);
    m.box(-1.9, -3, h - 1.3 - i * 5, 1.9, -1.1, h - 0.9 - i * 5, BLACK);
  });
  for (let z = 6; z < h - 18; z += 3) m.box(0.9, -0.6, z, 2.4, 0.6, z + 0.4, IRON);
  m.box(2.4, -0.3, 6, 2.8, 0.3, h - 16, IRON);
}
function semaphore(m: Mesh, o: BuildOpts) {
  const h = o.hgt;
  m.cyl([0, 0, 0], "z", h, 1.3, 0.8, WHITE, MAT.paint, 8); m.cyl([0, 0, 0], "z", 14, 1.4, 1.3, BLACK, MAT.paint, 8);
  m.cyl([0, 0, h], "z", 3, 1, 0, WHITE, MAT.paint, 8);
  m.box(-0.5, -1.6, h - 9, 14, -1.2, h - 5.6, RED_SIG, MAT.paint); m.box(10, -1.7, h - 9, 11.5, -1.1, h - 5.6, WHITE, MAT.paint);
  m.box(-5.5, -1.7, h - 10, -0.8, -1.2, h - 4.6, BLACK);
  m.cyl([-3.9, -1.9, h - 6.2], "y", 0.4, 1.2, 1.2, [1, 0.1, 0.08], MAT.glow, 10); m.cyl([-3.9, -1.9, h - 8.8], "y", 0.4, 1.2, 1.2, [0.03, 0.2, 0.12], MAT.glass, 10);
  for (let z = 4; z < h - 12; z += 3) m.box(1.1, -0.6, z, 2.6, 0.6, z + 0.4, IRON);
}
const RED_SIG: RGB = [0.8, 0.1, 0.08];
function bufferStop(m: Mesh) {
  // rail-built stop: track comes in along +x and ends at x = 0
  for (const s of [-1, 1]) {
    const y = s * 8.25;
    m.quad([-22, y - 0.5, 4.2], [-22, y + 0.5, 4.2], [-2, y + 0.5, 16], [-2, y - 0.5, 16], [0.35, 0.2, 0.14], MAT.rust);
    m.box(-22, y - 0.5, 4, -2, y + 0.5, 5, [0.35, 0.2, 0.14], MAT.rust);
    m.box(-3, y - 0.6, 4, -1.6, y + 0.6, 16.5, [0.35, 0.2, 0.14], MAT.rust);
    m.quad([6, y - 0.5, 4.2], [6, y + 0.5, 4.2], [-2, y + 0.5, 13], [-2, y - 0.5, 13], [0.35, 0.2, 0.14], MAT.rust);
  }
  m.box(-4.4, -15, 11.5, -2.6, 15, 16.5, [0.75, 0.12, 0.1], MAT.timber);
  m.cyl([-4.9, 0, 14], "x", 0.5, 1.3, 1.3, [1, 0.1, 0.08], MAT.glow, 10);
}
function levelCrossing(m: Mesh, o: BuildOpts) {
  // track along x; the road crosses along y. w = road width, d = road length
  const { w, d } = o, rail = 4.1;
  m.box(-w / 2, -d / 2, 0, w / 2, d / 2, 0.35, TARMAC, MAT.concrete, "z-");
  for (const s of [-1, 1]) {
    m.quad([-w / 2, s * 34, 0.35], [w / 2, s * 34, 0.35], [w / 2, s * 17, rail], [-w / 2, s * 17, rail], TARMAC, MAT.concrete);
    m.box(-w / 2, s * 12.8 - 3.2, 0, w / 2, s * 12.8 + 3.2, rail, WOOD, MAT.timber);
  }
  m.box(-w / 2, -6.6, 0, w / 2, 6.6, rail - 0.3, WOOD, MAT.timber);
  for (const s of [-1, 1]) {
    const y = s * 30;
    post(m, -w / 2 - 3, y, 0, 18, 1.1, WHITE);
    for (let i = 0; i < 7; i++) m.box(-w / 2 - 2 + (i * (w + 4)) / 7, y - 0.4, 14, -w / 2 - 2 + ((i + 1) * (w + 4)) / 7, y + 0.4, 16.2, i % 2 ? WHITE : RED_SIG, MAT.paint);
    m.cyl([0, y - s * 0.6, 15.1], "y", 0.4, 2.4, 2.4, RED_SIG, MAT.paint, 12);
    post(m, w / 2 + 4, y, 0, 26, 0.6, IRON); m.box(w / 2 + 1.5, y - 0.8, 22, w / 2 + 6.5, y + 0.8, 27, BLACK);
    for (const dx of [-1.4, 1.4]) m.cyl([w / 2 + 4 + dx, y - s * 0.9 - 0.2, 24.5], "y", 0.4, 1, 1, [1, 0.1, 0.08], MAT.glow, 8);
  }
}
function fence(m: Mesh, o: BuildOpts) {
  const { w, hgt: h, col } = o, n = Math.max(1, Math.round(w / 24));
  for (let i = 0; i <= n; i++) m.block(-w / 2 + (i * w) / n, 0, 0, 1.4, 1.4, h, col, MAT.timber);
  for (const z of [h * 0.3, h * 0.6, h * 0.88]) m.box(-w / 2, -0.35, z - 0.6, w / 2, 0.35, z + 0.6, col, MAT.timber);
}
function telegraphPole(m: Mesh, o: BuildOpts) {
  const h = o.hgt;
  m.cyl([0, 0, 0], "z", h, 1.3, 0.9, [0.3, 0.22, 0.15], MAT.timber, 8);
  for (const z of [h - 5, h - 11, h - 17]) { m.box(-0.5, -9, z, 0.5, 9, z + 1, [0.3, 0.22, 0.15], MAT.timber); for (const y of [-8, -4, 4, 8]) m.cyl([0, y, z + 1], "z", 1.6, 0.6, 0.4, WHITE, MAT.paint, 6); }
}
// ---------- bridges and tunnels ----------
function tunnelPortal(m: Mesh, o: BuildOpts) {
  // the track runs along x through the opening; the hill is on the -x side
  const { d, hgt: h, col } = o, t = o.w, ow = 26, spring = 44, n = 12;
  const y0 = -d / 2, y1 = d / 2;
  m.box(-t / 2, y0, 0, t / 2, -ow, h, col, MAT.concrete); m.box(-t / 2, ow, 0, t / 2, y1, h, col, MAT.concrete);
  let prev: [number, number] = [-ow, spring];
  for (let i = 1; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI, p: [number, number] = [Math.cos(a) * ow, spring + Math.sin(a) * ow];
    for (const x of [-t / 2, t / 2]) m.quad([x, prev[0], prev[1]], [x, p[0], p[1]], [x, p[0], h], [x, prev[0], h], col, MAT.concrete);
    m.quad([-t / 2, prev[0], prev[1]], [t / 2, prev[0], prev[1]], [t / 2, p[0], p[1]], [-t / 2, p[0], p[1]], shade(col, 0.6), MAT.concrete);
    m.quad([t / 2, prev[0] * 1.14, spring + (prev[1] - spring) * 1.14], [t / 2 + 1, prev[0] * 1.14, spring + (prev[1] - spring) * 1.14], [t / 2 + 1, p[0] * 1.14, spring + (p[1] - spring) * 1.14], [t / 2, p[0] * 1.14, spring + (p[1] - spring) * 1.14], shade(col, 1.15), MAT.concrete);
    prev = p;
  }
  m.box(-t / 2, y0, h, t / 2, y1, h + 0.01, col, MAT.concrete, "z-");
  m.box(-t / 2 - 1, y0 - 1.5, h, t / 2 + 1.5, y1 + 1.5, h + 3, shade(col, 1.12), MAT.concrete);
  m.quad([-t / 2, -ow, 0], [-t / 2, ow, 0], [-t / 2, ow, spring + ow], [-t / 2, -ow, spring + ow], [0.02, 0.02, 0.025], MAT.matte);   // darkness behind
  // a grassy bank behind and beside the portal
  m.blob([-t / 2 - 60, 0, 0], 85, d * 0.85, h + 14, GRASS, MAT.grass, o.seed, 0.12);
}
function roadBridge(m: Mesh, o: BuildOpts) {
  // the track runs along x under the arch; the road crosses along y. w = road width, d = bridge length
  const { w, d, hgt: h, col } = o, ow = Math.min(d / 2 - 14, 60), spring = Math.max(18, h - 12 - ow * 0.55), rise = h - 8 - spring, n = 14;
  const hw = w / 2;
  for (const s of [-1, 1]) m.box(-hw, s > 0 ? ow : -d / 2, 0, hw, s > 0 ? d / 2 : -ow, h, col, MAT.brick);
  let prev: [number, number] = [-ow, spring];
  for (let i = 1; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI, p: [number, number] = [Math.cos(a) * ow, spring + Math.sin(a) * rise];
    for (const x of [-hw, hw]) m.quad([x, prev[0], prev[1]], [x, p[0], p[1]], [x, p[0], h], [x, prev[0], h], col, MAT.brick);
    m.quad([-hw, prev[0], prev[1]], [hw, prev[0], prev[1]], [hw, p[0], p[1]], [-hw, p[0], p[1]], shade(col, 0.7), MAT.brick);
    prev = p;
  }
  m.box(-hw + 2, -d / 2, h, hw - 2, d / 2, h + 0.6, TARMAC, MAT.concrete);
  for (const e of [-1, 1]) { m.box(e * hw - (e > 0 ? 2 : 0), -d / 2, h, e * hw + (e > 0 ? 0 : 2), d / 2, h + 15, col, MAT.brick); m.box(e * hw - (e > 0 ? 2.6 : -0.6) - 0.6, -d / 2, h + 15, e * hw + (e > 0 ? 0.6 : 2.6), d / 2, h + 16.2, STONE, MAT.concrete); }
  for (let y = -d / 2 + 6; y < d / 2 - 8; y += 22) m.box(-0.5, y, h + 0.6, 0.5, y + 11, h + 0.66, WHITE, MAT.matte, "z-");
  // approach ramps
  for (const s of [-1, 1]) {
    const ya = s * d / 2, yb = s * (d / 2 + h * 2.6);
    m.quad([-hw + 2, ya, h + 0.6], [hw - 2, ya, h + 0.6], [hw - 2, yb, 0.2], [-hw + 2, yb, 0.2], TARMAC, MAT.concrete);
    for (const e of [-1, 1]) m.tri([e * (hw - 2), ya, 0], [e * (hw - 2), yb, 0], [e * (hw - 2), ya, h + 0.6], GRASS, MAT.grass);
    for (const e of [-1, 1]) m.quad([e * (hw - 2), ya, h + 0.6], [e * (hw - 2), yb, 0.2], [e * (hw + 22), yb, 0], [e * (hw + 22), ya, 0], GRASS, MAT.grass);
  }
}
function girderBridge(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o;
  m.box(-w / 2, -d / 2 + 1, -3, w / 2, d / 2 - 1, -0.2, [0.25, 0.24, 0.22], MAT.timber);
  for (const s of [-1, 1]) {
    m.box(-w / 2, s * d / 2 - 0.5, -6, w / 2, s * d / 2 + 0.5, h, col, MAT.paint);
    m.box(-w / 2, s * d / 2 - 2, h, w / 2, s * d / 2 + 2, h + 1, shade(col, 0.85), MAT.paint); m.box(-w / 2, s * d / 2 - 2, -7, w / 2, s * d / 2 + 2, -6, shade(col, 0.85), MAT.paint);
    for (let x = -w / 2; x <= w / 2 + 0.1; x += w / Math.max(2, Math.round(w / 26))) m.block(x, s * (d / 2 + (s * 0.9)), -6, 0.9, 1.4, h + 6, shade(col, 0.8));
  }
  for (const e of [-1, 1]) m.box(e * w / 2 - (e > 0 ? 0 : 14), -d / 2 - 4, -60, e * w / 2 + (e > 0 ? 14 : 0), d / 2 + 4, -3, STONE, MAT.concrete);
}
function retainingWall(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o;
  m.box(-w / 2, -d / 2, 0, w / 2, d / 2, h, col, MAT.brick);
  m.box(-w / 2, -d / 2 - 0.8, h, w / 2, d / 2 + 0.8, h + 1.6, STONE, MAT.concrete);
  for (let x = -w / 2 + 20; x < w / 2 - 10; x += 60) m.box(x - 3, -d / 2 - 1.6, 0, x + 3, -d / 2, h, shade(col, 0.92), MAT.brick);
}
// ---------- nature ----------
function tree(m: Mesh, o: BuildOpts) {
  const { d, hgt: h, col, seed } = o, r = d / 2;
  const rnd = (k: number) => { const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  m.cyl([0, 0, 0], "z", h * 0.5, r * 0.11, r * 0.06, [0.3, 0.24, 0.18], MAT.timber, 8, 0);
  m.cyl([0, 0, h * 0.35], "z", h * 0.25, r * 0.07, r * 0.03, [0.3, 0.24, 0.18], MAT.timber, 6, 0);
  m.blob([0, 0, h * 0.68], r * 0.8, r * 0.8, h * 0.32, col, MAT.foliage, seed, 0.3);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd(i) * 1.2, k = 0.42 + rnd(i + 9) * 0.2;
    m.blob([Math.cos(a) * r * k, Math.sin(a) * r * k, h * (0.5 + rnd(i + 3) * 0.18)], r * 0.55, r * 0.55, h * 0.2, shade(col, 0.85 + rnd(i + 20) * 0.3), MAT.foliage, seed + i, 0.34);
  }
}
function conifer(m: Mesh, o: BuildOpts) {
  const { d, hgt: h, col } = o, r = d / 2;
  m.cyl([0, 0, 0], "z", h * 0.25, r * 0.12, r * 0.1, [0.28, 0.2, 0.14], MAT.timber, 8, 0);
  for (let i = 0; i < 5; i++) m.cyl([0, 0, h * (0.14 + i * 0.16)], "z", h * 0.3, r * (1 - i * 0.17), r * (0.12 - i * 0.02), shade(col, 0.85 + (i % 2) * 0.2), MAT.foliage, 10, 1);
}
function bush(m: Mesh, o: BuildOpts) {
  m.blob([0, 0, o.hgt * 0.42], o.w / 2, o.d / 2, o.hgt * 0.55, o.col, MAT.foliage, o.seed, 0.35);
  m.blob([o.w * 0.2, -o.d * 0.15, o.hgt * 0.3], o.w * 0.32, o.d * 0.32, o.hgt * 0.4, shade(o.col, 1.15), MAT.foliage, o.seed + 4, 0.35);
}
function hedge(m: Mesh, o: BuildOpts) {
  const n = Math.max(1, Math.round(o.w / (o.d * 1.6)));
  for (let i = 0; i < n; i++) m.blob([-o.w / 2 + ((i + 0.5) * o.w) / n, 0, o.hgt * 0.5], (o.w / n) * 0.62, o.d / 2, o.hgt * 0.55, shade(o.col, 0.9 + ((i * 7) % 5) * 0.05), MAT.foliage, o.seed + i, 0.25);
}
function groundPatch(m: Mesh, o: BuildOpts, mat: number, z = 0.3) {
  m.box(-o.w / 2, -o.d / 2, 0, o.w / 2, o.d / 2, z, o.col, mat, "z-");
}
function pond(m: Mesh, o: BuildOpts) {
  const n = 24, pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, k = 1 + 0.08 * Math.sin(a * 3 + o.seed); pts.push({ x: (Math.cos(a) * o.w * k) / 2, y: (Math.sin(a) * o.d * k) / 2 }); }
  m.prism(pts.map((p) => ({ x: p.x * 1.08, y: p.y * 1.1 })), 0, 0.25, [0.36, 0.4, 0.22], [0.36, 0.4, 0.22], MAT.grass);
  m.prism(pts, 0, 0.4, o.col, o.col, MAT.water);
}
function hill(m: Mesh, o: BuildOpts) {
  const U = 22, V = 8, base = m.vertexCount;
  const rnd = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7 + o.seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) {
    const t = j / V, a = (i / U) * Math.PI * 2, k = (1 - t) * (1 + (rnd(i % U, j) - 0.5) * 0.18);
    const z = o.hgt * (1 - Math.pow(1 - t, 1.8)) * (j === V ? 1 : 0.94 + rnd(i % U, j + 30) * 0.1);
    const n: V3 = [Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.8];
    m.v([(Math.cos(a) * o.w * k) / 2, (Math.sin(a) * o.d * k) / 2, z], n, shade(o.col, 0.85 + rnd(i % U, j + 60) * 0.3), t < 0.25 && o.hgt > 60 ? MAT.grass : MAT.grass);
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) { const a = base + j * (U + 1) + i, b = a + U + 1; m.idx.push(a, a + 1, b + 1, a, b + 1, b); }
}
// ---------- roads and people ----------
function road(m: Mesh, o: BuildOpts) {
  m.box(-o.w / 2, -o.d / 2, 0, o.w / 2, o.d / 2, 0.4, TARMAC, MAT.concrete, "z-");
  for (let x = -o.w / 2 + 8; x < o.w / 2 - 14; x += 34) m.box(x, -0.6, 0.4, x + 16, 0.6, 0.46, WHITE, MAT.matte, "z-");
  for (const s of [-1, 1]) m.box(-o.w / 2, s * (o.d / 2 - 1.6) - 0.5, 0.4, o.w / 2, s * (o.d / 2 - 1.6) + 0.5, 0.46, WHITE, MAT.matte, "z-");
}
function car(m: Mesh, o: BuildOpts) {
  const L = 56, W = 23;
  for (const x of [-17, 17]) for (const s of [-1, 1]) m.cyl([x, s > 0 ? W / 2 - 3.2 : -W / 2 + 0.4, 4], "y", 2.8, 4, 4, BLACK, MAT.matte, 12, 3, [0.6, 0.6, 0.62]);
  m.box(-L / 2, -W / 2 + 0.6, 2.6, L / 2, W / 2 - 0.6, 10.5, o.col, MAT.paint);
  m.box(-L / 2 + 14, -W / 2 + 1.6, 10.5, L / 2 - 12, W / 2 - 1.6, 17.5, GLASS, MAT.glass);
  m.box(-L / 2 + 15, -W / 2 + 1.4, 17.2, L / 2 - 14, W / 2 - 1.4, 18, o.col, MAT.paint);
  for (const y of [-7.5, 7.5]) { m.box(L / 2 - 0.1, y - 2, 6.5, L / 2 + 0.2, y + 2, 8.8, [1, 0.96, 0.8], MAT.glow); m.box(-L / 2 - 0.2, y - 2, 6.5, -L / 2 + 0.1, y + 2, 8.5, [0.9, 0.1, 0.08], MAT.glow); }
}
function lorry(m: Mesh, o: BuildOpts) {
  const W = 30;
  for (const x of [-38, -26, 34]) for (const s of [-1, 1]) m.cyl([x, s > 0 ? W / 2 - 4 : -W / 2 + 0.6, 6], "y", 3.4, 6, 6, BLACK, MAT.matte, 12, 3, [0.6, 0.6, 0.62]);
  m.box(-50, -W / 2 + 2, 8, 50, W / 2 - 2, 12, IRON);
  m.box(-50, -W / 2 + 0.5, 12, 22, W / 2 - 0.5, 46, WHITE, MAT.paint);
  m.box(26, -W / 2 + 1, 10, 50, W / 2 - 1, 38, o.col, MAT.paint);
  m.box(49.9, -W / 2 + 3, 24, 50.3, W / 2 - 3, 35, GLASS, MAT.glass);
  for (const s of [-1, 1]) m.box(34, s * (W / 2 - 1) - 0.2, 24, 46, s * (W / 2 - 1) + 0.2, 35, GLASS, MAT.glass);
}
function people(m: Mesh, o: BuildOpts) {
  const cols: RGB[] = [[0.6, 0.15, 0.12], [0.15, 0.3, 0.55], [0.8, 0.7, 0.2], [0.25, 0.45, 0.3], [0.3, 0.3, 0.32]];
  const n = Math.max(1, Math.round((o.w * o.d) / 250));
  for (let i = 0; i < n; i++) { const s = Math.sin(o.seed * 9.1 + i * 4.7), c = Math.cos(o.seed * 3.3 + i * 7.9); person(m, (s * o.w) / 2.4, (c * o.d) / 2.4, 0, cols[(i + o.seed) % cols.length], o.seed + i); }
}
// ---------- the room (full size) ----------
function furniture(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o;
  m.box(-w / 2, -d / 2, 0, w / 2, d / 2, h, col, MAT.ply);
  m.box(-w / 2 + 18, -d / 2 - 2, 60, w / 2 - 18, -d / 2, h - 18, shade(col, 0.9), MAT.ply);
  for (const x of [-w * 0.22, w * 0.22]) m.box(x - 60, -d / 2 - 14, h * 0.55, x + 60, -d / 2 - 2, h * 0.55 + 12, [0.6, 0.6, 0.62], MAT.steel);
}
function bed(m: Mesh, o: BuildOpts) {
  const { w, d, hgt: h, col } = o;
  m.box(-w / 2, -d / 2, 0, w / 2, d / 2, h * 0.55, [0.72, 0.6, 0.42], MAT.ply);
  m.box(-w / 2 + 20, -d / 2 + 20, h * 0.55, w / 2 - 20, d / 2 - 20, h, [0.93, 0.93, 0.9], MAT.matte);
  m.box(-w / 2 + 20 + w * 0.3, -d / 2 + 14, h, w / 2 - 14, d / 2 - 14, h + 40, col, MAT.matte);
  m.box(-w / 2 + 50, -d / 2 + 110, h, -w / 2 + Math.min(520, w * 0.27), d / 2 - 110, h + 70, [0.97, 0.97, 0.95], MAT.matte);
  m.box(-w / 2, -d / 2, 0, -w / 2 + 30, d / 2, h + 380, [0.72, 0.6, 0.42], MAT.ply);
}
function backscene(m: Mesh, o: BuildOpts) {
  const { w, hgt: h } = o, n = 8;
  for (let i = 0; i < n; i++) {
    const z0 = (h * i) / n, z1 = (h * (i + 1)) / n, c = mix([0.82, 0.88, 0.93], [0.42, 0.62, 0.86], (i + 0.5) / n);
    m.box(-w / 2, -3, z0, w / 2, 3, z1, c, MAT.matte, i === 0 ? "" : "z-");
  }
  // distant hills painted along the bottom
  const k = Math.max(6, Math.round(w / 90));
  for (let i = 0; i < k; i++) {
    const x0 = -w / 2 + (i * w) / k, x1 = x0 + w / k, a = h * (0.12 + 0.07 * Math.sin(i * 1.7 + o.seed)), b = h * (0.12 + 0.07 * Math.sin((i + 1) * 1.7 + o.seed));
    m.quad([x0, -3.3, 0], [x1, -3.3, 0], [x1, -3.3, b], [x0, -3.3, a], [0.46, 0.58, 0.5], MAT.matte);
  }
}

export interface SceneryDef {
  id: string; name: string;
  group: "Stations" | "Buildings" | "Signals and lineside" | "Bridges and tunnels" | "Trees and ground" | "Roads and people" | "In the room";
  w: number; d: number; hgt: number;
  /** Which sizes can be changed, with their labels. */
  sizes: { w?: string; d?: string; hgt?: string };
  color: string; colors?: string[];
  /** Snaps onto track (centred on it, turned along it). */
  onTrack?: boolean;
  /** Lies flat on the board and is drawn under the track. */
  flat?: boolean;
  /** Full-size object: not scaled with the model scale. */
  real?: boolean;
  /** Stands on the room's floor, not on the baseboard. */
  floor?: boolean;
  build: (m: Mesh, o: BuildOpts) => void;
}

const BRICKS = ["#99513a", "#b06b4a", "#8d8676", "#d9c9a3"], GREENS = ["#3f6b2a", "#56803a", "#2f5a2c", "#7a8c3a"];
export const SCENERY: SceneryDef[] = [
  { id: "platform", name: "Platform", group: "Stations", w: 700, d: 60, hgt: 14, sizes: { w: "Length", d: "Width" }, color: "#a8a59e", build: platform },
  { id: "station", name: "Station building", group: "Stations", w: 220, d: 110, hgt: 48, sizes: { w: "Length", d: "Depth" }, color: "#99513a", colors: BRICKS, build: station },
  { id: "shelter", name: "Platform shelter", group: "Stations", w: 80, d: 30, hgt: 34, sizes: { w: "Length" }, color: "#d9c9a3", colors: ["#d9c9a3", "#2f5a3c", "#7a3b24"], build: shelter },
  { id: "signal-box", name: "Signal box", group: "Stations", w: 95, d: 46, hgt: 62, sizes: {}, color: "#99513a", colors: BRICKS, build: signalBox },
  { id: "footbridge", name: "Footbridge", group: "Stations", w: 180, d: 24, hgt: 66, sizes: { w: "Span", hgt: "Clearance" }, color: "#2f5a3c", colors: ["#2f5a3c", "#6d1a1f", "#3a4a66", "#8d8676"], build: footbridge },
  { id: "lamp", name: "Platform lamp", group: "Stations", w: 12, d: 6, hgt: 50, sizes: {}, color: "#1f4030", build: (m, o) => lampPost(m, 0, 0, 0, o.hgt) },
  { id: "house", name: "Terraced houses", group: "Buildings", w: 174, d: 84, hgt: 72, sizes: { w: "Length" }, color: "#99513a", colors: BRICKS, build: house },
  { id: "goods-shed", name: "Goods shed", group: "Buildings", w: 220, d: 110, hgt: 62, sizes: { w: "Length" }, color: "#99513a", colors: BRICKS, build: goodsShed },
  { id: "engine-shed", name: "Engine shed, one road", group: "Buildings", w: 300, d: 84, hgt: 70, sizes: { w: "Length" }, color: "#99513a", colors: BRICKS, onTrack: true, build: engineShed },
  { id: "warehouse", name: "Factory or warehouse", group: "Buildings", w: 280, d: 130, hgt: 80, sizes: { w: "Length", d: "Depth" }, color: "#8a4a36", colors: BRICKS, build: warehouse },
  { id: "water-tower", name: "Water tower", group: "Buildings", w: 60, d: 44, hgt: 92, sizes: {}, color: "#99513a", colors: BRICKS, build: waterTower },
  { id: "hut", name: "Lineside hut", group: "Buildings", w: 40, d: 30, hgt: 30, sizes: {}, color: "#5b4a3a", colors: ["#5b4a3a", "#2f5a3c", "#d9c9a3"], build: hut },
  { id: "signal-colour", name: "Colour light signal", group: "Signals and lineside", w: 8, d: 8, hgt: 74, sizes: {}, color: "#222222", build: colourLight },
  { id: "signal-semaphore", name: "Semaphore signal", group: "Signals and lineside", w: 20, d: 6, hgt: 96, sizes: {}, color: "#eeeeee", build: semaphore },
  { id: "buffer-stop", name: "Buffer stop", group: "Signals and lineside", w: 28, d: 32, hgt: 17, sizes: {}, color: "#7a3b24", onTrack: true, build: (m) => bufferStop(m) },
  { id: "level-crossing", name: "Level crossing", group: "Signals and lineside", w: 90, d: 200, hgt: 30, sizes: { w: "Road width", d: "Road length" }, color: "#333333", onTrack: true, flat: true, build: levelCrossing },
  { id: "fence", name: "Post and rail fence", group: "Signals and lineside", w: 300, d: 4, hgt: 16, sizes: { w: "Length" }, color: "#d9d4c4", colors: ["#d9d4c4", "#5b4a3a", "#2f5a3c"], build: fence },
  { id: "telegraph-pole", name: "Telegraph pole", group: "Signals and lineside", w: 4, d: 20, hgt: 110, sizes: {}, color: "#4a3a2a", build: telegraphPole },
  { id: "tunnel-portal", name: "Tunnel mouth", group: "Bridges and tunnels", w: 14, d: 110, hgt: 92, sizes: {}, color: "#8d8676", colors: ["#8d8676", "#99513a", "#6f6a62"], onTrack: true, build: tunnelPortal },
  { id: "road-bridge", name: "Road bridge over the line", group: "Bridges and tunnels", w: 76, d: 190, hgt: 82, sizes: { d: "Length" }, color: "#99513a", colors: BRICKS, onTrack: true, build: roadBridge },
  { id: "girder-bridge", name: "Plate girder bridge", group: "Bridges and tunnels", w: 300, d: 50, hgt: 22, sizes: { w: "Length" }, color: "#3d4b45", colors: ["#3d4b45", "#5a5f66", "#6d1a1f"], onTrack: true, build: girderBridge },
  { id: "retaining-wall", name: "Retaining wall", group: "Bridges and tunnels", w: 400, d: 8, hgt: 70, sizes: { w: "Length", hgt: "Height" }, color: "#99513a", colors: BRICKS, build: retainingWall },
  { id: "tree", name: "Broadleaf tree", group: "Trees and ground", w: 90, d: 90, hgt: 150, sizes: { d: "Crown", hgt: "Height" }, color: "#3f6b2a", colors: [...GREENS, "#a9762a"], build: tree },
  { id: "conifer", name: "Fir tree", group: "Trees and ground", w: 56, d: 56, hgt: 170, sizes: { d: "Spread", hgt: "Height" }, color: "#24492c", colors: ["#24492c", "#2f5a2c", "#3a5a3a"], build: conifer },
  { id: "bush", name: "Bush", group: "Trees and ground", w: 36, d: 30, hgt: 24, sizes: {}, color: "#56803a", colors: GREENS, build: bush },
  { id: "hedge", name: "Hedge", group: "Trees and ground", w: 300, d: 14, hgt: 20, sizes: { w: "Length" }, color: "#2f5a2c", colors: GREENS, build: hedge },
  { id: "grass", name: "Grass", group: "Trees and ground", w: 400, d: 300, hgt: 1, sizes: { w: "Length", d: "Width" }, color: "#5d8a3a", colors: ["#5d8a3a", "#7a8c3a", "#a89a5a", "#4a7a36"], flat: true, build: (m, o) => groundPatch(m, o, MAT.grass) },
  { id: "ballast-area", name: "Yard ballast or gravel", group: "Trees and ground", w: 400, d: 200, hgt: 1, sizes: { w: "Length", d: "Width" }, color: "#8a857c", colors: ["#8a857c", "#6f6a62", "#a89a7a", "#4a4744"], flat: true, build: (m, o) => groundPatch(m, o, MAT.ballast, 0.6) },
  { id: "pond", name: "Pond", group: "Trees and ground", w: 220, d: 150, hgt: 1, sizes: { w: "Length", d: "Width" }, color: "#2e4a52", flat: true, build: pond },
  { id: "hill", name: "Hill", group: "Trees and ground", w: 400, d: 300, hgt: 110, sizes: { w: "Length", d: "Width", hgt: "Height" }, color: "#5d8a3a", colors: ["#5d8a3a", "#7a8c3a", "#8d8676"], build: hill },
  { id: "road", name: "Road", group: "Roads and people", w: 500, d: 84, hgt: 1, sizes: { w: "Length", d: "Width" }, color: "#333333", flat: true, build: road },
  { id: "car", name: "Car", group: "Roads and people", w: 56, d: 23, hgt: 18, sizes: {}, color: "#8f1d16", colors: ["#8f1d16", "#1d4f8f", "#e8e6df", "#16181a", "#2e6b3c", "#e0a015"], build: car },
  { id: "lorry", name: "Lorry", group: "Roads and people", w: 100, d: 30, hgt: 46, sizes: {}, color: "#1d4f8f", colors: ["#1d4f8f", "#8f1d16", "#2e6b3c", "#e0a015"], build: lorry },
  { id: "people", name: "People", group: "Roads and people", w: 40, d: 24, hgt: 24, sizes: { w: "Length", d: "Width" }, color: "#666666", build: people },
  { id: "bed", name: "Bed", group: "In the room", w: 2000, d: 900, hgt: 430, sizes: { w: "Length", d: "Width", hgt: "Height" }, color: "#8a94a8", colors: ["#8a94a8", "#3a4a66", "#8f6a5a", "#5d7a5a"], real: true, floor: true, build: bed },
  { id: "furniture", name: "Cupboard or shelf unit", group: "In the room", w: 800, d: 400, hgt: 800, sizes: { w: "Width", d: "Depth", hgt: "Height" }, color: "#d6b98a", colors: ["#d6b98a", "#f2f0ea", "#6b4a32", "#3a3d42"], real: true, floor: true, build: furniture },
  { id: "backscene", name: "Backscene board", group: "In the room", w: 1200, d: 6, hgt: 300, sizes: { w: "Length", hgt: "Height" }, color: "#9cc3e6", real: true, build: backscene },
];

export const sceneryDef = (id: string) => SCENERY.find((s) => s.id === id);
