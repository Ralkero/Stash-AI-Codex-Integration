// Strict operator admission. Audit annotations alone are never authority.
import { check, id } from "../../service/validation.mjs";
import {
  EXACT,
  hash,
  same,
  exactIds,
  sourceMatches,
  sceneTags,
  policyReason,
  validateSource,
} from "../../service/exact-character-policy.mjs";
export const definition = (t) =>
  Object.fromEntries(
    ["id", "name", "description", "aliases", "ignore_auto_tag", "parents"].map(
      (k) => [k, t[k]],
    ),
  );
export async function auditedSource({
  audit,
  candidates,
  inventory,
  reassignments,
  completedPairs,
  adapter,
  identity,
  admission,
  owner,
  reference,
  reviewedAt,
}) {
  check(
    candidates.approved === false &&
      candidates.executable === false &&
      reassignments.approved === false,
    "EXACT_AUDIT_NOT_OFFLINE",
  );
  const scenes = new Map(audit.scenes.map((r) => [r.sceneId, r])),
    tags = new Map(inventory.tags.map((t) => [t.id, t]));
  check(
    scenes.size === audit.scenes.length && tags.size === inventory.tags.length,
    "EXACT_DUPLICATE_SOURCE",
  );
  const expected = audit.scenes
    .flatMap((r) =>
      r.findings
        .filter((f) => f.classification === "confirmed-policy-ineligible")
        .map((f) => r.sceneId + ":" + f.sourceId),
    )
    .sort();
  const actual = candidates.scenes
    .flatMap((r) => r.remove.map((t) => r.sceneId + ":" + t))
    .sort();
  check(
    same(expected, actual) &&
      new Set(actual).size === actual.length &&
      new Set(candidates.scenes.map((r) => r.sceneId)).size ===
        candidates.scenes.length,
    "EXACT_AUDIT_SCOPE_MISMATCH",
  );
  check(
    actual.length === candidates.summary.relationships &&
      candidates.scenes.length === candidates.summary.scenes &&
      actual.length === audit.summary.removalRelationships &&
      candidates.scenes.length === audit.summary.removalScenes,
    "EXACT_AUDIT_COUNTS",
  );
  const replacements = new Set(
    reassignments.candidates.map((f) => f.sceneId + ":" + f.sourceId),
  );
  const rows = [],
    excluded = [],
    crosswalk = [];
  const allIds = [...new Set(candidates.scenes.flatMap((r) => r.remove))]
    .map(id)
    .sort((a, b) => Number(a) - Number(b));
  check(allIds.length <= EXACT.maxPairs, "EXACT_SOURCE_LIMIT");
  const defs = [];
  for (let i = 0; i < allIds.length; i += 50)
    defs.push(...(await adapter.definitions(allIds.slice(i, i + 50))));
  const liveTags = new Map(defs.filter(Boolean).map((t) => [t.id, t]));
  for (const c of [...candidates.scenes].sort(
    (a, b) => Number(a.sceneId) - Number(b.sceneId),
  )) {
    id(c.sceneId);
    const a = scenes.get(c.sceneId);
    check(a, "EXACT_UNKNOWN_SCENE");
    const before = exactIds(c.before),
      remove = exactIds(c.remove),
      after = exactIds(c.after);
    check(
      same(before, exactIds(a.before)) &&
        hash(a.observedState) === a.beforeFingerprint &&
        c.beforeFingerprint === a.beforeFingerprint &&
        same(
          after,
          before.filter((t) => !remove.includes(t)),
        ) &&
        same(remove, exactIds(a.stageA.remove)) &&
        same(after, exactIds(a.stageA.after)),
      "EXACT_AUDIT_RECONCILIATION",
    );
    let current = null;
    try {
      current = await adapter.scene(c.sceneId);
    } catch (e) {
      if (e.message !== "SCENE_NOT_FOUND") throw e;
    }
    const evidence = [],
      accepted = [];
    for (const sourceId of remove) {
      id(sourceId);
      const pair = c.sceneId + ":" + sourceId,
        t = tags.get(sourceId),
        live = liveTags.get(sourceId);
      const f = c.findings.find((f) => f.sourceId === sourceId),
        af = a.findings.find((v) => v.id === f?.id && v.sourceId === sourceId);
      check(
        t && f && af && same(f, af) && a.accepted.includes(f.id),
        "EXACT_AUDIT_EVIDENCE_MISMATCH",
      );
      check(
        f.action === "remove" &&
          f.removalEstablished === true &&
          f.targetId === null &&
          f.status === "supported" &&
          f.classification === "confirmed-policy-ineligible" &&
          f.sceneId === c.sceneId &&
          f.beforeFingerprint === c.beforeFingerprint &&
          !replacements.has(pair),
        "EXACT_REASSIGNMENT_EXCLUDED",
      );
      const provenance = f.evidence.find(
        (e) => e.kind === "registry-provenance",
      )?.record;
      const native = f.evidence.find((e) => e.kind === "current-native-tag");
      // The audit's native fingerprint contains its original native fields only.
      const original = Object.fromEntries(
        [
          "id",
          "name",
          "aliases",
          "description",
          "ignore_auto_tag",
          "updated_at",
          "parents",
          "children",
        ].map((k) => [k, t[k]]),
      );
      check(
        native?.tagId === sourceId &&
          native.tagFingerprint === hash(original) &&
          same(provenance, t.identity),
        "EXACT_AUDIT_PROVENANCE",
      );
      check(
        !f.evidence.some((e) => e.kind === "user-decision"),
        "EXACT_POLICY_NOT_INDIVIDUAL_DECISION",
      );
      let reason = null,
        record = null,
        classification = null;
      if (completedPairs.has(pair)) reason = "EXACT_PREVIOUSLY_COMPLETED";
      else if (!current) reason = "SCENE_NOT_FOUND";
      else if (!sceneTags(current).includes(sourceId))
        reason = "EXACT_ALREADY_ABSENT";
      else if (!sourceMatches(a.observedState, current))
        reason = "EXACT_STALE_SOURCE";
      else if (!live || !same(definition(t), live))
        reason = "EXACT_TAG_DEFINITION_CHANGED";
      else {
        const records = identity.resolve(live);
        record = records.length === 1 ? records[0] : null;
        classification = identity.classify(live);
        if (
          !record ||
          !same(record, provenance) ||
          !policyReason(record) ||
          classification.status !== "ineligible" ||
          classification.reason !== policyReason(record) ||
          live.ignore_auto_tag
        )
          reason = "EXACT_POLICY_NOT_VERIFIED";
      }
      const row = {
        sceneId: c.sceneId,
        sourceId,
        status: reason ? "excluded" : "ready",
        reason: reason || classification.reason,
        auditFindingHash: hash(f),
      };
      crosswalk.push(row);
      if (reason) {
        excluded.push(row);
        continue;
      }
      accepted.push(sourceId);
      evidence.push({
        kind: "reviewed-policy-removal-v1",
        action: "remove",
        targetId: null,
        sourceId,
        sceneId: c.sceneId,
        beforeFingerprint: hash(current),
        removalEstablished: true,
        status: "supported",
        reasonCode: classification.reason,
        reason: f.reason,
        policyReference: admission.policy.reference,
        registryHash: admission.registryHash,
        registryRecord: record,
        ownerClassification: classification,
        definition: live,
        definitionHash: hash(live),
        auditFindingHash: hash(f),
        historicalEvidence: f.evidence,
        identityEvidenceIsImportedResearch: true,
        visualAbsenceNotRequired: true,
      });
    }
    if (accepted.length) {
      const b = sceneTags(current);
      rows.push({
        sceneId: c.sceneId,
        before: b,
        remove: accepted,
        after: b.filter((t) => !accepted.includes(t)),
        observedState: current,
        beforeFingerprint: hash(current),
        evidence,
        excluded: a.findings.filter((f) => !accepted.includes(f.sourceId)),
      });
    }
  }
  const source = {
    schema: 2,
    type: EXACT.type,
    owner,
    reference,
    sourceHash: hash(admission.auditHashes),
    reviewedAt,
    admission,
    rows,
    excluded,
    historical: {
      scenes: candidates.scenes.length,
      relationships: actual.length,
      reconciliationFingerprint: hash(audit),
      protectedReassignments: reassignments.candidates.length,
      uncertainRelationships: audit.summary.uncertainRelationships,
    },
  };
  validateSource(source);
  return { source, crosswalk, excluded };
}
