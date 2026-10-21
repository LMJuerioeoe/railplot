// Example shunting layouts on the laser-cut baseboard modules: ready-to-open plans that show how the
// modules, their track positions and the ready-made yards fit together. Each is built for the chosen
// track system, and grows by a board when that system's points need more room.
import { Pose, dist, walk } from "./geom";
import { getLibrary } from "./library";
import { Board, Item, Project, allModuleEnds, analyze, appendModule, boardGuides, createFlex, geom, motorsOverFrame, newProject, trackPorts } from "./model";
import { endsTouch } from "./modules";
import { parseProject, serialize } from "./io";
import { trackOffBoards } from "./checks";
import { buildYard, minYardLength, wagonLength, yardParts } from "./yards";

export interface ExampleLayout {
  id: string;
  name: string;
  boards: string;     // in words, for the list
  baseBoards: number; // how many boards that is (more when the track system's points need room)
  blurb: string;
  build(libId: string): Project;
}

/**
 * Where track crosses the joint between two modules, facing into `into`: the middle one, or with two or more
 * tracks the "outer" one (on the outside of a later left turn: the right of the direction of travel).
 */
function jointPort(p: Project, from: Board, into: Board, which: "middle" | "outer" = "middle"): Pose {
  const all = allModuleEnds(p);
  const e = all.find((x) => x.board === into.id && all.some((y) => y.board === from.id && endsTouch(x, y)));
  if (!e) throw new Error("Those modules don't meet.");
  const qs = trackPorts(p).filter((t) => t.board === into.id && dist(t, e) < e.width / 2 + 1);
  // how far to the right of the direction into the board
  const hin = e.h + Math.PI;
  const right = (t: { x: number; y: number }) => (t.x - e.x) * Math.sin(hin) - (t.y - e.y) * Math.cos(hin);
  const q = which === "middle" ? qs.sort((a, b) => dist(a, e) - dist(b, e))[0] : qs.sort((a, b) => right(b) - right(a))[0];
  return { x: q.x, y: q.y, h: q.h };
}

/** Lay flexible track along the guide on board `b` that starts or ends at `at`; returns the other end. */
function followGuide(p: Project, b: Board, at: { x: number; y: number }, flex: string): { x: number; y: number } {
  for (const g of boardGuides(p, b.id)) {
    let end: Pose = g.from;
    for (const s of g.segs) end = walk(end, s);
    if (dist(g.from, at) < 1) { createFlex(p, flex, { ...g.from, z: 0 }, g.segs); return end; }
    if (dist(end, at) < 1) { createFlex(p, flex, { ...g.from, z: 0 }, g.segs); return g.from; }
  }
  throw new Error("No guide there.");
}

/** Where track crosses a module's face that has no neighbour, facing into it (the face nearest `near`). */
function endPort(p: Project, b: Board, near: { x: number; y: number }): Pose {
  const all = allModuleEnds(p);
  const free = all.filter((x) => x.board === b.id && !all.some((y) => y.board !== b.id && endsTouch(x, y)));
  const e = free.sort((a, c) => dist(a, near) - dist(c, near))[0];
  const q = trackPorts(p).filter((t) => t.board === b.id && dist(t, e) < e.width / 2 + 1).sort((a, c) => dist(a, e) - dist(c, e))[0];
  return { x: q.x, y: q.y, h: q.h };
}

/** Does all the track lie on the boards, at least `margin` mm in from their edges? */
export function trackFits(p: Project, margin = 20): boolean {
  return trackOffBoards(p, margin, true).length === 0;
}

function modules(p: Project, ids: string[], tracks = 1): Board[] {
  return ids.map((id) => { const b = appendModule(p, id); b.module!.tracks = tracks; return b; });
}

/** The free end of the track furthest along from `start`. */
function farEnd(p: Project, items: Item[], start: Pose): Pose {
  const mine = new Set(items.map((i) => i.id));
  const ends = analyze(p).free.filter((e) => mine.has(e.item));
  const along = (q: { x: number; y: number }) => (q.x - start.x) * Math.cos(start.h) + (q.y - start.y) * Math.sin(start.h);
  const e = ends.sort((a, b) => along(b) - along(a))[0];
  return { x: e.x, y: e.y, h: e.h };
}

/**
 * Try plans with extra boards (at the start and at the end) and a lead-in before each yard, fewest boards
 * first, until the track fits on the boards with no point motor over a frame member. Points right at a
 * baseboard joint or over a cross member are awkward to fit motors to, so the lead-in moves them along.
 */
function search(build: (extraStart: number, extraEnd: number, leadA: number, leadB: number) => Project, twoLeads = false): Project {
  let best = null as { p: Project; motors: number } | null;
  const leads = Array.from({ length: 21 }, (_, i) => i * 20);
  for (let total = 0; total < 4; total++) {
    for (let a = total; a >= 0; a--) for (const la of leads) for (const lb of twoLeads ? leads : [0]) {
      const p = build(a, total - a, la, lb);
      // the motor check is quick; only plans that would be an improvement get the slower fit check
      const motors = motorsOverFrame(p).length;
      if (best && motors >= best.motors) continue;
      if (!trackFits(p)) continue;
      if (!motors) return p;
      best = { p, motors };
    }
    if (best) return best.p;
  }
  return build(3, 0, 0, 0);
}

/** A short lead of flexible track from `start`; returns where the yard begins. */
function leadIn(p: Project, libId: string, start: Pose, lead: number): Pose {
  if (lead < 1) return start;
  const k = yardParts(libId)!;
  createFlex(p, k.flex, { ...start, z: 0 }, [{ kind: "s", len: lead }]);
  return { x: start.x + Math.cos(start.h) * lead, y: start.y + Math.sin(start.h) * lead, h: start.h };
}

export const EXAMPLES: ExampleLayout[] = [
  {
    id: "inglenook-shelf",
    name: "Inglenook on a shelf",
    boards: "One 1200 × 400 board", baseBoards: 1,
    blurb: "The classic shunting puzzle on a single shelf board: a headshunt for the engine and three wagons, and sidings for five, three and three. Room for a goods shed or a factory beside the sidings.",
    build: (libId) => search((extra, _e, lead) => {
      const p = newProject("Inglenook on a shelf");
      const bs = modules(p, ["std-1200x400", ...Array(extra).fill("std-1200x400")]);
      const start = endPort(p, bs[0], { x: -1e6, y: 0 });
      // move the points along by changing the headshunt a little (up to 60 mm shorter), so the motors clear the frame
      const w = wagonLength(libId);
      buildYard(p, libId, { kind: "inglenook", roads: 3, side: 1, length: 0, wagon: w, headshunt: Math.round(4.6 * w + 40) - 60 + lead }, start);
      return p;
    }),
  },
  {
    id: "traverser-plank",
    name: "Shunting plank with a traverser",
    boards: "900 × 400 traverser and two 1200 × 400 boards", baseBoards: 3,
    blurb: "Trains arrive from the traverser fiddle yard, the engine runs round in the loop, and the wagons go into three goods sidings. The traverser's deck takes a train on each of its roads.",
    build: (libId) => search((extra, _e, lead) => {
      const p = newProject("Shunting plank with a traverser");
      const bs = modules(p, ["traverser-900x400", "std-1200x400", "std-1200x400", ...Array(extra).fill("std-1200x400")]);
      const port = jointPort(p, bs[0], bs[1]);
      const start = leadIn(p, libId, port, lead);
      const loop = minYardLength({ kind: "runround", roads: 2 }, libId) + 150;
      const rr = buildYard(p, libId, { kind: "runround", roads: 2, side: 1, length: loop, wagon: 80, headshunt: 120 }, start);
      const from = farEnd(p, rr.items, start);
      const room = (bs.length - 1) * 1200 - lead - 120 - loop - 120 - 30;
      buildYard(p, libId, { kind: "fiddle", roads: 3, side: -1, length: room, wagon: 80, headshunt: 0 }, from);
      return p;
    }),
  },
  {
    id: "l-shaped",
    name: "L-shaped: fiddle yard to Inglenook",
    boards: "Three 1200 × 600 boards and two 45° corners", baseBoards: 5,
    blurb: "A three-road fiddle yard on the first board, a line round the corner, and the Inglenook sidings on the last board. The line round the corner follows the corners' engraved centre arc.",
    build: (libId) => search((extra, extraEnd, lead, leadB) => {
      const p = newProject("L-shaped: fiddle yard to Inglenook");
      const ids = ["std-1200x600", ...Array(extra).fill("std-1200x600"), "std-1200x600", "corner45-600", "corner45-600", "std-1200x600", ...Array(extraEnd).fill("std-1200x600")];
      // two track positions, 200 mm in from each edge: the line runs on one of them, clear of the spine
      const bs = modules(p, ids, 2);
      const fyBoards = 1 + extra;
      // the fiddle yard faces the rest of the layout: build it from the joint, heading back into the first boards
      // the line runs on the right-hand track position; the fiddle yard is built from it, back into the first boards,
      // with its roads towards the middle of the board
      const line = jointPort(p, bs[fyBoards - 1], bs[fyBoards], "outer");
      const back = trackPorts(p).find((t) => t.board === bs[fyBoards - 1].id && dist(t, line) < 1)!;
      const fyStart = leadIn(p, libId, { x: back.x, y: back.y, h: back.h }, lead);
      buildYard(p, libId, { kind: "fiddle", roads: 3, side: -1, length: fyBoards * 1200 - 40 - lead, wagon: 80, headshunt: 0 }, fyStart);
      const k = yardParts(libId)!;
      // the plain board and the corners: flexible track along one guide each, from the fiddle yard's track position
      let at: { x: number; y: number } = line;
      for (const b of bs.slice(fyBoards, fyBoards + 3)) at = followGuide(p, b, at, k.flex);
      const first = bs[fyBoards + 3];
      const into = trackPorts(p).find((t) => t.board === first.id && dist(t, at) < 1)!;
      // the headshunt runs on from the line; shortening it a little (up to 60 mm) moves the points clear of the frame
      const w = wagonLength(libId);
      buildYard(p, libId, { kind: "inglenook", roads: 3, side: 1, length: 0, wagon: w, headshunt: Math.round(4.6 * w + 40) - 60 + leadB }, { x: into.x, y: into.y, h: into.h });
      return p;
    }, true),
  },
];

const built = new Map<string, string>();

/** An example in a track system: worked out once (finding a fit takes a moment), then copied. */
export function buildExample(id: string, libId: string): Project {
  const ex = EXAMPLES.find((e) => e.id === id);
  if (!ex) throw new Error("No such example.");
  const key = `${id}|${libId}`;
  let text = built.get(key);
  if (!text) {
    const p = ex.build(libId);
    p.name = `${ex.name} (${getLibrary(libId)?.name ?? libId})`;
    text = serialize(p);
    built.set(key, text);
  }
  return parseProject(text);
}
