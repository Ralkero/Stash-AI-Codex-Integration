import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
const source = await fs.readFile(
  new URL("../plugin/exact-character-cleanup.js", import.meta.url),
  "utf8",
);
const tick = () => new Promise((r) => setImmediate(r));
function harness() {
  let cursor = 0,
    pending = [],
    tree;
  const hooks = [],
    calls = [];
  let release;
  const plan = {
    id: "fixture",
    digest: "digest",
    state: "awaiting-approval",
    scenes: 2,
    relationships: 3,
    createdAt: 1,
    expiresAt: Date.now() + 60000,
    counts: {
      pending: 2,
      verified: 0,
      intent: 0,
      skipped: 0,
      failed: 0,
      recovered: 0,
    },
    verifiedRelationships: 0,
  };
  const detail = {
    plan,
    manifest: {
      id: "fixture",
      expiresAt: plan.expiresAt,
      counts: {
        scenes: 2,
        relationships: 3,
        distinctTags: 2,
        emptyAfter: 0,
        retainingTags: 2,
        reasons: { Reviewed: 3 },
      },
      entries: [
        {
          operationId: "one",
          sceneId: "10",
          label: "One",
          names: { 1: "<img onerror=alert(1)>", 2: "Keep" },
          before: ["1", "2"],
          remove: ["1"],
          after: ["2"],
          evidence: [{ reason: "Reviewed", decisionId: "d" }],
          excluded: [],
        },
        {
          operationId: "two",
          sceneId: "20",
          label: "Two",
          names: { 1: "Other" },
          before: ["1"],
          remove: ["1"],
          after: [],
          evidence: [{ reason: "Reviewed", decisionId: "d" }],
          excluded: [],
        },
      ],
      excluded: [],
    },
    rows: [
      { operationId: "one", status: "pending" },
      { operationId: "two", status: "pending" },
    ],
    journal: [],
    challenge: "secret",
  };
  const R = {
    Fragment: "fragment",
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
  vm.runInNewContext(source, {
    window,
    PluginApi: { React: R },
    Date,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout,
  });
  const props = {
    ready: true,
    writesReady: true,
    busy: false,
    revision: 0,
    request: async (route, b) => {
      calls.push({ route, ...b });
      if (b.action === "approve") {
        await new Promise((r) => (release = r));
        plan.state = "approved";
      }
      return b.action === "read"
        ? structuredClone(detail)
        : b.action === "list"
          ? { plans: [structuredClone(plan)] }
          : structuredClone(plan);
    },
  };
  function render() {
    cursor = 0;
    tree = window.StashAIExactCharacterCleanup(props);
    const q = pending;
    pending = [];
    q.forEach((fn) => fn());
    return tree;
  }
  const nodes = () => {
    const all = [];
    function visit(v) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") {
        all.push(v);
        visit(v.children);
      }
    }
    visit(tree);
    return all;
  };
  const text = (v) =>
    Array.isArray(v)
      ? v.map(text).join("")
      : v && typeof v === "object"
        ? text(v.children)
        : String(v ?? "");
  const button = (s) =>
    nodes().find((n) => n.type === "button" && text(n).includes(s));
  return {
    render,
    nodes,
    text: () => text(tree),
    button,
    calls,
    props,
    release: () => release(),
    flush: async () => {
      await tick();
      render();
      await tick();
      render();
    },
  };
}
test("review keeps full-scope approval, escapes labels, and requires explicit acknowledgement", async () => {
  const f = harness();
  f.render();
  f.button("Character Tag Cleanup").props.onClick();
  f.render();
  await f.flush();
  await f.button("Inspect complete plan").props.onClick();
  f.render();
  assert.equal(f.button("Approve removal of 3").props.disabled, true);
  assert(
    !f.nodes().some((n) => n.type === "img" || n.props.dangerouslySetInnerHTML),
  );
  assert(f.text().includes("<img onerror=alert(1)>"));
  const input = f
    .nodes()
    .find((n) => n.type === "input" && n.props.type !== "checkbox");
  input.props.onChange({ target: { value: "20" } });
  f.render();
  assert(f.text().includes("1 of 2 scenes shown"));
  assert(
    f.text().includes("Approve removal of 3 Tag assignments from 2 scenes"),
  );
  assert.equal(f.calls.filter((c) => c.action === "approve").length, 0);
});
test("progress revision during approval does not leave UI locked or issue duplicate approval", async () => {
  const f = harness();
  f.render();
  f.button("Character Tag Cleanup").props.onClick();
  f.render();
  await f.flush();
  await f.button("Inspect complete plan").props.onClick();
  f.render();
  f.nodes()
    .find((n) => n.props.type === "checkbox")
    .props.onChange({ target: { checked: true } });
  f.render();
  const inflight = f.button("Approve removal").props.onClick();
  f.render();
  assert(f.button("Refresh status").props.disabled);
  f.props.revision++;
  f.render();
  await f.flush();
  f.release();
  await inflight;
  await f.flush();
  assert.equal(f.button("Refresh status").props.disabled, false);
  assert.equal(f.calls.filter((c) => c.action === "approve").length, 1);
  assert(!f.button("Approve removal"));
});
test("runtime unavailable still permits review but never enables approval", async () => {
  const f = harness();
  f.props.writesReady = false;
  f.render();
  assert.equal(f.button("Character Tag Cleanup").props.disabled, false);
  f.button("Character Tag Cleanup").props.onClick();
  f.render();
  await f.flush();
  await f.button("Inspect complete plan").props.onClick();
  f.render();
  f.nodes()
    .find((n) => n.props.type === "checkbox")
    .props.onChange({ target: { checked: true } });
  f.render();
  assert(f.text().includes("Read-only review"));
  assert(f.button("Approve removal").props.disabled);
  assert.equal(f.calls.filter((c) => c.action === "approve").length, 0);
});
