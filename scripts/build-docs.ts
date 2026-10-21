// Builds the documentation website from the Markdown in docs/ (and firmware/README.md) into site/,
// with the Railplot web app at site/app/. No dependencies: a small Markdown renderer is included.
//   bun scripts/build-docs.ts
// Links to files outside the site point at GitHub when GITHUB_REPOSITORY is set (as in GitHub Actions).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "site");
const repo = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : "";
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

interface Page { src: string; out: string; title: string; group: string }
const PAGES: Page[] = [
  { src: "docs/index.md", out: "index.html", title: "Home", group: "" },
  { src: "docs/claude.md", out: "claude.html", title: "Claude and Railplot", group: "Plan" },
  { src: "docs/control/README.md", out: "control/index.html", title: "Controlling the layout", group: "Run your layout" },
  { src: "docs/control/automation.md", out: "control/automation.html", title: "Automation", group: "Run your layout" },
  { src: "docs/control/hub.md", out: "control/hub.html", title: "The hub", group: "Run your layout" },
  { src: "docs/control/throttles.md", out: "control/throttles.html", title: "Throttle apps", group: "Run your layout" },
  { src: "docs/control/dcc-ex.md", out: "control/dcc-ex.html", title: "DCC-EX", group: "Run your layout" },
  { src: "docs/control/testing.md", out: "control/testing.html", title: "Hardware testing", group: "Run your layout" },
  { src: "firmware/README.md", out: "firmware/index.html", title: "Controller firmware", group: "Run your layout" },
  { src: "docs/baseboard-modules.md", out: "baseboard-modules.html", title: "Baseboard modules", group: "Reference" },
  { src: "docs/yards.md", out: "yards.html", title: "Yards and example layouts", group: "Reference" },
  { src: "docs/library-format.md", out: "library-format.html", title: "Track libraries", group: "Reference" },
  { src: "docs/file-format.md", out: "file-format.html", title: "The .railplot file", group: "Reference" },
];

// ---------- Markdown ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

interface Ctx { page: Page; link(href: string): string; image(src: string, alt: string): string }

/** Inline Markdown: code, images, links, bold, italic, and a few safe HTML tags (kbd, br). */
function inline(text: string, ctx: Ctx): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  const keep: string[] = [];
  s = s.replace(/<(\/?)(kbd|br)\s*\/?>/g, (m) => { keep.push(m); return `\u0001${keep.length - 1}\u0001`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => ctx.image(src, alt));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
    const h = ctx.link(href.replace(/&amp;/g, "&"));
    const ext = /^https?:/.test(h) ? ' rel="noopener"' : "";
    return `<a href="${esc(h)}"${ext}>${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => keep[+i]).replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
  return s;
}

const indentOf = (l: string) => l.match(/^ */)![0].length;

/** Block Markdown, recursively for list items. */
function blocks(lines: string[], ctx: Ctx, toc?: { id: string; text: string }[]): string {
  const html: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { html.push(`<p>${inline(para.join(" "), ctx)}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { flush(); i++; continue; }
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^```(\w*)/))) {
      flush();
      const body: string[] = [];
      const ind = indentOf(line);
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { body.push(lines[i].slice(Math.min(ind, indentOf(lines[i])))); i++; }
      i++;
      html.push(`<pre${m[1] ? ` data-lang="${m[1]}"` : ""}><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    if ((m = t.match(/^(#{1,4})\s+(.*)$/))) {
      flush();
      const level = m[1].length, text = inline(m[2], ctx), id = slug(m[2]);
      if (level === 2 && toc) toc.push({ id, text });
      html.push(level === 1 ? `<h1>${text}</h1>` : `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${level}>`);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); html.push("<hr>"); i++; continue; }
    if (t.startsWith("|") && lines[i + 1]?.trim().match(/^\|[\s:|-]+\|$/)) {
      flush();
      const row = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
      const head = row(t);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(row(lines[i])); i++; }
      html.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c, ctx)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, ctx)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if ((m = t.match(/^([-*]|\d+\.)\s+/))) {
      flush();
      const ordered = /\d/.test(m[1]);
      const base = indentOf(line);
      const items: string[][] = [];
      while (i < lines.length) {
        const l = lines[i];
        const lt = l.trim();
        const mm = lt.match(/^([-*]|\d+\.)\s+/);
        if (mm && indentOf(l) === base && /\d/.test(mm[1]) === ordered) { items.push([lt.slice(mm[0].length)]); i++; continue; }
        if (!lt) {
          // a blank line ends the list unless the next line is indented under the item
          const next = lines[i + 1];
          if (next !== undefined && next.trim() && indentOf(next) > base) { items[items.length - 1].push(""); i++; continue; }
          break;
        }
        if (indentOf(l) > base) { items[items.length - 1].push(l.slice(Math.min(indentOf(l), base + (ordered ? 3 : 2)))); i++; continue; }
        if (!mm && items.length) { items[items.length - 1].push(lt); i++; continue; }   // a lazy continuation line
        break;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((it) => {
        const inner = blocks(it, ctx);
        const tight = !it.includes("") ? inner.replace(/^<p>([\s\S]*?)<\/p>/, "$1") : inner;
        return `<li>${tight}</li>`;
      }).join("")}</${tag}>`);
      continue;
    }
    if (t.startsWith("> ")) { flush(); const q: string[] = []; while (i < lines.length && lines[i].trim().startsWith(">")) { q.push(lines[i].trim().replace(/^>\s?/, "")); i++; } html.push(`<blockquote>${blocks(q, ctx)}</blockquote>`); continue; }
    para.push(t);
    i++;
  }
  flush();
  return html.join("\n");
}

// ---------- the site ----------

const pageBySrc = new Map(PAGES.map((p) => [p.src, p]));
const relUrl = (from: Page, toOut: string) => {
  const r = relative(dirname(from.out), toOut).replace(/\\/g, "/");
  return (r || toOut.split("/").pop()!).replace(/(^|\/)index\.html$/, "$1") || "./";
};
const copied = new Set<string>();

function makeCtx(page: Page): Ctx {
  return {
    page,
    link(href) {
      if (/^(https?:|mailto:|#)/.test(href)) return href;
      if (page.src === "docs/index.md" && href === "app/") return "app/";
      const [pathPart, hash] = href.split("#");
      const resolved = normalize(join(dirname(page.src), pathPart)).replace(/\\/g, "/").replace(/\/$/, "");
      const target = pageBySrc.get(resolved) ?? pageBySrc.get(`${resolved}/README.md`);
      if (target) return relUrl(page, target.out) + (hash ? `#${hash}` : "");
      if (resolved.endsWith("releases") && resolved.startsWith("..")) return repo ? `${repo}/releases` : href;
      if (existsSync(join(root, resolved)) && resolved.startsWith("docs/")) {
        const dest = resolved.slice("docs/".length);
        if (!copied.has(dest)) { mkdirSync(dirname(join(out, dest)), { recursive: true }); copyFileSync(join(root, resolved), join(out, dest)); copied.add(dest); }
        return relUrl(page, dest);
      }
      return repo ? `${repo}/${existsSync(join(root, resolved)) && !resolved.includes(".") ? "tree" : "blob"}/main/${resolved}` : href;
    },
    image(src, alt) {
      const resolved = normalize(join(dirname(page.src), src)).replace(/\\/g, "/");
      const file = join(root, resolved);
      if (src.endsWith(".svg") && existsSync(file)) {
        const svg = readFileSync(file, "utf8").replace(/<\?xml[^>]*>\s*/, "");
        return `<figure class="diagram">${svg}</figure>`;
      }
      return `<img src="${esc(this.link(src))}" alt="${esc(alt)}" loading="lazy">`;
    },
  };
}

const CSS = `
:root { --bg:#fbfbf8; --raised:#ffffff; --panel:#f4f5f1; --ink:#1b221e; --ink-2:#57615a; --ink-3:#7f8981; --line:#d2d8cf; --line-strong:#b9c1b6;
  --accent:#a2620c; --accent-ink:#fff; --accent-soft:#f3e4cb; --code:#eef0ea; --warn-soft:#f6ebc9;
  --font:"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,"Ubuntu","Noto Sans",sans-serif; --mono:"Cascadia Mono","SF Mono",ui-monospace,"Ubuntu Mono",Consolas,monospace; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#111412; --raised:#232925; --panel:#1b201d; --ink:#e2e7e1; --ink-2:#a3ada5; --ink-3:#7c867e; --line:#2d3430; --line-strong:#3d4640;
  --accent:#e3a548; --accent-ink:#1b1408; --accent-soft:#3b2e19; --code:#1d221f; --warn-soft:#3a3218; color-scheme: dark; } }
:root[data-theme="dark"] { --bg:#111412; --raised:#232925; --panel:#1b201d; --ink:#e2e7e1; --ink-2:#a3ada5; --ink-3:#7c867e; --line:#2d3430; --line-strong:#3d4640;
  --accent:#e3a548; --accent-ink:#1b1408; --accent-soft:#3b2e19; --code:#1d221f; --warn-soft:#3a3218; color-scheme: dark; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 var(--font); }
a { color: var(--accent); text-underline-offset: 2px; }
.top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 17px; color: var(--ink); text-decoration: none; }
.brand svg { color: var(--accent); }
.top .spacer { flex: 1; }
.btn { display: inline-flex; align-items: center; height: 34px; padding: 0 14px; border-radius: 6px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: 14px; text-decoration: none; white-space: nowrap; }
.layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); max-width: 1180px; margin: 0 auto; }
nav.side { position: sticky; top: 55px; align-self: start; max-height: calc(100vh - 55px); overflow: auto; padding: 24px 16px 24px 16px; font-size: 14px; }
nav.side h2 { margin: 18px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-3); }
nav.side ul { list-style: none; margin: 0; padding: 0; }
nav.side a { display: block; padding: 5px 10px; border-radius: 6px; color: var(--ink-2); text-decoration: none; }
nav.side a:hover { background: var(--accent-soft); color: var(--ink); }
nav.side a[aria-current="page"] { background: var(--accent-soft); color: var(--ink); font-weight: 600; }
nav.side .toc a { padding-left: 22px; font-size: 13px; }
main { min-width: 0; padding: 24px 32px 64px; }
article { max-width: 760px; }
h1 { font-size: 34px; line-height: 1.2; margin: 8px 0 16px; letter-spacing: -.01em; }
h2 { font-size: 24px; line-height: 1.3; margin: 40px 0 10px; padding-top: 8px; border-top: 1px solid var(--line); }
h3 { font-size: 18px; margin: 28px 0 8px; }
h4 { font-size: 16px; margin: 20px 0 6px; }
h2, h3, h4 { position: relative; scroll-margin-top: 70px; }
.anchor { position: absolute; left: -1em; width: 1em; color: var(--ink-3); text-decoration: none; opacity: 0; }
h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
p, ul, ol { margin: 0 0 14px; }
li { margin: 4px 0; }
li > ul, li > ol, li > .table-wrap, li > pre { margin-top: 8px; }
code { font: .88em var(--mono); background: var(--code); padding: 1px 5px; border-radius: 4px; }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow-x: auto; font-size: 14px; line-height: 1.5; }
pre code { background: none; padding: 0; font-size: inherit; }
kbd { font: 12px/1 var(--mono); padding: 2px 6px; border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 4px; background: var(--raised); }
.table-wrap { overflow-x: auto; margin: 0 0 16px; border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid var(--line); }
th { background: var(--panel); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
hr { border: 0; border-top: 1px solid var(--line); margin: 32px 0; }
blockquote { margin: 0 0 14px; padding: 8px 14px; border-left: 3px solid var(--accent); background: var(--warn-soft); border-radius: 0 6px 6px 0; }
figure.diagram { margin: 16px 0 24px; padding: 12px; background: var(--raised); border: 1px solid var(--line); border-radius: 10px; }
figure.diagram svg { display: block; width: 100%; height: auto; }
img { max-width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--line); }
.pager { display: flex; justify-content: space-between; gap: 16px; margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 14px; }
footer { color: var(--ink-3); font-size: 13px; margin-top: 32px; }
details.mnav { display: none; }
@media (max-width: 860px) {
  .layout { grid-template-columns: minmax(0, 1fr); }
  nav.side { display: none; }
  details.mnav { display: block; border-bottom: 1px solid var(--line); background: var(--panel); padding: 0 16px; }
  details.mnav summary { padding: 10px 0; font-weight: 600; cursor: pointer; }
  details.mnav nav.side { display: block; position: static; max-height: none; padding: 0 0 12px; }
  main { padding: 16px 16px 48px; }
  h1 { font-size: 28px; }
  .anchor { display: none; }
}
`;

const LOGO = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20c0-9 6-16 16-16"/><path d="M8 20c0-6.5 5-12 12-12"/><path d="M5 14.5l3 1.2M7.3 9.8l2.7 1.8M11 6.2l2 2.5"/></svg>`;

function navHtml(current: Page, toc: { id: string; text: string }[]) {
  const groups = [...new Set(PAGES.map((p) => p.group))];
  return groups.map((g) => `${g ? `<h2>${esc(g)}</h2>` : ""}<ul>${PAGES.filter((p) => p.group === g).map((p) => {
    const here = p === current;
    const sub = here && toc.length > 1 ? `<ul class="toc">${toc.map((t) => `<li><a href="#${t.id}">${t.text.replace(/<[^>]+>/g, "")}</a></li>`).join("")}</ul>` : "";
    return `<li><a href="${relUrl(current, p.out)}"${here ? ' aria-current="page"' : ""}>${esc(p.title)}</a>${sub}</li>`;
  }).join("")}</ul>`).join("");
}

function render(page: Page) {
  const md = readFileSync(join(root, page.src), "utf8");
  const toc: { id: string; text: string }[] = [];
  const body = blocks(md.split(/\r?\n/), makeCtx(page), toc);
  const h1 = md.match(/^#\s+(.*)$/m)?.[1] ?? page.title;
  const firstP = body.match(/<p>([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]+>/g, "").slice(0, 200) ?? "";
  const idx = PAGES.indexOf(page);
  const prev = PAGES[idx - 1], next = PAGES[idx + 1];
  const app = relUrl(page, "app/index.html");
  const nav = navHtml(page, toc);
  const title = page.out === "index.html" ? "Railplot: plan and run your model railway" : `${h1.replace(/[`*]/g, "")} · Railplot`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(firstP)}">
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="${relUrl(page, "index.html")}">${LOGO}Railplot</a>
  <span class="spacer"></span>
  <a class="btn" href="${app}">Open the app</a>
</header>
<details class="mnav"><summary>Contents</summary><nav class="side" aria-label="Guides">${nav}</nav></details>
<div class="layout">
  <nav class="side" aria-label="Guides">${nav}</nav>
  <main><article>
${body}
<div class="pager">${prev ? `<a href="${relUrl(page, prev.out)}">← ${esc(prev.title)}</a>` : "<span></span>"}${next ? `<a href="${relUrl(page, next.out)}">${esc(next.title)} →</a>` : "<span></span>"}</div>
<footer>Railplot ${esc(pkg.version)} · MIT licence${repo ? ` · <a href="${repo}">Source on GitHub</a>` : ""}</footer>
  </article></main>
</div>
</body>
</html>
`;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const page of PAGES) {
  const file = join(out, page.out);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(page));
}
// the app itself, if it has been built
const appFile = join(root, "dist", "index.html");
if (existsSync(appFile)) { mkdirSync(join(out, "app"), { recursive: true }); copyFileSync(appFile, join(out, "app", "index.html")); }
else console.warn("dist/index.html not found: run bun run build first to include the app.");
console.log(`Built ${PAGES.length} pages into site/${repo ? ` (links to ${repo})` : ""}`);
