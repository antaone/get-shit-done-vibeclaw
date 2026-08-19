---
name: vgsd-manage
description: "config workspace | workstreams thread update ship inbox"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
requires: [config, workspace, workstreams, thread, pause-work, resume-work, update, ship, inbox, pr-branch, undo]
---

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
