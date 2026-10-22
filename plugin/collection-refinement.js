(function () {
  "use strict";
  // Pure presentation policy. No transport, storage, model calls or metadata writes.
  const defaults = () => ({
    character: "all",
    completeness: "all",
    author: "all",
    franchise: "all",
    review: "all",
    condition: "all",
    original: "all",
  });
  const conditions = [
    ["missing-author", "Missing Author"],
    ["missing-franchise", "Missing Franchise"],
    ["missing-characters", "Confirmed Character absence"],
    ["descriptor-review", "Pending Descriptor Review"],
    ["needs-review", "Explicit Needs Review"],
  ];
  function reviewState(scene) {
    if (scene.status !== "available" || !scene.descriptors) return "unknown";
    if (scene.descriptors.needsReview === true) return "pending";
    return scene.descriptors.persistedStatus === "reviewed"
      ? "reviewed"
      : "other";
  }
  function matches(scene, filters, stale = false) {
    const f = { ...defaults(), ...filters };
    const available = !stale && scene.status === "available";
    const relationship = (kind, value) => {
      if (value === "all") return true;
      if (!available) return false;
      const values =
        kind === "author"
          ? scene.authors
          : scene.franchise
            ? [scene.franchise]
            : [];
      if (!Array.isArray(values)) return false;
      if (value === "assigned") return values.length > 0;
      if (value === "missing")
        return !values.length && !(kind === "author" && scene.authorsTruncated);
      return values.some((v) => "id:" + v.id === value);
    };
    const presence = available
      ? scene.characters?.presence || "unknown"
      : "unknown";
    const completeness = available
      ? scene.characters?.completeness || "unknown"
      : "unknown";
    return (
      (f.character === "all" || f.character === presence) &&
      (f.completeness === "all" || f.completeness === completeness) &&
      relationship("author", f.author) &&
      relationship("franchise", f.franchise) &&
      (f.review === "all" ||
        f.review === (stale ? "unknown" : reviewState(scene))) &&
      (f.condition === "all" ||
        (available && scene.currentGaps?.includes(f.condition))) &&
      (f.original === "all" ||
        scene.findings?.some((v) => v.code === f.original))
    );
  }
  // First source file only, not a sum/max over alternate encodes; absent last.
  const duration = (s) =>
    s.status === "available" && Number.isFinite(s.files?.[0]?.duration)
      ? s.files[0].duration
      : null;
  function refine(scenes, filters, sort = "original", stale = false) {
    const rows = scenes
      .map((scene, index) => ({ scene, index }))
      .filter((v) => matches(v.scene, filters, stale));
    rows.sort((a, b) => {
      if (sort === "id-asc" || sort === "id-desc")
        return (
          (Number(a.scene.sceneId) - Number(b.scene.sceneId)) *
          (sort === "id-desc" ? -1 : 1)
        );
      if (sort === "duration-asc" || sort === "duration-desc") {
        const x = stale ? null : duration(a.scene),
          y = stale ? null : duration(b.scene);
        if (x === null || y === null)
          return x === y ? a.index - b.index : x === null ? 1 : -1;
        return (
          (x - y) * (sort === "duration-desc" ? -1 : 1) || a.index - b.index
        );
      }
      return a.index - b.index;
    });
    return rows.map((v) => v.scene);
  }
  function entities(scenes, kind) {
    const values = new Map();
    for (const s of scenes) {
      if (s.status !== "available") continue;
      for (const v of kind === "author"
        ? s.authors || []
        : s.franchise
          ? [s.franchise]
          : [])
        values.set(v.id, { id: v.id, name: v.name });
    }
    return [...values.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || Number(a.id) - Number(b.id),
    );
  }
  function toggle(selected, sceneId, members) {
    if (!members.includes(sceneId) || !/^[1-9]\d{0,11}$/.test(sceneId))
      return selected;
    if (selected.includes(sceneId))
      return selected.filter((v) => v !== sceneId);
    return selected.length < 20 ? [...selected, sceneId] : selected;
  }
  function criteria(filters) {
    return (
      Object.entries({ ...defaults(), ...filters })
        .filter(([, v]) => v !== "all")
        .map(([key, value]) => `${key}=${value}`)
        .join("; ") || "none specified"
    );
  }
  function draft(action, selected, collection, filters) {
    const ids = selected.join(", ");
    const tasks = {
      plan: `Review scenes ${ids} for confirmed metadata gaps, owner-defined review requirements and incomplete evidence. Use review_scenes if available and present its evidence-backed review plan. Explain checks not performed and what needs clarification.`,
      investigate: `Inspect scenes ${ids}. Identify confirmed metadata gaps and outstanding review requirements, distinguishing verified findings from unknown states.`,
      compare: `Compare the Character, Author, Franchise and Descriptor metadata for scenes ${ids}. Explain meaningful differences; differences alone are not inconsistencies.`,
      review: `Check current Descriptor Review and explicit Needs Review status of scenes ${ids}. Explain confirmed outstanding work and unavailable evidence.`,
      related: `Inspect scenes ${ids} and identify supported metadata criteria for a new bounded search. Ask which criteria matter before searching if ambiguous. Do not infer visual or semantic similarity.`,
      refine: `Search Stash again beyond this collection, using existing bounded read tools. Requested local criteria: ${criteria(filters)}. ${ids ? `Selected context scenes: ${ids}. ` : ""}Re-read authoritative state. Explain unsupported criteria rather than silently dropping them; ask for clarification when needed. Historical findings are not current search evidence. Return a new verified collection only from fresh current-turn receipts; preserve partial-page limits and unknown global totals.`,
    };
    if (!tasks[action] || (action !== "refine" && !selected.length))
      return null;
    return {
      text: `${tasks[action]} Read-only: do not prepare or apply changes.`,
      context: {
        type: action === "refine" ? "refinement" : "selection",
        collectionId: collection.id,
        sceneIds: [...selected],
      },
    };
  }
  function correction(sceneId, collection, checkKey) {
    if (!/^[1-9]\d{0,11}$/.test(sceneId)) return null;
    const topic = {
      "missing-author": "missing Author",
      "missing-franchise": "missing Franchise",
      "missing-characters": "Character assignments",
      "character-classification": "incomplete Character classification",
      "descriptor-review": "Descriptor Review requirement",
      "needs-review": "explicit Needs Review requirement",
    }[checkKey];
    if (!topic) return null;
    return {
      text: `Investigate scene ${sceneId}'s ${topic}. Re-read authoritative state; distinguish absence from error and uncertainty. Ask me to confirm the intended existing entity or descriptor when unknown; do not infer it from a shared Author, Franchise or unclassified tag. Only after the intended target is explicit and resolved, prepare the smallest supported existing proposal. Never apply changes. Preserve unrelated metadata and review status. Native proposals allow at most five scenes; Descriptor proposals one scene; do not automatically chain batches.`,
      context: {
        type: "selection",
        collectionId: collection.id,
        sceneIds: [sceneId],
      },
    };
  }
  function preflight(filters, capabilities) {
    const catalog = capabilities?.criteria;
    const fallback = {
      level: "unsupported",
      tool: null,
      note: "Capability information unavailable; verify before searching.",
    };
    return Object.entries({ ...defaults(), ...filters })
      .filter(([, v]) => v !== "all")
      .map(([key, value]) => {
        let capability;
        if (key === "character" || key === "review")
          capability = catalog?.[key]?.[value];
        else if (key === "condition")
          capability = {
            "missing-author": catalog?.author,
            "missing-franchise": catalog?.franchise,
            "missing-characters": catalog?.character?.absent,
            "descriptor-review": catalog?.review?.pending,
            "needs-review": catalog?.needsReview,
          }[value];
        else if (
          ["author", "franchise", "completeness", "original"].includes(key)
        )
          capability = catalog?.[key];
        return { criterion: `${key}=${value}`, ...(capability || fallback) };
      });
  }
  window.StashAICollectionRefinement = Object.freeze({
    defaults,
    conditions,
    reviewState,
    matches,
    refine,
    entities,
    toggle,
    draft,
    correction,
    preflight,
  });
})();
