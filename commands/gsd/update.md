---
name: fvgsd:update
description: Update fvgsd from the local clone it was installed from
argument-hint: "[--sync | --reapply]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "update" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Update fvgsd from the local clone it was installed from, and show the commits pulled.

Routes to the update workflow which handles:
- Locating the local clone fvgsd was installed from
- Pulling the local clone (git pull --ff-only)
- Reinstalling from the updated clone
- Showing the commits that were pulled
- Restart reminder
</objective>

<execution_context>
@~/.claude/fvgsd/workflows/update.md
</execution_context>

<flags>
- **--sync**: Sync managed GSD skills across runtime roots so multi-runtime users stay aligned after an update. Runs the sync-skills workflow (--from, --to, --dry-run, --apply flags supported).
- **--reapply**: Reapply local modifications after a GSD update. Uses three-way comparison (pristine baseline, user-modified backup, newly installed version) to merge user customizations back. Runs the reapply-patches workflow.
- **(no flag)**: Standard update — pull the local clone, reinstall, show the commits pulled.
</flags>

<process>
Parse the first token of $ARGUMENTS:
- If it is `--sync`: strip the flag, execute the sync-skills workflow (passing remaining args for --from/--to/--dry-run/--apply).
- If it is `--reapply`: strip the flag, execute the reapply-patches workflow.
- Otherwise: execute the update workflow end-to-end.

</process>

<execution_context_extended>
@~/.claude/fvgsd/workflows/sync-skills.md
@~/.claude/fvgsd/workflows/reapply-patches.md
</execution_context_extended>
