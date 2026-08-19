---
name: vgsd:stats
description: Display project statistics — phases, plans, requirements, git metrics, and timeline
allowed-tools:
  - Read
  - Bash
requires: [phase, progress]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" execution-branch ensure "stats" --runtime __VGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Display comprehensive project statistics including phase progress, plan execution metrics, requirements completion, git history stats, and project timeline.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/stats.md
</execution_context>

<process>
Execute end-to-end.
</process>
