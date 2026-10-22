# Scene Auto-Tagger 0.9.25 integration

This focused owner update adds female identity eligibility to automatic native
scene Tag writes. Stash AI remains 0.11.2 with exact owner compatibility extended
to 0.9.25. It does not grant new cleanup or metadata mutation authority.

The owner delta is against the customized 0.9.24 source, including its existing
Character read and Descriptor transaction modules. It is not an installer for
unrelated upstream releases. Preserve the target checkout and configuration first.
From its parent directory, inspect `git apply --check --unidiff-zero owner.patch`.
Apply with `git apply --unidiff-zero owner.patch`, then copy the files beneath
`new/scene-auto-tagger/` into the owner source. Rebuild using
`node build-ai-read.cjs` and verify with `node build-ai-read.cjs --check`.
Run `node --test tests/*.test.js` and the existing verification scripts before
deploying the generated runtime and manifest. `source-hashes.json` records the
validated owner files. No private Git history or production state is included.

The initial reviewed registry covers only the policy's explicit examples. Unknown
identities and unknown gender fail closed. This deliberately reduces automatic
assignment coverage until more identity records are reviewed. There are no real
performer records yet. Existing Tags are preserved, including unresolved and
ineligible assignments. A separate approved cleanup is still required to remove any.

See `new/scene-auto-tagger/IDENTITY-POLICY.md` for the authority, scene-evidence
requirements, name matching, bounded read API, and remaining limitations.

Validation completed: 30 policy tests, 9 legacy owner assertions, four owner
verification scripts, generated-runtime parity, two legacy owner-contract tests,
and 554 Stash AI tests. Installed Stash read-only checks confirmed eligibility,
unchanged Character read semantics and cleanup environment compatibility. All
66 database table digests and 19 protected companion state files were unchanged.
An embedded-engine Unicode normalization mismatch was caught during live
validation, rolled back, corrected, and retested before successful deployment.

Existing cleanup manifests retain their original owner/environment fingerprints.
The new allowlist permits preparation under the new owner; it does not rewrite
historical plans or allow an old plan to bypass environment-drift checks.
