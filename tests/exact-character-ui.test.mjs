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
    calls = [],
    navigation = [];
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
  const historical = structuredClone(detail);
  historical.plan.id = historical.manifest.id = "historical";
  historical.plan.state = "invalidated";
  historical.plan.digest = "historical-digest";
  historical.challenge = null;
  const details = { fixture: detail, historical };
  const controls = { read: null };
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
        ? controls.read
          ? controls.read(b.args.planId)
          : structuredClone(details[b.args.planId])
        : b.action === "list"
          ? { plans: [structuredClone(plan), structuredClone(historical.plan)] }
          : structuredClone(plan);
    },
  };
  function render() {
    cursor = 0;
    tree = window.StashAIExactCharacterCleanup(props);
    // Model the commit phase: DOM refs are assigned before passive effects.
    for (const hook of hooks) {
      if (hook?.current?.fixtureElement) hook.current = null;
    }
    for (const node of nodes()) {
      if (node.props.ref)
        node.props.ref.current = {
          fixtureElement: true,
          focus: (options) =>
            navigation.push({ action: "focus", node, options }),
          scrollIntoView: (options) =>
            navigation.push({ action: "scroll", node, options }),
        };
    }
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
    navigation,
    controls,
    details,
    inspect: (id) => {
      const card = nodes().find((n) => n.props["data-exact-plan"] === id);
      return card.children
        .flat(Infinity)
        .find(
          (n) => n?.type === "button" && text(n) === "Inspect complete plan",
        );
    },
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

async function opened() {
  const f = harness();
  f.render();
  f.button("Character Tag Cleanup").props.onClick();
  f.render();
  await f.flush();
  return f;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const review = (f) => f.nodes().find((n) => n.props["data-exact-review"]);

test("inspection announces loading, then focuses and scrolls the committed accessible review", async () => {
  const f = await opened(),
    response = deferred();
  f.controls.read = () => response.promise;
  const pending = f.inspect("fixture").props.onClick();
  f.render();
  assert(!review(f));
  assert.equal(f.navigation.length, 0);
  const status = f.nodes().find((n) => n.props.role === "status");
  assert(status);
  assert.equal(status.props["aria-live"], "polite");
  assert(f.text().includes("Loading complete review for plan fixture"));
  assert(f.inspect("fixture").props.disabled);
  response.resolve(structuredClone(f.details.fixture));
  await pending;
  assert.equal(f.navigation.length, 0, "must wait for React commit");
  f.render();
  const section = review(f);
  assert.equal(section.props.tabIndex, -1);
  assert.equal(section.props.role, "region");
  assert(
    f
      .nodes()
      .some(
        (n) =>
          n.type === "h3" && n.props.id === section.props["aria-labelledby"],
      ),
  );
  assert(f.text().includes("Selected plan: fixture"));
  assert.deepEqual(
    f.navigation.map((n) => n.action),
    ["focus", "scroll"],
  );
  assert(f.navigation.every((n) => n.node === section));
  assert.equal(f.navigation[0].options.preventScroll, true);
  assert.equal(f.navigation[1].options.block, "start");
  assert(!f.text().includes("Loading complete review"));
});

test("repeated explicit inspections navigate again but background revisions do not steal focus", async () => {
  const f = await opened();
  for (let i = 1; i <= 2; i++) {
    await f.inspect("fixture").props.onClick();
    f.render();
    assert.equal(f.navigation.length, i * 2);
  }
  f.props.revision++;
  await f.flush();
  assert.equal(f.navigation.length, 4);
  assert(f.calls.every((c) => ["list", "read"].includes(c.action)));
});

test("switching historical and current plans clears acknowledgement and never mislabels details", async () => {
  const f = await opened();
  await f.inspect("fixture").props.onClick();
  f.render();
  f.nodes()
    .find((n) => n.props.type === "checkbox")
    .props.onChange({ target: { checked: true } });
  f.render();
  assert(!f.button("Approve removal").props.disabled);
  const response = deferred();
  f.controls.read = () => response.promise;
  const pending = f.inspect("historical").props.onClick();
  f.render();
  assert(!review(f));
  assert(!f.button("Approve removal"));
  response.resolve(structuredClone(f.details.historical));
  await pending;
  f.render();
  assert.equal(review(f).props["data-exact-review"], "historical");
  assert(f.text().includes("historical-digest"));
  assert(f.text().includes("Complete immutable review — invalidated"));
  assert(!f.button("Approve removal"));
  f.controls.read = null;
  await f.inspect("fixture").props.onClick();
  f.render();
  assert.equal(review(f).props["data-exact-review"], "fixture");
  assert.equal(
    f.nodes().find((n) => n.props.type === "checkbox").props.checked,
    false,
  );
  assert(f.button("Approve removal").props.disabled);
  assert.equal(f.details.fixture.challenge, "secret");
  assert.equal(f.calls.filter((c) => c.action === "approve").length, 0);
});

test("failed review exposes the actual error, clears stale details, focuses alert, and permits retry", async () => {
  const f = await opened();
  await f.inspect("fixture").props.onClick();
  f.render();
  f.controls.read = async () => {
    throw Error("HTTP 503: fixture read unavailable <tag>");
  };
  await f.inspect("historical").props.onClick();
  f.render();
  assert(!review(f));
  const alert = f.nodes().find((n) => n.props.role === "alert");
  assert.equal(alert.props.tabIndex, -1);
  assert(
    f
      .text()
      .includes(
        "Could not open the complete review for plan historical: HTTP 503: fixture read unavailable <tag>",
      ),
  );
  assert.equal(f.navigation.at(-1).node, alert);
  assert.equal(f.navigation.at(-2).action, "focus");
  assert(!f.inspect("historical").props.disabled);
  assert(!f.nodes().some((n) => n.props.dangerouslySetInnerHTML));
  f.controls.read = null;
  await f.inspect("historical").props.onClick();
  f.render();
  assert.equal(review(f).props["data-exact-review"], "historical");
  assert(!f.nodes().some((n) => n.props.role === "alert"));
});

test("a response for the wrong plan or manifest cannot be shown or approved", async () => {
  for (const mismatch of ["plan", "manifest"]) {
    const f = await opened(),
      wrong = structuredClone(f.details.fixture);
    wrong[mismatch].id = "historical";
    f.controls.read = async () => wrong;
    await f.inspect("fixture").props.onClick();
    f.render();
    assert(!review(f));
    assert(!f.button("Approve removal"));
    assert(
      f.text().includes("Review response did not match the selected plan."),
    );
  }
});

test("out-of-order inspection responses cannot replace the newest selection or unlock it early", async () => {
  const f = await opened(),
    first = deferred(),
    second = deferred();
  f.controls.read = (id) => (id === "fixture" ? first.promise : second.promise);
  const firstClick = f.inspect("fixture").props.onClick();
  // Simulate two events queued before React commits the disabled state.
  const secondClick = f.inspect("historical").props.onClick();
  f.render();
  first.resolve(structuredClone(f.details.fixture));
  await firstClick;
  f.render();
  assert(!review(f));
  assert(f.inspect("historical").props.disabled);
  assert.equal(f.navigation.length, 0);
  second.resolve(structuredClone(f.details.historical));
  await secondClick;
  f.render();
  assert.equal(review(f).props["data-exact-review"], "historical");
  assert.equal(f.navigation.length, 2);
  assert(!f.inspect("historical").props.disabled);
});

test("closing while inspection is pending prevents stale navigation and details on reopen", async () => {
  const f = await opened(),
    response = deferred();
  f.controls.read = () => response.promise;
  const pending = f.inspect("fixture").props.onClick();
  f.render();
  f.button("Close").props.onClick();
  f.render();
  response.resolve(structuredClone(f.details.fixture));
  await pending;
  f.render();
  assert.equal(f.navigation.length, 0);
  f.button("Character Tag Cleanup").props.onClick();
  await f.flush();
  assert(!review(f));
  assert(!f.inspect("fixture").props.disabled);
});
