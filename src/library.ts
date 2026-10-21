// Track libraries: the JSON format contributors write, and the normalised parts the editor uses.
import { DEG, Pose, Seg, dist, normAngle, segLength, walk } from "./geom";
import peco from "./libraries/peco-setrack-oo.json";
import hornby from "./libraries/hornby-oo.json";
import piko from "./libraries/piko-a-h0.json";
import pikoRoadbed from "./libraries/piko-a-roadbed-h0.json";
import streamline from "./libraries/peco-streamline-oo.json";
import maerklinC from "./libraries/maerklin-c-h0.json";
import kato from "./libraries/kato-unitrack-ho.json";

export type SegDef = { straight: number } | { radius: number; angle: number };
export interface RouteDef { from?: [number, number, number]; segs: SegDef[] }

export interface PartDef {
  id: string;
  name: string;
  type: "straight" | "curve" | "turnout" | "crossing" | "flex";
  length?: number;
  radius?: number;
  angle?: number;
  hand?: "left" | "right" | "both";
  routes?: RouteDef[];
  slip?: { radius: number };
  maxLength?: number;
  minRadius?: number;
  note?: string;
  /** The maker does not publish full geometry; Railplot's shape is a best estimate. */
  approximate?: boolean;
}

export interface TrackProfile {
  sleeperLength: number;
  sleeperWidth: number;
  sleeperSpacing: number;
  railHeight: number;
  roadbed: { top: number; bottom: number; height: number } | null;
}

export interface LibraryDef {
  format: 1;
  id: string;
  name: string;
  producer: string;
  system: string;
  scale: string;
  gauge: number;
  /** Centre-to-centre distance of parallel tracks laid with the system's own points and curves, mm. */
  trackSpacing?: number;
  profile: TrackProfile;
  sources: { title: string; url: string }[];
  parts: PartDef[];
}

export interface Route { from: Pose; segs: Seg[] }
/** An endpoint of a part in its local frame. `h` is the outward heading. */
export interface EndDef { x: number; y: number; h: number; route: number; atStart: boolean }

export interface Part {
  lib: LibraryDef;
  def: PartDef;
  key: string;          // "<libId>/<partId>"
  routes: Route[];
  ends: EndDef[];
  rigid: boolean;       // all ends share one height (turnouts, crossings)
  length: number;       // length of the main route
}

export function segFromDef(d: SegDef): Seg {
  return "straight" in d ? { kind: "s", len: d.straight } : { kind: "a", r: d.radius, deg: d.angle };
}

export function routesOf(def: PartDef): Route[] {
  const o: Pose = { x: 0, y: 0, h: 0 };
  switch (def.type) {
    case "straight": return [{ from: o, segs: [{ kind: "s", len: def.length! }] }];
    case "curve": return [{ from: o, segs: [{ kind: "a", r: def.radius!, deg: def.angle! }] }];
    case "flex": return [{ from: o, segs: [{ kind: "s", len: Math.min(def.maxLength ?? 500, 300) }] }];
    case "crossing": {
      const L = def.length!, a = def.angle! * DEG;
      const fromA: Pose = { x: -L / 2, y: 0, h: 0 };
      const fromB: Pose = { x: (-L / 2) * Math.cos(a), y: (-L / 2) * Math.sin(a), h: a };
      const r: Route[] = [
        { from: fromA, segs: [{ kind: "s", len: L }] },
        { from: fromB, segs: [{ kind: "s", len: L }] },
      ];
      if (def.slip) {
        r.push({ from: fromA, segs: [{ kind: "a", r: def.slip.radius, deg: def.angle! }] });
        r.push({ from: fromB, segs: [{ kind: "a", r: def.slip.radius, deg: -def.angle! }] });
      }
      return r;
    }
    case "turnout":
      return (def.routes ?? []).map((rd) => ({
        from: rd.from ? { x: rd.from[0], y: rd.from[1], h: rd.from[2] * DEG } : o,
        segs: rd.segs.map(segFromDef),
      }));
  }
}

export function routeEnd(r: Route): Pose {
  let p = r.from;
  for (const s of r.segs) p = walk(p, s);
  return p;
}

export function routeLength(r: Route): number {
  return r.segs.reduce((a, s) => a + segLength(s), 0);
}

/** Collect distinct endpoints of a set of routes. */
export function endsOf(routes: Route[]): EndDef[] {
  const ends: EndDef[] = [];
  const pushEnd = (e: EndDef) => {
    if (ends.some((o) => dist(o, e) < 0.05 && Math.abs(normAngle(o.h - e.h)) < 0.01)) return;
    ends.push(e);
  };
  routes.forEach((r, i) => {
    pushEnd({ x: r.from.x, y: r.from.y, h: normAngle(r.from.h + Math.PI), route: i, atStart: true });
    const e = routeEnd(r);
    pushEnd({ x: e.x, y: e.y, h: normAngle(e.h), route: i, atStart: false });
  });
  return ends;
}

export function buildPart(lib: LibraryDef, def: PartDef): Part {
  const routes = routesOf(def);
  return {
    lib, def, key: `${lib.id}/${def.id}`,
    routes,
    ends: endsOf(routes),
    rigid: def.type === "turnout" || def.type === "crossing",
    length: routeLength(routes[0]),
  };
}

export const LIBRARIES: LibraryDef[] = [
  peco as LibraryDef, streamline as LibraryDef, hornby as LibraryDef, piko as LibraryDef, pikoRoadbed as LibraryDef,
  maerklinC as LibraryDef, kato as LibraryDef,
];

const partIndex = new Map<string, Part>();
export function registerLibrary(lib: LibraryDef) {
  for (const d of lib.parts) partIndex.set(`${lib.id}/${d.id}`, buildPart(lib, d));
}
for (const l of LIBRARIES) registerLibrary(l);

export function getPart(key: string): Part | undefined { return partIndex.get(key); }
export function getLibrary(id: string): LibraryDef | undefined { return LIBRARIES.find((l) => l.id === id); }

/** Human summary of a part's geometry, e.g. "R 438 mm · 22.5°" or "168 mm". */
export function partGeometryLabel(def: PartDef): string {
  const n = (x: number) => (Math.round(x * 100) / 100).toString();
  switch (def.type) {
    case "straight": return `${n(def.length!)} mm`;
    case "curve": return `R${n(def.radius!)} · ${n(def.angle!)}°`;
    case "crossing": return `${n(def.length!)} mm · ${n(def.angle!)}°`;
    case "flex": return `${n(def.maxLength!)} mm · min R${n(def.minRadius!)}`;
    case "turnout": {
      const div = def.routes?.flatMap((r) => r.segs).find((s) => "radius" in s) as { radius: number; angle: number } | undefined;
      return div ? `R${n(div.radius)} · ${n(Math.abs(div.angle))}°` : "turnout";
    }
  }
}

/** Validate a library definition. Returns a list of problems (empty when fine). */
export function validateLibrary(lib: LibraryDef): string[] {
  const errs: string[] = [];
  const pos = (x: unknown) => typeof x === "number" && isFinite(x) && x > 0;
  if (lib.format !== 1) errs.push(`${lib.id}: format must be 1`);
  for (const k of ["id", "name", "producer", "system", "scale"] as const) if (!lib[k]) errs.push(`${lib.id ?? "?"}: missing ${k}`);
  if (!pos(lib.gauge)) errs.push(`${lib.id}: gauge must be a positive number`);
  if (!lib.sources?.length) errs.push(`${lib.id}: list at least one source for the geometry`);
  const ids = new Set<string>();
  for (const p of lib.parts ?? []) {
    const tag = `${lib.id}/${p.id}`;
    if (!p.id) errs.push(`${lib.id}: a part has no id`);
    if (ids.has(p.id)) errs.push(`${tag}: duplicate id`);
    ids.add(p.id);
    if (!p.name) errs.push(`${tag}: missing name`);
    switch (p.type) {
      case "straight": if (!pos(p.length)) errs.push(`${tag}: straight needs length > 0`); break;
      case "curve":
        if (!pos(p.radius)) errs.push(`${tag}: curve needs radius > 0`);
        if (!pos(p.angle) || p.angle! >= 360) errs.push(`${tag}: curve angle must be between 0 and 360 (curves are defined turning left)`);
        break;
      case "crossing":
        if (!pos(p.length)) errs.push(`${tag}: crossing needs length > 0`);
        if (!pos(p.angle) || p.angle! >= 90) errs.push(`${tag}: crossing angle must be between 0 and 90`);
        if (p.slip && !pos(p.slip.radius)) errs.push(`${tag}: slip radius must be > 0`);
        if (p.slip) {
          const r = routesOf(p);
          const a = routeEnd(r[2]), b = routeEnd(r[1]);
          if (dist(a, b) > 0.5) errs.push(`${tag}: slip route ends ${dist(a, b).toFixed(2)} mm away from the crossing leg`);
        }
        break;
      case "flex":
        if (!pos(p.maxLength)) errs.push(`${tag}: flex needs maxLength > 0`);
        if (!pos(p.minRadius)) errs.push(`${tag}: flex needs minRadius > 0`);
        break;
      case "turnout":
        if (!p.routes || p.routes.length < 2) errs.push(`${tag}: turnout needs at least 2 routes`);
        for (const r of p.routes ?? []) for (const s of r.segs) {
          if ("straight" in s ? !pos(s.straight) : !pos(s.radius) || !s.angle) errs.push(`${tag}: bad segment ${JSON.stringify(s)}`);
        }
        break;
      default: errs.push(`${tag}: unknown type "${(p as PartDef).type}"`);
    }
  }
  return errs;
}
