import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createService } from "../service/main.mjs";
import { WebSocket } from "ws";
test("authenticated review preparation and confirmation: ownership, replay, old catalog and no metadata writes", async () => {
  let writes = 0;
  const gql = http.createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    const { query } = JSON.parse(raw);
    let data;
    if (query.startsWith("mutation")) {
      writes++;
      data = {};
    } else if (query.includes("__type"))
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
    else if (query === "{plugins{id version enabled}}") data = { plugins: [] };
    else
      data = {
        s0: {
          id: "4153",
          title: "fixture",
          updated_at: "now",
          tags: [],
          groups: [],
          studio: null,
          files: [],
        },
      };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data }));
  });
  await new Promise((r) => gql.listen(0, "127.0.0.1", r));
  const reservation = http.createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-ai-review-test-"));
  await fs.writeFile(
    path.join(dir, "config.json"),
    JSON.stringify({
      schema: 1,
      port,
      stashUrl: `http://127.0.0.1:${gql.address().port}/graphql`,
      origins: ["http://localhost:9999"],
      writesEnabled: false,
    }),
  );
  let runtime;
  class Fake extends EventEmitter {
    threads = new Set();
    authenticated = true;
    async start() {}
    async create() {
      const id = randomUUID();
      this.threads.add(id);
      return { id };
    }
    async turn(id) {
      this.emit("notification", {
        method: "turn/started",
        params: { threadId: id, turn: { id: "turn" } },
      });
      return { turn: { id: "turn" } };
    }
    async read() {
      return { thread: { turns: [] } };
    }
    close() {}
  }
  const app = await createService({
    stateDir: dir,
    runtimeFactory: (opts) => {
      runtime = new Fake();
      runtime.dispatch = opts.dispatch;
      return runtime;
    },
  });
  await app.ready;
  await new Promise((r) => app.server.listen(port, "127.0.0.1", r));
  let token;
  const headers = () => ({
    "Content-Type": "application/json",
    Origin: "http://localhost:9999",
    Authorization: `Bearer ${token}`,
    "X-Stash-AI-Time": String(Date.now()),
    "X-Stash-AI-Nonce": randomUUID(),
  });
  const request = async (route, body = {}, hdr = headers()) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: "POST",
      headers: hdr,
      body: JSON.stringify(body),
    });
    return res.json();
  };
  try {
    const pairing = JSON.parse(
      await fs.readFile(path.join(dir, "auth.json"), "utf8"),
    );
    token = (await request("/pair", { code: pairing.pairCode })).token;
    const { id: threadId } = await request("/new");
    assert.ok(threadId);
    const noAuth = await request(
      "/review-decisions",
      { threadId },
      { ...headers(), Authorization: "Bearer bad" },
    );
    assert.equal(noAuth.error, "AUTH_REQUIRED");
    assert.equal(
      (await request("/review-decisions", { threadId: "other" })).error,
      "THREAD_DENIED",
    );
    await request("/send", { id: threadId, text: "fixture" });
    const result = await runtime.dispatch({
      threadId,
      tool: "request_review_decision",
      arguments: {
        sceneId: "4153",
        findings: ["missing-franchise"],
        action: "no-action",
      },
    });
    assert.equal(result.status, "awaiting-ui-confirmation");
    assert.equal(result.token, undefined);
    await assert.rejects(fs.stat(path.join(dir, "review-decisions.json")), {
      code: "ENOENT",
    });
    const [r] = await request("/review-decisions", { threadId });
    assert.ok(r.token);
    assert.equal(
      (
        await request("/review-decision-confirm", {
          threadId,
          id: r.id,
          token: r.token,
          decision: "confirm",
        })
      ).error,
      "BUSY",
    );
    runtime.emit("notification", {
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "turn", status: "completed", items: [] },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const wrong = await request("/review-decision-confirm", {
      threadId,
      id: r.id,
      token: "bad",
      decision: "confirm",
    });
    assert.equal(wrong.error, "REVIEW_CONFIRMATION_DENIED");
    const nonceHeaders = headers();
    const confirmed = await request(
      "/review-decision-confirm",
      { threadId, id: r.id, token: r.token, decision: "confirm" },
      nonceHeaders,
    );
    assert.equal(confirmed.status, "acknowledged");
    assert.ok(
      (
        await request(
          "/review-decision-confirm",
          { threadId, id: r.id, token: r.token, decision: "confirm" },
          nonceHeaders,
        )
      ).error,
    );
    assert.equal(
      JSON.parse(
        await fs.readFile(path.join(dir, "review-decisions.json"), "utf8"),
      ).events.length,
      1,
    );
    // New routes use the same WebSocket origin, authentication and nonce policy.
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: "http://localhost:9999",
    });
    await new Promise((r) => ws.once("open", r));
    const reply = new Promise((r) =>
      ws.once("message", (b) => r(JSON.parse(b))),
    );
    ws.send(
      JSON.stringify({
        id: 1,
        path: "/review-decisions",
        body: { threadId },
        token,
        time: Date.now(),
        nonce: randomUUID(),
      }),
    );
    const answer = await reply;
    assert.ok(!answer.error);
    ws.close();
    assert.equal(writes, 0);
  } finally {
    await app.close();
    await new Promise((r) => gql.close(r));
  }
});
