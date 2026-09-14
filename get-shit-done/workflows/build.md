<purpose>
Take a discussed phase to a verified implementation in one run. Research only when RESEARCH.md is missing, write a short brief, build it in vertical slices (in parallel where the runtime allows), verify with the project's own commands plus one verifier pass, fix what remains in capped rounds, and finish with a build summary. The separate plan-phase and execute-phase commands stay available; this workflow replaces them for the phase it builds.

You are the lead. Pass agents paths, never file contents. Read the JSON that each query prints; do not re-derive what a query already returns.
</purpose>

<available_agent_types>
Use these exact names; never fall back to general-purpose:
- fvgsd-builder — writes the build brief, builds one slice, fixes grouped problems, resolves merge conflicts
- fvgsd-verifier — verifies the phase in build mode and writes VERIFICATION.md (and HUMAN-UAT.md)
- fvgsd-phase-researcher — writes RESEARCH.md when it is missing
- fvgsd-code-reviewer — optional single review of the build diff
</available_agent_types>

<process>

<step name="parse_args">
Parse `$ARGUMENTS`. The first token that does not start with `--` is `PHASE`. A flag is active only when its literal token is present:
- `--confirm` → `CONFIRM=true`
- `--gaps` → `GAPS_FLAG=--gaps`
- `--research-only` → `RESEARCH_ONLY=true`
- `--brief-only` → `BRIEF_ONLY=true`

**Headless** means this prompt starts with `## HEADLESS MODE`, or AskUserQuestion is unavailable and nobody can answer. Otherwise the session is interactive. If `PHASE` is missing: interactive → ask for it; headless → `OUTCOME=blocked`, go to `next`.

Every step below that "goes to `next`" sets `OUTCOME` to `complete`, `gaps`, `blocked` or `stopped` first. A step may also set `NEXT` to the command the `next` step suggests, written as a command name plus arguments (for example `discuss-phase 3`).
</step>

<step name="initialize">
Load everything in one call. The installer replaces the runtime token; `init.build` ignores it when it was not replaced.

```bash
INIT=$(fvgsd-sdk query init.build "$PHASE" ${GAPS_FLAG} --runtime "${FVGSD_RUNTIME:-__FVGSD_RUNTIME__}")
BUILDER_SKILLS=$(fvgsd-sdk query agent-skills fvgsd-builder)
VERIFIER_SKILLS=$(fvgsd-sdk query agent-skills fvgsd-verifier)
```

Stop cases, in order:
- `error` present → show it; `OUTCOME=blocked` → `next`.
- `phase_found` false, or `inputs.context` null → say the phase needs CONTEXT.md first; `OUTCOME=stopped`, `NEXT=discuss-phase {PHASE}` → `next`.
- `resume.state` = `classic` → say the phase was planned with plan-phase; `OUTCOME=stopped`, `NEXT=execute-phase {PHASE}` → `next`.
- `complete` → show `resume.summary`; `OUTCOME=complete` → `next`.
- `human_needed` → say human checks are pending; `OUTCOME=stopped`, `NEXT=verify-work {PHASE}` → `next`.
- `gaps_found` with `resume.summary` not null → read that summary's frontmatter. With `kind: build-summary` → say gaps remain; `OUTCOME=gaps`, `NEXT=build {PHASE} --gaps` → `next`. Without it, finalize never completed: handle the state as `summarizing`.

**Query errors:** read `error` first in every `build.waves`, `build.run-checks` and `build.merge-wave` result (a background baseline's too), before any list. `error` present → show it (for `build.waves`, its `errors` too); `OUTCOME=blocked` → `next`. With `merge_abort_failed`, also show its `slice`, `detail` and the lists collected so far; that slice is in none of them.

Record: `N` = `phase.number`, `P` = `phase.padded`, `PHASE_DIR` = `phase.dir`, `PLAN` = `resume.plan`, `BASE` = `resume.base_commit`, `BRIEF` = `{PHASE_DIR}/{P}-{PLAN}-PLAN.md`, `SUMMARY` = `{PHASE_DIR}/{P}-{PLAN}-SUMMARY.md`, `VERIFICATION` = `{PHASE_DIR}/{P}-VERIFICATION.md`, `HUMAN_UAT` = `{PHASE_DIR}/{P}-HUMAN-UAT.md`, `ROUND=0`.

Tier:
- `TIER=parallel` when `runtime.spawn_agents`, `runtime.parallel_agents` and `runtime.worktree_isolation` are all true and `config.parallel` is `auto`.
- `TIER=sequential` when `runtime.spawn_agents` is true otherwise.
- `TIER=inline` when `runtime.spawn_agents` is false. Wherever this workflow spawns an agent, follow that agent's file (for example `fvgsd-builder.md`) from the runtime's installed agents folder (for Claude Code, `~/.claude/agents`) yourself with the same inputs; for the verifier, follow the build-mode section of `fvgsd-verifier.md`.

`PAUSE=true` when the brief waits for approval: `CONFIRM` is set, or `config.mode` is `interactive` in an interactive session. Otherwise `PAUSE=false`.

Spawning rules for every `Agent(...)` call:
- Pass `model="<value>"` only when `runtime.per_call_model` is true and the value is not `inherit`; otherwise omit `model`.
- Brief-mode builders use `models.brief`; builders for `strong: true` slices use `models.strong`; all other builders use `models.slice`; the verifier uses `models.verifier`.
- Append `${BUILDER_SKILLS}` or `${VERIFIER_SKILLS}` to the prompt.

> **ORCHESTRATOR RULE — CODEX RUNTIME**: After calling Agent(), stop working on that agent's task. Do not read its files, edit its code, or run its checks while it is active; wait for its result.

Resume from `resume.state`: `new` → `research`; `brief_written` → `baseline`, then `approve`; `slices_in_progress` → `waves` (skip `resume.done_slices`; tell builders of `resume.partial_slices` that a `chore({P}-{slice}): partial` commit exists); `verifying` → `checks`; `gaps_found` → `checks`, then `fix_rounds`; `summarizing` → `summary`. These flags never build: `RESEARCH_ONLY` always goes to `research`, and `BRIEF_ONLY` with any state other than `new` shows `{BRIEF}`, `OUTCOME=stopped` → `next`.
</step>

<step name="research">
If `inputs.research` is not null: with `RESEARCH_ONLY`, show its path, `OUTCOME=stopped` → `next`; otherwise skip this step. Also skip it when `config.research` is false and `RESEARCH_ONLY` is not set.

```bash
RESEARCHER_MODEL=$(fvgsd-sdk query resolve-model fvgsd-phase-researcher --pick model)
RESEARCHER_SKILLS=$(fvgsd-sdk query agent-skills fvgsd-phase-researcher)
```

```
Agent(
  subagent_type="fvgsd-phase-researcher",
  description="Research phase {N}",
  model="{RESEARCHER_MODEL}",   # apply the spawning rules
  prompt="
<objective>
Research how to implement Phase {N}: {phase.name}.
Answer: what does the builder need to know to write a good build brief for this phase?
</objective>
<files_to_read>
- {inputs.context} (user decisions)
- {inputs.roadmap} (read only the Phase {N} section)
- {inputs.requirements} (if not null)
- {inputs.milestone_brief} (if not null)
</files_to_read>
<additional_context>
Phase requirement IDs: {inputs.requirement_ids}
Project instructions: read ./CLAUDE.md if it exists.
</additional_context>
<output>
Write to: {PHASE_DIR}/{P}-RESEARCH.md
</output>
${RESEARCHER_SKILLS}
")
```

- `## RESEARCH COMPLETE` → `fvgsd-sdk query commit "docs({P}): research" --files "{PHASE_DIR}/{P}-RESEARCH.md"`.
- `## RESEARCH BLOCKED` → interactive: show the blocker and ask "Provide context", "Skip research" or "Stop"; headless: `fvgsd-sdk query state.add-blocker --text "Phase {N} research: <blocker>"`, `OUTCOME=blocked` → `next`.
- With `RESEARCH_ONLY`: `OUTCOME=stopped` → `next`.
</step>

<step name="baseline">
Skip when `baseline.needs_run` is false or `BRIEF_ONLY` is set. The baseline records which failures already existed, and `build.run-checks` compares against it on every later run. Run `fvgsd-sdk query build.run-checks --phase {N} --set full --label baseline` in the first case that applies:

- `PAUSE` false, or `resume.state` is not `new` (its brief is already committed) → in the foreground now (for a new build, before the brief builder is spawned).
- `PAUSE` true and `runtime.background_tasks` true → as a background command, started now before the brief builder is spawned; the brief touches only `.planning/`. The `approve` step waits for it, so it finishes before approval ends and before any slice work or merge.
- `PAUSE` true otherwise → set `DEFER_BASELINE=true`; the `brief` step runs it in the foreground right after the brief commit.
</step>

<step name="brief">
Only for `resume.state` = `new`.

`CONTINUE=true` when `PAUSE` is false and `BRIEF_ONLY` is not set; otherwise `CONTINUE=false`. A needed baseline never changes it. The builder continues into slice `s1` only when its brief has exactly one slice and no `user_setup` items.

```
Agent(
  subagent_type="fvgsd-builder",
  description="Write build brief for phase {N}",
  model="{models.brief}",   # apply the spawning rules
  prompt="
<build_inputs>
mode: brief
phase_dir: {PHASE_DIR}
brief: {BRIEF}
context: {inputs.context}
research: {PHASE_DIR}/{P}-RESEARCH.md if it exists, else none
milestone_brief: {inputs.milestone_brief or none}
roadmap: {inputs.roadmap}
requirements: {inputs.requirements or none}
requirement_ids: {inputs.requirement_ids joined with ", "}
commands_json: {commands as one-line JSON}
base_commit: {BASE}
continue_to_slice: {CONTINUE}
gaps: {true when GAPS_FLAG is set, else false}
verification: {VERIFICATION when GAPS_FLAG is set, else none}
</build_inputs>
${BUILDER_SKILLS}
")
```

Expect `## BRIEF RESULT` (plus a `## SLICE RESULT` for `s1` when it continued; keep that result for `waves`). The builder has committed the brief. If `DEFER_BASELINE` is true, run `fvgsd-sdk query build.run-checks --phase {N} --set full --label baseline` in the foreground now. Then:

```bash
fvgsd-sdk query build.check-brief "{BRIEF}"
```

If `valid` is false, spawn the builder once more with the same inputs plus `brief_errors_json: <errors as one-line JSON>`, and check again. Still invalid → show the errors, `OUTCOME=blocked` → `next`.

```bash
fvgsd-sdk query state.begin-phase --phase "{N}" --name "{phase.name}" --plans 1
```

With `BRIEF_ONLY`: show the objective and slices, `OUTCOME=stopped` → `next`.
</step>

<step name="approve">
Read the brief's frontmatter `slices` and `user_setup`, its `<objective>`, and its Decisions table.

- `PAUSE` true in an interactive session: show the objective, each slice (id, goal, owns, after, strong) and the Decisions table, then ask "Build this brief?" with "Build" and "Stop" (AskUserQuestion; a numbered list in text mode). "Stop" → `OUTCOME=stopped` → `next`. If the user edited the brief first, run `fvgsd-sdk query build.check-brief "{BRIEF}"` again and resolve its errors with them before building.
- `CONFIRM` set in a headless session: `fvgsd-sdk query state.add-blocker --text "Phase {N}: the build brief awaits approval"`, `OUTCOME=blocked` → `next`.
- Each `user_setup` item: interactive → have the user complete it and confirm before building; headless → `fvgsd-sdk query state.add-blocker --text "Phase {N} setup: <item>"` for each, then `OUTCOME=blocked` → `next`.

Before this step ends by any path, wait for a background baseline to finish; no slice work or merge starts beside it.
</step>

<step name="waves">
```bash
fvgsd-sdk query build.waves "{BRIEF}"
```

Check `error` first: with `invalid_brief`, show its `errors`; `OUTCOME=blocked` → `next`. Otherwise `waves` lists slice ids in the order they must run. Skip slices already done (`resume.done_slices`, or a kept `status: done` result); a kept `blocked` or `partial` result goes to **Slice results** below. For every other slice the builder prompt is:

```
<build_inputs>
mode: slice
phase_dir / brief / context / research / milestone_brief / roadmap / requirements / requirement_ids / commands_json: as in the brief step
base_commit: {WAVE_BASE}, the HEAD when this wave started
slice: {id}
goal: {goal}
owns: {owns joined with ", "}
known_failures: {one-line JSON of new failures from earlier waves, or none}
other_slice_notes: {for a resumed partial slice: "chore({P}-{id}): partial exists — continue from it"; else none}
</build_inputs>
```

**Parallel tier**, per wave:
1. `WAVE_BASE=$(git rev-parse HEAD)`.
2. Dispatch one `Agent(subagent_type="fvgsd-builder", description="Build slice {id} of phase {N}", model=..., isolation="worktree", prompt=...)` per message — never several Agent calls in one message, because parallel `git worktree add` races on `.git/config.lock`. Pass `run_in_background: true` where that parameter exists; where it does not, subagents already run in the background. Keep at most `config.max_concurrent_agents` running and collect each SLICE RESULT when its completion arrives.
3. Merge the isolated slices. The JSON holds only `slice`, `status`, `branch`, `worktree_path` and `commits`, so it contains no single quotes:
   ```bash
   fvgsd-sdk query build.merge-wave --phase {N} --base "$WAVE_BASE" --results '<json array of those results>'
   ```
   Check `error` first (**Query errors** in `initialize`).
4. For each `conflicts` entry: spawn one builder without `isolation`, with that slice's prompt plus `merge_from: {current branch}`, `worktree_path: {that slice's worktree}` and `other_slice_notes: {the other slices' notes}`, and no `fix_goal` or `fix_problems_json` (`merge_from` alone selects the builder's merge goal). It commits `fix({P}-{slice}): resolve merge with {other}`. Then rerun `build.merge-wave` with only that slice's result and the same `--base "$WAVE_BASE"`; a base taken from the moved HEAD fails with `base_mismatch` once two conflicts are resolved before either rerun.
5. Show each `blocked` entry (slice, reason, detail) together with each `skipped` entry (slice, reason). A slice listed in `merged` whose only `blocked` entry is `cleanup_failed` did merge: keep its leftover worktree or branch for the summary's Follow-ups and continue. Any other `blocked` entry → `OUTCOME=blocked` → `next`.

**Sequential tier:** spawn the same prompts one at a time, in wave order, without `isolation`. Builders commit on the current branch; there is no merge.

**Inline tier:** for each slice, follow slice mode in `fvgsd-builder.md` from the installed agents folder yourself.

**Slice results:**
- `done` → record commits and notes.
- `blocked` or `partial` with a `question` → interactive: put the question to the user, then continue the same agent with the answer where the runtime supports continuing an agent; otherwise spawn a new builder with the same inputs plus `other_slice_notes: <answer>; existing commits: <commits>`. In the parallel tier, when that slice then finishes, rerun `build.merge-wave` with only its result and `--base "$WAVE_BASE"`. Headless: let the rest of the wave finish, run `fvgsd-sdk query state.add-blocker --text "Phase {N} slice {id}: <question>"` for each question, then `OUTCOME=blocked` → `next`.
- No SLICE RESULT (the agent crashed): check `git log --oneline {BASE}..` (and the slice worktree when isolated), and spawn one new builder told which commits exist. A second failure makes the slice blocked.

After each wave:

```bash
fvgsd-sdk query build.run-checks --phase {N} --set wave
```

Check `error` first. Add results that fail (`exit` not 0 or `timed_out`) with `preexisting: false` to `KNOWN_FAILURES` for the next wave. Do not stop for them; the fix rounds handle what remains.
</step>

<step name="checks">
```bash
fvgsd-sdk query build.run-checks --phase {N} --set full
fvgsd-sdk query build.scan-stubs --base "{BASE}"
```

Check the run-checks `error` first. A **new failure** is a result that is not skipped, fails (`exit` not 0 or `timed_out`), and either has `preexisting: false` or has `preexisting: true` with an `output_tail` naming different failing tests or errors than the baseline's (`$(git rev-parse --git-common-dir)/fvgsd/build/{P}/baseline.json`). Record skipped commands as skipped.

For `resume.state` = `gaps_found`, skip `verify` and go to `fix_rounds`.
</step>

<step name="verify">
```bash
git diff --stat "{BASE}"..HEAD -- . ':(exclude).planning' | tail -1
git diff --name-only "{BASE}"..HEAD -- . ':(exclude).planning'
```

```
Agent(
  subagent_type="fvgsd-verifier",
  description="Verify phase {N} build",
  model="{models.verifier}",   # apply the spawning rules
  prompt="
Verify phase {N}: {phase.name}.
<build_mode>
brief: {BRIEF}
verification_path: {VERIFICATION}
human_uat_path: {HUMAN_UAT}
human_checks: {config.human_checks}
checks_json: {full run-checks result as one-line JSON}
stubs_json: {scan-stubs result as one-line JSON}
slice_results: {one entry per slice: id, status, commits, notes}
diff_stat: {the diff --stat summary line}
changed_files: {changed files joined with ", "}
context: {inputs.context}
roadmap: {inputs.roadmap}
requirement_ids: {inputs.requirement_ids joined with ", "}
recheck_gaps:
</build_mode>
${VERIFIER_SKILLS}
")
```

When `config.code_review` is true, also spawn once `Agent(subagent_type="fvgsd-code-reviewer", description="Review phase {N} build diff", prompt=...)` whose prompt holds a `<config>` block with `depth: standard`, `phase_dir: {PHASE_DIR}`, `review_path: $(git rev-parse --git-common-dir)/fvgsd/build/{P}/REVIEW.md` (outside the working tree), `diff_base: {BASE}` and `files:` with one `- <path>` line per changed file, and says not to commit the report. Its Critical findings become problems; Warning and Info findings go into the summary.

Read `{VERIFICATION}`: frontmatter `status` is `passed`, `gaps_found` or `human_needed`, and `gaps` lists the open gaps.
</step>

<step name="fix_rounds">
Build the problem list as JSON objects `{ "kind", "summary", "files" }`:
- each new check failure → `kind: "check"`, summary `<name> failed: <first error line>`, files named in its output tail
- each VERIFICATION.md `gaps` entry → `kind: "gap"`, summary from its `truth` and `reason`, files from `artifacts[].path`
- each stub finding → `kind: "stub"`, files `[file]`
- each Critical review finding → `kind: "review"`

While problems remain and `ROUND` < `config.fix_rounds`:
1. `ROUND=$((ROUND + 1))`; `PREV_COUNT` = the number of problems.
2. Group them (replace any single quote inside summaries with ’):
   ```bash
   fvgsd-sdk query build.group-problems --brief "{BRIEF}" --problems '<problems json>'
   ```
3. For each batch in `batches`, spawn one builder per group in that batch under the tier rules (parallel tier: record `WAVE_BASE`, use `isolation`, then `build.merge-wave`). Inputs: the slice prompt for `slice: {group.slice}` (for `fix`, `owns` is the group's files) plus `fix_goal: fix the listed problems` and `fix_problems_json: {that group's problems}`. Builders commit `fix({P}-{slice}): <what>`.
4. Rerun only what failed, plus build and typecheck (check the run-checks `error` first):
   ```bash
   fvgsd-sdk query build.run-checks --phase {N} --set full --only <failed names>,build,typecheck
   fvgsd-sdk query build.scan-stubs --base "{BASE}"
   ```
5. Recheck: spawn the verifier with the same `<build_mode>` block, updated `checks_json` and `stubs_json`, and `recheck_gaps:` set to the open gaps' truths. It rewrites `{VERIFICATION}`.
6. Rebuild the problem list. If the count is not lower than `PREV_COUNT`, stop the loop.

When problems remain, VERIFICATION.md keeps `status: gaps_found` and they go into the summary's Follow-ups.
</step>

<step name="summary">
Read `~/.claude/fvgsd/references/build-summary.md`. With the Write tool, write `{SUMMARY}`: frontmatter holding only `subsystem` and `tags` (finalize fills the rest), then the body sections from that reference — what each slice built with commit hashes, the Decisions table covering every D-XX in CONTEXT, deviations from the brief, checks (including pre-existing failures and skipped commands), verification status linking `{P}-VERIFICATION.md`, review Warning/Info findings, and follow-ups (including any worktree or branch left by `cleanup_failed`). When `resume.summary` is not null, an earlier finalize was refused or did not finish: read that summary and complete it instead of starting over.

`IDS` = the requirement IDs this build satisfied: every ID in `inputs.requirement_ids` when verification passed, otherwise only those VERIFICATION.md shows satisfied.

```bash
fvgsd-sdk query build.finalize --phase {N} --plan {PLAN} --base "{BASE}" --engine agents --tier {TIER} --fix-rounds {ROUND} --requirements-completed "{IDS joined with commas}"
```

Pass `--requirements-completed` only when `IDS` holds at least one ID; otherwise omit the flag, because an empty value is rejected.

- `ok: false` → for every ID in `missing.decisions` and `missing.requirements`, add a line to the summary saying where it landed or why it was deferred, then run finalize again.
- `ok: true` → keep `phase_complete`, `commit` and `warnings`. `OUTCOME=complete` when VERIFICATION.md is `passed`, `OUTCOME=gaps` when it is `gaps_found`, and `OUTCOME=stopped` when it is `human_needed` (only `human_checks: block` gives that status; under `defer`, human-only items stay in HUMAN-UAT.md and leave the status alone).
</step>

<step name="next">
If a background baseline is still running, wait for it to finish. Then print a short actions-taken report: slices built, merge-wave `blocked` and `skipped` slices, commits, checks (pass, fail, skipped, pre-existing), verification status, fix rounds used, and any `warnings`.

Then suggest one next command in this runtime's command form (the fvgsd command prefix followed by the name and arguments below). Use `NEXT` when a step set it; otherwise:
- The run is `blocked` or `stopped` with an unfinished brief (`{BRIEF}` exists, and `{SUMMARY}` is missing or has no `kind: build-summary`) → `build {N}`
- The phase is complete → `fvgsd-sdk query roadmap.analyze`: take the first later phase that is not complete. Suggest `build <it>` only when it has CONTEXT.md (`has_context` true) and no plans yet (`disk_status` `discussed` or `researched`), `discuss-phase <it>` otherwise, and `complete-milestone` when no phase remains.
- Gaps remain → `build {N} --gaps`
- HUMAN-UAT items are pending → `verify-work {N}`

When `fvgsd-sdk query config-get workflow.build_mode --default true` prints `false`, suggest `plan-phase` in place of `build` in any suggestion above or in `NEXT` (`build {N} --gaps` becomes `plan-phase {N} --gaps`). Never replace the unfinished-brief suggestion: it stays `build {N}`, because execute-phase refuses briefs.

End with exactly one of these lines, matching `OUTCOME`:

`complete` — the build finished, or was already complete, with no open gaps:

```text
## BUILD COMPLETE
```

`gaps` — verification gaps remain:

```text
## BUILD GAPS FOUND
```

`blocked` — a question, setup item, approval, conflict, invalid brief or error stopped the build:

```text
## BUILD BLOCKED
```

`stopped` — `--research-only` or `--brief-only` finished, the user chose Stop, or init sent the user to another command:

```text
## BUILD STOPPED
```
</step>

</process>
