# Design: fvgsd fork identity and side-by-side installs

**Date:** 2026-09-12
**Status:** Approved 2026-09-12; revised during planning (update check disabled instead of deleted, more collision surfaces covered)
**Sub-project:** 1 of 2. Implement before `2026-09-12-fvgsd-build-design.md`.

---

## Summary

This repository (VibeClaw, a fork of Get Shit Done that exposes its commands as `vgsd`) becomes a new fork named **fvgsd**. fvgsd must install next to upstream GSD and vgsd, in every supported runtime, without modifying or deleting their files. All installed and user-visible names change to `fvgsd`. Project state in `.planning/` stays shared, so existing projects keep working.

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
- **More shared surfaces found during planning:**
  - Bookkeeping: `gsd-pristine/`, `gsd-install-state.json`, `gsd-install-migration.lock`, `gsd-migration-journal/`, and the update cache `~/.cache/gsd/gsd-update-check.json`.
  - The hook helpers `hooks/lib/git-cmd.js` and `hooks/lib/gsd-graphify-rebuild.sh` live in a folder every GSD-family install shares.
  - The installer-migrations baseline scan (`installer-migrations/000-first-time-baseline.cjs`) treats any `gsd-*` or `vgsd-*` file as a stale GSD artifact that it may offer to remove.
  - Managed hooks are recognised by file basename in `shell-command-projection.cjs`, including legacy aliases such as `gsd-update-check.js`.
  - In Codex `config.toml`, GSD's uninstall removes everything from its marker (`# GSD Agent Configuration — managed by get-shit-done installer`) to the end of the file. The `codex_hooks` feature flag is removed by whichever install recorded ownership of it.
  - `reapStaleTempFiles` in `core.cjs` deletes old temp files starting with `gsd-`, which other installs also create.

Checked on 2026-09-12: upstream GSD 1.42.3 is installed on the maintainer's machine in `~/.claude`, `~/.codex`, `~/.gemini` and `~/.config/opencode`. Installing this repository as it is today would overwrite or delete it.

---

## Scope

**In scope:**
- One identity module that all code uses for names.
- A rename script, kept in the repository, that rewrites prompt, doc and test text and renames files.
- Installer ownership rules: fvgsd only writes and deletes files it owns.
- An update flow that pulls the local clone instead of installing from npm, with the update-check hooks kept but disabled.
- Fixing the two leftover bugs above.
- Tests that prove coexistence.

**Out of scope:**
- Publishing fvgsd to npm.
- Renaming the internal source folders `get-shit-done/` and `commands/gsd/`.
- Rewriting historical `CHANGELOG.md`, `docs/RELEASE-*.md` and `.changeset/` entries.
- Migrating an existing gsd or vgsd install to fvgsd.
- Deleting the update-check hooks or the Codex hook setup. They stay, renamed and disabled, so no runtime's hook setup changes shape.
- The build workflow (sub-project 2).

---

## Names

| Item | Today | fvgsd |
|---|---|---|
| Command shapes | `/vgsd-x`, `/vgsd:x`, `$vgsd-x`; `commands/vgsd/`, `skills/vgsd-x/`, `command/vgsd-x.md` | `/fvgsd-x`, `/fvgsd:x`, `$fvgsd-x`; `commands/fvgsd/`, `skills/fvgsd-x/`, `command/fvgsd-x.md` |
| Command frontmatter | `name: vgsd:<cmd>` | `name: fvgsd:<cmd>` |
| Install folder per runtime | `<config>/get-shit-done/` | `<config>/fvgsd/` |
| Agent files and names | `gsd-<role>.md`, `name: gsd-<role>` | `fvgsd-<role>.md`, `name: fvgsd-<role>` |
| Codex agent sections | `[agents.gsd-<role>]` | `[agents.fvgsd-<role>]` |
| Hook files | `hooks/gsd-<hook>.js`, `hooks/gsd-<hook>.sh` | `hooks/fvgsd/<hook>.js`, `hooks/fvgsd/<hook>.sh`, with no name prefix (see Name safety) |
| Hook helpers | `hooks/lib/git-cmd.js`, `hooks/lib/gsd-graphify-rebuild.sh` | `hooks/fvgsd/lib/git-cmd.js`, `hooks/fvgsd/lib/graphify-rebuild.sh` |
| Tools script in the install folder | `bin/gsd-tools.cjs` | `bin/fvgsd-tools.cjs` |
| Manifest | `gsd-file-manifest.json` | `fvgsd-file-manifest.json` |
| Local patches | `gsd-local-patches/` | `fvgsd-local-patches/` |
| Profile and source markers | `.gsd-profile`, `.gsd-source` | `.fvgsd-profile`, `.fvgsd-source` |
| Surface file | `.vgsd-surface.json` | `.fvgsd-surface.json` |
| Pristine copies | `gsd-pristine/` | `fvgsd-pristine/` |
| Migration state | `gsd-install-state.json`, `gsd-install-migration.lock`, `gsd-migration-journal/` | `fvgsd-install-state.json`, `fvgsd-install-migration.lock`, `fvgsd-migration-journal/` |
| Update cache | `~/.cache/gsd/gsd-update-check.json` | `~/.cache/fvgsd/update-check.json` |
| Codex config marker | `# GSD Agent Configuration — managed by get-shit-done installer` | `# FVGSD Agent Configuration — managed by fvgsd installer` |
| Codex feature ownership comment | `# GSD codex_hooks ownership: ` | `# FVGSD codex_hooks ownership: ` |
| Temp file prefix | `gsd-` | `fvgsd-` |
| npm package | `get-shit-done-cc` | `fvgsd`, with `"private": true` |
| Bins | `get-shit-done-cc`, `gsd-sdk`, `gsd-tools`, `vibe` | `fvgsd`, `fvgsd-sdk`, `fvgsd-tools`, `fvgsd-vibe` |
| SDK package | `@gsd-build/sdk` | `@fvgsd/sdk` |
| Execution branches | `vgsd/<runtime>/<cmd>/<id>`, `<git-common-dir>/vgsd/executions` | `fvgsd/<runtime>/<cmd>/<id>`, `<git-common-dir>/fvgsd/executions` |
| Guard placeholder | `__VGSD_RUNTIME__` | `__FVGSD_RUNTIME__` |
| VibeClaw state | `.planning-vibe/`, `.vibe/worktrees/` | `.planning-fvgsd-vibe/`, `.fvgsd-vibe/worktrees/` |
| CLAUDE.md markers | `<!-- GSD:profile-start -->`, `<!-- GSD:profile-end -->` | `<!-- FVGSD:profile-start -->`, `<!-- FVGSD:profile-end -->` |
| Environment variables | `GSD_*` | `FVGSD_*` |
| Project state | `.planning/` | `.planning/` (shared, unchanged) |

---

## Architecture

### Identity module

`get-shit-done/bin/lib/identity.cjs` exports one frozen object:

```js
module.exports = Object.freeze({
  name: 'fvgsd',
  commandPrefix: 'fvgsd',
  installDir: 'fvgsd',
  agentPrefix: 'fvgsd-',
  hooksDir: 'fvgsd',
  toolsScript: 'fvgsd-tools.cjs',
  bins: Object.freeze({ installer: 'fvgsd', sdk: 'fvgsd-sdk', tools: 'fvgsd-tools', vibe: 'fvgsd-vibe' }),
  packageName: 'fvgsd',
  sdkPackageName: '@fvgsd/sdk',
  manifestFile: 'fvgsd-file-manifest.json',
  patchesDir: 'fvgsd-local-patches',
  profileFile: '.fvgsd-profile',
  sourceFile: '.fvgsd-source',
  surfaceFile: '.fvgsd-surface.json',
  pristineDir: 'fvgsd-pristine',
  installStateFile: 'fvgsd-install-state.json',
  migrationLockFile: 'fvgsd-install-migration.lock',
  migrationJournalDir: 'fvgsd-migration-journal',
  updateCacheDir: 'fvgsd',
  updateCacheFile: 'update-check.json',
  codexMarker: '# FVGSD Agent Configuration — managed by fvgsd installer',
  codexHooksOwnershipPrefix: '# FVGSD codex_hooks ownership: ',
  tempPrefix: 'fvgsd-',
  branchPrefix: 'fvgsd/',
  executionsDir: 'fvgsd/executions',
  runtimePlaceholder: '__FVGSD_RUNTIME__',
  vibeStateDir: '.planning-fvgsd-vibe',
  vibeWorktreeRoot: '.fvgsd-vibe/worktrees',
  claudeMdMarker: 'FVGSD',
  envPrefix: 'FVGSD_',
});
```

- **SDK copy:** `scripts/gen-identity-ts.cjs` generates `sdk/src/identity.ts` from this module. `npm run check:identity-fresh` runs in `pretest`, following the pattern of the existing `check:*-fresh` scripts.
- **Consumers:** these read names from the module instead of literals:
  - `bin/install.js` and `bin/vibe.js`
  - in `get-shit-done/bin/lib/`: `runtime-slash.cjs`, `runtime-artifact-layout.cjs`, `runtime-homes.cjs`, `execution-branch.cjs`, `surface.cjs`, `profile-output.cjs`, `init.cjs`, `shell-command-projection.cjs`, `installer-migrations.cjs`, `installer-migration-report.cjs`, `installer-migrations/000-first-time-baseline.cjs`, and `core.cjs` (environment variables and the temp-file reaper)
  - in `sdk/src/query/`: `skill-manifest.ts` and `profile-output.ts`
  - in `get-shit-done/bin/lib/vibe/`: `store.cjs`, `git.cjs`, `schemas.cjs`, `orchestrator.cjs`, `entry-router.cjs`
  - in `scripts/`: `sync-execution-branch-guards.cjs`, `fix-slash-commands.cjs`, `build-hooks.js`, `lint-command-contract.cjs`, `lint-skill-deps.cjs`, `gen-inventory-manifest.cjs`

### Name safety

`fvgsd` contains both `gsd` and `vgsd`, so installed names are chosen so the upstream GSD and vgsd installers can't mistake them for their own. Those installers (`bin/install.js` at 29f1b1a6, whose logic comes from upstream):

- **Prefix matches (safe):** files, skills, commands and agents are matched with `startsWith('gsd-')` or `startsWith('vgsd-')`, and Codex agent sections with `/^agents\.gsd-/`. Names starting `fvgsd-` never match.
- **Substring matches (unsafe):** hook entries in `settings.json` and the statusline are matched with checks such as `includes('gsd-context-monitor')`, `includes('gsd-prompt-guard')` and `includes('gsd-statusline')`, one per hook. A hook installed as `hooks/fvgsd-context-monitor.js` would match. A GSD or vgsd install would then skip registering its own hook, and its uninstall would remove fvgsd's entry.

Rules:
- Hooks and the statusline install as `<config>/hooks/fvgsd/<hook>.js` or `.sh`, with no name prefix. Their helpers install under `<config>/hooks/fvgsd/lib/`, never the shared `hooks/lib/`.
- No installed file name, hook command, statusline command, Codex section path or OpenCode permission key may contain a prefix or substring those installers use to find their own entries. The coexistence test enforces this.
- fvgsd's own matchers only claim entries under `hooks/fvgsd/`. The un-prefixed basenames (`statusline.js`, `context-monitor.js`) are generic, so a bare basename is never enough to treat a hook as fvgsd's.

### Rename script

`scripts/rename-identity.cjs` applies ordered rules from `scripts/identity-rename.map.json` and renames files with `git mv`.

**Rules**, in order. Every rule except rule 1 matches whole tokens only:

1. Every `vgsd` not already preceded by `f` → `fvgsd`, and every `VGSD` not preceded by `F` → `FVGSD`, including inside larger identifiers such as `__VGSD_RUNTIME__`. This is the only substring rule. The string exists only because of this fork, and the "not preceded by `f`" condition stops a re-run from turning `fvgsd` into `ffvgsd`.
2. Install paths under a runtime config directory → `…/fvgsd/`. This covers `~/.claude/get-shit-done/`, `$HOME/.claude/get-shit-done/`, `${HOME}/.claude/get-shit-done/` and the same forms for `.codex`, `.gemini` and `.config/opencode`. Repository-relative `get-shit-done/` source paths are not changed.
3. Agent names: every `gsd-<role>` whose file exists in `agents/` → `fvgsd-<role>`. The list comes from the directory, not a pattern.
4. Hook names: every `gsd-<hook>` whose file exists in `hooks/` → `fvgsd/<hook>`, so `~/.claude/hooks/gsd-context-monitor.js` becomes `~/.claude/hooks/fvgsd/context-monitor.js`. The helper `gsd-graphify-rebuild.sh` → `graphify-rebuild.sh`, and `hooks/lib/` → `hooks/fvgsd/lib/`. The list comes from the directory.
5. Bins and packages:
   - `@gsd-build/sdk` → `@fvgsd/sdk`
   - `gsd-tools.cjs` → `fvgsd-tools.cjs`
   - `gsd-tools` → `fvgsd-tools`
   - `gsd-sdk` → `fvgsd-sdk`
   - `get-shit-done-cc` → `fvgsd`
6. Bookkeeping names: `gsd-file-manifest.json`, `gsd-local-patches`, `gsd-pristine`, `gsd-install-state.json`, `gsd-install-migration.lock`, `gsd-migration-journal`, `.gsd-profile` and `.gsd-source` → the same names with `fvgsd` in place of `gsd`.
7. VibeClaw paths:
   - `.planning-vibe` → `.planning-fvgsd-vibe`
   - `.vibe/worktrees` → `.fvgsd-vibe/worktrees`
   - `/.vibe/` in `.gitignore` → `/.fvgsd-vibe/`
8. `GSD:profile-start` and `GSD:profile-end` → `FVGSD:profile-start` and `FVGSD:profile-end`.
9. Environment variables: `GSD_[A-Z0-9_]+` → `FVGSD_` plus the same suffix.

**File renames:**
- `agents/gsd-*.md` → `agents/fvgsd-*.md`
- `hooks/gsd-<hook>.js` and `hooks/gsd-<hook>.sh` → `hooks/fvgsd/<hook>.js` and `hooks/fvgsd/<hook>.sh`, and `hooks/lib/*` → `hooks/fvgsd/lib/*` (with `gsd-graphify-rebuild.sh` → `graphify-rebuild.sh`), so the source layout matches what gets installed
- `get-shit-done/bin/gsd-tools.cjs` → `get-shit-done/bin/fvgsd-tools.cjs`
- `bin/gsd-sdk.js` → `bin/fvgsd-sdk.js`
- every tracked file whose name contains `vgsd` → the same name with `fvgsd`

**Exclusions:** `CHANGELOG.md`, `docs/RELEASE-*.md`, `.changeset/**`, `docs/superpowers/specs/**`, `node_modules/**`, `sdk/node_modules/**`, `sdk/dist/**`, `hooks/dist/**` and `.git/**`. Generated outputs are rebuilt from source, never rewritten.

**Behavior:**
- `--dry-run` prints a JSON report without writing: files and replacement counts per rule, plus the planned renames.
- A normal run writes the changes and prints the same report.
- A second run reports zero changes.

### Installer ownership

- **Writes:** every file fvgsd installs is recorded, with its hash, in `fvgsd-file-manifest.json`.
- **Reinstall and uninstall:** only files listed in fvgsd's previous manifest are deleted, plus any folders fvgsd created that end up empty. User-modified files are backed up to `fvgsd-local-patches/`, as today.
- **Removed migrations:** delete the branches of `_runLegacyInstallMigrations`, and the local-install cleanup, that remove `commands/gsd/`, `skills/gsd-*`, `skills/vgsd-*`, the Hermes `skills/gsd/` folder, `command/gsd-*.md` or `gsd-*` agents, or that strip Codex `[agents.gsd-*]` sections. fvgsd has no legacy layout of its own, so nothing replaces them.
- **settings.json:** an fvgsd hook entry is identified by an exact command path under `<config>/hooks/fvgsd/`. Entries that don't match are never modified and never cause registration to be skipped.
- **Codex config.toml:**
  - fvgsd writes its marker and `[agents.fvgsd-*]` sections above any existing GSD or vgsd marker, because those installers remove everything from their marker to the end of the file.
  - fvgsd removes only its own marker, its ownership comment and its `[agents.fvgsd-*]` sections, never marker-to-end-of-file.
  - On uninstall, fvgsd leaves `codex_hooks` enabled whenever `config.toml` still contains another GSD-family marker or `hooks.json` still has a SessionStart hook that isn't fvgsd's.
- **Codex hooks.json:** a SessionStart hook is fvgsd's only if its command points under `<config>/hooks/fvgsd/`. Legacy basename aliases such as `gsd-update-check.js` are not recognised.
- **Managed hook matching:** `shell-command-projection.cjs` lists fvgsd hooks as `fvgsd/<hook>` paths, and every caller passes the config directory, so matches are scoped to `<config>/hooks/fvgsd/`.
- **Installer migrations:** the baseline scan and its report only consider fvgsd's own surfaces (`fvgsd/`, `commands/fvgsd/`, `skills/fvgsd-*`, `agents/fvgsd-*`, `hooks/fvgsd/`). Files named `gsd-*` or `vgsd-*` belong to another install and are never offered for removal.
- **Temp files:** fvgsd creates and reaps temp files with the `fvgsd-` prefix only.
- **OpenCode permissions:** keys are matched on the `fvgsd` install path.
- **Statusline:** installed only when the runtime has no statusline configured, or when `--statusline` is passed. Uninstall removes it only if it is fvgsd's.

### Updates

- **npm update check disabled, not deleted.**
  - The update hooks stay installed, renamed to `hooks/fvgsd/check-update.js`, `check-update-worker.js` and `update-banner.js`. Every runtime's hook setup, including Codex's SessionStart hook, keeps its current shape.
  - The worker no longer calls npm. It writes `latest: "unknown"` and `update_available: false` to `~/.cache/fvgsd/update-check.json`, and still reports stale hooks by comparing installed hook versions.
  - `get-shit-done/bin/check-latest-version.cjs` returns `{ "ok": false, "reason": "disabled" }` without calling npm.
- **Source record.** The installer writes `.fvgsd-source` into each install folder:

  ```json
  { "repo": "/abs/path/to/clone", "remote": "<origin url>", "commit": "<sha>", "runtimes": ["claude"], "scope": "global" }
  ```

- **`/fvgsd-update`** (a rewrite of `get-shit-done/workflows/update.md`):
  1. Reads `.fvgsd-source`.
  2. Runs `git -C <repo> pull --ff-only`.
  3. Runs `npm install` in the repository, which rebuilds the SDK.
  4. Re-runs `node <repo>/bin/install.js` with the recorded runtimes and scope.
  5. Lists the commits pulled.

  If `.fvgsd-source` is missing or its repository path no longer exists, it prints the manual steps instead.

### Leftover bug fixes

- `query-unknown-command-hints.ts` takes the tools script name from the identity module.
- Hook messages get command names from `runtime-slash.cjs` when the installer copies hooks (the runtime is known at that point), instead of literals such as `/gsd:update`, `/gsd:pause-work`, `/gsd:quick` and `/gsd-new-project`.

### Package metadata

- `package.json`: name `fvgsd`, `"private": true`, bins as in the Names table, and `repository`, `homepage` and `bugs` pointing at this repository's `origin` remote.
- `sdk/package.json`: name `@fvgsd/sdk`, bin `fvgsd-sdk`.
- `.github/workflows/release.yml`: the npm publish step is removed.
- `README.md`: a short "fvgsd" section explaining that it coexists with gsd and vgsd.

---

## Testing

Root tests use `node:test`. Assertions compare parsed JSON or TOML structures and file hashes, never substrings.

- **`tests/fvgsd-coexistence.test.cjs`** is written first and fails before the change. For every runtime in `runtime-artifact-layout.cjs`:
  1. Create a temporary home. Seed a fake upstream GSD install and a fake vgsd install: commands or skills, agents, hooks, manifest, `settings.json` hook entries and statusline, and Codex `config.toml` agent sections and SessionStart block.
  2. Record a hash of every seeded file, plus the parsed seeded settings and config entries.
  3. Install fvgsd. Assert that every seeded file's hash is unchanged, that the seeded settings and config entries are still present and equal, and that fvgsd's files and entries exist. For Codex, also assert that fvgsd's `[agents.fvgsd-*]` sections come before the seeded GSD marker and that the seeded `hooks.json` SessionStart entry is still present.
  4. Check every fvgsd-installed file name, hook command, statusline command, Codex section path and OpenCode permission key against `tests/fixtures/foreign-installer-matchers.json`. That file lists the prefixes and substrings the gsd and vgsd installers use to find their own entries, taken from `bin/install.js` at 29f1b1a6. None may match.
  5. Uninstall fvgsd. Assert that the home matches the seeded snapshot exactly, including Codex's `codex_hooks` flag.
- **Migrations:** a first-time baseline scan of a config directory that contains `gsd-*` and `vgsd-*` skills, agents and hooks proposes no action for any of them.
- **Update check:** `check-latest-version.cjs` returns the `disabled` reason without calling its injected spawn function, and the worker, run with a fake `npm` first on `PATH` that records any call, leaves no record and writes `update_available: false`.
- **`tests/identity.test.cjs`:** the slash formatter, artifact layout, execution-branch helper and VibeClaw store return names equal to those derived from the identity module.
- **`tests/rename-identity-script.test.cjs`:** runs the script on a temporary fixture tree. It asserts that the JSON report counts match, excluded files are untouched and renamed files exist, and that a second run reports zero changes.
- **Updated suites:**
  - `tests/vgsd-command-namespace.test.cjs` becomes `tests/fvgsd-command-namespace.test.cjs`. Agents are now `fvgsd-`, and reinstall removes only fvgsd-owned paths.
  - The install, runtime-conversion and docs-parity suites are updated for the rename.
- **Generated files and checks:**
  - `docs/INVENTORY.md` and `docs/INVENTORY-MANIFEST.json` are regenerated.
  - These must pass: `npm run check:execution-branch-guards`, `npm run check:identity-fresh`, `npm test`, and `cd sdk && npm test`.
- **Manual acceptance** (needs the maintainer's approval at that point):
  1. Install fvgsd globally for Claude Code, Codex, Gemini and OpenCode.
  2. Re-hash every file listed in each runtime's GSD 1.42.3 `gsd-file-manifest.json` and confirm nothing changed.
  3. Confirm `/fvgsd-help` is available and `/gsd-help` still works.

---

## Implementation order

1. Write the coexistence test (red).
2. Add the identity module and switch code consumers to it.
3. Add the rename script, run it, and regenerate generated files.
4. Apply the installer ownership rules and remove the destructive migrations (coexistence test green).
5. Disable the npm update check and add the clone-based update flow.
6. Fix the leftover bugs, update package metadata and the README section, and add a changeset entry.
7. Get the full suites green, then run manual acceptance.

---

## Risks

- **Over-eager replacement.** Examples: GitHub URLs under the `gsd-build` organization, or the `gsd2-import` command. Mitigations: every rule except the fork-unique `vgsd` rule matches whole tokens, agent and hook names come from explicit directory lists, and the dry-run report is reviewed before writing.
- **Silent breakage of another install's `settings.json` or `config.toml`.** Covered by the coexistence test for every runtime layout.
- **Substring collisions caused by the name.** `fvgsd` contains `gsd` and `vgsd`. Handled by the Name safety rules and the foreign-matcher check in the coexistence test.
- **Breaking another runtime's hook setup.** Every hook keeps working under its new path rather than being removed, and the full test suite covers every runtime layout.
- **Stale generated files** (`hooks/dist`, `sdk/dist`, inventories). They are regenerated from source and never rewritten by the script.
- **Harder merges from upstream GSD or vgsd.** Accepted. After a merge, the rename script can be re-run to rename the incoming text.
