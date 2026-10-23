// The simulated layout: trains made of vehicles standing on the real track. It sits where the layout
// hardware sits: the control engine powers blocks, and the world moves each loco by the power in the
// block under it, trips the sensors its vehicles pass over and reports the current each block draws.
import { getLibrary } from "../library";
import { Project, geom } from "../model";
import type { ControlEngine } from "../control/engine";
import { TrackGraph, TrackPos, TrackPose } from "./track";
import { ConsistCfg, VehicleCfg, VehicleKind } from "../control/types";
import { newVehicle } from "./stock";

export type { VehicleKind };
export type Vehicle = VehicleCfg;

export interface Consist {
  id: string;
  /** The control train that drives it; none for wagons standing on their own. */
  train?: string;
  /** Not saved in the layout: a loco the simulator gave a train that has no rolling stock of its own. */
  auto?: boolean;
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
  /** Standing still now, with lastStop already noted for this stand. */
  stood?: boolean;
  /** How far it has run along its front's way, mm (backing counts down): turns the locos' wheels in 3D. */
  odo?: number;
  /** Held at the curve limit (derailments off): the HUD says so. */
  held?: boolean;
  /** Slowing for, or stopped at, a block ahead that another train has: that block. */
  waiting?: string;
  /** Slowing for, or stopped at, a point ahead set against it (with the point guard on): that point. */
  waitPoint?: string;
}

export type DerailCause = "curve" | "trailing" | "open-end" | "collision";

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
/** How hard a train brakes for a block ahead that isn't its own, mm/s², and how far short of it it stands, mm. */
const BRAKE = 500, STAND_OFF = 6;
/** Running through a point set against the train, mm/s: forgiving lets a sprung point through at walking pace. */
const TRAIL_SPEED = 80;
/** Hitting the end of the line faster than this, mm/s, tips the front vehicle off (forgiving: 1.5 times). */
const BUFFER_SPEED = 120;

/** Room between two vehicles' bodies (buffers just touching), mm. */
const GAP = 2;
/** The most vehicles in one train or rake. */
export const MAX_VEHICLES = 40;
/** Length of vehicles coupled together, buffer to buffer, mm. */
const lengthOf = (vs: { length: number }[]) => vs.reduce((a, v) => a + v.length + GAP, -GAP);
/** Closing speed at which buffers touching couple up, mm/s; faster, the trains bounce apart and stop. */
export const COUPLE_SPEED = 70;
/** How far a train the simulator stands on the track by itself can run both ways without trailing a point (mm). */
const RUN_CLEAR = 1500;
/** Closing speed over which a collision derails both trains, in coupling speeds (forgiving: 5). */
const CRASH = 3;
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
  if (!w) {
    const nw = new World(() => engine); w = nw; worlds.set(engine, nw);
    engine.onPoint = (item) => nw.onPiece(item);
    engine.where = (train) => nw.whereIs(train);
  }
  return w;
}

/**
 * The hub's simulator as sent to phones and laptops: every consist, its vehicles and where they stand,
 * rounded to a tenth of a mm. Enough to draw it in 3D and to see what's where.
 */
export interface WorldSnap {
  c: {
    id: string; train?: string; auto?: boolean; v: Vehicle[];
    at: [string, number, number, 1 | -1][];   // item, route, s, dir: each vehicle's centre
    sp: number; tr: 1 | -1; odo: number;
    d?: Derailment; held?: boolean; w?: string; wp?: string;
  }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export class World {
  graph!: TrackGraph;
  consists: Consist[] = [];
  /**
   * A copy of a hub's simulator, in a window connected to it: the consists come from the hub's snapshots,
   * and between them each just runs on at its speed so it moves smoothly. Nothing is worked out here.
   */
  mirror = false;
  /** mm/s at full power: a typical OO or H0 loco on 12 V, about 0.8 m/s. */
  fullSpeed = 800;
  private graphKey = "";
  private lastClock: number | null = null;
  private latched = new Map<string, Set<number>>();   // controller -> sensor inputs seen since its last reading
  private covered = new Set<string>();                // sensors with a vehicle over them now
  private nextId = 1;
  /** Each train's block as the engine had it at the last sync, to tell the engine moving a train from the world moving it. */
  private engineBlock = new Map<string, string>();

  constructor(private engine: () => ControlEngine) { this.sync(); }

  get p(): Project { return this.engine().p; }

  /**
   * Rebuild the track when the plan changed; take the rolling stock from the layout (control.consists);
   * and give every control train without rolling stock of its own a loco, where the engine says it is.
   */
  sync() {
    const e = this.engine(), p = e.p, cfg = e.cfg;
    if (this.mirror) { this.syncGraph(); return; }
    if (this.syncGraph()) {
      // vehicles on track that has gone come off the layout (trains go back into their block below)
      this.consists = this.consists.filter((c) => c.at.every((a) => this.graph.has(a)));
    }
    const saved = cfg.consists ?? [];
    const trainOk = (id?: string) => !id || cfg.trains.some((t) => t.id === id);
    // a train that was deleted leaves its rolling stock standing, as vehicles on their own
    for (const sc of saved) if (!trainOk(sc.train)) delete sc.train;
    for (const c of this.consists) if (!c.auto && !trainOk(c.train)) c.train = undefined;
    // consists that went from the layout (deleted, undone), or whose train went
    this.consists = this.consists.filter((c) => (c.auto ? trainOk(c.train) && !saved.some((s) => s.train === c.train) : saved.some((s) => s.id === c.id)) && trainOk(c.train));
    for (const sc of saved) {
      let c = this.consists.find((x) => x.id === sc.id);
      const sig = JSON.stringify(sc.vehicles);
      if (!c) {
        c = { id: sc.id, train: sc.train, vehicles: sc.vehicles.map((v) => ({ ...v })), at: [], speed: 0, travel: 1, lastSign: 0 };
        this.consists.push(c);
        if (sc.at && this.graph.has(sc.at)) this.place(c, { ...sc.at });
      } else if (JSON.stringify(c.vehicles) !== sig || c.train !== sc.train) {
        // made up differently (the Trains dialog, an undo): the front stays where it is
        const front = c.at[0];
        c.vehicles = sc.vehicles.map((v) => ({ ...v }));
        c.train = sc.train;
        if (front && !this.place(c, front)) c.at = [];
      }
    }
    for (const t of cfg.trains) {
      if (!t.block) continue;
      let c = this.consists.find((x) => x.train === t.id);
      if (!c) {
        c = { id: `auto-${t.id}`, auto: true, train: t.id, vehicles: [this.loco(t.color)], at: [], speed: 0, travel: 1, lastSign: 0 };
        this.consists.push(c);
      }
      if (!c.at.length) this.standIn(c, t.block);
      else if (!this.blocksOf(c).has(t.block)) {
        if (this.engineBlock.get(t.id) !== t.block) this.standIn(c, t.block);   // the engine moved it (placed by hand in 2D): stand it there
        else this.tellEngine(c);                                                 // the world moved it (uncoupled, coupled): the engine follows
      }
      this.engineBlock.set(t.id, t.block);
    }
  }

  /** Put a train's block in the engine where its loco stands. */
  private tellEngine(c: Consist) {
    const t = c.train ? this.engine().cfg.trains.find((x) => x.id === c.train) : undefined;
    const loco = Math.max(0, c.vehicles.findIndex((v) => v.kind === "loco"));
    const block = c.at[loco] && this.engine().topo.blockOfItem.get(c.at[loco].item);
    if (!t || !block || t.block === block) return;
    t.block = block;
    this.engineBlock.set(t.id, block);
    this.engine().assign();
  }

  private loco(color: string): Vehicle {
    return newVehicle("loco", this.libId(), `v${this.nextId++}`, color);
  }

  /** The track system most of the layout uses, for vehicle sizes and scale. */
  libId(): string { return this.p.items[0]?.part.split("/")[0] ?? "peco-setrack-oo"; }

  // ---------- making up trains ----------

  /** The saved form of a consist (making it part of the layout if the simulator made it up by itself). */
  private saved(c: Consist): ConsistCfg {
    const cfg = this.engine().cfg;
    cfg.consists ??= [];
    let sc = cfg.consists.find((x) => x.id === c.id);
    if (!sc) {
      if (c.auto) { c.auto = false; c.id = `k${this.newId()}`; }
      sc = { id: c.id, train: c.train, vehicles: c.vehicles.map((v) => ({ ...v })) };
      cfg.consists.push(sc);
    }
    sc.vehicles = c.vehicles.map((v) => ({ ...v }));
    sc.train = c.train;
    if (c.at[0]) sc.at = { ...c.at[0] };
    return sc;
  }

  private newId(): number {
    const cfg = this.engine().cfg;
    return cfg.nextId++;
  }

  /** Remember where every consist on the rails stands, in the layout (called when trains stop). */
  savePositions() {
    for (const sc of this.engine().cfg.consists ?? []) {
      const c = this.consists.find((x) => x.id === sc.id);
      if (c?.at[0] && !c.derailed) sc.at = { ...c.at[0] };
    }
  }

  /** A train's rolling stock, made part of the layout so it can be changed; created with a loco if it has none. */
  stockOf(train: string): ConsistCfg {
    const c = this.consistOf(train);
    if (c) return this.saved(c);
    const t = this.engine().cfg.trains.find((x) => x.id === train);
    const sc: ConsistCfg = { id: `k${this.newId()}`, train, vehicles: [this.loco(t?.color ?? "#2f5f9e")] };
    (this.engine().cfg.consists ??= []).push(sc);
    return sc;
  }

  /** A new rake of vehicles without a train (wagons standing on their own), not yet on the track. */
  newRake(vehicles: Vehicle[]): ConsistCfg {
    const sc: ConsistCfg = { id: `k${this.newId()}`, vehicles };
    (this.engine().cfg.consists ??= []).push(sc);
    return sc;
  }

  /**
   * Where a consist would stand with its front vehicle's centre at `front`, or why it can't: the track
   * ends under it, the front is on a point, or another consist is in the way.
   */
  fit(id: string, front: TrackPos): { at: TrackPos[] } | { error: string } {
    const c = this.consists.find((x) => x.id === id);
    if (!c) return { error: "That train isn't in the simulator." };
    if (this.engine().cfg.points.some((q) => q.item === front.item)) return { error: "That's a point: pick plain track." };
    const at = this.layout(c.vehicles, front, true);
    const need = lengthOf(c.vehicles);
    if (!at) return { error: `It won't fit there: the track ends (the train is ${Math.round(need)} mm long).` };
    // longer than a loop it's put on, it would run round onto its own back
    if (this.wraps(c.vehicles, at)) return { error: `It won't fit there: the train is ${Math.round(need)} mm long, longer than the loop it's on.` };
    if (this.overlaps(c, at)) return { error: "Another train is in the way there." };
    return { at };
  }

  /**
   * Put a consist on the track with its front vehicle's centre at `front`. Refused (with the reason) when
   * it won't fit there. A train's block in the engine follows.
   */
  placeConsist(id: string, front: TrackPos): string | null {
    this.sync();
    const f = this.fit(id, front);
    if ("error" in f) return f.error;
    const c = this.consists.find((x) => x.id === id)!;
    c.at = f.at; c.speed = 0; c.travel = 1; c.lastSign = 0;
    c.derailed = undefined; c.lastStop = undefined; c.stood = false;
    this.saved(c);
    if (c.train) {
      // a train put down by hand stands still, and the engine finds it where its loco is
      this.engine().emergencyStop(c.train);
      this.tellEngine(c);
    }
    return null;
  }

  /** Turn a consist round where it stands: the back vehicle becomes the front. */
  turnRound(id: string) {
    const c = this.consists.find((x) => x.id === id);
    if (!c?.at.length) return;
    c.vehicles.reverse();
    c.at = c.at.reverse().map((a) => TrackGraph.reversed(a));
    c.travel = 1; c.speed = 0;
    this.saved(c);
  }

  /** Split a consist behind vehicle `after`: the vehicles behind it become wagons standing on their own. */
  uncouple(id: string, after: number): string | null {
    const c = this.consists.find((x) => x.id === id);
    if (!c || after < 0 || after >= c.vehicles.length - 1) return "There's nothing to uncouple there.";
    if (c.derailed) return "Re-rail it first.";
    // both halves face the same way and remember which way the driver last went
    const back: Consist = { id: `k${this.newId()}`, vehicles: c.vehicles.slice(after + 1), at: c.at.slice(after + 1), speed: 0, travel: c.travel, lastSign: c.lastSign };
    c.vehicles = c.vehicles.slice(0, after + 1); c.at = c.at.slice(0, after + 1);
    c.speed = 0;
    // the half with the loco keeps the train; the other half stands
    if (c.train && !c.vehicles.some((v) => v.kind === "loco") && back.vehicles.some((v) => v.kind === "loco")) { back.train = c.train; c.train = undefined; }
    this.consists.push(back);
    this.saved(c); this.saved(back);
    return null;
  }

  /** Every coupling between two vehicles of a consist on the rails, and where it is. */
  couplers(): { consist: string; after: number; x: number; y: number; z: number }[] {
    const out: { consist: string; after: number; x: number; y: number; z: number }[] = [];
    for (const c of this.consists) {
      if (c.derailed || c.at.length < 2) continue;
      for (let i = 0; i < c.at.length - 1; i++) {
        const p = this.graph.pose(this.graph.advance(c.at[i], -(c.vehicles[i].length + GAP) / 2, this.points).pos);
        out.push({ consist: c.id, after: i, x: p.x, y: p.y, z: p.z });
      }
    }
    return out;
  }

  /** Uncouple a train's loco from the vehicles it pushes or pulls: behind it, or in front if it's at the back. */
  uncoupleLoco(train: string): string | null {
    const c = this.consistOf(train);
    if (!c || c.vehicles.length < 2) return "Nothing is coupled to this train.";
    if (Math.abs(c.speed) > 1) return "Stop the train first.";
    const loco = Math.max(0, c.vehicles.findIndex((v) => v.kind === "loco"));
    return this.uncouple(c.id, loco === 0 ? 0 : loco - 1);
  }

  /** Take a consist off the layout altogether. */
  remove(id: string) {
    const cfg = this.engine().cfg;
    cfg.consists = (cfg.consists ?? []).filter((x) => x.id !== id);
    this.consists = this.consists.filter((x) => x.id !== id);
  }

  /** Would a consist standing at `at` stand on another consist's vehicles? */
  /**
   * Why a consist can't be made up of `vehicles`, or null if it can: too many, longer than all the track,
   * or (standing on the track) running off the end behind it, round a loop onto its own front, or into
   * another train. Its front stays where it stands, so the new vehicles must fit behind it.
   */
  roomFor(id: string, vehicles: Vehicle[]): string | null {
    if (vehicles.length > MAX_VEHICLES) return `A train can have at most ${MAX_VEHICLES} vehicles.`;
    const need = Math.round(lengthOf(vehicles));
    const track = Math.round(this.p.items.reduce((a, i) => a + geom(i).length, 0));
    if (need > track) return `That would make it ${need} mm long, longer than all the track on the layout (${track} mm).`;
    const c = this.consists.find((x) => x.id === id);
    if (!c?.at.length || !vehicles.length) return null;
    const at = this.layout(vehicles, c.at[0], true);
    if (!at) return `There's no room behind it: the track ends (it would be ${need} mm long). Move it first, or make it shorter.`;
    if (this.wraps(vehicles, at)) return `There's no room behind it: at ${need} mm long it would run round the loop onto its own front.`;
    if (this.overlaps(c, at, vehicles)) return `There's no room behind it: it would run into another train (it would be ${need} mm long).`;
    return null;
  }

  /** Would vehicles standing at `at` reach round a loop onto each other? */
  private wraps(vehicles: Vehicle[], at: TrackPos[]): boolean {
    const poses = at.map((a) => this.graph.pose(a));
    for (let i = 0; i < at.length; i++) for (let j = i + 2; j < at.length; j++) {
      const reach = (vehicles[i].length + vehicles[j].length) / 2;
      if (Math.hypot(poses[i].x - poses[j].x, poses[i].y - poses[j].y) < reach - 1 && Math.abs(poses[i].z - poses[j].z) < 30) return true;
    }
    return false;
  }

  private overlaps(c: Consist, at: TrackPos[], vehicles = c.vehicles): boolean {
    const mine = at.map((a, i) => ({ p: this.graph.pose(a), half: vehicles[i].length / 2 }));
    return this.consists.some((o) => o !== c && o.at.some((a, i) => {
      const q = this.graph.pose(a), half = o.vehicles[i].length / 2;
      return mine.some((m) => Math.hypot(m.p.x - q.x, m.p.y - q.y) < m.half + half - 1 && Math.abs(m.p.z - q.z) < 30);
    }));
  }

  /**
   * Stand a consist in the middle of one of a block's pieces, facing along it: the longest piece from
   * which it can run a good way both ways without trailing through a point set against it (on a loop
   * road it would come off at the first point), or the longest piece if there's no such place.
   */
  standIn(c: Consist, block: string): boolean {
    const b = this.engine().cfg.blocks.find((x) => x.id === block);
    const items = (b?.items ?? []).map((id) => this.p.items.find((i) => i.id === id)).filter((i) => !!i);
    if (!items.length) return false;
    const byLength = [...items].sort((a, i) => geom(i!).length - geom(a!).length);
    const clear = (at: TrackPos) => [RUN_CLEAR, -RUN_CLEAR].every((d) => !this.graph.advance(at, d, this.points).trailed);
    const mids = byLength.map((i) => this.graph.middleOf(i!.id)).filter((m): m is TrackPos => !!m);
    for (const mid of mids) if (clear(mid) && this.place(c, mid)) return true;
    return mids.some((mid) => this.place(c, mid));
  }

  /** Put a consist's front vehicle at `front`, the rest following behind it along the track. */
  place(c: Consist, front: TrackPos): boolean {
    const at = this.layout(c.vehicles, front);
    if (!at) return false;
    c.at = at;
    c.speed = 0;
    return true;
  }

  /** Each vehicle's centre with the front one's at `front`, the rest behind it; null if the track ends under them. */
  private layout(vehicles: Vehicle[], front: TrackPos, ends = false): TrackPos[] | null {
    if (!vehicles.length) return null;   // nothing to stand anywhere
    const at: TrackPos[] = [front];
    for (let i = 1; i < vehicles.length; i++) {
      const back = (vehicles[i - 1].length + vehicles[i].length) / 2 + GAP;
      const r = this.graph.advance(at[i - 1], -back, this.points);
      if (r.stop) return null;
      at.push(r.pos);
    }
    if (!ends) return at;
    // placing by hand: the ends of the front and back vehicles must be on the track too
    const ahead = this.graph.advance(front, vehicles[0].length / 2, this.points);
    const behind = this.graph.advance(at[at.length - 1], -vehicles[vehicles.length - 1].length / 2, this.points);
    return ahead.stop || behind.stop ? null : at;
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
  /** Rebuild the track graph if the plan changed; true if it did. */
  private syncGraph(): boolean {
    const p = this.engine().p;
    const key = `${p.nextId}|${p.items.length}|${p.items.map((i) => `${i.id}:${i.x.toFixed(2)},${i.y.toFixed(2)},${i.rot.toFixed(4)},${i.z.join("/")}`).join(";")}`;
    if (key === this.graphKey) return false;
    this.graph = new TrackGraph(p);
    this.graphKey = key;
    return true;
  }

  /** This simulator's state, for a hub to send to the windows connected to it. */
  snap(): WorldSnap {
    return {
      c: this.consists.map((c) => ({
        id: c.id, train: c.train, auto: c.auto || undefined, v: c.vehicles,
        at: c.at.map((a): [string, number, number, 1 | -1] => [a.item, a.route, r1(a.s), a.dir]),
        sp: r1(c.speed), tr: c.travel, odo: r1(c.odo ?? 0),
        d: c.derailed, held: c.held || undefined, w: c.waiting, wp: c.waitPoint,
      })),
    };
  }

  /** Show a hub's simulator: this world becomes a copy of it (see `mirror`). */
  applySnap(s: WorldSnap, nowMs = performance.now()) {
    this.mirror = true;
    this.syncGraph();
    this.consists = s.c.map((x) => ({
      id: x.id, train: x.train, auto: x.auto, vehicles: x.v,
      at: x.at.map(([item, route, s, dir]) => ({ item, route, s, dir })).filter((a) => this.graph.has(a)),
      speed: x.sp, travel: x.tr, lastSign: 0, odo: x.odo, derailed: x.d, held: x.held, waiting: x.w, waitPoint: x.wp,
    })).map((c) => (c.at.length === c.vehicles.length ? c : { ...c, at: [] }));
    this.lastClock = nowMs;
  }

  /** Stop copying a hub: the simulator here takes its trains from the layout again. */
  unmirror() {
    if (!this.mirror) return;
    this.mirror = false;
    this.consists = [];
    this.lastClock = null;
    this.sync();
  }

  advanceTo(nowMs: number) {
    if (this.lastClock === null) { this.lastClock = nowMs; this.sync(); return; }
    const dt = Math.min(0.5, Math.max(0, (nowMs - this.lastClock) / 1000));
    if (dt <= 0) return;
    this.lastClock = nowMs;
    if (this.mirror) {
      // between the hub's updates each consist runs on as it was going (the next update puts it right)
      this.syncGraph();
      for (const c of this.consists) {
        if (!c.speed || c.derailed || !c.at.length) continue;
        const go = c.speed * Math.min(dt, 0.3);
        c.at = c.at.map((a) => this.graph.advance(a, go, this.points).pos);
        c.odo = (c.odo ?? 0) + go;
      }
      return;
    }
    this.sync();
    this.chooseTravel();
    let left = dt;
    while (left > 1e-9) { const h = Math.min(STEP, left); this.step(h); left -= h; }
    this.senseSensors();
  }

  /** The power in the block under a consist's loco (-1..1), or 0 without a loco. */
  /** What's standing on a piece of track, any part of any vehicle: a train's name, "A wagon", or null. */
  onPiece(item: string): string | null {
    for (const c of this.consists) {
      if (c.derailed) continue;
      for (let i = 0; i < c.vehicles.length; i++) {
        if (!c.at[i]) continue;
        const half = c.vehicles[i].length / 2;
        // along the vehicle from buffer to buffer, closer than the shortest piece
        for (let d = -half; d <= half + 0.01; d += Math.max(1, Math.min(20, half))) {
          if (this.graph.advance(c.at[i], d, this.points).pos.item === item) {
            const t = c.train ? this.engine().cfg.trains.find((x) => x.id === c.train) : undefined;
            return t?.name ?? "A wagon";
          }
        }
      }
    }
    return null;
  }

  /** Is a train's loco standing on track that's in no block, where it gets no power? */
  noPower(train: string): boolean {
    const c = this.consistOf(train);
    const i = c?.vehicles.findIndex((v) => v.kind === "loco") ?? -1;
    return !!c && i >= 0 && !!c.at[i] && !this.engine().topo.blockOfItem.has(c.at[i].item);
  }

  /** The power a train's loco picks up: its block's, if that block is the train's (not another train's cab). */
  private powerOf(c: Consist): number {
    const e = this.engine();
    const i = c.vehicles.findIndex((v) => v.kind === "loco");
    if (i < 0 || !c.at[i]) return 0;
    const block = e.topo.blockOfItem.get(c.at[i].item);
    if (!block || (c.train && e.claimedBy.get(block) !== c.train)) return 0;
    return e.power.get(block) ?? 0;
  }

  /** For the control engine: the blocks a train stands in, and the next one the way it's going. */
  whereIs(train: string): { on: string[]; lead: string | null; ahead: string | null } | undefined {
    const c = this.consistOf(train);
    if (!c?.at.length || c.derailed) return undefined;
    const i = c.travel === 1 ? 0 : c.at.length - 1;
    const end = this.graph.advance(c.at[i], c.travel * c.vehicles[i].length / 2, this.points).pos;
    return { on: [...this.blocksOf(c)], lead: this.engine().topo.blockOfItem.get(end.item) ?? null, ahead: this.blocksAhead(c, c.travel)[0] ?? null };
  }

  /**
   * How far a train can run the way it's going before its leading end reaches another train's block (one
   * given to it, or with some of its vehicles in), within `reach` mm; Infinity if there's none that near.
   */
  private roomAhead(c: Consist, reach: number): { room: number; block?: string; point?: string } {
    const e = this.engine(), way = c.travel, i = way === 1 ? 0 : c.at.length - 1, guard = !!e.cfg.pointGuard;
    let pos = this.graph.advance(c.at[i], way * c.vehicles[i].length / 2, this.points).pos;
    for (let d = 0; d <= reach; d += 8) {
      const b = e.topo.blockOfItem.get(pos.item);
      const other = b && (e.claimedBy.get(b) ?? e.held.get(b));
      if (other && other !== c.train) return { room: d, block: b };
      const r = this.graph.advance(pos, way * 8, this.points);
      // with the point guard on, a point set against it stops it like a signal at danger
      if (guard && r.trailed) return { room: d, point: r.trailed };
      if (r.stop) break;
      pos = r.pos;
    }
    return { room: Infinity };
  }

  /**
   * Which way each train goes. The control engine thinks in blocks, not in which way a loco faces: on a
   * trip it powers the blocks along the way and says "forward". So a train on a trip heads for the next
   * block of its way; otherwise it keeps going the way it was, and turns round when the driver reverses.
   */
  private chooseTravel() {
    const e = this.engine();
    for (const c of this.consists) {
      if (!c.train || !c.at.length) continue;
      const d = this.powerOf(c);
      const t = e.cfg.trains.find((x) => x.id === c.train);
      const path = e.runs.get(c.train)?.path;
      if (path?.length && t?.block) {
        // the way whose blocks ahead follow the trip's way furthest (both ends of a loop lead into the same block),
        // from the furthest block along the way that any of the train is in already
        const on = this.blocksOf(c);
        const rest = path.slice(Math.max(path.indexOf(t.block), ...path.map((b, i) => (on.has(b) ? i : -1))) + 1);
        const match = (way: 1 | -1) => { const seen = this.blocksAhead(c, way); let n = 0; while (n < rest.length && seen[n] === rest[n]) n++; return n; };
        const f = match(1), b = match(-1);
        if (f > b) c.travel = 1; else if (b > f) c.travel = -1;
      } else if (d !== 0 && Math.sign(d) !== (c.lastSign || 1)) {
        // the driver reversed (a train that hasn't run yet counts as last going forward, so "back" backs it)
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
      if (c.derailed || !c.at.length) { c.speed = 0; continue; }
      const target = c.travel * Math.abs(this.powerOf(c)) * this.fullSpeed;
      c.speed += (target - c.speed) * Math.min(1, dt / MOTOR_LAG);
      if (Math.abs(c.speed) < 0.01 && target === 0) c.speed = 0;
      // a train coming up to a block that isn't its own brakes, to stand short of it
      c.waiting = undefined; c.waitPoint = undefined;
      if (c.train && (c.speed * c.travel > 0 || target * c.travel > 0)) {
        const ahead = this.roomAhead(c, (this.fullSpeed * this.fullSpeed) / (2 * BRAKE) + 40);
        if (ahead.room < Infinity) {
          const vmax = Math.sqrt(2 * BRAKE * Math.max(0, ahead.room - STAND_OFF));
          const wait = () => { c.waiting = ahead.block; c.waitPoint = ahead.point; };
          if (Math.abs(c.speed) >= vmax) { c.speed = Math.sign(c.speed) * vmax; wait(); }
          if (vmax < 1) { c.speed = 0; wait(); }
        }
      }
      // the tightest curve under any vehicle
      let limit = Infinity, at = 0;
      c.at.forEach((a, i) => { const l = this.curveLimit(this.graph.pose(a).r); if (l < limit) { limit = l; at = i; } });
      c.held = false;
      if (Math.abs(c.speed) > limit) {
        if (this.mode === "off") { c.speed = Math.sign(c.speed) * limit; c.held = true; }
        else { this.derail(c, "curve", at, limit, this.graph.pose(c.at[at]).r); continue; }
      }
      if (c.speed === 0 && !c.stood) {
        c.stood = true;
        c.lastStop = c.at.map((a) => ({ ...a }));
        // stood still: the layout remembers where
        const sc = this.engine().cfg.consists?.find((x) => x.id === c.id);
        if (sc && c.at[0]) sc.at = { ...c.at[0] };
      }
      if (c.speed !== 0) c.stood = false;
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
    // another consist's buffers ahead: stop there, and couple, bounce or crash
    const hit = this.contact(c, lead, sgn, Math.abs(go));
    if (hit) go = sgn * Math.max(0, Math.min(Math.abs(go), hit.room));
    if (go !== 0) { c.at = c.at.map((a) => this.graph.advance(a, go, this.points).pos); c.odo = (c.odo ?? 0) + go; }
    if (hit && hit.room <= Math.abs(ds) + 1e-6) this.meet(c, lead, sgn, hit.other, hit.end);
  }

  /** A consist's two buffer ends: where they are and which vehicle each belongs to. */
  private endsOf(o: Consist): { x: number; y: number; z: number; h: number; vehicle: number }[] {
    if (!o.at.length) return [];
    const last = o.at.length - 1;
    const pose = (a: TrackPos, d: number) => (o.derailed ? null : this.graph.pose(this.graph.advance(a, d, this.points).pos));
    const out: { x: number; y: number; z: number; h: number; vehicle: number }[] = [];
    for (const [i, d] of [[0, o.vehicles[0].length / 2], [last, -o.vehicles[last].length / 2]] as const) {
      const p = pose(o.at[i], d);
      if (p) out.push({ ...p, vehicle: i });
      else { const q = o.derailed!.poses[i]; out.push({ x: q.x, y: q.y, z: q.z, h: q.h, vehicle: i }); }
    }
    return out;
  }

  /**
   * The nearest other consist's end in front of a moving consist's leading end, within `reach` mm plus a
   * buffer gap, on the same track (heading the same way or the opposite way, at the same height).
   */
  private contact(c: Consist, lead: number, sgn: number, reach: number): { other: Consist; end: number; room: number } | null {
    const tip = this.graph.pose(this.graph.advance(c.at[lead], sgn * c.vehicles[lead].length / 2, this.points).pos);
    const fx = Math.cos(tip.h) * sgn, fy = Math.sin(tip.h) * sgn;
    let best: { other: Consist; end: number; room: number } | null = null;
    for (const o of this.consists) {
      if (o === c || !o.at.length) continue;
      for (const e of this.endsOf(o)) {
        const dx = e.x - tip.x, dy = e.y - tip.y, d = Math.hypot(dx, dy);
        if (d > reach + GAP + 4 || Math.abs(e.z - tip.z) > 25) continue;
        if (d > 1 && (dx * fx + dy * fy) / d < 0.5) continue;               // behind or beside
        if (Math.abs(Math.cos(e.h - tip.h)) < 0.8 && !o.derailed) continue;  // on another track crossing here
        const room = Math.max(0, d - GAP);
        if (!best || room < best.room) best = { other: o, end: e.vehicle, room };
      }
    }
    return best;
  }

  /**
   * Buffers meet. Gently, with one side free of a train, they couple; harder, both stop dead; much harder
   * (or always, for two trains at speed), both come off.
   */
  private meet(c: Consist, lead: number, way: number, o: Consist, end: number) {
    const rel = Math.abs(c.speed) + Math.abs(o.speed);
    const crash = COUPLE_SPEED * (this.mode === "forgiving" ? 5 : CRASH);
    if (this.mode !== "off" && rel > crash && !o.derailed) {
      this.derail(c, "collision", lead, crash);
      this.derail(o, "collision", end, crash);
      return;
    }
    if (rel <= COUPLE_SPEED && !(c.train && o.train) && !o.derailed) { this.couple(c, way, o, end); return; }
    c.speed = 0; o.speed = 0;
  }

  /** Join two consists whose ends touch into one (`way` +1: c's front touched). The one with the train keeps it. */
  private couple(c: Consist, way: number, o: Consist, end: number) {
    const flip = (way === 1) === (end === 0);
    let ov = o.vehicles, oa = o.at;
    if (flip) { ov = [...ov].reverse(); oa = [...oa].reverse().map((a) => TrackGraph.reversed(a)); }
    const keep = c.train || !o.train ? c : o;
    const vehicles = way === 1 ? [...ov, ...c.vehicles] : [...c.vehicles, ...ov];
    const at = way === 1 ? [...oa, ...c.at] : [...c.at, ...oa];
    const speed = c.speed, travel = c.travel, lastSign = c.lastSign, train = c.train ?? o.train;
    const gone = keep === c ? o : c;
    keep.vehicles = vehicles; keep.at = at; keep.train = train; keep.speed = speed; keep.travel = travel; keep.lastSign = lastSign;
    keep.lastStop = undefined; keep.stood = false;
    this.consists = this.consists.filter((x) => x !== gone);
    const cfg = this.engine().cfg;
    cfg.consists = (cfg.consists ?? []).filter((x) => x.id !== gone.id);
    this.saved(keep);
    const t = cfg.trains.find((x) => x.id === train);
    if (t) this.engine().events.push(`${t.name} coupled up: ${vehicles.length} vehicles.`);
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
    if (t) e.haltAutos(t.id, `${t.name} derailed`);
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
    if (d.cause === "collision") return `it hit another train at ${sp(d.speed)}: buffers only take about ${sp(d.limit)}`;
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
      const here = this.consists.flatMap((c) => c.at.map((a, i) => ({ v: c.vehicles[i], a }))).filter(({ a }) => e.topo.blockOfItem.get(a.item) === b.id);
      const powered = (e.power.get(b.id) ?? 0) !== 0;
      const shorted = this.consists.some((c) => c.derailed && this.blocksOf(c).has(b.id));
      mA[b.channel] = powered && shorted ? 2000 : powered && here.some(({ v }) => v.kind === "loco") ? 150 : 0;
      idle[b.channel] = here.some(({ v }) => v.detectable) || strays.has(b.id) ? 25 : 0;
    }
    return { inputs, mA, idle };
  }

  /** Every vehicle and where it is, for drawing. */
  vehiclePoses(): { consist: Consist; vehicle: Vehicle; pose: TrackPose & { tilt?: number } }[] {
    return this.consists.filter((c) => c.at.length).flatMap((c) => c.vehicles.map((vehicle, i) => {
      const off = c.derailed?.poses[i];
      return { consist: c, vehicle, pose: off ? { ...off, r: Infinity } : this.graph.pose(c.at[i]) };
    }));
  }

  /** How close a train is to the curve limit just ahead of it (0..1+), for the HUD's warning. */
  curveMargin(train: string): number {
    const c = this.consistOf(train);
    if (!c?.at.length || c.derailed || !c.speed) return 0;
    const lead = c.speed > 0 ? 0 : c.at.length - 1;
    let worst = 0;
    for (const d of [0, 100, 200, 300]) {
      const r = this.graph.pose(this.graph.advance(c.at[lead], Math.sign(c.speed) * d, this.points).pos).r;
      worst = Math.max(worst, Math.abs(c.speed) / this.curveLimit(r));
    }
    return worst;
  }

  consistOf(train: string) { return this.consists.find((c) => c.train === train); }

  /** Track pieces with a vehicle on them (any part of it). */
  itemsUnder(): Set<string> {
    const out = new Set<string>();
    for (const c of this.consists) c.at.forEach((a, i) => {
      const half = c.vehicles[i].length / 2;
      out.add(a.item);
      for (const d of [-half, half]) out.add(this.graph.advance(a, d, this.points).pos.item);
    });
    return out;
  }

  /** The first point ahead of a train's leading end, within `reach` mm along the track as it's set. */
  pointAhead(train: string, reach = 1500): string | null {
    const c = this.consistOf(train);
    if (!c?.at.length) return null;
    const way = c.travel;
    const i = way === 1 ? 0 : c.at.length - 1;
    const under = new Set(c.at.map((a) => a.item));
    let pos = c.at[i];
    for (let d = 0; d < reach; d += 20) {
      pos = this.graph.advance(pos, way * 20, this.points).pos;
      if (!under.has(pos.item) && this.engine().cfg.points.some((q) => q.item === pos.item)) return pos.item;
    }
    return null;
  }

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
