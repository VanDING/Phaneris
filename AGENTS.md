# Repository collaboration defaults

## Git remotes

This is a standalone repository, not a GitHub fork:

- `origin` is this project: **https://github.com/VanDING/Phaneris**. It is our repository and the only push target.
- `upstream` is the source repository this project grew out of: `craft-ai-agents/craft-agents-oss`. Read it for upstream context and provenance; never push to it.
- A request that mentions the `main` branch without naming a remote means `origin/main`.
- Use SSH for all GitHub Git operations. Do not default to HTTPS.
- Both configured remotes use SSH on port 443 (`ssh://git@ssh.github.com:443/<owner>/<repository>.git`), the verified connection method for this workspace. Use the HTTPS repository URL for links and documentation; SSH and HTTPS serve different purposes here.

Note: a `pre-push` hook runs the full validation suite (`typecheck:all`, `lint`, the i18n gates, `identity:check`, `version:check`). A push therefore takes several minutes and fails loudly on a real regression — do not bypass it with `--no-verify`.

## Testing

- NEVER write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code.
