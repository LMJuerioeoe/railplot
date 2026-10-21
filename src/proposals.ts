// Proposals: changes to a plan that someone else (Claude, through the Railplot connector) suggests.
// A proposal sits in the plan until the owner accepts it (it is applied as an ordinary, undoable edit)
// or rejects it. It records the objects it adds, the new versions of the ones it changes, the ones it
// removes, and how the changed and removed ones looked, so it can tell when the plan has moved on.
import { Board, Item, Layer, Project, StartPoint, analyze, motorsOverFrame, summarize } from "./model";

export interface ProposalObjects { boards: Board[]; items: Item[]; starts: StartPoint[] }

export interface Proposal {
  id: string;
  title: string;
  /** Why it is suggested, in the proposer's words. */
  why?: string;
  by: string;
  at: string;               // ISO time
  /** Railplot hub only: the hub's layout version when it arrived. */
  v?: number;
  add: ProposalObjects & { layers: Layer[] };
  change: ProposalObjects;
  remove: string[];
  /** The changed and removed objects as they were when the proposal was made. */
  before: ProposalObjects;
  rename?: string;
}

const KINDS = ["boards", "items", "starts"] as const;
type Kind = (typeof KINDS)[number];
type Obj = Board | Item | StartPoint;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const empty = (): ProposalObjects => ({ boards: [], items: [], starts: [] });

export function newProposalId(): string {
  return `P${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, "0")}`;
}

/** The difference between a plan and a changed copy of it, as a proposal. */
export function diffProposal(before: Project, after: Project, title: string, why = "", by = "Claude"): Proposal {
  const pr: Proposal = {
    id: newProposalId(), title: title.trim() || "Suggested change", by, at: new Date().toISOString(),
    add: { ...empty(), layers: [] }, change: empty(), remove: [], before: empty(),
  };
  if (why.trim()) pr.why = why.trim();
  for (const k of KINDS) {
    const old = new Map<string, Obj>((before[k] as Obj[]).map((o) => [o.id, o]));
    const now = new Map<string, Obj>((after[k] as Obj[]).map((o) => [o.id, o]));
    for (const [id, o] of now) {
      const was = old.get(id);
      if (!was) (pr.add[k] as Obj[]).push(clone(o));
      else if (!same(was, o)) { (pr.change[k] as Obj[]).push(clone(o)); (pr.before[k] as Obj[]).push(clone(was)); }
    }
    for (const [id, o] of old) if (!now.has(id)) { pr.remove.push(id); (pr.before[k] as Obj[]).push(clone(o)); }
  }
  const layers = new Set(before.layers.map((l) => l.id));
  pr.add.layers = after.layers.filter((l) => !layers.has(l.id)).map(clone);
  if (after.name !== before.name) pr.rename = after.name;
  return pr;
}

export function isEmptyProposal(pr: Proposal): boolean {
  return !KINDS.some((k) => pr.add[k].length || pr.change[k].length) && !pr.remove.length && !pr.add.layers.length && !pr.rename;
}

/** Ids of objects the proposal changes or removes that no longer look the way they did. */
export function staleIds(p: Project, pr: Proposal): string[] {
  const out: string[] = [];
  for (const k of KINDS) {
    const now = new Map<string, Obj>((p[k] as Obj[]).map((o) => [o.id, o]));
    for (const o of pr.before[k] as Obj[]) {
      const cur = now.get(o.id);
      if (!cur || !same(cur, o)) out.push(o.id);
    }
  }
  return out;
}

const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "adds 9 pieces of track and 2 baseboards, moves 1 baseboard, removes 3 pieces of track" */
export function describeProposal(pr: Proposal): string {
  const words: Record<Kind, [string, string]> = { items: ["piece of track", "pieces of track"], boards: ["baseboard", "baseboards"], starts: ["start point", "start points"] };
  const list = (o: ProposalObjects) => KINDS.filter((k) => o[k].length).map((k) => counted(o[k].length, ...words[k]));
  const parts: string[] = [];
  const a = list(pr.add);
  if (pr.add.layers.length) a.push(counted(pr.add.layers.length, "layer"));
  if (a.length) parts.push(`adds ${join(a)}`);
  const c = list(pr.change);
  if (c.length) parts.push(`changes ${join(c)}`);
  if (pr.remove.length) {
    const r = KINDS.map((k) => [k, pr.before[k].filter((o) => pr.remove.includes(o.id)).length] as const).filter(([, n]) => n).map(([k, n]) => counted(n, ...words[k]));
    parts.push(`removes ${join(r)}`);
  }
  if (pr.rename) parts.push(`renames the plan “${pr.rename}”`);
  return parts.length ? join(parts) : "changes nothing";
}

function join(a: string[]) { return a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`; }

function freshId(p: Project, id: string, taken: Set<string>): string {
  if (!taken.has(id)) return id;
  const prefix = id.replace(/\d+$/, "") || "x";
  let n: string;
  do n = `${prefix}${p.nextId++}`; while (taken.has(n));
  return n;
}

function bumpNextId(p: Project) {
  const all = [...p.items, ...p.boards, ...p.starts, ...p.layers];
  p.nextId = Math.max(p.nextId, 1 + Math.max(0, ...all.map((o) => parseInt(String(o.id).replace(/\D/g, "")) || 0)));
}

export interface ApplyResult { ok: boolean; stale: string[]; ids: string[] }

/**
 * Apply a proposal to the plan and take it off the list. Refuses when objects it changes or removes have
 * since changed, unless `force` (then those changes win over the plan's). Returns the ids of the new and
 * changed objects, for selecting them.
 */
export function applyProposal(p: Project, pr: Proposal, force = false): ApplyResult {
  const stale = staleIds(p, pr);
  if (stale.length && !force) return { ok: false, stale, ids: [] };
  const ids: string[] = [];
  const remove = new Set(pr.remove);
  for (const k of KINDS) (p as any)[k] = (p[k] as Obj[]).filter((o) => !remove.has(o.id));
  for (const k of KINDS) for (const o of pr.change[k] as Obj[]) {
    const list = p[k] as Obj[];
    const i = list.findIndex((x) => x.id === o.id);
    if (i >= 0) list[i] = clone(o); else list.push(clone(o));
    ids.push(o.id);
  }
  // new objects keep their ids unless the plan has since used them
  const taken = new Set<string>([...p.items, ...p.boards, ...p.starts, ...p.layers].map((o) => o.id));
  const layerIds = new Map<string, string>();
  for (const l of pr.add.layers) {
    const id = freshId(p, l.id, taken); taken.add(id); layerIds.set(l.id, id);
    p.layers.push({ ...clone(l), id });
  }
  const layerOk = new Set(p.layers.map((l) => l.id));
  for (const k of KINDS) for (const o of pr.add[k] as Obj[]) {
    const c = clone(o) as Obj;
    c.id = freshId(p, c.id, taken); taken.add(c.id);
    (p[k] as Obj[]).push(c);
    ids.push(c.id);
  }
  for (const it of p.items) {
    if (layerIds.has(it.layer)) it.layer = layerIds.get(it.layer)!;
    if (!layerOk.has(it.layer)) it.layer = p.activeLayer;
  }
  if (pr.rename) p.name = pr.rename;
  bumpNextId(p);
  p.proposals = (p.proposals ?? []).filter((x) => x.id !== pr.id);
  if (!p.proposals.length) delete p.proposals;
  return { ok: true, stale, ids };
}

export function rejectProposal(p: Project, id: string) {
  p.proposals = (p.proposals ?? []).filter((x) => x.id !== id);
  if (!p.proposals.length) delete p.proposals;
}

/** The plan as it would be with the proposal accepted (a copy). */
export function withProposal(p: Project, pr: Proposal): Project {
  const q: Project = clone(p);
  applyProposal(q, pr, true);
  return q;
}

/**
 * Proposals from two versions of the same plan, after one side resolved some: keep the ones `mine` has,
 * plus ones that arrived in `theirs` that `mine` hasn't seen (`seen` lists every id this side has had).
 */
export function mergeProposals(mine: Proposal[] | undefined, theirs: Proposal[] | undefined, seen: Set<string>): Proposal[] {
  const out = [...(mine ?? [])];
  for (const pr of theirs ?? []) if (!seen.has(pr.id) && !out.some((x) => x.id === pr.id)) out.push(pr);
  return out;
}

/** A short health check of a plan, for saying what a proposal leads to. */
export function healthLine(p: Project): string {
  const s = summarize(p);
  const an = analyze(p);
  const bits = [
    s.freeEnds ? `${s.freeEnds} open end${s.freeEnds === 1 ? "" : "s"}` : "no open ends",
    an.bad.length ? `${an.bad.length} misaligned joint${an.bad.length === 1 ? "" : "s"}` : "joints aligned",
  ];
  if (p.boards.some((b) => b.module)) {
    const m = motorsOverFrame(p).length;
    bits.push(m ? `${m} point motor${m === 1 ? "" : "s"} over the frame` : "point motors clear of the frame");
  }
  return bits.join(", ");
}
