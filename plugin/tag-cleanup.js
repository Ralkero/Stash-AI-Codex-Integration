(function () {
  "use strict";
  const R = PluginApi.React,
    h = R.createElement;
  // One stable, oldest-first transcript. Status refreshes never change position.
  // Runtime messages retain their supplied order; artifacts use creation time,
  // not completion/refresh time. Missing legacy times stay in original order.
  window.StashAIChronology = function (nodes) {
    const flat = nodes.flat(Infinity).filter(Boolean);
    let previous = 0;
    return flat
      .map((node, index) => {
        const value = node.props?.["data-stash-time"];
        const at = Number.isFinite(value) && value > 0 ? value : previous;
        previous = at;
        return { node, at, index };
      })
      .sort((a, b) => a.at - b.at || a.index - b.index)
      .map((v) => v.node);
  };
  // Feedback-only hotfix; the frozen authorization and executor are unchanged.
  const messages = {
    CLEANUP_DECISION_CHANGED:
      "Your Character decisions changed after this plan was prepared. Request a fresh plan using those decisions, then approve that replacement. This plan cannot run.",
    CLEANUP_EXPIRED:
      "This plan expired. Request a fresh plan and review it before approving.",
    CLEANUP_ENVIRONMENT_CHANGED:
      "The Stash or plugin configuration changed. This plan cannot be approved; request a fresh audit and plan.",
    TAG_EVIDENCE_CHANGED:
      "The selected Tag information changed. Request a fresh audit and plan before approving.",
    CLEANUP_NOT_APPROVABLE:
      "This plan cannot currently be approved. Refresh its status and check whether writes are enabled in Advanced View.",
    CLEANUP_OPERATION_OUTSTANDING:
      "Another approved cleanup still needs attention. Check its status before approving this plan.",
    CLEANUP_PREFLIGHT_CONFLICT:
      "Scene metadata changed since this plan was prepared. Further removals stopped; the remaining work needs a fresh plan.",
    CLEANUP_UNCERTAIN_NO_RETRY:
      "A previous removal has an uncertain outcome. Reconcile it read-only; do not retry the removal.",
    BUSY: "Another request is still active. Wait for it to finish, then refresh this plan's status.",
  };
  function statusText(p) {
    const verified = (p.counts.verified || 0) + (p.counts.reconciled || 0);
    const counts = `${verified} of ${p.scenes} scenes verified; ${p.counts.pending || 0} pending, ${p.counts.intent || 0} in progress, ${p.counts.uncertain || 0} uncertain, ${p.counts.conflicted || 0} conflicted.`;
    if (p.approvalBlock)
      return messages[p.approvalBlock] || "This plan is no longer approvable.";
    if (p.status === "awaiting-approval")
      return p.expiresAt <= Date.now()
        ? messages.CLEANUP_EXPIRED
        : "Awaiting your approval. No removals have started under this plan.";
    if (p.status === "preparing")
      return `Preparing exact preview: ${p.prepared} of ${p.expectedScenes} scenes. No approval has been recorded.`;
    if (p.status === "completed")
      return `Cleanup completed. ${counts} ${p.verifiedRelationships ?? p.relationships} approved relationships verified removed.`;
    const prefix =
      {
        running: "Approval recorded — cleanup is running.",
        paused:
          "Cleanup paused. No further scenes will start until you resume.",
        cancelled: "Cleanup stopped. Completed removals were not undone.",
        uncertain:
          "Cleanup stopped because a result is uncertain. Do not retry removals.",
        conflicted: "Cleanup stopped because a safety check failed.",
        failed: "Plan preparation failed. No approval was recorded.",
      }[p.status] || p.status;
    return `${prefix} ${counts}`;
  }
  const button = (label, fn, disabled = false) =>
    h(
      "button",
      {
        type: "button",
        className: "btn btn-secondary btn-sm",
        onClick: fn,
        disabled,
      },
      label,
    );
  window.StashAITagCleanup = function ({
    threadId,
    request,
    revision,
    busy,
    ready = true,
    onDraft,
    base,
    children,
    onContentChange,
  }) {
    const globalCards =
      window.StashAIGlobalCleanup?.useCards({
        threadId,
        request,
        revision,
        ready,
        busy,
        onContentChange,
      }) || [];
    const [data, setData] = R.useState(null),
      [detail, setDetail] = R.useState(null),
      [error, setError] = R.useState(""),
      [working, setWorking] = R.useState(false),
      [selected, setSelected] = R.useState([]),
      [scene, setScene] = R.useState(""),
      [tag, setTag] = R.useState(""),
      [feedback, setFeedback] = R.useState({});
    const live = R.useRef(0),
      expanded = R.useRef(null),
      mounted = R.useRef(false);
    R.useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);
    R.useEffect(() => {
      onContentChange?.();
    }, [data, detail, children]);
    const call = (action, args = {}) =>
      request("/tag-cleanup", { threadId, action, args });
    R.useEffect(() => {
      if (!ready) return;
      const generation = ++live.current;
      let cancelled = false;
      call("list")
        .then(async (v) => {
          if (!cancelled && live.current === generation) {
            setData(v);
            setError("");
          }
          if (expanded.current && !cancelled) {
            const requested = expanded.current;
            const d = await call("read", requested);
            if (
              !cancelled &&
              live.current === generation &&
              expanded.current === requested
            )
              setDetail(d);
          }
        })
        .catch(() => {
          if (!cancelled)
            setError(
              "Cleanup status could not be refreshed. Displayed counts may be stale; this refresh did not send a new approval.",
            );
        });
      return () => {
        cancelled = true;
      };
    }, [threadId, revision, ready]);
    R.useEffect(() => {
      setDetail(null);
      setSelected([]);
      setError("");
      setFeedback({});
      expanded.current = null;
    }, [threadId]);
    const act = async (action, args, feedbackId = args?.planId) => {
      setWorking(true);
      setError("");
      const report = (kind, text) => {
        if (mounted.current && feedbackId)
          setFeedback((v) => ({ ...v, [feedbackId]: { kind, text } }));
      };
      if (action !== "read")
        report(
          "status",
          action === "approve"
            ? "Submitting approval… waiting for the companion to confirm. Please do not click again."
            : "Updating cleanup status…",
        );
      let accepted = false;
      try {
        const result = await call(action, args);
        accepted = true;
        if (mounted.current && ["approve", "control"].includes(action)) {
          setData(
            (v) =>
              v && {
                ...v,
                plans: v.plans.map((p) => (p.id === result.id ? result : p)),
              },
          );
          report(
            "status",
            action === "approve"
              ? "Approval recorded. See this plan's live execution status above."
              : "Control request accepted. See this plan's live status above.",
          );
        }
        const list = await call("list");
        if (!mounted.current) return;
        setData(list);
        if (action === "list")
          report("status", "Status refreshed from the companion.");
        if (action === "read") {
          setDetail(result);
          expanded.current = args;
        } else if (action === "classify") {
          setSelected([]);
          expanded.current = {
            auditId: args.auditId,
            ...(detail?.tag ? { tagId: args.tagId } : {}),
          };
          const d = await call("read", expanded.current);
          if (mounted.current) setDetail(d);
        }
      } catch (e) {
        if (mounted.current && feedbackId) {
          const code = String(e.code || e.message || e).slice(0, 140);
          const known = messages[code];
          report(
            "error",
            accepted
              ? "The request was accepted, but the latest status could not be loaded. Use Refresh status; do not approve again."
              : known
                ? `${action === "approve" ? "Approval was not accepted. " : "Request stopped. "}${known} (${code})`
                : "The response could not be confirmed. Use Refresh status before trying anything again; do not assume approval failed. (" +
                  code +
                  ")",
          );
        } else if (mounted.current)
          setError(
            "Operation stopped: " + String(e.message || e).slice(0, 140),
          );
      } finally {
        if (mounted.current) setWorking(false);
      }
    };
    if (!data || (!data.audits.length && !data.plans.length))
      return !children && !error && !globalCards.length
        ? null
        : h(
            R.Fragment,
            null,
            ...window.StashAIChronology([children, globalCards]),
            error ? h("p", { role: "status" }, error) : null,
          );
    const locked = busy || working || !ready;
    const pages = (args, page, count, size) =>
      h(
        "div",
        { className: "stash-ai-cleanup-controls" },
        button(
          "Previous page",
          () => act("read", { ...args, page: page - 1 }),
          page <= 1 || locked,
        ),
        h("span", null, `Page ${page} · ${count} entries`),
        button(
          "Next page",
          () => act("read", { ...args, page: page + 1 }),
          page * size >= count || locked,
        ),
      );
    const auditCards = data.audits.map((a) =>
      h(
        "section",
        {
          key: a.id,
          "aria-label": `Library audit ${a.id}`,
          className: "stash-ai-tag-cleanup",
          "data-stash-time": a.createdAt,
        },
        h("h3", null, `Library audit · ${a.status}`),
        h(
          "p",
          null,
          "Only exact native scene–Tag relationships can be removed. Scene records, global Tag definitions, Franchises, Authors and Descriptors are preserved. Scene-card Character notes describe owner classification; this separate audit checks your Character-only Tag policy.",
        ),
        h(
          "p",
          null,
          `${a.scenes} / ${a.total ?? "?"} scenes examined; ${a.tagged} tagged, ${a.untagged} without Tags; ${a.associations} relationships; ${a.classified} / ${a.distinctTags} distinct Tags classified; ${a.reconciled} scenes reconciled.`,
        ),
        h("p", null, a.scope),
        a.inheritedDecisions > 0 &&
          h(
            "p",
            null,
            `${a.inheritedDecisions} saved classification decisions carried forward after checking current Tag evidence. This does not approve removals.`,
          ),
        a.decisionWarnings?.length > 0 &&
          h(
            "p",
            { role: "status" },
            `Saved decisions need review for Tag IDs: ${a.decisionWarnings.map((w) => w.tagId).join(", ")}. These identities remain excluded from cleanup.`,
          ),
        h(
          "p",
          null,
          Object.entries(a.counts || {})
            .map(([category, n]) => `${category}: ${n}`)
            .join(" · "),
        ),
        h("small", null, a.id),
        a.error && h("p", null, a.error),
        button(
          "Inspect candidate groups",
          () => {
            setSelected([]);
            act("read", { auditId: a.id });
          },
          locked,
        ),
        h(
          "label",
          null,
          "Find Tag ID",
          h("input", {
            className: "form-control form-control-sm",
            value: tag,
            inputMode: "numeric",
            onChange: (e) => setTag(e.target.value),
          }),
        ),
        button(
          "Inspect Tag identity",
          () => act("read", { auditId: a.id, tagId: tag }),
          locked || !/^[1-9][0-9]*$/.test(tag),
        ),
        ["paused", "failed"].includes(a.status) &&
          button(
            "Resume read-only audit",
            () => act("resume-audit", { auditId: a.id }),
            locked,
          ),
      ),
    );
    const planCards = data.plans.map((p) =>
      h(
        "section",
        {
          key: p.id,
          "aria-label": `Removal plan ${p.id}`,
          className: "stash-ai-tag-cleanup",
          "data-stash-time": p.createdAt,
        },
        h(
          "h3",
          null,
          `Removal plan · ${p.approvalBlock ? "outdated — replacement required" : p.status}`,
        ),
        h(
          "div",
          {
            className: "stash-ai-cleanup-feedback",
            role: "status",
            "aria-live": "polite",
            "aria-atomic": true,
          },
          h("strong", null, statusText(p)),
          p.approval &&
            h("progress", {
              value: (p.counts.verified || 0) + (p.counts.reconciled || 0),
              max: Math.max(1, p.scenes),
              "aria-label": "Verified scene progress",
            }),
          !ready &&
            h(
              "p",
              null,
              "Disconnected — displayed counts may be stale. Reconnecting will refresh status; do not submit another approval.",
            ),
        ),
        h(
          "p",
          null,
          `${p.scenes} scenes; ${p.relationships} relationships. ${p.prepared} / ${p.expectedScenes} scenes prepared.`,
        ),
        h("p", null, "Tag IDs: " + p.tagIds.join(", ")),
        p.recurrencePrevention &&
          h("p", null, p.recurrencePrevention.explanation),
        h("p", null, "Plan ID: " + p.id),
        h(
          "p",
          { className: "stash-ai-cleanup-digest" },
          "SHA-256: " + (p.digest || "Preparing immutable manifest…"),
        ),
        h("p", null, "Expires: " + new Date(p.expiresAt).toLocaleString()),
        h(
          "p",
          null,
          Object.entries(p.counts)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ") || "No operations attempted",
        ),
        p.error &&
          h(
            "p",
            null,
            `${messages[p.error] || p.error}${p.errorSceneId ? " · Scene " + p.errorSceneId : ""}`,
          ),
        button(
          "Inspect complete removal manifest",
          () => act("read", { planId: p.id }),
          locked,
        ),
        button(
          "Refresh status",
          () => act("list", {}, p.id),
          working || !ready,
        ),
        feedback[p.id] &&
          h(
            "p",
            {
              className:
                "stash-ai-cleanup-feedback " +
                (feedback[p.id].kind === "error"
                  ? "stash-ai-cleanup-error"
                  : ""),
              role: feedback[p.id].kind === "error" ? "alert" : "status",
              "aria-live":
                feedback[p.id].kind === "error" ? "assertive" : "polite",
            },
            feedback[p.id].text,
          ),
        p.status === "awaiting-approval" &&
          h(
            "div",
            null,
            h(
              "p",
              null,
              "Approval authorizes bounded execution of every exact removal in this frozen plan, once—not future matches. Stop concurrent Auto-Tagger/Variant tasks and metadata edits first. Inspect all pages before approving. Already completed removals are not rolled back by Stop.",
            ),
            button(
              `Approve entire cleanup plan — ${p.relationships} removals on ${p.scenes} scenes`,
              () => act("approve", { planId: p.id, digest: p.digest }),
              locked || !!p.approvalBlock || p.expiresAt <= Date.now(),
            ),
          ),
        p.approval &&
          h(
            "div",
            { className: "stash-ai-cleanup-controls" },
            button(
              "Pause",
              () => act("control", { planId: p.id, action: "pause" }),
              working || p.status !== "running",
            ),
            button(
              "Stop future execution",
              () => act("control", { planId: p.id, action: "stop" }),
              working || ["cancelled", "completed"].includes(p.status),
            ),
            button(
              "Reconcile read-only",
              () => act("control", { planId: p.id, action: "reconcile" }),
              locked ||
                !["paused", "uncertain", "conflicted", "cancelled"].includes(
                  p.status,
                ),
            ),
            button(
              "Resume approved remainder",
              () => act("control", { planId: p.id, action: "resume" }),
              locked || !["paused", "uncertain"].includes(p.status),
            ),
          ),
      ),
    );
    const detailCard = detail?.plan
      ? h(
          "section",
          null,
          h("h3", null, "Exact before / remove / after native Tag IDs"),
          h(
            "label",
            null,
            "Find scene ID",
            h("input", {
              className: "form-control form-control-sm",
              value: scene,
              onChange: (e) => setScene(e.target.value),
              inputMode: "numeric",
            }),
          ),
          button(
            "Find in frozen plan",
            () =>
              act("read", {
                planId: detail.plan.id,
                ...(scene ? { sceneId: scene } : {}),
              }),
            locked || !/^[0-9]*$/.test(scene),
          ),
          detail.rows.map((r) =>
            h(
              "article",
              { key: r.id },
              h("a", { href: base + "scenes/" + r.id }, "Scene " + r.id),
              h("p", null, "Before: " + r.before.join(", ")),
              h("p", null, "Remove only: " + r.remove.join(", ")),
              h("p", null, "After: " + (r.after.join(", ") || "No Tags")),
              h("p", null, "Outcome: " + r.outcome.status),
              h("small", null, "Observed " + r.observedAt),
            ),
          ),
          pages(
            { planId: detail.plan.id, ...(scene ? { sceneId: scene } : {}) },
            detail.page,
            detail.count,
            20,
          ),
        )
      : detail?.audit
        ? h(
            "section",
            null,
            h("h3", null, "Tag candidates · " + detail.audit.status),
            detail.candidates?.map((t) =>
              h(
                "article",
                { key: t.tag.id },
                h("strong", null, `${t.tag.name} — Tag ${t.tag.id}`),
                h(
                  "p",
                  null,
                  `${t.category} · ${t.assignments} assignments. ${t.reason}`,
                ),
                t.tag.matches?.length > 0 &&
                  h(
                    "p",
                    null,
                    "Native name matches: " +
                      t.tag.matches
                        .map((m) => `${m.kind} ${m.name} (${m.id})`)
                        .join(", "),
                  ),
                t.eligible
                  ? h(
                      "label",
                      null,
                      h("input", {
                        type: "checkbox",
                        checked: selected.includes(t.tag.id),
                        onChange: (e) =>
                          setSelected((v) =>
                            e.target.checked
                              ? [...v, t.tag.id]
                              : v.filter((id) => id !== t.tag.id),
                          ),
                      }),
                      " Include this eligible Tag in plan draft",
                    )
                  : h(
                      "p",
                      null,
                      "Excluded from automatic cleanup; no removal authorized.",
                    ),
                h(
                  "div",
                  { className: "stash-ai-cleanup-controls" },
                  button(
                    "Inspect exact scene IDs",
                    () =>
                      act("read", {
                        auditId: detail.audit.id,
                        tagId: t.tag.id,
                      }),
                    locked,
                  ),
                  button(
                    "Preview representative scenes",
                    () =>
                      onDraft(
                        `Show scene cards for only these representative scene IDs from audit ${detail.audit.id}, Tag ${t.tag.id}: ${t.examples.join(", ")}. This is a read-only preview, not cleanup approval.`,
                      ),
                    locked || !t.examples.length,
                  ),
                  button(
                    "Character — keep",
                    () =>
                      act("classify", {
                        auditId: detail.audit.id,
                        tagId: t.tag.id,
                        choice: "character",
                        evidence: t.evidence,
                      }),
                    locked || detail.audit.status !== "complete",
                  ),
                  button(
                    "Non-character — record decision",
                    () =>
                      act("classify", {
                        auditId: detail.audit.id,
                        tagId: t.tag.id,
                        choice: "non-character",
                        evidence: t.evidence,
                      }),
                    locked || detail.audit.status !== "complete",
                  ),
                  button(
                    "Leave undecided",
                    () =>
                      act("classify", {
                        auditId: detail.audit.id,
                        tagId: t.tag.id,
                        choice: "undecided",
                        evidence: t.evidence,
                      }),
                    locked || detail.audit.status !== "complete",
                  ),
                ),
                h(
                  "small",
                  null,
                  "Classification decisions do not edit the owner taxonomy or approve cleanup. Recurrence and dependency blocks still apply.",
                ),
              ),
            ),
            detail.sceneIds &&
              h(
                "div",
                null,
                h("h4", null, `${detail.tag.tag.name} — exact assignments`),
                h(
                  "p",
                  null,
                  `${detail.tag.category} · ${detail.count} assignments. ${detail.tag.reason}`,
                ),
                h(
                  "p",
                  null,
                  `Owner evidence: ${detail.tag.owner.reason}. ${detail.tag.eligible ? "Eligible for an unapproved removal preview." : "Excluded from cleanup."}`,
                ),
                h(
                  "div",
                  { className: "stash-ai-cleanup-controls" },
                  ...[
                    ["Character — keep", "character"],
                    ["Non-character — record decision", "non-character"],
                    ["Leave undecided", "undecided"],
                  ].map(([label, choice]) =>
                    button(
                      label,
                      () =>
                        act("classify", {
                          auditId: detail.audit.id,
                          tagId: detail.tag.tag.id,
                          choice,
                          evidence: detail.tag.evidence,
                        }),
                      locked || detail.audit.status !== "complete",
                    ),
                  ),
                ),
                h(
                  "small",
                  null,
                  "Classification only: this does not modify metadata or approve removal.",
                ),
                button(
                  "Preview representative scenes",
                  () =>
                    onDraft(
                      `Show scene cards for only these representative scene IDs from audit ${detail.audit.id}, Tag ${detail.tag.tag.id}: ${detail.sceneIds.slice(0, 3).join(", ")}. Read-only preview, not cleanup approval.`,
                    ),
                  locked || !detail.sceneIds.length,
                ),
                detail.sceneIds.map((id) =>
                  h(
                    "a",
                    { key: id, href: base + "scenes/" + id },
                    `Scene ${id} `,
                  ),
                ),
              ),
            pages(
              {
                auditId: detail.audit.id,
                ...(detail.tag ? { tagId: detail.tag.tag.id } : {}),
              },
              detail.page,
              detail.count,
              detail.tag ? 50 : 20,
            ),
            button(
              "Draft cleanup-plan request",
              () =>
                onDraft(
                  `Prepare a complete immutable scene-tag removal plan from audit ${detail.audit.id} for only these selected eligible Tag IDs: ${selected.join(", ")}. Do not approve or execute it.`,
                ),
              locked || !selected.length || detail.audit.status !== "complete",
            ),
          )
        : null;
    // Expanded evidence belongs beside its own card, not beneath newer messages.
    const cards = [...auditCards, ...planCards].map((card) =>
      h(
        "div",
        {
          key: card.key || card.props.key,
          "data-stash-time": card.props["data-stash-time"],
        },
        card,
        (card.key || card.props.key) === (detail?.plan?.id || detail?.audit?.id)
          ? detailCard
          : null,
      ),
    );
    return h(
      R.Fragment,
      null,
      ...window.StashAIChronology([children, cards, globalCards]),
      error && h("p", { role: "alert" }, error),
    );
  };
})();
