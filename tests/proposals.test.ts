import { describe, expect, test } from "bun:test";
import { addRectBoard, appendModule, newProject, placePart, moveItems, Project } from "../src/model";
import { parseProject, serialize } from "../src/io";
import { applyProposal, describeProposal, diffProposal, isEmptyProposal, mergeProposals, rejectProposal, staleIds, withProposal } from "../src/proposals";
import { buildSample } from "../src/sample";

const copy = (p: Project) => parseProject(serialize(p));

function base() {
  const p = newProject("Test");
  addRectBoard(p, 0, 0, 1200, 600, "Board");
  placePart(p, "peco-setrack-oo/ST-200", { x: 100, y: 300, h: 0 });
  placePart(p, "peco-setrack-oo/ST-200", { x: 268, y: 300, h: 0 });
  return p;
}

describe("proposals", () => {
  test("a diff records adds, changes and removals, and applying it gives the changed plan", () => {
    const p = base();
    const q = copy(p);
    placePart(q, "peco-setrack-oo/ST-201", { x: 436, y: 300, h: 0 });
    moveItems(q, [q.items[0].id], 0, 10);
    q.items = q.items.filter((i) => i.id !== p.items[1].id);
    q.name = "Renamed";
    const pr = diffProposal(p, q, "Tidy", "because");
    expect(pr.add.items.length).toBe(1);
    expect(pr.change.items.map((i) => i.id)).toEqual([p.items[0].id]);
    expect(pr.remove).toEqual([p.items[1].id]);
    expect(pr.before.items.length).toBe(2);
    expect(pr.rename).toBe("Renamed");
    expect(describeProposal(pr)).toBe("adds 1 piece of track, changes 1 piece of track, removes 1 piece of track and renames the plan “Renamed”");
    p.proposals = [pr];
    const r = applyProposal(p, pr);
    expect(r.ok).toBe(true);
    expect(p.proposals).toBeUndefined();
    expect(serialize({ ...p, nextId: 0 })).toBe(serialize({ ...q, nextId: 0 }));
  });

  test("nothing changed is an empty proposal", () => {
    const p = base();
    expect(isEmptyProposal(diffProposal(p, copy(p), "x"))).toBe(true);
  });

  test("stale when what it changes has changed since; force applies it anyway", () => {
    const p = base();
    const q = copy(p);
    moveItems(q, [q.items[0].id], 50, 0);
    const pr = diffProposal(p, q, "Move");
    p.proposals = [pr];
    moveItems(p, [p.items[0].id], 0, 5);         // the owner moved it meanwhile
    expect(staleIds(p, pr)).toEqual([p.items[0].id]);
    const r = applyProposal(p, pr);
    expect(r.ok).toBe(false);
    expect(p.proposals?.length).toBe(1);
    expect(applyProposal(p, pr, true).ok).toBe(true);
    expect(p.items[0].x).toBeCloseTo(q.items[0].x);
  });

  test("new objects get fresh ids when the plan has used theirs meanwhile", () => {
    const p = base();
    const q = copy(p);
    const added = placePart(q, "peco-setrack-oo/ST-200", { x: 600, y: 300, h: 0 });
    const pr = diffProposal(p, q, "Add one");
    const clash = placePart(p, "peco-setrack-oo/ST-200", { x: 0, y: 0, h: 0 });   // same id as Claude's
    expect(clash.id).toBe(added.id);
    const r = applyProposal(p, pr);
    expect(r.ok).toBe(true);
    expect(new Set(p.items.map((i) => i.id)).size).toBe(p.items.length);
    expect(r.ids[0]).not.toBe(added.id);
    expect(p.nextId).toBeGreaterThan(Math.max(...p.items.map((i) => +i.id.slice(1))));
  });

  test("modules, layers and the preview copy", () => {
    const p = newProject();
    const q = copy(p);
    appendModule(q, "std-1200x600"); appendModule(q, "corner45-600");
    q.layers.push({ id: "L9", name: "Sidings", visible: true });
    const pr = diffProposal(p, q, "Boards");
    expect(describeProposal(pr)).toBe("adds 2 baseboards and 1 layer");
    const w = withProposal(p, pr);
    expect(w.boards.length).toBe(2);
    expect(p.boards.length).toBe(0);
  });

  test("reject takes it off the list; merge keeps unseen arrivals only", () => {
    const p = buildSample();
    const q = copy(p);
    moveItems(q, [q.items[0].id], 10, 0);
    const a = diffProposal(p, q, "A"), b = diffProposal(p, q, "B");
    p.proposals = [a, b];
    rejectProposal(p, a.id);
    expect(p.proposals!.map((x) => x.id)).toEqual([b.id]);
    const seen = new Set([a.id, b.id]);
    const c = diffProposal(p, q, "C");
    expect(mergeProposals(p.proposals, [a, b, c], seen).map((x) => x.title)).toEqual(["B", "C"]);
  });

  test("proposals survive saving and opening", () => {
    const p = base();
    const q = copy(p);
    placePart(q, "peco-setrack-oo/ST-200", { x: 600, y: 300, h: 0 });
    p.proposals = [diffProposal(p, q, "Keep me")];
    expect(parseProject(serialize(p)).proposals?.[0].title).toBe("Keep me");
  });
});
