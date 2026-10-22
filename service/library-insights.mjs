import { object, check, id, integer, choice } from "./validation.mjs";

export const INSIGHT_TTL = 60000;
const FIELDS = "id created_at studio{id} groups{group{id}} tags{id}";
const METRICS = [
  [
    "scenes",
    "Scenes",
    "Native findScenes count.",
    "{findScenes(filter:{per_page:1}){count}}",
    "findScenes",
  ],
  [
    "author",
    "Author coverage",
    "Scenes with at least one native Group relationship, divided by all scenes. Same relationship definition as Library Health; independently counted.",
    "{findScenes(filter:{per_page:1},scene_filter:{groups:{modifier:NOT_NULL}}){count}}",
    "findScenes",
  ],
  [
    "franchise",
    "Franchise coverage",
    "Scenes with a native Studio relationship, divided by all scenes. Same relationship definition as Library Health; independently counted.",
    "{findScenes(filter:{per_page:1},scene_filter:{studios:{modifier:NOT_NULL}}){count}}",
    "findScenes",
  ],
  [
    "audio",
    "Audio items",
    "Native findAudios count, not a scene count.",
    "{findAudios(filter:{per_page:1}){count}}",
    "findAudios",
  ],
];
const unknownMetrics = [
  [
    "characters",
    "Character coverage",
    "Unavailable: Library Health uses the browser More Like This identity adapter. Any-tag coverage is not Character coverage.",
  ],
  [
    "descriptors",
    "Descriptor coverage / global review backlog",
    "Unavailable globally without a scan. Use bounded owner-defined attention pages; descriptor presence is not completion.",
  ],
  [
    "variants",
    "Global Variant inconsistencies",
    "Unavailable without full graph validation; use read_variant_family for a specific scene.",
  ],
];
function safeCount(value) {
  check(Number.isSafeInteger(value) && value >= 0, "INVALID_METRIC");
  return value;
}
function criteria(input, characterIdentity = false) {
  object(input, [
    "category",
    "missing",
    "present",
    "createdAfter",
    "page",
    "limit",
  ]);
  const category = choice(input.category ?? "all", [
    "all",
    "metadata",
    "descriptor-review",
    "needs-review",
  ]);
  const result = {
    category,
    page: integer(input.page ?? 1, 1, 10000),
    limit: integer(input.limit ?? 10, 1, 20),
  };
  for (const key of ["missing", "present"]) {
    const values = input[key] ?? [];
    check(
      Array.isArray(values) &&
        values.length <= (key === "present" && characterIdentity ? 5 : 3) &&
        new Set(values).size === values.length,
    );
    result[key] = values.map((v) =>
      choice(
        v,
        key === "missing"
          ? ["franchise", "author", "characters"]
          : characterIdentity
            ? ["franchise", "author", "characters", "descriptors", "tags"]
            : ["franchise", "author"],
      ),
    );
  }
  check(!result.missing.some((v) => result.present.includes(v)));
  if (input.createdAfter !== undefined) {
    check(
      typeof input.createdAfter === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(input.createdAfter) &&
        new Date(input.createdAfter).toISOString().slice(0, 10) ===
          input.createdAfter,
    );
    result.createdAfter = input.createdAfter;
  }
  return result;
}
function filters(c, characterIdentity = false) {
  const clauses = [];
  const native = {
    franchise: "studios",
    author: "groups",
    characters: "tags",
    tags: "tags",
  };
  for (const field of c.missing)
    if (!characterIdentity || field !== "characters")
      clauses.push({ [native[field]]: { modifier: "IS_NULL" } });
  for (const field of c.present)
    if (native[field] && (!characterIdentity || field !== "characters"))
      clauses.push({ [native[field]]: { modifier: "NOT_NULL" } });
  if (c.createdAfter)
    clauses.push({
      created_at: { modifier: "GREATER_THAN", value: c.createdAfter },
    });
  if (!characterIdentity && !c.missing.length && c.category === "metadata")
    clauses.push({
      studios: { modifier: "IS_NULL" },
      OR: {
        groups: { modifier: "IS_NULL" },
        OR: { tags: { modifier: "IS_NULL" } },
      },
    });
  return clauses.reduceRight(
    (AND, value) => (Object.keys(AND).length ? { ...value, AND } : value),
    {},
  );
}

// No persistent cache, browser bridge, whole-library loop, inference or mutations.
export class LibraryInsights {
  constructor(
    stash,
    adapters,
    { now = Date.now, timeoutMs = 8000, characterIdentity = false } = {},
  ) {
    Object.assign(this, { stash, adapters, now, timeoutMs, characterIdentity });
    this.generation = 0;
  }
  invalidate() {
    this.generation++;
    if (this.cache) this.cache.expiresAt = 0;
  }
  async bounded(work) {
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("SOURCE_TIMEOUT")),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  query(query, variables = {}) {
    return this.bounded(
      this.stash.query(query, variables, { timeoutMs: this.timeoutMs }),
    );
  }
  async health(args = {}) {
    object(args, ["refresh"]);
    check(args.refresh === undefined || typeof args.refresh === "boolean");
    if (this.loading) return this.loading;
    if (this.cache && !args.refresh) return this.projectCache(true);
    const generation = this.generation;
    this.loading = this.measure(generation).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }
  projectCache(cached) {
    const stale = this.now() >= this.cache.expiresAt;
    return {
      ...this.cache,
      status: stale ? "stale" : this.cache.status,
      freshness: stale ? "stale" : "fresh",
      cached,
      metrics: this.cache.metrics.map((m) => ({
        ...m,
        freshness: stale ? "stale" : "fresh",
        cached,
      })),
    };
  }
  async measure(generation) {
    const observationStart = new Date(this.now()).toISOString();
    const values = await Promise.allSettled(
      METRICS.map(async ([, , , query, field]) =>
        safeCount((await this.query(query))[field].count),
      ),
    );
    const total = values[0].status === "fulfilled" ? values[0].value : null;
    const observedAt = this.now();
    const metrics = METRICS.map(([identifier, displayName, definition], i) => {
      const coverage = ["author", "franchise"].includes(identifier);
      const good = values[i].status === "fulfilled";
      const numerator = good ? values[i].value : null;
      const valid =
        good && (!coverage || (total !== null && numerator <= total));
      return {
        id: identifier,
        displayName,
        definition,
        source: "native GraphQL (not the Library Health dashboard snapshot)",
        numerator,
        denominator: coverage ? total : null,
        value: valid
          ? coverage
            ? total
              ? numerator / total
              : null
            : numerator
          : null,
        unit: coverage ? "ratio" : "items",
        status: valid ? "complete" : "failed",
        countScope: "exact-query-total",
        observedAt,
        reason: !valid
          ? "source_unavailable_or_non_atomic_count_mismatch"
          : coverage && total === 0
            ? "zero_denominator"
            : null,
      };
    });
    for (const [identifier, displayName, definition] of unknownMetrics)
      metrics.push({
        id: identifier,
        displayName,
        definition:
          identifier === "characters" && this.characterIdentity
            ? "Unavailable globally: owner explicit Character rules do not classify all tags. A bounded scene reader cannot supply an exact whole-library denominator/numerator without a scan and complete taxonomy."
            : definition,
        source: "browser owner / no bounded global API",
        numerator: null,
        denominator: null,
        value: null,
        status: "unavailable",
        countScope: "unknown",
        observedAt,
      });
    this.cache = {
      provider: "bounded-native-summary",
      dashboardSnapshot: false,
      status: metrics.some((m) => m.status === "complete")
        ? "partial"
        : "failed",
      observationStart,
      observationEnd: new Date(this.now()).toISOString(),
      observedAt,
      expiresAt: generation === this.generation ? observedAt + INSIGHT_TTL : 0,
      atomic: false,
      metrics,
      note: "Independent count queries, not a database-atomic snapshot. No full recalculation. Missing relationships may be intentional. refresh:true explicitly remeasures these cheap counts.",
    };
    return this.projectCache(false);
  }
  async native(c, sceneIds) {
    let data;
    const fieldsForContract =
      FIELDS + (this.characterIdentity ? " updated_at" : "");
    if (sceneIds) {
      if (!sceneIds.length) return { count: 0, scenes: [] };
      check(sceneIds.length <= 20);
      const declarations = sceneIds.map((_, i) => `$id${i}:ID!`).join(",");
      const fields = sceneIds
        .map((_, i) => `s${i}:findScene(id:$id${i}){${fieldsForContract}}`)
        .join(" ");
      data = {
        scenes: Object.values(
          await this.query(
            `query(${declarations}){${fields}}`,
            Object.fromEntries(sceneIds.map((v, i) => [`id${i}`, id(v)])),
          ),
        ).filter(Boolean),
      };
      check(data.scenes.every((s) => sceneIds.includes(s.id)));
    } else {
      const response = await this.query(
        `query($filter:FindFilterType!,$scene:SceneFilterType!){findScenes(filter:$filter,scene_filter:$scene){count scenes{${fieldsForContract}}}}`,
        {
          filter: {
            page: c.page,
            per_page: 20,
            sort: "created_at",
            direction: "DESC",
          },
          scene: filters(c, this.characterIdentity),
        },
      );
      data = response.findScenes;
      safeCount(data.count);
    }
    check(Array.isArray(data.scenes) && data.scenes.length <= 20);
    const seen = new Set();
    for (const s of data.scenes) {
      id(s.id);
      check(!seen.has(s.id));
      seen.add(s.id);
      check(
        typeof s.created_at === "string" &&
          Number.isFinite(Date.parse(s.created_at)),
      );
      check(s.studio === null || typeof s.studio?.id === "string");
      if (s.studio) id(s.studio.id);
      check(Array.isArray(s.groups) && Array.isArray(s.tags));
      if (this.characterIdentity)
        check(
          typeof s.updated_at === "string" &&
            Number.isFinite(Date.parse(s.updated_at)),
        );
      for (const g of s.groups) id(g.group?.id);
      for (const t of s.tags) id(t.id);
    }
    return data;
  }
  async review(args) {
    try {
      return await this.bounded(this.adapters.read("descriptors", args));
    } catch {
      return { status: "unavailable", reason: "owner_unavailable_or_timeout" };
    }
  }
  async attention(input = {}) {
    const c = criteria(input, this.characterIdentity),
      observedAt = this.now(),
      generation = this.generation;
    const sources = [],
      rows = new Map(),
      reviews = new Map();
    const ownerPage =
      c.category === "all" ||
      (c.category === "descriptor-review" &&
        !c.missing.length &&
        !c.present.length &&
        !c.createdAfter);
    // All/metadata/native-filtered intersections inspect one newest-first native
    // page. Unfiltered descriptor requests use the owner's candidate pagination.
    const nativePage = c.category !== "descriptor-review" || !ownerPage;
    let nativeCount = null,
      hasMore = false,
      scanned = 0;
    if (nativePage) {
      try {
        const n = await this.native(c);
        nativeCount = n.count;
        scanned += n.scenes.length;
        hasMore ||= c.page * 20 < n.count;
        for (const s of n.scenes) rows.set(s.id, s);
        sources.push({
          id: "native",
          status: "available",
          count: n.count,
          countScope: "exact-native-filter-count",
        });
        if (n.scenes.length) {
          const r = await this.review({ sceneIds: n.scenes.map((s) => s.id) });
          sources.push({ id: "owner-native-page", status: r.status });
          if (r.status === "available")
            for (const s of r.scenes) reviews.set(s.sceneId, s);
        }
      } catch {
        sources.push({ id: "native", status: "unavailable" });
      }
    }
    if (ownerPage) {
      const r = await this.review({ pending: true, page: c.page, limit: 20 });
      sources.push({
        id: "owner-candidate-page",
        status: r.status,
        countScope: "candidate-page-only",
      });
      if (r.status === "available") {
        scanned += r.scanned;
        hasMore ||= r.hasMore;
        for (const s of r.scenes) reviews.set(s.sceneId, s);
        try {
          const n = await this.native(
            c,
            r.scenes.map((s) => s.sceneId).filter((v) => !rows.has(v)),
          );
          for (const s of n.scenes) rows.set(s.id, s);
        } catch {
          sources.push({ id: "owner-native-join", status: "unavailable" });
        }
      }
    }
    const characters = new Map();
    if (this.characterIdentity) {
      const sceneIds = [...rows.keys()];
      // At most two owner batches, each <=20 IDs, never a catalog/library scan.
      for (let offset = 0; offset < sceneIds.length; offset += 20) {
        try {
          const r = await this.bounded(
            this.adapters.read("characters", {
              sceneIds: sceneIds.slice(offset, offset + 20),
            }),
          );
          sources.push({
            id: "character-identity-" + offset,
            status: r.status,
          });
          if (r.status === "available")
            for (const s of r.scenes) characters.set(s.sceneId, s);
        } catch {
          sources.push({
            id: "character-identity-" + offset,
            status: "unavailable",
          });
        }
      }
    }
    const items = [];
    let characterUnknownCandidates = 0;
    for (const s of rows.values()) {
      const r = reviews.get(s.id),
        gaps = [];
      const identity = characters.get(s.id);
      // A scene edited between the two reads cannot support a joined conclusion.
      const trustedIdentity =
        identity?.status === "available" &&
        identity.updatedAt === s.updated_at &&
        identity.assignedTagCount === s.tags.length
          ? identity
          : null;
      const characterPresence = !s.tags.length
        ? "absent"
        : (trustedIdentity?.presence ?? "unknown");
      if (this.characterIdentity && characterPresence === "unknown")
        characterUnknownCandidates++;
      if (!s.studio) gaps.push("franchise");
      if (!s.groups.length) gaps.push("author");
      if (
        this.characterIdentity ? characterPresence === "absent" : !s.tags.length
      )
        gaps.push("characters");
      const present = {
        author: !!s.groups.length,
        franchise: !!s.studio,
        tags: !!s.tags.length,
        characters: characterPresence === "present",
        descriptors:
          r?.updatedAt === s.updated_at &&
          !!(r?.descriptors?.acts?.length || r?.descriptors?.endings?.length),
      };
      if (
        !c.missing.every((v) => gaps.includes(v)) ||
        !c.present.every((v) =>
          this.characterIdentity ? present[v] === true : !gaps.includes(v),
        )
      )
        continue;
      if (
        c.createdAfter &&
        Date.parse(s.created_at) <= Date.parse(c.createdAfter)
      )
        continue;
      if (
        c.category === "descriptor-review" &&
        r?.needsDescriptorReview !== true
      )
        continue;
      if (c.category === "needs-review" && r?.autoTaggerNeedsReview !== true)
        continue;
      if (c.category === "metadata" && !gaps.length) continue;
      const evidence = [];
      if (r?.autoTaggerNeedsReview === true)
        evidence.push({
          category: "needs-review",
          authority: "owner-defined-review-work",
          source: "read_descriptor_review",
          condition:
            "Persisted Needs Review flag; not a diagnosis of incorrect tags.",
        });
      if (r?.needsDescriptorReview === true)
        evidence.push({
          category: "descriptor-review",
          authority: "owner-defined-review-work",
          source: "read_descriptor_review",
          condition:
            "Owner reports pending Descriptor Review; not inferred from descriptor presence.",
        });
      for (const gap of gaps)
        evidence.push({
          category: "missing-" + gap,
          authority: "verified-absence-not-error",
          source:
            gap === "characters" && this.characterIdentity && s.tags.length
              ? "get_scene_characters"
              : "native GraphQL",
          condition:
            gap === "characters"
              ? this.characterIdentity && s.tags.length
                ? "Owner explicitly excludes every assigned tag from Character identity; no unclassified assignments. Absence may be intentional."
                : "No tags at all, therefore no Character assignments. Nonempty tag lists remain unclassified; not all tags are Characters."
              : `No native ${gap === "author" ? "Group" : "Studio"} relationship; may be intentional.`,
        });
      if (!evidence.length) continue;
      const priority = r?.autoTaggerNeedsReview
        ? 1
        : r?.needsDescriptorReview
          ? 2
          : gaps.length > 1
            ? 4
            : 5;
      items.push({
        sceneId: s.id,
        sceneUrl: `/scenes/${s.id}`,
        createdAt: s.created_at,
        priority,
        evidence,
        observedAt,
        reviewState:
          r && r.status !== "not_found" ? "owner-observed" : "unknown",
        metadata: {
          franchiseId: s.studio?.id ?? null,
          authorIds: s.groups.map((g) => g.group.id),
          characterAbsence:
            this.characterIdentity &&
            characterPresence === "absent" &&
            s.tags.length
              ? "confirmed-owner-exclusions"
              : s.tags.length
                ? "unknown"
                : "confirmed-no-tags",
          ...(this.characterIdentity
            ? {
                characterPresence,
                characterIdentity: trustedIdentity ?? {
                  presence: characterPresence,
                  completeness: !s.tags.length ? "complete" : "unknown",
                },
                descriptorPresence: present.descriptors ? "present" : "unknown",
              }
            : {}),
        },
      });
    }
    items.sort(
      (a, b) =>
        a.priority - b.priority ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.sceneId.localeCompare(b.sceneId, undefined, { numeric: true }),
    );
    return {
      status: sources.some((s) => s.status === "available")
        ? "partial"
        : "unavailable",
      criteria: c,
      observedAt,
      expiresAt: generation === this.generation ? observedAt + INSIGHT_TTL : 0,
      atomic: false,
      freshness: generation === this.generation ? "fresh" : "stale",
      page: c.page,
      candidatePageSize: 20,
      scanned,
      nativeCandidateCount: nativeCount,
      matchingCount: null,
      ...(this.characterIdentity
        ? {
            characterUnknownCandidates,
            characterAuthority:
              "explicit-character-rules-v1; zero-tag native fallback",
          }
        : {}),
      countScope: "candidate-pages-only",
      matchedInScannedPages: items.length,
      hasMoreCandidatePages: hasMore,
      omittedMatchesInPage: Math.max(0, items.length - c.limit),
      items: items.slice(0, c.limit),
      sources,
      limitations: [
        "Not an exhaustive library backlog; page advances candidate pages, not ranked match pages. At most 40 candidates per call.",
        this.characterIdentity
          ? "Character absence requires zero tags or complete owner exclusion of every assignment. Unknowns are NOT missing Characters. Explicit taxonomy is incomplete globally; no exact Character coverage. Joined reads are non-atomic."
          : "Character gaps cover only scenes with no tags. Global Character coverage and nonempty-tag classification are unavailable.",
        "Priority: explicit flag, owner pending, multiple gaps, single gap; newest first within priority. Gaps may be intentional.",
        "Resolve existing entity IDs and ask on ambiguity before an existing preview. Shared Authors never prove a Franchise or Character. No automatic edits or review completion.",
      ],
    };
  }
}
