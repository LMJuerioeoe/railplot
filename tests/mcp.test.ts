import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEG, dist, normAngle } from "../src/geom";
import { analyze, geom, newProject, Project } from "../src/model";
import { parseProject, serialize } from "../src/io";
import { McpServer, PROTOCOL_VERSIONS } from "../src/mcp/server";
import { Connection, INSTRUCTIONS, railplotTools } from "../src/mcp/tools";
import { FileTarget, Folders, HubTarget } from "../src/mcp/targets";
import { OpContext, runSteps } from "../src/mcp/ops";
import { parseMcpArgs } from "../src/mcp/run";
import { Hub } from "../src/hub/server";
import { buildControlDemo } from "../src/sample";
import { diffProposal } from "../src/proposals";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "railplot-mcp-"));
const real = fs.realpathSync(dir);

function server(c: Connection) {
  return new McpServer({ name: "railplot", title: "Railplot", version: "9.9.9", instructions: INSTRUCTIONS }, railplotTools(c), () => {});
}
async function call(s: McpServer, name: string, args: Record<string, unknown> = {}) {
  const r: any = await s.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  return { text: r.result.content[0].text as string, error: r.result.isError as boolean };
}

describe("the MCP protocol", () => {
  const c: Connection = { target: null, folders: new Folders([dir]), hub: "" };
  const s = server(c);

  test("initialize agrees a protocol version and says what it offers", async () => {
    const r: any = await s.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(r.result.protocolVersion).toBe("2025-06-18");
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.serverInfo.name).toBe("railplot");
    expect(r.result.instructions).toContain("proposals");
    const old: any = await s.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(old.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  test("tools/list, ping, notifications and unknown methods", async () => {
    const r: any = await s.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const names = r.result.tools.map((t: any) => t.name);
    for (const n of ["get_status", "open_layout", "get_layout", "list_boards", "get_track", "check_layout", "get_parts_list", "list_parts",
      "propose_plan", "propose_add_yard", "propose_add_track", "withdraw_proposal", "get_control_status", "drive_train", "set_route"]) expect(names).toContain(n);
    expect(names).not.toContain("set_power");
    expect(names.some((n: string) => /power|estop|emergency/.test(n))).toBe(false);
    for (const t of r.result.tools) { expect(t.inputSchema.type).toBe("object"); expect(t.description.length).toBeGreaterThan(20); }
    expect(((await s.handle({ jsonrpc: "2.0", id: 4, method: "ping" })) as any).result).toEqual({});
    expect(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(((await s.handle({ jsonrpc: "2.0", id: 5, method: "resources/list" })) as any).error.code).toBe(-32601);
    expect(((await s.handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nope" } })) as any).error.code).toBe(-32602);
  });

  test("tool problems come back as tool errors the model can read", async () => {
    const r = await call(s, "get_layout");
    expect(r.error).toBe(true);
    expect(r.text).toContain("No plan is open");
  });

  test("serves newline-delimited JSON over a stream, in order", async () => {
    const out: string[] = [];
    const s2 = new McpServer({ name: "railplot", title: "Railplot", version: "1", instructions: "" }, [], (l) => out.push(l));
    const handlers: Record<string, (...a: any[]) => void> = {};
    const stream = { on(ev: string, fn: (...a: any[]) => void) { handlers[ev] = fn; return this; }, write: () => true } as any;
    const done = s2.serve(stream);
    handlers.data('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,');
    handlers.data('"method":"tools/list"}\nnot json\n');
    handlers.end();
    await done;
    const msgs = out.map((l) => JSON.parse(l));
    expect(msgs.map((m) => m.id)).toEqual([1, 2, null]);
    expect(msgs[2].error.code).toBe(-32700);
    expect(out.every((l) => l.endsWith("\n") && !l.slice(0, -1).includes("\n"))).toBe(true);
  });

  test("arguments: hub, file and several folders", () => {
    const o = parseMcpArgs(["--hub", "pi.local:8080", "--folder", "C:\\A", "C:\\B", "--file=x.railplot"]);
    expect(o).toEqual({ hub: "pi.local:8080", folders: ["C:\\A", "C:\\B"], file: "x.railplot", help: false });
    expect(parseMcpArgs(["--hub", "none"]).hub).toBe("");
  });
});

describe("files and folders", () => {
  const c: Connection = { target: null, folders: new Folders([dir]), hub: "" };
  const s = server(c);

  test("only .railplot files inside the allowed folders", async () => {
    expect((await call(s, "open_layout", { path: "/etc/passwd" })).text).toMatch(/Only \.railplot/);
    fs.writeFileSync(path.join(os.tmpdir(), "outside-railplot-test.railplot"), serialize(newProject()));
    expect((await call(s, "open_layout", { path: path.join(os.tmpdir(), "outside-railplot-test.railplot") })).text).toMatch(/isn't in a folder/);
    expect((await call(s, "open_layout", { path: path.join(dir, "..", path.basename(dir), "..", "x.railplot") })).error).toBe(true);
    expect((await call(s, "create_layout_file", { path: path.join(dir, "new.railplot"), name: "New" })).error).toBe(false);
    expect((await call(s, "create_layout_file", { path: path.join(dir, "new.railplot") })).text).toMatch(/already exists/);
    expect((await call(s, "list_layout_files")).text).toContain(path.join(real, "new.railplot"));
  });

  test("a proposal goes into the file, and can be withdrawn", async () => {
    const f = path.join(dir, "plan.railplot");
    fs.writeFileSync(f, serialize(newProject("Plan")));
    await call(s, "open_layout", { path: f });
    const r = await call(s, "propose_add_modules", { title: "Two boards", reason: "room for a yard", modules: ["std-1200x600", "std-1200x600"], tracks: 2 });
    expect(r.error).toBe(false);
    expect(r.text).toMatch(/Proposal P\w+, “Two boards”/);
    const p = parseProject(fs.readFileSync(f, "utf8"));
    expect(p.boards.length).toBe(0);                      // nothing changes until accepted
    expect(p.proposals?.length).toBe(1);
    expect(p.proposals![0].add.boards.length).toBe(2);
    expect(p.proposals![0].why).toBe("room for a yard");
    const id = p.proposals![0].id;
    expect((await call(s, "list_proposals")).text).toContain(id);
    expect((await call(s, "withdraw_proposal", { id })).text).toBe(`Withdrew ${id}.`);
    expect(parseProject(fs.readFileSync(f, "utf8")).proposals).toBeUndefined();
    expect((await call(s, "withdraw_proposal", { id })).text).toContain("isn't waiting");
  });

  test("preview works it out without sending", async () => {
    const f = path.join(dir, "plan.railplot");
    const r = await call(s, "propose_add_example", { title: "Example", example: "inglenook-shelf", library: "peco-setrack-oo", preview: true });
    expect(r.text).toMatch(/^Preview only/);
    expect(r.text).toContain("Inglenook on a shelf");
    expect(parseProject(fs.readFileSync(f, "utf8")).proposals).toBeUndefined();
  });

  test("a plan in several steps, then reading it back once accepted", async () => {
    const f = path.join(dir, "plan.railplot");
    const r = await call(s, "propose_plan", { title: "L-shape", steps: [
      { op: "add_modules", modules: ["std-1200x600", "corner45-600", "corner45-600", "std-1200x600"], tracks: 1 },
      { op: "lay_guides", boards: "all", library: "peco-setrack-oo" },
    ] });
    expect(r.error).toBe(false);
    // accept it as Railplot would
    const { applyProposal } = await import("../src/proposals");
    const p = parseProject(fs.readFileSync(f, "utf8"));
    expect(applyProposal(p, p.proposals![0]).ok).toBe(true);
    fs.writeFileSync(f, serialize(p));
    const boards = JSON.parse((await call(s, "list_boards")).text);
    expect(boards.length).toBe(4);
    expect(boards[0].faces.filter((x: any) => x.joined_to).length).toBe(1);
    expect(boards[1].track_positions.every((q: any) => q.used)).toBe(true);
    const track = JSON.parse((await call(s, "get_track", { board: boards[1].id })).text);
    expect(track.length).toBeGreaterThan(0);
    expect(track[0].ends[0]).toHaveProperty("joined_to");
    const check = await call(s, "check_layout");
    expect(check.text).toMatch(/open end/);
    expect(JSON.parse((await call(s, "get_parts_list")).text)[0]).toHaveProperty("part");
    const sum = JSON.parse((await call(s, "get_layout")).text);
    expect(sum.modules.length).toBe(4);
    expect(sum.main_track_system).toBe("peco-setrack-oo");
  });

  test("step errors say which step and why", async () => {
    const r = await call(s, "propose_plan", { title: "Bad", steps: [{ op: "add_modules", modules: ["std-1200x600"] }, { op: "add_track", at: { end: "t999:0" }, pieces: ["ST-200"] }] });
    expect(r.error).toBe(true);
    expect(r.text).toBe("Step 2 (add_track): No track piece t999.");
    expect((await call(s, "propose_add_track", { title: "x", at: { x: 0, y: 0 }, pieces: ["NOPE-1"] })).text).toMatch(/No part "NOPE-1"/);
    expect((await call(s, "propose_move", { title: "x", ids: ["b1"], dx: 0 })).text).toContain("No baseboard");
  });

  test("catalogue tools", async () => {
    const libs = JSON.parse((await call(s, "list_track_systems")).text);
    expect(libs.map((l: any) => l.id)).toContain("piko-a-h0");
    expect(libs.find((l: any) => l.id === "hornby-oo").flexible_track).toBe("peco-setrack-oo/SL-100");
    const parts = JSON.parse((await call(s, "list_parts", { library: "peco-setrack-oo", type: "turnout" })).text);
    expect(parts.map((x: any) => x.part)).toEqual(["ST-241", "ST-240"]);
    expect(JSON.parse((await call(s, "list_baseboard_modules", { family: "corner" })).text).length).toBeGreaterThan(0);
    expect(JSON.parse((await call(s, "list_examples")).text).length).toBe(3);
  });
});

describe("operations", () => {
  const run = (p: Project, steps: any[]): OpContext => runSteps(p, steps);
  const heading = (p: Project, ctx: OpContext) => normAngle(ctx.last!.h) / DEG;

  test("sectional track turns the way asked, and points continue on the road asked", () => {
    const p = newProject();
    let ctx = run(p, [{ op: "add_track", library: "peco-setrack-oo", at: { x: 0, y: 0, heading: 0 }, pieces: ["ST-200", { part: "ST-221", turn: "left" }] }]);
    expect(heading(p, ctx)).toBeCloseTo(45, 1);
    ctx = run(p, [{ op: "add_track", library: "peco-setrack-oo", at: { x: 0, y: -500, heading: 0 }, pieces: [{ part: "ST-221", turn: "right" }] }]);
    expect(heading(p, ctx)).toBeCloseTo(-45, 1);
    ctx = run(p, [{ op: "add_track", library: "peco-setrack-oo", at: { x: 0, y: 500, heading: 0 }, pieces: [{ part: "ST-241", exit: 2 }, "ST-200"] }]);
    expect(Math.abs(heading(p, ctx))).toBeGreaterThan(5);
    expect(analyze(p).bad.length).toBe(0);
  });

  test("flexible track, then joining two ends closes the gap smoothly", () => {
    const p = newProject();
    run(p, [{ op: "add_track", library: "peco-setrack-oo", at: { x: 0, y: 0, heading: 0 }, pieces: ["ST-200"] }]);
    run(p, [{ op: "add_flex", library: "peco-setrack-oo", at: { x: 1000, y: 300, heading: 180 }, sections: [{ straight: 100 }] }]);
    const free = analyze(p).free;
    expect(free.length).toBe(4);
    const a = free.find((e) => e.item === "t1" && e.end === 1)!, b = free.find((e) => e.item === "t2" && e.end === 1)!;
    run(p, [{ op: "join_ends", from: { end: `${a.item}:${a.end}` }, to: { end: `${b.item}:${b.end}` } }]);
    const an = analyze(p);
    expect(an.free.length).toBe(2);
    expect(an.bad.length).toBe(0);
  });

  test("\"last\" carries on from the previous step, and \"near\" finds a free track position", () => {
    const p = newProject();
    const ctx = run(p, [
      { op: "add_modules", modules: ["std-1200x400", "std-1200x400"], tracks: 1 },
      { op: "add_flex", at: { near: { x: -50, y: 200 } }, sections: [{ straight: 300 }], library: "peco-setrack-oo" },
      { op: "add_yard", kind: "fiddle", roads: 3, length: 1500, at: { last: true }, library: "peco-setrack-oo" },
    ]);
    expect(ctx.created.filter((id) => id.startsWith("b")).length).toBe(2);
    expect(analyze(p).bad.length).toBe(0);
    expect(p.items.length).toBeGreaterThan(5);
    const first = p.items[0];
    expect(geom(first).ends[0].x).toBeCloseTo(p.boards[0].pts.reduce((m, q) => Math.min(m, q.x), Infinity), 0);
  });

  test("move, remove, track positions, examples and direct edits", () => {
    const p = newProject();
    run(p, [{ op: "add_modules", modules: ["std-1200x600"] }]);
    run(p, [{ op: "module_tracks", boards: "all", tracks: 3 }]);
    expect(p.boards[0].module!.tracks).toBe(3);
    const x0 = p.boards[0].pts[0].x;
    run(p, [{ op: "move", ids: [p.boards[0].name], dx: 100 }]);
    expect(p.boards[0].pts[0].x).toBeCloseTo(x0 + 100);
    run(p, [{ op: "add_example", example: "inglenook-shelf", library: "piko-a-h0" }]);
    expect(p.boards.length).toBe(3);
    expect(p.boards[1].pts[0].x).toBeGreaterThan(x0 + 1200);
    run(p, [{ op: "remove", ids: [p.boards[0].id] }]);
    expect(p.boards.length).toBe(2);
    expect(() => run(p, [{ op: "edit", add: { items: [{ part: "bogus/1", x: 0, y: 0, rot: 0 }] } }])).toThrow(/Unknown part/);
    run(p, [{ op: "edit", add: { items: [{ part: "peco-setrack-oo/ST-200", x: 0, y: -900, rot: 0 }] }, rename: "Edited" }]);
    expect(p.name).toBe("Edited");
    expect(() => run(p, [{ op: "fly" }])).toThrow(/unknown operation/);
  });
});

describe("through the hub", () => {
  let hub: Hub;
  let hdir: string;
  const port = 19100 + Math.floor(Math.random() * 800);
  let c: Connection;
  let s: McpServer;
  beforeAll(async () => {
    hdir = fs.mkdtempSync(path.join(os.tmpdir(), "railplot-mcphub-"));
    fs.writeFileSync(path.join(hdir, "layout.railplot"), serialize(buildControlDemo()));
    hub = new Hub({ layout: path.join(hdir, "layout.railplot"), port, wtPort: 0, name: "Test", host: "test-hub", mdns: false, appHtml: "", version: "9.9.9", quiet: true });
    hub.start();
    c = { target: null, folders: new Folders([dir]), hub: `127.0.0.1:${port}` };
    s = server(c);
  });
  afterAll(() => hub.stop());

  test("finds the hub by itself and proposes into the live layout", async () => {
    const st = JSON.parse((await call(s, "get_status")).text);
    expect(st.live).toBe(true);
    expect(st.plan).toBe("Two-train control demo");
    const v0 = hub.version;
    const r = await call(s, "propose_add_flex", { title: "A spur", at: { x: 0, y: -900, heading: 0 }, sections: [{ straight: 200 }] });
    expect(r.error).toBe(false);
    expect(hub.p.proposals?.length).toBe(1);
    expect(hub.p.proposals![0].v).toBe(v0 + 1);
    expect(hub.version).toBe(v0 + 1);
  });

  test("an editor's layout keeps proposals it hadn't seen, and drops ones it resolved", async () => {
    const pr = hub.p.proposals![0];
    const seenAt = hub.version;
    const editor = parseProject(serialize(hub.p));
    delete editor.proposals;           // this editor never had it
    const r1 = await fetch(`http://127.0.0.1:${port}/api/layout?base=${pr.v! - 1}`, { method: "POST", body: serialize(editor) });
    expect((await r1.json()).merged).toBe(1);
    expect(hub.p.proposals?.map((x) => x.id)).toEqual([pr.id]);
    // an editor that had it and rejected it
    const r2 = await fetch(`http://127.0.0.1:${port}/api/layout?base=${seenAt + 1}`, { method: "POST", body: serialize(editor) });
    expect((await r2.json()).merged).toBe(0);
    expect(hub.p.proposals).toBeUndefined();
  });

  test("an editor that says what it resolved never loses proposals it hadn't seen", async () => {
    await call(s, "propose_add_flex", { title: "One", at: { x: 0, y: -900, heading: 0 }, sections: [{ straight: 100 }] });
    await call(s, "propose_add_flex", { title: "Two", at: { x: 0, y: -1000, heading: 0 }, sections: [{ straight: 100 }] });
    const [one, two] = hub.p.proposals!;
    const editor = parseProject(serialize(hub.p));
    delete editor.proposals;
    // even with an old base version: only the resolved one goes
    const r = await fetch(`http://127.0.0.1:${port}/api/layout?base=99999`, { method: "POST", body: serialize(editor), headers: { "X-Railplot-Resolved": one.id } });
    expect((await r.json()).merged).toBe(1);
    expect(hub.p.proposals?.map((x) => x.id)).toEqual([two.id]);
    // a whole new layout (no header, no base) starts without proposals
    await fetch(`http://127.0.0.1:${port}/api/layout`, { method: "POST", body: serialize(editor) });
    expect(hub.p.proposals).toBeUndefined();
  });

  test("withdrawing through the hub", async () => {
    await call(s, "propose_remove", { title: "Tidy", ids: [hub.p.items[0].id] });
    const id = hub.p.proposals![0].id;
    expect((await call(s, "withdraw_proposal", { id })).text).toBe(`Withdrew ${id}.`);
    expect(hub.p.proposals).toBeUndefined();
  });

  test("the controls need the owner's permission, and never touch power", async () => {
    const t = (await HubTarget.probe(`127.0.0.1:${port}`))!;
    const train = hub.p.control!.trains[0];
    let r = await call(s, "drive_train", { train: train.name, speed: 30 });
    expect(r.error).toBe(true);
    expect(r.text).toContain("Let Claude use the controls");
    // the owner turns it on in Railplot (the setting travels with the layout)
    const p = parseProject(serialize(hub.p));
    p.control!.claude = true;
    hub.setLayout(serialize(p));
    expect(await t.command({ c: "power", on: false })).toMatch(/not track power/);
    expect(await t.command({ c: "estop", train: train.id })).toMatch(/not track power/);
    r = await call(s, "drive_train", { train: train.name, speed: 30 });
    expect(r.error).toBe(false);
    expect(hub.engine.run(train.id).target).toBeCloseTo(0.3);
    r = await call(s, "stop_train", { train: train.id });
    expect(hub.engine.run(train.id).target).toBe(0);
    const route = hub.p.control!.routes![0];
    expect((await call(s, "set_route", { route: route.name })).error).toBe(false);
    expect((await call(s, "set_point", { point: "point 1", position: "diverging" })).error).toBe(false);
    expect(hub.p.control!.points[0].state).toBe(1);
    const status = JSON.parse((await call(s, "get_control_status")).text);
    expect(status.claude_may_use_controls).toBe(true);
    expect(status.trains.length).toBe(2);
    expect(status.points[0].position).toMatch(/diverging/);
    const auto = hub.p.control!.automations![0];
    expect((await call(s, "run_automation", { automation: auto.name, run: true })).error).toBe(false);
    expect(hub.engine.autoRuns.get(auto.id)?.running).toBe(true);
    await call(s, "run_automation", { automation: auto.id, run: false });
    expect((await call(s, "set_signal", { signal: "nope", mode: "stop" })).text).toContain("No signal");
  });

  test("the controls aren't there without a hub", async () => {
    const f = path.join(dir, "plan2.railplot");
    fs.writeFileSync(f, serialize(newProject()));
    const s2 = server({ target: new FileTarget(f), folders: new Folders([dir]), hub: "" });
    expect((await call(s2, "get_control_status")).text).toContain("need the Railplot hub");
  });
});

test("a proposal made by hand applies like Claude's", () => {
  const p = buildControlDemo();
  const q = parseProject(serialize(p));
  q.items.pop();
  const pr = diffProposal(p, q, "x");
  expect(pr.remove.length).toBe(1);
  expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
});
