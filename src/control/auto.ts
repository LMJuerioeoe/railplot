// Planning trips for automations: which way a train can get from one block to another,
// and which points need setting on the way. Works on the track itself, piece by piece.
import { dist } from "../geom";
import { routeEnd, routeLength } from "../library";
import { Project, analyze, geom, partOf } from "../model";
import { Topology } from "./engine";
import { ControlConfig, Step } from "./types";

export interface TripPath {
  blocks: string[];                           // block ids from start to destination
  points: { item: string; state: number }[];  // points to set, in the order the train meets them
  length: number;                             // mm, roughly
}

interface Link { from: number; to: number; route: number; len: number }

/** For each route through a part: which of its ends it joins. */
function linksOf(it: Project["items"][number]): Link[] {
  const part = partOf(it);
  const g = geom(it);
  if (part.def.type === "flex") return [{ from: 0, to: 1, route: 0, len: g.length }, { from: 1, to: 0, route: 0, len: g.length }];
  const find = (x: number, y: number) => {
    let best = 0, bd = Infinity;
    part.ends.forEach((e, i) => { const d = dist(e, { x, y }); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const out: Link[] = [];
  part.routes.forEach((r, ri) => {
    const a = find(r.from.x, r.from.y);
    const e = routeEnd(r);
    const b = find(e.x, e.y);
    const len = routeLength(r);
    out.push({ from: a, to: b, route: ri, len }, { from: b, to: a, route: ri, len });
  });
  return out;
}

interface Node { item: string; exit: number; cost: number; parent: Node | null; need?: { item: string; state: number } }

/**
 * Ways from block `from` to block `to`, shortest first, one per distinct sequence of blocks.
 * A train's position inside its starting block isn't known, so points inside it only count where the train leaves it.
 */
export function tripPaths(p: Project, cfg: ControlConfig, topo: Topology, from: string, to: string, max = 3): TripPath[] {
  if (from === to) return [];
  const an = analyze(p);
  const items = new Map(p.items.map((i) => [i.id, i]));
  const isTurnout = (id: string) => partOf(items.get(id)!).def.type === "turnout" && cfg.points.some((q) => q.item === id);
  const linkCache = new Map<string, Link[]>();
  const links = (id: string) => linkCache.get(id) ?? linkCache.set(id, linksOf(items.get(id)!)).get(id)!;
  const isolated = new Set(topo.boundaries.filter((b) => b.isolated).flatMap((b) => b.ends.map((e) => `${e.item}:${e.end}`)));

  const open: Node[] = [];
  const settled = new Set<string>();
  const startBlock = cfg.blocks.find((b) => b.id === from);
  if (!startBlock) return [];
  for (const id of startBlock.items) {
    const it = items.get(id);
    if (!it) continue;
    const part = partOf(it);
    geom(it).ends.forEach((_, e) => {
      const def = part.ends[e];
      const need = isTurnout(id) && def && !def.atStart ? { item: id, state: def.route } : undefined;
      open.push({ item: id, exit: e, cost: 0, parent: null, need });
    });
  }
  const found = new Map<string, TripPath>();
  while (open.length && found.size < max * 4) {
    open.sort((a, b) => a.cost - b.cost);
    const n = open.shift()!;
    const key = `${n.item}:${n.exit}`;
    if (settled.has(key)) continue;
    settled.add(key);
    if (isolated.has(key)) continue;
    const next = an.partner.get(key);
    if (!next) continue;
    const jb = topo.blockOfItem.get(next.item);
    if (!jb || jb === from) continue;
    if (jb === to) {
      const path = reconstruct(n, topo, to);
      const sig = path.blocks.join(">");
      if (!found.has(sig)) found.set(sig, path);
      continue;
    }
    for (const l of links(next.item)) {
      if (l.from !== next.end) continue;
      open.push({
        item: next.item, exit: l.to, cost: n.cost + l.len, parent: n,
        need: isTurnout(next.item) ? { item: next.item, state: l.route } : undefined,
      });
    }
  }
  return [...found.values()].sort((a, b) => a.length - b.length).slice(0, max);
}

function reconstruct(n: Node, topo: Topology, to: string): TripPath {
  const chain: Node[] = [];
  for (let x: Node | null = n; x; x = x.parent) chain.unshift(x);
  const blocks: string[] = [];
  const points: TripPath["points"] = [];
  for (const c of chain) {
    const b = topo.blockOfItem.get(c.item)!;
    if (blocks[blocks.length - 1] !== b) blocks.push(b);
    if (c.need && !points.some((q) => q.item === c.need!.item)) points.push(c.need);
  }
  blocks.push(to);
  return { blocks, points, length: n.cost };
}

export interface TripOptions {
  speed: number;        // % throttle, negative for backwards
  slow: number;         // % to slow to on arrival
  after: number;        // seconds at the slow speed before stopping
}

/** Steps to drive a train along a path and stop in the last block. */
export function tripSteps(path: TripPath, o: TripOptions): Step[] {
  return [
    ...path.points.map((q): Step => ({ do: "point", item: q.item, state: q.state })),
    { do: "drive", speed: o.speed },
    { do: "waitBlock", block: path.blocks[path.blocks.length - 1], via: path.blocks },
    { do: "arrive", speed: o.slow, after: o.after },
  ];
}

/** A plain-words description of a step, for lists and the hub. */
export function describeStep(s: Step, cfg: ControlConfig, pointName: (item: string) => string): string {
  const block = (id: string) => cfg.blocks.find((b) => b.id === id)?.name ?? "a deleted block";
  switch (s.do) {
    case "drive": return s.speed === 0 ? "Set the throttle to 0" : `Drive ${s.speed > 0 ? "forward" : "back"} at ${Math.abs(s.speed)}%`;
    case "waitBlock": return `Wait until it reaches ${block(s.block)}`;
    case "arrive": return `Slow to ${Math.abs(s.speed)}% and stop in this block after ${s.after} s`;
    case "stop": return "Stop";
    case "wait": return `Wait ${s.sec} s`;
    case "waitTime": return `Wait until the clock says ${s.at}`;
    case "waitFree": return `Wait until ${block(s.block)} is free`;
    case "route": return `Set route ${cfg.routes?.find((r) => r.id === s.route)?.name ?? "(deleted)"}`;
    case "point": {
      const pc = cfg.points.find((q) => q.item === s.item);
      const names = pc?.us.length === 3 ? ["straight", "left", "right"] : ["straight", "turn"];
      return `Set ${pointName(s.item)} to ${names[s.state] ?? s.state}`;
    }
    case "signal": return `${s.mode === "stop" ? "Hold" : "Release"} signal ${cfg.signals.find((g) => g.id === s.signal)?.name ?? "(deleted)"}`;
    case "light": return `Turn ${cfg.lights.find((l) => l.id === s.light)?.name ?? "(deleted light)"} ${s.on ? "on" : "off"}`;
  }
}
