import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import {
  assessScene,
  reviewFeedback,
  reviewSummary,
  REVIEW_LIMITATIONS,
} from "../service/review-policy.mjs";
import { searchCapabilities } from "../service/search-capabilities.mjs";
import { TOOLS } from "../service/tools.mjs";
import { characterExplanation } from "../service/character-explanations.mjs";
const source = await fs.readFile(
  new URL("../plugin/scene-results.js", import.meta.url),
  "utf8",
);
const refinementSource = await fs.readFile(
  new URL("../plugin/collection-refinement.js", import.meta.url),
  "utf8",
);
test("shared diagnostics registry advertises the current presentation contract", async () => {
  const page = await fs.readFile(
    new URL("../plugin/stash-ai.js", import.meta.url),
    "utf8",
  );
  assert.match(page, /schemaVersion: 10/);
  assert.match(page, /toolSchema: 10/);
});
const tick = () => new Promise((r) => setImmediate(r));
function harness() {
  let cursor = 0,
    pending = [],
    tree;
  const hooks = [],
    calls = [],
    asks = [],
    observers = [];
  let reply = { scenes: [], observedAt: new Date().toISOString() };
  const R = {
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    useState(value) {
      const index = cursor++;
      hooks[index] ??= { value };
      return [
        hooks[index].value,
        (v) => {
          hooks[index].value =
            typeof v === "function" ? v(hooks[index].value) : v;
        },
      ];
    },
    useRef(value) {
      return (hooks[cursor++] ??= { current: value });
    },
    useEffect(fn, deps) {
      const index = cursor++,
        old = hooks[index];
      if (!old || deps.some((v, i) => v !== old.deps[i])) {
        hooks[index] = { deps };
        pending.push(() => {
          old?.cleanup?.();
          hooks[index].cleanup = fn();
        });
      }
    },
  };
  const window = {
    PluginApi: { React: R },
    IntersectionObserver: class {
      constructor(fn) {
        this.fn = fn;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
  };
  vm.runInNewContext(refinementSource + "\n" + source, {
    window,
    Date,
    RegExp,
  });
  const props = {
    collection: {
      id: "collection1",
      count: 8,
      sourceTool: "find_scenes",
      scope: "returned-page",
      observedAt: new Date().toISOString(),
      layout: "grid",
    },
    threadId: "thread1",
    base: "/",
    request: async (...args) => {
      calls.push(args);
      return await reply;
    },
    onAsk: (text, context) => asks.push(context ? { text, context } : text),
  };
  function render() {
    cursor = 0;
    tree = window.StashAISceneResults(props);
    const effects = pending;
    pending = [];
    effects.forEach((f) => f());
    return tree;
  }
  const walk = (node) =>
    node && typeof node === "object"
      ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)]
      : [];
  return {
    render,
    props,
    calls,
    asks,
    observers,
    R,
    nodes: () => walk(tree),
    respond: (value) => {
      reply = value;
    },
    unmount: () => hooks.forEach((h) => h.cleanup?.()),
    visible: () => observers[0].fn([{ isIntersecting: true }]),
  };
}
const scene = (id) => ({
  sceneId: id,
  status: "available",
  title: "<script>text</script>",
  screenshot: `/scene/${id}/screenshot`,
  characters: {
    presence: "unknown",
    completeness: "partial",
    names: [],
    unclassifiedCount: 2,
  },
  authors: [],
  franchise: null,
  currentGaps: [],
  findings: [],
  descriptors: null,
  files: [],
});

test("positive Character stays primary; unclassified names render only as text and stale notes never imply persistence", async () => {
  const f = harness(),
    s = scene("1");
  s.characters = {
    presence: "present",
    completeness: "partial",
    names: [{ id: "2", name: "Recognized Character" }],
    unclassifiedCount: 1,
    unclassifiedTags: [
      { id: "3", name: "<img src=x onerror=alert(1)>", reason: "unregistered" },
    ],
  };
  s.characters.explanation = characterExplanation(s.characters);
  s.reasons = [
    {
      code: "search-match",
      label: "Matches your search",
      explanation: "Returned by your search.",
      basis: "selection",
    },
  ];
  f.respond({ scenes: [s], observedAt: Date.now() });
  f.render();
  f.visible();
  f.render();
  await tick();
  f.render();
  const component = f.nodes().find((n) => typeof n.type === "function");
  const card = component.type(component.props),
    text = JSON.stringify(card);
  assert.match(text, /Character assigned/);
  assert.match(text, /Recognized Character/);
  assert.match(text, /not a confirmed metadata error/);
  assert.match(text, /ID 3/);
  assert.doesNotMatch(
    text,
    /dangerouslySetInnerHTML|alert-warning|alert-danger|Character state unknown/,
  );
  const walk = (n) =>
    n && typeof n === "object"
      ? [n, ...(n.children || []).flat(Infinity).flatMap(walk)]
      : [];
  assert.ok(!walk(card).some((n) => n.type === "img" && n.props.src === "x"));
  const why = walk(card).find(
    (n) => n.props["aria-label"] === "Why this scene",
  );
  assert.doesNotMatch(
    JSON.stringify(why),
    /unregistered|unclassified|Character/,
  );
  const stale = component.type({ ...component.props, stale: true });
  assert.match(
    JSON.stringify(stale),
    /Current classification could not be checked/,
  );
  assert.doesNotMatch(
    JSON.stringify(stale),
    /some tags are still unclassified/,
  );
});

test("acknowledged finding retains facts but suppresses supplementary correction guidance", async () => {
  const f = harness(),
    s = scene("1");
  s.review = reviewFeedback(assessScene(s), s, "before", "now");
  s.recommendations = {
    rows: [{ key: "missing-franchise", decision: { state: "active" } }],
  };
  f.respond({ scenes: [s], observedAt: Date.now() });
  f.render();
  f.visible();
  f.render();
  await tick();
  f.render();
  const component = f.nodes().find((n) => typeof n.type === "function");
  const visibleText = (n) =>
    typeof n === "string"
      ? n
      : Array.isArray(n)
        ? n.map(visibleText).join(" ")
        : n && typeof n.type === "string"
          ? visibleText(n.children)
          : "";
  const text = visibleText(component.type(component.props));
  assert.match(text, /no Franchise was assigned/);
  assert.match(text, /You marked this condition No action needed/);
  assert.doesNotMatch(text, /Specify the intended existing Franchise/);
  assert.match(text, /find possible existing Authors/);
});

test("classification explanation action is read-only and does not request a correction", async () => {
  const f = harness(),
    s = scene("1");
  s.review = reviewFeedback(
    assessScene(s),
    s,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  f.respond({ scenes: [s], observedAt: Date.now() });
  f.render();
  f.visible();
  f.render();
  await tick();
  f.render();
  const component = f.nodes().find((n) => typeof n.type === "function");
  const walk = (n) =>
    n && typeof n === "object"
      ? [n, ...(n.children || []).flat(Infinity).flatMap(walk)]
      : [];
  const b = walk(component.type(component.props)).find(
    (n) => n.type === "button" && n.children[0] === "Explain this check",
  );
  assert.ok(b);
  b.props.onClick();
  assert.match(f.asks[0].text, /Do not prepare a proposal or apply changes/);
  assert.equal(f.calls.length, 1);
});
test("review summary, corrective draft, manual verification and preflight reuse collection without model calls", async () => {
  const f = harness(),
    s = scene("1");
  const original = assessScene(s);
  f.props.collection.sourceTool = "review_scenes";
  f.respond({
    scenes: [
      {
        ...s,
        review: reviewFeedback(
          original,
          s,
          new Date().toISOString(),
          new Date().toISOString(),
        ),
      },
    ],
    reviewSummary: reviewSummary([{ review: original }]),
    reviewLimitations: REVIEW_LIMITATIONS,
    searchCapabilities: searchCapabilities(
      TOOLS.map((t) => t.name),
      TOOLS.map((t) => t.name),
      8,
    ),
  });
  f.render();
  f.visible();
  f.render();
  await tick();
  f.render();
  assert.ok(
    f.nodes().some((n) => n.props["aria-label"] === "Review plan summary"),
  );
  assert.ok(
    f
      .nodes()
      .some((n) => n.props["aria-label"] === "Search capability preflight"),
  );
  const component = f.nodes().find((n) => typeof n.type === "function");
  const tree = component.type(component.props);
  const walk = (n) =>
    n && typeof n === "object"
      ? [n, ...(n.children || []).flat(Infinity).flatMap(walk)]
      : [];
  walk(tree)
    .find(
      (n) => n.type === "button" && n.children[0] === "Investigate correction",
    )
    .props.onClick();
  assert.equal(f.asks.length, 1);
  assert.match(f.asks[0].text, /scene 1/);
  assert.equal(f.asks[0].context.collectionId, "collection1");
  assert.equal(f.calls.length, 1);
  f.nodes()
    .find(
      (n) => n.type === "button" && n.children[0] === "Refresh verification",
    )
    .props.onClick();
  f.render();
  await tick();
  f.render();
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(([route]) => route === "/scene-results"));
});
test("collection waits for visibility; one batch hydrates authorized scenes; show more does not query", async () => {
  const f = harness();
  f.respond({
    scenes: Array.from({ length: 8 }, (_, i) => scene(String(i + 1))),
  });
  f.render();
  assert.equal(f.calls.length, 0);
  f.visible();
  f.render();
  await tick();
  f.render();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), [
    "/scene-results",
    { threadId: "thread1", collectionId: "collection1" },
  ]);
  assert.equal(f.nodes().filter((n) => n.props.scene).length, 6);
  f.nodes()
    .find(
      (n) => n.type === "button" && String(n.children).startsWith("Show more"),
    )
    .props.onClick();
  f.render();
  assert.equal(f.nodes().filter((n) => n.props.scene).length, 8);
  assert.equal(f.calls.length, 1);
  f.nodes()
    .find((n) => n.type === "select")
    .props.onChange({ target: { value: "list" } });
  f.render();
  assert.ok(
    f.nodes().some((n) => n.props.className?.includes("stash-ai-scene-list")),
  );
  assert.equal(f.calls.length, 1);
});
test("refresh fetches current data once; does not send model request; errors remain explicit", async () => {
  const f = harness();
  f.render();
  f.visible();
  f.render();
  await tick();
  f.render();
  f.respond(Promise.reject(Error("down")));
  f.nodes()
    .find((n) => n.type === "button" && n.children[0] === "Refresh metadata")
    .props.onClick();
  f.render();
  await tick();
  f.render();
  assert.equal(f.calls.length, 2);
  assert.ok(f.nodes().some((n) => n.props.role === "alert"));
  assert.ok(f.calls.every((c) => c[0] === "/scene-results"));
});
test("unmounted collection ignores in-flight reply and disconnects observer", async () => {
  const f = harness();
  let finish;
  f.respond(
    new Promise((r) => {
      finish = r;
    }),
  );
  f.render();
  f.visible();
  f.render();
  f.unmount();
  finish({ scenes: [scene("99")] });
  await tick();
  f.render();
  assert.ok(!f.nodes().some((n) => n.props.scene));
  assert.equal(f.observers[0].disconnected, true);
});
test("per-scene reasons precede metadata and secondary reasons are compact", async () => {
  const f = harness();
  f.respond({
    scenes: [
      {
        ...scene("1"),
        reasons: [
          {
            code: "missing-author",
            label: "Missing Author",
            explanation: "No Author when checked.",
            basis: "original",
            evidence: "verified-observation",
            observedAt: "2026-10-20T00:00:00Z",
            current: "no-longer-present",
          },
          {
            code: "character-unknown",
            label: "Character classification unknown",
            explanation: "Not an incorrect tag.",
            basis: "original",
            evidence: "unknown",
            observedAt: "2026-10-20T00:00:00Z",
            current: "unverified",
          },
        ],
      },
    ],
    observedAt: Date.now(),
  });
  f.render();
  f.visible();
  f.render();
  await tick();
  f.render();
  const component = f.nodes().find((n) => typeof n.type === "function");
  const card = component.type(component.props);
  const body = card.children[1];
  const section = body.children.find(
    (n) => n?.props?.["aria-label"] === "Why this scene",
  );
  assert.ok(section);
  assert.ok(
    body.children.indexOf(section) <
      body.children.findIndex((n) => n?.type === "details"),
  );
  const reasons = section.children[1];
  assert.equal(reasons.length, 2);
  assert.equal(reasons[0].children[0].children[0], "Missing Author");
  assert.ok(JSON.stringify(section).includes("No longer observed"));
  assert.ok(!JSON.stringify(section).includes("Original uncertainty"));
  assert.ok(JSON.stringify(section).includes("When checked:"));
  assert.equal(reasons[1].children[1], false);
  assert.ok(!JSON.stringify(section).includes("dangerouslySetInnerHTML"));
});
test("trusted card text stays text; Ask only prefills, Open Scene remains local", async () => {
  const f = harness();
  f.respond({ scenes: [scene("1")], observedAt: Date.now() });
  f.render();
  f.visible();
  f.render();
  await tick();
  f.render();
  const card = f.nodes().find((n) => typeof n.type === "function");
  const tree = card.type(card.props);
  const walk = (n) =>
    n && typeof n === "object"
      ? [n, ...(n.children || []).flat(Infinity).flatMap(walk)]
      : [];
  const nodes = walk(tree);
  assert.ok(
    nodes.some(
      (n) => n.type === "h4" && n.children[0] === "<script>text</script>",
    ),
  );
  assert.ok(!nodes.some((n) => n.props.dangerouslySetInnerHTML));
  nodes
    .find((n) => n.type === "button" && n.children[0] === "Ask about scene")
    .props.onClick();
  assert.equal(f.asks.length, 1);
  assert.match(f.asks[0], /scene 1/);
  assert.equal(f.calls.length, 1);
  assert.equal(nodes.find((n) => n.type === "a").props.href, "/scenes/1");
  const imageComponent = nodes.find((n) => typeof n.type === "function");
  let failed = false;
  f.R.useState = () => [
    failed,
    (v) => {
      failed = v;
    },
  ];
  f.R.useEffect = () => {};
  let image = imageComponent.type(imageComponent.props);
  assert.equal(image.children[0].props.loading, "lazy");
  image.children[0].props.onError();
  image = imageComponent.type(imageComponent.props);
  assert.equal(image.children[0].children[0], "Screenshot unavailable");
  failed = false;
  image = imageComponent.type({
    ...imageComponent.props,
    scene: { ...scene("1"), screenshot: "https://evil/x" },
  });
  assert.equal(image.children[0].children[0], "Screenshot unavailable");
});
test("local filters/sort/select/hidden selection prepare drafts without any network call; reset restores original", async () => {
  const f = harness();
  f.respond({
    scenes: [
      {
        ...scene("3"),
        characters: { presence: "present", completeness: "complete" },
      },
      scene("1"),
      scene("2"),
    ],
  });
  f.render();
  f.visible();
  f.render();
  await tick();
  f.render();
  const cards = () => f.nodes().filter((n) => n.props.scene);
  cards()[0].props.onSelect();
  f.render();
  assert.equal(cards()[0].props.selected, true);
  f.nodes()
    .find((n) => n.props["aria-label"] === "Character status")
    .props.onChange({ target: { value: "unknown" } });
  f.render();
  assert.deepEqual(
    cards().map((n) => n.props.scene.sceneId),
    ["1", "2"],
  );
  assert.match(
    JSON.stringify(f.nodes()),
    /1 scenes selected · 1 hidden by filters/,
  );
  f.nodes()
    .find((n) => n.props["aria-label"] === "Sort this collection")
    .props.onChange({ target: { value: "id-desc" } });
  f.render();
  assert.deepEqual(
    cards().map((n) => n.props.scene.sceneId),
    ["2", "1"],
  );
  for (const action of [
    "Investigate Selected",
    "Compare Metadata",
    "Check Review Status",
    "Find Related Scenes",
    "Search Stash again…",
  ])
    f.nodes()
      .find((n) => n.children[0] === action)
      .props.onClick();
  assert.equal(f.asks.length, 5);
  assert.ok(
    f.asks.every(
      (d) =>
        d.context.sceneIds.join() === "3" &&
        d.context.collectionId === "collection1",
    ),
  );
  assert.match(f.asks[4].text, /character=unknown/);
  assert.equal(f.calls.length, 1);
  f.nodes()
    .find((n) => n.children[0] === "Reset Filters")
    .props.onClick();
  f.nodes()
    .find((n) => n.props["aria-label"] === "Sort this collection")
    .props.onChange({ target: { value: "original" } });
  f.render();
  assert.deepEqual(
    cards().map((n) => n.props.scene.sceneId),
    ["3", "1", "2"],
  );
  f.nodes()
    .find((n) => n.children[0] === "Clear Selection")
    .props.onClick();
  f.render();
  assert.ok(cards().every((n) => !n.props.selected));
  assert.equal(f.calls.length, 1);
});
