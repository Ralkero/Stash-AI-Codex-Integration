// Real auth/HTTP/WebSocket/service + real typed adapter, isolated GraphQL only.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { createService } from "../service/main.mjs";
import { AUDITED_PLUGINS } from "../service/tag-cleanup-adapter.mjs";
import { RECURRENCE_PROTECTED_TAGS } from "../service/tag-cleanup-policy.mjs";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
test("isolated HTTP bulk approval is authenticated, frozen, one-time, and REMOVE-only", async () => {
  const tags = [
    {
      id: "44",
      name: "Mercy",
      ignore_auto_tag: false,
      parents: [],
      aliases: [],
    },
    {
      id: "1008",
      name: "Overwatch",
      ignore_auto_tag: false,
      parents: [],
      aliases: [],
    },
  ];
  const scenes = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    updated_at: "2026-10-20T00:00:00Z",
    tags: structuredClone(tags),
    title: "fixture",
    studio: { id: "1", name: "Overwatch" },
    groups: [{ group: { id: "2", name: "Author" }, scene_index: 1 }],
    custom_fields: { safe: "unchanged" },
    performers: [],
    galleries: [],
  }));
  const writes = [],
    unexpected = [];
  const plugins = Object.entries(AUDITED_PLUGINS).map(([id, version]) => ({
    id,
    version,
    enabled: true,
    hooks: null,
  }));
  const gql = http.createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const b of req) raw += b;
      const { query: q, variables: v = {} } = JSON.parse(raw);
      let data;
      if (q.includes("bulkSceneUpdate")) {
        assert.deepEqual(Object.keys(v.input).sort(), ["ids", "tag_ids"]);
        assert.equal(v.input.ids.length, 1);
        assert.deepEqual(v.input.tag_ids, { ids: ["1008"], mode: "REMOVE" });
        const s = scenes.find((s) => s.id === v.input.ids[0]);
        assert.ok(s.tags.some((t) => t.id === "1008"));
        writes.push(s.id);
        s.tags = s.tags.filter((t) => t.id !== "1008");
        s.updated_at = "2026-10-20T00:00:01Z";
        data = { bulkSceneUpdate: [{ id: s.id }] };
      } else if (q.includes("runPluginOperation") && v.args.kind !== "tags") {
        assert.ok(
          [
            "ai_read_v1",
            "character_identity_v1",
            "preferences_get",
            "descriptor_transaction_v1",
          ].includes(v.args.mode),
        );
        data = { runPluginOperation: {} }; // Existing optional capability probes unavailable in this fixture.
      } else if (q.includes("runPluginOperation")) {
        assert.equal(v.args.mode, "character_identity_v1");
        assert.equal(v.args.kind, "tags");
        data = {
          runPluginOperation: {
            apiVersion: 1,
            owner: "scene-auto-tagger",
            ownerVersion: "0.9.24",
            authority: "explicit-character-rules-v1",
            readOnly: true,
            tagDetailSchema: 1,
            sceneTagPolicy: {
              schema: 1,
              blockedNewAssignments: RECURRENCE_PROTECTED_TAGS,
            },
            tags: v.args.tagIds.map((id) => {
              const t = tags.find((t) => t.id === id),
                { aliases, ...evidence } = t;
              return {
                id,
                status: "available",
                classification:
                  id === "44" ? "registered-character" : "unknown",
                reason: id === "44" ? "registered-character" : "unregistered",
                evidence,
              };
            }),
          },
        };
      } else if (q.includes("__type"))
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
      else if (q.includes("plugins{"))
        data = {
          version: {
            version: "v0.31.1-native-audio.12",
            hash: "navigation-lifecycle-v12",
          },
          plugins,
          configuration: { plugins: {} },
        };
      else if (q.includes("version{"))
        data = {
          version: {
            version: "v0.31.1-native-audio.12",
            hash: "navigation-lifecycle-v12",
          },
          findScenes: { count: scenes.length },
        };
      else if (q.includes("findScenes")) {
        const rows = scenes.filter((s) => Number(s.id) > v.after);
        data = {
          findScenes: { count: rows.length, scenes: rows.slice(0, 100) },
          total: { count: scenes.length },
        };
      } else if (q.includes("findStudios"))
        data = {
          findStudios: { count: 1, studios: [{ id: "1", name: "Overwatch" }] },
        };
      else if (q.includes("findGroups"))
        data = {
          findGroups: { count: 1, groups: [{ id: "2", name: "Author" }] },
        };
      else if (q.includes("findTag"))
        data = Object.fromEntries(
          Object.values(v).map((id, i) => [
            "t" + i,
            tags.find((t) => t.id === id),
          ]),
        );
      else if (q.includes("findScene"))
        data = { findScene: scenes.find((s) => s.id === v.id) };
      else {
        unexpected.push(q);
        throw Error("unexpected query");
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data }));
    } catch (e) {
      unexpected.push(e.message);
      res.end(JSON.stringify({ errors: [{ message: e.message }] }));
    }
  });
  await new Promise((r) => gql.listen(0, "127.0.0.1", r));
  const reserve = http.createServer();
  await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "stash-ai-cleanup-http-"),
  );
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
    authenticated = true;
    threads = new Set();
    async start() {}
    async create() {
      const id = randomUUID();
      this.threads.add(id);
      return { id };
    }
    async read() {
      return { thread: { turns: [] } };
    }
    close() {}
    async turn(id) {
      this.emit("notification", {
        method: "turn/started",
        params: { threadId: id, turn: { id: "turn" } },
      });
      return { turn: { id: "turn" } };
    }
  }
  const globalWrites = [];
  let globalOwner,
    globalDigest = "before";
  const app = await createService({
    stateDir: dir,
    globalAdapterFactory: () => ({
      seed: async () => ({
        owner: globalOwner,
        thread: threadId,
        sourceDigest: "fixture",
        tags: [{ id: "9", name: "Fixture franchise" }],
        confirmation: { confirmed: true, deletionApproved: false },
      }),
      environment: async () => ({ version: 1 }),
      evidence: async () => ({ owner: "checked" }),
      backup: async () => ({
        archive: "fixture-only",
        sha256: "fixture",
        createdAt: 1,
        databaseDigest: "before",
        blobManifest: {},
      }),
      blobs: async () => {},
      project: () => ({
        beforeDigest: "before",
        afterDigest: "after",
        tags: [{ id: 9, name: "Fixture franchise" }],
        counts: { tags: 1 },
        removed: { tags: [{ id: 9 }] },
        removableBlobs: [],
      }),
      digest: () => globalDigest,
      destroyExact: async (ids) => {
        globalWrites.push(ids);
        globalDigest = "after";
      },
    }),
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
  const request = async (route, body = {}, h = headers()) =>
    (
      await fetch(`http://127.0.0.1:${port}${route}`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(body),
      })
    ).json();
  let threadId;
  const call = (action, args = {}, h) =>
    request("/tag-cleanup", { threadId, action, args }, h);
  const done = async () => {
    runtime.emit("notification", {
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "turn", status: "completed", items: [] },
      },
    });
    await delay(20);
  };
  const wait = async (fn) => {
    for (let i = 0; i < 250; i++) {
      const v = await fn();
      if (v) return v;
      await delay(20);
    }
    throw Error("fixture timeout " + JSON.stringify(unexpected));
  };
  try {
    const pair = JSON.parse(
      await fs.readFile(path.join(dir, "auth.json"), "utf8"),
    );
    globalOwner = pair.principal;
    token = (await request("/pair", { code: pair.pairCode })).token;
    assert.ok(token);
    threadId = (await request("/new")).id;
    assert.ok(threadId);
    assert.equal(
      (await call("list", {}, { ...headers(), Authorization: "Bearer bad" }))
        .error,
      "AUTH_REQUIRED",
    );
    assert.ok(
      (await call("list", {}, { ...headers(), Origin: "https://evil.invalid" }))
        .error,
    );
    assert.equal(
      (
        await request("/tag-cleanup", {
          threadId: "other",
          action: "list",
          args: {},
        })
      ).error,
      "THREAD_DENIED",
    );
    await request("/send", { id: threadId, text: "fixture" });
    const audit = await runtime.dispatch({
      threadId,
      tool: "start_scene_tag_audit",
      arguments: {},
    });
    assert.ok(audit.id);
    await assert.rejects(
      runtime.dispatch({
        threadId,
        tool: "start_scene_tag_audit",
        arguments: {},
      }),
      /ONE_CLEANUP_JOB/,
    );
    await done();
    await wait(async () => {
      const l = await call("list");
      return l.audits?.[0]?.status === "complete" && l;
    });
    assert.equal(writes.length, 0);
    await request("/send", { id: threadId, text: "fixture preview" });
    const plan = await runtime.dispatch({
      threadId,
      tool: "prepare_scene_tag_cleanup",
      arguments: { auditId: audit.id, tagIds: ["1008"] },
    });
    await done();
    const prepared = await wait(async () => {
      const l = await call("list");
      return l.plans?.[0]?.status === "awaiting-approval" && l.plans[0];
    });
    assert.equal(prepared.scenes, 12);
    assert.equal(prepared.relationships, 12);
    assert.equal(writes.length, 0);
    assert.equal((await call("read", { planId: plan.id })).rows.length, 12);
    assert.equal(
      (await call("approve", { planId: plan.id, digest: "bad" })).error,
      "CLEANUP_DIGEST_MISMATCH",
    );
    assert.ok(
      (
        await call("approve", {
          planId: plan.id,
          digest: prepared.digest,
          tagIds: ["44"],
        })
      ).error,
    );
    await request("/send", { id: threadId, text: "busy fixture" });
    assert.equal(
      (await call("approve", { planId: plan.id, digest: prepared.digest }))
        .error,
      "BUSY",
    );
    await done();
    const h = headers();
    const approved = await call(
      "approve",
      { planId: plan.id, digest: prepared.digest },
      h,
    );
    assert.equal(approved.status, "running");
    assert.ok(
      (await call("approve", { planId: plan.id, digest: prepared.digest }, h))
        .error,
      "nonce replay denied",
    );
    // Pause remains available even while the model is generating a response.
    await request("/send", { id: threadId, text: "status fixture" });
    assert.equal(
      (await call("control", { planId: plan.id, action: "pause" })).status,
      "paused",
    );
    await done();
    assert.equal(
      (await call("control", { planId: plan.id, action: "resume" })).status,
      "running",
    );
    await wait(async () => {
      const l = await call("list");
      return l.plans?.[0]?.status === "completed" && l;
    });
    const repeated = await call("approve", {
      planId: plan.id,
      digest: prepared.digest,
    });
    assert.equal(repeated.status, "completed");
    assert.equal(writes.length, 12);
    assert.equal(new Set(writes).size, 12);
    assert.ok(
      scenes.every(
        (s) =>
          s.tags.length === 1 &&
          s.tags[0].id === "44" &&
          s.studio.id === "1" &&
          s.groups[0].group.id === "2" &&
          s.custom_fields.safe === "unchanged",
      ),
    );
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
        path: "/tag-cleanup",
        body: { threadId, action: "list", args: {} },
        token,
        time: Date.now(),
        nonce: randomUUID(),
      }),
    );
    assert.ok(!(await reply).error);
    ws.close();
    const globalCall = (action, args = {}, hdr) =>
      request("/global-tag-cleanup", { threadId, action, args }, hdr);
    assert.equal(
      (
        await globalCall(
          "list",
          {},
          { ...headers(), Authorization: "Bearer wrong" },
        )
      ).error,
      "AUTH_REQUIRED",
    );
    assert.ok(
      (
        await globalCall(
          "list",
          {},
          { ...headers(), Origin: "https://evil.invalid" },
        )
      ).error,
    );
    assert.equal(
      (
        await request("/global-tag-cleanup", {
          threadId: "other",
          action: "prepare",
          args: {},
        })
      ).error,
      "THREAD_DENIED",
    );
    assert.ok(
      (await globalCall("prepare", { tagIds: ["44"] })).error,
      "caller cannot select arbitrary IDs",
    );
    await request("/send", {
      id: threadId,
      text: "fixture global tool-denial check",
    });
    await assert.rejects(
      runtime.dispatch({
        threadId,
        tool: "approve_global_tag_cleanup",
        arguments: {},
      }),
    );
    await done();
    const gp = await globalCall("prepare");
    assert.ok(gp.id);
    const frozen = await wait(async () => {
      const l = await globalCall("list");
      return l.plans?.[0]?.status === "awaiting-approval" && l.plans[0];
    });
    assert.equal(globalWrites.length, 0);
    const ga = {
      planId: gp.id,
      digest: frozen.digest,
      acknowledge: "DELETE EXACT GLOBAL TAGS",
    };
    assert.equal(
      (await globalCall("approve", { ...ga, acknowledge: "yes" })).error,
      "GLOBAL_CONFIRMATION_REQUIRED",
    );
    const nonceHeaders = headers();
    assert.equal(
      (await globalCall("approve", ga, nonceHeaders)).status,
      "preflight",
    );
    assert.equal(
      (await globalCall("approve", ga, nonceHeaders)).error,
      "REPLAY_DENIED",
    );
    await wait(async () => {
      const l = await globalCall("list");
      return l.plans?.[0]?.status === "completed";
    });
    assert.deepEqual(globalWrites, [["9"]]);
    assert.equal((await globalCall("approve", ga)).status, "completed");
    assert.deepEqual(globalWrites, [["9"]]);
    assert.deepEqual(unexpected, []);
  } finally {
    await app.close();
    await new Promise((r) => gql.close(r));
  }
});
