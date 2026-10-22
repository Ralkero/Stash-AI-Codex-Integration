# Scene Auto-Tagger 0.9.27 integration delta

Applies to the customized 0.9.26 owner, after the preceding integration package.
Stash AI remains 0.11.2. The four compatibility modules accept this audited owner;
later unknown versions remain rejected. Existing approvals do not silently adopt
a changed environment. There are no new metadata mutation tools or permissions.

## Changes

- Optional private reviewed identity bindings, guarded by exact native ID/name.
- Separate eligibility, canonical identity, safe match terms and scene review holds.
- Explicit approval for fictional mascot/avatar, collective, shared-mantle and
  female-form categories. Real performer adult verification remains mandatory.
- Canonical collision checks across distinct bindings, preserving positive identity
  evidence and retaining ineligible/ignored states rather than masking them.
- Explicit short-identifier opt-in with whole-token matching.

The optional `identity-local-review.json` is **private installation data**, not a
public example or portable library. Its records must be audited against the target
installation. This package contains no user decisions, native inventory, per-scene
evidence or private registry. The generated public module has an empty local layer.
Do not copy a locally generated entrypoint into GitHub: it embeds private bindings.

## Apply and validate

1. Back up source, installed files and any private binding file outside active
   plugin directories. Preserve unrelated modifications.
2. From the owner parent directory, run `git apply --check --unidiff-zero owner.patch`,
   then apply the patch and copy `new/scene-auto-tagger` files into the owner source.
3. Retain a private binding file only after checking its provenance and current
   native IDs/names. Rebuild with `node build-ai-read.cjs` and run `--check`.
4. In a disposable public staging copy without private bindings, run
   `node --test tests/*.test.js` and the four existing verification scripts. Native
   IDs in public fixtures must not accidentally bind to a private installation.
5. Run local-policy fixture tests and compare all live bounded read results against
   the exact reviewed private bindings. Verify ignored preferences, name drift,
   duplicate guards, independent association holds and unchanged legacy taxonomy.
6. Deploy the owner files and matched Stash AI compatibility modules. Reload plugins
   and restart the companion normally. Never run a live tagging task as validation.
7. Verify hashes and preserved database/state snapshots. Restore the checkpoint if
   validation fails. A rebuild without the private file intentionally omits its
   decisions; recover that file from the private backup rather than guessing.

`public-source-hashes.json` describes the sanitized public build, not a private
deployment. Normalized-text patch reconstruction is tested across line endings.
Registry installation does not rename, create, merge, delete or assign native Tags.
Metadata migration requires exact separate previews and the applicable approvals.
