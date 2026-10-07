# Notes for AI assistants working in this repository

## Git

- Identity is local to this repository: `andrii-habchak <andrey.gabchak@gmail.com>`. Check with `git config --local --get user.email` before committing; never change the global git config.
- Push over SSH only, through the host alias: `origin = git@github-vigil:andrii-habchak/JSONPath-Lens.git`. Do not switch the remote to HTTPS or to `git@github.com:` (no key is registered for that host on this machine).
- Full instructions and troubleshooting: [docs/git-setup.md](docs/git-setup.md).
- `andrii-habchak <andrey.gabchak@gmail.com>` is the only author and committer. Do not add `Co-Authored-By`, session links or any other AI attribution to commit messages or pull requests.
- Commit or push only when asked. Prefer a branch + pull request for changes to `main`.

## Project

- Chrome MV3 extension built with WXT + Preact + TypeScript. See `README.md` (features, layout) and `INSTALL.md` (build and install).
- Before committing: `pnpm compile && pnpm lint && pnpm test`; for UI changes also `pnpm e2e`.
