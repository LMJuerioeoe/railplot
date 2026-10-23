// Printing the plan: an overview, the track at 1:1 on A4 pages to lay it from, the parts list, a
// cutting list for the baseboards and the wiring list. The pages are built as HTML and printed by the
// browser (or the desktop app's web view), so "Save as PDF" in the print dialog makes a PDF.
import { Palette, projectToSvg } from "./render2d";
import { Project, boardBounds, geom, isVisible, partsList, projectBounds } from "./model";
import { getModule } from "./modules";
import { wiringList } from "./control/engine";
import { h } from "./ui/dom";

/** The printable area of an A4 page in portrait, mm, inside 10 mm margins, less a line for the page's label. */
export const PAGE = { w: 190, h: 265 };
/** How much each template page repeats of its neighbours, mm, to line them up by. */
export const OVERLAP = 10;

export interface PrintOptions { overview: boolean; templates: boolean; parts: boolean; cutting: boolean; wiring: boolean; only?: Set<string> }

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
const meets = (a: Bounds, b: Bounds) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

/**
 * The A4 pages the track is printed on at 1:1: a grid over the track (or just the chosen pieces), each
 * page `PAGE` big and overlapping the next by `OVERLAP`, leaving out pages with no track on them.
 * Rows are lettered from the back of the layout, columns numbered from the left.
 */
export function templatePages(p: Project, only?: Set<string>): { row: number; col: number; label: string; b: Bounds }[] {
  const items = p.items.filter((i) => isVisible(p, i) && (!only?.size || only.has(i.id)));
  if (!items.length) return [];
  const boxes = items.map((i) => geom(i).bounds);
  const all = boxes.reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }));
  const stepX = PAGE.w - OVERLAP, stepY = PAGE.h - OVERLAP, m = 5;
  const cols = Math.max(1, Math.ceil((all.maxX - all.minX + 2 * m - OVERLAP) / stepX));
  const rows = Math.max(1, Math.ceil((all.maxY - all.minY + 2 * m - OVERLAP) / stepY));
  const out: { row: number; col: number; label: string; b: Bounds }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    // y grows towards the back of the layout: row A is the back, as the plan is drawn
    const b = { minX: all.minX - m + c * stepX, maxX: all.minX - m + c * stepX + PAGE.w, maxY: all.maxY + m - r * stepY, minY: all.maxY + m - r * stepY - PAGE.h };
    if (boxes.some((x) => meets(x, b))) out.push({ row: r, col: c, label: `${rowName(r)}${c + 1}`, b });
  }
  return out;
}

const rowName = (r: number) => (r < 26 ? String.fromCharCode(65 + r) : `${String.fromCharCode(64 + Math.floor(r / 26))}${String.fromCharCode(65 + (r % 26))}`);

/** The baseboards to cut: each plain board's size (its bounding rectangle) and corners; modules come ready-made. */
export function cuttingList(p: Project): { name: string; w: number; d: number; corners: number; rect: boolean; module?: string }[] {
  return p.boards.map((b) => {
    const bb = boardBounds(b), m = b.module && getModule(b.module.preset);
    const w = bb.maxX - bb.minX, d = bb.maxY - bb.minY;
    const area = Math.abs(b.pts.reduce((s, q, i) => { const r = b.pts[(i + 1) % b.pts.length]; return s + q.x * r.y - r.x * q.y; }, 0) / 2);
    return { name: b.name, w, d, corners: b.pts.length, rect: Math.abs(area - w * d) < 1, module: m ? m.name : undefined };
  });
}

/** The whole print-out, as one element of A4 pages. */
export function printDocument(p: Project, pal: Palette, o: PrintOptions): HTMLElement {
  const doc = h("div", { class: "print-doc" });
  const page = (...kids: (Node | string | null)[]) => { const el = h("section", { class: "print-page" }, ...kids); doc.append(el); return el; };
  const mm = (n: number) => `${Math.round(n)} mm`;
  const b = projectBounds(p);
  const svgOf = (bounds: Bounds) => projectToSvg(p, pal, bounds);
  const date = new Date().toLocaleDateString();

  if (o.overview && b) {
    const el = page(h("h1", {}, p.name), h("p", { class: "print-sub" }, `${date} · ${mm(b.maxX - b.minX)} × ${mm(b.maxY - b.minY)} · ${p.items.length} pieces of track`));
    const fig = h("div", { class: "print-fig", html: svgOf(b) });
    const svg = fig.querySelector("svg");
    if (svg) { svg.removeAttribute("width"); svg.removeAttribute("height"); }
    el.append(fig);
    const pages = o.templates ? templatePages(p, o.only) : [];
    if (pages.length) el.append(h("p", { class: "print-note" }, `Track templates at 1:1 follow on ${pages.length} page${pages.length === 1 ? "" : "s"}, rows A to ${rowName(Math.max(...pages.map((x) => x.row)))} from the back and columns from the left. Print them at 100% ("actual size", not "fit to page"), check the 50 mm bar on each with a ruler, then trim and tape them together on the crosses.`));
  }

  if (o.templates && b) {
    const full = svgOf(b), pad = 40;
    // the drawing's own units are mm from (minX - pad, maxY + pad) at its top left
    // (boards in outline only, and no white sheet behind: it all saves ink)
    const inner = full.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/fill="#efe4cf"/g, 'fill="none"').replace(/<rect width="100%" height="100%" fill="#ffffff"\/>/, "");
    for (const t of templatePages(p, o.only)) {
      const x0 = t.b.minX - (b.minX - pad), y0 = (b.maxY + pad) - t.b.maxY;
      const marks: string[] = [];
      // crosses on the overlap's middle lines, to tape the pages together on
      for (const cx of [OVERLAP / 2, PAGE.w - OVERLAP / 2]) for (const cy of [OVERLAP / 2, PAGE.h - OVERLAP / 2])
        marks.push(`<path d="M${x0 + cx - 4} ${y0 + cy}h8M${x0 + cx} ${y0 + cy - 4}v8" stroke="#000" stroke-width="0.25"/>`);
      const bar = `<g transform="translate(${x0 + PAGE.w - 64} ${y0 + PAGE.h - 8})"><rect width="50" height="2" fill="#000"/><text x="25" y="-1.5" font-size="3.2" text-anchor="middle" font-family="sans-serif">50 mm</text></g>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w}mm" height="${PAGE.h}mm" viewBox="${x0} ${y0} ${PAGE.w} ${PAGE.h}">${inner}${marks.join("")}${bar}</svg>`;
      page(h("div", { class: "print-label" }, h("strong", {}, `Page ${t.label}`), ` · ${p.name} · 1:1, print at 100% · overlaps the next page by ${OVERLAP} mm`),
        h("div", { class: "print-template", html: svg }));
    }
  }

  if (o.parts) {
    const rows = partsList(p);
    page(h("h2", {}, "Parts list"),
      h("table", { class: "print-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Number"), h("th", {}, "Part"), h("th", {}, "Make"), h("th", { class: "num" }, "How many"))),
        h("tbody", {}, ...rows.map((r) => h("tr", {}, h("td", {}, r.id), h("td", {}, r.name + (r.length !== undefined ? ` (${(r.length / 1000).toFixed(2)} m in all)` : "")), h("td", {}, r.producer), h("td", { class: "num" }, String(r.count)))))));
  }

  if (o.cutting && p.boards.length) {
    const rows = cuttingList(p);
    page(h("h2", {}, "Baseboard cutting list"),
      h("p", { class: "print-note" }, "Sizes are each board's outside, left to right and front to back. A board that isn't a rectangle is cut from a sheet that size, to the shape on the overview."),
      h("table", { class: "print-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Board"), h("th", { class: "num" }, "Width"), h("th", { class: "num" }, "Depth"), h("th", {}, "Shape"))),
        h("tbody", {}, ...rows.map((r) => h("tr", {}, h("td", {}, r.name), h("td", { class: "num" }, mm(r.w)), h("td", { class: "num" }, mm(r.d)),
          h("td", {}, r.module ? `${r.module} (ready-made)` : r.rect ? "Rectangle" : `${r.corners} corners`))))));
  }

  const cfg = p.control;
  if (o.wiring && cfg && cfg.controllers.some((c) => c.kind !== "sim")) {
    const lines = wiringList(p, cfg);
    page(h("h2", {}, "Wiring list"),
      h("table", { class: "print-table" },
        h("thead", {}, h("tr", {}, h("th", {}, "Controller"), h("th", {}, "What"), h("th", {}, "Where"))),
        h("tbody", {}, ...lines.map((l) => h("tr", {}, h("td", {}, l.controller), h("td", {}, l.what), h("td", {}, l.where))))));
  }
  return doc;
}

/** Print the document: shown only to the printer, and taken away again afterwards. */
export function printNow(doc: HTMLElement) {
  document.querySelector(".print-doc")?.remove();
  document.body.append(doc);
  document.body.classList.add("printing-doc");
  const done = () => { document.body.classList.remove("printing-doc"); doc.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
  // some web views don't send afterprint: tidy up anyway once the dialog has gone
  setTimeout(() => { if (document.body.classList.contains("printing-doc")) done(); }, 1000);
}
