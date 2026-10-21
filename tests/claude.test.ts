import { describe, expect, test } from "bun:test";
import { overlappingTrack } from "../src/checks";
import { addRectBoard, appendModule, createFlex, layGuides, newProject, placePart } from "../src/model";
import { buildSample } from "../src/sample";

describe("track laid twice", () => {
  test("the check finds track laid on top of other track", () => {
    const p = newProject();
    addRectBoard(p, 0, 0, 3000, 600);
    for (let i = 0; i < 3; i++) placePart(p, "hornby-oo/R603", { x: i * 670, y: 300, h: 0 });
    expect(overlappingTrack(p)).toEqual([]);
    createFlex(p, "peco-setrack-oo/SL-100", { x: 500, y: 300, h: 0, z: 0 }, [{ kind: "s", len: 900 }]);
    expect(overlappingTrack(p).length).toBe(3);   // it runs along all three straights
    expect(overlappingTrack(buildSample())).toEqual([]);
  });

  test("laying track on the guides leaves out guides that already have track along them", () => {
    const p = newProject();
    appendModule(p, "std-1200x600"); appendModule(p, "std-1200x600"); appendModule(p, "std-1200x600");
    for (const b of p.boards) { b.module!.tracks = 2; }
    const y = trackY(p);
    // sectional track along one track position, with no ends at the module joints
    for (let i = 0; i < 5; i++) placePart(p, "hornby-oo/R603", { x: i * 670, y, h: 0 });
    const r = layGuides(p, p.boards[1].id, "peco-setrack-oo/SL-100");
    expect(r.laid.length).toBe(1);
    expect(r.already).toBe(1);
  });
});

function trackY(p: ReturnType<typeof newProject>) {
  const { trackPorts } = require("../src/model");
  return Math.max(...trackPorts(p).map((q: any) => q.y));
}
