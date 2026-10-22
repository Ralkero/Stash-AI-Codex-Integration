import { check, object } from "./validation.mjs";

// Fixed evidence vocabulary; neither model arguments nor metadata labels can
// create findings, select authorities, or assert a correction target.
export const REVIEW_CHECKS = Object.freeze({
  "missing-author": {
    label: "Author assignment",
    category: "gap",
    authority: "native",
    next: "clarification",
  },
  "missing-franchise": {
    label: "Franchise assignment",
    category: "gap",
    authority: "native",
    next: "clarification",
  },
  "missing-characters": {
    label: "Character assignment",
    category: "gap",
    authority: "character-owner-or-zero-tags",
    next: "clarification",
  },
  "character-classification": {
    label: "About Character classification",
    category: "uncertainty",
    authority: "character-owner-or-zero-tags",
    next: "information",
  },
  "descriptor-review": {
    label: "Pending Descriptor Review",
    category: "owner-review",
    authority: "descriptor-owner",
    next: "investigation",
  },
  "needs-review": {
    label: "Explicit Needs Review",
    category: "owner-review",
    authority: "descriptor-owner",
    next: "investigation",
  },
});
export const REVIEW_LIMITATIONS = [
  "Absence may be intentional; no intended correction value is inferred.",
  "Character taxonomy is incomplete. Unknown classification is not absence or an incorrect tag.",
  "Variant consistency, semantic correctness and browser-only review drafts were not checked by this plan.",
  "Native and owner reads are timestamp-checked but are not an atomic snapshot.",
  "No metadata changed. Review completion and learned corrections cannot be edited here.",
];
export function assessScene(scene) {
  const available = scene.status === "available";
  const conditions = {
    "missing-author":
      available && Array.isArray(scene.authors)
        ? scene.authors.length
          ? false
          : scene.authorsTruncated
            ? null
            : true
        : null,
    "missing-franchise": available ? scene.franchise === null : null,
    "missing-characters":
      available && ["present", "absent"].includes(scene.characters?.presence)
        ? scene.characters.presence === "absent"
        : null,
    "character-classification":
      available &&
      ["complete", "partial"].includes(scene.characters?.completeness)
        ? scene.characters.completeness === "partial"
        : null,
    "descriptor-review": available
      ? (scene.descriptors?.needsReview ?? null)
      : null,
    "needs-review": available
      ? (scene.descriptors?.autoTaggerNeedsReview ?? null)
      : null,
  };
  return {
    schema: 1,
    checks: Object.entries(REVIEW_CHECKS).map(([key, definition]) => ({
      key,
      state:
        conditions[key] == null
          ? "unknown"
          : conditions[key]
            ? "observed"
            : "not-observed",
      authority: definition.authority,
    })),
  };
}
export function validateReview(review) {
  object(review, ["schema", "checks"]);
  check(
    review.schema === 1 &&
      Array.isArray(review.checks) &&
      review.checks.length === Object.keys(REVIEW_CHECKS).length,
    "REVIEW_INVALID",
  );
  const seen = new Set();
  for (const c of review.checks) {
    object(c, ["key", "state", "authority"]);
    check(
      Object.hasOwn(REVIEW_CHECKS, c.key) &&
        !seen.has(c.key) &&
        c.authority === REVIEW_CHECKS[c.key].authority &&
        ["observed", "not-observed", "unknown"].includes(c.state),
      "REVIEW_INVALID",
    );
    seen.add(c.key);
  }
  return review;
}
export function reviewSummary(rows) {
  const has = (row, predicate) => row.review.checks.some(predicate);
  return {
    inspected: rows.length,
    confirmedGaps: rows.filter((r) =>
      has(
        r,
        (c) =>
          c.state === "observed" && REVIEW_CHECKS[c.key].category === "gap",
      ),
    ).length,
    ownerReview: rows.filter((r) =>
      has(
        r,
        (c) =>
          c.state === "observed" &&
          REVIEW_CHECKS[c.key].category === "owner-review",
      ),
    ).length,
    incompleteEvidence: rows.filter((r) =>
      has(
        r,
        (c) =>
          c.state === "unknown" ||
          (c.key === "character-classification" && c.state === "observed"),
      ),
    ).length,
    incompleteClassification: rows.filter((r) =>
      has(
        r,
        (c) => c.key === "character-classification" && c.state === "observed",
      ),
    ).length,
    possibleIssues: 0, // No existing trusted mismatch signal; never manufacture one.
    noConfirmedIssue: rows.filter(
      (r) =>
        !has(
          r,
          (c) =>
            c.state === "observed" &&
            REVIEW_CHECKS[c.key].category !== "uncertainty",
        ),
    ).length,
    countsOverlap: true,
  };
}
export function reviewFeedback(original, current, originalAt, observedAt) {
  validateReview(original);
  const fresh = assessScene(current);
  return {
    originalAt,
    observedAt,
    checks: original.checks.map((before) => {
      const now = fresh.checks.find((c) => c.key === before.key);
      const definition = REVIEW_CHECKS[before.key];
      return {
        ...before,
        ...definition,
        label: definition.label,
        historicalText: reviewText(before.key, before.state, true),
        currentText:
          now.state === "unknown" &&
          ["missing-characters", "character-classification"].includes(
            now.key,
          ) &&
          !["complete", "partial"].includes(current.characters?.completeness)
            ? "Current classification could not be checked."
            : reviewText(now.key, now.state, false),
        nextStep: reviewNext(now.key, now.state),
        originalState: before.state,
        currentState: now.state,
        outcome:
          now.state === "unknown"
            ? "current-unavailable"
            : before.state === "unknown"
              ? "new-observation"
              : before.state === "observed"
                ? now.state === "observed"
                  ? "still-observed"
                  : "no-longer-observed"
                : now.state === "observed"
                  ? "newly-observed"
                  : "not-observed",
        action:
          now.state === "unknown"
            ? "information"
            : now.state === "observed"
              ? definition.next
              : "none",
      };
    }),
  };
}

// Technical states remain in expanded evidence. Normal cards use these fixed,
// factual statements; a classifier limitation is never an unresolved defect.
export function reviewText(key, state, historical = false) {
  const prefix = historical
    ? "At the time of this review: "
    : "Checked again: ";
  if (state === "unknown")
    return (
      prefix +
      (key.startsWith("character") || key === "missing-characters"
        ? "Character classification could not confirm this check. No missing or incorrect Character tag was established."
        : "this check could not be completed.")
    );
  const statements = {
    "missing-author": ["no Author was assigned.", "an Author was assigned."],
    "missing-franchise": [
      "no Franchise was assigned.",
      "a Franchise was assigned.",
    ],
    "missing-characters": [
      "no Character assignment was found.",
      "a Character assignment was recognized.",
    ],
    "character-classification": [
      "some assigned tags could not be categorized. This is a classification limitation, not a confirmed metadata error.",
      "all assigned tags could be categorized by the current rules.",
    ],
    "descriptor-review": [
      "Descriptor Review had not been completed according to its review rules.",
      "Descriptor Review was not reported as pending. This alone does not prove review completion.",
    ],
    "needs-review": [
      "this scene was marked Needs Review.",
      "no Needs Review flag was reported.",
    ],
  };
  return prefix + statements[key][state === "observed" ? 0 : 1];
}
function reviewNext(key, state) {
  if (key === "character-classification")
    return "No metadata correction is necessary just to remove a classification note.";
  if (state === "unknown")
    return "Refresh or inspect the available evidence before deciding whether anything needs changing.";
  if (state !== "observed") return "No correction is suggested by this check.";
  return {
    "missing-author":
      "You can ask Stash AI to find possible existing Authors and prepare a correction.",
    "missing-franchise":
      "Specify the intended existing Franchise before requesting a correction.",
    "missing-characters":
      "If a Character should be assigned, specify the intended existing tag before requesting a correction.",
    "descriptor-review":
      "You can inspect the assigned Descriptors. Editing them does not complete the review workflow.",
    "needs-review":
      "Inspect why the scene was marked for review before deciding on any correction.",
  }[key];
}

// Journal status is evidence about an operation, not a claim that every finding
// is resolved. Return no values, integrity tokens, or executable commands.
export function operationFeedback(proposals, sceneId, now = Date.now()) {
  return proposals
    .filter((p) => p.rows.some((r) => r.id === sceneId))
    .slice(-3)
    .reverse()
    .map((p) => {
      const status =
        p.status === "pending" && p.expiresAt <= now ? "expired" : p.status;
      const row = p.rows.find((r) => r.id === sceneId);
      const result = p.results?.find((r) => r.id === sceneId);
      return {
        id: p.id,
        status,
        sceneStatus:
          result?.status ||
          (row.outcome && row.outcome !== "eligible"
            ? row.outcome
            : Array.isArray(p.results)
              ? "not-executed"
              : status),
        kind: p.kind === "descriptor" ? "descriptor" : "native",
      };
    });
}
