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

Normal GSD workflows continue to work without VibeClaw orchestration. Direct
`vgsd` use still creates a standalone execution branch; nothing creates
`.planning-vibe/` orchestration state until `vibe init` is run in a project.

## GSD versus VibeClaw

GSD remains the methodology and canonical workflow content. Its project documents stay in `.planning/`, VibeClaw exposes its commands under the collision-free `vgsd` namespace, and runtime-specific command/skill transformations still happen during installation.

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

Installed runtimes also expose an AI-native entry point, so users do not need
to translate Vibe operations into terminal commands:

```text
/vgsd-vibe quick
/vgsd-vibe debug --tool codex --tool claude
$vgsd-vibe new-milestone --tool codex
```

`vgsd-vibe` inspects Git, the current worktree, GSD planning state, active
runs, and existing candidates before it changes anything. It can continue
directly, create one candidate, or prepare N candidates from the same reviewed
base commit. Project, milestone, and phase commands map to the bundled
multi-stage workflows. An explicit phase entry may begin at discuss, plan,
execute, verify, or review using the reviewed integration commit when there is
no earlier Vibe promotion; ordinary stage advancement still requires its
declared promoted input. Every other public command—including `quick`, `fast`,
`debug`, `autonomous`, reviews, audits, documentation, spikes, and future
commands—gets a durable single-command workflow automatically.

The installed command calls the runtime-local `get-shit-done/bin/vibe.cjs`, so
it works wherever `vgsd` was installed; a globally linked `vibe` executable is
optional.

## Command order: Vibe first, workflow second

Yes: when you want branch/worktree isolation or competing tool runs, start on
the integration branch with `vgsd-vibe`. Do not begin by running the mutating
target command on that branch.

```text
integration worktree
  -> run vgsd-vibe for the target workflow
  -> choose direct, one candidate, or multiple candidates
  -> Vibe prepares local worktrees or publishes Git handoffs
  -> enter each local worktree or tracked worker branch
  -> run that candidate's printed native vgsd command
  -> complete, compare, and explicitly promote one result
```

For example, the first command in Claude Code or another slash-command runtime
is:

```text
/vgsd-vibe quick --tool codex --tool claude
```

Use `/vgsd:vibe quick --tool codex --tool claude` in Gemini CLI or
`$vgsd-vibe quick --tool codex --tool claude` in Codex. The gateway reports a
local worktree or remote handoff and native target invocation for every
candidate. Only then run the
reported `$vgsd-quick`, `/vgsd:quick`, or `/vgsd-quick` inside its matching
worktree.

There are two intentional operating modes:

| Goal | First command | Result |
| --- | --- | --- |
| Orchestrated work | `vgsd-vibe` for the target workflow | Vibe initializes or resumes orchestration and prepares local candidate worktrees or guarded remote handoffs before the target runs |
| Simple direct work | The target `vgsd` command | Before Vibe is initialized, GSD creates a protected standalone `vgsd/<runtime>/<command>/<execution-id>` branch |

After `.planning-vibe/` exists, a mutating target command on the integration
worktree is rejected. Return to the integration worktree, use `vgsd-vibe` to
prepare the target, and run it from the prepared candidate. Read-only control
commands remain direct.

`vgsd-vibe` is a gateway, not a permanent prefix inside the candidate. Invoke
it from the integration worktree to prepare or manage work; invoke the printed
target command from the candidate worktree to do the work.

## Execution modes: local worktrees and multi-machine Git handoffs

Every run snapshots one coordination mode. The mode cannot change while that
run is active.

| Mode | Worker location | Candidate identity | Commit/push policy |
| --- | --- | --- | --- |
| `local` (default) | Coordinator worktree, local terminal, SSH, remote IDE, or a container sharing the same paths | Exact absolute worktree, branch, base, candidate manifest, and tool | Candidate must be clean and committed when its contract requires a result commit |
| `multi-machine` | Independent clones on separate machines | Published branch plus remote `vibe-handoff/...` identity tag, assigned command/tool, base ancestry, and live upstream checks | Every candidate needs a result commit and must be pushed before coordinator completion |

The coordinator remains the owner of `.planning-vibe/`, candidate completion,
comparison, and promotion. Worker machines execute only their assigned native
`vgsd` command and push the result branch. This avoids trying to merge mutable
orchestration state from several clones.

Enable Git handoffs before starting a run:

```bash
vibe mode multi-machine --remote origin
```

Or request it through the installed gateway:

```text
/vgsd-vibe quick --multi-machine --remote origin --tool codex --tool claude
```

Use `vibe mode show` to inspect the current mode and `vibe mode local` to return
to local path-bound worktrees after the active run finishes.

### What preparation publishes

For each multi-machine candidate, Vibe atomically pushes all of the following
to the configured remote:

- the current integration branch at the reviewed run base;
- the exact-base `vibe/<run>/<stage>/<tool>-NNN` candidate branch;
- a lightweight `vibe-handoff/<candidate-id>/<command>` identity tag.

Preparation fails if the remote is missing, unavailable, rejects atomic push,
or contains a conflicting integration/candidate/tag ref. Source changes in the
integration worktree must be committed or resolved first. Remote URLs are
inspected but never persisted in Vibe state, because they may contain local
credentials.

### Worker handoff

Send the candidate branch and native invocation printed by `vgsd-vibe` to the
assigned worker. The coordinator does not need that worker's CLI executable,
but the worker must have the matching tool plus the same VibeClaw-aware `vgsd`
surface installed. In an existing worker clone:

```bash
git fetch origin --tags
git switch --track -c vibe/remote-quick/task/codex-001 origin/vibe/remote-quick/task/codex-001
```

Then run the printed target command, for example `$vgsd-quick`. Its execution
guard checks the live remote before workflow work begins:

- the local branch tracks the published candidate branch;
- exactly one matching handoff tag exists;
- the tag assigns this command and its recorded base;
- the runtime matches the candidate's tool;
- the worker branch descends from the base and is not behind or divergent;
- no remote `vibe-complete/<candidate-id>` marker exists.

The worker must persist all deliverables in Git, commit even an artifact-only or
no-source result (an intentional empty result commit is acceptable), and push:

```bash
git status --short
git add -A
git commit -m "feat: complete remote quick candidate"
git push origin HEAD:vibe/remote-quick/task/codex-001
```

Do not edit `.planning-vibe/` or `.vibe/` on the worker branch. Protected-path
validation rejects those changes when the coordinator receives the result.

### Coordinator receive and promotion

Return to the coordinator checkout:

```bash
vibe stage complete remote-quick-task-codex-001 --summary "Codex worker result"
vibe candidates task --run remote-quick
vibe promote remote-quick-task-codex-001
```

Completion fetches the remote candidate into its coordinator worktree and
requires an exact, clean, base-descended, committed, pushed result. It rejects
missing pushes, remote divergence, source mutation forbidden by the contract,
and changes to orchestration control paths. Once accepted, the coordinator
pushes `vibe-complete/<candidate-id>` so stale worker clones cannot rerun it.

Promotion rechecks the remote candidate branch and both tags, performs the same
safe local promotion rules, and pushes the integration branch. If the remote
advanced concurrently, the push fails instead of overwriting remote work.

## Greenfield and brownfield scenarios

The examples below use the slash-command form. Substitute `/vgsd:vibe` in
Gemini CLI or `$vgsd-vibe` in Codex.

### Greenfield A: empty directory, one candidate

Start in the directory that will become the project. A short product brief is
recommended because it gives the first planning candidate a reviewed input.

```text
/vgsd-vibe new-project --tool claude
```

The gateway detects that Git or `HEAD` is missing. It inspects the directory,
shows what would enter the baseline, initializes Git, and asks for approval
before creating the baseline commit. It then initializes Vibe, prepares one
candidate, and prints its worktree and `/vgsd-new-project` invocation. Open
that worktree and run the printed target command there. When it finishes,
return to the integration worktree to complete and promote the candidate.

Nothing requires you to run `git init`, `vibe init`, or `vibe stage prepare`
manually in this path. Approval is still required before the AI creates the
first commit, and secrets or unrelated generated files must not be included.

### Greenfield B: empty directory, three competing project foundations

Use local mode when all three adapters can access one coordinator filesystem:

```text
/vgsd-vibe new-project --tool gemini --tool codex --tool claude
```

After the reviewed baseline, Vibe creates three candidates from the same exact
commit. Run the printed `/vgsd:new-project`, `$vgsd-new-project`, and
`/vgsd-new-project` in the corresponding worktrees. Complete all candidates,
compare their `.planning/` results, and promote one. Later workflow stages read
only the promoted project foundation.

For three independent worker machines, configure a Git remote after the
reviewed initial baseline, then turn on the handoff mode before preparation:

```text
/vgsd-vibe new-project --multi-machine --remote origin --tool gemini --tool codex --tool claude
```

Each worker fetches only its published candidate branch, runs its assigned
native `new-project` command, commits `.planning/`, and pushes. The coordinator
receives all three pushed candidates, compares them, and promotes one.

### Greenfield C: start directly, adopt orchestration later

For a small experiment you may intentionally initialize Git yourself, create a
reviewed baseline commit, skip Vibe, and run a target command first:

```text
/vgsd-new-project
```

That creates a standalone smart branch. When you later invoke
`/vgsd-vibe plan-phase`, the gateway can initialize Vibe and import the local
standalone execution provenance. This path is safe, but it does not retroactively
turn the first execution into a competing Vibe candidate.

### Brownfield A: existing Git repository without GSD planning

First map the existing code in isolation, promote the preferred map, and then
create the project planning foundation:

```text
/vgsd-vibe map-codebase --tool codex --tool claude
/vgsd-vibe new-project --tool gemini --tool codex --tool claude
```

Run the commands one at a time. Finish and promote the `map-codebase` run
before starting `new-project`; Vibe will report an active-run conflict rather
than silently replacing unfinished work. Because the repository already has a
baseline, the gateway only asks you to resolve or approve new integration-tree
changes before it prepares candidates.

### Brownfield B: existing GSD project, enter at the current lifecycle stage

If `.planning/` already contains the project and roadmap, start at the stage
you actually need:

```text
/vgsd-vibe discuss-phase --tool claude
/vgsd-vibe plan-phase --tool codex --tool claude
/vgsd-vibe execute-phase --tool codex --tool opencode
/vgsd-vibe verify-work --tool codex
```

These are separate examples, not a command batch. An explicit entry at plan,
execute, verify, or review uses the reviewed integration commit when there is
no earlier Vibe promotion. Normal advancement inside an active feature run
still requires the prior stage's promoted result.

### Brownfield C: small fix, fast change, or investigation

General commands receive generated one-stage workflows, so they use the same
candidate safety and promotion lifecycle:

```text
/vgsd-vibe quick --tool codex
/vgsd-vibe fast --tool claude
/vgsd-vibe debug --tool codex --tool claude
/vgsd-vibe audit-fix --tool opencode
/vgsd-vibe code-review --tool gemini --tool claude
```

Choose one candidate for routine work or several candidates when alternative
diagnoses or implementations are worth comparing. A review-only result may
produce artifacts without source changes; a fix must still be committed in its
candidate before promotion.

### Brownfield D: begin a later milestone

Finish or resume any active run, switch the integration worktree to the branch
that should receive the milestone, and start with:

```text
/vgsd-vibe new-milestone --tool codex --tool claude
```

Both candidates start from the same promoted repository state. Promote the
preferred milestone definition before preparing its feature phases.

### Brownfield E: distribute feature candidates across existing clones

Make sure the coordinator integration branch contains the reviewed brownfield
baseline and is ready to publish, then start the run in multi-machine mode:

```text
/vgsd-vibe execute-phase --multi-machine --remote origin --tool codex --tool opencode --tool claude
```

Codex, OpenCode, and Claude can execute from independent clones on different
machines. Each clone must track its own candidate branch; sharing one candidate
branch between two workers is intentionally unsupported. After all workers
commit and push, the coordinator completes each candidate and promotes the
selected implementation. The next verification stage begins from that promoted
integration commit, not from either losing branch.

### Finishing any candidate scenario

The target workflow runs in the candidate, while lifecycle control runs from
the integration worktree. After the candidate has persisted its artifacts,
committed tracked changes, and passed relevant checks, return to the integration
worktree and use the gateway again:

```text
/vgsd-vibe status
/vgsd-vibe complete <candidate-id>
/vgsd-vibe candidates
/vgsd-vibe promote <candidate-id>
```

Promotion is never implied by workflow completion. With multiple candidates,
complete and inspect all useful alternatives before selecting one. The gateway
uses the runtime-local Vibe CLI for these operations; the equivalent operator
commands are documented below.

## Initialize a project

The AI-first scenarios above normally initialize Vibe for you. For manual CLI
operation, run from a Git project root with a reviewed baseline commit:

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

Initialization is idempotent. It validates existing configuration, only creates
missing bundled templates, and scans `vgsd/*` branches plus Git-local execution
metadata. Any direct pre-Vibe work is recorded in
`.planning-vibe/state/standalone-executions.json`.

## vgsd execution-branch guard

Every public `vgsd` command begins with the same portable preflight. Installer
path conversion carries it to Claude Code, Gemini CLI, Codex, and the other
supported runtimes.

```text
vgsd command starts
  ├─ valid Vibe candidate → reuse candidate branch/worktree
  ├─ Vibe exists, not a candidate → block and require stage preparation
  ├─ matching standalone branch → reuse it
  ├─ standalone branch owned by another tool → block
  └─ no Vibe setup → create vgsd/<runtime>/<command>/<execution-id>
```

The Vibe adapter supplies `VIBE_CANDIDATE_ID`, `VIBE_TOOL`, and `GSD_RUNTIME`
to managed launches. The guard verifies those values against the candidate
manifest, current branch, worktree path, tool assignment, and active candidate
status. A branch name alone is not sufficient inside a Vibe-managed project.

Standalone provenance is written below Git's common directory at
`vgsd/executions/`. Raw runtime session IDs are hashed before storage. The
working tree is not dirtied by the metadata, and existing dirty files remain in
place when Git switches to the new branch.

For diagnostics, call the compatibility utility inside the runtime install
directory (this Codex example uses `.codex`; use `.claude` or `.gemini` for
those installs):

```bash
node "$HOME/.codex/get-shit-done/bin/gsd-tools.cjs" execution-branch inspect help --runtime codex
node "$HOME/.codex/get-shit-done/bin/gsd-tools.cjs" execution-branch ensure plan-phase --runtime codex
```

Normally users do not run these directly; the installed `vgsd` command prompt
runs them before its workflow body.

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
  multi_machine: false
  remote: origin
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
- Multi-machine mode distributes candidate execution, but orchestration state remains coordinator-owned; concurrent coordinator-state merging is not supported.
- Multi-machine preparation requires a Git remote that supports atomic pushes, and worker guards require live remote access.
- Managed-launch command flags are initial adapter defaults; manual launch and generated context are the stable contract.
- YAML schema version 1 supports the bundled deterministic subset rather than every YAML feature.
- Candidate comparison is status/context/history based; semantic diff and cost dashboards are future consumers of the stored metadata.
- Promotion recovery leaves a durable intent if Git advances but final state persistence fails. Automated intent reconciliation is a future hardening step; the record is inspectable under `promotions/<run>/<stage>/intent.json`.

For implementation details and architectural rationale, see [VibeClaw Repository Orchestration Design](vibeclaw-orchestration-design.md).
