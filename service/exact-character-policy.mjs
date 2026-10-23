// Separate from the Franchise allowlist and native five-scene proposals.
import { check, object, id } from "./validation.mjs";
import { hash, same } from "./tag-cleanup-policy.mjs";
export { hash, same };
export const EXACT = Object.freeze({
  schema: 1,
  type: "exact-character-tag-removal",
  maxScenes: 500,
  maxPairs: 1000,
  batch: 5,
  ttl: 86400000,
  challengeTTL: 600000,
  maxPlans: 16,
});
export function exactIds(values) {
  check(Array.isArray(values) && values.length <= 100, "EXACT_IDS_INVALID");
  const result = values.map(id).sort((a, b) => Number(a) - Number(b));
  check(new Set(result).size === result.length, "EXACT_DUPLICATE_ID");
  return result;
}
export const sceneTags = (s) => exactIds(s.tags.map((t) => t.id));
// Playback bookkeeping is not a metadata precondition. No write constructs it.
export function metadata(s) {
  const v = structuredClone(s);
  for (const k of [
    "tags",
    "updated_at",
    "o_counter",
    "play_count",
    "play_duration",
    "last_played_at",
    "resume_time",
  ])
    delete v[k];
  for (const k of ["performers", "galleries"])
    if (v[k]) v[k].sort((a, b) => Number(a.id) - Number(b.id));
  if (v.groups)
    v.groups.sort((a, b) => Number(a.group.id) - Number(b.group.id));
  return v;
}
export function sourceMatches(observed, current) {
  const a = metadata(observed),
    b = metadata(current);
  return (
    same(a, Object.fromEntries(Object.keys(a).map((k) => [k, b[k]]))) &&
    same(sceneTags(observed), sceneTags(current))
  );
}
export function validateSource(s) {
  object(s, [
    "schema",
    "type",
    "owner",
    "reference",
    "sourceHash",
    "reviewedAt",
    "rows",
    "excluded",
    "historical",
    "admission",
  ]);
  check(
    [1, 2].includes(s.schema) &&
      s.type === EXACT.type &&
      typeof s.owner === "string" &&
      s.owner.length > 0,
    "EXACT_SOURCE_INVALID",
  );
  check(
    typeof s.reference === "string" &&
      s.reference.length <= 500 &&
      /^[a-f0-9]{64}$/.test(s.sourceHash) &&
      Number.isFinite(s.reviewedAt),
    "EXACT_SOURCE_INVALID",
  );
  check(
    Array.isArray(s.rows) &&
      s.rows.length > 0 &&
      s.rows.length <= EXACT.maxScenes &&
      Array.isArray(s.excluded),
    "EXACT_SOURCE_LIMIT",
  );
  const seen = new Set();
  if (s.schema === 2) {
    object(s.admission, [
      "kind",
      "policy",
      "auditHashes",
      "registryHash",
      "ownerCodeHash",
    ]);
    check(
      s.admission.kind === "reviewed-policy-audit-v1" &&
        s.admission.policy?.id === "female-identities-only-v1" &&
        s.admission.policy?.reference &&
        /^[a-f0-9]{64}$/.test(s.admission.policy?.documentHash) &&
        /^[a-f0-9]{64}$/.test(s.admission.registryHash) &&
        /^[a-f0-9]{64}$/.test(s.admission.ownerCodeHash) &&
        hash(s.admission.auditHashes) === s.sourceHash,
      "EXACT_POLICY_ADMISSION_INVALID",
    );
  } else check(!s.admission, "EXACT_SOURCE_INVALID");
  let pairs = 0;
  for (const r of s.rows) {
    object(r, [
      "sceneId",
      "before",
      "remove",
      "after",
      "observedState",
      "beforeFingerprint",
      "evidence",
      "excluded",
    ]);
    id(r.sceneId);
    check(!seen.has(r.sceneId), "EXACT_DUPLICATE_SCENE");
    seen.add(r.sceneId);
    const before = exactIds(r.before),
      remove = exactIds(r.remove),
      after = exactIds(r.after);
    check(
      remove.length > 0 &&
        remove.every((t) => before.includes(t)) &&
        same(
          after,
          before.filter((t) => !remove.includes(t)),
        ),
      "EXACT_REMOVAL_ONLY",
    );
    check(
      r.observedState?.id === r.sceneId &&
        same(before, sceneTags(r.observedState)) &&
        hash(r.observedState) === r.beforeFingerprint,
      "EXACT_SOURCE_FINGERPRINT",
    );
    check(
      Array.isArray(r.evidence) && Array.isArray(r.excluded),
      "EXACT_EVIDENCE_REQUIRED",
    );
    for (const tag of remove)
      check(
        s.schema === 2
          ? r.evidence.some((e) => validPolicyEvidence(e, r, tag, s.admission))
          : r.evidence.some(
              (e) =>
                e.sourceId === tag &&
                e.decisionId &&
                e.status === "supported" &&
                e.sceneId === r.sceneId &&
                e.beforeFingerprint === r.beforeFingerprint &&
                e.evidence?.some((v) => v.kind === "user-decision") &&
                ((e.action === "remove" && e.removalEstablished === true) ||
                  (e.action === "replace" &&
                    e.identityEstablished === true &&
                    e.associationEstablished === true &&
                    before.includes(e.targetId) &&
                    after.includes(e.targetId))),
            ),
        "EXACT_REMOVAL_EVIDENCE_REQUIRED",
      );
    check(
      !r.excluded.some((e) => remove.includes(e.sourceId)),
      "EXACT_UNRESOLVED_REMOVAL",
    );
    pairs += remove.length;
  }
  check(pairs <= EXACT.maxPairs, "EXACT_SOURCE_LIMIT");
  return pairs;
}
export function policyReason(record) {
  if (record?.policyApproval || record?.eligibilityHold) return null;
  if (["non-identity", "franchise"].includes(record?.category))
    return "ineligible-" + record.category;
  if (record?.category === "character" && record?.gender === "male")
    return "ineligible-male-character";
  return null; // New policy categories require an explicitly reviewed extension.
}
function validPolicyEvidence(e, r, tag, a) {
  return (
    e.kind === "reviewed-policy-removal-v1" &&
    e.action === "remove" &&
    e.sourceId === tag &&
    e.sceneId === r.sceneId &&
    e.beforeFingerprint === r.beforeFingerprint &&
    e.removalEstablished === true &&
    e.status === "supported" &&
    e.targetId === null &&
    !e.decisionId &&
    e.policyReference === a.policy.reference &&
    e.registryHash === a.registryHash &&
    e.registryRecord?.tagId === tag &&
    e.definition?.id === tag &&
    e.registryRecord?.nativeName === e.definition?.name &&
    !e.definition.ignore_auto_tag &&
    Boolean(policyReason(e.registryRecord)) &&
    e.reasonCode === policyReason(e.registryRecord) &&
    e.ownerClassification?.status === "ineligible" &&
    e.ownerClassification.reason === e.reasonCode &&
    e.registryRecord?.basis &&
    e.registryRecord?.evidence &&
    e.auditFindingHash?.match(/^[a-f0-9]{64}$/) &&
    e.definitionHash === hash(e.definition)
  );
}
export function validateManifest(m) {
  object(m, [
    "schema",
    "type",
    "id",
    "owner",
    "createdAt",
    "expiresAt",
    "source",
    "environment",
    "entries",
    "excluded",
    "counts",
    "definitions",
  ]);
  check(
    m.schema === 1 && m.type === EXACT.type && /^[a-f0-9-]{36}$/.test(m.id),
    "EXACT_MANIFEST_INVALID",
  );
  check(
    Array.isArray(m.entries) &&
      m.entries.length > 0 &&
      m.entries.length <= EXACT.maxScenes,
    "EXACT_MANIFEST_INVALID",
  );
  let pairs = 0;
  const scenes = new Set(),
    ops = new Set();
  for (const e of m.entries) {
    object(e, [
      "operationId",
      "sceneId",
      "before",
      "remove",
      "after",
      "names",
      "label",
      "metadata",
      "metadataHash",
      "sourceFingerprint",
      "evidence",
      "excluded",
    ]);
    id(e.sceneId);
    check(
      !scenes.has(e.sceneId) && !ops.has(e.operationId),
      "EXACT_DUPLICATE_OPERATION",
    );
    scenes.add(e.sceneId);
    ops.add(e.operationId);
    const b = exactIds(e.before),
      r = exactIds(e.remove),
      a = exactIds(e.after);
    check(
      r.length &&
        r.every((t) => b.includes(t)) &&
        same(
          a,
          b.filter((t) => !r.includes(t)),
        ),
      "EXACT_REMOVAL_ONLY",
    );
    check(
      e.operationId === hash({ sceneId: e.sceneId, remove: r }) &&
        e.metadataHash === hash(e.metadata),
      "EXACT_FINGERPRINT_INVALID",
    );
    pairs += r.length;
  }
  check(
    pairs <= EXACT.maxPairs &&
      m.counts.scenes === scenes.size &&
      m.counts.relationships === pairs,
    "EXACT_COUNTS_INVALID",
  );
  return m;
}
