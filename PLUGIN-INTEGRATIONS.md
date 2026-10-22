# Owner integration contracts

## v0.11 scene-tag audit / owner 0.9.23

The installed Native Audio v0.31.1-native-audio.12 `navigation-lifecycle-v12` fork
supports `BulkSceneUpdateInput.tag_ids: { ids, mode: REMOVE }`. The adapter supplies
one exact scene ID and no other fields. This removes join rows without replacing
the full tag set. The native timestamp changes; no compare-and-swap exists.

Auto-Tagger's additive `character_identity_v1` kind `tags` accepts 1–50 unique IDs;
`tagDetailSchema: 1` returns unchanged classification/reason plus native evidence.
Native and owner evidence must join exactly; a race fails closed. No YUV/media,
taxonomy write, private database/configuration read or learning initialization.
Existing Character/Descriptor capabilities accept 0.9.23 envelopes. Their semantics
are unchanged; previously prepared version-bound Descriptor previews remain stale.

The shared scene writer rejects newly introduced Tag 1008, not unknown Characters
generally. Existing tags and image writers remain unchanged. Variant family copy
is manual and can copy tags; coordinate it with cleanup. Needs Review, Variant
Hidden and taxonomy roots are blocked dependencies, not permanent policy exceptions.
Enabled plugin versions/hook absence are audited and bound into plans. Unknown
enabled versions block this workflow until reviewed. See the narrow baseline-relative
owner patches in `integration/0.11.0`; unrelated dirty owner work is not included.

## v0.10 guided review (contract 8)

No owner-plugin/core modification. Review aggregates the existing native projection,
Auto-Tagger Character identity and Descriptor Review readers with their current
timestamp/count integrity checks. Zero native tags can prove absence; incomplete
classification cannot. A persisted Descriptor assignment does not complete review.
Pending review is an owner requirement, not proof that a particular tag is wrong.

Native corrections reuse `propose_scene_changes`; explicit Descriptor corrections
reuse resolve/preview and the existing one-scene transaction gateway. Neither review
creation nor correction drafting calls apply. Indexed Author replacement and owner
classification edits remain unsupported. No structural Variant edits, learned rules,
preferences, queue changes or browser-draft synchronization.

Variant consistency is explicitly not checked by the six-check review plan.
The existing family reader remains available for separate investigation; it does
not become a global inconsistency detector. Owner-unavailable states remain unknown.

## v0.8 local scene collections (contract 7)

No owner version/API change. Cards reuse Auto-Tagger 0.9.21 Character identity
and Descriptor readers, native `findScene` aliases for title/image/Studio/Groups,
and timestamp/count checks. Native Tags are not all Characters. Descriptor
presence is not completed review. Unavailable owner data stays explicitly unknown.

Existing Variant read receipts can present only returned members with
`consistent:true` and not missing; they do not establish whole-family integrity.
No richer family comparison or structural actions are added. Preferences,
queues, learned rules, browser-only review drafts and playback remain untouched.

The new presentation tool has no owner execution or mutation path. UI hydration
is separate from model dispatch and uses three bounded batches per collection
(owner capability/version checks add small fixed queries). Historical evidence
stays tied to its source read; explicit refresh only replaces current card data.
No new owner GraphQL/plugin-operation capability is exposed to Codex.

Existing Descriptor Browser/Preferences/More Like This load native
`PluginApi.components.SceneCard()`. Their full card projection includes paths,
preview URLs, custom fields, markers, galleries and fingerprints, with additional
popover assumptions. The chat deliberately uses small trusted React cards instead:
no file-name fallback, video preview, broad hidden metadata or unsafe taxonomy
heuristic. It reuses PluginApi React, existing Bootstrap buttons/theme, base paths
and the existing AI transcript; it adds no new React patch or route listener.

## v0.7.0 Character identity (contract 6)

Auto-Tagger **0.9.21** owns `character_identity_v1` (`capabilities` / `scenes`).
It accepts 1–20 numeric scene IDs, deduplicates within that bound, batches singular
GraphQL reads and returns only IDs/counts/evidence, timestamps and completeness.
100 assigned tags per scene is the classification ceiling; oversized sets remain
unknown. No filenames, titles, descriptions, custom fields or full unrelated tag
lists are returned. Missing scenes and missing/malformed responses stay distinct.

The owner reuses `isCurrentCharacterTag`, `tagHasParentNamed`, normalization,
`DEFAULT_CONFIG.characterParentTag`, `EMBEDDED_ALIASES` and
`NON_CHARACTER_TAG_NAMES`. This is an **explicit subset**, not the full inference
engine. Direct Character parents and builtin canonical Character names establish
positive identity; explicit owner exclusions establish non-Character identity.
Ignored tags, unregistered rootless tags, conflicting parents/rules and indirect
ancestry stay unknown. Existing parent-name normalization applies; root aliases
and arbitrary ancestry are not invented. No config loader, learned-rule reader,
runtime full-catalog inference, task dispatch, mutation or initialization is used.

Vocabulary Labels only relabels UI. More Like This / Library Health's existing
rootless-tag heuristic is not authoritative negative classification and is
unchanged. Descriptor Review stores assignments in custom fields, not tags.

The companion gates the exact live owner version before every read, validates
envelope/ID/count/presence consistency and projects a <=64KiB owner response.
Descriptor reads/transactions remain supported at the two exact audited versions
0.9.20 and 0.9.21; the response must match the live version. Character reads require
0.9.21. Contract-5 attention retains no-tags semantics; contract-6 joins at most two
20-scene batches and excludes unknown Character status from missing queries.
Native timestamp/count agreement protects joins from scene edits between reads;
taxonomy/scene reads remain non-atomic. Global Character coverage is unavailable.

Generated owner parity: `node scene-auto-tagger/build-ai-read.cjs --check`.
Release-local deltas and test-only exact owner fixture: `integration/0.7.0`.
Production service never imports that fixture or copies the owner's classifier.

## v0.6.0 native insights and owner intersections

No owner runtime plugin changed. Library Health 0.1.3 has no safe server snapshot
API: its five-minute browser cache, Character identity, descriptor parsing,
Inbox/queues and full scene/Audio aggregation stay owner-controlled.
AI uses Option C: independent bounded native counts, explicitly not that dashboard.
Author = one or more Group relationships; Franchise = Studio present. Denominator
is all scenes. Audio inventory uses Native Audio's existing count query only.
Global Character/descriptor/backlog/variant statistics are unavailable, not zero.

Descriptor Review/Needs Review intersections reuse the existing Auto-Tagger
0.9.20 read adapter and exact compatibility gate. Character absence can only be
asserted for zero-tag scenes; no any-tag classifier or descriptor eligibility
clone was introduced. Native coverage still works when optional owners fail.
Variant family and Preferences inspection remain existing bounded tools, not
global anomaly discovery. Review Center links and the supplied toolbar icon remain.
See `REPORT-0.6.0.md` for measured scope and `service/library-insights.mjs` for
fixed query definitions. No owner UI caches/configuration or learned data is read
or mutated by this module.

## v0.4.0 implemented descriptor transaction

Auto-Tagger 0.9.20 exposes `descriptor_transaction_v1`; Diagnostics 0.2.5 reports
the fixed one-scene/12-assignment approval contract without metadata payloads.
Read adapter v1 stays intact, now gated to Auto-Tagger 0.9.20. Other owner versions
and APIs are unchanged. See DESCRIPTOR-TRANSACTIONS.md for exact commands, source
sharing, builtin-only vocabulary scope, durable companion idempotency and non-CAS
limitations. The older write go/no-go section below is historical and superseded
only for descriptor assignment changes—not review completion or learning.

Integration deltas against the preserved dirty source baseline are in
integration/0.4.0. No unrelated owner work was staged or overwritten.

## v0.3.0 implemented owner-read contracts (historical)

Audited/deployed 2026-10-19 (America/Chicago). All new capabilities are read-only.
The companion coordinates owners; it is not a second inference/review engine.

| Owner/version | Authority and existing boundary | v0.3 result |
|---|---|---|
| Auto-Tagger 0.9.19 (was 0.9.18) | Persisted descriptor custom fields; browser pure review rules; server learning/repair operations have broader side effects | Small owner API v1 added: eligibility, persisted review state, descriptors, Needs Review flag and bounded pending candidate pages |
| Variant Sets 0.5.27 (was 0.5.26) | Persisted variant_* relationships; owner parsing/family helpers; browser discovery drafts | Small owner API v1 added: requested scene/primary/paged declared members, inconsistency evidence; drafts explicitly browser-only |
| Preferences 0.3.1, unchanged | Persisted scene_pref_* state; existing preferences_get operation is read-only even for empty probe | Existing reader reused: vote/exclusion/revision/scope and shuffle count/time. Configuration getter may initialize state: not exposed |
| Library Health 0.1.3, unchanged | Browser-calculated Review Center snapshot; five-minute cache and owner metric definitions | Browser-only. No server cache endpoint, implicit full-library refresh or invented denominators |
| Review Center 0.1.4, unchanged | Browser aggregator of owner review providers | Underlying readers reused; no claimed aggregate backlog or browser-draft access |
| Core 0.1.0, unchanged | Browser registry, GraphQL/route helpers | No competing global registry; companion reports only its executable allowlist |
| Diagnostics 0.2.4 (was 0.2.3) | Existing sanitized browser status provider | Fixed scalar read-only capabilities, adapter version and freshness; no metadata payloads |

## Transport and authentication

Only the paired local companion dispatches typed model tools. Owner operations
use the existing authenticated Stash GraphQL transport, not a new public port.
The local installation currently accepts loopback GraphQL without an API key;
the existing configured Stash credential path is retained. Stash's operation Map
serializes integer arguments as strings in embedded JS; owner adapters accept
the bounded numeric forms while the companion requires actual JSON integers.
Owner read operations return synchronously, with no queued tasks or writes.

The two new owner operations return `{apiVersion:1, owner, ownerVersion,
readOnly:true, observedAt, source, ...}`. Descriptor API source is persisted scene
fields plus owner UI predicates. Variants source is persisted declared links.
Preferences retains its existing `{ok:true, preferences}` response; the companion
adds read timestamp/provenance. Owner results are not a cached scene snapshot.

## Exact model and owner operations

`get_plugin_capabilities({})` discovers manifests/enabled flags and probes only
the fixed read mode. Discovery TTL is 60 seconds with observedAt/fresh/stale;
concurrent discovery is coalesced. Exact compatible versions appear above. Missing,
disabled, incompatible, malformed and timeout states exclude that reader from new
thread catalogs. A later failed read is isolated to that result. Eight-second
timeouts and a 65,536-character serialized owner-response ceiling apply; output
is projected to known fields. Every read rechecks the live owner version.

`read_descriptor_review({sceneIds})`: 1–20 unique decimal scene IDs, no page fields.
Calls owner `mode:ai_read_v1, kind:scenes`. One aliased query returns explicit
not_found entries and bounded summaries. The alternative `{pending:true,page,limit}`
calls `kind:pending` (page 1–10000, limit 1–30, default 20). One stable ID-sorted
native candidate page is filtered by the exact owner eligibility/processed rules.
`candidateCount` is the native candidate total, **not** the review backlog;
`matchingCount:null`, `scanned`, `hasMore` and `candidate-page-only` prevent invented
coverage. Empty results do not imply no remaining backlog. Categories are the owner
taxonomy “Sex Acts & Positions” and “Endings”; each descriptor array caps at 100.
Missing persisted status remains missing; Auto-Tagger completion is always unknown.
The browser's transient review progress is not read. Files/paths stay inside the
owner and never enter the model-facing result. The generated helper parity test
must pass after future Descriptor UI rule changes.

`read_variant_family({sceneId,page,limit})`: one decimal ID, page 1–10000, limit
1–20. Calls owner `mode:ai_read_v1, kind:family`. At most three batched GraphQL
queries read requested scene, primary if needed, and the current member page.
Response distinguishes not_found, no_declared_family, declared_family and
inconsistent. familyId is owner-canonical `set_scene_<primaryId>` for deduplication.
Membership includes the primary. Declared count is not a discovered/repaired count.
Checks cover requested/primary/returned member references, roles, canonical set ID,
missing records and reciprocity. No reverse-link or full-graph scan is implied.
Malformed/oversized child declarations fail closed; no discovery or structural
mutation runs. Saved candidates and Preview Required remain browser-only.

`read_scene_preferences({sceneIds})`: 1–20 unique decimal IDs. Calls existing
`mode:preferences_get`; missing IDs are explicit. Neutral absent votes follow owner
semantics, not an AI inference. Vote (-1/0/1), independent exclusion, revision,
scope, shuffle count/time and familyShared are projected. Internal generation,
weights/configuration and unrelated fields are omitted. Capability probe uses an
empty ID array and neither initializes configuration nor scans scenes.

## Cross-plugin coordination

Native Character/tag searches and entity resolution remain separate. Join only by
authoritative scene IDs, deduplicate by canonical family ID, and retain each source's
coverage. A turn permits at most 12 plugin discovery/read calls. The model is told
to report partial scans and never treat absent drafts/flags as completion. No new
recommendation model, inference algorithm or full-library query endpoint exists.

## Write go/no-go: deferred

Descriptor save/undo currently lives in browser workflow code, writes a partial
custom-field patch and keeps local draft/history semantics. It is not a versioned
server operation with expected-before validation, idempotency and durable recovery.
Learning/repair APIs can alter learned corrections and other metadata; they are not
equivalent narrow review-state updates. Thus Phase 6 gates 2/8/9/10 are not met for
an externally orchestrated review save. No custom-field shortcut was added.

Next owner-side work should extract one deterministic single-scene review command
with immutable before/after, stale-state rejection, operation ID, durable outcome
and explicit compensating preview. Only then add a new approval operation/schema
with preservation/failure tests. Variant structure and Preferences edits stay out
of scope. Library Health would need an owner-controlled read-only metric snapshot
endpoint with denominator definitions/timestamps, not a generic browser bridge.

## Integration artifacts and rollback

`integration/0.3.0` contains exact deltas against the captured dirty owner baseline
and the new owner source/test files. It does not stage the owner repository or
absorb unrelated prior edits. Review patches against the exact baseline before
applying; do not blindly overwrite a newer owner checkout. Rollback code only,
never restore old auth/config/conversations/proposals over current protected state.

## Historical pre-v0.3 assessment (superseded above)

Live-source audit distinguishes server-backed metadata from browser-local state. No generic runPluginOperation tool was exposed.

| Owner | Existing boundary | Suggested next step |
|---|---|---|
| Scene Auto-Tagger / Descriptor Review | Server modes include learn preview/apply/list/disable/undo and repair preview/apply; browser review state and learned correction semantics belong to the plugin | First expose a versioned, read-only status/preview adapter. Keep learning, repair/apply and correction rewrites unavailable until owner-specific proposals and tests exist |
| Scene Variant Sets | Structural fields and backend discovery/link/unlink/promote/repair operations; browser review drafts; read-only SceneVariantReview API | Read family summaries through an owner contract first. No direct custom-field rewrites or structural repairs |
| Scene Preferences | Server operations and scene_pref_* fields; browser API includes config/preferences/shuffle operations | Add an explicit read-only capability with documented no-initialization side effects. Config getters can initialize state, so do not assume every getter is pure |
| Session Queue / Saved Queues | Current queue is tab-session state; named saved queues are browser localStorage; owner APIs exist | Requires consent-bound browser communication, not a remote GraphQL guess. Preserve queue ownership and manual-selection guards |
| Library Health | Browser aggregation of GraphQL metadata, with optional owner APIs | Reuse pure evaluation rules for bounded read-only summaries; avoid duplicating business rules or loading the entire library into model context |
| Review Center | Browser aggregator and owner-workflow links | Safe navigation/status links first; do not impersonate its provider actions |
| Custom Stash Core / Diagnostics | Capability registry, GraphQL helper, route/scope utilities, sanitized status reporting | Keep orchestration in the companion. Extend only narrow versioned capabilities |

Priority order:

1. Read-only owner capability discovery and bounded health/variant/preference summaries.
2. One owner-supported metadata workflow with immutable preview, stale checks and explicit approval.
3. Consent-bound browser queue operations, with separate tab/queue ownership and lifecycle tests.
4. Leave learned corrections, family repair/discovery, media/file operations, plugin source changes, Native Audio schema, arbitrary GraphQL and SQL unavailable.

v0.2.0 implements ordinary native tag/studio/group relationships, not owner-plugin
operations. Descriptor state is stored in custom fields (including
r34_scene_descriptor_status/source and descriptor arrays), and Needs Review is
owner-managed. Vocabulary Labels renames generic Tags, not a reliable classifier
of every tag as a Character. The ordinary relationship adapter must not infer
Descriptor or learned-correction edits from those labels.

Estimated next-step complexity: Auto-Tagger/Descriptor read-only preview adapter
medium (server modes exist, review draft state remains browser-owned); Variant
summaries medium and structural changes high; Preferences read-only medium because
getters may initialize state; queue communication high due to browser/tab ownership;
Library Health/Review Center bounded read-only adapters medium. Each needs an
owner-versioned, side-effect-declared contract and separate approval rules before
writes. None are implemented or automatically authorized by v0.2.0.

## v0.10.2 owner boundaries

No owner runtime changed. Auto-Tagger remains 0.9.22 with existing Character detailSchema 1
and Descriptor read/transaction APIs. Recommendations reuse those reads, now retaining the
verified owner version in the companion projection for evidence fingerprints. Stash AI's
review-decision log is not an owner review-completion API and never changes owner flags,
classification, learned rules or private custom fields. The Descriptor Review link uses the
existing `/plugins/scene-descriptor-review?scene=<id>` route; merely displaying it does not
execute a workflow. Compatibility gates and metadata approval limits remain unchanged.
