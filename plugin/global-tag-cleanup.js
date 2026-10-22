(function () {
  "use strict";
  const R = PluginApi.React,
    h = R.createElement;
  const explanations = {
    GLOBAL_BACKUP_STALE:
      "Library metadata changed since the recovery backup. No deletion was sent; prepare a fresh backup and exact plan.",
    GLOBAL_METADATA_CHANGED:
      "Metadata changed after this plan was prepared. No deletion was sent; request a fresh exact plan.",
    GLOBAL_ENVIRONMENT_CHANGED:
      "Plugin configuration, code or Character evidence changed. No deletion was sent; review before preparing a new plan.",
    GLOBAL_CHARACTER_KEEP:
      "A saved Character decision protects one of these tags. Nothing was deleted.",
    GLOBAL_READBACK_MISMATCH:
      "The result does not exactly match the approved plan. Do not retry deletion; inspect the recovery checkpoint.",
    GLOBAL_BACKUP_CHANGED:
      "The recovery archive is missing or changed. Deletion is blocked.",
    GLOBAL_WRITES_BLOCKED:
      "Writes are disabled, a chat is active, or another approved operation needs attention.",
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
  window.StashAIGlobalCleanup = {
    useCards: function ({
      threadId,
      request,
      revision,
      ready,
      busy,
      onContentChange,
    }) {
      const [data, setData] = R.useState(null),
        [detail, setDetail] = R.useState(null),
        [error, setError] = R.useState(""),
        [working, setWorking] = R.useState(false),
        [ack, setAck] = R.useState({});
      const generation = R.useRef(0);
      const call = (action, args = {}) =>
        request("/global-tag-cleanup", { threadId, action, args });
      R.useEffect(() => {
        generation.current++;
        setData(null);
        setDetail(null);
        setError("");
        setAck({});
        setWorking(false);
        return () => {
          generation.current++;
        };
      }, [threadId]);
      R.useEffect(() => {
        const current = generation.current;
        let cancelled = false;
        if (ready)
          call("list")
            .then((v) => {
              if (!cancelled && generation.current === current) {
                setData(v);
                setError("");
              }
            })
            .catch(() => {
              if (!cancelled)
                setError(
                  "Global cleanup status could not be refreshed. No new approval was sent.",
                );
            });
        return () => {
          cancelled = true;
        };
      }, [threadId, revision, ready]);
      R.useEffect(() => {
        onContentChange?.();
      }, [data, detail, error]);
      const act = async (action, args = {}) => {
        const current = generation.current;
        setWorking(true);
        setError("");
        try {
          const r = await call(action, args);
          if (current !== generation.current) return;
          if (action === "read") setDetail(r);
          if (action === "approve") setAck({});
          const v = await call("list");
          if (current === generation.current) setData(v);
        } catch (e) {
          if (current === generation.current)
            setError(
              (explanations[e.message] ||
                "Response could not be confirmed. Refresh status before taking further action; do not assume approval failed.") +
                " (" +
                String(e.message).slice(0, 120) +
                ")",
            );
        } finally {
          if (current === generation.current) setWorking(false);
        }
      };
      const locked = working || busy || !ready;
      const cards = (data?.plans || []).map((p) =>
        h(
          "section",
          {
            key: p.id,
            className: "stash-ai-proposal stash-ai-global-cleanup",
            "data-stash-time": p.createdAt,
            "data-global-plan": p.id,
          },
          h("h2", null, "Global tag cleanup · " + p.status),
          h("p", { role: "status", "aria-live": "polite" }, p.stage),
          p.error &&
            h("p", { role: "alert" }, explanations[p.error] || p.error),
          p.counts &&
            h(
              "p",
              null,
              `${p.counts.tags} global tags · ${p.counts.sceneAssignments} assignments on ${p.counts.scenes} scenes · ${p.counts.imageAssignments} assignments on ${p.counts.images} images · ${p.counts.aliases} tag aliases · ${p.counts.artwork} unshared tag artwork files.`,
            ),
          h(
            "p",
            null,
            "Saved Character decisions and all other metadata are protected. No source media is deleted. Auto-Tagger is unchanged; tags may recur.",
          ),
          p.backup &&
            h(
              "details",
              null,
              h("summary", null, "Verified recoverable backup"),
              h("p", null, p.backup.archive),
              h("p", null, "SHA-256: " + p.backup.sha256),
            ),
          h("p", null, "Plan: " + p.id),
          p.digest && h("p", null, "Exact plan SHA-256: " + p.digest),
          button(
            "Review exact tags and assignments",
            () => act("read", { planId: p.id }),
            locked,
          ),
          button("Refresh global cleanup status", () => act("list"), locked),
          p.status === "awaiting-approval" &&
            h(
              R.Fragment,
              null,
              h(
                "p",
                null,
                "Approval starts a single native deletion transaction after safety checks. Stop cannot undo a deletion already dispatched. Native Stash cannot atomically check metadata and delete; avoid concurrent library activity. A changed library or backup blocks the plan.",
              ),
              h(
                "label",
                null,
                h("input", {
                  type: "checkbox",
                  checked: !!ack[p.id],
                  disabled: locked,
                  onChange: (e) =>
                    setAck((v) => ({ ...v, [p.id]: e.target.checked })),
                }),
                " I reviewed these exact global tags and their assignments. No scans, Auto-Tagger jobs, playback or other metadata edits will run during cleanup. I understand that recovery requires an explicit database + blob restore.",
              ),
              button(
                "Approve exact global tag deletion",
                () =>
                  act("approve", {
                    planId: p.id,
                    digest: p.digest,
                    acknowledge: "DELETE EXACT GLOBAL TAGS",
                  }),
                locked || !ack[p.id] || !p.canApprove,
              ),
            ),
          !p.deletionDispatched &&
            ["preparing", "awaiting-approval", "preflight"].includes(
              p.status,
            ) &&
            button(
              "Stop before deletion",
              () => act("control", { planId: p.id, action: "stop" }),
              working || !ready,
            ),
          p.status === "uncertain" &&
            button(
              "Reconcile read-only (never retry)",
              () => act("control", { planId: p.id, action: "reconcile" }),
              locked,
            ),
          detail?.plan.id === p.id &&
            h(
              "details",
              { open: true },
              h("summary", null, "Exact plan details (not approval)"),
              h("p", null, detail.scope),
              h(
                "p",
                null,
                "Confirmed identities: " +
                  detail.tags.map((t) => `${t.name} (#${t.id})`).join("; "),
              ),
              h(
                "p",
                null,
                "Tag artwork eligible for removal: " +
                  (detail.artwork.join(", ") || "None"),
              ),
              ...(detail.limitations || []).map((t, i) =>
                h("p", { key: i }, t),
              ),
              h(
                "p",
                null,
                `Exact database rows · page ${detail.page} · ${detail.count} total`,
              ),
              h("pre", null, JSON.stringify(detail.rows, null, 2)),
              button(
                "Previous assignment page",
                () => act("read", { planId: p.id, page: detail.page - 1 }),
                locked || detail.page <= 1,
              ),
              button(
                "Next assignment page",
                () => act("read", { planId: p.id, page: detail.page + 1 }),
                locked || detail.page * 100 >= detail.count,
              ),
            ),
        ),
      );
      if (
        data?.preparationAvailable &&
        !data.plans.some((p) =>
          [
            "preparing",
            "awaiting-approval",
            "preflight",
            "deleting",
            "verifying",
            "uncertain",
            "completed",
          ].includes(p.status),
        )
      )
        cards.push(
          h(
            "section",
            {
              key: "global-prepare",
              className: "stash-ai-proposal",
              "data-stash-time": Date.now(),
            },
            h("h2", null, "Confirmed global tag cleanup"),
            h(
              "p",
              null,
              "Prepare the exact plan from the separately confirmed identities and verified backup. This does not approve or delete anything.",
            ),
            button(
              "Prepare confirmed global cleanup plan",
              () => act("prepare"),
              locked,
            ),
          ),
        );
      if (error)
        cards.push(h("p", { key: "global-error", role: "alert" }, error));
      return cards;
    },
  };
})();
