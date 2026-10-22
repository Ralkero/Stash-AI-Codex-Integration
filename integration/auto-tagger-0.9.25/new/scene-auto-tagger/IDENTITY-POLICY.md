# Female identity assignment policy (0.9.25)

Native scene Tags added by this owner must identify a verified female fictional
character or verified female adult performer, with independent scene evidence.
Taxonomy membership, existing assignments, learned corrections, creator credits,
franchise relationships and feminine-looking names do not establish eligibility.

`identity-eligibility-source.js` is an owner-reviewed registry and pure policy
module embedded by `node build-ai-read.cjs`. The initial evidence is the explicit
identity examples in the requested policy. There are no verified real-performer
records in this initial registry. The performer schema requires explicit adult
verification. Additional records require reviewed source changes; there is no
model-accessible registry writer. Removing a record reverses its future eligibility
without changing any existing assignments or saved learned rules.

Names use NFKC, case folding, separator normalization and complete phrase matching.
Man/Boy and Woman/Girl/Lady are separate tokens. Batman, Superman, Hellboy,
Supergirl and Batgirl are curated compound forms. Unknown feminine names remain
unresolved. Established conflicting gender signals make a known identity unresolved.
Chainsaw Man has a separate Franchise rejection when explicitly categorized under
Franchises. Otherwise its reviewed character identity is male. No blind `man`
substring matching is used.

The existing parser/confidence thresholds still nominate candidates. The new gate
additionally requires an exact canonical name or reviewed alias in the title or
file basename. Folder names, descriptions, Studio and Author links do not count.
This is textual association, not proof from video content; title ambiguity remains
a limitation. Runtime aliases cannot independently confer eligibility.

Every embedded `sceneUpdate` carrying `tag_ids` goes through `guardSceneIdentityWrite`
in `doGraphQL`. It rereads current assignments and a complete bounded tag inventory,
rejects collisions and unverified identities, preserves every existing Tag, and
rejects requested removals. Inputs built from a previous scene snapshot reject
changed Tag/Studio/Group state. Stash does not provide atomic compare-and-swap here;
an external writer racing after the last read is a remaining platform limitation.
Inventories above 10,000 Tags fail closed. The inventory is read per proposed write;
no persistent identity cache can become stale.

Bulk tagging previews filter blocked candidates and log exact Tag IDs and reason
codes. The final boundary rechecks accepted candidates. Manual learned repairs
cannot bypass it: incompatible assignments or Tag removals return errors and
require explicit handling outside Auto-Tagger. Learned records remain unchanged.
Scene tagging no longer creates global Character Tags or assigns/removes the
Needs Review marker. Review remains visible in task results. Independent native
Stash editing, image folder tagging and descriptor custom-field transactions keep
their existing ownership and semantics.

The separate read-only `identity_eligibility_v1` operation accepts either
`{kind:"capabilities"}` or `{kind:"tags",tagIds:["..."]}` (1–50 distinct IDs).
It returns policyVersion 1, ownerVersion, eligible/ineligible/unresolved, fixed
reasons, explanatory text and evidence provenance. It never evaluates scene
association on a Tag-only read. `character_identity_v1`, detailSchema 1, and
present/absent/unknown retain their taxonomy meanings. Eligibility never authorizes
cleanup; exact approved cleanup manifests and environment drift checks still apply.

Validation: `node --test tests/*.test.js`, the four `verify_scene_*.mjs` scripts,
`node build-ai-read.cjs --check`, and the Stash AI regression suite.
