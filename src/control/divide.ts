// Cut a layout into blocks so two or more trains can run at once, and put the trains in them.
import { Project, analyze, geom, partOf } from "../model";
import { addBlock, addTrain, neighbours, syncSensors, topology } from "./engine";
import { ControlConfig } from "./types";

/** OO length of a tank engine and three wagons, for when no train is made up yet. */
const DEFAULT_TRAIN = 500;

/**
 * Groups of track pieces, one per block. Plain track between points is cut into runs about
 * `target` mm long; each point (or crossing) goes in with the run at its toe, so a train
 * standing at a junction's toe holds the junction too. Runs shorter than a train join a neighbour.
 */
export function divideTrack(p: Project, trainLength = DEFAULT_TRAIN): string[][] {
  const an = analyze(p);
  const items = p.items.filter((i) => geom(i).ends.length);
  const byId = new Map(items.map((i) => [i.id, i]));
  const junction = (id: string) => { const t = partOf(byId.get(id)!).def.type; return t === "turnout" || t === "crossing"; };
  const len = (id: string) => geom(byId.get(id)!).length;
  const ends = (id: string) => geom(byId.get(id)!).ends.length;
  const partner = (id: string, end: number) => { const o = an.partner.get(`${id}:${end}`); return o && byId.has(o.item) ? o : undefined; };
  const linked = (id: string) => Array.from({ length: ends(id) }, (_, e) => partner(id, e)?.item).filter((x): x is string => !!x);
  const target = Math.max(2 * trainLength, 1200);

  const partOfItem = new Map<string, number>();
  const parts: string[][] = [];
  const newPart = (ids: string[]) => { for (const id of ids) partOfItem.set(id, parts.length); parts.push(ids); };

  // plain runs: walk each chain of plain pieces from an end that leads to a junction or nowhere
  const done = new Set<string>();
  const plain = items.map((i) => i.id).filter((id) => !junction(id));
  const isEnd = (id: string) => linked(id).filter((o) => !junction(o)).length < 2;
  for (const start of [...plain.filter(isEnd), ...plain]) {
    if (done.has(start)) continue;
    const chain: string[] = [];
    for (let at: string | undefined = start; at && !done.has(at);) {
      done.add(at); chain.push(at);
      at = linked(at).find((o) => !junction(o) && !done.has(o));
    }
    const total = chain.reduce((a, id) => a + len(id), 0);
    const n = Math.max(1, Math.round(total / target));
    let run: string[] = [], sum = 0, k = 1;
    for (const id of chain) {
      run.push(id); sum += len(id);
      if (k < n && sum >= (total * k) / n) { newPart(run); run = []; k++; }
    }
    if (run.length) newPart(run);
  }

  // junctions: those joined to each other go together, with the run at the first toe that has one
  const seen = new Set<string>();
  for (const it of items) {
    if (!junction(it.id) || seen.has(it.id)) continue;
    const group: string[] = [], queue = [it.id];
    seen.add(it.id);
    while (queue.length) {
      const id = queue.shift()!;
      group.push(id);
      for (const o of linked(id)) if (junction(o) && !seen.has(o)) { seen.add(o); queue.push(o); }
    }
    const toe = group.map((id) => partner(id, 0)?.item).find((o) => o && !junction(o))
      ?? group.flatMap(linked).find((o) => !junction(o));
    if (toe !== undefined && partOfItem.has(toe)) {
      const i = partOfItem.get(toe)!;
      for (const id of group) partOfItem.set(id, i);
      parts[i].push(...group);
    } else newPart(group);
  }

  // too short for a train: join the shortest neighbour, until none is left (or there's only one)
  const length = (ids: string[]) => ids.reduce((a, id) => a + len(id), 0);
  for (;;) {
    const live = parts.map((ids, i) => ({ ids, i })).filter((x) => x.ids.length);
    if (live.length <= 1) break;
    const short = live.filter((x) => length(x.ids) < trainLength).sort((a, b) => length(a.ids) - length(b.ids))[0];
    if (!short) break;
    const next = [...new Set(short.ids.flatMap(linked).map((o) => partOfItem.get(o)!).filter((i) => i !== short.i))]
      .sort((a, b) => length(parts[a]) - length(parts[b]))[0];
    if (next === undefined) break;   // track on its own: leave it be
    for (const id of short.ids) partOfItem.set(id, next);
    parts[next].push(...short.ids);
    parts[short.i] = [];
  }
  return parts.filter((x) => x.length);
}

/**
 * Replace the blocks with ones cut by divideTrack and make sure there are `trains` trains, each in a
 * block of its own. `where` says which piece a train's loco stands on now (in the simulator), so a
 * train keeps its place. Signals between blocks that are gone go too. Returns the new blocks' count.
 */
export function divideForTrains(p: Project, cfg: ControlConfig, trains: number, opts: { trainLength?: number; where?: (train: string) => string | undefined } = {}): number {
  const groups = divideTrack(p, opts.trainLength);
  const controller = cfg.blocks[0]?.controller ?? cfg.controllers[0]?.id;
  cfg.blocks = [];
  for (const g of groups) {
    const b = addBlock(cfg, g);
    if (!b.controller && controller) b.controller = controller;
  }
  const ids = new Set(cfg.blocks.map((b) => b.id));
  cfg.signals = cfg.signals.filter((s) => ids.has(s.from) && ids.has(s.to));
  const topo = topology(p, cfg);
  syncSensors(p, cfg, topo);

  // trains keep the block they stand in; the rest get the longest free blocks, away from other trains
  const taken = new Set<string>();
  for (const t of cfg.trains) {
    const at = opts.where?.(t.id);
    const b = at ? topo.blockOfItem.get(at) : undefined;
    t.block = b && !taken.has(b) ? b : undefined;
    if (t.block) taken.add(t.block);
  }
  const len = (id: string) => cfg.blocks.find((b) => b.id === id)!.items.reduce((a, i) => { const it = p.items.find((x) => x.id === i); return a + (it ? geom(it).length : 0); }, 0);
  const pick = () => {
    const free = cfg.blocks.map((b) => b.id).filter((b) => !taken.has(b));
    // best a block with a way out as the points are set (not a loop road with its points against it),
    // and not next to another train
    const out = (b: string) => neighbours(p, cfg, topo, b).length > 0;
    const apart = (b: string) => !neighbours(p, cfg, topo, b).some((n) => taken.has(n));
    const tiers = [free.filter((b) => out(b) && apart(b)), free.filter(out), free.filter(apart), free];
    return (tiers.find((x) => x.length) ?? []).sort((a, b) => len(b) - len(a))[0];
  };
  for (const t of cfg.trains) if (!t.block) { t.block = pick(); if (t.block) taken.add(t.block); }
  while (cfg.trains.length < trains) {
    const b = pick();
    if (!b) break;
    addTrain(cfg, b);
    taken.add(b);
  }
  return cfg.blocks.length;
}
