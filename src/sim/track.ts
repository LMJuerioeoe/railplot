// The track as something trains run on: positions along the pieces' routes, moving along them across
// joints and through points as they're set, and where on the plan a position is.
import { Prim, dist, normAngle, primAt } from "../geom";
import { routeEnd } from "../library";
import { Analysis, Item, Project, analyze, endKey, geom, itemRoutes, partOf, toWorld } from "../model";

/** A place on the track: a piece, one of its routes, a distance along that route, and which way along it. */
export interface TrackPos { item: string; route: number; s: number; dir: 1 | -1 }

/** Where a TrackPos is: plan position, height, heading (the way `dir` faces) and the radius there. */
export interface TrackPose { x: number; y: number; z: number; h: number; r: number }

/** Why a move stopped short. */
export type Stop = "open-end" | null;

interface RouteInfo { prims: Prim[]; len: number; startEnd: number; endEnd: number; z0: number; z1: number }
interface ItemInfo { item: Item; routes: RouteInfo[]; turnout: boolean }

/** Which route a point is set to (0 = straight), by item id. */
export type PointStates = (item: string) => number | undefined;

export class TrackGraph {
  private items = new Map<string, ItemInfo>();
  private an: Analysis;

  constructor(p: Project, an: Analysis = analyze(p)) {
    this.an = an;
    for (const it of p.items) {
      const g = geom(it);
      const ends = g.ends;
      const local = itemRoutes(it);
      const rigid = g.part.rigid;
      const routes = g.routes.map((r, ri) => {
        // which of the piece's ends each end of this route is: points share the toe between routes
        const from = toWorld(it, local[ri].from), to = toWorld(it, routeEnd(local[ri]));
        const find = (q: { x: number; y: number; h: number }, outward: number) =>
          Math.max(0, ends.findIndex((e) => dist(e, q) < 0.5 && Math.abs(normAngle(e.h - outward)) < 0.05));
        const startEnd = find(from, from.h + Math.PI), endEnd = find(to, to.h);
        const z0 = rigid ? it.z[0] ?? 0 : it.z[startEnd] ?? 0, z1 = rigid ? it.z[0] ?? 0 : it.z[endEnd] ?? 0;
        return { prims: r.prims, len: r.prims.reduce((a, q) => a + q.len, 0), startEnd, endEnd, z0, z1 };
      });
      this.items.set(it.id, { item: it, routes, turnout: partOf(it).def.type === "turnout" });
    }
  }

  has(pos: TrackPos) { const i = this.items.get(pos.item); return !!i && !!i.routes[pos.route]; }
  routeLength(item: string, route: number) { return this.items.get(item)?.routes[route]?.len ?? 0; }
  routesOf(item: string) { return this.items.get(item)?.routes.length ?? 0; }

  /** Where a position is on the plan, and which way it faces. */
  pose(pos: TrackPos): TrackPose {
    const r = this.items.get(pos.item)!.routes[pos.route];
    let t = Math.max(0, Math.min(r.len, pos.s)), pr = r.prims[r.prims.length - 1];
    for (const q of r.prims) { if (t <= q.len) { pr = q; break; } t -= q.len; }
    const at = primAt(pr, Math.min(t, pr.len));
    const z = r.z0 + (r.z1 - r.z0) * (r.len ? Math.max(0, Math.min(1, pos.s / r.len)) : 0);
    return { x: at.x, y: at.y, z, h: pos.dir === 1 ? at.h : normAngle(at.h + Math.PI), r: pr.kind === "arc" ? pr.r : Infinity };
  }

  /** The other way round: the same place facing back. */
  static reversed(pos: TrackPos): TrackPos { return { ...pos, dir: pos.dir === 1 ? -1 : 1 }; }

  /**
   * Move `ds` mm along the way the position faces (negative: backwards), across joints and through
   * points. A train entering a point by its toe takes the road the point is set for; entering by a
   * road the point isn't set for, it runs through anyway (as through a sprung point) and `trailed`
   * names the point, so the caller can decide whether that derails. An open end stops the move there.
   */
  advance(pos: TrackPos, ds: number, points: PointStates): { pos: TrackPos; moved: number; stop: Stop; trailed?: string } {
    if (ds < 0) {
      const back = this.advance(TrackGraph.reversed(pos), -ds, points);
      return { ...back, pos: TrackGraph.reversed(back.pos), moved: -back.moved };
    }
    let cur = { ...pos }, left = ds, moved = 0;
    let trailed: string | undefined;
    for (let hops = 0; hops < 64; hops++) {
      const info = this.items.get(cur.item)!;
      const r = info.routes[cur.route];
      const room = cur.dir === 1 ? r.len - cur.s : cur.s;
      if (left <= room) { cur.s += cur.dir * left; moved += left; return { pos: cur, moved, stop: null, trailed }; }
      left -= room; moved += room;
      cur.s = cur.dir === 1 ? r.len : 0;
      const end = cur.dir === 1 ? r.endEnd : r.startEnd;
      const other = this.an.partner.get(endKey({ item: cur.item, end }));
      if (!other) return { pos: cur, moved, stop: "open-end", trailed };
      const next = this.items.get(other.item);
      if (!next) return { pos: cur, moved, stop: "open-end", trailed };
      // the routes of the next piece that start or end where we come in
      const cands = next.routes.map((nr, i) => ({ i, nr })).filter(({ nr }) => nr.startEnd === other.end || nr.endEnd === other.end);
      if (!cands.length) return { pos: cur, moved, stop: "open-end", trailed };
      let pick = cands[0];
      if (next.turnout) {
        const set = points(next.item.id) ?? 0;
        const onSet = cands.find((c) => c.i === set);
        if (onSet) pick = onSet;
        else if (cands.every((c) => c.nr.startEnd !== other.end)) {
          // came in by the far end of a road the point isn't set for: running through it the wrong way
          trailed = next.item.id;
        }
      }
      const atStart = pick.nr.startEnd === other.end;
      cur = { item: next.item.id, route: pick.i, s: atStart ? 0 : pick.nr.len, dir: atStart ? 1 : -1 };
    }
    return { pos: cur, moved, stop: null, trailed };
  }

  /** A position in the middle of a piece's main route, facing along it. */
  middleOf(item: string): TrackPos | null {
    const info = this.items.get(item);
    if (!info) return null;
    return { item, route: 0, s: info.routes[0].len / 2, dir: 1 };
  }

  /** The nearest position on the track to a plan point, within `tol` mm, on any piece. */
  nearest(q: { x: number; y: number }, tol = 30): TrackPos | null {
    let best: TrackPos | null = null, bd = tol;
    for (const [id, info] of this.items) info.routes.forEach((r, ri) => {
      let acc = 0;
      for (const pr of r.prims) {
        const n = Math.max(2, Math.ceil(pr.len / 5));
        for (let k = 0; k <= n; k++) {
          const s = (pr.len * k) / n, at = primAt(pr, s), d = dist(at, q);
          if (d < bd) { bd = d; best = { item: id, route: ri, s: acc + s, dir: 1 }; }
        }
        acc += pr.len;
      }
    });
    return best;
  }
}
