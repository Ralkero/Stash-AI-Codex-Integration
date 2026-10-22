import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { ReviewDecisions } from "../service/review-decisions.mjs";
import {
  recommendations,
  sceneEvidence,
  evidenceHash,
} from "../service/recommendation-policy.mjs";
import { assessScene, reviewSummary } from "../service/review-policy.mjs";
import { dispatchTool, TOOLS, TOOL_SCHEMA } from "../service/tools.mjs";
import { Runtime } from "../service/runtime.mjs";
const codes = [
  "missing-author",
  "missing-franchise",
  "missing-characters",
  "character-classification",
  "descriptor-review",
  "needs-review",
];
function scene(extra = {}) {
  return {
    sceneId: "4153",
    status: "available",
    authors: [{ id: "102", name: "Author" }],
    franchise: null,
    characters: { presence: "absent", completeness: "complete" },
    descriptors: { needsReview: true, autoTaggerNeedsReview: false },
    reviewEvidence: Object.fromEntries(
      codes.map((k) => [k, evidenceHash(k, "fixture")]),
    ),
    ...extra,
  };
}
async function fixture(value = scene()) {
  const state = { scene: value, data: null, writes: 0, now: Date.now() };
  const store = {
    read: async (_, fallback) => structuredClone(state.data || fallback),
    write: async (_, v) => {
      state.writes++;
      state.data = structuredClone(v);
    },
  };
  const d = new ReviewDecisions(
    store,
    async () => structuredClone(state.scene),
    () => state.now,
  );
  await d.init();
  const args = {
    sceneId: "4153",
    findings: ["missing-franchise"],
    action: "no-action",
  };
  const prepare = async (input = args) => {
    await d.prepare("owner", "chat", input);
    return d.list("owner", "chat").at(-1);
  };
  const confirm = (r, extra = {}) =>
    d.confirm("owner", "chat", {
      id: r.id,
      token: r.token,
      decision: "confirm",
      ...extra,
    });
  return { state, store, d, args, prepare, confirm };
}
for (const key of codes)
  test(`fixed recommendation ${key} has exact scope, evidence and a draft, never a correction target`, () => {
    const s = scene({
      authors: [],
      characters: {
        presence: key === "character-classification" ? "unknown" : "absent",
        completeness:
          key === "character-classification" ? "partial" : "complete",
      },
      descriptors: { needsReview: true, autoTaggerNeedsReview: true },
    });
    const r = recommendations(s, null, "owner", "time").rows.find(
      (r) => r.key === key,
    );
    assert.ok(r);
    assert.equal(r.sceneId, "4153");
    assert.equal(r.evidenceStatus, "current");
    assert.match(r.draft, /scene 4153/);
    assert.notEqual(r.category, "correction");
  });
for (const presence of ["present", "unknown"])
  test(`partial Character ${presence} never becomes missing or incorrect`, () => {
    const r = recommendations(
      scene({
        franchise: { id: "1" },
        characters: { presence, completeness: "partial" },
        descriptors: { needsReview: false, autoTaggerNeedsReview: false },
      }),
      null,
      "owner",
      "now",
    );
    assert.deepEqual(
      r.rows.map((x) => x.key),
      ["character-classification"],
    );
    assert.equal(r.rows[0].category, "optional clarification");
    assert.match(r.summary, /No metadata changes recommended/);
    if (presence === "present")
      assert.match(r.rows[0].explanation, /assignment is recognized/);
  });
test("search, historical, deleted and missing-owner states never manufacture corrections", () => {
  const complete = scene({
    franchise: { id: "1" },
    characters: { presence: "present", completeness: "complete" },
    descriptors: { needsReview: false, autoTaggerNeedsReview: false },
    findings: [{ code: "missing-franchise", current: "no-longer-present" }],
  });
  assert.equal(recommendations(complete).rows.length, 0);
  assert.match(recommendations(complete).summary, /No metadata changes/);
  assert.equal(recommendations(scene({ status: "not_found" })).rows.length, 0);
  const unavailable = recommendations(
    scene({
      characters: { presence: "unknown", completeness: "unknown" },
      descriptors: null,
    }),
  );
  assert.deepEqual(
    unavailable.rows.map((r) => r.key),
    ["missing-franchise"],
  );
  assert.equal(unavailable.incomplete, true);
});
test("fingerprints ignore unrelated timestamps and change with relevant native/owner evidence", () => {
  const n = { tags: [], groups: [], studio: null, updated_at: "one" };
  const a = sceneEvidence(n, null, null, {}),
    b = sceneEvidence(
      { ...n, updated_at: "two", title: "changed" },
      null,
      null,
      {},
    );
  assert.deepEqual(a, b);
  assert.notEqual(
    sceneEvidence({ ...n, studio: { id: "2" } }, null, null, {})[
      "missing-franchise"
    ],
    a["missing-franchise"],
  );
  const identity = {
    detailSchema: 1,
    unclassifiedDetailsTruncated: false,
    presence: "unknown",
    completeness: "partial",
    unclassifiedTags: [{ id: "1", reason: "unregistered" }],
  };
  const native = { ...n, tags: [{ id: "1", name: "Untrusted <script>" }] };
  const c = sceneEvidence(native, identity, null, { characters: "one" });
  const d = sceneEvidence(
    native,
    { ...identity, unclassifiedTags: [{ id: "1", reason: "ignored" }] },
    null,
    { characters: "one" },
  );
  assert.notEqual(c["character-classification"], d["character-classification"]);
  assert.notEqual(
    c["character-classification"],
    sceneEvidence(native, identity, null, { characters: "two" })[
      "character-classification"
    ],
  );
  assert.equal(
    sceneEvidence(
      native,
      { ...identity, unclassifiedDetailsTruncated: true },
      null,
      {},
    )["character-classification"],
    undefined,
  );
});
test("prepare cannot commit, UI confirm scopes one finding; restart, conversation switch, reopen preserve audit and factual counts", async () => {
  const f = await fixture();
  const before = reviewSummary([{ review: assessScene(f.state.scene) }]);
  const result = await f.d.prepare("owner", "chat", f.args);
  assert.equal(result.status, "awaiting-ui-confirmation");
  assert.equal(result.token, undefined);
  assert.equal(f.state.writes, 0);
  const r = f.d.list("owner", "chat")[0];
  assert.equal((await f.confirm(r)).metadataChanged, false);
  assert.equal(f.state.writes, 1);
  await f.confirm(r);
  assert.equal(f.state.writes, 1);
  const restarted = new ReviewDecisions(f.store, async () => f.state.scene);
  await restarted.init();
  const rec = recommendations(f.state.scene, restarted, "owner", "now");
  assert.equal(rec.rows.find((r) => r.key === "missing-franchise").draft, null);
  assert.ok(rec.rows.find((r) => r.key === "missing-characters").draft);
  assert.ok(rec.rows.find((r) => r.key === "descriptor-review").draft);
  assert.deepEqual(
    before,
    reviewSummary([{ review: assessScene(f.state.scene) }]),
  );
  assert.equal(restarted.states("other", f.state.scene).length, 0);
  await restarted.prepare("owner", "another-chat", {
    ...f.args,
    action: "reopen",
  });
  const reopen = restarted.list("owner", "another-chat")[0];
  await restarted.confirm("owner", "another-chat", {
    id: reopen.id,
    token: reopen.token,
    decision: "confirm",
  });
  assert.equal(f.state.data.events.length, 2);
  assert.equal(f.state.data.events[1].previousId, f.state.data.events[0].id);
  assert.equal(restarted.states("owner", f.state.scene)[0].state, "reopened");
  assert.ok(recommendations(f.state.scene, restarted, "owner").rows[0].draft);
});
for (const change of [
  "foreign owner",
  "foreign thread",
  "bad token",
  "unknown request",
  "unknown decision",
  "extra property",
])
  test(`deny ${change}`, async () => {
    const f = await fixture(),
      r = await f.prepare();
    const input = { id: r.id, token: r.token, decision: "confirm" };
    if (change === "bad token") input.token = "bad";
    if (change === "unknown request") input.id = "bad";
    if (change === "unknown decision") input.decision = "approve";
    if (change === "extra property") input.write = true;
    await assert.rejects(
      f.d.confirm(
        change === "foreign owner" ? "other" : "owner",
        change === "foreign thread" ? "other" : "chat",
        input,
      ),
    );
    assert.equal(f.state.writes, 0);
  });
for (const args of [
  { findings: [] },
  { findings: ["all"] },
  { findings: ["missing-franchise", "missing-franchise"] },
  { sceneId: "all" },
  { action: "ignore-scene" },
  { note: "x".repeat(301) },
  { arbitrary: true },
])
  test(`reject ambiguous/forged scope ${JSON.stringify(args).slice(0, 70)}`, async () => {
    const f = await fixture();
    await assert.rejects(f.prepare({ ...f.args, ...args }));
    assert.equal(f.state.writes, 0);
  });
test("stale evidence, expiry, cancellation and unavailable reads cannot commit", async () => {
  const f = await fixture(),
    r = await f.prepare();
  f.state.scene.reviewEvidence["missing-franchise"] = "b".repeat(64);
  await assert.rejects(f.confirm(r), /EVIDENCE_CHANGED/);
  f.state.now += 600001;
  await assert.rejects(f.confirm(r), /DENIED/);
  const next = await f.prepare();
  f.d.cancel("owner", "chat");
  await assert.rejects(f.confirm(next), /DENIED/);
  f.state.scene = { sceneId: "4153", status: "unavailable" };
  await assert.rejects(f.prepare(), /EVIDENCE_UNAVAILABLE/);
  assert.equal(f.state.writes, 0);
});
test("changed/unverified acknowledgements do not suppress fresh recommendations", async () => {
  const f = await fixture();
  await f.confirm(await f.prepare());
  f.state.scene.reviewEvidence["missing-franchise"] = "b".repeat(64);
  assert.equal(f.d.states("owner", f.state.scene)[0].state, "changed");
  assert.ok(recommendations(f.state.scene, f.d, "owner").rows[0].draft);
  delete f.state.scene.reviewEvidence;
  assert.equal(f.d.states("owner", f.state.scene)[0].state, "unverified");
  assert.ok(recommendations(f.state.scene, f.d, "owner").rows[0].draft);
});
test("explicit multi-finding decision is atomic and a competing request cannot overwrite it", async () => {
  const f = await fixture();
  const a = await f.prepare({
      ...f.args,
      findings: ["missing-franchise", "missing-characters"],
    }),
    b = await f.prepare();
  await f.confirm(a);
  await assert.rejects(f.confirm(b), /DECISION_CHANGED/);
  assert.equal(f.state.data.events.length, 2);
  assert.equal(
    recommendations(f.state.scene, f.d, "owner").rows.filter((r) => r.draft)
      .length,
    1,
  );
});
test("corrupt state and write failure fail closed without overwriting evidence", async () => {
  const f = await fixture();
  f.state.data = { schema: 99, events: [] };
  const corrupt = new ReviewDecisions(f.store, async () => scene());
  await corrupt.init();
  assert.equal(corrupt.available, false);
  await assert.rejects(corrupt.prepare("owner", "chat", f.args));
  assert.equal(f.state.writes, 0);
  const r = await f.prepare();
  f.store.write = async () => {
    throw Error("disk");
  };
  await assert.rejects(f.confirm(r), /UNAVAILABLE/);
  assert.equal(f.d.events.length, 0);
});
test("new tool is prepare-only, version-gated; old conversations never gain it", async () => {
  assert.equal(TOOL_SCHEMA, 10);
  assert.equal(TOOLS.length, 24);
  const f = await fixture();
  await assert.rejects(
    dispatchTool({
      name: "request_review_decision",
      args: f.args,
      toolSchema: 8,
      toolNames: TOOLS.map((t) => t.name),
      reviewDecisions: f.d,
    }),
    /DENIED/,
  );
  const result = await dispatchTool({
    name: "request_review_decision",
    args: f.args,
    toolSchema: 9,
    toolNames: TOOLS.map((t) => t.name),
    reviewDecisions: f.d,
    owner: "owner",
    thread: "chat",
  });
  assert.equal(result.status, "awaiting-ui-confirmation");
  assert.equal(f.state.writes, 0);
  assert.ok(!TOOLS.some((t) => /confirm|commit|write.*decision/.test(t.name)));
  const runtime = new Runtime({ cwd: "fixture", tools: TOOLS });
  assert.match(
    runtime.options(9).developerInstructions,
    /respect its current recommendations/,
  );
  assert.doesNotMatch(
    runtime.options(8).developerInstructions,
    /Review decisions \(contract 9\)/,
  );
});
test("recommendation UI is text-safe, draft-only; confirmation exact scope, distinct controls", async () => {
  const h = (type, props, ...children) => ({
    type,
    props: props || {},
    children,
  });
  const window = { PluginApi: { React: { createElement: h } } };
  vm.runInNewContext(
    await fs.readFile(
      new URL("../plugin/recommendations.js", import.meta.url),
      "utf8",
    ),
    { window },
  );
  const f = await fixture();
  const s = f.state.scene;
  s.recommendations = recommendations(s, f.d, "owner", "now");
  const asks = [],
    decisions = [];
  const tree = window.StashAIReview.Recommendations({
    scene: s,
    onAsk: (v) => asks.push(v),
    onDecision: (v) => decisions.push(v),
  });
  const nodes = [];
  function walk(v) {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      nodes.push(v);
      v.children?.forEach(walk);
    }
  }
  walk(tree);
  const text = (n) => JSON.stringify(n.children);
  nodes
    .find((n) => n.type === "button" && text(n).includes("Draft investigation"))
    .props.onClick();
  assert.equal(asks.length, 1);
  assert.match(asks[0], /scene 4153/);
  assert.equal(decisions.length, 0);
  nodes
    .find((n) => n.type === "button" && text(n).includes("No action needed"))
    .props.onClick();
  assert.equal(decisions[0].action, "no-action");
  assert.deepEqual([...decisions[0].findings], ["missing-franchise"]);
  assert.equal(f.state.writes, 0);
  const r = await f.prepare({ ...f.args, note: "<script>unsafe()</script>" });
  const confirmed = [];
  const panel = window.StashAIReview.Confirmations({
    requests: [r],
    busy: false,
    onConfirm: (...a) => confirmed.push(a),
  });
  assert.match(JSON.stringify(panel), /does not change scene metadata/);
  assert.match(JSON.stringify(panel), /<script>/);
  assert.doesNotMatch(
    JSON.stringify(panel),
    /"type":"script"|dangerouslySetInnerHTML/,
  );
  assert.equal(confirmed.length, 0);
});
