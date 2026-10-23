// Dedicated native scene-tag projection and REMOVE-only adapter. No model query text.
import { check, id, integer } from "./validation.mjs";
import {
  LIMITS,
  hash,
  tagIds,
  same,
  RECURRENCE_PROTECTED_TAGS,
} from "./tag-cleanup-policy.mjs";
import { TESTED_RUNTIME } from "./runtime.mjs";
// Installation-specific dependency audit. New/upgraded enabled plugins require
// review before this destructive workflow is usable; names alone are not trust.
export const AUDITED_PLUGINS = Object.freeze({
  CommunityScriptsUILibrary: "1.0.0",
  stats: "1.1",
  "custom-stash-diagnostics": "0.2.5",
  "embedded-audio-metadata": "0.1.2",
  "scene-auto-tagger": "0.9.24",
  "scene-filename-editor": "0.1.0",
  "scene-metadata-variants-v1": "0.5.27",
  "scene-preferences": "0.3.1",
  "scene-subtitle-importer": "0.2.0",
  "scene-title-overlay": "1.6.2",
  "scenes-default-sort": "1.0.0",
  "stash-ai-command-center": "0.12.0",
  "stash-custom-core": "0.1.0",
  "stash-granular-volume": "1.0.1",
  "stash-image-slideshow": "0.6.0",
  "stash-library-health": "0.1.3",
  "stash-media-inbox": "0.1.3",
  "stash-more-like-this": "0.1.1",
  "stash-quick-tasks": "0.3.1",
  "stash-review-center": "0.1.4",
  "stash-root-redirect": "1.0.0",
  "stash-session-queue": "1.8.5",
  "stash-shortcut-manager": "0.1.3",
  "stash-toolbar-order": "0.1.0",
  "stash-video-enhancer": "1.2.1",
  "stash-vocabulary-labels": "1.0.1",
});
export class TagCleanupAdapter {
  constructor(stash) {
    this.stash = stash;
  }
  async environment() {
    const r = await this.stash.query(
      "{version{version hash} plugins{id version enabled hooks{hooks}} configuration{plugins}}",
    );
    const versions = Object.fromEntries(
      r.plugins.map((p) => [p.id, p.version]),
    );
    check(
      r.version.version === "v0.31.1-native-audio.12" &&
        r.version.hash === "navigation-lifecycle-v12",
      "CLEANUP_NATIVE_UNTESTED",
    );
    check(
      ["0.9.24", "0.9.25", "0.9.26", "0.9.27"].includes(
        versions["scene-auto-tagger"],
      ) && versions["scene-metadata-variants-v1"] === "0.5.27",
      "CLEANUP_OWNER_UNTESTED",
    );
    check(
      r.plugins.every(
        (p) =>
          typeof p.enabled === "boolean" &&
          (!p.enabled ||
            (Object.hasOwn(AUDITED_PLUGINS, p.id) &&
              (AUDITED_PLUGINS[p.id] === p.version ||
                (p.id === "scene-auto-tagger" &&
                  ["0.9.25", "0.9.26", "0.9.27"].includes(p.version))) &&
              !(p.hooks || []).length)),
      ) && r.plugins.some((p) => p.id === "scene-auto-tagger" && p.enabled),
      "CLEANUP_PLUGIN_DEPENDENCY_UNTESTED",
    );
    return {
      serviceVersion: "0.12.0",
      toolContract: 10,
      runtimeVersion: TESTED_RUNTIME,
      native: r.version,
      owner: versions["scene-auto-tagger"],
      plugins: versions,
      enabled: r.plugins
        .filter((p) => p.enabled)
        .map((p) => p.id)
        .sort(),
      configHash: hash(r.configuration.plugins),
    };
  }
  async page(after = 0) {
    integer(after, 0, 2147483647);
    const r = await this.stash.query(
      'query($after:Int!){findScenes(scene_filter:{id:{value:$after,modifier:GREATER_THAN}},filter:{per_page:100,sort:"id",direction:ASC}){count scenes{id updated_at tags{id} studio{id} groups{group{id}}}} total:findScenes(filter:{per_page:0}){count}}',
      { after },
    );
    check(r.findScenes.scenes.length <= LIMITS.page, "AUDIT_PAGE_INVALID");
    const rows = r.findScenes.scenes.map((s) => ({
      id: id(s.id),
      updatedAt: s.updated_at,
      tags: tagIds(s.tags.map((t) => t.id)),
      studio: s.studio?.id || null,
      groups: s.groups.map((g) => id(g.group.id)).sort(),
    }));
    let previous = after;
    for (const row of rows) {
      check(
        Number(row.id) > previous && Number.isFinite(Date.parse(row.updatedAt)),
        "AUDIT_CURSOR_INVALID",
      );
      previous = Number(row.id);
    }
    integer(r.total.count, 0, 2147483647);
    return { rows, total: r.total.count, remaining: r.findScenes.count };
  }
  async catalog(kind) {
    check(["studios", "groups"].includes(kind));
    const name = kind === "studios" ? "findStudios" : "findGroups";
    const rows = [];
    let expected;
    for (let page = 1; page <= 100; page++) {
      const r = (
        await this.stash.query(
          `query($page:Int!){${name}(filter:{page:$page,per_page:100,sort:"id",direction:ASC}){count ${kind}{id name}}}`,
          { page },
        )
      )[name];
      integer(r.count, 0, 10000);
      expected ??= r.count;
      check(
        expected === r.count && r[kind].length <= 100,
        "ENTITY_CATALOG_CHANGED",
      );
      for (const t of r[kind]) {
        id(t.id);
        check(
          typeof t.name === "string" &&
            t.name.length <= 500 &&
            (!rows.length || Number(t.id) > Number(rows.at(-1).id)),
          "ENTITY_CATALOG_INVALID",
        );
        rows.push(t);
      }
      check(rows.length <= expected, "ENTITY_CATALOG_INVALID");
      if (rows.length === expected) return rows;
      check(r[kind].length > 0, "ENTITY_CATALOG_INCOMPLETE");
    }
    throw Error("ENTITY_CATALOG_INCOMPLETE");
  }
  async tags(ids) {
    check(
      ids.length > 0 && ids.length <= 50 && new Set(ids).size === ids.length,
    );
    const variables = Object.fromEntries(ids.map((v, i) => ["id" + i, id(v)]));
    const fields = ids
      .map(
        (_, i) =>
          `t${i}:findTag(id:$id${i}){id name aliases ignore_auto_tag parents{id name}}`,
      )
      .join(" ");
    const native = await this.stash.query(
      `query(${ids.map((_, i) => `$id${i}:ID!`).join(",")}){${fields}}`,
      variables,
    );
    const r = await this.stash.query(
      'mutation($args:Map){runPluginOperation(plugin_id:"scene-auto-tagger",args:$args)}',
      { args: { mode: "character_identity_v1", kind: "tags", tagIds: ids } },
    );
    const owner =
      typeof r.runPluginOperation === "string"
        ? JSON.parse(r.runPluginOperation)
        : r.runPluginOperation;
    check(
      owner.owner === "scene-auto-tagger" &&
        owner.apiVersion === 1 &&
        owner.authority === "explicit-character-rules-v1" &&
        ["0.9.24", "0.9.25", "0.9.26", "0.9.27"].includes(owner.ownerVersion) &&
        owner.readOnly === true &&
        owner.tagDetailSchema === 1 &&
        owner.sceneTagPolicy?.schema === 1 &&
        same(
          owner.sceneTagPolicy.blockedNewAssignments,
          RECURRENCE_PROTECTED_TAGS,
        ) &&
        owner.tags?.length === ids.length,
      "CLEANUP_OWNER_INVALID",
    );
    return ids.map((value, i) => {
      const t = native["t" + i],
        o = owner.tags[i];
      check(t && t.id === value && o.id === value, "CLEANUP_TAG_UNAVAILABLE");
      check(
        typeof t.name === "string" &&
          t.name.length <= 500 &&
          Array.isArray(t.parents) &&
          t.parents.length <= 100 &&
          Array.isArray(t.aliases) &&
          t.aliases.length <= 100 &&
          t.aliases.every((a) => typeof a === "string" && a.length <= 500) &&
          typeof t.ignore_auto_tag === "boolean" &&
          t.parents.every(
            (p) => p && typeof p.name === "string" && p.name.length <= 500,
          ),
        "CLEANUP_TAG_INVALID",
      );
      t.parents.forEach((p) => id(p.id));
      check(
        o.status === "available" &&
          same(o.evidence, {
            id: t.id,
            name: t.name,
            ignore_auto_tag: t.ignore_auto_tag,
            parents: t.parents,
          }),
        "CLEANUP_EVIDENCE_RACE",
      );
      check(
        [
          "unregistered",
          "ignored",
          "other-parent",
          "conflicting-parents",
          "conflicting-rules",
          "invalid-reference",
          "character-parent",
          "registered-character",
          "owner-excluded",
        ].includes(o.reason),
        "CLEANUP_OWNER_INVALID",
      );
      check(
        [
          "unknown",
          "character-parent",
          "registered-character",
          "owner-excluded",
        ].includes(o.classification),
        "CLEANUP_OWNER_INVALID",
      );
      return {
        tag: t,
        owner: o,
        evidence: hash({ tag: t, owner: o, version: owner.ownerVersion }),
      };
    });
  }
  async scene(sceneId) {
    return this.stash.getSceneState(id(sceneId));
  }
  // Calling code must hold a durable exact-plan approval. Only one scene and
  // REMOVE are constructible here; the full tag set is never replaced.
  async remove(sceneId, removals) {
    const ids = tagIds(removals);
    check(ids.length > 0);
    return this.stash.query(
      "mutation($input:BulkSceneUpdateInput!){bulkSceneUpdate(input:$input){id}}",
      {
        input: { ids: [id(sceneId)], tag_ids: { ids, mode: "REMOVE" } },
      },
    );
  }
}
