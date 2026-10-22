// The simulated layout: trains made of vehicles standing on the real track. It sits where the layout
// hardware sits: the control engine powers blocks, and the world moves each loco by the power in the
// block under it, trips the sensors its vehicles pass over and reports the current each block draws.
import { getLibrary } from "../library";
import { Project, geom } from "../model";
import type { ControlEngine } from "../control/engine";
import { TrackGraph, TrackPos, TrackPose } from "./track";
import { wagonLength } from "../yards";

export type VehicleKind = "loco" | "coach" | "wagon" | "van" | "tank" | "brake";

export interface Vehicle {
  id: string;
  kind: VehicleKind;
  length: number;          // mm over buffers
  color: string;
  /** Draws current in a detection pulse: locos always; wagons with a resistor wheelset. */
  detectable?: boolean;
}

export interface Consist {
  id: string;
  /** The control train that drives it. */
  train?: string;
  vehicles: Vehicle[];      // front to back
  /** Each vehicle's centre on the track, facing the consist's front. */
  at: TrackPos[];
  /** mm/s along the way the front faces (negative: backing). */
  speed: number;
  /** Which end leads when the throttle is open: +1 the front, -1 the back. */
  travel: 1 | -1;
  /** The sign of the power last time it had any, to notice the driver reversing. */
  lastSign: number;
  /** Off the rails: why, and where each vehicle came to rest. Nothing moves until it's re-railed. */
  derailed?: Derailment;
  /** Where it last stood still on the rails, for "re-rail where it last stood". */
  lastStop?: TrackPos[];
  /** Held at the curve limit (derailments off): the HUD says so. */
  held?: boolean;
}

export type DerailCause = "curve" | "trailing" | "open-end";

export interface Derailment {
  cause: DerailCause;
  /** mm/s when it came off, and the most it could have done there. */
  speed: number;
  limit: number;
  /** The radius it came off on (curve), the point it ran through (trailing), or the piece whose end it ran off. */
  radius?: number;
  item: string;
  /** Each vehicle's resting place off the rails. */
  poses: { x: number; y: number; z: number; h: number; tilt: number }[];
}

/** Sideways acceleration a vehicle stays on the rails at, mm/s² (realistic). About 0.6 m/s on second radius. */
export const CURVE_ACCEL = 800;
/** Running through a point set against the train, mm/s: forgiving lets a sprung point through at walking pace. */
const TRAIL_SPEED = 80;
/** Hitting the end of the line faster than this, mm/s, tips the front vehicle off (forgiving: 1.5 times). */
const BUFFER_SPEED = 120;

/** Room between two vehicles' bodies (buffers just touching), mm. */
const GAP = 2;
/** Simulation step, s. */
const STEP = 1 / 120;
/** How fast a loco's speed follows its power, s (the engine adds the train's own momentum). */
const MOTOR_LAG = 0.25;

/** Scale of a track system: how many real millimetres one model millimetre stands for. */
export function scaleOf(libId: string): number | null {
  const s = getLibrary(libId)?.scale;
  return s === "OO" ? 76.2 : s === "H0" ? 87 : s === "TT" ? 120 : s === "N" ? 160 : null;
}

const worlds = new WeakMap<ControlEngine, World>();
/** The world for an engine: one per layout, shared by every simulated controller. */
export function worldFor(engine: ControlEngine): World {
  let w = worlds.get(engine);
  if (!w) { w = new World(() => engine); worlds.set(engine, w); }
  return w;
}

export class World {
  graph!: TrackGraph;
  consists: Consist[] = [];
  /** mm/s at full power: a typical OO or H0 loco on 12 V, about 0.8 m/s. */
  fullSpeed = 800;
  private graphKey = "";
  private lastClock: number | null = null;
  private latched = new Map<string, Set<number>>();   // controller -> sensor inputs seen since its last reading
  private covered = new Set<string>();                // sensors with a vehicle over them now
  private nextId = 1;

  constructor(private engine: () => ControlEngine) { this.sync(); }

  get p(): Project { return this.engine().p; }

  /** Rebuild the track when the plan changed, and give every control train a loco where the engine says it is. */
  sync() {
    const e = this.engine(), p = e.p;
    const key = `${p.nextId}|${p.items.length}|${p.items.map((i) => `${i.id}:${i.x.toFixed(2)},${i.y.toFixed(2)},${i.rot.toFixed(4)},${i.z.join("/")}`).join(";")}`;
    if (key !== this.graphKey) {
      this.graph = new TrackGraph(p);
      this.graphKey = key;
      // vehicles on track that has gone: take the consist off, it goes back in its block below
      this.consists = this.consists.filter((c) => c.at.every((a) => this.graph.has(a)));
    }
    const cfg = e.cfg;
    this.consists = this.consists.filter((c) => !c.train || cfg.trains.some((t) => t.id === c.train && t.block));
    for (const t of cfg.trains) {
      if (!t.block) continue;
      let c = this.consists.find((x) => x.train === t.id);
      if (!c) {
        c = { id: `v${this.nextId++}`, train: t.id, vehicles: [this.loco(t.color)], at: [], speed: 0, travel: 1, lastSign: 0 };
        this.consists.push(c);
      }
      // the engine put the train somewhere none of its vehicles are (placed by hand): stand it there
      if (!c.at.length || !this.blocksOf(c).has(t.block)) this.standIn(c, t.block);
    }
  }

  private loco(color: string): Vehicle {
    const lib = this.p.items[0]?.part.split("/")[0] ?? "peco-setrack-oo";
    return { id: `v${this.nextId++}`, kind: "loco", length: Math.round(wagonLength(lib) * 2.7), color, detectable: true };
  }

  /** Stand a consist in the middle of a block's longest piece, facing along it. */
  standIn(c: Consist, block: string): boolean {
    const b = this.engine().cfg.blocks.find((x) => x.id === block);
    const items = (b?.items ?? []).map((id) => this.p.items.find((i) => i.id === id)).filter((i) => !!i);
    if (!items.length) return false;
    const longest = items.reduce((a, i) => (geom(i!).length > geom(a!).length ? i : a))!;
    const mid = this.graph.middleOf(longest.id);
    if (!mid) return false;
    return this.place(c, mid);
  }

  /** Put a consist's front vehicle at `front`, the rest following behind it along the track. */
  place(c: Consist, front: TrackPos): boolean {
    const at: TrackPos[] = [front];
    for (let i = 1; i < c.vehicles.length; i++) {
      const back = (c.vehicles[i - 1].length + c.vehicles[i].length) / 2 + GAP;
      const r = this.graph.advance(at[i - 1], -back, this.points);
      if (r.stop) return false;
      at.push(r.pos);
    }
    c.at = at;
    c.speed = 0;
    return true;
  }

  private points = (item: string) => this.engine().cfg.points.find((q) => q.item === item)?.state;

  /** Blocks any part of a consist stands in (each vehicle from buffer to buffer). */
  blocksOf(c: Consist): Set<string> {
    const topo = this.engine().topo;
    const out = new Set<string>();
    c.at.forEach((a, i) => {
      const half = c.vehicles[i].length / 2;
      for (const d of [-half, 0, half]) {
        const b = topo.blockOfItem.get(d ? this.graph.advance(a, d, this.points).pos.item : a.item);
        if (b) out.add(b);
      }
    });
    return out;
  }

  /** Run the world up to a clock time in ms (fixed steps; a long gap is capped, so nothing jumps). */
  advanceTo(nowMs: number) {
    if (this.lastClock === null) { this.lastClock = nowMs; this.sync(); return; }
    const dt = Math.min(0.5, Math.max(0, (nowMs - this.lastClock) / 1000));
    if (dt <= 0) return;
    this.lastClock = nowMs;
    this.sync();
    this.chooseTravel();
    let left = dt;
    while (left > 1e-9) { const h = Math.min(STEP, left); this.step(h); left -= h; }
    this.senseSensors();
  }

  /** The power in the block under a consist's loco (-1..1), or 0 without a loco. */
  private powerOf(c: Consist): number {
    const e = this.engine();
    const i = c.vehicles.findIndex((v) => v.kind === "loco");
    if (i < 0) return 0;
    const block = e.topo.blockOfItem.get(c.at[i].item);
    return block ? e.power.get(block) ?? 0 : 0;
  }

  /**
   * Which way each train goes. The control engine thinks in blocks, not in which way a loco faces: on a
   * trip it powers the blocks along the way and says "forward". So a train on a trip heads for the next
   * block of its way; otherwise it keeps going the way it was, and turns round when the driver reverses.
   */
  private chooseTravel() {
    const e = this.engine();
    for (const c of this.consists) {
      if (!c.train) continue;
      const d = this.powerOf(c);
      const t = e.cfg.trains.find((x) => x.id === c.train);
      const path = e.runs.get(c.train)?.path;
      if (path?.length && t?.block) {
        // the way whose blocks ahead follow the trip's way furthest (both ends of a loop lead into the same block)
        const rest = path.slice(path.indexOf(t.block) + 1);
        const match = (way: 1 | -1) => { const seen = this.blocksAhead(c, way); let n = 0; while (n < rest.length && seen[n] === rest[n]) n++; return n; };
        const f = match(1), b = match(-1);
        if (f > b) c.travel = 1; else if (b > f) c.travel = -1;
      } else if (d !== 0 && c.lastSign !== 0 && Math.sign(d) !== c.lastSign) {
        c.travel = c.travel === 1 ? -1 : 1;
      }
      if (d !== 0) c.lastSign = Math.sign(d);
    }
  }

  /** The blocks beyond a consist's leading end, in order, going one way (+1: past the front), within 8 m. */
  blocksAhead(c: Consist, way: 1 | -1): string[] {
    const topo = this.engine().topo;
    const i = way === 1 ? 0 : c.at.length - 1;
    let pos = this.graph.advance(c.at[i], way * c.vehicles[i].length / 2, this.points).pos;
    const out: string[] = [];
    let last = topo.blockOfItem.get(pos.item);
    for (let k = 0; k < 200; k++) {
      const r = this.graph.advance(pos, way * 40, this.points);
      pos = r.pos;
      const b = topo.blockOfItem.get(pos.item);
      if (b && b !== last) { out.push(b); last = b; if (out.length >= 4) break; }
      if (r.stop) break;
    }
    return out;
  }

  get mode() { return this.engine().cfg.derailments ?? "realistic"; }

  /** The fastest a vehicle can take a curve of radius r, mm/s (Infinity on the straight). */
  curveLimit(r: number): number {
    if (!isFinite(r)) return Infinity;
    const v = Math.sqrt(CURVE_ACCEL * r);
    return this.mode === "forgiving" ? v * 1.5 : v;
  }

  step(dt: number) {
    for (const c of this.consists) {
      if (c.derailed) { c.speed = 0; continue; }
      const target = c.travel * Math.abs(this.powerOf(c)) * this.fullSpeed;
      c.speed += (target - c.speed) * Math.min(1, dt / MOTOR_LAG);
      if (Math.abs(c.speed) < 0.01 && target === 0) c.speed = 0;
      // the tightest curve under any vehicle
      let limit = Infinity, at = 0;
      c.at.forEach((a, i) => { const l = this.curveLimit(this.graph.pose(a).r); if (l < limit) { limit = l; at = i; } });
      c.held = false;
      if (Math.abs(c.speed) > limit) {
        if (this.mode === "off") { c.speed = Math.sign(c.speed) * limit; c.held = true; }
        else { this.derail(c, "curve", at, limit, this.graph.pose(c.at[at]).r); continue; }
      }
      if (c.speed === 0 && !c.lastStop) c.lastStop = c.at.map((a) => ({ ...a }));
      if (c.speed !== 0) c.lastStop = undefined;
      const ds = c.speed * dt;
      if (ds !== 0) this.move(c, ds);
    }
  }

  /**
   * Move every vehicle of a consist the same distance. The leading vehicle's end finds the way: an open
   * end stops the lot (tipping the front vehicle off if it hits too hard), and running through a point
   * set against the train derails it, unless derailments are off (or forgiving, at walking pace).
   */
  private move(c: Consist, ds: number) {
    const lead = ds > 0 ? 0 : c.at.length - 1;
    const half = c.vehicles[lead].length / 2, sgn = Math.sign(ds);
    const probe = this.graph.advance(c.at[lead], sgn * (half + Math.abs(ds)), this.points);
    let go = ds;
    const speed = Math.abs(c.speed);
    if (probe.trailed && this.mode !== "off" && (this.mode === "realistic" || speed > TRAIL_SPEED)) {
      this.derail(c, "trailing", lead, this.mode === "realistic" ? 0 : TRAIL_SPEED, undefined, probe.trailed);
      return;
    }
    if (probe.stop) {
      go = sgn * Math.max(0, probe.moved - half);
      const hard = BUFFER_SPEED * (this.mode === "forgiving" ? 1.5 : 1);
      if (this.mode !== "off" && speed > hard) { this.derail(c, "open-end", lead, hard, undefined, probe.pos.item); return; }
      c.speed = 0;
    }
    if (go === 0) return;
    c.at = c.at.map((a) => this.graph.advance(a, go, this.points).pos);
  }

  /** Take a consist off the rails: every vehicle slews outwards and tips, the train stops, its block shorts. */
  private derail(c: Consist, cause: DerailCause, vehicle: number, limit: number, radius?: number, item?: string) {
    const e = this.engine();
    const speed = Math.abs(c.speed);
    const poses = c.at.map((a, i) => {
      const p = this.graph.pose(a);
      // the vehicle that came off goes furthest; the rest follow it off, less and less
      const k = Math.max(0.2, 1 - Math.abs(i - vehicle) * 0.25);
      // outwards on a curve; otherwise to whichever side
      const side = cause === "curve" ? -Math.sign(this.turnOf(a)) || 1 : (i % 2 ? 1 : -1);
      const off = 18 * k, ahead = cause === "open-end" && i === vehicle ? Math.sign(c.speed || 1) * c.vehicles[i].length * 0.35 : 0;
      return {
        x: p.x - Math.sin(p.h) * off * side + Math.cos(p.h) * ahead, y: p.y + Math.cos(p.h) * off * side + Math.sin(p.h) * ahead,
        z: p.z, h: p.h + side * 0.25 * k, tilt: side * 1.1 * k,
      };
    });
    c.derailed = { cause, speed, limit, radius, item: item ?? c.at[vehicle].item, poses };
    c.speed = 0;
    const t = e.cfg.trains.find((x) => x.id === c.train);
    e.events.push(`${t?.name ?? "A train"} derailed: ${this.describe(c.derailed)}.`);
  }

  /** Which way the track turns under a position, for a train facing along it: +1 left, -1 right, 0 straight. */
  private turnOf(a: TrackPos): number {
    const h0 = this.graph.pose(a).h, h1 = this.graph.pose(this.graph.advance(a, 10, this.points).pos).h;
    const d = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0));
    return Math.abs(d) < 1e-6 ? 0 : Math.sign(d);
  }

  /** "47 km/h on a 371 mm curve, about 35 km/h is the limit" in the units of the layout's scale. */
  describe(d: Derailment): string {
    const lib = this.p.items.find((i) => i.id === d.item)?.part.split("/")[0] ?? "";
    const k = scaleOf(lib);
    const sp = (v: number) => (k ? `${Math.round((v * k * 3600) / 1e6)} km/h` : `${Math.round(v)} mm/s`);
    if (d.cause === "curve") return `${sp(d.speed)} on a ${Math.round(d.radius ?? 0)} mm curve, where about ${sp(d.limit)} is the limit`;
    if (d.cause === "trailing") return `it ran through a point set for the other road${d.limit ? ` faster than ${sp(d.limit)}` : ""}`;
    return `it ran into the end of the line at ${sp(d.speed)}`;
  }

  /**
   * Back on the rails: "here" puts every vehicle back on the track where it came off; "last-stop" where
   * the train last stood still. The block's fault is cleared and the train stays stopped.
   */
  rerail(consistId: string, how: "here" | "last-stop" = "here"): boolean {
    const c = this.consists.find((x) => x.id === consistId);
    if (!c?.derailed) return false;
    if (how === "last-stop" && c.lastStop?.every((a) => this.graph.has(a))) c.at = c.lastStop.map((a) => ({ ...a }));
    c.derailed = undefined;
    c.speed = 0;
    const e = this.engine();
    if (c.train) e.setThrottle(c.train, 0, false);
    for (const b of this.blocksOf(c)) e.clearFault(b);
    return true;
  }

  /** Sensors with a vehicle over them; each one that becomes covered is latched for its controller. */
  private senseSensors() {
    const e = this.engine();
    const now = new Set<string>();
    for (const s of e.cfg.sensors) {
      if (this.consists.some((c) => c.at.some((a, i) => this.over(a, c.vehicles[i].length, s)))) now.add(s.id);
    }
    for (const id of now) if (!this.covered.has(id)) {
      const s = e.cfg.sensors.find((x) => x.id === id)!;
      if (s.controller === undefined || s.input === undefined) continue;
      (this.latched.get(s.controller) ?? this.latched.set(s.controller, new Set()).get(s.controller)!).add(s.input);
    }
    this.covered = now;
  }

  /** Is a vehicle over a plan point (within 12 mm of its centre line, between its ends)? */
  private over(a: TrackPos, length: number, q: { x: number; y: number }) {
    const p = this.graph.pose(a);
    const dx = q.x - p.x, dy = q.y - p.y;
    const along = dx * Math.cos(p.h) + dy * Math.sin(p.h), across = -dx * Math.sin(p.h) + dy * Math.cos(p.h);
    return Math.abs(along) <= length / 2 && Math.abs(across) <= 12;
  }

  /** What a controller would report: sensors seen since last time, and current per driver channel. */
  readings(controller: string, strays: Set<string> = new Set()) {
    const e = this.engine();
    const inputs = this.latched.get(controller) ?? new Set<number>();
    this.latched.set(controller, new Set());
    const mA: number[] = [], idle: number[] = [];
    for (const b of e.cfg.blocks) {
      if (b.controller !== controller || b.channel === undefined) continue;
      const here = this.consists.flatMap((c) => c.vehicles.map((v, i) => ({ v, a: c.at[i] }))).filter(({ a }) => e.topo.blockOfItem.get(a.item) === b.id);
      const powered = (e.power.get(b.id) ?? 0) !== 0;
      const shorted = this.consists.some((c) => c.derailed && this.blocksOf(c).has(b.id));
      mA[b.channel] = powered && shorted ? 2000 : powered && here.some(({ v }) => v.kind === "loco") ? 150 : 0;
      idle[b.channel] = here.some(({ v }) => v.detectable) || strays.has(b.id) ? 25 : 0;
    }
    return { inputs, mA, idle };
  }

  /** Every vehicle and where it is, for drawing. */
  vehiclePoses(): { consist: Consist; vehicle: Vehicle; pose: TrackPose & { tilt?: number } }[] {
    return this.consists.flatMap((c) => c.vehicles.map((vehicle, i) => {
      const off = c.derailed?.poses[i];
      return { consist: c, vehicle, pose: off ? { ...off, r: Infinity } : this.graph.pose(c.at[i]) };
    }));
  }

  /** How close a train is to the curve limit just ahead of it (0..1+), for the HUD's warning. */
  curveMargin(train: string): number {
    const c = this.consistOf(train);
    if (!c || c.derailed || !c.speed) return 0;
    const lead = c.speed > 0 ? 0 : c.at.length - 1;
    let worst = 0;
    for (const d of [0, 100, 200, 300]) {
      const r = this.graph.pose(this.graph.advance(c.at[lead], Math.sign(c.speed) * d, this.points).pos).r;
      worst = Math.max(worst, Math.abs(c.speed) / this.curveLimit(r));
    }
    return worst;
  }

  consistOf(train: string) { return this.consists.find((c) => c.train === train); }

  /** Where a train's loco is. */
  poseOf(train: string): TrackPose | null {
    const c = this.consistOf(train);
    if (!c?.at.length) return null;
    const i = Math.max(0, c.vehicles.findIndex((v) => v.kind === "loco"));
    return this.graph.pose(c.at[i]);
  }

  /** A train's speed as the scale speed it stands for, km/h (null when the track system has no scale). */
  scaleKmh(train: string): number | null {
    const c = this.consistOf(train);
    const lib = this.p.items.find((i) => i.id === c?.at[0]?.item)?.part.split("/")[0] ?? "";
    const k = scaleOf(lib);
    return c && k ? (Math.abs(c.speed) * k) / 1e6 * 3600 : null;
  }
}
