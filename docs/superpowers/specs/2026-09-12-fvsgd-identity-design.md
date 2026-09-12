# Design: fvsgd fork identity and side-by-side installs

**Date:** 2026-09-12
**Status:** Design approved in conversation; spec awaiting review
**Sub-project:** 1 of 2. Implement before `2026-09-12-fvsgd-build-design.md`.

---

## Summary

This repository (VibeClaw, a fork of Get Shit Done that exposes its commands as `vgsd`) becomes a new fork named **fvsgd**. fvsgd must install next to upstream GSD and vgsd, in every supported runtime, without modifying or deleting their files. All installed and user-visible names change to `fvsgd`. Project state in `.planning/` stays shared, so existing projects keep working.

---

## Problem

The `vgsd` rename changed command names only.

- **No single source for names.** `vgsd` appears about 5,700 times across 387 files. The only named constants are `SMART_BRANCH_PREFIX = 'vgsd/'` in `get-shit-done/bin/lib/execution-branch.cjs` and `SURFACE_FILE_NAME = '.vgsd-surface.json'` in `get-shit-done/bin/lib/surface.cjs`.
- **Shared names still collide with upstream GSD.** These include:
  - the install folder `<config>/get-shit-done/`
  - `gsd-*` agents and hooks
  - `gsd-file-manifest.json`, `gsd-local-patches/`, `.gsd-profile` and `.gsd-source`
  - the npm package `get-shit-done-cc` and its bins (`get-shit-done-cc`, `gsd-sdk`, `gsd-tools`, `vibe`)
  - the update check (`~/.cache/gsd/gsd-update-check.json`, package `get-shit-done-cc`)
  - the CLAUDE.md markers (`<!-- GSD:profile-start -->`)
  - `GSD_*` environment variables

  VibeClaw state (`.planning-vibe/`, `.vibe/worktrees/`) and execution branches (`vgsd/…`, `<git-common-dir>/vgsd/executions`) would also collide with a vgsd install used in the same repository.
- **The installer deletes other installs** (`bin/install.js`):
  - `_runLegacyInstallMigrations` runs on every install and removes `commands/gsd/`, `skills/gsd-<cmd>/`, the Hermes `skills/gsd/` folder and `command/gsd-*.md`.
  - A local Claude Code install removes every `skills/(vgsd|gsd)-*` folder, and Codex rollback matches the same pattern.
  - Install and uninstall delete every `gsd-*` agent, and Codex `[agents.gsd-*]` sections are stripped from `config.toml`.
  - Hook registration in `settings.json` uses substring checks such as `includes('gsd-check-update')`. A second install therefore finds the first install's entry and skips registering its own.
- **Update replaces the fork.** `get-shit-done/workflows/update.md` installs `get-shit-done-cc@latest` from npm, which is upstream GSD.
- **Leftover bugs from the vgsd rename:**
  - `sdk/src/query/query-unknown-command-hints.ts` names a non-existent `vgsd-tools.cjs`.
  - The hooks `gsd-statusline.js`, `gsd-update-banner.js`, `gsd-workflow-guard.js`, `gsd-context-monitor.js` and `gsd-session-state.sh` still tell users to run `/gsd:update`.

Checked on 2026-09-12: upstream GSD 1.42.3 is installed on the maintainer's machine in `~/.claude`, `~/.codex`, `~/.gemini` and `~/.config/opencode`. Installing this repository as it is today would overwrite or delete it.

---

## Scope

**In scope:**
- One identity module that all code uses for names.
- A rename script, kept in the repository, that rewrites prompt, doc and test text and renames files.
- Installer ownership rules: fvsgd only writes and deletes files it owns.
- An update flow that pulls the local clone instead of installing from npm.
- Fixing the two leftover bugs above.
- Tests that prove coexistence.

**Out of scope:**
- Publishing fvsgd to npm.
- Renaming the internal source folders `get-shit-done/` and `commands/gsd/`.
- Rewriting historical `CHANGELOG.md`, `docs/RELEASE-*.md` and `.changeset/` entries.
- Migrating an existing gsd or vgsd install to fvsgd.
- The build workflow (sub-project 2).

---

## Names

| Item | Today | fvsgd |
|---|---|---|
| Command shapes | `/vgsd-x`, `/vgsd:x`, `$vgsd-x`; `commands/vgsd/`, `skills/vgsd-x/`, `command/vgsd-x.md` | `/fvsgd-x`, `/fvsgd:x`, `$fvsgd-x`; `commands/fvsgd/`, `skills/fvsgd-x/`, `command/fvsgd-x.md` |
| Command frontmatter | `name: vgsd:<cmd>` | `name: fvsgd:<cmd>` |
| Install folder per runtime | `<config>/get-shit-done/` | `<config>/fvsgd/` |
| Agent files and names | `gsd-<role>.md`, `name: gsd-<role>` | `fvsgd-<role>.md`, `name: fvsgd-<role>` |
| Codex agent sections | `[agents.gsd-<role>]` | `[agents.fvsgd-<role>]` |
| Hook files | `gsd-<hook>.js`, `gsd-<hook>.sh` | `fvsgd-<hook>.js`, `fvsgd-<hook>.sh` |
| Tools script in the install folder | `bin/gsd-tools.cjs` | `bin/fvsgd-tools.cjs` |
| Manifest | `gsd-file-manifest.json` | `fvsgd-file-manifest.json` |
| Local patches | `gsd-local-patches/` | `fvsgd-local-patches/` |
| Profile and source markers | `.gsd-profile`, `.gsd-source` | `.fvsgd-profile`, `.fvsgd-source` |
| Surface file | `.vgsd-surface.json` | `.fvsgd-surface.json` |
| npm package | `get-shit-done-cc` | `fvsgd`, with `"private": true` |
| Bins | `get-shit-done-cc`, `gsd-sdk`, `gsd-tools`, `vibe` | `fvsgd`, `fvsgd-sdk`, `fvsgd-tools`, `fvsgd-vibe` |
| SDK package | `@gsd-build/sdk` | `@fvsgd/sdk` |
| Execution branches | `vgsd/<runtime>/<cmd>/<id>`, `<git-common-dir>/vgsd/executions` | `fvsgd/<runtime>/<cmd>/<id>`, `<git-common-dir>/fvsgd/executions` |
| Guard placeholder | `__VGSD_RUNTIME__` | `__FVSGD_RUNTIME__` |
| VibeClaw state | `.planning-vibe/`, `.vibe/worktrees/` | `.planning-fvsgd-vibe/`, `.fvsgd-vibe/worktrees/` |
| CLAUDE.md markers | `<!-- GSD:profile-start -->`, `<!-- GSD:profile-end -->` | `<!-- FVSGD:profile-start -->`, `<!-- FVSGD:profile-end -->` |
| Environment variables | `GSD_*` | `FVSGD_*` |
| Project state | `.planning/` | `.planning/` (shared, unchanged) |

---

## Architecture

### Identity module

`get-shit-done/bin/lib/identity.cjs` exports one frozen object:

```js
module.exports = Object.freeze({
  name: 'fvsgd',
  commandPrefix: 'fvsgd',
  installDir: 'fvsgd',
  agentPrefix: 'fvsgd-',
  hookPrefix: 'fvsgd-',
  toolsScript: 'fvsgd-tools.cjs',
  bins: Object.freeze({ installer: 'fvsgd', sdk: 'fvsgd-sdk', tools: 'fvsgd-tools', vibe: 'fvsgd-vibe' }),
  packageName: 'fvsgd',
  sdkPackageName: '@fvsgd/sdk',
  manifestFile: 'fvsgd-file-manifest.json',
  patchesDir: 'fvsgd-local-patches',
  profileFile: '.fvsgd-profile',
  sourceFile: '.fvsgd-source',
  surfaceFile: '.fvsgd-surface.json',
  branchPrefix: 'fvsgd/',
  executionsDir: 'fvsgd/executions',
  runtimePlaceholder: '__FVSGD_RUNTIME__',
  vibeStateDir: '.planning-fvsgd-vibe',
  vibeWorktreeRoot: '.fvsgd-vibe/worktrees',
  claudeMdMarker: 'FVSGD',
  envPrefix: 'FVSGD_',
});
```

- **SDK copy:** `scripts/gen-identity-ts.cjs` generates `sdk/src/identity.ts` from this module. `npm run check:identity-fresh` runs in `pretest`, following the pattern of the existing `check:*-fresh` scripts.
- **Consumers:** these read names from the module instead of literals:
  - `bin/install.js` and `bin/vibe.js`
  - in `get-shit-done/bin/lib/`: `runtime-slash.cjs`, `runtime-artifact-layout.cjs`, `runtime-homes.cjs`, `execution-branch.cjs`, `surface.cjs`, `profile-output.cjs`, and `core.cjs` (environment variables)
  - in `get-shit-done/bin/lib/vibe/`: `store.cjs`, `git.cjs`, `schemas.cjs`, `orchestrator.cjs`, `entry-router.cjs`
  - in `scripts/`: `sync-execution-branch-guards.cjs`, `fix-slash-commands.cjs`, `build-hooks.js`, `lint-command-contract.cjs`, `lint-skill-deps.cjs`, `gen-inventory-manifest.cjs`

### Rename script

`scripts/rename-identity.cjs` applies ordered rules from `scripts/identity-rename.map.json` and renames files with `git mv`.

**Rules**, in order. Every rule except rule 1 matches whole tokens only:

1. Every occurrence of `vgsd` → `fvsgd` and `VGSD` → `FVSGD`, including inside larger identifiers such as `__VGSD_RUNTIME__`. This is the only substring rule. It is safe because the string exists only because of this fork, and re-running is harmless because `fvsgd` does not contain `vgsd`.
2. Install paths under a runtime config directory → `…/fvsgd/`. This covers `~/.claude/get-shit-done/`, `$HOME/.claude/get-shit-done/`, `${HOME}/.claude/get-shit-done/` and the same forms for `.codex`, `.gemini` and `.config/opencode`. Repository-relative `get-shit-done/` source paths are not changed.
3. Agent names: every `gsd-<role>` whose file exists in `agents/` → `fvsgd-<role>`. The list comes from the directory, not a pattern.
4. Hook names: every `gsd-<hook>` whose file exists in `hooks/` → `fvsgd-<hook>`. The list comes from the directory.
5. Bins and packages:
   - `@gsd-build/sdk` → `@fvsgd/sdk`
   - `gsd-tools.cjs` → `fvsgd-tools.cjs`
   - `gsd-tools` → `fvsgd-tools`
   - `gsd-sdk` → `fvsgd-sdk`
   - `get-shit-done-cc` → `fvsgd`
6. Bookkeeping names: `gsd-file-manifest.json`, `gsd-local-patches`, `.gsd-profile`, `.gsd-source` → their fvsgd names.
7. VibeClaw paths:
   - `.planning-vibe` → `.planning-fvsgd-vibe`
   - `.vibe/worktrees` → `.fvsgd-vibe/worktrees`
   - `/.vibe/` in `.gitignore` → `/.fvsgd-vibe/`
8. `GSD:profile-start` and `GSD:profile-end` → `FVSGD:profile-start` and `FVSGD:profile-end`.
9. Environment variables: `GSD_[A-Z0-9_]+` → `FVSGD_` plus the same suffix.

**File renames:**
- `agents/gsd-*.md` → `agents/fvsgd-*.md`
- `hooks/gsd-*` → `hooks/fvsgd-*`
- `get-shit-done/bin/gsd-tools.cjs` → `get-shit-done/bin/fvsgd-tools.cjs`
- `bin/gsd-sdk.js` → `bin/fvsgd-sdk.js`
- every tracked file whose name contains `vgsd` → the same name with `fvsgd`

**Exclusions:** `CHANGELOG.md`, `docs/RELEASE-*.md`, `.changeset/**`, `docs/superpowers/specs/**`, `node_modules/**`, `sdk/node_modules/**`, `sdk/dist/**`, `hooks/dist/**` and `.git/**`. Generated outputs are rebuilt from source, never rewritten.

**Behavior:**
- `--dry-run` prints a JSON report without writing: files and replacement counts per rule, plus the planned renames.
- A normal run writes the changes and prints the same report.
- A second run reports zero changes.

### Installer ownership

- **Writes:** every file fvsgd installs is recorded, with its hash, in `fvsgd-file-manifest.json`.
- **Reinstall and uninstall:** only files listed in fvsgd's previous manifest are deleted, plus any folders fvsgd created that end up empty. User-modified files are backed up to `fvsgd-local-patches/`, as today.
- **Removed migrations:** delete the branches of `_runLegacyInstallMigrations`, and the local-install cleanup, that remove `commands/gsd/`, `skills/gsd-*`, `skills/vgsd-*`, the Hermes `skills/gsd/` folder, `command/gsd-*.md` or `gsd-*` agents, or that strip Codex `[agents.gsd-*]` sections. fvsgd has no legacy layout of its own, so nothing replaces them.
- **settings.json:** an fvsgd hook entry is identified by an exact command path under `<config>/hooks/fvsgd-`. Entries that don't match are never modified and never cause registration to be skipped.
- **Codex config.toml:** only `[agents.fvsgd-*]` sections and the fvsgd-marked managed SessionStart block are written or removed.
- **OpenCode permissions:** keys are matched on the `fvsgd` install path.
- **Statusline:** installed only when the runtime has no statusline configured, or when `--statusline` is passed. Uninstall removes it only if it is fvsgd's.

### Updates

- **npm update check removed.** `hooks/gsd-check-update.js`, `hooks/gsd-check-update-worker.js`, `hooks/gsd-update-banner.js` and `get-shit-done/bin/check-latest-version.cjs` are deleted, along with their SessionStart registrations and tests. The statusline no longer shows update notices.
- **Source record.** The installer writes `.fvsgd-source` into each install folder:

  ```json
  { "repo": "/abs/path/to/clone", "remote": "<origin url>", "commit": "<sha>", "runtimes": ["claude"], "scope": "global" }
  ```

- **`/fvsgd-update`** (a rewrite of `get-shit-done/workflows/update.md`):
  1. Reads `.fvsgd-source`.
  2. Runs `git -C <repo> pull --ff-only`.
  3. Runs `npm install` in the repository, which rebuilds the SDK.
  4. Re-runs `node <repo>/bin/install.js` with the recorded runtimes and scope.
  5. Lists the commits pulled.

  If `.fvsgd-source` is missing or its repository path no longer exists, it prints the manual steps instead.

### Leftover bug fixes

- `query-unknown-command-hints.ts` takes the tools script name from the identity module.
- Hook messages build command names with `runtime-slash.cjs` when hooks are built, instead of the literal `/gsd:update`.

### Package metadata

- `package.json`: name `fvsgd`, `"private": true`, bins as in the Names table, and `repository`, `homepage` and `bugs` pointing at this repository's `origin` remote.
- `sdk/package.json`: name `@fvsgd/sdk`, bin `fvsgd-sdk`.
- `.github/workflows/release.yml`: the npm publish step is removed.
- `README.md`: a short "fvsgd" section explaining that it coexists with gsd and vgsd.

---

## Testing

Root tests use `node:test`. Assertions compare parsed JSON or TOML structures and file hashes, never substrings.

- **`tests/fvsgd-coexistence.test.cjs`** is written first and fails before the change. For every runtime in `runtime-artifact-layout.cjs`:
  1. Create a temporary home. Seed a fake upstream GSD install and a fake vgsd install: commands or skills, agents, hooks, manifest, `settings.json` hook entries and statusline, and Codex `config.toml` agent sections and SessionStart block.
  2. Record a hash of every seeded file, plus the parsed seeded settings and config entries.
  3. Install fvsgd. Assert that every seeded file's hash is unchanged, that the seeded settings and config entries are still present and equal, and that fvsgd's files and entries exist.
  4. Uninstall fvsgd. Assert that the home matches the seeded snapshot exactly.
- **`tests/identity.test.cjs`:** the slash formatter, artifact layout, execution-branch helper and VibeClaw store return names equal to those derived from the identity module.
- **`tests/rename-identity-script.test.cjs`:** runs the script on a temporary fixture tree. It asserts that the JSON report counts match, excluded files are untouched and renamed files exist, and that a second run reports zero changes.
- **Updated suites:**
  - `tests/vgsd-command-namespace.test.cjs` becomes `tests/fvsgd-command-namespace.test.cjs`. Agents are now `fvsgd-`, and reinstall removes only fvsgd-owned paths.
  - The install, runtime-conversion and docs-parity suites are updated for the rename.
- **Generated files and checks:**
  - `docs/INVENTORY.md` and `docs/INVENTORY-MANIFEST.json` are regenerated.
  - These must pass: `npm run check:execution-branch-guards`, `npm run check:identity-fresh`, `npm test`, and `cd sdk && npm test`.
- **Manual acceptance** (needs the maintainer's approval at that point):
  1. Install fvsgd globally for Claude Code, Codex, Gemini and OpenCode.
  2. Re-hash every file listed in each runtime's GSD 1.42.3 `gsd-file-manifest.json` and confirm nothing changed.
  3. Confirm `/fvsgd-help` is available and `/gsd-help` still works.

---

## Implementation order

1. Write the coexistence test (red).
2. Add the identity module and switch code consumers to it.
3. Add the rename script, run it, and regenerate generated files.
4. Apply the installer ownership rules and remove the destructive migrations (coexistence test green).
5. Replace the npm update check with the clone-based update flow.
6. Fix the leftover bugs, update package metadata and the README section, and add a changeset entry.
7. Get the full suites green, then run manual acceptance.

---

## Risks

- **Over-eager replacement.** Examples: GitHub URLs under the `gsd-build` organization, or the `gsd2-import` command. Mitigations: every rule except the fork-unique `vgsd` rule matches whole tokens, agent and hook names come from explicit directory lists, and the dry-run report is reviewed before writing.
- **Silent breakage of another install's `settings.json` or `config.toml`.** Covered by the coexistence test for every runtime layout.
- **Stale generated files** (`hooks/dist`, `sdk/dist`, inventories). They are regenerated from source and never rewritten by the script.
- **Harder merges from upstream GSD or vgsd.** Accepted. After a merge, the rename script can be re-run to rename the incoming text.
