# Scene Auto-Tagger 0.9.26 integration delta

Applies to the customized 0.9.25 owner (the preceding integration package), not arbitrary upstream versions. Stash AI remains 0.11.2; its compatibility allowlists additionally accept this audited owner. Unknown later versions remain blocked. Frozen proposal environment checks and approval rules are unchanged; old proposals do not silently acquire a new environment.

This delta embeds 66 manually reviewed fictional identities with source URLs, review date, canonical names and conservative aliases. Public publisher biographies and explicit encyclopedic character classifications support the factual records. No biographies, artwork, private Tag IDs, scene associations or library inventory are published. Code remains MIT; external publications and characters retain their respective rights. Sources are documented provenance only, never runtime network dependencies or automatically imported authority.

The data is in `new/scene-auto-tagger/identity-registry.json`. See each record's `sources` and `basis`, and the patched `IDENTITY-POLICY.md`. These additions do not bypass ignored-tag preferences, taxonomy conflict checks, native alias-collision checks or scene-specific association. Lili/Emilie and Sue/Susan are canonical alias pairs, not permission to merge native Tags. Ambiguous names remain excluded. No production tagging or metadata migration is part of installation.

## Apply and verify

1. Back up the installed owner and source, outside active plugin directories. Confirm the customized 0.9.25 baseline and inspect local changes.
2. From the parent of `scene-auto-tagger`, run `git apply --check --unidiff-zero <package>/owner.patch`, then `git apply --unidiff-zero <package>/owner.patch`.
3. Copy the package's `new/scene-auto-tagger` files into the owner source, without overwriting unrelated files.
4. Run `node build-ai-read.cjs`, then `node build-ai-read.cjs --check` and `node --test tests/*.test.js`. Rebuild first because checkout line endings may differ from the packaged Windows source hashes.
5. Deploy reviewed runtime/manifest/read sources, registry and policy documentation. Reload plugins, invoke bounded read-only identity APIs and compare actual responses. Deploy the four updated Stash AI compatibility modules as a matched set and restart the companion normally.
6. Confirm installed/source hashes and unchanged database relationships. Do not run a tagging task for validation. Roll back the saved files and reload/restart if any check fails.

`source-hashes.json` records exact reviewed source bytes, including Windows line endings where present. Patch reconstruction with different Git newline settings can differ bytewise before rebuilding; compare normalized text as well as deployment hashes.

The private exhaustive review and production checkpoints are intentionally not included. A remaining unresolved tag is not proof of incorrect metadata and is never authorization for cleanup.
