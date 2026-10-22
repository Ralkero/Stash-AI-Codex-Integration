import test from "node:test";
import assert from "node:assert/strict";
import { Proposals } from "../service/proposals.mjs";
import {
  validateOperations,
  applyRelationship,
} from "../service/relationships.mjs";
import { Stash } from "../service/stash.mjs";

async function fixture() {
  const scenes = Object.fromEntries(
    [1, 2, 3, 4, 5].map((n) => [
      String(n),
      {
        id: String(n),
        title: "",
        details: "untouched",
        rating100: null,
        updated_at: "initial",
        tags: [
          { id: "10", name: "Character A" },
          { id: "11", name: "Ordinary tag" },
          { id: "99", name: "Needs Review" },
        ],
        studio: { id: "20", name: "Franchise A" },
        groups: [
          { group: { id: "30", name: "Author A" }, scene_index: 7 },
          { group: { id: "31", name: "Author B" }, scene_index: null },
        ],
        custom_fields: { descriptor_status: "review", variant: "preserve" },
        play_count: 8,
      },
    ]),
  );
  const data = {},
    calls = [];
  const store = {
    read: async (k, f) => structuredClone(data[k] ?? f),
    write: async (k, v) => {
      data[k] = structuredClone(v);
    },
  };
  const stash = {
    getScene: async ({ id }) => structuredClone(scenes[id]),
    getSceneState: async (id) => structuredClone(scenes[id]),
    entitiesByIds: async (_kind, ids) =>
      ids
        .filter((id) => id !== "999")
        .map((id) => ({
          id,
          name: id === "99" ? "Needs Review" : "Entity " + id,
        })),
    findScenes: async () => ({
      scenes: Object.values(scenes),
      count: 100,
      hasMore: true,
      completeness: "page; count is server total",
    }),
    updateApproved: async (input) => {
      calls.push(structuredClone(input));
      const s = scenes[input.id];
      for (const [k, v] of Object.entries(input)) {
        if (k === "tag_ids")
          s.tags = v.map((id) => ({ id, name: "Entity " + id }));
        else if (k === "studio_id")
          s.studio = v === null ? null : { id: v, name: "Entity " + v };
        else if (k === "groups")
          s.groups = v.map((g) => ({
            group: { id: g.group_id, name: "Entity " + g.group_id },
            scene_index: g.scene_index,
          }));
        else s[k] = v;
      }
      s.updated_at = "changed" + calls.length;
    },
  };
  const p = new Proposals({ stash, store, writesEnabled: true });
  await p.init();
  const prepare = (operations, sceneIds = ["1"], extra = {}) =>
    p.prepare("owner", "thread", { sceneIds, operations, ...extra });
  const approve = async (proposal) =>
    p.decision("owner", "thread", {
      id: proposal.id,
      integrity: p.rows.find((r) => r.id === proposal.id).integrity,
      decision: "approve",
    });
  return { p, stash, scenes, calls, data, prepare, approve };
}
const op = (relationship, action, values) => ({
  relationship,
  action,
  ...values,
});
for (const [name, operation, expected] of [
  ["tag add", op("tags", "add", { ids: ["12"] }), ["10", "11", "12", "99"]],
  ["tag remove", op("tags", "remove", { ids: ["10"] }), ["11", "99"]],
  [
    "tag replace",
    op("tags", "replace", { fromId: "10", toId: "12" }),
    ["11", "12", "99"],
  ],
  [
    "tag multiple add",
    op("tags", "add", { ids: ["12", "13"] }),
    ["10", "11", "12", "13", "99"],
  ],
  ["tag multiple remove", op("tags", "remove", { ids: ["10", "11"] }), ["99"]],
])
  test(name + " preserves unrelated tags and custom state", async () => {
    const f = await fixture(),
      p = await f.prepare([operation]);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.approve(p)).status, "verified");
    assert.deepEqual(
      f.scenes[1].tags.map((t) => t.id),
      expected,
    );
    assert.equal(f.scenes[1].custom_fields.descriptor_status, "review");
    assert.equal(f.scenes[1].groups[0].scene_index, 7);
  });
for (const action of ["replace", "clear", "assign"])
  test(
    "Franchise " + action + " respects single nullable cardinality",
    async () => {
      const f = await fixture();
      if (action === "assign") f.scenes[1].studio = null;
      const p = await f.prepare([
        op("studio", action, {
          expectedId: action === "assign" ? null : "20",
          ...(action !== "clear" ? { toId: "21" } : {}),
        }),
      ]);
      assert.equal((await f.approve(p)).status, "verified");
      assert.equal(
        f.scenes[1].studio?.id ?? null,
        action === "clear" ? null : "21",
      );
    },
  );
for (const action of ["add", "remove", "replace"])
  test("Author " + action + " preserves unaffected order/index", async () => {
    const f = await fixture(),
      p = await f.prepare([
        op(
          "groups",
          action,
          action === "replace"
            ? { fromId: "31", toId: "32" }
            : { ids: [action === "add" ? "32" : "31"] },
        ),
      ]);
    assert.equal((await f.approve(p)).status, "verified");
    assert.equal(f.scenes[1].groups[0].group.id, "30");
    assert.equal(f.scenes[1].groups[0].scene_index, 7);
    if (action !== "remove")
      assert.equal(f.scenes[1].groups.at(-1).scene_index, null);
  });
for (const operation of [
  op("tags", "add", { ids: ["10"] }),
  op("tags", "remove", { ids: ["12"] }),
  op("tags", "replace", { fromId: "10", toId: "10" }),
  op("groups", "add", { ids: ["30"] }),
])
  test(
    "no-op " + JSON.stringify(operation) + " avoids writes/timestamp",
    async () => {
      const f = await fixture(),
        p = await f.prepare([operation]);
      assert.equal(p.status, "no_op");
      await f.approve(p);
      assert.equal(f.calls.length, 0);
      assert.equal(f.scenes[1].updated_at, "initial");
    },
  );
for (const operation of [
  op("tags", "add", { ids: [] }),
  op("tags", "clear", {}),
  op("tags", "add", { ids: ["10", "10"] }),
  op("studio", "assign", { toId: "21" }),
  op("studio", "replace", { toId: "21", expectedId: null }),
  op("groups", "add", { ids: ["30"], scene_index: 42 }),
  op("tags", "remove", { ids: null }),
])
  test("reject ambiguous/invalid operation " + JSON.stringify(operation), () =>
    assert.throws(() => validateOperations([operation])),
  );
test("protect review tags; unknown IDs and forbidden relationships rejected", async () => {
  const f = await fixture();
  for (const operations of [
    [op("tags", "remove", { ids: ["99"] })],
    [op("groups", "add", { ids: ["999"] })],
    [op("custom_fields", "replace", { fromId: "1", toId: "2" })],
  ])
    await assert.rejects(f.prepare(operations));
  assert.equal(f.calls.length, 0);
});
test("conflicting expected Franchise and indexed Author replacement are not eligible", async () => {
  const f = await fixture();
  for (const operation of [
    op("studio", "replace", { expectedId: "22", toId: "21" }),
    op("groups", "replace", { fromId: "30", toId: "32" }),
    op("groups", "replace", { fromId: "31", toId: "30" }),
  ]) {
    const p = await f.prepare([operation]);
    assert.equal(p.status, "conflict");
    await f.approve(p);
  }
  assert.equal(f.calls.length, 0);
});
test("mixed five-target selection reports actual subset, noops/conflicts and matched total", async () => {
  const f = await fixture();
  f.scenes[2].studio = { id: "22" };
  f.scenes[3].studio = { id: "21" };
  const p = await f.prepare(
    [op("studio", "replace", { expectedId: "20", toId: "21" })],
    ["1", "2", "3", "4", "5"],
    { selection: { limit: 5 } },
  );
  assert.equal(p.summary.matched, 100);
  assert.equal(p.summary.included, 3);
  assert.equal(p.summary.conflicts, 2);
  assert.equal((await f.approve(p)).status, "verified");
  assert.equal(f.calls.length, 3);
});
test("partial noops omitted and maximum five cannot be bypassed in one proposal", async () => {
  const f = await fixture();
  f.scenes[2].tags.push({ id: "12" });
  const p = await f.prepare(
    [op("tags", "add", { ids: ["12"] })],
    ["1", "2", "3", "4", "5"],
  );
  assert.equal(p.summary.alreadyCorrect, 1);
  await f.approve(p);
  assert.equal(f.calls.length, 4);
  await assert.rejects(
    f.prepare(
      [op("tags", "add", { ids: ["13"] })],
      ["1", "2", "3", "4", "5", "6"],
    ),
  );
  await assert.rejects(
    f.prepare([op("tags", "add", { ids: ["13"] })], ["1", "1"]),
  );
});
test("superseding preview is immutable and old approval is inert", async () => {
  const f = await fixture(),
    a = await f.prepare([op("tags", "add", { ids: ["12"] })]);
  const b = await f.prepare([op("tags", "add", { ids: ["13"] })]);
  assert.equal((await f.approve(a)).status, "superseded");
  f.p.rows.find((p) => p.id === b.id).summary.targetIds = ["2"];
  await assert.rejects(f.approve(b), /CHANGED/);
  assert.equal(f.calls.length, 0);
});
test("unrelated custom-field drift invalidates before first batch write", async () => {
  const f = await fixture(),
    p = await f.prepare([op("tags", "add", { ids: ["12"] })], ["1", "2"]);
  f.scenes[2].custom_fields.variant = "external change";
  await assert.rejects(f.approve(p), /STALE/);
  assert.equal(f.calls.length, 0);
});
test("unrelated mutation side effect causes failed readback and stops batch", async () => {
  const f = await fixture(),
    p = await f.prepare([op("tags", "add", { ids: ["12"] })], ["1", "2"]),
    update = f.stash.updateApproved;
  f.stash.updateApproved = async (input) => {
    await update(input);
    f.scenes[input.id].play_count++;
  };
  const r = await f.approve(p);
  assert.equal(r.status, "partial_or_uncertain");
  assert.equal(r.results[0].status, "verification_failed");
  assert.equal(f.calls.length, 1);
});
test("lost readback never retries a relationship write, including restart", async () => {
  const f = await fixture(),
    p = await f.prepare([op("groups", "remove", { ids: ["31"] })]),
    get = f.stash.getSceneState;
  f.stash.getSceneState = async (id) => {
    if (f.calls.length) throw Error("lost");
    return get(id);
  };
  assert.equal((await f.approve(p)).status, "partial_or_uncertain");
  await f.p.init();
  await f.approve(p);
  assert.equal(f.calls.length, 1);
});
test("public proposals never reveal custom snapshot hashes or fields", async () => {
  const f = await fixture();
  await f.prepare([op("tags", "add", { ids: ["12"] })]);
  assert.ok(f.p.rows[0].rows[0].guard.custom_fields);
  assert.ok(
    !JSON.stringify(f.p.list("owner", "thread")).includes("custom_fields"),
  );
});
test("all-disabled scalar changes also produce no-op", async () => {
  const f = await fixture();
  const p = await f.p.prepare("owner", "thread", {
    sceneIds: ["1"],
    changes: { title: "" },
  });
  assert.equal(p.status, "no_op");
});
test("five eligible scenes execute once each; a repeated approval is inert", async () => {
  const f = await fixture(),
    p = await f.prepare(
      [op("tags", "add", { ids: ["12"] })],
      ["1", "2", "3", "4", "5"],
    );
  assert.equal(p.summary.included, 5);
  assert.equal((await f.approve(p)).status, "verified");
  await f.approve(p);
  assert.equal(f.calls.length, 5);
});
test("second-scene failure records earlier success and stops later targets", async () => {
  const f = await fixture(),
    p = await f.prepare(
      [op("groups", "add", { ids: ["32"] })],
      ["1", "2", "3"],
    ),
    update = f.stash.updateApproved;
  f.stash.updateApproved = async (input) => {
    if (input.id === "2") throw Error("failure");
    return update(input);
  };
  const r = await f.approve(p);
  assert.deepEqual(
    r.results.map((x) => x.status),
    ["verified", "uncertain"],
  );
  assert.equal(r.status, "partial_or_uncertain");
  assert.equal(f.calls.length, 1);
});
test("entity renamed after preview invalidates approval", async () => {
  const f = await fixture(),
    p = await f.prepare([op("tags", "add", { ids: ["12"] })]);
  f.stash.entitiesByIds = async () => [{ id: "12", name: "Needs Review" }];
  await assert.rejects(f.approve(p), /STALE/);
  assert.equal(f.calls.length, 0);
});
test("server group enumeration changes do not imply lost scene indexes", async () => {
  const f = await fixture(),
    p = await f.prepare([op("groups", "add", { ids: ["32"] })]),
    update = f.stash.updateApproved;
  f.stash.updateApproved = async (input) => {
    await update(input);
    f.scenes[input.id].groups.reverse();
  };
  assert.equal((await f.approve(p)).status, "verified");
  assert.equal(
    f.scenes[1].groups.find((g) => g.group.id === "30").scene_index,
    7,
  );
});
test("null changes cannot disguise an invalid operation container", async () => {
  const f = await fixture();
  await assert.rejects(
    f.p.prepare("owner", "thread", {
      sceneIds: ["1"],
      changes: null,
      operations: [op("tags", "add", { ids: ["12"] })],
    }),
  );
});
