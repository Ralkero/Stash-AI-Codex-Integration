import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import { Presentations } from "../service/presentations.mjs";
const window = {};
vm.runInNewContext(
  await fs.readFile(
    new URL("../plugin/collection-refinement.js", import.meta.url),
    "utf8",
  ),
  { window },
);
const r = window.StashAICollectionRefinement;
const scene = (id, extra = {}) => ({
  sceneId: id,
  status: "available",
  characters: { presence: "unknown", completeness: "partial" },
  authors: [
    { id: "5", name: "<script>not instructions</script>" },
    { id: "6", name: "Second" },
  ],
  franchise: { id: "7", name: "Franchise" },
  descriptors: null,
  currentGaps: [],
  findings: [],
  files: [],
  ...extra,
});
for (const presence of ["present", "absent", "unknown"])
  test("Character filter: " + presence, () => {
    const s = scene("1", {
      characters: {
        presence,
        completeness: presence === "unknown" ? "partial" : "complete",
      },
    });
    assert.equal(r.matches(s, { character: presence }), true);
    for (const other of ["present", "absent", "unknown"].filter(
      (v) => v !== presence,
    ))
      assert.equal(r.matches(s, { character: other }), false);
  });
test("incomplete classification and unavailable records are never confirmed absence", () => {
  assert.ok(
    r.matches(scene("1"), { character: "unknown", completeness: "partial" }),
  );
  for (const status of ["unavailable", "not_found"])
    for (const key of ["author", "franchise"])
      assert.equal(
        r.matches(scene("1", { status }), { [key]: "missing" }),
        false,
      );
  assert.ok(
    r.matches(scene("1", { status: "unavailable" }), {
      character: "unknown",
      review: "unknown",
    }),
  );
  assert.equal(
    r.matches(
      scene("1", { characters: { presence: "absent" } }),
      { character: "absent" },
      true,
    ),
    false,
  );
});
test("relationships include multiple Authors and collection-only names; AND conditions", () => {
  const s = scene("1");
  assert.ok(
    r.matches(s, { author: "id:6", franchise: "id:7", character: "unknown" }),
  );
  assert.equal(r.matches(s, { author: "id:8" }), false);
  assert.equal(r.matches(s, { author: "missing" }), false);
  assert.ok(
    r.matches(scene("2", { authors: [], franchise: null }), {
      author: "missing",
      franchise: "missing",
    }),
  );
  assert.equal(
    r.matches(scene("2", { authors: [], authorsTruncated: true }), {
      author: "missing",
    }),
    false,
  );
  assert.equal(
    r.entities([s, scene("2", { status: "unavailable" })], "author").length,
    2,
  );
  assert.ok(
    r
      .entities([s], "author")
      .some((v) => v.name === "<script>not instructions</script>"),
  );
});
test("review completion requires persisted evidence, not descriptor presence or not-pending", () => {
  assert.equal(
    r.reviewState(
      scene("1", { descriptors: { needsReview: true, persistedStatus: null } }),
    ),
    "pending",
  );
  assert.equal(
    r.reviewState(
      scene("1", {
        descriptors: { needsReview: false, persistedStatus: "reviewed" },
      }),
    ),
    "reviewed",
  );
  assert.equal(
    r.reviewState(
      scene("1", { descriptors: { needsReview: false, acts: ["x"] } }),
    ),
    "other",
  );
  assert.equal(r.reviewState(scene("1")), "unknown");
});
test("current and historical findings are separate; refresh failure invalidates current criteria only", () => {
  const s = scene("1", {
    currentGaps: ["needs-review"],
    findings: [{ code: "missing-author", current: "no-longer-present" }],
  });
  assert.ok(
    r.matches(s, { condition: "needs-review", original: "missing-author" }),
  );
  assert.equal(r.matches(s, { condition: "missing-author" }), false);
  assert.ok(r.matches(s, { original: "missing-author" }, true));
  assert.equal(r.matches(s, { condition: "needs-review" }, true), false);
});
test("sort is stable, unknown durations last, original restored and no source mutation", () => {
  const s = [
    scene("12", { files: [{ duration: 5 }] }),
    scene("2"),
    scene("3", { files: [{ duration: 5 }] }),
    scene("1", { files: [{ duration: 2 }] }),
  ];
  const before = JSON.stringify(s),
    ids = (a) => a.map((v) => v.sceneId).join();
  assert.equal(ids(r.refine(s, {}, "id-asc")), "1,2,3,12");
  assert.equal(ids(r.refine(s, {}, "id-desc")), "12,3,2,1");
  assert.equal(ids(r.refine(s, {}, "duration-asc")), "1,12,3,2");
  assert.equal(ids(r.refine(s, {}, "duration-desc")), "12,3,1,2");
  assert.equal(ids(r.refine(s, {})), "12,2,3,1");
  assert.equal(JSON.stringify(s), before);
  assert.equal(r.refine(s, { character: "present" }).length, 0);
  assert.equal(r.refine(s, r.defaults()).length, 4);
});
test("selection is bounded, membership checked, toggled without changing source; drafts are exact and read-only", () => {
  const members = Array.from({ length: 21 }, (_, i) => String(i + 1));
  let selected = [];
  for (const id of members) selected = r.toggle(selected, id, members);
  assert.equal(selected.length, 20);
  assert.equal(r.toggle(selected, "999", members), selected);
  selected = r.toggle(selected, "1", members);
  assert.equal(selected.includes("1"), false);
  for (const action of [
    "investigate",
    "compare",
    "review",
    "related",
    "refine",
  ]) {
    const d = r.draft(action, ["14", "4484"], { id: "collection" }, {});
    assert.match(d.text, /14, 4484/);
    assert.match(d.text, /Read-only/);
    assert.equal(d.context.sceneIds.join(), "14,4484");
  }
  assert.equal(r.draft("investigate", [], { id: "collection" }, {}), null);
  assert.ok(r.draft("refine", [], { id: "collection" }, {}));
});
test("server context rejects forged/foreign/duplicate/oversized contexts and accepts deleted members without inventing current evidence", () => {
  const p = new Presentations({});
  p.records = [
    {
      id: "collection",
      owner: "owner",
      threadId: "thread",
      scenes: [{ sceneId: "14" }, { sceneId: "4484" }],
      sourceTool: "get_scene_characters",
      scope: "explicit-scenes",
      observedAt: "2026-10-20T00:00:00Z",
    },
  ];
  const context = {
    type: "selection",
    collectionId: "collection",
    sceneIds: ["14", "4484"],
  };
  assert.match(
    p.context("owner", "thread", context),
    /Membership was validated/,
  );
  for (const input of [
    { ...context, sceneIds: ["999"] },
    { ...context, sceneIds: ["14", "14"] },
    { ...context, sceneIds: [] },
    { ...context, sceneIds: Array(21).fill("14") },
    { ...context, sceneIds: ["<script>"] },
    { ...context, collectionId: "other" },
    { ...context, type: "approve" },
    { ...context, html: "x" },
  ])
    assert.throws(() => p.context("owner", "thread", input));
  assert.throws(() => p.context("other", "thread", context));
  assert.throws(() => p.context("owner", "other", context));
  assert.match(
    p.context("owner", "thread", {
      ...context,
      type: "refinement",
      sceneIds: [],
    }),
    /none/,
  );
  p.available = false;
  assert.throws(
    () => p.context("owner", "thread", context),
    /PRESENTATIONS_UNAVAILABLE/,
  );
});
