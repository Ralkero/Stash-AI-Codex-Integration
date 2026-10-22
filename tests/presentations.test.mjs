import test from "node:test";
import assert from "node:assert/strict";
import { Presentations, sourceRows } from "../service/presentations.mjs";
import { hydrateScenes, screenshotPath } from "../service/scene-cards.mjs";
const setup = async () => {
  let saved;
  const store = {
    read: async (_, fallback) => structuredClone(saved ?? fallback),
    write: async (_, data) => {
      saved = structuredClone(data);
    },
  };
  const p = new Presentations(store);
  await p.init();
  const turn = { turnId: "turn1", messageId: "final1", cancelled: false };
  const args = { tool: "find_scenes", callId: "call1", turnId: "turn1" };
  const result = p.record(turn, args, { scenes: [{ id: "1" }, { id: "2" }] });
  const selection = {
    turnId: "turn1",
    arguments: {
      sourceId: result.presentationSource.sourceId,
      sceneIds: ["1"],
    },
  };
  return {
    p,
    store,
    turn,
    result,
    selection,
    conversation: { id: "thread1", owner: "owner1" },
  };
};
test("exact completed-message references persist across restart; no transcript, metadata or images stored", async () => {
  const f = await setup();
  f.p.select(f.turn, f.selection);
  await f.p.finish(f.conversation, f.turn, {
    id: "turn1",
    status: "completed",
  });
  const loaded = new Presentations(f.store);
  await loaded.init();
  const attached = loaded.forMessage("owner1", "thread1", "turn1", "final1");
  assert.equal(attached.length, 1);
  const c = loaded.get("owner1", "thread1", attached[0].id);
  assert.deepEqual(c.scenes, [{ sceneId: "1", findings: [] }]);
  for (const key of ["text", "screenshot", "title", "characters", "thumbnail"])
    assert.ok(!(key in c));
  assert.deepEqual(
    loaded.forMessage("owner1", "thread1", "other", "final1"),
    [],
  );
  assert.deepEqual(
    loaded.forMessage("owner1", "thread1", "turn1", "commentary"),
    [],
  );
  assert.throws(() => loaded.get("other", "thread1", c.id), /DENIED/);
  assert.throws(() => loaded.get("owner1", "other", c.id), /DENIED/);
});
for (const patch of [
  { sourceId: "invented" },
  { sceneIds: ["3"] },
  { sceneIds: ["1", "1"] },
  { sceneIds: ["<img>"] },
  { sceneIds: [] },
  { sceneIds: Array(21).fill("1") },
  { html: "<script>" },
  { image: "https://evil" },
  { findings: ["missing-characters"] },
  { layout: "html" },
])
  test(
    "rejects unauthorized presentation input " + JSON.stringify(patch),
    async () => {
      const f = await setup();
      assert.throws(() =>
        f.p.select(f.turn, {
          ...f.selection,
          arguments: { ...f.selection.arguments, ...patch },
        }),
      );
      assert.equal(f.p.records.length, 0);
    },
  );
for (const status of ["failed", "interrupted", "inProgress"])
  test("does not publish " + status, async () => {
    const f = await setup();
    f.p.select(f.turn, f.selection);
    await f.p.finish(f.conversation, f.turn, { id: "turn1", status });
    assert.equal(f.p.records.length, 0);
  });
test("cancelled turns, wrong turns, missing final message and stale receipts fail closed", async () => {
  const f = await setup();
  assert.throws(() => f.p.select(f.turn, { ...f.selection, turnId: "turn2" }));
  assert.throws(() =>
    f.p.select({ turnId: "turn2" }, { ...f.selection, turnId: "turn2" }),
  );
  f.p.select(f.turn, f.selection);
  f.turn.cancelled = true;
  await f.p.finish(f.conversation, f.turn, {
    id: "turn1",
    status: "completed",
  });
  assert.equal(f.p.records.length, 0);
  f.turn.cancelled = false;
  delete f.turn.messageId;
  await f.p.finish(f.conversation, f.turn, {
    id: "turn1",
    status: "completed",
  });
  assert.equal(f.p.records.length, 0);
});
test("duplicate selection/completion is idempotent; collection limit is enforced", async () => {
  const f = await setup();
  const first = f.p.select(f.turn, f.selection);
  assert.deepEqual(f.p.select(f.turn, f.selection), {
    queued: true,
    collectionId: first.collectionId,
  });
  f.p.select(f.turn, {
    ...f.selection,
    arguments: { ...f.selection.arguments, sceneIds: ["2"] },
  });
  assert.throws(
    () =>
      f.p.select(f.turn, {
        ...f.selection,
        arguments: { ...f.selection.arguments, sceneIds: ["1", "2"] },
      }),
    /LIMIT/,
  );
  await Promise.all([
    f.p.finish(f.conversation, f.turn, { id: "turn1", status: "completed" }),
    f.p.finish(f.conversation, f.turn, { id: "turn1", status: "completed" }),
  ]);
  assert.equal(f.p.records.length, 2);
});
test("corrupt/unknown sidecar preserved and unavailable; failed writes do not poison later writes", async () => {
  let writes = 0;
  const p = new Presentations({
    read: async () => ({ schema: 99 }),
    write: async () => {
      writes++;
    },
  });
  await p.init();
  assert.equal(p.available, false);
  assert.equal(writes, 0);
  const f = await setup();
  f.p.select(f.turn, f.selection);
  const write = f.store.write;
  f.store.write = async () => {
    throw Error("disk");
  };
  await assert.rejects(
    f.p.finish(f.conversation, f.turn, { id: "turn1", status: "completed" }),
  );
  assert.equal(f.p.records.length, 0);
  f.store.write = write;
  await f.p.finish(f.conversation, f.turn, {
    id: "turn1",
    status: "completed",
  });
  assert.equal(f.p.records.length, 1);
});
test("eligible sources only; no IDs extracted from prose, untrusted keys or unverified variant members", () => {
  assert.deepEqual(
    sourceRows("propose_scene_changes", { scenes: [{ id: "1" }] }),
    [],
  );
  assert.deepEqual(
    sourceRows("find_scenes", { text: "scene 1", ids: ["1"] }),
    [],
  );
  assert.deepEqual(
    sourceRows("read_variant_family", {
      members: [
        { sceneId: "1", consistent: false },
        { sceneId: "2", consistent: true },
      ],
    }),
    [{ sceneId: "2", findings: [] }],
  );
  assert.deepEqual(
    sourceRows("get_scene_characters", {
      scenes: [{ sceneId: "1", status: "available", presence: "unknown" }],
    }),
    [{ sceneId: "1", findings: ["character-unknown"] }],
  );
  assert.deepEqual(
    sourceRows("find_library_attention_items", {
      items: [
        {
          sceneId: "1",
          evidence: [{ category: "fake" }, { category: "missing-author" }],
        },
      ],
    }),
    [{ sceneId: "1", findings: ["missing-author"] }],
  );
});
test("receipt budget is bounded, and wrong/cancelled tool completion gets no reference", async () => {
  const f = await setup();
  const raw = { id: "1" };
  assert.equal(
    f.p.record(
      f.turn,
      { tool: "get_scene", callId: "x", turnId: "wrong" },
      raw,
    ),
    raw,
  );
  for (let i = 0; i < 40; i++)
    f.p.record(
      f.turn,
      { tool: "get_scene", callId: "c" + i, turnId: "turn1" },
      raw,
    );
  assert.equal(f.turn.receipts.size, 24);
});
for (const bad of [
  "https://evil/scene/1/screenshot",
  "//evil/scene/1/screenshot",
  "/scene/2/screenshot",
  "javascript:alert(1)",
  "data:image/png;base64,X",
  "http://user:pass@localhost:9999/scene/1/screenshot",
  "http://localhost:9999/scene/1/screenshot#bad",
])
  test("image rejects " + bad, () =>
    assert.equal(
      screenshotPath(bad, "1", "http://localhost:9999/graphql"),
      null,
    ),
  );
test("image path is same-origin and strips credentials/query junk", () => {
  assert.equal(
    screenshotPath(
      "http://localhost:9999/scene/1/screenshot?t=123&apikey=secret&url=evil",
      "1",
      "http://localhost:9999/graphql",
    ),
    "/scene/1/screenshot?t=123",
  );
});
function cardFixture({
  owner = true,
  stale = false,
  missing = false,
  outage = false,
} = {}) {
  const calls = [];
  const stash = {
    url: "http://localhost:9999/graphql",
    query: async (q, v) => {
      calls.push({ q, v });
      if (outage) throw Error("down");
      return Object.fromEntries(
        Object.values(v).map((sceneId, i) => [
          "s" + i,
          missing
            ? null
            : {
                id: sceneId,
                title: "<script>untrusted</script>",
                updated_at: "now",
                tags:
                  sceneId === "2"
                    ? []
                    : [
                        { id: "9", name: "Character" },
                        { id: "8", name: "Not classified" },
                      ],
                studio: null,
                groups: [{ group: { id: "4", name: "Author" } }],
                paths: {
                  screenshot: `http://localhost:9999/scene/${sceneId}/screenshot`,
                },
                files: [],
              },
        ]),
      );
    },
  };
  const adapters = {
    read: async (key, { sceneIds }) => {
      calls.push({ key, sceneIds });
      if (!owner) return { status: "unavailable" };
      return {
        status: "available",
        scenes: sceneIds.map((sceneId) =>
          key === "characters"
            ? {
                sceneId,
                status: "available",
                updatedAt: stale ? "old" : "now",
                assignedTagCount: sceneId === "2" ? 0 : 2,
                characterTagIds: sceneId === "2" ? [] : ["9"],
                presence: sceneId === "2" ? "absent" : "present",
                completeness: "partial",
                unclassifiedCount: 1,
              }
            : {
                sceneId,
                updatedAt: stale ? "old" : "now",
                descriptors: { acts: ["a"], endings: [] },
                needsDescriptorReview: true,
                autoTaggerNeedsReview: false,
              },
        ),
      };
    },
  };
  const collection = {
    scenes: ["1", "2"].map((sceneId) => ({
      sceneId,
      findings: ["missing-characters", "descriptor-review"],
    })),
  };
  return { stash, adapters, collection, calls };
}
test("one native batch + two owner batches; trusted names only and historical/current distinction", async () => {
  const f = cardFixture();
  const result = await hydrateScenes(f.stash, f.adapters, f.collection);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(Object.values(f.calls[0].v), ["1", "2"]);
  assert.doesNotMatch(f.calls[0].q, /details|custom_fields|path /);
  assert.deepEqual(result.scenes[0].characters.names, [
    { id: "9", name: "Character" },
  ]);
  assert.equal(result.scenes[0].findings[0].current, "no-longer-present");
  assert.equal(result.scenes[1].findings[0].current, "still-present");
  assert.equal(result.scenes[0].findings[1].current, "still-present");
});
for (const config of [{ owner: false }, { stale: true }])
  test(
    "unknown/stale owner is not absence or resolution " +
      JSON.stringify(config),
    async () => {
      const f = cardFixture(config);
      const r = await hydrateScenes(f.stash, f.adapters, f.collection);
      assert.equal(r.scenes[0].characters.presence, "unknown");
      assert.equal(r.scenes[0].findings[0].current, "unverified");
      assert.equal(r.scenes[0].findings[1].current, "unverified");
      assert.equal(r.scenes[0].descriptors, null);
      assert.equal(r.scenes[1].characters.presence, "absent"); // independently verified zero tags
    },
  );
for (const config of [{ missing: true }, { outage: true }])
  test(
    "missing scenes/outage never imply resolution " + JSON.stringify(config),
    async () => {
      const f = cardFixture(config);
      const r = await hydrateScenes(f.stash, f.adapters, f.collection);
      assert.ok(
        r.scenes.every((s) =>
          s.findings.every((v) => v.current === "unverified"),
        ),
      );
    },
  );
