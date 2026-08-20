# VibeClaw Repository Orchestration Design

Status: implemented design baseline  
Schema version: 1

## 1. Existing architecture and integration points

GSD already separates authored workflow content from runtime installation. Canonical command wrappers live in `commands/gsd/`, detailed workflows in `get-shit-done/workflows/`, role prompts in `agents/`, and install-time runtime transformations in `bin/install.js` plus `runtime-artifact-layout.cjs`. The SDK exposes reusable phase execution and query APIs, while the compatibility CLI routes existing shell-oriented workflows through `gsd-tools.cjs`.

`.planning/` is owned by GSD. `planning-workspace.cjs` centralizes its path, workstream, and lock policy. Existing worktree code is primarily GSD execution safety and cleanup policy; it is not a durable model for competing cross-runtime candidates. Git subprocesses already use the non-interactive `execGit` seam in `shell-command-projection.cjs`.

VibeClaw is therefore an optional layer beside GSD. It references existing GSD commands and artifacts through stage contracts, but it does not change `.planning/`, duplicate GSD workflows, or participate in installer-time runtime conversion.

## 2. Module design

The orchestration implementation lives under `get-shit-done/bin/lib/vibe/` and is reusable without the CLI:

- `yaml.cjs`: deterministic YAML-subset parsing and serialization for committed configuration.
- `schemas.cjs`: validation and normalization for configuration, routes, workflows, runs, and candidates.
- `store.cjs`: `.planning-vibe/` paths, atomic JSON writes, append-only history, promotion records, and stale-lock recovery.
- `adapters.cjs`: registry-backed tool adapters and explicit/environment/marker detection.
- `git.cjs`: exact-base branch/worktree creation, atomic remote handoff publication, worker-result receipt, completion validation, safe promotion/push, and cleanup.
- `orchestrator.cjs`: route, run, candidate, context, completion, promotion, and status use cases.
- `index.cjs`: public library surface.
- `bin/vibe.js`: thin argument/output adapter.

Core state transitions return data or throw typed errors. Terminal formatting and process exit behavior remain in the CLI so a future dashboard can call the core directly.

## 3. State schema

`.planning-vibe/` is project state and is intended to be committed. `.vibe/` contains disposable worktrees and is added to the repository-local Git exclude file by `vibe init`.

```text
.planning-vibe/
├── config.yaml
├── routes/
│   ├── cheap.yaml
│   └── quality.yaml
├── workflows/
│   └── feature-development.yaml
├── runs/<run-id>/run.json
├── candidates/<candidate-id>/
│   ├── manifest.json
│   ├── context.json
│   ├── context.md
│   └── outputs/
├── promotions/<run-id>/<stage>/
│   ├── 0001.json
│   └── current.json
├── history/events.jsonl
├── locks/
└── state/
    └── active-run.json
```

Configuration, routes, and workflow contracts use human-authored YAML. Mutable manifests use canonical JSON to avoid lossy YAML mutation. History is append-only JSON Lines. Every mutable document includes a schema version.

Candidate provenance records the run, workflow, stage, adapter/tool, route,
promoted input, exact base commit, branch, coordinator worktree, optional remote
handoff identity, result commit, timestamps, outputs, metrics, completion state,
and promotion state. Unknown metrics remain `null`.

## 4. Git model

A run records its integration branch and base commit when it starts. Run creation requires the resolved base to equal that branch's current head, preventing an arbitrary historical base from producing a run that cannot later be promoted safely. Candidate bases are never inferred from the currently checked-out branch:

- the first stage uses the run base;
- a later stage uses the selected prior promotion's integration commit;
- competing candidates for one stage therefore receive the same promoted input and base.

Every contract with `requires_git_candidate: true` receives a branch named `vibe/<run>/<stage>/<tool>-NNN` and an isolated worktree under `.vibe/worktrees/<candidate-id>`. This includes planning stages that persist GSD artifacts through Git, even when they do not mutate application source.

Completion requires a clean candidate worktree, verifies that the branch still points at the recorded result, verifies ancestry from the recorded base, and rejects candidate commits that modify `.planning-vibe/` or `.vibe/`. Candidate metadata remains centralized in the main repository state and is discovered from linked worktrees through Git's common worktree metadata.

Runs snapshot either `local` or `multi-machine` coordination. Local candidates
retain the absolute-path identity above. Multi-machine preparation also pushes
the integration branch, candidate branch, and a lightweight
`vibe-handoff/<candidate-id>/<command>` tag in one atomic remote transaction.
The worker guard derives the candidate identity from its tracked branch and
verifies the live remote tag, exact command, assigned runtime, base ancestry,
remote relationship, and lack of a completion marker.

The worker is not an orchestration-state writer. It commits and pushes the
candidate result. Coordinator completion fetches that remote ref into the local
candidate worktree, requires at least one result commit, applies the normal
contract/protected-path validation, and publishes
`vibe-complete/<candidate-id>` at the accepted commit. Promotion verifies the
remote branch and both tags before advancing and pushing the integration branch.

## 5. Promotion model

Completion never promotes. Promotion is an explicit command guarded by the orchestration lock.

The normal promotion is a fast-forward from the integration branch's exact expected base to the candidate result. Replacing the current promotion requires `--replace`, is rejected when a later stage is already promoted, and creates an integration commit whose tree exactly matches the replacement candidate. That commit has both the current integration commit and candidate result as parents. This preserves both histories without resetting a branch or silently combining two competing implementations.

Promotion writes an intent record before Git mutation and finalizes an immutable numbered promotion record afterward. The run projection, candidate projection, immutable promotion record, and append-only history retain previous alternatives. A failed post-Git state update leaves a recoverable intent instead of pretending the operation never began.

Dirty application/source changes block promotion. Changes limited to `.planning-vibe/` are allowed because orchestration state is expected to evolve while candidates run. No command resets, cleans, or force-checks out user work.

## 6. Command model

The separate `vibe` executable keeps orchestration distinct from `/vgsd:*` methodology commands:

```text
vibe init
vibe mode show|local|multi-machine [--remote <name>]
vibe route list|show|use
vibe run start|resume|show|list
vibe status
vibe next
vibe stage prepare|launch|complete
vibe context [candidate]
vibe candidates [stage]
vibe promote <candidate> [--replace]
vibe history
vibe cleanup <candidate>
vibe tool list|detect
```

All inspection and lifecycle commands support `--json`. `stage prepare` is intentionally separate from launch, completion, and promotion so manual operation remains first-class.

## 7. GSD compatibility

Workflow contracts carry runtime-neutral stage semantics plus a `gsd.command` reference such as `vgsd:plan-phase` or `vgsd:execute-phase`. Stage context tells the selected tool which existing GSD action to run and where candidate-specific outputs belong. No runtime-specific copy of a GSD workflow is introduced.

Normal GSD operation does not create `.planning-vibe/` and does not load the VibeClaw library. VibeClaw only activates after `vibe init`.

## 8. Configuration and tool selection

Selection precedence is:

1. explicit `--tool` assignment;
2. `VIBE_TOOL` environment variable;
3. named route stage assignment;
4. runtime-specific environment marker;
5. adapter executable detection.

An explicit assignment always wins. The adapter registry avoids tool-condition ladders in orchestration logic and exposes detection, prompt construction, launch command construction, non-interactive support, resume support, and environment data.

`config.git.multi_machine` defaults to `false`; `config.git.remote` defaults to
`origin`. Enabling multi-machine mode validates the named remote and is rejected
while a differently configured run is active. Each run snapshots the mode and
remote so later configuration changes cannot weaken its handoff policy.

## 9. Concurrency and recovery

One atomic orchestration lock protects counters and multi-file state transitions. Lock files contain PID, host, and acquisition time. A lock is recoverable when its owner is no longer alive or its age exceeds the stale threshold; a live lock times out without being deleted. JSON writes use a same-directory temporary file and atomic rename, so a partial write cannot replace the last valid manifest.

Candidate IDs and branches are allocated while holding the lock. Failed worktree preparation performs scoped rollback only for the just-created candidate branch/worktree. Missing worktrees, missing branches, corrupt manifests, pending promotion intents, and stale locks surface as explicit state rather than being silently repaired.

## 10. Migration and compatibility

There is no automatic migration. Existing `.planning/`, `.gsd/`, commands, SDK consumers, runtime installs, workstreams, and GSD worktrees continue unchanged. `vibe init` is idempotent for an existing valid store and only creates missing orchestration templates/directories plus the private `.vibe/` Git exclude.

## 11. Implementation phases

1. Filesystem store, schemas, route/workflow templates, and adapter registry.
2. Runs, candidate lifecycle, normalized context, status, and JSON interfaces.
3. Exact-base Git branches/worktrees, completion validation, promotion, replacement, and cleanup.
4. CLI, GSD command references, documentation, and temporary-repository tests.
5. Future: richer managed-launch capability probing, dashboard API transport, artifact comparison, and metrics aggregation. Automatic winner selection and tool-to-tool communication remain explicitly out of scope.

## 12. Risks and mitigations

- **Divergent integration state:** promotion requires the recorded expected integration commit; replacement is explicit and history-preserving.
- **Dirty-tree loss:** source changes block promotion; no reset or clean operation exists.
- **State corruption:** atomic writes, strict validation, typed corruption errors, and append-only history.
- **Stale locks:** owner/age checks and bounded acquisition time.
- **Runtime CLI drift:** managed launch is adapter-scoped and optional; printed context/manual launch is always available.
- **GSD semantic duplication:** workflow contracts reference canonical GSD commands instead of copying workflow bodies.
- **Orchestration metadata contaminating candidates:** candidate commits are rejected if they touch `.planning-vibe/` or `.vibe/`.
- **Forged or stale remote worker state:** live remote identity/completion tags,
  assigned runtime/command checks, ancestry checks, atomic publication, exact
  pushed-result receipt, and integration push rejection fail closed.
- **Credential leakage through remote URLs:** remote names are persisted, but
  remote URLs are never written into candidate or orchestration state.
