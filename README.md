# VibeClaw

VibeClaw is a repository-backed orchestration layer for running one GSD workflow across multiple AI coding tools.

Gemini can research, Codex can plan, OpenCode and Claude Code Router can produce competing implementations, and Codex can verify the selected result. The tools never message each other. They coordinate through durable repository state, explicit Git commits, and human-controlled promotion.

```text
human/operator
      |
      v
VibeClaw repository state
      |
      +-- Gemini
      +-- Codex
      +-- Claude Code
      +-- Claude Code Router
      +-- OpenCode
      +-- Grok Build
```

VibeClaw extends [Get Shit Done (GSD)](https://github.com/gsd-build/get-shit-done). Existing GSD commands and `.planning/` projects continue to work normally; orchestration is an optional layer enabled per project with `vibe init`.

## Why VibeClaw

Most multi-agent systems depend on shared conversations or hidden runtime state. VibeClaw instead makes the repository the orchestration brain:

- workflow stages remain independent of tools;
- named routes provide overridable tool defaults;
- multiple tools can run the same stage from the same exact Git commit;
- every candidate receives an isolated branch and worktree;
- completion and promotion are separate actions;
- only the promoted candidate becomes input to the next stage;
- manifests retain provenance, artifacts, timing, token usage, cost, notes, and ratings;
- human-readable and JSON interfaces use the same reusable core library.

There is no agent-to-agent chat, negotiation, message queue, or automatic winner selection.

## Requirements

- Node.js 22 or newer
- Git
- At least one supported AI CLI for managed launch, or any tool that can consume the generated context manually

## Local setup

```bash
git clone https://github.com/antaone/get-shit-done-vibeclaw.git
cd get-shit-done-vibeclaw
npm install
npm link
```

`npm link` exposes the `vibe`, `get-shit-done-cc`, `gsd-tools`, and `gsd-sdk` commands locally. You can also run VibeClaw without linking:

```bash
node bin/vibe.js --help
```

## GSD: the workflow foundation

Get Shit Done is the spec-driven development system underneath VibeClaw. GSD turns a project idea into durable requirements, a roadmap, executable phase plans, implementation commits, and verification evidence. Its state lives in `.planning/`, so work survives context resets and can be resumed by another compatible runtime.

VibeClaw does not replace this process. It adds routing, candidates, worktrees, and promotion around GSD stages.

| Layer | Responsibility | State |
| --- | --- | --- |
| GSD | Discuss, research, specify, plan, execute, verify, and manage milestones | `.planning/` |
| VibeClaw | Assign tools, isolate candidates, record provenance, and promote results | `.planning-vibe/` |

### Install GSD

After the local setup above, install GSD for the runtimes you use:

```bash
# Interactive runtime and location selection
get-shit-done-cc

# Examples
get-shit-done-cc --codex --global
get-shit-done-cc --claude --global
get-shit-done-cc --gemini --global
get-shit-done-cc --opencode --global

# Install every supported runtime
get-shit-done-cc --all --global
```

The published-package form is `npx get-shit-done-cc` with the same flags. Use `--local` instead of `--global` to install only into the current project. `--profile=core`, `--profile=standard`, and `--profile=full` control the installed skill surface; `full` is the default.

The installer supports Claude Code, OpenCode, Gemini CLI, Kilo, Codex, Copilot, Antigravity, Cursor, Windsurf, Augment, Trae, Qwen Code, Hermes Agent, Cline, and CodeBuddy.

### GSD command syntax

The installer writes the correct command form for each runtime:

| Runtime | Example |
| --- | --- |
| Claude Code, OpenCode, Copilot, Kilo, Cursor, and similar runtimes | `/gsd-plan-phase 1` |
| Gemini CLI | `/gsd:plan-phase 1` |
| Codex | `$gsd-plan-phase 1` |

The spelling changes, but the workflow and persisted artifacts are the same.

### Core GSD workflow

```text
new project
    |
    v
discuss phase -> plan phase -> execute phase -> verify work
    |                                               |
    +--------------- durable .planning/ state ------+
                                                    |
                                                    v
                                           complete milestone
```

Using the common hyphen-style command form:

```text
/gsd-new-project
/gsd-discuss-phase 1
/gsd-plan-phase 1
/gsd-execute-phase 1
/gsd-verify-work 1
/gsd-complete-milestone
```

For an existing codebase, run `/gsd-map-codebase` before `/gsd-new-project`. Use `/gsd-progress` to inspect the current position and `/gsd-resume-work` after a context reset or a new session.

### What GSD provides

- structured project discovery, requirements, roadmaps, and phase planning;
- explicit discussion and decision capture before implementation;
- specialized research, planning, execution, verification, review, and security roles;
- plan checking, Nyquist validation, requirements coverage, and post-execution verification;
- Git-aware phase execution, worktree support, commits, and milestone completion;
- brownfield codebase mapping and dependency visualization;
- quick tasks, autonomous phases, debugging, UI review, code review, and security audits;
- persistent progress, pause/resume state, workstreams, backlogs, and context threads;
- configuration, model profiles, dynamic routing, hooks, and a TypeScript SDK.

GSD can be used by itself. If you do not run `vibe init`, nothing creates `.planning-vibe/` or changes the normal GSD lifecycle.

For the full methodology, see the [GSD User Guide](docs/USER-GUIDE.md), [Command Reference](docs/COMMANDS.md), [Feature Reference](docs/FEATURES.md), and [Configuration Reference](docs/CONFIGURATION.md).

## VibeClaw quick start

Run these commands inside a Git repository with an initial commit:

```bash
vibe init
vibe route list
vibe route use cheap
vibe run start feature-development --id feature-014
```

Prepare the route-selected research candidate:

```bash
vibe stage prepare research
vibe context
```

The prepare command creates a candidate manifest, an exact-base branch, an isolated worktree, and runtime-neutral JSON and Markdown context. Work manually in the printed worktree or ask VibeClaw to construct a managed launch:

```bash
vibe stage launch <candidate-id>
vibe stage launch <candidate-id> --execute
```

After the assigned work is finished, persist artifacts and complete the candidate:

```bash
vibe stage complete <candidate-id> \
  --summary "Research complete" \
  --artifact .planning/research.md
```

Completion does not advance the workflow. Inspect and promote explicitly:

```bash
vibe candidates research
vibe promote <candidate-id>
vibe next
```

## Competing implementations

Any stage can have multiple independent candidates. For example:

```bash
vibe stage prepare execute --tool opencode
vibe stage prepare execute --tool claude-router
vibe stage prepare execute --tool codex
```

All three candidates consume the same promoted plan and start at the same recorded base commit, but use separate branches and worktrees. After each tool commits its implementation:

```bash
vibe stage complete feature-014-execute-opencode-001 --summary "OpenCode implementation"
vibe stage complete feature-014-execute-claude-router-002 --summary "Claude Router implementation"
vibe stage complete feature-014-execute-codex-003 --summary "Codex implementation"

vibe status
vibe promote feature-014-execute-claude-router-002
```

The next verification candidate consumes only the promoted implementation.

## Routes and workflows

VibeClaw includes two starting routes:

| Stage | `cheap` | `quality` |
| --- | --- | --- |
| Research | Gemini | Gemini |
| Discuss | Claude | Claude |
| Plan | Codex | Codex |
| Execute | OpenCode | Claude Code Router |
| Verify | Codex | Codex |
| Review | Claude | Claude |

Routes are project-local YAML files under `.planning-vibe/routes/`. They are defaults, not restrictions; `--tool` always wins.

The bundled `feature-development` workflow defines:

```text
research -> optional discuss -> plan -> execute -> verify -> review
```

Each stage contract declares its required promoted input, expected outputs, whether source mutation is allowed, Git isolation requirements, completion conditions, and the existing GSD command it wraps.

## State model

VibeClaw keeps orchestration separate from GSD planning documents:

```text
.planning/                 GSD plans, research, context, and verification

.planning-vibe/
├── config.yaml            Project orchestration configuration
├── routes/                Named stage-to-tool defaults
├── workflows/             Runtime-neutral stage contracts
├── runs/                  Workflow run snapshots
├── candidates/            Candidate manifests, context, summaries, artifacts
├── promotions/            Current and immutable promotion records
├── history/events.jsonl   Append-only event history
├── locks/                 Recoverable orchestration locks
└── state/                 Active-run pointer

.vibe/worktrees/           Ignored candidate worktrees
```

Another tool entering the repository can reconstruct its run, stage, route, input, base commit, branch, worktree, expected output, and promotion status without previous chat history.

## Safe Git promotion

Candidate branches are not promoted project state until the operator runs `vibe promote`.

- First promotion uses a fast-forward from the exact expected integration commit.
- Replacing a selected candidate requires `--replace`.
- Replacement creates an exact-tree integration commit that preserves both candidate histories.
- Dirty integration trees, missing worktrees, deleted or advanced branches, divergent bases, and uncommitted candidate source changes are rejected.
- VibeClaw never silently resets, cleans, or force-checks out operator work.

## CLI

```text
vibe init
vibe route list|show|use
vibe run start|resume|show|list
vibe status
vibe next [--prepare]
vibe stage prepare|launch|complete
vibe context [candidate-id]
vibe candidates [stage]
vibe promote <candidate-id> [--replace]
vibe history
vibe cleanup <candidate-id> [--delete-branch]
vibe tool list|detect
```

Lifecycle and inspection commands support `--json`, including structured error output, for scripts and future dashboards.

## Supported adapters

| Tool ID | Runtime | Managed launch |
| --- | --- | --- |
| `codex` | OpenAI Codex CLI | Non-interactive |
| `claude` | Claude Code | Non-interactive |
| `claude-router` | Claude Code Router | Interactive |
| `opencode` | OpenCode | Non-interactive |
| `gemini` | Gemini CLI | Non-interactive |
| `grok` | Grok Build | Interactive |

Manual operation is always supported: prepare a candidate, open its worktree in your editor, run the assigned tool yourself, and then complete and promote through `vibe`.

## Development

```bash
npm test
node --test tests/vibe-core.test.cjs tests/vibe-cli.integration.test.cjs
npm run test:coverage
```

Root code uses CommonJS and `node:test`. The SDK under `sdk/` uses TypeScript and Vitest.

## Documentation

- [VibeClaw guide](docs/VIBECLAW.md)
- [Architecture and state design](docs/vibeclaw-orchestration-design.md)
- [GSD documentation index](docs/README.md)
- [CLI tools](docs/CLI-TOOLS.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Current scope

Promotion is intentionally human-controlled. Automatic candidate ranking, semantic comparison, route optimization, dashboard UI, and promotion-intent reconciliation are future work. The durable state and JSON interfaces are designed to support those additions without changing the candidate lifecycle.

## Attribution and license

VibeClaw is a fork and extension of GSD / Get Shit Done by TÂCHES and its contributors. It is distributed under the [MIT License](LICENSE).
