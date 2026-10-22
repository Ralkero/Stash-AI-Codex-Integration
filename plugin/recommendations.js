(function () {
  "use strict";
  if (window.StashAIReview || !window.PluginApi?.React) return;
  const h = window.PluginApi.React.createElement;
  const button = (label, onClick, disabled) =>
    h(
      "button",
      {
        type: "button",
        className: "btn btn-sm btn-secondary",
        onClick,
        disabled,
      },
      label,
    );
  const stateText = {
    active:
      "No action requested for this matching condition. The factual finding remains unchanged.",
    changed:
      "You previously marked this finding No action needed, but its relevant evidence changed. The earlier decision does not cover the new condition.",
    unverified:
      "You previously marked this finding No action needed. The current condition could not be verified; the earlier decision is not being applied.",
    reopened:
      "You reopened this finding. Ordinary recommendations apply again.",
  };
  function Recommendations({ scene, stale, onAsk, onDecision, base = "/" }) {
    const data = scene.recommendations;
    function decision(key, action, fingerprint) {
      onDecision({
        sceneId: scene.sceneId,
        findings: [key],
        action,
        expected: fingerprint ? { [key]: fingerprint } : {},
      });
    }
    const prior = (d) =>
      h(
        "div",
        { key: d.key, className: "stash-ai-review-state" },
        h("small", null, stateText[d.state]),
        d.note && h("p", null, `Your note: ${d.note}`),
        h(
          "small",
          null,
          `Decision recorded ${new Date(d.at).toLocaleString()}.`,
        ),
        d.state !== "reopened" &&
          button(
            "Reopen finding",
            () => decision(d.key, "reopen"),
            stale || !onDecision,
          ),
      );
    const row = (r) =>
      h(
        "div",
        { key: r.key, className: "stash-ai-recommendation" },
        h("strong", null, r.title),
        h("small", null, ` · ${r.category}`),
        h("p", null, r.explanation),
        r.clarificationRequired &&
          h("small", null, "Intended correction requires your clarification."),
        r.decision && prior(r.decision),
        h(
          "div",
          { className: "stash-ai-scene-actions" },
          r.key === "descriptor-review" &&
            r.decision?.state !== "active" &&
            !stale &&
            h(
              "a",
              {
                className: "btn btn-sm btn-secondary",
                href: `${base}plugins/scene-descriptor-review?scene=${scene.sceneId}`,
              },
              "Open Descriptor Review",
            ),
          r.draft &&
            button(
              r.category === "optional clarification"
                ? "Draft explanation request"
                : "Draft investigation request",
              () => onAsk(r.draft),
              stale,
            ),
          r.canAcknowledge &&
            button(
              "No action needed…",
              () => decision(r.key, "no-action", r.fingerprint),
              stale || !onDecision,
            ),
        ),
        h(
          "details",
          null,
          h("summary", null, "Recommendation evidence"),
          h(
            "small",
            null,
            `Scene ${r.sceneId}; ${r.key}; source ${r.authority}; ${stale ? "needs revalidation" : r.evidenceStatus}; checked ${r.observedAt}. ${r.capability}.`,
          ),
        ),
      );
    return h(
      "section",
      {
        className: "stash-ai-recommendations",
        "aria-label": "Recommended actions",
      },
      h("h5", null, "Recommended actions"),
      stale &&
        h(
          "p",
          null,
          "Refresh current evidence before acting on these recommendations.",
        ),
      !data &&
        h(
          "p",
          null,
          "Current recommendations are unavailable. Recheck the scene before requesting changes.",
        ),
      data?.summary && h("p", null, data.summary),
      data?.decisionStorage && h("p", null, data.decisionStorage),
      data?.incomplete &&
        h(
          "small",
          null,
          "Some checks could not be completed; no issue is inferred from missing evidence.",
        ),
      data?.rows.slice(0, 3).map(row),
      data?.rows.length > 3 &&
        h(
          "details",
          null,
          h("summary", null, "More recommended actions"),
          data.rows.slice(3).map(row),
        ),
      data?.prior.map((d) =>
        h(
          "div",
          { key: d.key },
          h("strong", null, `Previous decision: ${d.key}`),
          prior(d),
        ),
      ),
    );
  }
  function Confirmations({ requests, busy, onConfirm, panelRef }) {
    return h(
      "div",
      {
        className: "stash-ai-review-confirmations",
        ref: panelRef,
        tabIndex: -1,
      },
      requests.map((r) =>
        h(
          "section",
          {
            key: r.id,
            className: "stash-ai-review-confirmation",
            "aria-label": "Confirm Stash AI review decision",
          },
          h(
            "h4",
            null,
            r.action === "reopen"
              ? "Reopen these findings?"
              : "Mark these findings No action needed?",
          ),
          h("p", null, `Scene ${r.sceneId} — only the following findings:`),
          h(
            "ul",
            null,
            r.rows.map((row) => h("li", { key: row.key }, row.label)),
          ),
          r.note && h("p", null, `Requested note: ${r.note}`),
          h(
            "p",
            null,
            "This changes only your Stash AI review decision. It does not change scene metadata, complete Descriptor Review, clear Needs Review, or approve any metadata proposal.",
          ),
          h(
            "small",
            null,
            `Expires ${new Date(r.expiresAt).toLocaleTimeString()}. Starting another message cancels this request.`,
          ),
          h(
            "div",
            { className: "stash-ai-scene-actions" },
            button(
              r.action === "reopen"
                ? "Confirm reopen"
                : "Confirm no action needed",
              () => onConfirm(r, "confirm"),
              busy,
            ),
            button(
              "Cancel review decision",
              () => onConfirm(r, "cancel"),
              busy,
            ),
          ),
        ),
      ),
    );
  }
  window.StashAIReview = { Recommendations, Confirmations };
})();
