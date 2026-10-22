import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PluginAdapters } from "../service/plugin-adapters.mjs";
import { LibraryInsights } from "../service/library-insights.mjs";
import { toolsFor, dispatchTool, TOOL_SCHEMA } from "../service/tools.mjs";
import { Suggestions } from "../service/suggestions.mjs";
const owner = createRequire(import.meta.url)(
  "../integration/0.7.0/character-owner-fixture.cjs",
);
const at = "2026-10-20T08:00:00Z";
const tag = (id, name, parents = []) => ({
  id,
  name,
  parents,
  ignore_auto_tag: false,
});
const row = (id, tags, extra = {}) => ({
  id,
  tags,
  created_at: at,
  updated_at: at,
  studio: { id: "20" },
  groups: [{ group: { id: "30" } }],
  ...extra,
});
function fixture({
  rows = [],
  version = "0.9.21",
  corrupt,
  unavailable = false,
  timeout = false,
  mutateJoin = false,
} = {}) {
  const calls = [],
    state = { version };
  const stash = {
    async query(q, v = {}) {
      calls.push({ q, v });
      if (q === "{plugins{id version enabled}}")
        return {
          plugins: [
            {
              id: "scene-auto-tagger",
              enabled: !unavailable,
              version: state.version,
            },
          ],
        };
      if (q.includes("runPluginOperation")) {
        assert.equal(v.plugin_id, "scene-auto-tagger");
        let r;
        if (v.args.mode === "character_identity_v1") {
          if (timeout && v.args.kind === "scenes") return new Promise(() => {});
          r = owner.run(v.args, {
            gql: {
              Do(query, vars) {
                assert.match(query, /^query/);
                return Object.fromEntries(
                  Object.values(vars).map((id, i) => [
                    "s" + i,
                    rows.find((s) => s.id === id) ?? null,
                  ]),
                );
              },
            },
          });
          if (mutateJoin && r.scenes)
            r.scenes.forEach((s) => {
              s.updatedAt = "2026-10-21T00:00:00Z";
            });
          if (corrupt && r.scenes) corrupt(r);
        } else {
          assert.equal(v.args.mode, "ai_read_v1");
          r = {
            apiVersion: 1,
            owner: "scene-auto-tagger",
            ownerVersion: state.version,
            readOnly: true,
            observedAt: at,
            scenes: [],
          };
          if (v.args.kind === "pending")
            Object.assign(r, {
              scanned: 0,
              candidateCount: 0,
              hasMore: false,
            });
          if (v.args.kind === "scenes")
            r.scenes = v.args.sceneIds.map((id) => ({
              sceneId: id,
              updatedAt: at,
              eligible: true,
              processed: false,
              needsDescriptorReview: true,
              persistedStatus: null,
              statusEvidence: "missing",
              descriptors: { acts: ["Fixture assignment"], endings: [] },
              descriptorsTruncated: false,
              autoTaggerNeedsReview: false,
            }));
        }
        return { runPluginOperation: JSON.stringify(r) };
      }
      assert.doesNotMatch(q, /mutation|findTags|per_page:-1/);
      if (q.includes(" scenes{"))
        return { findScenes: { count: 10000, scenes: rows } };
      if (q.includes("s0:findScene"))
        return Object.fromEntries(
          Object.values(v).map((id, i) => [
            "s" + i,
            rows.find((s) => s.id === id) ?? null,
          ]),
        );
      return {
        [q.includes("findAudios") ? "findAudios" : "findScenes"]: {
          count: 100,
        },
      };
    },
  };
  const adapters = new PluginAdapters(stash, { timeoutMs: 20 });
  return {
    stash,
    adapters,
    calls,
    state,
    insights: new LibraryInsights(stash, adapters, {
      characterIdentity: true,
      timeoutMs: 50,
    }),
  };
}
const mixedRows = [
  row("1", [tag("2", "Needs Review")]),
  row("2", [tag("3", "Unclassified fixture")]),
  row("3", [tag("4", "Ashley Graham")]),
  row("4", []),
];
test("contract 6 reader is gated, bounded, deduplicated and projected without unrelated metadata", async () => {
  const f = fixture({ rows: mixedRows });
  const r = await f.adapters.read("characters", {
    sceneIds: ["1", "2", "3", "4", "999", "1"],
  });
  assert.equal(r.status, "available");
  assert.deepEqual(
    r.scenes.map((s) => s.presence),
    ["absent", "unknown", "present", "absent", "unknown"],
  );
  assert.deepEqual(r.scenes[2].characterTagIds, ["4"]);
  assert.equal(r.scenes[4].status, "not_found");
  assert.equal(r.taxonomyComplete, false);
  assert.doesNotMatch(
    JSON.stringify(r),
    /Unclassified fixture|Ashley Graham|files|custom_fields/,
  );
  assert.equal(f.calls.filter((c) => c.v.args?.kind === "scenes").length, 1);
  assert.ok(
    (await toolsFor(f.adapters)).some((t) => t.name === "get_scene_characters"),
  );
  assert.equal(TOOL_SCHEMA, 10);
});
for (const version of ["0.9.20", "0.9.25", "bad"])
  test(
    "unaudited Character owner " + version + " cannot invoke new mode",
    async () => {
      const f = fixture({ version });
      assert.equal(
        (await f.adapters.read("characters", { sceneIds: ["1"] })).status,
        "unavailable",
      );
      assert.ok(
        !f.calls.some((c) => c.v.args?.mode === "character_identity_v1"),
      );
      assert.ok(
        !(await toolsFor(f.adapters)).some(
          (t) => t.name === "get_scene_characters",
        ),
      );
    },
  );
test("owner downgrade after discovery is checked before operation", async () => {
  const f = fixture();
  await f.adapters.capabilities();
  f.state.version = "0.9.20";
  const before = f.calls.length;
  assert.equal(
    (await f.adapters.read("characters", { sceneIds: ["1"] })).status,
    "unavailable",
  );
  assert.ok(
    f.calls.slice(before).every((c) => !c.q.includes("runPluginOperation")),
  );
});
for (const corrupt of [
  (r) => {
    r.scenes[0].presence = "absent";
  },
  (r) => {
    r.scenes[0].characterTagIds = ["999"];
  },
  (r) => {
    r.scenes[0].unclassifiedCount = 0;
  },
  (r) => {
    r.scenes[0].sceneId = "999";
  },
  (r) => {
    r.scenes.push(r.scenes[0]);
  },
  (r) => {
    r.taxonomyComplete = true;
  },
  (r) => {
    r.ownerVersion = "0.9.20";
  },
])
  test("malformed owner cannot create confirmed absence", async () => {
    const f = fixture({ rows: [mixedRows[1]], corrupt });
    assert.equal(
      (await f.adapters.read("characters", { sceneIds: ["2"] })).status,
      "unavailable",
    );
  });
test("missing and timeout owner fail closed without raw error disclosure", async () => {
  for (const options of [{ unavailable: true }, { timeout: true }]) {
    const f = fixture(options);
    const r = await f.adapters.read("characters", { sceneIds: ["1"] });
    assert.equal(r.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(r), /SECRET|path/);
  }
});
test("v6 search detects excluded nonempty assignments but excludes unknown and present Characters", async () => {
  const f = fixture({ rows: mixedRows });
  const r = await f.insights.attention({
    category: "metadata",
    missing: ["characters"],
  });
  assert.deepEqual(
    r.items.map((s) => s.sceneId),
    ["1", "4"],
  );
  assert.equal(
    r.items[0].metadata.characterAbsence,
    "confirmed-owner-exclusions",
  );
  assert.equal(r.characterUnknownCandidates, 1);
  assert.equal(r.matchingCount, null);
  assert.equal(r.hasMoreCandidatePages, true);
  const native = f.calls.find((c) => c.q.includes(" scenes{"));
  assert.deepEqual(native.v.scene, {}); // Do NOT prefilter only zero-tag scenes.
});
test("v5 retains no-tags semantics and rejects new intersections", async () => {
  const f = fixture({ rows: mixedRows });
  const legacy = new LibraryInsights(f.stash, f.adapters);
  const r = await legacy.attention({
    category: "metadata",
    missing: ["characters"],
  });
  assert.deepEqual(
    r.items.map((s) => s.sceneId),
    ["4"],
  );
  assert.ok(
    !f.calls.some(
      (c) =>
        c.v.args?.mode === "character_identity_v1" &&
        c.v.args?.kind === "scenes",
    ),
  );
  await assert.rejects(legacy.attention({ present: ["descriptors"] }));
});
test("review, descriptor-presence and native criteria join by ID; presence is not completion", async () => {
  const f = fixture({ rows: mixedRows });
  const r = await f.insights.attention({
    category: "descriptor-review",
    present: ["descriptors", "tags", "author"],
    missing: ["characters"],
  });
  assert.deepEqual(
    r.items.map((s) => s.sceneId),
    ["1"],
  );
  assert.equal(r.items[0].metadata.descriptorPresence, "present");
  assert.ok(
    r.items[0].evidence.some((e) => e.category === "descriptor-review"),
  );
});
test("non-atomic scene change invalidates Character and descriptor joins", async () => {
  const f = fixture({ rows: [mixedRows[0]], mutateJoin: true });
  const r = await f.insights.attention({ missing: ["characters"] });
  assert.equal(r.items.length, 0);
  assert.equal(r.characterUnknownCandidates, 1);
});
test("descriptor assignments with zero tags are confirmed absent, not reviewed by presence", async () => {
  const f = fixture({ rows: [mixedRows[3]] });
  const r = await f.insights.attention({
    category: "descriptor-review",
    present: ["descriptors"],
    missing: ["characters"],
  });
  assert.deepEqual(
    r.items.map((s) => s.sceneId),
    ["4"],
  );
  assert.equal(r.items[0].metadata.characterPresence, "absent");
  assert.ok(
    r.items[0].evidence.some((e) => e.category === "descriptor-review"),
  );
});
test("unavailable taxonomy keeps zero-tag fallback, does not guess other absences", async () => {
  const f = fixture({ rows: mixedRows, unavailable: true });
  const r = await f.insights.attention({ missing: ["characters"] });
  assert.deepEqual(
    r.items.map((s) => s.sceneId),
    ["4"],
  );
});
test("global Character coverage remains explicitly unavailable; no scene/catalog scan", async () => {
  const f = fixture();
  const r = await f.insights.health();
  assert.equal(
    r.metrics.find((m) => m.id === "characters").status,
    "unavailable",
  );
  assert.equal(f.calls.length, 4);
  assert.ok(f.calls.every((c) => !c.q.includes(" scenes{")));
});
test("suggestions use confirmed absence only; original four-card prefill/no-write contract", async () => {
  const f = fixture({ rows: mixedRows });
  const s = new Suggestions(f.stash, f.adapters, { insights: f.insights });
  const r = await s.get();
  assert.ok(r.items.length <= 4);
  assert.ok(r.items.every((s) => /Do not change/.test(s.prompt)));
  for (const card of r.items)
    assert.doesNotMatch(card.trigger, /#2:.*confirmed Character absence/);
});
test("old catalog supported-operations result cannot advertise newly added tool", async () => {
  const f = fixture();
  const r = await dispatchTool({
    adapters: f.adapters,
    proposals: { writesEnabled: false },
    name: "list_supported_operations",
    args: {},
    toolSchema: 5,
    toolNames: ["get_scene"],
  });
  assert.equal(r.toolSchema, 5);
  assert.deepEqual(r.read, ["get_scene"]);
});
for (const args of [
  { sceneIds: [] },
  { sceneIds: ["x"] },
  { sceneIds: Array(21).fill("1") },
  { sceneIds: ["1"], mode: "bulk" },
  { sceneIds: ["1"], query: "mutation" },
])
  test("Character model arguments cannot select tasks/queries or exceed bounds", async () => {
    const f = fixture();
    await assert.rejects(f.adapters.read("characters", args));
    assert.equal(f.calls.length, 0);
  });
