// Trusted operator import only; not registered as a model or HTTP tool.
import { check } from "../../service/validation.mjs";
import {
  EXACT,
  hash,
  same,
  validateSource,
} from "../../service/exact-character-policy.mjs";
export function reviewedSource(
  manifest,
  planA,
  { owner, reference, sourceHash, reviewedAt = Date.now() },
) {
  const audited = [...planA.readyBatch.sceneRows, ...planA.remaining].map(
    (r) => ({ ...r, id: r.id || r.sceneId }),
  );
  check(
    planA.type === "scene-tag-removals" &&
      new Set(audited.map((r) => r.id)).size === audited.length,
    "EXACT_INPUT_INVALID",
  );
  const rows = manifest.scenes
    .filter((r) => r.stageA?.remove.length)
    .map((r) => {
      const a = audited.find((a) => a.id === r.sceneId);
      check(
        a &&
          same(a.before, r.before) &&
          same(a.remove, r.stageA.remove) &&
          same(a.after, r.stageA.after) &&
          a.beforeFingerprint === r.beforeFingerprint,
        "EXACT_RECONCILIATION_MISMATCH",
      );
      const evidence = r.findings.filter(
        (f) =>
          r.accepted.includes(f.id) && r.stageA.remove.includes(f.sourceId),
      );
      const excluded = r.findings.filter((f) => !r.accepted.includes(f.id));
      return {
        sceneId: r.sceneId,
        before: r.before,
        remove: r.stageA.remove,
        after: r.stageA.after,
        observedState: r.observedState,
        beforeFingerprint: r.beforeFingerprint,
        evidence,
        excluded,
      };
    });
  check(rows.length === audited.length, "EXACT_RECONCILIATION_MISMATCH");
  const source = {
    schema: 1,
    type: EXACT.type,
    owner,
    reference,
    sourceHash,
    reviewedAt,
    rows,
    excluded: manifest.scenes.flatMap((r) =>
      r.findings
        .filter((f) => !r.accepted.includes(f.id))
        .map((f) => ({
          sceneId: r.sceneId,
          sourceId: f.sourceId,
          reason: f.reason || "Unresolved evidence",
          decisionId: f.decisionId,
        })),
    ),
    historical: {
      scenes: rows.length,
      relationships: rows.reduce((n, r) => n + r.remove.length, 0),
      reconciliationFingerprint: hash(manifest),
    },
  };
  validateSource(source);
  return source;
}
