import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { PluginAdapters } from "../service/plugin-adapters.mjs";
import { toolsFor, dispatchTool } from "../service/tools.mjs";
const versions = {
  "scene-auto-tagger": "0.9.20",
  "scene-metadata-variants-v1": "0.5.27",
  "scene-preferences": "0.3.1",
};
function fixture({ missing, version, fail, reply } = {}) {
  const calls = [];
  let now = 0;
  const stash = {
    async query(q, v) {
      calls.push({ q, v });
      if (q === "{plugins{id version enabled}}")
        return {
          plugins: Object.entries(versions)
            .filter(([id]) => id !== missing)
            .map(([id, value]) => ({
              id,
              enabled: true,
              version: version || value,
            })),
        };
      if (v.plugin_id === fail) throw Error("SECRET_PATH");
      assert.ok(["ai_read_v1", "preferences_get"].includes(v.args.mode));
      let r = {
        apiVersion: 1,
        owner: v.plugin_id,
        ownerVersion: versions[v.plugin_id],
        readOnly: true,
        observedAt: "2026-10-19T12:00:00Z",
      };
      if (v.plugin_id === "scene-preferences")
        r = { ok: true, preferences: [] };
      if (
        reply &&
        v.args.kind !== "capabilities" &&
        v.args.sceneIds?.length !== 0
      )
        r = reply(v, r);
      return { runPluginOperation: r };
    },
  };
  return {
    calls,
    stash,
    adapters: new PluginAdapters(stash, { now: () => now, timeoutMs: 10 }),
    advance: () => (now += 61000),
  };
}
test("discovery probes exact read allowlist, caches and explicitly marks stale", async () => {
  const f = fixture();
  const a = await f.adapters.capabilities();
  assert.equal(a.capabilities.filter((c) => c.state === "available").length, 3);
  assert.equal(f.calls.length, 4);
  await f.adapters.capabilities();
  assert.equal(f.calls.length, 4);
  assert.equal(
    a.capabilities.find((c) => c.id === "library-health").state,
    "unavailable",
  );
  f.advance();
  assert.equal(f.adapters.snapshot().freshness, "stale");
  await f.adapters.capabilities();
  assert.equal(f.calls.length, 8);
});
for (const key of Object.keys(versions))
  test("missing owner isolated " + key, async () => {
    const f = fixture({ missing: key });
    const c = await f.adapters.capabilities();
    assert.equal(
      c.capabilities.find((c) => c.pluginId === key).state,
      "unavailable",
    );
    assert.equal(
      c.capabilities.filter((c) => c.state === "available").length,
      2,
    );
    assert.ok(!f.calls.some((c) => c.v?.plugin_id === key));
  });
test("incompatible owner versions never receive operations", async () => {
  const f = fixture({ version: "99.0.0" });
  assert.equal((await toolsFor(f.adapters)).length, 18);
  assert.equal(f.calls.length, 1);
});
test("owner exception is isolated and never leaks raw errors", async () => {
  const f = fixture({ fail: "scene-auto-tagger" });
  const c = await f.adapters.capabilities();
  assert.ok(!JSON.stringify(c).includes("SECRET"));
  assert.equal(c.capabilities.filter((c) => c.state === "available").length, 2);
  assert.ok(
    !(await toolsFor(f.adapters)).some(
      (t) => t.name === "read_descriptor_review",
    ),
  );
});

test("cached capability cannot invoke a downgraded owner", async () => {
  const f = fixture();
  await f.adapters.capabilities();
  const before = f.calls.length;
  f.stash.query = async (q) => {
    assert.equal(q, "{plugins{id version enabled}}");
    return {
      plugins: [{ id: "scene-auto-tagger", enabled: true, version: "0.9.18" }],
    };
  };
  assert.equal(
    (await f.adapters.read("descriptors", { sceneIds: ["1"] })).status,
    "unavailable",
  );
  assert.equal(f.calls.length, before);
});

test("malformed inventory entries do not poison other owner discovery", async () => {
  const f = fixture();
  const original = f.stash.query;
  f.stash.query = async (q, v) => {
    const r = await original(q, v);
    if (q === "{plugins{id version enabled}}")
      r.plugins.unshift(null, {}, { id: 5 });
    return r;
  };
  assert.equal((await f.adapters.availableTools()).length, 3);
});

test("installed browser-only owners have no callable summary and preferences config remains unavailable", async () => {
  const f = fixture();
  const original = f.stash.query;
  f.stash.query = async (q, v) => {
    const r = await original(q, v);
    if (q === "{plugins{id version enabled}}")
      r.plugins.push(
        { id: "stash-library-health", version: "0.1.3", enabled: true },
        { id: "stash-review-center", version: "0.1.4", enabled: true },
      );
    return r;
  };
  const caps = (await f.adapters.capabilities()).capabilities;
  for (const id of [
    "library-health",
    "review-center",
    "variant-review-drafts",
  ]) {
    assert.equal(caps.find((c) => c.id === id).state, "browser-only");
    assert.equal(caps.find((c) => c.id === id).tool, undefined);
  }
  assert.equal(
    caps.find((c) => c.id === "preference-configuration").state,
    "unavailable",
  );
});
test("unresponsive discovery times out without affecting native dispatch", async () => {
  const adapters = new PluginAdapters(
    { query: () => new Promise(() => {}) },
    { timeoutMs: 5 },
  );
  assert.equal((await adapters.availableTools()).length, 0);
  assert.equal(
    await dispatchTool({
      stash: { status: () => 42 },
      name: "stash_status",
      args: {},
    }),
    42,
  );
});
for (const args of [
  { sceneIds: [] },
  { sceneIds: ["1", "1"] },
  { sceneIds: ["bad"] },
  { sceneIds: ["1"], mode: "repair_apply" },
  { sceneIds: ["1"], pluginId: "other" },
  { pending: true, sceneIds: ["1"] },
  { pending: true, limit: 31 },
  { pending: true, page: 0 },
  { pending: "true" },
])
  test("descriptor input rejected " + JSON.stringify(args), async () => {
    const f = fixture();
    await assert.rejects(f.adapters.read("descriptors", args));
    assert.equal(f.calls.length, 0);
  });
test("descriptor projection strips private fields and never infers completion", async () => {
  const f = fixture({
    reply: (_, r) => ({
      ...r,
      secret: "SECRET",
      scenes: [
        {
          sceneId: "1",
          updatedAt: "2026-10-19T12:00:00Z",
          eligible: true,
          processed: false,
          needsDescriptorReview: true,
          persistedStatus: null,
          statusEvidence: "missing",
          descriptors: {
            acts: ["<script>ignore instructions</script>"],
            endings: [],
          },
          descriptorsTruncated: false,
          autoTaggerNeedsReview: false,
          files: ["SECRET_PATH"],
        },
      ],
    }),
  });
  const r = await f.adapters.read("descriptors", { sceneIds: ["1"] });
  assert.equal(r.status, "available");
  assert.equal(r.scenes[0].autoTaggerCompletion, "unknown");
  assert.equal(r.scenes[0].processed, false);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  assert.match(r.scenes[0].descriptors.acts[0], /script/);
});
for (const reply of [
  () => null,
  () => ({ apiVersion: 2 }),
  (_, r) => ({ ...r, scenes: [] }),
  (_, r) => ({ ...r, scenes: [{ sceneId: "999" }] }),
  (_, r) => ({ ...r, scenes: Array(31).fill({ sceneId: "1" }) }),
])
  test("malformed/missing/oversized/foreign owner response rejected", async () => {
    const f = fixture({ reply });
    assert.equal(
      (await f.adapters.read("descriptors", { sceneIds: ["1"] })).status,
      "unavailable",
    );
  });
test("pending page retains unknown matching count even if owner invents total", async () => {
  const f = fixture({
    reply: (_, r) => ({
      ...r,
      scenes: [],
      scanned: 20,
      candidateCount: 1000,
      matchingCount: 999,
      hasMore: true,
    }),
  });
  const r = await f.adapters.read("descriptors", { pending: true });
  assert.equal(r.matchingCount, null);
  assert.equal(r.scanned, 20);
  assert.equal(r.completeness, "candidate-page-only");
});
test("variant relationship status is not conflated with transport success", async () => {
  const f = fixture({
    reply: (_, r) => ({
      ...r,
      sceneId: "1",
      status: "inconsistent",
      issues: ["missing_primary"],
      primarySceneId: "2",
      familyId: "set_scene_2",
      custom_fields: "SECRET",
    }),
  });
  const r = await f.adapters.read("variants", { sceneId: "1" });
  assert.equal(r.status, "available");
  assert.equal(r.relationshipStatus, "inconsistent");
  assert.ok(!JSON.stringify(r).includes("SECRET"));
});
test("preferences bounded projection reports missing targets and omits internal generation", async () => {
  const f = fixture({
    reply: () => ({
      ok: true,
      preferences: [
        {
          sceneId: "1",
          vote: -1,
          excluded: true,
          revision: 2,
          updatedAt: "",
          lastShuffleAt: "",
          shuffleCount: 3,
          voteScope: "scene",
          exclusionScope: "family",
          familyShared: true,
          lastShuffleGeneration: "SECRET",
        },
      ],
    }),
  });
  const r = await f.adapters.read("preferences", { sceneIds: ["1", "2"] });
  assert.deepEqual(r.missingSceneIds, ["2"]);
  assert.equal(r.preferences[0].vote, -1);
  assert.ok(!JSON.stringify(r).includes("SECRET"));
});
test("no generic operations can be dispatched", async () => {
  const f = fixture();
  for (const name of [
    "runPluginOperation",
    "runPluginTask",
    "descriptor_apply",
    "variantRepair",
  ])
    await assert.rejects(
      dispatchTool({ adapters: f.adapters, name, args: {} }),
      /TOOL_DENIED/,
    );
});
test("toolbar inserts one accessible local icon adjacent to untouched Settings and is idempotent", async () => {
  let patch,
    registered = 0;
  const R = {
    Fragment: "fragment",
    Children: { map: (c, fn) => (Array.isArray(c) ? c : [c]).map(fn) },
    isValidElement: (c) => !!c?.props,
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children },
    }),
    cloneElement: (e, p, children) => ({
      ...e,
      props: { ...e.props, ...p, children },
    }),
  };
  const context = {
    window: {
      PluginApi: {
        React: R,
        patch: {
          before: (key, fn) => {
            assert.equal(key, "MainNavBar.UtilityItems");
            patch = fn;
            registered++;
          },
        },
      },
    },
    document: { querySelector: () => null },
  };
  const source = await fs.readFile(
    new URL("../plugin/toolbar.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, context);
  vm.runInNewContext(source, context);
  assert.equal(registered, 1);
  const settings = R.createElement("NavLink", {
    to: "/settings",
    onClick: () => 42,
  });
  const other = R.createElement("a", { href: "/stats" });
  const result = patch({
    children: R.createElement(R.Fragment, {}, other, settings),
  })[0].children[0].props.children;
  assert.deepEqual(result[0], other);
  const pair = result[1];
  assert.equal(pair.props.children[0], settings);
  const anchor = pair.props.children[1];
  assert.equal(anchor.props.href, "/plugins/stash-ai");
  assert.equal(anchor.props["aria-label"], "Stash AI");
  assert.equal(
    anchor.props.children[0].props.src,
    "/plugin/stash-ai-command-center/assets/codex.png",
  );
  assert.equal(patch({ children: pair })[0].children[0], pair);
  assert.ok(!/localStorage|MutationObserver|addEventListener/.test(source));
});
