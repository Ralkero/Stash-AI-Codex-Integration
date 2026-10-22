import test from "node:test";
import assert from "node:assert/strict";
import { GlobalTagCleanup } from "../service/global-tag-cleanup.mjs";
import { hash } from "../service/tag-cleanup-policy.mjs";
function fixture() {
  const state = new Map(),
    writes = [];
  const seed = {
    schema: 1,
    owner: "owner",
    thread: "thread",
    sourceDigest: "s".repeat(64),
    tags: [{ id: "7", name: "Franchise <script>" }],
    confirmation: { confirmed: true, deletionApproved: false },
  };
  const projection = {
    beforeDigest: "before",
    afterDigest: "after",
    tags: [{ id: 7, name: seed.tags[0].name }],
    counts: {
      tags: 1,
      scenes: 1,
      images: 1,
      sceneAssignments: 1,
      imageAssignments: 1,
      aliases: 0,
      artwork: 0,
    },
    removed: { tags: [{ id: 7 }], scenes_tags: [{ scene_id: 1, tag_id: 7 }] },
    removableBlobs: [],
  };
  let current = "before";
  const store = {
    read: async (n, d) => (state.has(n) ? structuredClone(state.get(n)) : d),
    write: async (n, v) => state.set(n, structuredClone(v)),
  };
  const adapter = {
    seed: async () => structuredClone(seed),
    environment: async () => ({ version: 1 }),
    evidence: async () => ({ ownerHash: "a", decisionsHash: "b" }),
    backup: async () => ({
      archive: "fixture",
      sha256: "x",
      createdAt: 1,
      databaseDigest: "before",
      blobManifest: {},
    }),
    blobs: async () => {},
    project: () => structuredClone(projection),
    digest: () => current,
    destroyExact: async (ids) => {
      writes.push(ids);
      current = "after";
    },
  };
  const make = () =>
    new GlobalTagCleanup({
      store,
      adapter,
      canWrite: () => true,
      schedule: false,
      now: () => 1000,
    });
  const engine = make();
  return {
    state,
    store,
    adapter,
    seed,
    projection,
    writes,
    engine,
    make,
    setCurrent: (v) => (current = v),
  };
}
async function ready(f) {
  await f.engine.init();
  const p = await f.engine.prepare("owner", "thread");
  await f.engine.step(p.id);
  assert.equal(f.engine.plans[0].status, "awaiting-approval");
  return f.engine.plans[0];
}
const approval = (p) => ({
  planId: p.id,
  digest: p.digest,
  acknowledge: "DELETE EXACT GLOBAL TAGS",
});
test("prepare never writes; exact digest, owner, phrase and explicit approval required", async () => {
  const f = fixture(),
    p = await ready(f);
  assert.deepEqual(f.writes, []);
  assert.equal(p.approval, null);
  assert.equal(p.digest, hash(p.manifest));
  await assert.rejects(
    f.engine.approve("other", "thread", approval(p)),
    /GLOBAL_DENIED/,
  );
  await assert.rejects(
    f.engine.approve("owner", "other", approval(p)),
    /GLOBAL_DENIED/,
  );
  await assert.rejects(
    f.engine.approve("owner", "thread", { ...approval(p), digest: "bad" }),
    /GLOBAL_CONFIRMATION_REQUIRED/,
  );
  await assert.rejects(
    f.engine.approve("owner", "thread", { ...approval(p), acknowledge: "yes" }),
    /GLOBAL_CONFIRMATION_REQUIRED/,
  );
  await assert.rejects(
    f.engine.approve("owner", "thread", { ...approval(p), ids: ["8"] }),
    /INVALID_INPUT/,
  );
  await f.engine.approve("owner", "thread", approval(p));
  assert.deepEqual(f.writes, []);
  assert.equal(p.status, "preflight");
  await f.engine.step(p.id);
  assert.deepEqual(f.writes, [["7"]]);
  assert.equal(p.status, "completed");
  await f.engine.approve("owner", "thread", approval(p));
  await f.engine.step(p.id);
  assert.equal(f.writes.length, 1);
});
for (const kind of [
  "seed",
  "owner",
  "environment",
  "backup",
  "metadata",
  "disabled",
  "expiry",
  "digest",
  "stop",
  "last-check",
])
  test(`preflight ${kind} blocks dispatch`, async () => {
    const f = fixture(),
      p = await ready(f);
    await f.engine.approve("owner", "thread", approval(p));
    if (kind === "seed") f.seed.tags[0].name = "Changed";
    if (kind === "owner")
      f.adapter.evidence = async () => ({ ownerHash: "changed" });
    if (kind === "environment")
      f.adapter.environment = async () => ({ version: 2 });
    if (kind === "backup")
      f.adapter.backup = async () => {
        throw Error("GLOBAL_BACKUP_CHANGED");
      };
    if (kind === "metadata") f.projection.counts.images = 2;
    if (kind === "disabled") f.engine.canWrite = () => false;
    if (kind === "expiry") f.engine.now = () => 1000 + 86400001;
    if (kind === "digest") p.manifest.tags[0].name = "tampered";
    if (kind === "stop")
      await f.engine.control("owner", "thread", {
        planId: p.id,
        action: "stop",
      });
    if (kind === "last-check") f.setCurrent("drift");
    await f.engine.step(p.id);
    assert.deepEqual(f.writes, []);
    assert.ok(["stopped", "conflicted"].includes(p.status));
  });
test("lost response is read back without retry; wrong result stays uncertain", async () => {
  const f = fixture(),
    p = await ready(f);
  f.adapter.destroyExact = async (ids) => {
    f.writes.push(ids);
    throw Error("network");
  };
  await f.engine.approve("owner", "thread", approval(p));
  await f.engine.step(p.id);
  assert.equal(p.status, "uncertain");
  assert.ok(f.engine.blocksWrites());
  await f.engine.step(p.id);
  assert.equal(f.writes.length, 1);
  await assert.rejects(
    f.engine.control("owner", "thread", { planId: p.id, action: "reconcile" }),
    /GLOBAL_READBACK_MISMATCH/,
  );
  f.setCurrent("after");
  await f.engine.control("owner", "thread", {
    planId: p.id,
    action: "reconcile",
  });
  assert.equal(p.status, "completed");
  assert.equal(f.writes.length, 1);
});
test("durable intent persistence failure sends zero writes", async () => {
  const f = fixture(),
    p = await ready(f);
  await f.engine.approve("owner", "thread", approval(p));
  const original = f.store.write;
  f.store.write = async (n, v) => {
    if (n === "global-tag-state.json" && v.value.plans.some((p) => p.intent))
      throw Error("disk");
    return original(n, v);
  };
  await f.engine.step(p.id);
  assert.equal(f.engine.available, false);
  assert.deepEqual(f.writes, []);
});
test("restart never dispatches approved or uncertain work; signed-state tampering fails closed", async () => {
  const f = fixture(),
    p = await ready(f);
  await f.engine.approve("owner", "thread", approval(p));
  const restarted = f.make();
  await restarted.init();
  assert.equal(restarted.plans[0].status, "stopped");
  assert.deepEqual(f.writes, []);
  const v = f.state.get("global-tag-state.json");
  v.value.plans[0].manifest.tags[0].id = "8";
  const corrupt = f.make();
  await corrupt.init();
  assert.equal(corrupt.available, false);
});
test("stop while backup read is pending prevents dispatch", async () => {
  const f = fixture(),
    p = await ready(f);
  await f.engine.approve("owner", "thread", approval(p));
  let release, entered;
  const waiting = new Promise((r) => (entered = r));
  const original = f.adapter.backup;
  f.adapter.backup = async () => {
    entered();
    await new Promise((r) => (release = r));
    return original();
  };
  const run = f.engine.serial(() => f.engine.step(p.id));
  await waiting;
  const stop = f.engine.control("owner", "thread", {
    planId: p.id,
    action: "stop",
  });
  release();
  await run;
  await stop;
  assert.equal(p.status, "stopped");
  assert.deepEqual(f.writes, []);
});
test("read is bounded, exact and owner-bound; duplicates prepare idempotently", async () => {
  const f = fixture(),
    p = await ready(f);
  assert.equal((await f.engine.prepare("owner", "thread")).id, p.id);
  const d = f.engine.read("owner", "thread", { planId: p.id, page: 1 });
  assert.equal(d.tags[0].name, "Franchise <script>");
  assert.equal(d.rows.length, 2);
  assert.throws(() =>
    f.engine.read("owner", "thread", { planId: p.id, page: 0 }),
  );
  assert.throws(() => f.engine.read("other", "thread", { planId: p.id }));
  assert.deepEqual(f.writes, []);
});
