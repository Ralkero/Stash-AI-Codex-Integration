# Changelog

## 0.11.1 — 2026-10-20

- Chronology hotfix: unify messages, attached results, audits, cleanup plans,
  ordinary proposals and review confirmations in an oldest-first transcript.
  Status refreshes do not reorder old cards; expanded evidence stays beside its
  originating card. Read-only history timestamps; no saved-record migration.
- Extend exact cleanup eligibility to six additional user-confirmed Franchise Tags,
  requiring explicit decisions and matching Auto-Tagger 0.9.24 recurrence policy.
- Carry saved decisions into fresh audits only within the same authenticated owner
  and conversation and when native/owner evidence matches. Changed evidence remains
  excluded; edits during an audit fail the refresh rather than losing a keep decision.
- Add classification-only controls to exact identity lookup and visible carryover counts.
- Preserve historical audits/plans, tool contract 10, isolated runtime, REMOVE-only
  execution, native metadata preservation guards and separate full-plan approval.

## 0.11.0 — 2026-10-20

- Feedback hotfix: plan-local approval messages survive background refresh; immediate
  submission feedback, verified progress/counts, disconnect/uncertain-response guidance,
  read-only status refresh, newest plans before candidates. Outdated decision revisions
  are visibly blocked. Authorization and executor semantics are unchanged.
- Contract 10: five narrowly typed background audit/preview/status tools, 24 total
  with compatible owners; previous chats keep their saved catalogs.
- Durable two-pass scene-ID audit, exact Tag groups, owner-grounded evidence,
  explicit classification decisions, dependency/recurrence blocks.
- Separate immutable REMOVE-only cleanup manifest and one authenticated full-plan
  approval. Sequential executor, durable intent, preflight/readback, pause/stop,
  conservative restart/reconciliation and no uncertain-write retry.
- Scoped conversation UI for progress, paginated candidates and before/after rows.
- Independently versioned Auto-Tagger 0.9.23 distinct-tag read extension and explicit
  Tag 1008 scene-writer prevention. Classifier/Descriptor semantics unchanged.
- Existing ordinary proposals, review decisions, isolated home and rich collections
  remain separate. Production execution requires actual user UI approval.

## 0.10.2 — 2026-10-20

- Fixed evidence-based Recommended actions at the bottom of every rich card.
- Editable investigation/explanation drafts and existing scene-specific Descriptor Review link.
- Exact finding/evidence-scoped No action needed and Reopen with explicit authenticated UI confirmation.
- Protected schema-1 audit log, restart/cross-chat persistence, stale evidence and replay safeguards.
- Contract 9 adds prepare-only review confirmation requests; no new metadata writer or owner change.
- Preserve existing catalogs, immutable historical results, journal 3, sidecar 1 and runtime isolation.

## 0.10.0 — 2026-10-20

- Read-only selected-scene review, fixed authoritative checks and explicit uncertainty.
- Draft-only per-finding correction workflow using existing previews and approvals.
- Historical/current verification and separate per-scene operation feedback.
- Local search-capability preflight; exact, bounded and unsupported criteria retained.
- Contract 8 adds one bounded read tool; no new writer, migration or runtime upgrade.
- Harden expired/excluded/unexecuted operation display and failed-refresh wording.
- Preserve existing chats, owner integrations and isolated runtime; validated installed
  rejection-only workflow with zero production metadata writes.

## 0.9.0 — 2026-10-20

- Local AND filters for Character state/completeness, Author, Franchise, owner
  review, current verified conditions and separately labeled original findings.
- Stable local ID/duration sorting with original-order restoration.
- Bounded card selection, explicit hidden selections, draft-only follow-ups and
  distinct Search Stash again action.
- Validate optional collection context before Send side effects; no new model
  tools, mutation authority, sidecar migration or owner-plugin changes.
- Preserve Simple/Advanced state and the contained responsive chat layout.

## 0.8.1 — 2026-10-20

- Concise task/evidence/next-step guidance for persisted final answers.
- Fixed per-scene "Why this scene" reasons, with separate original/current
  states and safe legacy fallbacks. Unknown Character classification is not
  absence or a suspected incorrect tag.
- Preserve contract 7, journal 3, sidecar 1, approvals and storage isolation.
- Fit Simple/Advanced chat to viewport; contain accessibility-label overflow
  and retain transcript/input scrolling without modifying global page styles.
- Respect Stash's mobile bottom toolbar and remeasure after view switching.
- Security fixture now defaults to a separate credential-free scratch home,
  preventing future test conversations from appearing in the desktop list.

## 0.8.0 — 2026-10-20

- Contract 7 adds `present_scene_results`, restricted to current-turn tool-result
  references. No new write tools. Old chats/catalogs and proposal schema 3 retained.
- Version-1 sidecar binds owner, thread, turn, source call and final message.
  Atomic, serialized writes; failed/cancelled turns do not publish collections.
- Shared responsive grid/list cards, local lazy screenshots, bounded batched
  metadata, expandable details, explicit refresh and draft-only questions.
- Historical findings and current state remain distinct; unknown owner identity
  is never a Character gap. UI metadata is not sent back to Codex implicitly.
- Preserve auto-growing composer, focus styling, exact empty-chat recovery,
  native toolbar, pairing, startup and isolated Codex-home routing.

## 0.7.0 empty-chat recovery fix — 2026-10-20

- Diagnose pinned App Server's non-durable, never-started chats after companion
  restart. Map its exact missing-rollout response to `EMPTY_CHAT_EXPIRED` only
  for pristine isolated records with no `startedAt`.
- On that pre-dispatch error only, the composer starts a fresh isolated chat and
  retries the unchanged draft once. Old index records remain intact; started,
  legacy, renamed and uncertain histories are never replaced. Generic errors
  and timeouts are not automatically resent; failed drafts remain editable.

## 0.7.0 UI follow-up — 2026-10-20

- Message composer grows/shrinks with typed, pasted or prefilled text in both
  views; width changes reflow automatically. Very long drafts scroll within a
  40vh cap, keeping the Send controls accessible. No manual resize needed.
- Scoped ResizeObserver disconnects on unmount; no new global event handlers,
  transport changes, conversation changes or metadata operations.

## 0.7.0 — 2026-10-20

- Add contract-6 `get_scene_characters`, backed by Auto-Tagger 0.9.21's bounded
  explicit Character identity API. Present/absent/unknown and completeness are
  distinct; unclassified tags never become false absence.
- Add Character-aware attention intersections with descriptor presence, review
  state and native metadata, retaining candidate paging/unknown global totals.
- Keep contract-5 attention semantics, saved tool catalogs, separate-home
  isolation, journal 3 and existing approval-only write authority.
- Reuse the four-card prefill-only UI; no toolbar/player/CSS redesign.
- Bind descriptor previews to the actual audited owner version; reject version
  drift before applying, without rewriting historical journal records.
- Exact global Character coverage remains unavailable; rootless runtime inference
  is not promoted to authoritative taxonomy. See `REPORT-0.7.0.md`.

## 0.6.0 — 2026-10-20

- Add contract-5 bounded native health summary with metric definitions, independent
  failures, observation windows, stale cache and explicit refresh.
- Add evidence-bearing metadata/review shortlists and bounded intersections.
- Diversify existing suggestion cards, retaining prefill-only behavior; invalidate
  cached evidence after approval attempts.
- Preserve contract-4 and earlier chats, isolated storage, exact-ID legacy routing,
  journal 3 and all approval/owner boundaries.
- No owner runtime, media, player, core, dependency or permission changes.
- Record the pre-existing user deletion of eight legacy test sessions separately
  from release preservation checks. See `REPORT-0.6.0.md`.

Earlier milestones are documented in the versioned REPORT files and Git history.

# Auto-Tagger 0.9.27 compatibility

- Accept the audited private reviewed-identity owner without changing Stash AI's
  version, metadata permissions or approval scopes.
- Publish the sanitized owner integration delta and policy regression fixtures.
- Keep private identity decisions, native inventory and migration drafts local.
