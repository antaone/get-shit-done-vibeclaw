---
name: vgsd-workflow
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
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" execution-branch ensure "ns-workflow" --runtime __VGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `vgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

Route to the appropriate phase-pipeline skill based on the user's intent.
Sub-skill names below are post-#2790 consolidated targets — `vgsd-phase`
absorbs the former add/insert/remove/edit-phase commands and `vgsd-progress`
absorbs the former next/do commands.

| User wants | Invoke |
|---|---|
| Gather context before planning | vgsd-discuss-phase |
| Clarify what a phase delivers | vgsd-spec-phase |
| Create a PLAN.md | vgsd-plan-phase |
| Execute plans in a phase | vgsd-execute-phase |
| Verify built features through UAT | vgsd-verify-work |
| Add / insert / remove / edit a phase | vgsd-phase |
| Advance to the next logical step | vgsd-progress |
| Offload planning to the ultraplan cloud | vgsd-ultraplan-phase |
| Cross-AI plan review convergence loop | vgsd-plan-review-convergence |

Invoke the matched skill directly using the Skill tool.
