import test from "node:test";
import assert from "node:assert/strict";
import { ExactCharacterCleanup } from "../service/exact-character-cleanup.mjs";
import {
  EXACT,
  hash,
  validateSource,
} from "../service/exact-character-policy.mjs";
import { seal } from "../service/tag-cleanup-policy.mjs";
export async function fixture(count = 7) {
  const disk = new Map(),
    writes = [],
    tags = [1, 2, 3].map((v) => ({
      id: String(v),
      name: "Fixture " + v,
      ignore_auto_tag: false,
    }));
  const scenes = Array.from({ length: count }, (_, i) => ({
    id: String(i + 10),
    title: "Fixture",
    tags: structuredClone(tags),
    custom_fields: { safe: "yes" },
    studio: { id: "8", name: "Fixture studio" },
    play_count: 1,
    updated_at: "old",
  }));
  const source = {
    schema: 1,
    type: EXACT.type,
    owner: "owner",
    reference: "synthetic-review",
    sourceHash: "a".repeat(64),
    reviewedAt: 1,
    rows: scenes.map((s, i) => {
      const remove = i === 0 ? ["1", "2"] : ["1"];
      const fingerprint = hash(s);
      return {
        sceneId: s.id,
        before: ["1", "2", "3"],
        remove,
        after: i === 0 ? ["3"] : ["2", "3"],
        observedState: structuredClone(s),
        beforeFingerprint: fingerprint,
        evidence: remove.map((sourceId) => ({
          id: "d" + s.id + sourceId,
          sceneId: s.id,
          sourceId,
          decisionId: "fixture",
          action: "remove",
          status: "supported",
          removalEstablished: true,
          beforeFingerprint: fingerprint,
          evidence: [{ kind: "user-decision", reference: "fixture" }],
          reason: "Fixture removal",
        })),
        excluded: [],
      };
    }),
    excluded: [],
    historical: { scenes: count, relationships: count + 1 },
  };
  const store = {
    read: async (n, f) => structuredClone(disk.has(n) ? disk.get(n) : f),
    write: async (n, v) => disk.set(n, structuredClone(v)),
  };
  let clock = 1000,
    writeAllowed = true;
  const adapter = {
    environment: async () => ({ version: 1 }),
    definitions: async (ids) =>
      ids.map((id) => structuredClone(tags.find((t) => t.id === id) || null)),
    scene: async (id) => {
      const s = scenes.find((s) => s.id === id);
      if (!s) throw Error("SCENE_NOT_FOUND");
      return structuredClone(s);
    },
    remove: async (id, removals) => {
      writes.push({ id, removals: structuredClone(removals) });
      const s = scenes.find((s) => s.id === id);
      s.tags = s.tags.filter((t) => !removals.includes(t.id));
      s.updated_at = "changed";
    },
  };
  const make = () =>
    new ExactCharacterCleanup({
      store,
      adapter,
      canWrite: () => writeAllowed,
      now: () => clock,
      schedule: false,
    });
  const engine = make();
  await engine.init();
  const stage = () =>
    disk.set("exact-character-source.json", {
      value: structuredClone(source),
      mac: seal(engine.key.key, source),
    });
  stage();
  const prepare = () => engine.prepare("owner");
  const approve = async (p) => {
    const d = engine.read("owner", { planId: p.id });
    return engine.approve("owner", {
      planId: p.id,
      digest: d.plan.digest,
      challenge: d.challenge,
      acknowledged: true,
    });
  };
  return {
    disk,
    store,
    tags,
    scenes,
    source,
    writes,
    adapter,
    engine,
    make,
    stage,
    prepare,
    approve,
    time: (v) => (clock = v),
    canWrite: (v) => (writeAllowed = v),
  };
}
test("frozen exact removals, one approval, five-scene batches and verified progress", async () => {
  const f = await fixture();
  const p = await f.prepare();
  assert.equal(p.scenes, 7);
  assert.equal(p.relationships, 8);
  assert.equal(f.writes.length, 0);
  await f.approve(p);
  assert.equal(f.writes.length, 0);
  const a = await f.engine.tick("owner", p.id);
  assert.equal(a.counts.verified, 5);
  assert.equal(a.verifiedRelationships, 6);
  assert.equal(a.state, "executing");
  await f.engine.tick("owner", p.id);
  assert.equal(f.engine.get("owner", p.id).state, "completed");
  assert.equal(f.writes.length, 7);
  assert.deepEqual(
    f.scenes[0].tags.map((t) => t.id),
    ["3"],
  );
  assert(f.scenes.every((s) => s.custom_fields.safe === "yes"));
  await f.engine.tick("owner", p.id);
  assert.equal(f.writes.length, 7);
});
test("environment change replaces only an unapproved review with a new immutable scope and no writes", async () => {
  const f = await fixture(1),
    old = await f.prepare();
  const oldManifest = structuredClone(
    f.engine.read("owner", { planId: old.id }).manifest,
  );
  assert((await f.engine.list("owner")).preparationAvailable);
  assert.equal((await f.prepare()).id, old.id);
  f.adapter.environment = async () => ({ version: 2 });
  await assert.rejects(() => f.approve(old), /EXACT_ENVIRONMENT_CHANGED/);
  const fresh = await f.prepare();
  assert.notEqual(fresh.id, old.id);
  assert.notEqual(fresh.digest, old.digest);
  const historical = f.engine.read("owner", { planId: old.id });
  assert.equal(historical.plan.state, "invalidated");
  assert.deepEqual(historical.manifest, oldManifest);
  assert.equal(fresh.state, "awaiting-approval");
  assert.equal(fresh.approved, false);
  await assert.rejects(() => f.approve(old));
  assert.equal(f.writes.length, 0);
});
test("different removal sets never become a cross-scene union", async () => {
  const f = await fixture(2),
    p = await f.prepare();
  await f.approve(p);
  await f.engine.tick("owner", p.id);
  assert.deepEqual(
    f.writes.map((w) => w.removals),
    [["1", "2"], ["1"]],
  );
  assert.deepEqual(
    f.scenes[1].tags.map((t) => t.id),
    ["2", "3"],
  );
});
test("final tag removal is explicitly previewed", async () => {
  const f = await fixture(1);
  f.scenes[0].tags = f.scenes[0].tags.slice(0, 2);
  const r = f.source.rows[0];
  r.before = ["1", "2"];
  r.after = [];
  r.observedState = structuredClone(f.scenes[0]);
  r.beforeFingerprint = hash(r.observedState);
  r.evidence.forEach((e) => (e.beforeFingerprint = r.beforeFingerprint));
  f.stage();
  const p = await f.prepare();
  assert.equal(p.emptyAfter, 1);
  await f.approve(p);
  await f.engine.tick("owner", p.id);
  assert.deepEqual(f.scenes[0].tags, []);
});
test("admission excludes stale, absent, unknown scenes and missing/ignored tags", async () => {
  for (const change of [
    "stale",
    "absent",
    "missing-scene",
    "missing-tag",
    "ignored",
    "renamed",
  ]) {
    const f = await fixture(2);
    if (change === "stale") f.scenes[0].title = "changed";
    if (change === "absent") f.scenes[0].tags = f.scenes[0].tags.slice(2);
    if (change === "missing-scene") f.scenes.shift();
    if (change === "missing-tag") f.tags.splice(1, 1);
    if (change === "ignored") f.tags[1].ignore_auto_tag = true;
    if (change === "renamed") f.tags[1].name = "Changed";
    if (["missing-tag", "renamed"].includes(change))
      await assert.rejects(f.prepare(), /NO_VALID/);
    else {
      const p = await f.prepare();
      assert.equal(p.scenes, 1);
      assert.equal(f.writes.length, 0);
    }
  }
});
test("source rejects duplicate scenes, wildcard, absent ID, additions, replacements, definition writes, unsupported evidence", async () => {
  const f = await fixture(1);
  for (const mutate of [
    (s) => s.rows.push(structuredClone(s.rows[0])),
    (s) => (s.rows[0].remove = ["*"]),
    (s) => (s.rows[0].remove = ["9"]),
    (s) => (s.rows[0].after = ["3", "4"]),
    (s) => (s.rows[0].rename = "bad"),
    (s) => (s.rows[0].evidence[0].removalEstablished = false),
    (s) => (s.rows[0].evidence[0].action = "replace"),
    (s) => s.rows[0].excluded.push({ sourceId: "1" }),
    (s) => (s.rows[0].observedState.title = "changed"),
  ]) {
    const s = structuredClone(f.source);
    mutate(s);
    assert.throws(() => validateSource(s));
  }
});
test("client cannot supply replacement scope or forged approval flags", async () => {
  const f = await fixture(1);
  await assert.rejects(f.engine.prepare("owner", { rows: [] }), /INVALID/);
  const p = await f.prepare();
  await assert.rejects(
    f.engine.approve("owner", { planId: p.id, approved: true }),
    /INVALID/,
  );
  await f.engine.tick("owner", p.id);
  assert.equal(f.writes.length, 0);
});
test("authenticated review challenge is owner, manifest and expiry bound; approval is single-use", async () => {
  const f = await fixture(1),
    p = await f.prepare(),
    d = f.engine.read("owner", { planId: p.id });
  assert.throws(() => f.engine.read("wrong", { planId: p.id }), /DENIED/);
  for (const a of [
    { digest: "x" },
    { challenge: "x" },
    { acknowledged: false },
  ])
    await assert.rejects(
      f.engine.approve("owner", {
        planId: p.id,
        digest: p.digest,
        challenge: d.challenge,
        acknowledged: true,
        ...a,
      }),
      /REVIEW/,
    );
  f.time(1000 + EXACT.challengeTTL + 1);
  await assert.rejects(
    f.engine.approve("owner", {
      planId: p.id,
      digest: p.digest,
      challenge: d.challenge,
      acknowledged: true,
    }),
    /REVIEW/,
  );
  await f.approve(p);
  await assert.rejects(f.approve(p), /REPLAY/);
  assert.equal(f.writes.length, 0);
});
test("expired pending review cannot approve", async () => {
  const f = await fixture(1),
    p = await f.prepare();
  f.time(p.expiresAt + 1);
  await assert.rejects(f.approve(p), /EXPIRED/);
  assert.equal(f.engine.get("owner", p.id).state, "expired");
});
test("expired approval stops before write", async () => {
  const f = await fixture(1),
    p = await f.prepare();
  await f.approve(p);
  f.time(1000 + EXACT.ttl + 1);
  assert.equal((await f.engine.tick("owner", p.id)).state, "expired");
  assert.equal(f.writes.length, 0);
});
test("tampered frozen scene/tag/final/count/operation/fingerprint fails before writes", async () => {
  for (const mutate of [
    (m) => (m.entries[0].sceneId = "999"),
    (m) => (m.entries[0].remove = ["3"]),
    (m) => (m.entries[0].after = []),
    (m) => m.counts.relationships++,
    (m) => m.entries.push(m.entries[0]),
    (m) => (m.entries[0].metadataHash = "x"),
  ]) {
    const f = await fixture(1),
      p = await f.prepare();
    await f.approve(p);
    mutate(f.engine.plans.get(p.id).manifest);
    await assert.rejects(f.engine.tick("owner", p.id));
    assert.equal(f.writes.length, 0);
  }
});
test("journal, approval and durable MAC corruption fail closed on restart", async () => {
  for (const kind of ["mac", "journal", "approval"]) {
    const f = await fixture(1),
      p = await f.prepare();
    await f.approve(p);
    const name = `exact-character-plan-${p.id}.json`,
      d = f.disk.get(name);
    if (kind === "mac") d.mac = "bad";
    else {
      if (kind === "journal") d.value.journal[0].event = "forged";
      else d.value.approval = true;
      d.mac = seal(f.engine.key.key, d.value);
    }
    const next = f.make();
    await next.init();
    assert.equal(next.available, false);
    assert.equal(next.blocksWrites(), true);
  }
});
test("stale scene and external already-absent pair skip without overwriting; independent scenes continue", async () => {
  const f = await fixture(3),
    p = await f.prepare();
  await f.approve(p);
  f.scenes[0].title = "new";
  f.scenes[1].tags = f.scenes[1].tags.filter((t) => t.id !== "1");
  const r = await f.engine.tick("owner", p.id);
  assert.equal(r.counts.skipped, 2);
  assert.equal(r.counts.verified, 1);
  assert.equal(r.verifiedRelationships, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(r.state, "completed-with-skips");
});
test("playback changes do not make metadata stale", async () => {
  const f = await fixture(1),
    p = await f.prepare();
  await f.approve(p);
  Object.assign(f.scenes[0], {
    updated_at: "new",
    play_count: 99,
    resume_time: 50,
    last_played_at: "now",
  });
  await f.engine.tick("owner", p.id);
  assert.equal(f.writes.length, 1);
});
test("missing scene and changed definitions skip safely", async () => {
  const f = await fixture(3),
    p = await f.prepare();
  await f.approve(p);
  f.scenes.shift();
  f.tags[1].name = "Changed";
  const r = await f.engine.tick("owner", p.id);
  assert.equal(r.counts.skipped, 3);
  assert.equal(f.writes.length, 0);
});
test("pause during a scene stops after its verification; resume finishes without duplicates", async () => {
  const f = await fixture(7),
    p = await f.prepare();
  await f.approve(p);
  const remove = f.adapter.remove;
  let pause;
  f.adapter.remove = async (...a) => {
    await remove(...a);
    pause = f.engine.control("owner", { planId: p.id, action: "pause" });
  };
  await f.engine.tick("owner", p.id);
  await pause;
  assert.equal(f.writes.length, 1);
  assert.equal(f.engine.get("owner", p.id).state, "paused");
  f.adapter.remove = remove;
  await f.engine.control("owner", { planId: p.id, action: "resume" });
  await f.engine.tick("owner", p.id);
  await f.engine.tick("owner", p.id);
  assert.equal(f.writes.length, 7);
});
test("restart pauses partially completed plan and does not auto-resume", async () => {
  const f = await fixture(7),
    p = await f.prepare();
  await f.approve(p);
  await f.engine.tick("owner", p.id);
  const next = f.make();
  await next.init();
  assert.equal(next.get("owner", p.id).state, "paused");
  await next.tick("owner", p.id);
  assert.equal(f.writes.length, 5);
  await next.control("owner", { planId: p.id, action: "resume" });
  await next.tick("owner", p.id);
  assert.equal(f.writes.length, 7);
});
test("lost write response followed by exact readback succeeds without retry", async () => {
  const f = await fixture(1),
    p = await f.prepare();
  await f.approve(p);
  const remove = f.adapter.remove;
  f.adapter.remove = async (...a) => {
    await remove(...a);
    throw Error("NETWORK_FAILURE");
  };
  assert.equal((await f.engine.tick("owner", p.id)).state, "completed");
  assert.equal(f.writes.length, 1);
});
test("write no-op/readback mismatch stops and cannot be resumed as a duplicate write", async () => {
  const f = await fixture(3),
    p = await f.prepare();
  await f.approve(p);
  f.adapter.remove = async () => {
    throw Error("NETWORK_FAILURE");
  };
  const r = await f.engine.tick("owner", p.id);
  assert.equal(r.state, "failed");
  assert.equal(r.counts.failed, 1);
  await assert.rejects(
    f.engine.control("owner", { planId: p.id, action: "resume" }),
    /UNSAFE/,
  );
  assert.equal(f.writes.length, 0);
});
test("interrupted intent is reconciled read-only after restart with uncertain attribution", async () => {
  const f = await fixture(2),
    p = await f.prepare();
  await f.approve(p);
  const scene = f.adapter.scene,
    remove = f.adapter.remove;
  let unavailable = false;
  f.adapter.remove = async (...a) => {
    await remove(...a);
    unavailable = true;
  };
  f.adapter.scene = async (...a) => {
    if (unavailable) throw Error("NETWORK_FAILURE");
    return scene(...a);
  };
  assert.equal((await f.engine.tick("owner", p.id)).state, "failed");
  assert.equal(f.writes.length, 1);
  f.adapter.scene = scene;
  f.adapter.remove = remove;
  const next = f.make();
  await next.init();
  await next.control("owner", { planId: p.id, action: "resume" });
  const r = await next.tick("owner", p.id);
  assert.equal(f.writes.length, 2);
  assert.equal(r.counts.recovered, 1);
  assert.equal(r.counts.verified, 1);
  assert.equal(r.recoveredRelationships, 2);
});
test("owner read failure is retryable only via explicit resume, never blindly writes", async () => {
  const f = await fixture(1),
    p = await f.prepare();
  await f.approve(p);
  const scene = f.adapter.scene;
  f.adapter.scene = async () => {
    throw Error("NETWORK_FAILURE");
  };
  assert.equal((await f.engine.tick("owner", p.id)).state, "failed");
  assert.equal(f.writes.length, 0);
  f.adapter.scene = scene;
  await f.engine.control("owner", { planId: p.id, action: "resume" });
  await f.engine.tick("owner", p.id);
  assert.equal(f.writes.length, 1);
});
test("simultaneous execution calls serialize; approval integrity checked each batch", async () => {
  const f = await fixture(7),
    p = await f.prepare();
  await f.approve(p);
  await Promise.all([
    f.engine.tick("owner", p.id),
    f.engine.tick("owner", p.id),
  ]);
  assert.equal(f.writes.length, 7);
  assert.equal(new Set(f.writes.map((w) => w.id)).size, 7);
});
test("environment or writes gate blocks execution", async () => {
  for (const mode of ["environment", "gate"]) {
    const f = await fixture(1),
      p = await f.prepare();
    await f.approve(p);
    if (mode === "environment")
      f.adapter.environment = async () => ({ version: 2 });
    else f.canWrite(false);
    assert.equal((await f.engine.tick("owner", p.id)).state, "failed");
    assert.equal(f.writes.length, 0);
  }
});
test("durable intent failure prevents owner write", async () => {
  const f = await fixture(1),
    p = await f.prepare();
  await f.approve(p);
  const write = f.store.write;
  f.store.write = async (n, v) => {
    if (v.value?.rows?.some((r) => r.status === "intent"))
      throw Error("DISK_FAILED");
    await write(n, v);
  };
  await f.engine.tick("owner", p.id);
  assert.equal(f.writes.length, 0);
  assert.equal(f.engine.available, false);
});
