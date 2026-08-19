---
name: vgsd-workflow
description: "workflow | discuss plan execute verify phase progress"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
requires: [discuss-phase, spec-phase, plan-phase, execute-phase, verify-work, phase, progress, ultraplan-phase, plan-review-convergence]
---

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
