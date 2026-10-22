// Will my trains fit? Checks a plan against the longest train and the longest vehicle the owner runs:
// passing loops and sidings too short to hold the train, blocks shorter than it, curves too tight for
// long coaches, and reverse curves with no straight between them, where buffers lock.
import { Prim } from "./geom";
import { Analysis, Item, Project, analyze, endKey, geom, partOf } from "./model";

/** The longest train (locomotive and all), and the longest single vehicle, in mm. */
export interface TrainSpec { length: number; vehicle: number }

/** Room to leave beyond the train: buffers clear of the points' fouling point, or of the stop block. */
export const SPARE = 30;

export interface Road {
  /** The plain track pieces between points (or a point and the end of the line), in order. */
  items: string[];
  length: number;
  /** "siding": a point at one end and the end of the line at the other; "loop": points at both ends. */
  kind: "siding" | "loop";
  /** A siding that leaves from the toe of its point: a headshunt, where the engine runs round to pull. */
  headshunt?: boolean;
}

export interface FitIssue {
  kind: "short-road" | "short-block" | "tight-curve" | "s-bend";
  severity: "info" | "warn";
  text: string;
  items: string[];
}

const isNode = (it: Item) => { const t = partOf(it).def.type; return t === "turnout" || t === "crossing"; };

/**
 * The roads of a plan: runs of plain track (straights, curves and flexible track) between points and
 * crossings. A road with a point at either end can hold a train clear of the main line; plain track with
 * no point at either end (a whole circuit, or a line on its own) isn't a road.
 */
export function roads(p: Project, an: Analysis = analyze(p)): Road[] {
  const byId = new Map(p.items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: Road[] = [];
  for (const start of p.items) {
    if (seen.has(start.id) || isNode(start)) continue;
    // walk both ways from this piece along plain track
    const chain: Item[] = [start];
    seen.add(start.id);
    const bounds: ("point" | "buffer" | "loop")[] = [];
    let toe = false;
    for (const endIdx of [0, 1]) {
      let cur = start, at = endIdx;
      for (;;) {
        const other = an.partner.get(endKey({ item: cur.id, end: at }));
        if (!other) { bounds.push("buffer"); break; }
        const next = byId.get(other.item)!;
        if (isNode(next)) { bounds.push("point"); if (other.end === 0 && partOf(next).def.type === "turnout") toe = true; break; }
        if (next.id === start.id || seen.has(next.id)) { bounds.push("loop"); break; }
        seen.add(next.id);
        if (endIdx === 0) chain.unshift(next); else chain.push(next);
        cur = next; at = other.end === 0 ? 1 : 0;
      }
    }
    const points = bounds.filter((b) => b === "point").length;
    if (!points || bounds.includes("loop")) continue;
    const road: Road = { items: chain.map((i) => i.id), length: chain.reduce((a, i) => a + geom(i).length, 0), kind: points === 2 ? "loop" : "siding" };
    if (road.kind === "siding" && toe) road.headshunt = true;
    out.push(road);
  }
  return out;
}

/** The track primitive next to one end of a piece, and which way it turns for a train leaving the piece there. */
function turnAt(it: Item, end: number): { r: number; sign: number } | null {
  const part = partOf(it);
  const g = geom(it);
  const e = part.def.type === "flex" ? { route: 0, atStart: end === 0 } : part.ends[end];
  const prims = g.routes[e.route]?.prims ?? [];
  const pr: Prim | undefined = e.atStart ? prims[0] : prims[prims.length - 1];
  if (!pr || pr.kind !== "arc") return null;
  // a train leaving by the start of the route runs it backwards, turning the other way
  return { r: pr.r, sign: Math.sign(pr.sweep) * (e.atStart ? -1 : 1) };
}

export function trainFit(p: Project, t: TrainSpec | undefined = p.train): FitIssue[] {
  if (!t || !(t.length > 0)) return [];
  const out: FitIssue[] = [];
  const an = analyze(p);
  const need = t.length + SPARE;
  for (const r of roads(p, an)) {
    if (r.length >= need) continue;
    const where = r.kind === "siding" ? "Siding" : "Loop road";
    out.push({ kind: "short-road", severity: "warn", items: r.items,
      text: `${where} ${r.items[0]}${r.items.length > 1 ? `–${r.items[r.items.length - 1]}` : ""} holds ${Math.round(r.length)} mm of train; your longest needs ${Math.round(need)} mm with room to clear the points` });
  }
  for (const b of p.control?.blocks ?? []) {
    const L = p.items.filter((i) => b.items.includes(i.id)).reduce((a, i) => a + geom(i).length, 0);
    if (L > 0 && L < t.length) out.push({ kind: "short-block", severity: "info", items: [...b.items],
      text: `Block ${b.name} is ${Math.round(L)} mm long, shorter than your longest train: it will stand across two blocks and hold both` });
  }
  if (t.vehicle > 0) {
    // curves: one note per radius
    const tight = new Map<number, string[]>();
    for (const it of p.items) {
      const rs = geom(it).routes.flatMap((r) => r.prims).filter((x) => x.kind === "arc").map((x) => (x as Extract<Prim, { kind: "arc" }>).r);
      const r = Math.min(...rs);
      if (isFinite(r) && r < t.vehicle * 1.4) { const k = Math.round(r); tight.set(k, [...(tight.get(k) ?? []), it.id]); }
    }
    for (const [r, ids] of [...tight].sort((a, b) => a[0] - b[0]))
      out.push({ kind: "tight-curve", severity: "warn", items: ids,
        text: `${ids.length} piece${ids.length === 1 ? "" : "s"} curve${ids.length === 1 ? "s" : ""} at R${r}, tight for a ${Math.round(t.vehicle)} mm vehicle: long coaches overhang and may not couple round it` });
    // reverse curves joined with no straight between them
    const done = new Set<string>();
    for (const it of p.items) partOf(it).ends.forEach((_, end) => {
      const other = an.partner.get(endKey({ item: it.id, end }));
      if (!other) return;
      const key = [endKey({ item: it.id, end }), endKey(other)].sort().join("|");
      if (done.has(key)) return;
      done.add(key);
      const a = turnAt(it, end), b = turnAt(p.items.find((i) => i.id === other.item)!, other.end);
      if (!a || !b) return;
      // leaving `it` the train turns a.sign; entering the other piece it turns -b.sign: opposite turns when the signs match
      if (a.sign !== 0 && a.sign === b.sign && Math.max(a.r, b.r) < t.vehicle * 3)
        out.push({ kind: "s-bend", severity: "warn", items: [it.id, other.item],
          text: `${it.id} and ${other.item} make a reverse curve (R${Math.round(a.r)} into R${Math.round(b.r)}) with no straight between: put about ${Math.round(t.vehicle)} mm of straight there, or long vehicles may lock buffers` });
    });
  }
  return out;
}
