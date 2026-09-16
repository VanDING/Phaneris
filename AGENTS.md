# Repository collaboration defaults

## Git remotes

Standard fork layout, with one constraint:

- `origin` is this project: **https://github.com/VanDING/Phaneris**. The project is standalone and is no longer a GitHub fork, so `origin` means *our* repository — never the upstream one.
- `upstream` is the repository this project grew out of: `craft-ai-agents/craft-agents-oss`. Read it for upstream context and provenance; it is not a push target.
- `VanDING/craft-agents-rebuild` was the working remote before the project moved to its own repository. It is retired — do not fetch from it, and never push to it. Its former remote name `rebuild` no longer exists.
- A request that mentions the `main` branch without naming a remote means `origin/main`.
- Use SSH for all GitHub Git operations. Do not default to HTTPS.
- Both remotes are configured over SSH on port 443 (`ssh://git@ssh.github.com:443/<owner>/<repository>.git`), which is the verified connection method for this workspace when the standard SSH port is unavailable. The HTTPS URLs above are the canonical locations for links, clone instructions and documentation — the two forms are not interchangeable.

Note: a `pre-push` hook runs the full validation suite (`typecheck:all`, `lint`, the i18n gates, `identity:check`, `version:check`). A push therefore takes several minutes and fails loudly on a real regression — do not bypass it with `--no-verify`.

## Testing

- Run only the minimum number of tests necessary to validate the change. Prefer focused tests that directly cover the affected behavior; do not run the full test suite unless the change's scope or risk clearly requires it, or the user explicitly requests it.
