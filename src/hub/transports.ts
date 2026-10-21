// How the hub reaches a DCC-EX command station: TCP (Wi-Fi or Ethernet, port 2560) or a serial port (USB).
// Both reconnect by themselves.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { DccExLink, Esp32Link, Link, SimLink, Transport } from "../control/link";
import { ControlEngine } from "../control/engine";
import { Controller, DCCEX_PORT } from "../control/types";

const RETRY_MS = 3000;

export class TcpTransport implements Transport {
  connected = false;
  error?: string;
  onText: (text: string) => void = () => {};
  private sock: { write(d: string): number; end(): void } | null = null;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(public host: string, public port = DCCEX_PORT) { this.open(); }

  private open() {
    if (this.closed) return;
    const dec = new TextDecoder();
    Bun.connect({
      hostname: this.host, port: this.port,
      socket: {
        open: (s) => { this.sock = s; this.connected = true; this.error = undefined; },
        data: (_s, chunk) => this.onText(dec.decode(chunk, { stream: true })),
        close: () => this.lost(`The connection to DCC-EX at ${this.host}:${this.port} closed.`),
        error: (_s, e) => this.lost(`DCC-EX at ${this.host}:${this.port}: ${e.message}`),
        connectError: (_s, e) => this.lost(`Can't reach DCC-EX at ${this.host}:${this.port} (${e.message}).`),
      },
    }).catch((e: Error) => this.lost(`Can't reach DCC-EX at ${this.host}:${this.port} (${e.message}).`));
  }

  private lost(msg: string) {
    this.connected = false;
    this.sock = null;
    this.error = msg;
    if (!this.closed && !this.timer) this.timer = setTimeout(() => { this.timer = null; this.open(); }, RETRY_MS);
  }

  send(text: string) { if (this.connected) this.sock?.write(text); }
  close() { this.closed = true; this.connected = false; if (this.timer) clearTimeout(this.timer); this.sock?.end(); }
}

/** Set a serial port to 115200 baud, raw. */
export function configureSerial(path: string): string | null {
  const win = process.platform === "win32";
  const r = win
    ? spawnSync("mode", [`${path.replace(/^\\\\\.\\/, "")}:`, "BAUD=115200", "PARITY=n", "DATA=8", "STOP=1", "dtr=on"], { shell: true })
    : spawnSync("stty", [process.platform === "darwin" ? "-f" : "-F", path, "115200", "raw", "-echo", "-hupcl", "cs8", "-cstopb", "-parenb"]);
  if (r.error) return r.error.message;
  if (r.status !== 0) return (r.stderr?.toString() || `couldn't set up ${path}`).trim();
  return null;
}

export class SerialTransport implements Transport {
  connected = false;
  error?: string;
  onText: (text: string) => void = () => {};
  private fd: number | null = null;
  private stream: fs.ReadStream | null = null;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(public path: string) { this.open(); }

  private open() {
    if (this.closed) return;
    const path = process.platform === "win32" && /^COM\d+$/i.test(this.path) ? `\\\\.\\${this.path}` : this.path;
    if (!fs.existsSync(path) && process.platform !== "win32") return this.lost(`No serial port at ${this.path}. Is the command station plugged in?`);
    const err = configureSerial(path);
    if (err) return this.lost(`Couldn't set up ${this.path}: ${err}`);
    try {
      this.fd = fs.openSync(path, "r+");
      const dec = new TextDecoder();
      this.stream = fs.createReadStream("", { fd: this.fd, autoClose: false, highWaterMark: 256 });
      this.stream.on("data", (b) => this.onText(dec.decode(b as Buffer, { stream: true })));
      this.stream.on("error", (e) => this.lost(`${this.path}: ${e.message}`));
      this.stream.on("end", () => this.lost(`${this.path} closed.`));
      this.connected = true;
      this.error = undefined;
    } catch (e) {
      this.lost(`Couldn't open ${this.path}: ${(e as Error).message}${process.platform === "linux" ? " (is your user in the dialout group?)" : ""}`);
    }
  }

  private lost(msg: string) {
    this.connected = false;
    this.error = msg;
    try { this.stream?.destroy(); } catch { /* gone */ }
    try { if (this.fd !== null) fs.closeSync(this.fd); } catch { /* gone */ }
    this.stream = null; this.fd = null;
    if (!this.closed && !this.timer) this.timer = setTimeout(() => { this.timer = null; this.open(); }, RETRY_MS);
  }

  send(text: string) {
    if (!this.connected || this.fd === null) return;
    try { fs.writeSync(this.fd, text); } catch (e) { this.lost(`${this.path}: ${(e as Error).message}`); }
  }

  close() { this.closed = true; if (this.timer) clearTimeout(this.timer); this.lost("closed"); this.closed = true; }
}

/** "192.168.4.1:2560" to host and port. */
export function splitHostPort(s: string): { host: string; port: number } {
  const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(s.trim());
  return { host: m?.[1] ?? s, port: m?.[2] ? +m[2] : DCCEX_PORT };
}

/** The hub's links: like the browser's, plus DCC-EX over TCP and serial ports. */
export function hubMakeLink(c: Controller, engine: () => ControlEngine): Link {
  if (c.kind === "sim") return new SimLink(c, engine);
  if (c.kind === "esp32") return new Esp32Link(c);
  if (!c.host) return new DccExLink(c, engine, null, c.conn === "net" ? "Put the command station's address in Set up, for example 192.168.4.1." : "Put the serial port in Set up, for example /dev/ttyACM0 (Linux), /dev/cu.usbmodem1101 (Mac) or COM3 (Windows).");
  if (c.conn === "net") { const { host, port } = splitHostPort(c.host); return new DccExLink(c, engine, new TcpTransport(host, port)); }
  return new DccExLink(c, engine, new SerialTransport(c.host));
}
