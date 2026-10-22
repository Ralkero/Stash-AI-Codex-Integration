import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createService } from "../service/main.mjs";
import { WebSocket } from "ws";
import { createRequire } from "node:module";
const descriptorOwner = createRequire(import.meta.url)(
  "../integration/0.4.0/descriptor-owner-fixture.cjs",
);
test("complete HTTP approval flow against isolated GraphQL fixture; never production Stash", async () => {
  const scene = {
    id: "1",
    title: "Original fixture",
    details: "Keep",
    rating100: 50,
    tags: [],
    updated_at: "before",
    custom_fields: { variant_role: "keep" },
    play_count: 9,
    files: [{ path: "C:/Rule34/fixture.mp4" }],
  };
  const inputs = [];
  let holdWrite = null,
    writeStarted = null;
  const gql = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const { query, variables } = JSON.parse(body);
    let data;
    if (query.includes("__type"))
      data = {
        __type: {
          inputFields: [
            "id",
            "title",
            "details",
            "rating100",
            "tag_ids",
            "studio_id",
            "groups",
          ].map((name) => ({ name })),
        },
      };
    else if (query.includes("version{"))
      data = {
        version: { version: "fixture", hash: "fixture" },
        findScenes: { count: 1 },
      };
    else if (query === "{plugins{id version enabled}}")
      data = {
        plugins: [
          { id: "scene-auto-tagger", version: "0.9.20", enabled: true },
        ],
      };
    else if (query.includes("runPluginOperation")) {
      try {
        data = {
          runPluginOperation: descriptorOwner.run(variables.args, {
            gql: {
              Do(q, v) {
                if (q.startsWith("mutation")) {
                  inputs.push(v.input);
                  Object.assign(
                    scene.custom_fields,
                    v.input.custom_fields.partial || {},
                  );
                  for (const k of v.input.custom_fields.remove || [])
                    delete scene.custom_fields[k];
                  scene.updated_at = "descriptor-after";
                  return { sceneUpdate: { id: scene.id } };
                }
                return { findScene: structuredClone(scene) };
              },
            },
          }),
        };
      } catch (e) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ errors: [{ message: e.message }] }));
        return;
      }
    } else if (query.startsWith("mutation")) {
      assert.ok(query.includes("sceneUpdate"));
      inputs.push(variables.input);
      writeStarted?.();
      if (holdWrite) await holdWrite;
      Object.assign(scene, variables.input, { updated_at: "after" });
      data = { sceneUpdate: scene };
    } else data = { findScene: scene };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data }));
  });
  await new Promise((r) => gql.listen(0, "127.0.0.1", r));
  const reservation = http.createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-ai-fixture-"));
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({
      schema: 1,
      port,
      stashUrl: `http://127.0.0.1:${gql.address().port}/graphql`,
      origins: ["http://localhost:9999"],
      writesEnabled: true,
    }),
  );
  let runtime;
  class Fake extends EventEmitter {
    threads = new Set();
    authenticated = true;
    async start() {}
    async create() {
      this.threads.add("fixture-thread");
      return { id: "fixture-thread" };
    }
    async resume() {
      throw Error("not needed");
    }
    async read() {
      return {
        thread: {
          turns: [
            { id: "interrupted-turn", status: "interrupted", items: [] },
            { id: "failed-turn", status: "failed", items: [] },
            { id: "completed-turn", status: "completed", items: [] },
          ],
        },
      };
    }
    async turn(id) {
      this.emit("notification", {
        method: "turn/started",
        params: { threadId: id, turn: { id: "turn1" } },
      });
      return { turn: { id: "turn1" } };
    }
    close() {}
  }
  const app = await createService({
    stateDir: dir,
    runtimeFactory: (options) => {
      runtime = new Fake();
      runtime.dispatch = options.dispatch;
      return runtime;
    },
  });
  await app.ready;
  await new Promise((r) => app.server.listen(port, "127.0.0.1", r));
  const origin = "http://localhost:9999";
  let token;
  const request = async (endpoint, body = {}, extra = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        "X-Stash-AI-Time": String(Date.now()),
        "X-Stash-AI-Nonce": randomUUID(),
        ...extra,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    assert.equal((await request("/status")).status, 401);
    assert.equal((await request("/suggestions")).status, 401);
    assert.equal(
      (await request("/status", {}, { Origin: "https://evil.example" })).status,
      400,
    );
    const auth = JSON.parse(
      await fs.readFile(path.join(dir, "auth.json"), "utf8"),
    );
    token = (await request("/pair", { code: auth.pairCode })).data.token;
    assert.ok(token);
    assert.equal((await request("/status")).data.writesEnabled, true);
    assert.equal(
      (await request("/suggestions", { query: "mutation" })).status,
      400,
    );
    const suggestions = await request("/suggestions");
    assert.equal(suggestions.status, 200);
    assert.ok(Array.isArray(suggestions.data.items));
    assert.equal(inputs.length, 0);
    const thread = (await request("/new")).data.id;
    assert.deepEqual(
      (await request("/history", { id: thread })).data.messages,
      [],
    );
    await request("/send", { id: thread, text: "Prepare a title edit" });
    // New read tools share the existing bounded owner-read budget. A failing
    // metric provider is represented as unavailable, never a mutation fallback.
    for (let i = 0; i < 12; i++) {
      const health = await runtime.dispatch({
        threadId: thread,
        tool: "get_library_health_snapshot",
        arguments: {},
      });
      assert.equal(health.status, "failed");
    }
    await assert.rejects(
      runtime.dispatch({
        threadId: thread,
        tool: "find_library_attention_items",
        arguments: {},
      }),
      /TOOL_DENIED/,
    );
    assert.equal(inputs.length, 0);
    const history = (await request("/history", { id: thread })).data;
    assert.equal(history.messages.length, 2);
    assert.match(history.messages[0].text, /Request interrupted/);
    assert.match(history.messages[1].text, /Request failed/);
    assert.match(history.messages[0].text, /not a confirmation/);
    const p = await runtime.dispatch({
      threadId: thread,
      tool: "propose_scene_changes",
      arguments: { sceneIds: ["1"], changes: { title: "Approved fixture" } },
    });
    assert.equal(inputs.length, 0);
    await assert.rejects(
      runtime.dispatch({
        threadId: thread,
        tool: "propose_scene_changes",
        arguments: { sceneIds: ["1"], changes: { title: "second batch" } },
      }),
      /ONE_PROPOSAL_PER_TURN/,
    );
    const preview = (await request("/proposals", { id: thread })).data[0];
    assert.equal(preview.rows[0].before.title, "Original fixture");
    assert.equal(
      (
        await request("/decision", {
          threadId: thread,
          id: p.id,
          integrity: "forged",
          decision: "approve",
        })
      ).status,
      400,
    );
    assert.equal(inputs.length, 0);
    const decision = {
      threadId: thread,
      id: p.id,
      integrity: preview.integrity,
      decision: "approve",
    };
    assert.equal(
      (await request("/decision", decision)).data.status,
      "verified",
    );
    assert.equal(
      (await request("/decision", decision)).data.status,
      "verified",
    );
    assert.equal(inputs.length, 1);
    assert.deepEqual(inputs[0], { id: "1", title: "Approved fixture" });
    assert.equal(scene.details, "Keep");
    assert.equal(scene.play_count, 9);
    assert.equal(scene.custom_fields.variant_role, "keep");
    const audit = JSON.parse(
      await fs.readFile(path.join(dir, "proposals.json"), "utf8"),
    );
    assert.equal(audit[0].results[0].status, "verified");
    assert.equal(audit[0].rows[0].before.title, "Original fixture");
    // Real socket disconnects against the isolated GraphQL fixture only.
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin });
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      return ws;
    };
    runtime.emit("notification", {
      method: "turn/completed",
      params: { threadId: thread, turn: { id: "turn1", status: "completed" } },
    });
    await request("/send", {
      id: thread,
      text: "Separately request another bounded preview",
    });
    const p2 = await runtime.dispatch({
      threadId: thread,
      tool: "propose_scene_changes",
      arguments: { sceneIds: ["1"], changes: { title: "Socket fixture" } },
    });
    let socket = await connect();
    const closed = new Promise((r) => socket.once("close", r));
    socket.close();
    await closed;
    assert.equal(inputs.length, 1);
    const pending = (await request("/proposals", { id: thread })).data.find(
      (p) => p.id === p2.id,
    );
    assert.equal(pending.status, "pending");
    let releaseWrite;
    holdWrite = new Promise((r) => {
      releaseWrite = r;
    });
    const started = new Promise((r) => {
      writeStarted = r;
    });
    socket = await connect();
    const decision2 = {
      threadId: thread,
      id: p2.id,
      integrity: pending.integrity,
      decision: "approve",
    };
    socket.send(
      JSON.stringify({
        id: 1,
        path: "/decision",
        body: decision2,
        token,
        time: Date.now(),
        nonce: randomUUID(),
      }),
    );
    await started;
    const lost = new Promise((r) => socket.once("close", r));
    socket.close();
    await lost;
    releaseWrite();
    // Reconnected replay joins serialized processing, never repeats the write.
    assert.equal(
      (await request("/decision", decision2)).data.status,
      "verified",
    );
    assert.equal(inputs.length, 2);
    assert.equal(
      (await request("/proposals", { id: thread })).data.find(
        (p) => p.id === p2.id,
      ).status,
      "verified",
    );
    assert.equal(
      (await request("/graphql", { query: "mutation{sceneDestroy}" })).status,
      400,
    );
    assert.equal(
      (await request("/history", { id: "some-other-user-thread" })).status,
      400,
    );
    runtime.emit("notification", {
      method: "turn/completed",
      params: { threadId: thread, turn: { id: "turn1", status: "completed" } },
    });
    await request("/send", {
      id: thread,
      text: "Prepare descriptor fixture, never production",
    });
    const resolution = await runtime.dispatch({
      threadId: thread,
      tool: "resolve_descriptors",
      arguments: { sceneId: "1", query: "Loop" },
    });
    assert.equal(resolution.exact[0].id, "endings:Loop");
    const d = await runtime.dispatch({
      threadId: thread,
      tool: "preview_descriptor_update",
      arguments: { sceneId: "1", add: ["endings:Loop"], remove: [] },
    });
    await assert.rejects(
      runtime.dispatch({
        threadId: thread,
        tool: "propose_scene_changes",
        arguments: { sceneIds: ["1"], changes: { title: "smuggled" } },
      }),
      /ONE_PROPOSAL_PER_TURN/,
    );
    assert.equal(inputs.length, 2);
    const dp = (await request("/proposals", { id: thread })).data.find(
      (p) => p.id === d.id,
    );
    const da = {
      threadId: thread,
      id: d.id,
      integrity: dp.integrity,
      decision: "approve",
    };
    assert.equal(
      (await request("/decision", { ...da, integrity: "forged" })).status,
      400,
    );
    assert.equal((await request("/decision", da)).data.status, "verified");
    assert.equal((await request("/decision", da)).data.status, "verified");
    assert.equal(inputs.length, 3);
    assert.equal(scene.custom_fields.variant_role, "keep");
    runtime.emit("notification", {
      method: "turn/completed",
      params: { threadId: thread, turn: { id: "turn1", status: "completed" } },
    });
    await request("/send", {
      id: thread,
      text: "Invalid descriptor attempt also consumes the one-preview budget",
    });
    await assert.rejects(
      runtime.dispatch({
        threadId: thread,
        tool: "preview_descriptor_update",
        arguments: { sceneId: "1", add: ["22"], remove: [] },
      }),
    );
    await assert.rejects(
      runtime.dispatch({
        threadId: thread,
        tool: "propose_scene_changes",
        arguments: { sceneIds: ["1"], changes: { title: "second" } },
      }),
      /ONE_PROPOSAL_PER_TURN/,
    );
    assert.equal(inputs.length, 3);
  } finally {
    await app.close();
    await new Promise((r) => gql.close(r));
  }
});
