---
name: fvgsd:progress
description: Check progress, advance workflow, or dispatch freeform intent — the unified GSD situational command
argument-hint: "[--forensic | --next | --do \"task description\"]"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
  - AskUserQuestion
requires: [phase]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch inspect "progress" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Check project progress, summarize recent work and what's ahead, then intelligently route to the next action.

Three modes:
- **default**: Show progress report + intelligently route to the next action (execute or plan). Provides situational awareness before continuing work.
- **--next**: Automatically advance to the next logical step without manual route selection. Reads STATE.md, ROADMAP.md, and phase directories. Supports `--force` to bypass safety gates.
- **--do "task description"**: Analyze freeform natural language and dispatch to the most appropriate GSD command. Never does the work itself — matches intent, confirms, hands off.
- **--forensic**: Append a 6-check integrity audit after the standard progress report.
</objective>

<flags>
- **--next**: Detect current project state and automatically invoke the next logical GSD workflow step. Scans all prior phases for incomplete work before routing. `--next --force` bypasses safety gates.
- **--do "..."**: Smart dispatcher — match freeform intent to the best GSD command using routing rules, confirm the match, then hand off.
- **--forensic**: Run 6-check integrity audit after the standard progress report.
- **(no flag)**: Standard progress check + intelligent routing (Routes A through F).
</flags>

<execution_context>
@~/.claude/fvgsd/workflows/progress.md
@~/.claude/fvgsd/workflows/next.md
@~/.claude/fvgsd/workflows/do.md
@~/.claude/fvgsd/references/ui-brand.md
</execution_context>

<process>
Arguments provided: "$ARGUMENTS"
Parse the first token from the provided arguments:
- If it is `--next`: strip the flag, execute the next workflow (passing remaining args e.g. --force).
- If it is `--do`: strip the flag, pass remainder as freeform intent to the do workflow.
- Otherwise: execute the progress workflow end-to-end (pass --forensic through if present).

Preserve all routing logic from the target workflow.
</process>
