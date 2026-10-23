// Control mode: drive trains, throw points, set signals and lights from a laptop or phone,
// run automations, and set up how the real layout is wired.
import type { App } from "../app";
import { Vec, dist, distToPrim, primAt } from "../geom";
import { geom, partOf } from "../model";
import { fmtLen, toScreen, View } from "../render2d";
import { clear, h, icon } from "../ui/dom";
import { dialog, field, numInput, toast } from "../ui/dialogs";
import {
  Aspect, ControlEngine, addBlock, addController, addLight, addSensorsAtBoundaries, addSignal, addTrain, controlWarnings, inputWhere,
  outputWhere, pointLabel, quickStart, servoWhere, syncPoints, syncSensors, topology, wiringList, BLOCK_PINS,
} from "./engine";
import { CLIENT_ID, Link, SimLink, baseUrl, makeLink, uploadFile, webSerialSupported } from "./link";
import { ControlRuntime } from "./runtime";
import { Cmd, LinkSummary, applyCommand, applySnapshot } from "./remote";
import { HubClient, hubBase, hubStatus } from "./hubclient";
import { renderAuto } from "./autoui";
import { divideForTrains } from "./divide";
import { Feed, Joiner, feeds, joiners, wiringSvg } from "./wiringplan";
import { ORIGINAL_HTML } from "../original";
import { worldFor } from "../sim/world";
import { ControlConfig, DCCEX_CAB_BASE, channelName, channelsOf, emptyControl } from "./types";

type SetupTool = { kind: "block"; id: string } | { kind: "signal" } | { kind: "place"; train: string } | null;

export const ASPECT_COLOR: Record<Aspect, string> = { red: "#e0413a", yellow: "#f0b429", green: "#2fbf5b" };
const HUB_KEY = "railplot.hub";

export class ControlUI {
  rt: ControlRuntime;
  hub: HubClient | null = null;
  tab: "drive" | "auto" | "setup" = "drive";
  tool: SetupTool = null;
  private timer = 0;
  private lastTick = 0;
  private live: { el: HTMLElement; update: () => void }[] = [];
  private pushTimer = 0;
  private applyingRemote = false;
  private pulling = false;
  dirtySetup = false;

  constructor(public app: App) {
    this.rt = new ControlRuntime(app.p, this.cfg, {
      makeLink, session: true,
      onSessionPulled: () => this.app.refresh(),
      onStateChanged: () => this.app.scheduleAutosave(),
    });
  }

  get engine(): ControlEngine { return this.rt.engine; }
  get links(): Map<string, Link> { return this.rt.links; }

  get cfg(): ControlConfig {
    if (!this.app.p.control) this.app.p.control = emptyControl();
    return this.app.p.control;
  }

  /** The plan and its track pieces as this last saw them, to tell new track from old. */
  private seen: { p: object; items: Set<string> } | null = null;

  /**
   * With one block for the whole layout, track laid since joins it: otherwise it has no power and a
   * train put on it can't move. Only while that block holds all the track it did before.
   */
  private joinNewTrack() {
    const p = this.app.p, cfg = this.cfg, ids = p.items.map((i) => i.id);
    const before = this.seen?.p === p ? this.seen.items : null;
    this.seen = { p, items: new Set(ids) };
    if (!before || cfg.blocks.length !== 1) return;
    const b = cfg.blocks[0], mine = new Set(b.items);
    const fresh = ids.filter((id) => !before.has(id));
    if (fresh.length && [...before].every((id) => mine.has(id) || !this.seen!.items.has(id))) {
      b.items.push(...fresh);
      this.app.hist.amend(p);   // the undo step that laid the track has it in the block too
    }
  }

  /** Called when the plan or the control setup changed. */
  onProjectChanged() {
    const cfg = this.cfg;
    syncPoints(this.app.p, cfg);
    for (const b of cfg.blocks) b.items = b.items.filter((id) => this.app.p.items.some((i) => i.id === id));
    this.joinNewTrack();
    syncSensors(this.app.p, cfg, topology(this.app.p, cfg));
    this.rt.setProject(this.app.p, cfg);
    if (this.hub?.snap) applySnapshot(this.engine, this.hub.snap);
    this.ensureRunning();
  }

  /** Called after an edit was committed: a hub gets the new layout. */
  onCommitted() {
    if (!this.hub || this.applyingRemote) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => { this.pushTimer = 0; this.pushLayout(); }, 700);
  }

  /** The control loop runs whenever there are controllers, in design mode too, so trains keep going. */
  ensureRunning() {
    if (this.timer || (!this.cfg.controllers.length && !this.hub)) return;
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), 100);
  }

  stop() { clearInterval(this.timer); this.timer = 0; }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (!this.hub) this.rt.tick(dt);
    const e = this.engine;
    while (e.events.length) toast(e.events.shift()!);
    if (this.app.mode === "control") { this.app.render(); for (const l of this.live) l.update(); }
  }

  // ---------- commands: run here, or on the hub ----------

  /** Do something to the layout. Errors are shown as a toast. */
  act(cmd: Cmd): Promise<string | null> {
    if (this.hub) {
      return this.hub.send(cmd).then((err) => { if (err) toast(err, "error"); return err; });
    }
    const err = applyCommand(this.engine, cmd, { take: (id) => this.rt.takeOver.add(id) });
    if (err) toast(err, "error");
    this.app.scheduleAutosave();
    return Promise.resolve(err);
  }

  /**
   * Send a command that changes the simulator's rolling stock to the hub, after this window's edits not
   * sent yet (a rake just made up has to be on the hub before it can be put on the track there).
   */
  async sendStock(cmd: Cmd): Promise<string | null> {
    if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = 0; await this.pushLayout(false); }
    return this.act(cmd);
  }

  /** Run a command, then redraw the panel and the plan. */
  private doAndRender(cmd: Cmd, ok?: string) {
    this.act(cmd).then((err) => { if (!err && ok) toast(ok); this.render(); this.app.render(); });
    if (!this.hub) { this.render(); this.app.render(); }
  }

  // ---------- a Railplot hub ----------

  savedHubHost(): string { try { return localStorage.getItem(HUB_KEY) ?? ""; } catch { return ""; } }

  /**
   * Connect to a hub. `useHubLayout`: take the layout the hub has (a phone joining), otherwise send this one.
   * The hub then drives the controllers, and this device only shows and sends.
   */
  async connectHub(host: string, useHubLayout: boolean): Promise<boolean> {
    const base = hubBase(host);
    const st = await hubStatus(base);
    if (!st) { toast(`No Railplot hub answered at ${base}.`, "error"); return false; }
    this.disconnectHub(false);
    const hub = new HubClient(host);
    this.hub = hub;
    try { if (host) localStorage.setItem(HUB_KEY, host); } catch { /* not kept */ }
    hub.onEvent = (t) => toast(t);
    let sim = false;
    hub.onSnapshot = (s) => {
      if (s.v !== hub.version && !this.pulling) this.pullLayout();
      else if (!this.pulling) applySnapshot(this.engine, s);
      // the hub's simulator came or went: Drive in 3D comes and goes with it
      if (!!s.world !== sim) { sim = !!s.world; this.render(); }
    };
    this.rt.setSuspended(true);
    if (useHubLayout) await this.pullLayout();
    else await this.pushLayout(true, true);
    this.ensureRunning();
    this.render();
    toast(`Connected to the hub at ${base}.`);
    return true;
  }

  disconnectHub(notify = true) {
    if (!this.hub) return;
    this.hub.close();
    this.hub = null;
    worldFor(this.engine).unmirror();
    this.rt.setSuspended(false);
    this.onProjectChanged();
    if (notify) { toast("Disconnected from the hub. This device drives the controllers again."); this.render(); }
  }

  private async pullLayout() {
    const hub = this.hub;
    if (!hub) return;
    this.pulling = true;
    try {
      // edits not sent yet go first, so they aren't lost (the hub keeps anything newer, like Claude's proposals)
      if (this.pushTimer) { clearTimeout(this.pushTimer); this.pushTimer = 0; await this.pushLayout(false); }
      const got = await hub.fetchLayout();
      if (!got) return;
      const { parseProject } = await import("../io");
      const p = parseProject(got.text);
      hub.version = got.v;
      this.applyingRemote = true;
      this.app.applyRemoteProject(p);
    } catch (e) {
      toast(`Couldn't read the hub's layout: ${(e as Error).message}`, "error");
    } finally {
      this.applyingRemote = false;
      this.pulling = false;
      if (hub.snap) applySnapshot(this.engine, hub.snap);
    }
  }

  private async pushLayout(pullIfMerged = true, replace = false) {
    const hub = this.hub;
    if (!hub) return;
    try {
      const { serialize } = await import("../io");
      const r = await hub.pushLayout(serialize(this.app.p), replace ? undefined : this.app.resolvedProposals);
      if (r.merged && pullIfMerged && !this.pulling) await this.pullLayout();
      else if (r.merged) hub.version = -1;
    } catch (e) { toast(`Couldn't send the layout to the hub: ${(e as Error).message}`, "error"); }
  }

  // ---------- the ESP32 can serve Railplot to phones ----------

  private esp() { return this.cfg.controllers.find((c) => c.kind === "esp32"); }

  async sendLayout() {
    const hub = this.esp();
    if (!hub) { toast("Add a controller first."); return; }
    try {
      const { serialize } = await import("../io");
      await uploadFile(`${baseUrl(hub)}/api/layout`, "layout.json", serialize(this.app.p));
      toast(`Layout sent to ${hub.name}. Phones that open ${hub.host || "the controller"} now get this plan.`);
    } catch (e) { toast(`Couldn't send the layout to ${hub.host}: ${(e as Error).message}`, "error"); }
  }

  async installApp() {
    const hub = this.esp();
    if (!hub) { toast("Add a controller first."); return; }
    if (!ORIGINAL_HTML) { toast("Install from the desktop app or the offline file; this copy of Railplot can't send itself.", "error"); return; }
    toast(`Installing Railplot on ${hub.name}…`);
    try {
      await uploadFile(`${baseUrl(hub)}/api/app`, "index.html", ORIGINAL_HTML, 60000);
      await this.sendLayout();
      toast(`Railplot is on ${hub.name}. Phones on the same Wi-Fi can open http://${hub.host || "railplot.local"}.`);
    } catch (e) { toast(`Couldn't install on ${hub.host}: ${(e as Error).message}`, "error"); }
  }

  // ---------- drawing on the plan ----------

  drawOverlay(ctx: CanvasRenderingContext2D, v: View) {
    const p = this.app.p, cfg = this.cfg, e = this.engine;
    const blockOf = e.topo.blockOfItem;
    ctx.save();
    ctx.lineCap = "round";
    // blocks: own colour; live blocks in the train's colour
    for (const it of p.items) {
      const bid = blockOf.get(it.id);
      const b = bid ? cfg.blocks.find((x) => x.id === bid) : undefined;
      const owner = bid ? e.claimedBy.get(bid) : undefined;
      const train = owner ? e.train(owner) : undefined;
      const occupied = train && train.block === bid;
      const editing = this.tool?.kind === "block" && this.tool.id === bid;
      let color = b?.color ?? "#9aa3a0", width = 5, alpha = 0.45;
      if (train) { color = train.color; width = occupied ? 9 : 6; alpha = occupied ? 0.85 : 0.45; }
      if (bid && e.faults.has(bid)) { color = "#e0413a"; alpha = 0.9; width = 9; }
      if (editing) { alpha = 0.95; width = 9; }
      if (!b && this.tab === "setup") { color = "#9aa3a0"; alpha = 0.25; }
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = Math.max(width, 4 * v.s);
      const g = geom(it);
      const pc = cfg.points.find((q) => q.item === it.id);
      g.routes.forEach((r, ri) => {
        if (pc && ri !== pc.state) return;
        ctx.beginPath();
        for (const pr of r.prims) strokePrim(ctx, v, pr);
        ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
    // blocks with something in them and no train booked: dashed red
    if (e.strays.size) {
      ctx.strokeStyle = "#e0413a"; ctx.lineWidth = Math.max(10, 6 * v.s); ctx.setLineDash([8, 6]); ctx.globalAlpha = 0.85;
      for (const it of p.items) {
        if (!e.strays.has(blockOf.get(it.id) ?? "")) continue;
        ctx.beginPath();
        for (const r of geom(it).routes) for (const pr of r.prims) strokePrim(ctx, v, pr);
        ctx.stroke();
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // joints trains must never cross (DCC-EX next to another system)
    for (const bnd of e.topo.boundaries) {
      if (!bnd.isolated) continue;
      const s = toScreen(v, bnd);
      ctx.strokeStyle = "#e0413a"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s.x - 7, s.y - 7); ctx.lineTo(s.x + 7, s.y + 7); ctx.moveTo(s.x + 7, s.y - 7); ctx.lineTo(s.x - 7, s.y + 7); ctx.stroke();
    }
    // the wiring plan, while setting up: insulated joiners across the rails, and the track feeds
    if (this.tab === "setup" && cfg.blocks.length) {
      const { js, fs } = this.wiringPlan();
      for (const j of js) {
        const nx = -Math.sin(j.h), ny = Math.cos(j.h);
        ctx.strokeStyle = j.why === "frog" ? "#b07c00" : "#111"; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
        ctx.beginPath();
        for (const side of [1, -1]) {
          const a = toScreen(v, { x: j.x + nx * side * 5, y: j.y + ny * side * 5 }), b = toScreen(v, { x: j.x + nx * side * 13, y: j.y + ny * side * 13 });
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const f of fs) {
        const s = toScreen(v, f);
        const b = cfg.blocks.find((x) => x.id === f.block);
        ctx.fillStyle = b?.color ?? "#555"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 9px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("F", s.x, s.y + 0.5);
      }
    }
    // points: show the route each is set to
    for (const pc of cfg.points) {
      const it = p.items.find((i) => i.id === pc.item);
      if (!it) continue;
      const g = geom(it);
      const toe = g.ends[0];
      const s = toScreen(v, toe);
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#1b221e"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      const r = g.routes[pc.state];
      if (r?.prims[0]) {
        const a = primAt(r.prims[0], Math.min(40, r.prims[0].len));
        const sa = toScreen(v, a);
        ctx.strokeStyle = "#1b221e"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(sa.x, sa.y); ctx.stroke();
      }
    }
    // sensors
    for (const sn of cfg.sensors) {
      const s = toScreen(v, sn);
      const on = e.sensorActive.has(sn.id);
      ctx.fillStyle = on ? "#f0b429" : "#ffffff"; ctx.strokeStyle = "#1b221e"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - 6); ctx.lineTo(s.x + 6, s.y); ctx.lineTo(s.x, s.y + 6); ctx.lineTo(s.x - 6, s.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // signals: a mast beside the track with the lit aspect
    for (const sg of cfg.signals) {
      const off = 26 / Math.max(v.s, 0.05) * Math.min(1, v.s * 2);
      const side = { x: sg.x + Math.sin(sg.h) * Math.max(24, off), y: sg.y - Math.cos(sg.h) * Math.max(24, off) };
      const s = toScreen(v, side), base = toScreen(v, sg);
      const aspect = e.aspects.get(sg.id) ?? "red";
      ctx.strokeStyle = "#1b221e"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.fillStyle = "#1b221e"; ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ASPECT_COLOR[aspect]; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill();
      if (sg.mode === "stop") { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); ctx.stroke(); }
    }
    // train labels
    ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of cfg.trains) {
      if (!t.block) continue;
      const anchor = this.blockAnchor(t.block, t.id);
      if (!anchor) continue;
      const s = toScreen(v, anchor);
      const w = ctx.measureText(t.name).width + 14;
      ctx.fillStyle = t.color; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.roundRect(s.x - w / 2, s.y - 20, w, 20, 10); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = "#ffffff"; ctx.fillText(t.name, s.x, s.y - 10);
    }
    ctx.restore();
  }

  /** A point on a block's track to label it (moves along the block in the simulator). */
  private blockAnchor(blockId: string, trainId?: string): Vec | null {
    const b = this.cfg.blocks.find((x) => x.id === blockId);
    if (!b || !b.items.length) return null;
    const items = b.items.map((id) => this.app.p.items.find((i) => i.id === id)).filter(Boolean) as ReturnType<typeof geom>[] & any[];
    // in the simulator, the train's loco is where it really is
    const sim = [...this.links.values()].find((l) => l instanceof SimLink) as SimLink | undefined;
    const at = trainId && sim ? sim.poseOf(trainId) : null;
    if (at) return { x: at.x, y: at.y };
    const it = items[Math.floor(items.length / 2)];
    const r = geom(it).routes[0];
    const pr = r.prims[Math.floor(r.prims.length / 2)];
    const q = primAt(pr, pr.len / 2);
    return { x: q.x, y: q.y };
  }

  // ---------- clicks on the plan ----------

  /** Returns true when the click did something. */
  onPlanClick(w: Vec): boolean {
    const p = this.app.p, cfg = this.cfg, e = this.engine;
    const tol = 14 / this.app.view.s;
    const tool = this.tool;
    if (tool?.kind === "place") {
      const it = this.itemAt(w, tol);
      const bid = it && e.topo.blockOfItem.get(it);
      if (!bid) { toast("Tap a piece of track that belongs to a block."); return true; }
      const t = cfg.trains.find((x) => x.id === tool.train);
      if (t) {
        if (this.hub) this.act({ c: "place", train: t.id, block: bid });
        t.block = bid;
        toast(`${t.name} is in ${e.blockName(bid)}.`);
      }
      this.tool = null;
      this.commitSetup();
      return true;
    }
    if (tool?.kind === "block") {
      const it = this.itemAt(w, tol);
      if (!it) return false;
      const b = cfg.blocks.find((x) => x.id === tool.id);
      if (!b) return false;
      if (b.items.includes(it)) b.items = b.items.filter((x) => x !== it);
      else { for (const o of cfg.blocks) o.items = o.items.filter((x) => x !== it); b.items.push(it); }
      this.commitSetup();
      return true;
    }
    if (tool?.kind === "signal") {
      const topo = e.topo;
      let best = null as null | (typeof topo.boundaries)[number], bd = Infinity;
      for (const bnd of topo.boundaries) { const d = dist(bnd, w); if (d < bd) { bd = d; best = bnd; } }
      if (!best || bd > tol * 3) { toast("Tap close to a joint between two blocks."); return true; }
      const near = this.itemAt(w, tol * 2);
      const nearBlock = near ? topo.blockOfItem.get(near) : undefined;
      const i = nearBlock === best.blocks[1] ? 1 : 0;
      const from = best.blocks[i], to = best.blocks[1 - i];
      const fromEnd = best.ends[i];
      const it = p.items.find((x) => x.id === fromEnd.item)!;
      const hdg = geom(it).ends[fromEnd.end].h;
      const s = addSignal(p, cfg, { x: best.x, y: best.y }, from, to, hdg);
      toast(`${s.name} added, for trains coming from ${e.blockName(from)}.`);
      this.tool = null;
      this.commitSetup();
      return true;
    }
    // driving: signals, then points
    for (const sg of cfg.signals) {
      if (dist(sg, w) < tol * 2.2) { this.doAndRender({ c: "signal", id: sg.id, mode: sg.mode === "stop" ? "auto" : "stop" }); return true; }
    }
    for (const pc of cfg.points) {
      const it = p.items.find((i) => i.id === pc.item);
      if (!it) continue;
      const g = geom(it);
      if (g.routes.some((r) => r.prims.some((pr) => distToPrim(pr, w) < tol))) {
        this.doAndRender({ c: "point", item: pc.item, state: (pc.state + 1) % pc.us.length });
        return true;
      }
    }
    return false;
  }

  private itemAt(w: Vec, tol: number): string | null {
    let best: string | null = null, bd = Infinity;
    for (const it of this.app.p.items) {
      for (const r of geom(it).routes) for (const pr of r.prims) {
        const d = distToPrim(pr, w);
        if (d < tol && d < bd) { bd = d; best = it.id; }
      }
    }
    return best;
  }

  commitSetup() {
    this.onProjectChanged();
    this.app.commit();
  }

  // ---------- the side panel ----------

  render(box?: HTMLElement) {
    const el = box ?? this.app.el.insp;
    if (!el) return;
    clear(el);
    this.live = [];
    const tab = (id: "drive" | "auto" | "setup", label: string) => h("button", {
      type: "button", role: "tab", "aria-selected": String(this.tab === id), class: this.tab === id ? "on" : "",
      onclick: () => { this.tab = id; if (id !== "setup") this.tool = null; this.render(); this.app.render(); },
    }, label);
    el.append(h("div", { class: "seg ctl-tabs", role: "tablist" }, tab("drive", "Drive"), tab("auto", "Auto"), tab("setup", "Set up")));
    if (this.tab === "drive") this.renderDrive(el);
    else if (this.tab === "auto") renderAuto(this, el);
    else this.renderSetup(el);
  }

  /** A bit of text kept up to date ten times a second. */
  liveText(fn: () => string, cls = "") {
    const s = h("span", { class: cls });
    const update = () => { const t = fn(); if (s.textContent !== t) s.textContent = t; };
    update();
    this.live.push({ el: s, update });
    return s;
  }

  addLive(el: HTMLElement, update: () => void) { update(); this.live.push({ el, update }); }

  private linkStates(): [string, LinkSummary][] {
    if (this.hub) return this.hub.snap?.links ?? [];
    return this.rt.linkSummaries();
  }

  private statusChips() {
    const wrap = h("div", { class: "health" });
    const update = () => {
      clear(wrap);
      if (this.hub) {
        const hs = this.hub.state;
        const n = this.hub.snap?.clients ?? 0;
        wrap.append(h("span", { class: `chip chip-${hs === "online" ? "ok" : hs === "offline" ? "bad" : "info"}`, title: this.hub.message || this.hub.base },
          hs === "online" ? `Hub: connected${n > 1 ? `, ${n} devices` : ""}` : hs === "offline" ? "Hub: offline" : "Hub: connecting…"));
      }
      if (!this.cfg.controllers.length) { wrap.append(h("span", { class: "chip chip-info" }, "No controller set up")); return; }
      const states = new Map(this.linkStates());
      for (const c of this.cfg.controllers) {
        const st = states.get(c.id);
        const kind = !st ? "info" : !st.online ? "bad" : st.accepted ? "ok" : "warn";
        const text = !st ? `${c.name}: connecting…` : !st.online ? `${c.name}: offline` : st.accepted ? `${c.name}: driving` : c.kind === "dccex" ? `${c.name}: not answering` : `${c.name}: another device is driving`;
        wrap.append(h("span", { class: `chip chip-${kind}`, title: st?.message ?? "" }, text));
        if (st?.online && !st.accepted && c.kind === "esp32") wrap.append(h("button", { class: "btn btn-sm", type: "button", onclick: () => { this.act({ c: "take", controller: c.id }); toast(`Taking over ${c.name}…`); } }, "Take over"));
        if (c.kind === "dccex" && !this.hub && c.conn !== "net" && !st?.online && webSerialSupported()) wrap.append(h("button", { class: "btn btn-sm", type: "button", onclick: () => this.connectUsb(c.id) }, "Connect USB"));
      }
      if (!this.engine.powerOn) {
        wrap.append(h("span", { class: "chip chip-warn" }, "Track power off"),
          h("button", { class: "btn btn-sm", type: "button", onclick: () => this.doAndRender({ c: "power", on: true }, "Track power on.") }, "Power on"));
      }
      for (const [b, msg] of this.engine.faults) {
        wrap.append(h("span", { class: "chip chip-bad", title: msg }, `Fault in ${this.engine.blockName(b)}`),
          h("button", { class: "btn btn-sm", type: "button", onclick: () => this.doAndRender({ c: "clearFault", block: b }, "Power back on. Watch the train.") }, "Reset"));
      }
    };
    let last = "";
    this.live.push({ el: wrap, update: () => {
      const sig = JSON.stringify(this.linkStates().map(([, l]) => [l.online, l.accepted])) + [...this.engine.faults.keys()].join() + this.engine.powerOn + (this.hub ? `${this.hub.state}${this.hub.snap?.clients}` : "");
      if (sig !== last) { last = sig; update(); }
    } });
    update();
    return wrap;
  }

  async connectUsb(controllerId: string) {
    const l = this.links.get(controllerId);
    if (!l?.connect) return;
    try { await l.connect(); toast("Connected to DCC-EX over USB."); }
    catch (e) { if ((e as Error).name !== "NotFoundError") toast((e as Error).message, "error"); }
    this.render();
  }

  private renderDrive(el: HTMLElement) {
    const cfg = this.cfg, e = this.engine;
    el.append(this.statusChips());
    el.append(h("div", { class: "btn-row stop-row" },
      h("button", { class: "btn stop-all", type: "button", onclick: () => this.doAndRender({ c: "stopAll" }, "All trains stopped.") },
        h("span", { html: icon("close", 18) }), "Stop all trains", h("kbd", {}, "Space")),
      e.powerOn ? h("button", { class: "btn btn-sm", type: "button", title: "Turn the track power off, like the power button on a DCC throttle", onclick: () => this.doAndRender({ c: "power", on: false }, "Track power off.") }, "Power off") : null));
    if (cfg.controllers.some((c) => c.kind === "sim") && (this.hub ? !!this.hub.snap?.world : true) && cfg.trains.some((t) => t.block))
      el.append(h("div", { class: "btn-row" }, h("button", { class: "btn", type: "button", id: "drive-3d", title: "Drive the simulated trains in 3D (D)", onclick: () => this.app.drive.start(), html: `${icon("cube", 16)}<span>Drive in 3D</span>` })));
    if (!cfg.trains.length || !cfg.blocks.length) {
      el.append(h("div", { class: "ctl-empty" },
        h("h3", {}, "Nothing to drive yet"),
        h("p", { class: "muted" }, "Start with one train running on the whole layout. You can split it into blocks for more trains later."),
        h("div", { class: "btn-row" },
          h("button", { class: "btn btn-primary", type: "button", onclick: () => this.quick("esp32") }, "Set up with a controller"),
          h("button", { class: "btn", type: "button", onclick: () => this.quick("sim") }, "Try it with the simulator")),
        h("p", { class: "muted small" }, "Or see blocks, sensors, signals and automations at work with two trains:"),
        h("div", { class: "btn-row" }, h("button", { class: "btn", type: "button", onclick: () => this.app.openControlDemo() }, "Open the two-train demo"))));
      return;
    }
    for (const t of cfg.trains) {
      const slider = h("input", { type: "range", min: "0", max: "100", step: "1", id: `thr-${t.id}`, value: String(Math.round(Math.abs(e.run(t.id).target) * 100)), "aria-label": `${t.name} speed` }) as HTMLInputElement;
      let dir = e.run(t.id).target < 0 ? -1 : 1;
      const apply = () => this.act({ c: "throttle", train: t.id, v: dir * (+slider.value / 100) });
      slider.addEventListener("input", apply);
      const dirBtns: HTMLElement[] = [];
      const dirBtn = (d: number, label: string, ic: string) => {
        const b = h("button", { class: `btn btn-sm dir ${dir === d ? "on" : ""}`, type: "button", "aria-pressed": String(dir === d), title: label,
          onclick: () => {
            if (Math.abs(e.run(t.id).speed) > 0.02 && d !== dir) { toast(`Slow ${t.name} to a stop before changing direction.`); return; }
            dir = d; apply(); showDir();
          }, html: icon(ic, 16) + `<span>${label}</span>` });
        b.dataset.dir = String(d);
        dirBtns.push(b);
        return b;
      };
      const showDir = () => { for (const b of dirBtns) { const on = +b.dataset.dir! === dir; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); } };
      const card = h("section", { class: "train-card", style: `--train:${t.color}` },
        h("div", { class: "train-head" },
          h("span", { class: "train-dot" }),
          h("strong", {}, t.name),
          this.liveText(() => {
            if (!t.block) return "not placed";
            const c = this.app.drive.world()?.consistOf(t.id), wait = c?.waiting, by = wait && e.train(e.claimedBy.get(wait) ?? e.held.get(wait) ?? "");
            const why = wait ? ` · waiting for ${e.blockName(wait)}${by ? ` (${by.name})` : ""}` : c?.waitPoint ? ` · waiting: ${pointLabel(this.app.p, this.cfg, c.waitPoint)} is set against it` : "";
            return `in ${e.blockName(t.block)}${why}`;
          }, "muted small"),
          this.liveText(() => `${Math.round(Math.abs(e.run(t.id).speed) * 100)}%`, "train-speed mono")),
        h("div", { class: "train-ctl" }, dirBtn(-1, "Back", "left"), slider, dirBtn(1, "Forward", "right")),
        this.liveText(() => {
          const a = (cfg.automations ?? []).find((x) => x.train === t.id && e.autoRuns.get(x.id)?.running);
          return a ? `${a.name}: ${e.autoRuns.get(a.id)!.status}` : "";
        }, "muted small auto-status"),
        this.derailedNote(t.id, t.name),
        h("div", { class: "btn-row" },
          h("button", { class: "btn btn-sm", type: "button", onclick: () => { slider.value = "0"; apply(); } }, "Stop"),
          !t.block ? h("button", { class: "btn btn-sm btn-primary", type: "button", onclick: () => { this.tool = { kind: "place", train: t.id }; toast(`Tap the block where ${t.name} is.`); } }, "Place on the plan") : null));
      // follow the throttle when something else moves it (an automation, another phone, a WiThrottle app)
      this.addLive(card, () => {
        const target = e.run(t.id).target;
        if (document.activeElement !== slider) {
          const v = String(Math.round(Math.abs(target) * 100));
          if (slider.value !== v) slider.value = v;
          const d = target < 0 ? -1 : target > 0 ? 1 : dir;
          if (d !== dir) { dir = d; showDir(); }
        }
      });
      el.append(card);
    }
    if (cfg.blocks.length === 1 && cfg.trains.length === 1)
      el.append(h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", id: "second-train",
        title: "Cut the layout into blocks, so each train has its own power, and add a train", onclick: () => this.divide(2) }, "Add a second train")));
    const routes = cfg.routes ?? [];
    if (routes.length) {
      el.append(h("div", { class: "sub-head" }, "Routes"));
      const grid = h("div", { class: "chip-grid" });
      for (const r of routes) {
        const b = h("button", { class: "btn btn-sm", type: "button", onclick: () => this.doAndRender({ c: "route", id: r.id }, `${r.name} set.`) }, r.name);
        this.addLive(b, () => b.classList.toggle("btn-primary", e.routeSet(r.id)));
        grid.append(b);
      }
      el.append(grid);
    }
    const autos = cfg.automations ?? [];
    if (autos.length) {
      el.append(h("div", { class: "sub-head" }, "Automations"));
      for (const a of autos) {
        const btn = h("button", { class: "btn btn-sm", type: "button", onclick: () => {
          const running = e.autoRuns.get(a.id)?.running;
          this.doAndRender({ c: "auto", id: a.id, run: !running });
        } });
        this.addLive(btn, () => { const t = e.autoRuns.get(a.id)?.running ? "Stop" : "Start"; if (btn.textContent !== t) btn.textContent = t; });
        el.append(h("div", { class: "kv" }, h("span", { class: "k" }, a.name, " ", this.liveText(() => e.autoRuns.get(a.id)?.status ?? "", "muted small")), btn));
      }
    }
    if (cfg.points.length) {
      el.append(h("div", { class: "sub-head" }, "Points"), h("p", { class: "muted small" }, "Tap a point on the plan, or here."));
      const grid = h("div", { class: "chip-grid" });
      for (const pc of cfg.points) {
        const it = this.app.p.items.find((i) => i.id === pc.item);
        if (!it) continue;
        const names = pc.us.length === 3 ? ["Straight", "Left", "Right"] : ["Straight", "Turn"];
        const b = h("button", { class: "btn btn-sm", type: "button", onclick: () => this.doAndRender({ c: "point", item: pc.item, state: (pc.state + 1) % pc.us.length }) });
        this.addLive(b, () => { const t = `${pointLabel(this.app.p, cfg, pc.item)} ${partOf(it).def.id}: ${names[pc.state] ?? pc.state}`; if (b.textContent !== t) b.textContent = t; });
        grid.append(b);
      }
      el.append(grid);
    }
    if (cfg.signals.length) {
      el.append(h("div", { class: "sub-head" }, "Signals"));
      for (const s of cfg.signals) {
        const dot = h("span", { class: "aspect" });
        this.addLive(dot, () => { dot.style.background = ASPECT_COLOR[e.aspects.get(s.id) ?? "red"]; });
        const b = h("button", { class: "btn btn-sm", type: "button", onclick: () => this.doAndRender({ c: "signal", id: s.id, mode: s.mode === "stop" ? "auto" : "stop" }) });
        this.addLive(b, () => { const t = s.mode === "stop" ? "Held at red" : "Automatic"; if (b.textContent !== t) b.textContent = t; });
        el.append(h("div", { class: "kv" }, h("span", { class: "k" }, dot, ` ${s.name}`), b));
      }
    }
    if (cfg.lights.length) {
      el.append(h("div", { class: "sub-head" }, "Lights"));
      for (const l of cfg.lights) {
        const sw = h("input", { type: "checkbox", id: `light-${l.id}`, checked: l.on, onchange: (ev: Event) => this.act({ c: "light", id: l.id, on: (ev.target as HTMLInputElement).checked }) }) as HTMLInputElement;
        const lvl = h("input", { type: "range", min: "1", max: "100", value: String(l.level), id: `lightlvl-${l.id}`, "aria-label": `${l.name} brightness`, oninput: (ev: Event) => this.act({ c: "light", id: l.id, level: +(ev.target as HTMLInputElement).value }) }) as HTMLInputElement;
        this.addLive(sw, () => { if (sw.checked !== l.on) sw.checked = l.on; if (document.activeElement !== lvl && lvl.value !== String(l.level)) lvl.value = String(l.level); });
        el.append(h("div", { class: "light-row" }, h("label", { class: "check" }, sw, l.name), lvl));
      }
    }
  }

  /** In the simulator, a train that's come off the rails says so here, with why and a way back on. */
  private derailedNote(train: string, name: string): HTMLElement {
    const why = h("span", { class: "grow" });
    const note = h("div", { class: "derailed-note", role: "status", hidden: true },
      h("strong", {}, `${name} derailed`), why,
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-sm btn-primary", type: "button", onclick: () => this.rerail(train, name, "last-stop") }, "Re-rail where it last stood"),
        h("button", { class: "btn btn-sm", type: "button", onclick: () => this.rerail(train, name, "here") }, "Re-rail here")));
    this.addLive(note, () => {
      const w = this.app.drive.world(), c = w?.consistOf(train), off = c?.derailed;
      note.hidden = !off;
      if (off) { const d = w!.describe(off); if (why.textContent !== d) why.textContent = d; }
    });
    return note;
  }

  private rerail(train: string, name: string, how: "here" | "last-stop") {
    this.act({ c: "rerail", train, how });
    toast(`${name} is back on the rails.`);
  }

  private quick(kind: "esp32" | "sim") {
    this.app.p.control = quickStart(this.app.p, this.app.p.control, kind);
    this.commitSetup();
    if (kind === "esp32") {
      toast("Set up for one train. Check the controller's address in Set up, then wire it as listed there.");
      this.tab = "setup";
    } else toast("Simulator ready. Move the slider to drive.");
    this.render();
  }

  /** Cut the layout into blocks for `n` trains (trains stay where they stand), and say what came of it. */
  private divide(n: number) {
    const w = this.app.drive.world();
    const lengths = w ? this.cfg.trains.map((t) => w.consistOf(t.id)?.vehicles.reduce((a, v) => a + v.length, 0) ?? 0) : [];
    const longest = Math.max(0, ...lengths);
    const where = (train: string) => {
      const c = w?.consistOf(train), i = c ? Math.max(0, c.vehicles.findIndex((v) => v.kind === "loco")) : -1;
      return c && i >= 0 ? c.at[i]?.item : undefined;
    };
    const blocks = divideForTrains(this.app.p, this.cfg, n, { trainLength: longest || undefined, where });
    this.commitSetup(); this.render();
    const placed = this.cfg.trains.filter((t) => t.block).length;
    toast(placed < n
      ? `${blocks} block${blocks === 1 ? "" : "s"}: room for ${placed} train${placed === 1 ? "" : "s"}. A longer layout or a passing loop makes room for more. Undo puts the old blocks back.`
      : `${blocks} blocks, ${placed} trains. A train only gets power in a block no other train holds, so they can't run into each other. Undo puts the old blocks back.`);
  }

  private renderSetup(el: HTMLElement) {
    const cfg = this.cfg, e = this.engine, p = this.app.p;
    const sec = (title: string, ...kids: (Node | null)[]) => h("section", { class: "setup-sec" }, h("h3", {}, title), ...kids.filter(Boolean) as Node[]);
    const ctrlSelect = (value: string | undefined, onchange: (v: string | undefined) => void, id: string) => {
      const s = h("select", { id, "aria-label": "Controller" }, h("option", { value: "" }, "None"), ...cfg.controllers.map((c) => h("option", { value: c.id, selected: c.id === value }, c.name))) as HTMLSelectElement;
      s.addEventListener("change", () => { onchange(s.value || undefined); this.commitSetup(); this.render(); });
      return s;
    };
    const num = (id: string, value: number | undefined, onchange: (v: number | undefined) => void, attrs: Record<string, string | number> = {}) => {
      const n = numInput(id, value ?? ("" as unknown as number), { min: 0, step: 1, ...attrs });
      if (value === undefined) n.value = "";
      n.addEventListener("change", () => { onchange(n.value === "" ? undefined : +n.value); this.commitSetup(); });
      return n;
    };
    const del = (label: string, fn: () => void) => h("button", { class: "icon-btn sm", type: "button", "aria-label": label, title: label, html: icon("trash", 14), onclick: () => { fn(); this.commitSetup(); this.render(); } });
    const kindOf = (id?: string) => cfg.controllers.find((c) => c.id === id)?.kind;

    el.append(h("p", { class: "muted small" }, "Work down the list: a controller, blocks of track, then points, sensors, signals, lights and trains. The wiring list tells you what goes on which pin."));

    const warnings = controlWarnings(p, cfg, e.topo);
    for (const w of warnings) el.append(h("p", { class: "warn-note" }, w));

    // hub
    const hubHost = h("input", { type: "text", id: "hub-host", value: this.hub?.host ?? this.savedHubHost(), placeholder: "railplot-hub.local:8080", "aria-label": "Hub address" }) as HTMLInputElement;
    el.append(sec("Railplot hub",
      h("p", { class: "muted small" }, "A hub is a small program on a laptop or Raspberry Pi that runs the layout on its own. Then several phones can drive different trains at once, WiThrottle and Engine Driver apps work, and automations keep running with every screen closed."),
      this.hub
        ? h("div", { class: "setup-row" }, h("span", { class: "small grow" }, `Connected to ${this.hub.base}. Layout changes you make here are sent to the hub.`),
          h("button", { class: "btn btn-sm", type: "button", onclick: () => this.disconnectHub() }, "Disconnect"))
        : h("div", { class: "setup-row" }, hubHost,
          h("button", { class: "btn btn-sm", type: "button", onclick: () => this.askHubLayout(hubHost.value.trim()) }, "Connect")),
      h("label", { class: "check claude-row" },
        h("input", { type: "checkbox", id: "claude-control", checked: !!cfg.claude, onchange: (ev: Event) => {
          if ((ev.target as HTMLInputElement).checked) cfg.claude = true; else delete cfg.claude;
          this.commitSetup();
          toast(cfg.claude ? "Claude can now use the controls through the hub." : "Claude can no longer use the controls.");
        } }),
        h("span", {}, h("strong", {}, "Let Claude use the controls"), h("br"),
          h("span", { class: "muted small" }, "Through the hub and the Railplot connector, Claude can then set routes, points, signals and lights, drive trains and run automations. It can never switch track power on or off. Stop the trains here or on any throttle at any time.")))));

    // controllers
    el.append(sec("Controllers",
      ...cfg.controllers.map((c) => {
        const name = h("input", { type: "text", id: `cn-${c.id}`, value: c.name, "aria-label": "Controller name" }) as HTMLInputElement;
        name.addEventListener("change", () => { c.name = name.value || c.name; this.commitSetup(); });
        const host = h("input", { type: "text", id: `ch-${c.id}`, value: c.host,
          placeholder: c.kind === "dccex" ? (c.conn === "net" ? "192.168.4.1:2560" : "Hub only: /dev/ttyACM0 or COM3") : "railplot.local or 192.168.4.1", "aria-label": "Address" }) as HTMLInputElement;
        host.addEventListener("change", () => { c.host = host.value.trim(); this.commitSetup(); });
        const remove = del("Remove controller", () => { cfg.controllers = cfg.controllers.filter((x) => x !== c); });
        if (c.kind === "sim") return h("div", { class: "setup-row" }, name, h("span", { class: "muted small grow" }, "Simulator"), remove);
        if (c.kind === "esp32") return h("div", { class: "setup-row" }, name, host, remove);
        const conn = h("select", { id: `cc-${c.id}`, "aria-label": "Connection" },
          h("option", { value: "usb", selected: c.conn !== "net" }, "USB"), h("option", { value: "net", selected: c.conn === "net" }, "Network")) as HTMLSelectElement;
        conn.addEventListener("change", () => { c.conn = conn.value as "usb" | "net"; this.commitSetup(); this.render(); });
        const cab = num(`cab-${c.id}`, c.cabBase ?? DCCEX_CAB_BASE, (v) => { c.cabBase = Math.max(1, Math.min(10200, v ?? DCCEX_CAB_BASE)); }, { min: 1, max: 10200, "aria-label": "Cab number for track A", title: "Cab number for track A" });
        return h("div", { class: "dccex-setup" },
          h("div", { class: "setup-row" }, name, conn, remove),
          h("div", { class: "setup-row" }, host, field("Cab for track A", cab),
            c.conn !== "net" && !this.hub ? h("button", { class: "btn btn-sm", type: "button", disabled: !webSerialSupported(), title: webSerialSupported() ? "" : "Needs Chrome or Edge on a computer", onclick: () => this.connectUsb(c.id) }, "Connect USB") : null),
          h("p", { class: "muted small" }, c.conn === "net"
            ? "Over Wi-Fi or Ethernet, DCC-EX listens on port 2560. A browser can't open that connection, so network DCC-EX needs the Railplot hub."
            : this.hub ? "Plugged into the hub's computer: put its serial port in the address box (for example /dev/ttyACM0 on a Raspberry Pi)." : "Plugged into this computer: press Connect USB (Chrome or Edge). The desktop app can't reach USB yet; open the offline file in Chrome or Edge, or use the hub."));
      }),
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-sm", type: "button", onclick: () => { addController(cfg, "esp32", cfg.controllers.some((c) => c.kind === "esp32") ? `railplot-${cfg.controllers.filter((c) => c.kind === "esp32").length + 1}.local` : "railplot.local"); this.commitSetup(); this.render(); } }, "Add ESP32 controller"),
        h("button", { class: "btn btn-sm", type: "button", onclick: () => { addController(cfg, "dccex"); this.commitSetup(); this.render(); toast("DCC-EX added. Give its tracks to blocks below; Railplot sets each one to DC mode."); } }, "Add DCC-EX"),
        !cfg.controllers.some((c) => c.kind === "sim") ? h("button", { class: "btn btn-sm", type: "button", onclick: () => { addController(cfg, "sim"); this.commitSetup(); this.render(); } }, "Add simulator") : null),
      this.esp() && !this.hub ? h("div", { class: "btn-row" },
        h("button", { class: "btn btn-sm", type: "button", onclick: () => this.installApp() }, "Install Railplot on the controller"),
        h("button", { class: "btn btn-sm", type: "button", onclick: () => this.sendLayout() }, "Send layout to controller")) : null,
      this.esp() && !this.hub ? h("p", { class: "muted small" }, `Phones and laptops can then open http://${this.esp()!.host || "railplot.local"} to drive.`) : null));

    // blocks
    const unassigned = e.topo.unassigned.length;
    el.append(sec("Blocks",
      h("p", { class: "muted small" }, "A block is a stretch of track with both rails cut at its ends and its own driver. One train per block. With one train, one block for the whole layout is enough."),
      unassigned ? h("div", { class: "warn-note" }, `${unassigned} piece${unassigned === 1 ? "" : "s"} of track ${unassigned === 1 ? "is" : "are"} in no block and won't get power: a train standing there can't move.`,
        cfg.blocks.length === 1 ? h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", id: "join-unassigned", onclick: () => {
          cfg.blocks[0].items.push(...e.topo.unassigned); this.commitSetup(); this.render(); toast(`Added to ${cfg.blocks[0].name}.`);
        } }, `Add ${unassigned === 1 ? "it" : "them"} to ${cfg.blocks[0].name}`)) : null) : null,
      ...cfg.blocks.map((b) => {
        const editing = this.tool?.kind === "block" && this.tool.id === b.id;
        const name = h("input", { type: "text", id: `bn-${b.id}`, value: b.name, "aria-label": "Block name" }) as HTMLInputElement;
        name.addEventListener("change", () => { b.name = name.value || b.name; this.commitSetup(); });
        const ctrl = cfg.controllers.find((c) => c.id === b.controller);
        const ch = h("select", { id: `bc-${b.id}`, "aria-label": "Driver" }, h("option", { value: "" }, "No driver"),
          ...Array.from({ length: channelsOf(ctrl) }, (_, i) => h("option", { value: String(i), selected: b.channel === i }, channelName(ctrl, i)))) as HTMLSelectElement;
        ch.addEventListener("change", () => { b.channel = ch.value === "" ? undefined : +ch.value; this.commitSetup(); });
        return h("div", { class: `setup-row block-row ${editing ? "editing" : ""}` },
          h("span", { class: "swatch", style: `background:${b.color}` }), name,
          ctrlSelect(b.controller, (v) => { b.controller = v; }, `bctl-${b.id}`), ch,
          h("button", { class: `btn btn-sm ${editing ? "btn-primary" : ""}`, type: "button", onclick: () => { this.tool = editing ? null : { kind: "block", id: b.id }; this.render(); this.app.render(); if (!editing) toast(`Tap track pieces to add them to ${b.name} or take them out.`); } }, editing ? "Done" : `${b.items.length} pieces`),
          del("Delete block", () => { cfg.blocks = cfg.blocks.filter((x) => x !== b); for (const t of cfg.trains) if (t.block === b.id) t.block = undefined; }));
      }),
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-sm", type: "button", onclick: () => {
          const sel = [...this.app.sel].filter((id) => p.items.some((i) => i.id === id));
          const b = addBlock(cfg, sel);
          this.tool = { kind: "block", id: b.id };
          this.commitSetup(); this.render();
          toast(sel.length ? `${b.name} made from the selected track.` : `Tap track pieces to add them to ${b.name}.`);
        } }, "New block"),
        !cfg.blocks.length ? h("button", { class: "btn btn-sm", type: "button", onclick: () => { addBlock(cfg, p.items.map((i) => i.id), "Whole layout"); this.commitSetup(); this.render(); } }, "One block for everything") : null),
      p.items.length ? (() => {
        const count = h("select", { id: "divide-count", "aria-label": "Trains" }, ...[2, 3, 4, 5, 6].map((n) => h("option", { value: String(n), selected: n === Math.max(2, Math.min(6, cfg.trains.length)) }, `${n} trains`))) as HTMLSelectElement;
        return h("div", { class: "btn-row" },
          h("button", { class: "btn btn-sm", type: "button", id: "divide-blocks", title: "Replace the blocks with ones cut at the points and along long runs, and put each train in its own", onclick: () => this.divide(+count.value) }, "Divide into blocks for"), count);
      })() : null));

    // points
    el.append(sec("Points",
      cfg.points.length ? h("p", { class: "muted small" }, "Each point gets a servo (or, on DCC-EX, a turnout number defined on the command station). Set the servo pulse for each position, then press the buttons to check the blades move fully across.") : h("p", { class: "muted small" }, "No points on the plan."),
      ...cfg.points.map((pc) => {
        const it = p.items.find((i) => i.id === pc.item);
        if (!it) return null;
        const names = pc.us.length === 3 ? ["Straight", "Left", "Right"] : ["Straight", "Turn"];
        const dcc = kindOf(pc.controller) === "dccex";
        return h("div", { class: "setup-row point-row" },
          h("span", { class: "small" }, h("strong", {}, `${pointLabel(p, cfg, pc.item)} `), partOf(it).def.id),
          ctrlSelect(pc.controller, (v) => { pc.controller = v; }, `pctl-${pc.item}`),
          num(`ps-${pc.item}`, pc.servo, (v) => { pc.servo = v; }, { "aria-label": dcc ? "DCC-EX turnout id" : "Servo number", title: dcc ? (pc.us.length === 3 ? "DCC-EX turnout id (left; right is the next id)" : "DCC-EX turnout id") : "Servo number" }),
          ...pc.us.map((us, i) => h("label", { class: "us" }, h("button", { class: `btn btn-sm ${pc.state === i ? "btn-primary" : ""}`, type: "button", onclick: () => this.doAndRender({ c: "point", item: pc.item, state: i }) }, names[i]),
            dcc ? null : num(`pu-${pc.item}-${i}`, us, (v) => { pc.us[i] = Math.max(500, Math.min(2500, v ?? 1500)); }, { min: 500, max: 2500, step: 10, "aria-label": `${names[i]} pulse µs` }))));
      })));

    // sensors
    el.append(sec("Sensors",
      h("p", { class: "muted small" }, "An infrared sensor at each joint between blocks tells Railplot when a train moves on, so its power follows it and the signals change. On DCC-EX, use the sensor's id on the command station."),
      ...cfg.sensors.map((s) => h("div", { class: "setup-row" },
        h("span", { class: "small grow" }, s.name),
        ctrlSelect(s.controller, (v) => { s.controller = v; }, `sctl-${s.id}`),
        num(`si-${s.id}`, s.input, (v) => { s.input = v; }, { "aria-label": "Input number", title: kindOf(s.controller) === "dccex" ? "DCC-EX sensor id" : "Input number" }),
        h("button", { class: "btn btn-sm", type: "button", title: "Pretend a train passed", onclick: () => this.doAndRender({ c: "sensor", id: s.id }, "The train moved on.") }, "Test"),
        del("Delete sensor", () => { cfg.sensors = cfg.sensors.filter((x) => x !== s); }))),
      cfg.blocks.length > 1 ? h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", onclick: () => { const n = addSensorsAtBoundaries(p, cfg); this.commitSetup(); this.render(); toast(n ? `${n} sensor${n === 1 ? "" : "s"} added.` : "Every block joint already has a sensor."); } }, "Add sensors at block joints")) : h("p", { class: "muted small" }, "Sensors need two or more blocks.")));

    // the simulator
    if (cfg.controllers.some((c) => c.kind === "sim")) {
      const mode = h("select", { id: "sim-derail", "aria-label": "Derailments", onchange: (ev: Event) => { this.act({ c: "derailMode", mode: (ev.target as HTMLSelectElement).value as "off" }); this.commitSetup(); } },
        ...([["realistic", "Realistic"], ["forgiving", "Forgiving"], ["off", "Off: hold trains at the limit"]] as const).map(([v, t]) => h("option", { value: v, selected: (cfg.derailments ?? "realistic") === v }, t)));
      el.append(sec("Simulator",
        h("div", { class: "setup-row" }, h("span", { class: "small grow" }, "Derailments"), mode),
        h("label", { class: "check" }, h("input", { id: "sim-point-guard", type: "checkbox", checked: !!cfg.pointGuard, onchange: (ev: Event) => { cfg.pointGuard = (ev.target as HTMLInputElement).checked || undefined; this.commitSetup(); } }),
          "Trains stop short of a point set against them"),
        h("p", { class: "muted small" }, "Simulated trains come off when driven too fast round a curve, through a point set against them, or into the end of the line. Forgiving lets them take curves half as fast again and run through points at walking pace. Re-rail them in Drive in 3D.")));
    }

    // detection by current
    const det = cfg.detection ?? { current: false, threshold: 3 };
    const sim = [...this.links.values()].find((l) => l instanceof SimLink) as SimLink | undefined;
    const strayPick = h("select", { id: "det-stray-block", "aria-label": "Block" }, ...cfg.blocks.map((b) => h("option", { value: b.id }, b.name))) as HTMLSelectElement;
    el.append(sec("Detecting trains by current",
      h("label", { class: "check" }, h("input", { id: "det-current", type: "checkbox", checked: det.current, onchange: (ev: Event) => {
        cfg.detection = { ...det, current: (ev.target as HTMLInputElement).checked };
        this.commitSetup(); this.engine.updateDetection("", [], undefined); this.render();
      } }), "Detect trains by the current they draw"),
      h("p", { class: "muted small" }, "Each DRV8876 driver measures its block's current. Under power a moving loco shows up by itself; in blocks with no power, the controller (firmware 0.4 or later) sends a pulse too short to move anything and measures that. Locos always show. For wagons and coaches, fit one resistor wheelset to each: a 2.2 kΩ surface-mount resistor across the axle draws about 5 mA. Not with DRV8871 drivers, which can't measure current."),
      h("div", { class: "setup-row" }, h("span", { class: "small grow" }, "Occupied from (mA)"),
        num("det-threshold", det.threshold, (v) => { cfg.detection = { ...det, threshold: Math.max(1, v ?? 3) }; }, { min: 1, max: 200, step: 1, "aria-label": "Threshold in mA" })),
      det.current && this.engine.strays.size ? h("p", { class: "warn-note" }, `Something is in ${[...this.engine.strays].map((b) => this.engine.blockName(b)).join(", ")} with no train booked there.`) : null,
      sim && cfg.blocks.length ? h("div", { class: "setup-row" }, h("span", { class: "small grow" }, "Simulator: leave a wagon in"), strayPick,
        h("button", { class: "btn btn-sm", type: "button", id: "det-stray", onclick: () => {
          const b = strayPick.value;
          sim.strays.has(b) ? sim.strays.delete(b) : sim.strays.add(b);
          toast(sim.strays.has(b) ? `A wagon is left in ${this.engine.blockName(b)}.` : `The wagon in ${this.engine.blockName(b)} is gone.`);
        } }, "Leave / take away")) : null));

    // signals
    el.append(sec("Signals",
      ...cfg.signals.map((s) => h("div", { class: "setup-row signal-row" },
        h("span", { class: "small grow" }, `${e.blockName(s.from)} → ${e.blockName(s.to)}`),
        ctrlSelect(s.controller, (v) => { s.controller = v; }, `gctl-${s.id}`),
        ...(["red", "yellow", "green"] as const).map((col) => h("label", { class: `led led-${col}` }, h("span", { class: "sr-only" }, `${col} LED output`),
          num(`g${col}-${s.id}`, s[col], (v) => { s[col] = v; }, { "aria-label": `${col} LED output`, title: kindOf(s.controller) === "dccex" ? `${col} LED VPIN` : `${col} LED output`, placeholder: "–" }))),
        del("Delete signal", () => { cfg.signals = cfg.signals.filter((x) => x !== s); }))),
      cfg.blocks.length > 1 ? h("div", { class: "btn-row" }, h("button", { class: `btn btn-sm ${this.tool?.kind === "signal" ? "btn-primary" : ""}`, type: "button", onclick: () => { this.tool = { kind: "signal" }; this.render(); toast("Tap the track just before a block joint, on the side trains come from."); } }, "Add signal")) : h("p", { class: "muted small" }, "Signals need two or more blocks.")));

    // lights
    el.append(sec("Lights",
      ...cfg.lights.map((l) => {
        const name = h("input", { type: "text", id: `ln-${l.id}`, value: l.name, "aria-label": "Light name" }) as HTMLInputElement;
        name.addEventListener("change", () => { l.name = name.value || l.name; this.commitSetup(); });
        return h("div", { class: "setup-row" }, name, ctrlSelect(l.controller, (v) => { l.controller = v; }, `lctl-${l.id}`),
          num(`lo-${l.id}`, l.output, (v) => { l.output = v; }, { "aria-label": "LED output", title: kindOf(l.controller) === "dccex" ? "DCC-EX VPIN" : "LED output" }),
          del("Delete light", () => { cfg.lights = cfg.lights.filter((x) => x !== l); }));
      }),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", onclick: () => { addLight(cfg); this.commitSetup(); this.render(); } }, "Add light"))));

    // trains
    el.append(sec("Trains",
      h("p", { class: "muted small" }, "On a WiThrottle or Engine Driver app connected to the hub, train 1 is address 1, train 2 is address 2, and so on."),
      ...cfg.trains.map((t, i) => {
        const name = h("input", { type: "text", id: `tn-${t.id}`, value: t.name, "aria-label": "Train name" }) as HTMLInputElement;
        name.addEventListener("change", () => { t.name = name.value || t.name; this.commitSetup(); });
        return h("div", { class: "train-setup" },
          h("div", { class: "setup-row" }, h("span", { class: "swatch", style: `background:${t.color}`, title: `Address ${i + 1}` }), name,
            h("button", { class: "btn btn-sm", type: "button", onclick: () => { this.tool = { kind: "place", train: t.id }; toast(`Tap the block where ${t.name} is.`); } }, t.block ? `In ${e.blockName(t.block)}` : "Place"),
            del("Delete train", () => { cfg.trains = cfg.trains.filter((x) => x !== t); })),
          h("div", { class: "row3" },
            field("Starts moving at (%)", num(`tmin-${t.id}`, t.minSpeed, (v) => { t.minSpeed = v ?? 15; }, { max: 60 })),
            field("Top speed (%)", num(`tmax-${t.id}`, t.maxSpeed, (v) => { t.maxSpeed = v ?? 80; }, { max: 100 })),
            field("Momentum (s)", num(`tmom-${t.id}`, t.momentum, (v) => { t.momentum = v ?? 0; }, { max: 20, step: 0.5 }))));
      }),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-sm", type: "button", onclick: () => {
        const free = cfg.blocks.find((b) => !cfg.trains.some((t) => t.block === b.id));
        addTrain(cfg, cfg.trains.length ? free?.id : cfg.blocks[0]?.id);
        this.commitSetup(); this.render();
      } }, "Add train")),
      cfg.trains.length > Math.max(1, cfg.blocks.length / 2) ? h("p", { class: "warn-note" }, "Each train needs a block of its own and a free block between trains. Add more blocks before running this many trains.") : null));

    el.append(h("div", { class: "btn-row" },
      h("button", { class: "btn", type: "button", onclick: () => this.showWiring(), html: `${icon("list", 16)}<span>Wiring list</span>` }),
      h("button", { class: "btn", type: "button", id: "wiring-diagram", onclick: () => this.showWiringDiagram(), html: `${icon("control", 16)}<span>Wiring diagram</span>` })));
  }

  /** Connecting from Set up: whose layout wins? */
  private askHubLayout(host: string) {
    dialog("Connect to the hub", h("div", {},
      h("p", {}, "The hub keeps its own copy of the layout. Which one should both use?"),
      h("p", { class: "muted small" }, "Phones and other computers connected to the hub switch to the layout you choose.")), [
      { label: "Cancel" },
      { label: "Use the hub's layout", onClick: () => { this.connectHub(host, true); } },
      { label: "Send this layout", primary: true, onClick: () => { this.connectHub(host, false); } },
    ]);
  }

  private wiringCache: { key: string; js: Joiner[]; fs: Feed[] } | null = null;
  /** Joiners and feeds, worked out again only when the track or the blocks change. */
  wiringPlan() {
    const p = this.app.p, cfg = this.cfg;
    const key = `${p.nextId}|${p.items.length}|${p.items.map((i) => `${i.x},${i.y},${i.rot}`).join(";")}|${JSON.stringify(cfg.blocks.map((b) => b.items))}`;
    if (this.wiringCache?.key !== key) this.wiringCache = { key, js: joiners(p, cfg), fs: feeds(p, cfg) };
    return this.wiringCache;
  }

  showWiringDiagram() {
    const svg = wiringSvg(this.app.p, this.cfg);
    const { js, fs } = this.wiringPlan();
    const frogs = js.filter((j) => j.why === "frog").length;
    const body = h("div", {},
      h("p", { class: "muted" }, `On the plan (Set up), black ticks across the rails mark the ${js.length - frogs} block joint${js.length - frogs === 1 ? "" : "s"} that need insulated joiners${frogs ? `, amber ticks the ${frogs} Electrofrog exit${frogs === 1 ? "" : "s"}` : ""}, and F the ${fs.length} track feed${fs.length === 1 ? "" : "s"}, at most ${1.5} m apart along each block. Feed every block the same way round: OUT1 to the same rail all round the layout.`),
      h("div", { class: "wiring-svg", html: svg }));
    dialog("Wiring diagram", body, [
      { label: "Save SVG", onClick: async () => { await this.app.saveFile(`${this.app.p.name} wiring.svg`, new Blob([svg], { type: "image/svg+xml" }), { name: "SVG drawing", extensions: ["svg"], mime: "image/svg+xml" }); return true; } },
      { label: "Done", primary: true },
    ], { wide: true });
  }

  showWiring() {
    const lines = wiringList(this.app.p, this.cfg);
    const by = new Map<string, typeof lines>();
    for (const l of lines) (by.get(l.controller) ?? by.set(l.controller, []).get(l.controller)!).push(l);
    const body = h("div", {},
      h("p", { class: "muted" }, "Every block driver, servo, sensor and LED, and where it connects. Board addresses are set with the solder jumpers on each board."),
      ...[...by].map(([ctrl, ls]) => h("div", {},
        h("h3", {}, ctrl),
        h("div", { class: "table-wrap" }, h("table", { class: "parts" },
          h("thead", {}, h("tr", {}, h("th", {}, "What"), h("th", {}, "Connects to"))),
          h("tbody", {}, ...ls.map((l) => h("tr", {}, h("td", {}, l.what), h("td", { class: "mono" }, l.where)))))))),
      lines.length ? null : h("p", {}, "Nothing to wire yet."));
    const text = lines.map((l) => `${l.controller}\t${l.what}\t${l.where}`).join("\n");
    dialog("Wiring list", body, [
      { label: "Copy", onClick: async () => { try { await navigator.clipboard.writeText(text); toast("Wiring list copied."); } catch { toast("Copy isn't available here.", "error"); } return true; } },
      { label: "Done", primary: true },
    ], { wide: true });
  }

  /** Keyboard while in control mode. Returns true if handled. */
  onKey(e: KeyboardEvent): boolean {
    if (e.code === "Space") { e.preventDefault(); this.doAndRender({ c: "stopAll" }, "All trains stopped."); return true; }
    if (e.key === "Escape" && this.tool) { this.tool = null; this.render(); this.app.render(); return true; }
    return false;
  }
}

function strokePrim(ctx: CanvasRenderingContext2D, v: View, pr: import("../geom").Prim) {
  if (pr.kind === "line") {
    const a = toScreen(v, pr.a), b = toScreen(v, pr.b);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  } else {
    const c = toScreen(v, pr.c);
    const a0 = -pr.a0, a1 = -(pr.a0 + pr.sweep);
    ctx.moveTo(c.x + pr.r * v.s * Math.cos(a0), c.y + pr.r * v.s * Math.sin(a0));
    ctx.arc(c.x, c.y, pr.r * v.s, a0, a1, pr.sweep > 0);
  }
}

export { CLIENT_ID, fmtLen, servoWhere, outputWhere, inputWhere, BLOCK_PINS };
