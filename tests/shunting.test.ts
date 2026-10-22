import { describe, expect, test } from "bun:test";
import { newProject } from "../src/model";
import { DEFAULT_WAGONS, INGLENOOK, deal, planSidings } from "../src/shunting";
import { buildYard, wagonLength } from "../src/yards";

describe("shunting sessions", () => {
  test("every wagon is placed once, no siding is overfilled, and the train fits where it's made up", () => {
    for (let seed = 1; seed < 200; seed++) {
      const d = deal(8, INGLENOOK, 5, seed);
      expect(d.start.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      d.start.forEach((s, i) => expect(s.length).toBeLessThanOrEqual(INGLENOOK[i].capacity));
      expect(d.train.length).toBe(5);
      expect(new Set(d.train).size).toBe(5);
      expect(d.into).toBe(0);
    }
  });

  test("the same card set deals the same cards", () => {
    expect(deal(8, INGLENOOK, 5, 1234)).toEqual(deal(8, INGLENOOK, 5, 1234));
    expect(deal(8, INGLENOOK, 5, 1234)).not.toEqual(deal(8, INGLENOOK, 5, 1235));
    expect(() => deal(12, INGLENOOK, 5, 1)).toThrow();
    expect(DEFAULT_WAGONS.length).toBe(8);
  });

  test("an Inglenook built on the plan gives three sidings, the longest for five wagons, and leaves out the headshunt", () => {
    const p = newProject();
    const lib = "peco-setrack-oo";
    buildYard(p, lib, { kind: "inglenook", roads: 3, side: 1, length: 0, wagon: wagonLength(lib), headshunt: 300 }, { x: 0, y: 0, h: 0 });
    const s = planSidings(p, wagonLength(lib));
    expect(s.length).toBe(3);
    expect(s[0].capacity).toBe(5);
    expect(s[2].capacity).toBe(3);
  });
});
