import test from "node:test";
import assert from "node:assert/strict";
import {
  sceneReasons,
  findingReasons,
  FINDING_REASONS,
} from "../service/scene-reasons.mjs";
import { sourceRows, Presentations } from "../service/presentations.mjs";
import { hydrateScenes } from "../service/scene-cards.mjs";
import { Runtime } from "../service/runtime.mjs";
const date = "2026-10-20T00:00:00.000Z";
const collection = (tool, rows) => ({
  sourceTool: tool,
  observedAt: date,
  scenes: rows,
});
for (const [code, [label]] of Object.entries(FINDING_REASONS))
  test("fixed original reason and exact evidence status: " + code, () => {
    const c = collection("find_library_attention_items", [
      { sceneId: "1", findings: [code] },
    ]);
    const reasons = findingReasons(c, c.scenes[0], [
      { code, current: "no-longer-present" },
    ]);
    assert.equal(reasons[0].label, label);
    assert.equal(reasons[0].current, "no-longer-present");
    assert.equal(reasons[0].observedAt, date);
    assert.equal(
      reasons[0].evidence,
      code === "character-unknown" ? "unknown" : "verified-observation",
    );
  });
for (const [tool, code] of [
  ["find_scenes", "search-match"],
  ["get_scene", "scene-inspection"],
  ["get_scene_characters", "character-inspection"],
  ["read_descriptor_review", "descriptor-inspection"],
  ["read_variant_family", "variant-member"],
  ["old", "selected-result"],
])
  test("legacy safe selection fallback: " + tool, () => {
    const c = collection(tool, [{ sceneId: "1", findings: [] }]);
    const r = sceneReasons(c, c.scenes[0], []);
    assert.equal(r[0].code, code);
    assert.equal(r[0].basis, "selection");
    assert.doesNotMatch(r[0].explanation, /missing|incorrect/i);
  });
test("source rows never spread findings between scenes or derive warnings from metadata prose", () => {
  const rows = sourceRows("find_library_attention_items", {
    items: [
      { sceneId: "1", evidence: [{ category: "missing-author" }] },
      {
        sceneId: "2",
        evidence: [
          { category: "descriptor-review" },
          { category: "needs-review" },
        ],
      },
      { sceneId: "3", evidence: [{ category: "suspected-incorrect-tag" }] },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.findings),
    [["missing-author"], ["descriptor-review", "needs-review"], []],
  );
  const c = collection("find_library_attention_items", rows);
  assert.deepEqual(
    sceneReasons(c, rows[0], []).map((r) => r.code),
    ["missing-author"],
  );
  assert.deepEqual(
    sourceRows("find_scenes", {
      scenes: [
        {
          id: "1",
          title: "<b>Missing Author</b>",
          findings: ["missing-author"],
        },
      ],
    }),
    [{ sceneId: "1", findings: [] }],
  );
  assert.deepEqual(
    sourceRows("get_scene", {
      id: "1",
      title: "Missing Author",
      groups: [],
      studio: null,
      tags: [],
    })[0].findings,
    ["missing-author", "missing-franchise", "missing-characters"],
  );
  assert.throws(() => sourceRows("get_scene", { id: "<img>" }));
});
test("unknown Character evidence is separate from absence and rejected as a forged presentation argument", async () => {
  const rows = sourceRows("get_scene_characters", {
    scenes: [
      { sceneId: "1", status: "available", presence: "unknown" },
      { sceneId: "2", status: "available", presence: "absent" },
      { sceneId: "3", status: "unavailable", presence: "unknown" },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.findings),
    [["character-unknown"], ["missing-characters"]],
  );
  const p = new Presentations({ read: async (_, fallback) => fallback });
  await p.init();
  const turn = { turnId: "turn" };
  const result = p.record(
    turn,
    { tool: "get_scene_characters", turnId: "turn", callId: "call" },
    { scenes: [{ sceneId: "1", status: "available", presence: "unknown" }] },
  );
  for (const extra of [
    { reasons: ["missing-author"] },
    { label: "Possible Character Tag Mismatch" },
    { url: "https://evil" },
    { findings: ["missing-characters"] },
  ])
    assert.throws(() =>
      p.select(turn, {
        turnId: "turn",
        arguments: {
          sourceId: result.presentationSource.sourceId,
          sceneIds: ["1"],
          ...extra,
        },
      }),
    );
  assert.throws(() =>
    p.select(
      { turnId: "turn2" },
      {
        turnId: "turn2",
        arguments: {
          sourceId: result.presentationSource.sourceId,
          sceneIds: ["1"],
        },
      },
    ),
  );
});
test("unknown code in stored data fails closed; valid legacy records remain byte-equivalent", async () => {
  const record = {
    schema: 1,
    type: "scene_collection",
    id: "c",
    owner: "o",
    threadId: "t",
    turnId: "u",
    messageId: "m",
    sourceId: "s",
    sourceCallId: "x",
    sourceTool: "get_scene",
    observedAt: date,
    layout: "grid",
    scope: "explicit-scenes",
    scenes: [{ sceneId: "1", findings: [] }],
  };
  const data = { schema: 1, collections: [record] };
  const before = JSON.stringify(data);
  let writes = 0;
  const store = { read: async () => data, write: async () => writes++ };
  const p = new Presentations(store);
  await p.init();
  assert.equal(p.available, true);
  assert.equal(JSON.stringify(data), before);
  record.scenes[0].reasons = ["suspected-incorrect-tag"];
  const bad = new Presentations(store);
  await bad.init();
  assert.equal(bad.available, false);
  assert.equal(writes, 0);
});
for (const state of [
  "resolved",
  "unknown",
  "owner-unavailable",
  "owner-stale",
  "missing",
  "outage",
])
  test(
    "original reason survives refresh with honest current status: " + state,
    async () => {
      const c = collection("get_scene_characters", [
        { sceneId: "1", findings: ["character-unknown"] },
      ]);
      const stash = {
        url: "http://localhost:9999/graphql",
        query: async () => {
          if (state === "outage") throw Error("down");
          return {
            s0:
              state === "missing"
                ? null
                : {
                    id: "1",
                    title: "<script>suspected incorrect</script>",
                    updated_at: "now",
                    tags: [{ id: "9", name: "unknown" }],
                    groups: [],
                    studio: null,
                    files: [],
                  },
          };
        },
      };
      const adapters = {
        read: async (key) => ({
          status: state === "owner-unavailable" ? "unavailable" : "available",
          scenes:
            key === "characters"
              ? [
                  {
                    sceneId: "1",
                    status: "available",
                    updatedAt: state === "owner-stale" ? "old" : "now",
                    assignedTagCount: 1,
                    characterTagIds: state === "resolved" ? ["9"] : [],
                    presence: state === "resolved" ? "present" : "unknown",
                    completeness: "partial",
                    unclassifiedCount: 1,
                  },
                ]
              : [],
        }),
      };
      const r = (await hydrateScenes(stash, adapters, c)).scenes[0];
      assert.equal(r.reasons[0].code, "character-inspection");
      assert.equal(r.findingExplanations[0].code, "character-unknown");
      assert.equal(
        r.findingExplanations[0].current,
        state === "resolved"
          ? "no-longer-present"
          : state === "unknown"
            ? "still-present"
            : "unverified",
      );
      assert.doesNotMatch(
        JSON.stringify(r.reasons),
        /<script>|suspected incorrect/,
      );
    },
  );
test("ordinary search remains a match even when fresh metadata has gaps", async () => {
  const c = collection("find_scenes", [{ sceneId: "1", findings: [] }]);
  const r = await hydrateScenes(
    {
      url: "http://localhost:9999",
      query: async () => ({
        s0: { id: "1", updated_at: "now", tags: [], groups: [], studio: null },
      }),
    },
    { read: async () => ({ status: "unavailable" }) },
    c,
  );
  assert.equal(r.scenes[0].reasons[0].code, "search-match");
  assert.deepEqual(r.scenes[0].currentGaps, [
    "missing-author",
    "missing-franchise",
    "missing-characters",
  ]);
});
test("runtime final-answer guidance retains evidence, no-image and preview-only boundaries on resume", () => {
  const r = new Runtime({
    cwd: ".",
    tools: [{ name: "present_scene_results" }],
  });
  for (const contract of [4, 7]) {
    const instructions = r.options(contract).developerInstructions;
    assert.match(instructions, /persisted final answer self-contained/);
    assert.match(instructions, /final prose renders before/);
    assert.match(instructions, /prepared preview is not an applied change/);
    assert.match(instructions, /images are not supplied for your analysis/);
  }
});
