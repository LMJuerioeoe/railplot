import { describe, expect, test } from "bun:test";
import { dist } from "../src/geom";
import { geom, newProject, placePart, continuationEnd } from "../src/model";
import { getPart } from "../src/library";
import { buildControlDemo } from "../src/sample";
import { addBlock, addController, topology } from "../src/control/engine";
import { emptyControl } from "../src/control/types";
import { FEED_SPACING, feeds, joiners, wiringParts, wiringSvg } from "../src/control/wiringplan";

describe("wiring plan", () => {
  test("joiners at every block joint, and a feed within reach of every piece", () => {
    const p = buildControlDemo();
    const cfg = p.control!;
    const js = joiners(p, cfg);
    expect(js.length).toBe(topology(p, cfg).boundaries.length);
    expect(js.every((j) => j.why === "block")).toBe(true);
    const fs = feeds(p, cfg);
    for (const b of cfg.blocks) {
      const mine = fs.filter((f) => f.block === b.id);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      for (const id of b.items) {
        const it = p.items.find((i) => i.id === id)!;
        const g = geom(it);
        expect(Math.min(...mine.map((f) => Math.min(...g.ends.map((e) => dist(e, f)))))).toBeLessThanOrEqual(FEED_SPACING + g.length);
      }
    }
  });

  test("an Electrofrog point gets joiners on its frog rails, and the shopping list counts packs", () => {
    const p = newProject();
    let at = { x: 0, y: 0, h: 0, z: 0 };
    for (const k of ["peco-setrack-oo/ST-200", "peco-streamline-oo/SL-E92", "peco-setrack-oo/ST-200"]) {
      const it = placePart(p, k, at);
      at = { ...geom(it).ends[continuationEnd(getPart(k)!, 0)] };
    }
    const cfg = emptyControl();
    addController(cfg, "esp32", "railplot.local");
    addBlock(cfg, p.items.map((i) => i.id));
    const js = joiners(p, cfg);
    expect(js.filter((j) => j.why === "frog").length).toBe(2);
    const rows = wiringParts(p, cfg);
    expect(rows.find((r) => r.id === "SL-11")?.count).toBe(1);
    expect(rows.find((r) => r.id === "frog")?.count).toBe(1);
    expect(rows.find((r) => r.id === "DRV8876")?.count).toBe(1);
    expect(wiringSvg(p, cfg)).toContain("Driver 1: DRV8876");
  });
});
