import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { RuntimeRouter } from "../service/runtime-router.mjs";
import { Runtime } from "../service/runtime.mjs";
import {
  runtimeEnvironment,
  validateRuntimeHome,
  verifyReportedHome,
} from "../service/runtime-home.mjs";

test("the actual App Server must report the selected canonical home", async () => {
  const expected = await fs.mkdtemp(path.join(os.tmpdir(), "stash-isolated-"));
  await verifyReportedHome(expected, expected);
  await verifyReportedHome(expected, await fs.realpath(expected));
  if (process.platform === "win32")
    await verifyReportedHome(expected, expected.toUpperCase());
  for (const wrong of [undefined, "", "relative", path.dirname(expected)])
    await assert.rejects(
      verifyReportedHome(expected, wrong),
      /CODEX_HOME_MISMATCH/,
    );
});

function setup({
  conversations = [{ id: "old", toolSchema: 1 }],
  manifest,
  failure,
  idleMs = 100000,
} = {}) {
  const calls = [],
    instances = [];
  const storage =
    manifest === undefined
      ? {
          schema: 1,
          legacyHome: path.resolve("legacy-fixture"),
          legacyThreadIds: ["old"],
        }
      : manifest;
  class Fake extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.threads = new Set();
      this.authenticated = true;
      this.tools = options.tools;
      instances.push(this);
    }
    async start() {
      calls.push(["start", this.options.codexHome]);
      if (failure === "start") throw Error("START_FAILED");
    }
    async create() {
      const id = "new-" + calls.length;
      calls.push(["create", id]);
      this.threads.add(id);
      return { id };
    }
    async resume(id, toolSchema) {
      calls.push(["resume", id, this.options.codexHome, toolSchema]);
      if (failure === "missing") throw Error("THREAD_NOT_FOUND");
      if (failure === "empty-rollout")
        throw Error(
          `CODEX_REQUEST_FAILED: no rollout found for thread id ${id}`,
        );
      if (failure === "wrong") return { id: "unrelated" };
      this.threads.add(id);
      return { id };
    }
    async read(id) {
      calls.push(["read", id]);
      return { thread: { id, turns: [] } };
    }
    async turn(id) {
      calls.push(["turn", id]);
      return { turn: { id: "turn" } };
    }
    async interrupt(id) {
      this.emit("notification", {
        method: "turn/completed",
        params: { threadId: id, turn: { id: "turn", status: "interrupted" } },
      });
    }
    close() {
      calls.push(["close", this.options.codexHome]);
      this.emit("unavailable", "CLOSED");
    }
  }
  const router = new RuntimeRouter({
    store: {
      dir: path.resolve("fixture-state"),
      read: async () => storage,
      write: async () => {},
    },
    conversations,
    tools: [{ name: "bounded" }],
    dispatch: async () => ({ ok: true }),
    factory: (o) => new Fake(o),
    legacyIdleMs: idleMs,
  });
  return { router, calls, instances, conversations };
}
test("resume guidance follows saved contract without replacing tool catalog", async () => {
  const f = setup({ conversations: [{ id: "old", toolSchema: 5 }] });
  await f.router.start();
  await f.router.resume("old");
  assert.equal(f.calls.find((c) => c[0] === "resume")[3], 5);
  f.router.close();
  const runtime = new Runtime({ tools: [{ name: "get_scene_characters" }] });
  assert.doesNotMatch(
    runtime.options(5).developerInstructions,
    /In contract-6 conversations/,
  );
  assert.match(
    runtime.options(6).developerInstructions,
    /In contract-6 conversations/,
  );
  let sent;
  runtime.call = async (method, args) => {
    sent = { method, args };
    return { thread: { id: "old" } };
  };
  await runtime.resume("old", 5);
  assert.equal(sent.args.dynamicTools, undefined);
  assert.doesNotMatch(
    sent.args.developerInstructions,
    /In contract-6 conversations/,
  );
});
test("isolated home is explicit; legacy process is lazy and IDs/catalogs remain owned", async () => {
  const f = setup();
  await f.router.start();
  assert.equal(f.instances.length, 1);
  assert.equal(f.instances[0].options.isolatedHome, true);
  const t = await f.router.create();
  f.conversations.push({ id: t.id, storage: "isolated" });
  await f.router.read(t.id);
  await f.router.read("old");
  await f.router.resume("old");
  assert.equal(f.instances.length, 2);
  assert.equal(f.instances[1].options.isolatedHome, false);
  assert.deepEqual(
    f.calls.filter((c) => c[0] === "resume").map((c) => c[1]),
    ["old"],
  );
  assert.equal(f.conversations[0].toolSchema, 1);
  await assert.rejects(f.router.read("desktop-unowned"), /THREAD_DENIED/);
  assert.equal(f.instances.length, 2);
  f.router.close();
});
test("missing thread is an error, never replacement creation", async () => {
  const f = setup({ failure: "missing" });
  await f.router.start();
  await assert.rejects(f.router.resume("old"), /THREAD_NOT_FOUND/);
  assert.ok(!f.calls.some((c) => c[0] === "create"));
  f.router.close();
});
for (const row of [
  { id: "empty", storage: "isolated", title: "New conversation" },
  { id: "empty", storage: "isolated", title: "New conversation", startedAt: 1 },
  { id: "empty", storage: "isolated", title: "Renamed chat" },
  { id: "old", title: "New conversation" },
])
  test(`empty rollout recovery signal is limited to pristine isolated chats: ${JSON.stringify(row)}`, async () => {
    const f = setup({
      conversations: [row],
      manifest: {
        schema: 1,
        legacyHome: path.resolve("legacy-fixture"),
        legacyThreadIds: row.storage ? [] : ["old"],
      },
      failure: "empty-rollout",
    });
    await f.router.start();
    const recoverable =
      row.storage === "isolated" &&
      !row.startedAt &&
      row.title === "New conversation";
    await assert.rejects(f.router.resume(row.id), (e) =>
      recoverable
        ? e.message === "EMPTY_CHAT_EXPIRED"
        : e.message.startsWith("CODEX_REQUEST_FAILED:"),
    );
    assert.ok(!f.calls.some(([name]) => name === "create" || name === "turn"));
    assert.deepEqual(f.conversations, [row]);
    f.router.close();
  });
test("resume cannot substitute a different ID", async () => {
  const f = setup({ failure: "wrong" });
  await f.router.start();
  await assert.rejects(f.router.resume("old"), /THREAD_ID_MISMATCH/);
  assert.ok(!f.router.threads.has("old"));
  f.router.close();
});
test("no cutover manifest with existing history fails closed", async () => {
  const f = setup({ manifest: null });
  await assert.rejects(f.router.start(), /STORAGE_SETUP_REQUIRED/);
  assert.equal(f.instances.length, 0);
});
for (const [label, manifest, conversations] of [
  [
    "unknown origin",
    { schema: 1, legacyHome: null, legacyThreadIds: [] },
    [{ id: "old" }],
  ],
  [
    "relative legacy path",
    { schema: 1, legacyHome: "relative", legacyThreadIds: ["old"] },
    [{ id: "old" }],
  ],
  [
    "conflicting namespace",
    { schema: 1, legacyHome: path.resolve("legacy"), legacyThreadIds: ["old"] },
    [{ id: "old", storage: "isolated" }],
  ],
  [
    "unsupported storage",
    { schema: 1, legacyHome: null, legacyThreadIds: [] },
    [{ id: "old", storage: "other" }],
  ],
])
  test("rejects " + label, async () => {
    const f = setup({ manifest, conversations });
    await assert.rejects(f.router.start(), /INVALID_STORAGE_ORIGIN/);
    assert.equal(f.instances.length, 0);
  });
test("one active turn across namespaces; cross-home dynamic dispatch denied", async () => {
  const f = setup();
  await f.router.start();
  const t = await f.router.create();
  f.conversations.push({ id: t.id, storage: "isolated" });
  await f.router.turn("old", "hello");
  await assert.rejects(f.router.turn(t.id, "duplicate"), /BUSY/);
  assert.throws(
    () => f.instances[0].options.dispatch({ threadId: "old" }),
    /TOOL_DENIED/,
  );
  await f.router.interrupt("old", "turn");
  await f.router.turn(t.id, "now allowed");
  f.router.close();
});
test("legacy idle shutdown clears loaded IDs and reopens exact thread", async () => {
  const f = setup({ idleMs: 10 });
  let unavailable = 0;
  f.router.on("unavailable", () => unavailable++);
  await f.router.start();
  await f.router.read("old");
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(f.router.threads.has("old"), false);
  assert.equal(f.router.entries.size, 1);
  assert.equal(unavailable, 0);
  await f.router.read("old");
  assert.equal(f.instances.length, 3);
  f.router.close();
});
test("active legacy turns are not idled; failed startup does not retain a process", async () => {
  const f = setup({ idleMs: 10 });
  await f.router.start();
  await f.router.turn("old", "hold");
  await new Promise((r) => setTimeout(r, 35));
  assert.equal(f.router.entries.size, 2);
  f.router.close();
  const bad = setup({ failure: "start" });
  await assert.rejects(bad.router.start(), /START_FAILED/);
  assert.equal(bad.router.entries.size, 0);
  assert.ok(bad.calls.some((c) => c[0] === "close"));
});
test("empty persisted isolated thread resumes without reading a nonexistent rollout", async () => {
  const f = setup({
    conversations: [{ id: "empty", storage: "isolated" }],
    manifest: { schema: 1, legacyHome: null, legacyThreadIds: [] },
  });
  await f.router.start();
  await f.router.resume("empty");
  assert.ok(!f.calls.some((c) => c[0] === "read"));
  f.router.close();
});
test("subprocess environment overrides inherited home and excludes credential/config injection", () => {
  const parent = {
    PATH: "path",
    CODEX_HOME: "desktop",
    Codex_Home: "other",
    CODEX_SQLITE_HOME: "desktop",
    OPENAI_API_KEY: "secret",
    CODEX_ACCESS_TOKEN: "secret",
    NODE_OPTIONS: "bad",
  };
  const env = runtimeEnvironment(parent, "isolated");
  assert.deepEqual(env, { PATH: "path", CODEX_HOME: "isolated" });
  assert.equal(parent.CODEX_HOME, "desktop");
});
test("home validator rejects missing, relative, root, file and unexpected configuration", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-home-"));
  await validateRuntimeHome(dir, { isolated: true });
  assert.deepEqual(await fs.readdir(dir), []);
  await assert.rejects(
    validateRuntimeHome(path.join(dir, "missing"), { isolated: true }),
    /CODEX_HOME_UNAVAILABLE/,
  );
  await assert.rejects(validateRuntimeHome("relative"), /INVALID_CODEX_HOME/);
  await assert.rejects(
    validateRuntimeHome(path.parse(dir).root),
    /INVALID_CODEX_HOME/,
  );
  await fs.writeFile(
    path.join(dir, "config.toml"),
    "model_provider='untrusted'",
  );
  await assert.rejects(
    validateRuntimeHome(dir, { isolated: true }),
    /UNEXPECTED_CODEX_CONFIGURATION/,
  );
  await assert.rejects(
    validateRuntimeHome(path.join(dir, "config.toml")),
    /INVALID_CODEX_HOME/,
  );
});

test(
  "Windows denied directory writes and junctions fail closed",
  { skip: process.platform !== "win32" },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-home-acl-"));
    const target = path.join(dir, "target");
    await fs.mkdir(target);
    const link = path.join(dir, "redirect");
    await fs.symlink(target, link, "junction");
    await assert.rejects(
      validateRuntimeHome(link, { isolated: true }),
      /INVALID_CODEX_HOME/,
    );
    const user = execFileSync("whoami.exe", [], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    try {
      execFileSync("icacls.exe", [target, "/deny", `${user}:(WD,AD)`], {
        windowsHide: true,
        stdio: "ignore",
      });
      await assert.rejects(
        validateRuntimeHome(target, { isolated: true }),
        /CODEX_HOME_UNAVAILABLE/,
      );
    } finally {
      execFileSync("icacls.exe", [target, "/remove:d", user], {
        windowsHide: true,
        stdio: "ignore",
      });
    }
  },
);

test("history reads do not acquire writer leases; missing authentication cannot create", async () => {
  const f = setup();
  await f.router.start();
  await f.router.read("old");
  assert.ok(!f.calls.some((c) => c[0] === "resume"));
  f.instances[0].authenticated = false;
  await assert.rejects(f.router.create(), /CODEX_NOT_READY/);
  assert.ok(!f.calls.some((c) => c[0] === "create"));
  f.router.close();
});
