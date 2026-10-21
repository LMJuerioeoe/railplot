// Builds the Railplot hub into single-file programs that need nothing installed.
//   bun scripts/build-hub.ts            this computer only
//   bun scripts/build-hub.ts --all      Windows, Linux (PC and Raspberry Pi) and Mac, plus the Claude
//                                       connector bundles (.mcpb) for the Claude desktop app on Windows and Mac
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");
const out = join(root, "dist", "hub");
mkdirSync(out, { recursive: true });

// the hub serves the web app, so build that first
const app = Bun.spawnSync(["bun", join(root, "scripts/build.ts")], { stdout: "inherit", stderr: "inherit" });
if (app.exitCode !== 0) process.exit(app.exitCode ?? 1);

const targets: [string, string][] = process.argv.includes("--all")
  ? [
      ["bun-windows-x64", "railplot-hub-windows-x64.exe"],
      ["bun-linux-x64", "railplot-hub-linux-x64"],
      ["bun-linux-arm64", "railplot-hub-raspberry-pi-64bit"],
      ["bun-darwin-arm64", "railplot-hub-mac-apple-silicon"],
      ["bun-darwin-x64", "railplot-hub-mac-intel"],
    ]
  : [["", process.platform === "win32" ? "railplot-hub.exe" : "railplot-hub"]];

for (const [target, name] of targets) {
  const args = ["build", "--compile", "--minify", join(root, "src/hub/main.ts"), "--outfile", join(out, name)];
  if (target) args.splice(2, 0, `--target=${target}`);
  const r = Bun.spawnSync(["bun", ...args], { stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) { console.error(`Building ${name} failed.`); process.exit(r.exitCode ?? 1); }
  console.log(`Built dist/hub/${name}`);
}

// ---------- the Claude connector as Claude desktop extensions (.mcpb: a zip with a manifest and the program) ----------

if (process.argv.includes("--all") || process.argv.includes("--mcpb")) {
  const { railplotTools } = await import("../src/mcp/tools");
  const { Folders } = await import("../src/mcp/targets");
  const tools = railplotTools({ target: null, folders: new Folders([root]), hub: "" }).map((t) => ({ name: t.name, description: t.description.split(". ")[0].replace(/\.$/, "") + "." }));
  const bundles: [string, string, string, string][] = [
    // bundle name, hub program, its name inside the bundle, platform
    ["railplot-claude-windows.mcpb", "railplot-hub-windows-x64.exe", "railplot-hub.exe", "win32"],
    ["railplot-claude-mac-apple-silicon.mcpb", "railplot-hub-mac-apple-silicon", "railplot-hub", "darwin"],
    ["railplot-claude-mac-intel.mcpb", "railplot-hub-mac-intel", "railplot-hub", "darwin"],
  ];
  for (const [bundle, program, inside, platform] of bundles) {
    const stage = join(out, `.stage-${platform}-${bundle}`);
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(join(stage, "server"), { recursive: true });
    try { copyFileSync(join(out, program), join(stage, "server", inside)); }
    catch { rmSync(stage, { recursive: true, force: true }); console.log(`Skipping ${bundle}: build ${program} first (--all).`); continue; }
    copyFileSync(join(root, "src-tauri/icons/128x128@2x.png"), join(stage, "icon.png"));
    const manifest = {
      manifest_version: "0.3",
      name: "railplot",
      display_name: "Railplot",
      version: pkg.version,
      description: "Let Claude read your Railplot track plans, check them and propose changes that you accept or reject in Railplot.",
      long_description: "Claude can open your .railplot plans (or the live layout on a Railplot hub), list the baseboards, track and parts, check for problems, and propose changes: baseboard modules, ready-made yards, sectional and flexible track, example layouts. Each proposal appears under Claude's proposals in Railplot, where you show it on the plan and accept or reject it. Claude never changes the plan by itself. With the hub, and only if you turn on \"Let Claude use the controls\" in Railplot, Claude can also set routes, points, signals and lights, drive trains and run automations; never track power.",
      author: { name: "Railplot contributors" },
      license: "MIT",
      icon: "icon.png",
      keywords: ["model railway", "track plan", "OO", "H0", "Railplot"],
      server: {
        type: "binary",
        entry_point: `server/${inside}`,
        // no extension: Windows finds railplot-hub.exe by itself
        mcp_config: { command: "${__dirname}/server/railplot-hub", args: ["mcp", "--hub", "${user_config.hub}", "--folder", "${user_config.folders}"] },
      },
      tools,
      tools_generated: false,
      user_config: {
        folders: { type: "directory", title: "Folders with your layouts", description: "Claude may read .railplot files in these folders and add proposals to them. Nothing else on your computer.", multiple: true, required: true, default: ["${DOCUMENTS}"] },
        hub: { type: "string", title: "Railplot hub address", description: "Used when the hub is running, for live proposals and (if you allow it in Railplot) the controls. Leave as it is if the hub runs on this computer.", default: "localhost:8080", required: false },
      },
      compatibility: { platforms: [platform] },
    };
    writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
    rmSync(join(out, bundle), { force: true });
    const z = Bun.spawnSync(["zip", "-q", "-r", "-X", join(out, bundle), "manifest.json", "icon.png", "server"], { cwd: stage, stdout: "inherit", stderr: "inherit" });
    rmSync(stage, { recursive: true, force: true });
    if (z.exitCode !== 0) { console.error(`Making ${bundle} needs the zip program.`); process.exit(1); }
    console.log(`Built dist/hub/${bundle}`);
  }
}
