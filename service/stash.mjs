import {
  object,
  string,
  id,
  integer,
  ids,
  choice,
  check,
} from "./validation.mjs";
import { uniqueIds } from "./relationships.mjs";
const SUMMARY = "id title rating100 studio { id name }";
const DETAIL =
  "id title details rating100 updated_at tags { id name } studio { id name } performers { id name } groups { group { id name } scene_index }";
// Service-only preservation snapshot; never returned to Codex or browser previews.
const AUDIT =
  DETAIL +
  " created_at date code director urls organized o_counter play_count play_duration last_played_at resume_time custom_fields galleries{id} stash_ids{endpoint stash_id}";
const ENTITY = {
  tags: ["findTags", "TagFilterType", "tag_filter"],
  studios: ["findStudios", "StudioFilterType", "studio_filter"],
  groups: ["findGroups", "GroupFilterType", "group_filter"],
  performers: ["findPerformers", "PerformerFilterType", "performer_filter"],
};
export class Stash {
  constructor({
    url = "http://localhost:9999/graphql",
    apiKey = "",
    fetchImpl = fetch,
  } = {}) {
    const u = new URL(url);
    check(
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
        ["http:", "https:"].includes(u.protocol),
      "STASH_NOT_LOCAL",
    );
    check(!u.username && !u.password && !u.search && !u.hash, "INVALID_CONFIG");
    Object.assign(this, { url, apiKey, fetchImpl });
  }
  async query(query, variables = {}, { timeoutMs = 12000 } = {}) {
    const r = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { ApiKey: this.apiKey } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!r.ok) throw Error("STASH_UNAVAILABLE");
    const j = await r.json();
    if (j.errors || !j.data) throw Error("STASH_QUERY_FAILED");
    return j.data;
  }
  async status() {
    const r = await this.query(
      "{version{version hash} findScenes(filter:{per_page:1}){count}}",
    );
    return {
      reachable: true,
      version: r.version.version,
      fork: r.version.hash,
      sceneCount: r.findScenes.count,
      toolSchema: 3,
    };
  }
  async compatible() {
    const r = await this.query(
      '{__type(name:"SceneUpdateInput"){inputFields{name}}}',
    );
    const names = r.__type?.inputFields.map((f) => f.name) || [];
    return [
      "id",
      "title",
      "details",
      "rating100",
      "tag_ids",
      "studio_id",
      "groups",
    ].every((n) => names.includes(n));
  }
  async getScene(args) {
    object(args, ["id", "includeDetails"]);
    id(args.id);
    if (args.includeDetails !== undefined)
      check(typeof args.includeDetails === "boolean");
    const fields = args.includeDetails
      ? DETAIL
      : DETAIL.replace(" details", "");
    const r = await this.query(`query($id:ID!){findScene(id:$id){${fields}}}`, {
      id: args.id,
    });
    check(r.findScene, "SCENE_NOT_FOUND");
    return r.findScene;
  }
  async getSceneState(sceneId) {
    const r = await this.query(`query($id:ID!){findScene(id:$id){${AUDIT}}}`, {
      id: id(sceneId),
    });
    check(r.findScene, "SCENE_NOT_FOUND");
    return r.findScene;
  }
  async entitiesByIds(kind, values) {
    choice(kind, Object.keys(ENTITY));
    const name = {
      tags: "findTag",
      studios: "findStudio",
      groups: "findGroup",
      performers: "findPerformer",
    }[kind];
    const checked = uniqueIds(values);
    // List-by-ids aborts the entire query on a missing ID in this fork. Singular
    // lookups return null, so aliases give bounded authoritative invalid-ID results.
    const declarations = checked.map((_, i) => `$id${i}:ID!`).join(",");
    const fields = checked
      .map(
        (_, i) =>
          `e${i}:${name}(id:$id${i}){id name ${kind === "tags" ? "aliases" : ""}}`,
      )
      .join(" ");
    const r = await this.query(
      `query(${declarations}){${fields}}`,
      Object.fromEntries(checked.map((value, i) => ["id" + i, value])),
    );
    return Object.values(r).filter(Boolean);
  }
  async findScenes(args = {}) {
    object(args, [
      "title",
      "ids",
      "tagIds",
      "studioIds",
      "groupIds",
      "performerIds",
      "missing",
      "createdAfter",
      "page",
      "limit",
      "relationships",
      "multipleAuthors",
    ]);
    const filter = {
      page: integer(args.page ?? 1, 1, 10000),
      per_page: integer(args.limit ?? 10, 1, 30),
      sort: "id",
      direction: "ASC",
    };
    const scene = {};
    const clauses = [];
    if (args.relationships !== undefined) {
      check(
        Array.isArray(args.relationships) &&
          args.relationships.length > 0 &&
          args.relationships.length <= 8,
      );
      for (const relation of args.relationships) {
        object(relation, ["kind", "match", "ids"]);
        const kind = choice(relation.kind, [
          "tags",
          "studios",
          "groups",
          "performers",
        ]);
        const match = choice(relation.match, [
          "any",
          "all",
          "none",
          "missing",
          "present",
        ]);
        const modifier = {
          any: "INCLUDES",
          all: "INCLUDES_ALL",
          none: "EXCLUDES",
          missing: "IS_NULL",
          present: "NOT_NULL",
        }[match];
        if (["missing", "present"].includes(match))
          check(relation.ids === undefined);
        clauses.push({
          [kind]: {
            modifier,
            ...(!["missing", "present"].includes(match)
              ? { value: uniqueIds(relation.ids) }
              : {}),
          },
        });
      }
    }
    if (args.title !== undefined)
      scene.title = { value: string(args.title, 200), modifier: "INCLUDES" };
    if (args.missing) {
      const missing = choice(args.missing, [
        "title",
        "details",
        "studio",
        "tags",
        "performers",
        "groups",
        "date",
      ]);
      // This fork rejects is_missing:"groups". Its native relationship-null
      // criterion is supported; AND preserves any other requested group filter.
      if (missing === "groups") scene.AND = { groups: { modifier: "IS_NULL" } };
      else scene.is_missing = missing;
    }
    for (const [key, field] of Object.entries({
      tagIds: "tags",
      studioIds: "studios",
      groupIds: "groups",
      performerIds: "performers",
    }))
      if (args[key])
        scene[field] = { value: ids(args[key]), modifier: "INCLUDES" };
    if (args.createdAfter !== undefined) {
      check(/^\d{4}-\d{2}-\d{2}$/.test(args.createdAfter));
      scene.created_at = { value: args.createdAfter, modifier: "GREATER_THAN" };
    }
    for (const clause of clauses) {
      let tail = scene;
      while (tail.AND) tail = tail.AND;
      tail.AND = clause;
    }
    if (args.multipleAuthors !== undefined)
      check(typeof args.multipleAuthors === "boolean");
    const variables = {
      filter,
      scene,
      ...(args.ids ? { ids: ids(args.ids, 30) } : {}),
    };
    const r = await this.query(
      `query($filter:FindFilterType!,$scene:SceneFilterType!,$ids:[ID!]){findScenes(filter:$filter,scene_filter:$scene,ids:$ids){count scenes{${SUMMARY}${args.multipleAuthors ? " groups{group{id}}" : ""}}}}`,
      variables,
    );
    const raw = r.findScenes;
    if (args.multipleAuthors)
      return {
        scenes: raw.scenes.filter((s) => s.groups.length > 1),
        count: null,
        candidateCount: raw.count,
        scanned: raw.scenes.length,
        page: filter.page,
        limit: filter.per_page,
        hasMore: filter.page * filter.per_page < raw.count,
        completeness:
          "Filtered current candidate page only; count unknown. Continue pages to enumerate multiple Authors.",
      };
    return {
      ...r.findScenes,
      page: filter.page,
      limit: filter.per_page,
      hasMore: filter.page * filter.per_page < r.findScenes.count,
      completeness:
        filter.page === 1 && raw.scenes.length === raw.count
          ? "complete"
          : "page; count is server total",
    };
  }
  async findEntities(args) {
    object(args, [
      "kind",
      "name",
      "page",
      "limit",
      "resolve",
      "id",
      "scenesMissingFranchise",
      "includeSceneCount",
    ]);
    const kind = choice(args.kind, ["tags", "studios", "groups", "performers"]);
    const queryName = {
      tags: "findTags",
      studios: "findStudios",
      groups: "findGroups",
      performers: "findPerformers",
    }[kind];
    const filter = {
      q: string(args.name ?? "", 200),
      page: integer(args.page ?? 1, 1, 10000),
      per_page: integer(args.limit ?? 10, 1, 30),
      sort: "name",
      direction: "ASC",
    };
    for (const key of [
      "resolve",
      "scenesMissingFranchise",
      "includeSceneCount",
    ])
      if (args[key] !== undefined) check(typeof args[key] === "boolean");
    if (args.id !== undefined) {
      id(args.id);
      const entities = await this.entitiesByIds(kind, [args.id]);
      return {
        resolution: entities.length ? "exact_id" : "invalid_id",
        [kind]: entities,
        count: entities.length,
        complete: true,
      };
    }
    const [, type, parameter] = ENTITY[kind];
    const entityFilter = {};
    if (args.scenesMissingFranchise) {
      choice(kind, ["tags", "studios", "groups"]);
      entityFilter.scenes_filter = { studios: { modifier: "IS_NULL" } };
    }
    if (args.resolve) {
      check(typeof args.name === "string" && args.name.trim().length > 0);
      check(args.page === undefined && !args.scenesMissingFranchise);
      // Native EQUALS avoids losing an exact match beyond a broad search page.
      const exact = await this.query(
        `query($entity:${type}!){${queryName}(${parameter}:$entity,filter:{per_page:30,sort:"id",direction:ASC}){count ${kind}{id name}}}`,
        { entity: { name: { value: args.name, modifier: "EQUALS" } } },
      );
      const candidates = exact[queryName];
      if (candidates.count > 0)
        return {
          ...candidates,
          resolution:
            candidates.count > 1
              ? "ambiguous"
              : candidates[kind][0].name === args.name
                ? "exact"
                : "case_insensitive",
          complete: candidates.count <= 30,
        };
    }
    const r = await this.query(
      `query($filter:FindFilterType!,$entity:${type}!){${queryName}(filter:$filter,${parameter}:$entity){count ${kind}{id name ${args.includeSceneCount ? "scene_count" : ""}}}}`,
      { filter, entity: entityFilter },
    );
    const result = r[queryName];
    return {
      ...result,
      page: filter.page,
      limit: filter.per_page,
      hasMore: filter.page * filter.per_page < result.count,
      complete: filter.page === 1 && result[kind].length === result.count,
      ...(args.includeSceneCount
        ? {
            countScope:
              "scene_count is each entity's total, not a count restricted by the search filter",
          }
        : {}),
      ...(args.resolve
        ? { resolution: result.count ? "similar_only" : "no_match" }
        : {}),
    };
  }
  // Application only. Never exposed as an agent tool or browser RPC.
  async updateApproved(input) {
    object(input, [
      "id",
      "title",
      "details",
      "rating100",
      "tag_ids",
      "studio_id",
      "groups",
    ]);
    id(input.id);
    if ("studio_id" in input && input.studio_id !== null) id(input.studio_id);
    if ("groups" in input) {
      check(Array.isArray(input.groups));
      const seen = new Set();
      for (const g of input.groups) {
        object(g, ["group_id", "scene_index"]);
        id(g.group_id);
        check(!seen.has(g.group_id));
        seen.add(g.group_id);
        if (g.scene_index !== null)
          integer(g.scene_index, -2147483648, 2147483647);
      }
    }
    return (
      await this.query(
        `mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){${DETAIL}}}`,
        { input },
      )
    ).sceneUpdate;
  }
}
