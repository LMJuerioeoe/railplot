// Talking to controllers: ESP32 boards over HTTP on the local network, DCC-EX command stations
// over USB or the network, or the built-in simulator.
import { ControlEngine, Frame } from "./engine";
import { worldFor } from "../sim/world";
import { Controller, DCCEX_CAB_BASE } from "./types";

export interface LinkStatus {
  online: boolean;
  accepted: boolean;          // this device is the one driving
  fw?: string;
  message?: string;
  inputs: (n: number) => boolean;
  mA: number[];
  /** mA each driver drew during the detection pulse into its unpowered block (ESP32 firmware 0.4 and later). */
  idle?: number[];
}

export interface Link {
  controller: Controller;
  /** What the connection depends on (see linkKey). */
  key: string;
  status: LinkStatus | null;
  busy: boolean;
  /** Send outputs and read inputs. `take` claims driving from another device. */
  exchange(frame: Frame, take: boolean): Promise<LinkStatus | null>;
  /** Links that need a person's go-ahead to connect (USB in a browser). */
  connect?(): Promise<void>;
  close?(): void;
}

/** What a link's connection depends on: change any of it and the link reconnects. */
export function linkKey(c: Controller) { return `${c.kind}|${c.host}|${c.conn ?? ""}|${c.cabBase ?? ""}`; }

export const CLIENT_ID = (() => {
  try {
    const k = "railplot.client";
    const v = sessionStorage.getItem(k) ?? Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(k, v);
    return v;
  } catch { return Math.random().toString(36).slice(2, 10); }
})();

export function baseUrl(c: Controller): string {
  if (!c.host) return typeof location !== "undefined" && location.protocol.startsWith("http") ? "" : "http://railplot.local";
  return /^https?:\/\//.test(c.host) ? c.host.replace(/\/$/, "") : `http://${c.host}`;
}

async function getJson(url: string, ms = 1200): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function postText(url: string, body: string, ms = 5000): Promise<void> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    // text/plain keeps this a "simple" request, so the controller needs no CORS preflight
    const r = await fetch(url, { method: "POST", body, headers: { "Content-Type": "text/plain" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } finally { clearTimeout(t); }
}

/** Upload a file to a controller as a form post (streams to its flash, no CORS preflight needed). */
export async function uploadFile(url: string, name: string, text: string, ms = 30000): Promise<void> {
  const fd = new FormData();
  fd.append("file", new Blob([text], { type: "text/plain" }), name);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method: "POST", body: fd, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } finally { clearTimeout(t); }
}

export async function fetchText(url: string, ms = 5000): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    return r.ok ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/** Is this page being served by a Railplot controller? */
export async function servedByController(): Promise<boolean> {
  if (typeof location === "undefined" || !location.protocol.startsWith("http")) return false;
  try { const j = await getJson("/api/status", 800); return typeof j?.fw === "string" && j.fw.startsWith("railplot-controller"); }
  catch { return false; }
}

const enc = (pairs: [number, number][]) => pairs.map(([a, b]) => `${a}:${b}`).join(",");

export class Esp32Link implements Link {
  status: LinkStatus | null = null;
  busy = false;
  key: string;
  private fails = 0;
  constructor(public controller: Controller) { this.key = linkKey(controller); }

  async exchange(frame: Frame, take: boolean): Promise<LinkStatus | null> {
    this.busy = true;
    try {
      const q = `cid=${CLIENT_ID}&take=${take ? 1 : 0}&b=${enc(frame.blocks)}&s=${enc(frame.servos)}&o=${enc(frame.outputs)}`;
      const j = await getJson(`${baseUrl(this.controller)}/api/frame?${q}`);
      this.fails = 0;
      const words: number[] = Array.isArray(j.in) ? j.in : [];
      this.status = {
        online: true, accepted: !!j.accepted, fw: j.fw,
        message: j.accepted ? undefined : "Another phone or computer is driving.",
        inputs: (n) => ((words[n >> 4] ?? 0) >> (n & 15) & 1) === 1,
        mA: Array.isArray(j.mA) ? j.mA : [],
        idle: Array.isArray(j.dmA) ? j.dmA : undefined,
      };
    } catch (e) {
      const blocked = typeof location !== "undefined" && location.protocol === "https:" && baseUrl(this.controller).startsWith("http:");
      const message = blocked
        ? "This page is served over https, which browsers don't let talk to a controller on your network. Use the desktop app, the offline file, or open the controller's own address."
        : `Can't reach ${this.controller.host || "the controller"}. Check it's powered and on the same Wi-Fi.`;
      if (++this.fails >= 2) this.status = { online: false, accepted: false, message, inputs: () => false, mA: [] };
    } finally { this.busy = false; }
    return this.status;
  }
}

// ---------- simulator ----------

/**
 * A pretend controller over the simulated world (src/sim/world.ts): trains of vehicles on the real
 * track, moved by the power of the block under the loco, tripping the sensors they pass over and
 * drawing current, just like the real thing. Every simulated controller shares one world.
 */
export class SimLink implements Link {
  status: LinkStatus | null = null;
  busy = false;
  key: string;
  /** Blocks with a simulated wagon left in them, for trying current detection. */
  strays = new Set<string>();
  /** Full speed in mm per second at full power. */
  fullSpeed = 800;
  /** The clock, in ms (tests replace it). */
  clock: () => number = () => performance.now();

  constructor(public controller: Controller, private engine: () => ControlEngine) { this.key = linkKey(controller); }

  get world() { return worldFor(this.engine()); }

  async exchange(_frame: Frame): Promise<LinkStatus | null> {
    const w = this.world;
    w.fullSpeed = this.fullSpeed;
    w.advanceTo(this.clock());
    const r = w.readings(this.controller.id, this.strays);
    this.status = { online: true, accepted: true, fw: "simulator", inputs: (n) => r.inputs.has(n), mA: r.mA, idle: r.idle };
    return this.status;
  }

  /** Where a simulated train's loco is on the plan. */
  poseOf(trainId: string) { return this.world.poseOf(trainId); }
}

// ---------- DCC-EX ----------

/** A byte pipe to a DCC-EX command station: Web Serial in a browser, or TCP or a serial port on the hub. */
export interface Transport {
  readonly connected: boolean;
  readonly error?: string;
  send(text: string): void;
  onText: (text: string) => void;
  close(): void;
}

/**
 * Railplot's side of the DCC-EX native protocol. Each Railplot block on the command station is one
 * TrackManager output (A-H) in DC mode with its own cab number, and Railplot sets that cab's speed.
 * Pure: it turns frames into commands and reads replies, without knowing how the bytes travel.
 */
export class DccExProtocol {
  private buf = "";
  private ready = false;
  private sentSpeed = new Map<number, string>();
  private sentTurnout = new Map<number, number>();
  private sentOut = new Map<number, boolean>();
  private lastRefresh = -1e9;
  private lastCurrent = -1e9;
  active = new Set<number>();
  private latched = new Set<number>();
  mA: number[] = [];
  version = "";
  lastRx = 0;
  rejected = 0;

  constructor(public cabBase = DCCEX_CAB_BASE) {}

  cab(channel: number) { return this.cabBase + channel; }
  static track(channel: number) { return String.fromCharCode(65 + channel); }

  /** Feed received text; returns the complete messages it contained. */
  receive(text: string, now: number): string[] {
    this.buf += text;
    const out: string[] = [];
    for (;;) {
      const a = this.buf.indexOf("<");
      if (a < 0) { this.buf = ""; break; }
      const b = this.buf.indexOf(">", a);
      if (b < 0) { this.buf = this.buf.slice(a); if (this.buf.length > 4096) this.buf = ""; break; }
      const msg = this.buf.slice(a + 1, b).trim();
      this.buf = this.buf.slice(b + 1);
      out.push(msg);
      this.handle(msg, now);
    }
    return out;
  }

  private handle(msg: string, now: number) {
    this.lastRx = now;
    const parts = msg.split(/\s+/);
    const op = msg[0];
    // "<Q id>" a sensor came on, "<q id>" it went off. ("<Q id vpin pullup>" is a sensor list entry, not an event.)
    const id = +(parts[0].length > 1 ? parts[0].slice(1) : parts[1] ?? "");
    const event = (parts[0].length > 1 ? parts.length === 1 : parts.length === 2) && Number.isFinite(id);
    if (op === "Q" && event) { this.active.add(id); this.latched.add(id); }
    else if (op === "q" && event) this.active.delete(id);
    else if (msg.startsWith("jI")) this.mA = msg.slice(2).trim().split(/\s+/).filter(Boolean).map(Number).map((x) => (Number.isFinite(x) ? x : 0));
    else if (msg.startsWith("iDCC")) { this.version = msg.slice(1).split("/")[0].trim(); }
    else if (msg === "X") this.rejected++;
  }

  /** Inputs since the last call: a sensor counts if it is on now or switched on in between. */
  takeInputs(): (n: number) => boolean {
    const on = new Set([...this.active, ...this.latched]);
    this.latched.clear();
    return (n) => on.has(n);
  }

  /** Commands that set up the command station: each used track to DC with its cab, and powered. */
  setup(channels: number[]): string[] {
    const out = ["<s>"];
    for (const ch of channels) out.push(`<= ${DccExProtocol.track(ch)} DC ${this.cab(ch)}>`);
    // changing a track's mode turns its power off
    for (const ch of channels) out.push(`<1 ${DccExProtocol.track(ch)}>`);
    for (const ch of channels) out.push(`<t ${this.cab(ch)} 0 1>`);
    this.ready = true;
    this.lastRefresh = -1e9; this.lastCurrent = -1e9;
    this.sentSpeed.clear(); this.sentTurnout.clear(); this.sentOut.clear();
    return out;
  }

  get isReady() { return this.ready; }
  reset() { this.ready = false; this.buf = ""; }

  /** Commands for a frame: only what changed, with every speed repeated every few seconds. */
  encode(frame: Frame, now: number): string[] {
    const out: string[] = [];
    const refresh = now - this.lastRefresh > 3000;
    if (refresh) this.lastRefresh = now;
    for (const [ch, d] of frame.blocks) {
      const speed = Math.min(126, Math.round((Math.abs(d) / 1023) * 126));
      const cmd = `<t ${this.cab(ch)} ${speed} ${d < 0 ? 0 : 1}>`;
      if (refresh || this.sentSpeed.get(ch) !== cmd) { out.push(cmd); this.sentSpeed.set(ch, cmd); }
    }
    for (const [id, st] of frame.turnouts) {
      if (this.sentTurnout.get(id) === st) continue;
      out.push(`<T ${id} ${st}>`);
      this.sentTurnout.set(id, st);
    }
    for (const [vpin, level] of frame.outputs) {
      const on = level > 0;
      if (this.sentOut.get(vpin) === on) continue;
      out.push(on ? `<z ${vpin}>` : `<z -${vpin}>`);
      this.sentOut.set(vpin, on);
    }
    if (now - this.lastCurrent > 1000) { this.lastCurrent = now; out.push("<JI>"); }
    return out;
  }

  /** mA per Railplot driver channel (DCC-EX lists currents in track order). */
  currents(): number[] { return this.mA; }

  stopAll(channels: number[]): string[] {
    return ["<!>", ...channels.map((ch) => `<t ${this.cab(ch)} 0 1>`)];
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class DccExLink implements Link {
  status: LinkStatus | null = null;
  busy = false;
  key: string;
  proto: DccExProtocol;
  private openedAt = 0;
  private wasConnected = false;

  constructor(public controller: Controller, private engine: () => ControlEngine, public transport: Transport | null, private hint = "") {
    this.key = linkKey(controller);
    this.proto = new DccExProtocol(controller.cabBase ?? DCCEX_CAB_BASE);
    this.attach();
  }

  private attach() {
    if (!this.transport) return;
    this.transport.onText = (t) => this.proto.receive(t, now());
  }

  /** Replace the byte pipe (for USB, after the person picks the port). */
  setTransport(t: Transport) {
    this.transport?.close();
    this.transport = t;
    this.proto.reset();
    this.wasConnected = false;
    this.attach();
  }

  private channels() {
    return [...new Set(this.engine().cfg.blocks.filter((b) => b.controller === this.controller.id && b.channel !== undefined).map((b) => b.channel!))].sort();
  }

  async exchange(frame: Frame): Promise<LinkStatus | null> {
    const t = this.transport;
    const tnow = now();
    if (!t || !t.connected) {
      this.wasConnected = false;
      this.proto.reset();
      this.status = { online: false, accepted: false, message: t?.error ?? this.hint ?? "Not connected.", inputs: () => false, mA: [] };
      return this.status;
    }
    if (!this.wasConnected) { this.wasConnected = true; this.openedAt = tnow; this.proto.lastRx = 0; }
    // an Arduino restarts when its USB port opens: give it time to boot before setting it up
    if (!this.proto.isReady) {
      if (this.proto.lastRx === 0 && tnow - this.openedAt < 3000) {
        this.status = { online: true, accepted: false, message: "Waiting for DCC-EX to start…", inputs: () => false, mA: [] };
        return this.status;
      }
      for (const c of this.proto.setup(this.channels())) t.send(c);
    }
    for (const c of this.proto.encode(frame, tnow)) t.send(c);
    const silent = this.proto.lastRx === 0 ? tnow - this.openedAt > 6000 : tnow - this.proto.lastRx > 5000;
    this.status = {
      online: true, accepted: !silent, fw: this.proto.version || "DCC-EX",
      message: silent ? "Connected, but DCC-EX isn't answering. Check it's an EX-CommandStation 5 or newer, and the USB speed is 115200." : undefined,
      inputs: this.proto.takeInputs(),
      mA: this.channelCurrents(),
    };
    return this.status;
  }

  private channelCurrents(): number[] {
    const out: number[] = [];
    this.proto.currents().forEach((v, i) => { out[i] = v; });
    return out;
  }

  close() {
    try { if (this.transport?.connected) for (const c of this.proto.stopAll(this.channels())) this.transport.send(c); } catch { /* closing anyway */ }
    this.transport?.close();
  }
}

// ---------- Web Serial (Chrome and Edge) ----------

type SerialPortLike = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};
const serialApi = (): { requestPort(o?: object): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> } | null =>
  typeof navigator !== "undefined" && (navigator as any).serial ? (navigator as any).serial : null;

export const webSerialSupported = () => !!serialApi() && (typeof isSecureContext === "undefined" || isSecureContext);

// ---------- the desktop app's own serial ports ----------

const tauri = () => (typeof window !== "undefined" ? window.__TAURI__ : undefined);
/** The desktop app reaches USB ports itself (its web view has no Web Serial). */
export const desktopSerial = () => !!tauri()?.event;
/** This window can open a USB port: Web Serial, or the desktop app. */
export const usbSupported = () => webSerialSupported() || desktopSerial();

export interface SerialPortInfo { name: string; usb: boolean; description: string }
export const listSerialPorts = (): Promise<SerialPortInfo[]> => tauri()!.core.invoke("serial_ports");

/** A USB port opened by the desktop app; what comes in arrives as events. */
export class DesktopSerialTransport implements Transport {
  connected = false;
  error?: string;
  onText: (text: string) => void = () => {};
  private id = 0;
  private unlisten: (() => void)[] = [];

  constructor(readonly name: string) {}

  async open() {
    const T = tauri()!;
    try {
      this.unlisten.push(await T.event!.listen<{ id: number; text: string }>("serial-data", (e) => { if (e.payload.id === this.id) this.onText(e.payload.text); }));
      this.unlisten.push(await T.event!.listen<{ id: number; error: string | null }>("serial-closed", (e) => {
        if (e.payload.id !== this.id) return;
        this.connected = false;
        if (e.payload.error) this.error = `The USB connection dropped: ${e.payload.error}`;
      }));
      this.id = await T.core.invoke("serial_open", { name: this.name });
      this.connected = true;
      this.error = undefined;
    } catch (e) {
      this.error = `Couldn't open ${this.name}: ${(e as Error).message ?? e}. Is another program (Arduino IDE, EX-WebThrottle) using it?`;
      this.stopListening();
    }
  }

  send(text: string) {
    if (!this.connected) return;
    tauri()!.core.invoke("serial_write", { id: this.id, text }).catch(() => { this.connected = false; this.error = "The USB connection dropped."; });
  }

  private stopListening() { for (const u of this.unlisten) u(); this.unlisten = []; }

  close() {
    this.connected = false;
    if (this.id) tauri()?.core.invoke("serial_close", { id: this.id }).catch(() => {});
    this.stopListening();
  }
}

export class WebSerialTransport implements Transport {
  connected = false;
  error?: string;
  onText: (text: string) => void = () => {};
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private enc = new TextEncoder();

  constructor(private port: SerialPortLike) {}

  async open() {
    try {
      await this.port.open({ baudRate: 115200 });
      this.writer = this.port.writable!.getWriter();
      this.connected = true;
      this.error = undefined;
      this.readLoop();
    } catch (e) {
      this.error = `Couldn't open the USB port: ${(e as Error).message}. Is another program (Arduino IDE, EX-WebThrottle) using it?`;
    }
  }

  private async readLoop() {
    const dec = new TextDecoder();
    try {
      this.reader = this.port.readable!.getReader();
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.onText(dec.decode(value, { stream: true }));
      }
    } catch (e) {
      this.error = `The USB connection dropped: ${(e as Error).message}`;
    }
    this.connected = false;
  }

  send(text: string) {
    if (!this.writer || !this.connected) return;
    this.writer.write(this.enc.encode(text)).catch(() => { this.connected = false; this.error = "The USB connection dropped."; });
  }

  close() {
    this.connected = false;
    this.reader?.cancel().catch(() => {});
    this.writer?.close().catch(() => {});
    this.port.close().catch(() => {});
  }
}

/** A DCC-EX link in a browser: USB through Web Serial. Network connections need the hub. */
export class BrowserDccExLink extends DccExLink {
  constructor(controller: Controller, engine: () => ControlEngine) {
    const hint = controller.conn === "net"
      ? "A browser can't open a network connection to DCC-EX. Run the Railplot hub, or connect DCC-EX by USB."
      : !usbSupported()
        ? "USB needs Chrome or Edge on a computer, the desktop app, or the Railplot hub."
        : "Press Connect USB in Set up and choose the command station's port.";
    super(controller, engine, null, hint);
    if (controller.conn !== "net") { if (webSerialSupported()) this.reuseGrantedPort(); else if (desktopSerial()) this.reopenDesktopPort(); }
  }

  /** In the desktop app: the port used last time (kept as the controller's address), or the only USB port there is. */
  private async reopenDesktopPort() {
    try {
      const usb = (await listSerialPorts()).filter((p) => p.usb);
      const name = usb.find((p) => p.name === this.controller.host)?.name ?? (usb.length === 1 ? usb[0].name : null);
      if (!name) return;
      const t = new DesktopSerialTransport(name);
      await t.open();
      if (t.connected) this.setTransport(t);
    } catch { /* the person connects by hand */ }
  }

  /** In the desktop app: open a port by name. */
  async connectPort(name: string) {
    const t = new DesktopSerialTransport(name);
    await t.open();
    if (!t.connected) throw new Error(t.error ?? "Couldn't open the port.");
    this.setTransport(t);
  }

  private async reuseGrantedPort() {
    const api = serialApi();
    if (!api || !webSerialSupported()) return;
    try {
      const ports = await api.getPorts();
      if (ports.length === 1) { const t = new WebSerialTransport(ports[0]); await t.open(); if (t.connected) this.setTransport(t); }
    } catch { /* the person connects by hand */ }
  }

  /** Must be called from a click: the browser asks which port to use. */
  async connect() {
    const api = serialApi();
    if (!api || !webSerialSupported()) throw new Error("This browser can't use USB devices. Use Chrome or Edge.");
    const port = await api.requestPort();
    const t = new WebSerialTransport(port);
    await t.open();
    if (!t.connected) throw new Error(t.error ?? "Couldn't open the port.");
    this.setTransport(t);
  }
}

export function makeLink(c: Controller, engine: () => ControlEngine): Link {
  if (c.kind === "sim") return new SimLink(c, engine);
  if (c.kind === "dccex") return new BrowserDccExLink(c, engine);
  return new Esp32Link(c);
}
