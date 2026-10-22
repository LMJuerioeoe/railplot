// Turns on the desktop app's updater for a release build: adds the update signing key's public half
// (TAURI_UPDATER_PUBKEY) and where to look for updates to src-tauri/tauri.conf.json, and asks the
// bundler for signed update files. The release workflow runs this only when the key is set up.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pubkey = (process.env.TAURI_UPDATER_PUBKEY ?? "").trim();
if (!pubkey) { console.error("TAURI_UPDATER_PUBKEY is empty: leaving the updater off."); process.exit(1); }
const repo = process.env.GITHUB_REPOSITORY || "LMJuerioeoe/railplot";
const path = join(import.meta.dir, "..", "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(path, "utf8"));
conf.bundle.createUpdaterArtifacts = true;
conf.plugins = {
  ...(conf.plugins ?? {}),
  updater: {
    pubkey,
    endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
    windows: { installMode: "passive" },
  },
};
writeFileSync(path, JSON.stringify(conf, null, 2) + "\n");
console.log(`Updater on: updates from ${conf.plugins.updater.endpoints[0]}`);
