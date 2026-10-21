// Builds Railplot into self-contained HTML files with Bun.
//   dist/index.html            full document, used by the desktop app and for offline use in a browser
//   dist/railplot-page.html    the same app without <html>/<head>/<body>, for hosting inside a page shell
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "dist");
mkdirSync(out, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/main.ts")],
  target: "browser",
  format: "esm",
  minify: !process.argv.includes("--dev"),
  splitting: false,
});
if (!result.success) {
  for (const m of result.logs) console.error(m);
  process.exit(1);
}
const js = (await result.outputs[0].text()).replace(/<\/script/gi, "<\\/script");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const title = "Railplot";
const desc = "Free, open-source track planner for OO and H0 model railways.";
const body = `<div id="app"></div>\n<script type="module">${js}</script>`;

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${desc}">
<meta name="generator" content="Railplot ${pkg.version}">
<title>${title}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(join(out, "index.html"), full);
// the controller firmware serves this to phones (gzipped to save flash)
mkdirSync(join(root, "firmware/data"), { recursive: true });
writeFileSync(join(root, "firmware/data/index.html.gz"), Bun.gzipSync(new TextEncoder().encode(full), { level: 9 }));

// Hosted pages keep a 16px side gutter and cannot download files.
const hostedCss = `.app{padding-left:max(16px, env(safe-area-inset-left, 0px));padding-right:max(16px, env(safe-area-inset-right, 0px));padding-block:0}`;
const page = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}\n${hostedCss}</style>
<script>window.RAILPLOT_HOSTED = true;</script>
${body}
`;
writeFileSync(join(out, "railplot-page.html"), page);
console.log(`Built dist/index.html (${(full.length / 1024).toFixed(0)} KB) and dist/railplot-page.html`);
