// Commands and state snapshots: the same commands drive the local engine and a Railplot hub,
// and a hub sends snapshots of its engine to every phone and laptop connected to it.
import { WorldSnap, worldFor } from "../sim/world";
import { Aspect, AutoRun, ControlEngine } from "./engine";
import { SignalMode, TrackPosCfg } from "./types";

export type Cmd =
  | { c: "throttle"; train: string; v: number }
  | { c: "estop"; train: string }
  | { c: "stopAll" }
  | { c: "power"; on: boolean }
  | { c: "point"; item: string; state: number }
  | { c: "signal"; id: string; mode: SignalMode }
  | { c: "light"; id: string; on?: boolean; level?: number }
  | { c: "clearFault"; block: string }
  | { c: "sensor"; id: string }
  | { c: "place"; train: string; block?: string }
  | { c: "route"; id: string }
  | { c: "auto"; id: string; run: boolean }
  | { c: "take"; controller: string }
  | { c: "rerail"; train: string; how?: "here" | "last-stop" }
  | { c: "derailMode"; mode: "off" | "forgiving" | "realistic" }
  | { c: "clock"; at?: number; ratio?: number }
  // the simulator's rolling stock, from the 3D drive view
  | { c: "placeConsist"; id: string; front: TrackPosCfg }
  | { c: "uncouple"; id: string; after: number }
  | { c: "turnRound"; id: string }
  | { c: "removeConsist"; id: string };

/** Commands that change the simulator's rolling stock (so the layout changes too). */
export const STOCK_CMDS: Cmd["c"][] = ["placeConsist", "uncouple", "turnRound", "removeConsist"];

export interface LinkSummary { online: boolean; accepted: boolean; message?: string; fw?: string }

export interface Snapshot {
  v: number;                                   // layout version on the hub
  powerOn: boolean;
  runs: [string, number, number, boolean, string[] | null][];   // train, target, speed, hold, path
  trains: [string, string | null][];           // train, block
  points: [string, number][];
  signals: [string, SignalMode][];
  lights: [string, boolean, number][];
  claimed: [string, string][];
  power: [string, number][];
  aspects: [string, Aspect][];
  sensors: string[];
  faults: [string, string][];
  autos: [string, AutoRun][];
  links: [string, LinkSummary][];
  clients: number;
  /** The layout clock, seconds after midnight. */
  time?: number;
  /** The simulator's trains and wagons, where they stand (a layout with the simulator only). */
  world?: WorldSnap;
}

export interface CmdContext {
  /** Ask a controller link to take over driving from another device. */
  take?(controller: string): void;
}

/** Apply a command to an engine. Returns an error message, or null when it worked. */
export function applyCommand(e: ControlEngine, cmd: Cmd, ctx: CmdContext = {}): string | null {
  const cfg = e.cfg;
  switch (cmd.c) {
    case "throttle":
      if (!e.train(cmd.train)) return "That train isn't on this layout.";
      if (!e.powerOn && cmd.v !== 0) return "Track power is off.";
      e.setThrottle(cmd.train, Number.isFinite(cmd.v) ? cmd.v : 0);
      return null;
    case "estop": e.emergencyStop(cmd.train); return null;
    case "stopAll": e.stopAll(); return null;
    case "power": e.setPower(!!cmd.on); return null;
    case "point": return e.setPoint(cmd.item, cmd.state);
    case "signal": {
      const s = cfg.signals.find((x) => x.id === cmd.id);
      if (!s) return "That signal isn't on this layout.";
      s.mode = cmd.mode === "stop" ? "stop" : "auto";
      e.assign();
      return null;
    }
    case "light": {
      const l = cfg.lights.find((x) => x.id === cmd.id);
      if (!l) return "That light isn't on this layout.";
      if (cmd.on !== undefined) l.on = !!cmd.on;
      if (cmd.level !== undefined) l.level = Math.max(1, Math.min(100, Math.round(cmd.level)));
      return null;
    }
    case "clearFault": e.clearFault(cmd.block); return null;
    case "rerail": {
      const c = worldFor(e).consistOf(cmd.train);
      if (!c) return "That train isn't in the simulator.";
      return worldFor(e).rerail(c.id, cmd.how ?? "here") ? null : "That train is on the rails.";
    }
    case "derailMode":
      if (!["off", "forgiving", "realistic"].includes(cmd.mode)) return "Derailments are off, forgiving or realistic.";
      cfg.derailments = cmd.mode;
      return null;
    case "sensor": return e.sensorTripped(cmd.id) ? null : "No train was heading that way.";
    case "place": {
      const t = e.train(cmd.train);
      if (!t) return "That train isn't on this layout.";
      if (cmd.block && !cfg.blocks.some((b) => b.id === cmd.block)) return "That block isn't on this layout.";
      t.block = cmd.block;
      e.assign();
      return null;
    }
    case "route": return e.setRoute(cmd.id);
    case "auto":
      if (cmd.run) return e.startAuto(cmd.id);
      e.stopAuto(cmd.id);
      return null;
    case "take": ctx.take?.(cmd.controller); return null;
    case "clock":
      if ((cmd.at !== undefined && !Number.isFinite(cmd.at)) || (cmd.ratio !== undefined && !Number.isFinite(cmd.ratio))) return "That isn't a time.";
      e.setClock(cmd.at, cmd.ratio);
      return null;
    case "placeConsist": {
      const f = cmd.front;
      if (!f || typeof f.item !== "string" || !Number.isFinite(f.s) || (f.dir !== 1 && f.dir !== -1)) return "That isn't a place on the track.";
      return worldFor(e).placeConsist(cmd.id, { item: f.item, route: f.route | 0, s: f.s, dir: f.dir });
    }
    case "uncouple": return worldFor(e).uncouple(cmd.id, cmd.after | 0);
    case "turnRound": {
      const w = worldFor(e);
      if (!w.consists.some((c) => c.id === cmd.id && c.at.length)) return "That isn't on the track.";
      w.turnRound(cmd.id);
      return null;
    }
    case "removeConsist": {
      const w = worldFor(e);
      if (!w.consists.some((c) => c.id === cmd.id && !c.train)) return "Only wagons on their own can be taken off.";
      w.remove(cmd.id);
      return null;
    }
  }
  return "Unknown command.";
}

export function snapshot(e: ControlEngine, v: number, links: [string, LinkSummary][], clients = 0): Snapshot {
  const cfg = e.cfg;
  return {
    v, powerOn: e.powerOn,
    runs: cfg.trains.map((t) => { const r = e.run(t.id); return [t.id, r.target, r.speed, !!r.hold, r.path ?? null]; }),
    trains: cfg.trains.map((t) => [t.id, t.block ?? null]),
    points: cfg.points.map((q) => [q.item, q.state]),
    signals: cfg.signals.map((s) => [s.id, s.mode]),
    lights: cfg.lights.map((l) => [l.id, l.on, l.level]),
    claimed: [...e.claimedBy],
    power: [...e.power],
    aspects: [...e.aspects],
    sensors: [...e.sensorActive],
    faults: [...e.faults],
    autos: [...e.autoRuns],
    links, clients,
    time: Number.isNaN(e.time) ? undefined : Math.floor(e.time),
    world: cfg.controllers.some((c) => c.kind === "sim") ? worldFor(e).snap() : undefined,
  };
}

/** Make a local engine show what the hub's engine is doing (it doesn't run on its own meanwhile). */
export function applySnapshot(e: ControlEngine, s: Snapshot) {
  const cfg = e.cfg;
  e.powerOn = s.powerOn;
  for (const [id, target, speed, hold, path] of s.runs) { const r = e.run(id); if (r) { r.target = target; r.speed = speed; r.hold = hold; r.path = path ?? undefined; } }
  for (const [id, block] of s.trains) { const t = e.train(id); if (t) t.block = block ?? undefined; }
  for (const [item, state] of s.points) { const q = cfg.points.find((x) => x.item === item); if (q) q.state = state; }
  for (const [id, mode] of s.signals) { const g = cfg.signals.find((x) => x.id === id); if (g) g.mode = mode; }
  for (const [id, on, level] of s.lights) { const l = cfg.lights.find((x) => x.id === id); if (l) { l.on = on; l.level = level; } }
  e.claimedBy = new Map(s.claimed);
  e.power = new Map(s.power);
  e.aspects = new Map(s.aspects);
  e.sensorActive = new Set(s.sensors);
  e.faults = new Map(s.faults);
  e.autoRuns = new Map(s.autos);
  if (s.time !== undefined) e.time = s.time;
  if (s.world) worldFor(e).applySnap(s.world);
}
