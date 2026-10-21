// The Railplot connector's tools: the plan tools (src/claude/plantools.ts) on a .railplot file or the
// Railplot hub, plus finding and opening plans on this computer.
import { Project } from "../model";
import { ToolDef, ToolError } from "./server";
import { FileTarget, Folders, HubTarget, Target } from "./targets";
import { ControlAccess, INSTRUCTIONS, PlanEnv, layoutSummary, planTools } from "../claude/plantools";

export { INSTRUCTIONS };

export interface Connection {
  target: Target | null;
  folders: Folders;
  /** Hub to look for when nothing is open yet ("" for none). */
  hub: string;
}

const json = (x: unknown) => JSON.stringify(x, null, 1);

async function target(c: Connection): Promise<Target> {
  if (c.target) return c.target;
  if (c.hub) { const h = await HubTarget.probe(c.hub); if (h) return (c.target = h); }
  throw new ToolError(`No plan is open. ${c.hub ? `No Railplot hub answered at ${c.hub}. ` : ""}Use list_layout_files and open_layout to open a .railplot file, or open_layout with a hub address.`);
}

async function hub(c: Connection): Promise<HubTarget> {
  const t = await target(c).catch(() => null);
  if (t instanceof HubTarget) return t;
  throw new ToolError("The controls need the Railplot hub: the layout runs there. Use open_layout with the hub's address (for example localhost:8080).");
}

/** The hub's controls: the hub checks the owner's permission and refuses power and emergency stops itself. */
function hubControl(h: HubTarget): ControlAccess {
  return {
    async state() { const [p, st] = await Promise.all([h.load(), h.state()]); return { claude: st.claude, snap: st.snap, p }; },
    command: (cmd) => h.command(cmd),
  };
}

export function railplotTools(c: Connection): ToolDef[] {
  const read = { readOnlyHint: true, openWorldHint: false };
  const env: PlanEnv = { target: () => target(c), control: async () => hubControl(await hub(c)) };
  const tools: ToolDef[] = [
    {
      name: "get_status", title: "Railplot connection", annotations: read,
      description: "Which plan is open (a Railplot hub or a .railplot file), the folders the connector may use, and whether the hub lets you use the controls. Start here.",
      inputSchema: { type: "object", properties: {} },
      run: async () => {
        const t = await target(c).catch(() => null);
        let p: Project | null = null;
        try { p = t ? await t.load() : null; } catch { p = null; }
        return json({
          open: t ? t.label : null, live: t?.kind === "hub",
          plan: p ? p.name : null, pending_proposals: p?.proposals?.length ?? 0,
          claude_may_use_controls: t?.kind === "hub" ? !!p?.control?.claude : false,
          folders: c.folders.roots,
          how_it_works: "Plans are in mm. You read the plan and send proposals; the owner accepts or rejects each one in Railplot. With the hub, proposals reach the open Railplot straight away; with a file, the desktop app picks them up from the file it has open.",
        });
      },
    },
    {
      name: "list_layout_files", title: "Find layout files", annotations: read,
      description: "List .railplot files in the folders the connector may use (or under one of them).",
      inputSchema: { type: "object", properties: { folder: { type: "string" } } },
      run: (a) => { const f = c.folders.list(a.folder); return f.length ? json(f) : `No .railplot files in ${a.folder ?? c.folders.roots.join(", ")}.`; },
    },
    {
      name: "open_layout", title: "Open a plan", annotations: read,
      description: "Open a plan: a .railplot file by path, or a Railplot hub by address (e.g. localhost:8080), which is live.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, hub: { type: "string" } } },
      run: async (a) => {
        if (a.hub) {
          const h = await HubTarget.probe(a.hub, 2500);
          if (!h) throw new ToolError(`No Railplot hub answered at ${a.hub}.`);
          c.target = h;
        } else c.target = new FileTarget(c.folders.check(a.path));
        const p = await c.target.load();
        return `Opened ${c.target.label}: “${p.name}”.\n${json(layoutSummary(p, c.target.label))}`;
      },
    },
    {
      name: "create_layout_file", title: "Start a new plan file", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      description: "Create a new, empty .railplot file (never overwrites) and open it, to propose a plan from scratch. The owner then opens it in Railplot.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, name: { type: "string" } }, required: ["path"] },
      run: (a) => { c.target = FileTarget.create(c.folders.check(a.path, false), a.name ?? ""); return `Created and opened ${c.target.label}. Open it in Railplot to see proposals as you make them.`; },
    },
    ...planTools(env),
  ];
  return tools;
}
