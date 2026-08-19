---
name: vgsd-quality
description: "quality gates | code review debug audit security eval ui"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
requires: [code-review, audit-uat, secure-phase, eval-review, ui-review, validate-phase, debug, forensics]
---

Route to the appropriate quality / review skill based on the user's intent.
`gsd-code-review-fix` was absorbed by `vgsd-code-review --fix` in #2790.

| User wants | Invoke |
|---|---|
| Review code for quality and correctness | vgsd-code-review |
| Auto-fix code review findings | vgsd-code-review --fix |
| Audit UAT / acceptance testing | vgsd-audit-uat |
| Security review of a phase | vgsd-secure-phase |
| Evaluate AI response quality | vgsd-eval-review |
| Review UI for design and accessibility | vgsd-ui-review |
| Validate phase outputs | vgsd-validate-phase |
| Debug a failing feature or error | vgsd-debug |
| Forensic investigation of a broken system | vgsd-forensics |

Invoke the matched skill directly using the Skill tool.
