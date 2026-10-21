import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildControlDemo } from "../src/sample";
import { ControlEngine } from "../src/control/engine";
import { WtSession } from "../src/hub/withrottle";
import { MdnsResponder, decodeName, encodeName, parseQuestions } from "../src/hub/mdns";
import { Hub } from "../src/hub/server";
import { serialize } from "../src/io";

function session() {
  const p = buildControlDemo();
  const e = new ControlEngine(p, p.control!);
  const s = new WtSession({ engine: () => e, project: () => p, name: "Test", version: "0.0.0" }, 0);
  return { p, e, s, cfg: p.control! };
}

describe("WiThrottle", () => {
  test("greets with version, roster, power, turnouts and routes", () => {
    const { s } = session();
    const g = s.greeting();
    expect(g[0]).toBe("VN2.0");
    expect(g).toContain("RL2]\\[Goods train}|{1}|{S]\\[Express}|{2}|{S");
    expect(g).toContain("PPA1");
    expect(g.find((l) => l.startsWith("PTL"))).toMatch(/^PTL]\\\[RP1}\|{point 1 .*}\|{2]\\\[RP2}\|{point 2 .*}\|{2$/);
    expect(g.find((l) => l.startsWith("PRL"))).toBe("PRL]\\[IR1}|{Main line}|{2]\\[IR2}|{Into the loop}|{4]\\[IA1}|{Auto: Goods shuttle}|{4");
    expect(g[g.length - 1]).toBe("*10");
  });

  test("acquire by address, drive, reverse and release", () => {
    const { s, e, cfg } = session();
    const ex = cfg.trains[1];
    const acq = s.handle("MT+S2<;>S2", 1);
    expect(acq[0]).toBe("MT+S2<;>");
    expect(acq).toContain("MTAS2<;>V0");
    expect(acq).toContain("MTAS2<;>R1");
    s.handle("MTAS2<;>V63", 2);
    expect(e.run(ex.id).target).toBeCloseTo(0.5);
    s.handle("MTAS2<;>R0", 3);
    expect(e.run(ex.id).target).toBeCloseTo(-0.5);
    s.handle("MTAS2<;>V0", 4);
    s.handle("MTAS2<;>V126", 5);
    expect(e.run(ex.id).target).toBeCloseTo(-1);     // direction remembered through zero
    expect(s.handle("MTAS2<;>qV", 6)).toEqual(["MTAS2<;>V126"]);
    s.handle("MTAS2<;>X", 7);
    expect(e.run(ex.id).target).toBe(0);
    expect(e.run(ex.id).speed).toBe(0);
    expect(s.handle("MT-S2<;>r", 8)).toEqual(["MT-S2<;>"]);
    expect(s.trains()).toEqual([]);
  });

  test("acquire by roster name; unknown addresses are refused", () => {
    const { s, cfg } = session();
    s.handle("MT+L1<;>EGoods train", 1);
    expect(s.trains()).toEqual([cfg.trains[0].id]);
    const r = s.handle("MS+S9<;>S9", 2);
    expect(r[0]).toMatch(/^HMRailplot has no train at S9\. Its trains are addresses 1 to 2\./);
    expect(r[1]).toBe("MS-S9<;>");
  });

  test("changes made elsewhere reach the app", () => {
    const { s, e, cfg } = session();
    s.handle("MT+S1<;>S1", 0);
    s.poll(0);
    e.setThrottle(cfg.trains[0].id, -0.25);
    e.setPoint(cfg.points[0].item, 1);
    const out = s.poll(100);
    expect(out).toContain("MTAS1<;>R0");
    expect(out).toContain("MTAS1<;>V32");
    expect(out).toContain("PTA4RP1");
    e.setPower(false);
    const out2 = s.poll(200);
    expect(out2).toContain("PPA0");
    expect(out2).toContain("MTAS1<;>V0");
    expect(out2).not.toContain("MTAS1<;>R1");   // stopping keeps the direction
  });

  test("turnouts, routes, automations and power from the app", () => {
    const { s, e, cfg } = session();
    s.handle("PTATRP2", 0);
    expect(cfg.points[1].state).toBe(1);
    s.handle("PTA2RP2", 0);
    expect(cfg.points[1].state).toBe(0);
    s.handle("PRA2IR2", 0);
    expect(e.routeSet(cfg.routes![1].id)).toBe(true);
    s.handle("PRA2IA1", 0);
    expect(e.autoRuns.get(cfg.automations![0].id)?.running).toBe(true);
    s.handle("PPA0", 0);
    expect(e.powerOn).toBe(false);
    expect(s.handle("PTATRP9", 0)[0]).toMatch(/^HM/);
  });

  test("a silent app's trains are stopped once the heartbeat runs out", () => {
    const { s, e, cfg } = session();
    s.handle("*+", 0);
    s.handle("MT+S2<;>S2", 0);
    s.handle("MTAS2<;>V100", 0);
    e.step(1);
    s.poll(10_000);
    expect(e.run(cfg.trains[1].id).target).not.toBe(0);
    s.poll(16_000);
    expect(e.run(cfg.trains[1].id).target).toBe(0);
    expect(e.run(cfg.trains[1].id).speed).toBe(0);
  });
});

describe("mDNS", () => {
  test("names round-trip, with compression", () => {
    const n = encodeName("Railplot._withrottle._tcp.local");
    expect(decodeName(n, 0)).toEqual(["Railplot._withrottle._tcp.local", n.length]);
    const pkt = Buffer.concat([n, Buffer.from([0xc0, 9])]);   // a pointer to "_withrottle..."
    expect(decodeName(pkt, n.length)[0]).toBe("_withrottle._tcp.local");
  });

  test("answers a query for the WiThrottle service", () => {
    const m = new MdnsResponder({ instance: "Railplot", type: "_withrottle._tcp", port: 12090 }, "railplot-hub");
    const head = Buffer.alloc(12); head.writeUInt16BE(1, 4);
    const q = Buffer.concat([head, encodeName("_withrottle._tcp.local"), Buffer.from([0, 12, 0, 1])]);
    expect(parseQuestions(q)).toEqual([{ name: "_withrottle._tcp.local", type: 12 }]);
    const a = m.answer(parseQuestions(q), ["192.168.1.20"])!;
    expect(a.readUInt16BE(2)).toBe(0x8400);
    expect(a.readUInt16BE(6)).toBe(1);        // the PTR
    expect(a.readUInt16BE(10)).toBe(3);       // SRV, TXT and A in the additional section
    expect([...a.subarray(a.length - 4)]).toEqual([192, 168, 1, 20]);
    expect(m.answer([{ name: "_other._tcp.local", type: 12 }])).toBeNull();
  });
});

describe("the hub", () => {
  let hub: Hub;
  let dir: string;
  const port = 18000 + Math.floor(Math.random() * 1000), wtPort = port + 1000;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "railplot-hub-"));
    fs.writeFileSync(path.join(dir, "layout.railplot"), serialize(buildControlDemo()));
    hub = new Hub({ layout: path.join(dir, "layout.railplot"), port, wtPort, name: "Test", host: "test-hub", mdns: false, appHtml: "<!doctype html><title>Railplot</title>", version: "9.9.9", quiet: true });
    hub.start();
  });
  afterAll(() => hub.stop());

  test("status, page and layout", async () => {
    const st = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
    expect(st.fw).toBe("railplot-hub 9.9.9");
    expect(st.layout).toBe("Two-train control demo");
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toContain("<title>Railplot</title>");
    const r = await fetch(`http://127.0.0.1:${port}/api/layout`);
    expect(r.headers.get("x-railplot-version")).toBe("1");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(JSON.parse(await r.text()).control.trains.length).toBe(2);
  });

  test("a browser drives through the WebSocket and sees the state", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws?cid=test`);
    const msgs: any[] = [];
    ws.onmessage = (ev) => msgs.push(JSON.parse(String(ev.data)));
    await new Promise((r) => (ws.onopen = r));
    const ex = hub.p.control!.trains[1].id;
    ws.send(JSON.stringify({ t: "cmd", id: 1, cmd: { c: "throttle", train: ex, v: 0.4 } }));
    ws.send(JSON.stringify({ t: "cmd", id: 2, cmd: { c: "route", id: "nope" } }));
    await Bun.sleep(400);
    expect(msgs.find((m) => m.t === "result" && m.id === 1).error).toBeNull();
    expect(msgs.find((m) => m.t === "result" && m.id === 2).error).toMatch(/doesn't exist/);
    const last = [...msgs].reverse().find((m) => m.t === "state").s;
    expect(last.runs.find((r: any) => r[0] === ex)[1]).toBeCloseTo(0.4);
    expect(last.clients).toBeGreaterThanOrEqual(1);
    ws.send(JSON.stringify({ t: "cmd", id: 3, cmd: { c: "stopAll" } }));
    await Bun.sleep(150);
    ws.close();
  });

  test("a WiThrottle app connects over TCP and drives", async () => {
    let got = "";
    const sock = await Bun.connect({ hostname: "127.0.0.1", port: wtPort, socket: { data: (_s, d) => { got += new TextDecoder().decode(d); } } });
    await Bun.sleep(200);
    expect(got.startsWith("VN2.0\n")).toBe(true);
    sock.write("NTest phone\nHUtest1\nMT+S1<;>S1\nMTAS1<;>V50\n");
    await Bun.sleep(300);
    expect(got).toContain("*10\n");
    expect(got).toContain("MT+S1<;>\n");
    expect(hub.engine.run(hub.p.control!.trains[0].id).target).toBeCloseTo(50 / 126);
    sock.end();
    await Bun.sleep(300);
    // the app vanished without saying Q: its train is stopped
    expect(hub.engine.run(hub.p.control!.trains[0].id).target).toBe(0);
  });

  test("a new layout keeps the trains where they are and is saved", async () => {
    const p = buildControlDemo();
    p.name = "Renamed";
    const goods = hub.p.control!.trains[0];
    goods.block = hub.p.control!.blocks.find((b) => b.name === "Station")!.id;
    const r = await fetch(`http://127.0.0.1:${port}/api/layout`, { method: "POST", body: serialize(p), headers: { "Content-Type": "text/plain" } });
    expect((await r.json()).v).toBe(2);
    expect(hub.p.name).toBe("Renamed");
    expect(hub.p.control!.trains[0].block).toBe(goods.block);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "layout.railplot"), "utf8"));
    expect(saved.name).toBe("Renamed");
    const bad = await fetch(`http://127.0.0.1:${port}/api/layout`, { method: "POST", body: "{}" });
    expect(bad.status).toBe(400);
  });
});
