// The Railplot tools that work on a plan, wherever it comes from: a file or the hub. They read and check
// the plan, send proposals the owner accepts or rejects, and, when the owner allows it, use the layout's controls.
import { DEG, dist, normAngle, pointInPoly } from "../geom";
import { LIBRARIES, getLibrary, getPart, partGeometryLabel } from "../library";
import { parseProject, serialize } from "../io";
import {
  Project, allModuleEnds, analyze, endKey, geom, itemRoutes, mainLibrary, partsList, summarize, trackPorts,
} from "../model";
import { minRadius } from "../geom";
import { MODULES, edgeOf, endsTouch, getModule, tracksOf } from "../modules";
import type { Proposal } from "../proposals";
import { describeProposal, diffProposal, healthLine, isEmptyProposal, staleIds } from "../proposals";
import { layoutIssues } from "../checks";
import { EXAMPLES } from "../examples";
import { yardParts } from "../yards";
import type { Cmd, Snapshot } from "../control/remote";
import { OPS, OpContext, runSteps, flexFor, OpError } from "./ops";
import { ToolDef, ToolError } from "./tooldefs";

/** Where the plan comes from, and where proposals go. */
export interface PlanTarget {
  kind: string;
  label: string;
  load(): Promise<Project>;
  addProposal(pr: Proposal): Promise<void>;
  withdraw(id: string): Promise<boolean>;
}

/** The layout's controls, as the place that runs them sees it. */
export interface ControlAccess {
  state(): Promise<{ claude: boolean; snap: Snapshot; p: Project }>;
  /** Returns an error message, or null when it worked. */
  command(cmd: Cmd): Promise<string | null>;
}

export interface PlanEnv {
  target(): Promise<PlanTarget>;
  /** Throws a ToolError saying why when there are no controls here. */
  control(): Promise<ControlAccess>;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const deg = (h: number) => r1(((normAngle(h) / DEG) + 360) % 360);
const json = (x: unknown) => JSON.stringify(x, null, 1);

// ---------- describing a plan ----------

export function boardInfo(p: Project) {
  const all = allModuleEnds(p);
  const ports = trackPorts(p);
  const an = analyze(p);
  return p.boards.map((b) => {
    const m = b.module && getModule(b.module.preset);
    const xs = b.pts.map((q) => q.x), ys = b.pts.map((q) => q.y);
    const base = { id: b.id, name: b.name, bounds: { minX: r1(Math.min(...xs)), minY: r1(Math.min(...ys)), maxX: r1(Math.max(...xs)), maxY: r1(Math.max(...ys)) } };
    if (!m || !b.module) return { ...base, kind: "plain", corners: b.pts.map((q) => [r1(q.x), r1(q.y)]) };
    const pl = b.module;
    return {
      ...base, kind: "module", preset: m.id, module: m.name, family: m.family, size: m.size,
      centre: [r1(pl.cx), r1(pl.cy)], rotation: deg(pl.rot), mirrored: !!pl.mirror,
      tracks: tracksOf(m, pl), spacing: pl.spacing, edge: edgeOf(m, pl),
      faces: all.filter((e) => e.board === b.id).map((e) => {
        const o = all.find((x) => x.board !== b.id && endsTouch(e, x));
        return { face: e.end, width: e.width, centre: [r1(e.x), r1(e.y)], facing: deg(e.h), joined_to: o ? p.boards.find((x) => x.id === o.board)?.name ?? o.board : null };
      }),
      track_positions: ports.filter((q) => q.board === b.id).map((q) => ({
        face: q.face, index: q.index, at: [r1(q.x), r1(q.y)], heading_into_board: deg(q.h), used: an.ends.some((e) => dist(e, q) < 1),
      })),
    };
  });
}

function itemInfo(p: Project, ids?: Set<string>, boardId?: string, limit = 300) {
  const an = analyze(p);
  const b = boardId ? p.boards.find((x) => x.id === boardId || x.name === boardId) : undefined;
  if (boardId && !b) throw new ToolError(`No baseboard "${boardId}".`);
  const out: unknown[] = [];
  let more = 0;
  for (const it of p.items) {
    if (ids && !ids.has(it.id)) continue;
    const g = geom(it);
    if (b) {
      const c = { x: (g.bounds.minX + g.bounds.maxX) / 2, y: (g.bounds.minY + g.bounds.maxY) / 2 };
      if (!pointInPoly(c, b.pts) && !g.ends.some((e) => pointInPoly(e, b.pts))) continue;
    }
    if (out.length >= limit) { more++; continue; }
    const d = g.part.def;
    const r = d.type === "flex" ? Math.min(...itemRoutes(it).map((x) => minRadius(x.segs))) : Infinity;
    out.push({
      id: it.id, part: d.id, library: g.part.lib.id, name: d.name, type: d.type, layer: it.layer,
      length: r1(g.length), ...(d.type === "flex" && isFinite(r) ? { tightest_radius: Math.round(r) } : {}),
      ends: g.ends.map((e, k) => {
        const j = an.partner.get(endKey({ item: it.id, end: k }));
        return { end: k, at: [r1(e.x), r1(e.y)], facing: deg(e.h), ...(e.z ? { height: r1(e.z) } : {}), joined_to: j ? endKey(j) : null };
      }),
    });
  }
  return { items: out, more };
}

export function layoutSummary(p: Project, where: string) {
  const s = summarize(p);
  const libs = new Map<string, number>();
  for (const it of p.items) { const k = getPart(it.part)?.lib.id ?? "?"; libs.set(k, (libs.get(k) ?? 0) + 1); }
  const cfg = p.control;
  return {
    name: p.name, open_from: where, units: "mm (x to the right, y up the plan; headings in degrees, 0 = +x, 90 = +y)",
    baseboards: p.boards.length, modules: p.boards.filter((b) => b.module).map((b) => `${b.name} (${b.id}): ${getModule(b.module!.preset)?.name ?? b.module!.preset}`),
    track: { sectional_pieces: s.pieces, flexible_mm: Math.round(s.flexLength), total_mm: Math.round(s.trackLength), tightest_radius: isFinite(s.minRadius) ? Math.round(s.minRadius) : null, steepest_percent: r1(s.maxGradient) },
    track_systems: Object.fromEntries(libs), main_track_system: p.items.length ? mainLibrary(p) : null,
    layers: p.layers.map((l) => `${l.name} (${l.id})${l.visible ? "" : ", hidden"}`),
    health: healthLine(p),
    pending_proposals: (p.proposals ?? []).map((x) => ({ id: x.id, title: x.title, change: describeProposal(x), out_of_date: staleIds(p, x).length > 0 })),
    control: cfg ? {
      controllers: cfg.controllers.length, blocks: cfg.blocks.length, points: cfg.points.length, signals: cfg.signals.length,
      trains: cfg.trains.map((t) => t.name), routes: (cfg.routes ?? []).map((r) => r.name), automations: (cfg.automations ?? []).map((a) => a.name),
      claude_may_use_controls: !!cfg.claude,
    } : null,
  };
}

// ---------- schemas ----------

const anchorSchema = (what: string) => ({
  type: "object",
  description: `${what}. Give one of: end ("t12:1", an open end of a piece), port ({board, index, face}: a track position on a module's face), start (a start point id), x/y/heading (anywhere; heading in degrees), last (true: where the previous step's track ended), near ({x, y}: the closest open end or free track position).`,
  properties: {
    end: { type: "string" },
    port: { type: "object", properties: { board: { type: "string" }, index: { type: "integer" }, face: { type: "integer" } }, required: ["board"] },
    start: { type: "string" },
    x: { type: "number" }, y: { type: "number" }, heading: { type: "number" },
    last: { type: "boolean" },
    near: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
  },
});

const proposeProps = {
  title: { type: "string", description: "A short name for the change, shown to the owner (e.g. \"Inglenook on Module 3\")." },
  reason: { type: "string", description: "Why you suggest it, in a sentence or two." },
  preview: { type: "boolean", description: "Only work it out and report: don't send it to Railplot yet." },
};

const libProp = { type: "string", description: "Track system id (list_track_systems). Default: the one the plan mostly uses." };

const STEP_DOCS: Record<string, { description: string; properties: Record<string, unknown>; required: string[] }> = {
  add_modules: {
    description: "Add laser-cut baseboard modules in a row, each joined to the free face of the one before (the first joins `after`, or the last module of the plan, or starts a new row).",
    properties: {
      modules: { type: "array", items: { type: "string" }, description: "Module ids from list_baseboard_modules, in order." },
      after: { type: "string", description: "Board id or name to join the first one to." },
      face: { type: "integer", description: "Which face of the first new module joins (a corner joined by its other face turns the other way)." },
      tracks: { type: "integer", minimum: 0, maximum: 4, description: "Track positions across each (default: carried on from the module before, or 1)." },
      spacing: { type: "number" }, edge: { type: "number", description: "mm from each face end to the outer track; 0 puts them together at the spacing." },
      library: libProp,
    },
    required: ["modules"],
  },
  module_tracks: {
    description: "Set the track positions across modules.",
    properties: {
      boards: { description: "Board ids or names, or \"all\".", anyOf: [{ type: "array", items: { type: "string" } }, { type: "string", enum: ["all"] }] },
      tracks: { type: "integer", minimum: 0, maximum: 4 }, spacing: { type: "number" }, edge: { type: "number" },
    },
    required: ["boards"],
  },
  add_yard: {
    description: "Build a ready-made yard from the track system's own points: a fiddle yard (one end), fiddle2 (double-ended), runround (a run-round loop with headshunts) or inglenook (the Inglenook sidings shunting puzzle).",
    properties: {
      kind: { type: "string", enum: ["fiddle", "fiddle2", "runround", "inglenook"] },
      at: anchorSchema("Where the yard starts (its toe, or the far end of the Inglenook headshunt), facing into the yard"),
      roads: { type: "integer", minimum: 2, maximum: 8 }, side: { type: "string", enum: ["left", "right"], description: "Which side of the first road the others go." },
      length: { type: "number", description: "Overall length in mm (fiddle yards, run-round loop)." }, spacing: { type: "number", description: "Exact distance between roads, mm (default: what the points give)." },
      wagon: { type: "number", description: "Inglenook wagon length, mm." }, headshunt: { type: "number", description: "Headshunt length, mm." },
      library: libProp,
    },
    required: ["kind", "at"],
  },
  add_track: {
    description: "Lay sectional pieces one after another. Each piece joins the end of the one before.",
    properties: {
      at: anchorSchema("Where the first piece joins"),
      pieces: { type: "array", description: "Part numbers (\"ST-200\"), or objects {part, turn: left|right (curves and points), enter (which end joins, default 0), exit (which end the next piece joins; for points 1 is the straight road and 2 the diverging one)}.",
        items: { anyOf: [{ type: "string" }, { type: "object", properties: { part: { type: "string" }, turn: { type: "string", enum: ["left", "right"] }, enter: { type: "integer" }, exit: { type: "integer" } }, required: ["part"] }] } },
      library: libProp,
    },
    required: ["at", "pieces"],
  },
  add_flex: {
    description: "Lay flexible track as straight and curved sections.",
    properties: {
      at: anchorSchema("Where it starts"),
      sections: { type: "array", items: { type: "object", properties: { straight: { type: "number" }, radius: { type: "number" }, angle: { type: "number", description: "Degrees; + turns left, − right." } } } },
      part: { type: "string", description: "Flexible track part (default: the track system's own)." }, library: libProp,
    },
    required: ["at", "sections"],
  },
  join_ends: {
    description: "Join two places (open ends or track positions) with one smooth piece of flexible track.",
    properties: { from: anchorSchema("One end"), to: anchorSchema("The other end"), part: { type: "string" }, library: libProp },
    required: ["from", "to"],
  },
  lay_guides: {
    description: "Lay flexible track along the guides on modules: the lines between their track positions, including the curves on corner modules.",
    properties: { boards: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "string", enum: ["all"] }] }, part: { type: "string" }, library: libProp },
    required: ["boards"],
  },
  move: {
    description: "Move and/or turn pieces, boards and start points.",
    properties: { ids: { type: "array", items: { type: "string" } }, dx: { type: "number" }, dy: { type: "number" }, rotate: { type: "number", description: "Degrees, + anticlockwise." },
      about: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } } },
    required: ["ids"],
  },
  remove: { description: "Remove pieces, boards or start points.", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"] },
  add_example: {
    description: "Add one of the example shunting layouts (list_examples), boards and track, built for a track system, beside the plan.",
    properties: { example: { type: "string" }, library: libProp, where: { type: "string", enum: ["right", "below"] } },
    required: ["example"],
  },
  edit: {
    description: "Direct edits for anything else: add or change pieces and boards as plan objects (see get_track for their shape), remove ids, rename the plan.",
    properties: {
      add: { type: "object", properties: { items: { type: "array", items: { type: "object" } }, boards: { type: "array", items: { type: "object" } } } },
      change: { type: "object", properties: { items: { type: "array", items: { type: "object" } }, boards: { type: "array", items: { type: "object" } } } },
      remove: { type: "array", items: { type: "string" } }, rename: { type: "string" },
    },
    required: [],
  },
};

// ---------- the tools ----------


// ---------- the tools ----------

export function planTools(env: PlanEnv): ToolDef[] {
  const read = { readOnlyHint: true, openWorldHint: false };
  const propose = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  /** Run steps on a copy of the plan and send the difference as one proposal. */
  async function proposeSteps(title: string, reason: string | undefined, steps: { op: string; [k: string]: unknown }[], previewOnly = false): Promise<string> {
    if (!title?.trim()) throw new ToolError("Give the proposal a short title.");
    const t = await env.target();
    const p = await t.load();
    const before = parseProject(serialize(p));
    let ctx: OpContext;
    try { ctx = runSteps(p, steps); }
    catch (e) { throw new ToolError(e instanceof OpError ? e.message : `That didn't work: ${(e as Error).message}`); }
    const pr = diffProposal(before, p, title, reason ?? "");
    if (isEmptyProposal(pr)) throw new ToolError("That changes nothing in the plan.");
    const mine = new Set(ctx.created);
    const issues = layoutIssues(p).filter((i) => i.kind !== "open-end" && ((i.item && mine.has(i.item)) || (i.board && mine.has(i.board)) || i.kind === "misaligned" || i.kind === "module-tracks"));
    const lines = [
      ...ctx.notes,
      `It ${describeProposal(pr)}.`,
      `With it, the plan has ${healthLine(p)}.`,
      issues.length ? `Worth a look:\n${issues.slice(0, 12).map((i) => `- ${i.text}`).join("\n")}${issues.length > 12 ? `\n- and ${issues.length - 12} more` : ""}` : "",
      ctx.created.length ? `New ids (they can change if the plan changes before it's accepted): ${ctx.created.slice(0, 60).join(", ")}${ctx.created.length > 60 ? "…" : ""}` : "",
    ].filter(Boolean);
    if (previewOnly) return `Preview only, nothing sent.\n${lines.join("\n")}`;
    await t.addProposal(pr);
    return `Proposal ${pr.id}, “${pr.title}”, is waiting in Railplot under Claude's proposals. The owner can show it on the plan, accept or reject it; nothing changes until they accept. Each proposal starts from the plan as it is now, so put steps that build on each other into one propose_plan.\n${lines.join("\n")}`;
  }

  const stepTool = (op: keyof typeof OPS, name: string, title: string): ToolDef => {
    const d = STEP_DOCS[op];
    return {
      name, title, annotations: propose,
      description: `${d.description} Sent to Railplot as a proposal the owner accepts or rejects.`,
      inputSchema: { type: "object", properties: { ...proposeProps, ...d.properties }, required: ["title", ...d.required] },
      run: (a) => { const { title: tt, reason, preview, ...rest } = a; return proposeSteps(tt, reason, [{ ...rest, op }], !!preview); },
    };
  };

  const tools: ToolDef[] = [
    {
      name: "get_layout", title: "Plan summary", annotations: read,
      description: "The open plan in brief: boards and modules, track totals by track system, layers, health (open ends, joints, point motors), pending proposals and the control setup.",
      inputSchema: { type: "object", properties: {} },
      run: async () => { const t = await env.target(); return json(layoutSummary(await t.load(), t.label)); },
    },
    {
      name: "list_boards", title: "Baseboards", annotations: read,
      description: "Every baseboard: plain boards with their corners; modules with their faces (width, what they join), track positions (where track crosses each face, and whether track is there) and settings.",
      inputSchema: { type: "object", properties: {} },
      run: async () => json(boardInfo(await (await env.target()).load())),
    },
    {
      name: "get_track", title: "Track pieces", annotations: read,
      description: "Track pieces with their part, length and ends (position, facing, height, what each end joins). Filter by ids or by a board.",
      inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" } }, board: { type: "string" }, limit: { type: "integer" } } },
      run: async (a) => {
        const p = await (await env.target()).load();
        const r = itemInfo(p, a.ids ? new Set(a.ids) : undefined, a.board, a.limit ?? 300);
        return json(r.more ? { ...r, note: `${r.more} more not shown: filter by board or ids.` } : r.items);
      },
    },
    {
      name: "check_layout", title: "Check the plan", annotations: read,
      description: "Problems in the plan: open ends, misaligned joints, point motors over frame members, track off the boards or near an edge, curves tighter than the track allows, steep gradients, and modules whose tracks don't line up.",
      inputSchema: { type: "object", properties: { include_open_ends: { type: "boolean", description: "List each open end (default true)." } } },
      run: async (a) => {
        const p = await (await env.target()).load();
        const all = layoutIssues(p).filter((i) => a.include_open_ends !== false || i.kind !== "open-end");
        return all.length ? `${healthLine(p)}.\n${all.map((i) => `- [${i.severity}] ${i.text}`).join("\n")}` : `No problems found: ${healthLine(p)}.`;
      },
    },
    {
      name: "get_parts_list", title: "Parts list", annotations: read,
      description: "What to buy: track pieces by part number (flexible track in lengths) and baseboard module hardware.",
      inputSchema: { type: "object", properties: { by_layer: { type: "boolean" } } },
      run: async (a) => json(partsList(await (await env.target()).load(), { byLayer: !!a.by_layer }).map((r) => ({ part: r.id, name: r.name, maker: r.producer, count: r.count, ...(r.length ? { length_mm: Math.round(r.length) } : {}), ...(r.layer ? { layer: r.layer } : {}) }))),
    },
    {
      name: "list_track_systems", title: "Track systems", annotations: read,
      description: "The track libraries Railplot has: id, scale, gauge, track spacing, flexible track and the points yards are built from.",
      inputSchema: { type: "object", properties: {} },
      run: () => json(LIBRARIES.map((l) => {
        const y = yardParts(l.id);
        const count = (t: string) => l.parts.filter((d) => d.type === t).length;
        return { id: l.id, name: l.name, scale: l.scale, gauge: l.gauge, track_spacing: l.trackSpacing ?? null, flexible_track: flexFor(l.id),
          parts: { straights: count("straight"), curves: count("curve"), points: count("turnout"), crossings: count("crossing") },
          yard_points: y ? { left: y.left, right: y.right, angle: r1(y.angle / DEG), radius: y.radius } : null };
      })),
    },
    {
      name: "list_parts", title: "Parts in a track system", annotations: read,
      description: "The parts in a track system: part number, name, type and geometry (length, radius · angle), with how many ends each has.",
      inputSchema: { type: "object", properties: { library: { type: "string" }, type: { type: "string", enum: ["straight", "curve", "turnout", "crossing", "flex"] }, search: { type: "string" } }, required: ["library"] },
      run: (a) => {
        const lib = getLibrary(a.library);
        if (!lib) throw new ToolError(`No track system "${a.library}". list_track_systems shows them.`);
        const q = String(a.search ?? "").toLowerCase();
        return json(lib.parts.filter((d) => (!a.type || d.type === a.type) && (!q || d.id.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))).map((d) => {
          const part = getPart(`${lib.id}/${d.id}`)!;
          return { part: d.id, name: d.name, type: d.type, geometry: partGeometryLabel(d), ...(d.hand ? { hand: d.hand } : {}), ends: d.type === "flex" ? 2 : part.ends.length, ...(d.approximate ? { approximate: true } : {}) };
        }));
      },
    },
    {
      name: "list_baseboard_modules", title: "Baseboard modules", annotations: read,
      description: "The laser-cut baseboard module range: id, family, size, faces and what each is for.",
      inputSchema: { type: "object", properties: { family: { type: "string" } } },
      run: (a) => json(MODULES.filter((m) => !a.family || m.family.toLowerCase().includes(String(a.family).toLowerCase())).map((m) => ({
        id: m.id, name: m.name, family: m.family, size: m.size, faces: m.faces.map((f) => f.width), weight_kg: m.weightKg, about: m.blurb,
      }))),
    },
    {
      name: "list_examples", title: "Example layouts", annotations: read,
      description: "The example shunting layouts that can be added to a plan with propose_add_example.",
      inputSchema: { type: "object", properties: {} },
      run: () => json(EXAMPLES.map((e) => ({ id: e.id, name: e.name, boards: e.boards, about: e.blurb }))),
    },
    {
      name: "list_proposals", title: "Pending proposals", annotations: read,
      description: "Proposals waiting for the owner, and whether the plan has changed under any of them.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const p = await (await env.target()).load();
        const list = (p.proposals ?? []).map((x) => ({ id: x.id, title: x.title, by: x.by, at: x.at, change: describeProposal(x), out_of_date: staleIds(p, x).length > 0 }));
        return list.length ? json(list) : "No proposals waiting: the owner has accepted or rejected them all.";
      },
    },
    {
      name: "withdraw_proposal", title: "Withdraw a proposal", annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Take back one of your proposals that the owner hasn't accepted or rejected yet.",
      inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: async (a) => ((await (await env.target()).withdraw(a.id)) ? `Withdrew ${a.id}.` : `${a.id} isn't waiting any more (accepted, rejected or withdrawn).`),
    },
    stepTool("add_modules", "propose_add_modules", "Propose baseboard modules"),
    stepTool("module_tracks", "propose_module_tracks", "Propose track positions"),
    stepTool("add_yard", "propose_add_yard", "Propose a yard"),
    stepTool("add_track", "propose_add_track", "Propose sectional track"),
    stepTool("add_flex", "propose_add_flex", "Propose flexible track"),
    stepTool("join_ends", "propose_join_ends", "Propose joining two ends"),
    stepTool("lay_guides", "propose_lay_guides", "Propose track on module guides"),
    stepTool("move", "propose_move", "Propose moving things"),
    stepTool("remove", "propose_remove", "Propose removing things"),
    stepTool("add_example", "propose_add_example", "Propose an example layout"),
    stepTool("edit", "propose_edit", "Propose direct edits"),
    {
      name: "propose_plan", title: "Propose several steps", annotations: propose,
      description: `Several operations in order, sent as one proposal: for changes that build on each other (modules, then track positions, then a yard from a track position, then flexible track on from "last"). Each step is {op, ...the same arguments as the matching propose_ tool}. Operations: ${Object.keys(OPS).join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: { ...proposeProps, steps: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: Object.keys(OPS) } }, required: ["op"] } } },
        required: ["title", "steps"],
      },
      run: (a) => proposeSteps(a.title, a.reason, a.steps ?? [], !!a.preview),
    },
    ...controlTools(env),
  ];
  return tools;
}

// ---------- the controls (through the hub, when the owner allows it) ----------


// ---------- the controls (when the owner allows it) ----------

function controlTools(env: PlanEnv): ToolDef[] {
  const act = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
  async function ready() {
    const h = await env.control();
    const st = await h.state();
    return { h, p: st.p, st, cfg: st.p.control };
  }
  const find = <T extends { id: string; name?: string }>(list: T[] | undefined, ref: string, what: string): T => {
    const l = list ?? [];
    const x = l.find((o) => o.id === ref) ?? l.find((o) => o.name?.toLowerCase() === String(ref).toLowerCase());
    if (!x) throw new ToolError(`No ${what} "${ref}". get_control_status lists them.`);
    return x;
  };
  async function send(cmd: Cmd, ok: string) {
    const h = await env.control();
    const err = await h.command(cmd);
    if (err) throw new ToolError(err);
    return ok;
  }

  return [
    {
      name: "get_control_status", title: "Layout status", annotations: { readOnlyHint: true, openWorldHint: true },
      description: "What the layout is doing now (through the hub): trains (where, speed), blocks, points, signals, lights, routes, automations and track power, and whether you may use the controls.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const { p, st, cfg } = await ready();
        if (!cfg) return "This layout has no control setup yet.";
        const s = st.snap;
        const blockName = (id: string | null | undefined) => (id ? cfg.blocks.find((b) => b.id === id)?.name ?? id : null);
        const pointName = (item: string) => `point ${cfg.points.findIndex((q) => q.item === item) + 1}`;
        return json({
          claude_may_use_controls: st.claude, track_power: s.powerOn ? "on" : "off",
          trains: cfg.trains.map((t) => {
            const run = s.runs.find((r) => r[0] === t.id);
            const where = s.trains.find((x) => x[0] === t.id)?.[1];
            const auto = (cfg.automations ?? []).find((a) => a.train === t.id && s.autos.some(([id, r]) => id === a.id && r.running));
            return { id: t.id, name: t.name, block: blockName(where), speed_percent: run ? Math.round(run[2] * 100) : 0, throttle_percent: run ? Math.round(run[1] * 100) : 0, automation: auto?.name ?? null };
          }),
          blocks: cfg.blocks.map((b) => ({ id: b.id, name: b.name, train: cfg.trains.find((t) => s.trains.some(([id, blk]) => id === t.id && blk === b.id))?.name ?? null, fault: s.faults.find((f) => f[0] === b.id)?.[1] ?? null })),
          points: cfg.points.map((q) => ({ id: q.item, name: pointName(q.item), position: (s.points.find((x) => x[0] === q.item)?.[1] ?? q.state) === 0 ? "straight" : `route ${s.points.find((x) => x[0] === q.item)?.[1] ?? q.state} (diverging)` })),
          signals: cfg.signals.map((g) => ({ id: g.id, name: g.name, aspect: s.aspects.find((a) => a[0] === g.id)?.[1] ?? null, mode: s.signals.find((x) => x[0] === g.id)?.[1] ?? g.mode })),
          lights: cfg.lights.map((l) => { const x = s.lights.find((y) => y[0] === l.id); return { id: l.id, name: l.name, on: x?.[1] ?? l.on, level: x?.[2] ?? l.level }; }),
          routes: (cfg.routes ?? []).map((r) => ({ id: r.id, name: r.name })),
          automations: (cfg.automations ?? []).map((a) => { const r = s.autos.find(([id]) => id === a.id)?.[1]; return { id: a.id, name: a.name, train: cfg.trains.find((t) => t.id === a.train)?.name ?? null, running: !!r?.running, status: r?.running ? r.status : null }; }),
          plan: p.name,
        });
      },
    },
    {
      name: "set_route", title: "Set a route", annotations: act,
      description: "Set a route: all its points at once. Needs the owner's permission (\"Let Claude use the controls\" in Railplot).",
      inputSchema: { type: "object", properties: { route: { type: "string", description: "Route id or name." } }, required: ["route"] },
      run: async (a) => { const { cfg } = await ready(); const r = find(cfg?.routes, a.route, "route"); return send({ c: "route", id: r.id }, `Route ${r.name} set.`); },
    },
    {
      name: "set_point", title: "Set a point", annotations: act,
      description: "Throw a point: straight or diverging (or a route number for three-way points).",
      inputSchema: { type: "object", properties: { point: { type: "string", description: "Point id (the track piece) or \"point 3\"." }, position: { type: "string", description: "straight, diverging, or a route number." } }, required: ["point", "position"] },
      run: async (a) => {
        const { cfg } = await ready();
        const pts = cfg?.points ?? [];
        const m = String(a.point).match(/^point\s*(\d+)$/i);
        const q = m ? pts[+m[1] - 1] : pts.find((x) => x.item === a.point);
        if (!q) throw new ToolError(`No point "${a.point}". get_control_status lists them.`);
        const pos = String(a.position).toLowerCase();
        const state = pos === "straight" ? 0 : pos === "diverging" ? 1 : /^\d+$/.test(pos) ? +pos : NaN;
        if (!Number.isFinite(state)) throw new ToolError("position is straight, diverging or a route number.");
        return send({ c: "point", item: q.item, state }, `Point ${pts.indexOf(q) + 1} set ${state === 0 ? "straight" : "to diverge"}.`);
      },
    },
    {
      name: "set_signal", title: "Set a signal", annotations: act,
      description: "Hold a signal at danger (stop) or let it work by itself (auto).",
      inputSchema: { type: "object", properties: { signal: { type: "string" }, mode: { type: "string", enum: ["auto", "stop"] } }, required: ["signal", "mode"] },
      run: async (a) => { const { cfg } = await ready(); const g = find(cfg?.signals, a.signal, "signal"); return send({ c: "signal", id: g.id, mode: a.mode === "stop" ? "stop" : "auto" }, `${g.name} ${a.mode === "stop" ? "held at danger" : "working by itself"}.`); },
    },
    {
      name: "set_light", title: "Set a light", annotations: act,
      description: "Switch a building or street light on or off, or set its brightness (1-100 %).",
      inputSchema: { type: "object", properties: { light: { type: "string" }, on: { type: "boolean" }, level: { type: "number", minimum: 1, maximum: 100 } }, required: ["light"] },
      run: async (a) => { const { cfg } = await ready(); const l = find(cfg?.lights, a.light, "light"); return send({ c: "light", id: l.id, on: a.on, level: a.level }, `${l.name} updated.`); },
    },
    {
      name: "drive_train", title: "Drive a train", annotations: act,
      description: "Set a train's throttle, -100 to 100 % (negative is backwards); 0 stops it with its momentum. Track power must already be on: you can't switch it on.",
      inputSchema: { type: "object", properties: { train: { type: "string" }, speed: { type: "number", minimum: -100, maximum: 100 } }, required: ["train", "speed"] },
      run: async (a) => {
        const { cfg } = await ready();
        const t = find(cfg?.trains, a.train, "train");
        const v = Math.max(-100, Math.min(100, Number(a.speed) || 0));
        return send({ c: "throttle", train: t.id, v: v / 100 }, v === 0 ? `${t.name} is slowing to a stop.` : `${t.name}: throttle ${v} %${v < 0 ? " (backwards)" : ""}. Signals and blocks still protect it.`);
      },
    },
    {
      name: "stop_train", title: "Stop a train", annotations: { ...act, idempotentHint: true },
      description: "Bring a train to a stop (throttle to 0, with its momentum).",
      inputSchema: { type: "object", properties: { train: { type: "string" } }, required: ["train"] },
      run: async (a) => { const { cfg } = await ready(); const t = find(cfg?.trains, a.train, "train"); return send({ c: "throttle", train: t.id, v: 0 }, `${t.name} is slowing to a stop.`); },
    },
    {
      name: "run_automation", title: "Start or stop an automation", annotations: act,
      description: "Start or stop one of the layout's automations (shuttles, trips, timetables).",
      inputSchema: { type: "object", properties: { automation: { type: "string" }, run: { type: "boolean" } }, required: ["automation", "run"] },
      run: async (a) => { const { cfg } = await ready(); const x = find(cfg?.automations, a.automation, "automation"); return send({ c: "auto", id: x.id, run: !!a.run }, `${x.name} ${a.run ? "started" : "stopped"}.`); },
    },
  ];
}

export const INSTRUCTIONS = `Railplot is a model railway track planner (OO and H0). This connector reads the owner's plan and sends proposals: changes the owner sees on the plan and accepts or rejects in Railplot. Nothing changes until they accept.
Start with get_status, then get_layout. Positions are in mm on the plan (x right, y up); headings are degrees (0 = +x, 90 = +y). Track positions on baseboard modules (list_boards) are where track should cross module joints; build from them so tracks line up.
To build, use the propose_ tools, or propose_plan for several steps that build on each other. Use preview: true to try something without sending it, then check_layout's findings to adjust. Keep proposals focused, each with a clear title and reason.
The control tools work only through the Railplot hub and only when the owner has turned on "Let Claude use the controls". Track power and emergency stops are never available to you. Tell the owner before moving trains.`;


export const CONTROL_TOOLS = ["get_control_status", "set_route", "set_point", "set_signal", "set_light", "drive_train", "stop_train", "run_automation"];
