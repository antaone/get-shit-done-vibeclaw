# Multi-Tool Project-to-Milestone Walkthrough

This guide shows the repeatable VibeClaw operating pattern:

```text
prepare Gemini + Codex + Claude Code from one coordinator commit
                         ↓
run each in its own branch and worktree
                         ↓
complete and compare all three candidates
                         ↓
human promotes one candidate to main
                         ↓
the next stage starts from only that promoted result
```

The examples use three tool IDs:

| Tool | VibeClaw ID | Command shown inside its candidate context |
| --- | --- | --- |
| Gemini CLI | `gemini` | `/fvgsd:...` |
| Codex | `codex` | `$fvgsd-...` |
| Claude Code (CC) | `claude` | `/fvgsd-...` |

Claude Code Router is a separate adapter with the ID `claude-router` and executable `ccr`.

## Choose the execution mode

One coordinator checkout owns the run, comparisons, and promotion. Candidate
execution can use either mode:

- `local` is the default. Gemini, Codex, and Claude run in the absolute
  candidate worktrees under the coordinator checkout. Separate terminals, SSH,
  remote IDEs, and shared-path containers are supported.
- `multi-machine` publishes each candidate as a guarded Git handoff. Gemini,
  Codex, and Claude may run in independent clones on different machines, while
  the coordinator receives their pushed commits and remains the only promotion
  owner.

Enable the second mode before starting the run:

```bash
vibe mode multi-machine --remote origin
```

Multi-machine preparation atomically publishes the integration branch,
candidate branch, and a command-specific identity tag. Each worker must track
its published branch, pass the assigned runtime/command guard, commit all
results, and push. Coordinator completion fetches the exact remote result and
publishes a completion marker; promotion revalidates the handoff and pushes the
integration branch. See [Multi-machine Git handoffs](VIBECLAW.md#execution-modes-local-worktrees-and-multi-machine-git-handoffs).

## Recommended order: `fvgsd-vibe` first

For normal interactive use, do not begin with the terminal sequence later in
this guide. Begin on the integration worktree with the installed AI gateway:

```text
/fvgsd-vibe new-project --tool gemini --tool codex --tool claude
```

When the three tools will run in independent clones, make the mode explicit:

```text
/fvgsd-vibe new-project --multi-machine --remote origin --tool gemini --tool codex --tool claude
```

Use `/fvgsd:vibe ...` in Gemini CLI or `$fvgsd-vibe ...` in Codex. The gateway
inspects Git and planning state, initializes Git when needed, requests approval
for a reviewed baseline commit, initializes Vibe, and prepares all requested
candidates from the same commit.

It then prints a branch, coordinator worktree, context path, and native target
command for each candidate. In local mode open each printed worktree; in
multi-machine mode fetch and track each printed branch from its assigned worker.
Run only the matching command:

```text
Gemini candidate: /fvgsd:new-project
Codex candidate:  $fvgsd-new-project
Claude candidate: /fvgsd-new-project
```

Return to the integration worktree to complete, compare, and promote. The
manual `vibe init`, `vibe run start`, and `vibe stage prepare` commands below
are the lower-level equivalent for operators and automation.

The same order applies to brownfield workflows. Examples include:

```text
/fvgsd-vibe map-codebase --tool codex --tool claude
/fvgsd-vibe new-milestone --tool codex --tool claude
/fvgsd-vibe execute-phase --tool codex --tool opencode
/fvgsd-vibe quick --tool codex
/fvgsd-vibe debug --tool codex --tool claude
```

Finish and promote one run before starting a different workflow, or explicitly
resolve the active run when the gateway reports a conflict. See the
[greenfield and brownfield scenario cookbook](VIBECLAW.md#greenfield-and-brownfield-scenarios)
for additional starting states.

## The two kinds of initialization

`vibe init` and GSD project initialization are different operations:

- `vibe init` runs once. It creates `.planning-fvgsd-vibe/`, routes, workflows, and the orchestration state store.
- The `project-bootstrap` workflow runs GSD project initialization as competing Gemini, Codex, and Claude candidates. The winning candidate creates the promoted `.planning/` foundation.

`fvgsd-vibe new-project` coordinates both operations in the correct order. You
only need to distinguish them when using the lower-level CLI manually.

VibeClaw always promotes to the integration branch that was checked out when `vibe run start` ran. If the winner must land on `main`, start every run from a clean `main` branch.

## How branch preflight fits this walkthrough

Every `fvgsd` command checks its branch before starting:

- The three candidates in this guide already have Vibe-created branches and
  worktrees, so their commands verify the candidate manifest and continue. In
  multi-machine mode, the equivalent check uses the live remote handoff tag,
  tracked branch, assigned command/tool, base ancestry, and completion marker.
- Running a mutating `fvgsd` command directly on `main` after `vibe init` stops.
  Return to `main`, invoke `fvgsd-vibe` for that target, and then run the target
  inside the prepared candidate; this prevents accidental edits on the
  integration branch.
- Running `fvgsd` before any Vibe setup creates a standalone branch named
  `fvgsd/<runtime>/<command>/<execution-id>`.
- If you later run `vibe init` from that standalone branch, initialization
  imports its provenance into
  `.planning-fvgsd-vibe/state/standalone-executions.json` and future invocations can
  safely reuse it.

Managed Vibe launches set the candidate ID, tool ID, and GSD runtime in the
environment automatically. A manual launch should be run inside the printed
candidate worktree; branch and worktree discovery supplies the same check even
when no launch environment is inherited.

Standalone-first example:

```text
Codex runs $fvgsd-new-project
  → fvgsd/codex/new-project/<execution-id>
  → project work is committed
  → vibe init
  → standalone execution is imported for later orchestration
```

## Prerequisites

For the local walkthrough below, install VibeClaw and GSD for all three tools
on the coordinator host, then confirm the adapters are available there. In
multi-machine mode, each worker only needs its assigned runtime installation;
the coordinator needs VibeClaw and authenticated access to the shared remote.

```bash
fvgsd --gemini --global
fvgsd --codex --global
fvgsd --claude --global

vibe tool list
vibe tool detect
gemini --version
codex --version
claude --version
```

The lower-level terminal walkthrough below assumes that the repository already
has a `main` branch and at least one commit. For a brand-new repository, the
recommended `fvgsd-vibe new-project` path can initialize Git and request approval
for the baseline. If preparing it manually, add a committed `PROJECT-BRIEF.md`
describing the product, users, constraints, and desired first release.

```bash
git init -b main
git add PROJECT-BRIEF.md
git commit -m "docs: add project brief"
```

## 1. Manual equivalent: initialize VibeClaw once

Skip this section when `fvgsd-vibe` already initialized the project. For the
lower-level path, run this from the repository root:

```bash
git switch main
vibe init
git add .planning-fvgsd-vibe
git commit -m "chore: initialize VibeClaw"
```

Initialization installs four bundled workflows:

| Workflow | Purpose |
| --- | --- |
| `project-bootstrap` | Compete on `/fvgsd-new-project` and promote one `.planning/` foundation |
| `milestone-bootstrap` | Compete on `/fvgsd-new-milestone` and promote one milestone definition |
| `feature-development` | Research → optional discuss → plan → execute → verify → review |
| `feature-build` | Research → optional discuss → optional brief → build → verify → review, with `/fvgsd-build` |

## 2. Bootstrap a new project with Gemini, Codex, and Claude

Start the run while `main` is checked out:

```bash
git switch main
git status --short
vibe run start project-bootstrap --id project-001
```

Prepare all three candidates before promoting anything. This guarantees that they share the same base commit but receive separate branches and worktrees.

```bash
vibe stage prepare project --run project-001 --tool gemini
vibe stage prepare project --run project-001 --tool codex
vibe stage prepare project --run project-001 --tool claude
```

For the first three preparations, the candidate IDs will look like:

```text
project-001-project-gemini-001
project-001-project-codex-002
project-001-project-claude-003
```

Always use the IDs printed by your terminal; sequence numbers increase when a stage is prepared again.

Launch each candidate in a separate terminal so the tools can work concurrently:

```bash
vibe stage launch project-001-project-gemini-001 --execute
vibe stage launch project-001-project-codex-002 --execute
vibe stage launch project-001-project-claude-003 --execute
```

Each tool reads its generated `context.md`, works only in its assigned worktree, reads `PROJECT-BRIEF.md`, and receives its native GSD action:

```text
Gemini:      /fvgsd:new-project
Codex:       $fvgsd-new-project
Claude Code: /fvgsd-new-project
```

Before completion, each candidate should have committed its `.planning/` result and have a clean worktree. Complete all three from the operator terminal:

```bash
vibe stage complete project-001-project-gemini-001 --summary "Gemini project foundation"
vibe stage complete project-001-project-codex-002 --summary "Codex project foundation"
vibe stage complete project-001-project-claude-003 --summary "Claude project foundation"
```

Inspect the candidates and compare their planning trees:

```bash
vibe candidates project --run project-001
vibe context project-001-project-gemini-001 --json
vibe context project-001-project-codex-002 --json
vibe context project-001-project-claude-003 --json

git diff vibe/project-001/project/gemini-001..vibe/project-001/project/codex-002 -- .planning
git diff vibe/project-001/project/codex-002..vibe/project-001/project/claude-003 -- .planning
```

Choose the best candidate and promote it. This example chooses Codex:

```bash
git switch main
vibe promote project-001-project-codex-002
```

Because the run started on `main`, promotion fast-forwards `main` to the selected candidate result. The other candidates remain recorded and are not merged.

If you promoted the wrong candidate, replace it before committing any additional work on `main`:

```bash
vibe promote project-001-project-claude-003 --replace
```

After the choice is final, persist the updated orchestration history:

```bash
git add .planning-fvgsd-vibe
git commit -m "chore: record project bootstrap run"
```

## 3. Start a later milestone the same way

`/fvgsd-new-project` already creates the initial milestone. Use `milestone-bootstrap` later, after the active milestone has been completed and you are ready to define the next one.

Create and commit a `MILESTONE-BRIEF.md`, then start from clean `main`:

```bash
git switch main
git add MILESTONE-BRIEF.md
git commit -m "docs: define next milestone"
vibe run start milestone-bootstrap --id milestone-002
```

Prepare, launch, and complete the same three-way comparison:

```bash
vibe stage prepare milestone --run milestone-002 --tool gemini
vibe stage prepare milestone --run milestone-002 --tool codex
vibe stage prepare milestone --run milestone-002 --tool claude

vibe stage launch milestone-002-milestone-gemini-001 --execute
vibe stage launch milestone-002-milestone-codex-002 --execute
vibe stage launch milestone-002-milestone-claude-003 --execute

vibe stage complete milestone-002-milestone-gemini-001 --summary "Gemini milestone proposal"
vibe stage complete milestone-002-milestone-codex-002 --summary "Codex milestone proposal"
vibe stage complete milestone-002-milestone-claude-003 --summary "Claude milestone proposal"
```

The candidate contexts use `/fvgsd:new-milestone`, `$fvgsd-new-milestone`, and `/fvgsd-new-milestone` respectively. Compare `.planning/`, then promote one candidate:

```bash
vibe candidates milestone --run milestone-002
git switch main
vibe promote milestone-002-milestone-claude-003

git add .planning-fvgsd-vibe
git commit -m "chore: record milestone bootstrap run"
```

## 4. Repeat the competition for phase research and planning

Use one `feature-development` run per phase. This example is for phase 1:

```bash
git switch main
vibe run start feature-development --id phase-01 --route quality
```

First compare research candidates:

```bash
vibe stage prepare research --run phase-01 --tool gemini
vibe stage prepare research --run phase-01 --tool codex
vibe stage prepare research --run phase-01 --tool claude

vibe stage launch phase-01-research-gemini-001 --execute
vibe stage launch phase-01-research-codex-002 --execute
vibe stage launch phase-01-research-claude-003 --execute

vibe stage complete phase-01-research-gemini-001 --summary "Gemini phase research"
vibe stage complete phase-01-research-codex-002 --summary "Codex phase research"
vibe stage complete phase-01-research-claude-003 --summary "Claude phase research"

vibe candidates research --run phase-01
vibe promote phase-01-research-gemini-001
```

Now all planning candidates start from the promoted Gemini research result:

```bash
vibe stage prepare plan --run phase-01 --tool gemini
vibe stage prepare plan --run phase-01 --tool codex
vibe stage prepare plan --run phase-01 --tool claude

vibe stage launch phase-01-plan-gemini-001 --execute
vibe stage launch phase-01-plan-codex-002 --execute
vibe stage launch phase-01-plan-claude-003 --execute

vibe stage complete phase-01-plan-gemini-001 --summary "Gemini phase plan"
vibe stage complete phase-01-plan-codex-002 --summary "Codex phase plan"
vibe stage complete phase-01-plan-claude-003 --summary "Claude phase plan"

vibe candidates plan --run phase-01
vibe promote phase-01-plan-codex-002
```

The optional `discuss` stage is skipped when no discuss candidate is prepared. To compare discussion results too, prepare and promote `discuss` candidates after research and before planning.

## 5. Repeat for implementation, verification, and review

The pattern does not change:

1. Prepare all candidates before promotion.
2. Launch each candidate in its isolated worktree.
3. Ensure candidate changes are committed and the worktree is clean.
4. Complete every candidate.
5. Compare results.
6. Promote exactly one.

For implementation:

```bash
vibe stage prepare execute --run phase-01 --tool gemini
vibe stage prepare execute --run phase-01 --tool codex
vibe stage prepare execute --run phase-01 --tool claude

vibe stage launch phase-01-execute-gemini-001 --execute
vibe stage launch phase-01-execute-codex-002 --execute
vibe stage launch phase-01-execute-claude-003 --execute

vibe stage complete phase-01-execute-gemini-001 --summary "Gemini implementation"
vibe stage complete phase-01-execute-codex-002 --summary "Codex implementation"
vibe stage complete phase-01-execute-claude-003 --summary "Claude implementation"

vibe candidates execute --run phase-01
vibe promote phase-01-execute-claude-003
```

Run the same commands with stage `verify`, then stage `review`. Each stage automatically receives only the prior promoted candidate as input. Use `vibe next --run phase-01` and `vibe status --run phase-01` to confirm the expected next action.

Do not commit `.planning-fvgsd-vibe/` between promotions in a multi-stage run. A run expects its integration branch to remain at the last promoted commit. Commit orchestration state after the final stage is promoted:

```bash
vibe status --run phase-01
git add .planning-fvgsd-vibe
git commit -m "chore: record phase 1 orchestration"
```

## Comparing and cleaning candidates

VibeClaw records provenance and status but intentionally leaves semantic selection to you. Useful comparison commands are:

```bash
vibe candidates <stage> --run <run-id>
vibe context <candidate-id> --json
vibe history --run <run-id> --stage <stage>
git show --stat <candidate-branch>
git diff <candidate-branch-a>..<candidate-branch-b>
```

After selection, remove a completed candidate worktree while retaining its branch and history:

```bash
vibe cleanup <candidate-id>
```

For an unpromoted candidate that you no longer need, delete its branch explicitly:

```bash
vibe cleanup <candidate-id> --delete-branch
```

The invariant throughout the process is simple: all candidates for one stage start from the same promoted commit, and only the candidate you explicitly promote advances `main`.
