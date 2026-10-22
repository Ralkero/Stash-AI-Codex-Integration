// Fixed presentation vocabulary. No model-authored labels, prose parsing,
// visual inference, or mutation authority. Future suspicions need owner evidence
// and a new audited code/projection, not an arbitrary warning string.
export const FINDING_REASONS = Object.freeze({
  "missing-author": [
    "No Author assigned",
    "No Author was assigned when checked. You can ask Stash AI to find possible existing Authors and prepare a correction.",
  ],
  "missing-franchise": [
    "No Franchise assigned",
    "No Franchise was assigned when checked. Specify the intended existing Franchise before requesting a correction.",
  ],
  "missing-characters": [
    "No Character assigned",
    "There were no assigned tags, or all assigned tags were explicitly classified as non-Characters. This may be intentional.",
  ],
  "character-unknown": [
    "Character category not confirmed",
    "Some assigned tags could not be categorized when checked. Stash AI has not identified a missing or incorrect Character tag.",
  ],
  "descriptor-review": [
    "Descriptor Review pending",
    "Descriptor Review has not been completed according to its review rules. You can inspect the assigned Descriptors; their presence does not mean the review is complete.",
  ],
  "needs-review": [
    "Marked Needs Review",
    "Auto-Tagger marked this scene Needs Review. No particular incorrect assignment has been identified.",
  ],
});
const selections = Object.freeze({
  review_scenes: [
    "review-inspection",
    "Included in your requested metadata review",
    "This scene was selected for the metadata review. Findings and classification notes are listed separately below.",
  ],
  find_scenes: [
    "search-match",
    "Matches your search",
    "Returned by the scene search used for this response. See the response for the search criteria and page limits.",
  ],
  get_scene: [
    "scene-inspection",
    "Requested scene inspection",
    "Included in the individual scene inspection used for this response.",
  ],
  get_scene_characters: [
    "character-inspection",
    "Character metadata inspection",
    "Included in the Character inspection used for this response. Classification notes are separate from metadata problems.",
  ],
  read_descriptor_review: [
    "descriptor-inspection",
    "Descriptor metadata inspection",
    "Included in the owner Descriptor Review read used for this response.",
  ],
  read_variant_family: [
    "variant-member",
    "Declared Variant family member",
    "Returned as a consistent declared member of the inspected Variant Set; this is not full-family validation.",
  ],
  find_library_attention_items: [
    "attention-inspection",
    "Included in attention results",
    "Returned by the bounded attention check; no more specific historical reason is available.",
  ],
});

export function findingReasons(collection, row, findings, characters) {
  const original = row.findings.filter((code) =>
    Object.hasOwn(FINDING_REASONS, code),
  );
  return original.map((code) => ({
    code,
    label: FINDING_REASONS[code][0],
    explanation: FINDING_REASONS[code][1],
    basis: "original",
    evidence: code === "character-unknown" ? "unknown" : "verified-observation",
    observedAt: collection.observedAt,
    current: findings.find((f) => f.code === code)?.current || "unverified",
    category:
      code === "character-unknown"
        ? "classification-limitation"
        : ["descriptor-review", "needs-review"].includes(code)
          ? "review-requirement"
          : "metadata-condition",
    currentText: currentFindingText(
      code,
      findings.find((f) => f.code === code)?.current,
      characters,
    ),
  }));
}
export function currentFindingText(code, state, characters) {
  if (!state || state === "unverified")
    return code === "character-unknown"
      ? "Current classification could not be checked."
      : "Current metadata could not be checked.";
  if (code === "character-unknown")
    return state === "still-present"
      ? "Checked again: some tags are still unclassified. No missing or incorrect Character tag has been confirmed."
      : characters?.presence === "present"
        ? "Checked again: a Character is recognized." +
          (characters.completeness === "partial"
            ? " Some other tags remain unclassified."
            : "")
        : "Checked again: Character absence can now be assessed. This does not establish who changed the metadata.";
  if (state === "no-longer-present")
    return "Checked again: this condition was not found. This does not establish who changed the metadata.";
  return (
    {
      "missing-author": "Checked again: no Author is assigned.",
      "missing-franchise": "Checked again: no Franchise is assigned.",
      "missing-characters": "Checked again: no Character assignment was found.",
      "descriptor-review": "Checked again: Descriptor Review is still pending.",
      "needs-review": "Checked again: this scene is still marked Needs Review.",
    }[code] || "Current metadata could not be checked."
  );
}
export function sceneReasons(collection, row, findings) {
  // Only attention-tool findings describe why an issue-focused result was selected.
  // Incidental gaps/limitations never replace a search or requested-review reason.
  if (collection.sourceTool === "find_library_attention_items") {
    const reasons = findingReasons(collection, row, findings).filter(
      (r) => r.category !== "classification-limitation",
    );
    if (reasons.length) return reasons;
  }
  const [code, label, explanation] = selections[collection.sourceTool] || [
    "selected-result",
    "Included in verified results",
    "Returned by the verified read used for this response; no more specific historical reason was recorded.",
  ];
  return [
    {
      code,
      label,
      explanation,
      basis: "selection",
      evidence: code === "search-match" ? "search-match" : "selection",
      observedAt: collection.observedAt,
    },
  ];
}
