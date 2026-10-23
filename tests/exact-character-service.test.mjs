import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { createService } from "../service/main.mjs";
import { hash, seal } from "../service/tag-cleanup-policy.mjs";
import { TOOLS } from "../service/tools.mjs";
test("real HTTP and browser WebSocket require authenticated review, reject replay and model approval; only fixture removes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stash-exact-http-"));
  const gql = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const q = JSON.parse(raw).query;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: q.includes("__type")
          ? {
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
            }
          : q.includes("version")
            ? { version: { version: "fixture" }, findScenes: { count: 1 } }
            : {},
      }),
    );
  });
  await new Promise((r) => gql.listen(0, "127.0.0.1", r));
  const reserve = http.createServer();
  await new Promise((r) => reserve.listen(0, "127.0.0.1", r));
  const port = reserve.address().port;
  await new Promise((r) => reserve.close(r));
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
  const tags = [
      { id: "1", name: "Fixture remove", ignore_auto_tag: false },
      { id: "2", name: "Fixture keep", ignore_auto_tag: false },
    ],
    scene = { id: "10", title: "Synthetic", tags: structuredClone(tags) },
    writes = [];
  class Runtime extends EventEmitter {
    authenticated = true;
    async start() {}
    close() {}
  }
  const app = await createService({
    stateDir: dir,
    runtimeFactory: () => new Runtime(),
    exactAdapterFactory: () => ({
      environment: async () => ({ fixture: true }),
      definitions: async (ids) =>
        ids.map((id) => tags.find((t) => t.id === id)),
      scene: async () => structuredClone(scene),
      remove: async (id, remove) => {
        assert.equal(id, "10");
        assert.deepEqual(remove, ["1"]);
        writes.push(id);
        scene.tags = scene.tags.filter((t) => !remove.includes(t.id));
      },
    }),
  });
  await app.ready;
  await new Promise((r) => app.server.listen(port, "127.0.0.1", r));
  let token;
  const headers = () => ({
    "Content-Type": "application/json",
    Origin: "http://localhost:9999",
    Authorization: "Bearer " + token,
    "X-Stash-AI-Time": String(Date.now()),
    "X-Stash-AI-Nonce": randomUUID(),
  });
  const request = async (body, h = headers(), url = "/character-cleanup") =>
    (
      await fetch(`http://127.0.0.1:${port}${url}`, {
        method: "POST",
        headers: h,
        body: JSON.stringify(body),
      })
    ).json();
  try {
    const auth = JSON.parse(await fs.readFile(path.join(dir, "auth.json")));
    token = (await request({ code: auth.pairCode }, headers(), "/pair")).token;
    assert(token);
    assert.equal(
      (
        await request(
          { action: "list" },
          { ...headers(), Authorization: "Bearer wrong" },
        )
      ).error,
      "AUTH_REQUIRED",
    );
    assert.equal(
      (
        await request(
          { action: "list" },
          { ...headers(), Origin: "https://evil.invalid" },
        )
      ).error,
      "ORIGIN_DENIED",
    );
    const fp = hash(scene),
      source = {
        schema: 1,
        type: "exact-character-tag-removal",
        owner: auth.principal,
        reference: "synthetic",
        sourceHash: "a".repeat(64),
        reviewedAt: 1,
        rows: [
          {
            sceneId: "10",
            before: ["1", "2"],
            remove: ["1"],
            after: ["2"],
            observedState: structuredClone(scene),
            beforeFingerprint: fp,
            evidence: [
              {
                sceneId: "10",
                sourceId: "1",
                decisionId: "fixture",
                status: "supported",
                action: "remove",
                removalEstablished: true,
                beforeFingerprint: fp,
                evidence: [{ kind: "user-decision" }],
              },
            ],
            excluded: [],
          },
        ],
        excluded: [],
        historical: { scenes: 1, relationships: 1 },
      };
    const key = JSON.parse(
      await fs.readFile(path.join(dir, "exact-character-key.json")),
    );
    await fs.writeFile(
      path.join(dir, "exact-character-source.json"),
      JSON.stringify({ value: source, mac: seal(key.key, source) }),
    );
    assert.equal(
      (await request({ action: "prepare", args: { manifest: source } })).error,
      "INVALID_INPUT",
    );
    const p = await request({ action: "prepare" });
    assert.equal(p.state, "awaiting-approval");
    assert.equal(writes.length, 0);
    assert.equal(
      (await request({ action: "apply", args: { planId: p.id } })).error,
      "OPERATION_DENIED",
    );
    assert.equal(
      (
        await request({
          action: "approve",
          args: {
            planId: p.id,
            digest: p.digest,
            challenge: "forged",
            acknowledged: true,
          },
        })
      ).error,
      "EXACT_REVIEW_REQUIRED",
    );
    async function browserRequest(
      body,
      h = headers(),
      route = "/character-cleanup",
    ) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
          origin: "http://localhost:9999",
        });
        const timer = setTimeout(() => {
          ws.terminate();
          reject(Error("WS_TIMEOUT"));
        }, 5000);
        ws.once("error", reject);
        ws.once("open", () =>
          ws.send(
            JSON.stringify({
              id: 1,
              path: route,
              body,
              token,
              time: h["X-Stash-AI-Time"] || h["x-stash-ai-time"],
              nonce: h["X-Stash-AI-Nonce"] || h["x-stash-ai-nonce"],
            }),
          ),
        );
        ws.once("message", (raw) => {
          clearTimeout(timer);
          ws.close();
          resolve(JSON.parse(raw).data);
        });
      });
    }
    assert.equal((await browserRequest({ action: "list" })).plans[0].id, p.id);
    assert.equal(
      (
        await browserRequest(
          { action: "list" },
          headers(),
          "/arbitrary-mutation",
        )
      ).error,
      "REQUEST_DENIED",
    );
    const d = await browserRequest({ action: "read", args: { planId: p.id } });
    assert(d.challenge);
    assert.equal(d.manifest.entries.length, 1);
    const h = headers(),
      body = {
        action: "approve",
        args: {
          planId: p.id,
          digest: p.digest,
          challenge: d.challenge,
          acknowledged: true,
        },
      };
    assert.equal((await browserRequest(body, h)).state, "approved");
    assert.equal((await request(body, h)).error, "REPLAY_DENIED");
    assert.equal((await request(body)).error, "EXACT_APPROVAL_REPLAY");
    for (let i = 0; i < 50 && !writes.length; i++)
      await new Promise((r) => setTimeout(r, 20));
    const state = await request({ action: "list" });
    assert.equal(state.plans[0].state, "completed");
    assert.deepEqual(writes, ["10"]);
    assert.deepEqual(
      scene.tags.map((t) => t.id),
      ["2"],
    );
    assert(!JSON.stringify(TOOLS).includes("character_cleanup"));
    assert(!JSON.stringify(TOOLS).includes("exact-character"));
    assert.equal(
      (
        await request({
          action: "read",
          args: { planId: p.id, manifest: { approved: true } },
        })
      ).error,
      "INVALID_INPUT",
    );
  } finally {
    await app.close();
    await new Promise((r) => gql.close(r));
  }
});
