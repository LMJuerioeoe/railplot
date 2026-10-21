// The wiring plan: where the insulated rail joiners and the track feeds go on the plan, what to buy for
// the wiring, and a diagram of each controller with its drivers, boards and blocks.
import { dist, primAt } from "../geom";
import { Item, PartsRow, Project, geom, partOf } from "../model";
import { BLOCK_PINS, inputWhere, servoWhere, topology } from "./engine";
import { ControlConfig } from "./types";

/** Feeds no further apart than this along a block, so voltage doesn't drop through the rail joiners. */
export const FEED_SPACING = 1500;

export interface Joiner { x: number; y: number; h: number; item: string; why: "block" | "frog"; blocks?: [string, string] }
export interface Feed { block: string; item: string; x: number; y: number; h: number }

/** The insulated joiner each track system sells, and how many rails need one at a block joint. */
export function joinerPart(libId: string): { id: string; name: string; rails: number } {
  if (libId.startsWith("peco-")) return { id: "SL-11", name: "Peco insulated rail joiners, code 100 (pack of 12)", rails: 2 };
  if (libId === "hornby-oo") return { id: "R920", name: "Hornby insulated rail joiners (pack of 12)", rails: 2 };
  if (libId.startsWith("piko-")) return { id: "55291", name: "PIKO A-Gleis insulated rail joiners", rails: 2 };
  // Märklin's three-rail track runs on the centre stud contacts: a block joint cuts the centre rail only
  if (libId === "maerklin-c-h0") return { id: "joiner", name: "Märklin C centre-rail insulation (one per joint)", rails: 1 };
  return { id: "joiner", name: "Insulated rail joiners for this track system", rails: 2 };
}

const isElectrofrog = (it: Item) => partOf(it).def.type === "turnout" && /electrofrog/i.test(partOf(it).def.name);

/**
 * Insulated joiners: across both rails at every joint between two blocks, and on the two frog rails where
 * each road leaves an Electrofrog point, so its live frog can't short against the next track.
 */
export function joiners(p: Project, cfg: ControlConfig): Joiner[] {
  const out: Joiner[] = [];
  for (const b of topology(p, cfg).boundaries) {
    const it = p.items.find((i) => i.id === b.ends[0].item);
    if (!it) continue;
    const e = geom(it).ends[b.ends[0].end];
    out.push({ x: e.x, y: e.y, h: e.h, item: it.id, why: "block", blocks: [b.blocks[0], b.blocks[1]] });
  }
  for (const it of p.items) if (isElectrofrog(it)) {
    geom(it).ends.forEach((e, i) => {
      if (i === 0) return;   // the toe stays joined: the frog rails end at the other ends
      if (out.some((j) => dist(j, e) < 1)) return;
      out.push({ x: e.x, y: e.y, h: e.h, item: it.id, why: "frog" });
    });
  }
  return out;
}

function midpoint(it: Item) {
  const g = geom(it), r = g.routes[0];
  let t = (r?.length ?? 0) / 2;
  for (const pr of r?.prims ?? []) { if (t <= pr.len) return primAt(pr, t); t -= pr.len; }
  return { x: g.ends[0].x, y: g.ends[0].y, h: g.ends[0].h };
}

/**
 * Track feeds for each block: one on its longest plain piece, then more until every piece of the block is
 * within FEED_SPACING of a feed. Points are fed through their rails, so feeds go on plain track if it can.
 */
export function feeds(p: Project, cfg: ControlConfig): Feed[] {
  const out: Feed[] = [];
  for (const b of cfg.blocks) {
    const items = p.items.filter((i) => b.items.includes(i.id));
    if (!items.length) continue;
    const plain = items.filter((i) => partOf(i).def.type !== "turnout" && partOf(i).def.type !== "crossing");
    const pool = (plain.length ? plain : items).map((it) => ({ it, at: midpoint(it), len: geom(it).length }));
    const mine: Feed[] = [];
    const first = pool.reduce((a, c) => (c.len > a.len ? c : a));
    mine.push({ block: b.id, item: first.it.id, ...first.at });
    for (;;) {
      // the piece furthest from any feed, if it is too far
      const far = items.map((it) => ({ it, at: midpoint(it), d: Math.min(...mine.map((f) => dist(f, midpoint(it)))) })).sort((a, c) => c.d - a.d)[0];
      if (!far || far.d <= FEED_SPACING) break;
      const near = pool.reduce((a, c) => (dist(c.at, far.at) < dist(a.at, far.at) ? c : a));
      if (mine.some((f) => f.item === near.it.id)) break;
      mine.push({ block: b.id, item: near.it.id, ...near.at });
    }
    out.push(...mine);
  }
  return out;
}

const count = (n: number) => Math.max(0, Math.ceil(n));

/** What to buy for the wiring, as parts-list rows. */
export function wiringParts(p: Project, cfg: ControlConfig): PartsRow[] {
  const rows: PartsRow[] = [];
  const row = (key: string, id: string, name: string, n: number) => { if (n > 0) rows.push({ key: `wire|${key}`, priceKey: `wire|${key}`, producer: "Wiring", library: "~ Wiring", id, name, count: n }); };
  const js = joiners(p, cfg);
  // joiners by track system: the system of the piece at each joint
  const bySystem = new Map<string, number>();
  for (const j of js) {
    const it = p.items.find((i) => i.id === j.item);
    const lib = it ? partOf(it).lib.id : "";
    const jp = joinerPart(lib);
    bySystem.set(lib, (bySystem.get(lib) ?? 0) + (j.why === "frog" ? 1 : jp.rails));
  }
  for (const [lib, n] of bySystem) { const jp = joinerPart(lib); row(`joiner|${lib}`, jp.id, `${jp.name}: ${n} joiners`, jp.name.includes("pack of 12") ? Math.ceil(n / 12) : n); }
  const fs = feeds(p, cfg);
  row("droppers", "feed", "Track feed (dropper) pairs, red and black, soldered to the rails", fs.length);
  const frogs = p.items.filter(isElectrofrog).length;
  row("frog", "frog", "Electrofrog frog feeds: a wire from each frog to a changeover switch on its point motor or servo", frogs);
  // bus wire: from each feed to the middle of the layout's feeds and back, two wires, plus the drop under the board
  if (fs.length) {
    const c = { x: fs.reduce((a, f) => a + f.x, 0) / fs.length, y: fs.reduce((a, f) => a + f.y, 0) / fs.length };
    const metres = fs.reduce((a, f) => a + 2 * (dist(f, c) + 300), 0) / 1000;
    row("bus", "0.5 mm²", `Bus wire, red and black, 0.5 mm² or heavier: about ${Math.ceil(metres)} m in all`, Math.ceil(metres));
  }
  const esp = cfg.controllers.filter((x) => x.kind === "esp32");
  if (esp.length) {
    const onEsp = (id?: string) => esp.some((x) => x.id === id);
    row("esp32", "ESP32", "ESP32 development board (ESP32-WROOM-32 DevKitC)", esp.length);
    row("drv", "DRV8876", "Pololu DRV8876 motor driver carrier (#4036), one per block", cfg.blocks.filter((b) => onEsp(b.controller)).length);
    const sensors = cfg.sensors.filter((s) => onEsp(s.controller));
    row("ir", "TCRT5000", "Infrared reflective sensor module (TCRT5000)", sensors.length);
    row("mcp", "MCP23017", "MCP23017 16-input board, one per 16 sensors", count(sensors.length / 16) * (sensors.length ? 1 : 0));
    const points = cfg.points.filter((q) => onEsp(q.controller));
    row("servo", "MG90S", "Micro servo (MG90S or SG90) with 0.8 mm piano wire", points.length);
    row("pca-s", "PCA9685", "PCA9685 16-channel servo board, one per 16 points", count(points.length / 16));
    const leds = cfg.signals.flatMap((g) => [g.red, g.yellow, g.green]).filter((x) => x !== undefined).length + cfg.lights.length;
    row("pca-l", "PCA9685", "PCA9685 board for LEDs (address 0x44), one per 16 LEDs", count(leds / 16));
    row("psu", "12 V", "12 V DC power supply (2 A or more), fuse holder and 2 A fuse, 12 V to 5 V buck converter", esp.length);
  }
  return rows;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/**
 * A wiring diagram for each ESP32 controller: the power, the ESP32, each block's driver with its pins and
 * the block it feeds, and the sensor and servo boards on the I2C bus.
 */
export function wiringSvg(p: Project, cfg: ControlConfig): string {
  const esp = cfg.controllers.filter((x) => x.kind === "esp32");
  const fs = feeds(p, cfg);
  const W = 860, parts: string[] = [];
  let y = 20;
  const box = (x: number, yy: number, w: number, hh: number, title: string, lines: string[], fill = "#f4f1ea") => {
    parts.push(`<rect x="${x}" y="${yy}" width="${w}" height="${hh}" rx="6" fill="${fill}" stroke="#4a4540"/>`);
    parts.push(`<text x="${x + 8}" y="${yy + 18}" font-weight="600">${esc(title)}</text>`);
    lines.forEach((l, i) => parts.push(`<text x="${x + 8}" y="${yy + 36 + i * 15}" font-size="11">${esc(l)}</text>`));
  };
  const wire = (x1: number, y1: number, x2: number, y2: number, color: string) =>
    parts.push(`<path d="M${x1} ${y1}H${(x1 + x2) / 2}V${y2}H${x2}" fill="none" stroke="${color}" stroke-width="2"/>`);
  for (const c of esp) {
    const blocks = cfg.blocks.filter((b) => b.controller === c.id && b.channel !== undefined).sort((a, b) => a.channel! - b.channel!);
    const sensors = cfg.sensors.filter((s) => s.controller === c.id);
    const points = cfg.points.filter((q) => q.controller === c.id && q.servo !== undefined);
    const rowsH = Math.max(blocks.length * 64, 150);
    parts.push(`<text x="20" y="${y + 14}" font-size="15" font-weight="700">${esc(c.name)}${c.host ? ` (${esc(c.host)})` : ""}</text>`);
    y += 28;
    box(20, y, 170, 92, "12 V supply", ["→ 2 A fuse → drivers' VIN", "→ buck converter → 5 V", "All GND joined"], "#fbe9d0");
    box(20, y + 110, 170, 110, "ESP32", ["5V from the buck converter", "I2C: SDA GPIO21, SCL GPIO22", `${blocks.length} block driver${blocks.length === 1 ? "" : "s"}`, `${sensors.length} sensors, ${points.length} servos`], "#e3eef7");
    blocks.forEach((b, i) => {
      const pin = BLOCK_PINS[b.channel!];
      const by = y + i * 64;
      box(250, by, 250, 54, `Driver ${b.channel! + 1}: DRV8876`, pin ? [`EN GPIO${pin.en} · PH GPIO${pin.ph} · CS GPIO${pin.cs}`, "SLEEP 3.3 V · PMODE GND"] : ["Not an ESP32 driver"]);
      wire(190, y + 150, 250, by + 27, "#3a6ea5");
      wire(190, y + 30, 250, by + 10, "#c0392b");
      const n = fs.filter((f) => f.block === b.id).length;
      const len = p.items.filter((it) => b.items.includes(it.id)).reduce((a, it) => a + geom(it).length, 0);
      box(560, by, 280, 54, `Block ${b.name}`, [`OUT1 → near rail, OUT2 → far rail`, `${n} feed${n === 1 ? "" : "s"} · ${(len / 1000).toFixed(1)} m of track`], "#eef5e9");
      parts.push(`<rect x="556" y="${by}" width="6" height="54" fill="${esc(b.color)}"/>`);
      wire(500, by + 22, 560, by + 22, "#c0392b");
      wire(500, by + 34, 560, by + 34, "#222");
    });
    let ay = y + Math.max(rowsH, 230) + 10;
    if (sensors.length) {
      box(250, ay, 590, 40 + Math.min(sensors.length, 6) * 15, `Sensors (${sensors.length}) on MCP23017 boards`, [...sensors.slice(0, 6).map((s) => `${s.name}: ${s.input !== undefined ? inputWhere(s.input) : "no input chosen"}`), ...(sensors.length > 6 ? ["… and the rest in the wiring list"] : [])], "#f3ecf7");
      wire(190, y + 165, 250, ay + 20, "#7d3c98");
      ay += 50 + Math.min(sensors.length, 6) * 15;
    }
    if (points.length) {
      box(250, ay, 590, 40 + Math.min(points.length, 6) * 15, `Point servos (${points.length}) on PCA9685 boards`, [...points.slice(0, 6).map((q, i) => `Point ${i + 1} (${q.item}): ${servoWhere(q.servo!)}`), ...(points.length > 6 ? ["… and the rest in the wiring list"] : [])], "#fdf6e3");
      wire(190, y + 180, 250, ay + 20, "#7d3c98");
      ay += 50 + Math.min(points.length, 6) * 15;
    }
    y = ay + 20;
  }
  if (!esp.length) { parts.push(`<text x="20" y="40">Add an ESP32 controller in Set up to see its wiring.</text>`); y = 60; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="system-ui, sans-serif" font-size="13" fill="#222">` +
    `<rect width="100%" height="100%" fill="#fff"/>${parts.join("")}</svg>`;
}

