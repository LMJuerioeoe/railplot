// Small SVG drawings of library parts for the tracks panel.
import { Prim, primBounds, primOf, walk } from "./geom";
import { Part } from "./library";

export function partThumb(part: Part, size = 56): string {
  const routes: Prim[][] = part.routes.map((r) => {
    let p = r.from;
    return r.segs.map((s) => { const pr = primOf(p, s); p = walk(p, s); return pr; });
  });
  if (part.def.type === "flex") {
    let p = { x: 0, y: 0, h: 0.35 };
    const segs = [{ kind: "a" as const, r: 160, deg: -40 }, { kind: "a" as const, r: 160, deg: 40 }];
    routes[0] = segs.map((s) => { const pr = primOf(p, s); p = walk(p, s); return pr; });
  }
  const g = part.lib.gauge / 2;
  const b = primBounds(routes.flat(), part.lib.profile.sleeperLength / 2 + 2);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const k = (size - 6) / Math.max(w, h);
  const ox = (size - w * k) / 2 - b.minX * k, oy = (size + h * k) / 2 + b.minY * k;
  const X = (x: number) => (ox + x * k).toFixed(2), Y = (y: number) => (oy - y * k).toFixed(2);
  const d = (pr: Prim, off: number) => {
    if (pr.kind === "line") {
      const n = { x: -Math.sin(pr.h) * off, y: Math.cos(pr.h) * off };
      return `M${X(pr.a.x + n.x)} ${Y(pr.a.y + n.y)}L${X(pr.b.x + n.x)} ${Y(pr.b.y + n.y)}`;
    }
    const sign = Math.sign(pr.sweep) || 1, r = pr.r - sign * off;
    const a = { x: pr.c.x + r * Math.cos(pr.a0), y: pr.c.y + r * Math.sin(pr.a0) };
    const e = { x: pr.c.x + r * Math.cos(pr.a0 + pr.sweep), y: pr.c.y + r * Math.sin(pr.a0 + pr.sweep) };
    return `M${X(a.x)} ${Y(a.y)}A${(r * k).toFixed(2)} ${(r * k).toFixed(2)} 0 ${Math.abs(pr.sweep) > Math.PI ? 1 : 0} ${pr.sweep > 0 ? 0 : 1} ${X(e.x)} ${Y(e.y)}`;
  };
  const bed = routes.flat().map((pr) => d(pr, 0)).join("");
  const rails = routes.flat().map((pr) => d(pr, g) + d(pr, -g)).join("");
  const bedW = Math.max(3, part.lib.profile.sleeperLength * k);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="${bed}" class="th-bed" stroke-width="${bedW.toFixed(1)}" fill="none" stroke-linecap="butt"/>` +
    `<path d="${rails}" class="th-rail" stroke-width="1.3" fill="none"/></svg>`;
}
