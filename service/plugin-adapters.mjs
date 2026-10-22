import { object, check, id, integer } from "./validation.mjs";
import { uniqueIds } from "./relationships.mjs";
import {
  CHARACTER_DETAIL_REASONS,
  characterExplanation,
} from "./character-explanations.mjs";

// Exact owner versions are deliberate compatibility gates, not optimistic ranges.
// None of these operation names or plugin IDs can be supplied by the model.
const OWNERS = {
  descriptors: {
    pluginId: "scene-auto-tagger",
    version: "0.9.20",
    compatibleVersions: [
      "0.9.20",
      "0.9.21",
      "0.9.22",
      "0.9.23",
      "0.9.24",
      "0.9.25",
      "0.9.26",
      "0.9.27",
    ],
    mode: "ai_read_v1",
    tool: "read_descriptor_review",
  },
  characters: {
    pluginId: "scene-auto-tagger",
    version: "0.9.21",
    compatibleVersions: [
      "0.9.21",
      "0.9.22",
      "0.9.23",
      "0.9.24",
      "0.9.25",
      "0.9.26",
      "0.9.27",
    ],
    mode: "character_identity_v1",
    tool: "get_scene_characters",
  },
  variants: {
    pluginId: "scene-metadata-variants-v1",
    version: "0.5.27",
    mode: "ai_read_v1",
    tool: "read_variant_family",
  },
  preferences: {
    pluginId: "scene-preferences",
    version: "0.3.1",
    mode: "preferences_get",
    tool: "read_scene_preferences",
  },
};
const OPERATION =
  "mutation StashAIOwnerRead($plugin_id:ID!,$args:Map){runPluginOperation(plugin_id:$plugin_id,args:$args)}";
const compatible = (owner, version) =>
  (owner.compatibleVersions || [owner.version]).includes(version);
const boundedText = (v, max = 300) => {
  check(typeof v === "string" && v.length <= max, "OWNER_MALFORMED");
  return v;
};
const bool = (v) => {
  check(typeof v === "boolean", "OWNER_MALFORMED");
  return v;
};
const list = (v, max) => {
  check(Array.isArray(v) && v.length <= max, "OWNER_MALFORMED");
  return v;
};
const timestamp = (v) => {
  boundedText(v, 60);
  check(Number.isFinite(Date.parse(v)), "OWNER_MALFORMED");
  return v;
};

export class PluginAdapters {
  constructor(stash, { now = Date.now, timeoutMs = 8000 } = {}) {
    Object.assign(this, { stash, now, timeoutMs });
    this.cache = null;
  }
  async bounded(work) {
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("OWNER_TIMEOUT")),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async call(key, args, expectedVersion = OWNERS[key].version) {
    const owner = OWNERS[key];
    const data = await this.bounded(
      this.stash.query(
        OPERATION,
        { plugin_id: owner.pluginId, args: { ...args, mode: owner.mode } },
        { timeoutMs: this.timeoutMs },
      ),
    );
    let result = data.runPluginOperation;
    if (typeof result === "string") {
      check(result.length <= 65536, "OWNER_MALFORMED");
      result = JSON.parse(result);
    }
    check(
      result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        JSON.stringify(result).length <= 65536,
      "OWNER_MALFORMED",
    );
    if (key === "preferences") check(result.ok === true, "OWNER_MALFORMED");
    else {
      check(
        result.apiVersion === 1 &&
          result.owner === owner.pluginId &&
          result.ownerVersion === expectedVersion &&
          result.readOnly === true,
        "OWNER_INCOMPATIBLE",
      );
      timestamp(result.observedAt);
      if (key === "characters")
        check(
          result.authority === "explicit-character-rules-v1" &&
            result.taxonomyComplete === false &&
            result.maxScenes === 20 &&
            result.maxTagsPerScene === 100,
          "OWNER_INCOMPATIBLE",
        );
    }
    return result;
  }
  snapshot() {
    return this.cache
      ? {
          ...this.cache,
          freshness: this.now() - this.cache.time < 60000 ? "fresh" : "stale",
        }
      : { freshness: "unknown", capabilities: [] };
  }
  async capabilities() {
    if (this.cache && this.now() - this.cache.time < 60000)
      return this.snapshot();
    if (this.loading) return this.loading;
    this.loading = this.discover().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }
  async discover() {
    let installed = [];
    try {
      const data = await this.bounded(
        this.stash.query("{plugins{id version enabled}}"),
      );
      installed = list(data.plugins, 1000).filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          typeof p.version === "string" &&
          typeof p.enabled === "boolean",
      );
    } catch {
      /* Missing discovery never breaks native tools. */
    }
    const capabilities = await Promise.all(
      Object.entries(OWNERS).map(async ([key, owner]) => {
        const plugin = installed.find((p) => p.id === owner.pluginId);
        let state =
          !plugin || !plugin.enabled
            ? "unavailable"
            : !compatible(owner, plugin.version)
              ? "incompatible"
              : "available";
        let reason =
          state === "unavailable"
            ? "owner_missing_disabled_or_unreachable"
            : state === "incompatible"
              ? "owner_version_not_audited"
              : null;
        if (state === "available") {
          try {
            await this.call(
              key,
              key === "preferences"
                ? { sceneIds: [] }
                : { kind: "capabilities" },
              plugin.version,
            );
          } catch (e) {
            state = "unavailable";
            reason =
              e.message === "OWNER_TIMEOUT"
                ? "timeout"
                : "owner_api_missing_or_invalid";
          }
        }
        return {
          id: key,
          pluginId: owner.pluginId,
          adapterVersion: 1,
          apiVersion: 1,
          ownerVersion:
            typeof plugin?.version === "string"
              ? plugin.version.slice(0, 40)
              : null,
          state,
          reason,
          readOnly: true,
          tool: owner.tool,
        };
      }),
    );
    for (const [key, pluginId, reason] of [
      [
        "library-health",
        "stash-library-health",
        "Metrics/cache require the browser owner and explicit full-snapshot refresh; no server summary API.",
      ],
      [
        "review-center",
        "stash-review-center",
        "Browser aggregator; use the available underlying owner readers. No authoritative combined count.",
      ],
      [
        "variant-review-drafts",
        "scene-metadata-variants-v1",
        "Saved discovery drafts/Preview Required state are browser-local; absence is not completion.",
      ],
      [
        "preference-configuration",
        "scene-preferences",
        "Configuration getter can initialize state; only persisted scene preference reads are enabled.",
      ],
    ])
      capabilities.push({
        id: key,
        pluginId,
        adapterVersion: 1,
        state:
          key !== "preference-configuration" &&
          installed.some((p) => p.id === pluginId && p.enabled)
            ? "browser-only"
            : "unavailable",
        reason,
        readOnly: true,
      });
    this.cache = {
      time: this.now(),
      observedAt: new Date(this.now()).toISOString(),
      capabilities,
    };
    return this.snapshot();
  }
  async availableTools() {
    return (await this.capabilities()).capabilities
      .filter((c) => c.state === "available" && c.tool)
      .map((c) => c.tool);
  }
  async read(key, args) {
    let request;
    if (key === "characters") {
      object(args, ["sceneIds"]);
      // Bound raw input before deduplication, never permit a huge duplicate list.
      list(args.sceneIds, 20).forEach(id);
      request = {
        kind: "scenes",
        sceneIds: uniqueIds([...new Set(args.sceneIds)]),
      };
    } else if (key === "descriptors") {
      object(args, ["sceneIds", "pending", "page", "limit"]);
      if (args.pending === true) {
        check(args.sceneIds === undefined);
        request = {
          kind: "pending",
          page: integer(args.page ?? 1, 1, 10000),
          limit: integer(args.limit ?? 20, 1, 30),
        };
      } else {
        check(args.pending === undefined || args.pending === false);
        check(args.page === undefined && args.limit === undefined);
        request = { kind: "scenes", sceneIds: uniqueIds(args.sceneIds) };
      }
    } else if (key === "variants") {
      object(args, ["sceneId", "page", "limit"]);
      request = {
        kind: "family",
        sceneId: id(args.sceneId),
        page: integer(args.page ?? 1, 1, 10000),
        limit: integer(args.limit ?? 20, 1, 20),
      };
    } else if (key === "preferences") {
      object(args, ["sceneIds"]);
      request = { sceneIds: uniqueIds(args.sceneIds) };
    } else throw Error("TOOL_DENIED");
    const capability = (await this.capabilities()).capabilities.find(
      (c) => c.id === key,
    );
    if (capability?.state !== "available")
      return { status: "unavailable", capability };
    try {
      // Recheck live version for every read. A cached discovery must never invoke
      // an unknown mode after an owner downgrade (legacy owners may default to tasks).
      const live = await this.bounded(
        this.stash.query(
          "{plugins{id version enabled}}",
          {},
          { timeoutMs: this.timeoutMs },
        ),
      );
      const owner = OWNERS[key];
      const current = live.plugins?.find((p) => p.id === owner.pluginId);
      check(
        current?.enabled === true && compatible(owner, current.version),
        "OWNER_INCOMPATIBLE",
      );
      const raw = await this.call(key, request, current.version);
      const result = this.project(key, raw, request);
      return {
        status: "available",
        owner: OWNERS[key].pluginId,
        ownerVersion: current.version,
        adapterVersion: 1,
        readOnly: true,
        authority: "persisted owner state with owner-defined interpretation",
        observedAt: raw.observedAt || new Date(this.now()).toISOString(),
        freshness: "fresh",
        ...result,
      };
    } catch (e) {
      // Never forward raw owner exceptions, query bodies, private fields or paths.
      return {
        status: "unavailable",
        owner: OWNERS[key].pluginId,
        reason:
          e.message === "OWNER_TIMEOUT"
            ? "timeout"
            : "owner_error_or_invalid_response",
      };
    }
  }
  project(key, raw, request) {
    if (key === "characters") {
      check(
        raw.authority === "explicit-character-rules-v1" &&
          raw.taxonomyComplete === false,
        "OWNER_MALFORMED",
      );
      const scenes = list(raw.scenes, request.sceneIds.length).map((s) => {
        check(request.sceneIds.includes(s.sceneId), "OWNER_MALFORMED");
        if (["not_found", "unavailable"].includes(s.status))
          return { sceneId: s.sceneId, status: s.status, presence: "unknown" };
        check(
          s.status === "available" &&
            ["present", "absent", "unknown"].includes(s.presence) &&
            ["complete", "partial"].includes(s.completeness),
          "OWNER_MALFORMED",
        );
        const ids = list(s.characterTagIds, 100).map(id);
        check(new Set(ids).size === ids.length, "OWNER_MALFORMED");
        const characterCount = integer(s.characterCount, 0, 100);
        const nonCharacterCount = integer(s.nonCharacterCount, 0, 100);
        const unclassifiedCount = integer(s.unclassifiedCount, 0, 1e9);
        const assignedTagCount = integer(s.assignedTagCount, 0, 1e9);
        const truncated = bool(s.truncated);
        check(
          characterCount === ids.length &&
            characterCount + nonCharacterCount + unclassifiedCount ===
              assignedTagCount &&
            s.completeness === (unclassifiedCount ? "partial" : "complete") &&
            s.presence ===
              (characterCount
                ? "present"
                : unclassifiedCount
                  ? "unknown"
                  : "absent") &&
            truncated === assignedTagCount > 100 &&
            (!truncated || unclassifiedCount === assignedTagCount),
          "OWNER_MALFORMED",
        );
        const parent = integer(s.evidence?.parent, 0, 100);
        const registered = integer(s.evidence?.registered, 0, 100);
        check(parent + registered === characterCount, "OWNER_MALFORMED");
        let detail = {};
        if (raw.detailSchema !== undefined) {
          check(
            raw.detailSchema === 1 && raw.maxUnclassifiedDetails === 4,
            "OWNER_MALFORMED",
          );
          const tags = list(s.unclassifiedTags, 4).map((t) => {
            object(t, ["id", "name", "nameTruncated", "reason"]);
            check(
              Object.hasOwn(CHARACTER_DETAIL_REASONS, t.reason),
              "OWNER_MALFORMED",
            );
            check(!ids.includes(t.id), "OWNER_MALFORMED");
            return {
              id: id(t.id),
              name: boundedText(t.name, 120),
              nameTruncated: bool(t.nameTruncated),
              reason: t.reason,
            };
          });
          check(
            new Set(tags.map((t) => t.id)).size === tags.length &&
              tags.length <= unclassifiedCount &&
              bool(s.unclassifiedDetailsTruncated) ===
                tags.length < unclassifiedCount,
            "OWNER_MALFORMED",
          );
          detail = {
            detailSchema: 1,
            unclassifiedTags: tags,
            unclassifiedDetailsTruncated: s.unclassifiedDetailsTruncated,
          };
        }
        return {
          sceneId: s.sceneId,
          status: s.status,
          updatedAt: timestamp(s.updatedAt),
          presence: s.presence,
          completeness: s.completeness,
          characterTagIds: ids,
          characterCount,
          nonCharacterCount,
          unclassifiedCount,
          assignedTagCount,
          truncated,
          evidence: { parent, registered },
          ...detail,
          explanation: characterExplanation({
            presence: s.presence,
            completeness: s.completeness,
            ...detail,
          }),
        };
      });
      check(
        scenes.length === request.sceneIds.length &&
          new Set(scenes.map((s) => s.sceneId)).size === scenes.length,
        "OWNER_MALFORMED",
      );
      return {
        scenes,
        taxonomyApiVersion: 1,
        taxonomyComplete: false,
        classificationAuthority:
          "scene-auto-tagger explicit-character-rules-v1",
        note: "Direct Character parent and builtin canonical registry; explicit owner exclusions. Unregistered, ignored, conflicting and indirect tags stay unknown. No learned/runtime inference or global coverage.",
      };
    }
    if (key === "descriptors") {
      const scenes = list(
        raw.scenes,
        request.sceneIds?.length || request.limit,
      ).map((s) => {
        id(s.sceneId);
        if (request.sceneIds)
          check(request.sceneIds.includes(s.sceneId), "OWNER_MALFORMED");
        if (s.status === "not_found")
          return { sceneId: s.sceneId, status: "not_found" };
        return {
          sceneId: s.sceneId,
          updatedAt: timestamp(s.updatedAt),
          eligible: bool(s.eligible),
          processed: bool(s.processed),
          needsDescriptorReview: bool(s.needsDescriptorReview),
          persistedStatus:
            s.persistedStatus === null ? null : boundedText(s.persistedStatus),
          statusEvidence: boundedText(s.statusEvidence, 20),
          descriptors: {
            acts: list(s.descriptors?.acts, 100).map((v) => boundedText(v)),
            endings: list(s.descriptors?.endings, 100).map((v) =>
              boundedText(v),
            ),
          },
          descriptorsTruncated: bool(s.descriptorsTruncated),
          autoTaggerNeedsReview: bool(s.autoTaggerNeedsReview),
          autoTaggerCompletion: "unknown",
          reviewProgress: "browser-only",
        };
      });
      check(
        new Set(scenes.map((s) => s.sceneId)).size === scenes.length,
        "OWNER_MALFORMED",
      );
      if (request.sceneIds)
        check(scenes.length === request.sceneIds.length, "OWNER_MALFORMED");
      const result = {
        scenes,
        categories: ["Sex Acts & Positions", "Endings"],
        note: "Descriptor presence is not completion. Missing status is owner-pending, not proof Auto-Tagger failed or succeeded.",
      };
      if (request.kind === "pending")
        Object.assign(result, {
          page: request.page,
          limit: request.limit,
          scanned: integer(raw.scanned, 0, request.limit),
          candidateCount: integer(raw.candidateCount, 0, 1e9),
          matchingCount: null,
          hasMore: bool(raw.hasMore),
          completeness: "candidate-page-only",
        });
      return result;
    }
    if (key === "variants") {
      check(
        raw.sceneId === request.sceneId &&
          [
            "not_found",
            "no_declared_family",
            "inconsistent",
            "declared_family",
          ].includes(raw.status),
        "OWNER_MALFORMED",
      );
      const result = {
        sceneId: raw.sceneId,
        relationshipStatus: raw.status,
        candidates: "browser-only",
        validationScope:
          "Primary, requested scene and this page of declared members only. No reverse-link or full graph scan.",
      };
      if (raw.primarySceneId) result.primarySceneId = id(raw.primarySceneId);
      if (raw.familyId) result.familyId = boundedText(raw.familyId, 80);
      if (raw.issues)
        result.issues = list(raw.issues, 25).map((v) => boundedText(v, 100));
      if (raw.members)
        Object.assign(result, {
          members: list(raw.members, request.limit).map((m) => ({
            sceneId: id(m.sceneId),
            ...(m.status === "missing"
              ? { status: "missing" }
              : {
                  role: boundedText(m.role, 20),
                  label: boundedText(m.label, 200),
                  sortIndex: boundedText(m.sortIndex, 20),
                  consistent: bool(m.consistent),
                }),
          })),
          declaredMemberCount: integer(raw.declaredMemberCount, 1, 10001),
          page: request.page,
          limit: request.limit,
          hasMore: bool(raw.hasMore),
        });
      return result;
    }
    const preferences = list(raw.preferences, request.sceneIds.length).map(
      (p) => {
        check(
          request.sceneIds.includes(p.sceneId) && [-1, 0, 1].includes(p.vote),
          "OWNER_MALFORMED",
        );
        return {
          sceneId: id(p.sceneId),
          vote: p.vote,
          excluded: bool(p.excluded),
          revision: integer(p.revision, 0, Number.MAX_SAFE_INTEGER),
          updatedAt: boundedText(p.updatedAt, 60),
          lastShuffleAt: boundedText(p.lastShuffleAt, 60),
          shuffleCount: integer(p.shuffleCount, 0, Number.MAX_SAFE_INTEGER),
          voteScope: boundedText(p.voteScope, 20),
          exclusionScope: boundedText(p.exclusionScope, 20),
          familyShared: bool(p.familyShared),
        };
      },
    );
    check(
      new Set(preferences.map((p) => p.sceneId)).size === preferences.length,
      "OWNER_MALFORMED",
    );
    return {
      preferences,
      missingSceneIds: request.sceneIds.filter(
        (id) => !preferences.some((p) => p.sceneId === id),
      ),
      note: "Instance-wide persisted scene preferences; absent vote means neutral under owner rules. Weight configuration and browser state were not read.",
    };
  }
}
