import { afterEach, describe, expect, test } from "bun:test";
import { ApiBackend, ChatError, defaultModel, listModels, renderMarkdown } from "../src/claude/chat";
import { CHAT_TOOLS, PlanEnv, PlanTarget, operationsGuide, planTools } from "../src/claude/plantools";
import { overlappingTrack } from "../src/checks";
import { addRectBoard, appendModule, createFlex, layGuides, newProject, placePart } from "../src/model";
import { parseProject, serialize } from "../src/io";
import type { Proposal } from "../src/proposals";
import { buildSample } from "../src/sample";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function appEnv(p = buildSample()) {
  const sent: Proposal[] = [];
  const target: PlanTarget = {
    kind: "app", label: "test",
    load: async () => parseProject(serialize(p)),
    addProposal: async (pr) => { sent.push(pr); },
    withdraw: async () => true,
  };
  const env: PlanEnv = { target: async () => target, control: async () => { throw new Error("no controls"); } };
  return { env, sent, p };
}

describe("the chat's tools", () => {
  test("the chat offers a short list, and the operations are described for the instructions", () => {
    const tools = planTools(appEnv().env).filter((t) => CHAT_TOOLS.includes(t.name));
    expect(tools.map((t) => t.name).sort()).toEqual([...CHAT_TOOLS].sort());
    for (const t of tools) expect(JSON.stringify(t.inputSchema).length).toBeLessThan(4096);   // the claude.ai limit
    const g = operationsGuide();
    for (const op of ["add_modules", "add_yard", "add_track", "add_flex", "join_ends", "lay_guides", "move", "remove", "add_example", "edit"]) expect(g).toContain(`- ${op}:`);
    expect(g.length).toBeLessThan(9000);
  });
});

describe("chat with an API key", () => {
  test("lists models and picks the newest Sonnet", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ id: "claude-opus-x", display_name: "Opus" }, { id: "claude-sonnet-y", display_name: "Sonnet" }] }))) as any;
    const m = await listModels("k");
    expect(defaultModel(m)).toBe("claude-sonnet-y");
    globalThis.fetch = (async () => new Response("{}", { status: 401 })) as any;
    await expect(listModels("bad")).rejects.toThrow(/didn't accept/);
  });

  test("runs tools until Claude has its answer, and proposals go to the plan's owner", async () => {
    const { env, sent } = appEnv();
    const tools = planTools(env).filter((t) => CHAT_TOOLS.includes(t.name));
    const bodies: any[] = [];
    const replies = [
      { content: [{ type: "text", text: "Looking." }, { type: "tool_use", id: "a", name: "check_layout", input: {} }], stop_reason: "tool_use" },
      { content: [{ type: "tool_use", id: "b", name: "propose_plan", input: { title: "Spur", steps: [{ op: "add_flex", at: { x: 0, y: -900, heading: 0 }, sections: [{ straight: 200 }] }] } },
        { type: "tool_use", id: "c", name: "nope", input: {} }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" },
    ];
    globalThis.fetch = (async (_url: string, init: any) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify(replies[bodies.length - 1])); }) as any;
    const texts: string[] = [], toolsRun: string[] = [];
    const out = await new ApiBackend("key", "m").run({
      instructions: "rules", turns: [{ role: "user", content: "hi" }], tools, signal: new AbortController().signal,
      onText: (t) => texts.push(t), onTool: (n, _i, r) => { if (r) toolsRun.push(`${n}:${r.error ? "error" : "ok"}`); },
    });
    expect(out).toBe("Looking.\n\nDone.");
    expect(toolsRun).toEqual(["check_layout:ok", "propose_plan:ok", "nope:error"]);
    expect(sent.length).toBe(1);
    expect(sent[0].title).toBe("Spur");
    expect(bodies[0].system).toBe("rules");
    expect(bodies[0].tools.some((t: any) => t.name === "propose_plan" && t.input_schema)).toBe(true);
    // the tool results go back with the ids Claude used
    const last = bodies[2].messages[bodies[2].messages.length - 1];
    expect(last.content.map((r: any) => [r.tool_use_id, r.is_error])).toEqual([["b", false], ["c", true]]);
  });

  test("a bad key or a busy service comes back as a plain message", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })) as any;
    const run = () => new ApiBackend("k", "m").run({ instructions: "", turns: [{ role: "user", content: "hi" }], tools: [], signal: new AbortController().signal, onText: () => {}, onTool: () => {} });
    await expect(run()).rejects.toMatchObject({ code: "auth" });
    globalThis.fetch = (async () => new Response("{}", { status: 529 })) as any;
    await expect(run()).rejects.toBeInstanceOf(ChatError);
  });
});

test("replies are shown with a little Markdown, and nothing else gets through as HTML", () => {
  const h = renderMarkdown("**Hi** <b>there</b>\n\n- one `R600`\n- two\n1. first\n## Head");
  expect(h).toBe("<p><strong>Hi</strong> &lt;b&gt;there&lt;/b&gt;</p><ul><li>one <code>R600</code></li><li>two</li></ul><ol><li>first</li></ol><p><strong>Head</strong></p>");
});

describe("track laid twice", () => {
  test("the check finds track laid on top of other track", () => {
    const p = newProject();
    addRectBoard(p, 0, 0, 3000, 600);
    for (let i = 0; i < 3; i++) placePart(p, "hornby-oo/R603", { x: i * 670, y: 300, h: 0 });
    expect(overlappingTrack(p)).toEqual([]);
    createFlex(p, "peco-setrack-oo/SL-100", { x: 500, y: 300, h: 0, z: 0 }, [{ kind: "s", len: 900 }]);
    expect(overlappingTrack(p).length).toBe(3);   // it runs along all three straights
    expect(overlappingTrack(buildSample())).toEqual([]);
  });

  test("laying track on the guides leaves out guides that already have track along them", () => {
    const p = newProject();
    appendModule(p, "std-1200x600"); appendModule(p, "std-1200x600"); appendModule(p, "std-1200x600");
    for (const b of p.boards) { b.module!.tracks = 2; }
    const y = trackY(p);
    // sectional track along one track position, with no ends at the module joints
    for (let i = 0; i < 5; i++) placePart(p, "hornby-oo/R603", { x: i * 670, y, h: 0 });
    const r = layGuides(p, p.boards[1].id, "peco-setrack-oo/SL-100");
    expect(r.laid.length).toBe(1);
    expect(r.already).toBe(1);
  });
});

function trackY(p: ReturnType<typeof newProject>) {
  const { trackPorts } = require("../src/model");
  return Math.max(...trackPorts(p).map((q: any) => q.y));
}
