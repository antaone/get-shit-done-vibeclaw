---
name: fvgsd-context
description: "codebase intelligence | map graphify docs learnings"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
  - Bash
requires: [map-codebase, graphify, docs-update, extract-learnings]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "ns-context" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

Route to the appropriate codebase-intelligence skill based on the user's intent.
`gsd-scan` and `gsd-intel` were folded into `fvgsd-map-codebase` flags by #2790.

| User wants | Invoke |
|---|---|
| Map the full codebase structure | fvgsd-map-codebase |
| Quick lightweight codebase scan | fvgsd-map-codebase --fast |
| Query mapped intelligence files | fvgsd-map-codebase --query |
| Generate a knowledge graph | fvgsd-graphify |
| Update project documentation | fvgsd-docs-update |
| Extract learnings from a completed phase | fvgsd-extract-learnings |

Invoke the matched skill directly using the Skill tool.
