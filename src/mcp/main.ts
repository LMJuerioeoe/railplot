#!/usr/bin/env bun
// The Railplot connector for Claude, from source: bun src/mcp/main.ts [--hub localhost:8080] [--folder DIR]
// (The hub program runs the same thing as "railplot-hub mcp".)
import pkg from "../../package.json";
import { runMcp } from "./run";

await runMcp(process.argv.slice(2), pkg.version);
process.exit(0);
