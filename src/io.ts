// Reading and writing .railplot files (JSON).
import { getPart } from "./library";
import { FILE_FORMAT, FILE_VERSION, Project } from "./model";

export function serialize(p: Project): string {
  return JSON.stringify(p, (k, v) => (typeof v === "number" ? Math.round(v * 1e5) / 1e5 : v), 1);
}

export class FileError extends Error {}

/**
 * Steps that bring an older file up to this version: MIGRATIONS[v - 1] turns version v into v + 1.
 * Version 1 is the first, so there are none yet; each future change to the format adds one here, and
 * a test opens a file of every older version.
 */
const MIGRATIONS: ((data: any) => void)[] = [];

export function parseProject(text: string): Project {
  return readProject(text).p;
}

/**
 * Read a layout, bringing an older one up to date and putting right what would stop it working (a
 * piece on a layer that's gone, two things with the same id, a board with too few corners, a train
 * in a block that's gone). `notes` says what was put right, in a few words each.
 */
export function readProject(text: string): { p: Project; notes: string[] } {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new FileError("This file isn't a Railplot layout: it is not valid JSON."); }
  if (data?.format !== FILE_FORMAT) throw new FileError("This file isn't a Railplot layout (missing \"format\": \"railplot\").");
  if (typeof data.version !== "number" || data.version > FILE_VERSION)
    throw new FileError(`This layout was saved by a newer Railplot (file version ${data.version}). Update Railplot to open it.`);
  for (const k of ["layers", "boards", "starts", "items"]) if (!Array.isArray(data[k])) throw new FileError(`The layout file is damaged: "${k}" is missing.`);
  for (let v = Math.max(1, Math.floor(data.version)); v < FILE_VERSION; v++) MIGRATIONS[v - 1]?.(data);
  data.version = FILE_VERSION;
  const missing = new Set<string>();
  for (const it of data.items) if (!getPart(it?.part)) missing.add(it?.part);
  if (missing.size) throw new FileError(`This layout uses track this version doesn't have: ${[...missing].join(", ")}.`);
  const notes: string[] = [];
  const num = (n: unknown) => typeof n === "number" && Number.isFinite(n);

  // pieces and boards that can't be placed
  const badItems = data.items.filter((it: any) => !num(it.x) || !num(it.y) || !num(it.rot));
  if (badItems.length) { data.items = data.items.filter((it: any) => !badItems.includes(it)); notes.push(`${badItems.length} piece${badItems.length === 1 ? "" : "s"} of track with no position taken out`); }
  for (const it of data.items) { if (!Array.isArray(it.z)) it.z = []; it.mirror = !!it.mirror; }
  const badBoards = data.boards.filter((b: any) => !Array.isArray(b.pts) || b.pts.length < 3 || b.pts.some((q: any) => !num(q?.x) || !num(q?.y)));
  if (badBoards.length) { data.boards = data.boards.filter((b: any) => !badBoards.includes(b)); notes.push(`${badBoards.length} baseboard${badBoards.length === 1 ? "" : "s"} with too few corners taken out`); }

  // layers
  if (!data.layers.length) data.layers = [{ id: "L1", name: "Main line", visible: true }];
  if (!data.layers.some((l: any) => l.id === data.activeLayer)) data.activeLayer = data.layers[0].id;
  const lost = data.items.filter((it: any) => !data.layers.some((l: any) => l.id === it.layer));
  for (const it of lost) it.layer = data.activeLayer;
  if (lost.length) notes.push(`${lost.length} piece${lost.length === 1 ? "" : "s"} on a layer that's gone put on ${data.layers.find((l: any) => l.id === data.activeLayer).name}`);

  // ids: each one once
  data.nextId = Math.max(data.nextId ?? 1, 1 + Math.max(0, ...[...data.items, ...data.boards, ...data.starts, ...data.layers]
    .map((o: any) => parseInt(String(o.id).replace(/\D/g, "")) || 0)));
  const seen = new Set<string>();
  let renamed = 0;
  for (const [list, prefix] of [[data.items, "i"], [data.boards, "b"], [data.starts, "s"]] as const) for (const o of list) {
    if (typeof o.id !== "string" || seen.has(o.id)) { o.id = `${prefix}${data.nextId++}`; renamed++; }
    seen.add(o.id);
  }
  if (renamed) notes.push(`${renamed} thing${renamed === 1 ? "" : "s"} sharing an id given a new one`);

  // the control setup: lists it needs, and nothing pointing at what's gone
  const c = data.control;
  if (c && typeof c === "object") {
    for (const k of ["controllers", "blocks", "points", "sensors", "signals", "lights", "trains"]) if (!Array.isArray(c[k])) c[k] = [];
    c.nextId = num(c.nextId) ? c.nextId : 1;
    const blocks = new Set(c.blocks.map((b: any) => b.id));
    for (const b of c.blocks) if (!Array.isArray(b.items)) b.items = [];
    let moved = 0;
    for (const t of c.trains) if (t.block && !blocks.has(t.block)) { t.block = undefined; moved++; }
    if (moved) notes.push(`${moved} train${moved === 1 ? "" : "s"} in a block that's gone taken off the plan (place ${moved === 1 ? "it" : "them"} again)`);
    const sigs = c.signals.length;
    c.signals = c.signals.filter((g: any) => blocks.has(g.from) && blocks.has(g.to));
    if (c.signals.length < sigs) notes.push(`${sigs - c.signals.length} signal${sigs - c.signals.length === 1 ? "" : "s"} between blocks that are gone taken out`);
    if (c.consists !== undefined && !Array.isArray(c.consists)) c.consists = [];
    if (c.consists) c.consists = c.consists.filter((k: any) => Array.isArray(k?.vehicles));
  } else delete data.control;
  if (data.proposals !== undefined && !Array.isArray(data.proposals)) delete data.proposals;

  data.units ??= "mm";
  data.gridStep ??= 50;
  return { p: data as Project, notes };
}
