# Offline identity migration reconciliation

This is an operator planning utility, not a product release or runtime tool.
Stash AI, Auto-Tagger, existing journals and approval permissions are unchanged.

The earlier private one-off transformation confused a canonical identity decision
with evidence for every scene association. A fixed source-to-target map could
recommend a specific character for a costume or generic noun. Per-Tag output also
created multiple competing final states for scenes shared by several decisions.
That generator is retired locally. Historical reports are preserved as evidence.

`scripts/lib/identity-reconciliation.mjs` now separates:

- Identity intent, scene evidence, removal eligibility and destination existence.
- Independent removal from atomic replacement; no remove-now/add-later guessing.
- Fresh exact-ID snapshots from dated historical recommendations.
- One consolidated safe final set from unresolved possible changes.
- Native proposal representability from actual approval and execution.

The engine rejects stale evidence, unavailable scenes, unknown destinations,
conflicting replacements, preservation/removal conflicts and destination/removal
conflicts. Duplicate findings normalize without dropping unrelated assignments.
Dependency ordering detects missing nodes and cycles. A destination requiring
creation remains blocked; it is never represented by an invented native ID.

## Operator use

Prepare private JSON containing `scenes`, `tags` and separately reviewed
`candidates`. Each candidate comes from `candidateFor`, references its decision and
evidence, and binds to a fresh scene fingerprint. The metadata snapshot is not a
visual observation. A title or Studio alone is not a general identity certificate.
The utility does not validate the truth of operator-supplied research; that remains
the explicit evidence-review responsibility, not a model-authored authority.

Run `node scripts/reconcile-identities.mjs PRIVATE_INPUT.json NEW_PRIVATE_OUTPUT.json`.
The output path must not exist. Never commit these private files or use the output
as a signed runtime manifest. The CLI has no network, journal or mutation calls.

## Approval boundaries

`nativeRemovalRequest` verifies one coherent request of at most five scenes and
20 Tag IDs. A union of removals must yield each exact intended scene result.
`nativeReplacementRequest` admits only the current one-source/one-destination
relationship shape. Compound merges remain unsupported, not silently split into
several proposals. No loop submits sequential proposals to evade a turn limit.

The existing bulk cleanup's exact audited identity allowlist remains unchanged.
A logically valid removal is not automatically eligible for that executor.
Renames, aliases, creation, ignore settings and global retirement have distinct
ownership/approval requirements. The planner adds no such mutation authority.

Where a scene has independent removals followed by replacement, Stage B depends
on verified Stage A and a newly observed snapshot/new preview. Do not approve both
against incompatible before states. Title changes never imply file renaming or
Variant Sets membership edits. Global definition retirement follows an all-media
relationship and owner/learned-rule dependency review, not just scene cleanup.

## Validation and privacy

`node --test tests/identity-reconciliation.test.mjs` covers merging, ambiguity,
staleness, deterministic normalization, dependencies and native request limits.
Private concrete regressions and actual installed proposal/owner fixtures stay
local. Real proposal preparation/apply logic is tested with in-memory adapters;
fixture approvals are not production approvals. No runtime UI changes are needed.

Generic code and synthetic fixtures are published. Current native IDs, scene
titles, filenames, private bindings, decisions and migration artifacts are not.
