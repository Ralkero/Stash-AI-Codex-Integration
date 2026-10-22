// Offline planning only. No I/O, owner calls, production journals or write tools.
import { createHash } from "node:crypto";
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export const fingerprint = (v) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
export function ids(values) {
  if (
    !Array.isArray(values) ||
    values.some((v) => typeof v !== "string" || !/^[1-9]\d*$/.test(v))
  )
    throw Error("INVALID_EXACT_IDS");
  return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
}
export function dependencyOrder(operations) {
  const byId = new Map(operations.map((o) => [o.id, o]));
  if (byId.size !== operations.length) throw Error("DUPLICATE_OPERATION");
  const visited = new Set(),
    active = new Set(),
    ordered = [];
  function visit(id) {
    if (!byId.has(id)) throw Error("MISSING_DEPENDENCY:" + id);
    if (active.has(id)) throw Error("CYCLIC_DEPENDENCY:" + id);
    if (visited.has(id)) return;
    active.add(id);
    for (const d of [...(byId.get(id).dependsOn || [])].sort()) visit(d);
    active.delete(id);
    visited.add(id);
    ordered.push(id);
  }
  [...byId.keys()].sort().forEach(visit);
  return ordered;
}
export function reconcileScene({ scene, sceneId, candidates, tags }) {
  if (!scene)
    return {
      sceneId,
      status: "unavailable",
      before: null,
      after: null,
      findings: candidates,
      conflicts: [{ code: "SCENE_UNAVAILABLE" }],
    };
  if (scene.id !== sceneId) throw Error("SCENE_ID_MISMATCH");
  const before = ids(scene.tags.map((t) => t.id)),
    stamp = fingerprint(scene),
    tagMap = new Map(tags.map((t) => [t.id, t]));
  const findings = [...candidates].sort((a, b) => a.id.localeCompare(b.id)),
    conflicts = [],
    rejected = new Set();
  if (new Set(findings.map((f) => f.id)).size !== findings.length)
    throw Error("DUPLICATE_FINDING");
  const reject = (c, code) => {
    rejected.add(c.id);
    conflicts.push({
      finding: c.id,
      code,
      sourceId: c.sourceId,
      targetId: c.targetId || null,
    });
  };
  for (const c of findings) {
    ids([c.sourceId]);
    if (c.sceneId !== sceneId) throw Error("FINDING_SCENE_MISMATCH");
    if (c.beforeFingerprint !== stamp) {
      reject(c, "STALE_SOURCE_SNAPSHOT");
      continue;
    }
    if (!["preserve", "remove", "replace", "review"].includes(c.action))
      throw Error("UNKNOWN_ACTION");
    if (c.status !== "supported" || c.action === "review") {
      reject(c, c.reason || "SCENE_EVIDENCE_REQUIRED");
      continue;
    }
    if (!before.includes(c.sourceId)) {
      reject(c, "SOURCE_ALREADY_ABSENT");
      continue;
    }
    if (!c.evidence?.length) {
      reject(c, "MISSING_EVIDENCE");
      continue;
    }
    if (c.action === "remove" && !c.removalEstablished) {
      reject(c, "REMOVAL_NOT_ESTABLISHED");
      continue;
    }
    if (c.action === "replace") {
      if (!c.associationEstablished || !c.identityEstablished) {
        reject(c, "REPLACEMENT_NOT_ESTABLISHED");
        continue;
      }
      if (!c.targetId) {
        reject(c, "DESTINATION_CREATION_REQUIRED");
        continue;
      }
      ids([c.targetId]);
      if (!tagMap.has(c.targetId)) {
        reject(c, "UNKNOWN_DESTINATION");
        continue;
      }
      if (c.targetId === c.sourceId) {
        reject(c, "SAME_SOURCE_DESTINATION");
        continue;
      }
      if (c.destinationAmbiguous && !c.canonicalTargetConfirmed) {
        reject(c, "CANONICAL_TARGET_AMBIGUOUS");
        continue;
      }
    }
  }
  const available = () => findings.filter((c) => !rejected.has(c.id));
  for (const sourceId of ids(findings.map((c) => c.sourceId))) {
    const group = available().filter((c) => c.sourceId === sourceId),
      destinations = new Set(
        group.filter((c) => c.action === "replace").map((c) => c.targetId),
      );
    if (destinations.size > 1)
      for (const c of group.filter((c) => c.action === "replace"))
        reject(c, "CONFLICTING_REPLACEMENTS");
    if (
      group.some((c) => c.action === "preserve") &&
      group.some((c) => ["remove", "replace"].includes(c.action))
    )
      for (const c of group.filter((c) => c.action !== "preserve"))
        reject(c, "PRESERVE_REMOVE_CONFLICT");
  }
  // A replacement target cannot also be removed in the same final state.
  const adding = available().filter((c) => c.action === "replace");
  for (const a of adding)
    for (const r of available().filter(
      (c) =>
        ["remove", "replace"].includes(c.action) && c.sourceId === a.targetId,
    )) {
      reject(a, "DESTINATION_REMOVAL_CONFLICT");
      reject(r, "DESTINATION_REMOVAL_CONFLICT");
    }
  const accepted = available(),
    removals = ids(
      accepted
        .filter((c) => ["remove", "replace"].includes(c.action))
        .map((c) => c.sourceId),
    ),
    additions = ids(
      accepted.filter((c) => c.action === "replace").map((c) => c.targetId),
    );
  const after = ids(
    before.filter((id) => !removals.includes(id)).concat(additions),
  );
  const added = after.filter((id) => !before.includes(id)),
    removed = before.filter((id) => !after.includes(id));
  // Stage A only contains independent removals. Reassignment is never split into
  // a destructive removal followed by a speculative future addition.
  const atomicSources = new Set(
    accepted
      .filter((c) => c.action === "replace" && !before.includes(c.targetId))
      .map((c) => c.sourceId),
  );
  const stageARemove = removed.filter((id) => !atomicSources.has(id)),
    stageAAfter = before.filter((id) => !stageARemove.includes(id));
  return {
    sceneId,
    before,
    after,
    removed,
    added,
    beforeFingerprint: stamp,
    observedState: scene,
    stageA: { remove: stageARemove, after: stageAAfter },
    stageB: {
      before: stageAAfter,
      after,
      requiresStageA: stageARemove.length > 0,
      requiresFreshPreview: true,
    },
    accepted: accepted.map((c) => c.id),
    findings,
    conflicts,
    status:
      removed.length || added.length
        ? "candidate"
        : conflicts.length
          ? "review"
          : "no-operation",
    visualVerification: false,
    approval: false,
  };
}
export function reconcileAll({ scenes, candidates, tags }) {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  if (byId.size !== scenes.length) throw Error("DUPLICATE_SCENE_SNAPSHOT");
  return ids(candidates.map((c) => c.sceneId)).map((sceneId) =>
    reconcileScene({
      scene: byId.get(sceneId),
      sceneId,
      candidates: candidates.filter((c) => c.sceneId === sceneId),
      tags,
    }),
  );
}
// A global identity mapping is deliberately not a scene-association certificate.
export function candidateFor({
  scene,
  sourceId,
  targetId = null,
  action,
  decisionId,
  evidence = [],
  associationEstablished = false,
  identityEstablished = false,
  removalEstablished = false,
  status = "review",
  reason = null,
  ...rest
}) {
  return {
    ...rest,
    id: `${decisionId}:${scene.id}:${sourceId}`,
    sceneId: scene.id,
    sourceId,
    targetId,
    action,
    decisionId,
    evidence,
    associationEstablished,
    identityEstablished,
    removalEstablished,
    status,
    reason,
    beforeFingerprint: fingerprint(scene),
  };
}
export function assertFresh(entry, scene) {
  if (!scene || fingerprint(scene) !== entry.beforeFingerprint)
    throw Error("STALE_MANIFEST");
  return true;
}
export function nativeRemovalRequest(entries) {
  if (!entries.length || entries.length > 5)
    throw Error("NATIVE_FIVE_SCENE_LIMIT");
  if (new Set(entries.map((e) => e.sceneId)).size !== entries.length)
    throw Error("DUPLICATE_SCENE");
  const remove = ids(entries.flatMap((e) => e.stageA.remove));
  if (!remove.length || remove.length > 20) throw Error("NATIVE_TAG_LIMIT");
  for (const e of entries) {
    const actual = e.before.filter((id) => !remove.includes(id));
    if (JSON.stringify(actual) !== JSON.stringify(e.stageA.after))
      throw Error("CROSS_SCENE_OPERATION_CONFLICT");
  }
  return {
    sceneIds: entries.map((e) => e.sceneId),
    operations: [{ relationship: "tags", action: "remove", ids: remove }],
  };
}
export function nativeReplacementRequest(entry) {
  const from = entry.stageB.before.filter((id) => !entry.after.includes(id)),
    to = entry.after.filter((id) => !entry.stageB.before.includes(id));
  if (from.length !== 1 || to.length !== 1)
    throw Error("NATIVE_SINGLE_REPLACEMENT_SHAPE");
  return {
    sceneIds: [entry.sceneId],
    operations: [
      { relationship: "tags", action: "replace", fromId: from[0], toId: to[0] },
    ],
  };
}
