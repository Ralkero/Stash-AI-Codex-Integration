import { check, id } from "./validation.mjs";

// UI-only evidence, never a model tool. No arbitrary input, inference or writes.
// Owner pending results are one candidate page, NOT a library-wide backlog.
export const SUGGESTION_TTL = 60000;
export class Suggestions {
  constructor(stash, adapters, { now = Date.now, insights } = {}) {
    Object.assign(this, { stash, adapters, now, insights });
    this.generation = 0;
  }
  invalidate() {
    this.generation++;
    this.cache = null;
  }
  async get({ refresh = false } = {}) {
    if (!refresh && this.cache && this.now() < this.cache.expiresAt)
      return this.cache;
    if (this.loading) return this.loading;
    this.loading = this.discover().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }
  async discover() {
    if (this.insights) return this.discoverAttention();
    const observedAt = this.now();
    const [review, franchise] = await Promise.allSettled([
      this.adapters.read("descriptors", { pending: true, page: 1, limit: 12 }),
      // Minimal fixed fields, stable order, no titles/private metadata or N+1.
      this.stash.query(
        '{findScenes(filter:{page:1,per_page:3,sort:"id",direction:ASC},scene_filter:{is_missing:"studio"}){count scenes{id studio{id}}}}',
        {},
        { timeoutMs: 8000 },
      ),
    ]);
    const items = [],
      sources = [];
    if (review.status === "fulfilled" && review.value.status === "available") {
      const rows = review.value.scenes;
      sources.push({
        id: "read_descriptor_review",
        state: "available",
        coverage: "First 12 owner candidates only",
      });
      for (const [kind, title, predicate, explanation] of [
        [
          "needs-review",
          "Investigate marked review work",
          (s) => s.autoTaggerNeedsReview === true,
          "Persisted Needs Review flag; the flag does not identify which metadata needs correction.",
        ],
        [
          "descriptor-review",
          "Review descriptor assignments",
          (s) => s.needsDescriptorReview === true && !s.autoTaggerNeedsReview,
          "Owner-defined pending Descriptor Review state. Missing review status is not proof of incorrect tags.",
        ],
      ]) {
        const selected = rows.filter(predicate);
        if (!selected.length) continue;
        const sceneIds = selected.slice(0, 3).map((s) => id(s.sceneId));
        items.push({
          id: kind,
          title,
          category: "review-work",
          source: "read_descriptor_review",
          sceneIds,
          verified: true,
          count: selected.length,
          countScope: "candidate-page-only",
          description: `${selected.length} found in the checked candidate page · Scene${sceneIds.length > 1 ? "s" : ""} #${sceneIds.join(", #")}`,
          trigger: explanation,
          prompt: `Re-read the Descriptor Review status and persisted Needs Review flags for scene IDs ${sceneIds.join(", ")}. Explain the owner evidence and what, if anything, needs attention. Do not infer incorrect tags from missing status or make any changes.`,
        });
      }
    } else
      sources.push({
        id: "read_descriptor_review",
        state: "unavailable",
        coverage: "Not checked",
      });
    try {
      check(franchise.status === "fulfilled");
      const result = franchise.value.findScenes;
      check(
        Number.isSafeInteger(result.count) &&
          result.count >= 0 &&
          Array.isArray(result.scenes) &&
          result.scenes.length <= 3 &&
          result.count >= result.scenes.length,
      );
      const sceneIds = result.scenes.map((s) => {
        check(s.studio === null);
        return id(s.id);
      });
      check(new Set(sceneIds).size === sceneIds.length);
      sources.push({
        id: "native_missing_franchise",
        state: "available",
        coverage: "Exact query count; first 3 IDs",
      });
      if (sceneIds.length)
        items.push({
          id: "missing-franchise",
          title: "Check unassigned Franchise information",
          category: "possible-gap",
          source: "native_missing_franchise",
          sceneIds,
          verified: true,
          count: result.count,
          countScope: "exact-query-total",
          description: `${result.count} scene${result.count === 1 ? "" : "s"} without a Franchise · showing #${sceneIds.join(", #")}`,
          trigger:
            "Native Franchise field is empty. This may be intentional, not an error.",
          prompt: `Re-read scenes ${sceneIds.join(", ")} and check their current Franchise assignments. Explain the missing information without assuming an assignment is required. Do not make changes.`,
        });
    } catch {
      sources.push({
        id: "native_missing_franchise",
        state: "unavailable",
        coverage: "Not checked",
      });
    }
    this.cache = {
      observedAt,
      expiresAt: observedAt + SUGGESTION_TTL,
      items: items.slice(0, 4).map((item) => ({
        ...item,
        observedAt,
        expiresAt: observedAt + SUGGESTION_TTL,
      })),
      sources,
    };
    return this.cache;
  }
  async discoverAttention() {
    const generation = this.generation;
    const [result, gaps] = await Promise.all([
      this.insights.attention({ category: "all", limit: 6 }),
      this.insights.attention({ category: "metadata", limit: 6 }),
    ]);
    const unique = new Map(
      [...result.items, ...gaps.items].map((row) => [row.sceneId, row]),
    );
    const groups = new Map();
    // Each scene belongs to one suggestion; combined evidence stays together.
    for (const row of unique.values()) {
      const key =
        row.priority <= 2
          ? row.evidence[0].category
          : row.evidence.some((e) => e.category === "missing-author")
            ? "missing-author"
            : "metadata-gaps";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const expiresAt =
      generation === this.generation
        ? Math.min(result.expiresAt, gaps.expiresAt)
        : 0;
    const titles = {
      "needs-review": "Investigate marked review work",
      "descriptor-review": "Prioritize descriptor review",
      "missing-author": "Investigate missing Author metadata",
      "metadata-gaps": "Check missing metadata relationships",
    };
    const items = [...groups.entries()].slice(0, 4).map(([key, rows]) => {
      const examples = rows.slice(0, 3),
        sceneIds = examples.map((r) => r.sceneId);
      // Bind each reason to its exact scene: a union of reasons across the card
      // could wrongly imply that every example has all of the same gaps.
      const labels = {
        "needs-review": "owner Needs Review",
        "descriptor-review": "owner pending Descriptor Review",
        "missing-author": "no Author",
        "missing-franchise": "no Franchise",
        "missing-characters": this.insights.characterIdentity
          ? "confirmed Character absence"
          : "no tags (Character-absence subset)",
      };
      const reasons = examples.map(
        (r) =>
          `#${r.sceneId}: ${r.evidence.map((e) => labels[e.category]).join(", ")}.`,
      );
      return {
        id: key,
        title: titles[key],
        category: rows[0].priority <= 2 ? "review-work" : "possible-gap",
        source: "bounded-library-attention",
        sceneIds,
        verified: true,
        count: rows.length,
        countScope: "returned-candidate-sample",
        description: `${rows.length} in this bounded shortlist · Scenes #${sceneIds.join(", #")}`,
        trigger:
          reasons.join(" ") + " Missing relationships may be intentional.",
        observedAt: result.observedAt,
        expiresAt,
        prompt: `Re-read native metadata and available owner Character identity and review state for scenes ${sceneIds.join(", ")}. Explain the verified gaps and outstanding review work for each, preserving uncertainty. Unclassified tags do not prove missing Characters. This is a partial shortlist, not a global backlog. Help me investigate existing metadata; ask before preparing a correction and never assume a shared Author proves a Franchise or Character. Do not change anything.`,
      };
    });
    const data = {
      observedAt: result.observedAt,
      expiresAt,
      items,
      sources: [...result.sources, ...gaps.sources].map((s) => ({
        id: s.id,
        state: s.status,
        coverage: "Bounded candidate pages only",
      })),
    };
    if (generation === this.generation) this.cache = data;
    return data;
  }
}
