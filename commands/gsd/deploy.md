---
name: fvgsd:deploy
description: Deploy the current commit to one project-pack environment and record the result in the handoff
argument-hint: "<env> [--ref BRANCH] [--approval TEXT]"
allowed-tools:
  - Read
  - Bash
  - Agent
  - AskUserQuestion
requires: [pack, handoff]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "deploy" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Deploy HEAD to one `pack.deploy` environment with fvgsd-deploy-runner, then record the result with fvgsd-handoff-keeper. Environments with `needs_owner: true` need the owner's yes first.

Flags are active only when their token appears in `$ARGUMENTS`:
- `--ref BRANCH`: the branch the deploy uses; default the current branch
- `--approval TEXT`: the owner's yes, verbatim, and where it is recorded
</objective>

<available_agent_types>
Use these exact names; never fall back to general-purpose:
- fvgsd-deploy-runner — runs the environment's deploy and after-checks
- fvgsd-handoff-keeper — records the result in the handoff notes
</available_agent_types>

<process>
Spawning: for each `Agent(...)` call, get the model with `fvgsd-sdk query resolve-model <agent> --pick model` and pass `model` only when it is not `inherit`. After spawning, wait for the result; do not do the agent's work yourself.

1. Run `fvgsd-sdk query pack.show`. Stop when `problems` names `pack.deploy` or `pack.deploy` has no entry for the environment, and list the environments it has.
2. When the target has `needs_owner: true` and `--approval` is absent, ask the user with AskUserQuestion whether the owner approves deploying the short HEAD sha to this environment. Use a yes, verbatim with the time, as the approval. Stop on anything else.
3. Spawn `Agent(subagent_type="fvgsd-deploy-runner", description="Deploy to <env>", prompt=...)` with `<deploy_inputs>`: `env`, `ref`, `sha` (`git rev-parse HEAD`) and `owner_approval`.
4. When it refuses because the commit isn't pushed, ask whether to push HEAD to the branch. Push only on a yes, then spawn the runner once more. Never push without asking.
5. Print the result block as returned.
6. When `pack.handoff_path` is set, spawn `Agent(subagent_type="fvgsd-handoff-keeper", description="Record deploy", prompt=...)` with `<handoff_inputs>`: `entry` (the result's env, sha, runs, after-checks, red and manual lines) and `step` (the current step label from the handoff file's newest entry, else `deploy`). Print its status.
</process>
