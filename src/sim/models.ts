// The rolling stock catalogue: classic British locomotives, coaches and wagons, drawn from their
// prototypes' dimensions at OO scale (1:76.2) and, where the owner has the model, from the maker's
// published sizes. The drawing is in steam.ts, diesels.ts, coaches.ts and wagons.ts.
import { VehicleCfg, VehicleKind } from "../control/types";
import { BLACK, BRASS, BUFFER_Z_H0, COPPER, Label, RED_BEAM, RGB, Shapes, WHITE, boundsOf, withBufferHeight } from "./parts";
import { drawBogieOpen, drawClass218, drawElectric, ElectricSpec } from "./europe";
import { drawSteam, drawTender, SteamSpec, TenderSpec } from "./steam";
import { drawClass08, drawClass37 } from "./diesels";
import { CoachSpec, drawCoach } from "./coaches";
import { drawBRBrakeVan, drawMineral, drawPlankOpen, drawTankWagon, drawToad, drawVan } from "./wagons";

export type { RGB, Shapes };
export { boundsOf };

/** A decal on a model: along a side (axis "y", at y = ±face) or on an end (axis "x", at x = face). */
export interface Mark { axis: "x" | "y"; face: number; u: [number, number]; z: [number, number]; label: Label; side?: 1 | -1 }

export type ModelGroup = "steam" | "diesel" | "electric" | "tender" | "coach" | "wagon";

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
  /** British stock is OO (1:76.2); European stock H0 (1:87), on the same 16.5 mm track. */
  scale?: "OO" | "H0";
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
/** European stock: buffers at 1,060 mm, 12.2 mm in H0. */
const h0 = (draw: (s: Shapes) => void) => (s: Shapes) => withBufferHeight(BUFFER_Z_H0, () => draw(s));
const DB_RED: RGB = [0.62, 0.11, 0.08], TEE_RED: RGB = [0.58, 0.07, 0.11], TEE_BEIGE: RGB = [0.88, 0.8, 0.6];
const DB_WINE: RGB = [0.5, 0.08, 0.12], SBB_GREEN: RGB = [0.13, 0.36, 0.22], DB_GREEN: RGB = [0.13, 0.3, 0.21];
const STAINLESS: RGB = [0.72, 0.74, 0.76], CORAIL_GREY: RGB = [0.62, 0.63, 0.62], DB_BROWN: RGB = [0.45, 0.2, 0.13];
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
    note: "The English Electric Type 3 in BR blue with full yellow ends and split headcode boxes: 61 ft 6 in over buffers",
    marks: [
      side(17.55, 84, 100, 21, 24.5, WHITE_T("37 025")), side(17.55, -100, -84, 21, 24.5, WHITE_T("37 025")),
      side(17.55, -13, 13, 31, 38.5, { logo: "br-arrow", color: "#f4f4f0" }),
    ],
    draw: drawClass37,
  },

  // ---------- coaches ----------
  {
    id: "br-mk1-sk-maroon", maker: "", name: "BR Mk1 corridor second (SK), maroon", group: "coach", kind: "coach",
    length: 268, width: 37, height: 51, color: "#5c1419",
    note: "64 ft 6 in Mk1 on BR1 bogies, in lined maroon: eight compartments, aluminium window frames",
    marks: [
      side(18.55, 100, 118, 18.2, 20.8, CREAM_T("M25041")), side(18.55, -118, -100, 18.2, 20.8, CREAM_T("M25041")),
    ],
    draw: coach({
      length: 268, width: 37, height: 51, bodyHalf: 126, floor: 15.5, waist: 30, eave: 44.5, rise: 5.2, tumblehome: 1.4,
      bogieCentre: 91.5, bogieWheelbase: 33.5, wheelR: 7, layout: "D T W W W W W W W W T D", vents: 10,
      livery: { lower: MAROON, roof: [0.38, 0.38, 0.38], lining: GOLD, frames: ALUMINIUM, ends: BLACK },
    }),
  },
  {
    id: "br-mk1-bsk-cc", maker: "", name: "BR Mk1 corridor brake second (BSK), carmine and cream", group: "coach", kind: "coach",
    length: 268, width: 37, height: 51, color: "#8c1f24",
    note: "The Mk1 brake in 1950s 'blood and custard': four compartments, the guard's van and luggage doors",
    marks: [
      side(18.55, 100, 118, 18.2, 20.8, CREAM_T("E34156")), side(18.55, -118, -100, 18.2, 20.8, CREAM_T("E34156")),
    ],
    draw: coach({
      length: 268, width: 37, height: 51, bodyHalf: 126, floor: 15.5, waist: 30, eave: 44.5, rise: 5.2, tumblehome: 1.4,
      bogieCentre: 91.5, bogieWheelbase: 33.5, wheelR: 7, layout: "D T W W W W D - L L - D", vents: 8,
      livery: { lower: CARMINE, upper: CREAM, roof: [0.38, 0.38, 0.38], lining: GOLD, frames: ALUMINIUM, ends: BLACK },
    }),
  },
  {
    id: "gwr-collett-57", maker: "", name: "GWR Collett 57 ft corridor third, chocolate and cream", group: "coach", kind: "coach",
    length: 240, width: 36, height: 49, color: "#4a2b1f",
    note: "A 1930s Great Western corridor coach: a door to every compartment, chocolate below and cream above, lined in gold",
    marks: [
      side(18.05, -4, 4, 19.5, 27.5, { logo: "gwr-roundel" }),
      side(18.05, 92, 106, 17, 19.6, GOLD_SHADED("5873")), side(18.05, -106, -92, 17, 19.6, GOLD_SHADED("5873")),
    ],
    draw: coach({
      length: 240, width: 36, height: 49, bodyHalf: 112, floor: 15, waist: 29, eave: 42.5, rise: 5.4, tumblehome: 1.2,
      bogieCentre: 80, bogieWheelbase: 28, wheelR: 6.8, layout: "T D W D W D W D W D W D W D W D T", vents: 7, windowRadius: 0.4,
      livery: { lower: CHOCOLATE, upper: GWR_CREAM, roof: [0.7, 0.7, 0.68], lining: GOLD, ends: CHOCOLATE },
    }),
  },
  {
    id: "lms-stanier-57", maker: "", name: "LMS Stanier 57 ft corridor third, crimson lake", group: "coach", kind: "coach",
    length: 242, width: 37, height: 50, color: "#73171a",
    note: "Stanier's flush-sided corridor coach in LMS crimson lake, lined in gold and black",
    marks: [
      side(18.55, -8, 8, 19, 23.5, GOLD_SHADED("LMS")),
      side(18.55, 92, 106, 19, 22, GOLD_SHADED("1234")), side(18.55, -106, -92, 19, 22, GOLD_SHADED("1234")),
    ],
    draw: coach({
      length: 242, width: 37, height: 50, bodyHalf: 113, floor: 15.5, waist: 29.5, eave: 44, rise: 5, tumblehome: 1.4,
      bogieCentre: 80, bogieWheelbase: 36, wheelR: 6.8, layout: "D T W W W W W W W T D", vents: 8, windowRadius: 1.8,
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
    note: "The LMS design BR built in thousands: corrugated steel ends, plain planked sides, BR bauxite",
    marks: [
      side(15.95, -32, -12, 16, 18.6, WHITE_T("B 760134", "condensed")), side(15.95, -32, -23, 19.2, 20.8, DATA("VENT")),
      side(15.95, 22, 32, 16, 18, DATA("12 T")),
    ],
    draw: (s) => drawVan(s, { length: 82, width: 33, height: 48, bodyHalf: 34.5, wheelbase: 36, top: 41.5, rise: 5.5, body: BAUXITE, corrugatedEnds: true, endVents: true, doors: [0], doorWidth: 16, marks: [{ x0: -32, x1: -20, z: 17, chars: 6 }] }),
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
    length: 82, width: 31, height: 33, color: "#80291c",
    note: "The colliery and coal merchants' wagon of the steam age: 7 planks, side door, a load of coal",
    marks: [
      side(15.35, -30, 30, 22.4, 25.8, { text: "J. ASHWORTH & SONS", color: "#f5f1e6", font: "serif" }),
      side(15.15, -33, -26, 15.6, 17.8, DATA("No 47")), side(15.15, 26, 33, 15.6, 17.8, DATA("COAL")),
    ],
    draw: (s) => drawPlankOpen(s, { length: 82, width: 31, body: PO_RED, band: [0.42, 0.13, 0.09], load: true }),
  },
  {
    id: "br-16t-mineral", maker: "", name: "BR 16 ton mineral wagon", group: "wagon", kind: "wagon",
    length: 80, width: 31, height: 34, color: "#80807a",
    note: "BR's steel coal wagon, built by the quarter-million: pressed-steel sides, side and top flap doors, loaded",
    marks: [
      side(15.15, -30, -15, 15.8, 18.2, WHITE_T("B 87654", "condensed")), side(15.15, 17, 28, 15.8, 17.6, DATA("16 T")),
    ],
    draw: (s) => drawMineral(s, { length: 80, width: 31, body: MINERAL_GREY, load: true }),
  },
  {
    id: "tank-14t", maker: "", name: "14 ton tank wagon, black", group: "wagon", kind: "tank",
    length: 85, width: 31, height: 46, color: "#1c1c1e",
    note: "A Class B tank wagon for oil: barrel on cradles, dome, ladders and tie bars",
    marks: [
      side(12.05, -26, -6, 26.5, 29.3, WHITE_T("MINERAL OIL", "condensed")), side(12.05, 6, 18, 26.8, 28.8, DATA("CLASS B")),
    ],
    draw: (s) => drawTankWagon(s, { length: 85, width: 31, body: [0.1, 0.1, 0.11] }),
  },
  {
    id: "br-20t-brake", maker: "", name: "BR standard 20 ton brake van, bauxite", group: "wagon", kind: "brake",
    length: 107, width: 32, height: 48, color: "#7a4226",
    note: "BR's goods brake van: verandahs at both ends, long end platforms, duckets for the guard",
    marks: [side(15.45, -12, 4, 16.4, 18.8, WHITE_T("B 954321", "condensed"))],
    draw: (s) => drawBRBrakeVan(s, { length: 107, width: 32, body: BAUXITE }),
  },
];

// ---------- European stock, H0 ----------
const EUROPE: Model[] = [
  {
    id: "db-br01", maker: "", name: "DB class 01 Pacific 2'C1'", group: "steam", kind: "loco", tender: "db-t32-tender", scale: "H0",
    length: 163, width: 36, height: 52.5, color: "#141414",
    note: "The German express Pacific in black and red, with big Wagner smoke deflectors: 2,000 mm drivers, 23.9 m over buffers with its tender",
    marks: [
      side(17.55, -55, -41, 27.5, 30.5, { text: "01 220", bg: "#121212", color: "#e6e6e2", border: "#cfcfca", font: "plate", radius: 0.4 }),
      front(70.95, -4, 4, 40.2, 42.4, { text: "01 220", bg: "#121212", color: "#e6e6e2", border: "#cfcfca", font: "plate", radius: 0.3 }),
    ],
    draw: h0(steam({
      length: 163, width: 36, height: 52.5,
      plate: { z: 23.5, half: 17.4, x0: -74, x1: 74 },
      wheels: [{ x: 66, r: 5.75 }, { x: 42, r: 5.75 }, { x: 13, r: 11.5, driven: true }, { x: -12.5, r: 11.5, driven: true }, { x: -38, r: 11.5, driven: true }, { x: -62, r: 7.2 }],
      cylinders: { x0: 48, x1: 60, z: 14, r: 4.8, outside: true, y: 12.4 }, mainDriver: 1,
      boiler: { x0: 4, x1: 56, z: 35.6, rBack: 11, rFront: 10.6 },
      smokebox: { x0: 56, x1: 70, r: 11.4 },
      firebox: { x0: -26, x1: 4, top: 46.6, half: 12.5, belpaire: false },
      chimney: { x: 64, top: 52.3, r: 3.2 },
      dome: { x: 22, r: 4, top: 50.5 },
      safety: { x: -10, kind: "pop" },
      cab: { x0: -60, x1: -26, eave: 48.5, rise: 3, half: 17.5, window: "square", back: "open" },
      deflectors: { x0: 52, x1: 74, top: 44 },
      livery: { body: BLACK, smokebox: BLACK, frames: DB_RED, wheels: DB_RED, beams: DB_RED, roof: BLACK, plate: BLACK, numbers: { col: WHITE, x0: -54, x1: -40, z: 34 } },
    })),
  },
  {
    id: "db-t32-tender", maker: "", name: "DB 2'2' T32 tender", group: "tender", kind: "tender", scale: "H0",
    length: 110, width: 35, height: 46, color: "#141414",
    note: "The 01's tender, on two bogies",
    marks: [side(17.55, -30, 30, 28, 31.5, WHITE_T("Deutsche Bundesbahn", "serif"))],
    draw: h0(tender({
      length: 110, width: 35, height: 46, wheels: [37, 15, -15, -37], r: 5.75,
      body: { x0: -50, x1: 48, z0: 17, top: 41 }, outsideFrames: false,
      livery: { body: BLACK, frames: DB_RED, beams: DB_RED },
    })),
  },
  {
    id: "db-br103", maker: "", name: "DB class 103 TEE electric", group: "electric", kind: "loco", scale: "H0",
    length: 224, width: 35.5, height: 51.6, color: "#941220",
    note: "The DB's flagship express electric in TEE red and beige: Co'Co', 200 km/h, 19.5 m over buffers",
    marks: [
      side(17.8, -12, 12, 24, 27, WHITE_T("103 113-7", "plate")), side(17.8, -4, 4, 33.5, 38, { logo: "db", color: "#f2f2ee" }),
      ...ends(105.95, -3.6, 3.6, 22.2, 25.6, { logo: "db", color: "#e6e6e2" }),
    ],
    draw: h0((s) => drawElectric(s, {
      length: 224, width: 35.5, height: 51.6, floor: 17, eave: 44, roofRise: 2.5, cabBack: 80.5,
      front: [[0, 17], [0, 22], [5, 29], [16, 44]],
      bogies: { centre: 60.6, wheelbase: 51.7, r: 7.2, axles: 3 },
      pantographs: [{ x: 50, kind: "diamond" }, { x: -50, kind: "diamond" }],
      livery: { body: TEE_RED, roof: [0.42, 0.43, 0.43], frames: [0.2, 0.2, 0.21], band: { z0: 17, z1: 21, col: TEE_BEIGE } },
      cabWindow: [4, 12, 32, 40], grilles: [-66, -34, -12, 12, 34, 66],
    })),
  },
  {
    id: "sbb-re44ii", maker: "", name: "SBB Re 4/4 II electric", group: "electric", kind: "loco", scale: "H0",
    length: 177, width: 34, height: 50.5, color: "#215c38",
    note: "The Swiss all-rounder in SBB green: Bo'Bo', single-arm pantographs, 15.4 m over buffers",
    marks: [
      side(17.05, -9, 9, 22.5, 25.4, WHITE_T("11130", "plate")), side(17.05, -24, 24, 33, 36.2, { logo: "sbb", color: "#f2f2ee" }),
      ...ends(82.45, -5, 5, 22.5, 25.5, WHITE_T("11130", "plate")),
    ],
    draw: h0((s) => drawElectric(s, {
      length: 177, width: 34, height: 50.5, floor: 16.5, eave: 43.5, roofRise: 2.2, cabBack: 66,
      front: [[0, 16.5], [0, 29], [1.6, 31], [4.6, 42], [5.6, 43.5]],
      bogies: { centre: 45.4, wheelbase: 32.2, r: 7.2, axles: 2 },
      pantographs: [{ x: 35, kind: "single" }, { x: -35, kind: "single" }],
      livery: { body: SBB_GREEN, roof: [0.45, 0.46, 0.46], frames: [0.18, 0.18, 0.19], stripe: { z: 24, col: [0.8, 0.82, 0.83] } },
      cabWindow: [3, 11, 31, 39], grilles: [-48, -22, 0, 22, 48],
    })),
  },
  {
    id: "db-br218", maker: "", name: "DB class 218 diesel-hydraulic", group: "diesel", kind: "loco", scale: "H0",
    length: 188.5, width: 35.6, height: 48.9, color: "#80141f",
    note: "The DB's standard main-line diesel in wine red with a grey stripe: centre cab, two bonnets, B'B', 16.4 m over buffers",
    marks: [
      side(17.65, -10, 10, 19.5, 22.6, WHITE_T("218 128-8", "plate")),
      side(15.35, 36, 46, 30, 36, { logo: "db", color: "#f2f2ee" }), side(15.35, -46, -36, 30, 36, { logo: "db", color: "#f2f2ee" }),
    ],
    draw: h0((s) => drawClass218(s, { length: 188.5, width: 35.6, body: DB_WINE, stripe: [0.78, 0.78, 0.75] })),
  },
  {
    id: "db-silberling", maker: "", name: "DB n-Wagen 'Silberling', 2nd class", group: "coach", kind: "coach", scale: "H0",
    length: 303, width: 32.5, height: 46.6, color: "#b8bdc2",
    note: "The DB's local train coach: fluted stainless steel sides, two doors a side, Minden-Deutz bogies, 26.4 m over buffers",
    marks: [
      side(16.3, -4, 4, 16.5, 20.5, { logo: "db", color: "#1a1a1a" }), side(16.3, 108, 136, 14.4, 15.9, DATA("50 80 22-34 123-4", "#1a1a1a")),
    ],
    draw: h0(coach({
      length: 303, width: 32.5, height: 46.6, bodyHalf: 143, floor: 13.5, waist: 21.5, eave: 40, rise: 5.6, tumblehome: 0.6,
      bogieCentre: 109, bogieWheelbase: 28.7, wheelR: 5.5, layout: "T W W D W W W W W W D W W T", vents: 6, windowRadius: 1.4, fluted: true,
      livery: { lower: STAINLESS, roof: [0.42, 0.42, 0.43], frames: [0.12, 0.12, 0.12], ends: [0.22, 0.32, 0.27] },
    })),
  },
  {
    id: "db-uicx-green", maker: "", name: "DB UIC-X compartment coach, bottle green", group: "coach", kind: "coach", scale: "H0",
    length: 303, width: 32.5, height: 46.6, color: "#214d36",
    note: "The 26.4 m UIC-X express coach of the 1950s and 60s in DB bottle green: compartments, aluminium window frames",
    marks: [
      side(16.3, -42, 42, 37.2, 39.1, WHITE_T("DEUTSCHE BUNDESBAHN")), side(16.3, 108, 136, 15, 16.6, DATA("51 80 22-40 123-4")),
    ],
    draw: h0(coach({
      length: 303, width: 32.5, height: 46.6, bodyHalf: 143, floor: 14, waist: 25.5, eave: 39.5, rise: 6, tumblehome: 1.2,
      bogieCentre: 109, bogieWheelbase: 28.7, wheelR: 5.5, layout: "D T W W W W W W W W W W T D", vents: 10, windowRadius: 1,
      livery: { lower: DB_GREEN, roof: [0.4, 0.4, 0.41], frames: [0.75, 0.76, 0.77], ends: [0.15, 0.17, 0.16] },
    })),
  },
  {
    id: "sncf-corail", maker: "", name: "SNCF Corail coach", group: "coach", kind: "coach", scale: "H0",
    length: 303, width: 33, height: 46, color: "#9fa1a0",
    note: "The French intercity coach of 1975 onwards: grey with a light window band and orange doors, 26.4 m over buffers",
    marks: [
      side(16.55, 96, 116, 16.5, 21.5, { logo: "sncf", color: "#ef7d1a" }), side(16.55, -116, -96, 16.5, 21.5, { logo: "sncf", color: "#ef7d1a" }),
    ],
    draw: h0(coach({
      length: 303, width: 33, height: 46, bodyHalf: 143, floor: 14, waist: 24, eave: 39, rise: 5.8, tumblehome: 1.4,
      bogieCentre: 109, bogieWheelbase: 28.7, wheelR: 5.5, layout: "D T W W W W W W W W W W T D", vents: 0, windowRadius: 1.6,
      livery: { lower: CORAIL_GREY, upper: [0.86, 0.87, 0.86], roof: [0.5, 0.5, 0.5], frames: [0.1, 0.1, 0.1], ends: CORAIL_GREY, doors: [0.92, 0.45, 0.12] },
    })),
  },
  {
    id: "db-eaos", maker: "", name: "DB Eaos bogie open wagon, with coal", group: "wagon", kind: "wagon", scale: "H0",
    length: 161, width: 34, height: 37, color: "#733321",
    note: "The European standard high-sided bogie open: steel sides on stanchions, Y25 bogies, 14 m over buffers",
    marks: [
      side(16.75, -60, -52, 18, 24, { logo: "db", color: "#f2f2ee" }), side(16.75, -46, -24, 17, 19.6, WHITE_T("Eaos 106", "condensed")),
      side(16.75, 30, 62, 16.6, 18.2, DATA("31 80 537 1 234-5")),
    ],
    draw: h0((s) => drawBogieOpen(s, { length: 161, width: 34, height: 37, body: DB_BROWN, load: true })),
  },
  {
    id: "db-gbs", maker: "", name: "DB Gbs covered wagon", group: "wagon", kind: "van", scale: "H0",
    length: 181, width: 33, height: 46, color: "#733823",
    note: "The two-axle covered wagon of the DB, with big sliding doors and a 10 m wheelbase: 15.7 m over buffers",
    marks: [
      side(15.95, -70, -62, 30, 36, { logo: "db", color: "#f2f2ee" }), side(15.95, -70, -50, 18, 20.6, WHITE_T("Gbs 254", "condensed")),
      side(15.95, 50, 80, 18, 19.6, DATA("21 80 151 1 234-5")),
    ],
    draw: h0((s) => drawVan(s, { length: 181, width: 33, height: 46, bodyHalf: 84, wheelbase: 115, top: 40.5, rise: 5, wheelR: 5.3, body: [0.45, 0.22, 0.14], roof: [0.55, 0.55, 0.53], doors: [0], doorWidth: 32, marks: [{ x0: -80, x1: -55, z: 18, chars: 10 }] })),
  },
  {
    id: "eu-tank-2axle", maker: "", name: "Two-axle tank wagon, silver", group: "wagon", kind: "tank", scale: "H0",
    length: 111, width: 34, height: 46.5, color: "#bdbfbd",
    note: "A Uerdingen-type two-axle tank wagon for mineral oil: a long barrel, dome, ladders and walkway",
    marks: [
      side(12.55, -30, -6, 27, 29.6, { text: "MINERALÖL", color: "#1a1a1a", font: "condensed" }),
      side(12.55, 32, 44, 25.5, 30.5, { text: "33 / 1203", bg: "#f08a1c", color: "#111", border: "#111", font: "plate" }),
    ],
    draw: h0((s) => drawTankWagon(s, { length: 111, width: 34, body: [0.74, 0.75, 0.74], bodyHalf: 48, r: 12.5, wheelbase: 57.5, wheelR: 5.3 })),
  },
  {
    id: "roco-t478-2079", maker: "Roco", name: "ČSD T 478.2 'Bardotka' diesel", group: "diesel", kind: "loco", scale: "H0",
    length: 190, width: 35.3, height: 47.2, color: "#991f1f",
    note: "Roco 7300090 (7310090 with sound): T 478.2079 of the ČSD, Era IV: dark red above a broad yellow band that wraps round the front, light grey skirt, roof and bogies, a striped plough; the goods version without the steam-heating boiler; Bo'Bo', 16.5 m (190 mm) over buffers, 3,074 mm wide, 4,103 mm high",
    marks: [
      side(17.7, -8.5, 4, 23.3, 26.3, { text: "T478 2079", bg: "#b5161b", color: "#f6f2ea", border: "#f6f2ea", font: "plate", radius: 0.4 }),
      side(17.7, 38.8, 43.8, 22.1, 27.1, { logo: "csd", color: "#b5161b", bg: "#f4f1e8" }),
      side(17.7, 50, 62, 19.2, 21.2, DATA("ČSD", "#2a1a10")),
      ...ends(89.35, -6.2, 6.2, 13.6, 16.2, { text: "T478 2079", bg: "#b5161b", color: "#f6f2ea", border: "#f6f2ea", font: "plate", radius: 0.3 }),
      front(90.75, -12.5, -6.5, 20, 25.5, { logo: "red-star" }), front(-90.75, 6.5, 12.5, 20, 25.5, { logo: "red-star" }),
    ],
    draw: h0((s) => drawElectric(s, {
      length: 190, width: 35.3, height: 47.2, floor: 18.6, eave: 41.6, roofRise: 4.4, cabBack: 54,
      front: [[-1.8, 18.6], [-1.8, 26.5]],
      // as Roco's photo shows it: the yellow band stands out at the front, the red below the windscreens
      // slopes back up to them, the windscreens lean back, and the grey roof rounds over the top
      frontParts: [
        [[-1.8, 18.6], [-1.8, 26.5]],
        [[-1.8, 26.5], [-1.2, 29.2], [-0.3, 32]],
        [[-0.3, 32], [3.4, 41.6]],
      ],
      frontColors: [[0.96, 0.72, 0.14], [0.6, 0.12, 0.12], [0.6, 0.12, 0.12]], roofNose: 3.2,
      screen: { part: 2, seg: 0 }, lampZ: 15, topLampZ: 44,
      bogies: { centre: 51.7, wheelbase: 27.6, r: 5.75, axles: 2 },
      pantographs: [], cornerR: 5,
      diesel: { fans: [-26, -8], exhausts: [6, 14] },
      skirt: { z0: 11.4, col: [0.68, 0.69, 0.68] },
      plough: { col: [0.92, 0.92, 0.9], stripe: [0.8, 0.12, 0.12] },
      tank: [-13.8, 14.8],
      sideWindows: [22.7, 7.6, -14.6, -28.9],
      louvres: [[-36, 20.3, 38.4, 40.8], [-60.6, -43.2, 21.6, 36.8]],
      ribs: [[-50, 50, 18.6, 26.5], [-50, 50, 27, 30.8]],
      plates: [],
      livery: { body: [0.6, 0.12, 0.12], roof: [0.68, 0.69, 0.68], frames: [0.6, 0.61, 0.6], beams: [0.32, 0.33, 0.33], band: { z0: 18.6, z1: 26.5, col: [0.96, 0.72, 0.14] } },
      cabWindow: [7, 12, 33, 38.5], doorWindow: [2.3, 5.5, 33, 38.5], grilles: [],
    })),
  },
  {
    id: "roco-1144-078", maker: "Roco", name: "ÖBB 1144 electric (1044)", group: "electric", kind: "loco", scale: "H0",
    length: 185, width: 34.6, height: 56.5, color: "#db231f",
    note: "Roco 7500060 (7510060 / 7520060 with sound): 1144 078-3 of the ÖBB, Epoch VI: traffic red with a light grey band and dark grey cab tops, four porthole windows a side, the raised Klatte roof grilles, red single-arm pantographs; Bo'Bo', 1,300 mm wheels, 185 mm over buffers",
    marks: [
      side(17.35, 57, 71, 23.8, 29, { logo: "obb", color: "#f6f6f4" }), side(17.35, -81, -67, 23.8, 29, { logo: "obb", color: "#f6f6f4" }),
      side(17.35, -32, -6, 19.2, 21.9, { text: "1144 078-3", color: "#222", font: "plate" }),
      side(17.35, 36.2, 39.6, 37.5, 40.5, { logo: "lightning" }), side(17.35, -62.8, -59.4, 37.5, 40.5, { logo: "lightning" }),
      ...ends(86.5, -6, 6, 23.4, 27.4, { logo: "obb", color: "#f6f6f4" }),
      ...ends(86.5, 3, 11, 28.6, 30.2, WHITE_T("1144 078", "plate")),
    ],
    draw: h0((s) => drawElectric(s, {
      length: 185, width: 34.6, height: 56.5, floor: 18.4, eave: 43.4, roofRise: 2, cabBack: 50,
      front: [[0, 18.4], [0, 22.8]],
      frontParts: [
        [[0, 18.4], [0, 22.8]],
        [[0, 22.8], [0.8, 31]],
        [[0.8, 31], [5.5, 42.6], [7.5, 44.4], [10, 45.2]],
      ],
      frontColors: [[0.82, 0.82, 0.8], [0.86, 0.14, 0.12], [0.3, 0.31, 0.32]],
      screen: { part: 2, seg: 0 }, lampZ: 20.6, topLampZ: 43.5,
      bogies: { centre: 46, wheelbase: 33.3, r: 7.47, axles: 2 },
      pantographs: [{ x: 47, kind: "single" }, { x: -47, kind: "single" }], pantoZ: 51, pantoCol: [0.75, 0.1, 0.1],
      roofPanels: { spans: [[13.8, 43], [-28.5, 13.8], [-41.6, -28.5], [-75, -50]], top: 51.2, col: [0.84, 0.85, 0.85] },
      cornerR: 3,
      skirt: { z0: 12, col: [0.27, 0.28, 0.29] },
      cabTop: { z0: 31, col: [0.3, 0.31, 0.32], len: 9 },
      portholes: [[24.6, 38, 2.8], [-2.5, 38, 2.8], [-28.6, 38, 2.8], [-54.2, 38, 2.8]],
      ribs: [[-60, 30, 22.8, 29.5]],
      doors: [[35, 7], [-64, 7]],
      plates: [],
      livery: { body: [0.86, 0.14, 0.12], roof: [0.3, 0.31, 0.32], frames: [0.25, 0.26, 0.27], band: { z0: 18.4, z1: 22.8, col: [0.82, 0.82, 0.8] } },
      cabWindow: [2, 7, 33, 39.5], grilles: [],
    })),
  },
];
MODELS.push(...EUROPE);

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
