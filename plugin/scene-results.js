(function () {
  "use strict";
  if (window.StashAISceneResults || !window.PluginApi?.React) return;
  const R = window.PluginApi.React,
    h = R.createElement,
    refinement = window.StashAICollectionRefinement;
  const labels = {
    "missing-author": "No Author assigned",
    "missing-franchise": "No Franchise assigned",
    "missing-characters": "No Characters assigned",
    "descriptor-review": "Descriptor review pending",
    "needs-review": "Auto-Tagger Needs Review",
    "character-unknown": "Character category not confirmed",
  };
  const sources = {
    review_scenes: "Scene review plan",
    find_scenes: "Scene search",
    get_scene: "Scene inspection",
    find_library_attention_items: "Attention findings",
    get_scene_characters: "Character inspection",
    read_descriptor_review: "Descriptor review",
    read_variant_family: "Declared Variant members",
  };
  const scopes = {
    "returned-page":
      "Selected scenes from one returned page; not the entire library.",
    "bounded-candidates":
      "Selected findings from bounded candidate pages; total matches unknown.",
    "explicit-scenes": "Explicitly inspected scenes only.",
    "declared-members-page":
      "Returned declared members only; not full-family validation.",
  };
  const button = (text, onClick, props = {}) =>
    h(
      "button",
      {
        type: "button",
        className: "btn btn-sm btn-secondary",
        onClick,
        ...props,
      },
      text,
    );
  const list = (values, empty) =>
    values?.length
      ? values
          .map((v) => (typeof v === "string" ? v : v.name || `ID ${v.id}`))
          .join(", ")
      : empty;
  function Image({ scene, base, observedAt }) {
    const [failed, setFailed] = R.useState(false);
    // Validate again at the rendering boundary. No model/image external URL.
    const safe =
      typeof scene.screenshot === "string" &&
      new RegExp(
        `^/scene/${scene.sceneId}/screenshot(?:\\?t=[\\d.-]{1,40})?$`,
      ).test(scene.screenshot);
    R.useEffect(() => setFailed(false), [scene.screenshot, observedAt]);
    return h(
      "div",
      { className: "stash-ai-scene-image" },
      safe && !failed
        ? h("img", {
            src: base + scene.screenshot.slice(1),
            alt: `Screenshot of scene ${scene.sceneId}`,
            loading: "lazy",
            decoding: "async",
            referrerPolicy: "no-referrer",
            onError: () => setFailed(true),
          })
        : h("span", null, "Screenshot unavailable"),
    );
  }
  function Card({
    scene,
    base,
    onAsk,
    onDecision,
    observedAt,
    selected,
    onSelect,
    collection,
    stale,
  }) {
    const available = scene.status === "available";
    const characterText = stale
      ? "Current classification could not be checked."
      : available
        ? scene.characters.presence === "unknown"
          ? "Character category not confirmed — no missing or incorrect tag has been confirmed"
          : scene.characters.presence === "absent"
            ? "None assigned (verified)"
            : "Character assigned — " +
              list(scene.characters.names, "recognized by the current rules")
        : "Unavailable";
    return h(
      "article",
      {
        className: `stash-ai-scene-card${selected ? " stash-ai-scene-selected" : ""}`,
        "data-scene-id": scene.sceneId,
      },
      h(Image, { scene, base, observedAt }),
      h(
        "div",
        { className: "stash-ai-scene-body" },
        h("h4", null, scene.title || `Scene ${scene.sceneId}`),
        h("p", { className: "stash-ai-scene-id" }, `Scene ${scene.sceneId}`),
        h(
          "label",
          { className: "stash-ai-scene-select" },
          h("input", {
            type: "checkbox",
            checked: !!selected,
            onChange: onSelect,
            "aria-label": `Select scene ${scene.sceneId}`,
          }),
          selected ? " Selected" : " Select for follow-up",
        ),
        h(
          "section",
          {
            className: "stash-ai-scene-reasons",
            "aria-label": "Why this scene",
          },
          h("strong", null, "Why this scene"),
          (
            scene.reasons || [
              {
                code: "selected-result",
                label: "Included in verified results",
                explanation:
                  "Returned by the verified read used for this response.",
              },
            ]
          ).map((reason, index) =>
            h(
              "div",
              { key: reason.code },
              h("b", { title: reason.explanation }, reason.label),
              index === 0 && h("p", null, reason.explanation),
              reason.basis === "original" &&
                h(
                  "small",
                  null,
                  "When checked: ",
                  index === 0 &&
                    `${new Date(reason.observedAt).toLocaleString()} · `,
                  stale
                    ? "Current state unverified during refresh/failure."
                    : {
                        "still-present":
                          reason.currentText ||
                          "Checked again: this condition is still present.",
                        "no-longer-present":
                          "No longer observed in current metadata; this does not establish who changed it.",
                        unverified: "Current state unverified.",
                      }[reason.current] || "Current state unverified.",
                ),
            ),
          ),
        ),
        !scene.review &&
          scene.findingExplanations?.length > 0 &&
          h(
            "details",
            { className: "stash-ai-recorded-findings" },
            h("summary", null, "Findings from the earlier check"),
            scene.findingExplanations.map((f) =>
              h(
                "div",
                { key: f.code },
                h("b", null, f.label),
                h("p", null, f.explanation),
                h(
                  "small",
                  null,
                  `${new Date(f.observedAt).toLocaleString()} · ${stale ? "Current metadata could not be checked." : f.currentText}`,
                ),
              ),
            ),
          ),
        available &&
          scene.characters.explanation &&
          h(
            "section",
            {
              className: "stash-ai-classification-info",
              "aria-label": `Character classification notes for scene ${scene.sceneId}`,
            },
            h(
              "strong",
              null,
              stale
                ? "Current classification could not be checked"
                : scene.characters.explanation.headline,
            ),
            scene.characters.presence === "present" &&
              h(
                "p",
                null,
                "Recognized Characters: ",
                list(scene.characters.names, "Present"),
                stale && " (last successful check)",
              ),
            h(
              "p",
              null,
              stale
                ? "Refresh to check again. Earlier classification is not current evidence."
                : scene.characters.explanation.note,
            ),
            !stale &&
              scene.characters.explanation.details.map((t) =>
                h(
                  "p",
                  { key: t.id },
                  h(
                    "b",
                    null,
                    `${t.name || "Tag"}${t.nameTruncated ? "…" : ""} (ID ${t.id})`,
                  ),
                  " — ",
                  t.explanation,
                ),
              ),
            !stale &&
              scene.characters.explanation.detailsTruncated &&
              h(
                "p",
                null,
                "Only some unclassified-tag details are shown; the complete count is in Metadata details.",
              ),
            !stale &&
              scene.characters.explanation.nextStep &&
              h("small", null, scene.characters.explanation.nextStep),
          ),
        scene.review &&
          h(
            "section",
            {
              className: "stash-ai-review-findings",
              "aria-label": `Review findings for scene ${scene.sceneId}`,
            },
            h("strong", null, "Review findings"),
            h(
              "small",
              null,
              `Original checks ${new Date(scene.review.originalAt).toLocaleString()}. Current verification ${stale ? "unavailable during refresh/failure" : new Date(scene.review.observedAt).toLocaleString()}.`,
            ),
            h(
              "ul",
              null,
              scene.review.checks
                .filter(
                  (c) =>
                    c.originalState !== "not-observed" ||
                    c.currentState !== "not-observed",
                )
                .map((c) =>
                  h(
                    "li",
                    { key: c.key },
                    h("b", null, c.label),
                    h(
                      "small",
                      null,
                      c.category === "uncertainty" ||
                        (c.currentState === "unknown" &&
                          [
                            "missing-characters",
                            "character-classification",
                          ].includes(c.key))
                        ? "Information / classification limitation"
                        : c.currentState === "unknown"
                          ? "Information / check unavailable"
                          : c.category === "owner-review"
                            ? "Review requirement"
                            : "Metadata condition",
                    ),
                    h("p", null, c.historicalText),
                    h(
                      "p",
                      null,
                      stale
                        ? "Current verification could not be checked."
                        : c.currentText,
                    ),
                    h(
                      "small",
                      null,
                      scene.recommendations?.rows.some(
                        (r) =>
                          r.key === c.key && r.decision?.state === "active",
                      )
                        ? "You marked this condition No action needed in Stash AI. The factual check and owner status are unchanged."
                        : c.nextStep,
                    ),
                    c.action !== "none" &&
                      !scene.recommendations?.rows.some(
                        (r) =>
                          r.key === c.key && r.decision?.state === "active",
                      ) &&
                      button(
                        c.action === "information"
                          ? "Explain this check"
                          : "Investigate correction",
                        () => {
                          const draft = refinement.correction(
                            scene.sceneId,
                            collection,
                            c.key,
                          );
                          if (draft)
                            onAsk(
                              c.action === "information"
                                ? `Explain the ${c.key} check for scene ${scene.sceneId}. Re-read current classification and any available tag IDs/names and owner-defined reasons. This is information, not a request to fix metadata. Do not prepare a proposal or apply changes.`
                                : draft.text,
                              draft.context,
                            );
                        },
                      ),
                  ),
                ),
            ),
            h(
              "details",
              null,
              h("summary", null, "All performed checks"),
              h(
                "ul",
                null,
                scene.review.checks.map((c) =>
                  h(
                    "li",
                    { key: c.key },
                    `${c.label}: original ${c.originalState}; current ${stale ? "unverified" : c.currentState}. Source: ${c.authority}.`,
                  ),
                ),
              ),
            ),
          ),
        scene.operations?.length > 0 &&
          h(
            "details",
            { className: "stash-ai-operation-feedback" },
            h("summary", null, "Recent operation status (this conversation)"),
            h(
              "p",
              null,
              "Operation status is separate from current findings. Refresh verification to re-read; rejected or uncertain is not success.",
            ),
            scene.operations.map((op) =>
              h(
                "p",
                { key: op.id },
                `${op.kind} ${op.id}: ${op.status} · scene outcome: ${op.sceneStatus}`,
              ),
            ),
          ),
        !available
          ? h(
              "p",
              { role: "status" },
              scene.status === "not_found"
                ? "Scene no longer available."
                : "Current metadata unavailable.",
            )
          : h(
              R.Fragment,
              null,
              h("p", null, h("strong", null, "Characters: "), characterText),
              h(
                "p",
                null,
                h("strong", null, "Authors: "),
                list(scene.authors, "None assigned"),
              ),
              h(
                "p",
                null,
                h("strong", null, "Franchise: "),
                scene.franchise?.name || "None assigned",
              ),
              h(
                "div",
                { className: "stash-ai-scene-badges" },
                (!stale ? scene.currentGaps : []).map((code) =>
                  h("span", { key: code }, labels[code]),
                ),
              ),
            ),
        !scene.reasons &&
          scene.findings?.length > 0 &&
          h(
            "div",
            { className: "stash-ai-scene-findings" },
            h("strong", null, "Original finding"),
            h(
              "ul",
              null,
              scene.findings.map((f) =>
                h(
                  "li",
                  { key: f.code },
                  labels[f.code],
                  " — ",
                  {
                    "still-present": "still observed",
                    "no-longer-present": "not observed in current metadata",
                    unverified: "current state unverified",
                  }[f.current],
                ),
              ),
            ),
          ),
        available &&
          h(
            "details",
            null,
            h("summary", null, "Metadata details"),
            h("p", null, "All Characters: ", characterText),
            h(
              "p",
              null,
              "All Authors: ",
              list(scene.authors, "None assigned"),
              scene.authorsTruncated && " (first 100)",
            ),
            h(
              "p",
              null,
              "Unclassified native tags: ",
              scene.characters.unclassifiedCount ?? "Not checked",
            ),
            h(
              "p",
              null,
              `Classification evidence: presence=${scene.characters.presence}; completeness=${scene.characters.completeness}. ${stale ? "Current verification unavailable." : "At the displayed check time."}`,
            ),
            scene.descriptors
              ? h(
                  R.Fragment,
                  null,
                  h(
                    "p",
                    null,
                    "Descriptors — Acts: ",
                    list(scene.descriptors.acts, "None"),
                  ),
                  h(
                    "p",
                    null,
                    "Descriptors — Endings: ",
                    list(scene.descriptors.endings, "None"),
                  ),
                  scene.descriptors.truncated &&
                    h("p", null, "Descriptor list is truncated by its owner."),
                  h(
                    "p",
                    null,
                    "Descriptor review: ",
                    scene.descriptors.needsReview
                      ? "Pending"
                      : "No pending requirement reported",
                    ". This is not proof that all metadata is correct.",
                  ),
                )
              : h(
                  "p",
                  null,
                  "Descriptors and review state unavailable or changed between reads.",
                ),
            h(
              "p",
              null,
              scene.files
                .map(
                  (f) =>
                    `${f.width || "?"} × ${f.height || "?"}${f.duration ? ` · ${Math.round(f.duration)} sec` : ""}`,
                )
                .join("; "),
            ),
            h(
              "small",
              null,
              `Current metadata read ${new Date(observedAt).toLocaleString()}. Independent reads, not an atomic snapshot.`,
            ),
          ),
        h(
          "div",
          { className: "stash-ai-scene-actions" },
          h(
            "a",
            {
              className: "btn btn-sm btn-secondary",
              href: `${base}scenes/${scene.sceneId}`,
            },
            "Open Scene",
          ),
          button("Ask about scene", () =>
            onAsk(
              `Inspect scene ${scene.sceneId} and explain its current metadata and any verified review requirements.`,
            ),
          ),
        ),
        window.StashAIReview &&
          h(window.StashAIReview.Recommendations, {
            scene,
            base,
            stale,
            onAsk: (draft) =>
              onAsk(draft, {
                type: "selection",
                collectionId: collection.id,
                sceneIds: [scene.sceneId],
              }),
            onDecision,
          }),
      ),
    );
  }
  function Collection({
    collection,
    threadId,
    request,
    onAsk,
    base,
    onDecision,
    decisionRevision = 0,
  }) {
    const root = R.useRef(null);
    const [visible, setVisible] = R.useState(false),
      [data, setData] = R.useState(null),
      [error, setError] = R.useState(""),
      [loading, setLoading] = R.useState(false),
      [revision, refresh] = R.useState(0),
      [count, setCount] = R.useState(6),
      [layout, setLayout] = R.useState(collection.layout),
      [filters, setFilters] = R.useState(refinement.defaults()),
      [sort, setSort] = R.useState("original"),
      [selected, setSelected] = R.useState([]);
    const scenes = data?.scenes || [];
    const rows = refinement.refine(scenes, filters, sort, !!error || loading);
    const hidden = selected.filter(
      (id) => !rows.some((s) => s.sceneId === id),
    ).length;
    const activeFilters = Object.values(filters).filter(
      (v) => v !== "all",
    ).length;
    const selectControl = (name, value, change, options) =>
      h(
        "label",
        null,
        name,
        h(
          "select",
          {
            "aria-label": name,
            value,
            onChange: (e) => change(e.target.value),
          },
          options.map(([value, text]) =>
            h("option", { key: value, value }, text),
          ),
        ),
      );
    const filterControl = (name, key, options) =>
      selectControl(
        name,
        filters[key],
        (value) => {
          setFilters((f) => ({ ...f, [key]: value }));
          setCount(6);
        },
        [["all", "All"], ...options],
      );
    const entityOptions = (kind) => [
      ["assigned", "Assigned"],
      ["missing", "Missing"],
      ...refinement
        .entities(scenes, kind)
        .map((v) => ["id:" + v.id, `${v.name || "Unnamed"} (ID ${v.id})`]),
    ];
    const prepare = (action) => {
      const draft = refinement.draft(action, selected, collection, filters);
      if (draft) onAsk(draft.text, draft.context);
    };
    R.useEffect(() => {
      if (!window.IntersectionObserver) {
        setVisible(true);
        return;
      }
      const observer = new window.IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setVisible(true);
            observer.disconnect();
          }
        },
        { rootMargin: "160px" },
      );
      observer.observe(root.current);
      return () => observer.disconnect();
    }, []);
    R.useEffect(() => {
      if (!visible) return;
      let current = true;
      setLoading(true);
      setError("");
      request("/scene-results", { threadId, collectionId: collection.id })
        .then((value) => {
          if (current) setData(value);
        })
        .catch(() => {
          if (current)
            setError(
              "Current scene metadata could not be loaded. Original findings are unchanged; try Refresh.",
            );
        })
        .finally(() => {
          if (current) setLoading(false);
        });
      return () => {
        current = false;
      };
    }, [visible, threadId, collection.id, request, revision, decisionRevision]);
    return h(
      "section",
      {
        ref: root,
        className: "stash-ai-scene-collection",
        "aria-label": "Scene results",
      },
      h(
        "div",
        { className: "stash-ai-scene-heading" },
        h("h3", null, sources[collection.sourceTool] || "Scene results"),
        h(
          "label",
          null,
          "Layout ",
          h(
            "select",
            {
              value: layout,
              onChange: (e) => setLayout(e.target.value),
              "aria-label": "Scene result layout",
            },
            h("option", { value: "grid" }, "Grid"),
            h("option", { value: "list" }, "Detailed list"),
          ),
        ),
        button(
          collection.sourceTool === "review_scenes"
            ? "Refresh verification"
            : "Refresh metadata",
          () => refresh((v) => v + 1),
          {
            disabled: loading || !visible,
          },
        ),
      ),
      h(
        "p",
        null,
        `${collection.count} selected scene${collection.count === 1 ? "" : "s"}. ${scopes[collection.scope] || ""}`,
      ),
      h(
        "small",
        null,
        `Original observation: ${new Date(collection.observedAt).toLocaleString()}. Missing metadata may be intentional.`,
      ),
      data?.reviewSummary &&
        h(
          "section",
          {
            className: "stash-ai-review-summary",
            "aria-label": "Review plan summary",
          },
          h("strong", null, "Read-only review plan — not a change proposal"),
          h(
            "p",
            null,
            `${data.reviewSummary.inspected} scenes inspected · ${data.reviewSummary.confirmedGaps} with confirmed gaps · ${data.reviewSummary.ownerReview} with pending review work · ${data.reviewSummary.possibleIssues || 0} with evidence-backed possible issues · ${data.reviewSummary.incompleteClassification || 0} with incomplete classification · ${data.reviewSummary.noConfirmedIssue} with no confirmed issue in the performed checks. ${data.reviewSummary.incompleteEvidence} have incomplete or unavailable evidence. Categories overlap; these are original observations. Classification limitations are not metadata defects.`,
          ),
          h(
            "p",
            null,
            "Resolve intended values with the user before preparing a correction. Native proposal limit: 5 scenes; Descriptor: 1 scene. One proposal attempt per turn; no automatic next batch.",
          ),
          h(
            "details",
            null,
            h("summary", null, "Checks and limits"),
            h(
              "ul",
              null,
              data.reviewLimitations.map((text) =>
                h("li", { key: text }, text),
              ),
            ),
          ),
          h(
            "small",
            null,
            "Refresh verification rechecks only this collection. Approval status alone never resolves a finding.",
          ),
        ),
      data &&
        h(
          "details",
          { className: "stash-ai-refinement" },
          h(
            "summary",
            null,
            `Filter current results & sort${activeFilters ? ` · ${activeFilters} filters active` : ""}`,
          ),
          h(
            "p",
            null,
            "Local to this collection. Different filters use AND. No new search or model request. Current filters use the last successful metadata read; unavailable values are unknown, not missing.",
          ),
          h(
            "div",
            { className: "stash-ai-refinement-fields" },
            filterControl("Character status", "character", [
              ["present", "Present"],
              ["absent", "Absent (verified)"],
              ["unknown", "Unknown / unavailable"],
            ]),
            filterControl("Character classification", "completeness", [
              ["complete", "Complete"],
              ["partial", "Partial"],
              ["unknown", "Unknown / unavailable"],
            ]),
            filterControl("Author", "author", entityOptions("author")),
            filterControl("Franchise", "franchise", entityOptions("franchise")),
            filterControl("Descriptor Review", "review", [
              ["pending", "Pending Review"],
              ["reviewed", "Reviewed (persisted)"],
              ["unknown", "Unknown / unavailable"],
              ["other", "Other known state (not pending)"],
            ]),
            filterControl(
              "Current verified condition",
              "condition",
              refinement.conditions,
            ),
            filterControl("Original finding (historical)", "original", [
              ...refinement.conditions,
              ["character-unknown", "Character classification unknown"],
            ]),
            selectControl(
              "Sort this collection",
              sort,
              (value) => {
                setSort(value);
                setCount(6);
              },
              [
                ["original", "Original order"],
                ["id-asc", "Scene ID ascending"],
                ["id-desc", "Scene ID descending"],
                ["duration-asc", "Duration shortest first"],
                ["duration-desc", "Duration longest first"],
              ],
            ),
          ),
          h(
            "small",
            null,
            "Duration uses the first source file; unknown values sort last. Specific Authors include any matching assignment. Options come only from this collection.",
          ),
          button("Reset Filters", () => {
            setFilters(refinement.defaults());
            setCount(6);
          }),
          h(
            "section",
            {
              className: "stash-ai-search-preflight",
              "aria-label": "Search capability preflight",
            },
            h("strong", null, "Before searching Stash again"),
            h(
              "ul",
              null,
              refinement
                .preflight(filters, data.searchCapabilities)
                .map((item) =>
                  h(
                    "li",
                    { key: item.criterion },
                    `${item.criterion}: `,
                    h(
                      "b",
                      null,
                      {
                        "exact-native": "Exact native filter",
                        bounded: "Bounded post-filter",
                        "scene-only": "Scene-level inspection only",
                        unsupported: "Unsupported",
                      }[item.level],
                    ),
                    `. ${item.note}`,
                  ),
                ),
            ),
            h(
              "small",
              null,
              activeFilters
                ? data.searchCapabilities?.combination ||
                    "Search support unavailable; verify before submitting."
                : "Choose a local filter to see its search support. This check does not run Codex or search the library.",
            ),
          ),
        ),
      data &&
        h(
          "p",
          { role: "status", className: "stash-ai-collection-count" },
          `${rows.length} of ${collection.count} scenes in this collection match · ${Math.min(rows.length, count)} cards shown · ${activeFilters} filters active. ${scenes.length !== collection.count ? "Hydration incomplete. " : ""}${loading || error ? "Current metadata unverified during loading/failure. " : ""}No new library search.`,
        ),
      data &&
        h(
          "div",
          { className: "stash-ai-selection-actions" },
          h(
            "span",
            { role: "status" },
            `${selected.length} scenes selected${hidden ? ` · ${hidden} hidden by filters` : ""}${selected.length ? ` · IDs: ${selected.join(", ")}` : ""}`,
          ),
          button("Clear Selection", () => setSelected([]), {
            disabled: !selected.length,
          }),
          ...[
            ["plan", "Review Selected"],
            ["investigate", "Investigate Selected"],
            ["compare", "Compare Metadata"],
            ["review", "Check Review Status"],
            ["related", "Find Related Scenes"],
          ].map(([action, label]) =>
            button(label, () => prepare(action), {
              key: action,
              disabled: !selected.length,
            }),
          ),
          button("Search Stash again…", () => prepare("refine")),
          h(
            "small",
            null,
            "Actions prepare an editable draft. Nothing runs until Send. Searching again is a new bounded read, not a local filter.",
          ),
        ),
      loading && h("p", { role: "status" }, "Loading current metadata…"),
      error && h("p", { role: "alert" }, error),
      data &&
        h(
          "div",
          { className: `stash-ai-scene-cards stash-ai-scene-${layout}` },
          rows.slice(0, count).map((scene) =>
            h(Card, {
              key: scene.sceneId,
              scene,
              base,
              onAsk,
              onDecision: onDecision
                ? (input) =>
                    onDecision({ ...input, collectionId: collection.id })
                : null,
              observedAt: data.observedAt,
              collection,
              stale: !!error || loading,
              selected: selected.includes(scene.sceneId),
              onSelect: () =>
                setSelected((ids) =>
                  refinement.toggle(
                    ids,
                    scene.sceneId,
                    scenes.map((s) => s.sceneId),
                  ),
                ),
            }),
          ),
        ),
      data &&
        count < rows.length &&
        button(`Show more (${rows.length - count} remaining)`, () =>
          setCount((n) => n + 6),
        ),
      data &&
        !rows.length &&
        h(
          "p",
          null,
          "No scenes match these local filters. Reset Filters to restore the collection.",
        ),
    );
  }
  window.StashAISceneResults = Collection;
})();
