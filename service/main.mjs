import http from "node:http";
import path from "node:path";
import os from "node:os";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Store } from "./store.mjs";
import { Stash } from "./stash.mjs";
import { Auth } from "./auth.mjs";
import { TESTED_RUNTIME } from "./runtime.mjs";
import { RuntimeRouter } from "./runtime-router.mjs";
import { Proposals } from "./proposals.mjs";
import { TOOLS, dispatchTool, toolsFor, TOOL_SCHEMA } from "./tools.mjs";
import { PluginAdapters } from "./plugin-adapters.mjs";
import { Suggestions } from "./suggestions.mjs";
import { LibraryInsights } from "./library-insights.mjs";
import { DescriptorTransactions } from "./descriptor-transactions.mjs";
import { Presentations } from "./presentations.mjs";
import { hydrateScenes } from "./scene-cards.mjs";
import { ReviewDecisions } from "./review-decisions.mjs";
import { TagCleanup } from "./tag-cleanup.mjs";
import { TagCleanupAdapter } from "./tag-cleanup-adapter.mjs";
import { GlobalTagCleanup } from "./global-tag-cleanup.mjs";
import { GlobalTagAdapter } from "./global-tag-adapter.mjs";
import { ExactCharacterCleanup } from "./exact-character-cleanup.mjs";
import { ExactCharacterAdapter } from "./exact-character-adapter.mjs";
import { recommendations } from "./recommendation-policy.mjs";
import {
  reviewFeedback,
  reviewSummary,
  operationFeedback,
  REVIEW_LIMITATIONS,
} from "./review-policy.mjs";
import { searchCapabilities } from "./search-capabilities.mjs";
import { object, string, check } from "./validation.mjs";
import { attachWebSocket } from "./websocket.mjs";
import { acquireInstance } from "./instance.mjs";
export const VERSION = "0.12.0";
export async function createService({
  stateDir = path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    "StashAICommandCenter",
  ),
  runtimeFactory = (options) => new RuntimeRouter(options),
  globalAdapterFactory = (options) => new GlobalTagAdapter(options),
  exactAdapterFactory = (stash) => new ExactCharacterAdapter(stash),
} = {}) {
  const store = new Store(stateDir);
  await store.init();
  const controlSecret = randomBytes(32).toString("base64url");
  await store.write("control.json", {
    schema: 1,
    token: controlSecret,
    pid: process.pid,
  });
  const config = await store.read("config.json", {
    schema: 1,
    port: 9998,
    stashUrl: "http://localhost:9999/graphql",
    origins: ["http://localhost:9999", "http://127.0.0.1:9999"],
    writesEnabled: false,
  });
  object(config, [
    "schema",
    "port",
    "stashUrl",
    "origins",
    "writesEnabled",
    "stashApiKey",
    "codexExe",
  ]);
  check(
    config.schema === 1 &&
      Number.isInteger(config.port) &&
      config.port >= 1024 &&
      config.port <= 65535,
    "INVALID_CONFIG",
  );
  check(
    Array.isArray(config.origins) &&
      config.origins.length > 0 &&
      config.origins.every((o) => {
        const u = new URL(o);
        return (
          ["localhost", "127.0.0.1"].includes(u.hostname) &&
          u.origin === o &&
          ["http:", "https:"].includes(u.protocol)
        );
      }),
    "INVALID_ORIGINS",
  );
  await store.write("config.json", config);
  const auth = new Auth(store, config.origins, config.port);
  await auth.init();
  const stash = new Stash({
    url: config.stashUrl,
    apiKey: config.stashApiKey || "",
  });
  // Starts closed. Open only after the pinned runtime and Stash schema pass.
  const descriptors = new DescriptorTransactions(stash);
  const proposals = new Proposals({
    stash,
    store,
    descriptors,
    writesEnabled: false,
  });
  const adapters = new PluginAdapters(stash);
  const insights = new LibraryInsights(stash, adapters);
  const characterInsights = new LibraryInsights(stash, adapters, {
    characterIdentity: true,
  });
  const suggestions = new Suggestions(stash, adapters, {
    insights: characterInsights,
  });
  await proposals.init();
  const presentations = new Presentations(store);
  await presentations.init();
  const reviewDecisions = new ReviewDecisions(store, async (sceneId) => {
    const data = await hydrateScenes(stash, adapters, {
      sourceTool: "review_scenes",
      scenes: [{ sceneId, findings: [] }],
    });
    return data.scenes[0];
  });
  await reviewDecisions.init();
  const cardReads = new Map();
  let conversations = await store.read("conversations.json", []),
    runtimeState = "connecting",
    stashReachable = false,
    lastError = null;
  const active = new Map(),
    subscribers = new Map();
  let cleanupApprovalPending = false;
  let indexQueue = Promise.resolve();
  const saveIndex = () => {
    indexQueue = indexQueue.then(() =>
      store.write("conversations.json", conversations),
    );
    return indexQueue;
  };
  const owned = (owner, id) => {
    const c = conversations.find((c) => c.id === id && c.owner === owner);
    check(c, "THREAD_DENIED");
    return c;
  };
  const emit = (owner, event) => {
    for (const res of subscribers.get(owner) || [])
      res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const runtime = runtimeFactory({
    store,
    conversations,
    exe: config.codexExe,
    cwd: path.join(store.dir, "empty-workspace"),
    tools: TOOLS,
    dispatch: async (p) => {
      const c = conversations.find((c) => c.id === p.threadId);
      check(
        c && active.has(c.id) && !active.get(c.id).cancelled,
        "TOOL_DENIED",
      );
      const currentTurn = active.get(c.id);
      if (
        [
          "start_scene_tag_audit",
          "read_scene_tag_audit",
          "resume_scene_tag_audit",
          "prepare_scene_tag_cleanup",
          "read_scene_tag_cleanup",
        ].includes(p.tool)
      ) {
        check(
          c.toolSchema >= 10 && c.toolNames?.includes(p.tool),
          "TOOL_DENIED",
        );
        currentTurn.cleanupCalls = (currentTurn.cleanupCalls || 0) + 1;
        check(currentTurn.cleanupCalls <= 12, "TOOL_DENIED");
        if (
          ["start_scene_tag_audit", "prepare_scene_tag_cleanup"].includes(
            p.tool,
          )
        ) {
          currentTurn.cleanupStarts ||= new Set();
          check(
            !currentTurn.cleanupStarts.has(p.tool),
            "ONE_CLEANUP_JOB_PER_TURN",
          );
          currentTurn.cleanupStarts.add(p.tool);
        }
      }
      if (p.tool === "request_review_decision") {
        check(
          c.toolSchema >= 9 && c.toolNames?.includes(p.tool),
          "TOOL_DENIED",
        );
        check(!currentTurn.reviewRequested, "ONE_REVIEW_REQUEST_PER_TURN");
        currentTurn.reviewRequested = true;
      }
      if (p.tool === "review_scenes")
        check(
          c.toolSchema >= 8 && c.toolNames?.includes(p.tool),
          "TOOL_DENIED",
        );
      if (p.tool === "present_scene_results") {
        check(
          c.toolSchema >= 7 && c.toolNames?.includes(p.tool),
          "TOOL_DENIED",
        );
        return presentations.select(currentTurn, p);
      }
      if (["resolve_descriptors", "preview_descriptor_update"].includes(p.tool))
        check(
          c.toolSchema >= 4 && c.toolNames?.includes(p.tool),
          "TOOL_DENIED",
        );
      if (p.tool === "get_scene_characters")
        check(
          c.toolSchema >= 6 && c.toolNames?.includes(p.tool),
          "TOOL_DENIED",
        );
      if (
        [
          "get_library_health_snapshot",
          "find_library_attention_items",
        ].includes(p.tool)
      )
        check(
          c.toolSchema >= 5 && c.toolNames?.includes(p.tool),
          "TOOL_DENIED",
        );
      if (
        [
          "review_scenes",
          "request_review_decision",
          "get_plugin_capabilities",
          "get_scene_characters",
          "read_descriptor_review",
          "read_variant_family",
          "read_scene_preferences",
          "resolve_descriptors",
          "get_library_health_snapshot",
          "find_library_attention_items",
        ].includes(p.tool)
      ) {
        check(
          c.toolSchema >= 3 && c.toolNames?.includes(p.tool),
          "TOOL_DENIED",
        );
        const turn = active.get(c.id);
        turn.pluginReads =
          (turn.pluginReads || 0) +
          (["review_scenes", "request_review_decision"].includes(p.tool)
            ? 2
            : 1);
        check(turn.pluginReads <= 12, "TOOL_DENIED");
      }
      emit(c.owner, {
        type: "activity",
        threadId: c.id,
        value: ["propose_scene_changes", "preview_descriptor_update"].includes(
          p.tool,
        )
          ? "Preparing changes"
          : "Searching Stash",
      });
      if (
        ["propose_scene_changes", "preview_descriptor_update"].includes(p.tool)
      ) {
        check(!active.get(c.id).proposalPrepared, "ONE_PROPOSAL_PER_TURN");
        // Reserve before asynchronous work; concurrent calls cannot multiply the batch.
        active.get(c.id).proposalPrepared = true;
      }
      const result = await dispatchTool({
        stash,
        adapters,
        descriptors,
        insights: c.toolSchema >= 6 ? characterInsights : insights,
        toolSchema: c.toolSchema || 1,
        toolNames: c.toolNames,
        proposals,
        reviewDecisions,
        tagCleanup,
        owner: c.owner,
        thread: c.id,
        name: p.tool,
        args: p.arguments,
      });
      if (p.tool === "request_review_decision") {
        if (active.get(c.id) !== currentTurn || currentTurn.cancelled) {
          reviewDecisions.cancel(c.owner, c.id);
          throw Error("TOOL_DENIED");
        }
        emit(c.owner, { type: "review-decisions", threadId: c.id });
      }
      emit(c.owner, { type: "proposals", threadId: c.id });
      return c.toolSchema >= 7 && active.get(c.id) === currentTurn
        ? presentations.record(currentTurn, p, result)
        : result;
    },
  });
  let globalTagCleanup, exactCharacterCleanup;
  const tagCleanup = new TagCleanup({
    store,
    adapter: new TagCleanupAdapter(stash),
    emit,
    canWrite: () =>
      proposals.writesEnabled &&
      !globalTagCleanup?.blocksWrites() &&
      !exactCharacterCleanup?.blocksWrites() &&
      !proposals.rows.some((p) => ["applying", "uncertain"].includes(p.status)),
  });
  await tagCleanup.init();
  globalTagCleanup = new GlobalTagCleanup({
    store,
    adapter: globalAdapterFactory({ stash, store, sceneCleanup: tagCleanup }),
    emit,
    canWrite: () =>
      proposals.writesEnabled &&
      active.size === 0 &&
      tagCleanup.available &&
      !tagCleanup.blocksWrites() &&
      !exactCharacterCleanup?.blocksWrites() &&
      !proposals.rows.some((p) => ["applying", "uncertain"].includes(p.status)),
  });
  await globalTagCleanup.init();
  exactCharacterCleanup = new ExactCharacterCleanup({
    store,
    adapter: exactAdapterFactory(stash),
    emit,
    canWrite: () =>
      proposals.writesEnabled &&
      active.size === 0 &&
      tagCleanup.available &&
      globalTagCleanup.available &&
      !tagCleanup.blocksWrites() &&
      !globalTagCleanup.blocksWrites() &&
      !proposals.rows.some((p) => ["applying", "uncertain"].includes(p.status)),
  });
  await exactCharacterCleanup.init();
  runtime.on("unavailable", (code) => {
    runtimeState = "offline";
    lastError = code;
    proposals.writesEnabled = false;
    for (const [threadId] of active) {
      const c = conversations.find((c) => c.id === threadId);
      if (c) reviewDecisions.cancel(c.owner, c.id);
      if (c) emit(c.owner, { type: "error", threadId, code });
    }
    active.clear();
  });
  runtime.on("notification", (m) => {
    const p = m.params || {},
      c = conversations.find((c) => c.id === p.threadId);
    if (!c) return;
    if (
      m.method === "item/completed" &&
      p.item?.type === "agentMessage" &&
      p.item.phase !== "commentary"
    ) {
      const a = active.get(c.id);
      if (a && a.turnId === p.turnId && !a.cancelled) a.messageId = p.item.id;
    }
    if (m.method === "turn/started") {
      const a = active.get(c.id);
      if (a) a.turnId = p.turn.id;
      emit(c.owner, {
        type: "activity",
        threadId: c.id,
        value: "Thinking / working",
      });
    }
    if (m.method === "item/agentMessage/delta")
      emit(c.owner, {
        type: "delta",
        threadId: c.id,
        itemId: p.itemId,
        text: p.delta,
      });
    if (m.method === "turn/completed") {
      const a = active.get(c.id);
      if (!a || a.turnId !== p.turn.id || a.finishing) return;
      if (a.cancelled || p.turn.status !== "completed")
        reviewDecisions.cancel(c.owner, c.id);
      a.finishing = true;
      const lastMessage = p.turn.items
        ?.filter((i) => i.type === "agentMessage" && i.phase !== "commentary")
        .at(-1);
      if (lastMessage) a.messageId = lastMessage.id;
      // Keep the turn active until durable publication. The UI history refresh
      // must never outrun the sidecar write or attach to a subsequent turn.
      presentations
        .finish(c, a, p.turn)
        .catch(() => {
          lastError = "PRESENTATION_SAVE_FAILED";
          emit(c.owner, { type: "error", threadId: c.id, code: lastError });
        })
        .finally(() => {
          if (active.get(c.id) === a) active.delete(c.id);
          c.updatedAt = Date.now();
          saveIndex().catch(() => {
            lastError = "STATE_WRITE_FAILED";
          });
          emit(c.owner, {
            type: "completed",
            threadId: c.id,
            status: p.turn.status,
          });
        });
    }
  });
  const ready = runtime
    .start()
    .then(async () => {
      runtimeState = runtime.authenticated
        ? "ready"
        : "authentication_required";
      try {
        const status = await stash.status();
        stashReachable = status.reachable;
        proposals.writesEnabled =
          runtimeState === "ready" &&
          config.writesEnabled === true &&
          (await stash.compatible());
      } catch {
        lastError = "STASH_UNAVAILABLE";
      }
    })
    .catch((error) => {
      runtimeState = "offline";
      lastError = [
        "STORAGE_SETUP_REQUIRED",
        "INVALID_STORAGE_ORIGIN",
        "INVALID_CODEX_HOME",
        "CODEX_HOME_UNAVAILABLE",
        "CODEX_HOME_MISMATCH",
        "UNEXPECTED_CODEX_CONFIGURATION",
      ].includes(error.message)
        ? error.message
        : "CODEX_UNAVAILABLE";
    });
  function status() {
    return {
      version: VERSION,
      runtimeVersion: TESTED_RUNTIME,
      runtimeState,
      authenticated: Boolean(runtime.authenticated),
      stashReachable,
      toolSchema: TOOL_SCHEMA,
      pluginAdapters: adapters.snapshot(),
      scenePresentations: presentations.available ? "available" : "unavailable",
      reviewDecisions: reviewDecisions.available ? "available" : "unavailable",
      reviewDecisionSchema: 1,
      tagCleanup: tagCleanup.available ? "available" : "unavailable",
      tagCleanupSchema: 1,
      globalTagCleanup: globalTagCleanup.available
        ? "available"
        : "unavailable",
      globalTagCleanupSchema: 1,
      exactCharacterCleanup: exactCharacterCleanup.available
        ? "available"
        : "unavailable",
      exactCharacterCleanupSchema: 1,
      relationshipOperations: [
        "tags:add/remove/replace",
        "studio:assign/replace/clear",
        "groups:add/remove/replace",
      ],
      writesEnabled: proposals.writesEnabled,
      lastError,
    };
  }
  async function body(req) {
    let text = "";
    for await (const c of req) {
      text += c;
      check(Buffer.byteLength(text) <= 65536, "BODY_TOO_LARGE");
    }
    try {
      return JSON.parse(text || "{}");
    } catch {
      throw Error("INVALID_JSON");
    }
  }
  const handle = async (req, res) => {
    try {
      if (req.url === "/control/stop") {
        const supplied = req.headers.authorization || "",
          expected = "Bearer " + controlSecret;
        check(
          req.method === "POST" &&
            !req.headers.origin &&
            req.headers.host === `127.0.0.1:${config.port}` &&
            supplied.length === expected.length &&
            timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)),
          "CONTROL_DENIED",
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"stopping":true}');
        setImmediate(() => close());
        return;
      }
      auth.checkOrigin(req);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "authorization,content-type,x-stash-ai-time,x-stash-ai-nonce",
        );
        res.writeHead(204);
        res.end();
        return;
      }
      check(
        req.method === "POST" &&
          req.headers["content-type"]?.split(";")[0] === "application/json",
        "METHOD_DENIED",
      );
      let result;
      const input = await body(req);
      if (req.url === "/pair") {
        object(input, ["code"]);
        result = await auth.pair(string(input.code, 100), req.headers.origin);
      } else {
        const owner = auth.authorize(req);
        switch (req.url) {
          case "/status":
            object(input, []);
            result = status();
            break;
          case "/suggestions":
            object(input, ["refresh"]);
            check(
              input.refresh === undefined || typeof input.refresh === "boolean",
            );
            result = await suggestions.get(input);
            break;
          case "/scene-results": {
            object(input, ["threadId", "collectionId"]);
            const conversation = owned(owner, input.threadId);
            const collection = presentations.get(
              owner,
              input.threadId,
              input.collectionId,
            );
            // Coalesce concurrent clients; no persistent metadata cache or polling.
            let read = cardReads.get(collection.id);
            if (!read) {
              check(cardReads.size < 4, "RATE_LIMIT");
              read = hydrateScenes(stash, adapters, collection);
              cardReads.set(collection.id, read);
              read
                .finally(() => cardReads.delete(collection.id))
                .catch(() => {});
            }
            const hydrated = await read;
            const prior = collection.scenes.filter((s) => s.review);
            const operations = proposals.list(owner, input.threadId);
            result = {
              ...hydrated,
              searchCapabilities: searchCapabilities(
                conversation.toolNames || [],
                await adapters.availableTools(),
                conversation.toolSchema || 1,
              ),
              ...(prior.length
                ? {
                    reviewSummary: reviewSummary(prior),
                    reviewLimitations: REVIEW_LIMITATIONS,
                  }
                : {}),
              scenes: hydrated.scenes.map((s) => {
                const original = collection.scenes.find(
                  (r) => r.sceneId === s.sceneId,
                )?.review;
                return {
                  ...s,
                  recommendations: recommendations(
                    s,
                    reviewDecisions,
                    owner,
                    hydrated.observedAt,
                  ),
                  operations: operationFeedback(operations, s.sceneId),
                  ...(original
                    ? {
                        review: reviewFeedback(
                          original,
                          s,
                          collection.observedAt,
                          hydrated.observedAt,
                        ),
                      }
                    : {}),
                };
              }),
            };
            break;
          }
          case "/unpair":
            object(input, []);
            await auth.revoke(req.headers.authorization);
            result = { revoked: true };
            setImmediate(() => {
              for (const res of subscribers.get(owner) || []) res.end();
            });
            break;
          case "/character-cleanup": {
            // UI-only authenticated account workflow; deliberately absent from TOOLS.
            object(input, ["action", "args"]);
            const args = input.args || {};
            if (input.action === "list") {
              object(args, []);
              result = await exactCharacterCleanup.list(owner);
            } else if (input.action === "read")
              result = exactCharacterCleanup.read(owner, args);
            else if (input.action === "control" && args.action === "pause")
              result = await exactCharacterCleanup.control(owner, args);
            else {
              check(active.size === 0 && !cleanupApprovalPending, "BUSY");
              cleanupApprovalPending = true;
              try {
                await proposals.queue;
                if (input.action === "prepare")
                  result = await exactCharacterCleanup.prepare(owner, args);
                else if (input.action === "approve")
                  result = await exactCharacterCleanup.approve(owner, args);
                else if (input.action === "control")
                  result = await exactCharacterCleanup.control(owner, args);
                else throw Error("OPERATION_DENIED");
              } finally {
                cleanupApprovalPending = false;
              }
            }
            break;
          }
          case "/global-tag-cleanup": {
            object(input, ["threadId", "action", "args"]);
            owned(owner, input.threadId);
            const args = input.args || {};
            if (input.action === "list") {
              object(args, []);
              result = globalTagCleanup.list(owner, input.threadId);
              const seed = await store.read(
                "global-tag-confirmation.json",
                null,
              );
              result.preparationAvailable =
                seed?.owner === owner && seed?.thread === input.threadId;
            } else if (input.action === "read")
              result = globalTagCleanup.read(owner, input.threadId, args);
            else if (input.action === "control")
              result = await globalTagCleanup.control(
                owner,
                input.threadId,
                args,
              );
            else {
              check(active.size === 0 && !cleanupApprovalPending, "BUSY");
              cleanupApprovalPending = true;
              try {
                await proposals.queue;
                if (input.action === "prepare")
                  result = await globalTagCleanup.prepare(
                    owner,
                    input.threadId,
                    args,
                  );
                else if (input.action === "approve")
                  result = await globalTagCleanup.approve(
                    owner,
                    input.threadId,
                    args,
                  );
                else throw Error("OPERATION_DENIED");
              } finally {
                cleanupApprovalPending = false;
              }
            }
            break;
          }
          case "/tag-cleanup": {
            object(input, ["threadId", "action", "args"]);
            owned(owner, input.threadId);
            const args = input.args || {};
            if (input.action === "list") {
              object(args, []);
              result = tagCleanup.list(owner, input.threadId);
            } else if (input.action === "read")
              result = tagCleanup.read(owner, input.threadId, args);
            else {
              check(
                active.size === 0 ||
                  (input.action === "control" &&
                    ["pause", "stop"].includes(args.action)),
                "BUSY",
              );
              if (input.action === "classify")
                result = await tagCleanup.classify(owner, input.threadId, args);
              else if (input.action === "approve") {
                check(!cleanupApprovalPending, "BUSY");
                cleanupApprovalPending = true;
                try {
                  await proposals.queue;
                  result = await tagCleanup.approve(
                    owner,
                    input.threadId,
                    args,
                  );
                } finally {
                  cleanupApprovalPending = false;
                }
              } else if (input.action === "control")
                result = await tagCleanup.control(owner, input.threadId, args);
              else if (input.action === "resume-audit")
                result = await tagCleanup.resumeAudit(
                  owner,
                  input.threadId,
                  args,
                );
              else throw Error("OPERATION_DENIED");
            }
            break;
          }
          case "/review-decisions":
            object(input, ["threadId"]);
            owned(owner, input.threadId);
            result = reviewDecisions.list(owner, input.threadId);
            break;
          case "/review-decision-request": {
            object(input, [
              "threadId",
              "collectionId",
              "sceneId",
              "findings",
              "action",
              "note",
              "expected",
            ]);
            owned(owner, input.threadId);
            check(active.size === 0, "BUSY");
            const collection = presentations.get(
              owner,
              input.threadId,
              input.collectionId,
            );
            check(
              collection.scenes.some((s) => s.sceneId === input.sceneId),
              "SCENE_CONTEXT_DENIED",
            );
            object(input.expected, input.findings);
            result = await reviewDecisions.prepare(
              owner,
              input.threadId,
              {
                sceneId: input.sceneId,
                findings: input.findings,
                action: input.action,
                note: input.note,
              },
              input.expected,
            );
            emit(owner, { type: "review-decisions", threadId: input.threadId });
            break;
          }
          case "/review-decision-confirm":
            object(input, ["threadId", "id", "token", "decision"]);
            owned(owner, input.threadId);
            check(active.size === 0, "BUSY");
            result = await reviewDecisions.confirm(owner, input.threadId, {
              id: input.id,
              token: input.token,
              decision: input.decision,
            });
            emit(owner, { type: "review-decisions", threadId: input.threadId });
            emit(owner, { type: "review-decisions-changed" });
            break;
          case "/conversations":
            object(input, []);
            result = conversations
              .filter((c) => c.owner === owner)
              .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
            break;
          case "/proposals":
            object(input, ["id"]);
            owned(owner, input.id);
            result = proposals.list(owner, input.id);
            break;
          case "/new": {
            object(input, []);
            check(runtimeState === "ready", "CODEX_NOT_READY");
            const catalog = await toolsFor(adapters, descriptors);
            runtime.tools = catalog;
            const t = await runtime.create();
            conversations.push({
              id: t.id,
              storage: "isolated",
              owner,
              title: "New conversation",
              toolSchema: TOOL_SCHEMA,
              toolNames: catalog.map((t) => t.name),
              updatedAt: Date.now(),
            });
            await saveIndex();
            result = { id: t.id };
            break;
          }
          case "/history": {
            object(input, ["id"]);
            const c = owned(owner, input.id);
            if (!c.startedAt) {
              result = {
                messages: [],
                active: false,
                proposals: [],
                reviewRequests: reviewDecisions.list(owner, input.id),
                toolSchema: c.toolSchema || 1,
              };
              break;
            }
            const r = await runtime.read(input.id);
            const messages = [];
            for (const turn of r.thread.turns || []) {
              for (const item of turn.items || []) {
                if (item.type === "agentMessage")
                  messages.push({
                    id: item.id,
                    role: "assistant",
                    timelineAt: turn.startedAt ? turn.startedAt * 1000 : null,
                    text: item.text,
                    collections:
                      turn.status === "completed"
                        ? presentations.forMessage(
                            owner,
                            input.id,
                            turn.id,
                            item.id,
                          )
                        : [],
                  });
                if (item.type === "userMessage")
                  messages.push({
                    id: item.id,
                    role: "user",
                    timelineAt: turn.startedAt ? turn.startedAt * 1000 : null,
                    text: (item.content || [])
                      .filter((x) => x.type === "text")
                      .map((x) => x.text)
                      .join("\n"),
                  });
              }
              // Runtime-owned history may omit an interrupted streaming item.
              // Preserve the outcome, without inventing or separately storing text.
              if (["interrupted", "failed"].includes(turn.status))
                messages.push({
                  id: `${turn.id}:outcome`,
                  role: "assistant",
                  timelineAt: turn.startedAt ? turn.startedAt * 1000 : null,
                  text: `Request ${turn.status}. Partial output may not be retained. This is not a confirmation that any proposed change was applied; check its authoritative proposal status.`,
                });
            }
            result = {
              messages,
              toolSchema: c.toolSchema || 1,
              active: active.has(input.id),
              proposals: proposals.list(owner, input.id),
              reviewRequests: reviewDecisions.list(owner, input.id),
            };
            break;
          }
          case "/send": {
            object(input, ["id", "text", "sceneId", "collectionContext"]);
            const c = owned(owner, input.id);
            const text = string(input.text, 12000);
            check(text.trim(), "EMPTY_MESSAGE");
            check(active.size === 0, "BUSY");
            if (input.sceneId !== undefined)
              check(/^[1-9]\d{0,11}$/.test(input.sceneId), "INVALID_SCENE");
            const collectionContext =
              input.collectionContext === undefined
                ? ""
                : presentations.context(owner, c.id, input.collectionContext);
            active.set(c.id, { turnId: null, cancelled: false });
            try {
              // A new user instruction can refine targets. Old approval must not race it.
              await proposals.cancelThread(owner, c.id);
              reviewDecisions.cancel(owner, c.id);
              emit(owner, { type: "review-decisions", threadId: c.id });
              emit(owner, { type: "proposals", threadId: c.id });
              if (!runtime.threads.has(c.id)) await runtime.resume(c.id);
              c.startedAt = Date.now();
              await saveIndex();
              const r = await runtime.turn(
                c.id,
                (input.sceneId
                  ? `Explicit scene context ID: ${input.sceneId}\n`
                  : "") +
                  collectionContext +
                  text,
              );
              const a = active.get(c.id);
              if (a) {
                a.turnId = r.turn.id;
                if (a.cancelled) await runtime.interrupt(c.id, r.turn.id);
              }
              if (c.title === "New conversation") c.title = text.slice(0, 60);
              await saveIndex();
              result = { accepted: true };
            } catch (e) {
              active.delete(c.id);
              throw e;
            }
            break;
          }
          case "/cancel": {
            object(input, ["id"]);
            owned(owner, input.id);
            const a = active.get(input.id);
            if (a && !a.finishing) {
              a.cancelled = true;
              if (a.turnId) await runtime.interrupt(input.id, a.turnId);
            }
            await proposals.cancelThread(owner, input.id);
            reviewDecisions.cancel(owner, input.id);
            emit(owner, { type: "review-decisions", threadId: input.id });
            result = { cancelRequested: Boolean(a && !a.finishing) };
            break;
          }
          case "/decision": {
            object(input, ["threadId", "id", "decision", "integrity"]);
            owned(owner, input.threadId);
            if (input.decision === "approve")
              check(
                !cleanupApprovalPending &&
                  tagCleanup.available &&
                  !globalTagCleanup.blocksWrites() &&
                  !exactCharacterCleanup.blocksWrites() &&
                  !tagCleanup.blocksWrites(),
                "CLEANUP_OPERATION_OUTSTANDING",
              );
            try {
              result = await proposals.decision(owner, input.threadId, {
                id: input.id,
                decision: input.decision,
                integrity: input.integrity,
              });
            } finally {
              // Even an uncertain/failed approval can have changed source data.
              if (input.decision === "approve") {
                insights.invalidate();
                characterInsights.invalidate();
                suggestions.invalidate();
                emit(owner, { type: "suggestions-stale" });
              }
            }
            emit(owner, { type: "proposals", threadId: input.threadId });
            break;
          }
          case "/events": {
            object(input, []);
            const set = subscribers.get(owner) || new Set();
            check(set.size < 4, "TOO_MANY_CONNECTIONS");
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(": connected\n\n");
            set.add(res);
            subscribers.set(owner, set);
            const timer = setInterval(
              () => res.write(": heartbeat\n\n"),
              15000,
            );
            res.on("close", () => {
              clearInterval(timer);
              set.delete(res);
              if (!set.size) subscribers.delete(owner);
            });
            return;
          }
          default:
            throw Error("OPERATION_DENIED");
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      const code = /^[A-Z_]+$/.test(e.message) ? e.message : "REQUEST_FAILED";
      if (!res.headersSent)
        res.writeHead(code === "AUTH_REQUIRED" ? 401 : 400, {
          "Content-Type": "application/json",
        });
      res.end(JSON.stringify({ error: code }));
    }
  };
  const server = http.createServer(handle);
  const closeSockets = attachWebSocket(server, handle, auth);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let closing;
  function close() {
    return (closing ??= (async () => {
      closeSockets();
      for (const set of subscribers.values()) for (const res of set) res.end();
      await proposals.queue;
      await presentations.queue;
      await reviewDecisions.queue;
      await tagCleanup.close();
      await globalTagCleanup.close();
      await exactCharacterCleanup.close();
      runtime.close();
      await new Promise((r) => server.close(r));
    })());
  }
  return {
    server,
    ready,
    status,
    config,
    close,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const stateDir = path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    "StashAICommandCenter",
  );
  const release = await acquireInstance(stateDir);
  let app;
  try {
    app = await createService({ stateDir });
  } catch (e) {
    await release();
    throw e;
  }
  app.server.on("close", () => release());
  app.server.listen(app.config.port, "127.0.0.1", () =>
    console.log(
      `Stash AI ${VERSION}: loopback port ${app.config.port}; approval policy active.`,
    ),
  );
  app.server.on("error", () => {
    app.close().finally(() => process.exit(1));
  });
  for (const event of ["SIGINT", "SIGTERM"])
    process.once(event, () => app.close().finally(() => process.exit()));
}
