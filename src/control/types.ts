// Layout control: the wiring of a real layout to controllers, saved with the plan.

/** One ESP32 controller board, a DCC-EX command station, or the built-in simulator. */
export interface Controller {
  id: string;
  name: string;
  kind: "esp32" | "dccex" | "sim";
  /**
   * ESP32: host name or IP address, e.g. "railplot.local" or "192.168.4.1". Empty: the device this page was opened from.
   * DCC-EX over the network: "192.168.4.1" or "192.168.4.1:2560". DCC-EX over USB through the hub: a serial port, e.g. "/dev/ttyACM0".
   */
  host: string;
  /** DCC-EX only: "usb" (Web Serial in Chrome/Edge, or a serial port on the hub) or "net" (TCP, through the hub). */
  conn?: "usb" | "net";
  /** DCC-EX only: the cab number for track A; track B gets the next one, and so on. */
  cabBase?: number;
}

/** An electrically separate section of track fed by one block driver. */
export interface Block {
  id: string;
  name: string;
  color: string;
  items: string[];          // track piece ids
  controller?: string;
  channel?: number;         // block driver 0-5 on that controller
}

/** A point (turnout) worked by a servo. */
export interface PointCfg {
  item: string;             // track piece id
  controller?: string;
  servo?: number;           // servo output number (PCA9685 0x40 is 0-15, 0x41 is 16-31, ...)
  us: number[];             // servo pulse for each route, microseconds (route 0 = straight)
  state: number;            // route currently set
}

/** A train detector (infrared sensor) at the boundary between two blocks. */
export interface Sensor {
  id: string;
  name: string;
  x: number; y: number;
  blocks: [string, string];
  controller?: string;
  input?: number;           // input number (MCP23017 0x20 is 0-15, 0x21 is 16-31, ...)
}

export type SignalMode = "auto" | "stop";
/** A colour-light signal guarding the way from one block into the next. */
export interface SignalCfg {
  id: string;
  name: string;
  x: number; y: number; h: number;
  from: string; to: string;  // block ids
  controller?: string;
  red?: number; yellow?: number; green?: number;   // LED output numbers (PCA9685 0x44 is 0-15, ...)
  mode: SignalMode;
}

/** A building, street or platform light. */
export interface LightCfg {
  id: string;
  name: string;
  controller?: string;
  output?: number;
  on: boolean;
  level: number;            // brightness 1-100 %
}

export interface TrainCfg {
  id: string;
  name: string;
  color: string;
  block?: string;           // where the train is
  maxSpeed: number;         // % of full track voltage at full throttle
  minSpeed: number;         // % that just gets it moving
  momentum: number;         // seconds from stop to full speed
}

/** A route: several points set together with one tap. */
export interface RouteCfg {
  id: string;
  name: string;
  points: { item: string; state: number }[];
}

/** One step of an automation. Speeds are % of the throttle, negative for backwards. */
export type Step =
  | { do: "drive"; speed: number }                       // set the throttle and carry on
  | { do: "waitBlock"; block: string; via?: string[] }   // until the train has moved into a block (only along `via`, if given)
  | { do: "arrive"; speed: number; after: number }        // slow down, stop within this block after `after` seconds
  | { do: "stop" }                                         // throttle to zero and wait until stopped
  | { do: "wait"; sec: number }
  | { do: "waitFree"; block: string }                     // until no other train is in or heading into a block
  | { do: "route"; route: string }
  | { do: "point"; item: string; state: number }
  | { do: "signal"; signal: string; mode: SignalMode }
  | { do: "light"; light: string; on: boolean };

/** A little program for one train: a shuttle, a timetable run, a station stop. */
export interface AutomationCfg {
  id: string;
  name: string;
  train?: string;
  steps: Step[];
  loop: boolean;
}

export interface ControlConfig {
  controllers: Controller[];
  blocks: Block[];
  points: PointCfg[];
  sensors: Sensor[];
  signals: SignalCfg[];
  lights: LightCfg[];
  trains: TrainCfg[];
  routes?: RouteCfg[];
  automations?: AutomationCfg[];
  /** Through a Railplot hub, let Claude set routes, points, signals and lights, drive trains and run automations (never track power). */
  claude?: boolean;
  nextId: number;
}

export const BLOCK_CHANNELS = 6;   // block drivers per ESP32 controller board
export const DCCEX_TRACKS = 8;     // TrackManager outputs A-H on a DCC-EX command station
export const DCCEX_PORT = 2560;
export const DCCEX_CAB_BASE = 9001;

/** How many block drivers a controller has. */
export function channelsOf(c: Controller | undefined): number {
  return c?.kind === "dccex" ? DCCEX_TRACKS : BLOCK_CHANNELS;
}

/** Name of a block driver on a controller: "Driver 1" on an ESP32, "Track A" on DCC-EX. */
export function channelName(c: Controller | undefined, ch: number): string {
  return c?.kind === "dccex" ? `Track ${String.fromCharCode(65 + ch)}` : `Driver ${ch + 1}`;
}

export function emptyControl(): ControlConfig {
  return { controllers: [], blocks: [], points: [], sensors: [], signals: [], lights: [], trains: [], routes: [], automations: [], nextId: 1 };
}

export const BLOCK_COLORS = ["#2f7fb3", "#b7652b", "#5b8f3a", "#8a4fa6", "#b03a5b", "#2f9a8f", "#9a7b18", "#4d5fb8", "#a0522d", "#3c8d5a"];
export const TRAIN_COLORS = ["#d2452c", "#2a74c9", "#e0a12a", "#2c9a5a", "#9b4fc2", "#d0408a", "#1f9bb0", "#7a8c1e", "#c56a1b", "#5a5fcf"];
