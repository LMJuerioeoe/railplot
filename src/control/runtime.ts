// The control loop without any user interface: steps the engine, sends each controller its frame
// and reads back sensors and currents. The browser and the hub both run one of these.
import { ControlEngine } from "./engine";
import { Link, baseUrl, fetchText, linkKey, postText } from "./link";
import { LinkSummary } from "./remote";
import { ControlConfig, Controller } from "./types";
import type { Project } from "../model";

export type LinkFactory = (c: Controller, engine: () => ControlEngine) => Link;

export interface RuntimeOptions {
  makeLink: LinkFactory;
  /** Share train positions and point settings through the first ESP32, so phones opening it pick up where you left off. */
  session?: boolean;
  /** Called after state was read back from a controller's session. */
  onSessionPulled?(): void;
  /** Called when there's state worth saving. */
  onStateChanged?(): void;
}

export class ControlRuntime {
  engine: ControlEngine;
  links = new Map<string, Link>();
  takeOver = new Set<string>();
  private wasDriving = new Map<string, boolean>();
  private lastSession = "";
  private sessionTimer = 0;

  constructor(p: Project, cfg: ControlConfig, private opts: RuntimeOptions) {
    this.engine = new ControlEngine(p, cfg);
    this.syncLinks();
  }

  get cfg() { return this.engine.cfg; }

  setProject(p: Project, cfg: ControlConfig) {
    this.engine.setProject(p, cfg);
    this.syncLinks();
  }

  /** While a hub drives the layout, this device mustn't talk to the controllers itself. */
  suspended = false;
  setSuspended(on: boolean) {
    this.suspended = on;
    if (on) this.close(); else this.syncLinks();
  }

  /** Make a link for every controller, replacing links whose controller changed. */
  syncLinks() {
    const cfg = this.cfg;
    if (this.suspended) return;
    for (const [id, l] of [...this.links]) {
      const c = cfg.controllers.find((x) => x.id === id);
      if (!c || l.key !== linkKey(c)) { l.close?.(); this.links.delete(id); continue; }
      l.controller = c;   // the same controller after an undo or a reload: keep the connection
    }
    for (const c of cfg.controllers) if (!this.links.has(c.id)) this.links.set(c.id, this.opts.makeLink(c, () => this.engine));
  }

  /** Drop a controller's link so it reconnects with new settings. */
  resetLink(id: string) { this.links.get(id)?.close?.(); this.links.delete(id); this.syncLinks(); }

  tick(dt: number) {
    const e = this.engine;
    e.step(dt);
    const frames = e.frames();
    for (const c of this.cfg.controllers) {
      const link = this.links.get(c.id);
      const frame = frames.get(c.id);
      if (!link || !frame || link.busy) continue;
      const take = this.takeOver.has(c.id);
      link.exchange(frame, take).then((st) => {
        if (!st) return;
        if (st.accepted) this.takeOver.delete(c.id);
        const was = this.wasDriving.get(c.id) ?? false;
        if (st.accepted && !was && c.kind === "esp32" && this.opts.session) this.pullSession(c.id);
        this.wasDriving.set(c.id, st.accepted);
        if (st.accepted) {
          e.updateSensors(c.id, st.inputs);
          e.updateCurrents(c.id, st.mA);
        }
      }).catch(() => { /* a link reports its own errors in its status */ });
    }
    if (this.opts.session) this.pushSessionSoon();
  }

  linkSummaries(): [string, LinkSummary][] {
    return [...this.links].map(([id, l]) => [id, l.status ? { online: l.status.online, accepted: l.status.accepted, message: l.status.message, fw: l.status.fw } : { online: false, accepted: false, message: "Connecting…" }]);
  }

  close() { for (const l of this.links.values()) l.close?.(); this.links.clear(); }

  // ---------- sharing state between devices through the first ESP32 ----------

  private hub() { return this.cfg.controllers.find((c) => c.kind === "esp32"); }

  private sessionJson() {
    const cfg = this.cfg;
    return JSON.stringify({
      trains: cfg.trains.map((t) => ({ id: t.id, block: t.block })),
      points: cfg.points.map((p) => ({ item: p.item, state: p.state })),
      lights: cfg.lights.map((l) => ({ id: l.id, on: l.on, level: l.level })),
      signals: cfg.signals.map((s) => ({ id: s.id, mode: s.mode })),
    });
  }

  private pushSessionSoon() {
    const hub = this.hub();
    if (!hub || !this.links.get(hub.id)?.status?.accepted) return;
    const now = performance.now();
    if (now - this.sessionTimer < 2000) return;
    this.sessionTimer = now;
    const j = this.sessionJson();
    if (j === this.lastSession) return;
    this.lastSession = j;
    postText(`${baseUrl(hub)}/api/session`, j).catch(() => { this.lastSession = ""; });
    this.opts.onStateChanged?.();
  }

  private async pullSession(controllerId: string) {
    const c = this.cfg.controllers.find((x) => x.id === controllerId);
    if (!c || c !== this.hub()) return;
    const txt = await fetchText(`${baseUrl(c)}/api/session`);
    if (!txt) return;
    try {
      const s = JSON.parse(txt);
      const cfg = this.cfg;
      for (const t of s.trains ?? []) { const x = cfg.trains.find((y) => y.id === t.id); if (x) x.block = t.block; }
      for (const p of s.points ?? []) { const x = cfg.points.find((y) => y.item === p.item); if (x) x.state = p.state; }
      for (const l of s.lights ?? []) { const x = cfg.lights.find((y) => y.id === l.id); if (x) { x.on = l.on; x.level = l.level; } }
      for (const g of s.signals ?? []) { const x = cfg.signals.find((y) => y.id === g.id); if (x) x.mode = g.mode; }
      this.engine.assign();
      this.opts.onSessionPulled?.();
    } catch { /* ignore a damaged session */ }
  }
}

