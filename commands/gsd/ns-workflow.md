---
name: fvgsd-workflow
description: "workflow | discuss plan execute verify phase progress"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
  - Bash
requires: [discuss-phase, spec-phase, plan-phase, execute-phase, verify-work, phase, progress, ultraplan-phase, plan-review-convergence]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "ns-workflow" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

Route to the appropriate phase-pipeline skill based on the user's intent.
Sub-skill names below are post-#2790 consolidated targets — `fvgsd-phase`
absorbs the former add/insert/remove/edit-phase commands and `fvgsd-progress`
absorbs the former next/do commands.

| User wants | Invoke |
|---|---|
| Gather context before planning | fvgsd-discuss-phase |
| Clarify what a phase delivers | fvgsd-spec-phase |
| Create a PLAN.md | fvgsd-plan-phase |
| Execute plans in a phase | fvgsd-execute-phase |
| Verify built features through UAT | fvgsd-verify-work |
| Add / insert / remove / edit a phase | fvgsd-phase |
| Advance to the next logical step | fvgsd-progress |
| Offload planning to the ultraplan cloud | fvgsd-ultraplan-phase |
| Cross-AI plan review convergence loop | fvgsd-plan-review-convergence |

Invoke the matched skill directly using the Skill tool.
