// Where the connector finds the plan: a Railplot hub (live: proposals reach every open Railplot at once)
// or a .railplot file (proposals are written into the file).
import fs from "node:fs";
import path from "node:path";
import { FileError, parseProject, serialize } from "../io";
import { Project, newProject } from "../model";
import type { Proposal } from "../proposals";
import type { Snapshot, Cmd } from "../control/remote";
import { ToolError } from "./server";

export interface Target {
  kind: "hub" | "file";
  label: string;
  load(): Promise<Project>;
  addProposal(pr: Proposal): Promise<void>;
  withdraw(id: string): Promise<boolean>;
}

export function hubBaseUrl(host: string): string {
  // the hub listens on IPv4; "localhost" can mean ::1 first on Windows
  host = host.trim().replace(/^localhost(?=:|$)/i, "127.0.0.1");
  if (/^https?:\/\//.test(host)) return host.replace(/\/$/, "").replace("//localhost", "//127.0.0.1");
  return /:\d+$/.test(host) ? `http://${host}` : `http://${host}:8080`;
}

async function req(url: string, init: RequestInit = {}, ms = 4000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  catch { throw new ToolError(`Can't reach the Railplot hub at ${url.replace(/\/api\/.*/, "")}. Is it running?`); }
  finally { clearTimeout(t); }
}

export class HubTarget implements Target {
  kind = "hub" as const;
  base: string;
  constructor(host: string) { this.base = hubBaseUrl(host); }
  get label() { return `the Railplot hub at ${this.base}`; }

  static async probe(host: string, ms = 1200): Promise<HubTarget | null> {
    const t = new HubTarget(host);
    try {
      const r = await req(`${t.base}/api/status`, {}, ms);
      const j = await r.json();
      return typeof j?.fw === "string" && j.fw.startsWith("railplot-hub") ? t : null;
    } catch { return null; }
  }

  async load(): Promise<Project> {
    const r = await req(`${this.base}/api/layout`);
    if (!r.ok) throw new ToolError(`The hub didn't send its layout (HTTP ${r.status}).`);
    return parseProject(await r.text());
  }

  async addProposal(pr: Proposal) {
    const r = await req(`${this.base}/api/proposals`, { method: "POST", body: JSON.stringify(pr), headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new ToolError(`The hub didn't take the proposal: ${await r.text()}`);
  }

  async withdraw(id: string) {
    const r = await req(`${this.base}/api/proposals/${encodeURIComponent(id)}`, { method: "DELETE" });
    return r.ok;
  }

  async state(): Promise<{ v: number; claude: boolean; snap: Snapshot }> {
    const r = await req(`${this.base}/api/state`);
    if (!r.ok) throw new ToolError(`This hub is too old for the controls (HTTP ${r.status}). Update the hub.`);
    return r.json();
  }

  async command(cmd: Cmd): Promise<string | null> {
    const r = await req(`${this.base}/api/claude/cmd`, { method: "POST", body: JSON.stringify(cmd), headers: { "Content-Type": "application/json" } });
    if (!r.ok) throw new ToolError(`The hub refused: ${await r.text()}`);
    return (await r.json()).error ?? null;
  }
}

/** Folders the connector may read and write .railplot files in. */
export class Folders {
  roots: string[];
  constructor(roots: string[]) {
    this.roots = roots.map((r) => { try { return fs.realpathSync(path.resolve(r)); } catch { return path.resolve(r); } });
  }

  /** A layout file path inside the allowed folders, or an error saying why not. */
  check(p: string, mustExist = true): string {
    if (!p) throw new ToolError("Give the path of a .railplot file.");
    const ext = path.extname(p).toLowerCase();
    if (ext !== ".railplot" && ext !== ".json") throw new ToolError("Only .railplot files (or Railplot .json files).");
    let full = path.resolve(this.roots[0] ?? process.cwd(), p);
    if (mustExist) {
      if (!fs.existsSync(full)) throw new ToolError(`There is no file at ${full}.`);
      full = fs.realpathSync(full);
    } else {
      try { full = path.join(fs.realpathSync(path.dirname(full)), path.basename(full)); } catch { throw new ToolError(`The folder ${path.dirname(full)} doesn't exist.`); }
    }
    if (!this.roots.some((r) => full === r || full.startsWith(r.endsWith(path.sep) ? r : r + path.sep)))
      throw new ToolError(`${full} isn't in a folder the Railplot connector may use (${this.roots.join(", ")}). Change the folders in the connector's settings.`);
    return full;
  }

  /** .railplot files in the folders (a few levels deep). */
  list(under?: string, max = 200): { path: string; size: number; modified: string }[] {
    const out: { path: string; size: number; modified: string }[] = [];
    const roots = under ? [this.checkDir(under)] : this.roots;
    const skip = new Set(["node_modules", ".git", "AppData", "Library", ".cache", ".Trash"]);
    const walk = (dir: string, depth: number) => {
      if (out.length >= max || depth > 4) return;
      let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= max) return;
        if (e.name.startsWith(".") || skip.has(e.name)) continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f, depth + 1);
        else if (e.isFile() && e.name.toLowerCase().endsWith(".railplot")) {
          try { const st = fs.statSync(f); out.push({ path: f, size: st.size, modified: new Date(st.mtimeMs).toISOString().slice(0, 16).replace("T", " ") }); } catch { /* gone */ }
        }
      }
    };
    for (const r of roots) walk(r, 0);
    return out;
  }

  private checkDir(d: string): string {
    const full = path.resolve(this.roots[0] ?? process.cwd(), d);
    if (!this.roots.some((r) => full === r || full.startsWith(r + path.sep))) throw new ToolError(`${full} isn't in a folder the connector may use.`);
    return full;
  }
}

export class FileTarget implements Target {
  kind = "file" as const;
  constructor(public file: string) {}
  get label() { return `the file ${this.file}`; }

  private read(): Project {
    try { return parseProject(fs.readFileSync(this.file, "utf8")); }
    catch (e) { throw new ToolError(e instanceof FileError ? e.message : `Couldn't read ${this.file}: ${(e as Error).message}`); }
  }

  private write(p: Project) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, serialize(p));
    fs.renameSync(tmp, this.file);
  }

  async load() { return this.read(); }

  async addProposal(pr: Proposal) {
    const p = this.read();
    p.proposals = [...(p.proposals ?? []).filter((x) => x.id !== pr.id), pr];
    this.write(p);
  }

  async withdraw(id: string) {
    const p = this.read();
    if (!(p.proposals ?? []).some((x) => x.id === id)) return false;
    p.proposals = p.proposals!.filter((x) => x.id !== id);
    if (!p.proposals.length) delete p.proposals;
    this.write(p);
    return true;
  }

  static create(file: string, name: string): FileTarget {
    if (fs.existsSync(file)) throw new ToolError(`${file} already exists. Open it instead, or choose another name.`);
    const p = newProject(name || path.basename(file, path.extname(file)));
    fs.writeFileSync(file, serialize(p));
    return new FileTarget(file);
  }
}
