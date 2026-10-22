# Security boundary

## v0.11 REMOVE-only bulk authorization

This release deliberately adds one separate write authority: remove exact native
scene–Tag pairs in a fully materialized, authenticated approved manifest. Five new
model tools only start/resume reads, inspect pages, and prepare plans. None approve,
execute, resume writes, or classify on the user's behalf. `/tag-cleanup` reuses
origin/pairing/principal/thread/time/nonce protection. Approval binds full SHA-256
digest, identity, operation, expiry and observation; protected HMAC records include
the index and every audit/plan. Corruption or persistence failure closes writes.

One scene in flight; durable intent precedes dispatch; independent readback follows
even a failed response. Restart pauses. Uncertain writes are never automatically
resent. User reconciliation is read-only and cannot establish causation. Ordinary
approvals are serialized against bulk approval and blocked by outstanding bulk
work. No metadata writer is exposed to embedded Codex. Exact limits and rollback
requirements: [SCENE-TAG-CLEANUP.md](SCENE-TAG-CLEANUP.md).

## v0.10.2 Stash AI-only review decisions

This adds no Stash/owner mutation permission. Only the authenticated UI confirmation
endpoint persists a review disposition. The model's contract-9 tool prepares an expiring
request, not a decision, and receives no confirmation token. No generic preference writer,
arbitrary finding code, scene-wide exemption, classifier repair or review-completion action.

All three review routes reuse origin/host, pairing principal, timestamp/nonce replay controls
and exact owned-thread checks. UI preparation also checks stored collection membership and
the displayed relevant fingerprint. Confirm requires matching thread/principal/request token,
expiry, no active model turn, latest prior-event ID and freshly matching evidence. Requests
are one scene/six explicit fixed findings, 32 pending max, ten-minute TTL; cancellation/new
Send/restart cannot silently commit. Multi-finding confirmation writes atomically; repeated
confirmation cannot append duplicates. Reopen binds the exact latest acknowledgement.

Atomic protected Store writes inherit existing Windows ACLs. Log schema 1 validates every
event and prior link, caps at 5,000 events, and fails closed on corrupt/full/unwritable state;
no automatic purge. Stash metadata, proposal journal 3 and presentation sidecar 1 are not
written by this path. Acknowledgement never means owner review completion or correctness.
Scene/owner reads are non-atomic; no scene-level updated_at-based invalidation is invented.
Read-only cards still show unverified/changed decisions, never apply them as exemptions.
Notes and names remain React text; recommendation actions only draft, never auto-send.

The same-origin trusted-plugin/paired local-user threat model remains. Confirmation tokens
are not a defense against compromised code already executing in Stash's trusted origin.
The actual restricted-runtime fixture continues to isolate all shell/files/network primitives
and uses a credential-free scratch home rather than the desktop home.

## v0.10.0 read-only reviews

`review_scenes` is contract-8-only, exact-ID bounded and read-only. Its six fixed
checks are derived from existing native/owner evidence; unclassified tags and
unavailable/stale joins remain unknown. Review evidence is validated before durable
publication. User text cannot supply trusted findings or override receipts.

Review/correction/search buttons only draft. Existing collection-context checks
precede Send side effects. No new writer or approval path: native five-scene,
Descriptor single-scene, one-attempt-per-turn, integrity, expiry, stale checks,
readback and uncertain-state handling remain unchanged. Operation status is not
proof that a review condition was resolved. No automatic batch chaining.

No source frames/images/credentials in model tools; no new telemetry, external API,
filesystem/network tool or runtime permission. The pinned restricted Codex runtime
and isolated home remain unchanged. v0.10 live validation used a rejected native
preview, zero production metadata writes. Descriptor production apply/restoration
acceptance remains outstanding.

## v0.9.0 collection context

Local filter/sort/selection state is untrusted presentation preference, not
permission, metadata evidence or a model receipt. It does not call the service
or cancel previews. A contextual `/send` accepts only type, collectionId and
sceneIds, validates owned conversation and stored collection membership, rejects
duplicates/unknown fields/foreign IDs/oversized lists, and fails closed when the
sidecar is unavailable. Checks run before proposal cancellation or runtime calls.
Selection requires 1–20 IDs; refinement may have no selected IDs. Deleted members
remain legitimate historical selections, but must be re-read and may be missing.

User-edited text remains ordinary user input, including manually typed scene IDs.
A validated context proves only selection membership; it does not authenticate
claims in that text. Nothing changes native/descriptor approval, tool catalogs,
receipts, Host/origin/auth/replay handling, runtime pins, dedicated home or legacy
routing. All metadata names remain React text. No new GraphQL/query interface,
browser automation bridge, media upload, mutation or owner execution capability.
Refined results cannot reuse an earlier turn's receipt or enlarge old collections.

## v0.8.1 explanation vocabulary

Reasons are derived from successful source projections, never assistant prose,
metadata names, thumbnails or model-authored JSON warnings. The only added code,
`character-unknown`, requires an available Character-owner result reporting
unknown presence; persisted use is constrained to that source tool. It never
means absent or incorrect. Native inspection gaps require actual empty
relationship arrays/null Studio, not missing projection properties.

Existing receipt/ownership/completion bounds, pairing, runtime pins, catalogs
and approvals are unchanged. There is no endpoint for writing reason records.
Unknown fields/codes in protected storage fail closed without replacing it.
Like v0.8.0, valid records are protected by local ACLs and service ownership, not
a cryptographic defense against privileged same-user filesystem tampering.
No supported suspected-tag or Variant-inconsistency signal is invented.

The standalone `security-validation.mjs` previously used the default desktop
home when no test override was set. It now always supplies an isolated home,
creating a fresh scratch directory by default with no copied credentials.
Existing fixture chats are preserved. This harness correction does not alter
production routing, auth, pins or permissions. See REPORT-0.8.1.md.

## v0.8 presentation-only authority

The model cannot request arbitrary scene-card hydration. A completed eligible
current-turn tool result creates an opaque receipt; the new tool only selects
already-returned IDs. Source tool/call, owner, thread, turn and final message are
bound in schema-1 protected storage. No HTML/React/JS or issue labels come from
model arguments. Failed, cancelled, unrelated and uncompleted turns cannot
publish. The authenticated UI hydrates only a collection belonging to its thread.
Unknown/corrupt sidecars fail closed without deleting user state.

Native metadata and audited owner adapters remain authoritative. Character
unknown is not absence, stale joins are not current proof, and owner errors do
not resolve findings. React text rendering escapes names/titles. Screenshot URLs
are restricted to the configured local Stash origin plus exact numeric-scene
path, then converted to same-origin paths; only a numeric cache stamp survives.
No credentials, image bytes or URLs enter model tools or the durable sidecar.
The companion does not proxy images or open external URLs. UI requests have the
same origin, pairing, nonce and concurrency rules as existing operations.

Proposal schema, integrity/staleness rules, one-attempt budget, UI-only approval,
runtime pins/guards, isolated home and legacy routing are unchanged. Presentation
is not mutation approval. Existing local/same-origin plugin trust assumptions
still apply: this is not protection against a malicious privileged local plugin.
Resource limits and load behavior are documented in ARCHITECTURE.md.

## v0.7.0 Character-reader boundary

The only new model capability is a bounded, read-only owner call. Fixed mode,
plugin ID and GraphQL projection cannot be supplied by the model. Exact live
version gates prevent unknown-mode fallthrough into older Auto-Tagger tasks.
The owner has no read-path writes/config initialization/learning/full scans.
Incomplete/conflicting taxonomy and malformed replies never prove absence.
The service validates IDs, counts, evidence and status consistency, caps owner
payloads, suppresses raw errors and retains the shared 12-read turn budget.
No new apply operation, approval bypass, media access, telemetry or permission.
Contract-5 semantics and saved catalogs remain intact; absent legacy IDs are
not recreated. Character evidence is untrusted metadata, never instructions.

## v0.6.0 read-only intelligence

Contract 5 adds only `get_library_health_snapshot` and
`find_library_attention_items`. Fixed query documents, validated criteria and
existing owner allowlists prevent arbitrary GraphQL/plugin calls. Both require
an owned active conversation with the matching persisted tool catalog and count
toward the existing twelve owner-read calls per turn. Suggestions still require
paired authentication; there is no public health endpoint.

Candidate reads omit titles, descriptions and file paths. Model output contains
only IDs, necessary relationship IDs and evidence, with explicit scope/freshness.
Cache is bounded and memory-only. Source failures return unavailable/partial,
never fabricated zero counts or completed review. No background repair, write
permission, journal migration, dependency, new origin or runtime tool permission
was added. Existing native/descriptor proposals remain the only mutation paths.
Actual pinned-runtime fresh/resumed catalog fixtures still deny shell, filesystem,
network, personal MCP and collaboration. Real-model read/preview tests never apply
production changes. Separate home/config/credentials and legacy IDs are unchanged.

## v0.5.1 home isolation

New threads use a current-user/SYSTEM-only home with explicit child environment
and SQLite placement; both binary pins remain. Startup verifies the actual child's
canonical home, including MSIX aliases. Missing/unwritable/redirected/unexpectedly
configured homes fail closed. No global env edit, copied credential, desktop
logout or fallback. Separate ChatGPT login was user-completed. Local isolation
does not claim to disable account synchronization or model-service processing.

The cutover manifest allows only nine existing integration-owned legacy IDs.
New records explicitly select isolated storage; unknown/ambiguous origins fail.
Lazy legacy runtime retains restrictions and saved catalogs. One turn is allowed
across namespaces; dispatch checks origin/active thread before existing owner/
approval checks. Missing history never creates a substitute. Journal records and
mutation authority are unchanged. Four actual-runtime fresh/resumed security
checks and 208 automated tests pass. See REPORT-CODEX-ISOLATION.md.

## v0.5.0 UI-only observations

Authenticated `/suggestions` accepts no query, scene IDs, operation name or other
parameters. It reuses fixed read-only owner operations and one static native query.
It does not invoke the model, change its thirteen-tool catalog, call an approval
route, write metadata or access browser storage. Findings omit titles/paths and
retain authoritative IDs, coverage and freshness; they are never instructions.
Click-to-prefill changes only the local draft. Existing UI-only approvals, pending
preview cancellation on actual submission, runtime pins and sandbox remain intact.
Both presentation modes use one controller and transport. No new network service
or dependency is introduced.

## v0.4.0 narrow descriptor exception

The owner-only descriptor transaction described in DESCRIPTOR-TRANSACTIONS.md is
the sole new plugin mutation path. No model-facing apply/approve/plugin-execution
tool exists. Arbitrary fields and review/learning edits remain forbidden. Exact
UI approval binds one scene, up to 12 assignments, owner plan, before-state, expiry,
operation ID and protected-field hashes. The shared one-proposal-attempt budget
applies across native and descriptor tools, even on invalid attempts.

At-most-once dispatch is enforced by the existing protected companion journal and
single-instance/serial queue, not the stateless owner VM. A Stash administrator or
same-user process calling owner operations directly is outside that boundary and
already has native GraphQL write access. No new network service or permissions.
Approval intent is file-synced before dispatch; restart never resends. Expected
state can be read-only reconciled without claiming causal proof. Uncertain records
block new edits on their scene. Compensation is a distinct, newly approved preview.

Both pinned executable hashes, restricted features, origin/token/nonce checks,
Windows ACLs and legacy journal records are retained. The sections below are
historical where they say no plugin-owned writes or only seven tools: new fully
available conversations have thirteen bounded tools, with no generic execution.

## v0.3.0 owner-read boundary

The four added model tools are `get_plugin_capabilities`, `read_descriptor_review`,
`read_variant_family`, and `read_scene_preferences`. No model argument chooses a
plugin ID or operation name. The companion internally uses Stash's mutation-shaped
`runPluginOperation` transport only for the three audited read modes; it does not
expose that GraphQL operation to the model. Each reader validates exact keys, IDs,
page bounds and compact responses. Raw owner errors, paths, private custom fields
and arbitrary configuration are not forwarded. Returned strings remain untrusted
data and are rendered as text through the existing UI.

Exact owner version gates and API probes fail closed. Each read rechecks the live
version, not just the 60-second capability snapshot. A privileged administrator
concurrently replacing owner code between version check and invocation is outside
the local trust boundary; do not deploy owner code during an active request.
No browser-state bridge, new MCP server, new network permission, or generic plugin
execution exists. Twelve plugin calls per turn bound orchestration; ID batches
and candidate/member pages are bounded independently.

Pinned executable hashes and restricted runtime features were not changed. Actual
pinned-runtime catalog probes pass for new threads and restart/resume. Existing
browser pairing, origin checks, replay protection, Windows ACLs, native five-scene
limits and immutable approvals remain. No new plugin mutation was implemented:
the Descriptor Review save/undo workflow lacks a server-side expected-before,
idempotency and recovery contract. Direct private-field updates are not a substitute.

The supplied Codex image is included for this user's local installation; no claim
of trademark ownership or public redistribution rights is made.

## Enforced controls

- Bind IPv4 loopback only, port 9998. Exact Host and trusted Origin allowlists on HTTP and WebSocket upgrades. No wildcard CORS, cookie authentication, URL tokens, or network listener for Codex.
- Pairing uses a random 256-bit one-use code with 15-minute expiry and a five-attempt/minute limit. Paired bearer tokens are random, stored hashed server-side, and scoped to the pairing origin. Browser pairing storage contains no Stash API key or Codex credential.
- Each authenticated message requires a random nonce and timestamp within 60 seconds; reuse is rejected. Approval idempotency is durable across restart.
- Payload, connection, subscriber and in-flight request bounds. Only named service paths are bridged; there is no arbitrary HTTP proxy or App Server RPC tunnel.
- Pinned executable and code-mode-host SHA-256, supported runtime version, no execution environments on every turn, no shell/file/browser/agent/plugin tool exposure, and personal MCP servers disabled. Browser JSON cannot modify the model, runtime config, tools, environment, cwd, or provider.
- The code-mode host is a V8 isolate, not Node. The actual-runtime fixture verified fetch/process/require are undefined and the nested tool catalog contains only the seven approved Stash tools plus clock/empty MCP-resource helpers. No shell, apply_patch, REA, filesystem or web tools were available, including after restart/resume.
- GraphQL documents are static and variables validated. No SQL, deletion, file operations, plugin operations, custom-field maps, Native Audio updates or broad replacement mutations.
- Proposal application is a separate authenticated UI path, unavailable to the model. Five-scene maximum; 15-minute expiry; full batch preflight; exact fields; serialized writes; verified readback; durable before-state; terminal-state idempotency.
- Runtime loss or an untested binary closes writes. An interrupted/uncertain write is never blindly retried. Shutdown waits for the proposal queue; forced termination preserves an applying record that becomes uncertain on restart.

## Trust assumptions and remaining risks

v0.2.0 keeps the same seven tool names with a version-2 bounded contract. One
proposal attempt per user turn prevents parallel calls multiplying the five-scene
limit. New user instructions invalidate pending previews. Explicit operation
semantics, expected Franchise checks, entity-name revalidation and unrelated-field
hash verification extend the existing journal. Protected review/taxonomy tags
cannot be edited, and no custom-field mutation input is accepted. Field hashes are
service-only; full plugin state is never returned to the model. The protection list
is tied to this audited installation, not a universal tag-ownership ontology.
Native scene updates have no separate owner-plugin call; custom fields, preferences,
review and queue state are preserved, not reimplemented. Independent plugin hooks
or concurrent external changes may still cause verification failure after a write;
that is reported without blind retry or undo.

This is one local Windows user's assistant. All paired browsers share that user's integration principal. It is not a multi-user Stash authorization system. A program already running as this Windows user can read that user's protected files; this service does not claim to defend against same-user malware or administrators.

Every installed Stash UI plugin runs in the same browser origin. A malicious or compromised plugin could read the local pairing token or simulate UI actions. Origin isolation cannot separate plugins within the same page. Keep trusted plugins only. Separate-browser or hardware approval is a possible future hardening option.

The Stash API in this installation accepts local read requests without an API key. That existing Stash policy was not changed. An optional API key stays in protected companion configuration and is not passed to the model's child environment.

Codex model inference uses the existing account and network. Requested metadata may therefore leave the computer as conversation/tool context. The integration does not transmit frames/media or bulk database exports, nor add telemetry. Treat the normal Codex rollout history as sensitive.

Stash does not provide compare-and-swap for sceneUpdate. Stale checking minimizes but cannot eliminate an external editor race between read and write. Do not concurrently edit the same fields. No transaction-wide atomicity is claimed for batches.

Tests establish the tested runtime/configuration boundary, not a general proof against every future runtime or browser exploit. Never remove the binary pin merely to silence an update failure; regenerate protocol schemas and rerun security-validation.mjs and live-runtime-validation.mjs.

## Incident/recovery

Disconnect browser revokes that token. Stop the service to terminate active sessions. Preserve proposals.json before recovery. Reconcile uncertain target fields through read-only queries, then prepare a new inverse proposal using the recorded before-values. Approve only if the current values still match the intended recovery precondition. There is no unrestricted undo command.
