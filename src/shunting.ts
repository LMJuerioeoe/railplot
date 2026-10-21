// Shunting sessions: deal a random starting position and a train to make up, for the Inglenook sidings
// or any plan's sidings, so an operating session has a puzzle to solve.
import { Project } from "./model";
import { roads } from "./trainfit";

export interface Wagon { name: string; color: string }

/** Eight wagons, as the classic Inglenook uses. */
export const DEFAULT_WAGONS: Wagon[] = [
  { name: "Coal wagon", color: "#4a4440" }, { name: "Box van", color: "#8a5a3c" }, { name: "Tank wagon", color: "#2f4f6f" },
  { name: "Open wagon", color: "#6f7b3a" }, { name: "Bolster wagon", color: "#7a6a4a" }, { name: "Cattle wagon", color: "#9a3b2e" },
  { name: "Hopper", color: "#5a5f66" }, { name: "Fish van", color: "#c8c0a8" },
];

/** A small repeatable random generator, so a card set can be dealt again from its number. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function shuffle<T>(a: T[], r: () => number): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export interface Siding { name: string; capacity: number }

/** The Inglenook: sidings for five, three and three wagons, and a headshunt for the engine and three. */
export const INGLENOOK: Siding[] = [{ name: "Siding 1", capacity: 5 }, { name: "Siding 2", capacity: 3 }, { name: "Siding 3", capacity: 3 }];

export interface Deal {
  seed: number;
  /** The wagons in each siding at the start, from the buffer stop end towards the points. */
  start: number[][];
  /** The train to make up, from the engine back. */
  train: number[];
  /** Which siding the train is made up in. */
  into: number;
}

/**
 * Deal a session: every wagon placed at random in the sidings (no siding overfilled), and a train of
 * `trainLength` of them, in a random order, to be made up in the longest siding.
 */
export function deal(wagons: number, sidings: Siding[], trainLength: number, seed: number): Deal {
  const room = sidings.reduce((a, s) => a + s.capacity, 0);
  if (wagons > room) throw new Error(`${wagons} wagons don't fit in sidings for ${room}.`);
  const into = sidings.reduce((best, s, i) => (s.capacity > sidings[best].capacity ? i : best), 0);
  const n = Math.min(trainLength, sidings[into].capacity, wagons);
  const r = rng(seed);
  const order = shuffle([...Array(wagons).keys()], r);
  const start: number[][] = sidings.map(() => []);
  for (const w of order) {
    // a random siding with room left
    const open = sidings.map((s, i) => i).filter((i) => start[i].length < sidings[i].capacity);
    start[open[Math.floor(r() * open.length)]].push(w);
  }
  const train = shuffle([...Array(wagons).keys()], r).slice(0, n);
  return { seed, start, train, into };
}

/** Sidings on the plan and how many wagons each holds, longest first. */
export function planSidings(p: Project, wagon: number): Siding[] {
  return roads(p).filter((r) => r.kind === "siding" && !r.headshunt).sort((a, b) => b.length - a.length)
    .map((r, i) => ({ name: `Siding ${i + 1} (${r.items[0]})`, capacity: Math.floor((r.length - 20) / wagon) }))
    .filter((s) => s.capacity > 0);
}
