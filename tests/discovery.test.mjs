import test from "node:test";
import assert from "node:assert/strict";
import { Stash } from "../service/stash.mjs";
function fixture(reply) {
  const calls = [];
  return {
    calls,
    stash: new Stash({
      fetchImpl: async (_url, o) => {
        const call = JSON.parse(o.body);
        calls.push(call);
        return { ok: true, json: async () => ({ data: reply(call) }) };
      },
    }),
  };
}
test("compound all/exclusion/presence criteria are parameterized AND clauses", async () => {
  const f = fixture(() => ({
    findScenes: { count: 80, scenes: [{ id: "1" }] },
  }));
  const r = await f.stash.findScenes({
    relationships: [
      { kind: "tags", match: "all", ids: ["1", "2"] },
      { kind: "tags", match: "none", ids: ["3"] },
      { kind: "groups", match: "present" },
      { kind: "studios", match: "missing" },
    ],
    page: 2,
    limit: 5,
  });
  let c = f.calls[0].variables.scene;
  assert.equal(c.AND.tags.modifier, "INCLUDES_ALL");
  assert.equal(c.AND.AND.tags.modifier, "EXCLUDES");
  assert.equal(c.AND.AND.AND.groups.modifier, "NOT_NULL");
  assert.equal(r.count, 80);
  assert.equal(r.hasMore, true);
});
test("multiple Authors reports candidate paging and never invents exact count", async () => {
  const f = fixture(() => ({
    findScenes: {
      count: 100,
      scenes: [
        { id: "1", groups: [{ group: { id: "1" } }, { group: { id: "2" } }] },
        { id: "2", groups: [] },
      ],
    },
  }));
  const r = await f.stash.findScenes({ multipleAuthors: true, limit: 2 });
  assert.equal(r.count, null);
  assert.equal(r.candidateCount, 100);
  assert.deepEqual(
    r.scenes.map((s) => s.id),
    ["1"],
  );
  assert.equal(r.hasMore, true);
});
for (const [name, rows, count, status] of [
  ["Alex", [{ id: "1", name: "Alex" }], 1, "exact"],
  ["alex", [{ id: "1", name: "Alex" }], 1, "case_insensitive"],
  [
    "Alex",
    [
      { id: "1", name: "Alex" },
      { id: "2", name: "Alex" },
    ],
    2,
    "ambiguous",
  ],
  ["Alex", [], 0, "no_match"],
])
  test("resolution " + status, async () => {
    const f = fixture(() => ({ findTags: { count, tags: rows } })),
      r = await f.stash.findEntities({ kind: "tags", name, resolve: true });
    assert.equal(r.resolution, status);
  });
test("similar candidates do not silently become exact; truncation explicit", async () => {
  const f = fixture((c) => ({
    findGroups: c.variables.entity.name
      ? { count: 0, groups: [] }
      : { count: 100, groups: [{ id: "1", name: "Alexandra" }] },
  }));
  const r = await f.stash.findEntities({
    kind: "groups",
    name: "Alex",
    resolve: true,
  });
  assert.equal(r.resolution, "similar_only");
  assert.equal(r.complete, false);
  assert.equal(r.hasMore, true);
});
test("invalid authoritative entity ID reported without creating entity", async () => {
  const f = fixture(() => ({ e0: null }));
  const r = await f.stash.findEntities({ kind: "studios", id: "999" });
  assert.equal(r.resolution, "invalid_id");
});
test("cross-entity missing Franchise and scene totals explicitly scoped", async () => {
  const f = fixture(() => ({
    findGroups: { count: 2, groups: [{ id: "1", name: "A", scene_count: 9 }] },
  }));
  const r = await f.stash.findEntities({
    kind: "groups",
    scenesMissingFranchise: true,
    includeSceneCount: true,
  });
  assert.equal(
    f.calls[0].variables.entity.scenes_filter.studios.modifier,
    "IS_NULL",
  );
  assert.match(r.countScope, /total/);
  assert.equal(r.complete, false);
});
test("unsupported filters, duplicate IDs and malformed null criteria rejected", async () => {
  const f = fixture(() => ({}));
  for (const args of [
    { relationships: [] },
    { relationships: [{ kind: "tags", match: "all", ids: ["1", "1"] }] },
    { relationships: [{ kind: "groups", match: "missing", ids: [] }] },
    { relationships: [{ kind: "custom_fields", match: "present" }] },
    { rawQuery: "mutation" },
  ])
    await assert.rejects(f.stash.findScenes(args));
  assert.equal(f.calls.length, 0);
});
