---
name: vgsd-project
description: "project lifecycle | milestones audits summary"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
---

Route to the appropriate project / milestone skill based on the user's intent.
`gsd-plan-milestone-gaps` was deleted by #2790 — gap planning now happens
inline as part of `vgsd-audit-milestone`'s output.

| User wants | Invoke |
|---|---|
| Start a new project | vgsd-new-project |
| Create a new milestone | vgsd-new-milestone |
| Complete the current milestone | vgsd-complete-milestone |
| Audit a milestone for issues | vgsd-audit-milestone |
| Summarize milestone status | vgsd-milestone-summary |

Invoke the matched skill directly using the Skill tool.
