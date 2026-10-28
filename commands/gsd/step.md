---
name: fvgsd:step
description: Run one step from its spec — digest, build, checks, deploy, proof, report and handoff
argument-hint: "<spec-path> <phase|new> [--scope NAME] [--target TEXT] [--deploy ENV] [--yes]"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
requires: [build, dod, deploy, handoff, pack, vibe]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "step" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Run one step end to end: digest the spec into the phase's CONTEXT.md, build it, run the definition-of-done checks, optionally deploy, collect proof, report, and update the handoff. The main session reads only the agents' short results and never reads the spec itself.

Agents: fvgsd-spec-digester, fvgsd-deploy-runner (only with `--deploy`), fvgsd-proof-collector and fvgsd-handoff-keeper. /fvgsd:build runs its own. To run the step in a Vibe candidate, start it as `/fvgsd:vibe step <arguments>`.

Flags are active only when their token appears in `$ARGUMENTS`:
- `--scope NAME`: the part of a multi-repo spec that is this repo's
- `--target TEXT`: how proof probes reach the running app, for example a dev base URL
- `--deploy ENV`: deploy to that `pack.deploy` environment after the checks pass
- `--yes`: skip the one approval question
</objective>

<available_agent_types>
Use these exact names; never fall back to general-purpose:
- fvgsd-spec-digester — writes the phase's CONTEXT.md from the spec
- fvgsd-deploy-runner — runs the `--deploy` environment
- fvgsd-proof-collector — probes the done-when items and writes the evidence file
- fvgsd-handoff-keeper — appends the report to the handoff notes
</available_agent_types>

<process>
Spawning: for each `Agent(...)` call, get the model with `fvgsd-sdk query resolve-model <agent> --pick model` and pass `model` only when it is not `inherit`. After spawning, wait for the result; do not do the agent's work yourself.

1. Parse `$ARGUMENTS`: the spec path (stop when the file is missing), the phase (a number, or `new`) and the flags.
2. Run `fvgsd-sdk query pack.show`. Stop on `problems`. With `--deploy ENV`, stop when `pack.deploy` has no `ENV` entry.
3. Phase: with `new`, run `fvgsd-sdk query phase.add "<the spec's first heading, else its file name>"` and use the phase it returns. Then run `fvgsd-sdk query find-phase <phase>`, and stop when `found` is false. P is the padded phase and PHASE_DIR its `directory`.
4. Digest. When `{PHASE_DIR}/{P}-CONTEXT.md` exists, keep it and say so. Otherwise spawn `Agent(subagent_type="fvgsd-spec-digester", description="Digest step spec", prompt=...)` with a `<digest_inputs>` block: `spec`, `phase` and `scope`. Stop on `## DIGEST REFUSED`.
5. Approve once. Show the digest result, or for an existing CONTEXT.md only its `### Done when` items and Open Questions (read them with Grep), then the plan: build, checks, the deploy if any, proof, report. Unless `--yes`, ask with AskUserQuestion: build now, or stop. This is the step's one approval.
6. Build: `Skill(skill="fvgsd-build", args="{phase}")`. Note its end marker. After `## BUILD BLOCKED` or `## BUILD STOPPED`, go to step 10.
7. Checks. Read `$(git rev-parse --git-common-dir)/fvgsd/build/{P}/latest.json`. Use it when every entry that isn't skipped passed at `git rev-parse HEAD`. Otherwise run `fvgsd-sdk query build.run-checks --set full --label dod --phase {phase} --tail 20`, in the background where the runtime supports it, and wait for it.
8. Deploy, only with `--deploy ENV` and passing checks.
   - When the target has `needs_owner: true`, ask the user for the owner's yes and pass their answer, verbatim with the time, as `owner_approval`. With `--yes` and no answer, skip the deploy and say why.
   - Spawn `Agent(subagent_type="fvgsd-deploy-runner", description="Deploy to ENV", prompt=...)` with `<deploy_inputs>`: `env`, `ref` (the current branch), `sha` (HEAD) and `owner_approval`.
   - When it refuses because the commit isn't pushed, ask whether to push HEAD to that branch. Push only on a yes, then spawn the runner once more.
9. Proof. Spawn `Agent(subagent_type="fvgsd-proof-collector", description="Collect step proof", prompt=...)` with `<proof_inputs>`:
   - `spec`: `{PHASE_DIR}/{P}-CONTEXT.md`
   - `evidence_path`: `{PHASE_DIR}/{P}-PROOF.md`
   - `human_uat_path`: `{PHASE_DIR}/{P}-HUMAN-UAT.md`, only when that file doesn't exist yet
   - `target`: the `--target` text, plus the deployed environment when there was one

   Then run `fvgsd-sdk query commit "docs({P}): step proof" --files <the files it wrote>`.
10. Report in at most 8 lines, starting with `pack.message_prefix` (the repo name when it is unset):
    - the spec file name, the phase and the short HEAD sha
    - the build's end marker
    - checks passed out of run
    - the deploy result with its run ids
    - proof passed out of total, and the human item count
    - the evidence path
11. Handoff. When `pack.handoff_path` is set, spawn `Agent(subagent_type="fvgsd-handoff-keeper", description="Update handoff", prompt=...)` with `<handoff_inputs>`: `entry` (the report) and `step: phase {P}`. Print its status. Otherwise say the handoff was skipped because `pack.handoff_path` is unset.
</process>
