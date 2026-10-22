import test from "node:test";
import assert from "node:assert/strict";
import { reviewScenes } from "../service/review-plans.mjs";
import {
  assessScene,
  reviewFeedback,
  reviewSummary,
  operationFeedback,
  validateReview,
} from "../service/review-policy.mjs";
import { Presentations } from "../service/presentations.mjs";
import { searchCapabilities } from "../service/search-capabilities.mjs";
import { Proposals } from "../service/proposals.mjs";
import { TOOLS, dispatchTool } from "../service/tools.mjs";
import { Runtime } from "../service/runtime.mjs";
import vm from "node:vm";
import fs from "node:fs/promises";
const window = {};
vm.runInNewContext(
  await fs.readFile(
    new URL("../plugin/collection-refinement.js", import.meta.url),
    "utf8",
  ),
  { window },
);
const ui = window.StashAICollectionRefinement;
const stamp = "2026-10-20T10:00:00Z";
const row = (extra = {}) => ({
  sceneId: "1",
  status: "available",
  authors: [],
  franchise: null,
  characters: { presence: "absent", completeness: "complete" },
  descriptors: { needsReview: true, autoTaggerNeedsReview: true },
  ...extra,
});
function fixture(count = 1, settings = {}) {
  const calls = [];
  const records = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      String(i + 1),
      {
        id: String(i + 1),
        title: "<script>untrusted</script>",
        updated_at: stamp,
        groups: [],
        tags: settings.tags || [],
        studio: null,
        files: [],
        paths: {
          screenshot: `http://localhost:9999/scene/${i + 1}/screenshot`,
        },
      },
    ]),
  );
  const stash = {
    url: "http://localhost:9999/graphql",
    query: async (query, variables) => {
      calls.push(["native", query]);
      assert.ok(!/mutation/.test(query));
      if (settings.nativeFailure) throw Error("PRIVATE ERROR");
      return Object.fromEntries(
        Object.values(variables).map((id, i) => ["s" + i, records[id] || null]),
      );
    },
    getSceneState: async (id) => structuredClone(records[id]),
    entitiesByIds: async (_, ids) =>
      ids.map((id) => ({ id, name: "Existing franchise" })),
    updateApproved: async (input) => {
      calls.push(["fixture-write", input]);
      if (settings.writeFailure) throw Error("fixture write uncertain");
      const s = records[input.id];
      if ("studio_id" in input)
        s.studio = { id: input.studio_id, name: "Existing franchise" };
      s.updated_at = "2026-10-20T11:00:00Z";
    },
  };
  const adapters = {
    read: async (kind, { sceneIds }) => {
      calls.push([kind]);
      if (settings.ownerFailure) throw Error("PRIVATE OWNER ERROR");
      return {
        status: "available",
        scenes: sceneIds.map((sceneId) => ({
          sceneId,
          status: "available",
          updatedAt: settings.stale ? "old" : records[sceneId]?.updated_at,
          assignedTagCount: settings.tags?.length || 0,
          characterTagIds: [],
          presence: settings.tags?.length ? "unknown" : "absent",
          completeness: settings.tags?.length ? "partial" : "complete",
          unclassifiedCount: settings.tags?.length || 0,
          needsDescriptorReview: true,
          autoTaggerNeedsReview: false,
          descriptors: { acts: [], endings: [] },
          persistedStatus: null,
        })),
      };
    },
  };
  return { stash, adapters, calls, records };
}
for (const count of [1, 5, 20])
  test(`review ${count} scenes in three bounded batches without model media or writes`, async () => {
    const f = fixture(count);
    const result = await reviewScenes(f.stash, f.adapters, {
      sceneIds: Object.keys(f.records),
    });
    assert.equal(result.summary.inspected, count);
    assert.equal(result.summary.confirmedGaps, count);
    assert.equal(result.summary.ownerReview, count);
    assert.equal(f.calls.length, 3);
    assert.equal(result.nextActions.readyToCorrect, false);
    assert.ok(
      !/screenshot|<script>|paths|untrusted/.test(JSON.stringify(result.scenes)),
    );
    result.scenes.forEach((s) => validateReview(s.review));
  });
for (const args of [
  { sceneIds: [] },
  { sceneIds: ["1", "1"] },
  { sceneIds: Array.from({ length: 21 }, (_, i) => String(i + 1)) },
  { sceneIds: ["1"], findings: ["wrong"] },
  { sceneIds: ["1"], checks: ["variants"] },
  { sceneIds: ["<script>"] },
])
  test(
    "reject invented or invalid review input " + JSON.stringify(args),
    async () => {
      const f = fixture();
      await assert.rejects(reviewScenes(f.stash, f.adapters, args));
      assert.equal(f.calls.length, 0);
    },
  );
for (const settings of [
  { ownerFailure: true },
  { nativeFailure: true },
  { stale: true },
  { tags: [{ id: "9", name: "unknown" }] },
])
  test(
    "review failure/uncertainty is not absence " + JSON.stringify(settings),
    async () => {
      const f = fixture(1, settings);
      const r = await reviewScenes(f.stash, f.adapters, {
        sceneIds: ["1", "99"],
      });
      assert.ok(r.scenes[1].review.checks.every((c) => c.state === "unknown"));
      const checks = r.scenes[0].review.checks;
      if (settings.tags)
        assert.equal(
          checks.find((c) => c.key === "missing-characters").state,
          "unknown",
        );
      if (!settings.tags)
        assert.equal(
          checks.find((c) => c.key === "descriptor-review").state,
          "unknown",
        );
      assert.ok(!JSON.stringify(r).includes("PRIVATE"));
    },
  );
test("multiple categories overlap; no confirmed issue is not complete evidence", () => {
  const good = row({
    authors: [{ id: "2" }],
    franchise: { id: "3" },
    characters: { presence: "present", completeness: "complete" },
    descriptors: { needsReview: false, autoTaggerNeedsReview: false },
  });
  const summary = reviewSummary(
    [row(), good, row({ status: "unavailable" })].map((s) => ({
      review: assessScene(s),
    })),
  );
  assert.equal(summary.confirmedGaps, 1);
  assert.equal(summary.ownerReview, 1);
  assert.equal(summary.incompleteEvidence, 1);
  assert.equal(summary.noConfirmedIssue, 2);
  assert.equal(summary.countsOverlap, true);
  const clear = reviewFeedback(assessScene(good), good, stamp, stamp);
  assert.ok(clear.checks.every((c) => c.action === "none"));
});
for (const status of ["available", "unavailable", "not_found"])
  test("historical review survives current " + status, () => {
    const old = assessScene(row());
    const encoded = JSON.stringify(old);
    const feedback = reviewFeedback(
      old,
      row({
        status,
        franchise: { id: "2" },
        characters: { presence: "present", completeness: "complete" },
      }),
      stamp,
      "later",
    );
    assert.equal(
      feedback.checks.find((c) => c.key === "missing-franchise").outcome,
      status === "available" ? "no-longer-observed" : "current-unavailable",
    );
    assert.equal(
      feedback.checks.find((c) => c.key === "descriptor-review").outcome,
      status === "available" ? "still-observed" : "current-unavailable",
    );
    assert.equal(JSON.stringify(old), encoded);
  });
test("review receipt publishes only completed final, survives restart; invented fields denied", async () => {
  let saved;
  const store = {
    read: async (_, fallback) => structuredClone(saved || fallback),
    write: async (_, value) => {
      saved = structuredClone(value);
    },
  };
  const p = new Presentations(store);
  await p.init();
  const turn = { turnId: "turn", messageId: "final" };
  const f = fixture();
  const result = p.record(
    turn,
    { tool: "review_scenes", turnId: "turn", callId: "read" },
    await reviewScenes(f.stash, f.adapters, { sceneIds: ["1"] }),
  );
  const args = {
    turnId: "turn",
    arguments: {
      sourceId: result.presentationSource.sourceId,
      sceneIds: ["1"],
    },
  };
  assert.throws(() =>
    p.select(turn, {
      ...args,
      arguments: { ...args.arguments, review: { ready: true } },
    }),
  );
  p.select(turn, args);
  for (const status of ["failed", "interrupted"])
    await p.finish({ id: "thread", owner: "owner" }, turn, {
      id: "turn",
      status,
    });
  assert.equal(p.records.length, 0);
  await p.finish({ id: "thread", owner: "owner" }, turn, {
    id: "turn",
    status: "completed",
  });
  await p.finish({ id: "thread", owner: "owner" }, turn, {
    id: "turn",
    status: "completed",
  });
  const restored = new Presentations(store);
  await restored.init();
  assert.equal(restored.records.length, 1);
  assert.deepEqual(
    restored.records[0].scenes[0].review,
    result.scenes[0].review,
  );
  assert.throws(() =>
    restored.context("other", "thread", {
      type: "selection",
      collectionId: p.records[0].id,
      sceneIds: ["1"],
    }),
  );
  saved.collections[0].scenes[0].review.checks[0].authority = "model";
  const corrupt = new Presentations(store);
  await corrupt.init();
  assert.equal(corrupt.available, false);
});
test("existing proposal engine applies only fixture correction; fresh checks resolve only target condition", async () => {
  const f = fixture(2);
  const before = await reviewScenes(f.stash, f.adapters, {
    sceneIds: ["1", "2"],
  });
  const proposals = new Proposals({
    stash: f.stash,
    store: { read: async () => [], write: async () => {} },
    writesEnabled: true,
  });
  await proposals.init();
  await proposals.prepare("owner", "thread", {
    sceneIds: ["1"],
    operations: [
      { relationship: "studio", action: "assign", toId: "8", expectedId: null },
    ],
  });
  assert.equal(f.calls.filter((c) => c[0] === "fixture-write").length, 0);
  const p = proposals.list("owner", "thread")[0];
  const approved = await proposals.decision("owner", "thread", {
    id: p.id,
    decision: "approve",
    integrity: p.integrity,
  });
  assert.equal(approved.status, "verified");
  await proposals.decision("owner", "thread", {
    id: p.id,
    decision: "approve",
    integrity: p.integrity,
  });
  assert.equal(f.calls.filter((c) => c[0] === "fixture-write").length, 1);
  const fresh = await reviewScenes(f.stash, f.adapters, {
    sceneIds: ["1", "2"],
  });
  assert.equal(before.scenes[0].review.checks[1].state, "observed");
  assert.equal(fresh.scenes[0].review.checks[1].state, "not-observed");
  assert.equal(fresh.scenes[1].review.checks[1].state, "observed");
  assert.equal(fresh.scenes[0].review.checks[4].state, "observed");
  assert.equal(
    operationFeedback(proposals.list("owner", "thread"), "2").length,
    0,
  );
});
for (const status of [
  "rejected",
  "expired",
  "uncertain",
  "partial_or_uncertain",
  "stale",
  "verified",
  "reconciled",
])
  test("operation feedback does not resolve findings for " + status, () => {
    const result = operationFeedback(
      [{ id: "p", status, rows: [{ id: "1" }] }],
      "1",
    );
    assert.equal(result[0].status, status);
    assert.ok(!("resolved" in result[0]));
    assert.equal(
      operationFeedback([{ id: "p", status, rows: [{ id: "1" }] }], "2").length,
      0,
    );
  });
test("operation feedback reports expiry without altering the journal", () => {
  const p = {
    id: "p",
    status: "pending",
    expiresAt: 10,
    rows: [{ id: "1", outcome: "eligible" }],
  };
  assert.equal(operationFeedback([p], "1", 11)[0].status, "expired");
  assert.equal(p.status, "pending");
});
test("batch verification never marks excluded or unexecuted rows verified", () => {
  const p = {
    id: "p",
    status: "partial_or_uncertain",
    rows: [
      { id: "1", outcome: "eligible" },
      { id: "2", outcome: "conflict" },
      { id: "3", outcome: "no_op" },
      { id: "4", outcome: "eligible" },
    ],
    results: [{ id: "1", status: "verified" }],
  };
  assert.equal(operationFeedback([p], "1")[0].sceneStatus, "verified");
  assert.equal(operationFeedback([p], "2")[0].sceneStatus, "conflict");
  assert.equal(operationFeedback([p], "3")[0].sceneStatus, "no_op");
  assert.equal(operationFeedback([p], "4")[0].sceneStatus, "not-executed");
});
test("catalog and runtime keep review read-only and old conversations unchanged", async () => {
  await assert.rejects(
    dispatchTool({
      name: "review_scenes",
      args: { sceneIds: ["1"] },
      toolSchema: 7,
      toolNames: TOOLS.map((t) => t.name),
    }),
    /TOOL_DENIED/,
  );
  const runtime = new Runtime({ tools: TOOLS });
  assert.match(runtime.options(8).developerInstructions, /Guided review/);
  assert.doesNotMatch(
    runtime.options(7).developerInstructions,
    /Guided review/,
  );
  assert.equal(TOOLS.filter((t) => t.name === "review_scenes").length, 1);
});
test("preflight maps exact/bounded/scene-only/unsupported without executing or dropping criteria", () => {
  const names = TOOLS.map((t) => t.name),
    caps = searchCapabilities(names, names, 8);
  const rows = ui.preflight(
    {
      author: "assigned",
      franchise: "missing",
      character: "unknown",
      review: "pending",
      original: "missing-author",
    },
    caps,
  );
  assert.deepEqual(
    Array.from(rows, (r) => r.level),
    ["scene-only", "exact-native", "exact-native", "bounded", "unsupported"],
  );
  assert.equal(rows.length, 5);
  assert.equal(caps.criteria.multipleAuthors.level, "bounded");
  assert.equal(caps.criteria.createdAfter.level, "exact-native");
  assert.equal(caps.criteria.variants.level, "scene-only");
  assert.equal(
    searchCapabilities(["find_scenes"], [], 7).criteria.character.absent.level,
    "unsupported",
  );
  assert.equal(
    ui.preflight({ madeUp: "field" }, caps).at(-1).level,
    "unsupported",
  );
});
test("review and correction drafts are bounded explicit-ID requests, never auto execution", () => {
  const c = { id: "collection" };
  const review = ui.draft("plan", ["1", "2"], c, {});
  assert.match(review.text, /Read-only: do not prepare or apply/);
  const correction = ui.correction("2", c, "missing-franchise");
  assert.match(correction.text, /scene 2/);
  assert.match(correction.text, /Only after the intended target is explicit/);
  assert.equal(correction.context.sceneIds[0], "2");
  assert.equal(ui.correction("2", c, "invented"), null);
});
