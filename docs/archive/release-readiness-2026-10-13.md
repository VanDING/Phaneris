# Release readiness checklist

> 归档裁定（2026-10-13）：historical。本文保留原规划、研究与当时证据，已退出独立实施队列；保留、条件触发和关闭事项以[当前价值裁定与执行队列](../process/implementation-value-register-2026-10-13.md)为准。正文中的旧状态、版本、路径与工期按历史口径阅读。

Status: proposed release gate; artifact facts reviewed 2026-10-13. External ownership/signing entries require maintainer decisions and credentials.

This checklist tracks the trust chain that must be complete before binaries are distributed outside the development team. Code-verifiable items should run in CI; the remaining items are manual release-owner decisions.

## Code and data integrity

- [x] Workspace backup/verify/restore commands with SHA-256 manifest (`bun run workspace:backup|verify|restore`).
- [x] Credential encryption key can come from Electron safeStorage or `PHANERIS_CREDENTIAL_KEY` instead of the machine-id fallback.
- [x] Remote connections verify TLS by default; per-workspace `allowInsecureTls` is an explicit opt-in.
- [x] Dependency audit is a CI gate with a checked-in known-advisory baseline.
- [ ] Workspace backup/restore exercised against a real desktop workspace in CI or a release rehearsal.
- [x] `remoteServer.token` moves into the encrypted credential vault on startup (workspace-scoped `remote_server_token`) and is never written back to `config.json`. Migration is one-way; release rehearsal should verify the upgrade path and document that rolling back to a pre-vault build requires re-entering remote tokens.
- [ ] Recovery drill: kill the app/server after T1 but before T2, verify the operation parks as unknown and is visible in Run.

## Branding and update chain

Phaneris uses its independent product identity; external release ownership still requires verification:

- [x] independent product name and bundle/application id: `Phaneris`, `io.github.vanding.phaneris` (identity manifest and generated packaging metadata).
- [ ] owned update feed domain and release bucket;
- [ ] owned support, security, and documentation URLs;
- [ ] signing certificate / notarization identity per platform;
- [ ] release notes and rollback policy.

Code identity and publisher metadata are independent. All optional service URLs are currently null, with no upstream fallback; owned service deployment and platform signing remain release-owner work. Public distribution still requires the unchecked gates below. Current adjudication: [governance completion ledger](../process/governance-completion-2026-10-11.md).

## Artifact verification

- [x] electron-builder file filters verified with `--dir` and by full local packages: one Pi bundle copy, no node-pty debug symbols; unpacked 581 MB, `resources/app` 206 MB.
- [ ] `bun run electron:dist:<platform>` completes on a **clean** machine and the NSIS/DMG/AppImage installer size is recorded. Local packaging already completes and the sizes are recorded — macOS x64 DMG 219,963,694 B / ZIP 213,469,327 B (2026-10-13, unsigned) and Windows x64 NSIS 193,813,199 B (2026-10-12, unsigned) — but both ran on a development machine, not a clean one.
- [ ] `bun run release:checksums` writes `SHA256SUMS` and `release-manifest.json`.
- [ ] Installer signature verifies with the platform tool (`signtool verify`, `codesign --verify`, `gpg --verify`).
- [ ] Checksum manifest is published next to the installer.
- [ ] SBOM/provenance generation is wired to the release job.
- [ ] Install, upgrade, and rollback are tested on the three supported platforms.
- [ ] Uninstall leaves user data intact and re-install finds the existing profile.

## Privacy

- [x] Crash reporting defaults to disabled (`services.telemetry.enabled = false`, DSN null in the identity manifest); opt-in requires explicit configuration. Runtime/packaging verification remains part of release rehearsal.
- [ ] A user-visible telemetry description and local diagnostic export exist.
- [ ] No provider tokens or workspace content are present in release artifacts or logs.
