---
type: Fixed
pr: 3365
---
**Codex `execute-phase` now uses its installed runtime identity and a safe worktree default** — phases planned or promoted by another tool execute sequentially when `workflow.use_worktrees` is unset, while an explicit non-false Codex setting still fails closed because `spawn_agent` has no direct mapping for Claude Code's `isolation="worktree"`. (#3360)
