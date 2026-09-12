---
name: fvgsd-project
description: "project lifecycle | milestones audits summary"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
  - Bash
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "ns-project" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

Route to the appropriate project / milestone skill based on the user's intent.
`gsd-plan-milestone-gaps` was deleted by #2790 — gap planning now happens
inline as part of `fvgsd-audit-milestone`'s output.

| User wants | Invoke |
|---|---|
| Start a new project | fvgsd-new-project |
| Create a new milestone | fvgsd-new-milestone |
| Complete the current milestone | fvgsd-complete-milestone |
| Audit a milestone for issues | fvgsd-audit-milestone |
| Summarize milestone status | fvgsd-milestone-summary |

Invoke the matched skill directly using the Skill tool.
