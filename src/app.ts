// The editor: state, input handling, panels and menus.
import { DEG, Pose, Seg, Vec, biarc, dist, minRadius, normAngle, samplePrim, tangentSegThrough, walk } from "./geom";
import { LIBRARIES, getLibrary, getPart, partGeometryLabel } from "./library";
import {
  Analysis, Anchor, Item, Project, WorldEnd, addLayer, addPolyBoard, addRectBoard, addStart, analyze, anchorPose,
  applySnap, boardAt, continuationEnd, createFlex, deleteItems, deleteLayer, endKey, findSnap, flexLength, geom,
  gradeBand, gradient, isVisible, itemsById, mirrorItems, moveItems, newProject, partOf, partsCsv, partsList,
  placePart, projectBounds, rotateItems, selectionBounds, setHeightAt, shiftHeights, summarize, uid,
  appendModule, mainLibrary, moduleJoints, motorsOverFrame, rejoinModule, trackPorts, portUsed, boardGuides, layGuides, allModuleEnds, BoardPort,
} from "./model";
import { DEFAULT_SPACING, MODULES, MODULE_FAMILIES, defaultEdge, edgeOf, getModule, maxTracks, moduleMembers, moduleOpenings, overallDepth, singleTrackOnly, tracksOf, ModulePreset } from "./modules";
import { endsTouch } from "./modules";
import { EXAMPLES, buildExample } from "./examples";
import { YardKind, YardOptions, buildYard, minYardLength, partName, roadSpacings, wagonLength, yardParts } from "./yards";
import { History } from "./history";
import { Proposal, applyProposal, describeProposal, rejectProposal, staleIds } from "./proposals";
import { ChatPanel } from "./claude/chatui";
import { FileError, parseProject, serialize } from "./io";
import { LabelMode, Palette, View, drawProject, fmtLen, hitItem, itemsInRect, projectToSvg, readPalette, toScreen, toWorldPt } from "./render2d";
import { partThumb } from "./thumbs";
import { LAYOUT_FILTER, hostedSave, isDesktop, isHosted, openText, saveBlob as rawSaveBlob, saveText, setWindowTitle, store } from "./platform";
import { buildControlDemo, buildSample } from "./sample";
import { clear, h, icon } from "./ui/dom";
import { closeDialog, confirmDialog, dialog, field, isDialogOpen, numInput, toast } from "./ui/dialogs";
import { View3D } from "./view3d";
import { ControlUI } from "./control/ui";
import { fetchText, servedByController } from "./control/link";
import { hubStatus } from "./control/hubclient";

type Tool = "select" | "start" | "flex" | "board" | "measure";
type Drag =
  | { kind: "move"; last: Vec; moved: boolean }
  | { kind: "pan"; x: number; y: number; moved: boolean; button: number }
  | { kind: "marquee"; a: Vec; b: Vec; add: boolean }
  | { kind: "startdir"; id: string; at: Vec }
  | { kind: "measure" };

interface LastPlaced { item: string; part: string; k: number; mirror: boolean; at: Pose & { z: number } }
interface FlexDraft { part: string; start: Pose & { z: number }; segs: Seg[]; preview: Seg[] | null; ok: boolean; snapTo: WorldEnd | null; free: boolean; origin?: Vec }

let hostedNotice: () => void = () => {};
async function saveBlob(...args: Parameters<typeof rawSaveBlob>) {
  if (isHosted()) {
    try {
      const r = await hostedSave(args[0], args[1]);
      if (r === "unavailable") { hostedNotice(); return null; }
      return r;
    } catch (err) { toast((err as Error).message, "error"); return null; }
  }
  return rawSaveBlob(...args);
}

const AUTOSAVE_KEY = "railplot.autosave.v1";
const PREFS_KEY = "railplot.prefs.v1";
const VERSION = "0.10.0";

export class App {
  p: Project = newProject();
  hist = new History();
  sel = new Set<string>();
  anchor: Anchor | null = null;
  last: LastPlaced | null = null;
  tool: Tool = "select";
  view: View = { s: 0.4, ox: 300, oy: 600 };
  heights = false;
  labels: LabelMode = "none";
  showGrid = true;
  showStructure = true;
  showTrackGuides = true;
  /** The last track library shown, for building yards while the yards list is open. */
  lastTrackLib = "";
  /** Tracks across each new module, when it doesn't carry on from another. */
  defaultTracks = 1;
  heightSel: Vec | null = null;
  hoverEnd: Vec | null = null;
  cursor: Vec | null = null;
  measure: { a: Vec; b: Vec } | null = null;
  marquee: { a: Vec; b: Vec } | null = null;
  boardDraft: Vec[] | null = null;
  flex: FlexDraft | null = null;
  flexPart = "peco-setrack-oo/SL-100";
  libId = "peco-setrack-oo";
  filter = "";
  filePath?: string;
  fileName = "";
  dirty = false;
  clipboard: string | null = null;
  an: Analysis = analyze(this.p);
  pal!: Palette;
  drag: Drag | null = null;
  spaceDown = false;
  view3d: View3D | null = null;
  mode3d = false;
  theme: "system" | "light" | "dark" = "system";
  mode: "design" | "control" = "design";
  ctl!: ControlUI;

  root: HTMLElement;
  canvas!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D;
  el: Record<string, HTMLElement> = {};
  private raf = 0;
  private autosaveTimer = 0;
  /** Proposals this window has had (from the file, the hub or the autosave), so new ones can be announced. */
  seenProposals = new Set<string>();
  /** Proposals accepted or rejected here: undo brings one back only with the step that resolved it. */
  resolvedProposals = new Set<string>();
  /** The proposal drawn on the plan. */
  showProp: string | null = null;
  /** What happened to proposals resolved in this window, for the chat's cards. */
  proposalOutcome = new Map<string, "accepted" | "rejected">();
  chat!: ChatPanel;
  /** Proposal ids in the file last time it was read (desktop app), to notice ones withdrawn. */
  private fileProposalIds = new Set<string>();
  private filePoll = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.loadPrefs();
    this.buildShell();
    this.pal = readPalette(this.root);
    this.ctl = new ControlUI(this);
    this.chat = new ChatPanel(this);
    this.el.workspace.append(this.chat.el);
    this.boot();
    this.bindEvents();
    hostedNotice = () => this.showHostedNotice();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => this.onThemeChange());
  }

  // ---------- boot / persistence ----------

  private boot() {
    const saved = store.get(AUTOSAVE_KEY);
    let loaded = false;
    if (saved) {
      try {
        const d = JSON.parse(saved);
        this.p = parseProject(JSON.stringify(d.project));
        this.fileName = d.fileName ?? "";
        this.filePath = d.filePath;
        this.dirty = !!d.dirty;
        loaded = true;
      } catch { /* ignore a damaged autosave */ }
    }
    if (!loaded) this.p = buildSample();
    for (const x of this.p.proposals ?? []) this.seenProposals.add(x.id);
    this.ctl.onProjectChanged();
    this.hist.reset(this.p);
    this.an = analyze(this.p);
    this.libId = this.p.items.length ? mainLibrary(this.p) : this.libId;
    this.renderLibrary();
    requestAnimationFrame(() => { this.resize(); this.zoomFit(); this.refresh(); });
    if (isDesktop()) this.openStartupFile();
    this.checkController();
    this.filePoll = window.setInterval(() => this.pollFileProposals(), 3000);
  }

  /** Opened from a Railplot controller (a phone at http://railplot.local): load its layout and go straight to driving. */
  private async checkController() {
    if (typeof location !== "undefined" && location.protocol.startsWith("http") && await hubStatus(location.origin, 800)) {
      // opened from a Railplot hub: use its layout and drive through it
      if (await this.ctl.connectHub("", true)) this.setMode("control");
      return;
    }
    if (!(await servedByController())) return;
    const text = await fetchText("/api/layout");
    if (!text) { toast("This controller has no layout yet. On your computer, open Set up in Control and press Send layout to controller."); return; }
    try {
      const p = parseProject(text);
      const hub = p.control?.controllers.find((c) => c.kind === "esp32");
      if (hub) hub.host = "";
      this.replaceProject(p, "", undefined);
      this.dirty = false;
      this.setMode("control");
    } catch (err) { toast(err instanceof FileError ? err.message : "The layout on the controller couldn't be read.", "error"); }
  }

  setMode(m: "design" | "control") {
    this.mode = m;
    this.root.classList.toggle("is-control", m === "control");
    if (m === "control") {
      this.flex = null; this.boardDraft = null; this.measure = null; this.last = null; this.tool = "select";
      this.canvas.dataset.tool = "control";
      this.ctl.onProjectChanged();
    } else { this.ctl.tool = null; this.canvas.dataset.tool = this.tool; }
    this.refresh();
    requestAnimationFrame(() => { this.resize(); this.zoomFit(); });
  }

  /** Desktop: open a layout passed on the command line (double-clicked in Explorer). */
  private async openStartupFile() {
    try {
      const T = window.__TAURI__!;
      const path: string | null = await T.core.invoke("startup_file");
      if (!path) return;
      const text: string = await T.core.invoke("read_text_file", { path });
      this.replaceProject(parseProject(text), path.split(/[\\/]/).pop(), path);
    } catch (err) {
      toast(err instanceof FileError ? err.message : `Couldn't open the file: ${(err as Error).message ?? err}`, "error");
    }
  }

  private loadPrefs() {
    try {
      const d = JSON.parse(store.get(PREFS_KEY) ?? "{}");
      if (d.theme) this.theme = d.theme;
      if (typeof d.showGrid === "boolean") this.showGrid = d.showGrid;
    } catch { /* defaults */ }
    this.applyTheme();
  }
  private savePrefs() { store.set(PREFS_KEY, JSON.stringify({ theme: this.theme, showGrid: this.showGrid })); }

  private applyTheme() {
    if (this.theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", this.theme);
  }

  private onThemeChange() {
    this.pal = readPalette(this.root);
    this.view3d?.setBackground(this.pal.plot);
    this.render();
  }

  scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      store.set(AUTOSAVE_KEY, JSON.stringify({ project: this.p, fileName: this.fileName, filePath: this.filePath, dirty: this.dirty, at: Date.now() }));
    }, 500);
  }

  // ---------- document changes ----------

  commit() {
    if (this.hist.commit(this.p)) {
      this.dirty = true;
      this.scheduleAutosave();
      this.ctl?.onCommitted();
    }
    this.refresh();
  }

  /** A layout that came from a Railplot hub (another device changed it, or this one joined). */
  applyRemoteProject(p: Project) {
    const fresh = (p.proposals ?? []).filter((x) => !this.seenProposals.has(x.id));
    for (const x of p.proposals ?? []) this.seenProposals.add(x.id);
    if (sameApartFromProposals(this.p, p)) {
      // only the proposals changed (one arrived or was withdrawn): keep the undo history and selection
      if (p.proposals?.length) this.p.proposals = p.proposals; else delete this.p.proposals;
      this.hist.amend(this.p);
      this.scheduleAutosave();
      this.refresh();
      this.announceProposals(fresh);
      return;
    }
    const first = !this.p.items.length || this.p.name !== p.name || this.p.items.length !== p.items.length;
    this.p = p;
    this.sel.clear(); this.anchor = null; this.last = null; this.flex = null; this.boardDraft = null; this.measure = null; this.heightSel = null;
    this.ctl.onProjectChanged();
    this.hist.reset(p);
    this.an = analyze(p);
    if (first) this.zoomFit();
    this.scheduleAutosave();
    this.refresh();
    this.announceProposals(fresh);
  }

  // ---------- proposals (from the Claude connector) ----------

  /** After undo or redo: proposals that arrived since that state stay, ones resolved in a later step stay resolved. */
  private keepProposals(p: Project): Project {
    const there = new Set((p.proposals ?? []).map((x) => x.id));
    const keep = (this.p.proposals ?? []).filter((x) => !there.has(x.id) && !this.resolvedProposals.has(x.id));
    const all = [...(p.proposals ?? []), ...keep];
    if (all.length) p.proposals = all; else delete p.proposals;
    return p;
  }

  private announceProposals(fresh: Proposal[]) {
    if (!fresh.length) return;
    this.root.classList.add("show-insp");
    toast(fresh.length === 1 ? `Claude proposes: ${fresh[0].title}. Accept or reject it under Claude's proposals.` : `Claude made ${fresh.length} proposals. Accept or reject them under Claude's proposals.`);
  }

  /** Desktop app with a saved file: pick up proposals the Claude connector wrote into the file. */
  async pollFileProposals() {
    const T = window.__TAURI__;
    if (!T || !this.filePath || isDialogOpen()) return;
    let text: string;
    try { text = await T.core.invoke("read_text_file", { path: this.filePath }); } catch { return; }
    let file: Project;
    try { file = JSON.parse(text); } catch { return; }
    const inFile = file.proposals ?? [];
    const ids = new Set(inFile.map((x) => x.id));
    const fresh = inFile.filter((x) => !this.seenProposals.has(x.id));
    // withdrawn: was in the file, isn't now, still waiting here
    const gone = [...this.fileProposalIds].filter((id) => !ids.has(id) && (this.p.proposals ?? []).some((x) => x.id === id));
    this.fileProposalIds = ids;
    if (!fresh.length && !gone.length) return;
    for (const x of fresh) this.seenProposals.add(x.id);
    const list = [...(this.p.proposals ?? []).filter((x) => !gone.includes(x.id)), ...fresh];
    if (list.length) this.p.proposals = list; else delete this.p.proposals;
    if (this.showProp && gone.includes(this.showProp)) this.showProp = null;
    this.hist.amend(this.p);
    this.scheduleAutosave();
    this.refresh();
    this.announceProposals(fresh);
  }

  showProposal(id: string | null) {
    this.showProp = this.showProp === id ? null : id;
    const pr = this.p.proposals?.find((x) => x.id === this.showProp);
    if (pr) {
      // zoom to what it touches
      const objs = [...pr.add.boards, ...pr.change.boards, ...pr.before.boards];
      const its = [...pr.add.items, ...pr.change.items, ...pr.before.items];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const take = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
      for (const b of objs) for (const q of b.pts) take(q.x, q.y);
      for (const it of its) { try { const g = geom({ ...it, id: `~${it.id}` }); take(g.bounds.minX, g.bounds.minY); take(g.bounds.maxX, g.bounds.maxY); } catch { /* unknown part */ } }
      if (isFinite(minX)) this.zoomToBox(minX, minY, maxX, maxY);
    }
    this.render();
    this.renderProposals();
  }

  acceptProposal(id: string, force = false) {
    const pr = this.p.proposals?.find((x) => x.id === id);
    if (!pr) return;
    const r = applyProposal(this.p, pr, force);
    if (!r.ok) {
      confirmDialog("The plan has changed since this was proposed",
        `${r.stale.length} of the things it changes or removes ${r.stale.length === 1 ? "has" : "have"} been changed or deleted since Claude proposed this. Accepting puts Claude's versions in their place.`,
        "Accept anyway").then((yes) => { if (yes) this.acceptProposal(id, true); });
      return;
    }
    this.resolvedProposals.add(id);
    this.proposalOutcome.set(id, "accepted");
    if (this.showProp === id) this.showProp = null;
    this.sel = new Set(r.ids.filter((x) => this.exists(x)));
    this.commit();
    toast(`Accepted: ${pr.title}. Undo takes it back.`);
  }

  rejectProposal(id: string) {
    const pr = this.p.proposals?.find((x) => x.id === id);
    if (!pr) return;
    rejectProposal(this.p, id);
    this.resolvedProposals.add(id);
    this.proposalOutcome.set(id, "rejected");
    if (this.showProp === id) this.showProp = null;
    this.commit();
    toast(`Rejected: ${pr.title}.`);
  }

  /** A proposal made in this window (the chat): it joins the list, and goes to the hub if connected. */
  addProposal(pr: Proposal) {
    this.p.proposals = [...(this.p.proposals ?? []).filter((x) => x.id !== pr.id), pr];
    this.seenProposals.add(pr.id);
    this.hist.amend(this.p);
    this.dirty = true;
    this.scheduleAutosave();
    this.refresh();
    this.ctl.onCommitted();
  }

  /** Claude takes back one of its proposals. */
  withdrawProposal(id: string): boolean {
    if (!this.p.proposals?.some((x) => x.id === id)) return false;
    rejectProposal(this.p, id);
    this.resolvedProposals.add(id);
    this.hist.amend(this.p);
    this.scheduleAutosave();
    this.refresh();
    this.ctl.onCommitted();
    return true;
  }

  private zoomToBox(minX: number, minY: number, maxX: number, maxY: number) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pad = 60;
    const s = Math.min((r.width - 2 * pad) / Math.max(200, maxX - minX), (r.height - 2 * pad) / Math.max(200, maxY - minY));
    const cur = this.view.s;
    // only zoom in as far as needed; keep the current scale when it already fits
    const fits = (() => { const a = toScreen(this.view, { x: minX, y: maxY }), b = toScreen(this.view, { x: maxX, y: minY }); return a.x > 0 && a.y > 0 && b.x < r.width && b.y < r.height; })();
    if (fits) return;
    this.view.s = Math.min(Math.max(0.05, s), Math.max(cur, 0.05) * 4);
    this.view.ox = r.width / 2 - ((minX + maxX) / 2) * this.view.s;
    this.view.oy = r.height / 2 + ((minY + maxY) / 2) * this.view.s;
    this.renderStatus();
  }

  renderProposals() {
    const box = this.el.props;
    if (!box) return;
    clear(box);
    const list = this.mode === "design" ? this.p.proposals ?? [] : [];
    box.hidden = !list.length;
    if (!list.length) return;
    box.append(h("div", { class: "sec-head" }, h("h3", { html: `${icon("spark", 16)}<span>Claude's proposals</span>` }), h("span", { class: "muted small mono" }, String(list.length))));
    for (const pr of list) {
      const stale = staleIds(this.p, pr);
      const on = this.showProp === pr.id;
      box.append(h("div", { class: `prop-card ${on ? "on" : ""}`, "data-prop": pr.id },
        h("div", { class: "prop-title" }, pr.title),
        h("div", { class: "muted small" }, `${pr.by} · ${ago(pr.at)} · ${describeProposal(pr)}`),
        pr.why ? h("p", { class: "prop-why small" }, pr.why) : null,
        stale.length ? h("p", { class: "warn-note" }, `The plan has changed where this would go (${stale.length} object${stale.length === 1 ? "" : "s"}).`) : null,
        h("div", { class: "btn-row" },
          h("button", { class: `btn btn-sm ${on ? "on" : ""}`, type: "button", "aria-pressed": String(on), onclick: () => this.showProposal(pr.id), html: `${icon("eye", 14)}<span>${on ? "Hide" : "Show"}</span>` }),
          h("button", { class: "btn btn-sm btn-primary", type: "button", onclick: () => this.acceptProposal(pr.id), html: `${icon("check", 14)}<span>Accept</span>` }),
          h("button", { class: "btn btn-sm", type: "button", onclick: () => this.rejectProposal(pr.id), html: `${icon("close", 14)}<span>Reject</span>` }))));
    }
  }

  refresh() {
    this.an = analyze(this.p);
    this.ctl?.onProjectChanged();
    if (this.anchor && !this.anchorValid(this.anchor)) this.anchor = null;
    for (const id of [...this.sel]) if (!this.exists(id)) this.sel.delete(id);
    if (this.last && !this.p.items.some((i) => i.id === this.last!.item)) this.last = null;
    this.render();
    this.renderInspector();
    this.renderLayers();
    if (this.showProp && !this.p.proposals?.some((x) => x.id === this.showProp)) this.showProp = null;
    this.renderProposals();
    this.chat?.refresh();
    this.renderStatus();
    this.renderPlacementBar();
    this.renderToolbarState();
    setWindowTitle(`${this.p.name}${this.dirty ? " •" : ""} · Railplot`);
    this.el.docName.textContent = this.p.name;
    this.el.docState.textContent = this.dirty ? "Unsaved changes" : (this.fileName ? `Saved as ${this.fileName}` : "Not saved to a file yet");
    if (this.mode3d) this.view3d?.setProject(this.p, false);
  }

  private exists(id: string) {
    return this.p.items.some((i) => i.id === id) || this.p.boards.some((b) => b.id === id) || this.p.starts.some((s) => s.id === id);
  }

  private anchorValid(a: Anchor) {
    if (a.kind === "start") return this.p.starts.some((s) => s.id === a.id);
    if (a.kind === "port") return trackPorts(this.p).some((q) => dist(q, a) < 0.5 && Math.abs(normAngle(q.h - a.h)) < 0.01) && !portUsed(this.p, a, this.an);
    return this.an.free.some((e) => e.item === a.item && e.end === a.end);
  }

  private replaceProject(p: Project, fileName = "", path?: string) {
    this.p = p;
    this.fileName = fileName;
    this.filePath = path;
    this.dirty = false;
    this.sel.clear(); this.anchor = null; this.last = null; this.flex = null; this.boardDraft = null; this.measure = null; this.heightSel = null;
    this.ctl.onProjectChanged();
    this.hist.reset(p);
    this.an = analyze(p);
    this.libId = p.items.length ? mainLibrary(p) : this.libId;
    for (const x of p.proposals ?? []) this.seenProposals.add(x.id);
    this.fileProposalIds = new Set((p.proposals ?? []).map((x) => x.id));
    this.showProp = null;
    this.renderLibrary();
    this.zoomFit();
    this.scheduleAutosave();
    this.refresh();
  }

  // ---------- placing track ----------

  anchorPoseOrCentre(): Pose & { z: number } {
    const a = this.anchor && anchorPose(this.p, this.anchor);
    if (a) return a;
    const r = this.canvas.getBoundingClientRect();
    const c = toWorldPt(this.view, { x: r.width / 2, y: r.height / 2 });
    return { x: Math.round(c.x / 10) * 10, y: Math.round(c.y / 10) * 10, h: 0, z: 0 };
  }

  placeFromLibrary(key: string, k = 0, mirror = false) {
    const part = getPart(key);
    if (!part) return;
    if (part.def.type === "flex") { this.flexPart = key; this.setTool("flex"); return; }
    const at = this.anchorPoseOrCentre();
    const consumed = this.anchor?.kind === "start" ? this.anchor.id : null;
    const it = placePart(this.p, key, at, k, mirror);
    if (consumed) this.p.starts = this.p.starts.filter((s) => s.id !== consumed);
    this.last = { item: it.id, part: key, k, mirror, at };
    this.afterPlace(it, k);
  }

  private afterPlace(it: Item, k: number) {
    this.sel = new Set([it.id]);
    this.heightSel = null;
    const an = analyze(this.p);
    const cont = continuationEnd(partOf(it), k);
    const isFree = (end: number) => an.free.some((e) => e.item === it.id && e.end === end);
    if (isFree(cont)) this.anchor = { kind: "end", item: it.id, end: cont };
    else {
      const other = an.free.find((e) => e.item === it.id);
      this.anchor = other ? { kind: "end", item: other.item, end: other.end } : null;
      if (!other) toast("Track joined up. Pick an end to keep building.");
    }
    this.commit();
  }

  adjustLast(change: "flip" | "nextEnd") {
    const L = this.last;
    if (!L) return;
    const part = getPart(L.part)!;
    const idx = this.p.items.findIndex((i) => i.id === L.item);
    if (idx < 0) return;
    this.p.items.splice(idx, 1);
    let { k, mirror } = L;
    if (change === "flip") mirror = !mirror;
    else k = (k + 1) % part.ends.length;
    const it = placePart(this.p, L.part, L.at, k, mirror);
    this.last = { ...L, item: it.id, k, mirror };
    this.afterPlace(it, k);
  }

  repeatLast() {
    if (!this.last) { toast("Place a piece first, then Space repeats it."); return; }
    if (!this.anchor) { toast("No free end to continue from. Click a track end first."); return; }
    this.placeFromLibrary(this.last.part, this.last.k === 0 ? 0 : this.last.k, this.last.mirror);
  }

  // ---------- tools ----------

  setTool(t: Tool) {
    if (this.tool === "flex" && t !== "flex") this.flex = null;
    if (this.tool === "board" && t !== "board") this.boardDraft = null;
    if (t !== "measure") this.measure = null;
    this.tool = t;
    this.last = t === "select" ? this.last : null;
    if (t === "flex" && this.anchor) this.beginFlexAtAnchor();
    this.canvas.dataset.tool = t;
    this.refresh();
  }

  private beginFlexAtAnchor() {
    const a = this.anchor && anchorPose(this.p, this.anchor);
    if (!a) return;
    this.flex = { part: this.flexPart, start: a, segs: [], preview: null, ok: true, snapTo: null, free: false };
  }

  private flexEnd(): Pose & { z: number } {
    const f = this.flex!;
    let e: Pose = f.start;
    for (const s of f.segs) e = walk(e, s);
    return { ...e, z: f.start.z };
  }

  private updateFlexPreview(w: Vec) {
    const f = this.flex;
    if (!f) return;
    const minR = getPart(f.part)?.def.minRadius ?? 0;
    if (f.free && f.origin && !f.segs.length && f.start.h === undefined as unknown) return;
    const end = this.flexEnd();
    const snapEnd = this.nearestFreeEnd(w, 14, (e) => !(f.snapTo && false) && dist(e, f.start) > 1);
    f.snapTo = null;
    if (snapEnd && dist(snapEnd, end) > 2) {
      const segs = biarc(end, snapEnd, normAngle(snapEnd.h + Math.PI));
      if (segs) {
        f.preview = segs;
        f.snapTo = snapEnd;
        f.ok = minRadius(segs) >= minR - 0.01;
        return;
      }
    }
    // or to a track position on a baseboard module, arriving square to the face
    const port = this.portAt(w, 14, (q) => dist(q, f.start) > 1 && Math.cos(q.h) * (end.x - q.x) + Math.sin(q.h) * (end.y - q.y) > 0);
    if (port && dist(port, end) > 2) {
      const segs = biarc(end, port, normAngle(port.h + Math.PI));
      if (segs) {
        f.preview = segs;
        f.snapTo = { x: port.x, y: port.y, h: port.h, z: 0 } as WorldEnd;
        f.ok = minRadius(segs) >= minR - 0.01;
        return;
      }
    }
    const s = tangentSegThrough(end, w, minR);
    f.preview = s ? [s] : null;
    f.ok = true;
  }

  private flexClick(w: Vec) {
    if (!this.flex) {
      const end = this.nearestFreeEnd(w, 12);
      const port = end ? null : this.portAt(w, 12);
      if (end) {
        this.anchor = { kind: "end", item: end.item, end: end.end };
        this.beginFlexAtAnchor();
      } else if (port) {
        this.anchor = { kind: "port", x: port.x, y: port.y, h: port.h };
        this.beginFlexAtAnchor();
      } else {
        // free start: the first click sets the start, the direction comes from the next point
        const st = addStart(this.p, w.x, w.y, 0);
        this.anchor = { kind: "start", id: st.id };
        this.flex = { part: this.flexPart, start: { x: w.x, y: w.y, h: 0, z: 0 }, segs: [], preview: null, ok: true, snapTo: null, free: true, origin: w };
      }
      this.refresh();
      return;
    }
    const f = this.flex;
    if (f.free && !f.segs.length) {
      const d = dist(w, f.start);
      if (d < 5) return;
      f.start = { ...f.start, h: Math.atan2(w.y - f.start.y, w.x - f.start.x) };
      f.segs.push({ kind: "s", len: d });
      f.free = false;
      this.render(); this.renderInspector();
      return;
    }
    if (!f.preview) return;
    if (!f.ok) { toast(`That join needs a curve tighter than the ${Math.round(getPart(f.part)?.def.minRadius ?? 0)} mm minimum radius.`, "error"); return; }
    f.segs.push(...f.preview);
    if (f.snapTo) { this.finishFlex(); return; }
    f.preview = null;
    this.render(); this.renderInspector();
  }

  finishFlex() {
    const f = this.flex;
    if (!f) return;
    if (!f.segs.length || flexLength(f.segs) < 1) { this.cancelFlex(); return; }
    if (f.free) return;
    const consumed = this.anchor?.kind === "start" ? this.anchor.id : null;
    const it = createFlex(this.p, f.part, f.start, f.segs);
    if (consumed) this.p.starts = this.p.starts.filter((s) => s.id !== consumed);
    if (f.snapTo) it.z[1] = f.snapTo.z;
    this.flex = null;
    this.sel = new Set([it.id]);
    const an = analyze(this.p);
    this.anchor = an.free.some((e) => e.item === it.id && e.end === 1) ? { kind: "end", item: it.id, end: 1 } : null;
    this.last = null;
    this.commit();
    if (this.tool === "flex" && this.anchor) this.beginFlexAtAnchor();
    this.render();
  }

  cancelFlex() {
    if (this.flex?.free && this.anchor?.kind === "start") {
      const id = this.anchor.id;
      this.p.starts = this.p.starts.filter((s) => s.id !== id);
      this.anchor = null;
    }
    this.flex = null;
    this.refresh();
  }

  addFlexSection(seg: Seg) {
    if (!this.flex) { if (this.anchor) this.beginFlexAtAnchor(); else { toast("Pick a track end or start point first."); return; } }
    const f = this.flex!;
    if (f.free) { toast("Click once more on the plan to set the direction first."); return; }
    const minR = getPart(f.part)?.def.minRadius ?? 0;
    if (seg.kind === "a" && seg.r < minR) seg = { ...seg, r: minR };
    f.segs.push(seg);
    this.render(); this.renderInspector();
  }

  finishBoard() {
    const d = this.boardDraft;
    if (!d || d.length < 3) { toast("A baseboard needs at least three corners."); return; }
    const b = addPolyBoard(this.p, d);
    this.boardDraft = null;
    this.sel = new Set([b.id]);
    this.setTool("select");
    this.commit();
  }

  // ---------- selection edits ----------

  selectedIds() { return [...this.sel]; }

  deleteSelection() {
    if (!this.sel.size) return;
    deleteItems(this.p, this.sel);
    this.sel.clear();
    this.last = null;
    this.commit();
  }

  rotateSelection(deg: number) {
    const b = selectionBounds(this.p, this.sel);
    if (!b) return;
    rotateItems(this.p, this.sel, deg * DEG, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
    this.last = null;
    this.commit();
  }

  flipSelection() {
    if (this.last && this.sel.size === 1 && this.sel.has(this.last.item)) { this.adjustLast("flip"); return; }
    const b = selectionBounds(this.p, this.sel);
    if (!b) return;
    mirrorItems(this.p, this.sel, (b.minX + b.maxX) / 2);
    this.commit();
  }

  nudge(dx: number, dy: number) {
    if (!this.sel.size) return;
    moveItems(this.p, this.sel, dx, dy);
    this.last = null;
    this.commit();
  }

  copy(cut = false) {
    if (!this.sel.size) return;
    const items = itemsById(this.p, this.sel);
    const boards = this.p.boards.filter((b) => this.sel.has(b.id));
    this.clipboard = JSON.stringify({ items, boards });
    if (cut) this.deleteSelection();
    toast(`${cut ? "Cut" : "Copied"} ${items.length + boards.length} item${items.length + boards.length === 1 ? "" : "s"}.`);
  }

  paste() {
    if (!this.clipboard) return;
    const d = JSON.parse(this.clipboard) as { items: Item[]; boards: { id: string; name: string; pts: Vec[] }[] };
    const ids: string[] = [];
    const off = 60;
    for (const it of d.items) {
      const n = { ...it, id: uid(this.p, "t"), x: it.x + off, y: it.y - off, layer: this.p.activeLayer };
      this.p.items.push(n); ids.push(n.id);
    }
    for (const b of d.boards) {
      const n = { ...b, id: uid(this.p, "b"), pts: b.pts.map((q) => ({ x: q.x + off, y: q.y - off })) };
      this.p.boards.push(n); ids.push(n.id);
    }
    this.clipboard = JSON.stringify({ items: itemsById(this.p, ids), boards: this.p.boards.filter((b) => ids.includes(b.id)) });
    this.sel = new Set(ids);
    this.last = null;
    this.commit();
  }

  selectAll() {
    this.sel = new Set([...this.p.items.filter((i) => isVisible(this.p, i)).map((i) => i.id)]);
    this.refresh();
  }

  undo() { const p = this.hist.undo(); if (p) { this.p = this.keepProposals(p); this.last = null; this.flex = null; this.dirty = true; this.scheduleAutosave(); this.refresh(); this.ctl.onCommitted(); } }
  redo() { const p = this.hist.redo(); if (p) { this.p = this.keepProposals(p); this.last = null; this.dirty = true; this.scheduleAutosave(); this.refresh(); this.ctl.onCommitted(); } }

  // ---------- view ----------

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.render();
  }

  zoomFit() {
    const b = projectBounds(this.p);
    const r = this.canvas.getBoundingClientRect();
    if (!b || r.width < 10) { this.view = { s: 0.4, ox: r.width / 2, oy: r.height / 2 }; this.render(); return; }
    const pad = 48;
    const s = Math.min((r.width - pad * 2) / Math.max(50, b.maxX - b.minX), (r.height - pad * 2) / Math.max(50, b.maxY - b.minY));
    this.view.s = Math.max(0.02, Math.min(8, s));
    this.view.ox = r.width / 2 - ((b.minX + b.maxX) / 2) * this.view.s;
    this.view.oy = r.height / 2 + ((b.minY + b.maxY) / 2) * this.view.s;
    this.render(); this.renderStatus();
  }

  zoomAt(f: number, sx?: number, sy?: number) {
    const r = this.canvas.getBoundingClientRect();
    const cx = sx ?? r.width / 2, cy = sy ?? r.height / 2;
    const w = toWorldPt(this.view, { x: cx, y: cy });
    this.view.s = Math.max(0.02, Math.min(20, this.view.s * f));
    this.view.ox = cx - w.x * this.view.s;
    this.view.oy = cy + w.y * this.view.s;
    this.render(); this.renderStatus();
  }

  render() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.draw());
  }

  private draw() {
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    const w = this.canvas.width / dpr, hgt = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const anchor = this.anchor && anchorPose(this.p, this.anchor);
    const ctlMode = this.mode === "control";
    drawProject(ctx, this.view, w, hgt, this.p, ctlMode ? {
      selection: new Set(), anchor: null, hoverEnd: null, heights: false, heightSel: null, labels: "none",
      gridStep: this.p.gridStep, showGrid: this.showGrid, analysis: { ends: [], partner: new Map(), free: [], bad: [] }, structure: false, tracksGuides: false,
    } : {
      selection: this.sel,
      anchor: anchor && !this.flex ? anchor : null,
      hoverEnd: this.hoverEnd,
      heights: this.heights,
      heightSel: this.heightSel,
      labels: this.labels,
      draft: this.flex && !this.flex.free ? { start: this.flex.start, segs: this.flex.segs, preview: this.flex.preview, ok: this.flex.ok } :
        this.flex && this.flex.free && this.cursor ? { start: { ...this.flex.start, h: Math.atan2(this.cursor.y - this.flex.start.y, this.cursor.x - this.flex.start.x) }, segs: [], preview: [{ kind: "s", len: Math.max(1, dist(this.cursor, this.flex.start)) }], ok: true } : null,
      boardDraft: this.boardDraft,
      cursor: this.cursor,
      measure: this.measure,
      marquee: this.marquee,
      gridStep: this.p.gridStep,
      showGrid: this.showGrid,
      analysis: this.an,
      structure: this.showStructure,
      tracksGuides: this.showTrackGuides,
      guideMinRadius: getPart(this.flexForTrack())?.def.minRadius,
      proposal: this.proposalOverlay(),
    }, this.pal);
    if (ctlMode) this.ctl.drawOverlay(ctx, this.view);
    this.el.emptyHint.hidden = ctlMode || this.p.items.length > 0 || this.p.boards.length > 0 || !!this.flex || !!this.boardDraft;
  }

  private proposalOverlay() {
    const pr = this.showProp ? this.p.proposals?.find((x) => x.id === this.showProp) : undefined;
    if (!pr) return null;
    // drawn under ids of their own, so they don't disturb the plan's cached geometry
    const known = (it: Item) => !!getPart(it.part);
    return {
      boards: [...pr.add.boards, ...pr.change.boards],
      items: [...pr.add.items, ...pr.change.items].filter(known).map((it) => ({ ...it, id: `~${it.id}` })),
      dim: new Set([...pr.change.items.map((x) => x.id), ...pr.remove]),
      removed: new Set(pr.remove),
    };
  }

  // ---------- hit helpers ----------

  private nearestFreeEnd(w: Vec, px: number, accept: (e: WorldEnd & { item: string; end: number }) => boolean = () => true) {
    const tol = px / this.view.s;
    let best: (WorldEnd & { item: string; end: number }) | null = null, bd = Infinity;
    for (const e of this.an.free) {
      const it = this.p.items.find((i) => i.id === e.item);
      if (it && !isVisible(this.p, it)) continue;
      const d = dist(e, w);
      if (d < tol && d < bd && accept(e)) { best = e; bd = d; }
    }
    return best;
  }

  /**
   * A free track position on a module face near `w`. Where two modules meet there is one for each,
   * facing into it: take the one facing the pointer.
   */
  private portAt(w: Vec, px: number, accept: (q: BoardPort) => boolean = () => true): BoardPort | null {
    const tol = px / this.view.s;
    if (!this.showTrackGuides) return null;
    const near = trackPorts(this.p).filter((q) => dist(q, w) < tol && accept(q) && !portUsed(this.p, q, this.an));
    if (!near.length) return null;
    near.sort((a, b) => dist(a, w) - dist(b, w) || (Math.cos(b.h) * (w.x - b.x) + Math.sin(b.h) * (w.y - b.y)) - (Math.cos(a.h) * (w.x - a.x) + Math.sin(a.h) * (w.y - a.y)));
    const first = near[0];
    const twins = near.filter((q) => dist(q, first) < 1);
    return twins.sort((a, b) => (Math.cos(b.h) * (w.x - b.x) + Math.sin(b.h) * (w.y - b.y)) - (Math.cos(a.h) * (w.x - a.x) + Math.sin(a.h) * (w.y - a.y)))[0];
  }

  /** The track library in use (the Baseboards list isn't one). */
  trackLibId(): string {
    if (getLibrary(this.libId)) return this.libId;
    if (this.lastTrackLib && getLibrary(this.lastTrackLib)) return this.lastTrackLib;
    const last = this.p.items[this.p.items.length - 1];
    return last ? partOf(last).lib.id : "peco-setrack-oo";
  }

  /** Flexible track to lay with: the library's own, or Peco Streamline (Hornby has none). */
  flexForTrack(): string {
    const lib = getLibrary(this.trackLibId());
    const f = lib?.parts.find((d) => d.type === "flex");
    return f ? `${lib!.id}/${f.id}` : "peco-setrack-oo/SL-100";
  }

  private startAt(w: Vec, px: number) {
    const tol = px / this.view.s;
    return this.p.starts.find((s) => dist(s, w) < tol || dist({ x: s.x + Math.cos(s.h) * 26 / this.view.s, y: s.y + Math.sin(s.h) * 26 / this.view.s }, w) < tol);
  }

  private jointAt(w: Vec, px: number): Vec | null {
    const tol = px / this.view.s;
    let best: Vec | null = null, bd = Infinity;
    for (const e of this.an.ends) { const d = dist(e, w); if (d < tol && d < bd) { best = { x: e.x, y: e.y }; bd = d; } }
    return best;
  }

  // ---------- events ----------

  private screenPos(e: MouseEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bindEvents() {
    const c = this.canvas;
    new ResizeObserver(() => this.resize()).observe(c.parentElement!);
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", () => { this.drag = null; this.marquee = null; this.render(); });
    c.addEventListener("pointerleave", () => { this.cursor = null; this.hoverEnd = null; this.renderStatus(); this.render(); });
    c.addEventListener("dblclick", (e) => {
      if (this.tool === "board") { this.boardDraft?.pop(); this.finishBoard(); }
      else if (this.tool === "flex") this.finishFlex();
      else {
        const w = toWorldPt(this.view, this.screenPos(e));
        if (!hitItem(this.p, w, 6 / this.view.s) && !boardAt(this.p, w)) this.zoomFit();
      }
    });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const s = this.screenPos(e);
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), s.x, s.y);
      else { this.view.ox -= e.deltaX; this.render(); }
    }, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("keydown", (e) => this.onKey(e));
    document.addEventListener("keyup", (e) => { if (e.code === "Space") this.spaceDown = false; });
    document.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".menu") && !t.closest(".menubar")) this.closeMenus();
      if (!t.closest(".ctxmenu")) this.el.ctx.hidden = true;
    });
    window.addEventListener("beforeunload", () => {
      store.set(AUTOSAVE_KEY, JSON.stringify({ project: this.p, fileName: this.fileName, filePath: this.filePath, dirty: this.dirty, at: Date.now() }));
    });
  }

  private onDown(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus({ preventScroll: true });
    const s = this.screenPos(e), w = toWorldPt(this.view, s);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
      this.drag = { kind: "pan", x: e.clientX, y: e.clientY, moved: false, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    if (this.mode === "control") {
      if (!this.ctl.onPlanClick(w)) this.drag = { kind: "pan", x: e.clientX, y: e.clientY, moved: false, button: 0 };
      return;
    }
    switch (this.tool) {
      case "select": {
        if (this.heights) {
          const j = this.jointAt(w, 10);
          if (j) { this.heightSel = j; this.sel.clear(); this.refresh(); return; }
        }
        const st = this.startAt(w, 10);
        if (st) {
          this.anchor = { kind: "start", id: st.id };
          this.sel = new Set([st.id]);
          this.last = null;
          this.drag = { kind: "move", last: w, moved: false };
          this.refresh();
          return;
        }
        const end = this.nearestFreeEnd(w, 10);
        if (end) {
          this.anchor = { kind: "end", item: end.item, end: end.end };
          this.last = null; this.heightSel = null;
          this.refresh();
          return;
        }
        const port = this.portAt(w, 9);
        if (port) {
          this.anchor = { kind: "port", x: port.x, y: port.y, h: port.h };
          this.last = null; this.heightSel = null; this.sel.clear();
          this.refresh();
          toast("Pick track on the left to build from this track position.");
          return;
        }
        const it = hitItem(this.p, w, 5 / this.view.s);
        const board = it ? null : boardAt(this.p, w);
        const id = it?.id ?? board?.id;
        this.heightSel = null;
        if (id) {
          if (e.shiftKey || e.ctrlKey) { this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); this.refresh(); return; }
          if (!this.sel.has(id)) { this.sel = new Set([id]); this.last = null; }
          this.drag = { kind: "move", last: w, moved: false };
          this.refresh();
          return;
        }
        if (!e.shiftKey) { this.sel.clear(); this.last = null; }
        this.drag = { kind: "marquee", a: w, b: w, add: e.shiftKey };
        this.marquee = { a: w, b: w };
        this.refresh();
        return;
      }
      case "start": {
        const st = addStart(this.p, Math.round(w.x), Math.round(w.y), 0);
        this.anchor = { kind: "start", id: st.id };
        this.sel = new Set([st.id]);
        this.drag = { kind: "startdir", id: st.id, at: w };
        this.refresh();
        return;
      }
      case "flex": this.flexClick(w); return;
      case "board": {
        const q = this.showGrid ? { x: Math.round(w.x / 10) * 10, y: Math.round(w.y / 10) * 10 } : w;
        if (!this.boardDraft) this.boardDraft = [];
        if (this.boardDraft.length >= 3 && dist(toScreen(this.view, this.boardDraft[0]), s) < 10) { this.finishBoard(); return; }
        this.boardDraft.push(q);
        this.render(); this.renderStatus();
        return;
      }
      case "measure":
        this.measure = { a: w, b: w };
        this.drag = { kind: "measure" };
        this.render();
        return;
    }
  }

  private onMove(e: PointerEvent) {
    const s = this.screenPos(e), w = toWorldPt(this.view, s);
    this.cursor = w;
    const d = this.drag;
    if (d?.kind === "pan") {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      this.view.ox += dx; this.view.oy += dy; d.x = e.clientX; d.y = e.clientY;
      this.render(); return;
    }
    if (d?.kind === "move") {
      const dx = w.x - d.last.x, dy = w.y - d.last.y;
      if (!d.moved && Math.hypot(dx, dy) * this.view.s < 3) { this.renderStatus(); return; }
      d.moved = true;
      moveItems(this.p, this.sel, dx, dy);
      d.last = w;
      this.an = analyze(this.p);
      this.render(); this.renderStatus(); return;
    }
    if (d?.kind === "marquee") { d.b = w; this.marquee = { a: d.a, b: w }; this.render(); return; }
    if (d?.kind === "startdir") {
      const st = this.p.starts.find((x) => x.id === d.id);
      if (st && dist(w, d.at) * this.view.s > 8) st.h = Math.round(Math.atan2(w.y - st.y, w.x - st.x) / (DEG * 7.5)) * 7.5 * DEG;
      this.render(); return;
    }
    if (d?.kind === "measure" && this.measure) { this.measure.b = w; this.render(); this.renderStatus(); return; }
    if (this.tool === "flex" && this.flex) this.updateFlexPreview(w);
    if (this.tool === "select" || this.tool === "flex") {
      const end = this.nearestFreeEnd(w, 10);
      this.hoverEnd = end ? { x: end.x, y: end.y } : null;
      this.canvas.style.cursor = end ? "pointer" : "";
    }
    this.render(); this.renderStatus();
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === "pan") {
      if (!d.moved && d.button === 2 && this.mode === "design") this.openContextMenu(e);
      return;
    }
    if (d.kind === "move") {
      if (d.moved) {
        const snap = findSnap(this.p, this.sel, 14 / this.view.s);
        if (snap) applySnap(this.p, this.sel, snap);
        this.last = null;
        this.commit();
      }
      return;
    }
    if (d.kind === "marquee") {
      const ids = itemsInRect(this.p, d.a, d.b);
      for (const b of this.p.boards) {
        const minX = Math.min(d.a.x, d.b.x), maxX = Math.max(d.a.x, d.b.x), minY = Math.min(d.a.y, d.b.y), maxY = Math.max(d.a.y, d.b.y);
        if (b.pts.every((q) => q.x >= minX && q.x <= maxX && q.y >= minY && q.y <= maxY)) ids.push(b.id);
      }
      for (const id of ids) this.sel.add(id);
      this.marquee = null;
      this.refresh();
      return;
    }
    if (d.kind === "startdir") { this.commit(); return; }
    if (d.kind === "measure") { this.renderStatus(); return; }
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (isDialogOpen()) return;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) {
      if (e.key === "Escape") t.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (this.mode === "control") {
      if (this.ctl.onKey(e)) return;
      if (mod && k.toLowerCase() === "s") { e.preventDefault(); this.save(); return; }
      if (k === "c" || k === "C") { this.setMode("design"); return; }
      if (k === "Home" || k === "0") { this.zoomFit(); return; }
      if (k === "+" || k === "=") { this.zoomAt(1.25); return; }
      if (k === "-") { this.zoomAt(0.8); return; }
      return;
    }
    if (!mod && (k === "c" || k === "C")) { this.setMode("control"); return; }
    if (mod) {
      const lk = k.toLowerCase();
      const map: Record<string, () => void> = {
        z: () => (e.shiftKey ? this.redo() : this.undo()), y: () => this.redo(),
        c: () => this.copy(), x: () => this.copy(true), v: () => this.paste(), a: () => this.selectAll(),
        s: () => this.save(e.shiftKey), o: () => this.openFile(), n: () => this.newFile(), d: () => { this.copy(); this.paste(); },
      };
      if (map[lk]) { e.preventDefault(); map[lk](); }
      return;
    }
    if (this.mode3d) { if (k === "Escape" || k === "3") this.toggle3d(false); return; }
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat && this.last && this.anchor) { this.repeatLast(); return; }
      this.spaceDown = true;
      return;
    }
    switch (k) {
      case "Escape":
        if (this.flex) { this.cancelFlex(); return; }
        if (this.boardDraft) { this.boardDraft = null; this.render(); return; }
        if (this.measure) { this.measure = null; this.render(); return; }
        if (this.tool !== "select") { this.setTool("select"); return; }
        this.sel.clear(); this.last = null; this.heightSel = null; this.refresh(); return;
      case "Enter":
        if (this.tool === "flex") this.finishFlex();
        if (this.tool === "board") this.finishBoard();
        return;
      case "Backspace":
        if (this.flex?.segs.length) { this.flex.segs.pop(); this.render(); this.renderInspector(); e.preventDefault(); return; }
        if (this.boardDraft?.length) { this.boardDraft.pop(); this.render(); e.preventDefault(); return; }
        this.deleteSelection(); return;
      case "Delete": this.deleteSelection(); return;
      case "Tab":
        if (this.last) { e.preventDefault(); this.adjustLast("nextEnd"); }
        return;
      case "f": case "F": this.flipSelection(); return;
      case "r": this.rotateSelection(-15); return;
      case "R": this.rotateSelection(15); return;
      case "v": case "V": this.setTool("select"); return;
      case "g": case "G": this.setTool("flex"); return;
      case "s": case "S": this.setTool("start"); return;
      case "b": case "B": this.setTool("board"); return;
      case "m": case "M": this.setTool("measure"); return;
      case "h": case "H": this.toggleHeights(); return;
      case "l": case "L": this.cycleLabels(); return;
      case "3": this.toggle3d(true); return;
      case "Home": case "0": this.zoomFit(); return;
      case "+": case "=": this.zoomAt(1.25); return;
      case "-": case "_": this.zoomAt(0.8); return;
      case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight": {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        if (this.heightSel && (k === "ArrowUp" || k === "ArrowDown")) { this.changeHeight(k === "ArrowUp" ? step : -step); return; }
        const dx = k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0, dy = k === "ArrowUp" ? step : k === "ArrowDown" ? -step : 0;
        this.nudge(dx, dy);
        return;
      }
    }
  }

  // ---------- heights / labels / 3D ----------

  toggleHeights() { this.heights = !this.heights; if (!this.heights) this.heightSel = null; this.refresh(); }
  cycleLabels() {
    const order: LabelMode[] = ["none", "number", "name", "gradient"];
    this.labels = order[(order.indexOf(this.labels) + 1) % order.length];
    toast(`Track labels: ${{ none: "off", number: "part numbers", name: "part names", gradient: "gradients" }[this.labels]}`);
    this.refresh();
  }

  heightAtSel(): number {
    const s = this.heightSel;
    if (!s) return 0;
    const e = this.an.ends.find((x) => dist(x, s) < 0.6);
    return e?.z ?? 0;
  }

  changeHeight(delta: number) { this.setHeight(this.heightAtSel() + delta); }
  setHeight(z: number) {
    if (!this.heightSel) return;
    setHeightAt(this.p, this.heightSel, Math.max(0, z));
    this.commit();
  }

  async toggle3d(on: boolean) {
    this.mode3d = on;
    this.el.view3d.hidden = !on;
    this.root.classList.toggle("is-3d", on);
    if (on) {
      try {
        if (!this.view3d) {
          this.view3d = new View3D(this.el.canvas3d as HTMLCanvasElement);
        }
        this.view3d.setBackground(this.pal.plot);
        this.view3d.setProject(this.p, true);
      } catch (err) {
        this.mode3d = false; this.el.view3d.hidden = true; this.root.classList.remove("is-3d");
        toast(String((err as Error).message ?? err), "error");
      }
    } else this.canvas.focus();
    this.renderToolbarState();
  }

  // ---------- files ----------

  async newFile() {
    if (this.dirty && this.p.items.length && !(await confirmDialog("Start a new layout?", `Changes to “${this.p.name}” that you haven't saved to a file will be lost.`, "Discard and start new", true))) return;
    const name = h("input", { id: "new-name", type: "text", value: "My layout" }) as HTMLInputElement;
    const w = numInput("new-w", 2400, { min: 100 }), d = numInput("new-d", 1200, { min: 100 });
    const kind = h("select", { id: "new-kind" },
      h("option", { value: "rect" }, "A plain rectangle"),
      ...MODULE_FAMILIES.map((fam) => h("optgroup", { label: fam }, ...MODULES.filter((m) => m.family === fam).map((m) => h("option", { value: m.id }, m.name)))),
      h("option", { value: "none" }, "No baseboard yet")) as HTMLSelectElement;
    const count = numInput("new-count", 2, { min: 1, max: 20, step: 1 });
    const tracks = h("select", { id: "new-tracks" }, ...[0, 1, 2, 3, 4].map((k) => h("option", { value: String(k), selected: k === this.defaultTracks }, k === 0 ? "None" : String(k)))) as HTMLSelectElement;
    const rectRow = h("div", { class: "row2" }, field("Width (mm)", w), field("Depth (mm)", d));
    const modRow = h("div", { class: "row2" }, field("How many, joined in a row", count), field("Tracks across each", tracks));
    const sync = () => { rectRow.hidden = kind.value !== "rect"; modRow.hidden = !getModule(kind.value); };
    kind.addEventListener("change", sync);
    sync();
    dialog("New layout", h("div", { class: "form-grid" },
      field("Layout name", name),
      field("Baseboard", kind),
      rectRow, modRow,
      h("p", { class: "muted" }, "You can add or change baseboards later from the Baseboards list.")), [
      { label: "Cancel" },
      { label: "Create layout", primary: true, onClick: () => {
        const p = newProject(name.value.trim() || "My layout");
        const W = +w.value, D = +d.value;
        if (kind.value === "rect" && W > 0 && D > 0) addRectBoard(p, 0, 0, W, D, "Baseboard");
        if (getModule(kind.value)) {
          this.defaultTracks = +tracks.value;
          const spacing = getLibrary(this.trackLibId())?.trackSpacing ?? DEFAULT_SPACING;
          for (let i = 0; i < Math.max(1, Math.min(20, Math.round(+count.value))); i++) {
            const b = appendModule(p, kind.value);
            b.module!.tracks = this.defaultTracks; b.module!.spacing = spacing;
          }
        }
        this.replaceProject(p);
        this.anchor = null;
        toast("New layout ready. Press S and click to place a start point, then pick track.");
      } },
    ]);
  }

  async openFile() {
    if (this.dirty && this.p.items.length && !(await confirmDialog("Open another layout?", `Changes to “${this.p.name}” that you haven't saved to a file will be lost.`, "Discard and open", true))) return;
    try {
      const f = await openText(LAYOUT_FILTER);
      if (!f) return;
      const p = parseProject(f.text);
      this.replaceProject(p, f.name, f.path);
      toast(`Opened ${f.name}.`);
    } catch (err) {
      toast(err instanceof FileError ? err.message : `Couldn't open the file: ${(err as Error).message}`, "error");
    }
  }

  showHostedNotice() {
    dialog("Saving files isn't available here", h("div", {},
      h("p", {}, "This web version can't download files. Your plan is kept in this browser automatically, so it will be here next time."),
      h("p", {}, "To save .railplot files, export pictures and print parts lists, use the Railplot desktop app or the offline HTML file from the project's GitHub page."),
      h("p", { class: "muted" }, "You can copy the layout as text and paste it into a file named something.railplot, then open it in the desktop app.")), [
      { label: "Copy layout as text", onClick: async () => {
        try { await navigator.clipboard.writeText(serialize(this.p)); toast("Layout copied as text."); } catch { toast("Copy isn't available here either.", "error"); }
        return true;
      } },
      { label: "OK", primary: true },
    ]);
  }

  async save(as = false) {
    if (isHosted()) {
      const base = `${this.p.name.replace(/[\\/:*?"<>|]+/g, "").trim() || "layout"}.railplot.json`;
      try {
        const r = await hostedSave(base, new Blob([serialize(this.p)], { type: "application/json" }));
        if (r === "unavailable") { this.showHostedNotice(); return; }
        if (!r) return;
        this.fileName = r.name; this.dirty = false; this.scheduleAutosave(); this.refresh();
        toast(`Saved ${r.name}. Rename it to .railplot to double-click it into the desktop app.`);
      } catch (err) { toast((err as Error).message, "error"); }
      return;
    }
    const name = this.fileName || `${this.p.name.replace(/[\\/:*?"<>|]+/g, "").trim() || "layout"}.railplot`;
    if (!as) await this.pollFileProposals();
    try {
      const r = await saveText(name, serialize(this.p), LAYOUT_FILTER, this.filePath, as || !this.filePath);
      if (!r) return;
      this.fileName = r.name; this.filePath = r.path ?? this.filePath; this.dirty = false;
      this.scheduleAutosave();
      this.refresh();
      toast(`Saved ${r.name}.`);
    } catch (err) { toast(`Couldn't save: ${(err as Error).message}`, "error"); }
  }

  async exportPng() {
    const b = projectBounds(this.p);
    if (!b) { toast("Nothing to export yet."); return; }
    const pad = 40;
    const W = b.maxX - b.minX + pad * 2, H = b.maxY - b.minY + pad * 2;
    const s = Math.min(4, 6000 / Math.max(W, H));
    const c = document.createElement("canvas");
    c.width = Math.round(W * s); c.height = Math.round(H * s);
    const ctx = c.getContext("2d")!;
    const pal = printPalette();
    drawProject(ctx, { s, ox: (pad - b.minX) * s, oy: (b.maxY + pad) * s }, c.width, c.height, this.p, {
      selection: new Set(), anchor: null, hoverEnd: null, heights: false, heightSel: null, labels: this.labels,
      gridStep: this.p.gridStep, showGrid: false, analysis: { ends: [], partner: new Map(), free: [], bad: [] }, tracksGuides: false,
    }, pal);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    if (!blob) { toast("Couldn't render the image.", "error"); return; }
    await saveBlob(`${this.p.name}.png`, blob, { name: "PNG image", extensions: ["png"], mime: "image/png" });
  }

  async exportSvg() {
    const b = projectBounds(this.p);
    if (!b) { toast("Nothing to export yet."); return; }
    const svg = projectToSvg(this.p, printPalette(), b);
    await saveBlob(`${this.p.name}.svg`, new Blob([svg], { type: "image/svg+xml" }), { name: "SVG drawing (true scale)", extensions: ["svg"], mime: "image/svg+xml" });
    toast("SVG saved at true scale: 1 mm on paper = 1 mm on the layout.");
  }

  // ---------- dialogs ----------

  showPartsList() {
    let visibleOnly = false, byLayer = false;
    const table = h("div", { class: "table-wrap" });
    const fill = () => {
      clear(table);
      const rows = partsList(this.p, { visibleOnly, byLayer });
      if (!rows.length) { table.append(h("p", { class: "muted" }, "No track on the layout yet.")); return; }
      const t = h("table", { class: "parts" },
        h("thead", {}, h("tr", {}, ...(byLayer ? [h("th", {}, "Layer")] : []), h("th", {}, "Part"), h("th", {}, "Name"), h("th", { class: "num" }, "Qty"))),
        h("tbody", {}, ...rows.map((r) => h("tr", {},
          ...(byLayer ? [h("td", {}, r.layer ?? "")] : []),
          h("td", { class: "mono" }, r.id),
          h("td", {}, r.name, h("span", { class: "muted small" }, ` · ${r.producer}`), r.length ? h("span", { class: "muted small" }, ` · ${fmtLen(r.length, this.p.units)} in total`) : null),
          h("td", { class: "num" }, String(r.count))))));
      table.append(t);
    };
    fill();
    const opts = h("div", { class: "row-opts" },
      h("label", { class: "check" }, h("input", { id: "pl-visible", type: "checkbox", onchange: (e: Event) => { visibleOnly = (e.target as HTMLInputElement).checked; fill(); } }), "Only visible layers"),
      h("label", { class: "check" }, h("input", { id: "pl-layer", type: "checkbox", onchange: (e: Event) => { byLayer = (e.target as HTMLInputElement).checked; fill(); } }), "Group by layer"));
    dialog("Parts list", h("div", {}, h("p", { class: "muted" }, "Flexible track is rounded up to whole lengths."), opts, table), [
      { label: "Copy as CSV", onClick: async () => {
        const csv = partsCsv(partsList(this.p, { visibleOnly, byLayer }));
        try { await navigator.clipboard.writeText(csv); toast("Parts list copied."); } catch { toast("Copy isn't available here. Use Save CSV instead.", "error"); }
        return true;
      } },
      { label: "Save CSV", onClick: async () => {
        await saveBlob(`${this.p.name} parts.csv`, new Blob([partsCsv(partsList(this.p, { visibleOnly, byLayer }))], { type: "text/csv" }), { name: "CSV", extensions: ["csv"], mime: "text/csv" });
        return true;
      } },
      { label: "Done", primary: true },
    ], { wide: true });
  }

  showRectBoard() {
    const x = numInput("rb-x", 0), y = numInput("rb-y", 0), w = numInput("rb-w", 2400, { min: 10 }), d = numInput("rb-d", 1200, { min: 10 });
    dialog("Add rectangular baseboard", h("div", { class: "form-grid" },
      h("div", { class: "row2" }, field("Width (mm)", w), field("Depth (mm)", d)),
      h("div", { class: "row2" }, field("Left edge X (mm)", x), field("Front edge Y (mm)", y))), [
      { label: "Cancel" },
      { label: "Add baseboard", primary: true, onClick: () => {
        if (+w.value <= 0 || +d.value <= 0) { toast("Width and depth must be more than 0.", "error"); return true; }
        const b = addRectBoard(this.p, +x.value, +y.value, +w.value, +d.value);
        this.sel = new Set([b.id]);
        this.commit(); this.zoomFit();
      } },
    ]);
  }

  showRotate() {
    if (!this.sel.size) { toast("Select something to rotate first."); return; }
    const a = numInput("rot-a", 15);
    dialog("Rotate selection", h("div", { class: "form-grid" }, field("Angle (degrees)", a, "Positive turns anticlockwise.")), [
      { label: "Cancel" },
      { label: "Rotate", primary: true, onClick: () => this.rotateSelection(+a.value) },
    ]);
  }

  showRaise() {
    if (!this.sel.size) { toast("Select track to raise or lower first."); return; }
    const a = numInput("raise-a", 10);
    dialog("Raise or lower selection", h("div", { class: "form-grid" }, field("Change in height (mm)", a, "Use a negative number to lower. Heights stop at the baseboard."), h("p", { class: "muted" }, "Gradients inside the selection stay the same.")), [
      { label: "Cancel" },
      { label: "Apply", primary: true, onClick: () => { shiftHeights(this.p, this.sel, +a.value); this.commit(); } },
    ]);
  }

  showPrefs() {
    const name = h("input", { id: "pref-name", type: "text", value: this.p.name }) as HTMLInputElement;
    const units = h("select", { id: "pref-units" }, h("option", { value: "mm" }, "Millimetres"), h("option", { value: "in" }, "Inches")) as HTMLSelectElement;
    units.value = this.p.units;
    const grid = numInput("pref-grid", this.p.gridStep, { min: 1 });
    const theme = h("select", { id: "pref-theme" }, h("option", { value: "system" }, "Match system"), h("option", { value: "light" }, "Light"), h("option", { value: "dark" }, "Dark")) as HTMLSelectElement;
    theme.value = this.theme;
    const showGrid = h("input", { id: "pref-showgrid", type: "checkbox" }) as HTMLInputElement;
    showGrid.checked = this.showGrid;
    dialog("Layout and app settings", h("div", { class: "form-grid" },
      h("h3", {}, "This layout"),
      field("Layout name", name),
      h("div", { class: "row2" }, field("Show lengths in", units), field("Grid step (mm)", grid)),
      h("h3", {}, "Railplot"),
      h("div", { class: "row2" }, field("Theme", theme), h("label", { class: "check" }, showGrid, "Show grid"))), [
      { label: "Cancel" },
      { label: "Save settings", primary: true, onClick: () => {
        this.p.name = name.value.trim() || this.p.name;
        this.p.units = units.value as "mm" | "in";
        this.p.gridStep = Math.max(1, +grid.value || 50);
        this.theme = theme.value as typeof this.theme;
        this.showGrid = showGrid.checked;
        this.applyTheme(); this.savePrefs();
        requestAnimationFrame(() => this.onThemeChange());
        this.commit();
      } },
    ]);
  }

  showShortcuts() {
    const rows: [string, string][] = [
      ["Space", "Add the same piece again"], ["F", "Flip the new piece or selection (left/right)"], ["Tab", "Join the new piece by its next end"],
      ["V", "Select tool"], ["G", "Flexible track tool"], ["S", "Start point tool"], ["B", "Draw baseboard"], ["M", "Measure"],
      ["H", "Track heights and gradients"], ["L", "Cycle track labels"], ["3", "3D view"], ["R / Shift+R", "Rotate selection 15° clockwise / anticlockwise"],
      ["Arrows", "Nudge 1 mm (Shift: 10 mm), or change a selected height"], ["Del", "Delete selection"], ["Enter", "Finish flex track or baseboard"],
      ["Esc", "Cancel, then back to Select"], ["Home", "Zoom to fit"], ["Wheel / right-drag", "Zoom / pan"],
      ["Ctrl+Z / Ctrl+Y", "Undo / redo"], ["Ctrl+C, X, V, D", "Copy, cut, paste, duplicate"], ["Ctrl+S / Ctrl+Shift+S", "Save / save as"],
    ];
    dialog("Keyboard shortcuts", h("table", { class: "keys" }, h("tbody", {}, ...rows.map(([k, d]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, d))))), [{ label: "Close", primary: true }], { wide: true });
  }

  showAbout() {
    dialog("About Railplot", h("div", { class: "about" },
      h("p", {}, h("strong", {}, `Railplot ${VERSION}`), " is a free, open-source track planner for OO and H0 model railways."),
      h("p", {}, "Track geometry comes from manufacturers' published dimensions. Each library lists its sources, and you can add your own track system as a JSON file."),
      h("p", { class: "muted" }, "Libraries in this version: ", LIBRARIES.map((l) => l.name).join(", "), "."),
      h("p", { class: "muted" }, isDesktop() ? "Running as the desktop app." : "Running in a browser. Your layout is kept in this browser until you save it to a file.")),
      [{ label: "Close", primary: true }]);
  }

  showClaudeHelp() {
    const pre = (t: string) => h("pre", { class: "code-block" }, t);
    dialog("Connect Claude", h("div", { class: "about" },
      h("p", {}, "With the Railplot connector, Claude (in the Claude desktop app, or Claude Code) can read your plan, check it and suggest changes. Each suggestion appears under ", h("strong", {}, "Claude's proposals"), " in the Details panel: ", h("strong", {}, "Show"), " draws it on the plan, ", h("strong", {}, "Accept"), " applies it (Undo takes it back) and ", h("strong", {}, "Reject"), " throws it away. Claude never changes the plan by itself."),
      h("p", {}, h("strong", {}, "Install: "), "download ", h("span", { class: "mono" }, "railplot-claude-windows.mcpb"), " (or the Mac one) from the Releases page and double-click it. The Claude desktop app asks you to confirm, then shows its settings: the hub's address and the folders your .railplot files are in."),
      h("p", {}, h("strong", {}, "Or by hand: "), "the connector is part of the hub program. Add this to Claude's settings (", h("span", { class: "mono" }, "claude_desktop_config.json"), "), with the path to your copy:"),
      pre(`{ "mcpServers": { "railplot": {\n  "command": "C:\\\\Railplot\\\\railplot-hub-windows-x64.exe",\n  "args": ["mcp", "--hub", "localhost:8080"]\n} } }`),
      h("p", {}, "For Claude Code: ", h("span", { class: "mono" }, "claude mcp add railplot -- /path/to/railplot-hub mcp")),
      h("p", {}, h("strong", {}, "Live or by file. "), "With the hub running and this window connected to it (Control › Set up › Railplot hub), proposals arrive straight away. Without the hub, Claude works on a saved .railplot file: the desktop app picks up proposals written into the file you have open; in a browser, open the file again to see them."),
      h("p", { class: "muted" }, "Running trains is separate and off unless you turn on “Let Claude use the controls” under Control › Set up › Railplot hub. Claude can then set routes, points, signals and lights, drive trains and run automations, but never switch track power on or off.")),
      [{ label: "Close", primary: true }]);
  }

  async loadSample() {
    if (this.dirty && this.p.items.length && !(await confirmDialog("Open the sample layout?", `Changes to “${this.p.name}” that you haven't saved to a file will be lost.`, "Discard and open sample", true))) return;
    this.replaceProject(buildSample());
  }

  /** Ready-to-open shunting layouts on the baseboard modules, in the chosen track system. */
  showExamples() {
    const lib = h("select", { id: "example-lib" }, ...LIBRARIES.filter((l) => yardParts(l.id)).map((l) => h("option", { value: l.id, selected: l.id === this.trackLibId() }, l.name))) as HTMLSelectElement;
    let chosen = EXAMPLES[0].id;
    const list = h("div", { class: "example-list", role: "radiogroup", "aria-label": "Example layouts" });
    const draw = () => {
      clear(list);
      for (const ex of EXAMPLES) {
        const pic = h("span", { class: "example-pic" });
        const sizes = h("span", { class: "muted small" }, ex.boards);
        // working out each plan takes a moment: draw the cards first, then the pictures
        setTimeout(() => {
          try {
            const p = buildExample(ex.id, lib.value);
            pic.innerHTML = layoutSvg(p, 300, 150);
            const extra = p.boards.length - ex.baseBoards;
            if (extra > 0) sizes.textContent = `${ex.boards}, plus ${extra} more 1200 mm board${extra === 1 ? "" : "s"} for ${getLibrary(lib.value)!.name}'s longer points`;
          } catch { /* shown without a picture */ }
        }, 0);
        const card = h("button", { type: "button", class: `example-card ${ex.id === chosen ? "on" : ""}`, role: "radio", "aria-checked": String(ex.id === chosen), "data-example": ex.id,
          onclick: () => { chosen = ex.id; draw(); } },
          pic,
          h("strong", {}, ex.name),
          sizes,
          h("span", { class: "small" }, ex.blurb));
        list.append(card);
      }
    };
    lib.addEventListener("change", draw);
    draw();
    dialog("Example shunting layouts", h("div", { class: "form-grid" },
      h("p", { class: "muted" }, "Complete plans on the laser-cut baseboard modules, built with the ready-made yards. Open one as a starting point: move things about, add buildings, or set it up for control."),
      field("Track system", lib, "PIKO A-Gleis's longer points need an extra board here and there; the plan grows to fit."),
      list), [
      { label: "Cancel" },
      { label: "Open", primary: true, onClick: async () => {
        if (this.dirty && this.p.items.length && !(await confirmDialog("Open the example?", `Changes to “${this.p.name}” that you haven't saved to a file will be lost.`, "Discard and open example", true))) return true;
        this.replaceProject(buildExample(chosen, lib.value));
        toast("Example opened. Its boards, track and parts list are all yours to change.");
      } },
    ], { wide: true });
  }

  async openControlDemo() {
    if (this.dirty && this.p.items.length && !(await confirmDialog("Open the two-train demo?", `Changes to “${this.p.name}” that you haven't saved to a file will be lost.`, "Discard and open demo", true))) return;
    this.replaceProject(buildControlDemo());
    this.setMode("control");
    toast("Demo ready: the Express runs round the oval; throw both points to let the Goods train out of the loop.");
  }

  private openContextMenu(e: MouseEvent) {
    const w = toWorldPt(this.view, this.screenPos(e));
    const it = hitItem(this.p, w, 6 / this.view.s);
    const b = it ? null : boardAt(this.p, w);
    const id = it?.id ?? b?.id;
    if (id && !this.sel.has(id)) { this.sel = new Set([id]); this.refresh(); }
    const m = this.el.ctx;
    clear(m);
    const item = (label: string, fn: () => void, disabled = false, kbd = "") =>
      h("button", { class: "menu-item", role: "menuitem", disabled, onclick: () => { m.hidden = true; fn(); } }, h("span", {}, label), kbd ? h("kbd", {}, kbd) : null);
    const has = this.sel.size > 0;
    m.append(
      item("Rotate 15° anticlockwise", () => this.rotateSelection(15), !has, "Shift+R"),
      item("Rotate 15° clockwise", () => this.rotateSelection(-15), !has, "R"),
      item("Flip", () => this.flipSelection(), !has, "F"),
      item("Duplicate", () => { this.copy(); this.paste(); }, !has, "Ctrl+D"),
      item("Raise or lower…", () => this.showRaise(), !has),
      h("div", { class: "menu-sep" }),
      ...this.p.layers.filter((l) => l.id !== (it?.layer ?? "")).map((l) => item(`Move to “${l.name}”`, () => {
        for (const x of itemsById(this.p, this.sel)) x.layer = l.id;
        this.commit();
      }, !has)),
      h("div", { class: "menu-sep" }),
      item("Delete", () => this.deleteSelection(), !has, "Del"),
    );
    const r = this.el.workspace.getBoundingClientRect();
    m.hidden = false;
    const mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = `${Math.min(e.clientX - r.left, r.width - mw - 8)}px`;
    m.style.top = `${Math.min(e.clientY - r.top, r.height - mh - 8)}px`;
  }

  // ---------- shell ----------

  private menus: { label: string; items: ({ label: string; kbd?: string; run: () => void; check?: () => boolean } | "-")[] }[] = [
    { label: "File", items: [
      { label: "New layout…", kbd: "Ctrl+N", run: () => this.newFile() },
      { label: "Open…", kbd: "Ctrl+O", run: () => this.openFile() },
      { label: "Save", kbd: "Ctrl+S", run: () => this.save() },
      { label: "Save as…", kbd: "Ctrl+Shift+S", run: () => this.save(true) },
      "-",
      { label: "Export image (PNG)…", run: () => this.exportPng() },
      { label: "Export true-scale drawing (SVG)…", run: () => this.exportSvg() },
      { label: "Parts list…", run: () => this.showPartsList() },
      "-",
      { label: "Open the sample layout", run: () => this.loadSample() },
      { label: "Example shunting layouts…", run: () => this.showExamples() },
      { label: "Open the two-train control demo", run: () => this.openControlDemo() },
      { label: "Settings…", run: () => this.showPrefs() },
    ] },
    { label: "Edit", items: [
      { label: "Undo", kbd: "Ctrl+Z", run: () => this.undo() },
      { label: "Redo", kbd: "Ctrl+Y", run: () => this.redo() },
      "-",
      { label: "Cut", kbd: "Ctrl+X", run: () => this.copy(true) },
      { label: "Copy", kbd: "Ctrl+C", run: () => this.copy() },
      { label: "Paste", kbd: "Ctrl+V", run: () => this.paste() },
      { label: "Delete", kbd: "Del", run: () => this.deleteSelection() },
      { label: "Select all track", kbd: "Ctrl+A", run: () => this.selectAll() },
      "-",
      { label: "Rotate…", run: () => this.showRotate() },
      { label: "Flip", kbd: "F", run: () => this.flipSelection() },
      { label: "Raise or lower…", run: () => this.showRaise() },
    ] },
    { label: "View", items: [
      { label: "Zoom to fit", kbd: "Home", run: () => this.zoomFit() },
      { label: "Zoom in", kbd: "+", run: () => this.zoomAt(1.25) },
      { label: "Zoom out", kbd: "−", run: () => this.zoomAt(0.8) },
      "-",
      { label: "Track heights and gradients", kbd: "H", run: () => this.toggleHeights(), check: () => this.heights },
      { label: "Cycle track labels", kbd: "L", run: () => this.cycleLabels() },
      { label: "Grid", run: () => { this.showGrid = !this.showGrid; this.savePrefs(); this.render(); }, check: () => this.showGrid },
      { label: "Baseboard frames and openings", run: () => { this.showStructure = !this.showStructure; this.render(); }, check: () => this.showStructure },
      { label: "Track positions on modules", run: () => { this.showTrackGuides = !this.showTrackGuides; this.render(); }, check: () => this.showTrackGuides },
      "-",
      { label: "3D view", kbd: "3", run: () => this.toggle3d(true) },
    ] },
    { label: "Tools", items: [
      { label: "Select", kbd: "V", run: () => this.setTool("select") },
      { label: "Flexible track", kbd: "G", run: () => this.setTool("flex") },
      { label: "Start point", kbd: "S", run: () => this.setTool("start") },
      { label: "Measure", kbd: "M", run: () => this.setTool("measure") },
      "-",
      { label: "Draw baseboard", kbd: "B", run: () => this.setTool("board") },
      { label: "Rectangular baseboard…", run: () => this.showRectBoard() },
      { label: "Baseboard modules…", run: () => { this.renderBoardLibrary(); this.root.classList.add("show-lib"); } },
      "-",
      { label: "New layer", run: () => { addLayer(this.p); this.commit(); } },
    ] },
    { label: "Help", items: [
      { label: "Keyboard shortcuts", run: () => this.showShortcuts() },
      { label: "Chat with Claude", run: () => this.chat.toggle(true) },
      { label: "Connect Claude…", run: () => this.showClaudeHelp() },
      { label: "About Railplot", run: () => this.showAbout() },
    ] },
  ];

  private closeMenus() {
    this.root.querySelectorAll(".menubar > .menu-root.open").forEach((m) => m.classList.remove("open"));
  }

  private buildShell() {
    const r = this.root;
    r.className = "app";
    const menubar = h("nav", { class: "menubar", "aria-label": "Main menu" });
    for (const m of this.menus) {
      const panel = h("div", { class: "menu", role: "menu" });
      const root = h("div", { class: "menu-root" },
        h("button", { class: "menu-label", type: "button", "aria-haspopup": "true", onclick: (e: Event) => {
          const open = root.classList.contains("open");
          this.closeMenus();
          if (!open) { this.fillMenu(panel, m.items); root.classList.add("open"); }
          e.stopPropagation();
        }, onmouseenter: () => {
          if (this.root.querySelector(".menubar > .menu-root.open") && !root.classList.contains("open")) {
            this.closeMenus(); this.fillMenu(panel, m.items); root.classList.add("open");
          }
        } }, m.label), panel);
      menubar.append(root);
    }
    const docName = h("span", { class: "doc-name" });
    const docState = h("span", { class: "doc-state" });
    const top = h("header", { class: "topbar" },
      h("div", { class: "brand", html: `<svg viewBox="0 0 28 28" width="22" height="22" aria-hidden="true"><path d="M4 22c8 0 6-16 20-16" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" opacity=".22"/><path d="M4 19.2c7.6 0 5.2-16 20-16M4 24.8c9.2 0 6.8-16 20-16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>Railplot</span>` }),
      menubar,
      h("div", { class: "doc" }, docName, docState));

    const tb = (id: string, ic: string, label: string, run: () => void, kbd?: string) =>
      h("button", { class: "tool-btn", id: `tb-${id}`, type: "button", title: kbd ? `${label} (${kbd})` : label, "aria-label": label, onclick: run, html: icon(ic) + `<span class="tool-txt">${label}</span>` });
    const sep = () => h("span", { class: "tb-sep", "aria-hidden": "true" });
    const toolbar = h("div", { class: "toolbar", role: "toolbar", "aria-label": "Tools" },
      tb("lib", "panel", "Track", () => this.root.classList.toggle("show-lib")),
      tb("new", "file", "New", () => this.newFile(), "Ctrl+N"),
      tb("open", "open", "Open", () => this.openFile(), "Ctrl+O"),
      tb("save", "save", "Save", () => this.save(), "Ctrl+S"),
      sep(),
      tb("undo", "undo", "Undo", () => this.undo(), "Ctrl+Z"),
      tb("redo", "redo", "Redo", () => this.redo(), "Ctrl+Y"),
      sep(),
      tb("select", "select", "Select", () => this.setTool("select"), "V"),
      tb("start", "start", "Start point", () => this.setTool("start"), "S"),
      tb("flex", "flex", "Flex track", () => this.setTool("flex"), "G"),
      tb("board", "board", "Baseboard", () => this.setTool("board"), "B"),
      tb("measure", "measure", "Measure", () => this.setTool("measure"), "M"),
      sep(),
      tb("heights", "heights", "Heights", () => this.toggleHeights(), "H"),
      tb("labels", "labels", "Labels", () => this.cycleLabels(), "L"),
      tb("fit", "fit", "Fit", () => this.zoomFit(), "Home"),
      sep(),
      tb("parts", "list", "Parts list", () => this.showPartsList()),
      tb("3d", "cube", "3D view", () => this.toggle3d(!this.mode3d), "3"),
      sep(),
      tb("control", "control", "Control", () => this.setMode("control"), "C"),
      tb("edit", "select", "Edit plan", () => this.setMode("design"), "C"),
      h("span", { class: "tb-grow" }),
      tb("claude", "spark", "Claude", () => this.chat.toggle()),
      tb("insp", "details", "Details", () => this.root.classList.toggle("show-insp")),
    );

    const libSelect = h("select", { id: "lib-select", "aria-label": "Track library", onchange: (e: Event) => { this.libId = (e.target as HTMLSelectElement).value; this.renderLibrary(); } });
    const scales = [...new Set(LIBRARIES.map((l) => l.scale))];
    for (const sc of scales) {
      const g = h("optgroup", { label: `${sc} scale` });
      for (const l of LIBRARIES.filter((x) => x.scale === sc)) g.append(h("option", { value: l.id }, l.name));
      libSelect.append(g);
    }
    libSelect.append(h("optgroup", { label: "Ready-made" }, h("option", { value: "@boards" }, "Baseboards and modules"), h("option", { value: "@yards" }, "Yards and shunting puzzles")));
    const search = h("input", { id: "lib-filter", type: "search", placeholder: "Filter by number or name", "aria-label": "Filter parts", oninput: (e: Event) => { this.filter = (e.target as HTMLInputElement).value; this.renderLibrary(); } });
    const lib = h("aside", { class: "library", "aria-label": "Track library" },
      h("div", { class: "lib-head" }, libSelect, search, h("p", { class: "lib-tip", id: "lib-tip" }, "Pick a part to join it at the arrow on the plan.")),
      h("div", { class: "lib-grid", id: "lib-grid" }),
      h("p", { class: "lib-src", id: "lib-src" }));

    this.canvas = h("canvas", { class: "plot", tabindex: "0", "aria-label": "Layout plan" }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d")!;
    const canvas3d = h("canvas", { class: "plot3d", "aria-label": "3D view of the layout" });
    const view3d = h("div", { class: "view3d", hidden: true },
      canvas3d,
      h("div", { class: "view3d-bar" },
        h("button", { class: "btn", type: "button", onclick: () => this.toggle3d(false), html: `${icon("close", 16)}<span>Back to plan</span>` }),
        h("button", { class: "btn", type: "button", onclick: () => this.view3d?.resetCamera(), html: `${icon("fit", 16)}<span>Reset view</span>` }),
        h("label", { class: "check" }, h("input", { id: "v3-supports", type: "checkbox", checked: true, onchange: (e: Event) => { if (this.view3d) { this.view3d.opts.supports = (e.target as HTMLInputElement).checked; this.view3d.rebuild(); } } }), "Supports"),
        h("label", { class: "check" }, h("input", { id: "v3-sleepers", type: "checkbox", checked: true, onchange: (e: Event) => { if (this.view3d) { this.view3d.opts.sleepers = (e.target as HTMLInputElement).checked; this.view3d.rebuild(); } } }), "Sleepers"),
        h("button", { class: "btn", type: "button", onclick: async () => {
          const b = await this.view3d?.snapshot();
          if (b) await saveBlob(`${this.p.name} 3D.png`, b, { name: "PNG image", extensions: ["png"], mime: "image/png" });
        }, html: `${icon("camera", 16)}<span>Save picture</span>` })),
      h("p", { class: "view3d-hint" }, "Drag to orbit · right-drag to pan · wheel to zoom · double-click to reset"));
    const placeBar = h("div", { class: "place-bar", hidden: true, role: "group", "aria-label": "New piece" });
    const emptyHint = h("div", { class: "empty-hint", hidden: true },
      h("h2", {}, "Start your plan"),
      h("p", {}, "Press ", h("kbd", {}, "S"), " and click to put down a start point, then pick track from the list on the left. Or draw a baseboard with ", h("kbd", {}, "B"), "."));
    const ctxMenu = h("div", { class: "menu ctxmenu", role: "menu", hidden: true });
    const zoom = h("div", { class: "zoom-ctl" },
      h("button", { class: "icon-btn", type: "button", "aria-label": "Zoom in", html: icon("zoomIn"), onclick: () => this.zoomAt(1.25) }),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Zoom out", html: icon("zoomOut"), onclick: () => this.zoomAt(0.8) }),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Zoom to fit", html: icon("fit"), onclick: () => this.zoomFit() }));
    const workspace = h("main", { class: "workspace" }, this.canvas, emptyHint, placeBar, zoom, ctxMenu, view3d);

    const inspector = h("aside", { class: "inspector", "aria-label": "Details" },
      h("section", { class: "insp-main", id: "insp-main" }),
      h("section", { class: "insp-props", id: "insp-props", hidden: true, "aria-label": "Claude's proposals" }),
      h("section", { class: "insp-layers" }, h("div", { class: "sec-head" }, h("h3", {}, "Layers"),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Add layer", title: "Add layer", html: icon("plus", 16), onclick: () => { addLayer(this.p); this.commit(); } })),
        h("ul", { class: "layers", id: "layers" })));

    const status = h("footer", { class: "statusbar" },
      h("span", { class: "st-hint", id: "st-hint" }),
      h("span", { class: "st-cell", id: "st-sel" }),
      h("span", { class: "st-cell mono", id: "st-xy" }),
      h("span", { class: "st-cell mono", id: "st-zoom" }));

    const scrimLib = h("div", { class: "drawer-scrim", onclick: () => this.root.classList.remove("show-lib", "show-insp") });
    r.append(top, toolbar, lib, workspace, inspector, status, scrimLib);
    Object.assign(this.el, {
      docName, docState, workspace, placeBar, chatBtn: toolbar.querySelector("#tb-claude")!, emptyHint, ctx: ctxMenu, view3d, canvas3d,
      libGrid: lib.querySelector("#lib-grid")!, libSelect, libSrc: lib.querySelector("#lib-src")!,
      insp: inspector.querySelector("#insp-main")!, props: inspector.querySelector("#insp-props")!, layers: inspector.querySelector("#layers")!,
      stHint: status.querySelector("#st-hint")!, stSel: status.querySelector("#st-sel")!, stXy: status.querySelector("#st-xy")!, stZoom: status.querySelector("#st-zoom")!,
    });
  }

  private fillMenu(panel: HTMLElement, items: (typeof this.menus)[number]["items"]) {
    clear(panel);
    for (const it of items) {
      if (it === "-") { panel.append(h("div", { class: "menu-sep" })); continue; }
      const checked = it.check?.();
      panel.append(h("button", { class: "menu-item", role: checked === undefined ? "menuitem" : "menuitemcheckbox", "aria-checked": checked === undefined ? undefined : String(checked), type: "button", onclick: () => { this.closeMenus(); it.run(); } },
        h("span", { class: "menu-check", html: checked ? icon("check", 14) : "" }), h("span", { class: "menu-text" }, it.label), it.kbd ? h("kbd", {}, it.kbd) : null));
    }
  }

  renderLibrary() {
    const tip = this.root.querySelector("#lib-tip");
    if (tip) tip.textContent = this.libId === "@boards" ? "Pick a module to add it after the selected one, or after the last module."
      : this.libId === "@yards" ? "Pick a yard to build it from the arrow on the plan (an open track end, a start point or a track position on a module)." : "Pick a part to join it at the arrow on the plan.";
    if (this.libId === "@boards") { this.renderBoardLibrary(); return; }
    if (this.libId === "@yards") { this.renderYardLibrary(); return; }
    if (getLibrary(this.libId)) this.lastTrackLib = this.libId;
    const lib = getLibrary(this.libId) ?? LIBRARIES[0];
    (this.el.libSelect as HTMLSelectElement).value = lib.id;
    const grid = this.el.libGrid;
    clear(grid);
    const f = this.filter.trim().toLowerCase();
    for (const d of lib.parts) {
      if (f && !`${d.id} ${d.name}`.toLowerCase().includes(f)) continue;
      const part = getPart(`${lib.id}/${d.id}`)!;
      const tile = h("button", {
        class: `part-tile ${d.type === "flex" ? "is-flex" : ""}`, type: "button", title: d.note ?? d.name,
        "data-part": `${lib.id}/${d.id}`,
        onclick: () => { this.root.classList.remove("show-lib"); this.placeFromLibrary(`${lib.id}/${d.id}`); },
      },
        h("span", { class: "part-thumb", html: partThumb(part) }),
        h("span", { class: "part-id" }, d.id, d.approximate ? h("span", { class: "approx", title: "Approximate geometry: check against a real piece" }, "≈") : null),
        h("span", { class: "part-name" }, d.name),
        h("span", { class: "part-geo" }, partGeometryLabel(d)));
      grid.append(tile);
    }
    if (!grid.childElementCount) grid.append(h("p", { class: "muted" }, "No parts match that filter."));
    const src = this.el.libSrc;
    clear(src);
    src.append(`${lib.scale} · gauge ${lib.gauge} mm · geometry from `, ...lib.sources.flatMap((s, i) => [i ? ", " : "", h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.title)]));
  }

  private renderYardLibrary() {
    (this.el.libSelect as HTMLSelectElement).value = "@yards";
    const grid = this.el.libGrid;
    clear(grid);
    const libId = this.trackLibId();
    for (const y of YARD_TYPES) {
      grid.append(h("button", { class: "part-tile yard-tile", type: "button", "data-yard": y.kind, title: y.blurb,
        onclick: () => { this.root.classList.remove("show-lib"); this.yardDialog(y.kind); } },
        h("span", { class: "part-thumb", html: yardSvg(libId, { ...defaultYard(y.kind, libId) }, 96, 52, true) }),
        h("span", { class: "part-id" }, y.short),
        h("span", { class: "part-name" }, y.name),
        h("span", { class: "part-geo" }, y.geo)));
    }
    const src = this.el.libSrc;
    clear(src);
    const k = yardParts(libId);
    src.append(k ? `Built from ${getLibrary(libId)!.name}: ${partName(k.left)} and ${partName(k.right)} points, ${partName(k.curve) || "flexible"} curves and ${partName(k.flex)} flexible track for the roads.` : "This track system has no ordinary points to build yards from.");
  }

  yardDialog(kind: YardKind) {
    const t = YARD_TYPES.find((y) => y.kind === kind)!;
    const lib = h("select", { id: "yard-lib" }, ...LIBRARIES.filter((l) => yardParts(l.id)).map((l) => h("option", { value: l.id, selected: l.id === this.trackLibId() }, l.name))) as HTMLSelectElement;
    const d0 = defaultYard(kind, lib.value);
    const roads = numInput("yard-roads", d0.roads, { min: 2, max: 8, step: 1 });
    const side = h("select", { id: "yard-side" }, h("option", { value: "1" }, "On the left"), h("option", { value: "-1" }, "On the right")) as HTMLSelectElement;
    const length = numInput("yard-length", d0.length, { min: 200, max: 10000, step: 10 });
    const spacingMode = h("select", { id: "yard-spacing-mode" }, h("option", { value: "natural" }, "As the points give it"), h("option", { value: "exact" }, "Exactly")) as HTMLSelectElement;
    const spacing = numInput("yard-spacing", getLibrary(lib.value)?.trackSpacing ?? 67, { min: 40, max: 200, step: 0.5 });
    const wagon = numInput("yard-wagon", d0.wagon, { min: 40, max: 200, step: 1 });
    const headshunt = numInput("yard-headshunt", d0.headshunt, { min: 0, max: 2000, step: 10 });
    const preview = h("div", { class: "yard-preview", "aria-hidden": "true" });
    const info = h("p", { class: "muted small" });
    const opts = (): YardOptions => ({
      kind, roads: Math.max(2, Math.min(8, Math.round(+roads.value || 2))), side: +side.value as 1 | -1,
      length: Math.max(100, +length.value || d0.length), wagon: Math.max(40, +wagon.value || d0.wagon), headshunt: kind === "inglenook" ? 0 : Math.max(0, +headshunt.value || 0),
      spacing: spacingMode.value === "exact" ? Math.max(40, +spacing.value || 67) : undefined,
    });
    const update = () => {
      const o = opts(), k = yardParts(lib.value)!;
      if (spacing.parentElement) spacing.parentElement.hidden = spacingMode.value !== "exact";
      const min = kind === "inglenook" ? 0 : minYardLength(o, lib.value);
      preview.innerHTML = yardSvg(lib.value, o, 520, 150);
      const gaps = roadSpacings(k, o.kind === "inglenook" ? 3 : o.kind === "runround" ? 2 : o.roads, o.spacing).map((g) => `${Math.round(g * 10) / 10}`);
      info.textContent = `${partName(k.left)} / ${partName(k.right)} points, ${partName(k.curve) || "flexible track"} to turn the last road, ${partName(k.flex)} for the roads. Roads ${[...new Set(gaps)].join(" and ")} mm apart.`
        + (min ? ` Shortest length for this: ${min} mm.` : "") + (min && o.length < min ? " It is shorter than that now: some roads won't fit." : "");
    };
    for (const el of [lib, roads, side, length, spacingMode, spacing, wagon, headshunt]) { el.addEventListener("input", update); el.addEventListener("change", update); }
    lib.addEventListener("change", () => { spacing.value = String(getLibrary(lib.value)?.trackSpacing ?? 67); if (kind !== "inglenook") length.value = String(Math.max(+length.value, minYardLength(opts(), lib.value))); update(); });
    roads.addEventListener("change", () => { length.value = String(Math.max(+length.value, minYardLength(opts(), lib.value))); update(); });
    const body = h("div", { class: "form-grid" },
      h("p", { class: "muted" }, t.blurb),
      preview,
      h("div", { class: "row2" }, field("Track system", lib), field("Roads go", side)),
      kind === "fiddle" || kind === "fiddle2" ? h("div", { class: "row2" }, field("Roads", roads), field("Overall length (mm)", length, kind === "fiddle2" ? "Toe to toe of the two ends" : "From the first point to the end of the roads")) : null,
      kind === "runround" ? h("div", { class: "row2" }, field("Loop length (mm)", length, "Toe to toe"), field("Headshunt at each end (mm)", headshunt)) : null,
      kind === "inglenook" ? h("div", { class: "row2" }, field("Wagon length (mm)", wagon, "Over buffers; the sidings take 5, 3 and 3"), h("span", {})) : null,
      kind === "inglenook" ? null : h("div", { class: "row2" }, field("Distance between roads", spacingMode), field("Spacing (mm)", spacing, "Short lengths of flexible track between the points")),
      info,
      h("p", { class: "muted small" }, "It is built from the arrow on the plan: an open track end, a start point (S) or a track position on a module. Without one, it goes below what is already on the plan."));
    update();
    dialog(t.name, body, [
      { label: "Cancel" },
      { label: "Build", primary: true, onClick: () => {
        // from the arrow; without one, below what is already on the plan rather than on top of it
        const pb = projectBounds(this.p);
        const at = this.anchor ? this.anchorPoseOrCentre() : pb ? { x: pb.minX, y: pb.minY - 300, h: 0, z: 0 } : this.anchorPoseOrCentre();
        const consumed = this.anchor?.kind === "start" ? this.anchor.id : null;
        try {
          const r = buildYard(this.p, lib.value, opts(), at);
          if (consumed) this.p.starts = this.p.starts.filter((x) => x.id !== consumed);
          this.sel = new Set(r.items.map((i) => i.id));
          this.anchor = null; this.last = null;
          this.commit();
          const rect = this.canvas.getBoundingClientRect();
          const tl = toWorldPt(this.view, { x: 0, y: 0 }), br = toWorldPt(this.view, { x: rect.width, y: rect.height });
          if (r.items.some((i) => { const b = geom(i).bounds; return b.minX < tl.x || b.maxX > br.x || b.maxY > tl.y || b.minY < br.y; })) this.zoomFit();
          toast([`${t.name} built: ${r.items.length} pieces.`, ...r.notes].join(" "), r.notes.some((n) => /short/.test(n)) ? "error" : "info");
        } catch (e) { toast((e as Error).message, "error"); return true; }
      } },
    ], { wide: true });
  }

  private renderBoardLibrary() {
    (this.el.libSelect as HTMLSelectElement).value = "@boards";
    const grid = this.el.libGrid;
    clear(grid);
    for (const fam of MODULE_FAMILIES) {
      grid.append(h("h4", { class: "lib-group" }, fam));
      for (const m of MODULES.filter((x) => x.family === fam)) {
        grid.append(h("button", { class: "part-tile board-tile", type: "button", "data-module": m.id, title: m.blurb,
          onclick: () => { this.root.classList.remove("show-lib"); this.addModuleFromUi(m.id); } },
          h("span", { class: "part-thumb", html: moduleThumb(m) }),
          h("span", { class: "part-id" }, m.size),
          h("span", { class: "part-name" }, shortModuleName(m)),
          h("span", { class: "part-geo" }, `${m.weightKg} kg · ${m.faces.length} faces`)));
      }
    }
    grid.append(
      h("button", { class: "part-tile", type: "button", onclick: () => { this.root.classList.remove("show-lib"); this.showRectBoard(); } },
        h("span", { class: "part-thumb", html: `<svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true"><rect x="4" y="16" width="48" height="24" class="th-board"/></svg>` }),
        h("span", { class: "part-id" }, "Rectangle"), h("span", { class: "part-name" }, "Plain baseboard of any size"), h("span", { class: "part-geo" }, "18 mm top")),
      h("button", { class: "part-tile", type: "button", onclick: () => { this.root.classList.remove("show-lib"); this.setTool("board"); } },
        h("span", { class: "part-thumb", html: `<svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true"><path d="M4 14h30v14h18v16H4z" class="th-board"/></svg>` }),
        h("span", { class: "part-id" }, "Any shape"), h("span", { class: "part-name" }, "Click the corners on the plan"), h("span", { class: "part-geo" }, "B")));
    const src = this.el.libSrc;
    clear(src);
    src.append("The laser-cut baseboard range: 4 mm birch ply torsion boxes, 100 mm tall. Modules join face to face (faces of the same width, so the dowels and bolts line up) and snap together when you drag them. A selected module gets the next one added after it.");
  }

  /** How many tracks cross the module, how far apart, and laying flexible track along the guides. */
  private trackPositionsPanel(boardId: string, m: ModulePreset): HTMLElement {
    const b = this.p.boards.find((x) => x.id === boardId)!;
    const pl = b.module!;
    const spacing = pl.spacing ?? DEFAULT_SPACING;
    const edge = edgeOf(m, pl);
    const n = tracksOf(m, pl), max = maxTracks(m, spacing, edge);
    const faceW = Math.min(...m.faces.map((f) => f.width));
    const set = (fn: () => void) => { fn(); this.commit(); };
    const seg = h("div", { class: "seg track-count", role: "group", "aria-label": "Tracks across" },
      ...[0, 1, 2, 3, 4].map((k) => h("button", { type: "button", id: `tracks-${k}`, class: n === k ? "on" : "", "aria-pressed": String(n === k), disabled: k > max,
        title: k > max ? (singleTrackOnly(m) ? "Moving decks take one track, on the centre line" : edge ? `${k} tracks between ${edge} mm from each edge would be closer than ${spacing} mm` : `${k} tracks don't fit across a ${faceW} mm face`) : "",
        onclick: () => set(() => { pl.tracks = k; pl.spacing = spacing; this.defaultTracks = k; }) }, String(k))));
    const sp = numInput("track-spacing", spacing, { min: 40, max: 120, step: 0.01 });
    sp.addEventListener("change", () => set(() => { pl.spacing = Math.max(40, Math.min(120, +sp.value || DEFAULT_SPACING)); }));
    // bunched at the spacing, or spread out to a distance from the edges
    const mode = h("select", { id: "track-mode", "aria-label": "Track placement", disabled: singleTrackOnly(m) },
      h("option", { value: "spread", selected: edge > 0 }, "Spread from the edges"),
      h("option", { value: "centre", selected: edge === 0 }, "Together at the spacing")) as HTMLSelectElement;
    mode.addEventListener("change", () => set(() => { pl.edge = mode.value === "spread" ? (defaultEdge(m) || Math.round(faceW / 3)) : 0; }));
    const ed = numInput("track-edge", edge || defaultEdge(m) || Math.round(faceW / 3), { min: 40, max: Math.floor(faceW / 2), step: 1 });
    ed.addEventListener("change", () => set(() => { pl.edge = Math.max(40, Math.min(faceW / 2, +ed.value || 200)); }));
    const lib = getLibrary(this.trackLibId());
    const guides = boardGuides(this.p, boardId);
    const flex = getPart(this.flexForTrack());
    const minR = flex?.def.minRadius ?? 0;
    const tight = guides.filter((g) => g.minRadius < minR - 0.01);
    // does the module next door have the same tracks?
    const all = allModuleEnds(this.p);
    const mismatch = all.filter((e) => e.board === boardId).some((e) => {
      const o = all.find((x) => x.board !== boardId && endsTouch(e, x));
      const ob = o && this.p.boards.find((x) => x.id === o.board);
      const om = ob?.module && getModule(ob.module.preset);
      if (!om) return false;
      // compare where the tracks actually are on the two touching faces
      const mine = trackPorts(this.p).filter((q) => q.board === boardId && dist(q, e) < e.width / 2 + 1);
      const theirs = trackPorts(this.p).filter((q) => q.board === ob!.id && dist(q, e) < e.width / 2 + 1);
      return mine.length !== theirs.length || mine.some((q) => !theirs.some((t) => dist(t, q) < 0.5));
    });
    const used = trackPorts(this.p).filter((q) => q.board === boardId && portUsed(this.p, q, this.an)).length;
    const kv = (k: string, v: string) => h("div", { class: "kv" }, h("span", { class: "k" }, k), h("span", { class: "v" }, v));
    return h("div", { class: "track-pos" },
      h("div", { class: "sub-head" }, "Track positions"),
      h("p", { class: "muted small" }, "Tracks cross every joining face at the same, centred positions, so they line up from module to module. Click a ring to build from it; track ends snap to them."),
      h("div", { class: "kv" }, h("span", { class: "k" }, "Tracks across"), seg),
      singleTrackOnly(m) ? null : field("Placement", mode),
      edge > 0 ? field("From the edge (mm)", ed, n > 1 ? `Outer tracks ${edge} mm in from each end of the ${faceW} mm face, ${Math.round(((faceW - 2 * edge) / (n - 1)) * 10) / 10} mm apart` : "One track goes in the middle") : null,
      field(edge > 0 ? "Closest spacing (mm)" : "Spacing (mm)", sp, lib?.trackSpacing ? `${lib.name}: ${lib.trackSpacing} mm between track centres` : undefined),
      guides.length ? kv("Guides", (() => { const r = Math.min(...guides.map((g) => g.minRadius)); return isFinite(r) ? `${guides.length}, tightest curve R${Math.round(r)}` : `${guides.length}, straight`; })()) : null,
      tight.length ? h("p", { class: "warn-note" }, `${tight.length === guides.length ? "The curves are" : `${tight.length} of the curves are`} tighter than ${flex?.def.name ?? "the flexible track"} allows (R${minR}).`) : null,
      mismatch ? h("p", { class: "warn-note" }, "A module next to this one has a different number or spacing of tracks, so they won't line up at the joint.") : null,
      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-sm", type: "button", id: "tracks-all", onclick: () => set(() => {
          for (const x of this.p.boards) if (x.module && getModule(x.module.preset)) { x.module.tracks = n; x.module.spacing = spacing; x.module.edge = pl.edge; }
          toast(`Every module now has ${n} track${n === 1 ? "" : "s"} across (fewer where they don't fit).`);
        }) }, "Use on every module"),
        guides.length ? h("button", { class: "btn btn-sm", type: "button", id: "lay-guides", onclick: () => {
          const r = layGuides(this.p, boardId, this.flexForTrack());
          if (r.laid.length) { this.sel = new Set(r.laid.map((i) => i.id)); this.commit(); }
          const bits = [r.laid.length ? `${r.laid.length} length${r.laid.length === 1 ? "" : "s"} of ${getPart(this.flexForTrack())?.def.id ?? "flexible track"} laid` : "Nothing laid"];
          if (r.already) bits.push(`${r.already} already had track`);
          if (r.tooTight) bits.push(`${r.tooTight} too tight a curve`);
          toast(`${bits.join("; ")}.`, r.laid.length ? "info" : "error");
        } }, "Lay flexible track on the guides") : null),
      used ? h("p", { class: "muted small" }, `${used} of the track positions have track at them.`) : null);
  }

  addModuleFromUi(id: string) {
    const sel = this.p.boards.find((b) => this.sel.has(b.id) && b.module);
    const b = appendModule(this.p, id, sel?.id);
    if (b.module!.tracks === undefined) { b.module!.tracks = this.defaultTracks; b.module!.spacing = getLibrary(this.trackLibId())?.trackSpacing ?? DEFAULT_SPACING; }
    this.sel = new Set([b.id]);
    this.last = null;
    this.commit();
    const r = this.canvas.getBoundingClientRect();
    const tl = toWorldPt(this.view, { x: 0, y: 0 }), br = toWorldPt(this.view, { x: r.width, y: r.height });
    if (b.pts.some((q) => q.x < tl.x || q.x > br.x || q.y > tl.y || q.y < br.y)) this.zoomFit();
    const m = getModule(id)!;
    toast(m.faces.length > 1 && sel ? `${b.name} added. "Join by its other face" in the panel turns it the other way.` : `${b.name} added. Drag it onto another module's face to join them.`);
  }

  private renderToolbarState() {
    const on = (id: string, v: boolean) => this.root.querySelector(`#tb-${id}`)?.classList.toggle("on", v);
    for (const t of ["select", "start", "flex", "board", "measure"]) on(t, this.tool === t);
    on("heights", this.heights);
    on("labels", this.labels !== "none");
    on("3d", this.mode3d);
    (this.root.querySelector("#tb-undo") as HTMLButtonElement).disabled = !this.hist.canUndo();
    (this.root.querySelector("#tb-redo") as HTMLButtonElement).disabled = !this.hist.canRedo();
  }

  private renderPlacementBar() {
    const bar = this.el.placeBar;
    const L = this.last;
    const it = L && this.p.items.find((i) => i.id === L.item);
    if (!L || !it || this.tool !== "select") { bar.hidden = true; return; }
    const part = getPart(L.part)!;
    clear(bar);
    append(bar, 
      h("span", { class: "pb-part" }, h("span", { class: "mono" }, part.def.id), ` ${part.def.name}`),
      h("button", { class: "btn btn-sm", type: "button", onclick: () => this.adjustLast("flip"), html: `${icon("flip", 16)}<span>${part.def.type === "curve" ? "Turn other way" : "Flip"}</span><kbd>F</kbd>` }),
      part.ends.length > 2 || part.def.type === "turnout" ? h("button", { class: "btn btn-sm", type: "button", onclick: () => this.adjustLast("nextEnd"), html: `${icon("swap", 16)}<span>Join by next end</span><kbd>Tab</kbd>` }) : null,
      h("button", { class: "btn btn-sm", type: "button", disabled: !this.anchor, onclick: () => this.repeatLast(), html: `${icon("repeat", 16)}<span>Add another</span><kbd>Space</kbd>` }),
    );
    bar.hidden = false;
  }

  private renderStatus() {
    const hints: Record<Tool, string> = {
      select: this.heights ? "Click a joint circle, then type a height or use ↑ ↓. Colours show gradient: green up to 2.5%, amber up to 4%, red above."
        : "Pick track on the left to add it at the arrow. Click any open track end to build from there. Drag to move; pieces snap together.",
      start: "Click to place a start point. Drag while holding to aim it.",
      flex: !this.flex ? "Click an open track end, or click empty space to start flexible track there."
        : this.flex.free ? "Click again to set the direction of the first straight."
        : "Move to shape, click to fix a section. Point at another open end to join it. Enter finishes, Backspace removes a section, Esc cancels.",
      board: this.boardDraft?.length ? "Click the next corner. Click the first corner, double-click or press Enter to finish." : "Click the corners of the baseboard in order.",
      measure: this.measure ? `Distance ${fmtLen(dist(this.measure.a, this.measure.b), this.p.units)}` : "Drag to measure a distance.",
    };
    this.el.stHint.textContent = this.mode === "control"
      ? (this.ctl.tool?.kind === "block" ? "Tap track pieces to add them to the block or take them out." : this.ctl.tool?.kind === "signal" ? "Tap the track just before a block joint, on the side trains come from."
        : this.ctl.tool?.kind === "place" ? "Tap the block where the train is." : "Tap a point to throw it, tap a signal to hold it at red. Drag to move around the plan. Space stops every train.")
      : hints[this.tool];
    const c = this.cursor;
    this.el.stXy.textContent = c ? `X ${Math.round(c.x)}  Y ${Math.round(c.y)} mm` : "";
    const ratio = 1 / (this.view.s * 0.2646);
    this.el.stZoom.textContent = ratio >= 1 ? `Screen 1:${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}` : `Screen ${(1 / ratio).toFixed(1)}:1`;
    const n = this.sel.size;
    this.el.stSel.textContent = n ? `${n} selected` : `${this.p.items.length} pieces`;
  }

  private renderLayers() {
    const ul = this.el.layers;
    clear(ul);
    const counts = new Map<string, number>();
    for (const it of this.p.items) counts.set(it.layer, (counts.get(it.layer) ?? 0) + 1);
    this.p.layers.forEach((l, i) => {
      const active = l.id === this.p.activeLayer;
      const vis = h("input", { type: "checkbox", id: `layer-vis-${l.id}`, "aria-label": `Show ${l.name}`, checked: l.visible, disabled: active,
        onchange: (e: Event) => { l.visible = (e.target as HTMLInputElement).checked; this.commit(); } });
      const name = h("button", { class: "layer-name", type: "button", title: active ? "Double-click to rename" : "Click to draw on this layer", onclick: () => { this.p.activeLayer = l.id; l.visible = true; this.commit(); },
        ondblclick: () => this.renameLayer(l.id) }, l.name);
      const li = h("li", { class: `layer ${active ? "active" : ""}` }, vis, name,
        h("span", { class: "layer-count mono" }, String(counts.get(l.id) ?? 0)),
        h("span", { class: "layer-actions" },
          h("button", { class: "icon-btn sm", type: "button", "aria-label": "Move layer up", html: icon("up", 14), disabled: i === 0, onclick: () => { const a = this.p.layers; [a[i - 1], a[i]] = [a[i], a[i - 1]]; this.commit(); } }),
          h("button", { class: "icon-btn sm", type: "button", "aria-label": "Move selection to this layer", title: "Move selection here", html: icon("download", 14), disabled: !this.sel.size, onclick: () => { for (const x of itemsById(this.p, this.sel)) x.layer = l.id; this.commit(); } }),
          h("button", { class: "icon-btn sm", type: "button", "aria-label": "Delete layer", html: icon("trash", 14), disabled: this.p.layers.length <= 1, onclick: () => this.removeLayer(l.id) })));
      ul.append(li);
    });
  }

  private renameLayer(id: string) {
    const l = this.p.layers.find((x) => x.id === id)!;
    const inp = h("input", { id: "layer-rename", type: "text", value: l.name }) as HTMLInputElement;
    dialog("Rename layer", field("Layer name", inp), [{ label: "Cancel" }, { label: "Rename", primary: true, onClick: () => { l.name = inp.value.trim() || l.name; this.commit(); } }]);
  }

  private async removeLayer(id: string) {
    const l = this.p.layers.find((x) => x.id === id)!;
    const n = this.p.items.filter((i) => i.layer === id).length;
    if (n && !(await confirmDialog(`Delete “${l.name}”?`, `Its ${n} piece${n === 1 ? "" : "s"} of track will be deleted too.`, "Delete layer", true))) return;
    deleteLayer(this.p, id);
    this.commit();
  }

  renderInspector() {
    const box = this.el.insp;
    if (this.mode === "control") { this.ctl.render(box); return; }
    clear(box);
    const u = this.p.units;
    const kv = (k: string, v: string | Node, cls = "") => h("div", { class: `kv ${cls}` }, h("span", { class: "k" }, k), h("span", { class: "v" }, v));

    if (this.flex && !this.flex.free) {
      const f = this.flex, part = getPart(f.part)!;
      const L = flexLength(f.segs);
      const lenIn = numInput("fx-len", 200, { min: 1 }), rIn = numInput("fx-r", Math.max(500, part.def.minRadius ?? 0), { min: part.def.minRadius ?? 1 }), aIn = numInput("fx-a", 30);
      append(box, 
        h("div", { class: "sec-head" }, h("h3", {}, "Flexible track")),
        h("p", { class: "muted small" }, `${part.def.id} ${part.def.name}`),
        kv("Length so far", fmtLen(L, u)),
        kv("Pieces needed", String(Math.max(1, Math.ceil(L / (part.def.maxLength ?? 1000))))),
        kv("Tightest curve", f.segs.some((s) => s.kind === "a") ? `R ${Math.round(minRadius(f.segs))} mm` : "straight"),
        kv("Minimum radius", `${part.def.minRadius} mm`),
        h("div", { class: "sub-head" }, "Add a section by numbers"),
        h("div", { class: "row2" }, field("Length (mm)", lenIn), h("button", { class: "btn", type: "button", onclick: () => this.addFlexSection({ kind: "s", len: +lenIn.value }) }, "Add straight")),
        h("div", { class: "row3" }, field("Radius (mm)", rIn), field("Angle (°)", aIn, "+ left, − right"),
          h("button", { class: "btn", type: "button", onclick: () => this.addFlexSection({ kind: "a", r: +rIn.value, deg: +aIn.value }) }, "Add curve")),
        h("div", { class: "btn-row" },
          h("button", { class: "btn", type: "button", onclick: () => { f.segs.pop(); this.render(); this.renderInspector(); }, disabled: !f.segs.length }, "Remove last"),
          h("button", { class: "btn btn-primary", type: "button", onclick: () => this.finishFlex(), disabled: !f.segs.length }, "Finish")),
      );
      return;
    }

    if (this.heightSel) {
      const z = this.heightAtSel();
      const input = numInput("height-z", z, { min: 0, step: 0.5 });
      input.addEventListener("change", () => this.setHeight(+input.value));
      const touching = this.an.ends.filter((e) => dist(e, this.heightSel!) < 0.6);
      append(box, 
        h("div", { class: "sec-head" }, h("h3", {}, "Height at this joint")),
        h("div", { class: "height-row" },
          h("button", { class: "icon-btn", type: "button", "aria-label": "Lower 1 mm", html: icon("minus"), onclick: () => this.changeHeight(-1) }),
          field("Above baseboard (mm)", input),
          h("button", { class: "icon-btn", type: "button", "aria-label": "Raise 1 mm", html: icon("plus"), onclick: () => this.changeHeight(1) })),
        h("p", { class: "muted small" }, "Turnouts and crossings stay level, so their other ends move too. Use ↑ ↓ for 1 mm steps, with Shift for 10 mm."),
        ...touching.map((e) => {
          const it = this.p.items.find((i) => i.id === e.item)!;
          const gr = gradient(it);
          return kv(`${partOf(it).def.id}`, gr === null ? "level piece" : gradeChip(gr));
        }),
      );
      return;
    }

    const items = itemsById(this.p, this.sel);
    const boards = this.p.boards.filter((b) => this.sel.has(b.id));
    if (items.length === 1 && !boards.length) {
      const it = items[0], g = geom(it), d = g.part.def;
      const gr = gradient(it);
      const layer = h("select", { id: "it-layer", onchange: (e: Event) => { it.layer = (e.target as HTMLSelectElement).value; this.commit(); } },
        ...this.p.layers.map((l) => h("option", { value: l.id, selected: l.id === it.layer }, l.name)));
      const rotIn = numInput("it-rot", +(normAngle(it.rot) / DEG).toFixed(2));
      rotIn.addEventListener("change", () => {
        const b = selectionBounds(this.p, [it.id])!;
        rotateItems(this.p, [it.id], +rotIn.value * DEG - it.rot, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
        this.commit();
      });
      append(box, 
        h("div", { class: "sec-head" }, h("h3", {}, h("span", { class: "mono" }, d.id), " ", d.name)),
        h("p", { class: "muted small" }, `${g.part.lib.name}`),
        kv(d.type === "flex" ? "Length" : "Main route", fmtLen(g.length, u)),
        d.type === "curve" ? kv("Radius · angle", partGeometryLabel(d)) : null,
        d.type === "turnout" || d.type === "crossing" ? kv("Geometry", partGeometryLabel(d)) : null,
        d.type === "flex" ? kv("Tightest curve", it.segs?.some((s) => s.kind === "a") ? `R ${Math.round(minRadius(it.segs!))} mm` : "straight") : null,
        d.type === "flex" ? kv("Pieces of flex", String(Math.ceil(g.length / (d.maxLength ?? 1000)))) : null,
        kv("Heights", g.ends.map((e) => `${+e.z.toFixed(1)}`).join(" / ") + " mm"),
        gr !== null ? kv("Gradient", gradeChip(gr)) : null,
        h("div", { class: "row2" }, field("Layer", layer), field("Rotation (°)", rotIn)),
        d.note ? h("p", { class: "muted small" }, d.approximate ? `≈ ${d.note}` : d.note) : null,
        d.type === "turnout" && this.p.boards.some((b) => b.module)
          ? (motorsOverFrame(this.p).some((w) => w.item === it.id)
            ? h("p", { class: "warn-note" }, "This point's motor would sit over a frame member. Move the point, or use a surface-mounted motor.")
            : h("p", { class: "muted small" }, "Point motor position is clear of the baseboard frame."))
          : null,
        selectionButtons(this),
      );
      return;
    }
    if (!items.length && boards.length === 1 && boards[0].module && getModule(boards[0].module.preset)) {
      const b = boards[0], m = getModule(b.module!.preset)!;
      const name = h("input", { id: "board-name", type: "text", value: b.name }) as HTMLInputElement;
      name.addEventListener("change", () => { b.name = name.value.trim() || b.name; this.commit(); });
      const joints = moduleJoints(this.p);
      const widths = [...new Set(m.faces.map((f) => f.width))].join(" and ");
      const extra = /^per joint/i.test(m.hardware) ? null : m.hardware;
      append(box,
        h("div", { class: "sec-head" }, h("h3", {}, m.name)),
        field("Name on the plan", name),
        h("p", { class: "muted small" }, m.blurb),
        kv("Size", m.size),
        kv("Height", `${overallDepth(m)} mm${m.canopyHeight ? `, pelmet ${m.canopyHeight} mm above the track` : ""}`),
        kv("Material", m.material),
        kv("Weight", `${m.weightKg} kg`),
        kv("Cutting", `${m.pieces} pieces from ${m.sheets.count} sheet${m.sheets.count === 1 ? "" : "s"} of ${m.sheets.size[0]} × ${m.sheets.size[1]} mm, ${m.cutLengthM} m of cut`),
        kv("Joins", `${m.faces.length} face${m.faces.length === 1 ? "" : "s"}, ${widths} mm wide; 2 dowels and 2 M8 bolts each`),
        extra ? kv("Also needs", extra) : null,
        joints ? kv("Joints on the layout", String(joints)) : null,
        this.trackPositionsPanel(b.id, m),
        h("p", { class: "muted small" }, "Lines under the top are the frame. Lighter panels are the openings in the bottom skin, where point motors and wiring can go. Thin lines are the guides engraved on the top: centre lines, the centre arc on curves and the roads on a traverser."),
        h("div", { class: "btn-row" },
          h("button", { class: "btn", type: "button", onclick: () => this.addModuleFromUi(m.id), html: `${icon("plus", 16)}<span>Add module after this</span>` }),
          h("button", { class: "btn", type: "button", id: "rejoin", onclick: () => {
            if (rejoinModule(this.p, b.id)) { this.commit(); this.render(); }
            else toast("Only one of its faces fits here.");
          }, html: `${icon("rotate", 16)}<span>Join by its other face</span>` })),
        selectionButtons(this),
      );
      return;
    }
    if (items.length || boards.length) {
      const total = items.reduce((a, it) => a + geom(it).length, 0);
      append(box, 
        h("div", { class: "sec-head" }, h("h3", {}, `${items.length + boards.length} selected`)),
        items.length ? kv("Track", `${items.length} pieces · ${fmtLen(total, u)}`) : null,
        ...boards.map((b) => {
          const bb = { w: Math.max(...b.pts.map((q) => q.x)) - Math.min(...b.pts.map((q) => q.x)), d: Math.max(...b.pts.map((q) => q.y)) - Math.min(...b.pts.map((q) => q.y)) };
          return kv(b.name, `${fmtLen(bb.w, u)} × ${fmtLen(bb.d, u)}`);
        }),
        selectionButtons(this),
      );
      return;
    }
    const s = summarize(this.p);
    const grade = gradeBand(s.maxGradient);
    append(box, 
      h("div", { class: "sec-head" }, h("h3", {}, "Layout")),
      h("div", { class: "health" },
        chip(s.freeEnds === 0 ? "ok" : "info", s.freeEnds === 0 ? "No open ends" : `${s.freeEnds} open end${s.freeEnds === 1 ? "" : "s"}`),
        chip(s.badJoints ? "bad" : "ok", s.badJoints ? `${s.badJoints} misaligned joint${s.badJoints === 1 ? "" : "s"}` : "Joints aligned"),
        chip(grade === "too-steep" ? "bad" : grade === "steep" ? "warn" : "ok", s.maxGradient < 0.05 ? "All level" : `Steepest ${s.maxGradient.toFixed(1)}%`),
        s.modules ? chip(s.motorsOverFrame ? "warn" : "ok", s.motorsOverFrame ? `${s.motorsOverFrame} point motor${s.motorsOverFrame === 1 ? "" : "s"} over the frame` : "Point motors clear of frame") : null),
      kv("Sectional pieces", String(s.pieces)),
      kv("Flexible track", fmtLen(s.flexLength, u)),
      kv("Total track", fmtLen(s.trackLength, u)),
      kv("Tightest radius", isFinite(s.minRadius) ? `${Math.round(s.minRadius)} mm` : "none"),
      kv("Baseboard area", s.boardArea ? `${(s.boardArea / 1e6).toFixed(2)} m²` : "none"),
      s.modules ? kv("Baseboard modules", `${s.modules} · ${s.moduleWeight.toFixed(1)} kg`) : null,
      h("div", { class: "btn-row" },
        h("button", { class: "btn", type: "button", onclick: () => this.showPartsList(), html: `${icon("list", 16)}<span>Parts list</span>` }),
        h("button", { class: "btn", type: "button", onclick: () => this.toggle3d(true), html: `${icon("cube", 16)}<span>3D view</span>` })),
    );
  }
}

function append(el: Element, ...kids: (Node | string | null | undefined | false)[]) {
  for (const k of kids) if (k !== null && k !== undefined && k !== false) el.append(k);
}

function moduleThumb(m: ModulePreset, size = 56): string {
  const xs = m.outline.map((p) => p.x), ys = m.outline.map((p) => p.y);
  const x0 = Math.min(...xs), y1 = Math.max(...ys);
  // every module at the same scale (the longest is 1200 mm), so sizes compare at a glance
  const k = (size - 6) / 1200, ox = (size - m.length * k) / 2, oy = (size - m.width * k) / 2;
  const X = (x: number) => (ox + (x - x0) * k).toFixed(1), Y = (y: number) => (oy + (y1 - y) * k).toFixed(1);
  const poly = (o: { x: number; y: number }[]) => `M${o.map((q) => `${X(q.x)} ${Y(q.y)}`).join("L")}Z`;
  const mem = moduleMembers(m).map((l) => `M${X(l.a.x)} ${Y(l.a.y)}L${X(l.b.x)} ${Y(l.b.y)}`).join("");
  const op = moduleOpenings(m).map(poly).join("");
  const feat = m.features.filter((f) => f.outline && f.kind !== "well").map((f) => poly(f.outline!)).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="${poly(m.outline)}" class="th-board"/><path d="${op}" class="th-open"/><path d="${mem}" class="th-frame" fill="none"/>` +
    (feat ? `<path d="${feat}" class="th-feature" fill="none"/>` : "") + `</svg>`;
}

/** "1200 × 600 sliding traverser" → "Sliding traverser" (the size is shown above it). */
function shortModuleName(m: ModulePreset) {
  const n = m.name.replace(/^\d+ × \d+ /, "");
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function chip(kind: "ok" | "warn" | "bad" | "info", text: string) {
  return h("span", { class: `chip chip-${kind}` }, text);
}

function gradeChip(gr: number) {
  const b = gradeBand(gr);
  const kind = b === "too-steep" ? "bad" : b === "steep" ? "warn" : b === "ok" ? "ok" : "info";
  return chip(kind, Math.abs(gr) < 0.05 ? "level" : `${Math.abs(gr).toFixed(2)}% ${gr > 0 ? "rising" : "falling"}`);
}

function selectionButtons(app: App) {
  return h("div", { class: "btn-row" },
    h("button", { class: "btn", type: "button", title: "Rotate 15° (Shift+R)", onclick: () => app.rotateSelection(15), html: `${icon("rotate", 16)}<span>15°</span>` }),
    h("button", { class: "btn", type: "button", title: "Flip (F)", onclick: () => app.flipSelection(), html: `${icon("flip", 16)}<span>Flip</span>` }),
    h("button", { class: "btn btn-danger-ghost", type: "button", title: "Delete (Del)", onclick: () => app.deleteSelection(), html: `${icon("trash", 16)}<span>Delete</span>` }));
}

function sameApartFromProposals(a: Project, b: Project) {
  return serialize({ ...a, proposals: undefined }) === serialize({ ...b, proposals: undefined });
}

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function printPalette(): Palette {
  return {
    plot: "#ffffff", grid: "#eeeeee", gridMajor: "#dddddd", board: "#efe4cf", boardEdge: "#9a8460", boardText: "#5b4a2e",
    rail: "#2b2f2c", sleeper: "#a89880", select: "#2b2f2c", accent: "#a5650f", ink: "#1c2320", ink2: "#5a625c",
    ok: "#2f7d46", warn: "#b07c00", bad: "#b3362b", free: "#a5650f", flex: "#9a8a72", ghost: "#cccccc", prop: "#2f63c8",
  };
}

export { endKey };

const YARD_TYPES: { kind: YardKind; name: string; short: string; geo: string; blurb: string }[] = [
  { kind: "fiddle", name: "Fiddle yard", short: "Fiddle yard", geo: "2–8 roads, one end",
    blurb: "A fan of parallel roads off a ladder of points, all ending in a line: the classic dead-end fiddle yard or storage sidings." },
  { kind: "fiddle2", name: "Double-ended fiddle yard", short: "Through yard", geo: "2–8 roads, both ends",
    blurb: "Ladders at both ends, so trains run in one end and out of the other: for a continuous run, or a station's loops." },
  { kind: "runround", name: "Run-round loop", short: "Run-round", geo: "loop and headshunts",
    blurb: "A loop where the engine runs round its train, with a headshunt at each end." },
  { kind: "inglenook", name: "Inglenook sidings", short: "Inglenook", geo: "shunting puzzle",
    blurb: "Alan Wright's classic shunting puzzle: a headshunt for the engine and three wagons, then sidings for five, three and three wagons. Make up a train of five from eight wagons, in the order the cards say." },
];

function defaultYard(kind: YardKind, libId: string): YardOptions {
  const base: YardOptions = { kind, roads: kind === "fiddle2" ? 4 : 5, side: 1, length: 0, wagon: wagonLength(libId), headshunt: 300 };
  base.length = kind === "runround" ? Math.max(1000, minYardLength(base, libId)) : kind === "inglenook" ? 0 : Math.max(kind === "fiddle" ? 1500 : 2000, minYardLength(base, libId));
  return base;
}

/** A centre-line drawing of a yard, built on a scratch layout. */
function yardSvg(libId: string, o: YardOptions, w: number, hgt: number, stretch = false): string {
  const p = newProject("yard");
  try { buildYard(p, libId, o, { x: 0, y: 0, h: 0 }); } catch { return ""; }
  const paths: string[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const lines: { pts: { x: number; y: number }[]; point: boolean }[] = [];
  for (const it of p.items) {
    const g = geom(it);
    for (const r of g.routes) {
      const pts = r.prims.flatMap((pr) => samplePrim(pr, 15));
      for (const q of pts) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
      lines.push({ pts, point: g.part.def.type === "turnout" });
    }
  }
  if (!lines.length) return "";
  const pad = 4, sx = (w - 2 * pad) / Math.max(1, maxX - minX), sy = (hgt - 2 * pad) / Math.max(1, maxY - minY);
  const k = Math.min(sx, sy);
  // small thumbnails of long, thin yards are stretched across so the roads can be told apart
  const ky = stretch ? Math.min(sy, k * 3) : k;
  const ox = (w - (maxX - minX) * k) / 2, oy = (hgt - (maxY - minY) * ky) / 2;
  for (const l of lines) paths.push(`<path d="M${l.pts.map((q) => `${(ox + (q.x - minX) * k).toFixed(1)} ${(oy + (maxY - q.y) * ky).toFixed(1)}`).join("L")}" class="${l.point ? "th-point" : "th-track"}" fill="none"/>`);
  return `<svg viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}" aria-hidden="true">${paths.join("")}</svg>`;
}


/** A small drawing of a whole plan: boards and track centre lines. */
function layoutSvg(p: Project, w: number, hgt: number): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of p.boards) for (const q of b.pts) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
  if (!isFinite(minX)) return "";
  const pad = 4, k = Math.min((w - 2 * pad) / (maxX - minX), (hgt - 2 * pad) / (maxY - minY));
  const ox = (w - (maxX - minX) * k) / 2, oy = (hgt - (maxY - minY) * k) / 2;
  const P = (q: { x: number; y: number }) => `${(ox + (q.x - minX) * k).toFixed(1)} ${(oy + (maxY - q.y) * k).toFixed(1)}`;
  const boards = p.boards.map((b) => `<path d="M${b.pts.map(P).join("L")}Z" class="th-board"/>`).join("");
  const track = p.items.flatMap((it) => {
    const g = geom(it);
    return g.routes.map((r) => `<path d="M${r.prims.flatMap((pr) => samplePrim(pr, 20)).map(P).join("L")}" class="${g.part.def.type === "turnout" ? "th-point" : "th-track"}" fill="none"/>`);
  }).join("");
  return `<svg viewBox="0 0 ${w} ${hgt}" width="${w}" height="${hgt}" aria-hidden="true">${boards}${track}</svg>`;
}
