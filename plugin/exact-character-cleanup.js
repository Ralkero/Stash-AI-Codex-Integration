(function () {
  "use strict";
  const R = PluginApi.React,
    h = R.createElement;
  const labels = {
    EXACT_VERIFIED: "The exact approved Tag set was verified after removal.",
    EXACT_VERIFIED_AFTER_WRITE_ERROR:
      "The response was interrupted; an authoritative read confirmed the exact result without another write.",
    EXACT_AFTER_OBSERVED_ATTRIBUTION_UNCERTAIN:
      "The expected result is present after restart. No repeat write was sent; attribution is uncertain.",
    EXACT_TAG_CHANGED_OR_MISSING:
      "A Tag definition changed or disappeared; this scene was skipped.",
    SCENE_NOT_FOUND: "This scene no longer exists; it was skipped.",
    EXACT_STALE_SOURCE: "Scene metadata changed; no removal was sent.",
    EXACT_ALREADY_ABSENT:
      "The approved relationships were already absent; not counted as our removals.",
    EXACT_ENVIRONMENT_CHANGED:
      "Plugin configuration or owner rules changed. Execution is blocked.",
    EXACT_REVIEW_REQUIRED:
      "Open the full review again; its confirmation token expired or changed.",
    EXACT_WRITES_BLOCKED:
      "Writes are unavailable, a chat is active, or another approved operation needs attention.",
    EXACT_READBACK_MISMATCH:
      "Readback did not match. Execution stopped; do not retry removals.",
    EXACT_RESTART_REQUIRES_RESUME:
      "The companion restarted. Review progress and explicitly resume.",
    EXACT_UNCERTAIN_NO_RETRY:
      "An earlier outcome is uncertain. No blind retry is permitted.",
    EXACT_READBACK_UNAVAILABLE:
      "Readback was unavailable. Resume will inspect the earlier attempt before doing anything else.",
    EXACT_EXPIRED: "This plan or approval expired. A fresh review is required.",
  };
  const explain = (s) => labels[s] || s;
  window.StashAIExactCharacterCleanup = function ({
    request,
    ready,
    writesReady = false,
    revision,
    busy,
  }) {
    const [open, setOpen] = R.useState(false),
      [data, setData] = R.useState(null),
      [detail, setDetail] = R.useState(null),
      [error, setError] = R.useState(""),
      [working, setWorking] = R.useState(false),
      [ack, setAck] = R.useState(false),
      [search, setSearch] = R.useState(""),
      [reason, setReason] = R.useState("");
    const generation = R.useRef(0),
      selected = R.useRef(null);
    const call = (action, args = {}) =>
      request("/character-cleanup", { action, args });
    R.useEffect(() => {
      generation.current++;
      setWorking(false);
    }, [open, ready]);
    R.useEffect(() => {
      let cancelled = false;
      if (!open || !ready) return;
      const g = generation.current;
      const refresh = () =>
        call("list")
          .then(async (v) => {
            const p = v.plans.find((p) => p.id === selected.current);
            const d =
              p && p.state !== "awaiting-approval"
                ? await call("read", { planId: p.id })
                : null;
            if (!cancelled && g === generation.current) {
              if (d) setDetail(d);
              setData(v);
            }
          })
          .catch((e) => {
            if (!cancelled) setError(explain(e.message));
          });
      refresh();
      return () => {
        cancelled = true;
      };
    }, [open, ready, revision]);
    const running = data?.plans?.some((p) =>
      ["approved", "executing"].includes(p.state),
    );
    R.useEffect(() => {
      if (!open || !ready || !running) return;
      let cancelled = false;
      const timer = setInterval(async () => {
        try {
          const v = await call("list");
          if (cancelled) return;
          if (selected.current) {
            const d = await call("read", { planId: selected.current });
            if (!cancelled) setDetail(d);
          }
          if (!cancelled) setData(v);
        } catch (e) {
          if (!cancelled) setError(explain(e.message));
        }
      }, 2000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [open, ready, running]);
    R.useEffect(
      () => () => {
        generation.current++;
        selected.current = null;
      },
      [],
    );
    const act = async (action, args = {}) => {
      const g = generation.current;
      setWorking(true);
      setError("");
      try {
        const v = await call(action, args);
        if (g !== generation.current) return;
        if (action === "read") {
          selected.current = v.plan.id;
          setDetail(v);
          setAck(false);
        } else if (selected.current) {
          setDetail(await call("read", { planId: selected.current }));
          setAck(false);
        }
        setData(await call("list"));
      } catch (e) {
        if (g === generation.current)
          setError(explain(e.message) + " No unconfirmed success is assumed.");
      } finally {
        if (g === generation.current) setWorking(false);
      }
    };
    const button = (text, fn, disabled = false) =>
      h(
        "button",
        {
          type: "button",
          className: "btn btn-secondary btn-sm",
          onClick: fn,
          disabled,
        },
        text,
      );
    const download = () => {
      const { challenge, ...safe } = detail;
      const blob = new Blob([JSON.stringify(safe, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "character-cleanup-" + detail.plan.id + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const locked = working || !ready,
      plan =
        detail &&
        (data?.plans?.find((p) => p.id === detail.plan.id) || detail.plan),
      m = detail?.manifest;
    const reasons = m
      ? [
          ...new Set(
            m.entries.flatMap((e) =>
              e.evidence.map((f) => f.reason || "Reviewed correction"),
            ),
          ),
        ]
      : [];
    const rows =
      m?.entries.filter(
        (e) =>
          (!reason || e.evidence.some((f) => f.reason === reason)) &&
          [e.sceneId, e.label, ...Object.values(e.names)]
            .join(" ")
            .toLowerCase()
            .includes(search.toLowerCase()),
      ) || [];
    return h(
      R.Fragment,
      null,
      button("Character Tag Cleanup", () => setOpen(true), !ready),
      open &&
        h(
          "div",
          {
            className: "stash-ai-exact-backdrop",
            onKeyDown: (e) => {
              if (e.key === "Escape") setOpen(false);
            },
          },
          h(
            "section",
            {
              className: "stash-ai-exact-panel",
              role: "dialog",
              "aria-modal": "true",
              "aria-label": "Character Tag Cleanup",
            },
            h(
              "header",
              null,
              h("h2", null, "Character Tag Cleanup"),
              button("Close", () => setOpen(false)),
            ),
            h(
              "p",
              null,
              "One frozen plan, one explicit approval. Only the listed scene-to-Tag relationships can be removed. No replacements, Tag deletions or title edits.",
            ),
            error && h("p", { role: "alert", className: "text-danger" }, error),
            !writesReady &&
              h(
                "p",
                { role: "status" },
                "Read-only review: approval and resume are unavailable until the companion's runtime and write checks pass. No cleanup will start.",
              ),
            button("Refresh status", () => act("list"), locked),
            data?.preparationAvailable &&
              button(
                "Prepare / revalidate reviewed removal plan",
                () => act("prepare"),
                locked || busy,
              ),
            data?.plans?.map((p) =>
              h(
                "section",
                {
                  key: p.id,
                  className: "stash-ai-proposal",
                  "data-exact-plan": p.id,
                },
                h(
                  "h3",
                  null,
                  p.relationships + " Tag removals · " + p.scenes + " scenes",
                ),
                h(
                  "p",
                  { role: "status", "aria-live": "polite" },
                  p.state +
                    " — " +
                    p.counts.verified +
                    " verified scenes / " +
                    p.verifiedRelationships +
                    " verified removals; " +
                    p.counts.pending +
                    " pending, " +
                    p.counts.intent +
                    " awaiting verification, " +
                    p.counts.skipped +
                    " skipped, " +
                    p.counts.failed +
                    " failed, " +
                    p.counts.recovered +
                    " recovered outcomes (attribution uncertain).",
                ),
                p.error && h("p", { role: "alert" }, explain(p.error)),
                p.lastBatch &&
                  h(
                    "p",
                    null,
                    "Last batch: " +
                      p.lastBatch.processed +
                      " operations checked at " +
                      new Date(p.lastBatch.at).toLocaleString(),
                  ),
                button(
                  "Inspect complete plan",
                  () => act("read", { planId: p.id }),
                  locked,
                ),
                ["approved", "executing"].includes(p.state) &&
                  button(
                    "Pause",
                    () => act("control", { planId: p.id, action: "pause" }),
                    locked,
                  ),
                p.resumeAvailable &&
                  button(
                    "Resume approved plan",
                    () => act("control", { planId: p.id, action: "resume" }),
                    locked || busy || !writesReady,
                  ),
              ),
            ),
            m &&
              h(
                "section",
                { "data-exact-review": m.id },
                h("h3", null, "Complete immutable review"),
                h(
                  "details",
                  null,
                  h("summary", null, "Removal reason breakdown"),
                  Object.entries(m.counts.reasons || {}).map(
                    ([reason, count]) =>
                      h(
                        "p",
                        { key: reason },
                        count + " assignments: " + reason,
                      ),
                  ),
                ),
                h(
                  "p",
                  null,
                  m.counts.distinctTags +
                    " distinct removal Tags; " +
                    m.counts.emptyAfter +
                    " scenes will have no Tags; " +
                    m.counts.retainingTags +
                    " retain other Tags. Remaining Tags are not automatically proof of correct Character depiction.",
                ),
                h("p", null, "Fingerprint: " + detail.plan.digest),
                h(
                  "p",
                  null,
                  "Excluded findings: " +
                    m.excluded.length +
                    ". Changes require a new plan and approval. Review expires " +
                    new Date(m.expiresAt).toLocaleString() +
                    ".",
                ),
                button(
                  "Export manifest and audit / recovery evidence",
                  download,
                ),
                h(
                  "label",
                  null,
                  "Search scene ID or Tag name",
                  h("input", {
                    className: "form-control",
                    value: search,
                    onChange: (e) => setSearch(e.target.value),
                  }),
                ),
                h(
                  "label",
                  null,
                  "Removal reason",
                  h(
                    "select",
                    {
                      className: "form-control",
                      value: reason,
                      onChange: (e) => setReason(e.target.value),
                    },
                    h("option", { value: "" }, "All reasons"),
                    reasons.map((r) => h("option", { value: r, key: r }, r)),
                  ),
                ),
                h(
                  "p",
                  null,
                  rows.length +
                    " of " +
                    m.entries.length +
                    " scenes shown. Approval always covers the entire frozen manifest, not the filter.",
                ),
                rows.map((e) => {
                  const row = detail.rows.find(
                      (r) => r.operationId === e.operationId,
                    ),
                    show = (ids) =>
                      ids
                        .map((id) => (e.names[id] || "Tag") + " (" + id + ")")
                        .join(", ") || "(none)";
                  return h(
                    "details",
                    { key: e.operationId },
                    h(
                      "summary",
                      null,
                      "Scene " +
                        e.sceneId +
                        " · Remove " +
                        show(e.remove) +
                        " · " +
                        row.status,
                    ),
                    h("p", null, "Before: " + show(e.before)),
                    h("p", null, "Remove: " + show(e.remove)),
                    h("p", null, "After: " + show(e.after)),
                    e.evidence.map((v, i) =>
                      h("p", { key: i }, v.reason + " — " + v.decisionId),
                    ),
                    e.excluded.length > 0 &&
                      h(
                        "p",
                        null,
                        "Other unresolved findings are excluded; their Tags are preserved.",
                      ),
                    row.reason && h("p", null, explain(row.reason)),
                  );
                }),
                h(
                  "details",
                  null,
                  h(
                    "summary",
                    null,
                    "Excluded findings and blocked candidates",
                  ),
                  h("pre", null, JSON.stringify(m.excluded, null, 2)),
                ),
                h(
                  "details",
                  null,
                  h("summary", null, "Audit journal / recovery limitations"),
                  h(
                    "p",
                    null,
                    "Export contains the exact original and observed Tag sets. Recovery is a separate approved operation; never restore an old whole-library database or overwrite intervening edits. No automatic rollback is offered.",
                  ),
                  h("pre", null, JSON.stringify(detail.journal, null, 2)),
                ),
                plan.state === "awaiting-approval" &&
                  m.expiresAt > Date.now() &&
                  h(
                    "div",
                    { className: "stash-ai-exact-approval" },
                    h(
                      "label",
                      null,
                      h("input", {
                        type: "checkbox",
                        checked: ack,
                        onChange: (e) => setAck(e.target.checked),
                      }),
                      " I reviewed the complete frozen scope and authorize only these removals.",
                    ),
                    button(
                      "Approve removal of " +
                        m.counts.relationships +
                        " Tag assignments from " +
                        m.counts.scenes +
                        " scenes",
                      () =>
                        act("approve", {
                          planId: m.id,
                          digest: detail.plan.digest,
                          challenge: detail.challenge,
                          acknowledged: true,
                        }),
                      locked ||
                        busy ||
                        !writesReady ||
                        !ack ||
                        !detail.challenge,
                    ),
                  ),
              ),
          ),
        ),
    );
  };
})();
