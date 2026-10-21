import { describe, expect, test } from "bun:test";
import { DccExLink, DccExProtocol, Transport } from "../src/control/link";
import { ControlEngine, addBlock, addController, addTrain, quickStart } from "../src/control/engine";
import { buildSample } from "../src/sample";
import { TcpTransport, hubMakeLink, splitHostPort } from "../src/hub/transports";
import { FakeDccEx } from "./helpers/fake-dccex";

const frame = (blocks: [number, number][], extra: Partial<{ turnouts: [number, number][]; outputs: [number, number][] }> = {}) =>
  ({ blocks, servos: [], outputs: extra.outputs ?? [], turnouts: extra.turnouts ?? [] });

describe("DCC-EX protocol", () => {
  test("sets each used track to DC with its own cab, then powers it", () => {
    const d = new DccExProtocol(9001);
    expect(d.setup([0, 2])).toEqual(["<s>", "<= A DC 9001>", "<= C DC 9003>", "<1 A>", "<1 C>", "<t 9001 0 1>", "<t 9003 0 1>"]);
  });

  test("speeds go out only when they change, and are repeated every few seconds", () => {
    const d = new DccExProtocol(9001);
    d.setup([0]);
    expect(d.encode(frame([[0, 1023]]), 0)).toEqual(["<t 9001 126 1>", "<JI>"]);
    expect(d.encode(frame([[0, 1023]]), 500)).toEqual([]);
    expect(d.encode(frame([[0, -512]]), 600)).toEqual(["<t 9001 63 0>"]);
    expect(d.encode(frame([[0, -512]]), 4000)).toEqual(["<t 9001 63 0>", "<JI>"]);
  });

  test("turnouts and outputs", () => {
    const d = new DccExProtocol();
    d.setup([]);
    expect(d.encode(frame([], { turnouts: [[20, 1]], outputs: [[164, 4095], [165, 0]] }), 0)).toEqual(["<T 20 1>", "<z 164>", "<z -165>", "<JI>"]);
    expect(d.encode(frame([], { turnouts: [[20, 1]], outputs: [[164, 4095], [165, 0]] }), 100)).toEqual([]);
  });

  test("reads sensors, currents and the version, even split across reads", () => {
    const d = new DccExProtocol();
    d.receive("<iDCCEX V-5.4.0 / MEGA / STANDARD_MOTOR_SHIELD / G-1>", 1);
    expect(d.version).toBe("DCCEX V-5.4.0");
    d.receive("<Q 1", 2);
    d.receive("2><jI 300 15>", 3);
    expect(d.mA).toEqual([300, 15]);
    d.receive("<q 12>", 4);
    let inputs = d.takeInputs();
    expect(inputs(12)).toBe(true);     // came on and went off between frames: still counts once
    inputs = d.takeInputs();
    expect(inputs(12)).toBe(false);
    d.receive("<Q 3 30 1>", 5);       // a sensor list entry, not an event
    expect(d.takeInputs()(3)).toBe(false);
  });

  test("emergency stop on close", () => {
    expect(new DccExProtocol(9001).stopAll([0, 1])).toEqual(["<!>", "<t 9001 0 1>", "<t 9002 0 1>"]);
  });
});

describe("DCC-EX link", () => {
  function setup() {
    const p = buildSample();
    const cfg = quickStart(p, undefined, "sim");
    const d = addController(cfg, "dccex", "127.0.0.1");
    cfg.blocks[0].controller = d.id; cfg.blocks[0].channel = 1;
    p.control = cfg;
    const e = new ControlEngine(p, cfg);
    return { p, cfg, d, e };
  }

  test("waits for the station to boot, then sets it up", async () => {
    const { cfg, d, e } = setup();
    const sent: string[] = [];
    const t: Transport = { connected: true, send: (s) => sent.push(s), onText: () => {}, close: () => {} };
    const link = new DccExLink(d, () => e, t);
    let st = await link.exchange(e.frames().get(d.id)!);
    expect(st!.message).toMatch(/Waiting for DCC-EX/);
    t.onText("<iDCCEX V-5.4.0 / MEGA / X / G>");
    e.setThrottle(cfg.trains[0].id, 1);
    e.step(5);
    st = await link.exchange(e.frames().get(d.id)!);
    expect(sent).toContain("<= B DC 9002>");
    expect(sent).toContain("<1 B>");
    expect(sent.some((s) => /^<t 9002 \d+ 1>$/.test(s) && !s.includes(" 0 1>"))).toBe(true);
    expect(st!.online).toBe(true);
    expect(st!.accepted).toBe(true);
  });

  test("a missing transport explains itself", async () => {
    const { d, e } = setup();
    const link = new DccExLink(d, () => e, null, "Plug it in.");
    const st = await link.exchange(e.frames().get(d.id)!);
    expect(st!.online).toBe(false);
    expect(st!.message).toBe("Plug it in.");
  });

  test("over TCP to a command station (through the hub's transport)", async () => {
    const fake = new FakeDccEx();
    try {
      const { cfg, d, e } = setup();
      d.host = `127.0.0.1:${fake.port}`; d.conn = "net";
      const s = cfg.sensors; void s;
      const link = hubMakeLink(d, () => e) as DccExLink;
      expect(link.transport).toBeInstanceOf(TcpTransport);
      e.setThrottle(cfg.trains[0].id, 0.5);
      for (let i = 0; i < 40; i++) { e.step(0.1); await link.exchange(e.frames().get(d.id)!); await Bun.sleep(100); }
      expect(fake.tracks.get("B")).toBe("DC 9002");
      expect(fake.speeds.get(9002)![0]).toBeGreaterThan(30);
      expect(fake.speeds.get(9002)![1]).toBe(1);
      expect(link.status!.accepted).toBe(true);
      expect(link.status!.mA[0]).toBe(140);
      link.close();
      await Bun.sleep(100);
      expect(fake.got).toContain("!");
    } finally { fake.stop(); }
  }, 15000);

  test("host and port", () => {
    expect(splitHostPort("192.168.4.1")).toEqual({ host: "192.168.4.1", port: 2560 });
    expect(splitHostPort("cs.local:2561")).toEqual({ host: "cs.local", port: 2561 });
  });
});
