// The sample layout shown on first launch: an OO Setrack oval with a passing loop.
import { biarc, dist, normAngle } from "./geom";
import { geom, addRectBoard, continuationEnd, createFlex, newProject, placePart, setHeightAt, Project, Item } from "./model";
import { getPart } from "./library";
import { addAutomation, addBlock, addController, addLight, addRoute, addSensorsAtBoundaries, addSignal, addTrain, syncPoints, topology } from "./control/engine";
import { tripPaths, tripSteps } from "./control/auto";
import { emptyControl } from "./control/types";

export function buildSample(): Project {
  const p = newProject("Sample OO oval with passing loop");
  addRectBoard(p, 0, 0, 2050, 1150, "Baseboard");
  let at = { x: 520, y: 150, h: 0, z: 0 };
  const chain = (key: string, k = 0, mirror = false): Item => {
    const it = placePart(p, key, at, k, mirror);
    const next = continuationEnd(getPart(key)!, k);
    const e = geom(it).ends[next];
    at = { x: e.x, y: e.y, h: e.h, z: e.z };
    return it;
  };
  const lh = chain("peco-setrack-oo/ST-241");
  chain("peco-setrack-oo/ST-201");
  chain("peco-setrack-oo/ST-201");
  // right-hand turnout facing back: join its straight end, continue from the toe
  const rh = chain("peco-setrack-oo/ST-240", 1);
  // the back of the oval climbs 20 mm (about 1.5%) so the plan shows gradients and supports
  const RISE = 20;
  const heights: { at: { x: number; y: number }; z: number }[] = [];
  for (let i = 0; i < 8; i++) { chain("peco-setrack-oo/ST-225"); heights.push({ at: { ...at }, z: (RISE * (i + 1)) / 8 }); }
  for (const s of ["ST-200", "ST-201", "ST-200", "ST-201"]) { chain(`peco-setrack-oo/${s}`); heights.push({ at: { ...at }, z: RISE }); }
  for (let i = 0; i < 8; i++) { chain("peco-setrack-oo/ST-225"); heights.push({ at: { ...at }, z: RISE * (1 - (i + 1) / 8) }); }

  // loop: a reverse curve off each turnout's diverging leg, joined by flex
  const leg = (t: Item) => {
    const e = geom(t).ends[2];
    const opts = [false, true].map((m) => {
      const it = placePart(p, "peco-setrack-oo/ST-225", { ...e, z: 0 }, 0, m);
      const end = geom(it).ends[1];
      p.items.pop();
      return { m, end };
    });
    const best = opts.sort((a, b) => Math.abs(Math.sin(a.end.h)) - Math.abs(Math.sin(b.end.h)))[0];
    placePart(p, "peco-setrack-oo/ST-225", { ...e, z: 0 }, 0, best.m);
    return best.end;
  };
  const a = leg(lh), b = leg(rh);
  const start = { x: a.x, y: a.y, h: a.h };
  const segs = biarc(start, b, normAngle(b.h + Math.PI));
  if (segs && dist(a, b) > 1) {
    createFlex(p, "peco-setrack-oo/SL-100", { ...start, z: 0 }, segs);
  }
  for (const hgt of heights) setHeightAt(p, hgt.at, hgt.z);
  p.name = "Sample OO oval with passing loop";
  return p;
}

/** The sample layout split into four blocks, with sensors, signals and two trains on the simulator. */
export function buildControlDemo(): Project {
  const p = buildSample();
  p.name = "Two-train control demo";
  const cfg = emptyControl();
  const sim = addController(cfg, "sim");
  const kind = (id: string) => p.items.find((i) => i.id === id)!;
  const pts = p.items.filter((i) => i.part.endsWith("ST-240") || i.part.endsWith("ST-241"));
  const minX = Math.min(...pts.map((i) => geom(i).bounds.minX)), maxX = Math.max(...pts.map((i) => geom(i).bounds.maxX));
  const cx = (it: Item) => (geom(it).bounds.minX + geom(it).bounds.maxX) / 2;
  const isLoop = (it: Item) => it.part.endsWith("SL-100") || (it.part.endsWith("ST-225") && geom(it).bounds.maxY < 260 && cx(it) > minX && cx(it) < maxX);
  const station = p.items.filter((i) => !isLoop(i) && geom(i).bounds.maxY < 200 && geom(i).bounds.minX >= minX - 1 && geom(i).bounds.maxX <= maxX + 1);
  const loop = p.items.filter(isLoop);
  const rest = p.items.filter((i) => !station.includes(i) && !loop.includes(i));
  const mid = (minX + maxX) / 2;
  const east = rest.filter((i) => (geom(i).bounds.minX + geom(i).bounds.maxX) / 2 > mid);
  const west = rest.filter((i) => !east.includes(i));
  const S = addBlock(cfg, station.map((i) => i.id), "Station");
  const L = addBlock(cfg, loop.map((i) => i.id), "Loop");
  const E = addBlock(cfg, east.map((i) => i.id), "East");
  const W = addBlock(cfg, west.map((i) => i.id), "West");
  for (const b of cfg.blocks) b.controller = sim.id;
  cfg.blocks.forEach((b, i) => (b.channel = i));
  syncPoints(p, cfg);
  addSensorsAtBoundaries(p, cfg);
  const topo = topology(p, cfg);
  for (const [from, to] of [[W.id, S.id], [E.id, S.id]] as const) {
    const bnd = topo.boundaries.find((b) => b.blocks.includes(from) && b.blocks.includes(to));
    if (!bnd) continue;
    const i = bnd.blocks.indexOf(from);
    const it = kind(bnd.ends[i].item);
    addSignal(p, cfg, { x: bnd.x, y: bnd.y }, from, to, geom(it).ends[bnd.ends[i].end].h);
  }
  const t1 = addTrain(cfg, L.id, "Goods train");
  const t2 = addTrain(cfg, E.id, "Express");
  t1.maxSpeed = 60; t2.maxSpeed = 90;
  for (const x of [...cfg.points, ...cfg.sensors, ...cfg.signals]) x.controller = sim.id;
  addLight(cfg, "Station lights").controller = sim.id;
  // routes: both points one way or the other
  addRoute(cfg, "Main line", cfg.points.map((q) => ({ item: q.item, state: 0 })));
  addRoute(cfg, "Into the loop", cfg.points.map((q) => ({ item: q.item, state: 1 })));
  // an automation: the goods train shuttles from the loop to the West block and back
  const topo2 = topology(p, cfg);
  const out = tripPaths(p, cfg, topo2, L.id, W.id)[0], back = tripPaths(p, cfg, topo2, W.id, L.id)[0];
  if (out && back) {
    const o = { slow: 30, after: 1.5 };
    addAutomation(cfg, "Goods shuttle", t1.id, [
      ...tripSteps(out, { speed: 70, ...o }), { do: "wait", sec: 5 },
      ...tripSteps(back, { speed: -70, ...o }), { do: "wait", sec: 5 },
    ], true);
  }
  p.control = cfg;
  return p;
}
