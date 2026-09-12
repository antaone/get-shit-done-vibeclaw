---
name: fvgsd-quality
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
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "ns-review" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

Route to the appropriate quality / review skill based on the user's intent.
`gsd-code-review-fix` was absorbed by `fvgsd-code-review --fix` in #2790.

| User wants | Invoke |
|---|---|
| Review code for quality and correctness | fvgsd-code-review |
| Auto-fix code review findings | fvgsd-code-review --fix |
| Audit UAT / acceptance testing | fvgsd-audit-uat |
| Security review of a phase | fvgsd-secure-phase |
| Evaluate AI response quality | fvgsd-eval-review |
| Review UI for design and accessibility | fvgsd-ui-review |
| Validate phase outputs | fvgsd-validate-phase |
| Debug a failing feature or error | fvgsd-debug |
| Forensic investigation of a broken system | fvgsd-forensics |

Invoke the matched skill directly using the Skill tool.
