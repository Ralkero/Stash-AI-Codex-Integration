import { createHash } from "node:crypto";
import { assessScene, REVIEW_CHECKS } from "./review-policy.mjs";

// Relevant field evidence only: updated_at, titles, paths and screenshots are
// deliberately excluded. The version prevents silently reusing changed policy.
export function evidenceHash(key, value) {
  return createHash("sha256")
    .update(JSON.stringify([1, key, value]))
    .digest("hex");
}
export function sceneEvidence(native, identity, review, versions) {
  const tags = [...native.tags]
    .map((t) => [t.id, t.name])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const result = {
    "missing-author": evidenceHash(
      "missing-author",
      native.groups.map((g) => [g.group.id, g.scene_index]).sort(),
    ),
    "missing-franchise": evidenceHash(
      "missing-franchise",
      native.studio?.id || null,
    ),
  };
  if (!tags.length)
    result["missing-characters"] = evidenceHash("missing-characters", [
      "zero-tags",
    ]);
  else if (identity?.completeness === "complete")
    result["missing-characters"] = evidenceHash("missing-characters", [
      versions.characters,
      tags,
      identity.presence,
      identity.characterTagIds,
    ]);
  // Bounded detail may not identify every uncertain tag. Do not silently make
  // an enduring acknowledgement when the full relevant cause is unavailable.
  if (identity?.detailSchema === 1 && !identity.unclassifiedDetailsTruncated)
    result["character-classification"] = evidenceHash(
      "character-classification",
      [
        versions.characters,
        tags,
        identity.presence,
        identity.completeness,
        identity.unclassifiedTags,
      ],
    );
  if (review && !review.descriptorsTruncated) {
    result["descriptor-review"] = evidenceHash("descriptor-review", [
      versions.descriptors,
      review.needsDescriptorReview,
      review.persistedStatus,
      review.descriptors,
    ]);
    result["needs-review"] = evidenceHash("needs-review", [
      versions.descriptors,
      review.autoTaggerNeedsReview,
    ]);
  }
  return result;
}
const actions = {
  "missing-author": [
    "Investigate missing Author",
    "No Author is assigned. Find the appropriate existing Author or confirm that this field is intentionally blank.",
    "investigation",
    "Investigate the missing Author. Recheck current metadata and identify possible existing Authors using evidence; ask me to confirm the intended assignment before preparing changes.",
  ],
  "missing-franchise": [
    "Investigate missing Franchise",
    "No Franchise is assigned. Check which existing Franchise belongs here before preparing a correction.",
    "investigation",
    "Investigate the missing Franchise. Recheck current metadata and identify possible existing Franchises using evidence; ask me to confirm the intended assignment before preparing changes. Do not infer a Franchise from the Author alone.",
  ],
  "missing-characters": [
    "Review Character assignments",
    "No Character assignment was found under the verified rules. Confirm whether this is intentional or identify the appropriate existing Characters.",
    "investigation",
    "Review the confirmed absence of Character assignments. Recheck the owner evidence and ask whether this is intentional before proposing any specific existing tag.",
  ],
  "character-classification": [
    "Check tag classification",
    "Some assigned tags cannot be categorized. This is not a confirmed metadata error; no correction is needed just to remove this note.",
    "optional clarification",
    "Explain the unclassified tags using current owner evidence. Do not treat uncertainty as missing or incorrect Characters, or suggest removing tags just to clear this note.",
  ],
  "descriptor-review": [
    "Review assigned Descriptors",
    "Descriptor Review reports outstanding work. Inspect assigned Descriptors to decide whether any correction is needed. Stash AI cannot complete the owner's review workflow.",
    "review",
    "Inspect the assigned Descriptors and pending Descriptor Review. Explain the owner's available evidence; do not mark review complete or prepare changes without my explicit request.",
  ],
  "needs-review": [
    "Investigate review flag",
    "This scene is marked Needs Review. Check why it was flagged before deciding whether anything should change.",
    "review",
    "Investigate the Needs Review flag using available owner evidence. Do not infer an incorrect Character or Descriptor and do not clear the flag.",
  ],
};

export function recommendations(scene, decisions, owner, observedAt) {
  const checks = assessScene(scene).checks;
  const states = decisions?.states(owner, scene) || [];
  const rows = checks
    .filter((c) => c.state === "observed")
    .map((c) => {
      const [title, explanation, category, draft] = actions[c.key];
      const decision = states.find((d) => d.key === c.key);
      const acknowledged = decision?.state === "active";
      return {
        key: c.key,
        sceneId: scene.sceneId,
        authority: c.authority,
        title: acknowledged
          ? `${REVIEW_CHECKS[c.key].label} — No action needed`
          : title,
        explanation: acknowledged
          ? "You reviewed this exact condition. No action requested in Stash AI; the underlying metadata and owner review status have not changed."
          : c.key === "character-classification" &&
              scene.characters?.presence === "present"
            ? "No Character correction recommended: a Character assignment is recognized. Some additional tags are unclassified; explanation is optional."
            : explanation,
        category: acknowledged ? "no change" : category,
        evidenceStatus: "current",
        observedAt,
        clarificationRequired: !acknowledged && category === "investigation",
        capability:
          "read; metadata previews require a separate explicit request and approval",
        draft: acknowledged ? null : `For scene ${scene.sceneId}: ${draft}`,
        fingerprint: scene.reviewEvidence?.[c.key] || null,
        canAcknowledge:
          !acknowledged &&
          Boolean(scene.reviewEvidence?.[c.key]) &&
          decisions?.available === true,
        decision: decision || null,
      };
    });
  // Keep historical decisions visible even if the current condition disappeared
  // or cannot be checked. They do not suppress new/unverified recommendations.
  const prior = states.filter((d) => !rows.some((r) => r.key === d.key));
  const noConfirmed = !checks.some(
    (c) =>
      c.state === "observed" && REVIEW_CHECKS[c.key].category !== "uncertainty",
  );
  return {
    schema: 1,
    rows,
    prior,
    summary:
      scene.status !== "available"
        ? "Current scene evidence could not be checked. Recheck before deciding on any change."
        : noConfirmed
          ? "No metadata changes recommended based on the checks performed."
          : rows.every((r) => r.category === "no change")
            ? "No action requested for the reviewed findings. Factual checks and owner review totals are unchanged."
            : null,
    incomplete: checks.some((c) => c.state === "unknown"),
    decisionStorage:
      decisions?.available === false
        ? "Saved decisions are unavailable; they have not been erased. Recheck them before acting on these recommendations."
        : null,
  };
}
