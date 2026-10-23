// The control engine: works out which block gets which train's power, follows trains from block to
// block as sensors trip, sets signal aspects, and turns it all into output frames for each controller.
// Pure logic with no DOM, so it can be tested and reused by the simulator.
import { Vec, dist } from "../geom";
import { Project, analyze, geom, partOf } from "../model";
import {
  AutomationCfg, BLOCK_COLORS, Block, ControlConfig, Controller, DCCEX_CAB_BASE, RouteCfg, SignalCfg, SignalMode, Step, TRAIN_COLORS,
  TrainCfg, channelName, channelsOf, emptyControl,
} from "./types";

export type Aspect = "red" | "yellow" | "green";

export interface Boundary {
  key: string;
  blocks: [string, string];
  ends: [{ item: string; end: number }, { item: string; end: number }];
  x: number; y: number;
  /** A DCC-EX track meeting a block on another controller: trains must never cross here. */
  isolated: boolean;
}

export interface Topology {
  blockOfItem: Map<string, string>;
  boundaries: Boundary[];
  unassigned: string[];       // track pieces in no block
}

export interface TrainRun {
  target: number; speed: number;
  /** Set by an automation's "arrive" step: no power beyond the train's own block, so it stops at the end of it. */
  hold?: boolean;
  /** Set while an automation follows a trip: power only goes to these blocks. */
  path?: string[];
}

export interface Frame {
  blocks: [number, number][];   // channel, duty -1023..1023
  servos: [number, number][];   // servo number, pulse µs
  outputs: [number, number][];  // output number, level 0..4095
  turnouts: [number, number][]; // DCC-EX turnout id, 0 closed / 1 thrown
}

/** Where an automation has got to. */
export interface AutoRun {
  running: boolean;
  step: number;
  t: number;          // seconds spent in this step
  phase: number;
  status: string;
}

export function cid(cfg: ControlConfig, prefix: string) { return `${prefix}${cfg.nextId++}`; }

/** Blocks and the joints between them, from the plan. */
export function topology(p: Project, cfg: ControlConfig): Topology {
  const blockOfItem = new Map<string, string>();
  for (const b of cfg.blocks) for (const it of b.items) blockOfItem.set(it, b.id);
  const an = analyze(p);
  const seen = new Set<string>();
  const boundaries: Boundary[] = [];
  for (const [k, other] of an.partner) {
    const [item, endS] = k.split(":");
    const end = +endS;
    const ba = blockOfItem.get(item), bb = blockOfItem.get(other.item);
    if (!ba || !bb || ba === bb) continue;
    const key = [`${item}:${end}`, `${other.item}:${other.end}`].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const it = p.items.find((i) => i.id === item);
    if (!it) continue;
    const e = geom(it).ends[end];
    const ca = cfg.blocks.find((b) => b.id === ba)?.controller, cb = cfg.blocks.find((b) => b.id === bb)?.controller;
    const dccex = (c?: string) => cfg.controllers.find((x) => x.id === c)?.kind === "dccex";
    const isolated = ca !== cb && (dccex(ca) || dccex(cb));
    boundaries.push({ key, blocks: [ba, bb], ends: [{ item, end }, { item: other.item, end: other.end }], x: e.x, y: e.y, isolated });
  }
  const unassigned = p.items.filter((i) => !blockOfItem.has(i.id)).map((i) => i.id);
  return { blockOfItem, boundaries, unassigned };
}

/** Is a track piece's end on the route its point is currently set to? Plain track: always. */
export function endActive(p: Project, cfg: ControlConfig, item: string, end: number): boolean {
  const it = p.items.find((i) => i.id === item);
  if (!it) return false;
  const part = partOf(it);
  if (part.def.type !== "turnout") return true;
  const e = part.ends[end];
  if (!e || e.atStart) return true;                       // the toe is on every route
  const pc = cfg.points.find((q) => q.item === item);
  const state = pc?.state ?? 0;
  return e.route === state;
}

/** Blocks a train can run into from `block`, given how the points are set. */
export function neighbours(p: Project, cfg: ControlConfig, topo: Topology, block: string): string[] {
  const out = new Set<string>();
  for (const b of topo.boundaries) {
    const i = b.blocks.indexOf(block);
    if (i < 0 || b.isolated) continue;
    if (!endActive(p, cfg, b.ends[0].item, b.ends[0].end) || !endActive(p, cfg, b.ends[1].item, b.ends[1].end)) continue;
    out.add(b.blocks[1 - i]);
  }
  return [...out];
}

export class ControlEngine {
  topo: Topology;
  /**
   * The simulator knows where every vehicle is: what's standing on a point, if anything. Without it
   * (real controllers) only the point's block is known, and any moving train in it holds the point.
   */
  onPoint?: (item: string) => string | null;
  /**
   * The simulator also knows which blocks a train stands in, the block its leading end is in, and the one
   * it runs into next (null: none, the track ends). Then a train holds the blocks under it and asks only for
   * those ahead; without it (real controllers) a moving train asks for every block next to its own, either way.
   */
  where?: (train: string) => { on: string[]; lead: string | null; ahead: string | null } | undefined;
  runs = new Map<string, TrainRun>();
  claimedBy = new Map<string, string>();     // block -> train
  /** In the simulator: blocks with some of a train's vehicles in them -> that train. */
  held = new Map<string, string>();
  power = new Map<string, number>();         // block -> signed duty -1..1
  aspects = new Map<string, Aspect>();       // signal -> aspect
  sensorActive = new Set<string>();
  faults = new Map<string, string>();        // block -> message
  autoRuns = new Map<string, AutoRun>();     // automation -> progress
  powerOn = true;
  events: string[] = [];
  /** Blocks drawing current, as the drivers report it (only with current detection on). */
  detected = new Set<string>();
  /** Occupied blocks with no train booked in them: a wagon left behind, or a train put down by hand. */
  strays = new Set<string>();
  /** Readings in a row that disagree with `detected`, per block, so one odd reading changes nothing. */
  private detectVotes = new Map<string, number>();
  /** When a train last left each block (engine seconds): its last wagons may still be there for a while. */
  private leftAt = new Map<string, number>();
  private clock = 0;
  /** The layout clock, seconds after midnight (see ControlConfig.clock). */
  time = NaN;

  constructor(public p: Project, public cfg: ControlConfig) {
    this.topo = topology(p, cfg);
    this.syncRuns();
    this.assign();
  }

  setProject(p: Project, cfg: ControlConfig) {
    this.p = p; this.cfg = cfg;
    this.topo = topology(p, cfg);
    this.syncRuns();
    this.assign();
  }

  private syncRuns() {
    for (const t of this.cfg.trains) if (!this.runs.has(t.id)) this.runs.set(t.id, { target: 0, speed: 0 });
    for (const id of [...this.runs.keys()]) if (!this.cfg.trains.some((t) => t.id === id)) this.runs.delete(id);
    for (const id of [...this.autoRuns.keys()]) if (!this.automations().some((a) => a.id === id)) this.autoRuns.delete(id);
  }

  routes(): RouteCfg[] { return this.cfg.routes ?? (this.cfg.routes = []); }
  automations(): AutomationCfg[] { return this.cfg.automations ?? (this.cfg.automations = []); }

  train(id: string) { return this.cfg.trains.find((t) => t.id === id); }
  run(id: string) { this.syncRuns(); return this.runs.get(id)!; }

  trainIn(block: string): TrainCfg | undefined { return this.cfg.trains.find((t) => t.block === block); }

  /** Work out which blocks each train may use, then the power for every block and the signal aspects. */
  assign() {
    this.findStrays();
    const { p, cfg, topo } = this;
    const claimed = new Map<string, string>();
    for (const t of cfg.trains) if (t.block && cfg.blocks.some((b) => b.id === t.block)) claimed.set(t.block, t.id);
    const stopped = (from: string, to: string) => cfg.signals.some((s) => s.from === from && s.to === to && s.mode === "stop");
    const wants = new Map<string, Set<string>>();
    // in the simulator: the blocks a train's vehicles stand in are kept from other trains
    const seen = new Map(cfg.trains.map((t) => [t.id, t.block && claimed.get(t.block) === t.id ? this.where?.(t.id) : undefined]));
    const held = new Map<string, string>();
    for (const t of cfg.trains) for (const b of seen.get(t.id)?.on ?? []) if (!held.has(b)) held.set(b, t.id);
    this.held = held;
    for (const t of cfg.trains) {
      const run = this.run(t.id);
      if (!t.block || !claimed.has(t.block) || run.hold) continue;
      // a train standing still with its throttle at zero doesn't need the blocks around it
      if (run.target === 0 && Math.abs(run.speed) < 0.005) continue;
      const path = this.run(t.id).path;
      // knowing which way it's going, a train asks for the blocks it's in and the one ahead of it, not
      // the one behind it too (which another train following it may need)
      const w = seen.get(t.id);
      const ask = w ? [...new Set([...w.on, w.lead, w.ahead])].filter((b): b is string => !!b && b !== t.block) : neighbours(p, cfg, topo, t.block);
      for (const n of ask) {
        if (claimed.has(n) || (held.get(n) ?? t.id) !== t.id || stopped(t.block, n) || this.faults.has(n) || this.strays.has(n)) continue;
        if (path && !path.includes(n)) continue;
        (wants.get(n) ?? wants.set(n, new Set()).get(n)!).add(t.id);
      }
    }
    // a free block wanted by two trains goes to the one that already had it; otherwise, where the
    // simulator says which way trains are going, to the first of them (the other waits its turn), and
    // with real controllers it stays dead and the trains stop either side of it
    const before = this.claimedBy;
    for (const [b, ts] of wants) {
      const prev = before.get(b);
      if (ts.size === 1) claimed.set(b, [...ts][0]);
      else if (prev && ts.has(prev)) claimed.set(b, prev);
      else if (this.where) claimed.set(b, [...ts][0]);
    }
    this.claimedBy = claimed;

    this.power = new Map();
    for (const b of cfg.blocks) {
      const tid = claimed.get(b.id);
      const t = tid ? this.train(tid) : undefined;
      if (!t || this.faults.has(b.id) || !this.powerOn) { this.power.set(b.id, 0); continue; }
      this.power.set(b.id, duty(t, this.run(t.id).speed));
    }

    this.aspects = new Map();
    for (const s of cfg.signals) this.aspects.set(s.id, this.aspectOf(s));
  }

  private aspectOf(s: SignalCfg): Aspect {
    if (s.mode === "stop") return "red";
    const { p, cfg, topo } = this;
    const trainHere = this.trainIn(s.from);
    const owner = this.claimedBy.get(s.to);
    if (!neighbours(p, cfg, topo, s.from).includes(s.to)) return "red";
    if (this.trainIn(s.to) || this.strays.has(s.to)) return "red";
    if (owner && owner !== trainHere?.id) return "red";
    if (!trainHere && owner) return "red";
    const onward = neighbours(p, cfg, topo, s.to).filter((b) => b !== s.from);
    const clear = onward.filter((b) => !this.trainIn(b) && (!this.claimedBy.get(b) || this.claimedBy.get(b) === trainHere?.id));
    return onward.length && clear.length ? "green" : "yellow";
  }

  /** Advance automations and momentum by dt seconds. */
  step(dt: number) {
    this.clock += dt;
    this.tick(dt);
    for (const a of this.automations()) {
      const r = this.autoRuns.get(a.id);
      if (r?.running) this.advanceAuto(a, r, dt);
    }
    for (const t of this.cfg.trains) {
      const r = this.run(t.id);
      if (t.block && this.faults.has(t.block)) r.target = 0;
      const rate = t.momentum > 0 ? dt / t.momentum : 1;
      const d = r.target - r.speed;
      r.speed = Math.abs(d) <= rate ? r.target : r.speed + Math.sign(d) * rate;
    }
    this.assign();
  }

  /** Set a train's throttle. A person taking the throttle stops any automation driving that train. */
  setThrottle(trainId: string, target: number, manual = true) {
    const r = this.run(trainId);
    if (!r) return;
    if (manual) {
      for (const a of this.automations()) {
        const ar = this.autoRuns.get(a.id);
        if (a.train === trainId && ar?.running) { ar.running = false; ar.status = "Stopped: you took the throttle"; this.events.push(`${a.name} stopped: you took over ${this.train(trainId)?.name}.`); }
      }
      r.hold = false; r.path = undefined;
    }
    r.target = Math.max(-1, Math.min(1, target));
    this.assign();
  }

  /** Stop one train at once, ignoring momentum. */
  emergencyStop(trainId: string) {
    const r = this.run(trainId);
    if (!r) return;
    this.setThrottle(trainId, 0);
    r.speed = 0;
    this.assign();
  }

  /** Run the layout clock on by dt real seconds. */
  private tick(dt: number) {
    const c = clockOf(this.cfg);
    if (Number.isNaN(this.time)) this.time = c.start * 60;
    this.time = (this.time + dt * c.ratio) % 86400;
  }

  /** Set the layout clock (minutes after midnight), and how fast it runs. */
  setClock(at?: number, ratio?: number) {
    const c = (this.cfg.clock ??= clockOf(this.cfg));
    if (ratio !== undefined) c.ratio = Math.max(1, Math.min(60, ratio));
    if (at !== undefined) { c.start = ((Math.round(at) % 1440) + 1440) % 1440; this.time = c.start * 60; }
  }

  stopAll() {
    for (const r of this.runs.values()) { r.target = 0; r.speed = 0; }
    for (const ar of this.autoRuns.values()) if (ar.running) { ar.running = false; ar.status = "Stopped: all trains stopped"; }
    for (const r of this.runs.values()) { r.hold = false; r.path = undefined; }
    this.assign();
  }

  /** Track power, like the power button on a DCC throttle. Off stops everything. */
  setPower(on: boolean) {
    if (!on) this.stopAll();
    this.powerOn = on;
    this.assign();
  }

  /** Set every point in a route. Returns an error if any point couldn't move (a train is on it). */
  setRoute(routeId: string): string | null {
    const r = this.routes().find((x) => x.id === routeId);
    if (!r) return "That route doesn't exist any more.";
    for (const q of r.points) {
      const pc = this.cfg.points.find((x) => x.item === q.item);
      if (!pc || pc.state === q.state) continue;
      const err = this.setPoint(q.item, q.state);
      if (err) return err;
    }
    return null;
  }

  /** Is a route fully set? */
  routeSet(routeId: string): boolean {
    const r = this.routes().find((x) => x.id === routeId);
    return !!r && r.points.every((q) => this.cfg.points.find((x) => x.item === q.item)?.state === q.state);
  }

  // ---------- automations ----------

  startAuto(id: string): string | null {
    const a = this.automations().find((x) => x.id === id);
    if (!a) return "That automation doesn't exist any more.";
    if (!a.steps.length) return `${a.name} has no steps yet.`;
    const t = a.train ? this.train(a.train) : undefined;
    if (a.steps.some(needsTrain) && !t) return `Choose the train for ${a.name} first.`;
    if (t && !t.block) return `Place ${t.name} on the plan first.`;
    if (!this.powerOn) return "Track power is off.";
    for (const o of this.automations()) {
      const r = this.autoRuns.get(o.id);
      if (o !== a && o.train && o.train === a.train && r?.running) { r.running = false; r.status = `Stopped: ${a.name} took over`; }
    }
    this.autoRuns.set(id, { running: true, step: 0, t: 0, phase: 0, status: "Starting" });
    return null;
  }

  /** Stop every automation driving a train, saying why (the train derailed, say). */
  haltAutos(trainId: string, why: string) {
    for (const a of this.automations()) {
      const r = this.autoRuns.get(a.id);
      if (a.train !== trainId || !r?.running) continue;
      r.running = false; r.status = `Stopped: ${why}`;
      this.events.push(`${a.name} stopped: ${why}.`);
    }
  }

  stopAuto(id: string) {
    const a = this.automations().find((x) => x.id === id);
    const r = this.autoRuns.get(id);
    if (!a || !r) return;
    if (r.running && a.train) { const tr = this.run(a.train); if (tr) { tr.target = 0; tr.hold = false; tr.path = undefined; } }
    r.running = false; r.status = "Stopped";
    this.assign();
  }

  private advanceAuto(a: AutomationCfg, ar: AutoRun, dt: number) {
    const t = a.train ? this.train(a.train) : undefined;
    const r = t ? this.run(t.id) : undefined;
    ar.t += dt;
    for (let guard = 0; guard < 32 && ar.running; guard++) {
      if (ar.step >= a.steps.length) {
        if (a.loop) { ar.step = 0; ar.t = 0; ar.phase = 0; continue; }
        ar.running = false; ar.status = "Finished";
        this.events.push(`${a.name} finished.`);
        return;
      }
      const s = a.steps[ar.step];
      if (needsTrain(s) && (!t || !r)) { ar.running = false; ar.status = "Stopped: no train chosen"; return; }
      const done = this.doStep(s, t!, r!, ar);
      if (!done) { ar.status = `Step ${ar.step + 1} of ${a.steps.length}: ${ar.status}`; return; }
      ar.step++; ar.t = 0; ar.phase = 0;
    }
  }

  /** Run one step; true when it is finished. `ar.status` says what it is waiting for. */
  private doStep(s: Step, t: TrainCfg, r: TrainRun, ar: AutoRun): boolean {
    const stopped = () => Math.abs(r.speed) < 0.005;
    switch (s.do) {
      case "drive":
        r.hold = false;
        this.setThrottle(t.id, s.speed / 100, false);
        return true;
      case "waitBlock": {
        ar.status = `waiting for ${t.name} to reach ${this.blockName(s.block)}`;
        const arrived = t.block === s.block;
        const path = arrived ? undefined : s.via;
        if (String(r.path) !== String(path)) { r.path = path; this.assign(); }
        return arrived;
      }
      case "arrive": {
        if (ar.phase === 0) {
          const dir = Math.sign(r.target || r.speed) || Math.sign(s.speed) || 1;
          r.hold = true;
          r.target = dir * Math.min(1, Math.abs(s.speed) / 100);
          ar.phase = 1; ar.t = 0;
          this.assign();
        }
        if (ar.phase === 1) {
          ar.status = `${t.name} slowing down in ${this.blockName(t.block ?? "")}`;
          if (ar.t < s.after) return false;
          r.target = 0; ar.phase = 2;
        }
        ar.status = `${t.name} stopping`;
        return stopped();
      }
      case "stop":
        r.target = 0;
        ar.status = `${t.name} stopping`;
        return stopped();
      case "wait":
        ar.status = `waiting ${Math.max(0, Math.ceil(s.sec - ar.t))} s`;
        return ar.t >= s.sec;
      case "waitFree": {
        const other = this.trainIn(s.block);
        const owner = this.claimedBy.get(s.block);
        ar.status = `waiting for ${this.blockName(s.block)} to be free`;
        return (!other || other.id === t?.id) && (!owner || owner === t?.id);
      }
      case "route": {
        const err = this.setRoute(s.route);
        ar.status = err ? `waiting to set ${this.routes().find((x) => x.id === s.route)?.name ?? "the route"}` : "";
        return !err;
      }
      case "point": {
        const pc = this.cfg.points.find((q) => q.item === s.item);
        if (!pc) return true;
        const err = pc.state === s.state ? null : this.setPoint(s.item, s.state);
        ar.status = err ? "waiting to change a point" : "";
        return !err;
      }
      case "signal": {
        const g = this.cfg.signals.find((x) => x.id === s.signal);
        if (g) { g.mode = s.mode; this.assign(); }
        return true;
      }
      case "light": {
        const l = this.cfg.lights.find((x) => x.id === s.light);
        if (l) l.on = s.on;
        return true;
      }
      case "waitTime": {
        const at = parseClock(s.at);
        if (at === null) return true;
        if (Number.isNaN(this.time)) this.tick(0);
        ar.status = `waiting until ${s.at} (the clock says ${clockText(this.time)})`;
        // due once the clock has reached it, up to twelve hours after (not when it's still the evening before)
        return (this.time / 60 - at + 1440) % 1440 < 720;
      }
    }
  }

  /**
   * Throw a point. Refused while a vehicle stands on it (in the simulator), or, with real controllers,
   * while a moving train is in the point's block.
   */
  setPoint(item: string, state: number): string | null {
    const pc = this.cfg.points.find((q) => q.item === item);
    if (!pc) return "That point isn't set up for control yet.";
    if (this.onPoint) {
      const over = this.onPoint(item);
      if (over) return `${over} is on this point: wait until it's clear.`;
    } else {
      const block = this.topo.blockOfItem.get(item);
      const t = block ? this.trainIn(block) : undefined;
      if (t && Math.abs(this.run(t.id).speed) > 0.001) return `Stop ${t.name} before changing this point.`;
    }
    pc.state = ((state % pc.us.length) + pc.us.length) % pc.us.length;
    this.assign();
    return null;
  }

  /** A sensor between two blocks tripped: move the train that was heading that way. */
  sensorTripped(sensorId: string): string | null {
    const s = this.cfg.sensors.find((x) => x.id === sensorId);
    if (!s) return null;
    const [a, b] = s.blocks;
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const t = this.trainIn(from);
      if (t && this.claimedBy.get(to) === t.id) {
        this.leftAt.set(from, this.clock);
        t.block = to;
        // automations move trains all the time: only tell people about trains they drive themselves
        if (!this.automations().some((x) => x.train === t.id && this.autoRuns.get(x.id)?.running)) this.events.push(`${t.name} entered ${this.blockName(to)}`);
        this.assign();
        return t.id;
      }
    }
    return null;
  }

  /** Update sensor states from controller inputs; rising edges move trains. */
  updateSensors(controllerId: string, inputs: (n: number) => boolean) {
    for (const s of this.cfg.sensors) {
      if (s.controller !== controllerId || s.input === undefined) continue;
      const on = inputs(s.input);
      const was = this.sensorActive.has(s.id);
      if (on && !was) { this.sensorActive.add(s.id); this.sensorTripped(s.id); }
      if (!on && was) this.sensorActive.delete(s.id);
    }
  }

  /** Current per block driver from a controller: flag a short circuit or stalled train. */
  updateCurrents(controllerId: string, mA: number[]) {
    for (const b of this.cfg.blocks) {
      if (b.controller !== controllerId || b.channel === undefined) continue;
      const i = mA[b.channel] ?? 0;
      if (i > 1250 && !this.faults.has(b.id)) {
        this.faults.set(b.id, `Too much current in ${b.name} (${Math.round(i)} mA). Check for a short circuit or a derailment.`);
        const t = this.trainIn(b.id);
        if (t) { const r = this.run(t.id); r.target = 0; r.speed = 0; }
        this.events.push(this.faults.get(b.id)!);
        this.assign();
      }
    }
  }

  /**
   * Occupancy from current. `mA` is what each driver draws while it powers its block; `idle` what it
   * draws during the controller's short detection pulses into blocks with no power. A block reading at
   * least the threshold three times in a row is occupied; three readings under it, and it is free.
   */
  updateDetection(controllerId: string, mA: number[], idle: number[] | undefined) {
    const det = this.cfg.detection;
    if (!det?.current) { if (this.detected.size || this.strays.size) { this.detected.clear(); this.strays.clear(); this.assign(); } return; }
    let changed = false;
    for (const b of this.cfg.blocks) {
      if (b.controller !== controllerId || b.channel === undefined) continue;
      const powered = (this.power.get(b.id) ?? 0) !== 0;
      const reading = powered ? mA[b.channel] : idle?.[b.channel];
      if (reading === undefined) continue;
      const on = reading >= det.threshold;
      if (on === this.detected.has(b.id)) { this.detectVotes.delete(b.id); continue; }
      const v = (this.detectVotes.get(b.id) ?? 0) + 1;
      if (v < 3) { this.detectVotes.set(b.id, v); continue; }
      this.detectVotes.delete(b.id);
      if (on) this.detected.add(b.id); else this.detected.delete(b.id);
      changed = true;
    }
    if (changed) this.afterDetection();
  }

  private afterDetection() {
    // a train whose block went quiet while exactly one block it was given lit up has moved on, even if no sensor saw it
    for (const t of this.cfg.trains) {
      if (!t.block || this.detected.has(t.block)) continue;
      const ahead = [...this.claimedBy].filter(([b, id]) => id === t.id && b !== t.block && this.detected.has(b)).map(([b]) => b);
      if (ahead.length !== 1) continue;
      this.leftAt.set(t.block, this.clock);
      t.block = ahead[0];
      this.events.push(`${t.name} entered ${this.blockName(ahead[0])} (seen by its current; no sensor saw it)`);
    }
    this.assign();
  }

  /** Occupied blocks with no train booked, none about to arrive, and none just leaving (its tail may still be there). */
  private findStrays() {
    if (!this.cfg.detection?.current) { this.strays = new Set(); return; }
    const before = this.strays;
    this.strays = new Set([...this.detected].filter((b) => !this.trainIn(b) && !this.claimedBy.get(b) && this.clock - (this.leftAt.get(b) ?? -1e9) > 10));
    for (const b of this.strays) if (!before.has(b))
      this.events.push(`Something is in ${this.blockName(b)} but no train is booked there: a wagon left behind, or a train put down by hand. Trains won't be sent into it until it's clear, or you place a train there.`);
  }

  clearFault(block: string) { this.faults.delete(block); this.assign(); }

  blockName(id: string) { return this.cfg.blocks.find((b) => b.id === id)?.name ?? "?"; }

  private kindOf(controller?: string) { return this.cfg.controllers.find((c) => c.id === controller)?.kind; }

  /** Output frames for each controller. */
  frames(): Map<string, Frame> {
    const out = new Map<string, Frame>();
    const f = (c?: string) => {
      if (!c) return null;
      if (!out.has(c)) out.set(c, { blocks: [], servos: [], outputs: [], turnouts: [] });
      return out.get(c)!;
    };
    for (const c of this.cfg.controllers) f(c.id);
    for (const b of this.cfg.blocks) {
      const fr = f(b.controller);
      if (fr && b.channel !== undefined) fr.blocks.push([b.channel, Math.round((this.power.get(b.id) ?? 0) * 1023)]);
    }
    for (const pc of this.cfg.points) {
      const fr = f(pc.controller);
      if (!fr || pc.servo === undefined) continue;
      if (this.kindOf(pc.controller) === "dccex") {
        // DCC-EX turnouts: a three-way point uses two, id (left) and id + 1 (right)
        if (pc.us.length === 3) { fr.turnouts.push([pc.servo, pc.state === 1 ? 1 : 0], [pc.servo + 1, pc.state === 2 ? 1 : 0]); }
        else fr.turnouts.push([pc.servo, pc.state ? 1 : 0]);
      } else fr.servos.push([pc.servo, Math.round(pc.us[pc.state] ?? 1500)]);
    }
    for (const s of this.cfg.signals) {
      const fr = f(s.controller);
      if (!fr) continue;
      let a = this.aspects.get(s.id) ?? "red";
      if (a === "yellow" && s.yellow === undefined) a = "green";
      for (const [col, ch] of [["red", s.red], ["yellow", s.yellow], ["green", s.green]] as const) {
        if (ch !== undefined) fr.outputs.push([ch, a === col ? 4095 : 0]);
      }
    }
    for (const l of this.cfg.lights) {
      const fr = f(l.controller);
      if (fr && l.output !== undefined) fr.outputs.push([l.output, l.on ? Math.round((Math.max(1, Math.min(100, l.level)) / 100) * 4095) : 0]);
    }
    return out;
  }
}

/** Throttle (-1..1) to block duty (-1..1) using the train's starting and top speed. */
/** The layout clock's settings: 06:00, real time, unless the layout says otherwise. */
export function clockOf(cfg: ControlConfig) { return cfg.clock ?? { start: 360, ratio: 1 }; }
/** "10:05" to minutes after midnight, or null. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
}
/** Seconds after midnight to "10:05". */
export function clockText(sec: number) {
  const m = Math.floor(sec / 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const needsTrain = (s: Step) => ["drive", "waitBlock", "arrive", "stop"].includes(s.do);

export function duty(t: TrainCfg, speed: number): number {
  const a = Math.abs(speed);
  if (a < 0.005) return 0;
  const lo = Math.max(0, Math.min(100, t.minSpeed)) / 100, hi = Math.max(lo, Math.min(100, t.maxSpeed)) / 100;
  return Math.sign(speed) * (lo + (hi - lo) * a);
}

// ---------- setup helpers ----------

export function addController(cfg: ControlConfig, kind: Controller["kind"], host = ""): Controller {
  const n = cfg.controllers.filter((c) => c.kind === kind).length + 1;
  const name = kind === "sim" ? "Simulator" : kind === "dccex" ? (n === 1 ? "DCC-EX" : `DCC-EX ${n}`) : n === 1 ? "Controller 1" : `Controller ${n}`;
  const c: Controller = { id: cid(cfg, "c"), kind, host, name };
  if (kind === "dccex") { c.conn = host ? "net" : "usb"; c.cabBase = DCCEX_CAB_BASE + 10 * (n - 1); }
  cfg.controllers.push(c);
  return c;
}

/** Next free block driver channel across the controllers. */
export function nextChannel(cfg: ControlConfig): { controller?: string; channel?: number } {
  for (const c of cfg.controllers) {
    const used = new Set(cfg.blocks.filter((b) => b.controller === c.id).map((b) => b.channel));
    for (let ch = 0; ch < channelsOf(c); ch++) if (!used.has(ch)) return { controller: c.id, channel: ch };
  }
  return {};
}

export function addBlock(cfg: ControlConfig, items: string[], name?: string): Block {
  for (const b of cfg.blocks) b.items = b.items.filter((i) => !items.includes(i));
  const n = cfg.blocks.length;
  const b: Block = { id: cid(cfg, "k"), name: name ?? `Block ${String.fromCharCode(65 + (n % 26))}${n >= 26 ? Math.floor(n / 26) : ""}`, color: BLOCK_COLORS[n % BLOCK_COLORS.length], items: [...items], ...nextChannel(cfg) };
  cfg.blocks.push(b);
  return b;
}

export function addTrain(cfg: ControlConfig, block?: string, name?: string): TrainCfg {
  const n = cfg.trains.length;
  const t: TrainCfg = { id: cid(cfg, "tr"), name: name ?? `Train ${n + 1}`, color: TRAIN_COLORS[n % TRAIN_COLORS.length], block, maxSpeed: 80, minSpeed: 15, momentum: 1.5 };
  cfg.trains.push(t);
  return t;
}

const firstFree = (used: Iterable<number | undefined>) => { const s = new Set(used); let i = 0; while (s.has(i)) i++; return i; };

/** Give every turnout on the plan a point entry (servo numbers in order). */
export function syncPoints(p: Project, cfg: ControlConfig) {
  const turnouts = p.items.filter((i) => partOf(i).def.type === "turnout");
  cfg.points = cfg.points.filter((pc) => turnouts.some((t) => t.id === pc.item));
  for (const t of turnouts) {
    if (cfg.points.some((pc) => pc.item === t.id)) continue;
    const routes = partOf(t).routes.length;
    const us = routes === 3 ? [1500, 1150, 1850] : [1300, 1700];
    cfg.points.push({ item: t.id, controller: cfg.controllers[0]?.id, servo: firstFree(cfg.points.map((q) => q.servo)), us, state: 0 });
  }
}

/** Drop sensors whose boundary has gone, and keep each sensor's two blocks up to date. */
export function syncSensors(p: Project, cfg: ControlConfig, topo = topology(p, cfg)) {
  cfg.sensors = cfg.sensors.filter((s) => {
    const b = topo.boundaries.find((x) => dist(s, x) < 2);
    if (!b) return false;
    s.blocks = [b.blocks[0], b.blocks[1]];
    return true;
  });
}

/** Put a sensor at every joint between two blocks that doesn't have one. */
export function addSensorsAtBoundaries(p: Project, cfg: ControlConfig, topo = topology(p, cfg)): number {
  syncSensors(p, cfg, topo);
  let n = 0;
  for (const b of topo.boundaries) {
    if (cfg.sensors.some((s) => dist(s, b) < 2)) continue;
    cfg.sensors.push({
      id: cid(cfg, "s"), name: `${blockName(cfg, b.blocks[0])} | ${blockName(cfg, b.blocks[1])}`, x: b.x, y: b.y, blocks: [b.blocks[0], b.blocks[1]],
      controller: cfg.controllers.find((c) => c.kind === "esp32")?.id ?? cfg.controllers[0]?.id, input: firstFree(cfg.sensors.map((x) => x.input)),
    });
    n++;
  }
  return n;
}

const blockName = (cfg: ControlConfig, id: string) => cfg.blocks.find((b) => b.id === id)?.name ?? "?";

/** A signal at a block boundary, guarding entry into `to` for trains coming from `from`. */
export function addSignal(p: Project, cfg: ControlConfig, at: Vec, from: string, to: string, heading: number): SignalCfg {
  const used = cfg.signals.flatMap((s) => [s.red, s.yellow, s.green]).concat(cfg.lights.map((l) => l.output));
  const red = firstFree(used), green = firstFree([...used, red]);
  const s: SignalCfg = {
    id: cid(cfg, "g"), name: `Into ${blockName(cfg, to)} from ${blockName(cfg, from)}`, x: at.x, y: at.y, h: heading, from, to,
    controller: cfg.controllers[0]?.id, red, green, mode: "auto",
  };
  cfg.signals.push(s);
  return s;
}

/**
 * A signal at every joint between two blocks, for each way through it, where there isn't one yet.
 * Returns how many were added.
 */
export function addSignalsAtBoundaries(p: Project, cfg: ControlConfig, topo = topology(p, cfg)): number {
  let n = 0;
  for (const b of topo.boundaries) {
    for (const i of [0, 1]) {
      const from = b.blocks[i], to = b.blocks[1 - i];
      if (cfg.signals.some((s) => s.from === from && s.to === to && dist(s, b) < 40)) continue;
      const end = b.ends[i], it = p.items.find((x) => x.id === end.item);
      if (!it) continue;
      // facing trains coming out of `from`: set back a little from the joint, on their left
      const h = geom(it).ends[end.end].h;
      addSignal(p, cfg, { x: b.x - Math.cos(h) * 12 + Math.sin(h) * 18, y: b.y - Math.sin(h) * 12 - Math.cos(h) * 18 }, from, to, h);
      n++;
    }
  }
  return n;
}

export function addLight(cfg: ControlConfig, name?: string) {
  const used = cfg.signals.flatMap((s) => [s.red, s.yellow, s.green]).concat(cfg.lights.map((l) => l.output));
  const l = { id: cid(cfg, "l"), name: name ?? `Light ${cfg.lights.length + 1}`, controller: cfg.controllers[0]?.id, output: firstFree(used), on: false, level: 80 };
  cfg.lights.push(l);
  return l;
}

/**
 * One train, the whole layout as one block: the quickest way to start.
 * Adds a controller (or the simulator), a block with every piece of track, a train and servo numbers for all points.
 */
export function quickStart(p: Project, cfg: ControlConfig | undefined, kind: Controller["kind"]): ControlConfig {
  const c = cfg ?? emptyControl();
  if (!c.controllers.some((x) => x.kind === kind)) addController(c, kind, kind === "esp32" ? "railplot.local" : "");
  const ctrl = c.controllers.find((x) => x.kind === kind)!;
  // move existing assignments onto this controller where unassigned
  if (!c.blocks.length) {
    const b = addBlock(c, p.items.map((i) => i.id), "Whole layout");
    b.controller = ctrl.id; b.channel = 0;
  }
  if (!c.trains.length) addTrain(c, c.blocks[0].id);
  syncPoints(p, c);
  for (const pc of c.points) pc.controller ??= ctrl.id;
  return c;
}

/** What to wire where, per controller. */
export interface WiringLine { controller: string; what: string; where: string }
export function wiringList(p: Project, cfg: ControlConfig): WiringLine[] {
  const out: WiringLine[] = [];
  const name = (id?: string) => cfg.controllers.find((c) => c.id === id)?.name ?? "No controller";
  const pins = BLOCK_PINS;
  for (const b of cfg.blocks) {
    if (b.channel === undefined) { out.push({ controller: name(b.controller), what: `Block ${b.name}`, where: "No driver chosen" }); continue; }
    const ctrl = cfg.controllers.find((c) => c.id === b.controller);
    if (ctrl?.kind === "dccex") {
      out.push({ controller: name(b.controller), what: `Block ${b.name} (${b.items.length} pieces)`, where: `${channelName(ctrl, b.channel)} output, DC mode, cab ${(ctrl.cabBase ?? DCCEX_CAB_BASE) + b.channel}` });
      continue;
    }
    const pn = pins[b.channel];
    if (!pn) { out.push({ controller: name(b.controller), what: `Block ${b.name}`, where: `Driver ${b.channel + 1} doesn't exist on an ESP32 controller` }); continue; }
    out.push({ controller: name(b.controller), what: `Block ${b.name} (${b.items.length} pieces)`, where: `Driver ${b.channel + 1}: EN GPIO${pn.en}, PH GPIO${pn.ph}, CS GPIO${pn.cs} (DRV8871: IN1 GPIO${pn.en}, IN2 GPIO${pn.ph})` });
  }
  const dcc = (c?: string) => cfg.controllers.find((x) => x.id === c)?.kind === "dccex";
  for (const pc of cfg.points) {
    const it = p.items.find((i) => i.id === pc.item);
    if (!it || pc.servo === undefined) continue;
    const where = dcc(pc.controller) ? (pc.us.length === 3 ? `DCC-EX turnouts ${pc.servo} (left) and ${pc.servo + 1} (right)` : `DCC-EX turnout ${pc.servo}`) : servoWhere(pc.servo);
    out.push({ controller: name(pc.controller), what: `Point ${partOf(it).def.id} (${pointLabel(p, cfg, pc.item)})`, where });
  }
  for (const s of cfg.sensors) if (s.input !== undefined) out.push({ controller: name(s.controller), what: `Sensor ${s.name}`, where: dcc(s.controller) ? `DCC-EX sensor ${s.input}` : inputWhere(s.input) });
  for (const g of cfg.signals) {
    for (const [col, ch] of [["red", g.red], ["yellow", g.yellow], ["green", g.green]] as const)
      if (ch !== undefined) out.push({ controller: name(g.controller), what: `${g.name}, ${col} LED`, where: dcc(g.controller) ? `DCC-EX VPIN ${ch}` : outputWhere(ch) });
  }
  for (const l of cfg.lights) if (l.output !== undefined) out.push({ controller: name(l.controller), what: l.name, where: dcc(l.controller) ? `DCC-EX VPIN ${l.output}` : outputWhere(l.output) });
  return out;
}

export const BLOCK_PINS = [
  { en: 25, ph: 26, cs: 36 }, { en: 27, ph: 14, cs: 39 }, { en: 13, ph: 4, cs: 34 },
  { en: 16, ph: 17, cs: 35 }, { en: 18, ph: 19, cs: 32 }, { en: 23, ph: 5, cs: 33 },
];
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;
export const servoWhere = (n: number) => `Servo board ${hex(0x40 + Math.floor(n / 16))}, pin ${n % 16}`;
export const outputWhere = (n: number) => `LED board ${hex(0x44 + Math.floor(n / 16))}, pin ${n % 16}`;
export const inputWhere = (n: number) => `Sensor board ${hex(0x20 + Math.floor(n / 16))}, ${n % 16 < 8 ? "A" : "B"}${n % 8}`;

/** A friendly name for a point: its part and its position number among points. */
export function pointLabel(p: Project, cfg: ControlConfig, item: string) {
  const i = cfg.points.findIndex((q) => q.item === item);
  return `point ${i + 1}`;
}

/** Things in the control setup worth warning about. */
export function controlWarnings(p: Project, cfg: ControlConfig, topo = topology(p, cfg)): string[] {
  const out: string[] = [];
  const name = (id: string) => cfg.blocks.find((b) => b.id === id)?.name ?? "?";
  for (const b of topo.boundaries) {
    if (!b.isolated) continue;
    out.push(`${name(b.blocks[0])} and ${name(b.blocks[1])} meet but are on different systems, one of them DCC-EX. DCC-EX tracks must never be bridged to another controller, so Railplot won't run trains across this joint. Keep both rails insulated there.`);
  }
  for (const bl of cfg.blocks) {
    const c = cfg.controllers.find((x) => x.id === bl.controller);
    if (c && bl.channel !== undefined && bl.channel >= channelsOf(c)) out.push(`${bl.name} uses ${channelName(c, bl.channel)}, which ${c.name} doesn't have.`);
  }
  const used = new Map<string, string>();
  for (const bl of cfg.blocks) {
    if (bl.controller === undefined || bl.channel === undefined) continue;
    const k = `${bl.controller}:${bl.channel}`;
    if (used.has(k)) out.push(`${bl.name} and ${used.get(k)} share the same driver.`);
    else used.set(k, bl.name);
  }
  return out;
}

export function addRoute(cfg: ControlConfig, name: string, points: RouteCfg["points"]): RouteCfg {
  const r: RouteCfg = { id: cid(cfg, "r"), name, points };
  (cfg.routes ??= []).push(r);
  return r;
}

export function addAutomation(cfg: ControlConfig, name: string, train?: string, steps: Step[] = [], loop = false): AutomationCfg {
  const a: AutomationCfg = { id: cid(cfg, "a"), name, train, steps, loop };
  (cfg.automations ??= []).push(a);
  return a;
}

export type { SignalMode };
