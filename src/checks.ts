// Checks on a plan, as a list of plain-language issues: open ends, joints, point motors, track off the
// baseboards, curves tighter than the track allows, gradients, and modules whose tracks don't line up.
import { dist, distToPrim, minRadius, pointInPoly, samplePrim } from "./geom";
import { Project, allModuleEnds, analyze, geom, gradeBand, gradient, itemRoutes, motorsOverFrame, partOf, trackPorts } from "./model";
import { endsTouch, getModule } from "./modules";
import { trainFit } from "./trainfit";

export interface Issue {
  kind: "overlap" | "open-end" | "misaligned" | "motor-over-frame" | "off-board" | "too-tight" | "steep" | "module-tracks" | "module-width" | "train-fit";
  severity: "info" | "warn" | "bad";
  text: string;
  item?: string;
  board?: string;
  at?: { x: number; y: number };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Track pieces that aren't on a baseboard, at least `margin` mm in from the edges (track crossing a module joint is fine). */
export function trackOffBoards(p: Project, margin = 20, firstOnly = false): string[] {
  if (!p.boards.length) return [];
  const boards = p.boards.map((b) => b.pts);
  const ports = trackPorts(p);
  const atFace = (q: { x: number; y: number }) => ports.some((t) => dist(t, q) < margin + 5);
  const out: string[] = [];
  for (const it of p.items) {
    let off = false;
    for (const r of geom(it).routes) for (const pr of r.prims) for (const q of samplePrim(pr, 10)) {
      if (off || atFace(q)) continue;
      // every point within the margin around the centre line is on some board (joints between boards don't count as edges)
      for (let k = 0; k < 8 && !off; k++) {
        const s = { x: q.x + Math.cos((k * Math.PI) / 4) * margin, y: q.y + Math.sin((k * Math.PI) / 4) * margin };
        if (!boards.some((poly) => pointInPoly(s, poly))) off = true;
      }
    }
    if (off) { out.push(it.id); if (firstOnly) break; }
  }
  return out;
}

/**
 * Pairs of pieces laid on top of each other: one runs along the other for 30 mm or more, away from the
 * ends where pieces meet. (Crossings and points cross at a spot, so they don't count.)
 */
export function overlappingTrack(p: Project, tol = 3): [string, string][] {
  const gs = p.items.map((it) => ({ it, g: geom(it) }));
  const out: [string, string][] = [];
  for (let i = 0; i < gs.length; i++) {
    const a = gs[i];
    const samples: { x: number; y: number }[][] = a.g.routes.map((r) => r.prims.flatMap((pr) => samplePrim(pr, 5)));
    for (let j = 0; j < gs.length; j++) {
      if (i === j) continue;
      const b = gs[j];
      if (a.g.bounds.maxX < b.g.bounds.minX || b.g.bounds.maxX < a.g.bounds.minX || a.g.bounds.maxY < b.g.bounds.minY || b.g.bounds.maxY < a.g.bounds.minY) continue;
      if (j < i && out.some(([x, y]) => x === b.it.id && y === a.it.id)) continue;
      const near = (q: { x: number; y: number }) => b.g.routes.some((r) => r.prims.some((pr) => distToPrim(pr, q) < tol));
      const awayFromEnds = (q: { x: number; y: number }) => ![...a.g.ends, ...b.g.ends].some((e) => dist(e, q) < 15);
      let run = 0, found = false;
      for (const route of samples) {
        run = 0;
        for (const q of route) {
          if (awayFromEnds(q) && near(q)) { if (++run >= 7) { found = true; break; } } else run = 0;
        }
        if (found) break;
      }
      if (found && !out.some(([x, y]) => (x === b.it.id && y === a.it.id))) out.push([a.it.id, b.it.id]);
    }
  }
  return out;
}

export function layoutIssues(p: Project): Issue[] {
  const out: Issue[] = [];
  for (const [a, b] of overlappingTrack(p)) out.push({ kind: "overlap", severity: "bad", item: a, text: `Track ${a} and ${b} are laid on top of each other` });
  const an = analyze(p);
  for (const e of an.free) out.push({ kind: "open-end", severity: "info", item: e.item, at: { x: r1(e.x), y: r1(e.y) }, text: `Open end ${e.item}:${e.end} at (${Math.round(e.x)}, ${Math.round(e.y)}), facing ${Math.round(((e.h * 180) / Math.PI + 360) % 360)}°` });
  for (const e of an.bad) out.push({ kind: "misaligned", severity: "bad", item: e.item, at: { x: r1(e.x), y: r1(e.y) }, text: `Ends meet but don't line up at ${e.item}:${e.end} (${Math.round(e.x)}, ${Math.round(e.y)})` });
  for (const w of motorsOverFrame(p)) {
    const b = p.boards.find((x) => x.id === w.board);
    out.push({ kind: "motor-over-frame", severity: "warn", item: w.item, board: w.board, text: `Point ${w.item} has its motor over ${w.member} on ${b?.name ?? w.board}` });
  }
  for (const id of trackOffBoards(p)) out.push({ kind: "off-board", severity: "warn", item: id, text: `Track ${id} runs off the baseboards or within 20 mm of an edge` });
  for (const it of p.items) {
    const part = partOf(it);
    if (part.def.type === "flex" && part.def.minRadius) {
      const r = Math.min(...itemRoutes(it).map((x) => minRadius(x.segs)));
      if (r < part.def.minRadius - 0.01) out.push({ kind: "too-tight", severity: "bad", item: it.id, text: `Flexible track ${it.id} curves to R${Math.round(r)}, tighter than ${part.def.id} allows (R${part.def.minRadius})` });
    }
    const gr = gradient(it);
    const band = gradeBand(gr);
    if (gr !== null && (band === "steep" || band === "too-steep")) out.push({ kind: "steep", severity: band === "too-steep" ? "bad" : "warn", item: it.id, text: `Track ${it.id} climbs at ${Math.abs(gr).toFixed(1)}%` });
  }
  // modules: faces that meet with different widths, or different track positions
  const all = allModuleEnds(p);
  const ports = trackPorts(p);
  const seen = new Set<string>();
  for (const a of all) for (const b of all) {
    if (a.board >= b.board || dist(a, b) > 2) continue;
    const key = `${a.board}:${a.end}|${b.board}:${b.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ba = p.boards.find((x) => x.id === a.board)!, bb = p.boards.find((x) => x.id === b.board)!;
    if (!endsTouch(a, b)) {
      if (Math.abs(Math.cos(a.h - b.h) + 1) < 0.01 && Math.abs(a.width - b.width) > 1)
        out.push({ kind: "module-width", severity: "bad", board: a.board, text: `${ba.name} and ${bb.name} meet with faces of different widths (${a.width} and ${b.width} mm)` });
      continue;
    }
    if (!getModule(ba.module!.preset) || !getModule(bb.module!.preset)) continue;
    const mine = ports.filter((q) => q.board === a.board && dist(q, a) < a.width / 2 + 1);
    const theirs = ports.filter((q) => q.board === b.board && dist(q, b) < b.width / 2 + 1);
    if (mine.length !== theirs.length || mine.some((q) => !theirs.some((t) => dist(t, q) < 0.5)))
      out.push({ kind: "module-tracks", severity: "warn", board: a.board, text: `${ba.name} and ${bb.name} have different track positions at their joint (${mine.length} and ${theirs.length} tracks), so the tracks won't line up` });
  }
  for (const f of trainFit(p)) out.push({ kind: "train-fit", severity: f.severity, item: f.items[0], text: f.text });
  return out;
}
