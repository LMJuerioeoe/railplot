// Reading and writing .railplot files (JSON).
import { getPart } from "./library";
import { FILE_FORMAT, FILE_VERSION, Project } from "./model";

export function serialize(p: Project): string {
  return JSON.stringify(p, (k, v) => (typeof v === "number" ? Math.round(v * 1e5) / 1e5 : v), 1);
}

export class FileError extends Error {}

export function parseProject(text: string): Project {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new FileError("This file isn't a Railplot layout: it is not valid JSON."); }
  if (data?.format !== FILE_FORMAT) throw new FileError("This file isn't a Railplot layout (missing \"format\": \"railplot\").");
  if (typeof data.version !== "number" || data.version > FILE_VERSION)
    throw new FileError(`This layout was saved by a newer Railplot (file version ${data.version}). Update Railplot to open it.`);
  for (const k of ["layers", "boards", "starts", "items"]) if (!Array.isArray(data[k])) throw new FileError(`The layout file is damaged: "${k}" is missing.`);
  const missing = new Set<string>();
  for (const it of data.items) if (!getPart(it.part)) missing.add(it.part);
  if (missing.size) throw new FileError(`This layout uses track this version doesn't have: ${[...missing].join(", ")}.`);
  if (!data.layers.length) data.layers = [{ id: "L1", name: "Main line", visible: true }];
  if (!data.layers.some((l: any) => l.id === data.activeLayer)) data.activeLayer = data.layers[0].id;
  data.nextId = Math.max(data.nextId ?? 1, 1 + Math.max(0, ...[...data.items, ...data.boards, ...data.starts, ...data.layers]
    .map((o: any) => parseInt(String(o.id).replace(/\D/g, "")) || 0)));
  data.units ??= "mm";
  data.gridStep ??= 50;
  return data as Project;
}
