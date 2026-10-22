import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
const code = await fs.readFile(
  new URL("../plugin/global-tag-cleanup.js", import.meta.url),
  "utf8",
);
const tick = () => new Promise((r) => setImmediate(r));
function harness() {
  let cursor = 0;
  const hooks = [],
    effects = [],
    calls = [];
  const R = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    Fragment: "fragment",
    useState(v) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = v;
      return [
        hooks[i],
        (v) => (hooks[i] = typeof v === "function" ? v(hooks[i]) : v),
      ];
    },
    useRef(v) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { current: v };
      return hooks[i];
    },
    useEffect(fn, deps) {
      const i = cursor++,
        old = hooks[i];
      if (!old || deps.some((v, j) => v !== old.deps[j])) {
        hooks[i] = { deps };
        effects.push(() => {
          old?.cleanup?.();
          hooks[i].cleanup = fn();
        });
      }
    },
  };
  const w = {};
  vm.runInNewContext(code, { PluginApi: { React: R }, window: w, Date });
  const plan = {
    id: "p",
    createdAt: 1,
    status: "awaiting-approval",
    stage: "No deletion approved",
    digest: "frozen",
    canApprove: true,
    counts: {
      tags: 1,
      scenes: 1,
      images: 2,
      sceneAssignments: 1,
      imageAssignments: 2,
      aliases: 0,
      artwork: 0,
    },
  };
  const props = {
    threadId: "t",
    ready: true,
    revision: 0,
    busy: false,
    request: async (route, b) => {
      calls.push({ route, ...structuredClone(b) });
      if (b.action === "list") return { plans: [structuredClone(plan)] };
      if (b.action === "read")
        return {
          plan,
          tags: [{ id: "7", name: "<img src=x onerror=approve()>" }],
          artwork: [],
          rows: [{ tag_id: 7 }],
          count: 1,
          page: 1,
        };
      if (b.action === "approve") {
        plan.status = "preflight";
        return plan;
      }
    },
  };
  const render = () => {
    cursor = 0;
    const cards = w.StashAIGlobalCleanup.useCards(props);
    for (const f of effects.splice(0)) f();
    return cards;
  };
  const all = (n) =>
    Array.isArray(n)
      ? n.flatMap(all)
      : n && typeof n === "object"
        ? [n, ...all(n.children || [])]
        : [];
  const find = (tree, text) =>
    all(tree).find((n) => n.type === "button" && n.children.includes(text));
  return { props, plan, render, calls, all, find };
}
test("global card requires explicit acknowledgement, never auto-approves, and surfaces progress after revision", async () => {
  const f = harness();
  f.render();
  await tick();
  let tree = f.render();
  let approve = f.find(tree, "Approve exact global tag deletion");
  assert.equal(approve.props.disabled, true);
  assert.ok(f.calls.every((c) => c.action === "list"));
  f.all(tree)
    .find((n) => n.type === "input")
    .props.onChange({ target: { checked: true } });
  tree = f.render();
  approve = f.find(tree, "Approve exact global tag deletion");
  assert.equal(approve.props.disabled, false);
  await approve.props.onClick();
  f.props.revision++;
  f.render();
  await tick();
  tree = f.render();
  assert.ok(JSON.stringify(tree).includes("preflight"));
  assert.equal(
    f.find(tree, "Refresh global cleanup status").props.disabled,
    false,
  );
  assert.deepEqual(f.calls.find((c) => c.action === "approve").args, {
    planId: "p",
    digest: "frozen",
    acknowledge: "DELETE EXACT GLOBAL TAGS",
  });
});
test("exact untrusted names are rendered as text, not HTML; failures remain visible", async () => {
  const f = harness();
  f.render();
  await tick();
  let tree = f.render();
  await f.find(tree, "Review exact tags and assignments").props.onClick();
  tree = f.render();
  assert.ok(JSON.stringify(tree).includes("<img src=x onerror=approve()>"));
  assert.ok(
    !f
      .all(tree)
      .some((n) => n.type === "img" || n.props.dangerouslySetInnerHTML),
  );
  f.props.request = async () => {
    throw Error("GLOBAL_BACKUP_CHANGED");
  };
  tree = f.render();
  await f.find(tree, "Refresh global cleanup status").props.onClick();
  tree = f.render();
  assert.ok(
    JSON.stringify(tree).includes("recovery archive is missing or changed"),
  );
  assert.ok(!f.calls.some((c) => c.action === "approve"));
});
