// Detailed rolling stock: real models, drawn from their prototypes' dimensions at OO scale (1:76.2).
// Each model describes itself with a few shapes in millimetres; the 3D view turns them into a mesh.
// Coordinates: x along the vehicle (+ is its front), y across it (+ is its left), z up from the rail top.
import { VehicleCfg, VehicleKind } from "../control/types";

export type RGB = [number, number, number];

/** What a model is drawn with. */
export interface Shapes {
  /** An upright box. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: RGB): void;
  /** A round bar along the vehicle: a boiler, a smokebox. */
  barX(x0: number, x1: number, y: number, z: number, r: number, col: RGB): void;
  /** A round bar across it: a wheel, seen from the side. */
  barY(x: number, y0: number, y1: number, z: number, r: number, col: RGB): void;
  /** A round bar upright: a chimney, a safety valve. */
  barZ(x: number, y: number, z0: number, z1: number, r: number, col: RGB): void;
  /** A flat strip on a side face (y = ±face), from one point to another: strapping, handrails, lettering panels. */
  strip(face: number, x0: number, z0: number, x1: number, z1: number, width: number, col: RGB): void;
  /** An arched roof from x0 to x1, its eaves at ±half wide and zEave high, rising `rise` in the middle. */
  roof(x0: number, x1: number, half: number, zEave: number, rise: number, col: RGB): void;
}

export interface Model {
  id: string;
  maker: string;
  name: string;
  /** What it is, for the simulator: a loco drives, a brake van is a brake van. */
  kind: VehicleKind;
  /** Over buffers, across the body, rail to the highest point (mm). */
  length: number;
  width: number;
  height: number;
  /** Livery colour, for the Trains dialog and the train's chip. */
  color: string;
  note: string;
  draw(s: Shapes): void;
}

// colours
const GWR_GREEN: RGB = [0.1, 0.25, 0.14], BLACK: RGB = [0.07, 0.07, 0.08], BUFFER_RED: RGB = [0.72, 0.13, 0.07];
const STEEL: RGB = [0.62, 0.63, 0.64], BRASS: RGB = [0.78, 0.6, 0.24], COAL: RGB = [0.04, 0.04, 0.045], GLASS: RGB = [0.2, 0.24, 0.27];
const UNDER: RGB = [0.1, 0.1, 0.1], WHITE_ROOF: RGB = [0.86, 0.86, 0.83], GWR_BROWN: RGB = [0.3, 0.19, 0.14];
const VAN_BROWN: RGB = [0.37, 0.23, 0.16], BR_GREY: RGB = [0.53, 0.56, 0.53], HANDRAIL: RGB = [0.92, 0.92, 0.9];

const darker = (c: RGB, k = 0.7): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** Buffers: a beam across each end and two buffers on it. */
function buffers(s: Shapes, half: number, beam: RGB, z = 9) {
  for (const e of [1, -1]) {
    const a = e * (half - 6), b = e * (half - 3.5), c = e * half;
    s.box(Math.min(a, b), Math.max(a, b), -15, 15, z - 3, z + 3, beam);
    for (const y of [-9.5, 9.5]) s.barX(Math.min(b, c), Math.max(b, c), y, z, 2.2, STEEL);
  }
}

/** A four-wheeled wagon's underframe: solebars, axleboxes and wheels at ±wheelbase/2. */
function wagonUnderframe(s: Shapes, half: number, wheelbase: number, r = 6.1) {
  s.box(-half + 4, half - 4, -14, 14, 7, 11, UNDER);                       // solebars and floor
  for (const x of [-wheelbase / 2, wheelbase / 2]) {
    for (const y of [-1, 1]) s.barY(x, y * 12.5, y * 14, r, r, BLACK);    // wheels, inside the solebars
    s.barY(x, -8, 8, r, 1, STEEL);                                       // axle
    for (const y of [-1, 1]) s.box(x - 3, x + 3, y * 14, y * 16, 6, 11, UNDER);   // axleboxes and springs
  }
}

/** Vertical planking and strapping on both sides of a van body. */
function vanSides(s: Shapes, x0: number, x1: number, half: number, z0: number, z1: number, strap: RGB, diagonals: boolean) {
  for (const face of [half, -half]) {
    s.strip(face, x0, z0 + 0.5, x1, z0 + 0.5, 1, strap);                  // bottom rail
    s.strip(face, x0, z1 - 0.5, x1, z1 - 0.5, 1, strap);                  // top rail
    for (const x of [x0 + 0.6, x1 - 0.6, (x0 + x1) / 2]) s.strip(face, x, z0, x, z1, 1.2, strap);   // corner and door posts
    if (diagonals) {
      const q = (x1 - x0) / 4;
      s.strip(face, x0 + 1, z0 + 1, x0 + q * 1.6, z1 - 1, 1, strap);
      s.strip(face, x1 - 1, z0 + 1, x1 - q * 1.6, z1 - 1, 1, strap);
    }
  }
}

/** The same shapes the other way round along the vehicle (x to -x). */
function mirrored(s: Shapes): Shapes {
  return {
    box: (x0, x1, y0, y1, z0, z1, c) => s.box(-x1, -x0, y0, y1, z0, z1, c),
    barX: (x0, x1, y, z, r, c) => s.barX(-x1, -x0, y, z, r, c),
    barY: (x, y0, y1, z, r, c) => s.barY(-x, y0, y1, z, r, c),
    barZ: (x, y, z0, z1, r, c) => s.barZ(-x, y, z0, z1, r, c),
    strip: (f, x0, z0, x1, z1, w, c) => s.strip(f, -x0, z0, -x1, z1, w, c),
    roof: (x0, x1, half, ze, rise, c) => s.roof(-x1, -x0, half, ze, rise, c),
  };
}

export const MODELS: Model[] = [
  {
    id: "dapol-51xx", maker: "Dapol", name: "GWR 51xx Large Prairie 2-6-2T", kind: "loco",
    length: 164, width: 35, height: 51, color: "#1a4024",
    note: "GWR green with black smokebox and red buffer beams, as 5134",
    draw(s) {
      // frames, footplate and buffer beams
      s.box(-74, 74, -7, 7, 4, 13, BLACK);
      s.box(-78, 78, -17.5, 17.5, 13, 15, BLACK);
      s.box(74, 78, -16, 16, 6, 13, BUFFER_RED); s.box(-78, -74, -16, 16, 6, 13, BUFFER_RED);
      for (const e of [1, -1]) for (const y of [-9.5, 9.5]) s.barX(Math.min(e * 78, e * 82), Math.max(e * 78, e * 82), y, 9.5, 2.3, STEEL);
      // smokebox, boiler and Belpaire firebox
      s.barX(52, 70, 0, 33, 10.6, BLACK);
      s.box(55, 70, -10, 10, 15, 24, BLACK);                               // smokebox saddle
      s.barX(18, 52, 0, 33, 10.2, GWR_GREEN);
      s.box(2, 19, -11.5, 11.5, 22, 44, GWR_GREEN);
      s.roof(2, 19, 11.5, 44, 1.8, GWR_GREEN);
      s.barZ(63, 0, 40, 50.5, 3.1, BLACK);                                  // chimney
      s.barZ(63, 0, 49.5, 51, 3.8, BLACK);
      s.barZ(26, 0, 41, 47.5, 2.8, BRASS);                                  // safety valve bonnet
      // side tanks, cab, bunker and coal
      s.box(10, 50, 10.5, 17.5, 15, 38, GWR_GREEN); s.box(10, 50, -17.5, -10.5, 15, 38, GWR_GREEN);
      s.box(-34, 2, -17.5, 17.5, 15, 46.5, GWR_GREEN);
      s.box(-31, -1, -17.6, 17.6, 33, 42, GLASS);                            // cab side openings
      s.box(-28, -4, -16.5, 16.5, 32.5, 43, darker(GWR_GREEN, 0.4));
      s.box(-36, 4, -17.8, 17.8, 46.5, 48.5, BLACK);                         // cab roof
      s.roof(-36, 4, 17.8, 48.5, 2.4, BLACK);
      s.box(-73, -34, -16.5, 16.5, 15, 38, GWR_GREEN);
      s.box(-70, -36, -15, 15, 38, 42, COAL);
      s.box(-2, 3, -6, -1, 38, 44, GLASS); s.box(-2, 3, 1, 6, 38, 44, GLASS);   // spectacle plates
      // brass number plates on the cab sides, safety lining on the tanks
      for (const face of [17.6, -17.6]) {
        s.strip(face, -21, 24, -11, 24, 3.5, BRASS);
        s.strip(face, 11, 17, 49, 17, 0.5, BRASS); s.strip(face, 11, 36, 49, 36, 0.5, BRASS);
      }
      // outside cylinders and the wheels: pony, three coupled drivers, trailing pony
      for (const y of [-1, 1]) s.box(54, 72, y * 10, y * 16, 6, 16, BLACK);
      for (const [x, r] of [[62, 6.3], [34, 11.3], [8, 11.3], [-18, 11.3], [-54, 6.3]] as const) {
        for (const y of [-1, 1]) { s.barY(x, y * 12, y * 14.5, r, r, GWR_GREEN); s.barY(x, y * 14.4, y * 14.8, r, r - 1.2, BLACK); }
      }
      for (const y of [-1, 1]) s.box(-19, 35, y * 15, y * 16.2, 6.5, 8.5, STEEL);     // coupling rods
      for (const y of [-1, 1]) s.box(8, 54, y * 16.2, y * 17, 10.5, 12, STEEL);       // connecting rods, to the crosshead
    },
  },
  {
    id: "dapol-10t-van", maker: "Dapol", name: "10 ton van", kind: "van",
    length: 84, width: 32, height: 46, color: "#5e3a29",
    note: "Brown with a white roof and diagonal strapping, 9 ft wheelbase",
    draw(s) {
      buffers(s, 42, UNDER);
      wagonUnderframe(s, 42, 36);
      s.box(-35, 35, -16, 16, 11, 40, VAN_BROWN);
      vanSides(s, -35, 35, 16, 11, 40, darker(VAN_BROWN, 0.6), true);
      for (const e of [1, -1]) s.box(e > 0 ? 34.5 : -35.2, e > 0 ? 35.2 : -34.5, -15, 15, 12, 40, darker(VAN_BROWN, 0.8));   // end planking
      s.roof(-36, 36, 16.5, 40, 5.5, WHITE_ROOF);
    },
  },
  {
    id: "efe-gwr-fish", maker: "EFE Rail", name: "GWR Fish van (Bloater)", kind: "van",
    length: 130, width: 32, height: 47, color: "#4d3024",
    note: "GWR brown, white roof, long wheelbase, lettered Fish Bloater",
    draw(s) {
      buffers(s, 65, UNDER);
      wagonUnderframe(s, 65, 94, 6.5);
      for (const y of [-1, 1]) s.box(-26, 26, y * 6, y * 8, 2.5, 7, UNDER);   // V-hangers and brake gear
      s.box(-58, 58, -16, 16, 11, 40.5, GWR_BROWN);
      vanSides(s, -58, 58, 16, 11, 40.5, darker(GWR_BROWN, 0.55), false);
      for (const face of [16, -16]) {
        for (const x of [-30, 30]) s.strip(face, x, 12, x, 40, 1, darker(GWR_BROWN, 0.55));
        s.strip(face, -6, 34, 6, 34, 1.6, WHITE_ROOF);                         // the GWR roundel and lettering, as pale panels
        s.strip(face, -52, 14, -40, 14, 2.2, WHITE_ROOF);
        s.strip(face, 44, 15, 54, 15, 2.2, WHITE_ROOF);
      }
      s.roof(-59, 59, 16.5, 40.5, 6, WHITE_ROOF);
      for (const x of [-30, 0, 30]) s.box(x - 1.5, x + 1.5, -1.5, 1.5, 46, 47, darker(WHITE_ROOF, 0.8));   // roof vents
    },
  },
  {
    id: "br-toad", maker: "", name: "GWR Toad brake van, BR grey", kind: "brake",
    length: 106, width: 32, height: 50, color: "#888f88",
    note: "20 ton brake van with a verandah at one end, BR grey, lettered Basingstoke",
    draw(front) {
      const s = mirrored(front);   // drawn verandah-first, but it runs verandah last, at the tail of the train
      buffers(s, 53, UNDER);
      wagonUnderframe(s, 53, 72, 6.3);
      s.box(-50, 50, -15.5, 15.5, 11, 13, UNDER);                            // floor and verandah deck
      s.box(-47, 17, -16, 16, 13, 40.5, BR_GREY);                            // the closed body
      vanSides(s, -47, 17, 16, 13, 40.5, darker(BR_GREY, 0.7), false);
      for (const face of [16, -16]) {
        s.strip(face, -45, 26, 15, 26, 0.9, HANDRAIL);                       // white handrails along the body
        s.strip(face, -20, 34, -6, 34, 1.4, HANDRAIL);                       // depot lettering, as a pale panel
        s.box(-31, -25, face > 0 ? 16 : -16.3, face > 0 ? 16.3 : -16, 30, 37, GLASS);   // side window
      }
      s.box(17, 18, -9, 9, 13, 38, darker(BR_GREY, 0.85));                   // verandah door into the body
      // verandah: corner posts, end handrails, and the roof carried over it
      for (const y of [-14.5, 14.5]) {
        s.box(48, 50, y - 1, y + 1, 13, 40.5, BR_GREY);
        s.box(17, 50, y - 0.5, y + 0.5, 25, 26.5, HANDRAIL);
        s.box(17, 50, y - 0.5, y + 0.5, 18, 19, HANDRAIL);
      }
      s.box(48.5, 49.5, -14, 14, 25, 26.5, HANDRAIL);
      s.box(48, 50, -15.5, 15.5, 13, 18, BR_GREY);
      s.roof(-48.5, 51, 16.5, 40.5, 6, darker(WHITE_ROOF, 0.92));
      s.barZ(-36, 6, 44, 49.5, 1.8, BLACK);                                  // stove chimney
      s.box(-8, -3, -15.5, 15.5, 13, 18, darker(BR_GREY, 0.8));              // sandboxes
    },
  },
];

export const modelById = (id: string | undefined) => MODELS.find((m) => m.id === id);

/** A vehicle of a model. */
export function vehicleOfModel(m: Model, id: string): VehicleCfg {
  return { id, kind: m.kind, model: m.id, name: m.maker ? `${m.maker} ${m.name}` : m.name, length: m.length, color: m.color, detectable: m.kind === "loco" };
}
