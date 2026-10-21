// Checks every track library in src/libraries: schema, ids, and simple geometry sanity.
//   bun scripts/validate-libraries.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LibraryDef, buildPart, validateLibrary } from "../src/library";

const dir = join(import.meta.dir, "../src/libraries");
let problems = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
  let lib: LibraryDef;
  try { lib = JSON.parse(readFileSync(join(dir, f), "utf8")); }
  catch (e) { console.error(`✗ ${f}: not valid JSON (${(e as Error).message})`); problems++; continue; }
  const errs = validateLibrary(lib);
  if (`${lib.id}.json` !== f) errs.push(`${f}: file name must be "<id>.json" (id is "${lib.id}")`);
  for (const d of lib.parts ?? []) {
    try {
      const p = buildPart(lib, d);
      if (d.type === "curve") {
        const n = 360 / d.angle!;
        if (Math.abs(n - Math.round(n)) > 1e-6) continue; // not a circle divisor, nothing to check
      }
      if (d.type !== "flex" && p.ends.length < 2) errs.push(`${lib.id}/${d.id}: part has fewer than 2 ends`);
    } catch (e) { errs.push(`${lib.id}/${d.id}: ${(e as Error).message}`); }
  }
  if (errs.length) { problems += errs.length; console.error(`✗ ${f}\n  ${errs.join("\n  ")}`); }
  else console.log(`✓ ${f}  ${lib.parts.length} parts`);
}
if (problems) { console.error(`\n${problems} problem(s) found.`); process.exit(1); }
