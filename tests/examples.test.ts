import { describe, expect, test } from "bun:test";
import { EXAMPLES, buildExample, trackFits } from "../src/examples";
import { analyze, moduleJoints, motorsOverFrame, partOf, partsList } from "../src/model";

const libs = ["peco-setrack-oo", "hornby-oo", "piko-a-h0"];
const freeEnds: Record<string, number> = { "inglenook-shelf": 4, "traverser-plank": 4, "l-shaped": 6 };

describe("example shunting layouts", () => {
  for (const ex of EXAMPLES) for (const lib of libs) {
    test(`${ex.name} in ${lib}`, () => {
      const p = buildExample(ex.id, lib);
      const an = analyze(p);
      expect(trackFits(p)).toBe(true);                       // all on the boards, clear of the edges
      expect(an.bad.length).toBe(0);                          // every joint lines up
      expect(an.free.length).toBe(freeEnds[ex.id]);           // only the sidings' ends are open
      expect(motorsOverFrame(p)).toEqual([]);                 // no point motor over a frame member
      expect(moduleJoints(p)).toBe(p.boards.length - 1);      // the boards are joined in one run
      expect(p.boards.length).toBeGreaterThanOrEqual(ex.baseBoards);
      expect(p.items.every((i) => partOf(i).lib.id === lib || partOf(i).def.type === "flex")).toBe(true);
      expect(partsList(p).some((r) => r.id === "joint") || p.boards.length === 1).toBe(true);
    });
  }
  test("Setrack and Hornby fit on the boards named; PIKO A's longer points need more", () => {
    for (const ex of EXAMPLES) expect(buildExample(ex.id, "peco-setrack-oo").boards.length).toBe(ex.baseBoards);
    expect(buildExample("inglenook-shelf", "piko-a-h0").boards.length).toBe(2);
  });
  test("each example is worked out once, then copied", () => {
    const a = buildExample("l-shaped", "hornby-oo"), b = buildExample("l-shaped", "hornby-oo");
    expect(a).not.toBe(b);
    expect(a.items.length).toBe(b.items.length);
  });
});
