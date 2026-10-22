# Ownership and extension contracts

## v0.11 separate audit and removal state machines

`tag-cleanup-policy.mjs` owns fixed policy/caps/classification/digests;
`tag-cleanup-adapter.mjs` owns bounded native/owner projections and the sole
one-scene REMOVE mutation; `tag-cleanup.mjs` owns durable auditing, frozen plans,
approval binding and sequential execution. `tag-cleanup.js` reuses the existing
authenticated transport and event stream. No new socket, route patch or global
listener. See [SCENE-TAG-CLEANUP.md](SCENE-TAG-CLEANUP.md) for the versioned contract.

The old review checks answer whether a field is absent/known, not whether every
tag follows this user's policy. The new explicit maintenance workflow does not
reinterpret or overwrite those historical findings. Native/Descriptor proposal
journal 3, presentation sidecar 1 and review-decision schema 1 are unchanged.

## v0.10.2 recommendation and disposition boundary

`recommendation-policy.mjs` derives only from `assessScene` and the existing six checks.
It supplies fixed titles/categories/draft text, exact scene/finding, authority, observation
time, clarification need and current decision state. No model-authored labels or guessed
targets. Current rich hydration and `review_scenes` use the same policy. Factual summaries
and immutable sidecar rows deliberately exclude decisions.

`sceneEvidence` SHA-256 fingerprints policy version + finding + relevant fields, excluding
scene updated_at/title/media. Native absence uses that relationship; zero tags independently
proves Character absence. Character evidence includes current exact owner version, sorted
assigned IDs/names and validated presence/completeness/detail reasons. Descriptor evidence
uses exact owner version, assigned descriptors, persisted review state and pending flag;
Needs Review uses its owner flag/version. Truncated detail or unavailable joins do not
permit an acknowledgement. The adapter additionally projects its verified owner version;
no owner API/classification rules changed. Reads are still timestamp-joined, not atomic.

`ReviewDecisions` owns schema-1 `review-decisions.json`, a maximum 5,000 append-only events.
Each stores owner/thread, exact scene/finding, evidence hash, action/time/note and prior event
ID. No metadata snapshots/media/transcripts. Latest event is derived, not separately mutable.
States are active, changed, unverified and reopened. Global per-principal decisions apply
across conversations; confirmations are additionally bound to their requesting conversation.
Storage corruption/write failure disables decisions without erasing the file or breaking cards.

Pending requests are memory-only, bounded to 32, expire in ten minutes and contain at most
six explicit fixed findings on one scene. Preparation reserves its slot before fresh reads.
The model gets no UI confirmation token. Commits serialize, re-read relevant evidence,
check previous-event ID, then atomically persist before publishing success. Duplicate
confirmation is idempotent while retained; expired/restarted requests cannot write.
New Send/cancel/runtime failure cancels pending requests. Reopen appends an audit event.

Catalog 9 adds `request_review_decision` (prepare-only, one attempt per turn, two owner-read
units). Old catalogs cannot dispatch it; contract-8 `review_scenes` also receives current
decision-aware recommendations. No new metadata writer. `/review-decisions`,
`/review-decision-request`, `/review-decision-confirm` reuse authenticated HTTP/WebSocket;
UI preparation requires owned stored collection membership and expected evidence hash.
Page keeps one pending panel across Simple/Advanced; existing SSE events refresh cards and
pending requests, with no new socket/global listener. `recommendations.js` renders only text,
fixed local owner links, draft actions and explicit confirmation controls.

## v0.10.1 explanation projections

`character-explanations.mjs` translates only the owner's fixed `detailSchema: 1`
reasons. Auto-Tagger 0.9.22 extends the existing v1 read response, not its inputs
or classifier. Four unknown-tag details per scene, 120 characters per name,
explicit truncation; no descriptions, files, images or new tool. Adapters validate
schema, bounds, reasons, disjoint IDs and counts. Hydration additionally joins
IDs/names and timestamps against the native assignment read. Missing/stale/malformed
owner data is unavailable, never evidence of absence (except native zero tags).

Review model output now includes at most four recognized tag names and four
unclassified details per scene, with truncation flags. These are untrusted data,
not instructions or corrective targets. Existing owner-read and result-size budgets
apply. UI text is React-escaped. Search selection and `findingExplanations` are
separate; `review-policy` preserves all six fixed check codes and original states,
adds plain current/historical text and separate incomplete-classification counts.
No trusted suspected-mismatch signal exists, so possibleIssues is zero, not inferred.

Detailed reasons are current read projections, not retroactively persisted history.
Old sidecar records and journal entries remain byte-for-byte equivalent. Historical
findings retain their codes/time; unavailable refresh never proves persistence.
Author-specific criteria remain in the response: old receipts do not store a search
query, so cards do not invent one from current metadata. Tool schema 8 is unchanged.

## v0.10.0 guided review

`service/review-plans.mjs` adds one bounded read tool, `review_scenes({sceneIds})`,
for 1–20 unique exact IDs. It reuses `hydrateScenes` (native batch plus Character
and Descriptor owner batches). Model output strips images and file fields; v0.10.1
adds bounded tag labels for classification explanations as described above.
`review-policy.mjs` centralizes six fixed checks, strict evidence validation,
overlapping counts, original/current comparison and safe operation-status projection.
No arbitrary model-authored findings, query text, corrective commands or targets.

`presentations.mjs` accepts this read's receipt through the existing completed-turn
publication path. Schema-1 rows optionally carry a validated review snapshot only
for `review_scenes`. Original rows are never rewritten. `/scene-results` reuses
hydration, compares current evidence with the saved snapshot, and adds latest-three
same-conversation operation statuses for each scene. No new endpoint or workflow DB.
Failure/loading marks verification unavailable; it cannot promote old evidence to
fresh success. Expiry is displayed without mutating the proposal journal; excluded
or unexecuted batch rows never inherit a batch-level verified status.

`search-capabilities.mjs` intersects audited descriptions with saved catalog/current
owner availability. It is descriptive, not a query compiler. Existing
`list_supported_operations` exposes it for contract 8; UI hydration supplies the same
summary for local preflight. `collection-refinement.js` owns draft/preflight policy;
`scene-results.js` adds compact review/actions in existing cards and manual refresh.

Catalog 8 adds one read (18 tools with installed owners). It consumes two units of
the existing 12 owner-read budget; legacy catalogs cannot dispatch it. Existing
20-scene/2-collection/24-receipt limits, lazy images, concurrency bounds, approval
writers, hooks, sockets and persistence paths remain. No dependency added.

## v0.9.0 interactive collections

`plugin/collection-refinement.js` is pure local policy: conservative predicates,
stable sorting, bounded selection and draft generation. `scene-results.js` retains
visibility-driven batched hydration and six-card mounting. It owns ephemeral
filters/sort/selection alongside existing layout state. Same component keys retain
state across presentation modes; unmount/reload resets preferences.

No new read endpoint, WebSocket, model tool or frontend dependency. The existing
hydration projection adds only the already-read owner's `persistedStatus` scalar,
so Reviewed is not inferred from descriptors or merely not-pending. Failed refresh
invalidates current filter evaluations; dated original findings remain available.

`Page` carries optional draft context separately from editable text, shows its
selected IDs, permits removal, clears it on conversation changes and sends it only
with explicit Send. Existing suggestion/single-scene drafts clear old context.
The `/send` validator invokes `Presentations.context` before active-turn setup,
proposal cancellation, resume or model execution. It proves owner/thread/collection
membership for at most 20 distinct IDs; it certifies no current metadata claim.
Invalid context cannot cancel a pending proposal. Valid submission retains the
existing cancellation behavior. Expired-empty-chat recovery cannot silently
reattach collection context to a newly created chat.

The service supplies a fixed context prefix containing IDs/source/scope/time to
the existing runtime turn. Codex owns its persistence as ordinary user input.
New searches still use saved contract-7 tools and fresh turn-bound receipts.
Sidecar schema 1, journal 3 and tool contract 7 stay unchanged. Optional durable
parent-lineage fields are deferred; the conversation/context already records the
relationship without modifying historical collections.
See PRESENTATION-CONTRACT.md for precise scope and null semantics.

## v0.8.1 contextual explanations

Tool contract 7, proposal journal 3 and presentation sidecar schema 1 remain.
`scene-reasons.mjs` supplies a fixed presentation vocabulary, not an inference
engine. Source projections now retain native missing relationships from
`get_scene` and an owner-observed `character-unknown` code from
`get_scene_characters`. Existing attention/review codes are reused. Codes stay
attached to each source row and its exact scene ID, receipt and final message.
Selection arguments still accept no reasons, labels, URLs or warnings.

Hydration derives `reasons` from stored source tool/finding codes and current
timestamp-validated reads. Original observations remain dated; current state is
still-present, no-longer-present or unverified. Unknown is not absence or suspected
incorrect tagging. Missing/deleted scenes retain their historical reasons.
Ordinary searches use a truthful generic search-match explanation, not fresh
metadata gaps as their reason for inclusion. No query names or historical
classification are invented for legacy records. No sidecar migration/rewrite.

Runtime guidance asks for a concise, self-contained final explanation of task,
evidence/uncertainty and useful next step. Existing commentary/delta/final message
association and Codex transcript remain unchanged. Trusted cards render beneath
their owning final answer; primary reason is expanded, secondary reasons compact.

The route measures its position below the native toolbar and fits available
viewport height. Its ResizeObserver/resize listeners clean up on unmount.
Transcript/message positioning contains absolute accessibility labels that
previously extended the document's scroll area; overflow is contained inside
the route. No body/html styles, scroll lock, toolbar mutations or global CSS.
Welcome observations scroll within the chat surface on short screens; composer
retains bounded auto-growth and its own input scrolling.

## v0.8 rich response boundary

`presentations.mjs` issues opaque receipts only after eligible reads complete in
the active contract-7 turn. Sources: scene search/inspection, attention findings,
Character inspection, Descriptor Review and consistent declared Variant members.
No prose-derived IDs, HTML, image URLs, model-authored labels or issue codes.
`present_scene_results` selects a subset of one receipt. Two collections / 20
total scenes / 24 receipts per turn.

Completion tracks authoritative `item/completed` agent-message IDs (or the last
agent message in the completed turn). Only successful, non-cancelled completion
publishes. The atomic sidecar write finishes before completion reaches the UI.
Exact owner/thread/turn/message joins prevent cross-chat/commentary attachment.
Interrupted/failed histories do not display cards. Duplicate selection/completion
is idempotent.

`scene-presentations.json` schema 1 contains references, source-call provenance,
timestamp/scope and whitelisted historical findings, not transcript or metadata.
Protected Store writes are serialized. Cap: 1,000 collections / 4 MiB compact
JSON; no automatic eviction. Exhaustion rejects new selections. Corrupt/unknown
schema disables rich output without overwriting the file or breaking text chat.
No migration or editing of Codex-owned storage.

Authenticated `/scene-results` accepts stored collection + owned thread IDs,
not arbitrary IDs/queries. `scene-cards.mjs` runs one aliased native batch and two
parallel existing owner batches. Joins require matching scene update timestamps
and Character assignment counts. Zero tags independently prove absence; nonempty
unclassified/unavailable state stays unknown. Reads are explicitly non-atomic.
In-flight hydration coalesces, with four concurrent collections maximum. No
background scan, persistent metadata cache or per-card owner query loop.

`scene-results.js` renders fixed React components in the existing transcript.
Collections load near the viewport; six cards initially mount, Show more adds six.
Images use native lazy loading, fixed aspect ratio and a missing-image fallback.
Actions never invoke the model except explicit Send. Cleanup ignores late replies
and disconnects the scoped observer. No new global listeners, patches or player
hooks. Layout/expansion are ephemeral; references survive reload.

Screenshots must match the configured Stash origin and numeric
`/scene/ID/screenshot` path, reduced to same-origin paths with an optional numeric
cache stamp. UI validates again and uses browser Stash authentication.
API-key/other query values are stripped. Images/URLs never enter tool output or
the sidecar. No media proxy, model image fetch or video autoplay.

## v0.7.0 additive Character identity (current)

`PluginAdapters.characters` calls Auto-Tagger 0.9.21's read-only explicit taxonomy
reader. `get_scene_characters` is available only to new contract-6 catalogs with a
compatible owner; every invocation shares the existing 12-owner-read turn budget.
The owner exposes present/absent/unknown, not a binary nonempty-tag heuristic.

Two instances of the existing `LibraryInsights` class preserve dispatch semantics:
saved contracts <=5 use the original no-tags path; >=6 uses owner identity.
Contract-6 native candidates are not prematurely restricted to zero tags.
At most 40 candidates / two 20-ID Character batches are joined; nonempty absence
requires complete owner exclusion, not a missing/failed classification. Descriptor
presence is a separate timestamp-checked intersection and never review completion.
Global counts are not extrapolated. Suggestions use the new path, existing TTL,
four-card limit, prefill-only controls and approval-triggered invalidation.

Runtime resume receives the saved contract number for matching guidance, but
never replaces App Server's saved dynamic tools. Storage origin routing, deleted
legacy fail-closed behavior, ownership and journal schemas are unchanged.

## v0.6.0 bounded intelligence (retained contract 5)

`LibraryInsights` is an independent read-only companion module, not a replacement
dashboard. Inspection found Library Health's aggregation is browser-side, loads
scene/Audio pages of 250 and depends on browser identity/provider state. Option C
was chosen: four fixed count-only GraphQL queries share its simple native Author
and Franchise relationship definitions. No browser cache bridge or owner API was
invented. Source labels explicitly distinguish the native summary from the dashboard.

`get_library_health_snapshot({refresh?})` coalesces requests, isolates failures,
retains exact observation windows, and exposes null ratios for empty denominators.
The memory-only snapshot expires after 60 seconds but can still be read as stale;
only explicit refresh remeasures it after initial load. No full-library scan.

`find_library_attention_items` accepts only typed category, missing/present
relationships, creation date, page and result limit. One newest-first native page
of 20 is joined to one bounded owner page/read, at most 40 candidate observations.
Owner-only IDs use a single aliased singular-scene query, not N+1 requests.
Results distinguish exact native-filter totals from unknown intersection totals.
Character absence is proven only when tags are empty; nonempty tags are unknown.
Owner review eligibility is never duplicated. Priority is explicit Needs Review,
owner pending, multiple gaps, single gap; newest first within priority. Missing
metadata is a possible intentional omission, never proof of incorrect metadata.

Suggestions reuse two bounded attention calls to diversify review and metadata
work (at most 60 candidate observations), deduplicate IDs into at most four cards
and retain click-to-prefill. Approval attempts invalidate both caches even on
uncertain failure, emitting one event over the existing transport. There is no
new listener, polling loop or persistent workflow database.

Contract 5 adds two read tools; existing owner readers share a twelve-call
per-turn budget with them. Native proposals remain five-scene maximum, descriptor
proposals one scene, journal 3, one proposal attempt per turn. New chats get 15
tools when all owners are available; old catalogs remain immutable. Resume APIs
and the exact-ID storage router are unchanged. Missing old threads fail closed,
without substitutes. Eight legacy sessions were already intentionally deleted by
the user before this release; their saved index entries remain untouched.

## v0.5.1 storage-origin routing

`RuntimeRouter` wraps the existing restricted Runtime API. New threads select
`<Store.dir>/codex-home` with index `storage:"isolated"`. The exclusive schema-1
`runtime-storage.json` cutover manifest contains the original home and exact nine
legacy IDs; it cannot discover arbitrary desktop threads. Catalogs/IDs remain.
Unknown origins or failed resume never create replacements.

Isolated runtime stays resident; legacy starts lazily and closes after 30 idle
seconds, never during a turn/operation. One turn is allowed across namespaces.
History uses read-only `thread/read`, avoiding writer leases; sending resumes the
same ID/catalog. Cross-origin events/dispatch are rejected. Runtime loss closes
write readiness through the existing path.

`runtime-home.mjs` validates absolute non-redirected directories and isolated
writability, denies unexpected configuration and supplies the child-only explicit
home. Runtime pins SQLite placement, isolated file-auth/OpenAI provider, and checks
`initialize.codexHome` against the selected canonical path, including MSIX aliases.
No global environment, network or dependency change. See REPORT-CODEX-ISOLATION.md.

## v0.5.0 chat-first presentation

`Page` remains the single controller: token/thread/history, streamed messages,
proposals, errors, draft text, scene context and the existing transport lifecycle.
Its presentation-only `view` state changes scoped classes and header/welcome
content. The transcript, composer, safe Markdown renderer and approval handlers
are shared, not two clients or two sets of subscriptions. New chats select Simple;
switching histories retains the current presentation. No view persistence schema.
History loading suppresses a false empty welcome on refresh. Scrolling reacts to
message/proposal updates only, gated by the reader's near-bottom position.
The flex transcript and in-flow composer avoid covering proposals with a fixed layer.

`service/suggestions.mjs` serves UI-only `/suggestions` through existing
authenticated HTTP/WebSocket routing, with an empty request schema. It calls the
existing owner reader for one 12-candidate page and a fixed minimal native query
for three missing-studio examples. Reads run independently, are bounded by existing
owner deadlines / an eight-second native timeout, coalesced and cached in memory
for 60 seconds. There is no model tool, saved inference, browser bridge, N+1 or
automatic full scan. The owner page can legitimately yield no findings. Suggestions
carry source, scene IDs, count scope, timestamps and expiry. UI hides expired
observations and requests no refresh until explicitly asked or a landing view is
opened again. A prefilled prompt asks Codex to re-read the state before reasoning.

The safe Markdown subset now includes paragraphs, lists and headings, still using
React text nodes and only local numeric scene links. HTML and external resources
are never evaluated. Auth, journal, runtime tools/permissions and owner contracts
remain unchanged. Details and measured evidence are in REPORT-UI-REFRESH.md.

## v0.4.0 descriptor transactions

See [DESCRIPTOR-TRANSACTIONS.md](DESCRIPTOR-TRANSACTIONS.md) for the full owner,
model, journal and recovery contracts. `service/descriptor-transactions.mjs`
provides fixed owner calls and validates projections; it never constructs a custom
field write. `service/proposals.mjs` extends the existing serialized approval
journal with descriptor schema 3. Tool contract 4 adds resolution and preview,
never application. Existing schemas and catalogs remain usable. The UI adds a
descriptor diff section to the existing cards; all routing/hooks/toolbar remain.

The stateless owner shares generated UI helpers. Durable at-most-once dispatch
belongs to the companion, not a fictional cross-VM owner ledger. Uncertain results
receive read-only reconciliation; same-scene edits stay blocked until resolved.
Historical v0.3 sections below describe retained readers, not the new write path.

## v0.3.0 additions

`service/plugin-adapters.mjs` is the sole companion boundary for fixed owner reads.
It performs version/API discovery, 60-second capability caching with freshness,
strict typed arguments, per-read live version checks, eight-second owner timeouts,
and bounded allowlist projection. It does not implement owner business rules.
See [PLUGIN-INTEGRATIONS.md](PLUGIN-INTEGRATIONS.md) for contracts and authority.

New threads persist tool schema 3 and their exact tool-name catalog. Only available
owner readers are registered at creation (up to eleven tools total). Runtime
dispatch requires that saved catalog and limits plugin reads/discovery to twelve
per turn. Dynamic-tool catalogs are not replaced on resume. Older chats retain
their catalog and receive an explicit legacy banner; unavailable capabilities
require a new chat after repair if absent from its original catalog. Journal schema
2, config/auth schema 1 and the public browser API version 1 remain unchanged.

Descriptor Review's server reader is built from its existing browser-side pure
eligibility/status helpers using `scene-auto-tagger/build-ai-read.cjs`; `--check`
detects source drift. Stash's embedded JavaScript loads only Exec[0] and provides
no module loader, so the small generated block lives in the owner's main script.
Variant reads reuse the owner's existing parsing and family-ID helpers. Neither
reader invokes inference, discovery, repair, learning or writes.

`plugin/toolbar.js` uses the native `MainNavBar.UtilityItems` React patch point.
Settings and the local AI anchor share one scoped layout slot so Toolbar Order
still identifies Settings without altering its saved order. The original Settings
element/handlers remain intact; no observers, global input listeners or browser
storage access are added. Normal anchor navigation is intentionally supported.
The supplied icon is a local asset, not a remote dependency.

UI status refreshes after a completed turn; Diagnostics receives only fixed
capability IDs/states, adapter versions and derived freshness, never scene payloads.

The sections below retain the earlier architecture/history; v0.3 supersedes their
references to the newest tool contract being version 2.

## Modules

| Component | Responsibility |
|---|---|
| plugin/stash-ai.js | Stash route, React state, chat, scene context, review controls; no library mutation code |
| plugin/transport.js | Authenticated WebSocket RPC, event delivery, timeout and unmount cleanup |
| plugin/message.js | Text-safe limited Markdown; only local scene links |
| service/runtime.mjs | Binary lock, stdio JSON-RPC, model discovery, thread/turn lifecycle, dynamic tool dispatch |
| service/main.mjs | Owned conversation index, active-turn state, server routes, lifecycle and application approval boundary |
| service/websocket.mjs | Strict upgrade origin/Host checks and bounded frames; same handler/policy as HTTP, no generic proxy |
| service/stash.mjs | Static GraphQL documents and validated variables; minimal reads and exact-field updates |
| service/tools.mjs | Central agent tool catalog; no apply/approve tool |
| service/proposals.mjs | Serialized preview/decision state machine, preflight, exact writes, readback, durable before-state audit |
| service/relationships.mjs | Pure explicit relationship validation, tag ownership guard, native cardinality/index handling, before/after diffs |
| service/auth.mjs | One-use pairing, hashed tokens, stable single-user principal, expiry and replay checking |
| service/store.mjs | Atomic JSON replacement and restricted Windows ACLs |
| service/instance.mjs | Exclusive process-state ownership; stale lock recovery without killing arbitrary PIDs |
| windows/*.ps1 | Non-admin installation, hidden startup, pairing and shutdown |

## Protocol details verified on the installed runtime

Initialize with experimental API capability, then initialized notification. Read account state without credentials, discover model/list, choose its default. Create threads with dynamicTools and environments: []. Disable shell/browser/apps/plugins/memories/multi-agent capabilities; disable each discovered personal MCP server. Retain the sandboxed code-mode host because this runtime uses it to execute dynamic-tool orchestration.

thread/resume does **not** accept environments in this installed schema. Each turn/start explicitly supplies environments: [] before model/tool execution. The controlled-model security test checks both fresh and restarted/resumed threads. thread/read with includeTurns is avoided for never-started threads because the runtime has no readable rollout yet.

turn/start may acknowledge just before the runtime activates its task. Cancellation retries only the specific no-active-turn race for a bounded second, recognizes already-completed turns, and otherwise reports failure rather than claiming cancellation.

Only integration-owned thread IDs from conversations.json are accessible to the browser. Generic App Server calls, arbitrary thread IDs, filesystem APIs, and command RPCs are never proxied. Server-originated requests other than approved dynamic tool calls are denied. Available models are discovered rather than hardcoded.

## Proposal state machine

`pending → rejected | cancelled | stale | applying → verified | partial_or_uncertain`

An expired pending proposal cannot apply. A persisted applying proposal is marked uncertain after restart. A repeated decision on a terminal proposal returns its recorded outcome without executing again. Every HTTP/WS request has separate replay protection; proposal idempotency also handles legitimate retries with fresh request nonces.

The immutable portion contains owner, thread, exact scene IDs, field-level before/after values, observed updated_at, and expiry. It is hashed and checked again before applying. The UI sends only proposal ID, integrity, and decision—not substitute values or expanded target lists. All target preflights complete before the first write. Each mutation sends only id plus explicitly approved fields, then reads back and compares them. Before-state is persisted before any write.

The model can prepare proposals and read their statuses. Only the authenticated browser decision endpoint can apply. Text saying approved, including hostile text in scene metadata, has no authority. Copying the integrity hash does not grant browser authentication or an apply tool.

## Persistence and privacy

As of v0.1.1, history derives an interruption/failure notice from each Codex turn's
recorded status. Streamed partial text can be absent from runtime-owned history;
the notice makes that explicit after refresh/restart. No second transcript store
is introduced. Proposal results remain the authority for writes, independently
of the conversational turn outcome.

The Codex runtime owns full conversation history. conversations.json stores only integration ownership, IDs, short titles and timestamps; it is not a second chat database. proposals.json is the restricted recovery journal, containing sensitive exact before/after values. auth.json stores pairing hashes and a temporary one-use code; control.json is a separate CLI shutdown secret. No model credentials are copied.

State and app folders inherit only the current Windows user and SYSTEM after ACL setup. Logs contain startup/status categories, not prompts or GraphQL bodies. Existing Codex conversation storage still contains normal chat/tool history and must be treated as private. Same-user malware or a compromised trusted Stash plugin is outside this boundary; see SECURITY.md.

## Integration changes

Core is unchanged: register ai-command-center/API 1 using the existing optional capability registry. Review Center gains one native link; no new global toolbar button. Diagnostics reads only a sanitized status snapshot and package version. The scene-tab patch adds one context link without modifying the player or tab selection state. Vocabulary Labels preservation is applied to the entire chat/diff subtree.

The consolidated Stash checkout contained unrelated uncommitted work before this task. Only narrow Review Center/Diagnostics/history changes were made there; its unrelated edits were neither reverted nor folded into this project's commits. The initial exact backup is outside the active plugin tree under the task's work/stage3-baseline-20261019 directory.

## Adding operations safely

### Tool and journal contract 2 (0.2.0)

The same seven tool names remain. `find_scenes.relationships` accepts up to eight
AND criteria (`kind`, `match`, nonempty unique `ids` except missing/present).
`multipleAuthors` post-filters a bounded candidate page; matching count is null.
`find_metadata_entities` adds `resolve`, `id`, `includeSceneCount`, and
`scenesMissingFranchise`. Exact native EQUALS resolution precedes a bounded similar
search. Singular-ID aliased reads return null for nonexistent IDs (this fork's
list-by-IDs operation instead errors). No model text enters GraphQL documents.

`propose_scene_changes` retains legacy `changes`, adding `operations` and optional
`selection` (same search contract). Each relationship appears at most once. Tag
and group add/remove take nonempty IDs; replace takes fromId/toId. Studio assign
takes expectedId:null and toId; replace takes expectedId/toId; clear takes a
non-null expectedId. Empty collection input never means clear. Group replacements
with a source index or an already-associated destination are conflicts; new group
links use null index, not an invented number. Payloads preserve unaffected array
order and indexes. Native GraphQL has no separate persisted association-order field;
readback compares group identity/index pairs independent of server enumeration.

Journal schema 2 hashes rows, operations, resolved entity snapshots, selection
evidence, summary and expiry, with owner/thread. Service-only field hashes cover
the audited unrelated scene fields including custom_fields and playback counters;
they are omitted from browser/model previews. Preflight revalidates entity names
and all eligible scenes; readback verifies approved fields and unrelated hashes.
No-op/conflict rows are reviewable but excluded from execution. No-op-only proposals
are terminal. Creating a new proposal supersedes an old pending one; a new user
message cancels pending proposals before model execution. Server reserves one
proposal attempt per turn, even for parallel tool calls. Bulk eligibility counts
apply only to up to five evaluated targets, never to unscanned matches.

Old journal records and chat IDs are retained. The pinned thread/resume schema has
no dynamicTools parameter, so old chats keep their v1 catalog; new chats persist
v2. UI labels legacy chats. Configuration and pairing schemas remain 1, public
StashCustom API remains 1, tool schema/capability schema becomes 2. No runtime
permissions or approval authority changed.

Add a bounded schema and validator to tools.mjs/stash.mjs; do not expose raw GraphQL. For writes, add an owner-reviewed field/operation contract and proposal representation, tests for preservation/stale/partial behavior, and explicit UI approval. Plugin-owned custom fields remain prohibited until their owning plugin exposes a validated adapter. Keep runtime RPC and user-approved mutation authority separate.
