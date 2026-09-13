# VibeClaw

VibeClaw is a repository-backed orchestration layer for running one GSD workflow across multiple AI coding tools.

<!-- rename-identity:off -->
## fvgsd

This fork installs as **fvgsd**. Its commands are `/fvgsd-*`, and it installs into its own folders (`<config>/fvgsd/`, `hooks/fvgsd/`, `fvgsd-*` agents), so it runs side by side with upstream GSD (`/gsd-*`) and VibeClaw vgsd (`/vgsd-*`) without changing their files. Projects keep using the shared `.planning/` folder. fvgsd is not published to npm: install it from a clone with `npm install && npm run build:hooks && node bin/install.js --<runtime> --global`, and update it with `/fvgsd-update`, which pulls that clone.
<!-- rename-identity:on -->

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

VibeClaw extends [Get Shit Done (GSD)](https://github.com/gsd-build/get-shit-done). Existing `.planning/` projects and GSD workflow behavior continue to work normally; this fork exposes the commands under `fvgsd` so it can coexist with upstream GSD. Orchestration is an optional layer enabled per project with `fvgsd-vibe init`.

## Why VibeClaw

Most multi-agent systems depend on shared conversations or hidden runtime state. VibeClaw instead makes the repository the orchestration brain:

- workflow stages remain independent of tools;
- named routes provide overridable tool defaults;
- multiple tools can run the same stage from the same exact Git commit;
- every candidate receives an isolated branch and worktree;
- every `fvgsd` command verifies its Git execution branch before doing work;
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
npm run build:hooks
npm link
```

The first `npm install` now installs and builds the nested SDK automatically
when `sdk/dist/cli.js` is missing. A separate `cd sdk && npm run build` step is
not required. To troubleshoot or rebuild it explicitly, run
`npm run build:sdk` from the repository root.

`npm link` exposes the `fvgsd-vibe`, `fvgsd`, `fvgsd-tools`, and `fvgsd-sdk` commands locally. You can also run VibeClaw without linking:

```bash
node bin/vibe.js --help
```

## GSD: the workflow foundation

Get Shit Done is the spec-driven development system underneath VibeClaw. GSD turns a project idea into durable requirements, a roadmap, executable phase plans, implementation commits, and verification evidence. Its state lives in `.planning/`, so work survives context resets and can be resumed by another compatible runtime.

VibeClaw does not replace this process. It adds routing, candidates, worktrees, and promotion around GSD stages.

| Layer | Responsibility | State |
| --- | --- | --- |
| GSD | Discuss, research, specify, plan, execute, verify, and manage milestones | `.planning/` |
| VibeClaw | Assign tools, isolate candidates, record provenance, and promote results | `.planning-fvgsd-vibe/` |

### Install GSD

After the local setup above, install GSD for the runtimes you use:

```bash
# Interactive runtime and location selection
fvgsd

# Examples
fvgsd --codex --global
fvgsd --claude --global
fvgsd --gemini --global
fvgsd --opencode --global

# Install every supported runtime
fvgsd --all --global
```

Without `npm link`, run `node bin/install.js` with the same flags from the clone. Use `--local` instead of `--global` to install only into the current project. `--profile=core`, `--profile=standard`, and `--profile=full` control the installed skill surface; `full` is the default.

The installer supports Claude Code, OpenCode, Gemini CLI, Kilo, Codex, Copilot, Antigravity, Cursor, Windsurf, Augment, Trae, Qwen Code, Hermes Agent, Cline, and CodeBuddy.

### Uninstall GSD and VibeClaw

Run the installer again with `--uninstall`, using the same runtime and scope
that were used for installation. The scope is required so the installer never
guesses which configuration tree it may change.

```bash
# Remove one global runtime installation, run from the clone
node bin/install.js --codex --global --uninstall
node bin/install.js --claude --global --uninstall

# Remove the current project's local runtime installation
node bin/install.js --codex --local --uninstall

# Remove every supported runtime installation in the selected scope
node bin/install.js --all --global --uninstall
node bin/install.js --all --local --uninstall
```

Replace `--codex` or `--claude` with the runtime originally installed. The
uninstaller removes GSD/VibeClaw-managed commands, skills, agents, hooks, and
manifests while preserving unrelated runtime configuration and repository
files. It does not delete `.planning/`, `.planning-fvgsd-vibe/`, project source, or
Git history.

If this checkout was exposed with `npm link`, remove the linked executables
after uninstalling the runtime artifacts:

```bash
npm unlink --global fvgsd
```

Removing Vibe orchestration from a repository is a separate, destructive
operation. First promote or otherwise preserve any candidate work you need,
check `fvgsd-vibe status`, and clean each completed candidate with
`fvgsd-vibe cleanup <candidate-id>`. Only then remove the committed
`.planning-fvgsd-vibe/` directory and disposable `.fvgsd-vibe/` worktree directory. Keep
`.planning/` if you want the brownfield GSD history to remain available.

### GSD command syntax

The installer writes the correct command form for each runtime:

| Runtime | Example |
| --- | --- |
| Claude Code, OpenCode, Copilot, Kilo, Cursor, and similar runtimes | `/fvgsd-plan-phase 1` |
| Gemini CLI | `/fvgsd:plan-phase 1` |
| Codex | `$fvgsd-plan-phase 1` |

VibeClaw intentionally owns the `fvgsd` namespace so it can be installed beside
upstream GSD without ambiguous or duplicate commands. Gemini renders the same
namespace with a colon because its command loader derives namespaces from
directories; the workflow and persisted artifacts are otherwise identical.

### Which command comes first?

For orchestrated work, run the installed `fvgsd-vibe` gateway from the
integration worktree first. It discovers the repository state, offers direct,
single-candidate, or multi-candidate execution, and prepares the branches and
local worktrees or remote handoffs. Run the printed target `fvgsd` command only
after entering its local candidate worktree or tracked worker branch.

```text
fvgsd-vibe for the target -> local worktree or Git handoff -> target fvgsd command
```

Running the target command first is still valid when you intentionally want
simple direct work. Before Vibe initialization it creates a protected
standalone branch. After Vibe initialization, mutating target commands on the
integration worktree stop and direct you back through `fvgsd-vibe`.

### Automatic execution branches

Every installed `fvgsd` command runs a Git preflight before it reads workflow
context or changes project state. The result depends on the current project:

| Current context | Result |
| --- | --- |
| Valid Vibe candidate worktree | Reuse its `vibe/<run>/<stage>/<tool>-NNN` branch |
| Vibe initialized, but not in a candidate | Stop the mutating command and route through the installed `fvgsd-vibe` entry surface |
| No Vibe setup | Create `fvgsd/<runtime>/<command>/<execution-id>` |
| Existing matching `fvgsd/...` branch | Reuse it; a different command gets a new execution branch |
| Existing branch owned by another runtime | Stop instead of mixing tool results |

Standalone branch creation preserves uncommitted files and stores provenance
under Git's local common directory, not in the working tree. It records the
runtime, command, execution identity, source branch, and base commit without
storing the raw session ID. Run `fvgsd-vibe init` later and VibeClaw imports those
records into `.planning-fvgsd-vibe/state/standalone-executions.json`.

This makes direct usage safe too. For example, Codex running
`$fvgsd-new-project` without Vibe creates a branch shaped like:

```text
fvgsd/codex/new-project/20260819-123456-a1b2c3d4-e5f607
```

The read-only exceptions are `fvgsd help` and `fvgsd vibe`: they inspect branch
and orchestration state but never create a standalone execution branch.

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
/fvgsd-new-project
/fvgsd-discuss-phase 1
/fvgsd-plan-phase 1
/fvgsd-execute-phase 1
/fvgsd-verify-work 1
/fvgsd-complete-milestone
```

For an existing codebase, run `/fvgsd-map-codebase` before `/fvgsd-new-project`. Use `/fvgsd-progress` to inspect the current position and `/fvgsd-resume-work` after a context reset or a new session.

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

GSD can be used without orchestration. If you do not run `fvgsd-vibe init`, no
`.planning-fvgsd-vibe/` store is created; `fvgsd` still protects direct work with a
standalone smart branch as described above.

For the full methodology, see the [GSD User Guide](docs/USER-GUIDE.md), [Command Reference](docs/COMMANDS.md), [Feature Reference](docs/FEATURES.md), and [Configuration Reference](docs/CONFIGURATION.md).

## VibeClaw quick start

For greenfield, brownfield, same-host, and multi-machine guidance, start with
the [VibeClaw guide](docs/VIBECLAW.md#command-order-vibe-first-workflow-second).
For the full Gemini + Codex + Claude Code flow—from a new project through later
milestones and phase execution—follow the
[Multi-Tool Project-to-Milestone Walkthrough](docs/MULTI-TOOL-WALKTHROUGH.md).

The installed `fvgsd-vibe` command is the AI-facing entry point. It can route
project creation, milestones, phase stages, `quick`, `fast`, `debug`, reviews,
audits, and other public `fvgsd` commands through one or more candidates:

```text
/fvgsd-vibe quick --tool codex --tool claude
/fvgsd-vibe debug --tool codex
/fvgsd-vibe execute-phase --tool opencode --tool claude
```

Use `/fvgsd:vibe ...` in Gemini CLI and `$fvgsd-vibe ...` in Codex. The skill
uses the Vibe CLI copied into the same runtime installation as `fvgsd`, so it
does not depend on a separate terminal `fvgsd-vibe` command being on `PATH`.

For greenfield work, invoke `fvgsd-vibe` in the new project directory. It can
inspect the files, initialize Git, and ask for approval before creating the
required baseline commit. For brownfield work, invoke it from the existing
repository's integration branch. In either case, it can initialize Vibe and
prepare the selected candidates without making you translate the flow into
terminal commands.

When a brownfield `.planning/` tree still contains legacy `/gsd-<command>`, `/gsd:<command>`,
or `$gsd-<command>` public command references, the gateway reports their exact locations
and runtime-native `fvgsd` replacements before candidate preparation. Migration
is explicit: review the proposed edits, apply them through the gateway, and
commit the focused planning change so every candidate inherits the corrected
namespace from its recorded base.

Local mode uses one coordinator checkout and path-bound worktrees. Opt-in
multi-machine mode publishes guarded Git handoffs so assigned tools can execute
from independent clones:

```text
/fvgsd-vibe quick --multi-machine --remote origin --tool codex --tool claude
```

The coordinator atomically publishes candidate branches and identity tags.
Workers must use tracked branches, the assigned runtime and command, commit
every result, and push it. Coordinator completion fetches and verifies the
pushed commit; promotion rechecks the remote markers and pushes the integration
branch. See [Multi-machine Git handoffs](docs/VIBECLAW.md#execution-modes-local-worktrees-and-multi-machine-git-handoffs).

The equivalent lower-level CLI path, useful for automation and operators, is:

```bash
fvgsd-vibe init
fvgsd-vibe mode multi-machine --remote origin  # optional; default is local
fvgsd-vibe route list
fvgsd-vibe route use cheap
fvgsd-vibe run start feature-development --id feature-014
```

Prepare the route-selected research candidate:

```bash
fvgsd-vibe stage prepare research
fvgsd-vibe context
```

The prepare command creates a candidate manifest, an exact-base branch, an isolated worktree, and runtime-neutral JSON and Markdown context. Work manually in the printed worktree or ask VibeClaw to construct a managed launch:

```bash
fvgsd-vibe stage launch <candidate-id>
fvgsd-vibe stage launch <candidate-id> --execute
```

After the assigned work is finished, persist artifacts and complete the candidate:

```bash
fvgsd-vibe stage complete <candidate-id> \
  --summary "Research complete" \
  --artifact .planning/research.md
```

Completion does not advance the workflow. Inspect and promote explicitly:

```bash
fvgsd-vibe candidates research
fvgsd-vibe promote <candidate-id>
fvgsd-vibe next
```

## Competing implementations

Any stage can have multiple independent candidates. For example:

```bash
fvgsd-vibe stage prepare execute --tool opencode
fvgsd-vibe stage prepare execute --tool claude-router
fvgsd-vibe stage prepare execute --tool codex
```

All three candidates consume the same promoted plan and start at the same recorded base commit, but use separate branches and worktrees. After each tool commits its implementation:

```bash
fvgsd-vibe stage complete feature-014-execute-opencode-001 --summary "OpenCode implementation"
fvgsd-vibe stage complete feature-014-execute-claude-router-002 --summary "Claude Router implementation"
fvgsd-vibe stage complete feature-014-execute-codex-003 --summary "Codex implementation"

fvgsd-vibe status
fvgsd-vibe promote feature-014-execute-claude-router-002
```

The next verification candidate consumes only the promoted implementation.

## Routes and workflows

VibeClaw includes two starting routes:

| Stage | `cheap` | `quality` |
| --- | --- | --- |
| Project bootstrap | Gemini | Claude |
| Milestone bootstrap | Codex | Claude |
| Research | Gemini | Gemini |
| Discuss | Claude | Claude |
| Plan | Codex | Codex |
| Execute | OpenCode | Claude Code Router |
| Verify | Codex | Codex |
| Review | Claude | Claude |

Routes are project-local YAML files under `.planning-fvgsd-vibe/routes/`. They are defaults, not restrictions; `--tool` always wins.

VibeClaw includes `project-bootstrap` for competing GSD project foundations,
`milestone-bootstrap` for competing milestone definitions, and
`feature-development` for the repeated phase lifecycle:

```text
research -> optional discuss -> plan -> execute -> verify -> review
```

Each stage contract declares its required promoted input, expected outputs, whether source mutation is allowed, Git isolation requirements, completion conditions, and the existing GSD command it wraps.

## State model

VibeClaw keeps orchestration separate from GSD planning documents:

```text
.planning/                 GSD plans, research, context, and verification

.planning-fvgsd-vibe/
├── config.yaml            Project orchestration configuration
├── routes/                Named stage-to-tool defaults
├── workflows/             Runtime-neutral stage contracts
├── runs/                  Workflow run snapshots
├── candidates/            Candidate manifests, context, summaries, artifacts
├── promotions/            Current and immutable promotion records
├── history/events.jsonl   Append-only event history
├── locks/                 Recoverable orchestration locks
└── state/                 Active-run pointer and imported standalone executions

.fvgsd-vibe/worktrees/           Ignored candidate worktrees
```

Another tool entering a candidate through the same coordinator checkout can
reconstruct its run, stage, route, input, base commit, branch, worktree,
expected output, and promotion status without previous chat history.

## Safe Git promotion

Candidate branches are not promoted project state until the operator runs `fvgsd-vibe promote`.

- First promotion uses a fast-forward from the exact expected integration commit.
- Replacing a selected candidate requires `--replace`.
- Replacement creates an exact-tree integration commit that preserves both candidate histories.
- Dirty integration trees, missing worktrees, deleted or advanced branches, divergent bases, and uncommitted candidate source changes are rejected.
- VibeClaw never silently resets, cleans, or force-checks out operator work.

## CLI

```text
fvgsd-vibe init
fvgsd-vibe mode show|local|multi-machine [--remote <name>]
fvgsd-vibe route list|show|use
fvgsd-vibe run start|resume|show|list
fvgsd-vibe status
fvgsd-vibe next [--prepare]
fvgsd-vibe stage prepare|launch|complete
fvgsd-vibe context [candidate-id]
fvgsd-vibe candidates [stage]
fvgsd-vibe promote <candidate-id> [--replace]
fvgsd-vibe history
fvgsd-vibe cleanup <candidate-id> [--delete-branch]
fvgsd-vibe tool list|detect
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

Manual operation is always supported: prepare a candidate, open its worktree in your editor, run the assigned tool yourself, and then complete and promote through `fvgsd-vibe`.

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
