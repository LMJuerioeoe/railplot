import { describe, expect, test } from "bun:test";
import { layoutIssues } from "../src/checks";
import { newProject, placePart, geom, continuationEnd } from "../src/model";
import { getPart } from "../src/library";
import { buildSample } from "../src/sample";
import { roads, trainFit } from "../src/trainfit";

function chain(p: ReturnType<typeof newProject>, steps: [string, boolean][]) {
  let at = { x: 0, y: 0, h: 0, z: 0 };
  for (const [k, mirror] of steps) {
    const it = placePart(p, k, at, 0, mirror);
    at = { ...geom(it).ends[continuationEnd(getPart(k)!, 0)] };
  }
}

describe("train fit", () => {
  test("the sample's two loop roads and the main line between its points", () => {
    const r = roads(buildSample());
    expect(r.map((x) => x.kind)).toEqual(["loop", "loop", "loop"]);
    expect(r.map((x) => Math.round(x.length)).sort((a, b) => a - b)).toEqual([670, 680, 3758]);
  });

  test("loops shorter than the train, with room to clear the points, are reported", () => {
    const p = buildSample();
    expect(trainFit(p, { length: 600, vehicle: 0 })).toEqual([]);
    const short = trainFit(p, { length: 700, vehicle: 0 });
    expect(short.map((i) => i.kind)).toEqual(["short-road", "short-road"]);
    p.train = { length: 700, vehicle: 0 };
    expect(layoutIssues(p).filter((i) => i.kind === "train-fit").length).toBe(2);
  });

  test("a siding ends at the end of the line", () => {
    const p = newProject();
    chain(p, [["peco-setrack-oo/ST-241", false], ["peco-setrack-oo/ST-200", false]]);
    expect(roads(p).map((r) => r.kind)).toEqual(["siding"]);
  });

  test("tight curves for long vehicles, and reverse curves with no straight between", () => {
    const p = newProject();
    chain(p, [["peco-setrack-oo/ST-220", false], ["peco-setrack-oo/ST-220", true]]);
    const kinds = trainFit(p, { length: 300, vehicle: 300 }).map((i) => i.kind);
    expect(kinds).toContain("tight-curve");
    expect(kinds).toContain("s-bend");
    // the same curves one after the other, the same way round, are no S-bend
    const q = newProject();
    chain(q, [["peco-setrack-oo/ST-220", false], ["peco-setrack-oo/ST-220", false]]);
    expect(trainFit(q, { length: 300, vehicle: 300 }).map((i) => i.kind)).toEqual(["tight-curve"]);
    // and a straight between them cures it
    const s = newProject();
    chain(s, [["peco-setrack-oo/ST-220", false], ["peco-setrack-oo/ST-201", false], ["peco-setrack-oo/ST-220", true]]);
    expect(trainFit(s, { length: 300, vehicle: 300 }).map((i) => i.kind)).toEqual(["tight-curve"]);
  });

  test("blocks shorter than the train", () => {
    const p = buildSample();
    p.control = { controllers: [], blocks: [{ id: "B1", name: "Loop", color: "#f00", items: ["t28", "t32", "t31"] }], points: [], sensors: [], signals: [], lights: [], trains: [], routes: [], automations: [], nextId: 2 } as any;
    expect(trainFit(p, { length: 800, vehicle: 0 }).some((i) => i.kind === "short-block")).toBe(true);
  });
});
