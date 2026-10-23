import { expect, test } from "bun:test";
import { buildSample } from "../src/sample";
import { OVERLAP, PAGE, cuttingList, templatePages } from "../src/print";
import { geom } from "../src/model";

test("the 1:1 template pages cover every piece of track, overlap, and leave out pages with no track", () => {
  const p = buildSample();
  const pages = templatePages(p);
  expect(pages.length).toBeGreaterThan(4);
  for (const it of p.items) {
    const b = geom(it).bounds;
    // every corner of every piece's box is on some page
    for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY], [b.maxX, b.minY]])
      expect(pages.some((q) => x >= q.b.minX && x <= q.b.maxX && y >= q.b.minY && y <= q.b.maxY)).toBe(true);
  }
  for (const q of pages) { expect(q.b.maxX - q.b.minX).toBeCloseTo(PAGE.w); expect(q.b.maxY - q.b.minY).toBeCloseTo(PAGE.h); }
  const a1 = pages.find((q) => q.label === "A1"), a2 = pages.find((q) => q.label === "A2");
  if (a1 && a2) expect(a1.b.maxX - a2.b.minX).toBeCloseTo(OVERLAP);
  // the middle of the oval has no track, so fewer pages than the whole grid
  const cols = Math.max(...pages.map((q) => q.col)) + 1, rows = Math.max(...pages.map((q) => q.row)) + 1;
  expect(pages.length).toBeLessThan(cols * rows);
  // just a few pieces: just their pages
  expect(templatePages(p, new Set([p.items[0].id])).length).toBeLessThanOrEqual(4);
});

test("the cutting list gives each baseboard's size", () => {
  const p = buildSample();
  const rows = cuttingList(p);
  expect(rows.length).toBe(p.boards.length);
  expect(rows[0].w).toBeGreaterThan(1000);
  expect(rows[0].rect).toBe(true);
});
