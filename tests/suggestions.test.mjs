import test from "node:test";
import assert from "node:assert/strict";
import { Suggestions, SUGGESTION_TTL } from "../service/suggestions.mjs";

function fixture({
  scenes = [],
  count = 0,
  missing = [],
  unavailable = false,
  failure = false,
} = {}) {
  let now = 1000,
    reads = 0,
    queries = 0;
  const adapter = {
    async read(key, args) {
      reads++;
      assert.equal(key, "descriptors");
      assert.deepEqual(args, { pending: true, page: 1, limit: 12 });
      if (unavailable) return { status: "unavailable" };
      return {
        status: "available",
        scenes,
        candidateCount: 9000,
        matchingCount: null,
      };
    },
  };
  const stash = {
    async query(query, variables, options) {
      queries++;
      assert.ok(!query.includes("mutation"));
      assert.ok(query.includes("per_page:3"));
      assert.ok(!query.includes("title"));
      assert.deepEqual(variables, {});
      assert.equal(options.timeoutMs, 8000);
      if (failure) throw Error("private error");
      return { findScenes: { count, scenes: missing } };
    },
  };
  const service = new Suggestions(stash, adapter, { now: () => now });
  return {
    service,
    counts: () => [reads, queries],
    expire: () => {
      now += SUGGESTION_TTL;
    },
  };
}
test("review findings use owner flags, not descriptors or candidate totals", async () => {
  const f = fixture({
    scenes: [
      {
        sceneId: "1",
        autoTaggerNeedsReview: true,
        needsDescriptorReview: true,
      },
      {
        sceneId: "2",
        autoTaggerNeedsReview: false,
        needsDescriptorReview: true,
      },
      {
        sceneId: "3",
        autoTaggerNeedsReview: false,
        needsDescriptorReview: false,
        descriptors: ["not completion"],
      },
    ],
  });
  const result = await f.service.get();
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.equal(item.count, 1);
    assert.equal(item.countScope, "candidate-page-only");
    assert.ok(item.verified);
    assert.equal(item.expiresAt - item.observedAt, SUGGESTION_TTL);
    assert.match(item.prompt, /Re-read/);
  }
  assert.match(result.items[1].trigger, /not proof/);
  assert.ok(!JSON.stringify(result).includes("9000"));
});
test("Franchise absence is an exact query count but only a possible gap", async () => {
  const result = await fixture({
    count: 40,
    missing: [{ id: "7", studio: null }],
  }).service.get();
  assert.equal(result.items[0].count, 40);
  assert.equal(result.items[0].category, "possible-gap");
  assert.equal(result.items[0].countScope, "exact-query-total");
  assert.deepEqual(result.items[0].sceneIds, ["7"]);
  assert.match(result.items[0].trigger, /intentional/);
});
test("missing owner does not prevent native suggestions", async () => {
  const result = await fixture({
    unavailable: true,
    count: 1,
    missing: [{ id: "7", studio: null }],
  }).service.get();
  assert.equal(result.items.length, 1);
  assert.equal(result.sources[0].state, "unavailable");
});
test("native failure does not prevent owner findings or expose raw errors", async () => {
  const result = await fixture({
    failure: true,
    scenes: [{ sceneId: "7", needsDescriptorReview: true }],
  }).service.get();
  assert.equal(result.items.length, 1);
  assert.equal(result.sources[1].state, "unavailable");
  assert.ok(!JSON.stringify(result).includes("private error"));
});
test("no observations and unavailable checks stay distinct", async () => {
  for (const unavailable of [false, true]) {
    const result = await fixture({
      unavailable,
      failure: unavailable,
    }).service.get();
    assert.deepEqual(result.items, []);
    assert.ok(
      result.sources.every(
        (s) => s.state === (unavailable ? "unavailable" : "available"),
      ),
    );
  }
});
test("coalesces reads, reuses short cache, expires without unbounded scans", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.service.get(), f.service.get()]);
  assert.equal(a, b);
  await f.service.get();
  assert.deepEqual(f.counts(), [1, 1]);
  f.expire();
  assert.notEqual(await f.service.get(), a);
  assert.deepEqual(f.counts(), [2, 2]);
});
for (const missing of [
  [{ id: "7", studio: { id: "1" } }],
  [{ id: "<script>write()</script>", studio: null }],
  [
    { id: "7", studio: null },
    { id: "7", studio: null },
  ],
  Array.from({ length: 4 }, (_, i) => ({ id: String(i + 1), studio: null })),
])
  test(
    "invalid native evidence is unavailable, not an invented suggestion " +
      JSON.stringify(missing),
    async () => {
      const result = await fixture({ count: 10, missing }).service.get();
      assert.equal(result.items.length, 0);
      assert.equal(result.sources[1].state, "unavailable");
    },
  );
