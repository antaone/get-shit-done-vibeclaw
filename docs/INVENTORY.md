# GSD Shipped Surface Inventory

> Authoritative roster of every shipped GSD surface: commands, agents, workflows, references, CLI modules, and hooks. Where the broad docs (AGENTS.md, COMMANDS.md, ARCHITECTURE.md, CLI-TOOLS.md) diverge from the filesystem, treat this file and the repository tree itself as the source of truth.

## How To Use This File

- Counts here are derived from the filesystem at the v1.36.0 pin and may drift between releases. For live counts, run `ls commands/gsd/*.md | wc -l`, `ls agents/fvgsd-*.md | wc -l`, etc. against the checkout.
- This file enumerates every shipped surface across all six families (agents, commands, workflows, references, CLI modules, hooks). Broad docs may render narrative or curated subsets; when they disagree with the filesystem, this file and the directory listings are authoritative.
- New surfaces added after v1.36.0 should land here first, then propagate to the broad docs. The drift-control tests in `tests/inventory-counts.test.cjs`, `tests/commands-doc-parity.test.cjs`, `tests/agents-doc-parity.test.cjs`, `tests/cli-modules-doc-parity.test.cjs`, `tests/hooks-doc-parity.test.cjs`, `tests/architecture-counts.test.cjs`, and `tests/command-count-sync.test.cjs` anchor the counts and roster contents against the filesystem.

---

## Agents (38 shipped)

Full roster at `agents/fvgsd-*.md`. The "Primary doc" column flags whether [`docs/AGENTS.md`](AGENTS.md) carries a full role card (*primary*), a short stub in the "Advanced and Specialized Agents" section (*advanced stub*), or no coverage (*inventory only*).

| Agent | Role (one line) | Spawned by | Primary doc |
|-------|-----------------|------------|-------------|
| fvgsd-project-researcher | Researches domain ecosystem before roadmap creation (stack, features, architecture, pitfalls). | `/fvgsd-new-project`, `/fvgsd-new-milestone` | primary |
| fvgsd-phase-researcher | Researches implementation approach for a specific phase before planning. | `/fvgsd-plan-phase` | primary |
| fvgsd-ui-researcher | Produces UI design contracts for frontend phases. | `/fvgsd-ui-phase` | primary |
| fvgsd-assumptions-analyzer | Produces evidence-backed assumptions for discuss-phase (assumptions mode). | `discuss-phase-assumptions` workflow | primary |
| fvgsd-advisor-researcher | Researches a single gray-area decision during discuss-phase advisor mode. | `discuss-phase` workflow (advisor mode) | primary |
| fvgsd-research-synthesizer | Combines parallel researcher outputs into a unified SUMMARY.md. | `/fvgsd-new-project` | primary |
| fvgsd-planner | Creates executable phase plans with task breakdown and goal-backward verification. | `/fvgsd-plan-phase`, `/fvgsd-quick` | primary |
| fvgsd-roadmapper | Creates project roadmaps with phase breakdown and requirement mapping. | `/fvgsd-new-project` | primary |
| fvgsd-executor | Executes GSD plans with atomic commits and deviation handling. | `/fvgsd-execute-phase`, `/fvgsd-quick` | primary |
| fvgsd-plan-checker | Verifies plans will achieve phase goals (8 verification dimensions). | `/fvgsd-plan-phase` (verification loop) | primary |
| fvgsd-integration-checker | Verifies cross-phase integration and end-to-end flows. | `/fvgsd-audit-milestone` | primary |
| fvgsd-ui-checker | Validates UI-SPEC.md design contracts against quality dimensions. | `/fvgsd-ui-phase` (validation loop) | primary |
| fvgsd-verifier | Verifies phase goal achievement through goal-backward analysis. | `/fvgsd-execute-phase` | primary |
| fvgsd-nyquist-auditor | Fills Nyquist validation gaps by generating tests. | `/fvgsd-validate-phase` | primary |
| fvgsd-ui-auditor | Retroactive 6-pillar visual audit of implemented frontend code. | `/fvgsd-ui-review` | primary |
| fvgsd-codebase-mapper | Explores codebase and writes structured analysis documents. | `/fvgsd-map-codebase` | primary |
| fvgsd-debugger | Investigates bugs using scientific method with persistent state. | `/fvgsd-debug`, `/fvgsd-verify-work` | primary |
| fvgsd-user-profiler | Scores developer behavior across 8 dimensions. | `/fvgsd-profile-user` | primary |
| fvgsd-doc-writer | Writes and updates project documentation. | `/fvgsd-docs-update` | primary |
| fvgsd-doc-verifier | Verifies factual claims in generated documentation. | `/fvgsd-docs-update` | primary |
| fvgsd-security-auditor | Verifies threat mitigations from PLAN.md threat model. | `/fvgsd-secure-phase` | primary |
| fvgsd-builder | Writes the build brief for a phase, or builds one slice of it (brief and slice modes). | `/fvgsd-build` | advanced stub |
| fvgsd-deploy-runner | Runs one deploy from the project pack's deploy target and reports its runs and after-checks. | sessions deploying a step | advanced stub |
| fvgsd-proof-collector | Walks a spec's done-when list, runs a probe for each item, and writes the evidence file. | sessions proving a step | advanced stub |
| fvgsd-handoff-keeper | Appends a handoff entry, rolls old entries to history, and flags a stale STATE.md. | sessions at a step boundary | advanced stub |
| fvgsd-spec-digester | Reads a long step spec once and writes the phase's CONTEXT.md for this repo. | sessions starting a step | advanced stub |
| fvgsd-pattern-mapper | Maps new files to closest existing analogs; writes PATTERNS.md for the planner. | `/fvgsd-plan-phase` (between research and planning) | advanced stub |
| fvgsd-debug-session-manager | Runs the full `/fvgsd-debug` checkpoint-and-continuation loop in isolated context so main stays lean. | `/fvgsd-debug` | advanced stub |
| fvgsd-code-reviewer | Reviews source files for bugs, security issues, and code-quality problems; produces REVIEW.md. | `/fvgsd-code-review` | advanced stub |
| fvgsd-code-fixer | Applies fixes to REVIEW.md findings with atomic per-fix commits; produces REVIEW-FIX.md. | `/fvgsd-code-review --fix` | advanced stub |
| fvgsd-ai-researcher | Researches a chosen AI framework's official docs into implementation-ready guidance (AI-SPEC.md §3–§4b). | `/fvgsd-ai-integration-phase` | advanced stub |
| fvgsd-domain-researcher | Surfaces domain-expert evaluation criteria and failure modes for an AI system (AI-SPEC.md §1b). | `/fvgsd-ai-integration-phase` | advanced stub |
| fvgsd-eval-planner | Designs structured evaluation strategy for an AI phase (AI-SPEC.md §5–§7). | `/fvgsd-ai-integration-phase` | advanced stub |
| fvgsd-eval-auditor | Retroactive audit of an AI phase's evaluation coverage; produces EVAL-REVIEW.md (COVERED/PARTIAL/MISSING). | `/fvgsd-eval-review` | advanced stub |
| fvgsd-framework-selector | ≤6-question interactive decision matrix that scores and recommends an AI/LLM framework. | `/fvgsd-ai-integration-phase` | advanced stub |
| fvgsd-intel-updater | Writes structured intel files (`.planning/intel/*.json`) used as a queryable codebase knowledge base. | `/fvgsd-map-codebase --query` | advanced stub |
| fvgsd-doc-classifier | Classifies a single planning document as ADR, PRD, SPEC, DOC, or UNKNOWN; spawned in parallel to process the doc corpus. | `/fvgsd-ingest-docs` | advanced stub |
| fvgsd-doc-synthesizer | Synthesizes classified planning docs into a single consolidated context with precedence rules, cycle detection, and three-bucket conflicts report. | `/fvgsd-ingest-docs` | advanced stub |

**Coverage note.** `docs/AGENTS.md` gives full role cards for 21 primary agents plus concise stubs for the 17 advanced agents. The Agent Tool Permissions Summary in that file covers only the primary 21 agents; the advanced agents' tool lists are captured in their per-agent frontmatter in `agents/fvgsd-*.md`.

---

## Commands (74 shipped)

Full roster at `commands/gsd/*.md`. The groupings below mirror `docs/COMMANDS.md` section order; each row carries the command name, a one-line role derived from the command's frontmatter `description:`, and a link to the source file. `tests/command-count-sync.test.cjs` locks the count against the filesystem.

### Namespace Meta-Skills

These six routers are descriptor-only entries that the model picks first; the body of each contains a routing table that points at the correct concrete sub-skill. They exist to keep the eager skill-listing token cost low while the full surface remains reachable. See [#2792](https://github.com/gsd-build/get-shit-done/issues/2792) for the rationale; the routing tables target the post-[#2790](https://github.com/gsd-build/get-shit-done/issues/2790) consolidated surface.

| Command | Role | Source |
|---------|------|--------|
| `/fvgsd-workflow` | Phase pipeline router — discuss / plan / execute / verify / phase / progress. | [commands/gsd/ns-workflow.md](../commands/gsd/ns-workflow.md) |
| `/fvgsd-project` | Project lifecycle router — milestones, audits, summary. | [commands/gsd/ns-project.md](../commands/gsd/ns-project.md) |
| `/fvgsd-quality` | Quality-gate router — code review, debug, audit, security, eval, ui. | [commands/gsd/ns-review.md](../commands/gsd/ns-review.md) |
| `/fvgsd-context` | Codebase-intelligence router — map, graphify, docs, learnings. | [commands/gsd/ns-context.md](../commands/gsd/ns-context.md) |
| `/fvgsd-manage` | Management router — config, workspace, workstreams, thread, update, ship, inbox. | [commands/gsd/ns-manage.md](../commands/gsd/ns-manage.md) |
| `/fvgsd-ideate` | Exploration & capture router — explore, sketch, spike, spec, capture. | [commands/gsd/ns-ideate.md](../commands/gsd/ns-ideate.md) |

### Core Workflow

| Command | Role | Source |
|---------|------|--------|
| `/fvgsd-new-project` | Initialize a new project with deep context gathering and PROJECT.md. | [commands/gsd/new-project.md](../commands/gsd/new-project.md) |
| `/fvgsd-workspace` | Manage GSD workspaces — create (`--new`), list (`--list`), or remove (`--remove`) isolated workspace environments. | [commands/gsd/workspace.md](../commands/gsd/workspace.md) |
| `/fvgsd-discuss-phase` | Gather phase context through adaptive questioning before planning. | [commands/gsd/discuss-phase.md](../commands/gsd/discuss-phase.md) |
| `/fvgsd-mvp-phase` | Plan a phase as a vertical MVP slice — user story, SPIDR splitting, then plan-phase. | [commands/gsd/mvp-phase.md](../commands/gsd/mvp-phase.md) |
| `/fvgsd-spec-phase` | Socratic spec refinement producing a SPEC.md with falsifiable requirements. | [commands/gsd/spec-phase.md](../commands/gsd/spec-phase.md) |
| `/fvgsd-ui-phase` | Generate UI design contract (UI-SPEC.md) for frontend phases. | [commands/gsd/ui-phase.md](../commands/gsd/ui-phase.md) |
| `/fvgsd-ai-integration-phase` | Generate AI design contract (AI-SPEC.md) via framework selection, research, and eval planning. | [commands/gsd/ai-integration-phase.md](../commands/gsd/ai-integration-phase.md) |
| `/fvgsd-build` | Plan and execute a discussed phase in one step with slices, checks, and verification. | [commands/gsd/build.md](../commands/gsd/build.md) |
| `/fvgsd-plan-phase` | Create detailed phase plan (PLAN.md) with verification loop. | [commands/gsd/plan-phase.md](../commands/gsd/plan-phase.md) |
| `/fvgsd-plan-review-convergence` | Cross-AI plan convergence loop — replan with review feedback until no HIGH concerns remain (max 3 cycles). | [commands/gsd/plan-review-convergence.md](../commands/gsd/plan-review-convergence.md) |
| `/fvgsd-ultraplan-phase` | [BETA] Offload plan phase to Claude Code's ultraplan cloud — drafts remotely, review in browser, import back via `/fvgsd-import`. Claude Code only. | [commands/gsd/ultraplan-phase.md](../commands/gsd/ultraplan-phase.md) |
| `/fvgsd-spike` | Rapidly spike an idea with throwaway experiments; use `--wrap-up` to package findings as a persistent skill. | [commands/gsd/spike.md](../commands/gsd/spike.md) |
| `/fvgsd-sketch` | Rapidly sketch UI/design ideas using throwaway HTML mockups; use `--wrap-up` to package findings. | [commands/gsd/sketch.md](../commands/gsd/sketch.md) |
| `/fvgsd-execute-phase` | Execute all plans in a phase with wave-based parallelization. | [commands/gsd/execute-phase.md](../commands/gsd/execute-phase.md) |
| `/fvgsd-verify-work` | Validate built features through conversational UAT with auto-diagnosis. | [commands/gsd/verify-work.md](../commands/gsd/verify-work.md) |
| `/fvgsd-dod` | Run the project's definition-of-done checks and show one pass/fail table. | [commands/gsd/dod.md](../commands/gsd/dod.md) |
| `/fvgsd-step` | Run one step from its spec — digest, build, checks, deploy, proof, report and handoff. | [commands/gsd/step.md](../commands/gsd/step.md) |
| `/fvgsd-deploy` | Deploy the current commit to one project-pack environment and record the result in the handoff. | [commands/gsd/deploy.md](../commands/gsd/deploy.md) |
| `/fvgsd-handoff` | Add an entry to the project's handoff notes, roll old entries to history, and check STATE.md. | [commands/gsd/handoff.md](../commands/gsd/handoff.md) |
| `/fvgsd-ship` | Create PR, run review, and prepare for merge after verification. | [commands/gsd/ship.md](../commands/gsd/ship.md) |
| `/fvgsd-fast` | Execute a trivial task inline — no subagents, no planning overhead. | [commands/gsd/fast.md](../commands/gsd/fast.md) |
| `/fvgsd-quick` | Execute a quick task with GSD guarantees (atomic commits, state tracking) but skip optional agents. | [commands/gsd/quick.md](../commands/gsd/quick.md) |
| `/fvgsd-ui-review` | Retroactive 6-pillar visual audit of implemented frontend code. | [commands/gsd/ui-review.md](../commands/gsd/ui-review.md) |
| `/fvgsd-code-review` | Review source files changed during a phase for bugs, security, and code-quality problems; use `--fix` to auto-apply findings. | [commands/gsd/code-review.md](../commands/gsd/code-review.md) |
| `/fvgsd-eval-review` | Retroactively audit an executed AI phase's evaluation coverage; produces EVAL-REVIEW.md. | [commands/gsd/eval-review.md](../commands/gsd/eval-review.md) |

### Phase & Milestone Management

| Command | Role | Source |
|---------|------|--------|
| `/fvgsd-phase` | CRUD for phases — add (default), insert (`--insert`), remove (`--remove`), or edit (`--edit`) phases in ROADMAP.md. | [commands/gsd/phase.md](../commands/gsd/phase.md) |
| `/fvgsd-add-tests` | Generate tests for a completed phase based on UAT criteria and implementation. | [commands/gsd/add-tests.md](../commands/gsd/add-tests.md) |
| `/fvgsd-validate-phase` | Retroactively audit and fill Nyquist validation gaps for a completed phase. | [commands/gsd/validate-phase.md](../commands/gsd/validate-phase.md) |
| `/fvgsd-secure-phase` | Retroactively verify threat mitigations for a completed phase. | [commands/gsd/secure-phase.md](../commands/gsd/secure-phase.md) |
| `/fvgsd-audit-milestone` | Audit milestone completion against original intent before archiving. | [commands/gsd/audit-milestone.md](../commands/gsd/audit-milestone.md) |
| `/fvgsd-audit-uat` | Cross-phase audit of all outstanding UAT and verification items. | [commands/gsd/audit-uat.md](../commands/gsd/audit-uat.md) |
| `/fvgsd-audit-fix` | Autonomous audit-to-fix pipeline — find issues, classify, fix, test, commit. | [commands/gsd/audit-fix.md](../commands/gsd/audit-fix.md) |
| `/fvgsd-complete-milestone` | Archive completed milestone and prepare for next version. | [commands/gsd/complete-milestone.md](../commands/gsd/complete-milestone.md) |
| `/fvgsd-new-milestone` | Start a new milestone cycle — update PROJECT.md and route to requirements. | [commands/gsd/new-milestone.md](../commands/gsd/new-milestone.md) |
| `/fvgsd-milestone-summary` | Generate a comprehensive project summary from milestone artifacts. | [commands/gsd/milestone-summary.md](../commands/gsd/milestone-summary.md) |
| `/fvgsd-cleanup` | Archive accumulated phase directories from completed milestones. | [commands/gsd/cleanup.md](../commands/gsd/cleanup.md) |
| `/fvgsd-manager` | Interactive command center for managing multiple phases from one terminal. | [commands/gsd/manager.md](../commands/gsd/manager.md) |
| `/fvgsd-workstreams` | Manage parallel workstreams — list, create, switch, status, progress, complete, resume. | [commands/gsd/workstreams.md](../commands/gsd/workstreams.md) |
| `/fvgsd-autonomous` | Run all remaining phases autonomously — discuss → plan → execute per phase. | [commands/gsd/autonomous.md](../commands/gsd/autonomous.md) |
| `/fvgsd-undo` | Safe git revert — roll back phase or plan commits using the phase manifest. | [commands/gsd/undo.md](../commands/gsd/undo.md) |

### Session & Navigation

| Command | Role | Source |
|---------|------|--------|
| `/fvgsd-progress` | Check project progress, show context, and route to next action; use `--next` to advance automatically or `--do` to run a freeform task. | [commands/gsd/progress.md](../commands/gsd/progress.md) |
| `/fvgsd-capture` | Capture ideas, tasks, notes, and seeds — todo (default), `--note`, `--backlog`, `--seed`, or `--list` pending todos. | [commands/gsd/capture.md](../commands/gsd/capture.md) |
| `/fvgsd-stats` | Display project statistics — phases, plans, requirements, git metrics, timeline. | [commands/gsd/stats.md](../commands/gsd/stats.md) |
| `/fvgsd-pause-work` | Create context handoff when pausing work mid-phase. | [commands/gsd/pause-work.md](../commands/gsd/pause-work.md) |
| `/fvgsd-resume-work` | Resume work from previous session with full context restoration. | [commands/gsd/resume-work.md](../commands/gsd/resume-work.md) |
| `/fvgsd-explore` | Socratic ideation and idea routing — think through ideas before committing. | [commands/gsd/explore.md](../commands/gsd/explore.md) |
| `/fvgsd-review-backlog` | Review and promote backlog items to active milestone. | [commands/gsd/review-backlog.md](../commands/gsd/review-backlog.md) |
| `/fvgsd-thread` | Manage persistent context threads for cross-session work. | [commands/gsd/thread.md](../commands/gsd/thread.md) |

### Codebase Intelligence

| Command | Role | Source |
|---------|------|--------|
| `/fvgsd-map-codebase` | Analyze codebase with parallel mapper agents; use `--fast` for lightweight scan or `--query` for intel queries. | [commands/gsd/map-codebase.md](../commands/gsd/map-codebase.md) |
| `/fvgsd-graphify` | Build, query, and inspect the project knowledge graph in `.planning/graphs/`. | [commands/gsd/graphify.md](../commands/gsd/graphify.md) |
| `/fvgsd-extract-learnings` | Extract decisions, lessons, patterns, and surprises from completed phase artifacts. | [commands/gsd/extract-learnings.md](../commands/gsd/extract-learnings.md) |

### Review, Debug & Recovery

| Command | Role | Source |
|---------|------|--------|
| `/fvgsd-review` | Request cross-AI peer review of phase plans from external AI CLIs. | [commands/gsd/review.md](../commands/gsd/review.md) |
| `/fvgsd-debug` | Systematic debugging with persistent state across context resets. | [commands/gsd/debug.md](../commands/gsd/debug.md) |
| `/fvgsd-forensics` | Post-mortem investigation for failed GSD workflows — analyzes git, artifacts, state. | [commands/gsd/forensics.md](../commands/gsd/forensics.md) |
| `/fvgsd-health` | Diagnose planning directory health and optionally repair issues. | [commands/gsd/health.md](../commands/gsd/health.md) |
| `/fvgsd-import` | Ingest external plans with conflict detection against project decisions. | [commands/gsd/import.md](../commands/gsd/import.md) |
| `/fvgsd-inbox` | Triage and review all open GitHub issues and PRs against project templates. | [commands/gsd/inbox.md](../commands/gsd/inbox.md) |

### Docs, Profile & Utilities

| Command | Role | Source |
|---------|------|--------|
| `/fvgsd-docs-update` | Generate or update project documentation verified against the codebase. | [commands/gsd/docs-update.md](../commands/gsd/docs-update.md) |
| `/fvgsd-ingest-docs` | Scan a repo for mixed ADRs/PRDs/SPECs/DOCs and bootstrap or merge the full `.planning/` setup with classification, synthesis, and conflicts report. | [commands/gsd/ingest-docs.md](../commands/gsd/ingest-docs.md) |
| `/fvgsd-profile-user` | Generate developer behavioral profile and Claude-discoverable artifacts. | [commands/gsd/profile-user.md](../commands/gsd/profile-user.md) |
| `/fvgsd-settings` | Configure GSD workflow toggles and model profile. | [commands/gsd/settings.md](../commands/gsd/settings.md) |
| `/fvgsd-config` | Configure GSD settings — workflow toggles (default), advanced knobs (`--advanced`), integrations (`--integrations`), or model profile (`--profile`). | [commands/gsd/config.md](../commands/gsd/config.md) |
| `/fvgsd-pr-branch` | Create a clean PR branch by filtering out `.planning/` commits. | [commands/gsd/pr-branch.md](../commands/gsd/pr-branch.md) |
| `/fvgsd-surface` | Toggle which skills are surfaced — apply a profile, list, or disable a cluster without reinstall. | [commands/gsd/surface.md](../commands/gsd/surface.md) |
| `/fvgsd-pack` | Show or draft the project pack, the config.json facts fvgsd's agents read instead of guessing. | [commands/gsd/pack.md](../commands/gsd/pack.md) |
| `/fvgsd-vibe` | Route any public workflow through one or more isolated Vibe candidates, including quick, fast, debug, phase, and milestone flows. | [commands/gsd/vibe.md](../commands/gsd/vibe.md) |
| `/fvgsd-update` | Update GSD to latest version; use `--sync` to sync skills across runtimes or `--reapply` to reapply local patches. | [commands/gsd/update.md](../commands/gsd/update.md) |
| `/fvgsd-help` | Show available GSD commands and usage guide. | [commands/gsd/help.md](../commands/gsd/help.md) |

---

## Workflows (89 shipped)

Full roster at `get-shit-done/workflows/*.md`. Workflows are thin orchestrators that commands reference internally; most are not read directly by end users. Rows below map each workflow file to its role (derived from the `<purpose>` block) and, where applicable, to the command that invokes it.

| Workflow | Role | Invoked by |
|----------|------|------------|
| `add-backlog.md` | Add a backlog item to ROADMAP.md using 999.x numbering. | `/fvgsd-capture --backlog` |
| `add-phase.md` | Add a new integer phase to the end of the current milestone in the roadmap. | `/fvgsd-phase` (default) |
| `add-tests.md` | Generate unit and E2E tests for a completed phase based on its artifacts. | `/fvgsd-add-tests` |
| `add-todo.md` | Capture an idea or task that surfaces during a session as a structured todo. | `/fvgsd-capture` (default) |
| `ai-integration-phase.md` | Orchestrate framework selection → AI research → domain research → eval planning into AI-SPEC.md. | `/fvgsd-ai-integration-phase` |
| `analyze-dependencies.md` | Analyze ROADMAP.md phases for file overlap and semantic dependencies; suggest `Depends on` edges. | `/fvgsd-manager --analyze-deps` |
| `audit-fix.md` | Autonomous audit-to-fix pipeline — run audit, parse, classify, fix, test, commit. | `/fvgsd-audit-fix` |
| `audit-milestone.md` | Verify milestone met its definition of done by aggregating phase verifications. | `/fvgsd-audit-milestone` |
| `audit-uat.md` | Cross-phase audit of UAT and verification files; produces prioritized outstanding-items list. | `/fvgsd-audit-uat` |
| `autonomous.md` | Drive milestone phases autonomously — all remaining, a range, or a single phase. | `/fvgsd-autonomous` |
| `build.md` | Plan and execute a discussed phase in one run: brief, slices, checks, verification, fix rounds and summary. | `/fvgsd-build` |
| `check-todos.md` | List pending todos, allow selection, load context, and route to the appropriate action. | `/fvgsd-capture --list` |
| `cleanup.md` | Archive accumulated phase directories from completed milestones. | `/fvgsd-cleanup` |
| `code-review-fix.md` | Auto-fix issues from REVIEW.md via fvgsd-code-fixer with per-fix atomic commits. | `/fvgsd-code-review --fix` |
| `code-review.md` | Review phase source changes via fvgsd-code-reviewer; produces REVIEW.md. | `/fvgsd-code-review` |
| `complete-milestone.md` | Mark a shipped version as complete — MILESTONES.md entry, PROJECT.md evolution, tag. | `/fvgsd-complete-milestone` |
| `diagnose-issues.md` | Orchestrate parallel debug agents to investigate UAT gaps and find root causes. | `/fvgsd-verify-work` (auto-diagnosis) |
| `discovery-phase.md` | Execute discovery at the appropriate depth level. | `/fvgsd-new-project` (discovery path) |
| `discuss-phase-assumptions.md` | Assumptions-mode discuss — extract implementation decisions via codebase-first analysis. | `/fvgsd-discuss-phase` (when `discuss_mode=assumptions`) |
| `discuss-phase-power.md` | Power-user discuss — pre-generate all questions into a JSON state file + HTML UI. | `/fvgsd-discuss-phase --power` |
| `discuss-phase.md` | Extract implementation decisions through iterative gray-area discussion. | `/fvgsd-discuss-phase` |
| `mvp-phase.md` | Plan a phase as a vertical MVP slice — user story, SPIDR splitting, then plan-phase. | `/fvgsd-mvp-phase` |
| `do.md` | Route freeform text from the user to the best matching GSD command. | `/fvgsd-progress --do` |
| `docs-update.md` | Generate, update, and verify canonical and hand-written project documentation. | `/fvgsd-docs-update` |
| `edit-phase.md` | Edit any field of an existing phase in ROADMAP.md in place, preserving number and position. | `/fvgsd-phase --edit` |
| `eval-review.md` | Retroactive audit of an implemented AI phase's evaluation coverage. | `/fvgsd-eval-review` |
| `execute-phase.md` | Execute all plans in a phase using wave-based parallel execution. | `/fvgsd-execute-phase` |
| `execute-plan.md` | Execute a phase prompt (PLAN.md) and create the outcome summary (SUMMARY.md). | `execute-phase.md` (per-plan subagent) |
| `explore.md` | Socratic ideation — guide the developer through probing questions. | `/fvgsd-explore` |
| `debug.md` | Systematic debugging — subcommand routing, session creation, delegation to fvgsd-debug-session-manager. | `/fvgsd-debug` |
| `extract-learnings.md` | Extract decisions, lessons, patterns, and surprises from completed phase artifacts. | `/fvgsd-extract-learnings` |
| `fast.md` | Execute a trivial task inline without subagent overhead. | `/fvgsd-fast` |
| `forensics.md` | Forensics investigation of failed workflows — git, artifacts, and state analysis. | `/fvgsd-forensics` |
| `graduation.md` | Cluster recurring LEARNINGS.md items across phases and surface HITL promotion candidates. | `transition.md` (graduation_scan step) |
| `health.md` | Validate `.planning/` directory integrity and report actionable issues. | `/fvgsd-health` |
| `help.md` | Display the complete GSD command reference. | `/fvgsd-help` |
| `import.md` | Ingest external plans with conflict detection against existing project decisions. | `/fvgsd-import` |
| `inbox.md` | Triage open GitHub issues and PRs against project contribution templates. | `/fvgsd-inbox` |
| `ingest-docs.md` | Scan a repo for mixed planning docs; classify, synthesize, and bootstrap or merge into `.planning/` with a conflicts report. | `/fvgsd-ingest-docs` |
| `insert-phase.md` | Insert a decimal phase for urgent work discovered mid-milestone. | `/fvgsd-phase --insert` |
| `list-phase-assumptions.md` | Surface Claude's assumptions about a phase before planning. | `/fvgsd-discuss-phase --assumptions` |
| `list-workspaces.md` | List all GSD workspaces found in `~/fvgsd-workspaces/` with their status. | `/fvgsd-workspace --list` |
| `manager.md` | Interactive milestone command center — dashboard, inline discuss, background plan/execute. | `/fvgsd-manager` |
| `map-codebase.md` | Orchestrate parallel codebase mapper agents to produce `.planning/codebase/` docs. | `/fvgsd-map-codebase` |
| `milestone-summary.md` | Milestone summary synthesis — onboarding and review artifact from milestone artifacts. | `/fvgsd-milestone-summary` |
| `new-milestone.md` | Start a new milestone cycle — load project context, gather goals, update PROJECT.md/STATE.md. | `/fvgsd-new-milestone` |
| `new-project.md` | Unified new-project flow — questioning, research (optional), requirements, roadmap. | `/fvgsd-new-project` |
| `new-workspace.md` | Create an isolated workspace with repo worktrees/clones and an independent `.planning/`. | `/fvgsd-workspace --new` |
| `next.md` | Detect current project state and automatically advance to the next logical step. | `/fvgsd-progress --next` |
| `node-repair.md` | Autonomous repair operator for failed task verification; invoked by `execute-plan`. | `execute-plan.md` (recovery) |
| `note.md` | Zero-friction idea capture — one Write call, one confirmation line. | `/fvgsd-capture --note` |
| `pause-work.md` | Create structured `.planning/HANDOFF.json` and `.continue-here.md` handoff files. | `/fvgsd-pause-work` |
| `plan-phase.md` | Create executable PLAN.md files with integrated research and verification loop. | `/fvgsd-plan-phase`, `/fvgsd-quick` |
| `plan-review-convergence.md` | Cross-AI plan convergence loop — replan with review feedback until no HIGH concerns remain. | `/fvgsd-plan-review-convergence` |
| `plant-seed.md` | Capture a forward-looking idea as a structured seed file with trigger conditions. | `/fvgsd-capture --seed` |
| `pr-branch.md` | Create a clean branch for pull requests by filtering `.planning/` commits. | `/fvgsd-pr-branch` |
| `profile-user.md` | Orchestrate the full developer profiling flow — consent, session scan, profile generation. | `/fvgsd-profile-user` |
| `progress.md` | Progress rendering — project context, position, and next-action routing. | `/fvgsd-progress` |
| `quick.md` | Quick-task execution with GSD guarantees (atomic commits, state tracking). | `/fvgsd-quick` |
| `reapply-patches.md` | Reapply local modifications after a GSD update. | `/fvgsd-update --reapply` |
| `remove-phase.md` | Remove a future phase from the roadmap and renumber subsequent phases. | `/fvgsd-phase --remove` |
| `remove-workspace.md` | Remove a GSD workspace and clean up worktrees. | `/fvgsd-workspace --remove` |
| `resume-project.md` | Resume work — restore full context from STATE.md, HANDOFF.json, and artifacts. | `/fvgsd-resume-work` |
| `review.md` | Cross-AI plan review via external CLIs; produces REVIEWS.md. | `/fvgsd-review` |
| `scan.md` | Rapid single-focus codebase scan — lightweight alternative to map-codebase. | `/fvgsd-map-codebase --fast` |
| `secure-phase.md` | Retroactive threat-mitigation audit for a completed phase. | `/fvgsd-secure-phase` |
| `session-report.md` | Session report — token usage, work summary, outcomes. | `/fvgsd-pause-work --report` |
| `settings.md` | Configure GSD workflow toggles and model profile. | `/fvgsd-settings`, `/fvgsd-config --profile` |
| `settings-advanced.md` | Configure GSD power-user knobs — plan bounce, timeouts, branch templates, cross-AI execution, runtime knobs. | `/fvgsd-config --advanced` |
| `settings-integrations.md` | Configure third-party API keys (Brave/Firecrawl/Exa), `review.models.<cli>` CLI routing, and `agent_skills.<agent-type>` injection with masked (`****<last-4>`) display. | `/fvgsd-config --integrations` |
| `ship.md` | Create PR, run review, and prepare for merge after verification. | `/fvgsd-ship` |
| `sketch.md` | Explore design directions through throwaway HTML mockups with 2-3 variants per sketch. | `/fvgsd-sketch` |
| `sketch-wrap-up.md` | Curate sketch findings and package them as a persistent `sketch-findings-[project]` skill. | `/fvgsd-sketch --wrap-up` |
| `spec-phase.md` | Socratic spec refinement with ambiguity scoring; produces SPEC.md. | `/fvgsd-spec-phase` |
| `spike.md` | Rapid feasibility validation through focused, throwaway experiments. | `/fvgsd-spike` |
| `spike-wrap-up.md` | Curate spike findings and package them as a persistent `spike-findings-[project]` skill. | `/fvgsd-spike --wrap-up` |
| `stats.md` | Project statistics rendering — phases, plans, requirements, git metrics. | `/fvgsd-stats` |
| `sync-skills.md` | Cross-runtime GSD skill sync — diff and apply `fvgsd-*` skill directories across runtime roots. | `/fvgsd-update --sync` |
| `transition.md` | Phase-boundary transition workflow — workstream checks, state advancement. | `execute-phase.md`, `/fvgsd-progress --next` |
| `ui-phase.md` | Generate UI-SPEC.md design contract via fvgsd-ui-researcher. | `/fvgsd-ui-phase` |
| `ui-review.md` | Retroactive 6-pillar visual audit via fvgsd-ui-auditor. | `/fvgsd-ui-review` |
| `ultraplan-phase.md` | [BETA] Offload planning to Claude Code's ultraplan cloud; drafts remotely and imports back via `/fvgsd-import`. | `/fvgsd-ultraplan-phase` |
| `undo.md` | Safe git revert — phase or plan commits using the phase manifest. | `/fvgsd-undo` |
| `thread.md` | Create, list, close, or resume persistent context threads for cross-session work. | `/fvgsd-thread` |
| `update.md` | Update GSD to latest version with changelog display. | `/fvgsd-update` |
| `validate-phase.md` | Retroactively audit and fill Nyquist validation gaps for a completed phase. | `/fvgsd-validate-phase` |
| `verify-phase.md` | Verify phase goal achievement through goal-backward analysis. | `execute-phase.md` (post-execution) |
| `verify-work.md` | Conversational UAT with auto-diagnosis — produces UAT.md and fix plans. | `/fvgsd-verify-work` |

> **Note:** Some workflows have no direct user-facing command (e.g. `execute-plan.md`, `verify-phase.md`, `transition.md`, `node-repair.md`, `diagnose-issues.md`) — they are invoked internally by orchestrator workflows. `discovery-phase.md` is an alternate entry for `/fvgsd-new-project`.

---

## References (63 shipped)

Full roster at `get-shit-done/references/*.md`. References are shared knowledge documents that workflows and agents `@-reference`. The groupings below match [`docs/ARCHITECTURE.md`](ARCHITECTURE.md#references-get-shit-donereferencesmd) — core, workflow, thinking-model clusters, and the modular planner decomposition.

### Core References

| Reference | Role |
|-----------|------|
| `checkpoints.md` | Checkpoint type definitions and interaction patterns. |
| `gates.md` | 4 canonical gate types (Confirm, Quality, Safety, Transition) wired into plan-checker and verifier. |
| `model-profiles.md` | Per-agent model tier assignments. |
| `model-profile-resolution.md` | Model resolution algorithm documentation. |
| `verification-patterns.md` | How to verify different artifact types. |
| `verification-overrides.md` | Per-artifact verification override rules. |
| `planning-config.md` | Full config schema and behavior. |
| `git-integration.md` | Git commit, branching, and history patterns. |
| `git-planning-commit.md` | Planning directory commit conventions. |
| `questioning.md` | Dream-extraction philosophy for project initialization. |
| `tdd.md` | Test-driven development integration patterns. |
| `ui-brand.md` | Visual output formatting patterns. |
| `common-bug-patterns.md` | Common bug patterns for code review and verification. |
| `debugger-philosophy.md` | Evergreen debugging disciplines loaded by `fvgsd-debugger`. |
| `mandatory-initial-read.md` | Shared required-reading boilerplate injected into agent prompts. |
| `project-skills-discovery.md` | Shared project-skills-discovery boilerplate injected into agent prompts. |

### Workflow References

| Reference | Role |
|-----------|------|
| `agent-contracts.md` | Formal interface between orchestrators and agents. |
| `context-budget.md` | Context window budget allocation rules. |
| `continuation-format.md` | Session continuation/resume format. |
| `domain-probes.md` | Domain-specific probing questions for discuss-phase. |
| `gate-prompts.md` | Gate/checkpoint prompt templates. |
| `scout-codebase.md` | Phase-type→codebase-map selection table for discuss-phase scout step (extracted via #2551). |
| `revision-loop.md` | Plan revision iteration patterns. |
| `universal-anti-patterns.md` | Universal anti-patterns to detect and avoid. |
| `worktree-path-safety.md` | Worktree guard suite: HEAD assertion, cwd-drift sentinel (step 0a, #3097), and absolute-path guard (step 0b, #3099) — loaded into executor spawn prompts via `<execution_context>`. |
| `artifact-types.md` | Planning artifact type definitions. |
| `phase-argument-parsing.md` | Phase argument parsing conventions. |
| `decimal-phase-calculation.md` | Decimal sub-phase numbering rules. |
| `workstream-flag.md` | Workstream active-pointer conventions (`--ws`). |
| `user-profiling.md` | User behavioral profiling detection heuristics. |
| `thinking-partner.md` | Conditional thinking-partner activation at decision points. |
| `autonomous-smart-discuss.md` | Smart-discuss logic for autonomous mode. |
| `ios-scaffold.md` | iOS application scaffolding patterns. |
| `ai-evals.md` | AI evaluation design reference for `/fvgsd-ai-integration-phase`. |
| `ai-frameworks.md` | AI framework decision-matrix reference for `fvgsd-framework-selector`. |
| `executor-examples.md` | Worked examples for the fvgsd-executor agent. |
| `doc-conflict-engine.md` | Shared conflict-detection contract for ingest/import workflows. |
| `execute-mvp-tdd.md` | Runtime gate semantics for execute-phase under MVP+TDD — pre-task failing-test verification, end-of-phase blocking review. |
| `verify-mvp-mode.md` | UAT framing rules for MVP-mode phases — user-flow-first ordering, deferred technical checks, user-story-format guard. |
| `build-summary.md` | Build summary format: the frontmatter keys the lead writes versus those `build.finalize` writes, and the ID coverage rule. |
| `build-brief.md` | Build brief format: frontmatter read by code, body sections, and the fields `build.check-brief` validates. |

### Sketch References

References consumed by the `/fvgsd-sketch` workflow and its wrap-up companion.

| Reference | Role |
|-----------|------|
| `sketch-interactivity.md` | Rules for making HTML sketches feel interactive and alive. |
| `sketch-theme-system.md` | Shared CSS theme variable system for cross-sketch consistency. |
| `sketch-tooling.md` | Floating toolbar utilities included in every sketch. |
| `sketch-variant-patterns.md` | Multi-variant HTML patterns (tabs, side-by-side, overlays). |

### Thinking-Model References

References for integrating thinking-class models (o3, o4-mini, Gemini 2.5 Pro) into GSD workflows.

| Reference | Role |
|-----------|------|
| `thinking-models-debug.md` | Thinking-model patterns for debug workflows. |
| `thinking-models-execution.md` | Thinking-model patterns for execution agents. |
| `thinking-models-planning.md` | Thinking-model patterns for planning agents. |
| `thinking-models-research.md` | Thinking-model patterns for research agents. |
| `thinking-models-verification.md` | Thinking-model patterns for verification agents. |

### Modular Planner Decomposition

The `fvgsd-planner` agent is decomposed into a core agent plus reference modules to fit runtime character limits.

| Reference | Role |
|-----------|------|
| `planner-antipatterns.md` | Planner anti-patterns and specificity examples. |
| `planner-chunked.md` | Chunked mode return formats (`## OUTLINE COMPLETE`, `## PLAN COMPLETE`) for Windows stdio hang mitigation. |
| `planner-gap-closure.md` | Gap-closure mode behavior (reads VERIFICATION.md, targeted replanning). |
| `planner-reviews.md` | Cross-AI review integration (reads REVIEWS.md from `/fvgsd-review`). |
| `planner-revision.md` | Plan revision patterns for iterative refinement. |
| `planner-source-audit.md` | Planner source-audit and authority-limit rules. |
| `planner-mvp-mode.md` | Vertical-slice planning rules for MVP mode. |
| `planner-human-verify-mode.md` | Rules for `workflow.human_verify_mode = end-of-phase`: suppress `checkpoint:human-verify` task emission and route deferred items via `<verify><human-check>`. |
| `planner-graphify-auto-update.md` | How `load_graph_context` surfaces `.last-build-status.json` auto-update state (running / failed / stale head) alongside the existing staleness annotation. Opt-in via `graphify.auto_update` (#3347). |
| `skeleton-template.md` | SKELETON.md template emitted for new-project Walking Skeleton (Phase 1 + `--mvp`). |
| `user-story-template.md` | User story format for MVP planning — "As a / I want to / So that" structured fields. |
| `spidr-splitting.md` | SPIDR splitting decomposition rules for handling large user stories in MVP mode. |

> **Subdirectory:** `get-shit-done/references/few-shot-examples/` contains additional few-shot examples (`plan-checker.md`, `verifier.md`) that are referenced from specific agents. These are not counted in the 63 top-level references.

---

## CLI Modules (76 shipped)

Full listing: `get-shit-done/bin/lib/*.cjs`.

| Module | Responsibility |
|--------|----------------|
| `active-workstream-store.cjs` | Workstream source precedence and selection (CLI `--ws` > `FVGSD_WORKSTREAM` env > stored pointer); name validation and environment propagation |
| `adr-parser.cjs` | ADR decision parser for plan-phase ingest express path; normalizes section synonyms, parses status/decision/scope fences, and enforces status rejection gates |
| `artifacts.cjs` | Canonical artifact registry — known `.planning/` root file names; used by `fvgsd-health` W019 lint |
| `audit.cjs` | Audit dispatch, audit open sessions, audit storage helpers |
| `cjs-command-router-adapter.cjs` | Shared compatibility adapter for manifest-backed CJS command-family routers |
| `cjs-sdk-bridge.cjs` | Shared SDK runtime-bridge loader (`tryLoadSdk`/`getExecuteForCjs`); consumed by every CJS router and `fvgsd-tools.cjs` to delegate canonical commands to the SDK in-process |
| `clusters.cjs` | Skill cluster definitions for the runtime surface module (ADR-0011 Phase 2) |
| `code-review-flags.cjs` | Typed flag parser for `/fvgsd:code-review`; exports `parseCodeReviewFlags(argv)` (→ `{ fix, all, auto, depth, files }`) and `resolveCodeReviewWorkflow(flags)` (→ `'code-review.md' \| 'code-review-fix.md'`); canonical dispatch seam for `--fix`/`--all`/`--auto` routing |
| `command-aliases.generated.cjs` | Generated CJS alias/subcommand metadata for manifest-backed family routers |
| `command-routing-hub.cjs` | Pure-result dispatch hub that centralizes mode decision (SDK vs CJS), error taxonomy, and no-throw contract for all command-family routers (#3788) |
| `commands.cjs` | Misc CLI commands (slug, timestamp, todos, scaffolding, stats) |
| `config-schema.cjs` | Single source of truth for `VALID_CONFIG_KEYS` and dynamic key patterns; imported by both the validator and the config-schema-docs parity test |
| `config.cjs` | `config.json` read/write, section initialization; imports validator from `config-schema.cjs` |
| `configuration.generated.cjs` | Generated Configuration Module — canonical config loading, legacy-key normalization, defaults merge, and explicit on-disk migration; source of truth for both SDK and CJS consumers |
| `context-utilization.cjs` | Pure classifier for `fvgsd-health --context` — turns (tokensUsed, contextWindow) into a `{ percent, state }` triage result against the 60%/70% fracture-point thresholds (#2792) |
| `core.cjs` | Error handling, output formatting, shared utilities, runtime fallbacks; compatibility re-exports for planning-workspace helpers |
| `decisions.cjs` | CJS shim adapter — re-exports from `decisions.generated.cjs` (Phase 6/#3575 Shared Module migration) |
| `decisions.generated.cjs` | GENERATED — CJS artifact emitted from `sdk/src/query/decisions.ts` via `sdk/scripts/gen-decisions.mjs`; parses CONTEXT.md `<decisions>` blocks, accepts numeric (D-42) and alphanumeric (D-INFRA-01) IDs, returns `{id, text, category, tags, trackable}`; do not edit directly |
| `docs.cjs` | Docs-update workflow init, Markdown scanning, monorepo detection |
| `drift.cjs` | Post-execute codebase structural drift detector (#2003): classifies file changes into new-dir/barrel/migration/route categories and round-trips `last_mapped_commit` frontmatter |
| `execution-branch.cjs` | Shared standalone/Vibe execution-branch inspection and safety guard used by every installed public command |
| `fallow-runner.cjs` | Fallow audit adapter for `/fvgsd-code-review`: binary resolution (`PATH` then `node_modules/.bin`), actionable missing-binary errors, and structural findings normalization |
| `frontmatter.cjs` | YAML frontmatter CRUD operations |
| `gap-checker.cjs` | Post-planning gap analysis (#2493): unified REQUIREMENTS.md + CONTEXT.md decisions vs PLAN.md coverage report (`fvgsd-tools gap-analysis`) |
| `graphify.cjs` | Knowledge-graph build/query/status/diff for `/fvgsd-graphify` |
| `gsd2-import.cjs` | External-plan ingest for `/fvgsd-import --from-gsd2` |
| `identity.cjs` | Frozen fvgsd identity names (install folder, command/agent prefixes, bins, markers); single source of truth copied to `sdk/src/identity.ts` by `scripts/gen-identity-ts.cjs` |
| `init-command-router.cjs` | Thin CJS subcommand router adapter for `fvgsd-tools init` |
| `init.cjs` | Compound context loading for each workflow type |
| `install-profiles.cjs` | Install profile allowlist + skill staging for `--minimal` install (#2762); single source of truth for which `fvgsd-*` skills/agents land in runtime config dirs |
| `installer-migration-authoring.cjs` | Installer migration authoring guardrails for record metadata, explicit scopes, ownership evidence, and runtime contract citations |
| `installer-migration-report.cjs` | Installer migration report projection and blocked-action guard for install/update integration |
| `installer-migrations.cjs` | Installer migration planning, artifact classification, install-state persistence, journaled apply, and rollback helpers |
| `intel.cjs` | Codebase intel store backing `/fvgsd-map-codebase --query` and `fvgsd-intel-updater` |
| `learnings.cjs` | Cross-phase learnings extraction for `/fvgsd-extract-learnings` |
| `milestone.cjs` | Milestone archival, requirements marking |
| `model-catalog.cjs` | CJS adapter over the shared model catalog JSON; exports canonical runtime tier defaults, agent profile maps, alias maps, and routing metadata for all CLI consumers |
| `model-profiles.cjs` | Backward-compatible profile helpers derived from `model-catalog.cjs`; no longer owns its own model table |
| `phase-command-router.cjs` | Thin CJS subcommand router adapter for `fvgsd-tools phase` |
| `phase.cjs` | Phase directory operations, decimal numbering, plan indexing |
| `phases-command-router.cjs` | Thin CJS subcommand router adapter for `fvgsd-tools phases` |
| `plan-scan.cjs` | CJS shim adapter — re-exports from `plan-scan.generated.cjs` (Phase 6/#3575 Shared Module migration) |
| `plan-scan.generated.cjs` | GENERATED — CJS artifact emitted from `sdk/src/query/plan-scan.ts` via `sdk/scripts/gen-plan-scan.mjs`; canonical phase-plan scanner for detecting plan and summary files in flat and nested layouts (k014); do not edit directly |
| `planning-workspace.cjs` | Planning path/workstream seam (`planningDir`, `planningPaths`, active-workstream routing, `.planning/.lock` orchestration) |
| `project-root.generated.cjs` | GENERATED — CJS artifact emitted from `sdk/src/project-root/index.ts` via `sdk/scripts/gen-project-root.mjs`; resolves a project root from a starting directory using four heuristics (own `.planning/` guard, `sub_repos` config, `multiRepo` flag, `.git` heuristic); do not edit directly |
| `profile-output.cjs` | Profile rendering, USER-PROFILE.md and dev-preferences.md generation |
| `profile-pipeline.cjs` | User behavioral profiling data pipeline, session file scanning |
| `prompt-budget.cjs` | Pure token-budget accounting for review prompts — estimates tokens, applies deterministic trim priority (head-shrink PROJECT.md, proportional plan truncation, drop context/research/requirements, hard-fail guard), returns structured metadata for `review.max_prompt_tokens` (#3081) |
| `review-reviewer-selection.cjs` | Reviewer selection/normalization helpers for `/fvgsd-review` default reviewer policy and precedence |
| `roadmap-command-router.cjs` | Thin CJS subcommand router adapter for `fvgsd-tools roadmap` |
| `roadmap.cjs` | ROADMAP.md parsing, phase extraction, plan progress |
| `runtime-artifact-layout.cjs` | Runtime artifact layout module — resolves the artifact directory shapes (commands, agents, skills) for each supported runtime; single source of truth for per-runtime artifact placement (#3663) |
| `runtime-homes.cjs` | Canonical runtime → global config/skills directory mapping; first-class support for all 15 runtimes including Hermes nested layout and Cline rules-based exclusion (#3126) |
| `runtime-slash.cjs` | Runtime-aware slash-command formatter — single source of truth for emitting `/fvgsd-<cmd>` (skills-based runtimes) and `$fvgsd-<cmd>` (codex) in user-facing output and persisted artifacts (#3584) |
| `schema-detect.cjs` | CJS shim adapter — re-exports from `schema-detect.generated.cjs` (Phase 6/#3575 Shared Module migration) |
| `schema-detect.generated.cjs` | GENERATED — CJS artifact emitted from `sdk/src/query/schema-detect.ts` via `sdk/scripts/gen-schema-detect.mjs`; schema-drift detection for ORM patterns (Prisma, Drizzle, Supabase, TypeORM, Payload); exports `detectSchemaFiles`, `detectSchemaOrm`, `checkSchemaDrift`, `SCHEMA_PATTERNS`, `ORM_INFO`; do not edit directly |
| `secrets.cjs` | CJS shim adapter — re-exports from `secrets.generated.cjs` (Phase 6/#3575 Shared Module migration) |
| `secrets.generated.cjs` | GENERATED — CJS artifact emitted from `sdk/src/query/secrets.ts` via `sdk/scripts/gen-secrets.mjs`; secret-config masking convention (`****<last-4>`) for integration keys; exports `SECRET_CONFIG_KEYS`, `isSecretKey`, `maskSecret`, `maskIfSecret`; do not edit directly |
| `security.cjs` | Path traversal prevention, prompt injection detection, safe JSON/shell helpers |
| `shell-command-projection.cjs` | Runtime-aware shell command projection for managed hook serialization: decides PowerShell call-operator usage by runtime/platform and normalizes Windows script path tokens |
| `state-command-router.cjs` | Thin CJS subcommand router adapter for `fvgsd-tools state` |
| `state.cjs` | STATE.md parsing, updating, progression, metrics |
| `state-document.cjs` | Pure STATE.md field extraction, replacement, status normalization, and progress calculation transforms |
| `state-document.generated.cjs` | GENERATED — CJS artifact emitted from `sdk/src/query/state-document.ts` via `sdk/scripts/gen-state-document.ts`; do not edit directly |
| `surface.cjs` | Runtime surface module — manages the runtime enable/disable surface state independently of the install-time profile marker (ADR-0011 Phase 2) |
| `template.cjs` | Template selection and filling with variable substitution |
| `uat.cjs` | UAT file parsing, verification debt tracking, audit-uat support |
| `validate-command-router.cjs` | Thin CJS subcommand router adapter for `fvgsd-tools validate` |
| `verify-command-router.cjs` | Thin CJS subcommand router adapter for `fvgsd-tools verify` |
| `verify.cjs` | Plan structure, phase completeness, reference, commit validation |
| `workstream-inventory-builder.generated.cjs` | GENERATED — pure workstream inventory projection builder; CJS artifact emitted from `sdk/src/workstream-inventory/builder.ts` via `sdk/scripts/gen-workstream-inventory-builder.mjs`; do not edit directly |
| `workstream-inventory.cjs` | Shared workstream inventory projection: state fields, phase/plan/summary counts, roadmap phase count, and active marker — thin orchestrator that delegates pure projection to `workstream-inventory-builder.generated.cjs` |
| `workstream-name-policy.cjs` | CJS shim adapter — re-exports from `workstream-name-policy.generated.cjs` (Phase 6/#3575 Shared Module migration) |
| `workstream-name-policy.generated.cjs` | GENERATED — CJS artifact emitted from `sdk/src/workstream-name-policy.ts` via `sdk/scripts/gen-workstream-name-policy.mjs`; canonical workstream name validation (`isValidActiveWorkstreamName`, `hasInvalidPathSegment`, `validateWorkstreamName`) and slug normalization (`toWorkstreamSlug`); do not edit directly |
| `workstream.cjs` | Workstream CRUD, migration, session-scoped active pointer |
| `worktree-safety.cjs` | Worktree-root resolution and non-destructive prune policy decisions; owns W017 health-check logic |

[`docs/CLI-TOOLS.md`](CLI-TOOLS.md) may describe a subset of these modules; when it disagrees with the filesystem, this table and the directory listing are authoritative.

---

## Hooks (13 shipped)

Full listing: `hooks/`.

| Hook | Event | Purpose |
|------|-------|---------|
| `fvgsd/statusline.js` | `statusLine` | Displays model, task, directory, context usage |
| `fvgsd/context-monitor.js` | `PostToolUse` / `AfterTool` | Injects agent-facing context warnings at 35%/25% remaining |
| `fvgsd/check-update.js` | `SessionStart` | Background check for new GSD versions |
| `fvgsd/check-update-worker.js` | (worker) | Background worker helper for check-update |
| `fvgsd/update-banner.js` | `SessionStart` | Opt-in banner surfacing update availability when GSD statusline isn't used (PR #2795) |
| `fvgsd/prompt-guard.js` | `PreToolUse` | Scans `.planning/` writes for prompt-injection patterns (advisory) |
| `fvgsd/workflow-guard.js` | `PreToolUse` | Detects file edits outside GSD workflow context (advisory, opt-in) |
| `fvgsd/read-guard.js` | `PreToolUse` | Advisory guard preventing Edit/Write on unread files |
| `fvgsd/read-injection-scanner.js` | `PostToolUse` | Scans tool Read results for prompt-injection patterns (v1.36+, PR #2201) |
| `fvgsd/session-state.sh` | `PostToolUse` | Session-state tracking for shell-based runtimes |
| `fvgsd/validate-commit.sh` | `PostToolUse` | Commit validation for conventional-commit enforcement |
| `fvgsd/phase-boundary.sh` | `PostToolUse` | Phase-boundary detection for workflow transitions |
| `fvgsd/graphify-update.sh` | `PostToolUse` | Auto-rebuild knowledge graph after main HEAD advances (opt-in, default off — #3347) |

---

## Maintenance

- When a new command, agent, workflow, reference, CLI module, or hook ships, update the corresponding section here before the release is cut.
- The drift-guard tests under `tests/` (see "How To Use This File" above) assert that every shipped file is enumerated in this inventory. A new file without a matching row here will fail CI.
- When the filesystem diverges from `docs/ARCHITECTURE.md` counts or from curated-subset docs (e.g. `docs/AGENTS.md`'s primary roster), this file is the source of truth.
