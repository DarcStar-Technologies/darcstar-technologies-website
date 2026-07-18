# Developer Guide

## Git hooks (actionlint + commitlint)

This repo uses [pre-commit](https://pre-commit.com) to run two linters as git hooks (config: `.pre-commit-config.yaml`):

| Hook                                              | Stage        | What it does                                                                                          |
| ------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| [actionlint](https://github.com/rhysd/actionlint) | `pre-commit` | Lints GitHub Actions workflow files (`.github/workflows/*.yml`)                                       |
| [commitlint](https://commitlint.js.org)           | `commit-msg` | Enforces [Conventional Commits](https://www.conventionalcommits.org) (config: `commitlint.config.js`) |

The same two linters also run in CI on push/PR — see `.github/workflows/actionlint.yml` and `.github/workflows/commitlint.yml` — so they are enforced even for contributors who haven't installed the hooks locally.

### One-time local setup

The hooks are **not** auto-installed. Each contributor activates them once per clone:

```sh
# pre-commit itself — this repo standardizes CLI tools on `uv tool` (like ruff, poetry, hatch)
uv tool install pre-commit --python 3.14

# install BOTH hook types into .git/hooks (pre-commit + commit-msg)
pre-commit install
```

`pre-commit install` reads `default_install_hook_types` from `.pre-commit-config.yaml`, so a single command wires up both the `pre-commit` and `commit-msg` hooks. The first commit afterward will build the hook toolchains (a Go build for actionlint, a Node env for commitlint); this is cached and only happens once.

> Don't have `uv`? See https://docs.astral.sh/uv/. Any pre-commit install works (`pipx install pre-commit`, etc.) — `uv tool` is just this project's convention.

### Commit message format

Commits must follow Conventional Commits, e.g.:

```
feat: add contact form
fix: correct locale redirect on /es
ci: pin actionlint action to v2
chore: bump dependencies
```

Non-conforming messages (e.g. `WIP`, `update stuff`) are rejected by the `commit-msg` hook. To relax or customize rules, edit `commitlint.config.js`.

### Running the linters manually

```sh
pre-commit run --all-files          # run pre-commit-stage hooks (actionlint) over the repo
pre-commit run actionlint --all-files
pre-commit autoupdate               # bump the pinned hook revs in .pre-commit-config.yaml
```
