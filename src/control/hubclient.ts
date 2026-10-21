// A phone or laptop connected to a Railplot hub: the hub runs the engine, this side sends commands
// and shows the hub's state.
import { CLIENT_ID } from "./link";
import { Cmd, Snapshot } from "./remote";

export type HubState = "connecting" | "online" | "offline";

/** "pi.local", "192.168.1.20:8080" or "http://..." to a base URL. Empty: the hub this page came from. */
export function hubBase(host: string): string {
  if (!host) return typeof location !== "undefined" && location.protocol.startsWith("http") ? location.origin : "http://railplot-hub.local:8080";
  if (/^https?:\/\//.test(host)) return host.replace(/\/$/, "");
  return /:\d+$/.test(host) ? `http://${host}` : `http://${host}:8080`;
}

export async function hubStatus(base: string, ms = 1500): Promise<{ fw: string; v: number; name?: string } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${base}/api/status`, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.fw === "string" && j.fw.startsWith("railplot-hub") ? j : null;
  } catch { return null; } finally { clearTimeout(t); }
}

export class HubClient {
  state: HubState = "connecting";
  snap: Snapshot | null = null;
  /** The layout version this page has. */
  version = -1;
  message = "";
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = new Map<number, (err: string | null) => void>();
  private retry = 0;
  private closed = false;
  onSnapshot: (s: Snapshot) => void = () => {};
  onEvent: (text: string) => void = () => {};

  constructor(public host: string) { this.open(); }

  get base() { return hubBase(this.host); }

  private open() {
    if (this.closed) return;
    const url = `${this.base.replace(/^http/, "ws")}/api/ws?cid=${CLIENT_ID}`;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (e) { this.fail(`Can't connect to the hub: ${(e as Error).message}`); return; }
    this.ws = ws;
    this.state = "connecting";
    ws.onopen = () => { this.state = "online"; this.retry = 0; this.message = ""; };
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === "state") { this.snap = m.s; this.onSnapshot(m.s); }
      else if (m.t === "event") this.onEvent(m.text);
      else if (m.t === "result") { this.pending.get(m.id)?.(m.error ?? null); this.pending.delete(m.id); }
    };
    ws.onclose = () => {
      for (const r of this.pending.values()) r("Lost the connection to the hub.");
      this.pending.clear();
      const https = typeof location !== "undefined" && location.protocol === "https:" && this.base.startsWith("http:");
      this.fail(https ? "This page is served over https, which can't reach a hub on your network. Open the hub's own address instead." : `Can't reach the hub at ${this.base}. Is it running?`);
    };
  }

  private fail(msg: string) {
    this.state = "offline";
    this.message = msg;
    this.ws = null;
    if (this.closed) return;
    const delay = Math.min(10000, 500 * 2 ** this.retry++);
    setTimeout(() => this.open(), delay);
  }

  send(cmd: Cmd): Promise<string | null> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve("Not connected to the hub.");
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      ws.send(JSON.stringify({ t: "cmd", id, cmd }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve("The hub didn't answer."); } }, 4000);
    });
  }

  async fetchLayout(): Promise<{ text: string; v: number } | null> {
    try {
      const r = await fetch(`${this.base}/api/layout`, { cache: "no-store" });
      if (!r.ok) return null;
      const v = +(r.headers.get("X-Railplot-Version") ?? "0");
      return { text: await r.text(), v };
    } catch { return null; }
  }

  /** Send this device's layout. `merged`: the hub kept proposals this device hadn't got yet, so fetch the layout again. */
  async pushLayout(text: string, resolved?: Iterable<string>): Promise<{ v: number; merged: number }> {
    // `resolved`: the proposals this device accepted or rejected; the hub keeps every other proposal it has.
    // Without it (sending a whole new layout) the hub's proposals go with its old layout.
    const headers: Record<string, string> = { "Content-Type": "text/plain" };
    if (resolved) headers["X-Railplot-Resolved"] = [...resolved].join(",");
    const r = await fetch(`${this.base}/api/layout?cid=${CLIENT_ID}${resolved ? `&base=${this.version}` : ""}`, { method: "POST", body: text, headers });
    if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
    const j = await r.json();
    this.version = j.v;
    return { v: j.v, merged: j.merged ?? 0 };
  }

  close() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    this.state = "offline";
  }
}
