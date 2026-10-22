(function () {
  "use strict";
  if (window.StashAICommandCenter || !window.PluginApi?.React) return;
  const api = window.PluginApi,
    R = api.React,
    h = R.createElement,
    base = document.querySelector("base")?.getAttribute("href") || "/",
    route = "/plugins/stash-ai";
  const KEY = "stash.aiCommandCenter.pairing.v1",
    LAST = "stash.aiCommandCenter.lastThread.v1";
  let lastStatus = {
    version: "0.11.2",
    runtimeState: "not_connected",
    authenticated: false,
    stashReachable: false,
    toolSchema: 10,
    writesEnabled: false,
    lastError: null,
  };
  const safeStorage = {
    get: (k) => {
      try {
        return localStorage.getItem(k) || "";
      } catch {
        return "";
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
  };
  const errors = {
    REVIEW_EVIDENCE_CHANGED:
      "The relevant evidence changed. Refresh the scene and request a new review decision.",
    REVIEW_EVIDENCE_UNAVAILABLE:
      "The complete relevant evidence is unavailable. No review decision was recorded.",
    REVIEW_CONFIRMATION_DENIED:
      "This review confirmation is expired, cancelled or invalid. Request it again from the current scene.",
    REVIEW_DECISION_CHANGED:
      "A newer review decision exists. Refresh before deciding again.",
    REVIEW_DECISIONS_UNAVAILABLE:
      "Saved review decisions are unavailable. Existing records were preserved; no new decision was confirmed.",
    REVIEW_ALREADY_ACKNOWLEDGED:
      "This exact condition is already marked No action needed. Refresh the scene to see it.",
    REVIEW_NOT_ACKNOWLEDGED:
      "There is no active decision to reopen for this finding. Refresh its current state.",
    REVIEW_STORAGE_FULL:
      "The review decision log is full. No records were deleted and no new decision was saved.",
    EMPTY_CHAT_EXPIRED:
      "This unused chat expired after the companion restarted. Your draft is preserved; start a new chat to send it.",
    UNRESOLVED_DESCRIPTOR_OPERATION:
      "An earlier operation on this scene is uncertain. Check its status; do not retry the change. Recovery requires read-only reconciliation or a manual audit.",
    DESCRIPTOR_STALE: "Descriptor metadata changed. Ask for a fresh preview.",
    DESCRIPTOR_OWNER_UNAVAILABLE:
      "The supported Auto-Tagger owner API is unavailable. No changes were made.",
    DESCRIPTOR_UNKNOWN_OR_PROTECTED:
      "That descriptor is unknown or not externally editable. Resolve an owner definition first.",
    COMPENSATION_STALE:
      "Metadata changed after the verified result. Automatic compensation is unsafe; inspect and prepare a new correction.",
    AUTH_REQUIRED: "Pair this browser again using the local companion setup.",
    PAIR_DENIED:
      "Pairing code is invalid, used, or expired. Open Pair.ps1 for a new code.",
    WRITES_DISABLED:
      "Writes are disabled by configuration or runtime safety checks; previews remain read-only.",
    BUSY: "Another conversation is working. Wait or cancel it first.",
    PROPOSAL_STALE:
      "Metadata changed since this preview. Ask for a new proposal.",
    CODEX_NOT_READY:
      "Codex is unavailable or needs login. Check the companion status.",
    PROPOSAL_EXPIRED: "This proposal expired. Ask for a fresh preview.",
    PRESENTATION_DENIED:
      "This collection context is invalid or belongs to another conversation. Remove it or select scenes again. No model request was started.",
    PRESENTATIONS_UNAVAILABLE:
      "Saved collections are unavailable. Remove the collection context to send ordinary text; existing records were preserved.",
  };
  function Page() {
    const [token, setToken] = R.useState(() => safeStorage.get(KEY)),
      [code, setCode] = R.useState(""),
      [thread, setThread] = R.useState(() => safeStorage.get(LAST)),
      [list, setList] = R.useState([]),
      [messages, setMessages] = R.useState([]),
      [proposals, setProposals] = R.useState([]),
      [reviewRequests, setReviewRequests] = R.useState([]),
      [decisionRevision, setDecisionRevision] = R.useState(0),
      [toolSchema, setToolSchema] = R.useState(10),
      [text, setText] = R.useState(""),
      [collectionContext, setCollectionContext] = R.useState(null),
      [status, setStatus] = R.useState(lastStatus),
      [activity, setActivity] = R.useState("Connecting"),
      [busy, setBusy] = R.useState(false),
      [error, setError] = R.useState(""),
      [revision, retry] = R.useState(0),
      [view, setView] = R.useState("simple"),
      [suggestions, setSuggestions] = R.useState(null),
      [suggestionState, setSuggestionState] = R.useState("loading"),
      [suggestionRevision, refreshSuggestions] = R.useState(0),
      [historyLoading, setHistoryLoading] = R.useState(
        () => !!safeStorage.get(LAST),
      );
    const activeThread = R.useRef(thread),
      lifecycle = R.useRef(null),
      transport = R.useRef(null),
      page = R.useRef(null),
      transcript = R.useRef(null),
      nearBottom = R.useRef(true),
      composer = R.useRef(null),
      reviewPanel = R.useRef(null),
      shownReviewRequest = R.useRef(null),
      sending = R.useRef(false);
    R.useEffect(() => {
      const id = reviewRequests[0]?.id;
      if (id && id !== shownReviewRequest.current) {
        shownReviewRequest.current = id;
        reviewPanel.current?.scrollIntoView({ block: "nearest" });
        reviewPanel.current?.focus({ preventScroll: true });
      }
      if (!id) shownReviewRequest.current = null;
    }, [reviewRequests]);
    const advanced = view === "advanced";
    const landing =
      !messages.length && !proposals.length && !busy && !historyLoading;
    const canSend =
      status.runtimeState === "ready" &&
      !busy &&
      !historyLoading &&
      !["Connecting", "Disconnected"].includes(activity);
    R.useLayoutEffect(() => {
      const el = page.current;
      if (!el) return;
      // Size only our route from its actual position below Stash's toolbar.
      // Never change body overflow or leave styles/listeners on other routes.
      const fit = () => {
        const top = el.getBoundingClientRect().top + window.scrollY;
        let bottom = parseFloat(window.getComputedStyle(el).marginBottom) || 0;
        // Stash moves its native toolbar to the bottom at mobile breakpoints.
        // Respect the host's reserved ancestor padding without modifying it.
        for (
          let parent = el.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const style = window.getComputedStyle(parent);
          bottom +=
            (parseFloat(style.paddingBottom) || 0) +
            (parseFloat(style.borderBottomWidth) || 0);
        }
        const viewport = window.visualViewport?.height || window.innerHeight;
        const value = `${Math.max(0, Math.floor(viewport - top - bottom))}px`;
        if (el.style.getPropertyValue("--stash-ai-height") !== value)
          el.style.setProperty("--stash-ai-height", value);
      };
      fit();
      const observer = window.ResizeObserver
        ? new window.ResizeObserver(fit)
        : null;
      if (el.parentElement) observer?.observe(el.parentElement);
      window.addEventListener("resize", fit);
      window.visualViewport?.addEventListener("resize", fit);
      return () => {
        observer?.disconnect();
        window.removeEventListener("resize", fit);
        window.visualViewport?.removeEventListener("resize", fit);
      };
    }, [view]);
    activeThread.current = thread;
    const sceneId = new URLSearchParams(location.search).get("scene");
    const scene = /^[1-9]\d{0,11}$/.test(sceneId || "") ? sceneId : null;
    const resizeComposer = R.useCallback(() => {
      const input = composer.current;
      if (!input) return;
      // Reset first so deleting text also shrinks the field. scrollHeight
      // includes padding; border-box height additionally needs the borders.
      const borders = input.offsetHeight - input.clientHeight;
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight + borders}px`;
    }, []);
    R.useLayoutEffect(resizeComposer, [resizeComposer, text, view, token]);
    R.useEffect(() => {
      const input = composer.current;
      if (!input || !window.ResizeObserver) return;
      let width = input.clientWidth;
      const observer = new window.ResizeObserver(() => {
        // Height changes are our own output, not a reason to resize again.
        if (input.clientWidth === width) return;
        width = input.clientWidth;
        resizeComposer();
      });
      observer.observe(input);
      return () => observer.disconnect();
    }, [resizeComposer, token]);
    const request = R.useCallback(
      async (path, input = {}) => {
        try {
          return await transport.current.call(path, input);
        } catch (e) {
          if (e.name === "AbortError") throw e;
          const error = Error(errors[e.message] || e.message);
          error.code = e.message;
          throw error;
        }
      },
      [token],
    );
    const refresh = R.useCallback(
      async (id) => {
        const data = await request("/history", { id });
        if (lifecycle.current?.signal.aborted || activeThread.current !== id)
          return;
        setMessages(data.messages);
        setToolSchema(data.toolSchema || 1);
        setProposals(data.proposals);
        setReviewRequests(data.reviewRequests || []);
        setBusy(data.active);
        setActivity(data.active ? "Working" : "Ready");
      },
      [request],
    );
    const run = (fn) =>
      Promise.resolve()
        .then(() => {
          setError("");
          return fn();
        })
        .catch((e) => {
          if (e.name !== "AbortError" && !lifecycle.current?.signal.aborted)
            setError(e.message);
        });
    R.useEffect(() => {
      const c = new AbortController(),
        client = new window.StashAITransport(token);
      lifecycle.current = c;
      transport.current = client;
      const suspend = () => {
        c.abort();
        client.close();
      };
      // Chromium may restore the document from back/forward cache without a
      // React remount. Release its old socket on leave and reconnect once on return.
      const resume = (event) => {
        if (event.persisted) {
          setError("");
          retry((value) => value + 1);
        }
      };
      const cleanup = () => {
        window.removeEventListener("pagehide", suspend);
        window.removeEventListener("pageshow", resume);
        suspend();
      };
      if (
        !["localhost", "127.0.0.1"].includes(location.hostname) ||
        location.protocol !== "http:"
      ) {
        setError(
          "This release supports HTTP Stash on this computer only. Remote and HTTPS browser connections are unsupported; do not weaken your server security settings.",
        );
        setActivity("Unsupported connection");
        return cleanup;
      }
      if (!token) {
        setActivity("Pairing required");
        return cleanup;
      }
      async function connect() {
        try {
          const s = await request("/status");
          if (c.signal.aborted) return;
          lastStatus = s;
          setStatus(s);
          const rows = await request("/conversations");
          if (c.signal.aborted) return;
          setList(rows);
          setActivity(s.runtimeState === "ready" ? "Ready" : s.runtimeState);
          if (
            activeThread.current &&
            rows.some((x) => x.id === activeThread.current)
          ) {
            setHistoryLoading(true);
            try {
              await refresh(activeThread.current);
            } finally {
              if (!c.signal.aborted) setHistoryLoading(false);
            }
          } else {
            setThread("");
            setHistoryLoading(false);
          }
          client.onDisconnect = () => {
            if (!c.signal.aborted) {
              setError("Companion disconnected. Retry connection.");
              setBusy(false);
              setActivity("Disconnected");
              lastStatus = {
                ...lastStatus,
                runtimeState: "offline",
                writesEnabled: false,
                lastError: "CONNECTION_FAILED",
              };
              setStatus(lastStatus);
            }
          };
          client.onEvent = (e) =>
            run(async () => {
              if (!c.signal.aborted && e.type === "review-decisions-changed") {
                setDecisionRevision((v) => v + 1);
                return;
              }
              if (!c.signal.aborted && e.type === "suggestions-stale") {
                setSuggestionState("stale");
                setSuggestions(null);
                return;
              }
              if (c.signal.aborted || e.threadId !== activeThread.current)
                return;
              if (e.type === "tag-cleanup") setDecisionRevision((v) => v + 1);
              if (e.type === "global-tag-cleanup")
                setDecisionRevision((v) => v + 1);
              if (e.type === "delta") {
                setMessages((rows) => {
                  const found = rows.find((m) => m.id === e.itemId);
                  return found
                    ? rows.map((m) =>
                        m.id === e.itemId ? { ...m, text: m.text + e.text } : m,
                      )
                    : [
                        ...rows,
                        {
                          id: e.itemId,
                          role: "assistant",
                          text: e.text,
                          timelineAt: Date.now(),
                        },
                      ];
                });
              }
              if (e.type === "activity") {
                setActivity(e.value);
                setBusy(true);
              }
              if (e.type === "completed") {
                await refresh(e.threadId);
                setActivity(e.status);
                setList(await request("/conversations"));
                const currentStatus = await request("/status");
                if (!c.signal.aborted) {
                  lastStatus = currentStatus;
                  setStatus(currentStatus);
                }
              }
              if (e.type === "proposals") {
                const ps = await request("/proposals", { id: e.threadId });
                if (activeThread.current === e.threadId) setProposals(ps);
              }
              if (e.type === "review-decisions") {
                const rows = await request("/review-decisions", {
                  threadId: e.threadId,
                });
                if (activeThread.current === e.threadId)
                  setReviewRequests(rows);
              }
              if (e.type === "error") {
                setError(
                  "Codex disconnected. Restart the companion and retry.",
                );
                setBusy(false);
              }
            });
          await client.call("/events");
        } catch (e) {
          if (!c.signal.aborted) {
            setActivity("Disconnected");
            setError(e.message);
            lastStatus = {
              ...lastStatus,
              runtimeState: "offline",
              lastError: "CONNECTION_FAILED",
            };
          }
        }
      }
      window.addEventListener("pagehide", suspend);
      window.addEventListener("pageshow", resume);
      connect();
      return cleanup;
    }, [token, revision, request, refresh]);
    R.useEffect(() => {
      if (nearBottom.current && transcript.current)
        transcript.current.scrollTop = transcript.current.scrollHeight;
    }, [messages, proposals]);
    // Presentation changes never touch the connection effect above. A single
    // short-lived evidence request uses that same authenticated transport.
    R.useEffect(() => {
      if (!token || !landing || advanced || status.runtimeState !== "ready")
        return;
      let disposed = false,
        timer;
      setSuggestionState("loading");
      request("/suggestions", { refresh: suggestionRevision > 0 })
        .then((data) => {
          if (disposed || lifecycle.current?.signal.aborted) return;
          setSuggestions(data);
          setSuggestionState(Date.now() < data.expiresAt ? "ready" : "stale");
          timer = setTimeout(
            () => {
              if (!disposed) setSuggestionState("stale");
            },
            Math.max(0, data.expiresAt - Date.now()),
          );
        })
        .catch(() => {
          if (!disposed && !lifecycle.current?.signal.aborted)
            setSuggestionState("unavailable");
        });
      return () => {
        disposed = true;
        clearTimeout(timer);
      };
    }, [
      token,
      landing,
      advanced,
      status.runtimeState,
      request,
      suggestionRevision,
      revision,
    ]);
    async function select(id) {
      nearBottom.current = true;
      activeThread.current = id;
      setThread(id);
      setCollectionContext(null);
      safeStorage.set(LAST, id);
      setMessages([]);
      setReviewRequests([]);
      setProposals([]);
      setHistoryLoading(!!id);
      try {
        if (id) await refresh(id);
      } finally {
        if (activeThread.current === id && !lifecycle.current?.signal.aborted)
          setHistoryLoading(false);
      }
    }
    async function create() {
      const r = await request("/new");
      setList(await request("/conversations"));
      await select(r.id);
      setView("simple");
      composer.current?.focus();
      return r.id;
    }
    async function send() {
      if (!canSend || sending.current || !text.trim()) return;
      sending.current = true;
      const value = text;
      const context = collectionContext;
      try {
        let id = thread;
        if (!id) id = await create();
        nearBottom.current = true;
        setBusy(true);
        setActivity("Sending");
        setText("");
        setMessages((rows) => [
          ...rows,
          {
            id: crypto.randomUUID(),
            role: "user",
            text: value,
            timelineAt: Date.now(),
          },
        ]);
        const submit = () =>
          request("/send", {
            id,
            text: value,
            ...(scene ? { sceneId: scene } : {}),
            ...(context ? { collectionContext: context } : {}),
          });
        try {
          await submit();
        } catch (e) {
          // Only this server code guarantees that no turn was dispatched and
          // no history existed. Never retry timeouts or generic send failures.
          if (
            e.code !== "EMPTY_CHAT_EXPIRED" ||
            context ||
            lifecycle.current?.signal.aborted ||
            activeThread.current !== id
          )
            throw e;
          id = await create(); // Preserve the old empty index record.
          setBusy(true);
          setActivity("Sending in a new chat (unused chat expired)");
          setMessages([
            {
              id: crypto.randomUUID(),
              role: "user",
              text: value,
              timelineAt: Date.now(),
            },
          ]);
          await submit(); // At most one recovery attempt.
        }
        // Refresh cancelled previews without replacing optimistic/streaming messages
        // with history that the runtime may not have persisted yet.
        const current = await request("/proposals", { id });
        if (activeThread.current === id) {
          setProposals(current);
          setCollectionContext(null);
        }
      } catch (e) {
        setBusy(false);
        setText(value);
        throw e;
      } finally {
        sending.current = false;
      }
    }
    async function pair() {
      const data = await request("/pair", { code: code.trim() });
      safeStorage.set(KEY, data.token);
      setCode("");
      setToken(data.token);
    }
    async function decide(p, decision) {
      await request("/decision", {
        threadId: thread,
        id: p.id,
        integrity: p.integrity,
        decision,
      });
      setProposals(await request("/proposals", { id: thread }));
    }
    const button = (label, fn, disabled = false, kind = "secondary") =>
      h(
        "button",
        {
          type: "button",
          className: "btn btn-" + kind,
          onClick: () => run(fn),
          disabled,
        },
        label,
      );
    return h(
      "main",
      {
        ref: page,
        className: `stash-ai-page stash-ai-${advanced ? "advanced" : "simple"}${landing ? " stash-ai-landing" : ""}`,
        "data-stash-vocabulary-preserve": "true",
      },
      h(
        "header",
        { className: "stash-ai-header" },
        h("h1", null, "Stash AI"),
        h(
          "button",
          {
            type: "button",
            className: "stash-ai-view-link",
            onClick: () => setView(advanced ? "simple" : "advanced"),
          },
          advanced ? "Simple View" : "Advanced View",
        ),
      ),
      advanced &&
        h(
          "p",
          { className: "stash-ai-muted" },
          "Your library assistant • Codex-connected • Changes require a separate approval",
        ),
      advanced &&
        h(
          "div",
          { className: "stash-ai-toolbar" },
          h(
            "a",
            {
              href: base + "plugins/library-review",
              className: "btn btn-secondary",
            },
            "Review Center",
          ),
          button("Retry connection", () => retry((x) => x + 1)),
          h("span", { role: "status" }, token ? activity : "Pairing required"),
        ),
      error &&
        h(
          "div",
          { role: "alert", className: "alert alert-warning" },
          error,
          !advanced && button("Retry connection", () => retry((x) => x + 1)),
        ),
      !token
        ? h(
            "section",
            null,
            h("h2", null, "Connect your local companion"),
            h(
              "p",
              null,
              "Run Pair.ps1 from the installed companion folder. Enter its single-use code here. No ChatGPT password or Stash API key is needed in this page.",
            ),
            h(
              "label",
              null,
              "Pairing code",
              h("input", {
                type: "password",
                autoComplete: "off",
                className: "form-control",
                value: code,
                onChange: (e) => setCode(e.target.value),
              }),
            ),
            button("Pair this browser", pair, !code),
          )
        : h(
            R.Fragment,
            null,
            h(
              "div",
              { className: "stash-ai-toolbar" },
              button(
                advanced ? "New conversation" : "New Chat",
                create,
                busy || historyLoading || status.runtimeState !== "ready",
              ),
              h(
                "select",
                {
                  "aria-label": "Conversation history",
                  className: "form-control",
                  value: thread,
                  disabled: busy || historyLoading,
                  onChange: (e) => {
                    const id = e.target.value;
                    run(() => select(id));
                  },
                },
                h("option", { value: "" }, "Select a conversation"),
                list.map((c) =>
                  h("option", { key: c.id, value: c.id }, c.title),
                ),
              ),
              !advanced &&
                h(
                  "span",
                  { className: "stash-ai-connection", role: "status" },
                  busy ? "Working" : activity,
                ),
              advanced &&
                button("Disconnect browser", async () => {
                  await request("/unpair");
                  safeStorage.set(KEY, "");
                  setToken("");
                }),
            ),
            scene &&
              h(
                "p",
                null,
                "Explicit context: ",
                h("a", { href: base + "scenes/" + scene }, "Scene " + scene),
              ),
            thread &&
              toolSchema < 10 &&
              h(
                "p",
                { className: "stash-ai-muted" },
                "Legacy conversation · tool contract v" +
                  toolSchema +
                  ". Original tool catalog retained. Start a new conversation for v10 library tag audits and cleanup plans.",
              ),
            !advanced &&
              landing &&
              h(
                "section",
                { className: "stash-ai-welcome", "aria-label": "Welcome" },
                h("h2", null, "What would you like to do with your library?"),
                h(
                  "p",
                  { className: "stash-ai-muted" },
                  "Search, explore, or prepare a change. You stay in control.",
                ),
                h(
                  "div",
                  {
                    className: "stash-ai-suggestions",
                    "aria-label": "Library observations",
                  },
                  suggestionState === "loading"
                    ? h(
                        "p",
                        { role: "status" },
                        "Checking a small set of library signals…",
                      )
                    : suggestionState === "stale"
                      ? h(
                          "p",
                          null,
                          "Observations have expired. Refresh to check current evidence.",
                        )
                      : suggestionState === "unavailable"
                        ? h(
                            "p",
                            null,
                            "Suggestions are unavailable. You can still write a request.",
                          )
                        : suggestions?.items?.length
                          ? suggestions.items.slice(0, 4).map((item) =>
                              h(
                                "button",
                                {
                                  key: item.id,
                                  type: "button",
                                  className: "stash-ai-suggestion",
                                  onClick: () => {
                                    if (Date.now() >= item.expiresAt) {
                                      setSuggestionState("stale");
                                      return;
                                    }
                                    setText(item.prompt);
                                    setCollectionContext(null);
                                    composer.current?.focus();
                                  },
                                },
                                h("strong", null, item.title),
                                h("span", null, item.description),
                                h("small", null, item.trigger),
                              ),
                            )
                          : h(
                              "p",
                              null,
                              "No verified issues surfaced from the available checks. This was not a full-library review.",
                            ),
                  suggestionState === "ready" &&
                    suggestions &&
                    h(
                      "p",
                      { className: "stash-ai-muted" },
                      "Checked ",
                      new Date(suggestions.observedAt).toLocaleTimeString(),
                      " · ",
                      suggestions.sources.some((s) => s.state === "unavailable")
                        ? "Some sources unavailable · "
                        : "",
                      "Select an observation to draft a request; nothing is sent.",
                    ),
                  suggestionState !== "loading" &&
                    button("Refresh suggestions", () =>
                      refreshSuggestions((x) => x + 1),
                    ),
                ),
              ),
            h(
              "div",
              {
                className: "stash-ai-messages",
                hidden: !advanced && landing,
                ref: transcript,
                "aria-label": "Conversation",
                onScroll: (e) => {
                  const el = e.currentTarget;
                  nearBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                },
              },
              h(
                window.StashAITagCleanup,
                {
                  key: thread,
                  threadId: thread,
                  request,
                  revision: decisionRevision,
                  busy: busy || historyLoading,
                  ready:
                    Boolean(thread && token) &&
                    ![
                      "Connecting",
                      "Disconnected",
                      "Pairing required",
                    ].includes(activity),
                  base,
                  onContentChange: () => {
                    if (nearBottom.current && transcript.current)
                      transcript.current.scrollTop =
                        transcript.current.scrollHeight;
                  },
                  onDraft: (draft) => {
                    setText(draft);
                    setCollectionContext(null);
                    composer.current?.focus();
                  },
                },
                messages.length
                  ? messages.map((m) =>
                      h(
                        "article",
                        {
                          key: m.id,
                          className: "stash-ai-message",
                          "data-role": m.role,
                          "data-stash-time": m.timelineAt,
                        },
                        h(
                          "strong",
                          { className: "stash-ai-speaker" },
                          m.role === "user" ? "You" : "Stash AI",
                        ),
                        h(
                          "div",
                          { className: "stash-ai-text" },
                          window.StashAIMessage(h, m.text, base),
                        ),
                        button("Copy", () =>
                          navigator.clipboard.writeText(m.text),
                        ),
                        window.StashAISceneResults &&
                          m.role === "assistant" &&
                          (m.collections || []).map((collection) =>
                            h(window.StashAISceneResults, {
                              key: `${thread}:${collection.id}`,
                              collection,
                              threadId: thread,
                              request,
                              decisionRevision,
                              onDecision: (input) =>
                                run(async () => {
                                  await request("/review-decision-request", {
                                    ...input,
                                    threadId: thread,
                                  });
                                  if (activeThread.current === thread)
                                    setReviewRequests(
                                      await request("/review-decisions", {
                                        threadId: thread,
                                      }),
                                    );
                                }),
                              base,
                              onAsk: (draft, context = null) => {
                                setText(draft);
                                setCollectionContext(context);
                                composer.current?.focus();
                              },
                            }),
                          ),
                      ),
                    )
                  : h(
                      "p",
                      null,
                      historyLoading
                        ? "Loading conversation…"
                        : "Try “Find scenes by an Author with no Franchise” or “Show this scene’s Characters and Authors.” Missing metadata is not automatically a defect.",
                    ),
                window.StashAIReview &&
                  reviewRequests.map((review, index) =>
                    h(window.StashAIReview.Confirmations, {
                      key: review.id,
                      "data-stash-time": review.createdAt,
                      panelRef:
                        index === reviewRequests.length - 1
                          ? reviewPanel
                          : undefined,
                      requests: [review],
                      busy: busy || historyLoading,
                      onConfirm: (r, decision) =>
                        run(async () => {
                          await request("/review-decision-confirm", {
                            threadId: thread,
                            id: r.id,
                            token: r.token,
                            decision,
                          });
                          if (activeThread.current === thread) {
                            setReviewRequests(
                              await request("/review-decisions", {
                                threadId: thread,
                              }),
                            );
                            setDecisionRevision((v) => v + 1);
                          }
                        }),
                    }),
                  ),
                proposals.map((p) =>
                  h(
                    !advanced &&
                      ["rejected", "cancelled", "superseded"].includes(p.status)
                      ? "details"
                      : "section",
                    {
                      key: p.id,
                      className: "stash-ai-proposal",
                      "data-stash-time": p.createdAt,
                    },
                    !advanced &&
                      ["rejected", "cancelled", "superseded"].includes(
                        p.status,
                      ) &&
                      h(
                        "summary",
                        null,
                        "Change preview · " +
                          p.status +
                          " · Scene " +
                          p.rows.map((row) => row.id).join(", "),
                      ),
                    h(
                      "h2",
                      null,
                      "Change preview · " + p.rows.length + " scene(s)",
                    ),
                    h("p", null, "Status: " + p.status + " · " + p.scope),
                    p.descriptorPreview &&
                      h(
                        "section",
                        { className: "stash-ai-relationship" },
                        h(
                          "h3",
                          null,
                          p.compensates
                            ? "Descriptor compensation"
                            : "Descriptor assignments",
                        ),
                        ...[
                          "current",
                          "proposed",
                          "added",
                          "removed",
                          "unchanged",
                        ].map((key) =>
                          h(
                            "p",
                            { key },
                            h("strong", null, key + ": "),
                            p.descriptorPreview[key]
                              .map(
                                (d) =>
                                  `${d.name} (${d.category === "acts" ? "Act / position" : "Ending"}; ${d.id})`,
                              )
                              .join("; ") || "None",
                          ),
                        ),
                        h(
                          "p",
                          null,
                          `${p.descriptorPreview.operationCount} assignment changes. Review status, source and learning: unchanged.`,
                        ),
                        h(
                          "p",
                          null,
                          "Operation ID: " +
                            p.id +
                            (p.compensates
                              ? " · Compensates: " + p.compensates
                              : ""),
                        ),
                      ),
                    p.summary &&
                      h(
                        "p",
                        null,
                        `Matched: ${p.summary.matched ?? "unknown"} · Evaluated: ${p.summary.evaluated} · Eligible/included: ${p.summary.included} · Already correct: ${p.summary.alreadyCorrect} · Conflicts: ${p.summary.conflicts}. Target IDs: ${p.summary.targetIds.join(", ") || "none"}. ${p.summary.scope}`,
                      ),
                    h(
                      "p",
                      null,
                      "Expires: " + new Date(p.expiresAt).toLocaleTimeString(),
                    ),
                    p.rows.map((row) =>
                      h(
                        "details",
                        { key: row.id, open: p.rows.length === 1 },
                        h(
                          "summary",
                          null,
                          "Scene " + row.id + " — " + (row.label || "Untitled"),
                        ),
                        h(
                          "a",
                          { href: base + "scenes/" + row.id },
                          "Open scene",
                        ),
                        row.outcome &&
                          h(
                            "p",
                            null,
                            row.outcome +
                              (row.conflicts?.length
                                ? " · " + row.conflicts.join(", ")
                                : ""),
                          ),
                        (row.diffs || []).map((d) =>
                          h(
                            "section",
                            {
                              key: d.relationship,
                              className: "stash-ai-relationship",
                            },
                            h(
                              "h3",
                              null,
                              {
                                tags: "Characters / tags",
                                studio: "Franchise",
                                groups: "Authors",
                              }[d.relationship] +
                                " · " +
                                d.action,
                            ),
                            [
                              "before",
                              "after",
                              "added",
                              "removed",
                              "unchanged",
                            ].map((key) =>
                              h(
                                "p",
                                { key },
                                h("strong", null, key + ": "),
                                d[key].length
                                  ? d[key]
                                      .map((e) => `${e.name} (ID ${e.id})`)
                                      .join("; ")
                                  : "None",
                              ),
                            ),
                            d.associationAfter &&
                              h(
                                "p",
                                null,
                                "Author indexes: " +
                                  d.associationAfter
                                    .map(
                                      (g) =>
                                        `${g.group_id}: ${g.scene_index ?? "unset"}`,
                                    )
                                    .join("; "),
                              ),
                          ),
                        ),
                        h(
                          "div",
                          { className: "stash-ai-diff" },
                          h(
                            "div",
                            null,
                            "Before",
                            h("pre", null, JSON.stringify(row.before, null, 2)),
                          ),
                          h(
                            "div",
                            null,
                            "After",
                            h("pre", null, JSON.stringify(row.after, null, 2)),
                          ),
                        ),
                      ),
                    ),
                    h("p", { className: "stash-ai-muted" }, p.recovery),
                    h(
                      "div",
                      { className: "stash-ai-toolbar" },
                      button(
                        "Approve exact changes",
                        () => decide(p, "approve"),
                        p.status !== "pending" || !status.writesEnabled || busy,
                        "primary",
                      ),
                      button(
                        "Reject",
                        () => decide(p, "reject"),
                        p.status !== "pending",
                      ),
                      button(
                        "Cancel proposal",
                        () => decide(p, "cancel"),
                        p.status !== "pending",
                      ),
                    ),
                    !status.writesEnabled &&
                      h(
                        "p",
                        null,
                        "Writes are currently disabled by configuration or runtime safety checks. Previews do not change metadata.",
                      ),
                  ),
                ),
              ),
            ),
            h(
              "section",
              {
                className: "stash-ai-compose-area",
                "aria-label": "Write a message",
              },
              collectionContext &&
                h(
                  "div",
                  { className: "stash-ai-draft-context", role: "status" },
                  `Collection ${collectionContext.type === "refinement" ? "refinement" : "selection"} draft · ${collectionContext.sceneIds.length} selected · IDs: ${collectionContext.sceneIds.join(", ") || "none"}. Membership is checked on Send; metadata must be re-read.`,
                  button("Remove collection context", () =>
                    setCollectionContext(null),
                  ),
                ),
              busy &&
                h(
                  "p",
                  { className: "stash-ai-activity", role: "status" },
                  activity,
                ),
              h(
                "div",
                { className: "stash-ai-composer" },
                h("label", { htmlFor: "stash-ai-composer" }, "Message"),
                h("textarea", {
                  id: "stash-ai-composer",
                  ref: composer,
                  className: "form-control",
                  value: text,
                  placeholder:
                    "Ask Codex to search, organize, or update your Stash library…",
                  maxLength: 12000,
                  onChange: (e) => setText(e.target.value),
                  onKeyDown: (e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                      e.preventDefault();
                      run(send);
                    }
                  },
                }),
                h(
                  "div",
                  { className: "stash-ai-toolbar" },
                  button("Send", send, !canSend || !text.trim(), "primary"),
                  button(
                    "Cancel request",
                    async () => {
                      await request("/cancel", { id: thread });
                      setActivity("Cancellation requested");
                    },
                    !busy,
                  ),
                ),
              ),
              h(
                "p",
                { className: "stash-ai-muted" },
                advanced
                  ? "Enter sends · Shift+Enter adds a line. New instructions cancel ordinary pending previews. Frozen cleanup plans remain separate; use Pause/Stop to halt approved execution. Only requested metadata is sent to Codex. HTML and external content are never executed."
                  : proposals.some((p) => p.status === "pending")
                    ? "Sending a new message cancels pending previews. Switching views or drafting text does not."
                    : "Enter to send · Shift+Enter for a new line · Changes need your approval",
              ),
            ),
          ),
    );
  }
  api.register.route(route, Page);
  api.patch.before("ScenePage.Tabs", (props) => [
    {
      ...props,
      children: h(
        R.Fragment,
        null,
        props.children,
        props.scene?.id &&
          h(
            "li",
            { className: "nav-item" },
            h(
              "a",
              {
                className: "nav-link",
                href:
                  base +
                  "plugins/stash-ai?scene=" +
                  encodeURIComponent(props.scene.id),
              },
              "Ask Stash AI",
            ),
          ),
      ),
    },
  ]);
  window.StashAICommandCenter = {
    version: "0.11.2",
    apiVersion: 1,
    route,
    status: () => ({
      ...lastStatus,
      pluginAdapters: lastStatus.pluginAdapters
        ? {
            ...lastStatus.pluginAdapters,
            freshness:
              lastStatus.runtimeState !== "ready"
                ? "unknown"
                : Date.now() - lastStatus.pluginAdapters.time < 60000
                  ? "fresh"
                  : "stale",
          }
        : undefined,
    }),
  };
  function publish() {
    if (window.StashCustom?.apiVersion === 1)
      window.StashCustom.capabilities.register({
        id: "ai-command-center",
        apiVersion: 1,
        pluginId: "stash-ai-command-center",
        version: "0.11.2",
        schemaVersion: 10,
        api: window.StashAICommandCenter,
      });
  }
  publish();
  if (!window.StashCustom)
    window.addEventListener("stash-custom:ready", publish, { once: true });
})();
