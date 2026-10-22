import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fingerprint,
  ids,
  candidateFor,
  reconcileScene,
  reconcileAll,
  dependencyOrder,
  assertFresh,
  nativeRemovalRequest,
  nativeReplacementRequest,
} from "../scripts/lib/identity-reconciliation.mjs";
const tags = ["1", "2", "3", "4", "5", "6"].map((id) => ({
  id,
  name: "Fixture " + id,
}));
const scene = {
  id: "101",
  title: "Fixture costume",
  updated_at: "t1",
  tags: [tags[0], tags[1], tags[2]],
  custom_fields: { protected: "unchanged" },
};
const c = (sourceId, action = "remove", extra = {}) =>
  candidateFor({
    scene,
    sourceId,
    action,
    decisionId: "d" + sourceId,
    status: "supported",
    removalEstablished: true,
    evidence: [{ kind: "fixture-user-policy" }],
    ...extra,
  });
const run = (candidates, s = scene) =>
  reconcileScene({ scene: s, sceneId: "101", candidates, tags });
test("multiple removals produce one final state, preserving unrelated tags", () => {
  const r = run([c("1"), c("2")]);
  assert.deepEqual(r.after, ["3"]);
  assert.deepEqual(r.stageA.remove, ["1", "2"]);
});
test("duplicate removals and additions are normalized", () => {
  const r = run([
    c("1"),
    c("1", "remove", { decisionId: "other" }),
    c("2", "replace", {
      targetId: "4",
      associationEstablished: true,
      identityEstablished: true,
    }),
    c("2", "replace", {
      decisionId: "more",
      targetId: "4",
      associationEstablished: true,
      identityEstablished: true,
    }),
  ]);
  assert.deepEqual(r.after, ["3", "4"]);
});
test("removal and addition remain atomic, independent stage A is explicit", () => {
  const r = run([
    c("1"),
    c("2", "replace", {
      targetId: "4",
      associationEstablished: true,
      identityEstablished: true,
    }),
  ]);
  assert.deepEqual(r.stageA.after, ["2", "3"]);
  assert.deepEqual(r.stageB.before, ["2", "3"]);
  assert.deepEqual(r.after, ["3", "4"]);
  assert.deepEqual(nativeReplacementRequest(r).operations, [
    { relationship: "tags", action: "replace", fromId: "2", toId: "4" },
  ]);
});
test("two replacements for the same source cannot silently choose a winner", () => {
  const r = run(
    ["4", "5"].map((targetId, i) =>
      c("1", "replace", {
        decisionId: "x" + i,
        targetId,
        associationEstablished: true,
        identityEstablished: true,
      }),
    ),
  );
  assert.deepEqual(r.after, ["1", "2", "3"]);
  assert(r.conflicts.every((x) => x.code === "CONFLICTING_REPLACEMENTS"));
});
test("preservation conflicts with removal; independent safe change survives", () => {
  const r = run([c("1"), c("1", "preserve", { decisionId: "keep" }), c("2")]);
  assert.deepEqual(r.after, ["1", "3"]);
  assert.equal(r.conflicts[0].code, "PRESERVE_REMOVE_CONFLICT");
});
test("destination already assigned is a duplicate removal without addition", () => {
  const r = run([
    c("1", "replace", {
      targetId: "2",
      associationEstablished: true,
      identityEstablished: true,
    }),
  ]);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.stageA.remove, ["1"]);
});
test("source already absent is no-op, never an unsolicited add", () => {
  const r = run([
    c("6", "replace", {
      targetId: "4",
      associationEstablished: true,
      identityEstablished: true,
    }),
  ]);
  assert.deepEqual(r.after, ["1", "2", "3"]);
  assert.equal(r.conflicts[0].code, "SOURCE_ALREADY_ABSENT");
});
test("deleted scene is unavailable", () => {
  assert.equal(
    reconcileScene({ scene: null, sceneId: "101", candidates: [c("1")], tags })
      .status,
    "unavailable",
  );
});
test("inconsistent snapshots and later metadata changes are rejected", () => {
  const r = run([]);
  assert.throws(() => assertFresh(r, { ...scene, title: "Changed" }), /STALE/);
  const conflict = run([c("1")], { ...scene, updated_at: "t2" });
  assert.deepEqual(conflict.after, ["1", "2", "3"]);
  assert.equal(conflict.conflicts[0].code, "STALE_SOURCE_SNAPSHOT");
});
test("unknown destination and missing creation dependency cannot remove source", () => {
  for (const targetId of [null, "999"]) {
    const r = run([
      c("1", "replace", {
        targetId,
        associationEstablished: true,
        identityEstablished: true,
      }),
    ]);
    assert.deepEqual(r.after, ["1", "2", "3"]);
    assert(r.conflicts.length);
  }
});
test("duplicate canonical identities require an explicit survivor", () => {
  const r = run([
    c("1", "replace", {
      targetId: "4",
      associationEstablished: true,
      identityEstablished: true,
      destinationAmbiguous: true,
    }),
  ]);
  assert.equal(r.conflicts[0].code, "CANONICAL_TARGET_AMBIGUOUS");
});
test("identity intent alone cannot turn a costume into another character", () => {
  const r = run([
    c("1", "replace", { targetId: "4", identityEstablished: true }),
  ]);
  assert.deepEqual(r.after, ["1", "2", "3"]);
  assert.equal(r.conflicts[0].code, "REPLACEMENT_NOT_ESTABLISHED");
});
test("generic word policy removal never invents a replacement", () => {
  const r = run([c("1")]);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.after, ["2", "3"]);
});
test("mixed franchise or name-only hypotheses remain review, not replacements", () => {
  const r = run([
    c("1", "replace", {
      status: "review",
      targetId: "4",
      identityEstablished: true,
      evidence: [{ kind: "studio-only" }],
    }),
  ]);
  assert.deepEqual(r.after, ["1", "2", "3"]);
});
test("retention of collective exception is compatible with duplicate consolidation", () => {
  const r = run([
    c("1", "preserve"),
    c("2", "replace", {
      targetId: "1",
      identityEstablished: true,
      associationEstablished: true,
    }),
  ]);
  assert.deepEqual(r.after, ["1", "3"]);
});
test("a replacement target cannot simultaneously be removed", () => {
  const r = run([
    c("1", "replace", {
      targetId: "2",
      associationEstablished: true,
      identityEstablished: true,
    }),
    c("2"),
  ]);
  assert.deepEqual(r.after, ["1", "2", "3"]);
  assert(r.conflicts.every((c) => c.code === "DESTINATION_REMOVAL_CONFLICT"));
});
test("deterministic normalized IDs and results independent of candidate order", () => {
  assert.deepEqual(ids(["3", "1", "3", "2"]), ["1", "2", "3"]);
  assert.deepEqual(run([c("1"), c("2")]), run([c("2"), c("1")]));
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
});
test("invalid IDs and duplicate scene snapshots fail", () => {
  assert.throws(() => ids(["name"]), /EXACT_IDS/);
  assert.throws(
    () => reconcileAll({ scenes: [scene, scene], candidates: [c("1")], tags }),
    /DUPLICATE_SCENE/,
  );
});
test("creation precedes reassignment precedes retirement", () => {
  assert.deepEqual(
    dependencyOrder([
      { id: "retire", dependsOn: ["move"] },
      { id: "create" },
      { id: "move", dependsOn: ["create"] },
    ]),
    ["create", "move", "retire"],
  );
});
test("missing dependencies and cycles fail", () => {
  assert.throws(
    () => dependencyOrder([{ id: "move", dependsOn: ["create"] }]),
    /MISSING_DEPENDENCY/,
  );
  assert.throws(
    () =>
      dependencyOrder([
        { id: "a", dependsOn: ["b"] },
        { id: "b", dependsOn: ["a"] },
      ]),
    /CYCLIC/,
  );
});
test("native batch limit and incompatible combined removals fail", () => {
  const r = run([c("1")]);
  assert.throws(() => nativeRemovalRequest(Array(6).fill(r)), /FIVE_SCENE/);
  const other = { ...run([c("2")]), sceneId: "102" };
  assert.throws(() => nativeRemovalRequest([r, other]), /CROSS_SCENE/);
  assert.equal(nativeRemovalRequest([r]).operations[0].action, "remove");
});
test("unsupported compound native replacement is not disguised as removals", () => {
  const r = run([
    c("1", "replace", {
      targetId: "4",
      associationEstablished: true,
      identityEstablished: true,
    }),
    c("2", "replace", {
      targetId: "5",
      associationEstablished: true,
      identityEstablished: true,
    }),
  ]);
  assert.throws(() => nativeReplacementRequest(r), /SINGLE_REPLACEMENT/);
  assert.deepEqual(r.stageA.remove, []);
});
test("no metadata mutation or global retirement executor is exported", async () => {
  const m = await import("../scripts/lib/identity-reconciliation.mjs");
  assert(!("apply" in m));
  assert(!("deleteTag" in m));
});
