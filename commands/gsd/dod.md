---
name: fvgsd:dod
description: Run the project's definition-of-done checks and show one pass/fail table
argument-hint: "[phase]"
allowed-tools:
  - Bash
requires: [pack]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch inspect "dod" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Run the full check set once (build, typecheck, lint and test, then `workflow.extra_check_commands`) and report it in under 40 lines. Do not fix anything.
</objective>

<process>
1. Run `fvgsd-sdk query build.run-checks --set full --label dod --tail 20`, adding `--phase <phase>` when one is given (the results then count as that phase's latest checks). Where the runtime supports background commands, run it as one and wait for it to finish without ending your turn, because the checks can outlast a foreground command's time limit. Otherwise run it in the foreground.
2. If the result has `error`, show it and stop.
3. Print one table, `| Check | Command | Result | Time |`, with Result `pass`, `FAIL (exit N)`, `TIMEOUT` or `skipped`, and Time from `duration_ms`. A skipped check has no command: it is set to `off` or was not detected (`/fvgsd-pack show` tells which).
4. Under the table, for each failure print its `output_tail` (already the last 20 lines) in a code block headed by its name, and mark it `preexisting` when the result says so.
5. End with the `results_file` path and one line: `DoD: passed` or `DoD: N failing`.
</process>
