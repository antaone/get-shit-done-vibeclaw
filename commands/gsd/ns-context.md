---
name: vgsd-context
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
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" execution-branch ensure "ns-context" --runtime __VGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `vgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

Route to the appropriate codebase-intelligence skill based on the user's intent.
`gsd-scan` and `gsd-intel` were folded into `vgsd-map-codebase` flags by #2790.

| User wants | Invoke |
|---|---|
| Map the full codebase structure | vgsd-map-codebase |
| Quick lightweight codebase scan | vgsd-map-codebase --fast |
| Query mapped intelligence files | vgsd-map-codebase --query |
| Generate a knowledge graph | vgsd-graphify |
| Update project documentation | vgsd-docs-update |
| Extract learnings from a completed phase | vgsd-extract-learnings |

Invoke the matched skill directly using the Skill tool.
