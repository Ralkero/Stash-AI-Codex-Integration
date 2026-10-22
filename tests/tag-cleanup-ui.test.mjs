import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
const source = await fs.readFile(
  new URL("../plugin/tag-cleanup.js", import.meta.url),
  "utf8",
);
const tick = () => new Promise((r) => setImmediate(r));
test("UI and Diagnostics advertise the bulk-aware tool contract", async () => {
  const ui = await fs.readFile(
    new URL("../plugin/stash-ai.js", import.meta.url),
    "utf8",
  );
  assert.match(ui, /toolSchema: 10/);
  assert.match(ui, /schemaVersion: 10/);
  assert.match(source, /separate audit checks your Character-only Tag policy/);
});
function harness() {
  let cursor = 0,
    pending = [],
    tree;
  const hooks = [],
    calls = [],
    drafts = [];
  const audit = {
    id: "audit",
    status: "complete",
    scenes: 100,
    total: 100,
    tagged: 90,
    untagged: 10,
    associations: 160,
    classified: 2,
    distinctTags: 2,
    reconciled: 100,
    scope: "all native scenes",
  };
  const plan = {
    id: "plan",
    status: "awaiting-approval",
    digest: "frozen",
    scenes: 25,
    relationships: 25,
    prepared: 25,
    expectedScenes: 25,
    tagIds: ["1008"],
    counts: { pending: 25 },
    expiresAt: Date.now() + 60000,
  };
  const state = { audits: [audit], plans: [plan] };
  const R = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    useState(v) {
      const i = cursor++;
      hooks[i] ??= { v };
      return [
        hooks[i].v,
        (x) => {
          hooks[i].v = typeof x === "function" ? x(hooks[i].v) : x;
        },
      ];
    },
    useRef(v) {
      return (hooks[cursor++] ??= { current: v });
    },
    useEffect(fn, deps) {
      const i = cursor++,
        old = hooks[i];
      if (!old || deps.some((d, n) => d !== old.deps[n])) {
        hooks[i] = { deps };
        pending.push(() => {
          old?.cleanup?.();
          hooks[i].cleanup = fn();
        });
      }
    },
  };
  const window = {};
  vm.runInNewContext(source, { PluginApi: { React: R }, window, Date });
  const props = {
    threadId: "thread",
    revision: 0,
    busy: false,
    base: "/",
    onDraft: (s) => drafts.push(s),
    request: async (route, b) => {
      calls.push({ route, ...structuredClone(b) });
      if (b.action === "list") return structuredClone(state);
      if (b.action === "approve") {
        plan.status = "running";
        plan.approval = { at: Date.now() };
        return plan;
      }
      if (b.action === "control") {
        plan.status =
          b.args.action === "pause"
            ? "paused"
            : b.args.action === "stop"
              ? "cancelled"
              : "running";
        return plan;
      }
      if (b.action === "read" && b.args.planId)
        return {
          plan: structuredClone(plan),
          page: b.args.page || 1,
          count: 25,
          rows: [
            {
              id: "1",
              before: ["44", "1008"],
              remove: ["1008"],
              after: ["44"],
              observedAt: "today",
              outcome: { status: "pending" },
            },
          ],
        };
      if (b.action === "read")
        return {
          audit,
          page: 1,
          count: 1,
          candidates: [
            {
              tag: {
                id: "1008",
                name: '<img src=x onerror="approve()">',
                matches: [],
              },
              evidence: "e",
              eligible: true,
              category: "confirmed-non-character",
              reason: "User decision",
              assignments: 25,
              examples: ["1", "3"],
            },
          ],
        };
    },
  };
  const render = () => {
    cursor = 0;
    tree = window.StashAITagCleanup(props);
    for (const f of pending.splice(0)) f();
    return tree;
  };
  const all = (n) =>
    Array.isArray(n)
      ? n.flatMap((x) => all(x))
      : n && typeof n === "object"
        ? [n, ...all(n.children || [])]
        : [];
  const text = (n) =>
    Array.isArray(n)
      ? n.map(text).join(" ")
      : n && typeof n === "object"
        ? text(n.children || [])
        : typeof n === "string"
          ? n
          : "";
  return {
    state,
    plan,
    props,
    calls,
    drafts,
    render,
    all: () => all(tree),
    text: (n = tree) => text(n),
    async settle() {
      render();
      await tick();
      render();
    },
    async click(label) {
      const n = all(tree).find(
        (n) => n.type === "button" && text(n).includes(label),
      );
      assert.ok(n, label);
      assert.equal(n.props.disabled, false, label);
      await n.props.onClick();
      await tick();
      render();
    },
    unmount() {
      hooks.forEach((h) => h?.cleanup?.());
    },
  };
}
test("audit UI renders coverage and a real frozen full-plan approval; mount never approves", async () => {
  const f = harness();
  await f.settle();
  assert.match(f.text(), /100 \/ 100 scenes/);
  assert.match(f.text(), /25 removals on 25 scenes/);
  assert.ok(f.calls.every((c) => c.action === "list"));
  await f.click("Inspect complete removal manifest");
  assert.match(f.text(), /Before: 44, 1008/);
  assert.match(f.text(), /Remove only: 1008/);
  assert.match(f.text(), /After: 44/);
  await f.click("Next page");
  assert.equal(f.calls.filter((c) => c.action === "read").at(-1).args.page, 2);
  await f.click("Approve entire cleanup");
  assert.deepEqual(f.calls.find((c) => c.action === "approve").args, {
    planId: "plan",
    digest: "frozen",
  });
  f.props.busy = true;
  f.render();
  await f.click("Pause");
  assert.equal(f.plan.status, "paused");
  await f.click("Stop future execution");
  assert.equal(f.plan.status, "cancelled");
  f.unmount();
});
test("candidate names remain text, preview and preparation only draft editable prompts", async () => {
  const f = harness();
  await f.settle();
  await f.click("Inspect candidate groups");
  assert.match(f.text(), /<img src=x/);
  assert.ok(
    !f.all().some((n) => n.type === "img" || n.props.dangerouslySetInnerHTML),
  );
  await f.click("Preview representative scenes");
  assert.match(f.drafts[0], /only these representative scene IDs/);
  const box = f
    .all()
    .find((n) => n.type === "input" && n.props.type === "checkbox");
  box.props.onChange({ target: { checked: true } });
  f.render();
  await f.click("Draft cleanup-plan request");
  assert.match(f.drafts[1], /only these selected eligible Tag IDs: 1008/);
  assert.ok(!f.calls.some((c) => c.action === "approve"));
  f.unmount();
});
test("exact identity view records classification only and shows carried decisions", async () => {
  const f = harness(),
    original = f.props.request;
  f.state.audits[0].inheritedDecisions = 20;
  f.props.request = async (route, body) => {
    if (body.action === "classify") {
      f.calls.push(structuredClone(body));
      return f.state.audits[0];
    }
    if (body.action === "read")
      return {
        audit: f.state.audits[0],
        page: 1,
        count: 1,
        tag: {
          tag: { id: "956", name: "Stellar Blade" },
          owner: { reason: "unregistered" },
          evidence: "exact-evidence",
          eligible: false,
          category: "probable-non-character",
          reason: "Needs explicit confirmation",
        },
        sceneIds: ["1"],
      };
    return original(route, body);
  };
  await f.settle();
  assert.match(f.text(), /20 saved classification decisions carried forward/);
  await f.click("Inspect candidate groups");
  await f.click("Non-character — record decision");
  assert.deepEqual(f.calls.find((c) => c.action === "classify").args, {
    auditId: "audit",
    tagId: "956",
    choice: "non-character",
    evidence: "exact-evidence",
  });
  assert.match(f.text(), /Stellar Blade — exact assignments/);
  assert.ok(!f.calls.some((c) => c.action === "approve"));
  f.unmount();
});
test("expired approval is disabled and empty conversations do not acquire an audit panel", async () => {
  const f = harness();
  f.plan.expiresAt = 0;
  await f.settle();
  assert.equal(
    f
      .all()
      .find((n) => n.type === "button" && f.text(n).includes("Approve entire"))
      .props.disabled,
    true,
  );
  f.state.audits = [];
  f.state.plans = [];
  f.props.revision++;
  await f.settle();
  assert.equal(f.render(), null);
  f.unmount();
});
test("reload waits for the shared transport and retries after reconnect", async () => {
  const f = harness();
  f.props.ready = false;
  await f.settle();
  assert.equal(f.calls.length, 0);
  f.props.ready = true;
  await f.settle();
  assert.match(f.text(), /100 \/ 100 scenes/);
  f.props.ready = false;
  await f.settle();
  const n = f.calls.length;
  f.props.ready = true;
  await f.settle();
  assert.ok(f.calls.length > n);
  await f.click("Inspect complete removal manifest");
  assert.match(f.text(), /Before: 44/);
  f.unmount();
});

test("outdated plans explain changed decisions and disable approval before a click", async () => {
  const f = harness();
  f.plan.approvalBlock = "CLEANUP_DECISION_CHANGED";
  await f.settle();
  assert.match(f.text(), /outdated — replacement required/);
  assert.match(f.text(), /Your Character decisions changed/);
  assert.equal(
    f
      .all()
      .find(
        (n) => n.type === "button" && f.text(n).startsWith("Approve entire"),
      ).props.disabled,
    true,
  );
  assert.equal(
    f.calls.some((c) => c.action === "approve"),
    false,
  );
  f.unmount();
});

test("approval failure stays in its own plan beside controls across background refresh", async () => {
  const f = harness();
  const original = f.props.request;
  f.props.request = (route, b) =>
    b.action === "approve"
      ? Promise.reject(Error("CLEANUP_DECISION_CHANGED"))
      : original(route, b);
  await f.settle();
  await f.click("Approve entire");
  let section = f
    .all()
    .find((n) => n.props["aria-label"] === "Removal plan plan");
  assert.match(
    f.text(section),
    /Approval was not accepted.*Your Character decisions changed/,
  );
  assert.ok(f.all().some((n) => n.props.role === "alert"));
  f.props.revision++;
  await f.settle();
  section = f.all().find((n) => n.props["aria-label"] === "Removal plan plan");
  assert.match(f.text(section), /Approval was not accepted/);
  assert.equal(f.plan.status, "awaiting-approval");
  f.unmount();
});

test("slow approval immediately gives visible feedback and cannot be clicked twice", async () => {
  const f = harness();
  const original = f.props.request;
  let resolve;
  f.props.request = (route, b) =>
    b.action === "approve"
      ? new Promise((r) => {
          resolve = () =>
            r({ ...f.plan, status: "running", approval: { at: Date.now() } });
        })
      : original(route, b);
  await f.settle();
  const action = f
    .all()
    .find((n) => n.type === "button" && f.text(n).startsWith("Approve entire"))
    .props.onClick();
  f.render();
  assert.match(f.text(), /Submitting approval…/);
  assert.equal(
    f
      .all()
      .find(
        (n) => n.type === "button" && f.text(n).startsWith("Approve entire"),
      ).props.disabled,
    true,
  );
  resolve();
  await action;
  await f.settle();
  f.unmount();
});

test("lost response does not falsely claim no approval and refresh never resubmits", async () => {
  const f = harness();
  const original = f.props.request;
  f.props.request = async (route, b) => {
    if (b.action === "approve") {
      await original(route, b);
      throw Error("REQUEST_FAILED");
    }
    return original(route, b);
  };
  await f.settle();
  await f.click("Approve entire");
  assert.match(f.text(), /do not assume approval failed/);
  await f.click("Refresh status");
  assert.match(f.text(), /Approval recorded — cleanup is running/);
  assert.equal(f.calls.filter((c) => c.action === "approve").length, 1);
  f.unmount();
});

test("accepted approval followed by failed status refresh stays accepted", async () => {
  const f = harness();
  const original = f.props.request;
  await f.settle();
  f.props.request = (route, b) =>
    b.action === "list" ? Promise.reject(Error("OFFLINE")) : original(route, b);
  f.render();
  await f.click("Approve entire");
  assert.match(
    f.text(),
    /request was accepted, but the latest status could not be loaded/,
  );
  assert.match(f.text(), /Approval recorded — cleanup is running/);
  f.unmount();
});

test("live progress is accessible, shows partial outcomes and completes without hidden failures", async () => {
  const f = harness();
  f.plan.status = "running";
  f.plan.approval = { at: Date.now() };
  f.plan.counts = {
    verified: 12,
    reconciled: 1,
    pending: 10,
    intent: 1,
    uncertain: 1,
  };
  await f.settle();
  assert.match(
    f.text(),
    /13 of 25 scenes verified; 10 pending, 1 in progress, 1 uncertain/,
  );
  assert.equal(f.all().find((n) => n.type === "progress").props.value, 13);
  f.props.ready = false;
  f.render();
  assert.match(f.text(), /Disconnected — displayed counts may be stale/);
  f.props.ready = true;
  f.plan.status = "completed";
  f.plan.counts = { verified: 25, pending: 0 };
  f.plan.verifiedRelationships = 25;
  f.props.revision++;
  await f.settle();
  assert.match(f.text(), /Cleanup completed/);
  assert.match(f.text(), /25 approved relationships verified removed/);
  await f.click("Inspect candidate groups");
  assert.ok(
    f.text().indexOf("Removal plan · completed") >
      f.text().indexOf("Tag candidates"),
  );
  f.unmount();
});

test("all transcript kinds share oldest-first stable ordering without mutating history", () => {
  const window = {};
  vm.runInNewContext(source, { PluginApi: { React: {} }, window, Date });
  const node = (id, at) => ({ props: { id, "data-stash-time": at } });
  const messages = [
    node("user1", 10),
    node("assistant1", 10),
    node("user2", 30),
    node("assistant2", 30),
    node("streaming", 80),
  ];
  const input = [
    messages,
    false,
    [node("new-plan", 40), node("old-plan", 20)],
    node("review", 50),
    node("proposal", 25),
    node("audit", 15),
  ];
  const before = JSON.stringify(input);
  const ordered = window.StashAIChronology(input);
  assert.deepEqual(
    Array.from(ordered, (n) => n.props.id),
    [
      "user1",
      "assistant1",
      "audit",
      "old-plan",
      "proposal",
      "user2",
      "assistant2",
      "new-plan",
      "review",
      "streaming",
    ],
  );
  assert.equal(JSON.stringify(input), before);
  assert.equal(ordered[0], messages[0]);
});

test("legacy untimed messages keep source order and equal times remain stable", () => {
  const window = {};
  vm.runInNewContext(source, { PluginApi: { React: {} }, window, Date });
  const nodes = [
    undefined,
    null,
    false,
    { props: { id: "a" } },
    { props: { id: "b", "data-stash-time": NaN } },
    { props: { id: "c", "data-stash-time": 5 } },
    { props: { id: "d" } },
  ];
  assert.deepEqual(
    Array.from(window.StashAIChronology(nodes), (n) => n.props.id),
    ["a", "b", "c", "d"],
  );
});

test("new plan stays after completed plan and expanded evidence stays beside its owner", async () => {
  const f = harness();
  f.state.audits[0].createdAt = 10;
  f.plan.createdAt = 40;
  f.state.plans.push({
    ...f.plan,
    id: "old",
    createdAt: 20,
    status: "completed",
  });
  f.props.children = [
    {
      type: "article",
      props: { key: "later", "data-stash-time": 60 },
      children: ["Newest message"],
    },
  ];
  await f.settle();
  let text = f.text();
  assert.ok(text.indexOf("Plan ID: old") < text.indexOf("Plan ID: plan"));
  assert.ok(text.indexOf("Plan ID: plan") < text.indexOf("Newest message"));
  await f.click("Inspect candidate groups");
  text = f.text();
  assert.ok(text.indexOf("Tag candidates") < text.indexOf("Plan ID: old"));
  f.plan.counts = { verified: 25 };
  f.plan.status = "completed";
  f.props.revision++;
  await f.settle();
  assert.ok(
    f.text().indexOf("Plan ID: old") < f.text().indexOf("Plan ID: plan"),
  );
  assert.ok(f.calls.every((c) => ["list", "read"].includes(c.action)));
  f.unmount();
});
