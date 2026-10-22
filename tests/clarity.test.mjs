import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PluginAdapters } from "../service/plugin-adapters.mjs";
import { characterExplanation } from "../service/character-explanations.mjs";
import { hydrateScenes } from "../service/scene-cards.mjs";
import { sceneReasons, findingReasons } from "../service/scene-reasons.mjs";
import {
  assessScene,
  reviewFeedback,
  reviewSummary,
} from "../service/review-policy.mjs";
const require = createRequire(import.meta.url);
const owner = require("../integration/0.10.1/character-owner-fixture.cjs");
const previous = require("../integration/0.7.0/character-owner-fixture.cjs");
const at = "2026-10-20T00:00:00Z";
const tag = (id, name, parents = [], ignore_auto_tag = false) => ({
  id,
  name,
  parents,
  ignore_auto_tag,
});
const root = { id: "900", name: "Characters" };
const cases = [
  [
    "recognized complete",
    [tag("2", "Ashley Graham")],
    "present",
    "complete",
    null,
  ],
  [
    "recognized partial",
    [tag("2", "Ashley Graham"), tag("3", "User Character")],
    "present",
    "partial",
    "unregistered",
  ],
  [
    "user considers Character",
    [tag("3", "User Character")],
    "unknown",
    "partial",
    "unregistered",
  ],
  ["zero tags", [], "absent", "complete", null],
  [
    "non Character only",
    [tag("3", "Needs Review")],
    "absent",
    "complete",
    null,
  ],
  [
    "ignored",
    [tag("3", "Ashley Graham", [], true)],
    "unknown",
    "partial",
    "ignored",
  ],
  [
    "conflicting parents",
    [tag("3", "Fixture", [root, { id: "8", name: "Other" }])],
    "unknown",
    "partial",
    "conflicting-parents",
  ],
  [
    "indirect or other parent",
    [tag("3", "Fixture", [{ id: "8", name: "Subcategory" }])],
    "unknown",
    "partial",
    "other-parent",
  ],
  [
    "conflicting rules",
    [tag("3", "Needs Review", [root])],
    "unknown",
    "partial",
    "conflicting-rules",
  ],
  [
    "invalid references",
    [tag("3", "Fixture", [{ id: "bad", name: "Characters" }])],
    "unknown",
    "partial",
    "invalid-reference",
  ],
];
function read(tags) {
  const calls = [];
  const raw = owner.run(
    { kind: "scenes", sceneIds: ["1"] },
    {
      gql: {
        Do(q, v) {
          calls.push(q);
          assert.match(q, /^query/);
          return { s0: { id: "1", updated_at: at, tags } };
        },
      },
    },
  );
  assert.equal(calls.length, 1);
  return raw;
}
for (const [name, tags, presence, completeness, reason] of cases)
  test("clarity owner and projection: " + name, () => {
    const raw = read(tags),
      row = raw.scenes[0];
    assert.equal(row.presence, presence);
    assert.equal(row.completeness, completeness);
    assert.equal(row.unclassifiedTags[0]?.reason || null, reason);
    for (const t of tags) assert.equal(owner.classify(t), previous.classify(t));
    const projected = new PluginAdapters({}).project("characters", raw, {
      sceneIds: ["1"],
    }).scenes[0];
    assert.equal(projected.presence, presence);
    assert.equal(
      projected.explanation.headline,
      presence === "present"
        ? "Character assigned"
        : presence === "absent"
          ? "No Character assigned"
          : "Character category not confirmed",
    );
    if (reason)
      assert.match(
        projected.explanation.note,
        /not a confirmed metadata error/,
      );
  });
test("detail bounds, exact IDs, and truncated names are explicit", () => {
  const r = read(
    Array.from({ length: 9 }, (_, i) => tag(String(i + 1), "A".repeat(140))),
  ).scenes[0];
  assert.equal(r.unclassifiedCount, 9);
  assert.equal(r.unclassifiedTags.length, 4);
  assert.equal(r.unclassifiedDetailsTruncated, true);
  assert.equal(r.unclassifiedTags[0].name.length, 120);
  assert.equal(r.unclassifiedTags[0].nameTruncated, true);
  const over = read(
    Array.from({ length: 101 }, (_, i) => tag(String(i + 1), "x")),
  ).scenes[0];
  assert.equal(over.unclassifiedTags.length, 0);
  assert.equal(over.unclassifiedDetailsTruncated, true);
});
for (const corrupt of [
  (r) => (r.detailSchema = 2),
  (r) => (r.scenes[0].unclassifiedTags[0].reason = "model-suspected-mismatch"),
  (r) => (r.scenes[0].unclassifiedTags[0].id = "2"),
  (r) => (r.scenes[0].unclassifiedDetailsTruncated = true),
  (r) => (r.scenes[0].unclassifiedTags[0].url = "https://evil"),
])
  test("malformed detail is rejected", () => {
    const raw = read([tag("2", "Ashley Graham"), tag("3", "x")]);
    corrupt(raw);
    assert.throws(() =>
      new PluginAdapters({}).project("characters", raw, { sceneIds: ["1"] }),
    );
  });
test("old owner falls back honestly without invented tags or causes", () => {
  const raw = previous.run(
    { kind: "scenes", sceneIds: ["1"] },
    {
      gql: {
        Do() {
          return { s0: { id: "1", updated_at: at, tags: [tag("3", "x")] } };
        },
      },
    },
  );
  const c = new PluginAdapters({}).project("characters", raw, {
    sceneIds: ["1"],
  }).scenes[0];
  assert.deepEqual(c.explanation.details, []);
  assert.match(c.explanation.note, /could not be categorized/);
  assert.doesNotMatch(JSON.stringify(c.explanation), /unregistered|x \(ID/);
});
test("search/review selection is not replaced by incidental findings", () => {
  for (const sourceTool of [
    "find_scenes",
    "review_scenes",
    "get_scene_characters",
  ]) {
    const c = { sourceTool, observedAt: at },
      row = { findings: ["character-unknown", "missing-author"] };
    assert.equal(sceneReasons(c, row, [])[0].basis, "selection");
    assert.equal(findingReasons(c, row, []).length, 2);
  }
});
test("classification is not a metadata defect or a suspected mismatch", () => {
  const s = {
    status: "available",
    authors: [{ id: "1" }],
    franchise: { id: "2" },
    characters: { presence: "present", completeness: "partial" },
    descriptors: { needsReview: false, autoTaggerNeedsReview: false },
  };
  const review = assessScene(s),
    summary = reviewSummary([{ review }]);
  assert.equal(summary.confirmedGaps, 0);
  assert.equal(summary.ownerReview, 0);
  assert.equal(summary.possibleIssues, 0);
  assert.equal(summary.incompleteClassification, 1);
  assert.equal(summary.noConfirmedIssue, 1);
  const c = reviewFeedback(review, s, at, at).checks.find(
    (c) => c.key === "character-classification",
  );
  assert.equal(c.action, "information");
  assert.match(c.nextStep, /No metadata correction/);
  assert.doesNotMatch(c.currentText, /unresolved|incorrect assignment|owner/);
});
test("historical limitation survives current unavailability without claiming persistence", () => {
  const s = {
    status: "available",
    authors: [],
    franchise: null,
    characters: { presence: "unknown", completeness: "partial" },
    descriptors: { needsReview: true, autoTaggerNeedsReview: false },
  };
  const r = reviewFeedback(assessScene(s), { status: "unavailable" }, at, at);
  assert.match(
    r.checks.find((c) => c.key === "character-classification").historicalText,
    /could not be categorized/,
  );
  assert.match(
    r.checks.find((c) => c.key === "character-classification").currentText,
    /Current classification could not be checked/,
  );
  assert.equal(reviewSummary([{ review: assessScene(s) }]).confirmedGaps, 1);
  assert.equal(reviewSummary([{ review: assessScene(s) }]).ownerReview, 1);
});
for (const condition of ["fresh", "stale", "missing-owner", "wrong-detail-tag"])
  test("card evidence joins: " + condition, async () => {
    const tags = [
      tag("2", "Ashley Graham"),
      tag("3", "<img src=x onerror=alert(1)>"),
    ];
    const projected = new PluginAdapters({}).project("characters", read(tags), {
      sceneIds: ["1"],
    });
    if (condition === "stale")
      projected.scenes[0].updatedAt = "2020-01-01T00:00:00Z";
    if (condition === "wrong-detail-tag")
      projected.scenes[0].unclassifiedTags[0].id = "99";
    const c = {
      sourceTool: "review_scenes",
      observedAt: at,
      scenes: [{ sceneId: "1", findings: [] }],
    };
    const r = await hydrateScenes(
      {
        url: "http://localhost:9999",
        query: async () => ({
          s0: { id: "1", updated_at: at, tags, groups: [], studio: null },
        }),
      },
      {
        read: async (key) =>
          key === "characters" && condition !== "missing-owner"
            ? { status: "available", ...projected }
            : { status: "unavailable" },
      },
      c,
    );
    const ch = r.scenes[0].characters;
    assert.equal(ch.presence, condition === "fresh" ? "present" : "unknown");
    if (condition === "fresh")
      assert.equal(ch.explanation.details[0].name, tags[1].name);
    else {
      assert.equal(ch.unclassifiedCount, null);
      assert.match(ch.explanation.note, /could not be checked/);
      assert.deepEqual(ch.explanation.details, []);
    }
  });
test("missing API is unavailable, not partial classification evidence", () => {
  const c = characterExplanation({
    presence: "unknown",
    completeness: "unknown",
  });
  assert.match(c.headline, /unavailable/);
  assert.doesNotMatch(c.note, /still|unresolved/);
});

test("native zero tags still establish absence when owner is unavailable", async () => {
  const r = await hydrateScenes(
    {
      url: "http://localhost:9999",
      query: async () => ({
        s0: { id: "1", updated_at: at, tags: [], groups: [], studio: null },
      }),
    },
    { read: async () => ({ status: "unavailable" }) },
    {
      sourceTool: "get_scene",
      observedAt: at,
      scenes: [{ sceneId: "1", findings: [] }],
    },
  );
  assert.equal(r.scenes[0].characters.presence, "absent");
  assert.equal(r.scenes[0].characters.completeness, "complete");
  assert.equal(r.scenes[0].characters.unclassifiedCount, 0);
  assert.equal(
    r.scenes[0].characters.explanation.category,
    "metadata-condition",
  );
});
