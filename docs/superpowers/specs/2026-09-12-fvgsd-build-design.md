# Design: /fvgsd-build — plan and execute in one step

**Date:** 2026-09-12
**Status:** Design approved in conversation; spec awaiting review
**Sub-project:** 2 of 2. Implement after `2026-09-12-fvgsd-identity-design.md`; names below assume it is done.

---

## Summary

`/fvgsd-build <phase>` replaces the separate plan-phase and execute-phase steps for a discussed phase. It:

1. Reads the phase's inputs:
   - CONTEXT.md
   - RESEARCH.md (researching first only if it is missing)
   - the phase's ROADMAP section
   - REQUIREMENTS.md
   - a milestone brief, if one exists
2. Writes a short direction brief.
3. Builds the phase in a few vertical slices, in parallel where the runtime supports it.
4. Verifies with real commands plus one verifier pass.
5. Fixes remaining problems in a capped number of rounds (two by default).
6. Ends with an actions-taken summary.

Each phase gets a brief, a summary and VERIFICATION.md. RESEARCH.md is added only when build had to create it, and HUMAN-UAT.md only when human-only checks exist. The brief and summary reuse the PLAN and SUMMARY file names, so status checks, routing, the SDK runner, the verifier and VibeClaw keep working. `plan-phase` and `execute-phase` stay available.

It is built Claude Code first. The faster behaviors are switched on per runtime from a capability table: parallel slices in worktrees, per-call model choice, background commands and saved workflow scripts. Other runtimes gain them by turning their switches on.

---

## Problem

Planning a phase can take hours, much of it spent writing, reviewing and re-validating plan documents, and execution adds hours of document ceremony on top. The causes are in the current workflows.

### Causes (as of commit 29f1b1a6)

**Planning**
- **Plans restate everything.** Executors receive CONTEXT.md, RESEARCH.md and earlier SUMMARYs only when `context_window >= 500000` (`get-shit-done/workflows/execute-phase.md:632-636`). The default is 200000, so every PLAN repeats that material.
- **The revision loop builds in rework.** The planner/checker loop counts warnings as issues and exits only on a clean pass. The workflow, planner and checker also describe the plan format inconsistently:
  - `read_first` is mandatory in the workflow but missing from the planner's task definition.
  - The planner accepts a plain `<verify>`, while the checker treats a missing `<automated>` as a blocker.

  The worst case is about 18 planner and checker spawns.
- **Correct plans fail the decision-coverage gate.** `sdk/src/query/check-decision-coverage.ts` counts a `D-XX` citation only in frontmatter `must_haves`, `truths` or `objective`, or under a markdown heading named must_haves, truths, tasks or objective. A citation inside an XML `<action>` block with no such heading fails the gate and forces a replan.
- **Duplicate work.** Requirement and decision coverage is checked five times. Research is effectively done twice: once by the researcher, then again in the planner's mandatory discovery.

**Execution**
- **Gap closure has no cap.** Verification gaps start a plan → execute → review → verify cycle with no limit. Only the SDK runner caps it, at 1.
- **Cold starts.** Each executor loads about 36K tokens of instructions before reading its plan, and every checkpoint continuation pays that again.
- **Repeated test runs.** The full test suite runs after every wave and again at the end.
- **Per-plan close-out.** Each plan ends with a SUMMARY from a 248-line template, 6+N state calls and a metadata commit.
- **Merges in the prompt.** Worktree merges are about 160 lines of shell inside the workflow prompt.

These costs come from one assumption: an expensive model writes exhaustive plans so that a cheaper executor with limited context can follow them. That no longer holds, because current Claude models offer a 1M-token context on eligible plans.

---

## Goals

- One command takes a discussed phase to a verified implementation.
- A phase's new planning files are the brief, the summary and VERIFICATION.md. RESEARCH.md is added only when missing, and HUMAN-UAT.md only when human-only checks exist.
- No agent reviews planning documents. Document checks are scripts over fields that code reads.
- Verification uses commands plus one verifier pass, with at most `workflow.build_fix_rounds` fix rounds.
- It works on every runtime, and faster tiers switch on per runtime capability.
- Existing status checks, routing, the SDK runner and VibeClaw keep working, and plan-phase and execute-phase stay available.

## Non-goals

- Removing plan-phase or execute-phase.
- Slimming the phase researcher (separate follow-up).
- Changing discuss-phase.
- Building the saved Claude Code workflow engine. It is designed under Stage 2 below and built after Stage 1 has settled.

---

## Architecture

```text
/fvgsd-build <phase> [--confirm] [--gaps] [--research-only] [--brief-only]
    │
    ├─ fvgsd-sdk query init.build        → inputs, check commands, capabilities, config, resume state, baseline
    ├─ stop if no CONTEXT.md             → suggest /fvgsd-discuss-phase <phase>
    ├─ research if RESEARCH.md missing   → fvgsd-phase-researcher              (--research-only stops here)
    ├─ baseline checks if needed         → build.run-checks --set full --label baseline (background during the brief, else right after it)
    ├─ fvgsd-builder, brief mode         → {P}-{NN}-PLAN.md, build.check-brief, commit    (--brief-only stops here)
    │    └─ --confirm or mode: interactive → user approves; user_setup items asked before building
    ├─ build.waves                        → ordered waves of slices
    │    └─ per wave: fvgsd-builder, slice mode, per slice → build.merge-wave → build.run-checks --set wave
    ├─ build.run-checks --set full, build.scan-stubs
    ├─ fvgsd-verifier, build mode        → {P}-VERIFICATION.md (+ {P}-HUMAN-UAT.md)
    ├─ fix rounds ≤ build_fix_rounds     → build.group-problems → fvgsd-builder per slice → rerun failed checks → verifier recheck
    ├─ lead writes {P}-{NN}-SUMMARY.md body
    └─ build.finalize                     → summary frontmatter, ID coverage, STATE/ROADMAP/REQUIREMENTS, commit
```

`{P}` is the padded phase number used in existing file names (for example `03`). `{NN}` is `01` for the first build and the next free plan number for `--gaps`.

### Components

| Component | Path | Purpose |
|---|---|---|
| Command | `commands/gsd/build.md` | `name: fvgsd:build`; argument hint `<phase> [--confirm] [--gaps] [--research-only] [--brief-only]`; execution-branch guard block like other commands |
| Workflow | `get-shit-done/workflows/build.md` | Lead instructions; target 400 lines or fewer |
| Agent | `agents/fvgsd-builder.md` | Brief and slice modes; target 10KB or smaller; no embedded reference dumps |
| Format references | `get-shit-done/references/build-brief.md`, `get-shit-done/references/build-summary.md` | Brief and summary formats, read on demand |
| Query handlers | `sdk/src/query/build-*.ts`, family manifest `sdk/src/query/command-manifest.build.ts`, `init.build` added to `command-manifest.init.ts`, handlers mapped in `command-family-handlers.ts` | `init.build`, `build.check-brief`, `build.waves`, `build.merge-wave`, `build.run-checks`, `build.scan-stubs`, `build.group-problems`, `build.finalize`, `checks.detect` |
| Capability table | `sdk/shared/runtime-capabilities.json` | Per-runtime switches |
| VibeClaw template | `get-shit-done/vibe/templates/workflows/feature-build.yaml` | Stage workflow using build |
| Stage 2 script | `get-shit-done/workflows/claude/fvgsd-build-slices.js` | Saved Claude Code workflow (Stage 2 only) |

`command-aliases.generated.ts` is regenerated, and `npm run check:alias-drift` must pass.

### Setup: `init.build <phase> [--gaps]`

Returns JSON:

```json
{
  "phase": { "number": "3", "padded": "03", "name": "user-auth", "dir": ".planning/phases/03-user-auth" },
  "inputs": {
    "context": ".planning/phases/03-user-auth/03-CONTEXT.md",
    "research": ".planning/phases/03-user-auth/03-RESEARCH.md",
    "spec": null,
    "ui_spec": null,
    "milestone_brief": null,
    "requirement_ids": ["AUTH-01", "AUTH-02"]
  },
  "commands": { "build": "npm run build", "typecheck": "npx tsc --noEmit", "lint": "npm run lint", "test": "npm test" },
  "runtime": { "name": "claude", "spawn_agents": true, "parallel_agents": true, "worktree_isolation": true, "per_call_model": true, "agent_effort": true, "background_tasks": true, "workflow_scripts": true },
  "config": { "research": true, "fix_rounds": 2, "human_checks": "defer", "code_review": false, "parallel": "auto", "engine": "agents", "max_concurrent_agents": 3, "check_timeout_seconds": 1800, "mode": "yolo", "security_enforcement": false, "commit_docs": true },
  "models": { "brief": "opus", "slice": "sonnet", "strong": "opus", "verifier": "sonnet" },
  "resume": { "state": "new", "plan": "01", "brief": null, "summary": null, "done_slices": [], "partial_slices": [], "base_commit": "abc1234" },
  "baseline": { "last_passing_commit": null, "code_head": "abc1234", "needs_run": true }
}
```

- **Check commands.** Values set in `workflow.build_command`, `workflow.typecheck_command`, `workflow.lint_command` and `workflow.test_command` win. Otherwise `checks.detect` inspects the project.
  - It moves the detection that `get-shit-done/workflows/execute-phase/steps/post-merge-gate.md` currently does in shell into code, and `post-merge-gate.md` switches to calling `checks.detect`.
  - It adds typecheck and lint detection:
    - `package.json` scripts named `typecheck`, `type-check` or `lint`
    - `npx tsc --noEmit` when `tsconfig.json` exists
    - `ruff check` and `mypy` for Python
    - `cargo clippy`
    - `go vet ./...`
    - `lint` and `typecheck` targets in a Makefile or Justfile
  - A command that is neither configured nor detected is `null` and is reported as skipped wherever it would run.
- **Milestone brief.** The first file that exists of `.planning/MILESTONE-CONTEXT.md` and `.planning/MILESTONE-BRIEF.md`.
- **Models.** Resolved with the existing model-profile resolution, including `models` and `model_overrides`:
  - `brief` and `strong` use the planning-tier model.
  - `slice` uses the model of the new `fvgsd-builder` row: quality opus, balanced sonnet, budget sonnet, adaptive sonnet, inherit inherit. The row belongs to the `execution` phase type.
  - `verifier` is unchanged.
- **Resume state**, derived from files and git only:
  - `new`: no brief exists for the current plan number.
  - `brief_written`: the brief exists and no slice has commits.
  - `slices_in_progress`: at least one slice lacks its `feat({P}-{slice})` commit. `partial_slices` lists those with a `chore({P}-{slice}): partial` commit.
  - `verifying`: every slice has its `feat` commit, and VERIFICATION.md is missing or older than the last `feat` or `fix` commit.
  - `gaps_found`: VERIFICATION.md has status `gaps_found` and is newer than the last `feat` or `fix` commit.
  - `complete`: the summary exists and VERIFICATION.md has status `passed`. The command prints the status and stops.
- **Baseline.** `last_passing_commit` is `build.checks_passed_at` from the most recent summary with `kind: build-summary`, across all phases. `code_head` is the latest commit that changed files outside `.planning/`. `needs_run` is false when the two have the same code tree. A build never re-baselines at a HEAD that holds its own commits, so `needs_run` is also false for a gap build (`--gaps`, or a resumed gap brief) and for a build resumed past `brief_written`: the phase's `baseline.json` still describes what was broken before its first build, and without one every failure counts as new. It is false as well when `baseline.json` was taken at `code_head`'s code tree.
- **Gap runs.** With `--gaps`, `resume.plan` is the next free plan number and `resume.state` describes that plan. While the latest brief's summary is not finalized (`kind: build-summary` missing), `--gaps` resumes that brief instead.

### Brief: `{P}-{NN}-PLAN.md`

Everything in the frontmatter is read by code:

```yaml
---
phase: 03-user-auth
plan: 01
type: execute
kind: brief
wave: 1
depends_on: []
files_modified: [src/auth/session.ts, src/auth/password.ts, src/routes/auth/login.ts]
autonomous: true
requirements: [AUTH-01, AUTH-02]
user_setup: []
gap_closure: false
must_haves:
  truths:
    - "A user with valid credentials can sign in and stays signed in after a reload"
  artifacts: []   # same item format as get-shit-done/templates/phase-prompt.md
  key_links: []   # same item format as get-shit-done/templates/phase-prompt.md
slices:
  - id: s1
    goal: "Session model and password hashing"
    owns: ["src/auth/**", "migrations/*auth*.sql"]
    after: []
    strong: false
  - id: s2
    goal: "Login and logout routes"
    owns: ["src/routes/auth/**", "app/login/**"]
    after: [s1]
    strong: false
---
```

Body:

```markdown
<objective>
What this phase delivers and why, in one to three paragraphs. The plan index reads the first line.
</objective>

## Approach
Key design choices, interfaces shared between slices, and data flow.

## Slices
### s1 — Session model and password hashing
Owns: src/auth/**, migrations/*auth*.sql
Done when: …

## Decisions
| Decision | Where it lands | Status |
|---|---|---|
| D-01 | s1: argon2id hashing in src/auth/password.ts | planned |
| D-04 | — | deferred: SSO moves to a later phase per CONTEXT |

## Checks
build: npm run build · typecheck: npx tsc --noEmit · lint: npm run lint · test: npm test

## Risks
A short list, plus threat notes when `security_enforcement` is on.

## Judgment calls
The choices CONTEXT left to Claude's discretion, and what was chosen.
```

The target length is 100 to 200 lines. This is guidance only and is not checked.

**`build.check-brief <path>`** checks only the following and returns `{ "valid": bool, "errors": [{ "field": "slices[1].after[0]", "message": "…" }] }`:
- the existing plan frontmatter schema: `phase`, `plan`, `type`, `wave`, `depends_on`, `files_modified`, `autonomous`, `must_haves`
- `kind: brief`
- `requirements` is non-empty when `inputs.requirement_ids` is non-empty
- `slices` has at least one entry; ids match `^s[0-9]+$` and are unique; every `after` id exists; there are no cycles; `owns` is non-empty
- an `<objective>` block is present

The builder fixes any errors in the same turn. Nothing else about the brief is checked.

**Approval.** With `--confirm` or `mode: interactive`, the lead shows the objective, the slices and the decisions table, and asks whether to continue or stop. If the user edits the brief first, the lead runs `build.check-brief` again before building.

**Gap briefs.** A `--gaps` brief has `gap_closure: true`, `depends_on: ["{P}-{previous NN}"]` and `wave` set to the previous wave plus one. Its slices cover only the gaps listed in VERIFICATION.md.

### Builder agent: `agents/fvgsd-builder.md`

```yaml
---
name: fvgsd-builder
description: Writes the build brief for a phase, or builds one slice of it, for /fvgsd-build.
tools: Read, Write, Edit, Bash, Grep, Glob
effort: high
---
```

- **Frontmatter per runtime.** Runtime converters drop keys the target runtime doesn't support. The builder never spawns agents.
- **Inputs.** The lead passes paths, not file contents: mode, phase folder, brief, slice id, CONTEXT, RESEARCH, milestone brief, ROADMAP, REQUIREMENTS, the check commands as JSON, owned globs and base commit.
- **Model per call.**
  - Brief-mode runs pass `models.brief`, and `strong: true` slices pass `models.strong`, as a per-call model when `per_call_model` is on.
  - Otherwise, including all other slices, the agent runs on its profile row model.

**Brief mode**
1. Reads the inputs and the relevant code, and writes the brief.
2. Runs `build.check-brief`.
3. Commits `docs({P}): build brief`.
4. Returns:

```text
## BRIEF RESULT
brief: .planning/phases/03-user-auth/03-01-PLAN.md
slices: [s1, s2, s3]
user_setup: []
```

When the lead's prompt says `continue_to_slice: true`, the builder goes straight on to build `s1` in slice mode in the same run and also returns a SLICE RESULT. The lead sets this only when all of these hold:
- the brief has exactly one slice
- neither `--confirm` nor `mode: interactive` applies
- `user_setup` is empty

**Slice mode**
- Works on files matching `owns`. If it must change other files, it keeps those changes minimal and lists them.
- Before its `feat` commit, runs `build.run-checks --set quick` (typecheck and lint) plus the tests relevant to the slice, choosing the test arguments itself (for example a path filter). It may run these earlier whenever it wants feedback.
- Does not report `done` while these checks fail.
- Ends with exactly one `feat({P}-{slice}): <goal>` commit. If it stops early, it commits the work so far as `chore({P}-{slice}): partial — <reason>`.
- When run with worktree isolation, reports its branch and worktree path.
- Returns:

```text
## SLICE RESULT
slice: s2
status: done | blocked | partial
commits: [<sha>]
branch: <branch or empty>
worktree_path: <path or empty>
outside_owned_files: []
deviations: []
checks: { typecheck: pass, lint: pass, tests: "14 passed" }
question: ""
notes: |
  Up to 20 lines for the summary.
```

### Slices, waves and tiers

- **`build.waves <brief>`** returns `{ "waves": [["s1"], ["s2", "s3"]] }`. A slice runs only after every slice in its `after` list. Slices whose `owns` globs overlap never share a wave; the later one moves to the next wave.
- **Tier**, from `init.build.runtime` and config:
  1. **Parallel.** When `spawn_agents`, `parallel_agents` and `worktree_isolation` are on and `workflow.build_parallel` is `auto`, up to `max_concurrent_agents` slices of a wave run at once, each spawned with worktree isolation.
  2. **Sequential.** When agents can be spawned but the parallel conditions aren't met, one slice agent runs at a time in the main worktree, in wave order.
  3. **Inline.** When `spawn_agents` is off, the lead follows the builder instructions itself, slice by slice.
- **Merge.** `build.merge-wave --phase <P> --results <json>` merges each isolated slice branch into the current branch with `--no-ff`, in wave order. It then applies the cleanup logic behind the existing `worktree.cleanup-wave` query and returns `{ "merged": ["s2"], "conflicts": [{ "slice": "s3", "files": ["src/routes/index.ts"] }], "cleaned": ["<path>"] }`.
  - On a conflict it aborts that merge, leaving the tree clean, and continues with the other slices.
  - The lead then spawns a builder in slice mode on the conflicting branch. Its goal is to merge the current branch in and resolve the conflict, and it gets both slices' notes.
  - That builder commits `fix({P}-{slice}): resolve merge with {other}`, and the lead calls `build.merge-wave` again for that slice.
- **After each wave:** `build.run-checks --set wave`.
- **Blocked slices.**
  - **Interactive session:** the lead asks the user, then resumes the slice with the answer. It continues the same agent where the runtime supports that; otherwise it starts a new agent that is told which commits already exist.
  - **Headless run:** the lead finishes the current wave, records each question with `state.add-blocker` and exits non-zero.
- **Crashed slice agent.** Retried once with a new agent that is told which commits already exist. A second failure marks the slice blocked.
- **`user_setup` items.** Asked before the first wave in an interactive session. In a headless run they are recorded with `state.add-blocker` and the run exits before building.

### Runtime capability table: `sdk/shared/runtime-capabilities.json`

```json
{
  "claude": {
    "spawn_agents": true,
    "parallel_agents": true,
    "worktree_isolation": true,
    "per_call_model": true,
    "agent_effort": true,
    "background_tasks": true,
    "workflow_scripts": true
  }
}
```

- **Other runtimes.** Every other runtime in `runtime-artifact-layout.cjs` gets an entry. Its values are set during implementation from that runtime's current documentation, and any value not confirmed there is `false`.
- **Unknown runtimes** resolve to all `false`.
- **Upgrading a runtime.** Turning a switch on for a runtime is the only change needed to give it the faster behavior.

### Checks

**`build.run-checks --set quick|wave|full [--label <name>] [--only <names>]`**
- Runs the resolved commands, each with a timeout of `workflow.build_check_timeout_seconds`.
- Stores the result under `<git-common-dir>/fvgsd/build/{P}/<label or set>.json`, outside the working tree, and records each command's latest result, with the commit it ran at, in `<git-common-dir>/fvgsd/build/{P}/latest.json`.
- Returns:

```json
{ "set": "full", "passed": false, "results": [
  { "name": "test", "command": "npm test", "commit": "abc1234", "exit": 1, "timed_out": false, "skipped": false, "duration_ms": 81234, "preexisting": true, "output_tail": "last 200 lines" }
] }
```

- **Sets:** `quick` runs typecheck and lint. `wave` runs build and typecheck. `full` runs build, typecheck, lint and test. `--only` narrows any set to the named commands.
- **Baseline.** When `baseline.needs_run` is true, the lead runs `build.run-checks --set full --label baseline`: in the background while the brief is written where `background_tasks` is on, otherwise in the foreground right after the brief.
- **Pre-existing failures.** A failing command is marked `preexisting: true` when the same command also failed in the baseline. The lead compares the two output tails and counts only failures missing from the baseline as new. Pre-existing failures are reported in the summary and do not block.
- **Stub scan.** `build.scan-stubs --base <commit>` runs the marker scan now inside `PhaseRunner.checkArchitecturalDebt` (`sdk/src/phase-runner.ts`), extracted into a shared function that takes a file list. It scans the files changed since the base commit and returns `[{ "file", "line", "marker" }]`.

### Verification

- **Verifier inputs.** The lead spawns `fvgsd-verifier` with a build-mode block in its prompt. The inputs are:
  - the brief path
  - the slice results
  - the full `build.run-checks` result
  - the stub findings
  - the diff stat and the files changed since the base commit
  - the CONTEXT decisions
  - the phase's ROADMAP success criteria and requirement IDs
- **Rules in build mode.** `agents/fvgsd-verifier.md` gains a build-mode section: the verifier does not rerun the full test suite, but may run targeted probe commands. It writes `{P}-VERIFICATION.md` in the existing format (frontmatter `phase`, `verified`, `status`, `score`, plus the gaps list).
- **Human-only checks** (visual or manual flows) go to `{P}-HUMAN-UAT.md` in the existing format. With `workflow.build_human_checks: defer` (the default) they don't affect `status`. With `block`, the status is `human_needed`.
- **Optional code review.** When `workflow.build_code_review` is true, the lead also spawns `fvgsd-code-reviewer` once over the diff. Its Critical findings join the fix list; Warning and Info findings are listed in the summary.

### Fix rounds

1. **Problems** are the new check failures, verifier gaps, stub findings and (when code review is on) Critical review findings.
2. **Grouping.** `build.group-problems` maps each problem to the slice that owns its file. Problems with no owner go to the slice owning the most files in the same directory. If no slice does, they form a group with slice id `fix`, whose commits use the scope `{P}-fix`.
3. **Fixing.** The lead spawns a builder per group; groups with disjoint files run in parallel under the same tier rules. Each builder commits `fix({P}-{slice}): <what>`.
4. **Rechecking.** Only the failed commands rerun, plus build and typecheck. Then the verifier rechecks only the open gaps.
5. **Stopping.** The loop ends when no problems remain, after `workflow.build_fix_rounds` rounds (default 2), or early when a round doesn't reduce the number of problems.
6. **If problems remain,** VERIFICATION.md keeps status `gaps_found`, the summary lists what is left, and the next-step output suggests `/fvgsd-build {phase} --gaps`.

### Summary and finalize

**Summary file.** The lead writes the body of `{P}-{NN}-SUMMARY.md`, along with the schema-required `subsystem` and `tags`:

```markdown
# Phase 3: User Auth — Build Summary

**One-line outcome.**

## What was built
Per slice: what it delivered, with commit hashes.

## Decisions
| Decision | Status | Notes |
|---|---|---|
| D-01 | done | argon2id hashing in src/auth/password.ts |

## Deviations from the brief

## Checks
Commands and results, including any pre-existing failures.

## Verification
Status and a link to 03-VERIFICATION.md.

## Follow-ups
Remaining gaps, deferred human checks, deferred decisions.
```

**`build.finalize --phase <P> --plan <NN> --base <commit> --engine <agents|workflow> --tier <parallel|sequential|inline> --fix-rounds <n> --requirements-completed <ids>`**

1. **Summary frontmatter.** Fills or overwrites:
   - `phase`, `plan` and `kind: build-summary`
   - `duration` and `completed`, with the start taken from the brief commit time
   - `key-files.created` and `key-files.modified`, from `git diff --name-status <base>..HEAD` with `.planning/` excluded
   - `requirements-completed`
   - a `build` block: `started`, `completed`, `engine`, `tier`, `slices`, `fix_rounds`, `checks`, and `checks_passed_at`. `checks_passed_at` is the latest commit outside `.planning/`. It is set only when every non-skipped command's latest result in `latest.json` passed at that commit; otherwise it is `null`.
2. **ID coverage.** Collects every `D-XX` from the CONTEXT `<decisions>` block and every requirement ID in the phase's ROADMAP section, then searches the whole brief and summary text for each, in any location. If any are missing it returns `{ "ok": false, "missing": { "decisions": [], "requirements": [] } }` without changing state. The lead adds a line for each and runs finalize again.
3. **State updates**, through the existing state, requirements and roadmap logic:
   - STATE.md position
   - requirements marked complete
   - ROADMAP.md plan progress
   - the phase marked complete only when VERIFICATION.md status is `passed`
4. **Commit.** Commits `docs({P}): build summary and verification`, respecting `commit_docs`.
5. **Result.** Returns `{ "ok": true, "phase_complete": bool, "commit": "<sha>" }`.

The command then prints the next step:
- `/fvgsd-discuss-phase` or `/fvgsd-build` for the next phase
- `/fvgsd-build {phase} --gaps` when gaps remain
- `/fvgsd-verify-work {phase}` when HUMAN-UAT items are pending

---

## Integration

### Phase status and routing

Status checks are unchanged: a brief counts as a plan and a build summary counts as its SUMMARY. With `workflow.build_mode: true` (the default), the suggestions change:

| Situation | Suggestion |
|---|---|
| CONTEXT.md exists, no plans | `/fvgsd-build N` |
| An incomplete plan has `kind: brief` | `/fvgsd-build N` (resume) |
| Build phase with VERIFICATION.md `gaps_found` | `/fvgsd-build N --gaps` |
| `do` receives "build phase N" | `/fvgsd-build N` |

- **Code:** `sdk/src/query/route-next-action.ts`, and the manager recommended actions in `get-shit-done/bin/lib/init.cjs`.
- **Workflows:** `get-shit-done/workflows/next.md`, `progress.md`, `manager.md`, `autonomous.md` (plan and execute become one build step, and gap closure uses `--gaps`), `transition.md`, `discuss-phase/modes/chain.md` (chains into build) and `do.md`.
- **Plan index:** `phase-plan-index` (`sdk/src/query/phase.ts` and `get-shit-done/bin/lib/phase.cjs`) adds `kind` for each plan.
- **execute-phase:** if any incomplete plan has `kind: brief`, it stops with: "Phase N was started with /fvgsd-build — run /fvgsd-build N to resume."
- **Turning it off:** with `workflow.build_mode: false`, all suggestions revert to plan-phase and execute-phase.

### SDK runner

- **New step types:** `sdk/src/types.ts` gains `PhaseStepType.Build` and a `build` phase type. `stepToPhaseType` is extended in `phase-runner.ts` and `session-runner.ts`.
- **Workflow map:** `PHASE_WORKFLOW_MAP` in `phase-prompt.ts` maps `build` to `build.md`.
- **File manifest:** `PHASE_FILE_MANIFEST` in `context-engine.ts` gets a build entry with CONTEXT, RESEARCH, ROADMAP, REQUIREMENTS, STATE and the milestone brief.
- **Tool scoping:** `tool-scoping.ts` allows agent spawning for the build step.
- **Behavior when `workflow.build_mode` is true:**
  - The Research step runs `build.md` with `--research-only`. The classic path is unchanged.
  - After the research gate, a Build step replaces Plan, PlanCheck and Execute.
  - The Verify step reads the status from the VERIFICATION.md that Build wrote, instead of spawning the verifier again.
  - Gap closure runs Build with `--gaps`. `maxGapRetries` stays 1.
- **Fixes:**
  1. `runExecuteStep` with zero plans returns a failure with the blocker "no plans found" instead of success.
  2. The architectural-debt scan uses the files changed since the phase's base commit when plans are briefs or lack `files_modified`.
  3. `ContextEngine` looks for `*-CONTEXT.md` and `*-RESEARCH.md` in the phase folder before falling back to the `.planning/` root.

### VibeClaw

**`feature-build.yaml` stages**
- **research:** `gsd.command: fvgsd:build`, `gsd.args: ["--research-only"]`, `mutates_source: false`.
- **discuss** (optional): same definition as in `feature-development.yaml`.
- **brief** (optional): `gsd.command: fvgsd:build`, `gsd.args: ["--brief-only"]`, `mutates_source: false`, `input.promoted_stages: [research, discuss]`.
- **build:** `gsd.command: fvgsd:build`, `mutates_source: true`, `input.promoted_stages: [brief, discuss, research]`.
- **verify** and **review:** same definitions as in `feature-development.yaml`, with verify's `input.promoted_stages: [build]`.

**Code and data changes**
- `schemas.cjs`: optional `gsd.args`, an array whose items must match `^--[a-z][a-z0-9-]*$`.
- `orchestrator.cjs`: adds the template to the copy list, and `renderContextMarkdown` appends args to the slash invocation.
- `entry-router.cjs`: `LIFECYCLE_ENTRIES` maps `build` to the build stage of `feature-build`.
- `routes/cheap.yaml` and `routes/quality.yaml`: a `build:` entry using the tool currently assigned to `execute`.
- `feature-development.yaml` is unchanged.

### Configuration

Add each key to `sdk/shared/config-defaults.manifest.json`, regenerate `get-shit-done/bin/lib/configuration.generated.cjs` (`npm run check:configuration-fresh`), and document it in `docs/CONFIGURATION.md`.

| Key | Default | Values |
|---|---|---|
| `workflow.build_mode` | `true` | boolean |
| `workflow.build_fix_rounds` | `2` | integer 0–5 |
| `workflow.build_human_checks` | `"defer"` | `"defer"`, `"block"` |
| `workflow.build_code_review` | `false` | boolean |
| `workflow.build_parallel` | `"auto"` | `"auto"`, `"off"` |
| `workflow.build_engine` | `"agents"` | `"agents"`, `"workflow"` |
| `workflow.build_check_timeout_seconds` | `1800` | positive integer |
| `workflow.lint_command` | `""` | string; empty means detect |
| `workflow.typecheck_command` | `""` | string; empty means detect |

Reused settings:
- `workflow.research`, `workflow.build_command` and `workflow.test_command`
- `parallelization.max_concurrent_agents` (3 when `parallelization` is a boolean)
- `model_profile`, `models` and `model_overrides`
- `mode`, `security_enforcement` and `commit_docs`

### Docs and inventory

- `docs/COMMANDS.md`, `docs/USER-GUIDE.md`, `docs/CONFIGURATION.md`, `docs/VIBECLAW.md` and `README.md` describe build.
- `get-shit-done/references/model-profiles.md` gets the `fvgsd-builder` row.
- `docs/INVENTORY.md` and `docs/INVENTORY-MANIFEST.json` are regenerated.
- A changeset fragment is added.

---

## Stage 2 (later): saved Claude Code workflow engine

Built after Stage 1 is in use and the brief, summary and query formats have settled.

- **Install.** The installer copies `get-shit-done/workflows/claude/fvgsd-build-slices.js` to `~/.claude/workflows/`, for Claude Code only. It runs as `/fvgsd-build-slices`; the name differs from `/fvgsd-build` because saved workflows become slash commands.
- **Opt-in.** Set `workflow.build_engine: "workflow"`. When the runtime's `workflow_scripts` switch is off, or the launch is not permitted, build falls back to the agents engine and says so.
- **Division of work.**
  - The command still does setup, research, the brief, `--confirm` and `user_setup`, because a workflow cannot pause for user input.
  - It then invokes the saved workflow by name, with `args`:

    ```json
    { "phase": "03", "phase_dir": "…", "brief": "…", "base_commit": "…", "waves": [["s1"], ["s2", "s3"]], "slices": { "s1": { "goal": "…", "owns": ["…"], "strong": false } }, "commands": { "build": "…" }, "models": { "slice": "sonnet", "strong": "opus", "verifier": "sonnet" }, "max_parallel": 3, "fix_rounds": 2, "human_checks": "defer", "code_review": false }
    ```

  - Afterwards the command writes the summary and runs `build.finalize` as in Stage 1.
- **Script.**
  - `meta` is a plain literal with phases `Slices`, `Checks`, `Verify` and `Fix`.
  - For each wave, it runs `parallel()` over slice agents with worktree isolation and a JSON schema matching SLICE RESULT.
  - An agent runs `fvgsd-sdk query build.merge-wave` and `build.run-checks`, because the script itself has no shell access.
  - It then runs the verifier agent and the fix loop, applying the same stop rule inside the script.
  - It returns `{ slices, checks, verification, fix_rounds, blocked }`.
- **Constraints from Claude Code.**
  - No mid-run user input: blocked slices end the run with `blocked` entries. The command asks the user and relaunches, and completed agents replay from cache within the session.
  - `Date.now()` and `Math.random()` throw inside scripts, so timestamps come from `args` or queries.
  - At most 16 concurrent agents.
  - Headless runs need a `Workflow(fvgsd-build-slices)` allow rule, and the installer prints that hint.
- **Before writing the script,** the implementer loads Claude Code's `/workflow-authoring` reference to confirm the `agent()` option for worktree isolation. If none exists, slices within a wave run one at a time inside the script.
- **Tests.** Load the script in a `node:vm` harness with fake `agent`, `parallel`, `pipeline` and `phase` functions and a fixture `args`. Assert the call order, the merge/check/verify sequence, the fix-round stop rule and the returned shape.

---

## Testing

Assertions compare JSON output or parsed files, never source text or raw substrings.

**SDK (Vitest)**
- **Query handlers (`sdk/src/query/build-*.test.ts`):**
  - `build.check-brief`: valid, missing fields, cycle, duplicate id, unknown `after`, empty `owns`, missing `<objective>`.
  - `build.waves`: dependency order, and overlapping `owns` split across waves.
  - `build.run-checks`: fake commands (`node -e "process.exit(1)"`), timeout, skipped commands, `preexisting` against a stored baseline, and per-command commit tracking in `latest.json`.
  - `build.scan-stubs` over a temporary git diff.
  - `build.group-problems`: owned, unowned and nearest-directory cases.
  - `build.finalize`: frontmatter fill, `key-files` from git, ID coverage anywhere in the text (inside XML, tables and headings), missing-ID refusal, and state updates.
  - `checks.detect` against fixture projects (npm, Makefile, Go, Cargo, Python, Xcode), with config overrides winning.
  - `init.build`: every resume state and the baseline decision.
- **Integration (`sdk/src/query/build-merge-wave.integration.test.ts`):** a temporary repository with two isolated slice branches. A clean merge succeeds; a conflicting edit is reported with no partial merge left behind.
- **Tool chain without a model (`sdk/src/query/build-chain.integration.test.ts`):**
  1. Set up a temporary project with a `.planning` fixture and git, and a brief fixture.
  2. Run `build.waves`, simulate slice commits on branches, run `build.merge-wave`, then `build.run-checks` with fake commands.
  3. Run `build.finalize` with summary and VERIFICATION fixtures.
  4. Assert STATE, ROADMAP and REQUIREMENTS through the existing query JSON, and that the next action names the following phase.
- **Runner:**
  - Build is selected when `build_mode` is on, and the classic path when it's off.
  - Verify reads the status from VERIFICATION.md.
  - Gap closure passes `--gaps`.
  - Execute with zero plans fails.
  - The debt scan uses changed files.
  - `ContextEngine` finds files in the phase folder.
- **Routing:** `route-next-action` over fixture phase folders (CONTEXT only, brief only, brief + summary + passed VERIFICATION, gaps_found) with `build_mode` on and off, plus `phase-plan-index` reporting `kind`.

**Root (`node:test`)**
- **Manager:** recommended actions in `init.cjs` for the same fixtures.
- **VibeClaw:** `feature-build.yaml` validates; `gsd.args` is accepted and rejected per the pattern and appears in the rendered context's invocation; the `build` lifecycle entry resolves; both routes files contain `build`. Update the pinned workflow list in `tests/vibe-core.test.cjs`.
- **Install:** `fvgsd-builder` installs in every runtime layout, and converters drop unsupported frontmatter keys. `runtime-capabilities.json` has an entry for every layout runtime, and unknown runtimes resolve to all `false`.
- **Existing checks:** the command contract lint, inventory manifest sync, command and agent docs parity, execution-branch guard check, alias drift check and configuration freshness check pass.

**Acceptance (manual)**
- After installing fvgsd, run `/fvgsd-build` on a real phase of a project.
- Compare it with that project's most recent phase built with plan-phase and execute-phase: new planning files, wall-clock time (the summary's `build.started` and `build.completed` versus that phase's git timestamps), fix rounds and verification status.

---

## Success criteria

- **Planning files:** a phase adds at most the brief, the summary, VERIFICATION.md, RESEARCH.md (only when missing) and HUMAN-UAT.md (only when human-only checks exist).
- **No document reviews:** no agent reviews planning documents. The only document checks are `build.check-brief` and the ID coverage in `build.finalize`.
- **Full test suite runs:** at most one baseline (only when the last passing commit isn't the latest code commit) plus one end-of-build run. Fix rounds rerun only the commands that failed, plus build and typecheck.
- **Agent count:** a single-slice phase with no fixes starts at most two agents, the builder and the verifier, plus the researcher when RESEARCH.md is missing.
- **Compatibility:** existing status, routing and VibeClaw tests pass, apart from the intentional updates listed above.

---

## Risks

- **Slices disagree on shared interfaces.** Mitigations: the brief's Approach section names shared interfaces; slices that share contracts are ordered with `after`; build and typecheck run after every wave; merge conflicts go to a builder with both slices' notes.
- **Executor-tier models struggle with complex slices.** Mitigations: the brief marks those slices `strong`, and `model_overrides` still applies.
- **Parallel slices compete for machine resources.** Mitigations: quick checks are scoped to changed files, and concurrency defaults to 3.
- **Headless runs stop on blockers.** Questions are recorded with `state.add-blocker`, and running the command again resumes from git state.
- **Nested worktrees when VibeClaw candidates run build.** Git supports worktrees created from a linked worktree. The merge-wave integration test includes a run whose base is itself a linked worktree. The check state directory is keyed by the git common dir and the phase, so two builds of the same phase in one repository at the same time (for example VibeClaw candidates in worktrees) share `baseline.json` and `latest.json`: a same-code-tree mismatch then yields `checks_passed_at: null`, which is conservative, but one build can overwrite the other's baseline mid-run.
