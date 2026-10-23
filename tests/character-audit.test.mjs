import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inventory,
  comparePasses,
  coverage,
  historicalCompatible,
  noCompletedRemovals,
  escapeHtml,
  csvCell,
} from "../scripts/lib/character-audit.mjs";
test("CSV quotes embedded delimiters/newlines and neutralizes formulas", () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  for (const text of ["=1+1", "+1", "-2", "@SUM(A1)", "\tformula"])
    assert.ok(csvCell(text).startsWith("\"'"));
  assert.equal(csvCell("plain name"), '"plain name"');
});
test("bounded inventory visits all pages and empty inventory", async () => {
  const a = await inventory(
    async (p) => ({
      count: 3,
      rows: (p === 1 ? ["1", "2"] : ["3"]).map((id) => ({ id })),
    }),
    2,
  );
  assert.equal(a.pages, 2);
  assert.equal(a.rows.length, 3);
  assert.equal(
    (await inventory(async () => ({ count: 0, rows: [] }))).count,
    0,
  );
});
for (const [name, pages, error] of [
  [
    "count drift",
    [
      { count: 2, rows: [{ id: "1" }] },
      { count: 3, rows: [{ id: "2" }] },
    ],
    "COUNT_DRIFT",
  ],
  [
    "duplicate",
    [
      { count: 2, rows: [{ id: "1" }] },
      { count: 2, rows: [{ id: "1" }] },
    ],
    "DUPLICATE",
  ],
  [
    "missing page",
    [
      { count: 2, rows: [{ id: "1" }] },
      { count: 2, rows: [] },
    ],
    "INCOMPLETE",
  ],
  ["oversized", [{ count: 2, rows: [{ id: "1" }, { id: "2" }] }], "PAGE_LIMIT"],
])
  test(name, async () => {
    await assert.rejects(
      inventory(async (p) => pages[p - 1], 1),
      new RegExp(error),
    );
  });
test("two-pass drift includes changed, added and missing rows", () =>
  assert.deepEqual(
    comparePasses(
      [{ id: "1", name: "a" }, { id: "2" }],
      [{ id: "1", name: "b" }, { id: "3" }],
    ),
    ["1", "2", "3"],
  ));
test("coverage includes zero-tag scenes and verifies SQL join", () => {
  const scenes = [
      { id: "1", tags: [] },
      { id: "2", tags: [{ id: "3" }] },
    ],
    tags = [{ id: "3" }];
  assert.equal(
    coverage(scenes, tags, [{ scene_id: 2, tag_id: 3 }]).untaggedScenes,
    1,
  );
  assert.throws(() => coverage(scenes, tags, []), /MISMATCH/);
  assert.throws(() => coverage(scenes, []), /DANGLING/);
});
test("old association evidence cannot survive independent metadata drift", () => {
  const s = {
    id: "1",
    title: "Specific identity",
    files: [{ basename: "a.mp4" }],
    tags: [],
  };
  assert(
    historicalCompatible(s, { ...s, tags: [{ id: "2" }], updated_at: "later" }),
  );
  assert(!historicalCompatible(s, { ...s, title: "Changed" }));
  assert(!historicalCompatible(s, { ...s, files: [{ basename: "b.mp4" }] }));
});
test("completed removal pairs cannot be reproposed", () => {
  assert(
    noCompletedRemovals(
      [{ sceneId: "1", stageA: { remove: ["3"] } }],
      [{ sceneId: "1", remove: ["2"] }],
    ),
  );
  assert.throws(
    () =>
      noCompletedRemovals(
        [{ sceneId: "1", stageA: { remove: ["2"] } }],
        [{ sceneId: "1", remove: ["2"] }],
      ),
    /REPROPOSED/,
  );
});
test("HTML evidence escapes hostile names rather than rendering markup", () =>
  assert.equal(
    escapeHtml("<img onerror=\"x\"> & 'name'"),
    "&lt;img onerror=&quot;x&quot;&gt; &amp; &#39;name&#39;",
  ));
