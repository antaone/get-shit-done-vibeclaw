---
name: vgsd-manage
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
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" execution-branch ensure "ns-manage" --runtime __VGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `vgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

Route to the appropriate management skill based on the user's intent.
`vgsd-config` (settings + advanced + integrations + profile) and `vgsd-workspace`
(new + list + remove) are post-#2790 consolidated entries.

| User wants | Invoke |
|---|---|
| Configure GSD settings (basic / advanced / integrations / profile) | vgsd-config |
| Manage workspaces (create / list / remove) | vgsd-workspace |
| Manage parallel workstreams | vgsd-workstreams |
| Continue work in a fresh context thread | vgsd-thread |
| Pause current work | vgsd-pause-work |
| Resume paused work | vgsd-resume-work |
| Update the GSD installation | vgsd-update |
| Ship completed work | vgsd-ship |
| Process inbox items | vgsd-inbox |
| Create a clean PR branch | vgsd-pr-branch |
| Undo the last GSD action | vgsd-undo |

Invoke the matched skill directly using the Skill tool.
