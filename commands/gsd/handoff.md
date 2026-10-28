---
name: fvgsd:handoff
description: Add an entry to the project's handoff notes, roll old entries to history, and check STATE.md
argument-hint: "[entry text] [--step LABEL]"
allowed-tools:
  - Read
  - Bash
  - Agent
requires: [pack, progress]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch inspect "handoff" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Keep the handoff file at `pack.handoff_path` short and current with fvgsd-handoff-keeper. Print only its status.

`--step LABEL` is active only when its token appears in `$ARGUMENTS`; it names the current step.
</objective>

<available_agent_types>
Use these exact names; never fall back to general-purpose:
- fvgsd-handoff-keeper — appends the entry, rolls old entries and checks STATE.md
</available_agent_types>

<process>
Spawning: for each `Agent(...)` call, get the model with `fvgsd-sdk query resolve-model <agent> --pick model` and pass `model` only when it is not `inherit`. After spawning, wait for the result; do not do the agent's work yourself.

1. Run `fvgsd-sdk query config-get pack.handoff_path --default ""`. When it prints an empty value, stop and suggest `/fvgsd:pack init`.
2. Entry: the text in `$ARGUMENTS` without the flag. When there is none, write 3–8 lines yourself: what this session did and committed (`git log --oneline -10` for the shas), where it stopped, and the next action.
3. Step: `--step`, else the current phase from `fvgsd-sdk query state.json` as `phase {N}`.
4. Spawn `Agent(subagent_type="fvgsd-handoff-keeper", description="Update handoff", prompt=...)` with `<handoff_inputs>`: `entry` and `step`.
5. Print the `## HANDOFF STATUS` block. When it reports STATE.md stale, offer to update STATE.md through `fvgsd-sdk query state.update` or `/fvgsd:progress`.
</process>
