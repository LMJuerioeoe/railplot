// A WiThrottle server, so Engine Driver (Android), WiThrottle (iPhone) and other WiThrottle apps can
// drive Railplot's analogue trains. Train 1 is address 1, train 2 is address 2, and so on.
// Points appear as turnouts, routes and automations as routes, and track power works.
// Protocol: https://jmri.org/help/en/package/jmri/jmrit/withrottle/Protocol.shtml
import { ControlEngine, pointLabel } from "../control/engine";
import { applyCommand } from "../control/remote";
import { Project, partOf } from "../model";

export const WT_PORT = 12090;
export const HEARTBEAT_S = 10;

const AR = "]\\[";   // between entries
const FS = "}|{";   // between fields
const ST = "<;>";   // in throttle commands

const clean = (s: string) => s.replace(/[\]\[}{|<>;\r\n]/g, " ").trim();

export interface WtHost {
  engine(): ControlEngine;
  project(): Project;
  name: string;
  version: string;
  log?(msg: string): void;
}

/** One connected throttle app. Feed it lines; it returns the lines to send back. */
export class WtSession {
  name = "";
  heartbeat = false;
  lastSeen = 0;
  quit = false;
  /** throttle id -> loco key ("S1") -> train id */
  throttles = new Map<string, Map<string, string>>();
  private sent = new Map<string, string>();       // "T|S1|V" -> "V42"
  private sentTurnouts = new Map<string, number>();
  private sentRoutes = new Map<string, number>();
  private sentPower = -1;
  private timedOut = false;

  /** `dirs` is shared by every app on one hub: the direction each train was last set to, so V0 keeps it. */
  constructor(private host: WtHost, now: number, private dirs = new Map<string, 1 | -1>()) { this.lastSeen = now; }

  private get e() { return this.host.engine(); }

  /** Everything a new app is told when it connects. */
  greeting(): string[] {
    const e = this.e;
    const out = [`VN2.0`, `HTRailplot`, `HtRailplot hub ${this.host.version}`, this.roster(), `PPA${e.powerOn ? 1 : 0}`,
      `PTT${AR}Turnouts${FS}Point${AR}Closed${FS}2${AR}Thrown${FS}4`, this.turnoutList(),
      `PRT${AR}Routes${FS}Route${AR}Active${FS}2${AR}Inactive${FS}4`, this.routeList(), `*${HEARTBEAT_S}`];
    this.sentPower = e.powerOn ? 1 : 0;
    return out;
  }

  roster(): string {
    const trains = this.e.cfg.trains;
    return `RL${trains.length}${trains.map((t, i) => `${AR}${clean(t.name) || `Train ${i + 1}`}${FS}${i + 1}${FS}S`).join("")}`;
  }

  private turnouts() {
    const e = this.e, p = this.host.project();
    return e.cfg.points.map((pc, i) => {
      const it = p.items.find((x) => x.id === pc.item);
      return { sys: `RP${i + 1}`, user: clean(`${pointLabel(p, e.cfg, pc.item)} ${it ? partOf(it).def.id : ""}`), pc, state: pc.state ? 4 : 2 };
    });
  }

  turnoutList(): string {
    const ts = this.turnouts();
    for (const t of ts) this.sentTurnouts.set(t.sys, t.state);
    return `PTL${ts.map((t) => `${AR}${t.sys}${FS}${t.user}${FS}${t.state}`).join("")}`;
  }

  private routes() {
    const e = this.e;
    const routes = (e.cfg.routes ?? []).map((r, i) => ({ sys: `IR${i + 1}`, user: clean(r.name), state: e.routeSet(r.id) ? 2 : 4, run: () => applyCommand(e, { c: "route", id: r.id }) }));
    const autos = (e.cfg.automations ?? []).map((a, i) => ({
      sys: `IA${i + 1}`, user: clean(`Auto: ${a.name}`), state: e.autoRuns.get(a.id)?.running ? 2 : 4,
      run: () => applyCommand(e, { c: "auto", id: a.id, run: !e.autoRuns.get(a.id)?.running }),
    }));
    return [...routes, ...autos];
  }

  routeList(): string {
    const rs = this.routes();
    for (const r of rs) this.sentRoutes.set(r.sys, r.state);
    return `PRL${rs.map((r) => `${AR}${r.sys}${FS}${r.user}${FS}${r.state}`).join("")}`;
  }

  /** The train an address or roster entry means: "S3", "L3", "E" + name. */
  private trainFor(key: string, info: string): string | undefined {
    const trains = this.e.cfg.trains;
    if (info.startsWith("E")) {
      const name = info.slice(1).trim().toLowerCase();
      const t = trains.find((x) => clean(x.name).toLowerCase() === name);
      if (t) return t.id;
    }
    const n = parseInt(key.replace(/^[SL]/, ""), 10);
    return Number.isFinite(n) && n >= 1 && n <= trains.length ? trains[n - 1].id : undefined;
  }

  private dirOf(trainId: string): 1 | -1 {
    const r = this.e.run(trainId);
    if (r && r.target !== 0) return r.target < 0 ? -1 : 1;
    return this.dirs.get(trainId) ?? 1;
  }

  /** Lines describing a loco on a throttle, for after it was acquired or queried. */
  private locoState(tid: string, key: string, trainId: string): string[] {
    const r = this.e.run(trainId);
    const v = Math.round(Math.abs(r?.target ?? 0) * 126);
    const dir = this.dirOf(trainId) > 0 ? 1 : 0;
    this.sent.set(`${tid}|${key}|V`, `V${v}`);
    this.sent.set(`${tid}|${key}|R`, `R${dir}`);
    return [`M${tid}A${key}${ST}V${v}`, `M${tid}A${key}${ST}R${dir}`, `M${tid}A${key}${ST}s1`];
  }

  handle(line: string, now: number): string[] {
    this.lastSeen = now;
    this.timedOut = false;
    const out: string[] = [];
    const l = line.trim();
    if (!l) return out;
    const e = this.e;
    if (l === "*+") { this.heartbeat = true; return out; }
    if (l === "*-") { this.heartbeat = false; return out; }
    if (l === "*") return out;
    if (l === "Q") { this.quit = true; return out; }
    if (l[0] === "N") { this.name = l.slice(1).trim(); out.push(`*${HEARTBEAT_S}`); return out; }
    if (l.startsWith("HU")) return out;
    if (l.startsWith("PPA")) {
      const on = l[3] === "1";
      applyCommand(e, { c: "power", on });
      this.host.log?.(`${this.name || "A throttle app"} turned track power ${on ? "on" : "off"}`);
      return out;
    }
    if (l.startsWith("PTA")) {
      const action = l[3], sys = l.slice(4);
      const t = this.turnouts().find((x) => x.sys === sys);
      if (!t) return [`HMRailplot has no turnout called ${clean(sys)}.`];
      const n = t.pc.us.length;
      const state = action === "C" ? 0 : action === "T" ? (t.pc.state === 0 ? 1 : t.pc.state) : (t.pc.state + 1) % n;
      const err = applyCommand(e, { c: "point", item: t.pc.item, state });
      if (err) out.push(`HM${clean(err)}`);
      return out;
    }
    if (l.startsWith("PRA")) {
      const sys = l.slice(4);
      const r = this.routes().find((x) => x.sys === sys);
      if (!r) return [`HMRailplot has no route called ${clean(sys)}.`];
      const err = r.run();
      if (err) out.push(`HM${clean(err)}`);
      return out;
    }
    if (l[0] === "M" && l.length > 3) return this.throttle(l);
    return out;   // unknown: ignored, as the protocol asks
  }

  private throttle(l: string): string[] {
    const out: string[] = [];
    const tid = l[1], op = l[2];
    const sep = l.indexOf(ST);
    const key = (sep < 0 ? l.slice(3) : l.slice(3, sep)).trim();
    const info = sep < 0 ? "" : l.slice(sep + ST.length);
    const locos = this.throttles.get(tid) ?? this.throttles.set(tid, new Map()).get(tid)!;
    const e = this.e;
    if (op === "+" || op === "S") {
      const trainId = this.trainFor(key, info);
      if (!trainId) {
        const n = e.cfg.trains.length;
        return [`HMRailplot has no train at ${key}. ${n ? `Its trains are addresses 1 to ${n}.` : "Add a train in Railplot first."}`, `M${tid}-${key}${ST}`];
      }
      locos.set(key, trainId);
      this.host.log?.(`${this.name || "A throttle app"} took ${e.train(trainId)?.name}`);
      out.push(`M${tid}+${key}${ST}`, `M${tid}L${key}${ST}${AR}${AR}`, ...this.locoState(tid, key, trainId));
      return out;
    }
    if (op === "-") {
      if (key === "*") locos.clear(); else locos.delete(key);
      out.push(`M${tid}-${key}${ST}`);
      return out;
    }
    if (op !== "A") return out;
    const targets = key === "*" ? [...locos] : locos.has(key) ? [[key, locos.get(key)!] as [string, string]] : [];
    const action = info[0];
    for (const [k, trainId] of targets) {
      const r = e.run(trainId);
      if (!r) continue;
      switch (action) {
        case "V": {
          const v = parseInt(info.slice(1), 10);
          if (!Number.isFinite(v)) break;
          if (v < 0) { applyCommand(e, { c: "estop", train: trainId }); break; }
          const err = applyCommand(e, { c: "throttle", train: trainId, v: this.dirOf(trainId) * Math.min(126, v) / 126 });
          if (err) out.push(`HM${clean(err)}`);
          break;
        }
        case "R": {
          const d: 1 | -1 = info[1] === "0" ? -1 : 1;
          this.dirs.set(trainId, d);
          if (r.target !== 0 && Math.sign(r.target) !== d) applyCommand(e, { c: "throttle", train: trainId, v: d * Math.abs(r.target) });
          break;
        }
        case "X": applyCommand(e, { c: "estop", train: trainId }); break;
        case "I": applyCommand(e, { c: "throttle", train: trainId, v: 0 }); break;
        case "q":
          if (info[1] === "V") out.push(`M${tid}A${k}${ST}V${Math.round(Math.abs(r.target) * 126)}`);
          if (info[1] === "R") out.push(`M${tid}A${k}${ST}R${this.dirOf(trainId) > 0 ? 1 : 0}`);
          break;
        case "r": case "d":
          locos.delete(k);
          out.push(`M${tid}-${k}${ST}`);
          break;
        default: break;   // functions (F, f, m) and speed steps (s): analogue trains have none
      }
    }
    return out;
  }

  /** Changes since last time, to keep the app up to date. Also enforces the heartbeat. */
  poll(now: number): string[] {
    const out: string[] = [];
    const e = this.e;
    if (this.heartbeat && !this.timedOut && now - this.lastSeen > HEARTBEAT_S * 1000 * 1.5) {
      this.timedOut = true;
      for (const id of this.trains()) applyCommand(e, { c: "estop", train: id });
      this.host.log?.(`${this.name || "A throttle app"} went quiet: its trains were stopped`);
    }
    for (const [tid, locos] of this.throttles) {
      for (const [key, trainId] of locos) {
        const r = e.run(trainId);
        if (!r) continue;
        if (r.target !== 0) this.dirs.set(trainId, r.target < 0 ? -1 : 1);
        const v = `V${Math.round(Math.abs(r.target) * 126)}`;
        const d = `R${this.dirOf(trainId) > 0 ? 1 : 0}`;
        for (const [k, val] of [["V", v], ["R", d]] as const) {
          const sk = `${tid}|${key}|${k}`;
          if (this.sent.get(sk) !== val) { this.sent.set(sk, val); out.push(`M${tid}A${key}${ST}${val}`); }
        }
      }
    }
    for (const t of this.turnouts()) if (this.sentTurnouts.get(t.sys) !== t.state) { this.sentTurnouts.set(t.sys, t.state); out.push(`PTA${t.state}${t.sys}`); }
    for (const r of this.routes()) if (this.sentRoutes.get(r.sys) !== r.state) { this.sentRoutes.set(r.sys, r.state); out.push(`PRA${r.state}${r.sys}`); }
    const pw = e.powerOn ? 1 : 0;
    if (pw !== this.sentPower) { this.sentPower = pw; out.push(`PPA${pw}`); }
    return out;
  }

  /** The trains this app holds. */
  trains(): string[] { return [...new Set([...this.throttles.values()].flatMap((m) => [...m.values()]))]; }

  /** The layout changed: send the lists again. */
  relist(): string[] { return [this.roster(), this.turnoutList(), this.routeList()]; }
}

/** The TCP side: one WtSession per connection. */
export class WtServer {
  sessions = new Set<{ s: WtSession; write(l: string[]): void; close(): void }>();
  private server: { stop(): void } | null = null;
  private dirs = new Map<string, 1 | -1>();

  constructor(private host: WtHost, public port = WT_PORT) {}

  start() {
    type Conn = { s: WtSession; buf: string; write(l: string[]): void; close(): void };
    const host = this.host;
    this.server = Bun.listen<Conn>({
      hostname: "0.0.0.0", port: this.port,
      socket: {
        open: (sock) => {
          const s = new WtSession(host, Date.now(), this.dirs);
          const conn: Conn = {
            s, buf: "",
            write: (lines) => { if (lines.length) sock.write(lines.map((x) => `${x}\n`).join("")); },
            close: () => sock.end(),
          };
          sock.data = conn;
          this.sessions.add(conn);
          conn.write(s.greeting());
        },
        data: (sock, chunk) => {
          const c = sock.data;
          c.buf += new TextDecoder().decode(chunk);
          const lines = c.buf.split(/\r\n|\n|\r/);
          c.buf = lines.pop() ?? "";
          for (const line of lines) c.write(c.s.handle(line, Date.now()));
          if (c.buf.length > 8192) c.buf = "";
          if (c.s.quit) sock.end();
        },
        close: (sock) => {
          const c = sock.data;
          this.sessions.delete(c);
          if (!c.s.quit) {
            // the app vanished (phone asleep, out of Wi-Fi): stop its trains rather than let them run on
            const e = host.engine();
            for (const id of c.s.trains()) applyCommand(e, { c: "throttle", train: id, v: 0 });
            if (c.s.trains().length) host.log?.(`${c.s.name || "A throttle app"} disconnected: its trains were stopped`);
          }
        },
        error: () => { /* close follows */ },
      },
    });
  }

  poll() { const now = Date.now(); for (const c of this.sessions) c.write(c.s.poll(now)); }
  relist() { for (const c of this.sessions) c.write(c.s.relist()); }
  stop() { for (const c of this.sessions) c.close(); this.server?.stop(); }
}
