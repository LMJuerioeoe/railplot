// A pretend DCC-EX command station on TCP, answering the commands Railplot sends.
export class FakeDccEx {
  got: string[] = [];
  tracks = new Map<string, string>();
  speeds = new Map<number, [number, number]>();
  turnouts = new Map<number, number>();
  vpins = new Map<number, boolean>();
  private socks = new Set<{ write(s: string): number }>();
  private server: { stop(): void; port: number };
  port: number;

  constructor() {
    this.server = Bun.listen<{ buf: string }>({
      hostname: "127.0.0.1", port: 0,
      socket: {
        open: (s) => { s.data = { buf: "" }; this.socks.add(s); },
        data: (s, chunk) => {
          s.data.buf += new TextDecoder().decode(chunk);
          for (;;) {
            const a = s.data.buf.indexOf("<"), b = s.data.buf.indexOf(">", a);
            if (a < 0 || b < 0) break;
            const cmd = s.data.buf.slice(a + 1, b);
            s.data.buf = s.data.buf.slice(b + 1);
            this.got.push(cmd);
            const r = this.reply(cmd);
            if (r) s.write(r);
          }
        },
        close: (s) => { this.socks.delete(s); },
      },
    });
    this.port = this.server.port;
  }

  private reply(cmd: string): string {
    const p = cmd.split(/\s+/);
    switch (p[0]) {
      case "s": return "<iDCCEX V-5.4.0 / MEGA / STANDARD_MOTOR_SHIELD / G-test>";
      case "=": if (p.length >= 3) { this.tracks.set(p[1], `${p[2]} ${p[3] ?? ""}`.trim()); return `<= ${p[1]} ${p[2]} ${p[3] ?? ""}>`; } return "";
      case "1": return `<p1 ${p[1] ?? ""}>`;
      case "t": this.speeds.set(+p[1], [+p[2], +p[3]]); return `<l ${p[1]} 0 ${+p[3] ? 128 + +p[2] : +p[2]} 0>`;
      case "T": this.turnouts.set(+p[1], +p[2]); return `<H ${p[1]} ${p[2]}>`;
      case "z": { const v = +p[1]; this.vpins.set(Math.abs(v), !p[1].startsWith("-")); return ""; }
      case "JI": return "<jI 140 0 0 0>";
      case "!": for (const k of this.speeds.keys()) this.speeds.set(k, [0, 1]); return "";
      default: return "";
    }
  }

  /** A sensor on the command station changes. */
  sensor(id: number, on: boolean) { for (const s of this.socks) s.write(on ? `<Q ${id}>` : `<q ${id}>`); }

  stop() { this.server.stop(); }
}
