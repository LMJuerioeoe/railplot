// Black-and-white baseboard outlines for planning scenery with pen and paper: a PDF to print, on one page or
// tiled over several at a round scale. Written by hand (lines and Helvetica text only), so there is nothing to load.
import { Vec } from "./geom";
import { Project, geom, isVisible } from "./model";
import { objectCorners, objectDef } from "./objects";
import { sampleRoute } from "./trackdetail";

export type Paper = "a4" | "a3" | "letter";
export interface OutlineOpts {
  paper: Paper;
  /** The N of 1:N, or "fit" for the largest round scale that fits one page. */
  scale: number | "fit";
  /** Track: left out, drawn in light grey to sketch over, or in black. */
  track: "none" | "light" | "black";
  grid: boolean;
  names: boolean;
  /** Outlines of the scenery already on the plan. */
  scenery: boolean;
}
export const DEFAULT_OUTLINE: OutlineOpts = { paper: "a4", scale: "fit", track: "light", grid: true, names: true, scenery: false };

const PAPERS: Record<Paper, [number, number]> = { a4: [210, 297], a3: [297, 420], letter: [215.9, 279.4] };
/** Scales a ruler can be read at. */
export const ROUND_SCALES = [1, 2, 2.5, 4, 5, 8, 10, 12.5, 15, 20, 25, 30, 40, 50, 75, 100];
const MARGIN = 10, FOOT = 14, PT = 72 / 25.4;

export interface OutlinePlan {
  scale: number; landscape: boolean; cols: number; rows: number; pages: number;
  /** Printable area of a page for the drawing, mm. */
  cellW: number; cellH: number; pageW: number; pageH: number;
  /** What is drawn, in plan millimetres. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** The area the sheet covers: the baseboards, or the track if there are no boards yet. */
export function outlineBounds(p: Project) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (q: Vec) => { minX = Math.min(minX, q.x); minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y); };
  for (const b of p.boards) b.pts.forEach(take);
  if (!isFinite(minX)) for (const it of p.items) { const g = geom(it).bounds; take({ x: g.minX, y: g.minY }); take({ x: g.maxX, y: g.maxY }); }
  if (p.room) p.room.pts.forEach(take);
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Work out the scale, the paper direction and the number of pages. */
export function planOutline(p: Project, o: OutlineOpts): OutlinePlan | null {
  const b = outlineBounds(p);
  if (!b) return null;
  const W = b.maxX - b.minX, H = b.maxY - b.minY;
  const [pw, ph] = PAPERS[o.paper];
  const layout = (landscape: boolean, scale: number) => {
    const pageW = landscape ? ph : pw, pageH = landscape ? pw : ph;
    const cellW = pageW - 2 * MARGIN, cellH = pageH - 2 * MARGIN - FOOT;
    const cols = Math.max(1, Math.ceil(W / scale / cellW - 1e-6)), rows = Math.max(1, Math.ceil(H / scale / cellH - 1e-6));
    return { scale, landscape, cols, rows, pages: cols * rows, cellW, cellH, pageW, pageH, bounds: b };
  };
  if (o.scale === "fit") {
    for (const s of ROUND_SCALES) {
      const a = layout(W >= H, s);
      if (a.pages === 1) return a;
      const c = layout(W < H, s);
      if (c.pages === 1) return c;
    }
    return layout(W >= H, ROUND_SCALES[ROUND_SCALES.length - 1]);
  }
  const a = layout(true, o.scale), c = layout(false, o.scale);
  return a.pages < c.pages || (a.pages === c.pages && W >= H) ? a : c;
}

const fmtScale = (s: number) => `1:${Number.isInteger(s) ? s : s.toFixed(1)}`;
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
/** Text as a PDF string in WinAnsi: brackets escaped, anything outside Latin-1 replaced. */
function pdfText(t: string) {
  let out = "";
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (c === 0x2013 || c === 0x2014) out += "-";
    else if (c === 0xd7) out += "\\327";
    else if (c >= 32 && c < 127) out += ch;
    else if (c >= 160 && c <= 255) out += "\\" + c.toString(8).padStart(3, "0");
    else out += "?";
  }
  return `(${out})`;
}

export function outlinePdf(p: Project, o: OutlineOpts, today = new Date().toISOString().slice(0, 10)): { pdf: Uint8Array; plan: OutlinePlan } | null {
  const plan = planOutline(p, o);
  if (!plan) return null;
  const { scale, cols, rows, cellW, cellH, pageW, pageH, bounds: b } = plan;
  const k = PT / scale;                         // plan mm -> points
  const W = b.maxX - b.minX, H = b.maxY - b.minY;
  // centre the drawing on the sheet(s)
  const padX = (cols * cellW * scale - W) / 2, padY = (rows * cellH * scale - H) / 2;
  const grey = o.track === "light" ? "0.62 G" : "0 G";
  const gridStep = [10, 50, 100, 500, 1000].find((s) => s / scale >= 5) ?? 1000;

  // the drawing itself, in plan millimetres through one transform; the same stream is reused on every page
  const body: string[] = [];
  const path = (pts: Vec[], close: boolean) => { body.push(pts.map((q, i) => `${n2(q.x)} ${n2(q.y)} ${i ? "l" : "m"}`).join(" ") + (close ? " h S" : " S")); };
  const lw = (mmOnPaper: number) => body.push(`${n2(mmOnPaper * scale)} w`);
  if (o.grid) {
    const x0 = Math.floor((b.minX - padX) / gridStep) * gridStep, x1 = b.maxX + padX, y0 = Math.floor((b.minY - padY) / gridStep) * gridStep, y1 = b.maxY + padY;
    for (const major of [false, true]) {
      body.push(major ? "0.72 G" : "0.86 G"); lw(major ? 0.18 : 0.1);
      for (let x = x0; x <= x1; x += gridStep) if ((Math.round(x / gridStep) % 5 === 0) === major) path([{ x, y: y0 }, { x, y: y1 }], false);
      for (let y = y0; y <= y1; y += gridStep) if ((Math.round(y / gridStep) % 5 === 0) === major) path([{ x: x0, y }, { x: x1, y }], false);
    }
  }
  if (p.room && p.room.pts.length >= 3) {
    body.push("0.45 G"); lw(0.25);
    const open = new Set(p.room.open ?? []);
    p.room.pts.forEach((q, i) => {
      const r = p.room!.pts[(i + 1) % p.room!.pts.length];
      body.push(open.has(i) ? `[${n2(3 * scale)} ${n2(2 * scale)}] 0 d` : "[] 0 d");
      path([q, r], false);
    });
    body.push("[] 0 d");
  }
  if (o.track !== "none") {
    body.push(grey); lw(o.track === "light" ? 0.2 : 0.25);
    for (const it of p.items) {
      if (!isVisible(p, it)) continue;
      const g = geom(it), half = g.part.lib.profile.sleeperLength / 2;
      for (const r of g.routes) {
        if (r.length < 0.5) continue;
        const pts = sampleRoute(r.prims, 0, 0, (4 * Math.PI) / 180);
        for (const s of [1, -1]) path(pts.map((q) => ({ x: q.x - Math.sin(q.h) * half * s, y: q.y + Math.cos(q.h) * half * s })), false);
      }
    }
    // a centre line helps when measuring clearances by hand
    body.push(`[${n2(2 * scale)} ${n2(1.5 * scale)}] 0 d`); lw(0.12);
    for (const it of p.items) {
      if (!isVisible(p, it)) continue;
      for (const r of geom(it).routes) if (r.length >= 0.5) path(sampleRoute(r.prims, 0, 0, (4 * Math.PI) / 180), false);
    }
    body.push("[] 0 d");
  }
  if (o.scenery) {
    body.push("0.35 G"); lw(0.2);
    for (const ob of p.objects ?? []) if (objectDef(ob.kind) && !objectDef(ob.kind)!.stock) path(objectCorners(p, ob), true);
  }
  body.push("0 G"); lw(0.5);
  body.push("1 j 1 J");
  for (const bd of p.boards) if (bd.pts.length >= 3) path(bd.pts, true);
  const drawing = body.join("\n");

  // per-page streams
  const objs: string[] = [];           // object bodies, 1-based ids
  const add = (s: string) => { objs.push(s); return objs.length; };
  const stream = (s: string) => `<< /Length ${s.length} >>\nstream\n${s}\nendstream`;
  const catalogId = add(""), pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const boldId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const xId = add(`<< /Type /XObject /Subtype /Form /BBox [${n2(b.minX - padX - 5)} ${n2(b.minY - padY - 5)} ${n2(b.maxX + padX + 5)} ${n2(b.maxY + padY + 5)}] /Resources << >> /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`);
  const kids: number[] = [];
  const barReal = [50, 100, 200, 250, 500, 1000, 2000, 5000].find((v) => v / scale >= 35) ?? 5000;
  const text = (x: number, y: number, size: number, t: string, bold = false, shade = 0) => `BT ${shade} g /${bold ? "F2" : "F1"} ${size} Tf ${n2(x * PT)} ${n2(y * PT)} Td ${pdfText(t)} Tj ET`;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const c: string[] = [];
    const ox = MARGIN, oy = MARGIN + FOOT;                           // lower-left of the drawing cell, mm
    // plan coordinates of this cell's lower-left corner (rows run from the top of the plan down)
    const wx = b.minX - padX + col * cellW * scale, wy = b.minY - padY + (rows - 1 - row) * cellH * scale;
    c.push("q", `${n2(ox * PT)} ${n2(oy * PT)} ${n2(cellW * PT)} ${n2(cellH * PT)} re W n`);
    c.push(`${k.toFixed(6)} 0 0 ${k.toFixed(6)} ${((ox - wx / scale) * PT).toFixed(3)} ${((oy - wy / scale) * PT).toFixed(3)} cm`, "/D Do", "Q");
    if (o.names) {
      for (const bd of p.boards) {
        if (bd.pts.length < 3 || !bd.name) continue;
        const cx = bd.pts.reduce((s, q) => s + q.x, 0) / bd.pts.length, cy = bd.pts.reduce((s, q) => s + q.y, 0) / bd.pts.length;
        const px = ox + (cx - wx) / scale, py = oy + (cy - wy) / scale;
        const size = 7, wText = bd.name.length * size * 0.5 * 0.3528;
        if (px - wText / 2 < ox + 1 || px + wText / 2 > ox + cellW - 1 || py < oy + 2 || py > oy + cellH - 3) continue;
        c.push(text(px - wText / 2, py - 1, size, bd.name, false, 0.45));
      }
    }
    // frame, and where the neighbouring sheets join
    c.push("0.6 G 0.3 w", `${n2(ox * PT)} ${n2(oy * PT)} ${n2(cellW * PT)} ${n2(cellH * PT)} re S`);
    // footer: title, scale, scale bar, page
    const fy = MARGIN + 1;
    c.push(text(ox, fy + 7.5, 10, p.name, true));
    c.push(text(ox, fy + 3, 7.5, `Baseboard outlines for scenery planning, scale ${fmtScale(scale)}, ${Math.round(W)} × ${Math.round(H)} mm, grid ${o.grid ? `${gridStep} mm` : "off"}, ${today}`, false, 0.3));
    const bx = ox + cellW - barReal / scale - 2, by = fy + 5;
    c.push("0 G 0.5 w", `${n2(bx * PT)} ${n2(by * PT)} m ${n2((bx + barReal / scale) * PT)} ${n2(by * PT)} l S`);
    for (let i = 0; i <= 5; i++) { const tx = bx + (barReal / scale) * (i / 5); c.push(`${n2(tx * PT)} ${n2(by * PT)} m ${n2(tx * PT)} ${n2((by + (i % 5 === 0 ? 2.4 : 1.4)) * PT)} l S`); }
    c.push(text(bx, by - 3.2, 7, `0`, false, 0.2), text(bx + barReal / scale - 9, by - 3.2, 7, `${barReal} mm`, false, 0.2));
    if (cols * rows > 1) {
      c.push(text(ox + cellW / 2 - 18, fy + 7.5, 8, `Sheet ${row * cols + col + 1} of ${cols * rows}  (row ${row + 1}, column ${col + 1})`, true, 0.2));
      c.push(text(ox + cellW / 2 - 18, fy + 3.6, 6.5, "Trim at the frame and tape the sheets edge to edge.", false, 0.4));
    }
    const contentId = add(stream(c.join("\n")));
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n2(pageW * PT)} ${n2(pageH * PT)}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> /XObject << /D ${xId} 0 R >> >> >>`));
  }
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((i) => `${i} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((body2, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body2}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o2) => `${String(o2).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info << /Title ${pdfText(`${p.name} - baseboard outlines`)} /Producer (Railplot) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return { pdf: bytes, plan };
}

/** One line saying what will be printed. */
export function describeOutline(plan: OutlinePlan): string {
  const paper = plan.landscape ? "landscape" : "portrait";
  return plan.pages === 1 ? `One ${paper} page at ${fmtScale(plan.scale)}: 10 mm on paper is ${Math.round(plan.scale * 10)} mm on the layout.`
    : `${plan.pages} ${paper} pages (${plan.cols} across, ${plan.rows} down) at ${fmtScale(plan.scale)}: 10 mm on paper is ${Math.round(plan.scale * 10)} mm on the layout.`;
}
