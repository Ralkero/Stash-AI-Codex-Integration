# Reviewed identity registry — Scene Auto-Tagger 0.9.26

This focused owner update extends the existing 0.9.25 eligibility policy. Stash AI remains 0.11.2. It does not introduce a new classification writer or change scene metadata.

## Result and evidence standard

The offline manifest adds 66 reviewed fictional-identity records. Each has a canonical identity, narrowly supported aliases, franchise context, factual decision basis and public source links. Publisher biographies are preferred; explicit encyclopedic character classifications provide additional support. No runtime web access, bulk data import, appearance inference or copied biographies are included.

An installed read-only audit matched all 333 current Tag definitions against expected outcomes. Among 326 previously unresolved candidates, 62 became eligible. The remaining 264 stay blocked, including two verified but ignored Tags and four Tags in two duplicate-alias pairs. Existing six eligible Tags and one exclusion retained their behavior. A complete private disposition table was retained locally, not published.

This was a conservative evidence review and triage, not a claim that all remaining names are ineligible or impossible to verify. Short/shared names, uncertain canonical aliases, collective or title-like labels, and insufficiently substantiated identities stay unresolved. No gender is inferred from an unfamiliar name. No real-performer verification was added. A later review can add evidence without changing the gate.

## Compatibility and safety

- Existing identity, ignored-tag, taxonomy-conflict, duplicate-native-alias, exact scene-association, fresh-state and additive-only safeguards remain intact.
- Canonical aliases do not merge native Tags. Lili/Emilie De Rochefort and Sue/Susan Storm continue to fail closed when both native definitions exist.
- Sources and revision are additional provenance fields on eligibility results; legacy Character taxonomy and Descriptor review contracts remain unchanged.
- Stash AI allowlists accept audited owner 0.9.26 while unknown future versions remain rejected. Proposal approval, frozen environment matching and mutation limits are unchanged.
- No production tagging task, cleanup plan, metadata write or media access was performed. Source/deployment checkpoints remain local and recoverable.

## Validation

- 559 Stash AI tests pass; syntax checks pass.
- 104 owner test entries pass, including 73 new registry tests; the legacy harness also reports its nine assertions passing.
- Four existing owner verification scripts pass against fixtures.
- Reconstructing the distribution patch from the saved 0.9.25 baseline produces normalized source parity; rebuild/parity checks and all 103 eligibility/registry tests pass in that reconstructed copy.
- Installed Web/embedded-JS owner classifications match local expectations for all 333 Tags in batches of at most 50. The old Character scene projection is preserved.
- Installed Stash AI Character and Descriptor readers report available, and the cleanup environment accepts the audited owner version. The running companion rejects unauthenticated status requests with HTTP 401.
- All 66 database-table hashes, all 19 protected top-level companion JSON state files and Stash configuration are unchanged. Source/installed runtime hashes match. No tagging jobs were launched.

Fixture mutation tests are not production write tests. No new Codex conversation was created; isolation configuration and historical conversations were not changed. Media files were not opened, modified or re-encoded; their contents were not exhaustively rehashed.

## Maintenance and licensing

See [the integration package](../integration/auto-tagger-0.9.26/README.md). Its registry is auditable data, not a model-generated authority at runtime. Existing MIT code licensing is unchanged. Factual assertions are recorded in original wording with source links; external publications, biographies, images and character rights remain with their respective owners. Source pages can change, so future additions need fresh review and the same tests.

Recommended next work is targeted disambiguation with user-confirmed canonical identities or stronger references, not a broad permissive matcher. Ignored Tags and duplicate definitions require separate explicit decisions; this update does not make those decisions for the user.
