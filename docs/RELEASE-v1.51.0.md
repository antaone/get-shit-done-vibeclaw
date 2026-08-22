# v1.51.0 Release Notes

**Release Date:** 2026-08-22  
**npm tag:** `latest`

```bash
npm install -g get-shit-done-cc@latest
# or pin exact:
npm install -g get-shit-done-cc@1.51.0
```

---

## Summary

Version 1.51.0 is a minor release focused on VibeClaw brownfield project compatibility. This release hardens the onboarding flow for existing `.planning/` projects that may contain stale public `gsd` command references from earlier installations.

## What's Fixed

### VibeClaw Brownfield Onboarding — Stale Command Detection

**Issue:** When upgrading projects to the new `vgsd` namespace (introduced in v1.50.0-canary.3), existing `.planning/` directories might still reference the legacy `gsd-*` command names in Markdown files, skill paths, and workflow artifacts. These stale references could cause execution failures or confusion during the upgrade.

**Fix:** The brownfield onboarding flow now:

- **Detects** stale public `gsd` command references in `.planning/` directory entries
- **Reports** exact Markdown file locations and the corresponding runtime-native `vgsd` replacements
- **Migrates** references transactionally via explicit user review and approval
- **Protects** candidate preparation by failing closed until focused migrations are reviewed and committed
- **Preserves** internal `gsd-tools`, `gsd-sdk` names, URLs, non-Markdown artifacts, and unrelated text unchanged

This ensures a smooth upgrade path for projects already using GSD's planning infrastructure.

## Installation & Verification

Install the latest version:

```bash
npm install -g get-shit-done-cc@latest
gsd --version
```

Run the health check:

```bash
gsd health
```

## Compatibility

- **Node.js:** >= 22.0.0
- **Platforms:** macOS, Linux, Windows
- **Runtimes:** Claude Code, Gemini CLI, Codex, OpenCode
- **Breaking changes:** None

## Documentation

- Updated: [CHANGELOG.md](../CHANGELOG.md)
- See also: [VIBECLAW.md](VIBECLAW.md) for the new namespace strategy and brownfield migration details

## Upgrading from Earlier Versions

If you have existing `.planning/` directories:

1. Update to v1.51.0: `npm install -g get-shit-done-cc@latest`
2. Run `/gsd health` to check your installation
3. Run `/gsd new-project --check` to inspect any legacy command references
4. Follow the interactive brownfield onboarding prompts to migrate as needed

No manual intervention is required unless you've customized GSD skills or commands directly in `.planning/`.
