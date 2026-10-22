import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
const source = await fs.readFile(
  new URL("../plugin/stash-ai.js", import.meta.url),
  "utf8",
);
const markdown = await fs.readFile(
  new URL("../plugin/message.js", import.meta.url),
  "utf8",
);
const css = await fs.readFile(
  new URL("../plugin/stash-ai.css", import.meta.url),
  "utf8",
);
const tick = () => new Promise((r) => setImmediate(r));
function harness({
  saved = "",
  history = [],
  proposals = [],
  evidence,
  suggestionError = false,
  sendErrors = [],
} = {}) {
  let Page,
    cursor = 0,
    tree,
    clients = 0,
    closed = 0,
    focused = 0;
  const hooks = [],
    pending = [],
    calls = [],
    handlers = new Map(),
    timers = [];
  const defaultEvidence = {
    observedAt: Date.now(),
    expiresAt: Date.now() + 60000,
    sources: [],
    items: [],
  };
  const same = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const React = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children,
    }),
    useState(value) {
      const i = cursor++;
      if (!hooks[i])
        hooks[i] = { value: typeof value === "function" ? value() : value };
      return [
        hooks[i].value,
        (v) => {
          hooks[i].value = typeof v === "function" ? v(hooks[i].value) : v;
        },
      ];
    },
    useRef(value) {
      const i = cursor++;
      return (hooks[i] ||= { current: value });
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!same(hooks[i]?.deps, deps)) hooks[i] = { value: fn, deps };
      return hooks[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(hooks[i]?.deps, deps)) {
        const old = hooks[i];
        hooks[i] = { deps };
        pending.push(() => {
          old?.cleanup?.();
          hooks[i].cleanup = fn();
        });
      }
    },
  };
  React.useLayoutEffect = React.useEffect;
  const observers = [];
  let client;
  const window = {
    innerHeight: 900,
    scrollY: 0,
    getComputedStyle: (el) => ({
      marginBottom: "21px",
      paddingBottom: el.paddingBottom || "0px",
    }),
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        observers.push(this);
      }
      observe() {}
      disconnect() {
        this.disconnected = true;
      }
    },
    PluginApi: {
      React,
      register: {
        route: (_r, p) => {
          Page = p;
        },
      },
      patch: { before() {} },
    },
    StashCustom: { apiVersion: 1, capabilities: { register() {} } },
    StashAISceneResults: function Collection() {},
    addEventListener: (key, fn) => handlers.set(key, fn),
    removeEventListener: (key) => handlers.delete(key),
    StashAITransport: class {
      constructor() {
        clients++;
        client = this;
      }
      close() {
        closed++;
      }
      async call(path, args = {}) {
        calls.push({ path, args });
        if (path === "/send" && sendErrors.length) {
          const error = sendErrors.shift();
          if (error) throw Error(error);
        }
        if (path === "/status")
          return { runtimeState: "ready", writesEnabled: true };
        if (path === "/conversations")
          return [
            { id: "saved", title: "Saved" },
            { id: "new", title: "New conversation" },
          ];
        if (path === "/history")
          return {
            messages: args.id === "saved" ? history : [],
            proposals,
            toolSchema: 4,
            active: false,
          };
        if (path === "/suggestions") {
          if (suggestionError) throw Error("unavailable");
          return evidence || defaultEvidence;
        }
        if (path === "/new") return { id: "new" };
        if (path === "/proposals") return proposals;
        return {};
      }
    },
  };
  vm.runInNewContext(markdown + "\n" + source, {
    window,
    document: { querySelector: () => null },
    localStorage: {
      getItem: (key) => (key.includes("pairing") ? "token" : saved),
      setItem() {},
    },
    location: {
      hostname: "localhost",
      protocol: "http:",
      search: "?scene=647",
    },
    URLSearchParams,
    AbortController,
    crypto: { randomUUID },
    Date,
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
  });
  function nodes() {
    const result = [];
    const walk = (x) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        result.push(x);
        x.children?.forEach(walk);
      }
    };
    walk(tree);
    return result;
  }
  const textOf = (x) =>
    typeof x === "string"
      ? x
      : Array.isArray(x)
        ? x.map(textOf).join("")
        : x?.children?.map(textOf).join("") || "";
  function render() {
    cursor = 0;
    tree = Page();
    for (const node of nodes())
      if (node.props.ref && !node.props.ref.current)
        node.props.ref.current = {
          focus() {
            focused++;
          },
          scrollTop: 0,
          style: {
            getPropertyValue(k) {
              return this[k];
            },
            setProperty(k, v) {
              this[k] = v;
            },
          },
          parentElement: {},
          getBoundingClientRect: () => ({ top: 77 }),
          clientWidth: 600,
          offsetHeight: 102,
          scrollHeight: 100,
          clientHeight: 100,
        };
    pending.splice(0).forEach((f) => f());
  }
  return {
    async settle() {
      for (let i = 0; i < 4; i++) {
        render();
        await tick();
      }
    },
    render,
    nodes,
    calls,
    timers,
    handlers,
    observers,
    find: (label) =>
      nodes().find(
        (n) =>
          n.type === "button" &&
          (textOf(n) === label || textOf(n.children[0]) === label),
      ),
    text: () => textOf(tree),
    get tree() {
      return tree;
    },
    get client() {
      return client;
    },
    stats: () => ({ clients, closed, focused }),
    close() {
      hooks.forEach((h) => h?.cleanup?.());
    },
  };
}
test("empty session defaults to minimal landing; suggestions do not delay composer", async () => {
  const ui = harness();
  await ui.settle();
  assert.match(ui.tree.props.className, /stash-ai-simple stash-ai-landing/);
  assert.ok(ui.find("Advanced View"));
  assert.match(ui.text(), /not a full-library review/);
  assert.ok(ui.nodes().find((n) => n.type === "textarea"));
  assert.ok(!ui.find("Disconnect browser"));
  assert.equal(ui.calls.filter((c) => c.path === "/events").length, 1);
  ui.close();
});
test("route height uses measured position, contains hidden speakers, and cleans up sizing listeners", async () => {
  const ui = harness();
  await ui.settle();
  assert.equal(ui.tree.props.ref.current.style["--stash-ai-height"], "802px");
  assert.ok(ui.handlers.has("resize"));
  ui.tree.props.ref.current.getBoundingClientRect = () => ({ top: 100 });
  ui.handlers.get("resize")();
  assert.equal(ui.tree.props.ref.current.style["--stash-ai-height"], "779px");
  ui.tree.props.ref.current.parentElement.paddingBottom = "49px";
  ui.handlers.get("resize")();
  assert.equal(ui.tree.props.ref.current.style["--stash-ai-height"], "730px");
  assert.match(
    css,
    /\.stash-ai-page \.stash-ai-messages\s*\{[^}]*position: relative/s,
  );
  assert.match(css, /overscroll-behavior-y: contain/);
  assert.doesNotMatch(css, /^(?:body|html)\s*\{|min-height: 32rem/m);
  ui.close();
  assert.equal(ui.handlers.size, 0);
  assert.ok(ui.observers.every((o) => o.disconnected));
});
for (const errors of [
  ["EMPTY_CHAT_EXPIRED"],
  ["REQUEST_FAILED"],
  ["CODEX_TIMEOUT"],
  ["EMPTY_CHAT_EXPIRED", "EMPTY_CHAT_EXPIRED"],
])
  test(`send recovers only a proven empty-chat expiry, once: ${errors.join(",")}`, async () => {
    const expected = [...errors];
    const ui = harness({ saved: "saved", sendErrors: [...errors] });
    await ui.settle();
    const area = () => ui.nodes().find((n) => n.type === "textarea");
    area().props.onChange({ target: { value: "Keep this draft exactly" } });
    await ui.settle();
    ui.find("Send").props.onClick();
    await ui.settle();
    await ui.settle();
    const recover = expected[0] === "EMPTY_CHAT_EXPIRED";
    const sends = ui.calls.filter((c) => c.path === "/send");
    assert.equal(sends.length, recover ? 2 : 1);
    assert.equal(
      ui.calls.filter((c) => c.path === "/new").length,
      recover ? 1 : 0,
    );
    assert.equal(sends[0].args.id, "saved");
    if (recover) assert.equal(sends[1].args.id, "new");
    for (const call of sends) {
      assert.equal(call.args.text, "Keep this draft exactly");
      assert.equal(call.args.sceneId, "647");
    }
    assert.equal(
      area().props.value,
      recover && expected.length === 1 ? "" : "Keep this draft exactly",
    );
    assert.equal(ui.stats().clients, 1);
    ui.close();
  });
test("composer grows, shrinks, reflows by width and cleans up its observer", async () => {
  const ui = harness();
  await ui.settle();
  const area = () => ui.nodes().find((n) => n.type === "textarea");
  const input = area().props.ref.current;
  assert.equal(input.style.height, "102px");
  input.scrollHeight = 240;
  area().props.onChange({ target: { value: "Long wrapped draft" } });
  await ui.settle();
  assert.equal(input.style.height, "242px");
  input.scrollHeight = 100;
  area().props.onChange({ target: { value: "" } });
  await ui.settle();
  assert.equal(input.style.height, "102px");
  assert.equal(ui.observers.length, 2);
  input.scrollHeight = 300;
  ui.observers[1].callback();
  assert.equal(
    input.style.height,
    "102px",
    "height-only notifications ignored",
  );
  input.clientWidth = 300;
  ui.observers[1].callback();
  assert.equal(input.style.height, "302px");
  ui.find("Advanced View").props.onClick();
  input.scrollHeight = 200;
  await ui.settle();
  assert.equal(input.style.height, "202px");
  assert.equal(ui.calls.filter((c) => c.path === "/send").length, 0);
  ui.close();
  assert.ok(ui.observers.every((o) => o.disconnected));
  assert.match(css, /max-height: 40vh/);
  assert.match(css, /resize: none/);
});
test("approval invalidation hides old suggestions; explicit refresh requests fresh evidence without a turn", async () => {
  const ui = harness();
  await ui.settle();
  assert.equal(
    ui.calls.find((c) => c.path === "/suggestions").args.refresh,
    false,
  );
  ui.client.onEvent({ type: "suggestions-stale" });
  await ui.settle();
  assert.match(ui.text(), /Observations have expired/);
  ui.find("Refresh suggestions").props.onClick();
  await ui.settle();
  assert.equal(
    ui.calls.filter((c) => c.path === "/suggestions").at(-1).args.refresh,
    true,
  );
  assert.equal(ui.calls.filter((c) => c.path === "/send").length, 0);
  assert.equal(ui.stats().clients, 1);
  ui.close();
});
test("first submit, stream and repeated view switching share one transport and scene context", async () => {
  const ui = harness();
  await ui.settle();
  ui.nodes()
    .find((n) => n.type === "textarea")
    .props.onChange({ target: { value: "hello" } });
  ui.render();
  ui.find("Send").props.onClick();
  await ui.settle();
  assert.ok(!ui.tree.props.className.includes("stash-ai-landing"));
  assert.equal(ui.calls.find((c) => c.path === "/send").args.sceneId, "647");
  ui.client.onEvent({
    type: "delta",
    threadId: "new",
    itemId: "a",
    text: "Stream one",
  });
  await ui.settle();
  for (let i = 0; i < 3; i++) {
    ui.find("Advanced View").props.onClick();
    await ui.settle();
    assert.ok(ui.find("Disconnect browser"));
    assert.match(ui.text(), /Stream one/);
    ui.find("Simple View").props.onClick();
    await ui.settle();
  }
  assert.equal(ui.stats().clients, 1);
  assert.equal(ui.calls.filter((c) => c.path === "/events").length, 1);
  assert.equal(ui.calls.filter((c) => c.path === "/send").length, 1);
  ui.close();
  assert.equal(ui.handlers.size, 0);
  assert.equal(ui.stats().closed, 1);
});
test("collection draft context is editable, shared across modes, sent only explicitly and removable", async () => {
  const ui = harness({
    saved: "saved",
    history: [
      {
        id: "a",
        role: "assistant",
        text: "Found scenes",
        collections: [{ id: "c" }],
      },
    ],
    proposals: [
      { id: "p", status: "pending", rows: [], expiresAt: Date.now() + 60000 },
    ],
  });
  await ui.settle();
  const context = {
    type: "selection",
    collectionId: "c",
    sceneIds: ["14", "4484"],
  };
  ui.nodes()
    .find((n) => n.props.collection)
    .props.onAsk("Inspect 14, 4484.", context);
  await ui.settle();
  assert.match(ui.text(), /Collection selection draft/);
  assert.equal(
    ui.calls.filter(
      (c) =>
        c.path === "/send" || c.path === "/decision" || c.path === "/cancel",
    ).length,
    0,
  );
  ui.find("Advanced View").props.onClick();
  await ui.settle();
  assert.match(ui.text(), /IDs: 14, 4484/);
  ui.nodes()
    .find((n) => n.type === "textarea")
    .props.onChange({ target: { value: "Compare them, read-only." } });
  await ui.settle();
  ui.find("Send").props.onClick();
  await ui.settle();
  const sent = ui.calls.find((c) => c.path === "/send");
  assert.equal(sent.args.text, "Compare them, read-only.");
  assert.deepEqual(sent.args.collectionContext, context);
  assert.doesNotMatch(ui.text(), /Collection selection draft/);
  ui.nodes()
    .find((n) => n.props.collection)
    ?.props.onAsk("Another draft", context);
  ui.close();
});
test("existing chat opens transcript; pending preview survives mode switches with exact controls", async () => {
  const p = {
    id: "p",
    status: "pending",
    rows: [{ id: "647", before: { title: "" }, after: { title: "fixture" } }],
    expiresAt: Date.now() + 60000,
  };
  const ui = harness({
    saved: "saved",
    history: [
      { id: "u", role: "user", text: "<script>approve()</script>" },
      { id: "a", role: "assistant", text: "## Heading\n\n- Item\n\n`code`" },
    ],
    proposals: [p],
  });
  await ui.settle();
  assert.ok(!ui.tree.props.className.includes("stash-ai-landing"));
  const before = ui.calls.length;
  ui.find("Advanced View").props.onClick();
  await ui.settle();
  ui.find("Simple View").props.onClick();
  await ui.settle();
  assert.equal(ui.calls.length, before);
  assert.ok(ui.find("Approve exact changes"));
  assert.ok(ui.find("Reject"));
  assert.match(ui.text(), /cancels pending previews/);
  assert.ok(!ui.nodes().some((n) => n.type === "script"));
  assert.ok(ui.nodes().some((n) => n.type === "ul"));
  assert.ok(ui.nodes().some((n) => n.type === "h4"));
  assert.match(css, /data-role="user"[\s\S]*?margin-left: auto/);
  assert.match(
    css,
    /\.stash-ai-simple \.stash-ai-message \{[\s\S]*?background: none/,
  );
  ui.close();
});
test("suggestion click safely prefills and focuses without any request; expiry prevents reuse", async () => {
  const item = {
    id: "x",
    title: "<script>read()</script>",
    description: "Scene #7",
    trigger: "Owner state",
    prompt: "Re-read scene 7",
    expiresAt: Date.now() + 60000,
  };
  const ui = harness({
    evidence: {
      items: [item],
      sources: [],
      observedAt: Date.now(),
      expiresAt: item.expiresAt,
    },
  });
  await ui.settle();
  const count = ui.calls.length;
  ui.find(item.title).props.onClick();
  await ui.settle();
  assert.equal(
    ui.nodes().find((n) => n.type === "textarea").props.value,
    item.prompt,
  );
  assert.equal(ui.calls.length, count);
  assert.equal(ui.stats().focused, 1);
  assert.ok(!ui.nodes().some((n) => n.type === "script"));
  item.expiresAt = 0;
  ui.find(item.title).props.onClick();
  await ui.settle();
  assert.match(ui.text(), /expired/);
  assert.ok(!ui.find(item.title));
  ui.close();
});
test("unavailable evidence is honest and composer remains enabled", async () => {
  const ui = harness({ suggestionError: true });
  await ui.settle();
  assert.match(ui.text(), /Suggestions are unavailable/);
  ui.nodes()
    .find((n) => n.type === "textarea")
    .props.onChange({ target: { value: "Still usable" } });
  ui.render();
  assert.equal(ui.find("Send").props.disabled, false);
  ui.close();
});
test("new chat from Advanced returns Simple without losing connection; history selection remains available", async () => {
  const ui = harness({
    saved: "saved",
    history: [{ id: "u", role: "user", text: "old" }],
  });
  await ui.settle();
  ui.find("Advanced View").props.onClick();
  await ui.settle();
  ui.find("New conversation").props.onClick();
  await ui.settle();
  assert.match(ui.tree.props.className, /stash-ai-simple stash-ai-landing/);
  ui.nodes()
    .find((n) => n.type === "select")
    .props.onChange({ target: { value: "saved" } });
  await ui.settle();
  assert.match(ui.text(), /old/);
  assert.equal(ui.stats().clients, 1);
  ui.close();
});

test("streaming does not force scrolling when the reader has scrolled up", async () => {
  const ui = harness({
    saved: "saved",
    history: [{ id: "a", role: "assistant", text: "initial" }],
  });
  await ui.settle();
  const pane = ui
    .nodes()
    .find((n) => n.props.className === "stash-ai-messages");
  Object.assign(pane.props.ref.current, {
    scrollTop: 12,
    scrollHeight: 2000,
    clientHeight: 400,
  });
  pane.props.onScroll({ currentTarget: pane.props.ref.current });
  ui.client.onEvent({
    type: "delta",
    threadId: "saved",
    itemId: "a",
    text: " updated",
  });
  await ui.settle();
  assert.equal(pane.props.ref.current.scrollTop, 12);
  ui.close();
});

test("Enter submits once; Shift+Enter remains multiline", async () => {
  const ui = harness();
  await ui.settle();
  const area = () => ui.nodes().find((n) => n.type === "textarea");
  area().props.onChange({ target: { value: "test" } });
  ui.render();
  let prevented = 0;
  const event = {
    key: "Enter",
    shiftKey: true,
    stopPropagation() {},
    preventDefault() {
      prevented++;
    },
  };
  area().props.onKeyDown(event);
  await ui.settle();
  assert.equal(ui.calls.filter((c) => c.path === "/send").length, 0);
  event.shiftKey = false;
  area().props.onKeyDown(event);
  area().props.onKeyDown(event);
  await ui.settle();
  assert.equal(ui.calls.filter((c) => c.path === "/send").length, 1);
  assert.equal(prevented, 2);
  ui.close();
});

for (const status of ["verified", "uncertain", "rejected", "cancelled"])
  test(`fixture-only terminal ${status} keeps status visible and approval disabled`, async () => {
    const p = {
      id: "p",
      status,
      rows: [{ id: "647", before: {}, after: {} }],
      expiresAt: Date.now(),
    };
    const ui = harness({ saved: "saved", proposals: [p] });
    await ui.settle();
    assert.equal(ui.find("Approve exact changes").props.disabled, true);
    assert.match(ui.text(), new RegExp(status));
    const card = ui
      .nodes()
      .find((n) => n.props.className === "stash-ai-proposal");
    assert.equal(
      card.type,
      ["rejected", "cancelled"].includes(status) ? "details" : "section",
    );
    ui.find("Advanced View").props.onClick();
    await ui.settle();
    assert.equal(
      ui.nodes().find((n) => n.props.className === "stash-ai-proposal").type,
      "section",
    );
    assert.equal(ui.calls.filter((c) => c.path === "/decision").length, 0);
    ui.close();
  });
