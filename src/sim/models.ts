// The rolling stock catalogue: classic British locomotives, coaches and wagons, drawn from their
// prototypes' dimensions at OO scale (1:76.2) and, where the owner has the model, from the maker's
// published sizes. The drawing is in steam.ts, diesels.ts, coaches.ts and wagons.ts.
import { VehicleCfg, VehicleKind } from "../control/types";
import { BLACK, BRASS, COPPER, Label, RED_BEAM, RGB, Shapes, WHITE, boundsOf } from "./parts";
import { drawSteam, drawTender, SteamSpec, TenderSpec } from "./steam";
import { drawClass08, drawClass37 } from "./diesels";
import { CoachSpec, drawCoach } from "./coaches";
import { drawBRBrakeVan, drawMineral, drawPlankOpen, drawTankWagon, drawToad, drawVan } from "./wagons";

export type { RGB, Shapes };
export { boundsOf };

/** A decal on a model: along a side (axis "y", at y = ±face) or on an end (axis "x", at x = face). */
export interface Mark { axis: "x" | "y"; face: number; u: [number, number]; z: [number, number]; label: Label; side?: 1 | -1 }

export type ModelGroup = "steam" | "diesel" | "tender" | "coach" | "wagon";

export interface Model {
  id: string;
  /** Who makes the model it's drawn from, when it's one the owner has; empty for a prototype-only model. */
  maker: string;
  name: string;
  group: ModelGroup;
  /** What it is, for the simulator: a loco drives, a brake van is a brake van. */
  kind: VehicleKind;
  /** Over buffers, across the widest part, rail to the highest point (mm). */
  length: number;
  width: number;
  height: number;
  /** Livery colour, for the Trains dialog. */
  color: string;
  note: string;
  /** Lettering, numbers, plates and emblems, painted on as decals. */
  marks?: Mark[];
  /** A tender engine's tender: added behind it. */
  tender?: string;
  draw(s: Shapes): void;
}

// ---------- liveries ----------
const GWR_GREEN: RGB = [0.14, 0.29, 0.18], GWR_LINING: [RGB, RGB] = [[0.86, 0.5, 0.14], BLACK];
const LNER_GREEN: RGB = [0.25, 0.45, 0.19];
const GOLD: RGB = [0.86, 0.71, 0.36];
const MAROON: RGB = [0.36, 0.08, 0.1], CARMINE: RGB = [0.55, 0.12, 0.14], CREAM: RGB = [0.87, 0.79, 0.6];
const CHOCOLATE: RGB = [0.29, 0.17, 0.12], GWR_CREAM: RGB = [0.89, 0.81, 0.63], CRIMSON: RGB = [0.45, 0.09, 0.1];
const ALUMINIUM: RGB = [0.72, 0.73, 0.74];
const VAN_BROWN: RGB = [0.37, 0.23, 0.16], GWR_BROWN: RGB = [0.3, 0.19, 0.14], BAUXITE: RGB = [0.48, 0.26, 0.15];
const BR_GREY: RGB = [0.53, 0.56, 0.53], MINERAL_GREY: RGB = [0.5, 0.5, 0.48], PO_RED: RGB = [0.5, 0.16, 0.11];
const GWR_LIVERY = { body: GWR_GREEN, lining: GWR_LINING, smokebox: BLACK, frames: BLACK, wheels: GWR_GREEN, beams: RED_BEAM, bonnet: BRASS, roof: BLACK };


// ---------- markings ----------
const side = (face: number, x0: number, x1: number, z0: number, z1: number, label: Label, only?: 1 | -1): Mark => ({ axis: "y", face, u: [x0, x1], z: [z0, z1], label, side: only });
const ends = (face: number, y0: number, y1: number, z0: number, z1: number, label: Label): Mark[] => [
  { axis: "x", face, u: [y0, y1], z: [z0, z1], label }, { axis: "x", face: -face, u: [y0, y1], z: [z0, z1], label }];
const front = (face: number, y0: number, y1: number, z0: number, z1: number, label: Label): Mark => ({ axis: "x", face, u: [y0, y1], z: [z0, z1], label });
const gwrPlate = (text: string): Label => ({ text, bg: "#141414", color: "#dcb860", border: "#dcb860", font: "serif", radius: 0.5 });
const smokeboxPlate = (text: string): Label => ({ text, bg: "#111", color: "#e9e6dc", border: "#cfcac0", font: "sans", radius: 0.3 });
const GOLD_SHADED = (text: string): Label => ({ text, color: "#e3bd5c", shadow: "#7e1f12", font: "sans" });
const CREAM_T = (text: string): Label => ({ text, color: "#efe7cc", font: "sans" });
const WHITE_T = (text: string, font: Label["font"] = "sans"): Label => ({ text, color: "#f2f2ee", font });
const DATA = (text: string, color = "#f2f2ee"): Label => ({ text, color, font: "condensed", bold: false });

const steam = (spec: SteamSpec) => (s: Shapes) => drawSteam(s, spec);
const tender = (spec: TenderSpec) => (s: Shapes) => drawTender(s, spec);
const coach = (spec: CoachSpec) => (s: Shapes) => drawCoach(s, spec);

export const MODELS: Model[] = [
  // ---------- steam ----------
  {
    id: "dapol-51xx", maker: "Dapol", name: "GWR 51xx Large Prairie 2-6-2T", group: "steam", kind: "loco",
    length: 164, width: 34, height: 51, color: "#1a4024",
    note: "Dapol 4S-041-010: 5134 in GWR green with the shirt-button roundel; traced from Dapol's side view, 164 mm over buffers",
    marks: [
      side(16.65, -67.7, -59.7, 29.1, 32.3, gwrPlate("5134")), side(16.95, -23.8, -19.8, 29.5, 33.5, { logo: "gwr-roundel" }),
      ...ends(76.5, -6.5, 6.5, 11.6, 13.4, { text: "5134", color: "#e3bd5c", font: "serif" }),
    ],
    draw: steam({
      length: 164, width: 34, height: 51,
      plate: { z: 20.8, half: 16.8, x0: -76, x1: 76, drop: { x: 57.8, z: 15.6, run: 1.5 }, beam: 16.3 },
      wheels: [{ x: 63.3, r: 6.5 }, { x: 30.5, r: 10.7, driven: true }, { x: 1.5, r: 10.7, driven: true }, { x: -28.9, r: 10.7, driven: true }, { x: -61.3, r: 7 }],
      cylinders: { x0: 42.5, x1: 57.8, z: 10.9, r: 4.4, outside: true, y: 12.3, block: true }, mainDriver: 1,
      boiler: { x0: -4.6, x1: 41.2, z: 32.2, rBack: 8.6, rFront: 8 },
      smokebox: { x0: 41.2, x1: 62, r: 8.2 },
      firebox: { x0: -29, x1: -4.6, top: 43.3, half: 9, belpaire: true },
      chimney: { x: 49, top: 48.3, r: 2.45 },
      safety: { x: 4, kind: "bonnet", top: 48.7 },
      cab: { x0: -62.2, x1: -29.1, eave: 46.9, rise: 3.9, half: 16.6, window: "round", back: "bunker", sill: 35.3, opening: [-57.9, -40.1] },
      tanks: { kind: "side", x0: -29.1, x1: 27.5, top: 39.8, topFront: 38.3, inner: 9.5 },
      bunker: { x0: -78, top: 40.1 },
      livery: { ...GWR_LIVERY, lining: undefined, bonnet: GWR_GREEN, wheels: BLACK, roof: [0.2, 0.2, 0.21], numberPlate: BRASS },
    }),
  },
  {
    id: "gwr-57xx", maker: "", name: "GWR 57xx pannier tank 0-6-0PT", group: "steam", kind: "loco",
    length: 125, width: 34, height: 49, color: "#1a4024",
    note: "The Great Western's everywhere shunter and branch engine: 31 ft 2 in over buffers, 4 ft 7½ in wheels, copper-capped chimney; traced from Accurascale's side view",
    marks: [
      side(16.65, -46, -38, 21.5, 24.5, gwrPlate("5764")), side(16.75, 10.5, 17.5, 27, 34, { logo: "gwr-roundel" }),
    ],
    draw: steam({
      length: 125, width: 34, height: 49,
      plate: { z: 15, half: 16.6, x0: -56, x1: 56 },
      wheels: [{ x: 33, r: 8.8, driven: true }, { x: 3.9, r: 8.8, driven: true }, { x: -28.9, r: 8.8, driven: true }],
      cylinders: { x0: 38, x1: 52, z: 11, r: 4, outside: false },
      boiler: { x0: -5.3, x1: 38, z: 28.5, rBack: 9, rFront: 9 },
      smokebox: { x0: 38, x1: 51.5, r: 9.2 },
      firebox: { x0: -24, x1: -5.3, top: 38.2, half: 7.4, belpaire: true },
      chimney: { x: 43, top: 48, r: 2.4 },
      dome: { x: 9.8, r: 4.8, top: 48 },
      safety: { x: -14.8, kind: "bonnet", top: 44.5 },
      cab: { x0: -47.8, x1: -24.2, eave: 44, rise: 1, half: 16.6, window: "round", back: "bunker", sill: 30, opening: [-47.2, -31.3] },
      tanks: { kind: "pannier", x0: -24.2, x1: 51.3, top: 37, inner: 7.4, bottom: 23.3 },
      bunker: { x0: -60, top: 37 },
      livery: { body: GWR_GREEN, smokebox: BLACK, frames: BLACK, wheels: GWR_GREEN, beams: RED_BEAM, bonnet: BRASS, cap: COPPER, roof: BLACK, numberPlate: BRASS },
    }),
  },
  {
    id: "lms-jinty", maker: "", name: "LMS 3F 'Jinty' 0-6-0T", group: "steam", kind: "loco",
    length: 125, width: 34, height: 51, color: "#16181a",
    note: "The LMS standard shunting tank in BR plain black with the early crest: 31 ft 4½ in over buffers, 4 ft 7 in wheels; traced from Bachmann's side view",
    marks: [
      side(16.85, -54.5, -43.5, 21.8, 25.6, CREAM_T("47383")), side(16.95, -12.5, -1.5, 22, 27.5, { logo: "br-crest-early" }),
      front(50.75, -3.4, 3.4, 33.6, 35.6, smokeboxPlate("47383")),
    ],
    draw: steam({
      length: 125, width: 34, height: 51,
      plate: { z: 14.9, half: 16.6, x0: -56, x1: 56 },
      wheels: [{ x: 35.1, r: 9, driven: true }, { x: 1.6, r: 9, driven: true }, { x: -31.1, r: 9, driven: true }],
      cylinders: { x0: 38, x1: 50, z: 11, r: 4, outside: false },
      boiler: { x0: -5.1, x1: 35.5, z: 28, rBack: 9.2, rFront: 9.2 },
      smokebox: { x0: 35.5, x1: 50.1, r: 9.6 },
      firebox: { x0: -24.4, x1: -5.1, top: 38.4, half: 10, belpaire: true },
      chimney: { x: 41.2, top: 48.7, r: 2.4, tall: true },
      dome: { x: 13.4, r: 3.9, top: 45.7 },
      safety: { x: -15.5, kind: "ramsbottom" },
      cab: { x0: -48.9, x1: -24.4, eave: 46.6, rise: 1, half: 16.8, window: "round", back: "bunker", sill: 32.3, opening: [-42.6, -30.7] },
      tanks: { kind: "side", x0: -24.4, x1: 22.3, top: 32.3, inner: 10.8 },
      bunker: { x0: -58.2, top: 32.3 },
      splashers: true,
      livery: { body: BLACK, smokebox: BLACK, frames: BLACK, wheels: BLACK, beams: RED_BEAM, roof: BLACK, numbers: { col: WHITE, x0: -32, x1: -19, z: 28 } },
    }),
  },
  {
    id: "gwr-castle", maker: "", name: "GWR Castle class 4-6-0", group: "steam", kind: "loco", tender: "gwr-collett-tender",
    length: 158, width: 35, height: 53, color: "#1a4024",
    note: "Collett's express engine in lined GWR green: 6 ft 8½ in drivers under brass-beaded splashers, copper-capped chimney, four cylinders; traced from Hornby's side view",
    marks: [
      side(17.25, -71, -63.2, 27.4, 30, gwrPlate("4073")), side(10.05, -30, -6.5, 27, 30.4, gwrPlate("CAERPHILLY CASTLE")),
      ...ends(73.5, -6.5, 6.5, 16.2, 18.6, { text: "4073", color: "#e3bd5c", font: "serif" }),
    ],
    draw: steam({
      length: 158, width: 35, height: 53,
      plate: { z: 21.1, half: 17.2, x0: -79, x1: 74, drop: { x: 63.4, z: 16.5, run: 6 }, beam: 16.5 },
      wheels: [{ x: 57, r: 6.2 }, { x: 30.8, r: 6.2 }, { x: 9.3, r: 13, driven: true }, { x: -18.2, r: 13, driven: true }, { x: -47.6, r: 13, driven: true }],
      cylinders: { x0: 24.9, x1: 36.8, z: 15, r: 4.6, outside: true, y: 12.6, block: true }, mainDriver: 1,
      boiler: { x0: -23.3, x1: 35, z: 34.4, rBack: 11.5, rFront: 10.1 },
      smokebox: { x0: 35, x1: 58.4, r: 10.3 },
      firebox: { x0: -55.9, x1: -23.3, top: 47.2, half: 12.5, belpaire: true },
      chimney: { x: 41, top: 50.9, r: 3 },
      safety: { x: -4.5, kind: "bonnet", top: 50 },
      topFeed: { x: 3 },
      cab: { x0: -79, x1: -55.9, eave: 49.5, rise: 1.2, half: 17.2, window: "round", back: "open", sill: 34, opening: [-77.9, -70.6] },
      splashers: true,
      livery: { ...GWR_LIVERY, cap: COPPER, beading: BRASS, numberPlate: BRASS, bands: [0.86, 0.5, 0.14] },
    }),
  },
  {
    id: "gwr-collett-tender", maker: "", name: "GWR Collett 4,000 gallon tender", group: "tender", kind: "tender",
    length: 98, width: 34, height: 46, color: "#1a4024",
    note: "The Castle's tender, with the shirt-button roundel; traced from Hornby's side view",
    marks: [side(16.85, -5.5, 5.5, 27, 38, { logo: "gwr-roundel" })],
    draw: tender({
      length: 98, width: 34, height: 46, wheels: [30.1, 0, -29.3], r: 8.2,
      body: { x0: -42.3, x1: 41.3, z0: 16.5, top: 43, step: { x: -32.4, top: 39.5 }, coal: 43 }, outsideFrames: true,
      livery: { body: GWR_GREEN, frames: BLACK, beams: RED_BEAM, lining: GWR_LINING },
    }),
  },
  {
    id: "lner-a3", maker: "", name: "LNER A3 Pacific 4-6-2", group: "steam", kind: "loco", tender: "lner-gn-tender",
    length: 172, width: 36, height: 52.5, color: "#548f3d",
    note: "Gresley's express Pacific in LNER apple green, lined black and white, as 4472 in the 1930s: three cylinders, 6 ft 8 in drivers; traced from Hornby's side view of 4472",
    marks: [
      side(17.65, -82.5, -65, 25.4, 29.5, GOLD_SHADED("4472")),
      ...ends(80.5, -6.5, 6.5, 16.8, 19.2, { text: "4472", color: "#e3bd5c", font: "sans" }),
    ],
    draw: steam({
      length: 172, width: 36, height: 52.5,
      plate: { z: 24.5, half: 17.8, x0: -86, x1: 80, drop: { x: 37.5, z: 19, run: 35 }, beam: 18 },
      wheels: [{ x: 69.8, r: 5.8 }, { x: 47.2, r: 5.8 }, { x: 25.5, r: 12.9, driven: true }, { x: -2.6, r: 12.9, driven: true }, { x: -30.8, r: 12.9, driven: true }, { x: -69.6, r: 7.2 }],
      cylinders: { x0: 52.3, x1: 61.5, z: 15.7, r: 5.1, outside: true, y: 12.6 }, mainDriver: 1,
      boiler: { x0: -50.3, x1: 42.1, z: 37.4, rBack: 12.2, rFront: 11.7 },
      smokebox: { x0: 42.1, x1: 66.1, r: 11.8 },
      firebox: { x0: -62.7, x1: -50.3, top: 49.4, half: 13, belpaire: false },
      chimney: { x: 51, top: 52, r: 3 },
      dome: { x: 3.1, r: 4.8, top: 51.4 },
      safety: { x: -57, kind: "pop" },
      cab: { x0: -86, x1: -62.7, eave: 48.6, rise: 1.3, half: 17.6, window: "square", back: "open", sill: 33.7, opening: [-80.2, -65.4], openTop: 42, z0: 13.9 },
      splashers: true,
      livery: { body: LNER_GREEN, lining: [BLACK, WHITE], bands: [0.92, 0.92, 0.9], smokebox: BLACK, frames: BLACK, wheels: LNER_GREEN, beams: RED_BEAM, roof: [0.25, 0.42, 0.18], numbers: { col: GOLD, x0: -52, x1: -36, z: 27 } },
    }),
  },
  {
    id: "lner-gn-tender", maker: "", name: "LNER eight-wheeled tender", group: "tender", kind: "tender",
    length: 108, width: 36, height: 46, color: "#548f3d",
    note: "The A3's tender, with coal rails and LNER lettering; traced from Hornby's side view",
    marks: [side(17.85, -34, 26, 24.9, 28.9, GOLD_SHADED("L N E R"))],
    draw: tender({
      length: 108, width: 36, height: 46, wheels: [35.2, 13.2, -9.8, -32.2], r: 7.5,
      body: { x0: -51.8, x1: 47.6, z0: 15.4, top: 42, flare: true, coalRails: true }, outsideFrames: true,
      livery: { body: LNER_GREEN, frames: BLACK, beams: RED_BEAM, lining: [BLACK, WHITE] },
    }),
  },
  {
    id: "lms-black5", maker: "", name: "LMS Stanier 'Black Five' 4-6-0", group: "steam", kind: "loco", tender: "lms-stanier-tender",
    length: 152, width: 35, height: 52, color: "#16181a",
    note: "Stanier's mixed-traffic engine in BR lined black: high running plate, taper boiler, 6 ft drivers, Walschaerts gear; traced from Hornby's side view",
    marks: [
      side(17.25, -69, -57.3, 24.4, 27.6, CREAM_T("45110")),
      front(58.8, -3.6, 3.6, 39, 41, smokeboxPlate("45110")),
    ],
    draw: steam({
      length: 152, width: 35, height: 52,
      plate: { z: 23.4, half: 17.2, x0: -76, x1: 70, drop: { x: 58.2, z: 15.1, run: 7 }, beam: 15.1 },
      wheels: [{ x: 56.7, r: 6.6 }, { x: 32.3, r: 6.6 }, { x: 9.4, r: 12, driven: true }, { x: -18.1, r: 12, driven: true }, { x: -49.6, r: 12, driven: true }],
      cylinders: { x0: 37.9, x1: 49, z: 16, r: 5.2, outside: true, y: 12.2 }, mainDriver: 1,
      boiler: { x0: -21.7, x1: 31.7, z: 35, rBack: 12, rFront: 9 },
      smokebox: { x0: 31.7, x1: 58.2, r: 9.2 },
      firebox: { x0: -52.5, x1: -21.7, top: 47.1, half: 12.4, belpaire: true },
      chimney: { x: 41.4, top: 48.8, r: 2.8 },
      dome: { x: -2.8, r: 3.4, top: 48.8 },
      safety: { x: -41, kind: "pop" },
      cab: { x0: -75, x1: -52.5, eave: 48, rise: 1.2, half: 17.2, window: "square", back: "open", sill: 32.6, opening: [-70.5, -55.7], openTop: 41.5, z0: 17.6 },
      livery: { body: BLACK, lining: [[0.62, 0.12, 0.1], [0.55, 0.55, 0.55]], bands: [0.55, 0.1, 0.08], smokebox: BLACK, frames: BLACK, wheels: BLACK, beams: RED_BEAM, roof: BLACK, numbers: { col: WHITE, x0: -46, x1: -31, z: 32 } },
    }),
  },
  {
    id: "lms-stanier-tender", maker: "", name: "LMS Stanier 4,000 gallon tender", group: "tender", kind: "tender",
    length: 100, width: 35, height: 48, color: "#16181a",
    note: "The Black Five's tender, lined, with the BR crest; traced from Hornby's side view",
    marks: [side(17.35, -6.5, 6.5, 27, 40, { logo: "br-crest-late" })],
    draw: tender({
      length: 100, width: 35, height: 48, wheels: [31, 0, -30], r: 8.2,
      body: { x0: -44.1, x1: 42.1, z0: 17, top: 45.2, step: { x: -28.2, top: 35.7 }, coal: 45.5 }, outsideFrames: true,
      livery: { body: BLACK, frames: BLACK, beams: RED_BEAM, lining: [[0.62, 0.12, 0.1], [0.55, 0.55, 0.55]] },
    }),
  },

  // ---------- diesel ----------
  {
    id: "br-class08", maker: "", name: "BR Class 08 diesel shunter", group: "diesel", kind: "loco",
    length: 117, width: 34, height: 51.5, color: "#1c4d30",
    note: "The 350 hp yard shunter in BR green with wasp-striped ends: jackshaft drive, 4 ft 6 in wheels, 29 ft 3 in over buffers; traced from Hornby's side view",
    marks: [
      side(17.05, -38.5, -30.5, 26.6, 29.8, CREAM_T("D3083")), side(12.65, 8.5, 15.5, 31.5, 37.5, { logo: "br-crest-late" }),
    ],
    draw: drawClass08,
  },
  {
    id: "br-class37", maker: "", name: "BR Class 37 Co-Co diesel", group: "diesel", kind: "loco",
    length: 245, width: 35, height: 52, color: "#2b4d78",
    note: "The English Electric Type 3 in BR blue with full yellow ends and split headcode boxes: 61 ft 6 in over buffers; traced from Bachmann's side view",
    marks: [
      side(17.55, 80, 92, 25.4, 28.8, WHITE_T("37 025")), side(17.55, -92, -80, 25.4, 28.8, WHITE_T("37 025")),
      side(17.55, 44, 56, 22.5, 28.5, { logo: "br-arrow", color: "#f4f4f0" }),
    ],
    draw: drawClass37,
  },

  // ---------- coaches ----------
  {
    id: "br-mk1-sk-maroon", maker: "", name: "BR Mk1 corridor second (SK), maroon", group: "coach", kind: "coach",
    length: 268, width: 37, height: 51, color: "#5c1419",
    note: "64 ft 6 in Mk1 on BR1 bogies, in lined maroon: eight compartments, aluminium window frames; traced from Hornby's side view",
    marks: [
      side(18.55, 113, 125, 21, 23.6, CREAM_T("M25041")), side(18.55, -125, -113, 21, 23.6, CREAM_T("M25041")),
    ],
    draw: coach({
      length: 268, width: 37, height: 51, bodyHalf: 130.5, floor: 16.2, waist: 26, eave: 40.9, rise: 7.5, tumblehome: 1.4,
      bogieCentre: 91.8, bogieWheelbase: 35, wheelR: 7, layout: "D _ W - W - W - W _ D _ W - W - W - W _ T _ D", vents: 10,
      widths: { D: 10, W: 17.5, "-": 8.4, _: 4.2, T: 8 },
      livery: { lower: MAROON, roof: [0.38, 0.38, 0.38], lining: GOLD, frames: ALUMINIUM, ends: BLACK },
    }),
  },
  {
    id: "br-mk1-bsk-cc", maker: "", name: "BR Mk1 corridor brake second (BSK), carmine and cream", group: "coach", kind: "coach",
    length: 268, width: 37, height: 51, color: "#8c1f24",
    note: "The Mk1 brake in 1950s 'blood and custard': four compartments, the guard's van and luggage doors; traced from Bachmann's side view",
    marks: [
      side(18.55, 113, 125, 20.4, 22.6, CREAM_T("E34156")), side(18.55, -125, -113, 20.4, 22.6, CREAM_T("E34156")),
    ],
    draw: coach({
      length: 268, width: 37, height: 51, bodyHalf: 130.5, floor: 16.2, waist: 26, eave: 40.9, rise: 7.5, tumblehome: 1.4,
      bogieCentre: 91.8, bogieWheelbase: 35, wheelR: 7, layout: "= D _ w ~ D ^ w _ D _ D _ W - W - W - W + D", vents: 8,
      widths: { "=": 27.5, D: 9.2, _: 4.4, w: 10, "~": 15, "^": 11.8, W: 18.1, "-": 8.9, "+": 19.4 },
      livery: { lower: CARMINE, upper: CREAM, roof: [0.38, 0.38, 0.38], lining: GOLD, frames: ALUMINIUM, ends: BLACK },
    }),
  },
  {
    id: "gwr-collett-57", maker: "", name: "GWR Collett 57 ft corridor third, chocolate and cream", group: "coach", kind: "coach",
    length: 240, width: 36, height: 50.5, color: "#4a2b1f",
    note: "A 1930s Great Western corridor coach: a door to every compartment, chocolate below and cream above, lined in gold; traced from Hornby's side view",
    marks: [
      side(18.05, -3.2, 3.2, 17, 23.4, { logo: "gwr-roundel" }),
      side(18.05, 98, 106, 25.2, 27.2, GOLD_SHADED("5873")), side(18.05, -106, -98, 25.2, 27.2, GOLD_SHADED("5873")),
    ],
    draw: coach({
      length: 240, width: 36, height: 50.5, bodyHalf: 116.5, floor: 15.3, waist: 27.4, eave: 41.1, rise: 8.3, tumblehome: 1.2,
      bogieCentre: 85.3, bogieWheelbase: 27.9, wheelR: 6.8, layout: "= T + w _ D _ w - w _ D _ w - w _ D _ w - w _ D _ w - w _ D _ w - w _ D _ w - w _ D _ w - w _ D _ w ^ T >", vents: 7, windowRadius: 0.4,
      widths: { "=": 6.8, T: 8, "+": 3.6, w: 6, _: 1.5, D: 8.4, "-": 1, "^": 3.7, ">": 5.5 },
      livery: { lower: CHOCOLATE, upper: GWR_CREAM, roof: [0.7, 0.7, 0.68], lining: GOLD, ends: CHOCOLATE },
    }),
  },
  {
    id: "lms-stanier-57", maker: "", name: "LMS Stanier 57 ft corridor third, crimson lake", group: "coach", kind: "coach",
    length: 242, width: 37, height: 51, color: "#73171a",
    note: "Stanier's flush-sided corridor coach in LMS crimson lake, lined in gold and black; traced from Hornby's side view of 1716",
    marks: [
      side(18.55, -70, -58, 20.6, 22.8, GOLD_SHADED("L M S")),
      side(18.55, 59, 67, 20.6, 22.8, GOLD_SHADED("1716")),
    ],
    draw: coach({
      length: 242, width: 37, height: 51, bodyHalf: 115.5, floor: 15.5, waist: 25.9, eave: 41.5, rise: 8.3, tumblehome: 1.4,
      bogieCentre: 80.5, bogieWheelbase: 36.3, wheelR: 6.8, layout: "= D + W - W - W - W - W - W - W + D =", vents: 8, windowRadius: 1.8,
      widths: { "=": 1.7, D: 8.6, "+": 17.65, W: 17.5, "-": 8.1 },
      livery: { lower: CRIMSON, roof: [0.36, 0.36, 0.36], lining: GOLD, ends: BLACK, frames: [0.62, 0.52, 0.32] },
    }),
  },

  // ---------- wagons ----------
  {
    id: "dapol-10t-van", maker: "Dapol", name: "Ventilated van, GWR type", group: "wagon", kind: "van",
    length: 82, width: 33, height: 48, color: "#5e3a29",
    note: "Dapol 4F-011 / 4F-012: planked ends with vents, diagonal strapping, white roof; traced from Dapol's side view: 82 mm, 10 ft wheelbase",
    marks: [
      side(15.95, -32, -14, 16, 18.6, WHITE_T("W 145872", "condensed")), side(15.95, -32, -23, 19.2, 20.8, DATA("VENT")),
      side(15.95, 22, 32, 16, 18, DATA("T 9-1")),
    ],
    draw: (s) => drawVan(s, { length: 82, width: 33, height: 48, bodyHalf: 35.2, wheelbase: 39.6, top: 44.3, rise: 2.5, body: VAN_BROWN, diagonals: true, braceDown: true, horizontal: true, stanchions: [-23, 23], endVents: true, doors: [0], doorWidth: 22.5, marks: [{ x0: -32, x1: -20, z: 17, chars: 5 }] }),
  },
  {
    id: "lms-vent-van", maker: "", name: "LMS / BR 12 ton ventilated van, bauxite", group: "wagon", kind: "van",
    length: 82, width: 33, height: 48, color: "#7a4226",
    note: "The LMS design BR built in thousands, here with plywood sides: corrugated steel ends, 10 ft wheelbase, BR bauxite; traced from Bachmann's side view",
    marks: [
      side(15.95, 21, 33, 17, 19.6, WHITE_T("B 760134", "condensed")), side(15.95, -33, -24, 21, 24.4, WHITE_T("XP")),
      side(15.95, 25, 29, 20.4, 21.8, DATA("12T")),
    ],
    draw: (s) => drawVan(s, { length: 82, width: 33, height: 48, bodyHalf: 35.7, wheelbase: 39.6, top: 41.6, rise: 3.8, body: BAUXITE, corrugatedEnds: true, endVents: true, plywood: true, diagonals: true, braceDown: true, stanchions: [-23.3, 23.3], doors: [0], doorWidth: 23, marks: [{ x0: -32, x1: -20, z: 17, chars: 6 }] }),
  },
  {
    id: "efe-gwr-fish", maker: "EFE Rail", name: "GWR 10T Bloater fish van", group: "wagon", kind: "van",
    length: 128, width: 32, height: 48, color: "#4d3024",
    note: "EFE Rail E87059: Diagram S9 No. 2603, GWR brown with the shirt-button roundel, three doors a side braced in an inverted V, X-braced panels between, 18 ft wheelbase, shell roof ventilators; 128 mm",
    marks: [
      side(15.45, -54, -46, 18.6, 20.6, CREAM_T("FISH")), side(15.45, -54, -40, 15.8, 18.2, CREAM_T("BLOATER")),
      side(15.45, 45, 49, 18.6, 20.6, CREAM_T("XP")), side(15.45, 44, 54, 15.8, 18.2, CREAM_T("2603")),
      side(15.45, 17, 23, 28.5, 34.5, { logo: "gwr-roundel" }),
    ],
    draw: (s) => drawVan(s, { length: 128, width: 32, height: 48, bodyHalf: 57, wheelbase: 72, top: 40.5, rise: 6, wheelR: 6.5, body: GWR_BROWN, horizontal: true, doorChevron: true, stanchions: [-50, -30, -10, 10, 30, 50], crosses: [{ x: -20, half: 9 }, { x: 20, half: 9 }], doors: [-40, 0, 40], doorWidth: 20, shellVents: [-36, 0, 36], marks: [{ x0: -54, x1: -46, z: 16, chars: 2 }, { x0: 45, x1: 54, z: 16, chars: 4 }] }),
  },
  {
    id: "br-toad", maker: "Oxford Rail", name: "GWR Toad brake van, BR grey", group: "wagon", kind: "brake",
    length: 103, width: 32, height: 51, color: "#888f88",
    note: "Oxford Rail OR76TOB003: W35717 in BR grey, lettered Basingstoke; the early 20 ft-bodied Toad. 103 mm, traced from Oxford Rail's side view",
    marks: [
      side(15.45, -13.2, -1.1, 35.8, 37.6, WHITE_T("BASINGSTOKE")), side(15.45, -12, -3, 31.3, 32.9, DATA("NOT IN")), side(15.45, -13, -2, 29.3, 30.9, DATA("COMMON USE")),
      side(15.45, -11, -3.3, 19.5, 21.7, WHITE_T("W35717", "condensed")), side(15.45, 22.5, 25.5, 19.6, 20.8, DATA("16T")),
    ],
    draw: (s) => drawToad(s, { length: 103, width: 32, body: BR_GREY, roof: [0.8, 0.8, 0.77] }),
  },
  {
    id: "po-7plank", maker: "", name: "7-plank open wagon, private owner, with coal", group: "wagon", kind: "wagon",
    length: 82, width: 31, height: 36.5, color: "#80291c",
    note: "The colliery and coal merchants' wagon of the steam age: 7 planks, side door, a load of coal; traced from Hornby's side view",
    marks: [
      side(15.35, -31, 31, 25.5, 30.5, { text: "J. ASHWORTH & SONS", color: "#f5f1e6", font: "serif" }),
      side(15.15, -33, -26, 15.6, 17.8, DATA("No 47")), side(15.15, 26, 33, 15.6, 17.8, DATA("COAL")),
    ],
    draw: (s) => drawPlankOpen(s, { length: 82, width: 31, body: PO_RED, band: [0.42, 0.13, 0.09], load: true }),
  },
  {
    id: "br-16t-mineral", maker: "", name: "BR 16 ton mineral wagon", group: "wagon", kind: "wagon",
    length: 80, width: 31, height: 37.5, color: "#80807a",
    note: "BR's steel coal wagon, built by the quarter-million: pressed-steel sides, side and top flap doors, loaded; traced from Accurascale's drawing",
    marks: [
      side(15.15, -31, -21, 16.6, 19, WHITE_T("B 87654", "condensed")), side(15.15, -31, -21, 19.8, 22, WHITE_T("COAL 16", "condensed")),
    ],
    draw: (s) => drawMineral(s, { length: 80, width: 31, body: MINERAL_GREY, load: true }),
  },
  {
    id: "tank-14t", maker: "", name: "14 ton tank wagon, black", group: "wagon", kind: "tank",
    length: 85, width: 31, height: 50.5, color: "#1c1c1e",
    note: "A Class B tank wagon for oil: barrel on cradles, dome, ladders and tie rods; traced from Dapol's side view",
    marks: [
      side(14.45, -32, -10, 30, 35, WHITE_T("MINERAL OIL", "condensed")), side(14.45, 10, 24, 30.8, 33.2, DATA("CLASS B")),
    ],
    draw: (s) => drawTankWagon(s, { length: 85, width: 31, body: [0.1, 0.1, 0.11], bodyHalf: 37.5, r: 14.4, wheelbase: 41.6, wheelR: 6.3, tieRods: true }),
  },
  {
    id: "br-20t-brake", maker: "", name: "BR standard 20 ton brake van, bauxite", group: "wagon", kind: "brake",
    length: 107, width: 32, height: 49.5, color: "#7a4226",
    note: "BR's goods brake van: verandahs at both ends, long end platforms, duckets for the guard; traced from Bachmann's side view",
    marks: [side(15.45, -19.5, -9, 16.8, 19.2, WHITE_T("B 954321", "condensed")), side(15.45, -17, -12, 19.8, 21, DATA("CAP"))],
    draw: (s) => drawBRBrakeVan(s, { length: 107, width: 32, body: BAUXITE }),
  },
];

// each model draws its markings after its body
for (const m of MODELS) {
  const body = m.draw, marks = m.marks;
  if (marks?.length) m.draw = (s) => { body(s); for (const k of marks) s.decal(k.axis, k.face, k.u[0], k.u[1], k.z[0], k.z[1], k.label, k.side); };
}

export const modelById = (id: string | undefined) => MODELS.find((m) => m.id === id);

/** A vehicle of a model. */
export function vehicleOfModel(m: Model, id: string): VehicleCfg {
  return { id, kind: m.kind, model: m.id, name: m.maker ? `${m.maker} ${m.name}` : m.name, length: m.length, color: m.color, detectable: m.kind === "loco" };
}

/** The vehicles a catalogue choice adds: a tender engine brings its tender. */
export function vehiclesOfModel(m: Model, nextId: () => string): VehicleCfg[] {
  const out = [vehicleOfModel(m, nextId())];
  const t = modelById(m.tender);
  if (t) out.push(vehicleOfModel(t, nextId()));
  return out;
}
