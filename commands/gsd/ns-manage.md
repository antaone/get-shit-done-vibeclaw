---
name: fvgsd-manage
description: "config workspace | workstreams thread update ship inbox"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
  - Bash
requires: [config, workspace, workstreams, thread, pause-work, resume-work, update, ship, inbox, pr-branch, undo]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "ns-manage" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

Route to the appropriate management skill based on the user's intent.
`fvgsd-config` (settings + advanced + integrations + profile) and `fvgsd-workspace`
(new + list + remove) are post-#2790 consolidated entries.

| User wants | Invoke |
|---|---|
| Configure GSD settings (basic / advanced / integrations / profile) | fvgsd-config |
| Manage workspaces (create / list / remove) | fvgsd-workspace |
| Manage parallel workstreams | fvgsd-workstreams |
| Continue work in a fresh context thread | fvgsd-thread |
| Pause current work | fvgsd-pause-work |
| Resume paused work | fvgsd-resume-work |
| Update the GSD installation | fvgsd-update |
| Ship completed work | fvgsd-ship |
| Process inbox items | fvgsd-inbox |
| Create a clean PR branch | fvgsd-pr-branch |
| Undo the last GSD action | fvgsd-undo |

Invoke the matched skill directly using the Skill tool.
