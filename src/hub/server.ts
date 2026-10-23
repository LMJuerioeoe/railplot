// The Railplot hub: runs the layout on a laptop or Raspberry Pi with no screen needed.
// It drives the controllers, serves Railplot to phones, keeps every connected device in step,
// and speaks WiThrottle so Engine Driver and WiThrottle apps work.
import fs from "node:fs";
import path from "node:path";
import type { ServerWebSocket } from "bun";
import { ControlRuntime } from "../control/runtime";
import { Cmd, applyCommand, snapshot } from "../control/remote";
import { syncPoints, syncSensors, topology } from "../control/engine";
import { emptyControl } from "../control/types";
import { FileError, parseProject, serialize } from "../io";
import { Project } from "../model";
import type { Proposal } from "../proposals";
import { buildSample } from "../sample";
import { hubMakeLink } from "./transports";
import { WT_PORT, WtServer } from "./withrottle";
import { MdnsResponder, localIPv4 } from "./mdns";

export interface HubOptions {
  layout: string;           // file the hub keeps its layout in
  port: number;             // web page and API
  wtPort: number;           // WiThrottle; 0 turns it off
  name: string;             // shown in throttle apps
  host: string;             // mDNS host name, without .local
  mdns: boolean;
  appHtml: string;          // the Railplot web app
  version: string;
  quiet?: boolean;
}

type Client = { cid: string };

export class Hub {
  p: Project;
  rt: ControlRuntime;
  version = 1;
  clients = new Set<ServerWebSocket<Client>>();
  wt: WtServer | null = null;
  mdns: MdnsResponder | null = null;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = performance.now();
  private savedState = "";
  private saveTimer = 0;
  private lastSnap = "";
  /** How many proposals the last layout from an editor didn't have yet (so the editor fetches the layout again). */
  lastMerged = 0;

  constructor(public o: HubOptions) {
    this.p = this.load();
    this.prepare(this.p);
    this.rt = new ControlRuntime(this.p, this.p.control!, { makeLink: hubMakeLink, session: false });
  }

  log(msg: string) { if (!this.o.quiet) console.log(`${new Date().toLocaleTimeString()}  ${msg}`); }

  private load(): Project {
    try {
      if (fs.existsSync(this.o.layout)) return parseProject(fs.readFileSync(this.o.layout, "utf8"));
      this.log(`No layout at ${this.o.layout} yet: starting with the sample. Send yours from Railplot (Control > Set up > Railplot hub).`);
    } catch (e) {
      this.log(`Couldn't read ${this.o.layout}: ${e instanceof FileError ? e.message : (e as Error).message}. Starting with the sample.`);
    }
    return buildSample();
  }

  private prepare(p: Project) {
    p.control ??= emptyControl();
    p.control.routes ??= [];
    p.control.automations ??= [];
    syncPoints(p, p.control);
    syncSensors(p, p.control, topology(p, p.control));
  }

  get engine() { return this.rt.engine; }

  start() {
    const hub = this;
    this.server = Bun.serve<Client, {}>({
      hostname: "0.0.0.0", port: this.o.port,
      fetch(req, server) { return hub.http(req, server); },
      websocket: {
        open(ws) { hub.clients.add(ws); hub.send(ws, { t: "state", s: hub.snap() }); },
        close(ws) { hub.clients.delete(ws); },
        message(ws, data) { hub.onMessage(ws, String(data)); },
      },
    });
    if (this.o.wtPort) {
      this.wt = new WtServer({ engine: () => this.engine, project: () => this.p, name: this.o.name, version: this.o.version, log: (m) => this.log(m) }, this.o.wtPort);
      try { this.wt.start(); } catch (e) { this.log(`WiThrottle server couldn't start on port ${this.o.wtPort}: ${(e as Error).message}`); this.wt = null; }
    }
    if (this.o.mdns && this.wt) {
      this.mdns = new MdnsResponder({ instance: this.o.name, type: "_withrottle._tcp", port: this.o.wtPort }, this.o.host, (m) => this.log(m));
      this.mdns.start();
    }
    this.timer = setInterval(() => this.tick(), 100);
    const ips = localIPv4();
    this.log(`Railplot hub ${this.o.version} is running.`);
    this.log(`  Phones and laptops: open ${ips.map((ip) => `http://${ip}:${this.o.port}`).join(" or ") || `http://localhost:${this.o.port}`}${this.o.mdns ? ` (or http://${this.o.host}.local:${this.o.port})` : ""}`);
    if (this.wt) this.log(`  WiThrottle and Engine Driver: ${ips[0] ?? "this computer"}, port ${this.o.wtPort}${this.mdns ? " (they should find it by themselves)" : ""}`);
    this.log(`  Layout: ${this.p.name}, kept in ${path.resolve(this.o.layout)}`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.saveNow();
    this.wt?.stop();
    this.mdns?.stop();
    this.rt.close();
    this.server?.stop(true);
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    this.rt.tick(dt);
    const e = this.engine;
    while (e.events.length) { const t = e.events.shift()!; this.log(t); this.broadcast({ t: "event", text: t }); }
    this.wt?.poll();
    this.stockChanged();
    const s = JSON.stringify({ t: "state", s: this.snap() });
    if (s !== this.lastSnap) { this.lastSnap = s; for (const ws of this.clients) ws.send(s); }
    this.saveSoon();
  }

  /**
   * The simulator changes the layout's rolling stock as trains couple and uncouple, and when a window
   * places, turns round or takes off vehicles: a new layout version then has windows fetch it again,
   * so the stock they have (and send back with their next edit) matches the hub's.
   */
  private stockChanged() {
    const sig = JSON.stringify((this.p.control?.consists ?? []).map((c) => [c.id, c.train, c.vehicles.map((v) => v.id)]));
    if (this.stockSig === null) { this.stockSig = sig; return; }
    if (sig === this.stockSig) return;
    this.stockSig = sig;
    this.version++;
    this.saveSoon();
  }
  private stockSig: string | null = null;

  snap() { return snapshot(this.engine, this.version, this.rt.linkSummaries(), this.clients.size + (this.wt?.sessions.size ?? 0)); }

  private send(ws: ServerWebSocket<Client>, m: unknown) { ws.send(JSON.stringify(m)); }
  private broadcast(m: unknown) { const s = JSON.stringify(m); for (const ws of this.clients) ws.send(s); }

  private onMessage(ws: ServerWebSocket<Client>, text: string) {
    let m: any;
    try { m = JSON.parse(text); } catch { return; }
    if (m?.t !== "cmd" || !m.cmd) return;
    let error: string | null;
    try { error = applyCommand(this.engine, m.cmd as Cmd, { take: (id) => this.rt.takeOver.add(id) }); }
    catch (e) { error = (e as Error).message; }
    this.stockChanged();
    this.send(ws, { t: "result", id: m.id, error });
  }

  /**
   * A new layout from a Railplot editor. Trains, points and signals keep their live state where they still exist.
   * `base`: the hub version the editor last had; proposals that arrived after that are kept, the others
   * the editor has accepted or rejected.
   */
  setLayout(text: string, base?: number, resolved?: Set<string>): number {
    const p = parseProject(text);
    this.prepare(p);
    if (resolved) {
      // the editor says which proposals it accepted or rejected: every other one the hub has stays
      const keep = (this.p.proposals ?? []).filter((x) => !resolved.has(x.id) && !(p.proposals ?? []).some((y) => y.id === x.id));
      if (keep.length) p.proposals = [...(p.proposals ?? []), ...keep];
      this.lastMerged = keep.length;
    } else if (base !== undefined) {
      const newer = (this.p.proposals ?? []).filter((x) => (x.v ?? 0) > base && !(p.proposals ?? []).some((y) => y.id === x.id));
      if (newer.length) p.proposals = [...(p.proposals ?? []), ...newer];
      this.lastMerged = newer.length;
    } else this.lastMerged = 0;
    const old = this.p.control!, cfg = p.control!;
    for (const t of cfg.trains) { const o = old.trains.find((x) => x.id === t.id); if (o) t.block = o.block; }
    for (const q of cfg.points) { const o = old.points.find((x) => x.item === q.item); if (o) q.state = o.state; }
    for (const g of cfg.signals) { const o = old.signals.find((x) => x.id === g.id); if (o) g.mode = o.mode; }
    for (const l of cfg.lights) { const o = old.lights.find((x) => x.id === l.id); if (o) { l.on = o.on; l.level = o.level; } }
    this.p = p;
    this.rt.setProject(p, cfg);
    this.version++;
    this.stockSig = null;   // the editor's stock is the hub's now
    this.saveNow();
    this.wt?.relist();
    this.log(`Layout updated: ${p.name}`);
    return this.version;
  }

  /** A proposal from the Claude connector: it joins the layout and every editor gets it. */
  addProposal(pr: Proposal): number {
    if (!pr || typeof pr.id !== "string" || !pr.add || !pr.change || !Array.isArray(pr.remove)) throw new Error("That isn't a proposal.");
    this.version++;
    pr.v = this.version;
    this.p.proposals = [...(this.p.proposals ?? []).filter((x) => x.id !== pr.id), pr];
    this.saveNow();
    this.log(`Claude proposed: ${pr.title}`);
    return this.version;
  }

  withdrawProposal(id: string): boolean {
    const had = (this.p.proposals ?? []).some((x) => x.id === id);
    if (!had) return false;
    this.p.proposals = this.p.proposals!.filter((x) => x.id !== id);
    if (!this.p.proposals.length) delete this.p.proposals;
    this.version++;
    this.saveNow();
    return true;
  }

  /** A command from the Claude connector: only when the layout allows it, and never track power or emergency stops. */
  claudeCommand(cmd: Cmd): string | null {
    if (!this.p.control?.claude) return "Claude isn't allowed to use the controls on this layout. Turn on \"Let Claude use the controls\" in Railplot, under Control > Set up > Railplot hub.";
    const allowed: Cmd["c"][] = ["throttle", "point", "signal", "light", "route", "auto"];
    if (!allowed.includes(cmd?.c)) return "Claude can set routes, points, signals and lights, drive trains and run automations, but not track power or emergency stops.";
    const err = applyCommand(this.engine, cmd);
    if (!err) this.log(`Claude: ${JSON.stringify(cmd)}`);
    return err;
  }

  private saveSoon() {
    const now = Date.now();
    if (now - this.saveTimer < 5000) return;
    this.saveTimer = now;
    this.saveNow();
  }

  saveNow() {
    const text = serialize(this.p);
    if (text === this.savedState) return;
    try {
      fs.mkdirSync(path.dirname(path.resolve(this.o.layout)), { recursive: true });
      const tmp = `${this.o.layout}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, this.o.layout);
      this.savedState = text;
    } catch (e) { this.log(`Couldn't save the layout: ${(e as Error).message}`); }
  }

  private cors(h: Record<string, string> = {}) {
    return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Railplot-Resolved", "Access-Control-Expose-Headers": "X-Railplot-Version", "Cache-Control": "no-store", ...h };
  }

  private async http(req: Request, server: { upgrade(r: Request, o: { data: Client }): boolean }): Promise<Response | undefined> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: this.cors({ "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" }) });
    if (url.pathname === "/api/ws") {
      if (server.upgrade(req, { data: { cid: url.searchParams.get("cid") ?? "" } })) return undefined;
      return new Response("WebSocket expected", { status: 400 });
    }
    if (url.pathname === "/api/status") {
      return Response.json({ fw: `railplot-hub ${this.o.version}`, v: this.version, name: this.o.name, layout: this.p.name, withrottle: this.wt ? this.o.wtPort : 0, clients: this.clients.size }, { headers: this.cors() });
    }
    if (url.pathname === "/api/layout" && req.method === "GET") {
      return new Response(serialize(this.p), { headers: this.cors({ "Content-Type": "application/json", "X-Railplot-Version": String(this.version) }) });
    }
    if (url.pathname === "/api/layout" && req.method === "POST") {
      const text = await req.text();
      if (text.length > 20_000_000) return new Response("Layout too big", { status: 413, headers: this.cors() });
      const base = url.searchParams.get("base");
      try {
        const res = req.headers.get("X-Railplot-Resolved");
        const v = this.setLayout(text, base !== null && /^\d+$/.test(base) ? +base : undefined, res === null ? undefined : new Set(res.split(",").filter(Boolean)));
        return Response.json({ v, merged: this.lastMerged }, { headers: this.cors() });
      }
      catch (e) { return new Response(e instanceof FileError ? e.message : `Couldn't read that layout: ${(e as Error).message}`, { status: 400, headers: this.cors() }); }
    }
    if (url.pathname === "/api/state") {
      return Response.json({ v: this.version, claude: !!this.p.control?.claude, snap: this.snap() }, { headers: this.cors() });
    }
    if (url.pathname === "/api/proposals" && req.method === "POST") {
      try { return Response.json({ v: this.addProposal(await req.json()) }, { headers: this.cors() }); }
      catch (e) { return new Response((e as Error).message, { status: 400, headers: this.cors() }); }
    }
    const pm = url.pathname.match(/^\/api\/proposals\/([\w-]+)$/);
    if (pm && req.method === "DELETE") {
      return this.withdrawProposal(pm[1]) ? Response.json({ v: this.version }, { headers: this.cors() }) : new Response("No such proposal", { status: 404, headers: this.cors() });
    }
    if (url.pathname === "/api/claude/cmd" && req.method === "POST") {
      let cmd: Cmd;
      try { cmd = await req.json(); } catch { return new Response("Expected a command", { status: 400, headers: this.cors() }); }
      let error: string | null;
      try { error = this.claudeCommand(cmd); } catch (e) { error = (e as Error).message; }
      return Response.json({ error }, { headers: this.cors() });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(this.o.appHtml, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
    }
    return new Response("Not found", { status: 404, headers: this.cors() });
  }
}

export { WT_PORT };
