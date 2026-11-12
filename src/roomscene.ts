// Scenery, the room and baseboard legs for the 3D view, built with the scenery mesh builder (millimetres, z up).
// view3d.ts copies the result into its own mesh.
import { Vec, pointInPoly } from "./geom";
import { MAT, Mesh, RGB, V3, rgb, shade } from "./gfx/mesh";
import { Board, Project } from "./model";
import { getModule, overallDepth } from "./modules";
import { buildObject, objectDef } from "./objects";

const LEG: RGB = [0.78, 0.66, 0.47];
/** Floor to baseboard top when the plan has no room, mm. */
export const DEFAULT_BOARD_HEIGHT = 950;

function boardLegs(m: Mesh, b: Board, T: number, floorZ: number) {
  const xs = b.pts.map((q) => q.x), ys = b.pts.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const inset = Math.min(70, (x1 - x0) * 0.2, (y1 - y0) * 0.2);
  const want: Vec[] = [{ x: x0 + inset, y: y0 + inset }, { x: x1 - inset, y: y0 + inset }, { x: x1 - inset, y: y1 - inset }, { x: x0 + inset, y: y1 - inset }];
  if (x1 - x0 > 1700) { want.push({ x: (x0 + x1) / 2, y: y0 + inset }, { x: (x0 + x1) / 2, y: y1 - inset }); }
  if (y1 - y0 > 1700) { want.push({ x: x0 + inset, y: (y0 + y1) / 2 }, { x: x1 - inset, y: (y0 + y1) / 2 }); }
  const cx = b.pts.reduce((s, q) => s + q.x, 0) / b.pts.length, cy = b.pts.reduce((s, q) => s + q.y, 0) / b.pts.length;
  const legs: Vec[] = [];
  for (const w of want) {
    let q = w;
    // pull a corner that falls outside an L- or curve-shaped board towards its middle
    for (let k = 0; k < 8 && !pointInPoly(q, b.pts); k++) q = { x: q.x + (cx - q.x) * 0.18, y: q.y + (cy - q.y) * 0.18 };
    if (pointInPoly(q, b.pts) && !legs.some((l) => Math.hypot(l.x - q.x, l.y - q.y) < 120)) legs.push(q);
  }
  for (const q of legs) {
    m.block(q.x, q.y, floorZ, 44, 44, -T - floorZ, LEG, MAT.ply, "z-z+");
    m.block(q.x, q.y, floorZ, 50, 50, 6, [0.1, 0.1, 0.1], MAT.matte);
  }
}

function addRoom(m: Mesh, p: Project, floorZ: number) {
  const room = p.room!;
  const pts = room.pts;
  const area = pts.reduce((s, q, k) => { const r = pts[(k + 1) % pts.length]; return s + q.x * r.y - r.x * q.y; }, 0);
  const inward = area > 0 ? 1 : -1;
  const open = new Set(room.open ?? []);
  const floorCol: RGB = room.floor === "carpet" ? [0.46, 0.45, 0.47] : room.floor === "concrete" ? [0.6, 0.6, 0.58] : [0.74, 0.58, 0.4];
  const floorMat = room.floor === "carpet" ? MAT.matte : room.floor === "concrete" ? MAT.concrete : MAT.floor;
  m.prism(pts, floorZ - 30, floorZ, floorCol, shade(floorCol, 0.7), floorMat, MAT.matte);
  const wall = rgb(room.wall), rail: RGB = [0.82, 0.72, 0.54];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ex = b.x - a.x, ey = b.y - a.y, l = Math.hypot(ex, ey) || 1;
    const n: V3 = [(-ey / l) * inward, (ex / l) * inward, 0];
    if (open.has(i)) {
      // an open side: a railing
      const posts = Math.max(1, Math.round(l / 900));
      for (let k = 0; k <= posts; k++) m.block(a.x + (ex * k) / posts, a.y + (ey * k) / posts, floorZ, 60, 60, 950, rail, MAT.timber);
      m.at(a.x, a.y, floorZ, Math.atan2(ey, ex), () => {
        m.box(0, -30, 900, l, 30, 950, rail, MAT.timber);
        for (let x = 110; x < l - 60; x += 110) m.box(x - 14, -12, 80, x + 14, 12, 900, rail, MAT.timber, "z-z+");
        m.box(0, -20, 40, l, 20, 80, rail, MAT.timber);
      });
      continue;
    }
    m.quad([a.x, a.y, floorZ], [b.x, b.y, floorZ], [b.x, b.y, floorZ + room.height], [a.x, a.y, floorZ + room.height], wall, MAT.wall, n);
    const k = 12;
    m.quad([a.x + n[0] * k, a.y + n[1] * k, floorZ], [b.x + n[0] * k, b.y + n[1] * k, floorZ], [b.x + n[0] * k, b.y + n[1] * k, floorZ + 80], [a.x + n[0] * k, a.y + n[1] * k, floorZ + 80], [0.95, 0.95, 0.93], MAT.wall, n);
  }
}

export interface RoomSceneOpts { room: boolean; legs: boolean }

/** Everything that stands on or around the baseboards: scenery, furniture, legs, the room's floor and walls. */
export function sceneryMesh(p: Project, opt: RoomSceneOpts): Mesh {
  const m = new Mesh();
  const room = opt.room && p.room && p.room.pts.length >= 3 ? p.room : null;
  const floorZ = -(room ? room.boardHeight : DEFAULT_BOARD_HEIGHT);
  for (const o of p.objects ?? []) { const def = objectDef(o.kind); if (def && (!def.floor || room)) buildObject(m, p, o, undefined, floorZ); }
  if (room) {
    if (opt.legs) for (const b of p.boards) { if (b.pts.length < 3) continue; const mod = b.module && getModule(b.module.preset); boardLegs(m, b, mod ? overallDepth(mod) : 18, floorZ); }
    addRoom(m, p, floorZ);
  }
  return m;
}
