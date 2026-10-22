// Fixed translations of the owner's detailSchema 1. No inference from tag names.
export const CHARACTER_DETAIL_REASONS = Object.freeze({
  unregistered:
    "This tag has no direct Characters category and is not in the classifier's registered Character list.",
  ignored:
    "This tag is marked Ignore Auto Tag, so the classifier leaves its category undecided. That does not mean it is not a Character.",
  "conflicting-parents":
    "This tag has both a Characters parent and another parent category. The classifier cannot choose between them.",
  "other-parent":
    "This tag has a parent other than the direct Characters category. The classifier does not infer Character identity through that hierarchy.",
  "conflicting-rules":
    "The classifier's Character and non-Character rules both match this tag. No incorrect assignment has been confirmed.",
  "invalid-reference":
    "The classifier could not read a complete, valid category reference for this tag.",
});

export function characterExplanation(c) {
  const present = c.presence === "present";
  const unavailable = c.completeness === "unknown" || c.completeness == null;
  return {
    category:
      c.presence === "absent"
        ? "metadata-condition"
        : c.completeness === "complete"
          ? "no-confirmed-issue"
          : "classification-limitation",
    headline: present
      ? "Character assigned"
      : c.presence === "absent"
        ? "No Character assigned"
        : unavailable
          ? "Character classification unavailable"
          : "Character category not confirmed",
    note: unavailable
      ? "Current classification could not be checked. Stash AI has not identified a missing or incorrect Character tag."
      : c.completeness === "partial"
        ? (present ? "A Character is recognized. " : "") +
          "Some assigned tags could not be categorized. This is a limitation of Stash AI's Character rules, not a confirmed metadata error." +
          (present
            ? ""
            : " These tags prevent Stash AI from confirming Character absence.")
        : c.presence === "absent"
          ? "There are no assigned tags, or all assigned tags are explicitly classified as non-Characters. This may be intentional."
          : "Character presence is confirmed by the current classification rules.",
    details: (c.unclassifiedTags || []).map((t) => ({
      ...t,
      explanation: CHARACTER_DETAIL_REASONS[t.reason],
    })),
    detailsTruncated: !!c.unclassifiedDetailsTruncated,
    nextStep:
      c.completeness === "partial"
        ? "No metadata correction is necessary just to remove this note. Only categorize these tags if you want them formally recognized."
        : unavailable
          ? "Try refreshing to check classification again."
          : null,
  };
}
