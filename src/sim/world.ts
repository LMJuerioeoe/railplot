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
}

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
  /** mm/s at full power. */
  fullSpeed = 450;
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

  step(dt: number) {
    for (const c of this.consists) {
      const target = c.travel * Math.abs(this.powerOf(c)) * this.fullSpeed;
      c.speed += (target - c.speed) * Math.min(1, dt / MOTOR_LAG);
      if (Math.abs(c.speed) < 0.01 && target === 0) c.speed = 0;
      const ds = c.speed * dt;
      if (ds !== 0) this.move(c, ds);
    }
  }

  /** Move every vehicle of a consist the same distance; the leading vehicle finds the way, and an open end stops the lot. */
  private move(c: Consist, ds: number) {
    const lead = ds > 0 ? 0 : c.at.length - 1;
    const first = this.graph.advance(c.at[lead], ds, this.points);
    const go = first.stop ? first.moved * Math.sign(ds) : ds;
    if (first.stop) c.speed = 0;
    if (go === 0) return;
    c.at = c.at.map((a, i) => (i === lead ? first.pos : this.graph.advance(a, go, this.points).pos));
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
      mA[b.channel] = powered && here.some(({ v }) => v.kind === "loco") ? 150 : 0;
      idle[b.channel] = here.some(({ v }) => v.detectable) || strays.has(b.id) ? 25 : 0;
    }
    return { inputs, mA, idle };
  }

  /** Every vehicle and where it is, for drawing. */
  vehiclePoses(): { consist: Consist; vehicle: Vehicle; pose: TrackPose }[] {
    return this.consists.flatMap((c) => c.vehicles.map((vehicle, i) => ({ consist: c, vehicle, pose: this.graph.pose(c.at[i]) })));
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
