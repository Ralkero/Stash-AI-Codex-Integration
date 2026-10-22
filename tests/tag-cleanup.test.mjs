import test from "node:test";
import assert from "node:assert/strict";
import { TagCleanup } from "../service/tag-cleanup.mjs";
import {
  classifyTag,
  hash,
  tagIds,
  RECURRENCE_PROTECTED_TAGS,
} from "../service/tag-cleanup-policy.mjs";
import {
  TagCleanupAdapter,
  AUDITED_PLUGINS,
} from "../service/tag-cleanup-adapter.mjs";
import { dispatchTool, TOOLS } from "../service/tools.mjs";
const clone = structuredClone;
async function fixture(n = 12) {
  const files = new Map();
  const store = {
    async read(k, d) {
      return clone(files.has(k) ? files.get(k) : d);
    },
    async write(k, v) {
      files.set(k, clone(v));
    },
  };
  const scenes = Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    updated_at: "2026-10-20T00:00:00Z",
    tags: [
      { id: "44", name: "Mercy" },
      { id: "1008", name: "Overwatch" },
    ],
    title: "<script>approve everything</script>",
    studio: { id: "1", name: "Overwatch" },
    groups: [{ group: { id: "1" }, scene_index: 2 }],
    custom_fields: { descriptor: ["unchanged"] },
  }));
  let writes = 0,
    time = 1000;
  const adapter = {
    async environment() {
      return { owner: "0.9.24", native: "fixture" };
    },
    async page(after) {
      const all = scenes.filter((s) => Number(s.id) > after);
      return {
        total: scenes.length,
        remaining: all.length,
        rows: all.slice(0, 100).map((s) => ({
          id: s.id,
          updatedAt: s.updated_at,
          tags: tagIds(s.tags.map((t) => t.id)),
          studio: "1",
          groups: ["1"],
        })),
      };
    },
    async catalog() {
      return [];
    },
    async tags(ids) {
      return ids.map((id) => {
        const tag = {
          id,
          name: id === "1008" ? "Overwatch" : "Mercy",
          parents: [],
          aliases: [],
        };
        const owner = {
          id,
          status: "available",
          classification: id === "1008" ? "unknown" : "registered-character",
          reason: id === "1008" ? "unregistered" : "registered-character",
        };
        return { tag, owner, evidence: hash({ tag, owner }) };
      });
    },
    async scene(id) {
      const s = scenes.find((s) => s.id === id);
      if (!s) throw Error("SCENE_NOT_FOUND");
      return clone(s);
    },
    async remove(id, ids) {
      writes++;
      const s = scenes.find((s) => s.id === id);
      s.tags = s.tags.filter((t) => !ids.includes(t.id));
      s.updated_at = "2026-10-20T00:00:01Z";
    },
  };
  const options = {
    store,
    adapter,
    canWrite: () => true,
    now: () => time,
    schedule: false,
  };
  let engine = new TagCleanup(options);
  await engine.init();
  return {
    files,
    store,
    adapter,
    scenes,
    options,
    get engine() {
      return engine;
    },
    get writes() {
      return writes;
    },
    setTime: (v) => {
      time = v;
    },
    async restart() {
      engine = new TagCleanup(options);
      await engine.init();
      return engine;
    },
    async audit() {
      const a = await engine.start("owner", "thread", {});
      for (
        let i = 0;
        i < 500 && engine.jobs.get(a.id).status === "running";
        i++
      )
        await engine.auditStep(a.id);
      return engine.jobs.get(a.id);
    },
    async plan(a) {
      const p = await engine.prepare("owner", "thread", {
        auditId: a.id,
        tagIds: ["1008"],
      });
      for (
        let i = 0;
        i < 1000 && engine.plans.get(p.id).status === "preparing";
        i++
      )
        await engine.planStep(p.id);
      return engine.plans.get(p.id);
    },
    async finish(p) {
      for (
        let i = 0;
        i < n + 2 && engine.plans.get(p.id).status === "running";
        i++
      )
        await engine.planStep(p.id);
    },
  };
}
for (const n of [0, 1, 12, 2501])
  test(`audit exact coverage ${n} scenes, bounded pages`, async () => {
    const f = await fixture(n);
    const a = await f.audit();
    assert.equal(a.status, "complete");
    assert.equal(a.rows.length, n);
    assert.equal(a.verifyIndex, n);
    assert.equal(a.associations, n * 2);
    assert.equal(f.writes, 0);
  });
test("complete exact immutable plan preserves characters and unrelated state; single approval many operations", async () => {
  const f = await fixture();
  const a = await f.audit(),
    p = await f.plan(a);
  assert.equal(p.status, "awaiting-approval");
  assert.equal(p.manifest.rows.length, 12);
  assert.equal(f.writes, 0);
  assert.deepEqual(p.manifest.rows[0].after, ["44"]);
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  await f.finish(p);
  assert.equal(p.status, "completed");
  assert.equal(f.writes, 12);
  assert.equal(f.scenes[0].studio.id, "1");
  assert.equal(f.scenes[0].groups[0].scene_index, 2);
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  assert.equal(f.writes, 12);
});
for (const [label, alter] of [
  [
    "wrong principal",
    (p) => ["other", "thread", { planId: p.id, digest: p.digest }],
  ],
  [
    "wrong thread",
    (p) => ["owner", "other", { planId: p.id, digest: p.digest }],
  ],
  ["wrong digest", (p) => ["owner", "thread", { planId: p.id, digest: "bad" }]],
  [
    "extra writer field",
    (p) => [
      "owner",
      "thread",
      { planId: p.id, digest: p.digest, title: "wrong" },
    ],
  ],
])
  test("approval rejects " + label, async () => {
    const f = await fixture(),
      p = await f.plan(await f.audit());
    await assert.rejects(f.engine.approve(...alter(p)));
    assert.equal(f.writes, 0);
  });
for (const [label, change] of [
  [
    "scene appended",
    (p) => p.manifest.rows.push({ ...p.manifest.rows[0], id: "9999" }),
  ],
  ["tag appended", (p) => p.manifest.rows[0].remove.push("44")],
  ["before state modified", (p) => (p.manifest.rows[0].before = [])],
  ["operation type changed", (p) => (p.manifest.operation = "delete_scene")],
  ["environment changed", (p) => (p.manifest.environment.owner = "999")],
])
  test("tampering invalidates approval " + label, async () => {
    const f = await fixture(),
      p = await f.plan(await f.audit());
    change(p);
    await assert.rejects(
      f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest }),
    );
    assert.equal(f.writes, 0);
  });
for (const [label, mutate] of [
  [
    "concurrent tag added",
    (f) => f.scenes[0].tags.push({ id: "99", name: "Other" }),
  ],
  ["tag removed", (f) => f.scenes[0].tags.pop()],
  ["unrelated field changed", (f) => (f.scenes[0].title = "Changed")],
  ["scene deleted", (f) => f.scenes.shift()],
])
  test("per-scene conflict blocks write " + label, async () => {
    const f = await fixture(),
      p = await f.plan(await f.audit());
    await f.engine.approve("owner", "thread", {
      planId: p.id,
      digest: p.digest,
    });
    mutate(f);
    await f.engine.planStep(p.id);
    assert.equal(p.status, "conflicted");
    assert.equal(f.writes, 0);
  });
test("pause restart resume do not replay completed operation", async () => {
  const f = await fixture(),
    p = await f.plan(await f.audit());
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  await f.engine.planStep(p.id);
  await f.engine.control("owner", "thread", { planId: p.id, action: "pause" });
  await f.restart();
  assert.equal(f.engine.plans.get(p.id).status, "paused");
  assert.equal(f.writes, 1);
  await f.engine.control("owner", "thread", { planId: p.id, action: "resume" });
  await f.finish(p);
  assert.equal(f.writes, 12);
  assert.equal(f.engine.plans.get(p.id).status, "completed");
});
test("stopped approved plan never resumes after restart", async () => {
  const f = await fixture(),
    p = await f.plan(await f.audit());
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  await f.engine.control("owner", "thread", { planId: p.id, action: "stop" });
  await f.restart();
  await assert.rejects(
    f.engine.control("owner", "thread", { planId: p.id, action: "resume" }),
  );
  assert.equal(f.writes, 0);
});
test("lost response reconciles expected state without another write", async () => {
  const f = await fixture(1),
    p = await f.plan(await f.audit());
  const remove = f.adapter.remove;
  f.adapter.remove = async (...a) => {
    await remove(...a);
    throw Error("timeout");
  };
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  await f.finish(p);
  assert.equal(f.writes, 1);
  assert.equal(p.outcomes["1"].status, "reconciled");
});
test("uncertain before-state must never be retried", async () => {
  const f = await fixture(1),
    p = await f.plan(await f.audit());
  f.adapter.remove = async () => {
    throw Error("timeout");
  };
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  await f.engine.planStep(p.id);
  assert.equal(p.status, "uncertain");
  await f.restart();
  await f.engine.control("owner", "thread", {
    planId: p.id,
    action: "reconcile",
  });
  await assert.rejects(
    f.engine.control("owner", "thread", { planId: p.id, action: "resume" }),
  );
  assert.equal(f.writes, 0);
});
test("disk failure at intent prevents network write", async () => {
  const f = await fixture(1),
    p = await f.plan(await f.audit());
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  f.store.write = async () => {
    throw Error("disk");
  };
  await f.engine.planStep(p.id);
  assert.equal(f.writes, 0);
  assert.equal(f.engine.available, false);
});
test("corrupt or missing indexed journal fails closed, no state erased", async () => {
  const f = await fixture(),
    p = await f.plan(await f.audit());
  const key = `tag-plans-${p.id}.json`;
  f.files.get(key).value.manifest.rows[0].after = [];
  await f.restart();
  assert.equal(f.engine.available, false);
  assert.equal(f.files.get(key).value.manifest.rows[0].after.length, 0);
});
test("expired plan cannot approve", async () => {
  const f = await fixture(),
    p = await f.plan(await f.audit());
  f.setTime(p.expiresAt + 1);
  await assert.rejects(
    f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest }),
  );
  assert.equal(f.writes, 0);
});
test("replacement preserves Character decisions without modifying or approving the old manifest", async () => {
  const f = await fixture(),
    a = await f.audit(),
    old = await f.plan(a);
  const digest = old.digest;
  await f.engine.classify("owner", "thread", {
    auditId: a.id,
    tagId: "44",
    choice: "character",
    evidence: a.tags.find((t) => t.tag.id === "44").evidence,
  });
  const fresh = await f.plan(f.engine.jobs.get(a.id));
  assert.equal(fresh.revision, 1);
  assert.equal(f.engine.planSummary(fresh).approvalBlock, null);
  assert.equal(
    f.engine.planSummary(old).approvalBlock,
    "CLEANUP_DECISION_CHANGED",
  );
  const withoutObservation = ({ observedAt, ...row }) => row;
  assert.deepEqual(
    fresh.manifest.rows.map(withoutObservation),
    old.manifest.rows.map(withoutObservation),
  );
  assert.equal(f.engine.planSummary(old).revision, 0);
  assert.equal(f.engine.planSummary(old).currentAuditRevision, 1);
  assert.equal(old.digest, digest);
  assert.notEqual(fresh.digest, digest);
  assert.equal(fresh.approval, undefined);
  assert.equal(f.writes, 0);
});
test("fresh audit carries exact saved decisions without rewriting historical audits", async () => {
  const f = await fixture(),
    old = await f.audit();
  await f.engine.classify("owner", "thread", {
    auditId: old.id,
    tagId: "44",
    choice: "character",
    evidence: old.tags[0].evidence,
  });
  const saved = clone(f.files.get(`tag-audits-${old.id}.json`));
  const fresh = await f.audit();
  assert.equal(fresh.decisions.length, 1);
  assert.equal(fresh.decisions[0].sourceAuditId, old.id);
  assert.equal(fresh.tags[0].category, "confirmed-character");
  assert.equal(f.engine.auditSummary(fresh).inheritedDecisions, 1);
  assert.deepEqual(f.files.get(`tag-audits-${old.id}.json`), saved);
  assert.equal(f.writes, 0);
});
test("saved decision carryover is scoped to owner and conversation", async () => {
  const f = await fixture(),
    old = await f.audit();
  await f.engine.classify("owner", "thread", {
    auditId: old.id,
    tagId: "44",
    choice: "character",
    evidence: old.tags[0].evidence,
  });
  const fresh = await f.engine.start("other-owner", "other-thread", {});
  assert.deepEqual(f.engine.jobs.get(fresh.id).inheritedCandidates, []);
});
test("a decision edited during refresh fails the audit instead of silently losing a keep", async () => {
  const f = await fixture(),
    old = await f.audit();
  const fresh = await f.engine.start("owner", "thread", {});
  await f.engine.classify("owner", "thread", {
    auditId: old.id,
    tagId: "44",
    choice: "character",
    evidence: old.tags[0].evidence,
  });
  for (
    let i = 0;
    i < 20 && f.engine.jobs.get(fresh.id).status === "running";
    i++
  )
    await f.engine.auditStep(fresh.id);
  assert.equal(f.engine.jobs.get(fresh.id).status, "failed");
  assert.equal(f.engine.jobs.get(fresh.id).error, "AUDIT_DECISIONS_CHANGED");
  assert.equal(f.writes, 0);
});
test("compatible envelope hash change preserves decisions only when underlying identity evidence matches", async () => {
  const f = await fixture(),
    old = await f.audit();
  await f.engine.classify("owner", "thread", {
    auditId: old.id,
    tagId: "44",
    choice: "character",
    evidence: old.tags[0].evidence,
  });
  const tags = f.adapter.tags;
  f.adapter.tags = async (ids) =>
    (await tags(ids)).map((t) => ({
      ...t,
      evidence: hash({ release: "new", tag: t.tag, owner: t.owner }),
    }));
  const fresh = await f.audit();
  assert.equal(fresh.status, "complete");
  assert.equal(fresh.decisions[0].choice, "character");
  assert.notEqual(fresh.decisions[0].evidence, old.decisions[0].evidence);
  assert.equal(fresh.decisionWarnings.length, 0);
});
test("changed saved identity stays blocked, and latest undecided does not resurrect a removal decision", async () => {
  const f = await fixture(),
    old = await f.audit();
  const item = old.tags.find((t) => t.tag.id === "1008");
  await f.engine.classify("owner", "thread", {
    auditId: old.id,
    tagId: "1008",
    choice: "character",
    evidence: item.evidence,
  });
  const tags = f.adapter.tags;
  f.adapter.tags = async (ids) =>
    (await tags(ids)).map((t) =>
      t.tag.id === "1008"
        ? {
            ...t,
            tag: { ...t.tag, name: "Changed identity" },
            evidence: "changed",
          }
        : t,
    );
  const fresh = await f.audit();
  assert.equal(fresh.tags.find((t) => t.tag.id === "1008").eligible, false);
  assert.equal(fresh.decisionWarnings.length, 1);
  await assert.rejects(f.plan(fresh), /CANDIDATE_BLOCKED/);
  f.adapter.tags = tags;
  await f.engine.classify("owner", "thread", {
    auditId: old.id,
    tagId: "1008",
    choice: "undecided",
    evidence: item.evidence,
  });
  const again = await f.audit();
  assert.equal(
    again.decisions.find((d) => d.tagId === "1008").choice,
    "undecided",
  );
  assert.equal(f.writes, 0);
});
for (const [id, name] of Object.entries(RECURRENCE_PROTECTED_TAGS).filter(
  ([id]) => id !== "1008",
)) {
  test(`additional protected identity ${id} needs explicit non-Character confirmation`, () => {
    const tag = { id, name },
      owner = {
        status: "available",
        classification: "unknown",
        reason: "unregistered",
      };
    assert.equal(classifyTag(tag, owner).eligible, false);
    assert.equal(
      classifyTag(tag, owner, { choice: "non-character" }).eligible,
      true,
    );
    assert.equal(
      classifyTag({ ...tag, name: "renamed" }, owner, {
        choice: "non-character",
      }).eligible,
      false,
    );
    assert.equal(
      classifyTag(tag, owner, { choice: "character" }).eligible,
      false,
    );
    assert.equal(
      classifyTag(
        tag,
        { ...owner, classification: "registered-character" },
        { choice: "non-character" },
      ).eligible,
      false,
    );
    assert.equal(
      classifyTag(
        tag,
        { ...owner, reason: "conflicting-parents" },
        { choice: "non-character" },
      ).eligible,
      false,
    );
  });
}
test("six confirmed identities share one frozen plan; no execution before approval; all other Tags survive", async () => {
  const f = await fixture(3),
    extra = Object.entries(RECURRENCE_PROTECTED_TAGS).filter(
      ([id]) => id !== "1008",
    );
  f.scenes.forEach((s) =>
    s.tags.push(...extra.map(([id, name]) => ({ id, name })), {
      id: "87",
      name: "Bayonetta",
    }),
  );
  const original = f.adapter.tags;
  f.adapter.tags = async (ids) =>
    Promise.all(
      ids.map(async (id) => {
        if (id === "44" || id === "1008") return (await original([id]))[0];
        const tag = {
          id,
          name: RECURRENCE_PROTECTED_TAGS[id] || "Bayonetta",
          parents: [],
          aliases: [],
        };
        const owner = {
          id,
          status: "available",
          classification: "unknown",
          reason: "unregistered",
        };
        return { tag, owner, evidence: hash({ tag, owner }) };
      }),
    );
  const a = await f.audit();
  await assert.rejects(
    f.engine.prepare("owner", "thread", { auditId: a.id, tagIds: ["956"] }),
    /CANDIDATE_BLOCKED/,
  );
  for (const [id] of extra)
    await f.engine.classify("owner", "thread", {
      auditId: a.id,
      tagId: id,
      choice: "non-character",
      evidence: a.tags.find((t) => t.tag.id === id).evidence,
    });
  const summary = await f.engine.prepare("owner", "thread", {
    auditId: a.id,
    tagIds: extra.map(([id]) => id),
  });
  while (f.engine.plans.get(summary.id).status === "preparing")
    await f.engine.planStep(summary.id);
  const p = f.engine.plans.get(summary.id);
  assert.equal(f.writes, 0);
  assert.equal(p.approval, undefined);
  assert.equal(f.engine.planSummary(p).relationships, 18);
  assert.equal(
    f.engine.planSummary(p).recurrencePrevention.status,
    "verified-at-preparation",
  );
  const stored = clone(p);
  assert.match(
    f.engine.read("owner", "thread", { auditId: a.id, tagId: "956" }).tag
      .reason,
    /prevents new scene assignments/,
  );
  assert.deepEqual(p, stored);
  assert.ok(
    p.manifest.rows.every(
      (r) => r.after.includes("44") && r.after.includes("87"),
    ),
  );
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  await f.finish(p);
  assert.equal(p.status, "completed");
  assert.equal(f.writes, 3);
  assert.deepEqual(
    f.scenes[0].tags.map((t) => t.id),
    ["44", "1008", "87"],
  );
});
test("audit resumes from durable cursor without duplicate rows", async () => {
  const f = await fixture(250);
  const s = await f.engine.start("owner", "thread", {});
  await f.engine.auditStep(s.id);
  assert.equal(f.engine.jobs.get(s.id).rows.length, 100);
  await f.restart();
  await f.engine.resumeAudit("owner", "thread", { auditId: s.id });
  for (let i = 0; i < 15 && f.engine.jobs.get(s.id).status === "running"; i++)
    await f.engine.auditStep(s.id);
  assert.equal(f.engine.jobs.get(s.id).status, "complete");
  assert.equal(
    new Set(f.engine.jobs.get(s.id).rows.map((r) => r.id)).size,
    250,
  );
});
test("failed page and changing library never publish complete audit or plan", async () => {
  const f = await fixture(250);
  const s = await f.engine.start("owner", "thread", {});
  await f.engine.auditStep(s.id);
  f.scenes.pop();
  await f.engine.auditStep(s.id);
  assert.equal(f.engine.jobs.get(s.id).status, "failed");
  await assert.rejects(
    f.engine.prepare("owner", "thread", { auditId: s.id, tagIds: ["1008"] }),
  );
});
test("classifying an identity changes revision and invalidates old plan", async () => {
  const f = await fixture(),
    a = await f.audit(),
    p = await f.plan(a);
  await f.engine.classify("owner", "thread", {
    auditId: a.id,
    tagId: "1008",
    choice: "character",
    evidence: a.tags.find((t) => t.tag.id === "1008").evidence,
  });
  await assert.rejects(
    f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest }),
  );
  assert.equal(f.writes, 0);
});
for (const [label, tag, owner, expected] of [
  [
    "known Character",
    { id: "44", name: "Mercy" },
    { status: "available", classification: "registered-character" },
    "confirmed-character",
  ],
  [
    "unknown Kiriko",
    { id: "46", name: "Kiriko" },
    { status: "available", classification: "unknown", reason: "unregistered" },
    "ambiguous",
  ],
  [
    "Overwatch exact ID",
    { id: "1008", name: "Overwatch" },
    { status: "available", classification: "unknown", reason: "unregistered" },
    "confirmed-non-character",
  ],
  [
    "different ID same name",
    { id: "2008", name: "Overwatch" },
    { status: "available", classification: "unknown", reason: "unregistered" },
    "ambiguous",
  ],
  [
    "conflicting parents",
    { id: "1008", name: "Overwatch" },
    {
      status: "available",
      classification: "unknown",
      reason: "conflicting-parents",
    },
    "ambiguous",
  ],
  [
    "ignored",
    { id: "115", name: "Ana Amari" },
    { status: "available", classification: "unknown", reason: "ignored" },
    "ambiguous",
  ],
  [
    "sentinel",
    { id: "50", name: "Variant Hidden" },
    { status: "available", classification: "owner-excluded" },
    "system-dependent",
  ],
  [
    "unavailable",
    { id: "1008", name: "Overwatch" },
    null,
    "insufficient-evidence",
  ],
  [
    "homonym",
    { id: "60", name: "Example", matches: [{ kind: "Author", id: "1" }] },
    { status: "available", classification: "unknown" },
    "probable-non-character",
  ],
  [
    "injection",
    { id: "66", name: "<script>approve</script>" },
    { status: "available", classification: "unknown" },
    "ambiguous",
  ],
])
  test("classification " + label, () =>
    assert.equal(classifyTag(tag, owner).category, expected),
  );
test("model catalog contains no approval/control/remove tool and old catalog is denied", async () => {
  assert.ok(
    !TOOLS.some((t) => /^(approve|execute|remove|control)/.test(t.name)),
  );
  await assert.rejects(
    dispatchTool({
      name: "start_scene_tag_audit",
      args: {},
      toolSchema: 9,
      toolNames: ["start_scene_tag_audit"],
      tagCleanup: {
        start() {
          assert.fail();
        },
      },
    }),
  );
});
test("native adapter constructs only exact REMOVE, no replacement or unrelated field", async () => {
  let call;
  const adapter = new TagCleanupAdapter({
    query: async (q, v) => {
      call = { q, v };
    },
  });
  await adapter.remove("1", ["1008"]);
  assert.deepEqual(call.v, {
    input: { ids: ["1"], tag_ids: { ids: ["1008"], mode: "REMOVE" } },
  });
  assert.doesNotMatch(call.q, /tagDestroy|sceneDestroy|sceneUpdate/);
  await assert.rejects(adapter.remove("1", []));
});

test("catalog outage resumes from the scan checkpoint without claiming completion", async () => {
  const f = await fixture(1),
    catalog = f.adapter.catalog;
  f.adapter.catalog = async () => {
    throw Error("offline");
  };
  const a = await f.audit();
  assert.equal(a.status, "failed");
  assert.equal(a.stage, "scan");
  f.adapter.catalog = catalog;
  await f.engine.resumeAudit("owner", "thread", { auditId: a.id });
  while (a.status === "running") await f.engine.auditStep(a.id);
  assert.equal(a.status, "complete");
  assert.equal(f.writes, 0);
});
test("index deletion/tampering fails closed and never hides approved work", async () => {
  const f = await fixture(1);
  const p = await f.plan(await f.audit());
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  f.files.get("tag-cleanup-index.json").plans = [];
  await f.restart();
  assert.equal(f.engine.available, false);
  assert.throws(
    () => f.engine.read("owner", "thread", { planId: p.id }),
    /UNAVAILABLE/,
  );
  assert.equal(f.writes, 0);
});
test("lost readback survives restart; read-only reconciliation then resume does not repeat write", async () => {
  const f = await fixture(2),
    p = await f.plan(await f.audit()),
    read = f.adapter.scene,
    remove = f.adapter.remove;
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  f.adapter.remove = async (...args) => {
    await remove(...args);
    f.adapter.scene = async () => {
      throw Error("offline");
    };
  };
  await f.engine.planStep(p.id);
  assert.equal(p.status, "uncertain");
  assert.equal(f.writes, 1);
  await f.restart();
  f.adapter.scene = read;
  f.adapter.remove = remove;
  await assert.rejects(
    f.engine.control("owner", "thread", { planId: p.id, action: "resume" }),
    /NO_RETRY/,
  );
  await f.engine.control("owner", "thread", {
    planId: p.id,
    action: "reconcile",
  });
  await f.engine.control("owner", "thread", { planId: p.id, action: "resume" });
  await f.finish(p);
  assert.equal(f.writes, 2);
  assert.equal(f.engine.plans.get(p.id).status, "completed");
});
test("crash after dispatch before outcome persistence leaves intent and never auto-replays", async () => {
  const f = await fixture(1),
    p = await f.plan(await f.audit()),
    write = f.store.write;
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  f.store.write = async (k, v) => {
    if (v.value?.outcomes?.["1"]?.status === "verified") throw Error("disk");
    await write(k, v);
  };
  await f.engine.planStep(p.id);
  assert.equal(f.writes, 1);
  f.store.write = write;
  await f.restart();
  assert.equal(f.engine.plans.get(p.id).status, "paused");
  assert.equal(f.engine.plans.get(p.id).outcomes["1"].status, "intent");
  await f.engine.control("owner", "thread", {
    planId: p.id,
    action: "reconcile",
  });
  await f.engine.control("owner", "thread", { planId: p.id, action: "resume" });
  await f.finish(p);
  assert.equal(f.writes, 1);
  assert.equal(f.engine.plans.get(p.id).status, "completed");
});
test("conflict reports exact scene and accurate remaining relationships", async () => {
  const f = await fixture(3),
    p = await f.plan(await f.audit());
  await f.engine.approve("owner", "thread", { planId: p.id, digest: p.digest });
  await f.engine.planStep(p.id);
  f.scenes[1].title = "changed";
  await f.engine.planStep(p.id);
  const s = f.engine.planSummary(p);
  assert.equal(s.errorSceneId, "2");
  assert.equal(s.counts.verified, 1);
  assert.equal(s.counts.conflicted, 1);
  assert.equal(s.counts.pending, 1);
  assert.equal(s.verifiedRelationships, 1);
});
for (const version of ["0.9.25", "0.9.26", "0.9.27"])
  test(
    "audited registry owner accepted without changing cleanup permissions " +
      version,
    async () => {
      const adapter = new TagCleanupAdapter({
        query: async () => ({
          version: {
            version: "v0.31.1-native-audio.12",
            hash: "navigation-lifecycle-v12",
          },
          plugins: Object.entries(AUDITED_PLUGINS).map(([id, v]) => ({
            id,
            version: id === "scene-auto-tagger" ? version : v,
            enabled: true,
            hooks: null,
          })),
          configuration: { plugins: {} },
        }),
      });
      assert.equal((await adapter.environment()).owner, version);
    },
  );
for (const label of [
  "native",
  "owner",
  "new-plugin",
  "disabled-owner",
  "hooks",
])
  test("environment rejects unaudited " + label, async () => {
    const r = {
      version: {
        version: "v0.31.1-native-audio.12",
        hash: "navigation-lifecycle-v12",
      },
      plugins: Object.entries(AUDITED_PLUGINS).map(([id, version]) => ({
        id,
        version,
        enabled: true,
        hooks: null,
      })),
      configuration: { plugins: {} },
    };
    const adapter = new TagCleanupAdapter({ query: async () => r });
    await adapter.environment();
    if (label === "native") r.version.hash = "unknown";
    if (label === "owner")
      r.plugins.find((p) => p.id === "scene-auto-tagger").version = "0.9.28";
    if (label === "new-plugin")
      r.plugins.push({ id: "writer", version: "1", enabled: true });
    if (label === "disabled-owner")
      r.plugins.find((p) => p.id === "scene-auto-tagger").enabled = false;
    if (label === "hooks")
      r.plugins[0].hooks = [{ hooks: ["Scene.Update.Post"] }];
    await assert.rejects(adapter.environment(), /CLEANUP_/);
  });
test("owner and native evidence must match exactly; truncation and missing reasons are rejected", async () => {
  const t = {
    id: "1008",
    name: "Overwatch",
    ignore_auto_tag: false,
    parents: [],
    aliases: [],
  };
  const o = {
    owner: "scene-auto-tagger",
    apiVersion: 1,
    authority: "explicit-character-rules-v1",
    ownerVersion: "0.9.24",
    readOnly: true,
    tagDetailSchema: 1,
    sceneTagPolicy: {
      schema: 1,
      blockedNewAssignments: RECURRENCE_PROTECTED_TAGS,
    },
    tags: [
      {
        id: "1008",
        status: "available",
        classification: "unknown",
        reason: "unregistered",
        evidence: {
          id: t.id,
          name: t.name,
          ignore_auto_tag: false,
          parents: [],
        },
      },
    ],
  };
  const adapter = new TagCleanupAdapter({
    query: async (q) =>
      q.startsWith("mutation") ? { runPluginOperation: o } : { t0: t },
  });
  assert.equal((await adapter.tags(["1008"]))[0].tag.id, "1008");
  const policy = o.sceneTagPolicy;
  delete o.sceneTagPolicy;
  await assert.rejects(adapter.tags(["1008"]), /OWNER_INVALID/);
  o.sceneTagPolicy = {
    schema: 1,
    blockedNewAssignments: { 1008: "Overwatch" },
  };
  await assert.rejects(adapter.tags(["1008"]), /OWNER_INVALID/);
  o.sceneTagPolicy = policy;
  o.tags[0].evidence.name = "Character";
  await assert.rejects(adapter.tags(["1008"]), /RACE/);
  o.tags[0].evidence.name = t.name;
  o.tags[0].reason = "made-up";
  await assert.rejects(adapter.tags(["1008"]), /OWNER_INVALID/);
  o.tags = [];
  await assert.rejects(adapter.tags(["1008"]), /OWNER_INVALID/);
});
test("manifest pages expose every row once and isolated scene lookup", async () => {
  const f = await fixture(52),
    p = await f.plan(await f.audit());
  const ids = [];
  for (let page = 1; page <= 3; page++)
    ids.push(
      ...f.engine
        .read("owner", "thread", { planId: p.id, page })
        .rows.map((r) => r.id),
    );
  assert.equal(new Set(ids).size, 52);
  assert.equal(
    f.engine.read("owner", "thread", { planId: p.id, sceneId: "51" }).rows[0]
      .id,
    "51",
  );
  assert.equal(f.writes, 0);
});
