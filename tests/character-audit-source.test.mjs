import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixture } from "./exact-character-cleanup.test.mjs";
import { auditedSource } from "../scripts/lib/character-audit-source.mjs";
import { stageSource } from "../scripts/lib/character-staging.mjs";
import {
  readSources,
  SOURCE_INDEX,
} from "../service/exact-character-sources.mjs";
import { hash, validateSource } from "../service/exact-character-policy.mjs";
import { Store } from "../service/store.mjs";
import { acquireInstance } from "../service/instance.mjs";
async function setup(count = 3) {
  const f = await fixture(count);
  // Fully synthetic native records and imported-research references.
  const records = f.tags.map((t) => ({
    tagId: t.id,
    nativeName: t.name,
    canonical: t.name,
    category: "character",
    gender: "male",
    basis: "Synthetic reviewed male identity",
    evidence: "fixture-research",
    sources: ["https://example.invalid/source"],
    policyApproval: false,
  }));
  const native = (t) => ({
    ...t,
    aliases: [],
    description: "",
    parents: [],
    children: [],
    updated_at: "old",
  });
  f.tags.forEach((t) =>
    Object.assign(t, { aliases: [], description: "", parents: [] }),
  );
  const inventory = {
    tags: f.tags.map((t) => ({
      ...native(t),
      identity: records.find((r) => r.tagId === t.id),
    })),
  };
  const audit = {
    summary: {
      removalRelationships: count + 1,
      removalScenes: count,
      uncertainRelationships: 0,
    },
    scenes: f.source.rows.map((r) => {
      const findings = r.remove.map((sourceId) => ({
        id: r.sceneId + ":" + sourceId,
        sceneId: r.sceneId,
        sourceId,
        targetId: null,
        action: "remove",
        removalEstablished: true,
        status: "supported",
        classification: "confirmed-policy-ineligible",
        reason: "Synthetic policy exclusion",
        beforeFingerprint: r.beforeFingerprint,
        evidence: [
          {
            kind: "current-native-tag",
            tagId: sourceId,
            tagFingerprint: hash(native(f.tags.find((t) => t.id === sourceId))),
          },
          {
            kind: "registry-provenance",
            record: records.find((t) => t.tagId === sourceId),
          },
        ],
      }));
      return {
        sceneId: r.sceneId,
        before: r.before,
        after: r.after,
        observedState: r.observedState,
        beforeFingerprint: r.beforeFingerprint,
        stageA: { remove: r.remove, after: r.after },
        findings,
        accepted: findings.map((f) => f.id),
      };
    }),
  };
  const candidates = {
    approved: false,
    executable: false,
    summary: { relationships: count + 1, scenes: count },
    scenes: audit.scenes.map((r) => ({
      sceneId: r.sceneId,
      before: r.before,
      remove: r.stageA.remove,
      after: r.stageA.after,
      beforeFingerprint: r.beforeFingerprint,
      findings: structuredClone(r.findings),
    })),
  };
  const args = {
    audit,
    candidates,
    inventory,
    reassignments: { approved: false, candidates: [] },
    completedPairs: new Set(),
    adapter: f.adapter,
    identity: {
      resolve: (t) => records.filter((r) => r.tagId === t.id),
      classify: () => ({
        status: "ineligible",
        reason: "ineligible-male-character",
      }),
    },
    admission: {
      kind: "reviewed-policy-audit-v1",
      policy: {
        id: "female-identities-only-v1",
        reference: "fixture-policy",
        documentHash: "b".repeat(64),
      },
      auditHashes: { fixture: "c".repeat(64) },
      registryHash: "d".repeat(64),
      ownerCodeHash: "e".repeat(64),
    },
    owner: "owner",
    reference: "fixture",
    reviewedAt: 1,
  };
  return { f, args, records, run: () => auditedSource(args) };
}
test("policy source admits exact evidence without pretending an individual user decision", async () => {
  const v = await setup();
  const r = await v.run();
  assert.equal(validateSource(r.source), 4);
  assert.equal(r.excluded.length, 0);
  assert(
    r.source.rows.every((r) =>
      r.evidence.every(
        (e) => !e.decisionId && e.kind === "reviewed-policy-removal-v1",
      ),
    ),
  );
});
for (const problem of [
  "duplicate-scene",
  "duplicate-pair",
  "invalid-id",
  "unknown-id",
  "reassignment",
  "unresolved",
  "forged-user",
  "unsupported-evidence",
  "tampered-before",
  "combined-after",
  "renamed-registry",
  "eligible-registry",
])
  test("audit admission rejects " + problem, async () => {
    const v = await setup(),
      { args: a } = v,
      c = a.candidates.scenes[0],
      r = a.audit.scenes[0];
    if (problem === "duplicate-scene") a.candidates.scenes.push(c);
    if (problem === "duplicate-pair") c.remove.push(c.remove[0]);
    if (problem === "invalid-id") c.sceneId = "*";
    if (problem === "unknown-id") a.inventory.tags = [];
    if (problem === "reassignment")
      a.reassignments.candidates.push({
        sceneId: c.sceneId,
        sourceId: c.remove[0],
        targetId: null,
      });
    if (problem === "unresolved") {
      r.findings[0].classification = "uncertain";
      c.findings = structuredClone(r.findings);
    }
    if (problem === "forged-user") {
      r.findings[0].evidence.push({
        kind: "user-decision",
        reference: "fabricated",
      });
      c.findings = structuredClone(r.findings);
    }
    if (problem === "unsupported-evidence") {
      r.findings[0].evidence = [];
      c.findings = structuredClone(r.findings);
    }
    if (problem === "tampered-before") c.beforeFingerprint = "a".repeat(64);
    if (problem === "combined-after") c.after.push("99");
    if (problem === "renamed-registry")
      v.records[0] = { ...v.records[0], nativeName: "Other" };
    if (problem === "eligible-registry")
      v.records[0] = { ...v.records[0], gender: "female" };
    if (["renamed-registry", "eligible-registry"].includes(problem)) {
      const result = await v.run();
      assert(
        result.excluded.some((e) => e.reason === "EXACT_POLICY_NOT_VERIFIED"),
      );
    } else await assert.rejects(v.run);
  });
for (const problem of [
  "renamed",
  "definition-change",
  "stale",
  "absent",
  "completed",
  "missing-tag",
  "missing-scene",
])
  test("fresh exclusion " + problem, async () => {
    const v = await setup(),
      pair = v.args.candidates.scenes[0];
    if (problem === "renamed") v.f.tags[0].name = "Changed";
    if (problem === "definition-change") v.f.tags[0].aliases = ["Changed"];
    if (problem === "stale") v.f.scenes[0].title = "Changed";
    if (problem === "absent")
      v.f.scenes[0].tags = v.f.scenes[0].tags.filter((t) => t.id !== "1");
    if (problem === "completed") v.args.completedPairs.add(pair.sceneId + ":1");
    if (problem === "missing-tag") v.f.tags.shift();
    if (problem === "missing-scene") v.f.scenes.shift();
    const r = await v.run();
    assert(r.excluded.length > 0);
    assert.equal(v.f.writes.length, 0);
  });
test("315 scenes /317 removals/18 empty results execute in63 batches only in fixtures", async () => {
  const v = await setup(315),
    { f, args: a } = v;
  // Add a second multi-removal scene; make18 single-removal scenes empty.
  for (let i = 1; i < 20; i++) {
    const scene = f.scenes[i],
      row = a.audit.scenes[i],
      c = a.candidates.scenes[i];
    if (i === 1) {
      row.stageA.remove = ["1", "2"];
      row.stageA.after = ["3"];
      const extra = structuredClone(row.findings[0]);
      extra.sourceId = "2";
      extra.id = scene.id + ":2";
      extra.evidence = structuredClone(a.audit.scenes[0].findings[1].evidence);
      row.findings.push(extra);
      row.accepted.push(extra.id);
    } else {
      scene.tags = scene.tags.filter((t) => t.id === "1");
      row.before = ["1"];
      row.stageA.after = [];
      row.observedState = structuredClone(scene);
      row.beforeFingerprint = hash(scene);
      row.findings.forEach(
        (e) => (e.beforeFingerprint = row.beforeFingerprint),
      );
    }
    Object.assign(c, {
      before: row.before,
      remove: row.stageA.remove,
      after: row.stageA.after,
      beforeFingerprint: row.beforeFingerprint,
      findings: structuredClone(row.findings),
    });
  }
  a.audit.summary.removalRelationships = 317;
  a.candidates.summary.relationships = 317;
  const r = await v.run();
  f.disk.set("exact-character-source.json", f.engine.wrap(r.source));
  const p = await f.prepare();
  assert.equal(p.relationships, 317);
  assert.equal(p.emptyAfter, 18);
  assert.equal(p.scenes, 315);
  await f.approve(p);
  for (let i = 0; i < 63; i++) {
    const before = f.writes.length;
    await f.engine.tick("owner", p.id);
    assert.equal(f.writes.length - before, 5);
  }
  assert.equal(f.engine.get("owner", p.id).state, "completed");
  assert.equal(f.writes.flatMap((w) => w.removals).length, 317);
  assert(f.scenes.every((s) => s.custom_fields.safe === "yes"));
  await f.engine.tick("owner", p.id);
  assert.equal(f.writes.length, 315);
});
test("versioned staging preserves old bytes, retries, history, restart and approval binding", async () => {
  const f = await fixture(1),
    old = await f.prepare();
  await f.approve(old);
  await f.engine.tick("owner", old.id);
  const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "stash-source-generations-"),
    ),
    store = new Store(dir);
  for (const [n, v] of f.disk) await store.write(n, v);
  f.engine.store = store;
  const historical = await fs.readFile(
      store.filename("exact-character-plan-" + old.id + ".json"),
    ),
    legacy = await fs.readFile(store.filename("exact-character-source.json"));
  const second = structuredClone(f.source);
  second.sourceHash = "b".repeat(64);
  second.rows[0].before = ["3"];
  second.rows[0].remove = ["3"];
  second.rows[0].after = [];
  second.rows[0].observedState = structuredClone(f.scenes[0]);
  second.rows[0].beforeFingerprint = hash(f.scenes[0]);
  second.rows[0].evidence = [
    {
      ...second.rows[0].evidence[0],
      sourceId: "3",
      beforeFingerprint: second.rows[0].beforeFingerprint,
    },
  ];
  await stageSource(f.engine, second);
  const p = await f.prepare();
  assert.equal((await f.prepare()).id, p.id);
  assert.equal(p.approved, false);
  assert.notEqual(p.digest, old.digest);
  await stageSource(f.engine, second);
  assert.deepEqual(
    await fs.readFile(store.filename("exact-character-source.json")),
    legacy,
  );
  assert.deepEqual(
    await fs.readFile(
      store.filename("exact-character-plan-" + old.id + ".json"),
    ),
    historical,
  );
  const fresh = f.make();
  fresh.store = store;
  await fresh.init();
  assert(fresh.available);
  assert.equal((await fresh.source("owner")).sourceHash, second.sourceHash);
  assert.equal(fresh.get("owner", old.id).state, "completed");
  const newPlan = fresh.get("owner", p.id),
    copy = structuredClone(newPlan);
  copy.approval = fresh.get("owner", old.id).approval;
  assert.throws(() => fresh.verify(copy), /APPROVAL/);
  await assert.rejects(() => readSources(fresh, "other"));
  const index = await store.read(SOURCE_INDEX);
  index.value.active = "0".repeat(64);
  await store.write(SOURCE_INDEX, index);
  await assert.rejects(() => fresh.source("owner"), /INTEGRITY/);
});
test("operator uses the same exclusive instance lock as companion; concurrent import cannot stage", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-import-lock-")),
    release = await acquireInstance(dir);
  try {
    await assert.rejects(
      () => acquireInstance(dir),
      /INSTANCE_ALREADY_RUNNING/,
    );
  } finally {
    await release();
  }
});
test("new evidence schema rejects unsupported policy, identity changes and false decision provenance", async () => {
  const v = await setup(),
    { source } = await v.run();
  for (const change of [
    (s) => (s.schema = 99),
    (s) => (s.admission.kind = "anything"),
    (s) => (s.admission.policy.id = "arbitrary"),
    (s) => (s.sourceHash = "0".repeat(64)),
    (s) => (s.rows[0].evidence[0].decisionId = "forged"),
    (s) => (s.rows[0].evidence[0].registryRecord.gender = "female"),
    (s) => {
      const e = s.rows[0].evidence[0];
      e.registryRecord.gender = "female";
      e.reasonCode = null;
      e.ownerClassification.reason = null;
    },
    (s) => (s.rows[0].evidence[0].definition.name = "renamed"),
  ]) {
    const bad = structuredClone(source);
    change(bad);
    assert.throws(() => validateSource(bad));
  }
});
test("source index rejects signed bad schema, missing active, missing history and altered content", async () => {
  for (const mode of [
    "schema",
    "missing-active",
    "missing-history",
    "tampered-content",
    "wrong-owner",
  ]) {
    const f = await fixture(1),
      digest = hash(f.source),
      name = "exact-character-source-" + digest + ".json";
    const index = {
      schema: 1,
      owner: "owner",
      active: digest,
      sources: [{ digest, file: name }],
    };
    f.disk.set(name, f.engine.wrap(f.source));
    if (mode === "schema") index.schema = 2;
    if (mode === "missing-active") index.active = "0".repeat(64);
    if (mode === "missing-history") f.disk.delete(name);
    if (mode === "wrong-owner") index.owner = "other";
    if (mode === "tampered-content") {
      const s = structuredClone(f.source);
      s.reference = "changed";
      f.disk.set(name, f.engine.wrap(s));
    }
    f.disk.set(SOURCE_INDEX, f.engine.wrap(index));
    await assert.rejects(() => f.engine.source("owner"));
  }
});
