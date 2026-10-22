# Scene collections and refinement — v0.10.0

New model catalog 8 / 18 tools with installed owners. Sidecar schema 1. Journal 3.
Older saved catalogs remain unchanged.

## Structured reviews

`review_scenes` is an eligible source. Each row stores only sceneId, fixed finding
codes and `review:{schema:1,checks:[{key,state,authority}]}`. Exactly six unique
registered keys and their matching authorities are required. States are observed,
not-observed or unknown. No editable metadata, images, executable correction or
model-authored narrative becomes trusted evidence.

The existing source/turn/message/owner joins and successful-completion requirement
apply. Historical summaries overlap. Current feedback is recomputed from hydration;
the sidecar is not updated. Unavailable refresh invalidates current verification.
Manual Refresh verification also reads latest-three same-conversation operations,
without copying credentials/integrity tokens or inferring resolution.

Old schema-1 collections still load without rewriting them. New review rows require
v0.10's validator: rolling back only code to v0.9 can fail closed on those rows.
Preserve the newer sidecar; do not restore an older checkpoint over newer history.

## Provenance (retained)

Only successful eligible current-turn reads issue `presentationSource` receipts.
`present_scene_results({sourceId,sceneIds,layout})` selects unique IDs from exactly
that receipt. No metadata, URLs, HTML or arbitrary findings are accepted.
Two collections/20 scenes total/24 receipts per turn. Publication requires a
successful completed turn and exact final assistant item. Cancelled/failed turns
cannot publish. Saved owner/thread/turn/message/source joins remain authoritative.

Schema-1 references store IDs, source/scope/time and fixed finding codes, never
images or a second transcript. Cap 1,000 collections / 4 MiB; no eviction or
migration. Legacy records remain unchanged. UI hydration is an authenticated
owned-collection read: one native batch and two owner batches (plus bounded
capability/version checks), maximum four concurrent/coalesced collection reads.

## Local preferences

All filters evaluate only hydrated members; different categories use AND.
No multi-select Boolean builder. No model call, library search or sidecar write.

| Filter | Authoritative interpretation |
|---|---|
| Character status | Present / absent / unknown from the existing timestamp/count-checked owner join; verified zero tags can independently prove absence |
| Classification | Complete / partial / unknown; presence and completeness are independent |
| Author | Assigned / missing / any matching specific Group ID from this collection; multiple Authors supported |
| Franchise | Assigned / missing / specific Studio ID from this collection |
| Descriptor Review | Pending from owner predicate; Reviewed requires persisted `reviewed`; unavailable is unknown; other known not-pending states stay separate |
| Current condition | Current verified missing Author/Franchise/Characters, pending Descriptor Review or explicit Auto-Tagger Needs Review |
| Original finding | Separate historical source codes, including Character uncertainty; never interpreted as current evidence |

Missing/deleted/unavailable records never satisfy current missing relationships.
They can satisfy Unknown or historical criteria. On refresh failure, current
filtering treats retained data as unverified; dated cards may remain for context.
Between explicit refreshes the successful observation remains a dated read, not
a continuously live guarantee. Owner stale joins are unavailable, not absence.

Specific entity options use only hydrated names/IDs (Authors bounded to first
100 per scene). No entity scan. Names are untrusted React text. Duration uses the
first of the existing projected source-file records, not a sum of alternate
encodes. Unknown values sort last in both directions; equal values retain original
position. ID sorting is numeric. Original order never mutates the source array.
Creation-date sorting and grouping are not offered.

Counts say “X of Y scenes in this collection match,” separately showing mounted
cards and active filters. Six cards initially mount; Show more mounts six more
matching members. The original scope remains visible. Original global/candidate
counts, when known, stay in the original tool-backed answer; old sidecars cannot
reconstruct an unstored total and no number is invented.

Selections retain filtered-out IDs and display their hidden count and exact IDs.
Clear Selection does not reset filters. Reset Filters does not clear selection or
sort. Preferences survive view switches, not unmount/reload/conversation changes.

## Draft context and Send

Actions prepare editable text plus optional UI context:

```json
{
  "type": "selection",
  "collectionId": "existing-collection-id",
  "sceneIds": ["647", "14"]
}
```

`/send` retains id/text/optional sceneId and adds optional `collectionContext`.
Only `selection` and `refinement` types are accepted. Selection needs 1–20 distinct
decimal IDs; refinement permits 0–20. Every ID must belong to the saved collection
owned by the same integration principal and conversation. No arbitrary source
metadata/filters/approval fields are accepted as verified evidence.

Validation precedes proposal cancellation, active-turn setup and runtime calls.
Invalid/foreign context rejects without those effects. Removing context leaves
ordinary free-text chat. Editing text does not expand the verified selection.
The composer displays the attached IDs and an explicit removal button.

Investigate, Compare, Review Status and Related Scenes are read-only draft
templates. Search Stash again prepares a distinct new-search request with local
criteria described as requests, not established query capabilities. No action
automatically sends, approves or supersedes a proposal. Explicit Send retains
the normal pending-preview cancellation rule.

The service prefixes validated membership/source/scope/time to existing user
input; it is not a receipt for new results or proof of current metadata. New
searches use existing typed/bounded tools, fresh receipt selection and successful
completion. Unsupported intersections require bounded authoritative checks or
clarification, never silent broadening or exhaustive scans. Related means
user-chosen supported metadata, not visual similarity.

No dedicated parent-lineage sidecar field in v0.9. The persisted conversation and
context prefix provide traceability; original and refined collections remain
independent immutable references to their own successful reads.

## v0.10.1 finding clarity (no sidecar migration)

Hydrated `reasons` describe actual selection. `findingExplanations` separately
describe saved finding codes, original time, category and current verification.
Character projections retain presence/completeness and optionally detailSchema 1,
up to four unknown-tag details and fixed plain-language explanations. Presence
`present` plus completeness `partial` means Character assigned, not unknown overall.
Simple and Advanced share these cards; technical states remain in expanded details.
`reviewSummary` adds incompleteClassification and possibleIssues (zero until a
trusted suspicion signal exists); all counts are overlapping, scoped observations.
No persisted row, finding code, authority, selection boundary or approval changes.

## v0.10.2 recommendations (additive projection; sidecar still 1)

Each hydrated card has `recommendations: {schema:1, rows, prior, summary, incomplete,
decisionStorage}`. Rows bind fixed finding key/scene/authority/time/evidenceStatus, fixed
category/title/explanation/draft, clarification need, opaque relevant fingerprint,
canAcknowledge and optional decision state. Never persist these current projections in
historical collection rows. `review_scenes` returns the same current recommendations;
the existing sourceRows validator continues to save only six-check snapshots.

Categories implemented by fixed checks: investigation, review, optional clarification,
no change. No fixed check supplies an intended entity, so none pretends correction-ready.
Explicit user-specified changes continue through existing entity resolution and native/
Descriptor preview. No new executable action is accepted from the model.

UI draws up to three actions, with extras expanded. Drafts carry the exact scene as existing
validated collection selection context. Confirmation/reopen use separate authenticated
requests and never send a model turn or metadata approval. Old chats can use UI decisions;
conversational preparation requires new catalog 9. Unavailable storage leaves factual
findings visible with an honest notice. Old prose and original finding times are preserved.
