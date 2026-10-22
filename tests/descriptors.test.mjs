import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Proposals } from "../service/proposals.mjs";
import {
  DescriptorTransactions,
  DESCRIPTOR_OWNER_VERSION,
} from "../service/descriptor-transactions.mjs";
import { toolsFor, dispatchTool } from "../service/tools.mjs";
const owner = createRequire(import.meta.url)(
  "../integration/0.4.0/descriptor-owner-fixture.cjs",
);
const A = "r34_sex_acts_positions",
  E = "r34_ending_descriptors";
export async function fixture() {
  const scene = {
    id: "647",
    title: "Fixture",
    details: "keep",
    updated_at: "before",
    tags: [{ id: "22", name: "Preserve" }],
    studio: { id: "3" },
    groups: [{ group: { id: "5" }, scene_index: 4 }],
    performers: [{ id: "9" }],
    play_count: 6,
    files: [{ path: "C:/Rule34/fixture.mp4" }],
    custom_fields: {
      [A]: '["Missionary","Cowgirl"]',
      [E]: '["Loop"]',
      r34_scene_descriptor_status: "reviewed",
      r34_scene_descriptor_source: "manual_review",
      variant_role: "primary",
      learning: "keep",
      pref: "keep",
    },
  };
  const before = structuredClone(scene),
    calls = [],
    data = {};
  let lost = false,
    broken = false,
    version = DESCRIPTOR_OWNER_VERSION,
    corrupt = false,
    failSave = false;
  const runtime = {
    gql: {
      Do(q, v) {
        if (q.startsWith("mutation")) {
          calls.push(structuredClone(v.input));
          Object.assign(
            scene.custom_fields,
            v.input.custom_fields.partial || {},
          );
          for (const k of v.input.custom_fields.remove || [])
            delete scene.custom_fields[k];
          scene.updated_at = "after" + calls.length;
          if (corrupt) scene.custom_fields.learning = "wrong";
          if (lost) throw Error("LOST");
          return { sceneUpdate: { id: scene.id } };
        }
        return { findScene: v.id === scene.id ? structuredClone(scene) : null };
      },
    },
  };
  const stash = {
    async getSceneState() {
      if (broken) throw Error("OFFLINE");
      return structuredClone(scene);
    },
    async query(q, v) {
      if (q === "{plugins{id version enabled}}")
        return {
          plugins: [{ id: "scene-auto-tagger", enabled: true, version }],
        };
      assert.match(q, /runPluginOperation/);
      // The audited 0.9.21 transaction implementation differs only in its envelope version.
      return {
        runPluginOperation: {
          ...owner.run(v.args, runtime),
          ownerVersion: version,
        },
      };
    },
  };
  const store = {
    async read(k, f) {
      return structuredClone(data[k] ?? f);
    },
    async write(k, v) {
      if (failSave) throw Error("DISK");
      data[k] = structuredClone(v);
    },
  };
  const descriptors = new DescriptorTransactions(stash);
  let now = 1000;
  const make = async () => {
    const p = new Proposals({
      stash,
      store,
      descriptors,
      writesEnabled: true,
      now: () => now,
    });
    await p.init();
    return p;
  };
  const p = await make();
  const prepare = (
    args = { sceneId: "647", add: ["acts:Blowjob"], remove: ["endings:Loop"] },
  ) => p.prepareDescriptors("o", "t", args);
  const approve = (x, instance = p) =>
    instance.decision("o", "t", {
      id: x.id,
      integrity: instance.rows.find((r) => r.id === x.id).integrity,
      decision: "approve",
    });
  return {
    p,
    make,
    stash,
    descriptors,
    scene,
    before,
    calls,
    data,
    prepare,
    approve,
    set(o) {
      if ("lost" in o) lost = o.lost;
      if ("broken" in o) broken = o.broken;
      if ("version" in o) version = o.version;
      if ("corrupt" in o) corrupt = o.corrupt;
      if ("failSave" in o) failSave = o.failSave;
      if ("now" in o) now = o.now;
    },
  };
}
test("descriptor preview -> approved owner apply -> independent verification preserves unrelated data", async () => {
  const f = await fixture(),
    x = await f.prepare();
  assert.equal(f.calls.length, 0);
  assert.equal(x.preview.operationCount, 2);
  const r = await f.approve(x);
  assert.equal(r.status, "verified");
  assert.equal(f.calls.length, 1);
  assert.deepEqual(Object.keys(f.calls[0]).sort(), ["custom_fields", "id"]);
  for (const [k, v] of Object.entries(f.before.custom_fields))
    if (![A, E].includes(k)) assert.equal(f.scene.custom_fields[k], v);
  for (const k of [
    "tags",
    "studio",
    "groups",
    "performers",
    "play_count",
    "details",
    "files",
  ])
    assert.deepEqual(f.scene[k], f.before[k]);
  assert.equal(r.ownerPlan, undefined);
  assert.equal(r.descriptorCommand, undefined);
  assert.equal(r.preservedCustomFields, undefined);
});
test("repeated and concurrent approval plus restart are idempotent", async () => {
  const f = await fixture(),
    x = await f.prepare();
  await Promise.all([f.approve(x), f.approve(x)]);
  await f.approve(x, await f.make());
  assert.equal(f.calls.length, 1);
});
for (const version of ["0.9.21", "0.9.22"])
  test(`descriptor proposals bind audited owner ${version}`, async () => {
    const f = await fixture();
    f.set({ version });
    const x = await f.prepare();
    assert.equal(f.p.rows.find((r) => r.id === x.id).ownerVersion, version);
    assert.equal((await f.approve(x)).status, "verified");
    assert.equal(f.calls.length, 1);
  });
for (const versions of [
  ["0.9.20", "0.9.21"],
  ["0.9.21", "0.9.20"],
  ["0.9.21", "0.9.22"],
  ["0.9.22", "0.9.21"],
])
  test(`descriptor approval rejects owner drift ${versions.join(" -> ")}`, async () => {
    const f = await fixture();
    f.set({ version: versions[0] });
    const x = await f.prepare();
    f.set({ version: versions[1] });
    await assert.rejects(f.approve(x), /DESCRIPTOR_STALE/);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.scene, f.before);
  });
test("descriptor dispatch rechecks its bound owner version", async () => {
  const f = await fixture();
  const plan = await f.descriptors.preview({
    sceneId: "647",
    add: ["acts:Blowjob"],
    remove: [],
  });
  f.set({ version: "0.9.21" });
  await assert.rejects(
    f.descriptors.apply(
      "fixture",
      { sceneId: "647", add: ["acts:Blowjob"], remove: [] },
      plan,
      "0.9.20",
    ),
    /DESCRIPTOR_STALE/,
  );
  assert.equal(f.calls.length, 0);
});
test("separate compensation restores original raw assignment order and leaves review unchanged", async () => {
  const f = await fixture(),
    x = await f.prepare({
      sceneId: "647",
      add: ["acts:Blowjob"],
      remove: ["acts:Missionary"],
    });
  await f.approve(x);
  const c = await f.prepare({ compensateId: x.id });
  assert.equal(f.calls.length, 1);
  assert.notEqual(c.id, x.id);
  await f.approve(c);
  assert.deepEqual(f.scene.custom_fields, f.before.custom_fields);
});
test("compensation refuses unrelated intervening edits", async () => {
  const f = await fixture(),
    x = await f.prepare();
  await f.approve(x);
  f.scene.title = "changed";
  await assert.rejects(f.prepare({ compensateId: x.id }), /STALE/);
  assert.equal(f.calls.length, 1);
});
test("lost owner response reconciles independently without causal claim or retry", async () => {
  const f = await fixture(),
    x = await f.prepare();
  f.set({ lost: true });
  const r = await f.approve(x);
  assert.equal(r.status, "reconciled");
  assert.match(r.results[0].note, /Causation/);
  await f.approve(x);
  assert.equal(f.calls.length, 1);
});
test("restart from durable applying intent never re-dispatches; recovery only reads", async () => {
  const f = await fixture(),
    x = await f.prepare();
  await f.approve(x);
  const disk = f.data["proposals.json"][0];
  disk.status = "applying";
  delete disk.verifiedGuard;
  const restarted = await f.make();
  assert.equal(restarted.rows[0].status, "uncertain");
  await f.approve(x, restarted);
  assert.equal(f.calls.length, 1);
  await restarted.reconcileDescriptor("o", "t", x.id);
  assert.equal(restarted.rows[0].status, "reconciled");
  assert.equal(f.calls.length, 1);
});
test("crash after intent but before dispatch stays uncertain, even when original state remains", async () => {
  const f = await fixture(),
    x = await f.prepare();
  const disk = f.data["proposals.json"][0];
  disk.status = "applying";
  disk.approvedAt = 1000;
  const p = await f.make();
  await f.approve(x, p);
  await p.reconcileDescriptor("o", "t", x.id);
  assert.equal(p.rows[0].status, "uncertain");
  assert.equal(f.calls.length, 0);
});
test("unexpected protected-field change fails verification and cannot auto-compensate", async () => {
  const f = await fixture(),
    x = await f.prepare();
  f.set({ corrupt: true });
  assert.equal((await f.approve(x)).status, "uncertain");
  await assert.rejects(f.prepare({ compensateId: x.id }), /DENIED/);
  await f.p.reconcileDescriptor("o", "t", x.id);
  assert.equal(f.p.rows[0].status, "uncertain");
});
for (const change of [
  "timestamp",
  "assignment",
  "review",
  "unrelated",
  "version",
])
  test("approval rejects stale " + change, async () => {
    const f = await fixture(),
      x = await f.prepare();
    if (change === "timestamp") f.scene.updated_at = "changed";
    if (change === "assignment") f.scene.custom_fields[A] = "[]";
    if (change === "review")
      f.scene.custom_fields.r34_scene_descriptor_status = "missing";
    if (change === "unrelated") f.scene.tags = [];
    if (change === "version") f.set({ version: "9.9.9" });
    await assert.rejects(f.approve(x));
    assert.equal(f.calls.length, 0);
  });
for (const tamper of [
  "descriptorCommand",
  "ownerPlan",
  "descriptorPreview",
  "preservedCustomFields",
  "id",
])
  test("immutable approval binds " + tamper, async () => {
    const f = await fixture(),
      x = await f.prepare();
    f.p.rows[0][tamper] = tamper === "id" ? x.id + "x" : {};
    await assert.rejects(f.approve({ id: f.p.rows[0].id }), /PROPOSAL_CHANGED/);
    assert.equal(f.calls.length, 0);
  });
test("failed durable intent prevents dispatch", async () => {
  const f = await fixture(),
    x = await f.prepare();
  f.set({ failSave: true });
  await assert.rejects(f.approve(x), /DISK/);
  assert.equal(f.calls.length, 0);
});
for (const decision of ["reject", "cancel"])
  test(decision + " never applies", async () => {
    const f = await fixture(),
      x = await f.prepare();
    await f.p.decision("o", "t", {
      id: x.id,
      integrity: f.p.rows[0].integrity,
      decision,
    });
    await f.approve(x);
    assert.equal(f.calls.length, 0);
  });
test("no-op has no approval or write", async () => {
  const f = await fixture(),
    x = await f.prepare({ sceneId: "647", add: ["acts:Cowgirl"], remove: [] });
  assert.equal(x.status, "no_op");
  await f.approve(x);
  assert.equal(f.calls.length, 0);
});
test("expired and wrong principal/thread approvals are denied", async () => {
  const f = await fixture(),
    x = await f.prepare();
  const a = { id: x.id, integrity: f.p.rows[0].integrity, decision: "approve" };
  await assert.rejects(f.p.decision("bad", "t", a));
  await assert.rejects(f.p.decision("o", "bad", a));
  f.set({ now: 1000000 });
  await assert.rejects(f.approve(x), /EXPIRED/);
  assert.equal(f.calls.length, 0);
});
test("owner resolution and tool discovery fail closed on version mismatch", async () => {
  const f = await fixture();
  const r = await f.descriptors.resolve({ query: "Loop" });
  assert.equal(r.exact[0].id, "endings:Loop");
  assert.equal(r.exact[0].editable, true);
  assert.ok(
    (await toolsFor(null, f.descriptors)).some(
      (t) => t.name === "preview_descriptor_update",
    ),
  );
  f.set({ version: "0.9.19" });
  assert.ok(
    !(await toolsFor(null, f.descriptors)).some(
      (t) => t.name === "preview_descriptor_update",
    ),
  );
});
test("model cannot supply arbitrary owner command, approval, custom fields or multiple scenes", async () => {
  const f = await fixture();
  for (const args of [
    { sceneId: "647", add: ["22"], remove: [] },
    { sceneId: "647", add: ["acts:Blowjob"], remove: [], approved: true },
    { sceneIds: ["647", "648"], add: ["acts:Blowjob"], remove: [] },
    {
      sceneId: "647",
      add: ["acts:Blowjob"],
      remove: [],
      restore: { [A]: "[]" },
    },
  ])
    await assert.rejects(f.prepare(args));
  await assert.rejects(
    dispatchTool({
      name: "apply_descriptor_update",
      args: {},
      proposals: f.p,
      descriptors: f.descriptors,
    }),
  );
  assert.equal(f.calls.length, 0);
});
test("tampered owner response cannot hide a mutation beyond the preview", async () => {
  const f = await fixture();
  const query = f.stash.query;
  f.stash.query = async (q, v) => {
    const r = await query(q, v);
    if (v?.args.kind === "preview")
      r.runPluginOperation.preview.mutation.custom_fields.partial[A] =
        '["Cowgirl"]';
    return r;
  };
  await assert.rejects(f.prepare());
  assert.equal(f.calls.length, 0);
});
test("Go Map object key reordering does not invalidate a legitimate owner preview", async () => {
  const f = await fixture();
  const query = f.stash.query;
  const reverse = (v) =>
    Array.isArray(v)
      ? v.map(reverse)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, v]) => [k, reverse(v)]),
          )
        : v;
  f.stash.query = (q, v) => query(q, reverse(v));
  const x = await f.prepare();
  assert.equal((await f.approve(x)).status, "verified");
});
test("uncertain descriptor blocks new descriptor/native proposals across conversations", async () => {
  const f = await fixture(),
    x = await f.prepare();
  f.p.rows[0].status = "uncertain";
  await assert.rejects(
    f.p.prepareDescriptors("o", "another", {
      sceneId: "647",
      add: ["endings:Loop"],
      remove: [],
    }),
    /UNRESOLVED/,
  );
  await assert.rejects(
    f.p.prepare("o", "another", {
      sceneIds: ["647"],
      changes: { title: "retry" },
    }),
    /UNRESOLVED/,
  );
  assert.equal(f.calls.length, 0);
});
test("live protocol regression: omitted add/remove lists are empty, explicit null is invalid", async () => {
  const f = await fixture();
  const x = await f.prepare({ sceneId: "647", add: ["endings:Facial"] });
  assert.equal(x.preview.added.length, 1);
  assert.equal(x.preview.removed.length, 0);
  const y = await f.prepare({ sceneId: "647", remove: ["endings:Loop"] });
  assert.equal(y.preview.removed.length, 1);
  await assert.rejects(
    f.prepare({ sceneId: "647", add: null, remove: ["endings:Loop"] }),
  );
  await assert.rejects(f.prepare({ sceneId: "647" }));
  assert.equal(f.calls.length, 0);
});
test("previously prepared preview cannot bypass a later uncertain operation in another chat", async () => {
  const f = await fixture();
  await f.prepare();
  const next = await f.p.prepareDescriptors("o", "other", {
    sceneId: "647",
    add: ["endings:Facial"],
  });
  f.p.rows[0].status = "uncertain";
  await assert.rejects(
    f.p.decision("o", "other", {
      id: next.id,
      integrity: f.p.rows[1].integrity,
      decision: "approve",
    }),
    /UNRESOLVED/,
  );
  assert.equal(f.calls.length, 0);
});
