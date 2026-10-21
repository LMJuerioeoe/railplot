#!/usr/bin/env bun
// railplot-hub: run a Railplot layout on a laptop or Raspberry Pi.
//   railplot-hub [--layout my-layout.railplot] [--port 8080] [--withrottle 12090] [--name "My railway"] [--no-mdns]
//   railplot-hub mcp [--hub localhost:8080] [--folder DIR]     the Railplot connector for Claude (stdio)
import os from "node:os";
import path from "node:path";
import appHtml from "../../dist/index.html" with { type: "text" };
import pkg from "../../package.json";
import { Hub } from "./server";
import { WT_PORT } from "./withrottle";

const HELP = `Railplot hub ${pkg.version}

Runs your layout without a screen: drives the controllers, serves Railplot to phones and
laptops on your network, and lets WiThrottle and Engine Driver apps drive the trains.

  --layout FILE      where the hub keeps the layout (default: ~/railplot-hub/layout.railplot)
  --port N           port for the web page (default 8080)
  --withrottle N     port for WiThrottle apps (default ${WT_PORT}; 0 turns it off)
  --name TEXT        the name throttle apps show (default "Railplot")
  --host NAME        network name, as NAME.local (default railplot-hub)
  --no-mdns          don't announce the hub on the network
  --help             this text

  railplot-hub mcp   runs the Railplot connector for Claude instead (see "railplot-hub mcp --help")

Send your layout to the hub from Railplot: Control > Set up > Railplot hub > Connect.
More: docs/control/hub.md in the Railplot source.`;

function args(argv: string[]) {
  const o: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) o[k] = v;
    else if (k.startsWith("no-")) o[k.slice(3)] = false;
    else if (k === "help") o.help = true;
    else o[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
  }
  return o;
}

if (process.argv[2] === "mcp") {
  // the Railplot connector for Claude: stdio only, so nothing else may print to stdout
  const { runMcp } = await import("../mcp/run");
  await runMcp(process.argv.slice(3), pkg.version);
  process.exit(0);
}

const a = args(process.argv.slice(2));
if (a.help) { console.log(HELP); process.exit(0); }
const num = (v: unknown, d: number) => (typeof v === "string" && /^\d+$/.test(v) ? +v : d);

const hub = new Hub({
  layout: typeof a.layout === "string" ? a.layout : path.join(os.homedir(), "railplot-hub", "layout.railplot"),
  port: num(a.port, 8080),
  wtPort: a.withrottle === false ? 0 : num(a.withrottle, WT_PORT),
  name: typeof a.name === "string" ? a.name : "Railplot",
  host: typeof a.host === "string" ? a.host : "railplot-hub",
  mdns: a.mdns !== false,
  appHtml,
  version: pkg.version,
});
try { hub.start(); }
catch (e) { console.error(`The hub couldn't start: ${(e as Error).message}`); process.exit(1); }

const quit = () => { console.log("Stopping: all trains stop."); hub.engine.stopAll(); setTimeout(() => { hub.stop(); process.exit(0); }, 400); };
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
