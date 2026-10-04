# Repository collaboration defaults

## Git remotes

This is a standalone repository, not a GitHub fork:

- `origin` is this project: **https://github.com/VanDING/Phaneris**. It is our repository and the only push target.
- `upstream` is the source repository this project grew out of: `craft-ai-agents/craft-agents-oss`. Read it for upstream context and provenance; never push to it.
- A request that mentions the `main` branch without naming a remote means `origin/main`.
- Use SSH for all GitHub Git operations. Do not default to HTTPS.
- Both configured remotes use SSH on port 443 (`ssh://git@ssh.github.com:443/<owner>/<repository>.git`), the verified connection method for this workspace. Use the HTTPS repository URL for links and documentation; SSH and HTTPS serve different purposes here.

Note: a `pre-push` hook runs the full validation suite (`typecheck:all`, `lint`, the i18n gates, `identity:check`, `version:check`). A push therefore takes several minutes and fails loudly on a real regression — do not bypass it with `--no-verify`.

## Tags

Upstream and Phaneris both release under the same `v0.x` numbering, so their tags collide in the shared `refs/tags/` namespace (e.g. upstream `v0.3.0` — a 2026-01 upstream build — versus our `v0.3.0`, `chore(release): prepare Phaneris 0.3.0`). Keep the two sets apart:

- `refs/tags/*` holds **Phaneris (origin) release tags only**. `git tag` therefore lists our releases and nothing else.
- `refs/upstream-tags/*` holds **every upstream tag**, mirrored one-to-one from `upstream`.
- Consequence: `git push --tags origin` can only ever publish our own tags. Never let upstream tags land in `refs/tags/` — an accidental `git push --tags` would otherwise pollute our public repository.

This is enforced by local `remote.upstream` config (re-apply it on a fresh clone):

```sh
git config remote.upstream.tagOpt --no-tags
git config --add remote.upstream.fetch '+refs/tags/*:refs/upstream-tags/*'
git fetch upstream
```

Sync with `git fetch --all --prune`. Do **not** pass `--tags`: that flag overrides `tagOpt` and refetches every upstream tag back into `refs/tags/` (a negative refspec cannot prevent this — it would also disable the namespaced mapping). If it happens, re-home the leaked tags — objects are identical, so nothing is lost:

```sh
git ls-remote --tags --refs origin | sed 's#.*refs/tags/##' | sort > /tmp/phaneris-tags
git for-each-ref --format='%(refname:strip=2) %(objectname)' refs/upstream-tags/ \
  | while read -r name obj; do
      grep -qx "$name" /tmp/phaneris-tags && continue
      [ "$(git rev-parse -q --verify "refs/tags/$name" || true)" = "$obj" ] || continue
      git update-ref -d "refs/tags/$name"
    done
```

## Testing

- NEVER write unit tests after you write code.
- Highly prefer E2E tests as the sole testing mechanism. Use them to verify complex features work. At the end of E2E tests, produce a verifiable and repeatable artifact.
- If you must test a system in isolation, FIRST write all the ways it could fail, THEN write the code.
