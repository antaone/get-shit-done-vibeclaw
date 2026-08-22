---
type: Fixed
pr: 3364
---
**Codex installs now canonicalize `hooks.json` to the current nested schema** — reinstalling migrates legacy top-level event arrays under `hooks`, removes stale GSD update commands, preserves user-owned hooks and metadata, and writes exactly one managed SessionStart command. (#3357)
