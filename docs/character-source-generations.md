# Additional reviewed Character cleanup sources

This is an operator-only extension of the existing exact removal workflow, not
a new executor. No HTTP/model upload endpoint or mutation permission was added.
Stash AI's protocol remains 0.12.0; source schema 2 is an additive, private
storage format. Legacy source schema 1 and completed manifests remain readable.

## Admission

`scripts/prepare-character-review.mjs --audit` accepts positional arguments:

1. State directory (stop the companion first).
2. Private audit directory.
3. SHA-256 of its `SHA256SUMS.json`.
4. Explicit user policy/task document path.
5. SHA-256 of that document.
6. SHA-256 of installed Auto-Tagger code.
7. SHA-256 of installed private identity registry.
8. Human-readable source/policy reference.
9. Private inspection output directory.

The caller must inspect and pin these inputs; this is not an untrusted JSON
upload interface. All artifacts are hash-checked. Exact candidate pairs must
match the complete audit's policy-ineligible set. Native definitions, installed
registry records, owner classifications and fresh scene state are independently
compared. Only male Character, Franchise and non-identity policy exclusions are
currently admitted. Renamed or changed Tags, ignored entries, ambiguous records,
completed relationships, replacements and stale state are excluded or rejected.
No research annotation is converted into an individual user decision. Research
provenance stays labelled as imported evidence, not freshly verified research.

## Sealed generations and history

The importer holds the same `instance.lock` as the companion. It cannot run
alongside the service or another importer. The original
`exact-character-source.json` is never overwritten. A digest-named source is
exclusively created and fsynced, then a sealed `exact-character-sources.json`
index atomically selects it. Every indexed historical source is authenticated
when resolving the current source; missing, changed or unsupported records fail
closed. An orphan source without an index after a crash requires operator
reconciliation, not silent fallback. No historical source reactivation is allowed.

New manifests embed the selected source digest, audit fingerprint, evidence and
owner environment. Old plans are self-contained and never acquire new source
contents. Approvals remain bound to owner, unique plan ID and complete manifest
digest. Repeating an unchanged preparation reuses the same pending plan. A
different active pending plan blocks staging. Output copies never authorize writes.

Execution remains the existing five-scene scheduler with fresh preflight,
definition/environment checks, durable intent, readback verification and recovery
journals. Preparation never calls approve/apply/resume/tick. The production
adapter's removal method is explicitly disabled in the importer.

## Review

The complete review preserves lifecycle-aware focus/navigation and unchecked
acknowledgement. `Expected result` can display only scenes that become untagged;
search and filters never narrow approval scope. Policy evidence identifies the
registry basis instead of displaying a fabricated individual decision identifier.
The immutable manifest and journal can be exported through the existing button.

Keep all real audit files, registry bindings, source documents, inspection copies,
approval records, snapshots and local paths private. Public tests are synthetic.
