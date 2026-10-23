# Exact-Manifest Character Tag Cleanup — contract 1

Stash AI 0.12.0 adds an account-owned, UI-only workflow. It is not a language-model
tool. The existing Franchise cleanup allowlist and native five-scene proposal
limit are unchanged. Auto-Tagger, Variant Sets and the restricted Codex runtime
are not changed by this release. The tool catalog remains version 10.

## Admission and immutable review

The operator-only `scripts/prepare-character-review.mjs` accepts a private
reconciliation and its removal-only Plan A, with explicit SHA-256 digests for
both input files. Stop the companion first. Its arguments are, in order:
state directory, reconciliation JSON, expected file digest, Plan A JSON,
expected Plan A file digest, and a short source reference. It refuses an existing
staged source rather than overwriting it. Keep all inputs, state and outputs private.

The importer verifies agreement between both artifacts, exact scene IDs,
consolidated before/remove/after sets, fresh-snapshot fingerprints, recorded user
decisions and accepted findings. An accepted replacement is admitted only as a
redundant relationship removal when its destination already exists in the scene
and is preserved. Additions, unresolved destinations and unresolved removal
dependencies are rejected. `supported` alone does not pass admission.

The service re-reads each exact scene, required native Tag definitions and the
audited environment. Stale, missing, ignored or renamed identities are excluded,
never broadened. Other ambiguous findings remain recorded but cannot grant scope.
It freezes one plan with a UUID, schema/type, timestamps, source reference/digest,
environment, exact per-scene operations, Tag names, metadata preservation hashes,
evidence, exclusions and counts. The initial bounds are 500 scenes / 1,000 pairs.
These are resource limits, not authority to expand the supplied reviewed source.

## Authentication and storage

`/character-cleanup` uses the existing loopback host/origin check, paired bearer
credential, timestamp and single-use request nonce. Owner identity comes from
authentication, never the request body. No endpoint accepts a client manifest,
approval flag, filename, arbitrary query or mutation. No embedded model tool can
prepare, approve, resume or invoke this endpoint.

Reading the complete plan issues a ten-minute review challenge bound to owner,
plan and digest. Approval also requires the exact digest and explicit UI
acknowledgement. A successful approval is single-use, HMAC-bound to the immutable
manifest, owner, review context and approval time. Reviews and approvals each
expire after 24 hours. Expired pending reviews can be regenerated from the same
staged source, with fresh checks and new approval. Approved expired/uncertain
work must be reconciled before an operator stages any remaining scope.

Separate `exact-character-*` files use the existing protected, fsync-and-rename
Store. The index and complete plan/journal records are HMAC-sealed with a private
local key. Each journal event also chains to the previous event digest. Invalid
indexes, manifests, approvals or journals fail closed. A journal write failure
disables the workflow; owner writes never precede durable intent. This protects
against accidental changes and untrusted clients, not an administrator who can
read the key and rewrite protected local files.

## Execution, progress and concurrency

One approval schedules batches of at most five scenes. Each scene is one
`bulkSceneUpdate` with one scene ID and Tag mode `REMOVE`; it cannot add Tags or
overwrite an entire Tag array. Before each operation the executor checks approval,
exact current Tags, protected metadata and Tag definitions. It rechecks the owner
environment each batch. Playback counters, resume position and `updated_at` are
excluded from metadata preconditions; meaningful metadata remains protected.

Each operation records intent, sends once, reads back, and verifies the exact
expected Tag set and protected metadata. Stale or externally already-absent
relationships are skipped and not counted as our successful removals. Independent
scenes can continue. Failures and mismatched readback stop scheduling. A failed
write response triggers readback, not a duplicate write. Readback confirming the
result is recorded explicitly. After interrupted intent, resume performs a
read-only reconciliation: an observed after-state is marked recovered with
uncertain attribution, separately from verified removals; any other outcome
requires manual investigation and cannot be blindly retried.

The native API has no compare-and-swap transaction combining the read with REMOVE.
A concurrent external writer can therefore race the precondition. REMOVE does not
replace unrelated Tags, and post-write verification detects mismatch; it cannot
prevent every concurrent change. Avoid simultaneous tagging jobs or manual edits.

All new workflow actions serialize. Approval and resume also coordinate with the
existing native and cleanup write gates. An unresolved approved job blocks other
companion mutations. Pause stops new scene scheduling after the current scene's
verification. Restart never resumes writes; explicit authenticated Resume is
required. No automatic retries of ambiguous writes, automatic rollback or
background approval automation exist.

## User interface and recovery

Open **Character Tag Cleanup** in the Stash AI page header (Simple or Advanced
View). It is account-wide, not attached to or inserted into a conversation.
Inspect the complete plan, search by scene ID or Tag name, filter by reason, expand
before/remove/after sets and evidence, and export the immutable review plus audit.
Filtering never narrows or changes the scope of the single approval button.
The acknowledgement checkbox starts unchecked. Busy/error/progress feedback is
visible; verified counts are distinct from pending, skipped, failed and recovered.
Paired users can inspect a plan even when the Codex runtime is unavailable.
Approval/resume remain disabled until runtime and write gates pass; inspection
does not grant execution authority.
Explicit Prepare / revalidate preserves an unchanged pending plan. If its bound
environment changed, it invalidates only that unapproved review, retains the old
manifest/journal, freshly reads the original staged candidates and creates a new
plan requiring new approval. It never rebinds or expands an existing approval.

Exported recovery candidates contain only previously affected scene/tag pairs,
original Tags and expected post-operation preconditions. They are not executable
rollback authority. A later correction requires fresh reads and its own approved
relationship-addition operation. Do not restore an old whole-library database or
overwrite intervening user changes. Recovery may be unsafe after later edits.

## Tests and privacy

Run `npm test` and `npm run check`. Dedicated exact-character tests cover frozen
scope, authentication/replay, tampering, expiry, missing/stale data, interruption,
pause/resume, no-op failures, protected metadata and UI acknowledgement/refresh
races. Production removal is not a deployment test. Private native fixtures,
manifests, journals and backup evidence stay outside the public repository.
