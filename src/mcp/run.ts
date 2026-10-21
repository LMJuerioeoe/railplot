// railplot-hub mcp: the Railplot connector for Claude, over stdio.
//   railplot-hub mcp [--hub localhost:8080] [--file plan.railplot] [--folder DIR ...]
import os from "node:os";
import { McpServer } from "./server";
import { FileTarget, Folders } from "./targets";
import { Connection, INSTRUCTIONS, railplotTools } from "./tools";

export const MCP_HELP = `railplot-hub mcp: the Railplot connector for Claude (Model Context Protocol, over stdio)

  --hub HOST[:PORT]   the Railplot hub to use when it is running (default localhost:8080; "none" for never)
  --file FILE         open this .railplot file to start with
  --folder DIR ...    folders whose .railplot files Claude may read and add proposals to (default: your home folder)

Claude reads the plan and sends proposals, which you accept or reject in Railplot.`;

export function parseMcpArgs(argv: string[]) {
  const o: { hub: string; file?: string; folders: string[]; help: boolean } = { hub: "localhost:8080", folders: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--hub") o.hub = argv[++i] ?? "";
    else if (a.startsWith("--hub=")) o.hub = a.slice(6);
    else if (a === "--file") o.file = argv[++i];
    else if (a.startsWith("--file=")) o.file = a.slice(7);
    else if (a === "--folder" || a === "--folders") { while (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) o.folders.push(...argv[++i].split(/[;\n]/).filter(Boolean)); }
    else if (a.startsWith("--folder=")) o.folders.push(a.slice(9));
  }
  if (o.hub === "none") o.hub = "";
  return o;
}

export async function runMcp(argv: string[], version: string) {
  const o = parseMcpArgs(argv);
  if (o.help) { process.stderr.write(MCP_HELP + "\n"); return; }
  const folders = new Folders(o.folders.length ? o.folders : [os.homedir()]);
  const c: Connection = { target: null, folders, hub: o.hub };
  if (o.file) {
    try { c.target = new FileTarget(folders.check(o.file)); }
    catch (e) { process.stderr.write(`railplot mcp: ${(e as Error).message}\n`); }
  }
  const server = new McpServer({ name: "railplot", title: "Railplot", version, instructions: INSTRUCTIONS }, railplotTools(c));
  process.stderr.write(`Railplot connector ${version}: talking to Claude over stdio. Folders: ${folders.roots.join(", ")}${o.hub ? `; hub ${o.hub} when running` : ""}.\n`);
  await server.serve();
}
