# Scene-tag policy and cleanup contract — 0.11.0

## Interpretation and scope

Native scene Tags identify Characters only. Franchises belong in Studio, Authors
in Groups, Descriptors in their owner custom fields. This policy informs task
interpretation/classification, never grants approval. A full-library cleanup request
is not a five-scene review. Ordinary review findings and their historical wording
remain accurate within their narrower checks; they do not prove policy compliance.

New chats use contract 10 / up to 24 tools. Old chats retain exact saved tool names
and routing. The pinned runtime remains 0.163.0-alpha.10.2. Five additional tools:

| Tool | Arguments / authority |
|---|---|
| start_scene_tag_audit | Empty; one durable read job over all native scenes |
| resume_scene_tag_audit | Exact auditId; read-only resume of interrupted scan |
| read_scene_tag_audit | auditId, optional page/tagId; 20 candidates or 50 scene IDs |
| prepare_scene_tag_cleanup | Complete auditId and 1–50 explicit eligible tagIds |
| read_scene_tag_cleanup | planId, optional page/sceneId; 20 frozen rows and progress |

At most 12 cleanup calls, one audit start and one plan preparation per model turn.
The model may prepare within the same turn after completion; it cannot trigger an
automatic new model turn. Background work is independent of chat generation. The
UI offers editable follow-up drafts; nothing is sent or approved automatically.

## Audit, evidence and classification

Stable ascending ID cursor (`id GREATER_THAN`, 100 rows) fetches only IDs/timestamp/
tag IDs/Studio/Group references. Reconcile count and remaining count each page.
Classify distinct identities in 50-ID owner calls, not per scene. Native Studio and
Group name catalogs supply grounded *possible* matches, not proof against homonyms.
A second ID traversal verifies exact coverage and scene projections; no atomic
database snapshot is claimed. Concurrent changes fail the audit; persistent drift
requires a new scan. Temporary read failures can resume from the durable checkpoint.

Classifications: confirmed-character, confirmed-non-character, probable-non-character,
ambiguous, system-dependent, insufficient-evidence. Owner positive Character evidence
wins over a contrary user category selection. Conflicting relationships stay ambiguous.
Ignored/unregistered/unknown tags are never automatically violations. A user can record
an exact evidence-bound classification in this audit, not modify owner taxonomy.
Changing it invalidates all plans from the prior audit revision. Decisions are scoped
to their audit, not silently propagated to renamed identities or future audits.

Explicit user policy establishes Overwatch ID 1008 as non-character. Eligibility also
requires exact identity/name, compatible owner and no positive/conflicting evidence.
0.9.23 blocks new assignments in the shared Auto-Tagger scene writer. Other owner-excluded
or user-confirmed non-Characters stay blocked until recurrence prevention is reviewed.
Names matching a Studio/Group remain probable, not removal-ready. This is intentionally
not a semantic oracle or a blanket ban on unknown Character names.

Needs Review, Variant Hidden and taxonomy roots are unresolved workflow dependencies.
Do not remove them merely to satisfy the Character-only rule. Current known plugin
versions and hook absence are pinned in the adapter; new enabled plugins/versions
require review. Local modifications without a version change are not detected by the
GraphQL version gate. Do not run concurrent metadata tasks during execution.

## Immutable preview and UI approval

Preparation rereads every affected scene in groups of five. Manifest rows contain
ID, full before Tag set, exact remove IDs, full resulting set, timestamp, unrelated
metadata hash and observation. Tag evidence, policy, native/owner/plugin/config/runtime
versions are frozen once, not rediscovered as new targets during execution.
Canonical SHA-256 binds plan ID, owner, chat, audit/revision, creation/expiry and manifest.
No page is omitted from authorization: the browser pages through a fully materialized
plan. Exact scene-ID lookup is supported. Representative scene previews draft a bounded
read using the existing scene-card system. Candidate decisions do not approve a plan.

One authenticated **Approve entire cleanup plan** click binds that exact digest and
operation. The model has no approval/control endpoint or tool. Token/origin/thread/
nonce protection is shared with existing UI. No production approval is performed by
development scripts. No global Tag or scene deletion; no Studio/Group/Descriptor edit.

## Execution and recovery

One scene per scheduled operation (50 ms between operations), no concurrent writes.
Before each: validate HMAC approval, digest, expiry, owner/environment and Tag evidence;
read complete preservation state and compare Tag set, timestamp and unrelated fields.
Persist intent with fsync+atomic rename **before** the fixed native REMOVE mutation.
Read back independently even if the mutation response was lost. Record verified,
reconciled-without-causal-claim, conflicted, or uncertain, plus pending counts/remaining
rows. A single conflict stops further dispatch. No automatic rollback or uncertain retry.

Pause/Stop are usable even while a model turn runs. They wait for the current bounded
operation, then stop future dispatch. Native requests each timeout at 12 seconds; an
in-flight operation cannot be remotely cancelled safely. Stop does not undo prior work.
Cancelled plans cannot resume; their uncertain outcomes can still be reconciled read-only.

On restart: running audit -> paused; unfinished preparation -> failed (new plan needed);
running approved plan -> paused. Intent remains distinguishable from unstarted work.
Explicit read-only reconciliation must resolve intent/uncertain rows before resume.
Matching expected state does not prove which writer caused it. Unchanged-before after
a lost response is still uncertain and cannot be blindly retried. A conflicted or expired
plan needs a fresh plan/approval for remaining work. Never erase journals to unblock.

Stash offers no compare-and-swap. The REMOVE operator avoids clobbering concurrently
added tags, but the preflight/write window and other post-write hooks cannot be made
atomic. Readback catches observed differences, not all later edits. Protected fields
include Studio, indexed Groups, Descriptors/custom fields, title/details/rating and the
existing native preservation projection. Source media is never opened or changed.

## Storage and limits

Schema 1: `tag-cleanup-key.json`, HMAC-protected `tag-cleanup-index.json`, and separate
`tag-audits-<uuid>.json` / `tag-plans-<uuid>.json`. Existing protected directory ACLs
apply. No credentials/media in audit/plan records. Ordinary proposal journal 3,
presentation sidecar 1 and review-decision schema 1 are not migrated or merged.

Limits: 10,000 scenes, 2,000 distinct Tags, 200,000 associations/audit; 100 tags/scene;
50 selected tag identities/plan; 100-row scene pages; 50-ID owner batches; 10,000 each
Studio/Group catalog; 32 retained audits, 64 retained plans, 32 MiB serialized payload
per record; 2,000 explicit decisions/audit; 500 control events/plan; 24-hour approval
expiry and one-hour run window per explicit resume. No silent eviction or truncation.
Native/owner identity fields are bounded; malformed/oversized evidence fails closed.
Capacity requires explicit archival/design work, not automatic deletion.

## Deployment / rollback / tests

Deploy coordinated AI UI/service 0.11.0 and owner 0.9.23 after checkpoints and tests;
reload plugins and use graceful Windows Stop/Start helpers. Do not copy runtime state
over active newer conversations or approvals. Check source/installed/served hashes,
Diagnostics versions and actual pinned-runtime/browser behavior, not just copied files.

Rollback: first pause/stop approved work, preserve **current** state, reconcile any
uncertain intent and disable writes before downgrading. Preserve all new audit/plan,
conversation, approval and session files. Older services do not understand bulk state
and must remain write-disabled; never restore old state as an apparent rollback. A
separate exact restoration operation would need new explicit approval and drift checks;
bulk re-add/undo is not part of this remove-only release.

Run `npm test`, `npm run check`, `npm audit --omit=dev --audit-level=high`, and
`node scripts/security-validation.mjs` (credential-free isolated fixture home).
`tag-cleanup*.test.mjs` cover state machine, HTTP/WS auth, source/owner evidence,
crashes, lost responses, pause/restart, exact preservation, pagination and React UI.
Owner classic/AI/Character/Descriptor and related plugin suites remain independent.
See REPORT-0.11.0.md for measured live evidence, exact counts and production-write status.
