# Multi-Tool Project-to-Milestone Walkthrough

This guide shows the repeatable VibeClaw operating pattern:

```text
prepare Gemini + Codex + Claude Code from one commit
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
| Gemini CLI | `gemini` | `/vgsd:...` |
| Codex | `codex` | `$vgsd-...` |
| Claude Code (CC) | `claude` | `/vgsd-...` |

Claude Code Router is a separate adapter with the ID `claude-router` and executable `ccr`.

## The two kinds of initialization

`vibe init` and GSD project initialization are different operations:

- `vibe init` runs once. It creates `.planning-vibe/`, routes, workflows, and the orchestration state store.
- The `project-bootstrap` workflow runs GSD project initialization as competing Gemini, Codex, and Claude candidates. The winning candidate creates the promoted `.planning/` foundation.

VibeClaw always promotes to the integration branch that was checked out when `vibe run start` ran. If the winner must land on `main`, start every run from a clean `main` branch.

## How branch preflight fits this walkthrough

Every `vgsd` command checks its branch before starting:

- The three candidates in this guide already have Vibe-created branches and
  worktrees, so their commands verify the candidate manifest and continue.
- Running a `vgsd` command directly on `main` after `vibe init` stops. Prepare
  and launch a candidate instead; this prevents accidental edits on the
  integration branch.
- Running `vgsd` before any Vibe setup creates a standalone branch named
  `vgsd/<runtime>/<command>/<execution-id>`.
- If you later run `vibe init` from that standalone branch, initialization
  imports its provenance into
  `.planning-vibe/state/standalone-executions.json` and future invocations can
  safely reuse it.

Managed Vibe launches set the candidate ID, tool ID, and GSD runtime in the
environment automatically. A manual launch should be run inside the printed
candidate worktree; branch and worktree discovery supplies the same check even
when no launch environment is inherited.

Standalone-first example:

```text
Codex runs $vgsd-new-project
  → vgsd/codex/new-project/<execution-id>
  → project work is committed
  → vibe init
  → standalone execution is imported for later orchestration
```

## Prerequisites

Install VibeClaw and GSD for all three tools, then confirm the adapters are available:

```bash
get-shit-done-cc --gemini --global
get-shit-done-cc --codex --global
get-shit-done-cc --claude --global

vibe tool list
vibe tool detect
gemini --version
codex --version
claude --version
```

The repository must already have a `main` branch and at least one commit. For a brand-new repository, add a committed `PROJECT-BRIEF.md` describing the product, users, constraints, and desired first release.

```bash
git init -b main
git add PROJECT-BRIEF.md
git commit -m "docs: add project brief"
```

## 1. Initialize VibeClaw once

Run this from the repository root:

```bash
git switch main
vibe init
git add .planning-vibe
git commit -m "chore: initialize VibeClaw"
```

Initialization installs three bundled workflows:

| Workflow | Purpose |
| --- | --- |
| `project-bootstrap` | Compete on `/vgsd-new-project` and promote one `.planning/` foundation |
| `milestone-bootstrap` | Compete on `/vgsd-new-milestone` and promote one milestone definition |
| `feature-development` | Research → optional discuss → plan → execute → verify → review |

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
Gemini:      /vgsd:new-project
Codex:       $vgsd-new-project
Claude Code: /vgsd-new-project
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
git add .planning-vibe
git commit -m "chore: record project bootstrap run"
```

## 3. Start a later milestone the same way

`/vgsd-new-project` already creates the initial milestone. Use `milestone-bootstrap` later, after the active milestone has been completed and you are ready to define the next one.

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

The candidate contexts use `/vgsd:new-milestone`, `$vgsd-new-milestone`, and `/vgsd-new-milestone` respectively. Compare `.planning/`, then promote one candidate:

```bash
vibe candidates milestone --run milestone-002
git switch main
vibe promote milestone-002-milestone-claude-003

git add .planning-vibe
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

Do not commit `.planning-vibe/` between promotions in a multi-stage run. A run expects its integration branch to remain at the last promoted commit. Commit orchestration state after the final stage is promoted:

```bash
vibe status --run phase-01
git add .planning-vibe
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
