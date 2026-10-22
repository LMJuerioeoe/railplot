// The rolling stock catalogue: classic British locomotives, coaches and wagons, drawn from their
// prototypes' dimensions at OO scale (1:76.2) and, where the owner has the model, from the maker's
// published sizes. The drawing is in steam.ts, diesels.ts, coaches.ts and wagons.ts.
import { VehicleCfg, VehicleKind } from "../control/types";
import { BLACK, BRASS, BUFFER_Z_H0, COPPER, RED_BEAM, RGB, Shapes, WHITE, boundsOf, withBufferHeight } from "./parts";
import { drawBogieOpen, drawClass218, drawElectric, ElectricSpec } from "./europe";
import { drawSteam, drawTender, SteamSpec, TenderSpec } from "./steam";
import { drawClass08, drawClass37 } from "./diesels";
import { CoachSpec, drawCoach } from "./coaches";
import { drawBRBrakeVan, drawMineral, drawPlankOpen, drawTankWagon, drawToad, drawVan } from "./wagons";

export type { RGB, Shapes };
export { boundsOf };

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
  /** A tender engine's tender: added behind it. */
  tender?: string;
  /** British stock is OO (1:76.2); European stock H0 (1:87), on the same 16.5 mm track. */
  scale?: "OO" | "H0";
  draw(s: Shapes): void;
}

// ---------- liveries ----------
const GWR_GREEN: RGB = [0.1, 0.25, 0.14], GWR_LINING: [RGB, RGB] = [[0.86, 0.5, 0.14], BLACK];
const LNER_GREEN: RGB = [0.25, 0.45, 0.19];
const GOLD: RGB = [0.86, 0.71, 0.36];
const MAROON: RGB = [0.36, 0.08, 0.1], CARMINE: RGB = [0.55, 0.12, 0.14], CREAM: RGB = [0.87, 0.79, 0.6];
const CHOCOLATE: RGB = [0.29, 0.17, 0.12], GWR_CREAM: RGB = [0.89, 0.81, 0.63], CRIMSON: RGB = [0.45, 0.09, 0.1];
const ALUMINIUM: RGB = [0.72, 0.73, 0.74];
const VAN_BROWN: RGB = [0.37, 0.23, 0.16], GWR_BROWN: RGB = [0.3, 0.19, 0.14], BAUXITE: RGB = [0.48, 0.26, 0.15];
const BR_GREY: RGB = [0.53, 0.56, 0.53], MINERAL_GREY: RGB = [0.5, 0.5, 0.48], PO_RED: RGB = [0.5, 0.16, 0.11];
const GWR_LIVERY = { body: GWR_GREEN, lining: GWR_LINING, smokebox: BLACK, frames: BLACK, wheels: GWR_GREEN, beams: RED_BEAM, bonnet: BRASS, roof: BLACK };

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
    length: 164, width: 34, height: 48, color: "#1a4024",
    note: "Dapol 4S-041-010: 5134 in GWR green, lined, with the shirt-button roundel; 164 × 34 × 48 mm",
    draw: steam({
      length: 164, width: 34, height: 48,
      plate: { z: 17, half: 16.8, x0: -76, x1: 76 },
      wheels: [{ x: 57, r: 6.3 }, { x: 30, r: 11.3, driven: true }, { x: 4, r: 11.3, driven: true }, { x: -22, r: 11.3, driven: true }, { x: -49, r: 6.3 }],
      cylinders: { x0: 52, x1: 67, z: 13.5, r: 4.5, outside: true, y: 12.3 }, mainDriver: 1,
      boiler: { x0: 20, x1: 52, z: 30, rBack: 10.4, rFront: 9.2 },
      smokebox: { x0: 52, x1: 67, r: 10 },
      firebox: { x0: 3, x1: 20, top: 41.5, half: 11.5, belpaire: true },
      chimney: { x: 61, top: 47.6, r: 3 },
      safety: { x: 27, kind: "bonnet" },
      cab: { x0: -32, x1: 3, eave: 44.5, rise: 2.8, half: 16.6, window: "round", back: "bunker" },
      tanks: { kind: "side", x0: 8, x1: 50, top: 35, inner: 11 },
      bunker: { x0: -76, top: 35 },
      livery: { ...GWR_LIVERY, emblem: { x: 29, z: 26, r: 3.2, col: GOLD, ring: BLACK }, numberPlate: BRASS },
    }),
  },
  {
    id: "gwr-57xx", maker: "", name: "GWR 57xx pannier tank 0-6-0PT", group: "steam", kind: "loco",
    length: 125, width: 34, height: 49, color: "#1a4024",
    note: "The Great Western's everywhere shunter and branch engine: 31 ft 2 in over buffers, 4 ft 7½ in wheels, copper-capped chimney",
    draw: steam({
      length: 125, width: 34, height: 49,
      plate: { z: 15.5, half: 16.6, x0: -57, x1: 57 },
      wheels: [{ x: 30, r: 8.8, driven: true }, { x: 1, r: 8.8, driven: true }, { x: -32, r: 8.8, driven: true }],
      cylinders: { x0: 40, x1: 54, z: 11, r: 4, outside: false },
      boiler: { x0: 8, x1: 40, z: 27.5, rBack: 9, rFront: 9 },
      smokebox: { x0: 40, x1: 52, r: 9.6 },
      firebox: { x0: -10, x1: 8, top: 37.8, half: 7.2, belpaire: true },
      chimney: { x: 47, top: 48.6, r: 2.7 },
      dome: { x: 18, r: 3.6, top: 41 },
      safety: { x: -1, kind: "bonnet" },
      cab: { x0: -36, x1: -10, eave: 46, rise: 2.6, half: 16.6, window: "round", back: "bunker" },
      tanks: { kind: "pannier", x0: -9.5, x1: 44, top: 38.6, inner: 7.4, bottom: 22 },
      bunker: { x0: -57, top: 33 },
      livery: { body: GWR_GREEN, smokebox: BLACK, frames: BLACK, wheels: GWR_GREEN, beams: RED_BEAM, bonnet: BRASS, cap: COPPER, roof: BLACK, emblem: { x: 18, z: 31, r: 3, col: GOLD, ring: BLACK }, numberPlate: BRASS },
    }),
  },
  {
    id: "lms-jinty", maker: "", name: "LMS 3F 'Jinty' 0-6-0T", group: "steam", kind: "loco",
    length: 125, width: 34, height: 51, color: "#16181a",
    note: "The LMS standard shunting tank in BR plain black with the early crest: 31 ft 4½ in over buffers, 4 ft 7 in wheels",
    draw: steam({
      length: 125, width: 34, height: 51,
      plate: { z: 15.5, half: 16.6, x0: -57, x1: 57 },
      wheels: [{ x: 31, r: 8.7, driven: true }, { x: 3, r: 8.7, driven: true }, { x: -31, r: 8.7, driven: true }],
      cylinders: { x0: 40, x1: 54, z: 11, r: 4, outside: false },
      boiler: { x0: 4, x1: 40, z: 27, rBack: 8.6, rFront: 8.6 },
      smokebox: { x0: 40, x1: 53, r: 9.2 },
      firebox: { x0: -12, x1: 4, top: 37, half: 10.4, belpaire: true },
      chimney: { x: 48, top: 50.6, r: 2.6, tall: true },
      dome: { x: 20, r: 3.6, top: 41 },
      safety: { x: -4, kind: "pop" },
      cab: { x0: -38, x1: -12, eave: 48, rise: 2.4, half: 16.8, window: "round", back: "bunker" },
      tanks: { kind: "side", x0: 4, x1: 40, top: 33, inner: 10.8 },
      bunker: { x0: -57, top: 34 },
      livery: { body: BLACK, smokebox: BLACK, frames: BLACK, wheels: BLACK, beams: RED_BEAM, roof: BLACK, emblem: { x: 22, z: 24, r: 3.4, col: GOLD }, numbers: { col: WHITE, x0: -32, x1: -19, z: 28 } },
    }),
  },
  {
    id: "gwr-castle", maker: "", name: "GWR Castle class 4-6-0", group: "steam", kind: "loco", tender: "gwr-collett-tender",
    length: 158, width: 35, height: 53, color: "#1a4024",
    note: "Collett's express engine in lined GWR green: 6 ft 8½ in drivers under brass-beaded splashers, copper-capped chimney, four cylinders",
    draw: steam({
      length: 158, width: 35, height: 53,
      plate: { z: 19.5, half: 17.2, x0: -72, x1: 74 },
      wheels: [{ x: 64, r: 6.3 }, { x: 38, r: 6.3 }, { x: 9, r: 13.3, driven: true }, { x: -19, r: 13.3, driven: true }, { x: -49, r: 13.3, driven: true }],
      cylinders: { x0: 45, x1: 57, z: 15, r: 4.8, outside: true, y: 12.3 }, mainDriver: 1,
      boiler: { x0: 14, x1: 50, z: 35, rBack: 11.6, rFront: 10 },
      smokebox: { x0: 50, x1: 64, r: 10.6 },
      firebox: { x0: -16, x1: 14, top: 48.5, half: 12.5, belpaire: true },
      chimney: { x: 58, top: 52.8, r: 3.2 },
      safety: { x: 26, kind: "bonnet" },
      topFeed: { x: 36 },
      cab: { x0: -48, x1: -16, eave: 49.5, rise: 3, half: 17.2, window: "round", back: "open" },
      splashers: true,
      livery: { ...GWR_LIVERY, cap: COPPER, beading: BRASS, numberPlate: BRASS },
    }),
  },
  {
    id: "gwr-collett-tender", maker: "", name: "GWR Collett 4,000 gallon tender", group: "tender", kind: "tender",
    length: 98, width: 34, height: 44, color: "#1a4024",
    note: "The Castle's tender, with the shirt-button roundel",
    draw: tender({
      length: 98, width: 34, height: 44, wheels: [31, 0, -31], r: 7.9,
      body: { x0: -43, x1: 43, z0: 16.5, top: 38.5 }, outsideFrames: true,
      livery: { body: GWR_GREEN, frames: BLACK, beams: RED_BEAM, lining: GWR_LINING, emblem: { x: 0, z: 28, r: 4, col: GOLD, ring: BLACK } },
    }),
  },
  {
    id: "lner-a3", maker: "", name: "LNER A3 Pacific 4-6-2", group: "steam", kind: "loco", tender: "lner-gn-tender",
    length: 172, width: 36, height: 52, color: "#548f3d",
    note: "Gresley's express Pacific in LNER apple green, lined black and white, as 4472 in the 1930s: three cylinders, 6 ft 8 in drivers",
    draw: steam({
      length: 172, width: 36, height: 52,
      plate: { z: 20.5, half: 17.8, x0: -80, x1: 80, drop: { x: 72, z: 18 } },
      wheels: [{ x: 71, r: 6.3 }, { x: 45, r: 6.3 }, { x: 16, r: 13.2, driven: true }, { x: -14, r: 13.2, driven: true }, { x: -44, r: 13.2, driven: true }, { x: -69, r: 7.3 }],
      cylinders: { x0: 52, x1: 64, z: 15.5, r: 5, outside: true, y: 12.6 }, mainDriver: 1,
      boiler: { x0: 6, x1: 60, z: 37.5, rBack: 12.3, rFront: 11.6 },
      smokebox: { x0: 60, x1: 74, r: 12.3 },
      firebox: { x0: -24, x1: 6, top: 48.6, half: 13, belpaire: false },
      chimney: { x: 68, top: 51.8, r: 3.4 },
      dome: { x: 30, r: 4.2, top: 51.5 },
      safety: { x: -8, kind: "pop" },
      cab: { x0: -58, x1: -24, eave: 48.8, rise: 3, half: 17.6, window: "square", back: "open" },
      splashers: true,
      livery: { body: LNER_GREEN, lining: [BLACK, WHITE], smokebox: BLACK, frames: BLACK, wheels: LNER_GREEN, beams: RED_BEAM, roof: [0.25, 0.42, 0.18], numbers: { col: GOLD, x0: -52, x1: -36, z: 27 } },
    }),
  },
  {
    id: "lner-gn-tender", maker: "", name: "LNER eight-wheeled tender", group: "tender", kind: "tender",
    length: 108, width: 36, height: 46, color: "#548f3d",
    note: "The A3's tender, with coal rails and LNER lettering",
    draw: tender({
      length: 108, width: 36, height: 46, wheels: [39, 13, -13, -39], r: 7.1,
      body: { x0: -48, x1: 47, z0: 17.5, top: 39, flare: true, coalRails: true }, outsideFrames: true,
      livery: { body: LNER_GREEN, frames: BLACK, beams: RED_BEAM, lining: [BLACK, WHITE], lettering: { col: GOLD, x0: -22, x1: 22, z: 26, chars: 4 } },
    }),
  },
  {
    id: "lms-black5", maker: "", name: "LMS Stanier 'Black Five' 4-6-0", group: "steam", kind: "loco", tender: "lms-stanier-tender",
    length: 152, width: 35, height: 52, color: "#16181a",
    note: "Stanier's mixed-traffic engine in BR lined black: high running plate, taper boiler, 6 ft drivers, Walschaerts gear",
    draw: steam({
      length: 152, width: 35, height: 52,
      plate: { z: 25, half: 17.2, x0: -68, x1: 70, drop: { x: 59, z: 20.5 } },
      wheels: [{ x: 61, r: 6.4 }, { x: 36, r: 6.4 }, { x: 7, r: 12, driven: true }, { x: -21, r: 12, driven: true }, { x: -51, r: 12, driven: true }],
      cylinders: { x0: 43, x1: 54, z: 17, r: 5, outside: true, y: 12.2 }, mainDriver: 1,
      boiler: { x0: 12, x1: 46, z: 38, rBack: 11.6, rFront: 10.2 },
      smokebox: { x0: 46, x1: 60, r: 10.8 },
      firebox: { x0: -20, x1: 12, top: 49.2, half: 12.4, belpaire: true },
      chimney: { x: 54, top: 51.6, r: 3 },
      dome: { x: 26, r: 3.6, top: 50.4 },
      safety: { x: -2, kind: "pop" },
      cab: { x0: -52, x1: -20, eave: 49, rise: 2.8, half: 17.2, window: "square", back: "open" },
      livery: { body: BLACK, lining: [[0.62, 0.12, 0.1], [0.55, 0.55, 0.55]], smokebox: BLACK, frames: BLACK, wheels: BLACK, beams: RED_BEAM, roof: BLACK, numbers: { col: WHITE, x0: -46, x1: -31, z: 32 } },
    }),
  },
  {
    id: "lms-stanier-tender", maker: "", name: "LMS Stanier 4,000 gallon tender", group: "tender", kind: "tender",
    length: 100, width: 35, height: 47, color: "#16181a",
    note: "The Black Five's tender, lined, with the BR crest",
    draw: tender({
      length: 100, width: 35, height: 47, wheels: [31, 0, -31], r: 7.1,
      body: { x0: -44, x1: 43, z0: 17.5, top: 40 }, outsideFrames: true,
      livery: { body: BLACK, frames: BLACK, beams: RED_BEAM, lining: [[0.62, 0.12, 0.1], [0.55, 0.55, 0.55]], emblem: { x: 0, z: 28, r: 4, col: GOLD } },
    }),
  },

  // ---------- diesel ----------
  {
    id: "br-class08", maker: "", name: "BR Class 08 diesel shunter", group: "diesel", kind: "loco",
    length: 117, width: 34, height: 50, color: "#1c4d30",
    note: "The 350 hp yard shunter in BR green with wasp-striped ends: jackshaft drive, 4 ft 6 in wheels, 29 ft 3 in over buffers",
    draw: drawClass08,
  },
  {
    id: "br-class37", maker: "", name: "BR Class 37 Co-Co diesel", group: "diesel", kind: "loco",
    length: 245, width: 35, height: 52, color: "#2b4d78",
    note: "The English Electric Type 3 in BR blue with full yellow ends and split headcode boxes: 61 ft 6 in over buffers",
    draw: drawClass37,
  },

  // ---------- coaches ----------
  {
    id: "br-mk1-sk-maroon", maker: "", name: "BR Mk1 corridor second (SK), maroon", group: "coach", kind: "coach",
    length: 268, width: 37, height: 51, color: "#5c1419",
    note: "64 ft 6 in Mk1 on BR1 bogies, in lined maroon: eight compartments, aluminium window frames",
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
    note: "Dapol 4F-011 / 4F-012: GWR planked ends with vents, diagonal strapping, white roof; 82 × 33 × 48 mm, 9 ft wheelbase",
    draw: (s) => drawVan(s, { length: 82, width: 33, height: 48, bodyHalf: 34.5, wheelbase: 36, top: 41.5, rise: 5.5, body: VAN_BROWN, diagonals: true, endVents: true, doors: [0], doorWidth: 16, marks: [{ x0: -32, x1: -20, z: 17, chars: 5 }] }),
  },
  {
    id: "lms-vent-van", maker: "", name: "LMS / BR 12 ton ventilated van, bauxite", group: "wagon", kind: "van",
    length: 82, width: 33, height: 48, color: "#7a4226",
    note: "The LMS design BR built in thousands: corrugated steel ends, plain planked sides, BR bauxite",
    draw: (s) => drawVan(s, { length: 82, width: 33, height: 48, bodyHalf: 34.5, wheelbase: 36, top: 41.5, rise: 5.5, body: BAUXITE, corrugatedEnds: true, endVents: true, doors: [0], doorWidth: 16, marks: [{ x0: -32, x1: -20, z: 17, chars: 6 }] }),
  },
  {
    id: "efe-gwr-fish", maker: "EFE Rail", name: "GWR 10T Bloater fish van", group: "wagon", kind: "van",
    length: 128, width: 32, height: 47, color: "#4d3024",
    note: "EFE Rail E87059: Diagram S9 No. 2603, GWR brown with the shirt-button roundel, three doors a side, shell roof ventilators; 128 mm",
    draw: (s) => drawVan(s, { length: 128, width: 32, height: 47, bodyHalf: 57, wheelbase: 92, top: 40.5, rise: 5, wheelR: 6.5, body: GWR_BROWN, diagonals: true, doors: [-36, 0, 36], doorWidth: 14, shellVents: [-36, 0, 36], emblem: { x: 0, z: 33.5, r: 3, col: GOLD }, marks: [{ x0: -54, x1: -46, z: 16, chars: 2 }, { x0: 45, x1: 54, z: 16, chars: 4 }] }),
  },
  {
    id: "br-toad", maker: "Oxford Rail", name: "GWR Toad brake van, BR grey", group: "wagon", kind: "brake",
    length: 103, width: 32, height: 50, color: "#888f88",
    note: "Oxford Rail OR76TOB003: W35717 in BR grey, lettered Basingstoke; the early 20 ft-bodied Toad. 103 mm, measured from the owner's model",
    draw: (s) => drawToad(s, { length: 103, width: 32, body: BR_GREY, roof: [0.8, 0.8, 0.77] }),
  },
  {
    id: "po-7plank", maker: "", name: "7-plank open wagon, private owner, with coal", group: "wagon", kind: "wagon",
    length: 82, width: 31, height: 33, color: "#80291c",
    note: "The colliery and coal merchants' wagon of the steam age: 7 planks, side door, a load of coal",
    draw: (s) => drawPlankOpen(s, { length: 82, width: 31, body: PO_RED, band: [0.42, 0.13, 0.09], load: true }),
  },
  {
    id: "br-16t-mineral", maker: "", name: "BR 16 ton mineral wagon", group: "wagon", kind: "wagon",
    length: 80, width: 31, height: 34, color: "#80807a",
    note: "BR's steel coal wagon, built by the quarter-million: pressed-steel sides, side and top flap doors, loaded",
    draw: (s) => drawMineral(s, { length: 80, width: 31, body: MINERAL_GREY, load: true }),
  },
  {
    id: "tank-14t", maker: "", name: "14 ton tank wagon, black", group: "wagon", kind: "tank",
    length: 85, width: 31, height: 46, color: "#1c1c1e",
    note: "A Class B tank wagon for oil: barrel on cradles, dome, ladders and tie bars",
    draw: (s) => drawTankWagon(s, { length: 85, width: 31, body: [0.1, 0.1, 0.11] }),
  },
  {
    id: "br-20t-brake", maker: "", name: "BR standard 20 ton brake van, bauxite", group: "wagon", kind: "brake",
    length: 107, width: 32, height: 48, color: "#7a4226",
    note: "BR's goods brake van: verandahs at both ends, long end platforms, duckets for the guard",
    draw: (s) => drawBRBrakeVan(s, { length: 107, width: 32, body: BAUXITE }),
  },
];

// ---------- European stock, H0 ----------
const EUROPE: Model[] = [
  {
    id: "db-br01", maker: "", name: "DB class 01 Pacific 2'C1'", group: "steam", kind: "loco", tender: "db-t32-tender", scale: "H0",
    length: 163, width: 36, height: 52.5, color: "#141414",
    note: "The German express Pacific in black and red, with big Wagner smoke deflectors: 2,000 mm drivers, 23.9 m over buffers with its tender",
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
    draw: h0(tender({
      length: 110, width: 35, height: 46, wheels: [37, 15, -15, -37], r: 5.75,
      body: { x0: -50, x1: 48, z0: 17, top: 41 }, outsideFrames: false,
      livery: { body: BLACK, frames: DB_RED, beams: DB_RED, lettering: { col: WHITE, x0: -6, x1: 6, z: 29, chars: 2 } },
    })),
  },
  {
    id: "db-br103", maker: "", name: "DB class 103 TEE electric", group: "electric", kind: "loco", scale: "H0",
    length: 224, width: 35.5, height: 51.6, color: "#941220",
    note: "The DB's flagship express electric in TEE red and beige: Co'Co', 200 km/h, 19.5 m over buffers",
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
    draw: h0((s) => drawClass218(s, { length: 188.5, width: 35.6, body: DB_WINE, stripe: [0.78, 0.78, 0.75] })),
  },
  {
    id: "db-silberling", maker: "", name: "DB n-Wagen 'Silberling', 2nd class", group: "coach", kind: "coach", scale: "H0",
    length: 303, width: 32.5, height: 46.6, color: "#b8bdc2",
    note: "The DB's local train coach: fluted stainless steel sides, two doors a side, Minden-Deutz bogies, 26.4 m over buffers",
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
    draw: h0((s) => drawBogieOpen(s, { length: 161, width: 34, height: 37, body: DB_BROWN, load: true })),
  },
  {
    id: "db-gbs", maker: "", name: "DB Gbs covered wagon", group: "wagon", kind: "van", scale: "H0",
    length: 181, width: 33, height: 46, color: "#733823",
    note: "The two-axle covered wagon of the DB, with big sliding doors and a 10 m wheelbase: 15.7 m over buffers",
    draw: h0((s) => drawVan(s, { length: 181, width: 33, height: 46, bodyHalf: 84, wheelbase: 115, top: 40.5, rise: 5, wheelR: 5.3, body: [0.45, 0.22, 0.14], roof: [0.55, 0.55, 0.53], doors: [0], doorWidth: 32, marks: [{ x0: -80, x1: -55, z: 18, chars: 10 }] })),
  },
  {
    id: "eu-tank-2axle", maker: "", name: "Two-axle tank wagon, silver", group: "wagon", kind: "tank", scale: "H0",
    length: 111, width: 34, height: 46.5, color: "#bdbfbd",
    note: "A Uerdingen-type two-axle tank wagon for mineral oil: a long barrel, dome, ladders and walkway",
    draw: h0((s) => drawTankWagon(s, { length: 111, width: 34, body: [0.74, 0.75, 0.74], bodyHalf: 48, r: 12.5, wheelbase: 57.5, wheelR: 5.3 })),
  },
];
MODELS.push(...EUROPE);

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
