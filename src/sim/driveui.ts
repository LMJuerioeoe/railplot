// The drive view: the layout in 3D with the simulated trains moving on it, a HUD to drive them, and
// cameras that follow a train. It runs over the 3D view and the control loop that already exist.
import type { App } from "../app";
import { SimLink } from "../control/link";
import { quickStart } from "../control/engine";
import { h, clear } from "../ui/dom";
import { closeDialog, confirmDialog, dialog, toast } from "../ui/dialogs";
import { store } from "../platform";
import { DynamicVehicle } from "../view3d";
import { geom } from "../model";
import { World, scaleOf, worldFor } from "./world";
import { TrackPos, TrackPose } from "./track";
import { STOCK, newVehicle } from "./stock";
import { MODELS, ModelGroup, modelById, vehiclesOfModel } from "./models";
import { VehicleKind } from "../control/types";

export type Camera = "tabletop" | "chase" | "cab";
const CAMERAS: Camera[] = ["tabletop", "chase", "cab"];
const CAMERA_NAMES: Record<Camera, string> = { tabletop: "Tabletop", chase: "Chase", cab: "Cab" };
const PREFS = "railplot.drive.v1";

/** Side-on outlines of the stock kinds, drawn for the Trains dialog (64 × 22). */
const SILHOUETTE: Record<VehicleKind, string> = {
  tender: "M8 8h48v9H8z M16 19a2 2 0 1 0 0.1 0 M32 19a2 2 0 1 0 0.1 0 M48 19a2 2 0 1 0 0.1 0",
  loco: "M4 6h40v-3h12v3h4v11H4z M10 19a2 2 0 1 0 0.1 0 M22 19a2 2 0 1 0 0.1 0 M44 19a2 2 0 1 0 0.1 0 M54 19a2 2 0 1 0 0.1 0",
  coach: "M2 6q30-4 60 0v11H2z M10 19a2 2 0 1 0 0.1 0 M16 19a2 2 0 1 0 0.1 0 M48 19a2 2 0 1 0 0.1 0 M54 19a2 2 0 1 0 0.1 0",
  wagon: "M12 10h40v7H12z M20 19a2 2 0 1 0 0.1 0 M44 19a2 2 0 1 0 0.1 0",
  van: "M12 7q20-3 40 0v10H12z M20 19a2 2 0 1 0 0.1 0 M44 19a2 2 0 1 0 0.1 0",
  tank: "M12 15h40v2H12z M14 8h36a4 4 0 0 1 0 7H14a4 4 0 0 1 0-7z M20 19a2 2 0 1 0 0.1 0 M44 19a2 2 0 1 0 0.1 0",
  brake: "M12 7h28v10H12z M40 10h12v7H40z M20 19a2 2 0 1 0 0.1 0 M44 19a2 2 0 1 0 0.1 0",
};
const silhouette = (kind: VehicleKind) => h("span", { class: "stock-pic", "aria-hidden": "true",
  html: `<svg viewBox="0 0 64 22" width="64" height="22"><path d="${SILHOUETTE[kind]}" fill="currentColor" stroke="currentColor" stroke-width="1.2"/></svg>` });

const hexRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x888888;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class DriveView {
  open = false;
  camera: Camera = "chase";
  train: string | null = null;
  units: "kmh" | "mph" = "kmh";
  private hud: HTMLElement | null = null;
  private raf = 0;
  private eye: [number, number, number] | null = null;
  private look: [number, number, number] | null = null;
  private refs: { speed?: HTMLElement; speedBox?: HTMLElement; unit?: HTMLElement; tag?: HTMLElement; throttle?: HTMLInputElement; throttleLabel?: HTMLElement; trains?: HTMLElement; camera?: HTMLElement; card?: HTMLElement; placeCard?: HTMLElement; placeNote?: HTMLElement } = {};
  private cardFor: string | null = null;
  /** Things in the scene that can be clicked: points and signals, where they are this frame. */
  targets: { kind: "point" | "signal" | "coupler"; id: string; after?: number; x: number; y: number; z: number }[] = [];
  /** Placing a consist on the track (S08): where its front would go, and whether it fits there. */
  placing: { id: string; dir: 1 | -1; front: TrackPos | null; ghost: TrackPos[] | null; error: string | null } | null = null;
  /** The coupling under the pointer, shown as a marker. */
  private hoverCoupler: string | null = null;
  private samples: { graph: unknown; list: TrackPos[] } = { graph: null, list: [] };
  /** The Trains dialog: the consist being made up and the vehicle picked in it. */
  private editing: string | null = null;
  private picked: number | null = null;
  private trainsBody: HTMLElement | null = null;
  /** Which models the Trains dialog shows: British OO, European H0, or all. */
  private catScale: "OO" | "H0" | "all" | undefined;
  private zCache = new Map<string, number>();
  private zGraph: unknown = null;

  constructor(private app: App) {
    try { const d = JSON.parse(store.get(PREFS) ?? "{}"); if (d.units === "mph") this.units = "mph"; if (CAMERAS.includes(d.camera)) this.camera = d.camera; } catch { /* defaults */ }
  }

  private get ctl() { return this.app.ctl; }
  private savePrefs() { store.set(PREFS, JSON.stringify({ units: this.units, camera: this.camera })); }

  /** The simulator's world, when this window runs it (no hub). */
  world(): World | null {
    const sim = [...this.ctl.links.values()].find((l) => l instanceof SimLink);
    return sim && !this.ctl.hub ? worldFor(this.ctl.engine) : null;
  }

  /** Open the drive view: the simulator gets set up first if the layout has nothing to drive. */
  async start() {
    const p = this.app.p;
    if (!p.items.length) { toast("Lay some track first: there's nothing to drive on."); return; }
    const cfg = this.ctl.cfg;
    if (!cfg.controllers.some((c) => c.kind === "sim")) {
      if (cfg.controllers.length) { toast("Drive in 3D uses the simulator. Add it in Control > Set up (Controllers) to drive here."); return; }
      if (!(await confirmDialog("Drive in the simulator?", "Railplot adds a simulated controller and a train, and treats the whole layout as one block. You can split it into blocks later in Control > Set up.", "Set up and drive"))) return;
      quickStart(p, cfg, "sim");
      this.app.commit();
    }
    if (!cfg.trains.some((t) => t.block)) { toast("Put a train on the layout in Control > Drive (Place) first."); return; }
    this.ctl.onProjectChanged();
    this.train = cfg.trains.find((t) => t.id === this.train && t.block)?.id ?? cfg.trains.find((t) => t.block)!.id;
    await this.app.toggle3d(true);
    if (!this.app.mode3d) return;
    this.open = true;
    this.app.root.classList.add("is-driving");
    this.buildHud();
    this.eye = null;
    if (this.app.view3d) { this.app.view3d.onPick = (x, y) => this.pick(x, y); this.app.view3d.onHover = (x, y) => this.hoverAt(x, y); }
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.frame());
  }

  stop() {
    if (!this.open) return;
    this.open = false;
    cancelAnimationFrame(this.raf);
    this.hud?.remove(); this.hud = null;
    this.refs.card?.remove(); this.refs.placeCard?.remove(); this.refs = {}; this.cardFor = null;
    this.placing = null; this.hoverCoupler = null;
    this.app.root.classList.remove("is-driving");
    if (this.app.view3d) { this.app.view3d.follow = null; this.app.view3d.onPick = null; this.app.view3d.onHover = null; this.app.view3d.setDynamic([]); }
  }

  // ---------- HUD ----------

  private buildHud() {
    this.hud?.remove();
    const cfg = this.ctl.cfg;
    const trains = h("div", { class: "hud-group hud-trains", role: "radiogroup", "aria-label": "Train" });
    const throttle = h("input", { type: "range", min: "-100", max: "100", step: "1", value: "0", id: "drive-throttle", "aria-label": "Throttle",
      oninput: () => this.setThrottle(+throttle.value / 100) }) as HTMLInputElement;
    const throttleLabel = h("span", {}, "Stopped");
    const speed = h("b", { id: "drive-speed" }, "0"), unit = h("span", {}, this.unitName()), tag = h("span", { class: "hud-tag warn", hidden: true }, "Curve");
    const speedBox = h("div", { class: "hud-speed", "aria-label": "Speed" }, speed, h("span", {}, unit, " ", tag));
    const cam = h("button", { class: "hud-chip", type: "button", id: "drive-camera", onclick: () => this.nextCamera() });
    this.hud = h("div", { class: "hud", role: "toolbar", "aria-label": "Train controls", id: "drive-hud" },
      trains,
      h("div", { class: "hud-throttle" }, h("label", { for: "drive-throttle" }, h("span", {}, "Back"), throttleLabel, h("span", {}, "Forward")), throttle),
      speedBox,
      h("button", { class: "hud-btn", type: "button", id: "drive-stop", title: "Stop this train (Space)", onclick: () => this.setThrottle(0, true) }, "Stop"),
      h("button", { class: "hud-btn", type: "button", id: "drive-trains", title: "Make up trains and place them (T)", onclick: () => this.openTrains() }, "Trains"),
      cam,
      h("button", { class: "hud-btn", type: "button", id: "drive-exit", title: "Back to the plan (Esc)", onclick: () => this.app.toggle3d(false) }, "Exit"));
    this.refs = { speed, speedBox, unit, tag, throttle, throttleLabel, trains, camera: cam };
    for (const t of cfg.trains.filter((x) => x.block)) {
      trains.append(h("button", { class: "hud-chip", type: "button", role: "radio", "data-train": t.id, style: `--train:${t.color}`,
        onclick: () => { this.train = t.id; this.eye = null; this.syncHud(); } }, h("span", { class: "dot" }), t.name, h("span", { class: "hud-tag danger", hidden: true, "data-derailed": t.id }, "Derailed")));
    }
    this.app.el.view3d.append(this.hud);
    this.syncHud();
  }

  private unitName() {
    const lib = this.app.p.items[0]?.part.split("/")[0] ?? "";
    return scaleOf(lib) ? (this.units === "mph" ? "mph" : "km/h") : "mm/s";
  }

  private syncHud() {
    const r = this.refs;
    const w = this.world();
    for (const tag of r.trains?.querySelectorAll<HTMLElement>("[data-derailed]") ?? []) tag.hidden = !w?.consistOf(tag.dataset.derailed!)?.derailed;
    const off = this.train ? w?.consistOf(this.train)?.derailed : undefined;
    if (r.throttle) r.throttle.disabled = !!off;
    this.derailCard(w, off ? this.train : null);
    for (const b of r.trains?.querySelectorAll<HTMLElement>("[data-train]") ?? []) b.setAttribute("aria-checked", String(b.dataset.train === this.train));
    if (r.camera) { clear(r.camera); r.camera.append(`${CAMERA_NAMES[this.camera]} `, h("kbd", {}, "C")); r.camera.title = "Change the camera (C)"; r.camera.setAttribute("aria-label", `Camera: ${CAMERA_NAMES[this.camera]} (C)`); }
    const target = this.train ? this.ctl.engine.run(this.train)?.target ?? 0 : 0;
    if (r.throttle && document.activeElement !== r.throttle) r.throttle.value = String(Math.round(target * 100));
    if (r.throttleLabel) r.throttleLabel.textContent = off ? "Derailed" : target === 0 ? "Stopped" : `${Math.round(Math.abs(target) * 100)}% ${target > 0 ? "forward" : "back"}`;
  }

  /** The derailment card for the selected train, while it's off the rails. */
  private derailCard(w: World | null, train: string | null) {
    if (this.cardFor === train) return;
    this.cardFor = train;
    this.refs.card?.remove(); this.refs.card = undefined;
    const c = train && w ? w.consistOf(train) : undefined;
    if (!c?.derailed || !train) return;
    const name = this.ctl.cfg.trains.find((t) => t.id === train)?.name ?? "The train";
    const here = h("button", { class: "hud-btn primary", type: "button", id: "drive-rerail", onclick: () => this.rerail("here") }, "Re-rail here");
    const card = h("div", { class: "hud-card", role: "alertdialog", "aria-label": `${name} derailed`, id: "drive-derailed" },
      h("h3", {}, `${name} derailed`),
      h("p", {}, `${w!.describe(c.derailed)[0].toUpperCase()}${w!.describe(c.derailed).slice(1)}.`),
      h("div", { class: "row" }, here,
        h("button", { class: "hud-btn", type: "button", onclick: () => this.rerail("last-stop") }, "Re-rail where it last stood")));
    this.app.el.view3d.append(card);
    this.refs.card = card;
    setTimeout(() => here.focus(), 0);
  }

  private rerail(how: "here" | "last-stop") {
    if (!this.train) return;
    this.ctl.act({ c: "rerail", train: this.train, how });
    this.cardFor = "~";   // redraw on the next frame
  }

  private setThrottle(v: number, show = false) {
    if (!this.train) return;
    this.ctl.act({ c: "throttle", train: this.train, v: Math.max(-1, Math.min(1, v)) });
    if (show) this.syncHud(); else if (this.refs.throttleLabel) this.refs.throttleLabel.textContent = v === 0 ? "Stopped" : `${Math.round(Math.abs(v) * 100)}% ${v > 0 ? "forward" : "back"}`;
  }

  private nextCamera() {
    this.camera = CAMERAS[(CAMERAS.indexOf(this.camera) + 1) % CAMERAS.length];
    this.eye = null;
    if (this.camera === "tabletop" && this.app.view3d) { this.app.view3d.follow = null; this.app.view3d.resetCamera(); }
    this.savePrefs();
    this.syncHud();
  }

  /** Keys in the drive view. Returns true when handled. */
  onKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    const k = e.key;
    if (this.placing) {
      if (k === "Escape") { this.stopPlacing(); return true; }
      if (k === "r" || k === "R") { this.placing.dir = this.placing.dir === 1 ? -1 : 1; this.refit(); return true; }
      if (k === "Enter" && this.placing.ghost) { this.placeHere(); return true; }
      // keyboard only: ←/→ slide the ghost along the track (Shift: further), ↑/↓ jump to the next piece
      if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); this.nudgePlacing((k === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 200 : 40)); return true; }
      if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); this.jumpPlacing(k === "ArrowUp" ? 1 : -1); return true; }
      if (k === "Enter") { toast(this.placing.error ?? "Move the ghost onto the track first: arrows, or point at it."); return true; }
    }
    const target = this.train ? this.ctl.engine.run(this.train)?.target ?? 0 : 0;
    const step = e.shiftKey ? 0.2 : 0.05;
    if (k === "e" || k === "E" || k === "ArrowRight" || k === "ArrowUp") { this.setThrottle(target + step, true); return true; }
    if (k === "q" || k === "Q" || k === "ArrowLeft" || k === "ArrowDown") { this.setThrottle(target - step, true); return true; }
    if (e.code === "Space") { e.preventDefault(); if (e.shiftKey) this.ctl.act({ c: "stopAll" }); else this.setThrottle(0, true); return true; }
    if (k === "c" || k === "C") { this.nextCamera(); return true; }
    if (k === "r" || k === "R") { this.rerail("here"); return true; }
    if (k === "p" || k === "P") {
      const w = this.world(), item = this.train && w ? w.pointAhead(this.train) : null;
      if (item) this.throwPoint(item); else toast("No point ahead of this train.");
      return true;
    }
    if (k === "k" || k === "K") { this.units = this.units === "kmh" ? "mph" : "kmh"; this.savePrefs(); if (this.refs.unit) this.refs.unit.textContent = this.unitName(); return true; }
    if (k === "t" || k === "T") { this.openTrains(); return true; }
    if (k === "u" || k === "U") {
      const w = this.world();
      if (!w || !this.train) return true;
      const err = w.uncoupleLoco(this.train);
      if (err) toast(err); else { this.app.commit(); toast("Uncoupled."); }
      return true;
    }
    if (/^[1-9]$/.test(k)) {
      const t = this.ctl.cfg.trains.filter((x) => x.block)[+k - 1];
      if (t) { this.train = t.id; this.eye = null; this.syncHud(); }
      return true;
    }
    return false;
  }

  // ---------- every frame ----------

  private frame() {
    if (!this.open) return;
    const v3 = this.app.view3d;
    const w = this.world();
    if (w && v3) {
      // run the world to now, so trains glide between the control loop's ticks
      w.advanceTo(performance.now());
      const railTop = 5;
      const vehicles: DynamicVehicle[] = w.vehiclePoses().map(({ vehicle, pose }) => ({
        ...this.shape(vehicle), color: vehicle.model && modelById(vehicle.model) ? [1, 1, 1] : hexRgb(vehicle.color),
        x: pose.x, y: pose.y, z: pose.z + railTop, h: pose.h, tilt: pose.tilt,
      }));
      v3.setDynamic([...vehicles, ...this.scenery(w), ...this.ghost(w)]);
      const at = this.train ? w.poseOf(this.train) : null;
      if (at && this.camera !== "tabletop" && !this.placing) this.followCamera(at, w);
      else v3.follow = null;
      this.updateSpeed(w);
    }
    this.raf = requestAnimationFrame(() => this.frame());
  }

  /** What a vehicle is drawn as: its model, at the model's own size, or a plain body of its kind. */
  private shape(v: { kind: string; length: number; model?: string }) {
    const md = modelById(v.model);
    if (md) return { kind: `model:${md.id}`, length: md.length, width: md.width, height: md.height };
    const gauge = 16.5;
    return { kind: v.kind, length: v.length - 2, width: gauge * 1.9, height: v.kind === "loco" ? gauge * 3 : gauge * 2.6 };
  }

  /** Signal masts with their lamps lit as the engine sets them, and a lever beside each point. */
  private scenery(w: World): DynamicVehicle[] {
    const e = this.ctl.engine, cfg = this.ctl.cfg;
    if (this.zGraph !== w.graph) { this.zCache.clear(); this.zGraph = w.graph; }
    const zAt = (key: string, x: number, y: number) => {
      let z = this.zCache.get(key);
      if (z === undefined) { const at = w.graph.nearest({ x, y }, 40); z = at ? w.graph.pose(at).z : 0; this.zCache.set(key, z); }
      return z;
    };
    const out: DynamicVehicle[] = [];
    const box = (x: number, y: number, z: number, h: number, l: number, wd: number, ht: number, color: [number, number, number]) =>
      out.push({ kind: "box", x, y, z, h, length: l, width: wd, height: ht, color });
    this.targets = [];
    const dark: [number, number, number] = [0.13, 0.14, 0.14];
    const lampOff: [number, number, number] = [0.23, 0.25, 0.24];
    const LAMP: Record<string, [number, number, number]> = { red: [1, 0.35, 0.28], yellow: [1, 0.76, 0.2], green: [0.24, 0.86, 0.43] };
    for (const sg of cfg.signals) {
      const z = zAt(`s${sg.id}`, sg.x, sg.y);
      // beside the track on the right, as on the plan
      const x = sg.x + Math.sin(sg.h) * 26, y = sg.y - Math.cos(sg.h) * 26;
      const aspect = e.aspects.get(sg.id) ?? "red";
      box(x, y, z, sg.h, 3, 3, 70, dark);
      box(x, y, z + 58, sg.h, 6, 10, 28, dark);
      // the lamps face the trains coming
      const fx = x - Math.cos(sg.h) * 3.5, fy = y - Math.sin(sg.h) * 3.5;
      (["red", "yellow", "green"] as const).forEach((col, i) => {
        if (col === "yellow" && sg.yellow === undefined) return;
        box(fx, fy, z + 78 - i * 8, sg.h, 2, 6, 6, aspect === col ? LAMP[col] : lampOff);
      });
      if (sg.mode === "stop") box(x, y, z + 50, sg.h, 4, 12, 4, [0.95, 0.95, 0.95]);
      this.targets.push({ kind: "signal", id: sg.id, x, y, z: z + 70 });
    }
    const under = w.itemsUnder();
    for (const pc of cfg.points) {
      const it = this.app.p.items.find((i) => i.id === pc.item);
      if (!it) continue;
      const toe = geom(it).ends[0];
      // the toe's heading points out of the point; the lever stands to its right, a little way in
      const ih = toe.h + Math.PI;
      const x = toe.x + Math.cos(ih) * 20 + Math.sin(ih) * 26, y = toe.y + Math.sin(ih) * 20 - Math.cos(ih) * 26;
      const z = (it.z[0] ?? 0);
      const locked = under.has(it.id);
      const col: [number, number, number] = locked ? [0.4, 0.4, 0.4] : pc.state ? [0.89, 0.65, 0.28] : [0.88, 0.89, 0.86];
      box(x, y, z, ih + (pc.state ? 0.5 : -0.5), 12, 4, 8, col);
      box(x, y, z, ih, 8, 8, 4, dark);
      this.targets.push({ kind: "point", id: it.id, x, y, z: z + 6 });
    }
    // coupler markers: only the one under the pointer shows
    const accent = hexRgb(this.token("--hud-accent"));
    for (const k of w.couplers()) {
      const id = `${k.consist}:${k.after}`;
      if (id === this.hoverCoupler) box(k.x, k.y, k.z + 14, 0, 7, 7, 7, accent);
      this.targets.push({ kind: "coupler", id: k.consist, after: k.after, x: k.x, y: k.y, z: k.z + 16 });
    }
    return out;
  }

  /** A click in the 3D view: the nearest point lever or signal within reach of it. */
  private pick(cx: number, cy: number) {
    if (this.placing) { this.hoverAt(cx, cy); if (this.placing.ghost) this.placeHere(); else if (this.placing.error) toast(this.placing.error); return; }
    const best = this.nearestTarget(cx, cy);
    if (!best) return;
    if (best.kind === "coupler") {
      const err = this.world()?.uncouple(best.id, best.after!);
      if (err) toast(err); else { this.app.commit(); toast("Uncoupled."); }
      this.hoverCoupler = null;
      return;
    }
    if (best.kind === "point") this.throwPoint(best.id);
    else {
      const sg = this.ctl.cfg.signals.find((x) => x.id === best!.id);
      if (sg) this.ctl.act({ c: "signal", id: sg.id, mode: sg.mode === "stop" ? "auto" : "stop" });
    }
  }

  /** The clickable thing nearest a canvas point, within 30 px. */
  private nearestTarget(cx: number, cy: number) {
    const v3 = this.app.view3d;
    if (!v3) return null;
    let best: (typeof this.targets)[number] | null = null, bd = 30;
    for (const t of this.targets) {
      const s = v3.toCanvas(t.x, t.y, t.z);
      if (!s) continue;
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /** The pointer over the scene: the ghost train follows it when placing; otherwise couplers light up. */
  private hoverAt(cx: number, cy: number) {
    const w = this.world(), v3 = this.app.view3d;
    if (!w || !v3) return;
    if (!this.placing) {
      const t = this.nearestTarget(cx, cy);
      this.hoverCoupler = t?.kind === "coupler" ? `${t.id}:${t.after}` : null;
      v3.canvas.style.cursor = t ? "pointer" : "";
      return;
    }
    if (this.samples.graph !== w.graph) this.samples = { graph: w.graph, list: w.graph.samples(20) };
    let best: TrackPos | null = null, bd = 28;
    for (const a of this.samples.list) {
      const p = w.graph.pose(a), s = v3.toCanvas(p.x, p.y, p.z + 5);
      if (!s) continue;
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; best = a; }
    }
    this.placing.front = best;
    this.refit();
  }

  /** Check the spot under the pointer for the consist being placed, facing the way chosen. */
  private refit() {
    const pl = this.placing, w = this.world();
    if (!pl || !w) return;
    pl.ghost = null; pl.error = null;
    if (pl.front) {
      const f = w.fit(pl.id, { ...pl.front, dir: pl.dir });
      if ("error" in f) pl.error = f.error; else pl.ghost = f.at;
    }
    if (this.refs.placeNote) {
      this.refs.placeNote.textContent = pl.error ?? (pl.ghost ? "Click, or press Enter, to put it here." : "Point at the track where the front should go, or use the arrow keys.");
      this.refs.placeNote.classList.toggle("bad", !!pl.error);
    }
  }

  /** Start placing a consist: the camera stops following, and a ghost of the train follows the pointer. */
  startPlacing(id: string) {
    const w = this.world();
    if (!w) return;
    closeDialog();
    w.sync();
    const c = w.consists.find((x) => x.id === id);
    if (!c) return;
    this.placing = { id, dir: 1, front: null, ghost: null, error: null };
    if (this.camera !== "tabletop") { this.camera = "tabletop"; this.app.view3d?.resetCamera(); this.syncHud(); }
    if (this.app.view3d) this.app.view3d.follow = null;
    this.refs.placeCard?.remove();
    const note = h("p", { "aria-live": "polite", id: "drive-place-note" }, "Point at the track where the front should go, or use the arrow keys.");
    const card = h("div", { class: "hud-card neutral", role: "group", "aria-label": "Place a train", id: "drive-place" },
      h("h3", {}, `Place ${this.consistName(id)}`), note,
      h("div", { class: "row" },
        h("button", { class: "hud-btn", type: "button", onclick: () => { if (this.placing) { this.placing.dir = this.placing.dir === 1 ? -1 : 1; this.refit(); } } }, "Turn round (R)"),
        h("button", { class: "hud-btn", type: "button", id: "drive-place-cancel", onclick: () => this.stopPlacing() }, "Cancel (Esc)")));
    this.app.el.view3d.append(card);
    this.refs.placeCard = card; this.refs.placeNote = note;
  }

  /** Where the keyboard starts the ghost: where the consist stands, else the selected train, else the first plain track. */
  private placingStart(w: World): TrackPos | null {
    const pl = this.placing!;
    const c = w.consists.find((x) => x.id === pl.id);
    if (c?.at.length) return { ...c.at[0] };
    const t = this.train ? w.consistOf(this.train) : undefined;
    if (t?.at.length) return { ...t.at[0] };
    const pts = new Set(this.ctl.cfg.points.map((q) => q.item));
    const item = this.app.p.items.find((i) => !pts.has(i.id));
    return item ? w.graph.middleOf(item.id) : null;
  }

  /** Slide the ghost `d` mm along the track (through the points as they're set). */
  private nudgePlacing(d: number) {
    const pl = this.placing, w = this.world();
    if (!pl || !w) return;
    if (!pl.front) pl.front = this.placingStart(w);
    else pl.front = w.graph.advance({ ...pl.front, dir: 1 }, d, (id) => this.ctl.cfg.points.find((q) => q.item === id)?.state).pos;
    if (pl.front) pl.front = { ...pl.front, dir: 1 };
    this.refit();
  }

  /** Jump the ghost to the middle of the next (or previous) piece of track: the way to reach a siding. */
  private jumpPlacing(by: 1 | -1) {
    const pl = this.placing, w = this.world();
    if (!pl || !w) return;
    const items = this.app.p.items;
    if (!items.length) return;
    const at = pl.front ? items.findIndex((i) => i.id === pl.front!.item) : -1;
    const next = items[(Math.max(-1, at) + by + items.length) % items.length];
    pl.front = w.graph.middleOf(next.id);
    this.refit();
  }

  private stopPlacing() {
    this.placing = null;
    this.refs.placeCard?.remove(); this.refs.placeCard = undefined; this.refs.placeNote = undefined;
  }

  private placeHere() {
    const pl = this.placing, w = this.world();
    if (!pl?.front || !w) return;
    const err = w.placeConsist(pl.id, { ...pl.front, dir: pl.dir });
    if (err) { toast(err); return; }
    const train = w.consists.find((x) => x.id === pl.id)?.train;
    this.stopPlacing();
    this.app.commit();
    if (train) this.train = train;
    this.buildHud();
    toast(`${this.consistName(pl.id)} is on the track.`);
  }

  /** The placing ghost: the consist's vehicles where they'd stand, or its front vehicle in red where it won't fit. */
  private ghost(w: World): DynamicVehicle[] {
    const pl = this.placing;
    const c = pl ? w.consists.find((x) => x.id === pl.id) : undefined;
    if (!pl?.front || !c) return [];
    const ok = hexRgb(this.token("--ghost-ok")), bad = hexRgb(this.token("--ghost-bad"));
    const at = pl.ghost ?? [{ ...pl.front, dir: pl.dir }];
    return at.map((a, i) => {
      const p = w.graph.pose(a), v = c.vehicles[i];
      return { ...this.shape(v), color: pl.ghost ? ok : bad, x: p.x, y: p.y, z: p.z + 5, h: p.h };
    });
  }

  /** The catalogue's models, for the Trains dialog and for checking them (tenders too, when asked). */
  catalogue(tenders = false): string[] { return MODELS.filter((m) => tenders || m.group !== "tender").map((m) => m.id); }
  vehiclesFor(id: string) { const md = modelById(id); let n = 0; return md ? vehiclesOfModel(md, () => `cat${n++}`) : []; }

  private token(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  private consistName(id: string): string {
    const sc = this.ctl.cfg.consists?.find((x) => x.id === id);
    const t = sc?.train ? this.ctl.cfg.trains.find((x) => x.id === sc.train) : undefined;
    if (t) return t.name;
    const n = sc?.vehicles.length ?? 0;
    return `the rake of ${n} ${n === 1 ? "vehicle" : "vehicles"}`;
  }

  // ---------- the Trains dialog (S07) ----------

  /** Make up trains: pick a train (or a rake of wagons), add stock, reorder, place it on the track. */
  openTrains() {
    const w = this.world();
    if (!w) { toast("Making up trains needs the simulator running in this window."); return; }
    if (this.placing) this.stopPlacing();
    const cfg = this.ctl.cfg;
    if (!this.editing || !cfg.consists?.some((x) => x.id === this.editing)) {
      const t = this.train ?? cfg.trains[0]?.id;
      if (t) { this.editing = w.stockOf(t).id; this.app.commit(); }
      else this.editing = cfg.consists?.[0]?.id ?? null;
    }
    this.picked = null;
    const body = h("div", { class: "trains-dlg" });
    this.trainsBody = body;
    this.renderTrains();
    dialog("Trains and rolling stock", body, [{ label: "Done", primary: true }], { wide: true });
  }

  private renderTrains() {
    const body = this.trainsBody, w = this.world();
    if (!body || !w) return;
    const cfg = this.ctl.cfg;
    // redrawing replaces the buttons: keep the keyboard where it was (and Esc working)
    const was = document.activeElement as HTMLElement | null;
    const key = was && body.contains(was) ? (["id", "data-kind", "data-model", "data-i"].map((k) => was.getAttribute(k) !== null ? `[${k}="${was.getAttribute(k)}"]` : "").find((x) => x) ?? null) : null;
    clear(body);
    if (key) queueMicrotask(() => { if (!body.contains(document.activeElement)) (body.querySelector<HTMLElement>(key) ?? body.querySelector<HTMLElement>("button"))?.focus(); });
    const sc = cfg.consists?.find((x) => x.id === this.editing);
    // which train or rake
    const which = h("select", { id: "trains-which", onchange: () => {
      const v = which.value;
      if (v.startsWith("t:")) { this.editing = w.stockOf(v.slice(2)).id; this.app.commit(); } else this.editing = v.slice(2);
      this.picked = null; this.renderTrains();
    } }) as HTMLSelectElement;
    for (const t of cfg.trains) {
      const own = cfg.consists?.find((x) => x.train === t.id);
      which.append(h("option", { value: own ? `c:${own.id}` : `t:${t.id}` }, t.name));
    }
    for (const r of cfg.consists?.filter((x) => !x.train) ?? []) which.append(h("option", { value: `c:${r.id}` }, `Rake of ${r.vehicles.length} ${r.vehicles.length === 1 ? "vehicle" : "vehicles"} (${r.id})`));
    which.value = sc ? `c:${sc.id}` : which.value;
    const newRake = h("button", { class: "btn btn-sm", type: "button", id: "trains-new-rake", onclick: () => {
      const r = w.newRake([newVehicle("wagon", w.libId(), `v${cfg.nextId++}`)]);
      this.editing = r.id; this.picked = null; this.app.commit(); this.renderTrains();
    } }, "New rake of wagons");
    body.append(h("div", { class: "trains-head" }, h("label", { class: "field" }, h("span", { class: "field-label" }, "Make up"), which), newRake));
    if (!sc) { body.append(h("p", {}, "No trains yet: add one in Control > Drive, or start a rake of wagons.")); return; }

    const c = w.consists.find((x) => x.id === sc.id);
    const onTrack = !!c?.at.length;
    const len = sc.vehicles.reduce((a, v) => a + v.length + 2, -2);
    const train = sc.train ? cfg.trains.find((t) => t.id === sc.train) : undefined;
    const noLoco = !!train && !sc.vehicles.some((v) => v.kind === "loco");
    const lost = !onTrack && !!sc.at;   // it stood on the track, but no longer fits there
    body.append(h("p", { class: "trains-sum" }, `${sc.vehicles.length} ${sc.vehicles.length === 1 ? "vehicle" : "vehicles"}, ${Math.round(len)} mm. `,
      onTrack ? h("span", { class: "chip chip-ok" }, "On the track") : h("span", { class: "chip chip-warn" }, "Not on the track"),
      noLoco ? h("span", { class: "chip chip-warn" }, " No loco: it can't move") : null));

    // the strip, front first
    const strip = h("ol", { class: "consist-strip", "aria-label": "Vehicles, front first", id: "trains-strip" });
    strip.classList.toggle("bad", lost);
    if (!sc.vehicles.length) strip.append(h("li", { class: "empty" }, "No vehicles yet: add a loco."));
    sc.vehicles.forEach((v, i) => {
      if (i > 0) {
        const gap = h("li", { class: "coupling" });
        if (onTrack && !c!.derailed) gap.append(h("button", { type: "button", class: "coupler-btn", title: `Uncouple between ${i} and ${i + 1}`, "aria-label": `Uncouple between vehicle ${i} and ${i + 1}`,
          onclick: () => { const err = w.uncouple(sc.id, i - 1); if (err) toast(err); else { this.app.commit(); toast("Uncoupled: the vehicles behind stand on their own."); this.renderTrains(); } } }));
        strip.append(gap);
      }
      const b = h("button", { type: "button", class: `veh${this.picked === i ? " on" : ""}`, style: `--veh:${v.color}; width:${Math.max(28, Math.min(120, v.length * 0.45))}px`,
        "aria-label": `${v.name ?? v.kind}, ${i + 1} of ${sc.vehicles.length}`, "aria-pressed": String(this.picked === i), "data-i": String(i),
        onclick: () => { this.picked = this.picked === i ? null : i; this.renderTrains(); this.focusVehicle(); },
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this.picked = i; this.removeVehicle(); }
          else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); this.picked = i; this.moveVehicle(e.key === "ArrowLeft" ? -1 : 1); }
        } });
      strip.append(h("li", {}, b));
    });
    body.append(strip);
    if (lost) body.append(h("p", { class: "trains-bad" }, "Made up like this, it doesn't fit where it stood. Place it again."));

    // the picked vehicle
    const pv = this.picked !== null ? sc.vehicles[this.picked] : undefined;
    if (pv) {
      const i = this.picked!;
      const row = h("div", { class: "trains-veh", role: "group", "aria-label": "Picked vehicle" },
        h("b", {}, `${pv.name ?? pv.kind}, ${pv.length} mm`),
        h("button", { class: "btn btn-sm", type: "button", disabled: i === 0, onclick: () => this.moveVehicle(-1) }, "Move forward"),
        h("button", { class: "btn btn-sm", type: "button", disabled: i === sc.vehicles.length - 1, onclick: () => this.moveVehicle(1) }, "Move back"),
        h("button", { class: "btn btn-sm btn-danger-ghost", type: "button", id: "trains-remove-veh", onclick: () => this.removeVehicle() }, "Remove"));
      const len = h("input", { type: "number", id: "trains-length", min: "20", max: "400", step: "1", value: String(pv.length), "aria-label": "Length over buffers (mm)",
        onchange: () => { const v = Math.round(+len.value); if (v >= 20 && v <= 400) { pv.length = v; this.changed(); } } }) as HTMLInputElement;
      row.append(h("label", { class: "check" }, "Length ", len, " mm"));
      if (pv.kind !== "loco") {
        const cb = h("input", { type: "checkbox", id: "trains-resistor", checked: !!pv.detectable, onchange: () => { pv.detectable = cb.checked; this.app.commit(); } }) as HTMLInputElement;
        row.append(h("label", { class: "check" }, cb, " Resistor wheelset (current detection sees it)"));
      }
      body.append(row);
    }

    // what to do with it
    const acts = h("div", { class: "trains-acts" },
      h("button", { class: "btn btn-primary", type: "button", id: "trains-place", disabled: !sc.vehicles.length, onclick: () => this.startPlacing(sc.id) }, onTrack ? "Move it on the track" : "Place on the track"),
      h("button", { class: "btn", type: "button", id: "trains-turn", disabled: !onTrack, onclick: () => { w.turnRound(sc.id); this.app.commit(); this.renderTrains(); } }, "Turn round"));
    if (!sc.train) acts.append(h("button", { class: "btn btn-danger-ghost", type: "button", id: "trains-remove", onclick: () => { w.remove(sc.id); this.editing = null; this.app.commit(); closeDialog(); this.openTrains(); } }, "Take off the layout"));
    body.append(acts);
    // stock to add
    body.append(h("h3", {}, "Add to the back"));
    const tiles = h("div", { class: "stock-tiles" });
    for (const st of STOCK) {
      const len = newVehicle(st.kind, w.libId(), "x").length;
      tiles.append(h("button", { type: "button", class: "part-tile stock-tile", "data-kind": st.kind, "aria-label": `Add a ${st.name.toLowerCase()}, ${len} mm`,
        onclick: () => { sc.vehicles.push(newVehicle(st.kind, w.libId(), `v${cfg.nextId++}`, st.kind === "loco" && train ? train.color : undefined)); this.changed(); } },
        silhouette(st.kind), h("span", { class: "name" }, st.name), h("span", { class: "len" }, `${len} mm`)));
    }
    body.append(tiles);
    // detailed models, at their real lengths, by type
    // British stock is OO, European H0: the layout's own scale first, the other a choice away
    this.catScale ??= scaleOf(w.libId()) === 87 ? "H0" : "OO";
    const scaleSel = h("select", { id: "trains-scale", "aria-label": "Which models", onchange: () => { this.catScale = scaleSel.value as typeof this.catScale; this.renderTrains(); } },
      h("option", { value: "OO" }, "British (OO, 1:76)"), h("option", { value: "H0" }, "European (H0, 1:87)"), h("option", { value: "all" }, "All")) as HTMLSelectElement;
    scaleSel.value = this.catScale!;
    body.append(h("div", { class: "trains-head" }, h("h3", {}, "Models"), h("label", { class: "field" }, h("span", { class: "field-label" }, "Show"), scaleSel)));
    const GROUPS: [ModelGroup, string][] = [["steam", "Steam locomotives"], ["diesel", "Diesel locomotives"], ["electric", "Electric locomotives"], ["coach", "Coaches"], ["wagon", "Wagons"]];
    for (const [g, title] of GROUPS) {
      const inGroup = MODELS.filter((x) => x.group === g && (this.catScale === "all" || (x.scale ?? "OO") === this.catScale));
      if (!inGroup.length) continue;
      body.append(h("h3", {}, title));
      const models = h("div", { class: "stock-tiles", role: "group", "aria-label": title });
      for (const md of inGroup) {
        const t = modelById(md.tender), len = md.length + (t ? t.length + 2 : 0);
        models.append(h("button", { type: "button", class: "part-tile stock-tile", "data-model": md.id, "aria-label": `Add a ${md.maker ? md.maker + " " : ""}${md.name}${t ? " and its tender" : ""}, ${len} mm`, title: md.note,
          onclick: () => { sc.vehicles.push(...vehiclesOfModel(md, () => `v${cfg.nextId++}`)); this.changed(); } },
          h("span", { class: "swatch", style: `background:${md.color}`, "aria-hidden": "true" }), silhouette(md.kind), h("span", { class: "name" }, md.name), h("span", { class: "len" }, `${md.maker ? md.maker + " · " : ""}${md.scale === "H0" ? "H0 · " : ""}${len} mm${t ? " with tender" : ""}`)));
      }
      body.append(models);
    }

  }

  private focusVehicle() {
    // the strip was just redrawn: keep the keyboard on the picked vehicle
    if (this.picked !== null) this.trainsBody?.querySelector<HTMLElement>(`.veh[data-i="${this.picked}"]`)?.focus();
  }

  /** The made-up consist changed: save it (the world keeps its front where it stood) and redraw. */
  private changed() {
    this.app.commit();
    this.world()?.sync();
    this.renderTrains();
  }

  private removeVehicle() {
    const sc = this.ctl.cfg.consists?.find((x) => x.id === this.editing);
    if (!sc || this.picked === null) return;
    sc.vehicles.splice(this.picked, 1);
    if (!sc.vehicles.length && !sc.train) { this.world()?.remove(sc.id); this.editing = null; this.app.commit(); closeDialog(); this.openTrains(); return; }
    this.picked = sc.vehicles.length ? Math.min(this.picked, sc.vehicles.length - 1) : null;
    this.changed();
    this.focusVehicle();
  }

  private moveVehicle(by: -1 | 1) {
    const sc = this.ctl.cfg.consists?.find((x) => x.id === this.editing);
    if (!sc || this.picked === null) return;
    const j = this.picked + by;
    if (j < 0 || j >= sc.vehicles.length) return;
    [sc.vehicles[this.picked], sc.vehicles[j]] = [sc.vehicles[j], sc.vehicles[this.picked]];
    this.picked = j;
    this.changed();
    this.focusVehicle();
  }

  /** Throw a point to its next road, unless a train stands on it. */
  private throwPoint(item: string) {
    const w = this.world();
    if (w?.itemsUnder().has(item)) { toast("A train is standing on that point."); return; }
    const pc = this.ctl.cfg.points.find((q) => q.item === item);
    if (!pc) return;
    const roads = Math.max(2, pc.us.length);
    this.ctl.act({ c: "point", item, state: (pc.state + 1) % roads });
  }

  /**
   * Chase: behind and above the train, looking past it along the track. Cab: at the loco's front, looking
   * down the track ahead. Both follow the track round curves rather than the loco's heading.
   */
  private followCamera(at: TrackPose, w: World) {
    const c = this.train ? w.consistOf(this.train) : undefined;
    if (!c?.at.length) return;
    const way = c.travel;
    const li = Math.max(0, c.vehicles.findIndex((v) => v.kind === "loco"));
    const loco = c.at[li], half = c.vehicles[li].length / 2;
    const along = (from: typeof loco, d: number) => w.graph.pose(w.graph.advance(from, way * d, (id) => this.ctl.cfg.points.find((q) => q.item === id)?.state).pos);
    const lead = way === 1 ? c.at[0] : c.at[c.at.length - 1], tail = way === 1 ? c.at[c.at.length - 1] : c.at[0];
    const leadHalf = c.vehicles[way === 1 ? 0 : c.at.length - 1].length / 2, tailHalf = c.vehicles[way === 1 ? c.at.length - 1 : 0].length / 2;
    let eye: TrackPose, look: TrackPose, up: number, lookUp: number;
    if (this.camera === "chase") { eye = along(tail, -(tailHalf + 300)); look = along(lead, leadHalf + 250); up = 150; lookUp = 25; }
    else { eye = along(loco, half + 6); look = along(loco, half + 450); up = 40; lookUp = 25; }
    void at;
    const want = { eye: [eye.x, eye.y, eye.z + up] as [number, number, number], look: [look.x, look.y, look.z + lookUp] as [number, number, number] };
    // smooth the chase camera; the cab is fixed to the loco
    const k = this.camera === "cab" || !this.eye ? 1 : 0.15;
    const mix = (a: number[] | null, b: number[]) => (a ? a.map((x, n) => x + (b[n] - x) * k) : b) as [number, number, number];
    this.eye = mix(this.eye, want.eye); this.look = mix(this.look, want.look);
    this.app.view3d!.follow = { eye: this.eye, target: this.look };
  }

  private updateSpeed(w: World) {
    const r = this.refs;
    if (!r.speed || !this.train) return;
    const kmh = w.scaleKmh(this.train);
    const c = w.consistOf(this.train);
    const shown = kmh === null ? Math.abs(c?.speed ?? 0) : this.units === "mph" ? kmh / 1.609 : kmh;
    r.speed.textContent = String(Math.round(shown));
    // amber close to the curve limit ahead, red over it (only seen with derailments off: the train is held)
    const m = w.curveMargin(this.train);
    r.speedBox?.classList.toggle("near", m >= 0.85 && m <= 1 && !c?.held);
    r.speedBox?.classList.toggle("over", m > 1 || !!c?.held);
    if (r.tag) { r.tag.hidden = !(m >= 0.85 || c?.held); r.tag.textContent = c?.held ? "Held" : "Curve"; }
    this.syncHud();
  }
}
