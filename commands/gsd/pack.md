---
name: fvgsd:pack
description: Show or draft the project pack, the config.json facts fvgsd's agents read instead of guessing
argument-hint: "[show|init]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - AskUserQuestion
requires: [config]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "pack" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Show the project pack, or draft the missing parts from the repo and save what the user confirms. The pack is the `pack` section of `.planning/config.json` plus the check, research and verifier settings next to it. Specialist agents read it and refuse to guess a field that is missing.
</objective>

<reference>
| Key | Value |
|---|---|
| `pack.name` | Short project name |
| `pack.deploy` | One entry per environment: `{"kind": "github", "workflows": [...]}` or `{"kind": "command", "command": "..."}`, plus optional `needs_owner`, `after_checks` (commands) and `notes` |
| `pack.migrations` | `{"dir": "...", "scheme": "...", "lock_timeout": true}`; only `dir` is required |
| `pack.candidates` | Vibe candidate naming pattern |
| `pack.message_prefix` | Prefix for status messages to other sessions |
| `pack.handoff_path` | Running handoff notes file, relative to the project root |
| `workflow.build_command`, `typecheck_command`, `lint_command`, `test_command` | The four checks. Empty means detect, `off` skips one |
| `workflow.extra_check_commands` | More definition-of-done commands, run after the four by the full set and `/fvgsd-dod` |
| `workflow.research` | `true`, `false` or `on-gap` (research only when CONTEXT.md lists Open Questions) |
| `workflow.build_verify_report` | `full` or `lite` (must-haves table, no narrative) |
</reference>

<process>
1. Run `fvgsd-sdk query pack.show`.
2. `show` (the default): print the pack as a key/value table, then `missing`, `problems`, each check command with its source plus `extra`, `research` and `verify_report`. Stop.
3. `init`:
   - Read only what proposes values: `package.json` scripts, the names and `on:` triggers of `.github/workflows/*.yml` (`workflow_dispatch` workflows are deploy candidates), the migrations folder if one exists, and the deploy, check and migration sections of `CLAUDE.md` or `AGENTS.md`.
   - Propose a value for each missing field, and for each check command the instructions name differently from `pack.show`. Leave a field out when nothing supports it, and say so.
   - Set `needs_owner: true` on every deploy environment other than `dev`, unless the user says otherwise.
   - Show the proposal as one table (key, value, source) and ask with AskUserQuestion which rows to save; the user may edit a value in their answer.
   - Save each confirmed row with `fvgsd-sdk query config-set <key> '<value>'` (JSON for objects and lists). A rejected value prints why; fix it with the user or drop it.
   - Run `fvgsd-sdk query pack.show` again and print `missing` and `problems`.
</process>
