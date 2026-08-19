# VibeClaw Multi-Tool Orchestration

VibeClaw is an optional repository-backed orchestration layer around GSD. It lets a human assign different workflow stages to Gemini, Codex, Claude Code, Claude Code Router, OpenCode, Grok Build, or future adapters without making those tools communicate with one another.

The repository is the handoff mechanism:

```text
tool reads promoted repository state
  → works in an isolated candidate
  → persists artifacts and commits
  → operator completes and inspects the candidate
  → operator explicitly promotes one result
  → the next tool reads that promotion
```

Normal GSD commands continue to work without VibeClaw. Nothing creates orchestration state until `vibe init` is run in a project.

## GSD versus VibeClaw

GSD remains the methodology and canonical workflow content. Its project documents stay in `.planning/`, its commands stay under the `gsd` namespace, and its runtime-specific command/skill transformations still happen during installation.

VibeClaw manages cross-tool execution around GSD:

- named stage-to-tool route defaults;
- workflow run identity;
- competing candidates;
- promoted inputs;
- exact Git bases, branches, and worktrees;
- normalized tool context;
- completion, metrics, promotion, and history.

That state lives in `.planning-vibe/`. VibeClaw stage contracts reference existing commands such as `/vgsd:plan-phase` and `/vgsd:execute-phase`; they do not create `plan-phase-codex`, `plan-phase-claude`, or other runtime copies.

## Install surface

The package exposes a separate executable:

```bash
vibe --help
```

When working directly from this repository without a global package link, use:

```bash
node bin/vibe.js --help
```

## Initialize a project

Run from a Git project root:

```bash
vibe init
```

Initialization creates:

```text
.planning-vibe/
├── config.yaml
├── routes/
├── workflows/
├── runs/
├── candidates/
├── promotions/
├── history/
├── locks/
└── state/
```

It also adds `.vibe/` to `.git/info/exclude`. Candidate worktrees are stored under `.vibe/worktrees/`, so they cannot be committed accidentally. `.planning-vibe/` is not ignored: project routes and durable orchestration state are intended to be inspectable and committable.

Initialization is idempotent. It validates existing configuration and only creates missing bundled templates.

For a complete three-tool operating recipe using Gemini, Codex, and Claude Code, see [Multi-Tool Project-to-Milestone Walkthrough](MULTI-TOOL-WALKTHROUGH.md).

## Configuration

The default `.planning-vibe/config.yaml` is:

```yaml
version: 1
project_name: my-project
default_route: cheap
git:
  candidate_branches: true
  worktrees: auto
  worktree_root: .vibe/worktrees
  promotion_strategy: fast-forward
promotion:
  mode: manual
```

Schema version 1 intentionally supports manual promotion only. Invalid versions, route names, workflow contracts, stages, and tools fail with actionable errors.

## Routes

A route supplies defaults; it does not bind a stage permanently to a tool.

```yaml
version: 1
name: cheap
stages:
  research:
    tool: gemini
  plan:
    tool: codex
  execute:
    tool: opencode
  verify:
    tool: codex
```

Use routes with:

```bash
vibe route list
vibe route show cheap
vibe route use cheap
```

An explicit stage assignment overrides the route:

```bash
vibe stage prepare execute --tool claude-router
```

Tool resolution is explicit override, `VIBE_TOOL`, route snapshot, runtime marker, then executable detection. A run snapshots its route and workflow when it starts, so later edits do not retroactively change existing provenance.

## Runs, stages, and candidates

Start or resume a run:

```bash
vibe run start feature-development
vibe run start feature-development --id feature-014 --route quality
vibe run resume feature-014
vibe run show feature-014
vibe run list
```

The run records its base commit and integration branch at creation. An explicit `--base` may name the same commit through another ref, but the resolved commit must equal the checked-out integration branch head; historical bases require checking out a dedicated integration branch first. To promote to `main`, check out `main` before starting the run.

The bundled workflows are:

| Workflow | Stages | Purpose |
| --- | --- | --- |
| `project-bootstrap` | `project` | Compare GSD new-project foundations from the same brief and base commit |
| `milestone-bootstrap` | `milestone` | Compare next-milestone definitions from the same brief and base commit |
| `feature-development` | `research`, optional `discuss`, `plan`, `execute`, `verify`, `review` | Repeatable phase delivery lifecycle |

The `feature-development` workflow declares contracts for:

```text
research → optional discuss → plan → execute → verify → review
```

Each contract declares allowed source mutation, Git isolation, promoted inputs, expected outputs, completion requirements, and the existing GSD command to use.

Prepare a candidate without launching anything:

```bash
vibe stage prepare research
vibe stage prepare execute --tool opencode
```

Preparation allocates a unique candidate ID, resolves promoted input, records the exact base, creates the branch/worktree when required, and writes both JSON and Markdown context.

Inspect it from any worktree:

```bash
vibe context <candidate-id>
vibe context <candidate-id> --json
```

Inside a candidate worktree, `VIBE_CANDIDATE_ID` or the worktree path lets `vibe context` identify the candidate without chat history or hidden shell state.

## Manual and managed launch

Manual launch is the baseline:

1. Run `vibe stage prepare`.
2. Open the printed worktree in an editor.
3. Run the selected AI tool yourself.
4. Give it the generated `context.md` path.
5. Persist its summary/artifacts and commit candidate work.
6. Run `vibe stage complete`.

The adapter can also print a managed-launch command and mark the candidate running:

```bash
vibe stage launch <candidate-id>
```

Execute that command directly only when desired:

```bash
vibe stage launch <candidate-id> --execute
```

Managed launch is optional because AI CLI flags change more often than the repository state contract. The generated context remains the authoritative interface.

## Completion and artifacts

Each candidate needs a non-empty summary. The tool can write to the summary path named in `context.md`, or the operator can supply one:

```bash
vibe stage complete <candidate-id> --summary "Implemented and tested the promoted plan."
```

Copy GSD or other outputs into durable candidate storage with repeatable `--artifact` flags:

```bash
vibe stage complete <candidate-id> \
  --summary "Plan complete." \
  --artifact .planning/phases/03/03-01-PLAN.md \
  --artifact .planning/phases/03/03-RESEARCH.md
```

Optional metrics are recorded without requiring an analytics service:

```bash
vibe stage complete <candidate-id> \
  --summary "Verification passed." \
  --duration-seconds 420 \
  --estimated-cost 0.38 \
  --input-tokens 12000 \
  --output-tokens 3500 \
  --rating 5
```

Completion checks Git ancestry, worktree cleanliness, branch identity, protected orchestration paths, and the stage mutation contract. Completion does not promote.

## Competing candidates and promotion

Prepare the same stage several times from the same promoted input:

```bash
vibe stage prepare execute --tool opencode
vibe stage prepare execute --tool claude-router
vibe stage prepare execute --tool codex
```

Each receives a branch like:

```text
vibe/feature-014/execute/opencode-001
vibe/feature-014/execute/claude-router-002
vibe/feature-014/execute/codex-003
```

Inspect them without advancing the workflow:

```bash
vibe candidates execute
vibe status
vibe context <candidate-id> --json
```

Promote exactly one completed result:

```bash
vibe promote feature-014-execute-claude-router-002
```

The normal Git strategy is fast-forward from the candidate's recorded base. If a different candidate for the same stage was already promoted, replacement must be intentional:

```bash
vibe promote feature-014-execute-codex-003 --replace
```

Replacement creates a new integration commit whose tree exactly matches the replacement candidate and whose parents preserve the current integration history and candidate history. VibeClaw never resets the integration branch and never silently blends two competing implementations. Replacement is blocked after a downstream stage has already been promoted.

Dirty source changes block promotion. Changes inside `.planning-vibe/` are excluded from that check because live orchestration metadata is expected to evolve while candidates run.

## Complete example

This example compares OpenCode and Claude Code Router execution while keeping all handoff in the repository:

```bash
vibe init
vibe route use cheap
vibe run start feature-development --id feature-014

# Gemini research
vibe stage prepare research
# Run Gemini in the printed worktree, persist research, then:
vibe stage complete feature-014-research-gemini-001 \
  --summary "Research complete." \
  --artifact .planning/phases/03/03-RESEARCH.md
vibe promote feature-014-research-gemini-001

# Codex planning (the optional discuss stage is skipped)
vibe stage prepare plan
# Run Codex, then:
vibe stage complete feature-014-plan-codex-001 \
  --summary "Plan complete." \
  --artifact .planning/phases/03/03-01-PLAN.md
vibe promote feature-014-plan-codex-001

# Competing implementations from the exact same promoted plan/base
vibe stage prepare execute --tool opencode
vibe stage prepare execute --tool claude-router

# Complete each after its work is committed
vibe stage complete feature-014-execute-opencode-001 \
  --summary "OpenCode implementation complete."
vibe stage complete feature-014-execute-claude-router-002 \
  --summary "Claude Router implementation complete."

vibe candidates execute
vibe status

# Human chooses Claude Router
vibe promote feature-014-execute-claude-router-002

# Codex verification consumes only the promoted implementation
vibe stage prepare verify
vibe stage complete feature-014-verify-codex-001 \
  --summary "Verification passed." \
  --artifact .planning/phases/03/03-VERIFICATION.md
vibe promote feature-014-verify-codex-001
```

## JSON and future dashboards

Use `--json` for machine-readable output:

```bash
vibe status --json
vibe candidates execute --json
vibe context <candidate-id> --json
vibe history --run feature-014 --json
```

Errors also use a stable JSON envelope when `--json` is present:

```json
{
  "error": "INTEGRATION_DIRTY",
  "message": "Promotion is blocked by uncommitted source changes",
  "details": { "files": [" M src/example.js"] }
}
```

The CLI delegates to `VibeOrchestrator`; a dashboard can use the same library instead of parsing terminal text.

## Recovery and cleanup

`vibe status` reports missing or advanced candidate branches and missing worktrees. Invalid or partially written manifests fail as `STATE_CORRUPT`; they are not overwritten silently. Locks are reclaimed when their local owner is gone or a remote-owner lock is stale.

Remove a completed candidate's worktree while preserving its branch and provenance:

```bash
vibe cleanup <candidate-id>
```

Delete an unpromoted candidate branch intentionally:

```bash
vibe cleanup <candidate-id> --delete-branch
```

Promoted branches are preserved. Cleanup refuses dirty worktrees and advanced branches.
Uncommitted non-source artifacts are the one scoped exception: when every dirty path was explicitly copied into the candidate's durable `outputs/`, cleanup may remove the worktree with those copies preserved.

## Current limitations

- Promotion is intentionally human-controlled; there is no automatic winner selection or route optimization.
- There is no tool-to-tool messaging, shared conversation, queue, or negotiation.
- Managed-launch command flags are initial adapter defaults; manual launch and generated context are the stable contract.
- YAML schema version 1 supports the bundled deterministic subset rather than every YAML feature.
- Candidate comparison is status/context/history based; semantic diff and cost dashboards are future consumers of the stored metadata.
- Promotion recovery leaves a durable intent if Git advances but final state persistence fails. Automated intent reconciliation is a future hardening step; the record is inspectable under `promotions/<run>/<stage>/intent.json`.

For implementation details and architectural rationale, see [VibeClaw Repository Orchestration Design](vibeclaw-orchestration-design.md).
