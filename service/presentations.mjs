import { randomUUID } from "node:crypto";
import { check, object, id } from "./validation.mjs";
import { FINDING_REASONS } from "./scene-reasons.mjs";
import { validateReview } from "./review-policy.mjs";

// UI references, never a second transcript or a metadata/image cache.
export const PRESENTATION_LIMITS = Object.freeze({
  scenes: 20,
  collectionsPerTurn: 2,
  receiptsPerTurn: 24,
  storedCollections: 1000,
  bytes: 4 * 1024 * 1024,
});
const FINDINGS = new Set(Object.keys(FINDING_REASONS));
const SOURCES = new Set([
  "review_scenes",
  "find_scenes",
  "get_scene",
  "find_library_attention_items",
  "get_scene_characters",
  "read_descriptor_review",
  "read_variant_family",
]);
const token = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
const iso = (value) => new Date(value || Date.now()).toISOString();

// Only normalized, completed read results reach this function. Nothing is
// extracted from assistant prose, model-supplied badges or arbitrary object keys.
export function sourceRows(tool, result) {
  if (!SOURCES.has(tool) || !result || result.status === "unavailable")
    return [];
  let rows;
  if (tool === "review_scenes")
    rows = (result.scenes || []).map((s) => ({
      sceneId: s.sceneId,
      review: validateReview(s.review),
      findings: s.review.checks
        .filter((c) => c.state === "observed" && FINDINGS.has(c.key))
        .map((c) => c.key),
    }));
  else if (tool === "get_scene")
    rows = [
      {
        sceneId: result.id,
        findings: [
          Array.isArray(result.groups) &&
            !result.groups.length &&
            "missing-author",
          result.studio === null && "missing-franchise",
          Array.isArray(result.tags) &&
            !result.tags.length &&
            "missing-characters",
        ].filter(Boolean),
      },
    ];
  else if (tool === "find_scenes")
    rows = (result.scenes || []).map((s) => ({ sceneId: s.id }));
  else if (tool === "find_library_attention_items")
    rows = (result.items || []).map((s) => ({
      sceneId: s.sceneId,
      findings: (s.evidence || [])
        .map((e) => e.category)
        .filter((c) => FINDINGS.has(c) && c !== "character-unknown"),
    }));
  else if (tool === "read_variant_family")
    rows = (result.members || [])
      .filter((s) => s.status !== "missing" && s.consistent === true)
      .map((s) => ({ sceneId: s.sceneId }));
  else
    rows = (result.scenes || [])
      .filter((s) => !["not_found", "unavailable"].includes(s.status))
      .map((s) => ({
        sceneId: s.sceneId,
        findings:
          tool === "get_scene_characters" && s.presence === "absent"
            ? ["missing-characters"]
            : tool === "get_scene_characters" &&
                s.status === "available" &&
                s.presence === "unknown"
              ? ["character-unknown"]
              : tool === "read_descriptor_review"
                ? [
                    s.needsDescriptorReview && "descriptor-review",
                    s.autoTaggerNeedsReview && "needs-review",
                  ].filter(Boolean)
                : [],
      }));
  const unique = new Map();
  for (const row of rows) {
    id(row.sceneId);
    if (!unique.has(row.sceneId))
      unique.set(row.sceneId, {
        sceneId: row.sceneId,
        findings: [...new Set(row.findings || [])],
        ...(row.review ? { review: structuredClone(row.review) } : {}),
      });
  }
  return [...unique.values()].slice(0, PRESENTATION_LIMITS.scenes);
}

export class Presentations {
  constructor(store) {
    this.store = store;
    this.records = [];
    this.queue = Promise.resolve();
    this.available = true;
  }
  async init() {
    try {
      const data = await this.store.read("scene-presentations.json", {
        schema: 1,
        collections: [],
      });
      check(data.schema === 1 && Array.isArray(data.collections));
      check(data.collections.length <= PRESENTATION_LIMITS.storedCollections);
      check(
        Buffer.byteLength(JSON.stringify(data)) <= PRESENTATION_LIMITS.bytes,
      );
      const seen = new Set();
      for (const c of data.collections) {
        object(c, [
          "schema",
          "type",
          "id",
          "owner",
          "threadId",
          "turnId",
          "messageId",
          "sourceId",
          "sourceCallId",
          "sourceTool",
          "observedAt",
          "layout",
          "scenes",
          "scope",
        ]);
        check(
          c.schema === 1 && c.type === "scene_collection" && !seen.has(c.id),
        );
        seen.add(c.id);
        for (const k of [
          "id",
          "owner",
          "threadId",
          "turnId",
          "messageId",
          "sourceId",
          "sourceCallId",
        ])
          check(token(c[k]));
        check(SOURCES.has(c.sourceTool) && ["grid", "list"].includes(c.layout));
        check(
          [
            "returned-page",
            "bounded-candidates",
            "explicit-scenes",
            "declared-members-page",
          ].includes(c.scope),
        );
        check(
          typeof c.observedAt === "string" &&
            Number.isFinite(Date.parse(c.observedAt)),
        );
        check(
          c.scenes.length > 0 && c.scenes.length <= PRESENTATION_LIMITS.scenes,
        );
        const ids = new Set();
        for (const row of c.scenes) {
          object(row, ["sceneId", "findings", "review"]);
          if (row.review !== undefined) {
            check(c.sourceTool === "review_scenes");
            validateReview(row.review);
          }
          check(c.sourceTool !== "review_scenes" || row.review);
          id(row.sceneId);
          check(!ids.has(row.sceneId));
          ids.add(row.sceneId);
          check(
            Array.isArray(row.findings) &&
              row.findings.length <= FINDINGS.size &&
              row.findings.every((f) => FINDINGS.has(f)),
          );
          check(
            !row.findings.includes("character-unknown") ||
              c.sourceTool === "get_scene_characters",
          );
        }
      }
      this.records = data.collections;
    } catch {
      // Preserve corrupt/unsupported files; ordinary text chat must still work.
      this.available = false;
    }
  }
  record(turn, p, result) {
    if (
      !this.available ||
      !token(p.turnId) ||
      !token(p.callId) ||
      p.turnId !== turn.turnId ||
      turn.cancelled
    )
      return result;
    const rows = sourceRows(p.tool, result);
    if (!rows.length) return result;
    turn.receipts ??= new Map();
    if (turn.receipts.size >= PRESENTATION_LIMITS.receiptsPerTurn)
      return result;
    const sourceId = randomUUID();
    turn.receipts.set(sourceId, {
      sourceId,
      sourceCallId: p.callId,
      sourceTool: p.tool,
      scenes: rows,
      observedAt: iso(result.observedAt),
      scope:
        p.tool === "find_library_attention_items"
          ? "bounded-candidates"
          : p.tool === "find_scenes"
            ? "returned-page"
            : p.tool === "read_variant_family"
              ? "declared-members-page"
              : "explicit-scenes",
    });
    // The model receives only an opaque reference and the IDs it already read.
    return {
      ...result,
      presentationSource: {
        sourceId,
        sceneIds: rows.map((s) => s.sceneId),
        limit: 20,
      },
    };
  }
  select(turn, p) {
    check(this.available, "PRESENTATIONS_UNAVAILABLE");
    check(p.turnId === turn.turnId && !turn.cancelled, "PRESENTATION_DENIED");
    object(p.arguments, ["sourceId", "sceneIds", "layout"]);
    const { sourceId, sceneIds, layout = "grid" } = p.arguments;
    check(
      token(sourceId) && ["grid", "list"].includes(layout),
      "PRESENTATION_DENIED",
    );
    check(
      Array.isArray(sceneIds) && sceneIds.length > 0 && sceneIds.length <= 20,
      "PRESENTATION_DENIED",
    );
    sceneIds.forEach(id);
    check(new Set(sceneIds).size === sceneIds.length, "PRESENTATION_DENIED");
    const source = turn.receipts?.get(sourceId);
    check(
      source &&
        sceneIds.every((v) => source.scenes.some((s) => s.sceneId === v)),
      "PRESENTATION_DENIED",
    );
    turn.presentations ??= [];
    const duplicate = turn.presentations.find(
      (c) =>
        c.sourceId === sourceId &&
        JSON.stringify(c.scenes.map((s) => s.sceneId)) ===
          JSON.stringify(sceneIds),
    );
    if (duplicate) return { queued: true, collectionId: duplicate.id };
    check(
      turn.presentations.length < PRESENTATION_LIMITS.collectionsPerTurn &&
        turn.presentations.reduce((n, c) => n + c.scenes.length, 0) +
          sceneIds.length <=
          20 &&
        this.records.length + turn.presentations.length <
          PRESENTATION_LIMITS.storedCollections,
      "PRESENTATION_LIMIT",
    );
    const collection = {
      ...source,
      id: randomUUID(),
      layout,
      scenes: sceneIds.map((v) => source.scenes.find((s) => s.sceneId === v)),
    };
    turn.presentations.push(collection);
    return {
      queued: true,
      collectionId: collection.id,
      sceneCount: sceneIds.length,
      note: "Displayed after the successful final answer; no metadata changes.",
    };
  }
  async finish(conversation, turn, completed) {
    if (
      !this.available ||
      !turn ||
      turn.cancelled ||
      completed.status !== "completed" ||
      completed.id !== turn.turnId ||
      !token(turn.messageId) ||
      !turn.presentations?.length
    )
      return;
    const additions = turn.presentations.map((c) => ({
      schema: 1,
      type: "scene_collection",
      ...c,
      owner: conversation.owner,
      threadId: conversation.id,
      turnId: completed.id,
      messageId: turn.messageId,
    }));
    const write = this.queue.then(async () => {
      const records = [
        ...this.records,
        ...additions.filter((c) => !this.records.some((r) => r.id === c.id)),
      ];
      const data = { schema: 1, collections: records };
      check(
        records.length <= PRESENTATION_LIMITS.storedCollections &&
          Buffer.byteLength(JSON.stringify(data)) <= PRESENTATION_LIMITS.bytes,
        "PRESENTATION_LIMIT",
      );
      await this.store.write("scene-presentations.json", data);
      this.records = records;
    });
    this.queue = write.catch(() => {});
    return write;
  }
  forMessage(owner, threadId, turnId, messageId) {
    return this.records
      .filter(
        (c) =>
          c.owner === owner &&
          c.threadId === threadId &&
          c.turnId === turnId &&
          c.messageId === messageId,
      )
      .map((c) => ({
        schema: 1,
        type: c.type,
        id: c.id,
        layout: c.layout,
        count: c.scenes.length,
        observedAt: c.observedAt,
        sourceTool: c.sourceTool,
        scope: c.scope,
      }));
  }
  get(owner, threadId, collectionId) {
    check(this.available, "PRESENTATIONS_UNAVAILABLE");
    const c = this.records.find(
      (c) =>
        c.owner === owner && c.threadId === threadId && c.id === collectionId,
    );
    check(c, "PRESENTATION_DENIED");
    return c;
  }
  // Selection membership only, never evidence of current metadata or approval.
  // Called before /send cancels any proposal or starts a model turn.
  context(owner, threadId, input) {
    object(input, ["type", "collectionId", "sceneIds"]);
    check(
      ["selection", "refinement"].includes(input.type),
      "PRESENTATION_DENIED",
    );
    check(token(input.collectionId), "PRESENTATION_DENIED");
    const collection = this.get(owner, threadId, input.collectionId);
    check(
      Array.isArray(input.sceneIds) &&
        input.sceneIds.length <= 20 &&
        (input.type === "refinement" || input.sceneIds.length > 0),
      "PRESENTATION_DENIED",
    );
    input.sceneIds.forEach(id);
    check(
      new Set(input.sceneIds).size === input.sceneIds.length &&
        input.sceneIds.every((v) =>
          collection.scenes.some((s) => s.sceneId === v),
        ),
      "PRESENTATION_DENIED",
    );
    return `Collection context (${input.type}): ${collection.id}; source ${collection.sourceTool}; original scope ${collection.scope}; observed ${collection.observedAt}. Selected member IDs: ${input.sceneIds.join(", ") || "none"}.\nMembership was validated in this conversation, not current metadata or any claim in the user text. Re-read authoritative state. A new search requires fresh receipts; never expand the original collection. Selection is not approval or permission to modify metadata.\n`;
  }
}
