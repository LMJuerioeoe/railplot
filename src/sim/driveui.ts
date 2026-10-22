// The drive view: the layout in 3D with the simulated trains moving on it, a HUD to drive them, and
// cameras that follow a train. It runs over the 3D view and the control loop that already exist.
import type { App } from "../app";
import { SimLink } from "../control/link";
import { quickStart } from "../control/engine";
import { h, clear } from "../ui/dom";
import { confirmDialog, toast } from "../ui/dialogs";
import { store } from "../platform";
import { DynamicVehicle } from "../view3d";
import { World, scaleOf, worldFor } from "./world";
import { TrackPose } from "./track";

export type Camera = "tabletop" | "chase" | "cab";
const CAMERAS: Camera[] = ["tabletop", "chase", "cab"];
const CAMERA_NAMES: Record<Camera, string> = { tabletop: "Tabletop", chase: "Chase", cab: "Cab" };
const PREFS = "railplot.drive.v1";

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
  private refs: { speed?: HTMLElement; unit?: HTMLElement; throttle?: HTMLInputElement; throttleLabel?: HTMLElement; trains?: HTMLElement; camera?: HTMLElement } = {};

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
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.frame());
  }

  stop() {
    if (!this.open) return;
    this.open = false;
    cancelAnimationFrame(this.raf);
    this.hud?.remove(); this.hud = null;
    this.app.root.classList.remove("is-driving");
    if (this.app.view3d) { this.app.view3d.follow = null; this.app.view3d.setDynamic([]); }
  }

  // ---------- HUD ----------

  private buildHud() {
    this.hud?.remove();
    const cfg = this.ctl.cfg;
    const trains = h("div", { class: "hud-group hud-trains", role: "radiogroup", "aria-label": "Train" });
    const throttle = h("input", { type: "range", min: "-100", max: "100", step: "1", value: "0", id: "drive-throttle", "aria-label": "Throttle",
      oninput: () => this.setThrottle(+throttle.value / 100) }) as HTMLInputElement;
    const throttleLabel = h("span", {}, "Stopped");
    const speed = h("b", { id: "drive-speed" }, "0"), unit = h("span", {}, this.unitName());
    const cam = h("button", { class: "hud-chip", type: "button", id: "drive-camera", onclick: () => this.nextCamera() });
    this.hud = h("div", { class: "hud", role: "toolbar", "aria-label": "Train controls", id: "drive-hud" },
      trains,
      h("div", { class: "hud-throttle" }, h("label", { for: "drive-throttle" }, h("span", {}, "Back"), throttleLabel, h("span", {}, "Forward")), throttle),
      h("div", { class: "hud-speed", "aria-label": "Speed" }, speed, h("span", {}, unit)),
      h("button", { class: "hud-btn", type: "button", id: "drive-stop", title: "Stop this train (Space)", onclick: () => this.setThrottle(0, true) }, "Stop"),
      cam,
      h("button", { class: "hud-btn", type: "button", id: "drive-exit", title: "Back to the plan (Esc)", onclick: () => this.app.toggle3d(false) }, "Exit"));
    this.refs = { speed, unit, throttle, throttleLabel, trains, camera: cam };
    for (const t of cfg.trains.filter((x) => x.block)) {
      trains.append(h("button", { class: "hud-chip", type: "button", role: "radio", "data-train": t.id, style: `--train:${t.color}`,
        onclick: () => { this.train = t.id; this.eye = null; this.syncHud(); } }, h("span", { class: "dot" }), t.name));
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
    for (const b of r.trains?.querySelectorAll<HTMLElement>("[data-train]") ?? []) b.setAttribute("aria-checked", String(b.dataset.train === this.train));
    if (r.camera) { clear(r.camera); r.camera.append(`${CAMERA_NAMES[this.camera]} `, h("kbd", {}, "C")); r.camera.title = "Change the camera (C)"; }
    const target = this.train ? this.ctl.engine.run(this.train)?.target ?? 0 : 0;
    if (r.throttle && document.activeElement !== r.throttle) r.throttle.value = String(Math.round(target * 100));
    if (r.throttleLabel) r.throttleLabel.textContent = target === 0 ? "Stopped" : `${Math.round(Math.abs(target) * 100)}% ${target > 0 ? "forward" : "back"}`;
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
    const target = this.train ? this.ctl.engine.run(this.train)?.target ?? 0 : 0;
    const step = e.shiftKey ? 0.2 : 0.05;
    if (k === "e" || k === "E" || k === "ArrowRight" || k === "ArrowUp") { this.setThrottle(target + step, true); return true; }
    if (k === "q" || k === "Q" || k === "ArrowLeft" || k === "ArrowDown") { this.setThrottle(target - step, true); return true; }
    if (e.code === "Space") { e.preventDefault(); if (e.shiftKey) this.ctl.act({ c: "stopAll" }); else this.setThrottle(0, true); return true; }
    if (k === "c" || k === "C") { this.nextCamera(); return true; }
    if (k === "u" || k === "U") { this.units = this.units === "kmh" ? "mph" : "kmh"; this.savePrefs(); if (this.refs.unit) this.refs.unit.textContent = this.unitName(); return true; }
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
      const gauge = 16.5, railTop = 5;
      const vehicles: DynamicVehicle[] = w.vehiclePoses().map(({ vehicle, pose }) => ({
        kind: vehicle.kind, length: vehicle.length - 2, width: gauge * 1.9, height: vehicle.kind === "loco" ? gauge * 3 : gauge * 2.6,
        color: hexRgb(vehicle.color), x: pose.x, y: pose.y, z: pose.z + railTop, h: pose.h,
      }));
      v3.setDynamic(vehicles);
      const at = this.train ? w.poseOf(this.train) : null;
      if (at && this.camera !== "tabletop") this.followCamera(at, w);
      else v3.follow = null;
      this.updateSpeed(w);
    }
    this.raf = requestAnimationFrame(() => this.frame());
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
    this.syncHud();
  }
}
