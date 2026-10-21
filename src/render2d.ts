// Draws a layout onto a 2D canvas.
import { Pose, Prim, Seg, Vec, primAt, primOf, samplePrim, walk } from "./geom";
import { Analysis, Board, Item, Project, geom, gradeBand, gradient, isVisible, motorsOverFrame, partOf } from "./model";
import { getModule, moduleFixings, moduleGuides, moduleMembers, moduleOpenings, modulePorts, moduleToWorld } from "./modules";

export interface View { s: number; ox: number; oy: number }  // px per mm, screen position of world origin
export const toScreen = (v: View, p: Vec): Vec => ({ x: v.ox + p.x * v.s, y: v.oy - p.y * v.s });
export const toWorldPt = (v: View, p: Vec): Vec => ({ x: (p.x - v.ox) / v.s, y: (v.oy - p.y) / v.s });

export interface Palette {
  plot: string; grid: string; gridMajor: string; board: string; boardEdge: string; boardText: string;
  rail: string; sleeper: string; select: string; accent: string; ink: string; ink2: string;
  ok: string; warn: string; bad: string; free: string; flex: string; ghost: string; prop: string;
}

export function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const g = (n: string) => cs.getPropertyValue(n).trim() || "#888";
  return {
    plot: g("--plot"), grid: g("--grid"), gridMajor: g("--grid-major"), board: g("--board"), boardEdge: g("--board-edge"),
    boardText: g("--board-text"), rail: g("--rail"), sleeper: g("--sleeper"), select: g("--select"), accent: g("--accent"),
    ink: g("--ink"), ink2: g("--ink-2"), ok: g("--ok"), warn: g("--warn"), bad: g("--bad"), free: g("--free"),
    flex: g("--flex"), ghost: g("--ghost"), prop: g("--proposal"),
  };
}

export type LabelMode = "none" | "number" | "name" | "gradient";

export interface Overlay {
  selection: Set<string>;
  anchor: Pose | null;
  hoverEnd: Vec | null;
  heights: boolean;
  heightSel: Vec | null;
  labels: LabelMode;
  draft?: { start: Pose; segs: Seg[]; preview: Seg[] | null; ok: boolean } | null;
  boardDraft?: Vec[] | null;
  cursor?: Vec | null;
  measure?: { a: Vec; b: Vec } | null;
  marquee?: { a: Vec; b: Vec } | null;
  gridStep: number;
  showGrid: boolean;
  analysis: Analysis;
  /** Draw baseboard module frames, openings and fixings. */
  structure?: boolean;
  /** Draw the track positions on module faces and the guides between them. */
  tracksGuides?: boolean;
  /** Guides tighter than this radius are drawn in red (the flexible track's minimum). */
  guideMinRadius?: number;
  /** A proposal shown on the plan: its new and changed boards and track, and what it removes. */
  proposal?: { boards: Board[]; items: Item[]; dim: Set<string>; removed: Set<string> } | null;
}

function pathPrim(ctx: CanvasRenderingContext2D, v: View, pr: Prim, offset: number, move = true) {
  if (pr.kind === "line") {
    const n = { x: -Math.sin(pr.h) * offset, y: Math.cos(pr.h) * offset };
    const a = toScreen(v, { x: pr.a.x + n.x, y: pr.a.y + n.y }), b = toScreen(v, { x: pr.b.x + n.x, y: pr.b.y + n.y });
    if (move) ctx.moveTo(a.x, a.y); else ctx.lineTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else {
    const sign = Math.sign(pr.sweep) || 1;
    const r = (pr.r - sign * offset) * v.s;
    const c = toScreen(v, pr.c);
    const a0 = -pr.a0, a1 = -(pr.a0 + pr.sweep);
    if (move) { ctx.moveTo(c.x + r * Math.cos(a0), c.y + r * Math.sin(a0)); }
    ctx.arc(c.x, c.y, Math.max(r, 0.01), a0, a1, pr.sweep > 0);
  }
}

function strokeRoutes(ctx: CanvasRenderingContext2D, v: View, prims: Prim[][], offsets: number[]) {
  ctx.beginPath();
  for (const route of prims) for (const off of offsets) route.forEach((pr, i) => pathPrim(ctx, v, pr, off, i === 0));
  ctx.stroke();
}

function drawSleepers(ctx: CanvasRenderingContext2D, v: View, prims: Prim[], len: number, spacing: number) {
  ctx.beginPath();
  for (const pr of prims) {
    const n = Math.max(1, Math.floor(pr.len / spacing));
    for (let i = 0; i < n; i++) {
      const p = primAt(pr, (i + 0.5) * (pr.len / n));
      const nx = -Math.sin(p.h) * len / 2, ny = Math.cos(p.h) * len / 2;
      const a = toScreen(v, { x: p.x + nx, y: p.y + ny }), b = toScreen(v, { x: p.x - nx, y: p.y - ny });
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
  }
  ctx.stroke();
}

export function segsToPrims(start: Pose, segs: Seg[]): Prim[] {
  const out: Prim[] = [];
  let p = start;
  for (const s of segs) { out.push(primOf(p, s)); p = walk(p, s); }
  return out;
}

/** Draw a track (centre-line prims grouped per route) in the current style. */
function drawTrack(ctx: CanvasRenderingContext2D, v: View, routes: Prim[][], gauge: number, sleeperLen: number, spacing: number, rail: string, sleeper: string, alpha = 1) {
  ctx.globalAlpha = alpha;
  if (v.s >= 0.16) {
    ctx.strokeStyle = sleeper;
    ctx.lineWidth = Math.max(1, 2.4 * v.s);
    if (spacing * v.s >= 3) for (const r of routes) drawSleepers(ctx, v, r, sleeperLen, spacing);
    else {
      ctx.lineWidth = sleeperLen * v.s;
      ctx.globalAlpha = alpha * 0.55;
      strokeRoutes(ctx, v, routes, [0]);
      ctx.globalAlpha = alpha;
    }
    ctx.strokeStyle = rail;
    ctx.lineWidth = Math.max(v.s < 0.5 ? 0.8 : 1, 0.9 * v.s);
    strokeRoutes(ctx, v, routes, [gauge / 2, -gauge / 2]);
  } else {
    ctx.strokeStyle = rail;
    ctx.lineWidth = 1.6;
    strokeRoutes(ctx, v, routes, [0]);
  }
  ctx.globalAlpha = 1;
}

export function drawGrid(ctx: CanvasRenderingContext2D, v: View, w: number, h: number, step: number, pal: Palette) {
  let st = step;
  while (st * v.s < 8) st *= 2;
  const major = st * 10;
  const tl = toWorldPt(v, { x: 0, y: 0 }), br = toWorldPt(v, { x: w, y: h });
  const lines = (s: number, color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = Math.floor(tl.x / s) * s; x <= br.x; x += s) { const sx = Math.round(v.ox + x * v.s) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
    for (let y = Math.floor(br.y / s) * s; y <= tl.y; y += s) { const sy = Math.round(v.oy - y * v.s) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
    ctx.stroke();
  };
  lines(st, pal.grid);
  if (major * v.s > 40) lines(major, pal.gridMajor);
}

export function fmtLen(mm: number, units: "mm" | "in" = "mm"): string {
  if (units === "in") return `${(mm / 25.4).toFixed(mm < 254 ? 2 : 1)} in`;
  return mm >= 1000 ? `${(mm / 1000).toFixed(mm >= 10000 ? 1 : 2)} m` : `${Math.round(mm)} mm`;
}

export function drawProject(ctx: CanvasRenderingContext2D, v: View, w: number, h: number, p: Project, o: Overlay, pal: Palette) {
  ctx.fillStyle = pal.plot;
  ctx.fillRect(0, 0, w, h);
  if (o.showGrid) drawGrid(ctx, v, w, h, o.gridStep, pal);

  // baseboards
  for (const b of p.boards) {
    if (b.pts.length < 3) continue;
    ctx.beginPath();
    b.pts.forEach((q, i) => { const s = toScreen(v, q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.closePath();
    ctx.fillStyle = pal.board; ctx.fill();
    if (b.module && o.structure !== false) drawModule(ctx, v, b, pal);
    if (b.module && o.tracksGuides !== false) drawTrackGuides(ctx, v, b, pal, o);
    ctx.beginPath();
    b.pts.forEach((q, i) => { const s = toScreen(v, q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.closePath();
    ctx.lineWidth = o.selection.has(b.id) ? 2.5 : 1.5;
    ctx.strokeStyle = o.selection.has(b.id) ? pal.select : pal.boardEdge; ctx.stroke();
  }
  if (o.structure !== false && p.boards.some((b) => b.module)) {
    for (const w of motorsOverFrame(p)) {
      const it = p.items.find((i) => i.id === w.item);
      if (!it || !isVisible(p, it)) continue;
      const g = geom(it);
      const toe = g.ends[0];
      const sp = toScreen(v, { x: toe.x + Math.cos(toe.h + Math.PI) * 20, y: toe.y + Math.sin(toe.h + Math.PI) * 20 });
      ctx.strokeStyle = pal.warn; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(8, 16 * v.s), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // tracks
  const font = (px: number) => `${px}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-num") || "monospace"}`;
  for (const it of p.items) {
    if (!isVisible(p, it)) continue;
    const g = geom(it);
    const prof = g.part.lib.profile;
    const routes = g.routes.map((r) => r.prims);
    const sel = o.selection.has(it.id);
    let rail = pal.rail;
    if (o.heights) {
      const band = gradeBand(gradient(it));
      if (band === "ok") rail = pal.ok; else if (band === "steep") rail = pal.warn; else if (band === "too-steep") rail = pal.bad;
    }
    if (sel) {
      ctx.strokeStyle = pal.select; ctx.globalAlpha = 0.28; ctx.lineWidth = Math.max(6, (prof.sleeperLength + 6) * v.s);
      ctx.lineCap = "round"; strokeRoutes(ctx, v, routes, [0]); ctx.lineCap = "butt"; ctx.globalAlpha = 1;
    }
    drawTrack(ctx, v, routes, g.part.lib.gauge, prof.sleeperLength, prof.sleeperSpacing, sel ? pal.select : rail,
      g.part.def.type === "flex" ? pal.flex : pal.sleeper, o.proposal?.dim.has(it.id) ? 0.3 : 1);
  }
  if (o.proposal) drawProposal(ctx, v, p, o.proposal, pal);

  // joints, ends
  const an = o.analysis;
  const endR = Math.max(3, Math.min(7, 5 * v.s));
  for (const e of an.free) {
    const it = p.items.find((i) => i.id === e.item);
    if (it && !isVisible(p, it)) continue;
    const s = toScreen(v, e);
    ctx.strokeStyle = pal.free; ctx.lineWidth = 2;
    const nx = -Math.sin(e.h), ny = Math.cos(e.h);
    const half = Math.max(6, 14 * v.s);
    ctx.beginPath(); ctx.moveTo(s.x + nx * half, s.y - ny * half); ctx.lineTo(s.x - nx * half, s.y + ny * half); ctx.stroke();
  }
  for (const e of an.bad) {
    const s = toScreen(v, e);
    ctx.strokeStyle = pal.bad; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, endR + 4, 0, Math.PI * 2); ctx.stroke();
  }
  for (const st of p.starts) {
    const sel = o.selection.has(st.id);
    drawArrow(ctx, v, st, sel ? pal.select : pal.accent, 0.8);
  }
  if (o.hoverEnd) {
    const s = toScreen(v, o.hoverEnd);
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, endR + 5, 0, Math.PI * 2); ctx.stroke();
  }
  if (o.anchor) drawArrow(ctx, v, o.anchor, pal.accent, 1);

  // labels
  if (o.labels !== "none" || o.heights) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = font(Math.round(Math.max(10, Math.min(13, 10 * v.s + 6))));
    for (const it of p.items) {
      if (!isVisible(p, it)) continue;
      const g = geom(it);
      const r0 = g.routes[0];
      if (!r0 || !r0.prims.length) continue;
      let text = "";
      const mode = o.heights ? "gradient" : o.labels;
      if (mode === "number") text = g.part.def.id;
      else if (mode === "name") text = g.part.def.name;
      else if (mode === "gradient") { const gr = gradient(it); if (gr !== null && Math.abs(gr) >= 0.05) text = `${Math.abs(gr).toFixed(1)}%`; }
      if (!text) continue;
      let t = r0.length / 2, pr = r0.prims[0];
      for (const q of r0.prims) { if (t <= q.len) { pr = q; break; } t -= q.len; }
      const m = primAt(pr, Math.min(t, pr.len));
      const s = toScreen(v, { x: m.x - Math.sin(m.h) * 22, y: m.y + Math.cos(m.h) * 22 });
      labelPill(ctx, s.x, s.y, text, pal, mode === "gradient" ? colorFor(gradient(it), pal) : pal.ink);
    }
  }

  // heights: one marker per joint
  if (o.heights) {
    const seen: Vec[] = [];
    ctx.font = font(11);
    for (const e of an.ends) {
      if (seen.some((q) => Math.hypot(q.x - e.x, q.y - e.y) < 0.6)) continue;
      seen.push(e);
      const s = toScreen(v, e);
      const sel = o.heightSel && Math.hypot(o.heightSel.x - e.x, o.heightSel.y - e.y) < 0.6;
      ctx.fillStyle = sel ? pal.select : pal.plot; ctx.strokeStyle = sel ? pal.select : pal.ink2; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (e.z !== 0 || sel) {
        ctx.fillStyle = pal.ink; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(`${+e.z.toFixed(1)}`, s.x + 7, s.y - 4);
      }
    }
  }

  // flex draft
  if (o.draft) {
    const fixed = segsToPrims(o.draft.start, o.draft.segs);
    let end = o.draft.start;
    for (const sgm of o.draft.segs) end = walk(end, sgm);
    ctx.setLineDash([]);
    drawTrack(ctx, v, [fixed], 16.5, 30, 8.5, pal.select, pal.flex);
    if (o.draft.preview) {
      drawTrack(ctx, v, [segsToPrims(end, o.draft.preview)], 16.5, 30, 8.5, o.draft.ok ? pal.ok : pal.bad, pal.ghost, 0.85);
    }
  }
  if (o.boardDraft && o.boardDraft.length) {
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath();
    o.boardDraft.forEach((q, i) => { const s = toScreen(v, q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    if (o.cursor) { const s = toScreen(v, o.cursor); ctx.lineTo(s.x, s.y); }
    ctx.stroke(); ctx.setLineDash([]);
    for (const q of o.boardDraft) { const s = toScreen(v, q); ctx.fillStyle = pal.accent; ctx.fillRect(s.x - 3, s.y - 3, 6, 6); }
  }
  if (o.measure) {
    const a = toScreen(v, o.measure.a), b = toScreen(v, o.measure.b);
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    const d = Math.hypot(o.measure.b.x - o.measure.a.x, o.measure.b.y - o.measure.a.y);
    ctx.font = font(12);
    labelPill(ctx, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14, fmtLen(d, p.units), pal, pal.ink);
  }
  if (o.marquee) {
    const a = toScreen(v, o.marquee.a), b = toScreen(v, o.marquee.b);
    ctx.fillStyle = pal.select; ctx.globalAlpha = 0.1; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.select; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y); ctx.setLineDash([]);
  }
}

function drawProposal(ctx: CanvasRenderingContext2D, v: View, p: Project, pr: NonNullable<Overlay["proposal"]>, pal: Palette) {
  const outline = (pts: Vec[]) => { ctx.beginPath(); pts.forEach((q, i) => { const s = toScreen(v, q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath(); };
  // removed: struck through in red
  for (const b of p.boards) if (pr.removed.has(b.id)) {
    outline(b.pts); ctx.strokeStyle = pal.bad; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const it of p.items) if (pr.removed.has(it.id)) {
    const g = geom(it);
    ctx.strokeStyle = pal.bad; ctx.globalAlpha = 0.45; ctx.lineWidth = Math.max(4, (g.part.lib.profile.sleeperLength + 4) * v.s); ctx.lineCap = "round";
    strokeRoutes(ctx, v, g.routes.map((r) => r.prims), [0]); ctx.lineCap = "butt"; ctx.globalAlpha = 1;
  }
  // new and changed: in the proposal colour
  for (const b of pr.boards) {
    if (b.pts.length < 3) continue;
    outline(b.pts); ctx.fillStyle = pal.prop; ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.prop; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const it of pr.items) {
    const g = geom(it);
    const prof = g.part.lib.profile;
    const routes = g.routes.map((r) => r.prims);
    ctx.strokeStyle = pal.prop; ctx.globalAlpha = 0.22; ctx.lineWidth = Math.max(6, (prof.sleeperLength + 8) * v.s); ctx.lineCap = "round";
    strokeRoutes(ctx, v, routes, [0]); ctx.lineCap = "butt"; ctx.globalAlpha = 1;
    drawTrack(ctx, v, routes, g.part.lib.gauge, prof.sleeperLength, prof.sleeperSpacing, pal.prop, pal.prop, 0.9);
  }
}

/** Hidden frame members (dashed), bottom-skin openings and end fixings of a baseboard module. */
function drawModule(ctx: CanvasRenderingContext2D, v: View, b: Board, pal: Palette) {
  const m = getModule(b.module!.preset);
  if (!m) return;
  const W = (q: { x: number; y: number }) => toScreen(v, moduleToWorld(m, b.module!, q));
  ctx.save();
  // openings in the bottom skin: where you can reach from underneath
  ctx.fillStyle = pal.plot; ctx.globalAlpha = 0.38;
  for (const o of moduleOpenings(m)) {
    ctx.beginPath(); o.forEach((q, i) => { const s = W(q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 0.9;
  // frame members under the top
  ctx.strokeStyle = pal.boardEdge;
  ctx.setLineDash([Math.max(3, 10 * v.s), Math.max(2, 6 * v.s)]);
  for (const mem of moduleMembers(m)) {
    if (mem.kind === "side") continue;
    ctx.lineWidth = Math.max(1, mem.thickness * v.s);
    const a = W(mem.a), c = W(mem.b);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  // guides engraved on the top: centre lines, centre arcs, roads, 100 mm ticks
  ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.strokeStyle = pal.boardText;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of m.marks) { const a = W({ x: x1, y: y1 }), c = W({ x: x2, y: y2 }); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); }
  ctx.stroke();
  // moving decks, turntable discs, openings in the top, the canopy above and the backscene
  for (const f of m.features) {
    ctx.globalAlpha = 0.85;
    if (f.line) {
      ctx.strokeStyle = pal.boardText; ctx.lineWidth = Math.max(2, 4 * v.s);
      ctx.beginPath(); f.line.forEach((q, i) => { const p = W(q); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
      continue;
    }
    if (!f.outline) continue;
    ctx.beginPath(); f.outline.forEach((q, i) => { const p = W(q); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath();
    if (f.kind === "canopy") { ctx.strokeStyle = pal.boardText; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]); }
    else if (f.kind === "well") { ctx.fillStyle = pal.plot; ctx.globalAlpha = 0.5; ctx.fill(); }
    else { ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.6; ctx.stroke(); }
  }
  // fixings at the ends
  ctx.globalAlpha = 1;
  for (const f of moduleFixings(m)) {
    const s = W(f.p), r = Math.max(2, (f.d / 2) * v.s);
    ctx.strokeStyle = pal.boardText; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
    if (f.kind === "bolt") { ctx.beginPath(); ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x + r, s.y); ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x, s.y + r); ctx.stroke(); }
  }
  // name and size, in the middle
  ctx.font = `11px ${getComputedStyle(document.documentElement).getPropertyValue("--font-num") || "monospace"}`;
  const room = Math.min(m.length, m.width) * v.s * 0.9;
  for (const label of [`${b.name} · ${m.size}`, b.name]) {
    if (ctx.measureText(label).width > room) continue;
    const s = toScreen(v, { x: b.module!.cx, y: b.module!.cy });
    ctx.fillStyle = pal.boardText; ctx.globalAlpha = 0.8; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, s.x, s.y + 14);
    break;
  }
  ctx.restore();
}

/** Track positions on a module's faces (rings, filled once track ends there) and dashed guides between them. */
function drawTrackGuides(ctx: CanvasRenderingContext2D, v: View, b: Board, pal: Palette, o: Overlay) {
  const m = getModule(b.module!.preset);
  if (!m) return;
  const ports = modulePorts(m, b.module!);
  if (!ports.length || (b.module!.spacing ?? 67) * v.s < 5) return;
  ctx.save();
  ctx.lineWidth = Math.max(1, 1.2);
  ctx.setLineDash([Math.max(4, 14 * v.s), Math.max(3, 10 * v.s)]);
  for (const g of moduleGuides(m, b.module!)) {
    const tight = g.minRadius < (o.guideMinRadius ?? 0) - 0.01;
    ctx.strokeStyle = tight ? "#d2452c" : pal.accent;
    ctx.globalAlpha = tight ? 0.7 : 0.45;
    ctx.beginPath();
    let pose: Pose = g.from, first = true;
    for (const sg of g.segs) {
      const pr = primOf(pose, sg);
      for (const q of samplePrim(pr, 20)) { const s = toScreen(v, q); if (first) { ctx.moveTo(s.x, s.y); first = false; } else ctx.lineTo(s.x, s.y); }
      pose = walk(pose, sg);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const used = (q: Vec) => o.analysis.ends.some((e) => Math.abs(e.x - q.x) < 1 && Math.abs(e.y - q.y) < 1);
  const r = Math.max(3, Math.min(6, 9 * v.s));
  for (const q of ports) {
    const s = toScreen(v, q);
    // a short tick into the board shows the direction track leaves the face
    const t = { x: s.x + Math.cos(q.h) * 14, y: s.y - Math.sin(q.h) * 14 };
    ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = used(q) ? pal.accent : pal.plot; ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function colorFor(gr: number | null, pal: Palette) {
  const b = gradeBand(gr);
  return b === "ok" ? pal.ok : b === "steep" ? pal.warn : b === "too-steep" ? pal.bad : pal.ink2;
}

function labelPill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, pal: Palette, color: string) {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 10, hgt = 17;
  ctx.fillStyle = pal.plot; ctx.globalAlpha = 0.88;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - hgt / 2, w, hgt, 4); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = color; ctx.fillText(text, x, y + 0.5);
}

function drawArrow(ctx: CanvasRenderingContext2D, v: View, p: Pose, color: string, alpha: number) {
  const s = toScreen(v, p);
  const L = 22, W = 8;
  const dx = Math.cos(p.h), dy = -Math.sin(p.h);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + dx * L, s.y + dy * L); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s.x + dx * (L + 8), s.y + dy * (L + 8));
  ctx.lineTo(s.x + dx * L - dy * W, s.y + dy * L + dx * W);
  ctx.lineTo(s.x + dx * L + dy * W, s.y + dy * L - dx * W);
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------- hit testing ----------

export function hitItem(p: Project, q: Vec, tolMm: number): Item | null {
  let best: Item | null = null, bestD = Infinity;
  for (let i = p.items.length - 1; i >= 0; i--) {
    const it = p.items[i];
    if (!isVisible(p, it)) continue;
    const g = geom(it);
    const b = g.bounds;
    if (q.x < b.minX - tolMm || q.x > b.maxX + tolMm || q.y < b.minY - tolMm || q.y > b.maxY + tolMm) continue;
    const half = g.part.lib.profile.sleeperLength / 2;
    for (const r of g.routes) for (const pr of r.prims) {
      const d = Math.max(0, distToPrimFast(pr, q) - half);
      if (d <= tolMm && d < bestD) { best = it; bestD = d; }
    }
  }
  return best;
}

import { distToPrim } from "./geom";
const distToPrimFast = distToPrim;

export function itemsInRect(p: Project, a: Vec, b: Vec): string[] {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const ids: string[] = [];
  for (const it of p.items) {
    if (!isVisible(p, it)) continue;
    const bb = geom(it).bounds;
    if (bb.minX >= minX && bb.maxX <= maxX && bb.minY >= minY && bb.maxY <= maxY) ids.push(it.id);
  }
  for (const s of p.starts) if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) ids.push(s.id);
  return ids;
}

// ---------- SVG export ----------

export function projectToSvg(p: Project, pal: Palette, bounds: { minX: number; minY: number; maxX: number; maxY: number }): string {
  const pad = 40;
  const W = bounds.maxX - bounds.minX + pad * 2, H = bounds.maxY - bounds.minY + pad * 2;
  const X = (x: number) => (x - bounds.minX + pad).toFixed(2), Y = (y: number) => (bounds.maxY - y + pad).toFixed(2);
  const primD = (pr: Prim, off: number, first: boolean) => {
    if (pr.kind === "line") {
      const n = { x: -Math.sin(pr.h) * off, y: Math.cos(pr.h) * off };
      return `${first ? "M" : "L"}${X(pr.a.x + n.x)} ${Y(pr.a.y + n.y)} L${X(pr.b.x + n.x)} ${Y(pr.b.y + n.y)}`;
    }
    const sign = Math.sign(pr.sweep) || 1;
    const r = pr.r - sign * off;
    const a = { x: pr.c.x + r * Math.cos(pr.a0), y: pr.c.y + r * Math.sin(pr.a0) };
    const b = { x: pr.c.x + r * Math.cos(pr.a0 + pr.sweep), y: pr.c.y + r * Math.sin(pr.a0 + pr.sweep) };
    const large = Math.abs(pr.sweep) > Math.PI ? 1 : 0;
    const sweepFlag = pr.sweep > 0 ? 0 : 1;
    return `${first ? "M" : "L"}${X(a.x)} ${Y(a.y)} A${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} ${sweepFlag} ${X(b.x)} ${Y(b.y)}`;
  };
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}mm" height="${H.toFixed(1)}mm" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}">`);
  out.push(`<title>${esc(p.name)}</title>`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  for (const b of p.boards) out.push(`<polygon points="${b.pts.map((q) => `${X(q.x)},${Y(q.y)}`).join(" ")}" fill="#efe4cf" stroke="#9a8460" stroke-width="1"/>`);
  for (const it of p.items) {
    if (!isVisible(p, it)) continue;
    const g = geom(it);
    const half = g.part.lib.gauge / 2;
    const prof = g.part.lib.profile;
    const sleepers: string[] = [];
    for (const r of g.routes) for (const pr of r.prims) {
      for (const s of samplePrim(pr, prof.sleeperSpacing).slice(0, -1)) {
        const nx = -Math.sin(s.h) * prof.sleeperLength / 2, ny = Math.cos(s.h) * prof.sleeperLength / 2;
        sleepers.push(`M${X(s.x + nx)} ${Y(s.y + ny)} L${X(s.x - nx)} ${Y(s.y - ny)}`);
      }
    }
    out.push(`<g data-part="${esc(partOf(it).def.id)}"><path d="${sleepers.join(" ")}" stroke="#a89880" stroke-width="2.2" fill="none"/>`);
    const rails = g.routes.map((r) => [half, -half].map((off) => r.prims.map((pr, i) => primD(pr, off, i === 0)).join(" ")).join(" ")).join(" ");
    out.push(`<path d="${rails}" stroke="#2b2f2c" stroke-width="0.9" fill="none"/></g>`);
  }
  out.push(`</svg>`);
  return out.join("\n");
}

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
