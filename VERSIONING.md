# Versioning & Release Strategy

GSD follows [Semantic Versioning 2.0.0](https://semver.org/) with three release tiers. fvgsd is not published to npm, so every tier produces a git tag rather than an npm dist-tag; installing means cloning and checking out that tag.

## Release Tiers

| Tier | What ships | Version format | Git tag | Branch | Install |
|------|-----------|---------------|---------|--------|---------|
| **Patch** | Bug fixes only | `1.27.1` | `v1.27.1` | `hotfix/1.27.1` | clone, checkout `v1.27.1`, `node bin/install.js` |
| **Minor** | Fixes + enhancements | `1.28.0` | `v1.28.0` (after RC) | `release/1.28.0` | clone, checkout the `v1.28.0-rc.N` tag (RC) or `v1.28.0` |
| **Major** | Fixes + enhancements + features | `2.0.0` | `v2.0.0` (after beta) | `release/2.0.0` | clone, checkout the `v2.0.0-beta.N` tag (beta) or `v2.0.0` |

## Release Streams

fvgsd has no npm channel, so there are no dist-tags — only git tags and branches:

| Stream | Meaning | Installed by |
|-----|---------|-------------|
| stable | Latest tagged release on `main` | clone, checkout `main` (or its latest tag), `node bin/install.js` |
| pre-release | RC or beta tag on a `release/*` branch | clone, checkout that tag, `node bin/install.js` |

The version string (`-rc.1` vs `-beta.1`) communicates stability level. Users only get a pre-release if they explicitly check out its tag.

## Semver Rules

| Increment | When | Examples |
|-----------|------|----------|
| **PATCH** (1.27.x) | Bug fixes, typo corrections, test additions | Hook filter fix, config corruption fix |
| **MINOR** (1.x.0) | Non-breaking enhancements, new commands, new runtime support | New workflow command, discuss-mode feature |
| **MAJOR** (x.0.0) | Breaking changes to config format, CLI flags, or runtime API; new features that alter existing behavior | Removing a command, changing config schema |

## Pre-Release Version Progression

Major and minor releases use different pre-release types:

```
Minor: 1.28.0-rc.1  →  1.28.0-rc.2  →  1.28.0
Major: 2.0.0-beta.1 →  2.0.0-beta.2 →  2.0.0
```

- **beta** (major releases only): Feature-complete but not fully tested. API mostly stable. Used for major releases to signal a longer testing cycle.
- **rc** (minor releases only): Production-ready candidate. Only critical fixes expected.
- Each version uses one pre-release type throughout its cycle. The `rc` action in the release workflow automatically selects the correct type based on the version.

## Branch Structure

```
main                              ← stable, always deployable
  │
  ├── hotfix/1.27.1               ← patch: cherry-pick fix from main, tag when finalized
  │
  ├── release/1.28.0              ← minor: accumulate fixes + enhancements, RC cycle
  │     ├── v1.28.0-rc.1          ← tag: pre-release
  │     └── v1.28.0                ← tag: stable
  │
  ├── release/2.0.0               ← major: features + breaking changes, beta cycle
  │     ├── v2.0.0-beta.1         ← tag: pre-release
  │     ├── v2.0.0-beta.2         ← tag: pre-release
  │     └── v2.0.0                ← tag: stable
  │
  ├── fix/1200-bug-description    ← bug fix branch (merges to main)
  ├── feat/925-feature-name       ← feature branch (merges to main)
  └── chore/1206-maintenance      ← maintenance branch (merges to main)
```

## Release Workflows

### Patch Release (Hotfix)

For fixes that need to ship without waiting for the next minor.

A hotfix `vX.YY.Z` cumulatively includes everything in `vX.YY.{Z-1}` plus every `fix:`/`chore:` commit landed on `main` since that base. The base tag is the anchor — `git cherry $BASE_TAG main` reveals exactly which commits are still unshipped, and the new `vX.YY.Z` tag becomes the next hotfix's base, so the cycle is self-documenting.

#### Two paths

**Path A — `hotfix.yml` (canonical, two-step):**

1. Trigger `hotfix.yml` with `action=create`, `version=1.27.1`, `auto_cherry_pick=true` (default).
   - Workflow detects `BASE_TAG` = highest `v1.27.*` < `v1.27.1` (so `1.27.1` branches from `v1.27.0`; `1.27.2` would branch from `v1.27.1`).
   - Branches `hotfix/1.27.1` from `BASE_TAG`.
   - Auto-cherry-picks every `fix:`/`chore:` commit on `origin/main` not already in the base, oldest-first. Patch-equivalents are skipped via `git cherry`. `feat:`/`refactor:` are **never** auto-included.
   - On conflict the workflow halts with the offending SHA. Resolve manually on the branch, then re-run finalize with `auto_cherry_pick=false`.
   - Bumps `package.json` (and `sdk/package.json`), pushes the branch, and lists every included SHA in the run summary.
2. (Optional) push additional manual commits to `hotfix/1.27.1`.
3. Trigger `hotfix.yml` with `action=finalize`. The workflow:
   - Runs `install-smoke` cross-platform gate.
   - Runs full test suite + coverage.
   - Builds SDK, bundles `sdk-bundle/fvgsd-sdk.tgz` inside the CC tarball (parity with `release-sdk.yml`).
   - Tags `v1.27.1` and creates a GitHub Release.
   - Opens merge-back PR against `main`.

**Path B — `release-sdk.yml` (one-shot, SDK-bundling variant):**

Bundles the SDK inside the CC tarball in the same run.

1. Trigger `release-sdk.yml` with `action=hotfix`, `version=1.27.1`, `auto_cherry_pick=true`.
   - The `prepare` job creates the branch and cherry-picks (same logic as Path A).
   - `install-smoke` runs against the new branch.
   - The `release` job tags and creates a GitHub Release.
   - Idempotent: if `hotfix/1.27.1` already exists (e.g. you ran `hotfix.yml create` first), the prepare job checks it out and re-runs cherry-pick as a no-op.
2. `dry_run=true` exercises the full pipeline without pushing the branch or tagging.

### Minor Release (Standard Cycle)

For accumulated fixes and enhancements.

1. Trigger `release.yml` with action `create` and version (e.g., `1.28.0`)
2. Workflow creates `release/1.28.0` branch from main, bumps package.json
3. Trigger `release.yml` with action `rc` to tag `1.28.0-rc.1` as a GitHub pre-release
4. Test the RC: clone, checkout the `v1.28.0-rc.1` tag, `node bin/install.js`
5. If issues found: fix on release branch, tag `rc.2`, `rc.3`, etc.
6. Trigger `release.yml` with action `finalize` — tags `1.28.0` and creates the stable GitHub Release
7. Merge release branch to main

### Major Release

Same as minor but uses `-beta.N` instead of `-rc.N`, signaling a longer testing cycle.

1. Trigger `release.yml` with action `create` and version (e.g., `2.0.0`)
2. Trigger `release.yml` with action `rc` to tag `2.0.0-beta.1` as a GitHub pre-release
3. If issues found: fix on release branch, tag `beta.2`, `beta.3`, etc.
4. Trigger `release.yml` with action `finalize` -- tags `2.0.0` and creates the stable GitHub Release
5. Merge release branch to main

## Conventional Commits

Branch names map to commit types:

| Branch prefix | Commit type | Version bump |
|--------------|-------------|-------------|
| `fix/` | `fix:` | PATCH |
| `feat/` | `feat:` | MINOR |
| `hotfix/` | `fix:` | PATCH (immediate) |
| `chore/` | `chore:` | none |
| `docs/` | `docs:` | none |
| `refactor/` | `refactor:` | none |
