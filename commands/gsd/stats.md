---
name: fvgsd:stats
description: Display project statistics — phases, plans, requirements, git metrics, and timeline
allowed-tools:
  - Read
  - Bash
requires: [phase, progress]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch inspect "stats" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Display comprehensive project statistics including phase progress, plan execution metrics, requirements completion, git history stats, and project timeline.
</objective>

<execution_context>
@~/.claude/fvgsd/workflows/stats.md
</execution_context>

<process>
Execute end-to-end.
</process>
