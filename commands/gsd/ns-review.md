---
name: vgsd-quality
description: "quality gates | code review debug audit security eval ui"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
  - Bash
requires: [code-review, audit-uat, secure-phase, eval-review, ui-review, validate-phase, debug, forensics]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" execution-branch ensure "ns-review" --runtime __VGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

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
