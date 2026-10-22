import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createService } from "../service/main.mjs";
test("authenticated route, real dispatcher and completion event bind cards to final message without changing legacy catalogs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-rich-fixture-"));
  const gql = http.createServer(async (req, res) => {
    let body = "";
    for await (const b of req) body += b;
    const { query } = JSON.parse(body);
    const data = query.includes("version{")
      ? { version: { version: "fixture" }, findScenes: { count: 1 } }
      : query.includes("plugins{")
        ? { plugins: [] }
        : query.includes("s0:findScene")
          ? {
              s0: {
                id: "1",
                title: "fixture",
                updated_at: "now",
                tags: [],
                groups: [],
                studio: null,
                files: [],
                paths: {},
              },
            }
          : {
              findScene: {
                id: "1",
                title: "fixture",
                tags: [],
                groups: [],
                studio: null,
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
  await fs.writeFile(
    path.join(dir, "conversations.json"),
    JSON.stringify([
      {
        id: "legacy",
        owner: "owner",
        title: "old",
        toolSchema: 6,
        toolNames: ["get_scene"],
        startedAt: 1,
      },
    ]),
  );
  await fs.writeFile(
    path.join(dir, "auth.json"),
    JSON.stringify({
      schema: 1,
      principal: "owner",
      pairings: [],
      pairCode: "fixture",
      pairExpires: Date.now() + 60000,
    }),
  );
  let runtime, dispatch;
  class Fake extends EventEmitter {
    threads = new Set(["legacy"]);
    authenticated = true;
    turns = [];
    submitted = [];
    async start() {}
    async create() {
      this.threads.add("thread");
      return { id: "thread" };
    }
    async read() {
      return { thread: { turns: this.turns } };
    }
    async turn(threadId, text) {
      this.submitted.push(text);
      this.emit("notification", {
        method: "turn/started",
        params: { threadId, turn: { id: "turn" } },
      });
      return { turn: { id: "turn" } };
    }
    async interrupt() {}
    close() {}
  }
  const app = await createService({
    stateDir: dir,
    runtimeFactory: (options) => {
      dispatch = options.dispatch;
      return (runtime = new Fake());
    },
  });
  await app.ready;
  await new Promise((r) => app.server.listen(port, "127.0.0.1", r));
  let token = "";
  const request = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:9999",
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "X-Stash-AI-Time": String(Date.now()),
        "X-Stash-AI-Nonce": randomUUID(),
      },
      body: JSON.stringify(body),
    });
    return response.json();
  };
  try {
    assert.equal((await request("/scene-results", {})).error, "AUTH_REQUIRED");
    token = (await request("/pair", { code: "fixture" })).token;
    await request("/send", { id: "legacy", text: "inspect" });
    const oldRead = await dispatch({
      threadId: "legacy",
      turnId: "turn",
      callId: "old",
      tool: "get_scene",
      arguments: { id: "1" },
    });
    assert.equal(oldRead.presentationSource, undefined);
    await assert.rejects(
      dispatch({
        threadId: "legacy",
        turnId: "turn",
        tool: "present_scene_results",
        arguments: {},
      }),
      /TOOL_DENIED/,
    );
    runtime.emit("notification", {
      method: "turn/completed",
      params: { threadId: "legacy", turn: { id: "turn", status: "completed" } },
    });
    await new Promise((r) => setTimeout(r, 10));
    await request("/new", {});
    await request("/send", { id: "thread", text: "inspect" });
    const read = await dispatch({
      threadId: "thread",
      turnId: "turn",
      callId: "read1",
      tool: "review_scenes",
      arguments: { sceneIds: ["1"] },
    });
    const selected = await dispatch({
      threadId: "thread",
      turnId: "turn",
      callId: "present1",
      tool: "present_scene_results",
      arguments: {
        sourceId: read.presentationSource.sourceId,
        sceneIds: ["1"],
      },
    });
    await dispatch({
      threadId: "thread",
      turnId: "turn",
      callId: "preview1",
      tool: "propose_scene_changes",
      arguments: { sceneIds: ["1"], changes: { title: "fixture preview" } },
    });
    assert.equal(
      (
        await request("/scene-results", {
          threadId: "thread",
          collectionId: selected.collectionId,
        })
      ).error,
      "PRESENTATION_DENIED",
    );
    const items = [
      { type: "agentMessage", id: "commentary", text: "Looking" },
      { type: "agentMessage", id: "final", text: "Found one" },
    ];
    runtime.turns = [{ id: "turn", status: "completed", items }];
    runtime.emit("notification", {
      method: "turn/completed",
      params: { threadId: "thread", turn: runtime.turns[0] },
    });
    for (let i = 0; i < 50; i++) {
      if (!(await request("/history", { id: "thread" })).active) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const history = await request("/history", { id: "thread" });
    assert.deepEqual(history.messages[0].collections, []);
    assert.equal(history.messages[1].collections[0].id, selected.collectionId);
    assert.equal(
      (
        await request("/scene-results", {
          threadId: "legacy",
          collectionId: selected.collectionId,
        })
      ).error,
      "PRESENTATION_DENIED",
    );
    assert.equal(
      (
        await request("/scene-results", {
          threadId: "thread",
          collectionId: selected.collectionId,
          sceneIds: ["2"],
        })
      ).error,
      "INVALID_INPUT",
    );
    const cards = await request("/scene-results", {
      threadId: "thread",
      collectionId: selected.collectionId,
    });
    assert.equal(cards.scenes[0].sceneId, "1");
    assert.equal(cards.scenes[0].characters.presence, "absent");
    assert.equal(cards.scenes[0].descriptors, null);
    assert.equal(cards.reviewSummary.inspected, 1);
    assert.equal(cards.scenes[0].review.checks[0].outcome, "still-observed");
    assert.equal(cards.searchCapabilities.criteria.author.level, "exact-native");
    assert.equal(cards.searchCapabilities.criteria.character.unknown.level, "unsupported");
    assert.equal(cards.scenes[0].operations[0].status, "pending");
    const records = JSON.parse(
      await fs.readFile(path.join(dir, "scene-presentations.json")),
    );
    assert.equal(records.collections.length, 1);
    const submittedBefore = runtime.submitted.length;
    assert.equal(
      (await request("/proposals", { id: "thread" }))[0].status,
      "pending",
    );
    for (const context of [
      {
        type: "selection",
        collectionId: selected.collectionId,
        sceneIds: ["2"],
      },
      { type: "selection", collectionId: "foreign", sceneIds: ["1"] },
      {
        type: "selection",
        collectionId: selected.collectionId,
        sceneIds: ["1"],
        approval: true,
      },
    ]) {
      assert.ok(
        (
          await request("/send", {
            id: "thread",
            text: "inspect",
            collectionContext: context,
          })
        ).error,
      );
      assert.equal(runtime.submitted.length, submittedBefore);
      assert.equal(
        (await request("/proposals", { id: "thread" }))[0].status,
        "pending",
      );
      assert.equal((await request("/history", { id: "thread" })).active, false);
    }
    await request("/send", {
      id: "thread",
      text: "commentary-only fixture",
      collectionContext: {
        type: "selection",
        collectionId: selected.collectionId,
        sceneIds: ["1"],
      },
    });
    assert.match(runtime.submitted.at(-1), /Selected member IDs: 1/);
    assert.match(runtime.submitted.at(-1), /not approval/);
    assert.equal(
      (await request("/proposals", { id: "thread" }))[0].status,
      "cancelled",
    );
    const again = await dispatch({
      threadId: "thread",
      turnId: "turn",
      callId: "read2",
      tool: "get_scene",
      arguments: { id: "1" },
    });
    await dispatch({
      threadId: "thread",
      turnId: "turn",
      callId: "present2",
      tool: "present_scene_results",
      arguments: {
        sourceId: again.presentationSource.sourceId,
        sceneIds: ["1"],
      },
    });
    const commentary = {
      type: "agentMessage",
      id: "only-commentary",
      phase: "commentary",
      text: "Working",
    };
    runtime.emit("notification", {
      method: "item/completed",
      params: { threadId: "thread", turnId: "turn", item: commentary },
    });
    runtime.emit("notification", {
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: { id: "turn", status: "completed", items: [commentary] },
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      JSON.parse(await fs.readFile(path.join(dir, "scene-presentations.json")))
        .collections.length,
      1,
    );
  } finally {
    await app.close();
    await new Promise((r) => gql.close(r));
  }
});
