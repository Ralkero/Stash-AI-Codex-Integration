# Stash AI Command Center

Stash AI is a local companion and Stash UI plugin that connects a customized
Stash installation to the signed-in Codex desktop runtime. It provides a native
chat-first interface for read-only library exploration, rich scene results,
guided review, and narrowly bounded metadata proposals that require explicit
approval in Stash before any write.

Current tracked release: **0.11.2**.

Audited owner integration: [Scene Auto-Tagger 0.9.26 verified identity registry](docs/identity-registry-0.9.26.md). This expands source-backed identity records without changing existing scene tags or approval rules.

> This repository tracks a customized, installation-specific project. It is not
> an official Stash or OpenAI product. Review the compatibility checks before
> using it with a different Stash build or plugin ecosystem.

## Privacy and safety

- Video frames, filenames, scene metadata, and chat context stay local.
- No analytics, telemetry, cloud relay, or third-party metadata service is used.
- The browser connects only to the loopback companion.
- Pairing uses a short-lived one-use code and stores only token hashes in the
  companion state.
- Model tools cannot approve their own changes. Metadata writes use immutable
  previews and explicit authenticated UI approval.
- Runtime state, credentials, private conversations, production manifests,
  database backups, library screenshots, and validation evidence are excluded
  from this public repository.

Read [SECURITY.md](SECURITY.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before
deployment.

## Requirements

- Windows
- Node.js 22 or newer
- Stash `v0.31.1-native-audio.12` with hash `navigation-lifecycle-v12`
- Codex desktop app with an authenticated local App Server runtime
- The companion plugin versions listed in `service/tag-cleanup-adapter.mjs` for
  guarded bulk-maintenance features

Compatibility checks fail closed when the tested Stash or owner-plugin contract
does not match. The ordinary read-only chat surface remains separate from guarded
cleanup workflows.

## Fresh installation

```powershell
git clone https://github.com/Ralkero/Stash-AI-Codex-Integration.git
Set-Location Stash-AI-Codex-Integration
npm ci
npm test
npm run check
.\windows\Install.ps1 -EnableStartup
```

The installer intentionally refuses to overwrite an existing installation. Back
up and validate an existing deployment before updating it.

After installation:

1. Run `%LOCALAPPDATA%\StashAICommandCenter\app\windows\Pair.ps1`.
2. Open `/plugins/stash-ai` in Stash.
3. Enter the one-use pairing code within 15 minutes.

The companion listens on `127.0.0.1:9998`; Stash remains responsible for its own
native playback, library database, and media files.

## Development

```powershell
npm ci
npm test
npm run check
```

The project has no frontend build step. The UI reuses Stash's React runtime,
theme classes, and plugin API. The only runtime npm dependency is `ws`.

Repository layout:

- `plugin/` — Stash UI, toolbar entry, rich results, approval cards, and styles.
- `service/` — loopback companion, Codex runtime bridge, bounded Stash adapters,
  policy, persistence, and approval state machines.
- `windows/` — installation, startup, pairing, and stop helpers.
- `tests/` — isolated unit, contract, lifecycle, security, and UI fixtures.
- `scripts/` — reusable syntax, pairing, runtime, isolation, and security checks.
- `ARCHITECTURE.md`, `SECURITY.md`, and the focused contract documents — design
  and maintenance reference.

## Important boundaries

- This repository does not include Stash databases, source media, thumbnails,
  private Codex homes, service state, or production approval journals.
- Scene Auto-Tagger is a separately owned plugin and is not bundled here.
- Bulk cleanup is restricted to tested owner/native contracts and explicit exact
  manifests. Unknown classification is never automatic deletion evidence.
- Global Tag recovery is an operator-specific procedure. Private backup paths,
  hashes, and production manifests belong outside source control.

## License

No open-source license has been granted yet. The repository is public for source
tracking and review; normal copyright protections apply unless a license is added.
