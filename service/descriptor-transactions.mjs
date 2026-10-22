import { object, check, id, string } from "./validation.mjs";
export const DESCRIPTOR_OWNER_VERSION = "0.9.20";
// Exact audited releases: .21 adds Character reads; .22 only explains their results.
const OWNER_VERSIONS = [
  DESCRIPTOR_OWNER_VERSION,
  "0.9.21",
  "0.9.22",
  "0.9.23",
  "0.9.24",
  "0.9.25",
];
export const ASSIGNMENT_FIELDS = [
  "r34_sex_acts_positions",
  "r34_ending_descriptors",
];
export const DESCRIPTOR_FIELDS = [
  ...ASSIGNMENT_FIELDS,
  "r34_scene_descriptor_status",
  "r34_scene_descriptor_source",
];
export const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export const sameDescriptorPlan = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function descriptorArgs(args) {
  object(args, ["sceneId", "add", "remove"]);
  args = {
    ...args,
    add: args.add === undefined ? [] : args.add,
    remove: args.remove === undefined ? [] : args.remove,
  };
  id(args.sceneId);
  for (const list of [args.add, args.remove]) {
    check(
      Array.isArray(list) &&
        list.length <= 12 &&
        new Set(list).size === list.length,
    );
    list.forEach((v) => {
      string(v, 320);
      check(/^(acts|endings):.+/.test(v), "DESCRIPTOR_REFERENCE_REQUIRED");
    });
  }
  check(
    args.add.length + args.remove.length > 0 &&
      args.add.length + args.remove.length <= 12,
  );
  check(!args.add.some((v) => args.remove.includes(v)), "DESCRIPTOR_CONFLICT");
  return structuredClone(args);
}
export function rawDescriptorState(s) {
  return Object.fromEntries(
    DESCRIPTOR_FIELDS.map((k) => [k, s.custom_fields?.[k] ?? null]),
  );
}
export class DescriptorTransactions {
  constructor(stash) {
    this.stash = stash;
  }
  async available() {
    try {
      await this.call({ kind: "capabilities" });
      return true;
    } catch {
      return false;
    }
  }
  async call(args, expectedOwnerVersion) {
    const live = await this.stash.query(
      "{plugins{id version enabled}}",
      {},
      { timeoutMs: 8000 },
    );
    const current = live.plugins?.find(
      (p) =>
        p?.id === "scene-auto-tagger" &&
        p.enabled === true &&
        OWNER_VERSIONS.includes(p.version),
    );
    check(current, "DESCRIPTOR_OWNER_UNAVAILABLE");
    check(
      !expectedOwnerVersion || current.version === expectedOwnerVersion,
      "DESCRIPTOR_STALE",
    );
    let raw;
    try {
      const result = await this.stash.query(
        'mutation DescriptorOwner($args:Map){runPluginOperation(plugin_id:"scene-auto-tagger",args:$args)}',
        { args: { mode: "descriptor_transaction_v1", ...args } },
        { timeoutMs: 15000 },
      );
      raw = result.runPluginOperation;
      if (typeof raw === "string") {
        check(raw.length <= 65536);
        raw = JSON.parse(raw);
      }
    } catch (e) {
      // GraphQL may include owner codes wrapped in prose, never relay raw details.
      const code = String(e.message).match(
        /DESCRIPTOR_(STALE|SCENE_NOT_FOUND|SCENE_INELIGIBLE|UNKNOWN_OR_PROTECTED|INVALID_STORED_VALUE|INVALID_RESTORE|CONFLICT|APPROVED_PLAN_CHANGED|READBACK_FAILED)/,
      )?.[0];
      throw Error(code || "DESCRIPTOR_OWNER_ERROR");
    }
    check(
      raw &&
        JSON.stringify(raw).length <= 65536 &&
        raw.apiVersion === 1 &&
        raw.owner === "scene-auto-tagger" &&
        raw.ownerVersion === current.version,
      "DESCRIPTOR_OWNER_INVALID",
    );
    return raw;
  }
  async resolve(args) {
    object(args, ["sceneId", "query"]);
    if (args.sceneId !== undefined) id(args.sceneId);
    string(args.query, 100);
    const r = await this.call({ kind: "resolve", ...args });
    check(
      ["exact", "ambiguous", "similar_only", "no_match"].includes(r.resolution),
    );
    const project = (rows) => {
      check(Array.isArray(rows) && rows.length <= 30);
      return rows.map((d) => {
        string(d.id, 320);
        string(d.name, 100);
        check(["acts", "endings"].includes(d.category));
        check(d.id === d.category + ":" + encodeURIComponent(d.name));
        return {
          id: d.id,
          name: d.name,
          category: d.category,
          assigned: d.assigned === true,
          editable: d.canAdd === true,
        };
      });
    };
    return {
      resolution: r.resolution,
      matches: project(r.matches),
      exact: project(r.exact),
      hasMore: r.hasMore === true,
      scope:
        "Owner builtins and current-scene assignments only. Browser-local custom definitions cannot be edited. Descriptor IDs are category-qualified strings, not Stash tag IDs.",
    };
  }
  async preview(command, { withOwner = false } = {}) {
    const r = await this.call({ kind: "preview", command }),
      p = r.preview;
    check(
      p?.before?.sceneId === command.sceneId &&
        p.reviewEffect === "unchanged" &&
        typeof p.noOp === "boolean",
      "DESCRIPTOR_OWNER_INVALID",
    );
    object(p.before, ["sceneId", "updatedAt", "fields"]);
    string(p.before.updatedAt, 80);
    object(p.before.fields, DESCRIPTOR_FIELDS);
    object(p.afterFields, DESCRIPTOR_FIELDS);
    check(
      DESCRIPTOR_FIELDS.every(
        (k) =>
          Object.hasOwn(p.before.fields, k) && Object.hasOwn(p.afterFields, k),
      ),
    );
    for (const k of DESCRIPTOR_FIELDS) {
      for (const value of [p.before.fields[k], p.afterFields[k]])
        if (value !== null) string(value, 20000);
      if (!ASSIGNMENT_FIELDS.includes(k))
        check(
          p.before.fields[k] === p.afterFields[k],
          "DESCRIPTOR_REVIEW_CHANGE_FORBIDDEN",
        );
    }
    object(p.mutation, ["id", "custom_fields"]);
    check(p.mutation.id === command.sceneId);
    object(p.mutation.custom_fields, ["partial", "remove"]);
    if (p.mutation.custom_fields.partial)
      object(p.mutation.custom_fields.partial, ASSIGNMENT_FIELDS);
    check(
      (p.mutation.custom_fields.remove || []).every((k) =>
        ASSIGNMENT_FIELDS.includes(k),
      ),
    );
    for (const list of [p.current, p.proposed, p.added, p.removed]) {
      check(Array.isArray(list) && list.length <= 200);
      for (const d of list) {
        string(d.name, 100);
        string(d.id, 320);
        check(
          ["acts", "endings"].includes(d.category) &&
            d.id === d.category + ":" + encodeURIComponent(d.name),
        );
      }
    }
    check(
      p.operationCount === p.added.length + p.removed.length &&
        p.operationCount <= 12,
    );
    const expectedMutation = {};
    const partial = {},
      remove = [];
    for (const k of ASSIGNMENT_FIELDS)
      if (p.before.fields[k] !== p.afterFields[k]) {
        if (p.afterFields[k] === null) remove.push(k);
        else partial[k] = p.afterFields[k];
      }
    if (Object.keys(partial).length) expectedMutation.partial = partial;
    if (remove.length) expectedMutation.remove = remove;
    check(
      sameDescriptorPlan(expectedMutation, p.mutation.custom_fields) &&
        p.noOp === (Object.keys(expectedMutation).length === 0),
      "DESCRIPTOR_OWNER_INVALID",
    );
    const idsFor = (fields) =>
      ASSIGNMENT_FIELDS.flatMap((k, i) => {
        const list = fields[k] === null ? [] : JSON.parse(fields[k]);
        check(
          Array.isArray(list) &&
            list.length <= 100 &&
            list.every((n) => typeof n === "string" && n.length <= 100),
        );
        return list.map(
          (n) => (i ? "endings:" : "acts:") + encodeURIComponent(n),
        );
      });
    const before = idsFor(p.before.fields),
      after = idsFor(p.afterFields);
    const equalIds = (a, b) => sameDescriptorPlan([...a].sort(), [...b].sort());
    check(
      equalIds(
        before,
        p.current.map((d) => d.id),
      ) &&
        equalIds(
          after,
          p.proposed.map((d) => d.id),
        ),
      "DESCRIPTOR_OWNER_INVALID",
    );
    check(
      equalIds(
        after.filter((id) => !before.includes(id)),
        p.added.map((d) => d.id),
      ) &&
        equalIds(
          before.filter((id) => !after.includes(id)),
          p.removed.map((d) => d.id),
        ),
      "DESCRIPTOR_OWNER_INVALID",
    );
    check(
      p.added.every((d) => command.add.includes(d.id)) &&
        p.removed.every((d) => command.remove.includes(d.id)),
      "DESCRIPTOR_OWNER_INVALID",
    );
    return withOwner ? { plan: p, ownerVersion: r.ownerVersion } : p;
  }
  apply(operationId, command, expectedPlan, expectedOwnerVersion) {
    return this.call(
      { kind: "apply", operationId, command, expectedPlan },
      expectedOwnerVersion,
    );
  }
}
