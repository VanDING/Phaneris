# Repository collaboration defaults

## Git remotes

- `rebuild` (`VanDING/Phaneris`) is this project's working repository. The project is standalone and is no longer a GitHub fork.
- `VanDING/craft-agents-rebuild` is the former working repository: a fork of the upstream project, kept for historical reference only and never a push target.
- When a request mentions the remote `main` branch without naming a remote, interpret it as `rebuild/main`.
- `origin` (`craft-ai-agents/craft-agents-oss`) is the upstream repository. Only use `origin/main` when the request explicitly says upstream or names `origin`.
- Use SSH for all GitHub Git operations. Do not default to HTTPS.
- In environments where the standard SSH port is unavailable, use GitHub SSH over port 443 (`ssh://git@ssh.github.com:443/<owner>/<repository>.git`), which is the verified connection method for this workspace.

## Testing

- Run only the minimum number of tests necessary to validate the change. Prefer focused tests that directly cover the affected behavior; do not run the full test suite unless the change's scope or risk clearly requires it, or the user explicitly requests it.
