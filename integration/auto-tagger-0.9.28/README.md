# Scene Auto-Tagger 0.9.28 — native definition creation guard

This incremental owner patch targets the audited 0.9.27 source. Stash AI remains
0.12.0; its exact owner-version lists additionally accept this audited release.
No protocol, metadata authority, approval or executor scope is expanded.

## Reproduced defect and correction

The legacy image-folder job could create native Franchise Tag definitions from
directory names even though normal scene jobs require existing eligible identity
Tags. An isolated synthetic apply fixture reproduced `tagCreate` followed by
`imageUpdate`. This is a definition-creation pathway, not a scene-guard bypass.

The job now looks up existing definitions only. Missing definitions are counted
as `blockedCreation` in preview and apply, never as `wouldUpdate`. The legacy
creation helper and final owner GraphQL transport both reject automatic
`tagCreate`. Existing image assignments, native aliases, saved preferences,
private identity bindings and learned corrections are not rewritten.

The legacy image task still assigns **existing** Tags to images. It neither
creates definitions nor assigns scene Tags. No broader image taxonomy migration
is included.

## Application

Back up source and deployment outside active plugin directories. Preserve any
private `identity-local-review.json` independently; it is intentionally absent
from this package. From the directory containing `scene-auto-tagger/`:

```powershell
git apply --check --unidiff-zero path/to/owner.patch
git apply --unidiff-zero path/to/owner.patch
```

Copy `new/scene-auto-tagger/tests/` into the corresponding owner test directory,
then run `node build-ai-read.cjs`, `node build-ai-read.cjs --check`, and the tests.
The build embeds the existing local review file when present. Public hash values
describe the sanitized build with an empty private layer, not a private runtime.
Verify patch reconstruction and owner/companion compatibility before deployment.
Deploy matching generated/source files and reload plugins. Restart the companion
only when deploying its four changed compatibility modules.

## Verification and limits

- Synthetic regressions cover missing-definition preview/apply, direct helper
  and transport rejection, and unchanged existing-image assignment.
- Actual effective-alias construction, normal scene dry-run and learned repair
  preview/apply exercise the independent scene write guard.
- 117 owner tests and 632 companion tests passed at release preparation, along
  with related owner suites. Unreviewed future owner versions remain rejected.
- Public before/after patch reconstruction is tested; no private library evidence
  or local binding record is included.
- This is not a global GraphQL write interceptor. Native Stash auto-tagging,
  manual operations and other plugins remain outside the owner guard. Native
  alias correction requires separate authorization. Removing an old assignment
  does not by itself establish permanent recurrence prevention.

The offline audit helpers in `scripts/lib/character-audit.mjs` provide bounded
inventory validation, snapshot drift checks, relationship reconciliation,
historical-evidence checks, completed-removal exclusion and output escaping.
They have no I/O, credentials, owner calls or metadata mutation capability.
