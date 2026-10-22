// Native relationship semantics. No entity creation or plugin-owned field writes.
import { object, choice, check, id, ids } from "./validation.mjs";
export function uniqueIds(value, max = 20) {
  const result = ids(value, max);
  check(result.length === value.length, "DUPLICATE_ID");
  return result;
}
export const fieldValue = (s, k) =>
  k === "tag_ids"
    ? s.tags.map((t) => t.id).sort()
    : k === "studio_id"
      ? (s.studio?.id ?? null)
      : k === "groups"
        ? (s.groups || []).map((g) => ({
            group_id: g.group.id,
            scene_index: g.scene_index ?? null,
          }))
        : s[k];
export function validateOperations(operations) {
  check(
    Array.isArray(operations) &&
      operations.length > 0 &&
      operations.length <= 6,
  );
  const seen = new Set();
  for (const op of operations) {
    object(op, [
      "relationship",
      "action",
      "ids",
      "fromId",
      "toId",
      "expectedId",
    ]);
    choice(op.relationship, ["tags", "studio", "groups"]);
    check(!seen.has(op.relationship), "ONE_OPERATION_PER_RELATIONSHIP");
    seen.add(op.relationship);
    if (op.relationship === "studio") {
      choice(op.action, ["assign", "replace", "clear"]);
      object(op, ["relationship", "action", "toId", "expectedId"]);
      check("expectedId" in op, "EXPECTED_FRANCHISE_REQUIRED");
      if (op.expectedId !== null) id(op.expectedId);
      if (op.action === "assign") check(op.expectedId === null);
      if (op.action !== "assign") id(op.expectedId);
      if (op.action === "clear") check(!("toId" in op));
      else id(op.toId);
    } else {
      choice(op.action, ["add", "remove", "replace"]);
      if (op.action === "replace") {
        object(op, ["relationship", "action", "fromId", "toId"]);
        id(op.fromId);
        id(op.toId);
      } else {
        object(op, ["relationship", "action", "ids"]);
        uniqueIds(op.ids);
      }
    }
  }
  return structuredClone(operations);
}
export function referencedIds(op) {
  return [
    ...new Set(op.ids || [op.fromId, op.toId, op.expectedId].filter(Boolean)),
  ];
}
export function protectedTag(entity) {
  // Descriptor state lives in custom fields; Needs Review and taxonomy roots are owner-managed tags.
  return [entity.name, ...(entity.aliases || [])].some((n) =>
    ["needs review", "characters", "descriptors"].includes(
      String(n || "")
        .normalize("NFKC")
        .trim()
        .toLowerCase(),
    ),
  );
}
export function applyRelationship(scene, op, entities) {
  const field = { tags: "tag_ids", studio: "studio_id", groups: "groups" }[
    op.relationship
  ];
  const before = fieldValue(scene, field);
  let after = structuredClone(before),
    conflict = null;
  if (op.relationship === "studio") {
    if (before !== op.expectedId) conflict = "UNEXPECTED_FRANCHISE";
    else after = op.action === "clear" ? null : op.toId;
  } else {
    const current =
      op.relationship === "tags" ? before : before.map((g) => g.group_id);
    if (op.action === "replace") {
      if (!current.includes(op.fromId))
        conflict = "REPLACED_ASSOCIATION_MISSING";
      else if (op.fromId !== op.toId) {
        // Never merge two indexed Author associations by guessing which index wins.
        if (
          op.relationship === "groups" &&
          before.find((g) => g.group_id === op.fromId)?.scene_index !== null
        )
          conflict = "INDEXED_AUTHOR_REPLACEMENT_UNSUPPORTED";
        else if (op.relationship === "groups" && current.includes(op.toId))
          conflict = "AUTHOR_ALREADY_ASSOCIATED";
        else
          after =
            op.relationship === "tags"
              ? [
                  ...new Set(
                    current.map((x) => (x === op.fromId ? op.toId : x)),
                  ),
                ].sort()
              : before.map((g) =>
                  g.group_id === op.fromId ? { ...g, group_id: op.toId } : g,
                );
      }
    } else if (op.action === "add") {
      const additions = op.ids.filter((x) => !current.includes(x));
      after =
        op.relationship === "tags"
          ? [...current, ...additions].sort()
          : [
              ...before,
              ...additions.map((group_id) => ({ group_id, scene_index: null })),
            ];
    } else
      after =
        op.relationship === "tags"
          ? before.filter((x) => !op.ids.includes(x))
          : before.filter((g) => !op.ids.includes(g.group_id));
  }
  const present = (value) =>
    op.relationship === "studio"
      ? value
        ? [value]
        : []
      : op.relationship === "groups"
        ? value.map((g) => g.group_id)
        : value;
  const oldIds = present(before),
    newIds = present(after);
  const label = (entityId) => ({
    id: entityId,
    name:
      entities.find((e) => e.id === entityId)?.name ||
      (op.relationship === "tags"
        ? scene.tags.find((t) => t.id === entityId)?.name
        : op.relationship === "studio"
          ? scene.studio?.name
          : scene.groups.find((g) => g.group.id === entityId)?.group.name) ||
      "(name unavailable)",
  });
  return {
    field,
    before,
    after,
    conflict,
    diff: {
      relationship: op.relationship,
      action: op.action,
      before: oldIds.map(label),
      after: newIds.map(label),
      added: newIds.filter((x) => !oldIds.includes(x)).map(label),
      removed: oldIds.filter((x) => !newIds.includes(x)).map(label),
      unchanged: oldIds.filter((x) => newIds.includes(x)).map(label),
      ...(op.relationship === "groups"
        ? { associationBefore: before, associationAfter: after }
        : {}),
    },
  };
}
