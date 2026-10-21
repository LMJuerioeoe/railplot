// A minimal mDNS (Bonjour/Zeroconf) responder so throttle apps find the hub by themselves:
// it answers for the WiThrottle service (_withrottle._tcp) and the hub's own host name.
import dgram from "node:dgram";
import os from "node:os";

const GROUP = "224.0.0.251", PORT = 5353;
const T_A = 1, T_PTR = 12, T_TXT = 16, T_SRV = 33, T_ANY = 255;

export interface MdnsService { instance: string; type: string; port: number; txt?: string[] }

export function encodeName(name: string): Buffer {
  const parts = name.replace(/\.$/, "").split(".");
  const bufs = parts.map((p) => { const b = Buffer.from(p, "utf8"); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

/** Read a (possibly compressed) name at `off`. Returns the name and the offset after it. */
export function decodeName(buf: Buffer, off: number): [string, number] {
  const labels: string[] = [];
  let end = -1, jumps = 0;
  for (;;) {
    if (off >= buf.length) throw new Error("bad name");
    const len = buf[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (++jumps > 16) throw new Error("loop");
      if (end < 0) end = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      continue;
    }
    labels.push(buf.toString("utf8", off + 1, off + 1 + len));
    off += 1 + len;
  }
  return [labels.join("."), end >= 0 ? end : off];
}

export function parseQuestions(buf: Buffer): { name: string; type: number }[] {
  if (buf.length < 12) return [];
  const flags = buf.readUInt16BE(2);
  if (flags & 0x8000) return [];                // a response, not a query
  const qd = buf.readUInt16BE(4);
  const out: { name: string; type: number }[] = [];
  let off = 12;
  for (let i = 0; i < qd; i++) {
    const [name, o] = decodeName(buf, off);
    out.push({ name: name.toLowerCase(), type: buf.readUInt16BE(o) });
    off = o + 4;
  }
  return out;
}

function rr(name: string, type: number, cls: number, ttl: number, data: Buffer): Buffer {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0); head.writeUInt16BE(cls, 2); head.writeUInt32BE(ttl, 4); head.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), head, data]);
}

export function localIPv4(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  return out;
}

export class MdnsResponder {
  private sock: dgram.Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  hostName: string;

  constructor(public service: MdnsService, host: string, private log: (m: string) => void = () => {}) {
    this.hostName = `${host.replace(/\.local$/, "")}.local`;
  }

  get typeName() { return `${this.service.type}.local`; }
  get instanceName() { return `${this.service.instance}.${this.typeName}`; }

  /** The answer packet for the questions asked (or for an announcement). Empty when not ours. */
  answer(qs: { name: string; type: number }[], ips = localIPv4()): Buffer | null {
    const ptr = rr(this.typeName, T_PTR, 1, 4500, encodeName(this.instanceName));
    const srvData = Buffer.concat([Buffer.from([0, 0, 0, 0, this.service.port >> 8, this.service.port & 255]), encodeName(this.hostName)]);
    const srv = rr(this.instanceName, T_SRV, 0x8001, 120, srvData);
    const txtStrings = (this.service.txt?.length ? this.service.txt : [""]).map((t) => { const b = Buffer.from(t); return Buffer.concat([Buffer.from([b.length]), b]); });
    const txt = rr(this.instanceName, T_TXT, 0x8001, 4500, Buffer.concat(txtStrings));
    const as = ips.map((ip) => rr(this.hostName, T_A, 0x8001, 120, Buffer.from(ip.split(".").map(Number))));
    const meta = rr("_services._dns-sd._udp.local", T_PTR, 1, 4500, encodeName(this.typeName));
    let answers: Buffer[] = [], extra: Buffer[] = [];
    const announce = !qs.length;
    for (const q of qs) {
      const any = q.type === T_ANY;
      if (q.name === this.typeName.toLowerCase() && (q.type === T_PTR || any)) { answers.push(ptr); extra.push(srv, txt, ...as); }
      else if (q.name === this.instanceName.toLowerCase() && (q.type === T_SRV || q.type === T_TXT || any)) { answers.push(q.type === T_TXT ? txt : srv); if (q.type !== T_TXT) extra.push(...as); }
      else if (q.name === this.hostName.toLowerCase() && (q.type === T_A || any)) answers.push(...as);
      else if (q.name === "_services._dns-sd._udp.local" && (q.type === T_PTR || any)) answers.push(meta);
    }
    if (announce) { answers = [ptr, srv, txt, ...as]; extra = []; }
    if (!answers.length) return null;
    extra = extra.filter((x) => !answers.includes(x));
    const head = Buffer.alloc(12);
    head.writeUInt16BE(0, 0); head.writeUInt16BE(0x8400, 2);
    head.writeUInt16BE(0, 4); head.writeUInt16BE(answers.length, 6); head.writeUInt16BE(0, 8); head.writeUInt16BE(extra.length, 10);
    return Buffer.concat([head, ...answers, ...extra]);
  }

  start() {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.sock = sock;
    sock.on("error", (e) => { this.log(`mDNS isn't available (${e.message}). Throttle apps can still connect by address.`); try { sock.close(); } catch { /* closed */ } this.sock = null; });
    sock.on("message", (msg) => {
      try {
        const qs = parseQuestions(msg);
        if (!qs.length) return;
        const pkt = this.answer(qs);
        if (pkt) sock.send(pkt, PORT, GROUP);
      } catch { /* not a packet we understand */ }
    });
    sock.bind(PORT, () => {
      try { sock.addMembership(GROUP); sock.setMulticastTTL(255); } catch (e) { this.log(`mDNS: ${(e as Error).message}`); }
      this.announce();
      setTimeout(() => this.announce(), 1000);
      this.timer = setInterval(() => this.announce(), 60_000);
    });
  }

  announce() { const pkt = this.answer([]); if (pkt && this.sock) this.sock.send(pkt, PORT, GROUP); }

  stop() { if (this.timer) clearInterval(this.timer); try { this.sock?.close(); } catch { /* closed */ } this.sock = null; }
}
