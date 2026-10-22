import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { Auth } from "../service/auth.mjs";
import { attachWebSocket } from "../service/websocket.mjs";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import fs from "node:fs/promises";
class Store {
  async read(_k, v) {
    return structuredClone(v);
  }
  async write() {}
}
test("invalid WebSocket messages cannot release another request's concurrency slot", async () => {
  const server = http.createServer(),
    pending = [];
  let calls = 0;
  const close = attachWebSocket(
    server,
    async (_req, res) => {
      calls++;
      await new Promise((r) => pending.push(r));
      res.end("{}");
    },
    { checkOrigin: () => {} },
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  try {
    for (let id = 1; id <= 6; id++)
      ws.send(JSON.stringify({ id, path: "/status" }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(calls, 6);
    const response = () => new Promise((r) => ws.once("message", r));
    let reply = response();
    ws.send(JSON.stringify({ id: 7, path: "/forbidden" }));
    await reply;
    reply = response();
    ws.send(JSON.stringify({ id: 8, path: "/status" }));
    await Promise.race([reply, new Promise((r) => setTimeout(r, 30))]);
    assert.equal(calls, 6);
  } finally {
    for (const done of pending) done();
    close();
    await new Promise((r) => server.close(r));
  }
});
test("WebSocket rejects foreign origins and unauthenticated/replayed operations; forwards authenticated events", async () => {
  let auth;
  const server = http.createServer();
  const requests = [];
  const handle = async (req, res) => {
    try {
      auth.checkOrigin(req);
      auth.authorize(req);
      let body = "";
      for await (const c of req) body += c;
      requests.push(JSON.parse(body));
      if (req.url === "/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"type":"delta","text":"streamed"}\n\n');
      } else {
        res.writeHead(200);
        res.end('{"ok":true}');
      }
    } catch {
      res.writeHead(401);
      res.end('{"error":"AUTH_REQUIRED"}');
    }
  };
  const close = attachWebSocket(server, handle, {
    checkOrigin: (r) => auth.checkOrigin(r),
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  auth = new Auth(new Store(), ["http://localhost:9999"], port);
  await auth.init();
  const { token } = await auth.pair(
    auth.state.pairCode,
    "http://localhost:9999",
  );
  const connect = (origin) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  try {
    await assert.rejects(connect("https://evil.example"), /403/);
    const ws = await connect("http://localhost:9999");
    const next = () =>
      new Promise((r) => ws.once("message", (b) => r(JSON.parse(b))));
    let p = next();
    ws.send(
      JSON.stringify({
        id: 1,
        path: "/status",
        body: {},
        time: Date.now(),
        nonce: randomUUID(),
      }),
    );
    assert.equal((await p).status, 401);
    const payload = {
      id: 2,
      path: "/status",
      body: {},
      token,
      time: Date.now(),
      nonce: randomUUID(),
    };
    p = next();
    ws.send(JSON.stringify(payload));
    assert.equal((await p).data.ok, true);
    p = next();
    ws.send(JSON.stringify({ ...payload, id: 3 }));
    assert.equal((await p).status, 401);
    p = next();
    ws.send(
      JSON.stringify({
        ...payload,
        id: 4,
        path: "/graphql",
        nonce: randomUUID(),
      }),
    );
    assert.equal((await p).status, 400);
    const events = [];
    ws.on("message", (b) => events.push(JSON.parse(b)));
    p = next();
    ws.send(
      JSON.stringify({
        ...payload,
        id: 5,
        path: "/events",
        nonce: randomUUID(),
      }),
    );
    await p;
    await new Promise((r) => setImmediate(r));
    assert.ok(events.some((e) => e.event?.text === "streamed"));
    assert.equal(requests.length, 2);
    ws.close();
  } finally {
    close();
    await new Promise((r) => server.close(r));
  }
});
test("plugin registration is idempotent, scoped, and never renders HTML", async () => {
  const source = await fs.readFile(
    new URL("../plugin/stash-ai.js", import.meta.url),
    "utf8",
  );
  let routes = 0,
    patches = 0,
    registered = 0;
  const w = {
    PluginApi: {
      React: { createElement: () => ({}) },
      register: { route: () => routes++ },
      patch: { before: () => patches++ },
    },
    StashCustom: {
      apiVersion: 1,
      capabilities: { register: () => registered++ },
    },
  };
  const context = vm.createContext({
    window: w,
    document: { querySelector: () => null },
    URLSearchParams,
  });
  vm.runInContext(source, context);
  vm.runInContext(source, context);
  assert.equal(routes, 1);
  assert.equal(patches, 1);
  assert.equal(registered, 1);
  assert.ok(!source.includes("dangerouslySetInnerHTML"));
  assert.ok(!source.includes("innerHTML"));
  assert.ok(!source.includes("addEventListener('keydown"));
});
test("page-cache lifecycle releases transport, requests reconnect, and removes handlers", async () => {
  const source = await fs.readFile(
    new URL("../plugin/stash-ai.js", import.meta.url),
    "utf8",
  );
  const handlers = new Map(),
    effects = [],
    elements = [],
    updates = [];
  let Page,
    closed = 0;
  const window = {
    PluginApi: {
      React: {
        createElement: (type, props) => {
          const element = { type, props };
          elements.push(element);
          return element;
        },
        useState: (value) => [
          typeof value === "function" ? value() : value,
          (v) => updates.push(v),
        ],
        useRef: (value) => ({ current: value }),
        useCallback: (fn) => fn,
        useLayoutEffect: () => {},
        useEffect: (fn) => effects.push(fn),
      },
      register: {
        route: (_route, page) => {
          Page = page;
        },
      },
      patch: { before: () => {} },
    },
    StashCustom: { apiVersion: 1, capabilities: { register: () => {} } },
    StashAITransport: class {
      call() {
        return new Promise(() => {});
      }
      close() {
        closed++;
      }
    },
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name, fn) => {
      if (handlers.get(name) === fn) handlers.delete(name);
    },
  };
  vm.runInNewContext(source, {
    window,
    document: { querySelector: () => null },
    localStorage: {
      getItem: (key) => (key.includes("pairing") ? "test-token" : ""),
    },
    location: { hostname: "localhost", protocol: "http:", search: "" },
    URLSearchParams,
    AbortController,
  });
  Page();
  let cleanup;
  for (const effect of effects) {
    const dispose = effect();
    if (handlers.has("pagehide")) {
      cleanup = dispose;
      break;
    }
  }
  assert.equal(handlers.size, 2);
  handlers.get("pageshow")({ persisted: false });
  assert.equal(updates.length, 0);
  handlers.get("pagehide")();
  assert.equal(closed, 1);
  handlers.get("pageshow")({ persisted: true });
  assert.equal(updates[1](0), 1);
  cleanup();
  assert.equal(handlers.size, 0);
  // Controlled inputs may restore their DOM value before the async action runs.
  updates.length = 0;
  const event = { target: { value: "selected-thread" } };
  elements.find((e) => e.type === "select").props.onChange(event);
  event.target.value = "previous-thread";
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(updates.includes("selected-thread"));
  assert.ok(!updates.includes("previous-thread"));
});

test("transport rejects pending requests and closes connection on page unmount", async () => {
  const source = await fs.readFile(
    new URL("../plugin/transport.js", import.meta.url),
    "utf8",
  );
  class WS {
    constructor() {
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen();
      });
    }
    send() {}
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  const window = {};
  vm.runInNewContext(source, {
    window,
    WebSocket: WS,
    crypto: { randomUUID },
    DOMException,
    Date,
    JSON,
    Map,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
  });
  const t = new window.StashAITransport("token");
  const pending = t.call("/status");
  await new Promise((r) => setImmediate(r));
  t.close();
  await assert.rejects(pending);
  assert.equal(t.pending.size, 0);
  assert.equal(t.ws.readyState, 3);
});
test("Markdown is text-safe and links only to numeric local scenes", async () => {
  const source = await fs.readFile(
      new URL("../plugin/message.js", import.meta.url),
      "utf8",
    ),
    window = {};
  vm.runInNewContext(source, { window });
  const h = (type, props, ...children) => ({ type, props, children });
  const result = window.StashAIMessage(
    h,
    "**Safe** <script>alert(1)</script> [bad](https://evil.example) [Scene 1](/scenes/1) `code`",
    "/",
  );
  const types = [];
  function walk(x) {
    if (x && typeof x === "object") {
      if (x.type) types.push(x.type);
      if (x.type === "a") assert.equal(x.props.href, "/scenes/1");
      (x.children || x).forEach?.(walk);
    }
  }
  walk(result);
  assert.ok(types.includes("strong"));
  assert.ok(types.includes("a"));
  assert.ok(!types.includes("script"));
  assert.ok(!types.includes("img"));
  assert.match(JSON.stringify(result), /https:\/\/evil.example/);
});
test("closed socket cannot silently reopen without event subscription", async () => {
  const source = await fs.readFile(
      new URL("../plugin/transport.js", import.meta.url),
      "utf8",
    ),
    window = {};
  let created = 0;
  class WS {
    constructor() {
      created++;
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen();
      });
    }
    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  vm.runInNewContext(source, {
    window,
    WebSocket: WS,
    setTimeout,
    clearTimeout,
    Error,
    Map,
    Promise,
  });
  const t = new window.StashAITransport("fixture");
  await t.open();
  t.ws.close();
  await assert.rejects(t.open(), /Retry connection/);
  assert.equal(created, 1);
  t.close();
});
test("relationship preview preserves long untrusted names as text and shows exact indexes", async () => {
  const source = await fs.readFile(
    new URL("../plugin/stash-ai.js", import.meta.url),
    "utf8",
  );
  const name = "Long name ".repeat(40) + "<script>approve()</script>",
    entity = { id: "32", name };
  let Page,
    index = 0;
  const proposal = {
    id: "fixture",
    descriptorPreview: {
      current: [],
      proposed: [{ id: "endings:Loop", name, category: "endings" }],
      added: [{ id: "endings:Loop", name, category: "endings" }],
      removed: [],
      unchanged: [],
      operationCount: 1,
    },
    rows: [
      {
        id: "1",
        label: "",
        outcome: "eligible",
        conflicts: [],
        before: { groups: [] },
        after: { groups: [{ group_id: "32", scene_index: null }] },
        diffs: [
          {
            relationship: "groups",
            action: "add",
            before: [],
            after: [entity],
            added: [entity],
            removed: [],
            unchanged: [],
            associationAfter: [{ group_id: "32", scene_index: null }],
          },
        ],
      },
    ],
    status: "pending",
    scope: "fixture",
    expiresAt: Date.now() + 10000,
  };
  const states = [
    "token",
    "",
    "thread",
    [],
    [],
    [proposal],
    [],
    0,
    2,
    "",
    null,
    { writesEnabled: true },
    "Ready",
    false,
    "",
    0,
  ];
  const h = (type, props, ...children) => ({ type, props, children });
  const window = {
    PluginApi: {
      React: {
        createElement: h,
        useState: () => [states[index++], () => {}],
        useRef: (v) => ({ current: v }),
        useCallback: (f) => f,
        useLayoutEffect: () => {},
        useEffect: () => {},
      },
      register: {
        route: (_r, p) => {
          Page = p;
        },
      },
      patch: { before: () => {} },
    },
    StashCustom: { apiVersion: 1, capabilities: { register: () => {} } },
  };
  vm.runInNewContext(source, {
    window,
    document: { querySelector: () => null },
    location: { search: "" },
    URLSearchParams,
  });
  const tree = Page(),
    text = JSON.stringify(tree);
  assert.ok(text.includes(name));
  assert.match(text, /32: unset/);
  assert.match(text, /unchanged/);
  assert.match(text, /Descriptor assignments/);
  assert.match(text, /Review status, source and learning: unchanged/);
  assert.match(text, /endings:Loop/);
  assert.ok(!text.includes('"type":"script"'));
});
