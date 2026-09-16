# /fvgsd-build Implementation Plan (Stage 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/fvgsd-build <phase>`, which takes a discussed phase to a verified implementation in one run: research only when RESEARCH.md is missing, a short brief, vertical slices built in parallel where the runtime allows, command-based checks, one verifier pass, capped fix rounds and an actions-taken summary.

**Architecture:**
- New SDK queries do the deterministic work: `init.build`, `checks.detect`, `build.check-brief`, `build.waves`, `build.run-checks`, `build.scan-stubs`, `build.merge-wave`, `build.group-problems` and `build.finalize`.
- A lean workflow (`get-shit-done/workflows/build.md`) drives those queries. It spawns a new `fvgsd-builder` agent in brief or slice mode, and the existing `fvgsd-verifier` in a new build mode.
- A per-runtime capability table (`sdk/shared/runtime-capabilities.json`) picks the parallel, sequential or inline tier.
- Routing, the manager, the SDK phase runner and VibeClaw offer the new command while `workflow.build_mode` is true, which is the default.

**Tech Stack:** Node.js ≥ 22 (CommonJS, `node:test`) at the root; TypeScript ESM with Vitest in `sdk/`; markdown prompt files; git worktrees.

**Spec:** `docs/superpowers/specs/2026-09-12-fvgsd-build-design.md`. Read it before starting; this plan argues from it. The spec's "Stage 2 (later): saved Claude Code workflow engine" is out of scope.

## Global Constraints

- Node.js ≥ 22. Root code is CommonJS, strict mode, two-space indentation, semicolons, `node:` imports. SDK code is strict TypeScript (ESM/NodeNext, `.js` import suffixes).
- Root tests use `node:test` and `node:assert/strict` with helpers from `tests/helpers.cjs`, named `*.test.cjs`. A test that spawns the installer ends in `.install.test.cjs`. SDK tests use Vitest next to the source (`*.test.ts`); tests that build temporary git repositories with worktrees end in `.integration.test.ts`.
- Assertions compare JSON output or parsed files, never source text or raw substrings. The only exception is prompt files (`agents/`, `commands/`, `get-shit-done/workflows/`, `get-shit-done/references/`), whose tests start with `// allow-test-rule: source-text-is-the-product`.
- At most 2 test files per production module prefix (`scripts/lint-test-file-count.cjs`). No production file may be named `sdk/src/query/build.ts`; every build module is `build-<name>.ts`.
- Fixtures and examples use generic values (`03-user-auth`, `AUTH-01`, `D-01`) and nothing from other projects.
- Names:
  - command `name: fvgsd:build` with argument hint `<phase> [--confirm] [--gaps] [--research-only] [--brief-only]`
  - agent `fvgsd-builder`
  - files `{P}-{NN}-PLAN.md` (`kind: brief`), `{P}-{NN}-SUMMARY.md` (`kind: build-summary`), `{P}-VERIFICATION.md`, `{P}-HUMAN-UAT.md`, `{P}-RESEARCH.md`
  - `{P}` is the padded phase number (`03`); `{NN}` is `01` for the first build and the next free plan number for `--gaps`
- Commit subjects: `docs({P}): build brief`, `feat({P}-{slice}): <goal>`, `chore({P}-{slice}): partial — <reason>`, `fix({P}-{slice}): <what>`, `fix({P}-{slice}): resolve merge with {other}`, `docs({P}): build summary and verification`.
- Check results live under `<git-common-dir>/fvgsd/build/{P}/`, never in the working tree.
- New configuration keys (spec "Configuration"):

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

- Size targets: the workflow `get-shit-done/workflows/build.md` is 400 lines or fewer; `agents/fvgsd-builder.md` is 10KB or smaller.
- `plan-phase` and `execute-phase` keep working. With `workflow.build_mode: false`, every suggestion reverts to them.
- Never run `bin/install.js` outside tests. Tests follow `tests/helpers/install-shared.cjs` (temp `HOME` and `--config-dir`). Never read or modify `~/.claude`, `~/.codex`, `~/.gemini`, `~/.config/opencode` or `~/.cache`.
- Work on branch `feat/fvgsd-build`, created from `main` in Task 0.
- Every task ends with:
  - its own tests passing
  - no new failures against the Task 0 baseline (see "Verification")
  - one commit that stages explicit paths and never stages `.superpowers/`, with a Conventional Commit subject and the attribution trailers your session's system reminder gives for commits

## Decisions made while planning

These refine the spec where the code as it is today forced a choice. Treat them as binding alongside the spec.

1. **Query registration.**
   - `checks.detect` and the `build.*` queries are registered as entries in `NON_FAMILY_COMMAND_MANIFEST` (`sdk/src/query/command-manifest.non-family.ts`), with handler tuples (dotted and spaced names) in `DOMAIN_STATIC_CATALOG` (`sdk/src/query/command-static-catalog-domain.ts`).
   - `init.build` joins `INIT_COMMAND_MANIFEST`, `FAMILY_HANDLERS.init` and the CJS init router.
   - Reason: a new `build` family touches 13 files and two CJS tests, and `checks.detect` cannot live inside it because the drift check slices canonicals by family prefix.
   - Aliases are regenerated with `cd sdk && npx tsx scripts/gen-command-aliases.ts`, and `npm run check:alias-drift` must pass.
2. **Extra flags and fields on the queries.**
   - `build.run-checks` also takes `--phase <P>`, which names the results folder.
   - `build.merge-wave` also takes `--base <commit>` (the wave's base) and accepts `--results-file <path>` as an alternative to `--results <json>`. It returns `blocked` and `skipped` alongside `merged`, `conflicts` and `cleaned`.
3. **`init.build` additions.**
   - It accepts `--runtime <name>`, and returns `phase_found`, `inputs.roadmap`, `inputs.requirements` and `resume.verification`.
   - Three states are added: `classic` (the phase already has plans that are not briefs), `summarizing` (fresh passed/human_needed VERIFICATION.md, no summary) and `human_needed` (summary exists, VERIFICATION.md `human_needed`).
   - VERIFICATION.md freshness compares the file's mtime with the last `feat`/`fix` commit time.
   - `config.parallel` is `off` when `parallelization` (boolean or `.enabled`) or `workflow.use_worktrees` is false.
   - An unresolved model (empty string) is reported as `inherit`.
4. **`build.group-problems`** also returns `batches`: groups whose files don't overlap share a batch.
5. **`build.finalize`** keeps every frontmatter key it doesn't own byte-for-byte, requires the lead to have written `subsystem` and `tags`, and returns `warnings` from state updates.
6. **Config schema.** `workflow.build_command` and `workflow.test_command` join `validKeys`: the docs and workflows already use them, but the schema omitted them. `config-set` validates the new keys in both `sdk/src/query/config-mutation.ts` and `get-shit-done/bin/lib/config.cjs`.
7. **Agent install.**
   - The installer strips the `effort:` frontmatter key for every runtime except Claude Code.
   - `fvgsd-builder` gets `workspace-write` in `CODEX_AGENT_SANDBOX`.
8. **Surfaces.** `build` joins `PROFILES.core`, `PROFILES.standard` and the `core_loop` cluster, because routing suggests it by default.
9. **VibeClaw routes.** Both routes files gain `brief:` (the tool assigned to `plan`) as well as `build:` (the tool assigned to `execute`), so every `feature-build` stage has a default tool.
10. **Manager.** It recommends `build` for a discussed phase only when that phase's dependencies are satisfied.
11. **SDK runner.**
    - `workflow.build_mode === true` selects the build path.
    - The Build step gets four times the per-step turn and budget limits.
    - A headless override is prepended to the build prompt.
    - Advance skips `phase.complete` when `roadmap.analyze` already reports the phase complete, because `build.finalize` completed it.
12. **`checks.detect`.**
    - It keeps the post-merge-gate rules for `build` and `test`.
    - It proposes `lint` and `typecheck` from Makefile or Justfile only when the recipe exists.
    - It proposes `ruff check .` and `mypy .` only when their config exists (`[tool.ruff]`, `ruff.toml` or `.ruff.toml`; `[tool.mypy]` or `mypy.ini`).
13. **Unfinished briefs.** A phase whose unfinished plan has `kind: brief` always routes to `/fvgsd-build N`, even with `workflow.build_mode: false`: the prompts, `route.next-action` and the manager all do this. Reason: execute-phase refuses briefs, so pointing there leads nowhere. Every other build suggestion, including `--gaps`, still follows `workflow.build_mode`.
14. **Build workflow text.** The SDK's `sanitizePrompt` removes lines containing slash commands, so runner-visible text in `get-shit-done/workflows/build.md` names next steps as bare command names and prints them in the runtime's form. The code reviewer writes REVIEW.md under `<git-common-dir>/fvgsd/build/{P}/`, so the build adds no planning file. In a headless session, `--confirm` records a blocker, and `config.mode: interactive` is ignored.
15. **Check freshness.** A check result counts for a commit when its recorded commit and that commit have identical code trees (`git diff --quiet <a> <b> -- . ':(exclude).planning'` exits 0). `build.finalize` uses this for `checks_passed_at`, and `init.build` for `baseline.needs_run`. Reason: `build.run-checks` records HEAD, which is often a `.planning`-only commit or an earlier commit with the same code, so comparing SHAs would discard results that still apply.

16. **Baseline timing.** This changes the spec's "Checks" timing. When a baseline run is needed and the build won't pause for approval, the full baseline runs in the foreground before the brief builder starts, so `continue_to_slice` can still build a single slice in the same agent run. With an approval pause (`--confirm`, or interactive mode in an interactive session), it runs in the background during the brief where `background_tasks` is on and finishes before approval ends; otherwise it runs right after the brief commit. Reason: slice work must not change the working tree while baseline tests run, and a single-slice phase must still start at most the builder and the verifier.

## Verification

Workspace (git-ignored): `WS=.superpowers/sdd/2026-09-12-fvgsd-build`.

- **Root suite** (about 3 minutes including `pretest`):
  ```bash
  npm test > "$WS/task-<N>-root.log" 2>&1
  node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-<N>-root.log"
  ```
- **SDK suite** (about 15 minutes). Run it only when a task says so:
  ```bash
  (cd sdk && npm test > "../$WS/task-<N>-sdk.log" 2>&1)
  node "$WS/compare-failures.cjs" "$WS/baseline-sdk.log" "$WS/task-<N>-sdk.log"
  ```
- **Result:** the compare script prints JSON and exits 1 when `newFailures` is non-empty. A task passes when `newFailures` is `[]`. Put the JSON in your report.
- **Missing titles:** list every entry in `missingTitles` with a one-line reason (for example "test renamed in this task").
- **Pre-existing failures** are out of scope unless the task's change is what makes them pass.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `sdk/shared/config-defaults.manifest.json`, `sdk/shared/config-schema.manifest.json`, `sdk/src/config.ts`, `sdk/src/query/config-mutation.ts`, `get-shit-done/bin/lib/config.cjs` | New keys, defaults, `config-set` validation | 1 |
| `sdk/shared/runtime-capabilities.json`, `sdk/src/runtime-capabilities.ts`, `get-shit-done/bin/lib/runtime-artifact-layout.cjs` (export) | Capability table and loader | 1 |
| `sdk/src/query/build-shared.ts` | Flag parsing, git helpers, phase resolution, state dir, shared readers | 2 (extended in 3, 5, 8) |
| `sdk/src/query/build-checks.ts`, `get-shit-done/workflows/execute-phase/steps/post-merge-gate.md` | `checks.detect`, `build.run-checks`; gate uses detection | 2 |
| `sdk/src/query/build-brief.ts`, `get-shit-done/references/build-brief.md` | Brief loading, `build.check-brief`, `build.waves`, glob overlap; brief format | 3 |
| `agents/fvgsd-builder.md`, `agents/fvgsd-verifier.md`, `sdk/shared/model-catalog.json`, `bin/install.js`, `get-shit-done/references/model-profiles.md` | Builder agent, verifier build mode, model row, installer key stripping and sandbox | 4 |
| `sdk/src/debt-markers.ts`, `sdk/src/query/build-stubs.ts`, `sdk/src/phase-runner.ts` | Shared marker scan, `build.scan-stubs` | 5 |
| `sdk/src/query/build-merge.ts` | `build.merge-wave` | 6 |
| `sdk/src/query/build-problems.ts` | `build.group-problems` | 7 |
| `sdk/src/query/build-init.ts`, `sdk/src/query/command-manifest.init.ts`, `sdk/src/query/command-family-handlers.ts`, `get-shit-done/bin/lib/init-command-router.cjs` | `init.build` | 8 |
| `sdk/src/query/build-finalize.ts`, `get-shit-done/references/build-summary.md` | `build.finalize`; summary format; tool-chain integration test | 9 |
| `commands/gsd/build.md`, `get-shit-done/workflows/build.md`, `get-shit-done/bin/lib/clusters.cjs`, `get-shit-done/bin/lib/install-profiles.cjs`, `commands/gsd/ns-workflow.md`, `docs/COMMANDS.md`, `docs/USER-GUIDE.md`, `README.md` | The command and its workflow | 10 |
| `sdk/src/query/phase.ts`, `get-shit-done/bin/lib/phase.cjs`, `sdk/src/types.ts`, `sdk/src/query/route-next-action.ts`, `sdk/src/query/init-complex.ts`, `get-shit-done/bin/lib/init.cjs` | Plan `kind`, next-action routing, manager actions | 11 |
| `get-shit-done/workflows/{do,next,progress,manager,autonomous,transition,execute-phase}.md`, `get-shit-done/workflows/discuss-phase/modes/chain.md` | Prompt-level routing and the execute-phase guard | 12 |
| `sdk/src/phase-runner.ts`, `sdk/src/context-engine.ts` | Runner fixes (zero plans, debt scan on changed files, phase-folder context) | 13 |
| `sdk/src/types.ts`, `sdk/src/phase-runner.ts`, `sdk/src/session-runner.ts`, `sdk/src/phase-prompt.ts`, `sdk/src/context-engine.ts`, `sdk/src/tool-scoping.ts` | Runner Build step | 14 |
| `get-shit-done/vibe/templates/workflows/feature-build.yaml`, `get-shit-done/bin/lib/vibe/{schemas,orchestrator,entry-router}.cjs`, `get-shit-done/vibe/templates/routes/{cheap,quality}.yaml`, `docs/VIBECLAW.md`, `docs/MULTI-TOOL-WALKTHROUGH.md` | VibeClaw `feature-build` | 15 |
| `.changeset/*.md`, `docs/INVENTORY.md`, `docs/INVENTORY-MANIFEST.json` | Changeset, inventory check, full verification | 16 |
| — | Manual acceptance (ask the maintainer first) | 17 |

## Interface Registry

Every task implements or consumes these exact names and shapes. A task's implementer sees only their own task, so this registry is the contract between tasks.

### `sdk/src/runtime-capabilities.ts` (Task 1)

```ts
export const RUNTIME_CAPABILITY_KEYS: readonly ['spawn_agents', 'parallel_agents', 'worktree_isolation', 'per_call_model', 'agent_effort', 'background_tasks', 'workflow_scripts'];
export type RuntimeCapabilityKey = (typeof RUNTIME_CAPABILITY_KEYS)[number];
export type RuntimeCapabilities = Record<RuntimeCapabilityKey, boolean>;
export function resolveRuntimeCapabilities(runtime: string): RuntimeCapabilities; // unknown runtime → all false
export function capabilityTableRuntimes(): string[]; // sorted keys of the JSON table
```

In Stage 1 nothing reads `agent_effort`. Installers strip `effort:` from agent frontmatter for every runtime except Claude Code until a runtime-specific mapping exists (Decision 7).

### `sdk/src/query/build-shared.ts` (Task 2; extended by Tasks 3, 5, 8)

```ts
export interface FlagSpec { values?: readonly string[]; booleans?: readonly string[] }
export interface ParsedFlags { flags: Record<string, string | boolean>; positionals: string[] }
// Throws GSDError(Validation) for: unknown flag, duplicate flag, missing value, empty or whitespace-only value, value starting with "--" or "=" (as in "--name==value"), and a value on a boolean flag ("--gaps=true").
// Accepts both "--name value" and "--name=value".
export function parseFlags(args: readonly string[], spec: FlagSpec): ParsedFlags;
export interface GitResult { ok: boolean; code: number; stdout: string; stderr: string } // trailing whitespace trimmed; leading spaces kept for porcelain output
export function runGit(cwd: string, args: readonly string[]): GitResult; // spawnSync('git', args), never a shell
export function gitCommonDir(projectDir: string): string | null; // absolute; null outside a repository
export function headCommit(projectDir: string): string | null; // full SHA, 40 or 64 hex characters; null without a repository or commit
export interface BuildPhase { number: string; padded: string; name: string; dir: string; dirAbs: string } // dir is project-relative POSIX
export async function resolveBuildPhase(projectDir: string, phaseArg: string, workstream?: string): Promise<BuildPhase | null>;
export function buildStateDir(projectDir: string, padded: string): string | null; // <git-common-dir>/fvgsd/build/<padded>; null outside a repository; throws GSDError(Validation) for an unsafe phase segment
export function writeJsonAtomic(filePath: string, value: unknown): void; // mkdir -p, temp file + rename
// Task 3:
export async function phaseRequirementIds(projectDir: string, phase: string, workstream?: string): Promise<string[]>;
// Task 5:
export interface ChangedFile { status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'; path: string }
export function changedFilesSince(projectDir: string, base: string): ChangedFile[]; // excludes .planning/, R/C report the new path
export function codeHead(projectDir: string): string | null; // latest first-parent commit touching files outside .planning/ (git log -1 --first-parent)
// Task 8:
export interface PhasePlanFile { file: string; nn: string; num: number; kind: string | null; gapClosure: boolean; sliceIds: string[]; hasSummary: boolean }
export function listPhasePlanFiles(phaseDirAbs: string, padded: string): PhasePlanFile[]; // sorted by num
export interface VerificationInfo { path: string; status: string | null; mtimeMs: number }
export function readVerification(phaseDirAbs: string, padded: string): VerificationInfo | null;
```

### `sdk/src/query/build-checks.ts` (Task 2)

```ts
export type CheckName = 'build' | 'typecheck' | 'lint' | 'test';
export const CHECK_NAMES: readonly CheckName[]; // ['build', 'typecheck', 'lint', 'test']
export type CheckSet = 'quick' | 'wave' | 'full';
export const CHECK_SETS: Readonly<Record<CheckSet, readonly CheckName[]>>; // quick: typecheck, lint · wave: build, typecheck · full: all four
export type CheckSource = 'config' | 'detected' | 'none';
export interface DetectedChecks { build: string | null; typecheck: string | null; lint: string | null; test: string | null; sources: Record<CheckName, CheckSource> }
export interface DetectDeps { listXcodeSchemes?: (projectPath: string) => string[] }
export function detectChecks(projectDir: string, workflowConfig: Record<string, unknown>, deps?: DetectDeps): DetectedChecks;
export const checksDetect: QueryHandler; // checks.detect → DetectedChecks
export interface CheckResult { name: CheckName; command: string | null; commit: string | null; exit: number | null; timed_out: boolean; skipped: boolean; duration_ms: number; preexisting: boolean; output_tail: string }
export interface RunChecksData { set: CheckSet; label: string; passed: boolean; results: CheckResult[] }
export interface LatestCheckEntry { command: string | null; commit: string | null; exit: number | null; timed_out: boolean; skipped: boolean; passed: boolean; at: string }
export function readLatestChecks(projectDir: string, padded: string): Record<string, LatestCheckEntry>; // {} when missing
export const buildRunChecks: QueryHandler; // build.run-checks --phase <P> --set quick|wave|full [--label <name>] [--only a,b]
```

`build.run-checks` writes `<state dir>/<label or set>.json` (the `RunChecksData`) and merges `latest.json` under a lock.
- A failing result has `exit !== 0` or `timed_out`.
- It is `preexisting` when `baseline.json` holds a failing result with the same `name` and `command`.
- `output_tail` is the last 200 lines of combined stdout and stderr.

### `sdk/src/query/build-brief.ts` (Task 3)

```ts
export interface BriefSlice { id: string; goal: string; owns: string[]; after: string[]; strong: boolean }
export interface BriefError { field: string; message: string } // field examples: "wave", "kind", "requirements", "slices", "slices[1].after[0]", "slices[0].owns", "objective"
export interface LoadedBrief { absPath: string; relPath: string; content: string; frontmatter: Record<string, unknown>; slices: BriefSlice[] }
export async function loadBrief(projectDir: string, briefPath: string): Promise<LoadedBrief>; // GSDError(Validation) if outside the project or missing
export function normalizeSlices(frontmatter: Record<string, unknown>): BriefSlice[]; // tolerant: missing after → [], strong "true" → true
export function validateBrief(brief: LoadedBrief, requirementIds: readonly string[]): BriefError[];
export function computeWaves(slices: readonly BriefSlice[]): string[][];
export function globToRegExp(glob: string): RegExp; // supports **, *, ?, [..], {a,b}
export function fileMatchesGlob(file: string, glob: string): boolean;
export function globsOverlap(a: string, b: string): boolean;
export function ownsOverlap(a: readonly string[], b: readonly string[]): boolean;
export const buildCheckBrief: QueryHandler; // build.check-brief <path> → { valid, errors }
export const buildWaves: QueryHandler; // build.waves <path> → { waves } or { error: 'invalid_brief', errors }
```

### `sdk/src/debt-markers.ts` and `sdk/src/query/build-stubs.ts` (Task 5)

```ts
export interface DebtMarkerFinding { file: string; line: number; marker: string; text: string }
export function isDebtScannable(file: string): boolean; // false for .md / .markdown
export function hasFormalDebtReference(text: string): boolean;
export function findDebtMarkers(file: string, content: string): DebtMarkerFinding[];
export const buildScanStubs: QueryHandler; // build.scan-stubs --base <commit> → [{ file, line, marker }]
```

### `sdk/src/query/build-merge.ts` (Task 6)

```ts
export interface MergeWaveData {
  merged: string[];
  conflicts: Array<{ slice: string; files: string[] }>;
  blocked: Array<{ slice: string; reason: 'invalid_branch' | 'protected_branch' | 'branch_mismatch' | 'worktree_dirty' | 'base_mismatch' | 'bulk_deletions' | 'merge_failed' | 'cleanup_failed'; detail: string }>;
  skipped: Array<{ slice: string; reason: 'not_done' | 'not_isolated' }>;
  cleaned: string[]; // removed worktree paths
}
export const buildMergeWave: QueryHandler; // build.merge-wave --phase <P> --base <commit> (--results <json> | --results-file <path>)
```

Merge commit message: `chore({P}-{slice}): merge slice branch`. Slices merge in numeric id order; the fix-round slice id `fix` sorts last.

### `sdk/src/query/build-problems.ts` (Task 7)

```ts
export type ProblemKind = 'check' | 'gap' | 'stub' | 'review';
export interface BuildProblem { id?: string; kind: ProblemKind; summary: string; files?: string[] }
export interface ProblemGroup { slice: string; problems: BuildProblem[]; files: string[] } // slice is a brief slice id or "fix"
export const buildGroupProblems: QueryHandler; // build.group-problems --brief <path> (--problems <json> | --problems-file <path>) → { groups, batches: string[][] }
```

### `sdk/src/query/build-init.ts` (Task 8)

`initBuild` (`init.build <phase> [--gaps] [--runtime <name>]`) returns:

```json
{
  "phase_found": true,
  "phase": { "number": "3", "padded": "03", "name": "user-auth", "dir": ".planning/phases/03-user-auth" },
  "inputs": { "context": ".planning/phases/03-user-auth/03-CONTEXT.md", "research": null, "spec": null, "ui_spec": null, "milestone_brief": null, "roadmap": ".planning/ROADMAP.md", "requirements": ".planning/REQUIREMENTS.md", "requirement_ids": ["AUTH-01", "AUTH-02"] },
  "commands": { "build": "npm run build", "typecheck": "npx tsc --noEmit", "lint": "npm run lint", "test": "npm test" },
  "runtime": { "name": "claude", "spawn_agents": true, "parallel_agents": true, "worktree_isolation": true, "per_call_model": true, "agent_effort": true, "background_tasks": true, "workflow_scripts": true },
  "config": { "research": true, "fix_rounds": 2, "human_checks": "defer", "code_review": false, "parallel": "auto", "engine": "agents", "max_concurrent_agents": 3, "check_timeout_seconds": 1800, "mode": "interactive", "security_enforcement": true, "commit_docs": true },
  "models": { "brief": "opus", "slice": "sonnet", "strong": "opus", "verifier": "sonnet" },
  "resume": { "state": "new", "plan": "01", "brief": null, "summary": null, "done_slices": [], "partial_slices": [], "base_commit": "<40-char sha>", "verification": null },
  "baseline": { "last_passing_commit": null, "code_head": "<40-char sha>", "needs_run": true }
}
```

- **States:** `resume.state` is one of `new`, `brief_written`, `slices_in_progress`, `verifying`, `gaps_found`, `summarizing`, `complete`, `human_needed` or `classic`.
- **Phase not found:** `{ "phase_found": false, "phase": { "number", "padded" } }`.
- **No git repository:** `{ "error": "git_repository_required" }`. This also covers a repository with no commits (HEAD can't be resolved).
- **`resume.verification`:** `null`, or `{ "path": "<project-relative path>", "status": "<frontmatter status or null>" }`.
- **State `classic`:** `plan`, `brief` and `summary` are `null`, and `base_commit` is HEAD.
- **`--runtime`:** values outside the supported runtimes, including the unreplaced `__FVGSD_RUNTIME__` token, fall back to detection (`FVGSD_RUNTIME`, then config `runtime`, then `claude`).
- **`baseline.needs_run`:** false only when `last_passing_commit` exists and `git diff --quiet <last> <code_head> -- . ':(exclude).planning'` exits 0 (Decision 15).

### `sdk/src/query/build-finalize.ts` (Task 9)

```ts
export function upsertFrontmatterKeys(content: string, owned: Record<string, unknown>): string; // owned keys first, other top-level blocks kept verbatim
export const buildFinalize: QueryHandler;
// build.finalize --phase <P> --plan <NN> --base <commit> --engine agents|workflow --tier parallel|sequential|inline --fix-rounds <n> [--requirements-completed <ids>]
// (omit --requirements-completed when no IDs were completed; parseFlags rejects empty values)
// → { ok: true, phase_complete: boolean, commit: string | null, warnings: string[] }
// → { ok: false, missing: { decisions: string[], requirements: string[] } }   (state untouched)
```

### Runner and routing (Tasks 11, 13, 14)

```ts
// sdk/src/types.ts
export enum PhaseType { /* existing */ Build = 'build' }
export enum PhaseStepType { /* existing */ Build = 'build' }
export interface PlanInfo { /* existing */ kind?: string | null }
export interface ContextFiles { /* existing */ milestone?: string }
// sdk/src/context-engine.ts
resolveContextFiles(phaseType: PhaseType, phaseDir?: string): Promise<ContextFiles>; // phaseDir is project-relative
// sdk/src/phase-prompt.ts
buildPrompt(phaseType: PhaseType, plan: ParsedPlan | null, contextFiles: ContextFiles, phaseDir?: string, args?: string): Promise<string>; // args adds "## Arguments\n\n$ARGUMENTS: <args>"
```

- **`phase-plan-index`** (TS and CJS): each plan gains `kind` (`string | null`).
- **Manager actions** (TS and CJS) gain `action: 'build'`, with commands `/fvgsd-build N` or `/fvgsd-build N --gaps`. CJS renders them with `formatGsdSlash('build', runtime)`.

### Prompt contracts (Tasks 4, 10, 12)

- **Builder input:** the lead passes paths, not contents, in one `<build_inputs>` block of `key: value` lines:
  - `mode: brief|slice`, `phase_dir`, `brief`, `slice`, `goal`, `owns`, `base_commit`
  - `context`, `research`, `milestone_brief`, `roadmap`, `requirements`, `requirement_ids`
  - `commands_json`, `continue_to_slice: true|false`
  - optional: `fix_goal`, `fix_problems_json`, `merge_from`, `worktree_path` (the worktree holding the conflicting slice branch), `other_slice_notes`, `known_failures`, `gaps: true|false`, `verification` (the VERIFICATION.md path, used when `gaps` is true), `brief_errors_json` (`build.check-brief` errors for a brief-mode retry)
- **Builder results:** exactly the spec's `## BRIEF RESULT` and `## SLICE RESULT` blocks.
- **Verifier build mode:** triggered by a `<build_mode>` block with `key: value` lines:
  - `brief`, `verification_path`, `human_uat_path`, `human_checks: defer|block`
  - `checks_json`, `stubs_json`, `slice_results`, `diff_stat`, `changed_files`
  - `context`, `roadmap`, `requirement_ids`, `recheck_gaps` (empty on the first pass)
- **Workflow end markers** (read by chain and autonomous modes): `## BUILD COMPLETE`, `## BUILD GAPS FOUND`, `## BUILD BLOCKED`, `## BUILD STOPPED`.

## Tasks

| Task | Deliverable |
|---|---|
| 0 | Branch, workspace and test baselines |
| 1 | Build settings: config keys, validation, runtime capability table |
| 2 | `build-shared.ts`, `checks.detect`, `build.run-checks`; post-merge gate uses detection |
| 3 | `build.check-brief`, `build.waves`, brief format reference |
| 4 | `fvgsd-builder` agent, verifier build mode, model row, installer changes |
| 5 | Shared debt-marker scan and `build.scan-stubs` |
| 6 | `build.merge-wave` |
| 7 | `build.group-problems` |
| 8 | `init.build` |
| 9 | `build.finalize`, summary reference, tool-chain integration test |
| 10 | `/fvgsd-build` command and workflow |
| 11 | Plan `kind`, `route.next-action`, manager recommendations |
| 12 | Workflow routing prompts and the execute-phase guard |
| 13 | SDK runner fixes |
| 14 | SDK runner Build step |
| 15 | VibeClaw `feature-build` |
| 16 | Changeset and full verification |
| 17 | Manual acceptance (ask the maintainer first) |

---

### Task 0: Branch, workspace and baselines

**Files:**
- Create (git-ignored): `.superpowers/sdd/2026-09-12-fvgsd-build/compare-failures.cjs`

- [ ] **Step 1: Create the branch**

```bash
git status --porcelain   # expected: no output
git switch main
git switch -c feat/fvgsd-build
```

- [ ] **Step 2: Create the workspace and the compare script**

```bash
WS=.superpowers/sdd/2026-09-12-fvgsd-build
mkdir -p "$WS"
git check-ignore -q "$WS/probe" && echo ignored   # expected: ignored
```

Create `$WS/compare-failures.cjs`:

```js
#!/usr/bin/env node
'use strict';

// node compare-failures.cjs <baseline-log> <new-log>
// Root logs: node:test spec reporter. SDK logs: vitest " FAIL " lines.
// Prints { baselineFailures, currentFailures, newFailures, fixedCount, missingTitleCount, missingTitles }.
// Exits 1 when newFailures is non-empty.

const fs = require('node:fs');

function normalize(id) {
  return id
    .replace(/get-shit-done(?:-cc)?/gi, 'X')
    .replace(/(?:f?v)?gsd\//gi, 'X-')
    .replace(/(?:f?v)?gsd/gi, 'X')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLog(logPath) {
  const failures = new Map();
  const titles = new Map();
  let pendingFile = null;
  for (const line of fs.readFileSync(logPath, 'utf8').split(/\r?\n/)) {
    const vitest = line.match(/^ FAIL {2}(?:\|[^|]+\| )?(.+?)\s*$/);
    if (vitest) {
      failures.set(normalize(vitest[1]), vitest[1]);
      pendingFile = null;
      continue;
    }
    const at = line.match(/^test at (.+?):\d+:\d+$/);
    if (at) {
      pendingFile = at[1];
      continue;
    }
    const result = line.match(/^(\s*)([✔✖]) (.+?)(?: \([\d.]+m?s\))?$/);
    if (result) {
      const [, indent, mark, title] = result;
      if (pendingFile && mark === '✖' && indent === '') {
        const id = `${pendingFile} :: ${title}`;
        failures.set(normalize(id), id);
      } else if (!/^failing tests:$/.test(title)) {
        const key = normalize(title);
        const entry = titles.get(key) || { title, count: 0 };
        entry.count += 1;
        titles.set(key, entry);
      }
    }
    if (line.trim() !== '') pendingFile = null;
  }
  return { failures, titles };
}

const [baselineLog, currentLog] = process.argv.slice(2);
if (!baselineLog || !currentLog) {
  process.stderr.write('usage: node compare-failures.cjs <baseline-log> <new-log>\n');
  process.exit(2);
}
const baseline = parseLog(baselineLog);
const current = parseLog(currentLog);
const newFailures = [...current.failures].filter(([key]) => !baseline.failures.has(key)).map(([, id]) => id).sort();
const fixedCount = [...baseline.failures.keys()].filter((key) => !current.failures.has(key)).length;
const missingTitles = [...baseline.titles]
  .map(([key, { title, count }]) => ({ title, missing: count - ((current.titles.get(key) || { count: 0 }).count) }))
  .filter(({ missing }) => missing > 0)
  .map(({ title, missing }) => (missing > 1 ? `${title} (×${missing})` : title))
  .sort();
process.stdout.write(`${JSON.stringify({
  baselineFailures: baseline.failures.size,
  currentFailures: current.failures.size,
  newFailures,
  fixedCount,
  missingTitleCount: missingTitles.length,
  missingTitles,
}, null, 2)}\n`);
process.exit(newFailures.length > 0 ? 1 : 0);
```

- [ ] **Step 3: Install dependencies if missing**

```bash
[ -d node_modules ] || npm ci --ignore-scripts
[ -d sdk/node_modules ] || (cd sdk && npm ci)
```

- [ ] **Step 4: Record the baselines**

```bash
npm test > "$WS/baseline-root.log" 2>&1
(cd sdk && npm test > "../$WS/baseline-sdk.log" 2>&1)
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/baseline-root.log"
node "$WS/compare-failures.cjs" "$WS/baseline-sdk.log" "$WS/baseline-sdk.log"
```

Expected: both compares print `"newFailures": []`. Record `baselineFailures` for each suite in your report. The tree is not green on `main`: pre-existing failures are expected, and they are the baseline.

- [ ] **Step 5: No commit**

Nothing tracked changed.

---

### Task 1: Build settings: config keys, validation and the runtime capability table

**Files:**
- Modify:
  - `sdk/shared/config-defaults.manifest.json`
  - `sdk/shared/config-schema.manifest.json`
  - `sdk/src/config.ts`
  - `sdk/src/query/config-mutation.ts`
  - `get-shit-done/bin/lib/config.cjs`
  - `get-shit-done/bin/lib/runtime-artifact-layout.cjs`
  - `docs/CONFIGURATION.md`
- Create:
  - `sdk/shared/runtime-capabilities.json`
  - `sdk/src/runtime-capabilities.ts`
- Test:
  - `sdk/src/runtime-capabilities.test.ts`
  - `tests/fvgsd-build-settings.test.cjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `RUNTIME_CAPABILITY_KEYS`, `resolveRuntimeCapabilities` and `capabilityTableRuntimes` (see the Interface Registry)
  - the nine `workflow.*` build keys with defaults
  - `workflow.build_command` and `workflow.test_command` as valid config keys
  - `validateBuildSetting(keyPath, value): string | null`, exported from `sdk/src/query/config-mutation.ts`, with a mirrored copy exported from `get-shit-done/bin/lib/config.cjs`
  - `ALLOWED_RUNTIMES`, exported from `get-shit-done/bin/lib/runtime-artifact-layout.cjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/fvgsd-build-settings.test.cjs`:

```js
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const { ALLOWED_RUNTIMES } = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');
const { validateBuildSetting } = require('../get-shit-done/bin/lib/config.cjs');

const CAPABILITY_KEYS = [
  'spawn_agents', 'parallel_agents', 'worktree_isolation', 'per_call_model',
  'agent_effort', 'background_tasks', 'workflow_scripts',
];

function configPath(dir) {
  return path.join(dir, '.planning', 'config.json');
}

describe('build settings: config-set', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.writeFileSync(configPath(tmpDir), `${JSON.stringify({ workflow: {} }, null, 2)}\n`);
  });

  afterEach(() => cleanup(tmpDir));

  const accepted = [
    ['workflow.build_mode', 'false', false],
    ['workflow.build_fix_rounds', '0', 0],
    ['workflow.build_fix_rounds', '5', 5],
    ['workflow.build_human_checks', 'block', 'block'],
    ['workflow.build_code_review', 'true', true],
    ['workflow.build_parallel', 'off', 'off'],
    ['workflow.build_engine', 'workflow', 'workflow'],
    ['workflow.build_check_timeout_seconds', '600', 600],
    ['workflow.lint_command', 'npm run lint', 'npm run lint'],
    ['workflow.typecheck_command', 'npx tsc --noEmit', 'npx tsc --noEmit'],
    ['workflow.build_command', 'make all', 'make all'],
    ['workflow.test_command', 'make check', 'make check'],
  ];

  for (const [key, raw, expected] of accepted) {
    test(`accepts ${key} ${raw}`, () => {
      const result = runGsdTools(['config-set', key, raw], tmpDir, { HOME: tmpDir });
      assert.equal(result.success, true, result.error);
      const config = JSON.parse(fs.readFileSync(configPath(tmpDir), 'utf8'));
      assert.deepEqual(config.workflow[key.slice('workflow.'.length)], expected);
    });
  }

  const rejected = [
    ['workflow.build_mode', 'maybe'],
    ['workflow.build_fix_rounds', '6'],
    ['workflow.build_fix_rounds', '-1'],
    ['workflow.build_fix_rounds', '1.5'],
    ['workflow.build_human_checks', 'later'],
    ['workflow.build_code_review', 'yes'],
    ['workflow.build_parallel', 'on'],
    ['workflow.build_engine', 'script'],
    ['workflow.build_check_timeout_seconds', '0'],
    ['workflow.lint_command', '42'],
  ];

  for (const [key, raw] of rejected) {
    test(`rejects ${key} ${raw} and leaves config.json unchanged`, () => {
      const before = fs.readFileSync(configPath(tmpDir));
      const result = runGsdTools(['config-set', key, raw], tmpDir, { HOME: tmpDir });
      assert.equal(result.success, false);
      assert.notEqual(result.exitCode, 0);
      assert.deepEqual(fs.readFileSync(configPath(tmpDir)), before);
    });
  }
});

describe('build settings: validateBuildSetting in config.cjs', () => {
  const valid = [
    ['workflow.build_mode', false],
    ['workflow.build_fix_rounds', 0],
    ['workflow.build_fix_rounds', 5],
    ['workflow.build_human_checks', 'block'],
    ['workflow.build_parallel', 'auto'],
    ['workflow.build_engine', 'workflow'],
    ['workflow.build_check_timeout_seconds', 1],
    ['workflow.lint_command', ''],
    ['workflow.research', 'not a build setting'],
  ];

  for (const [key, value] of valid) {
    test(`returns null for ${key} ${JSON.stringify(value)}`, () => {
      assert.equal(validateBuildSetting(key, value), null);
    });
  }

  const invalid = [
    ['workflow.build_mode', 'true'],
    ['workflow.build_code_review', 1],
    ['workflow.build_fix_rounds', 6],
    ['workflow.build_fix_rounds', 1.5],
    ['workflow.build_human_checks', 'later'],
    ['workflow.build_parallel', 'on'],
    ['workflow.build_check_timeout_seconds', 0],
    ['workflow.test_command', 42],
  ];

  for (const [key, value] of invalid) {
    test(`returns a message for ${key} ${JSON.stringify(value)}`, () => {
      const message = validateBuildSetting(key, value);
      assert.equal(typeof message, 'string');
      assert.notEqual(message.trim(), '');
    });
  }
});

describe('build settings: runtime capability table', () => {
  const tablePath = path.join(__dirname, '..', 'sdk', 'shared', 'runtime-capabilities.json');

  test('has exactly one entry per installable runtime', () => {
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    assert.deepEqual(Object.keys(table).sort(), [...ALLOWED_RUNTIMES].sort());
  });

  test('every entry has exactly the seven boolean switches', () => {
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    for (const [runtime, entry] of Object.entries(table)) {
      assert.deepEqual(Object.keys(entry).sort(), [...CAPABILITY_KEYS].sort(), runtime);
      for (const key of CAPABILITY_KEYS) assert.equal(typeof entry[key], 'boolean', `${runtime}.${key}`);
    }
  });

  test('claude has every switch on', () => {
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    for (const key of CAPABILITY_KEYS) assert.equal(table.claude[key], true, key);
  });
});
```

Create `sdk/src/runtime-capabilities.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RUNTIME_CAPABILITY_KEYS, capabilityTableRuntimes, resolveRuntimeCapabilities } from './runtime-capabilities.js';

function allSwitches(value: boolean): Record<string, boolean> {
  return Object.fromEntries(RUNTIME_CAPABILITY_KEYS.map((key) => [key, value]));
}

describe('runtime capabilities', () => {
  it('lists the seven switches in spec order', () => {
    expect([...RUNTIME_CAPABILITY_KEYS]).toEqual([
      'spawn_agents', 'parallel_agents', 'worktree_isolation', 'per_call_model',
      'agent_effort', 'background_tasks', 'workflow_scripts',
    ]);
  });

  it('turns every switch on for claude', () => {
    expect(resolveRuntimeCapabilities('claude')).toEqual(allSwitches(true));
  });

  it('resolves unknown and hostile runtime names to all false', () => {
    for (const name of ['unknown-runtime', '', '__proto__', 'constructor', '../claude']) {
      expect(resolveRuntimeCapabilities(name)).toEqual(allSwitches(false));
    }
  });

  it('covers the fifteen installable runtimes', () => {
    expect(capabilityTableRuntimes()).toEqual([
      'antigravity', 'augment', 'claude', 'cline', 'codebuddy', 'codex', 'copilot', 'cursor',
      'gemini', 'hermes', 'kilo', 'opencode', 'qwen', 'trae', 'windsurf',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/fvgsd-build-settings.test.cjs`
Expected: FAIL. The `accepts …` tests report `Unknown config key`, the `validateBuildSetting` tests fail with `validateBuildSetting is not a function`, and the capability-table tests fail with `ENOENT … runtime-capabilities.json`. The `rejects …` tests may already pass.

Run: `cd sdk && npx vitest run src/runtime-capabilities.test.ts`
Expected: FAIL with `Failed to load url ./runtime-capabilities.js`.

- [ ] **Step 3: Add the defaults and valid keys**

In `sdk/shared/config-defaults.manifest.json`, replace:

```json
    "security_asvs_level": 1,
    "security_block_on": "high"
  },
```

with:

```json
    "security_asvs_level": 1,
    "security_block_on": "high",
    "build_mode": true,
    "build_fix_rounds": 2,
    "build_human_checks": "defer",
    "build_code_review": false,
    "build_parallel": "auto",
    "build_engine": "agents",
    "build_check_timeout_seconds": 1800,
    "lint_command": "",
    "typecheck_command": ""
  },
```

In `sdk/shared/config-schema.manifest.json`, replace:

```json
    "workflow.drift_threshold",
    "workflow.drift_action",
```

with:

```json
    "workflow.drift_threshold",
    "workflow.drift_action",
    "workflow.build_mode",
    "workflow.build_fix_rounds",
    "workflow.build_human_checks",
    "workflow.build_code_review",
    "workflow.build_parallel",
    "workflow.build_engine",
    "workflow.build_check_timeout_seconds",
    "workflow.lint_command",
    "workflow.typecheck_command",
    "workflow.build_command",
    "workflow.test_command",
```

In `sdk/src/config.ts`, replace:

```ts
  context_coverage_gate: boolean;
}

export interface HooksConfig {
```

with:

```ts
  context_coverage_gate: boolean;
  /** Route discussed phases to the build command instead of plan-phase + execute-phase (default true). */
  build_mode?: boolean;
  /** Fix rounds after build verification, integer 0–5 (default 2). */
  build_fix_rounds?: number;
  /** 'defer' keeps human-only checks out of verification status; 'block' makes it human_needed. */
  build_human_checks?: 'defer' | 'block';
  /** Run fvgsd-code-reviewer once over the build diff. */
  build_code_review?: boolean;
  /** 'auto' builds a wave's slices in parallel where the runtime supports it; 'off' builds one at a time. */
  build_parallel?: 'auto' | 'off';
  /** 'agents' (default) or the saved Claude Code workflow engine. */
  build_engine?: 'agents' | 'workflow';
  /** Per-command timeout for build.run-checks, in seconds (default 1800). */
  build_check_timeout_seconds?: number;
  /** Check commands. An empty or missing value means checks.detect decides. */
  build_command?: string;
  typecheck_command?: string;
  lint_command?: string;
  test_command?: string;
}

export interface HooksConfig {
```

- [ ] **Step 4: Validate the new keys in `config-set`**

In `sdk/src/query/config-mutation.ts`, directly above the line `// ─── setConfigValue ───────────────────────────────────────────────────────`, add:

```ts
// ─── validateBuildSetting ─────────────────────────────────────────────────

const BUILD_SETTING_BOOLEANS = new Set(['workflow.build_mode', 'workflow.build_code_review']);
const BUILD_SETTING_ENUMS: Readonly<Record<string, readonly string[]>> = {
  'workflow.build_human_checks': ['defer', 'block'],
  'workflow.build_parallel': ['auto', 'off'],
  'workflow.build_engine': ['agents', 'workflow'],
};
const BUILD_SETTING_STRINGS = new Set([
  'workflow.lint_command',
  'workflow.typecheck_command',
  'workflow.build_command',
  'workflow.test_command',
]);

/**
 * Validate a build setting value after CLI coercion.
 * Returns an error sentence, or null when the value is acceptable or the key is not a build setting.
 * Mirrored by validateBuildSetting in get-shit-done/bin/lib/config.cjs.
 */
export function validateBuildSetting(keyPath: string, value: unknown): string | null {
  if (BUILD_SETTING_BOOLEANS.has(keyPath) && typeof value !== 'boolean') {
    return 'Must be a boolean (true or false).';
  }
  const allowed = Object.prototype.hasOwnProperty.call(BUILD_SETTING_ENUMS, keyPath) ? BUILD_SETTING_ENUMS[keyPath] : null;
  if (allowed && !allowed.includes(String(value))) {
    return `Valid values: ${allowed.join(', ')}`;
  }
  if (keyPath === 'workflow.build_fix_rounds'
    && !(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5)) {
    return 'Must be an integer from 0 to 5.';
  }
  if (keyPath === 'workflow.build_check_timeout_seconds'
    && !(typeof value === 'number' && Number.isInteger(value) && value > 0)) {
    return 'Must be a positive integer.';
  }
  if (BUILD_SETTING_STRINGS.has(keyPath) && typeof value !== 'string') {
    return 'Must be a string.';
  }
  return null;
}

```

In the same file, replace:

```ts
  // Human verification checkpoint mode (#3309) — port of config.cjs:457-460.
  const VALID_HUMAN_VERIFY_MODES = ['mid-flight', 'end-of-phase'];
  if (keyPath === 'workflow.human_verify_mode' && !VALID_HUMAN_VERIFY_MODES.includes(String(parsedValue))) {
    throw new GSDError(
      `Invalid workflow.human_verify_mode '${rawValue}'. Valid values: ${VALID_HUMAN_VERIFY_MODES.join(', ')}`,
      ErrorClassification.Validation,
    );
  }
```

with:

```ts
  // Human verification checkpoint mode (#3309) — port of config.cjs:457-460.
  const VALID_HUMAN_VERIFY_MODES = ['mid-flight', 'end-of-phase'];
  if (keyPath === 'workflow.human_verify_mode' && !VALID_HUMAN_VERIFY_MODES.includes(String(parsedValue))) {
    throw new GSDError(
      `Invalid workflow.human_verify_mode '${rawValue}'. Valid values: ${VALID_HUMAN_VERIFY_MODES.join(', ')}`,
      ErrorClassification.Validation,
    );
  }

  // Build settings — keep in sync with validateBuildSetting in config.cjs.
  const buildSettingError = validateBuildSetting(keyPath, parsedValue);
  if (buildSettingError) {
    throw new GSDError(`Invalid ${keyPath} '${rawValue}'. ${buildSettingError}`, ErrorClassification.Validation);
  }
```

In `get-shit-done/bin/lib/config.cjs`, directly above the JSDoc of `cmdConfigSet` (the `/**` line before ` * Command to set a value in the config file, allowing nested values via dot notation (e.g.,`), add:

```js
const BUILD_SETTING_BOOLEANS = new Set(['workflow.build_mode', 'workflow.build_code_review']);
const BUILD_SETTING_ENUMS = {
  'workflow.build_human_checks': ['defer', 'block'],
  'workflow.build_parallel': ['auto', 'off'],
  'workflow.build_engine': ['agents', 'workflow'],
};
const BUILD_SETTING_STRINGS = new Set([
  'workflow.lint_command',
  'workflow.typecheck_command',
  'workflow.build_command',
  'workflow.test_command',
]);

// Mirrors validateBuildSetting in sdk/src/query/config-mutation.ts.
function validateBuildSetting(keyPath, value) {
  if (BUILD_SETTING_BOOLEANS.has(keyPath) && typeof value !== 'boolean') {
    return 'Must be a boolean (true or false).';
  }
  const allowed = Object.prototype.hasOwnProperty.call(BUILD_SETTING_ENUMS, keyPath) ? BUILD_SETTING_ENUMS[keyPath] : null;
  if (allowed && !allowed.includes(String(value))) {
    return `Valid values: ${allowed.join(', ')}`;
  }
  if (keyPath === 'workflow.build_fix_rounds'
    && !(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5)) {
    return 'Must be an integer from 0 to 5.';
  }
  if (keyPath === 'workflow.build_check_timeout_seconds'
    && !(typeof value === 'number' && Number.isInteger(value) && value > 0)) {
    return 'Must be a positive integer.';
  }
  if (BUILD_SETTING_STRINGS.has(keyPath) && typeof value !== 'string') {
    return 'Must be a string.';
  }
  return null;
}

```

In the same file, replace:

```js
  // Human verification checkpoint mode (#3309)
  const VALID_HUMAN_VERIFY_MODES = ['mid-flight', 'end-of-phase'];
  if (keyPath === 'workflow.human_verify_mode' && !VALID_HUMAN_VERIFY_MODES.includes(String(parsedValue))) {
    error(`Invalid workflow.human_verify_mode '${value}'. Valid values: ${VALID_HUMAN_VERIFY_MODES.join(', ')}`);
  }
```

with:

```js
  // Human verification checkpoint mode (#3309)
  const VALID_HUMAN_VERIFY_MODES = ['mid-flight', 'end-of-phase'];
  if (keyPath === 'workflow.human_verify_mode' && !VALID_HUMAN_VERIFY_MODES.includes(String(parsedValue))) {
    error(`Invalid workflow.human_verify_mode '${value}'. Valid values: ${VALID_HUMAN_VERIFY_MODES.join(', ')}`);
  }

  // Build settings — keep in sync with sdk/src/query/config-mutation.ts.
  const buildSettingError = validateBuildSetting(keyPath, parsedValue);
  if (buildSettingError) {
    error(`Invalid ${keyPath} '${value}'. ${buildSettingError}`);
  }
```

In the same file, export the function so the tests can call the CJS copy directly. Replace:

```js
module.exports = {
  VALID_CONFIG_KEYS,
  cmdConfigEnsureSection,
```

with:

```js
module.exports = {
  VALID_CONFIG_KEYS,
  validateBuildSetting,
  cmdConfigEnsureSection,
```

- [ ] **Step 5: Add the capability table and its loader**

In `get-shit-done/bin/lib/runtime-artifact-layout.cjs`, replace:

```js
module.exports = { resolveRuntimeArtifactLayout, findInstallSourceRoot };
```

with:

```js
module.exports = { ALLOWED_RUNTIMES, resolveRuntimeArtifactLayout, findInstallSourceRoot };
```

Create `sdk/shared/runtime-capabilities.json`:

```json
{
  "claude": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": true, "per_call_model": true, "agent_effort": true, "background_tasks": true, "workflow_scripts": true },
  "cursor": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": true, "per_call_model": false, "agent_effort": true, "background_tasks": false, "workflow_scripts": false },
  "gemini": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": false, "per_call_model": false, "agent_effort": false, "background_tasks": false, "workflow_scripts": false },
  "codex": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": false, "per_call_model": true, "agent_effort": true, "background_tasks": true, "workflow_scripts": false },
  "copilot": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": false, "per_call_model": false, "agent_effort": false, "background_tasks": true, "workflow_scripts": false },
  "antigravity": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": true, "per_call_model": false, "agent_effort": false, "background_tasks": false, "workflow_scripts": false },
  "windsurf": { "spawn_agents": false, "parallel_agents": false, "worktree_isolation": false, "per_call_model": false, "agent_effort": false, "background_tasks": false, "workflow_scripts": false },
  "augment": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": false, "per_call_model": false, "agent_effort": false, "background_tasks": false, "workflow_scripts": false },
  "trae": { "spawn_agents": false, "parallel_agents": false, "worktree_isolation": false, "per_call_model": false, "agent_effort": false, "background_tasks": false, "workflow_scripts": false },
  "qwen": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": true, "per_call_model": false, "agent_effort": false, "background_tasks": true, "workflow_scripts": false },
  "hermes": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": false, "per_call_model": false, "agent_effort": false, "background_tasks": true, "workflow_scripts": false },
  "codebuddy": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": true, "per_call_model": false, "agent_effort": true, "background_tasks": true, "workflow_scripts": false },
  "cline": { "spawn_agents": false, "parallel_agents": false, "worktree_isolation": false, "per_call_model": false, "agent_effort": false, "background_tasks": false, "workflow_scripts": false },
  "opencode": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": false, "per_call_model": false, "agent_effort": true, "background_tasks": false, "workflow_scripts": false },
  "kilo": { "spawn_agents": true, "parallel_agents": true, "worktree_isolation": false, "per_call_model": false, "agent_effort": true, "background_tasks": false, "workflow_scripts": false }
}
```

**Where the values come from.** They were set from each runtime's official documentation, checked on 2026-09-13.

A switch is `true` only when all of these hold:
- the documented feature is on by default
- it works per spawn in the way `/fvgsd-build` uses it
- it is available in the surface fvgsd installs into

Everything else is `false`, per the spec: "any value not confirmed there is false".

Sources and deliberate `false` values:
- **claude:** all on. Sources: code.claude.com/docs/en/sub-agents, /tools-reference, /worktrees and /workflows.
- **codex:**
  - on: subagents, parallel runs, per-spawn model and effort, background terminals. Sources: learn.chatgpt.com/docs/config-file/config-reference and /docs/agent-configuration/subagents.
  - off: worktree isolation; the runtime doesn't provide it.
- **gemini:**
  - on: subagents (geminicli.com/docs/core/subagents) and parallel subagents (developers.googleblog.com, "Subagents have arrived in Gemini CLI").
  - off: background tasks, because output reaches the agent only when `tools.shell.backgroundCompletionBehavior` is `"inject"`, and the default is `"silent"`. Also off: effort, which is settings-only.
- **opencode:**
  - on: subagents, parallel runs and `reasoningEffort` in agent config. Source: opencode.ai/docs/agents.
  - off: background subagents, which need an experimental flag.
- **copilot:**
  - on: subagents and parallel runs (code.visualstudio.com/docs/copilot/agents/subagents; docs.github.com Copilot CLI fleet); background shells in VS Code and CLI.
  - off: per-call model, which is VS Code only, and effort, which is CLI only with its field name undocumented.
- **cursor:**
  - on: parallel Task calls, worktree per subagent and effort through the model string. Source: cursor.com/docs/subagents.
  - off: per-call model, which is frontmatter only.
- **windsurf:** all off. Cascade was removed on 2026-09-08 (docs.devin.ai/desktop/changelog).
- **cline:** all off. Agent Teams exist only in the CLI, SDK and Kanban, not in the VS Code extension fvgsd installs into (docs.cline.bot/cli/agent-teams).
- **kilo:**
  - on: subagents (kilo.ai/docs/automate/tools), parallel runs (blog.kilo.ai, new Kilo for VS Code) and provider options like `reasoningEffort` (kilo.ai/docs/customize/custom-subagents).
- **qwen:**
  - on: Task tool with `isolation: "worktree"` and parallel runs (github.com/QwenLM/qwen-code docs/developers/tools/task.md); background monitor (docs/developers/tools/monitor.md).
  - off: per-call model, which accepts configured grades rather than model IDs, and workflows, which are off by default (`tools.workflowsEnabled`).
- **antigravity:** on: `invoke_subagent` with a worktree per subagent. Source: antigravity.google/docs/subagents.
- **augment:** on: subagents and parallel runs in Auggie CLI. Source: docs.augmentcode.com/cli/subagents.
- **trae:** all off. Agent-defined subagents need a Beta switch (docs.trae.ai/ide/subagents).
- **codebuddy:**
  - on: subagents, background tasks, worktrees and parallel runs. Sources: codebuddy.ai/docs/cli/tools-reference, /worktree and /sub-agents.
  - off: per-call model, which takes tiers rather than model IDs, and workflow scripts, which use a different engine and are in research preview.
- **hermes:**
  - on: delegation and parallel runs (hermes-agent.nousresearch.com/docs/user-guide/features/delegation); background tools.
  - off: worktree isolation, which needs the global `delegation.worktree_isolation`, off by default.

`workflow_scripts` stays `true` only for Claude Code, because the Stage 2 engine is a Claude Code saved workflow.

Create `sdk/src/runtime-capabilities.ts`:

```ts
/**
 * Runtime capability table — per-runtime switches that pick the build tier.
 *
 * Source of truth: sdk/shared/runtime-capabilities.json. Values come from each
 * runtime's own documentation; anything not confirmed there is false. Turning a
 * switch on is the only change needed to give a runtime the faster behavior.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RUNTIME_CAPABILITY_KEYS = [
  'spawn_agents',
  'parallel_agents',
  'worktree_isolation',
  'per_call_model',
  'agent_effort',
  'background_tasks',
  'workflow_scripts',
] as const;

export type RuntimeCapabilityKey = (typeof RUNTIME_CAPABILITY_KEYS)[number];
export type RuntimeCapabilities = Record<RuntimeCapabilityKey, boolean>;

const TABLE_PATH = new URL('../shared/runtime-capabilities.json', import.meta.url);
const TABLE: Record<string, Record<string, unknown>> = JSON.parse(readFileSync(fileURLToPath(TABLE_PATH), 'utf-8'));

/** Resolve the switches for a runtime. Unknown runtimes resolve to all false. */
export function resolveRuntimeCapabilities(runtime: string): RuntimeCapabilities {
  const entry = Object.prototype.hasOwnProperty.call(TABLE, runtime) ? TABLE[runtime] : undefined;
  const result = {} as RuntimeCapabilities;
  for (const key of RUNTIME_CAPABILITY_KEYS) {
    result[key] = entry !== undefined && entry[key] === true;
  }
  return result;
}

/** Runtime names present in the table, sorted. */
export function capabilityTableRuntimes(): string[] {
  return Object.keys(TABLE).sort();
}
```

- [ ] **Step 6: Document the keys**

In `docs/CONFIGURATION.md`, replace both occurrences of:

```text
When unset, the gate auto-detects:
```

(in the `workflow.build_command` and `workflow.test_command` rows) with:

```text
When unset, `checks.detect` resolves it (used by this gate and the build workflow):
```

Insert these rows directly after the `workflow.test_command` row, which is the last row of the Workflow Toggles table:

```markdown
| `workflow.build_mode` | boolean | `true` | Route discussed phases to the build workflow, which plans and executes a phase in one step. When `false`, every suggestion reverts to `/fvgsd-plan-phase` and `/fvgsd-execute-phase`. |
| `workflow.build_fix_rounds` | number | `2` | Maximum fix rounds the build workflow runs after verification (0–5). A round that doesn't reduce the number of problems ends the loop early. |
| `workflow.build_human_checks` | string | `defer` | `defer` records human-only checks in `{phase}-HUMAN-UAT.md` without changing the verification status. `block` sets the status to `human_needed`. |
| `workflow.build_code_review` | boolean | `false` | Run `fvgsd-code-reviewer` once over the build diff. Critical findings join the fix list. |
| `workflow.build_parallel` | string | `auto` | `auto` builds a wave's slices in parallel worktrees when the runtime supports it. `off` builds one slice at a time. |
| `workflow.build_engine` | string | `agents` | `agents` runs slices as spawned agents. `workflow` selects the saved Claude Code workflow engine, with a fallback to `agents` when that engine is unavailable. |
| `workflow.build_check_timeout_seconds` | number | `1800` | Per-command timeout for `build.run-checks`. |
| `workflow.lint_command` | string | `""` | Lint command for build checks. Empty means `checks.detect` decides: a package.json `lint` script, a Makefile or Justfile `lint` target, `cargo clippy`, `go vet ./...`, or `ruff check .` when ruff is configured. |
| `workflow.typecheck_command` | string | `""` | Typecheck command for build checks. Empty means `checks.detect` decides: a package.json `typecheck` or `type-check` script, a Makefile or Justfile `typecheck` target, `npx tsc --noEmit` when `tsconfig.json` exists, or `mypy .` when mypy is configured. |
```

The build command itself arrives in Task 10. Until then, `docs/` must not mention its slash name: `tests/docs-parity-live-registry.test.cjs` rejects `/fvgsd-*` tokens that don't name an existing command.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
(cd sdk && npm run build)   # fvgsd-tools config-set dispatches through sdk/dist; a stale build skips the new validation
node --test tests/fvgsd-build-settings.test.cjs tests/config.test.cjs tests/config-schema-docs-parity.test.cjs tests/config-schema-sdk-parity.test.cjs tests/configuration-generator.test.cjs tests/secure-phase.test.cjs
(cd sdk && npx vitest run src/runtime-capabilities.test.ts src/query/config-mutation.test.ts src/query/config-query.test.ts)
npm run check:configuration-fresh
(cd sdk && npx tsc --noEmit)
```

Expected: all pass. None of these tests pins the complete `workflow` defaults object, so no existing expectation changes. If one does fail because it enumerates every workflow default, add the nine new keys with the defaults above to that expectation. That edit belongs to this task.

- [ ] **Step 8: Compare the root suite with the baseline**

```bash
npm test > "$WS/task-1-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-1-root.log"
```

Expected: `"newFailures": []`.

- [ ] **Step 9: Commit**

```bash
git add sdk/shared/config-defaults.manifest.json sdk/shared/config-schema.manifest.json sdk/shared/runtime-capabilities.json \
  sdk/src/config.ts sdk/src/runtime-capabilities.ts sdk/src/runtime-capabilities.test.ts sdk/src/query/config-mutation.ts \
  get-shit-done/bin/lib/config.cjs get-shit-done/bin/lib/runtime-artifact-layout.cjs docs/CONFIGURATION.md \
  tests/fvgsd-build-settings.test.cjs
git commit -m "feat(config): add build settings and runtime capability table"
```

---

### Task 2: `build-shared.ts`, `checks.detect`, `build.run-checks`, post-merge gate

**Files:**
- Create:
  - `sdk/src/query/build-shared.ts`
  - `sdk/src/query/build-checks.ts`
- Modify:
  - `sdk/src/query/command-manifest.non-family.ts`
  - `sdk/src/query/command-static-catalog-domain.ts`
  - `sdk/src/query/command-aliases.generated.ts` (generated)
  - `get-shit-done/bin/lib/command-aliases.generated.cjs` (generated)
  - `get-shit-done/workflows/execute-phase/steps/post-merge-gate.md`
- Test:
  - `sdk/src/query/build-shared.test.ts`
  - `sdk/src/query/build-checks.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (`sdk/src/config.ts`), `findPhase` (`sdk/src/query/phase.ts`), `normalizePhaseName` (`sdk/src/query/helpers.ts`), and the Task 1 defaults (`workflow.build_check_timeout_seconds`, `workflow.lint_command`, `workflow.typecheck_command`).
- Produces: exactly the registry's `build-shared.ts` Task 2 functions (`parseFlags`, `runGit`, `gitCommonDir`, `headCommit`, `resolveBuildPhase`, `buildStateDir`, `writeJsonAtomic`) and every `build-checks.ts` name (`CHECK_NAMES`, `CHECK_SETS`, `detectChecks`, `checksDetect`, `readLatestChecks`, `buildRunChecks` and their types). The queries `checks.detect` and `build.run-checks` are registered.

- [ ] **Step 1: Write the failing tests**

Create `sdk/src/query/build-shared.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import {
  buildStateDir, gitCommonDir, headCommit, parseFlags, resolveBuildPhase, runGit, writeJsonAtomic,
} from './build-shared.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function makeRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(dir, 'README.md'), '# test\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

describe('parseFlags', () => {
  const spec = { values: ['phase', 'set'], booleans: ['gaps'] } as const;

  it('parses values, the equals form, booleans and positionals', () => {
    expect(parseFlags(['3', '--set', 'full', '--phase=03', '--gaps'], spec)).toEqual({
      flags: { set: 'full', phase: '03', gaps: true },
      positionals: ['3'],
    });
  });

  it('keeps unicode, long values and shell metacharacters as plain values', () => {
    const value = `ünïcode; rm -rf / && $(whoami) \`id\` "q" ${'x'.repeat(5000)}`;
    expect(parseFlags(['--phase', value], spec).flags.phase).toBe(value);
  });

  it.each([
    [['--phase']],
    [['--phase', '--set', 'full']],
    [['--phase', '']],
    [['--phase', '   ']],
    [['--phase=']],
    [['--phase==1']],
    [['--phase', '1', '--phase', '2']],
    [['--nope', 'x']],
    [['--gaps=true']],
    [['--']],
  ])('rejects %j', (args) => {
    let caught: unknown;
    try {
      parseFlags(args, spec);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GSDError);
    expect((caught as GSDError).classification).toBe('validation');
  });
});

describe('resolveBuildPhase', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-shared-'));
    await mkdir(join(dir, '.planning', 'phases', '03-user-auth'), { recursive: true });
    await mkdir(join(dir, '.planning', 'phases', '02.1-hotfix'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves number, padded, name and directories', async () => {
    expect(await resolveBuildPhase(dir, '3')).toEqual({
      number: '3',
      padded: '03',
      name: 'user-auth',
      dir: '.planning/phases/03-user-auth',
      dirAbs: join(dir, '.planning/phases/03-user-auth'),
    });
  });

  it('keeps decimal phases', async () => {
    const phase = await resolveBuildPhase(dir, '2.1');
    expect([phase?.number, phase?.padded]).toEqual(['2.1', '02.1']);
  });

  it('returns null for missing, empty or hostile phases', async () => {
    for (const arg of ['9', '', '   ', '../../etc', 'a\0b']) {
      expect(await resolveBuildPhase(dir, arg)).toBeNull();
    }
  });
});

describe('git helpers', () => {
  let repo: string;
  let worktree: string;

  beforeEach(async () => {
    repo = await makeRepo('fvgsd-build-git-');
    worktree = `${repo}-wt`;
    git(repo, 'worktree', 'add', '-q', worktree);
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it('resolves the shared common dir and state dir from a linked worktree', () => {
    const common = gitCommonDir(worktree);
    expect(common).not.toBeNull();
    expect(realpathSync(common!)).toBe(realpathSync(join(repo, '.git')));
    expect(buildStateDir(worktree, '03')).toBe(join(common!, 'fvgsd', 'build', '03'));
  });

  it('reports HEAD and handles directories outside git', async () => {
    expect(headCommit(repo)).toBe(git(repo, 'rev-parse', 'HEAD'));
    const plain = await mkdtemp(join(tmpdir(), 'fvgsd-build-nogit-'));
    expect(gitCommonDir(plain)).toBeNull();
    expect(headCommit(plain)).toBeNull();
    expect(buildStateDir(plain, '03')).toBeNull();
    expect(runGit(plain, ['status']).ok).toBe(false);
    await rm(plain, { recursive: true, force: true });
  });

  it('rejects unsafe phase segments for the state dir', () => {
    for (const bad of ['..', '../x', 'a/b', '', '.hidden']) {
      expect(() => buildStateDir(repo, bad)).toThrow(GSDError);
    }
  });
});

describe('writeJsonAtomic', () => {
  it('creates parents, replaces content and leaves no temp files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-json-'));
    const target = join(dir, 'a', 'b', 'data.json');
    writeJsonAtomic(target, { ok: true });
    writeJsonAtomic(target, { ok: false });
    expect(JSON.parse(await readFile(target, 'utf-8'))).toEqual({ ok: false });
    expect(await readdir(join(dir, 'a', 'b'))).toEqual(['data.json']);
    await rm(dir, { recursive: true, force: true });
  });
});
```

Create `sdk/src/query/build-checks.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildRunChecks, checksDetect, detectChecks, readLatestChecks, type RunChecksData } from './build-checks.js';

const NODE = JSON.stringify(process.execPath);
const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-checks-'));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function files(dir: string, entries: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(entries)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
}

async function repoWithConfig(workflow: Record<string, unknown>): Promise<string> {
  const dir = await tempDir();
  await files(dir, { '.planning/config.json': JSON.stringify({ workflow }) });
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

async function run(dir: string, args: string[]): Promise<RunChecksData> {
  return (await buildRunChecks(args, dir)).data as RunChecksData;
}

describe('detectChecks', () => {
  it('reads npm scripts', async () => {
    const dir = await tempDir();
    await files(dir, { 'package.json': JSON.stringify({ scripts: { build: 'tsc', typecheck: 'tsc --noEmit', lint: 'eslint .', test: 'vitest' } }) });
    expect(detectChecks(dir, {})).toEqual({
      build: 'npm run build', typecheck: 'npm run typecheck', lint: 'npm run lint', test: 'npm test',
      sources: { build: 'detected', typecheck: 'detected', lint: 'detected', test: 'detected' },
    });
  });

  it('uses type-check, and npm test without a build script', async () => {
    const dir = await tempDir();
    await files(dir, { 'package.json': JSON.stringify({ scripts: { 'type-check': 'tsc' } }), 'tsconfig.json': '{}' });
    const checks = detectChecks(dir, {});
    expect([checks.build, checks.typecheck, checks.lint, checks.test]).toEqual([null, 'npm run type-check', null, 'npm test']);
  });

  it('falls back to tsc when only tsconfig.json exists', async () => {
    const dir = await tempDir();
    await files(dir, { 'tsconfig.json': '{}' });
    expect(detectChecks(dir, {}).typecheck).toBe('npx tsc --noEmit');
  });

  it('uses Makefile targets and ignores commented ones', async () => {
    const dir = await tempDir();
    await files(dir, { Makefile: 'build:\n\tcc\ntest:\n\t./t\nlint:\n\tl\ntypecheck:\n\tc\n' });
    expect(detectChecks(dir, {})).toMatchObject({ build: 'make build', typecheck: 'make typecheck', lint: 'make lint', test: 'make test' });
    const commented = await tempDir();
    await files(commented, { Makefile: '# build:\n# test:\n' });
    expect(detectChecks(commented, {})).toMatchObject({ build: null, test: null });
  });

  it('uses just for build and test, and only existing lint or typecheck recipes', async () => {
    const dir = await tempDir();
    await files(dir, { justfile: 'lint:\n  echo lint\n' });
    expect(detectChecks(dir, {})).toMatchObject({ build: 'just build', test: 'just test', lint: 'just lint', typecheck: null });
  });

  it('detects Go and Cargo projects', async () => {
    const go = await tempDir();
    await files(go, { 'go.mod': 'module example.com/x\n' });
    expect(detectChecks(go, {})).toMatchObject({ build: 'go build ./...', test: 'go test ./...', lint: 'go vet ./...', typecheck: null });
    const cargo = await tempDir();
    await files(cargo, { 'Cargo.toml': '[package]\nname = "x"\n' });
    expect(detectChecks(cargo, {})).toMatchObject({ build: 'cargo build', test: 'cargo test', lint: 'cargo clippy', typecheck: null });
  });

  it('detects Python and only proposes ruff and mypy when configured', async () => {
    const dir = await tempDir();
    await files(dir, {
      'pyproject.toml': '[tool.ruff]\nline-length = 100\n[tool.mypy]\nstrict = true\n',
      'src/app.py': 'x = 1\n',
      'tests/test_app.py': 'y = 2\n',
      '.venv/lib.py': '',
      'node_modules/pkg/x.py': '',
      '.planning/notes.py': '',
    });
    expect(detectChecks(dir, {})).toMatchObject({
      build: "python -m py_compile 'src/app.py' 'tests/test_app.py'",
      test: 'python -m pytest -x -q --tb=short || uv run python -m pytest -x -q --tb=short',
      lint: 'ruff check .',
      typecheck: 'mypy .',
    });
    const plain = await tempDir();
    await files(plain, { 'requirements.txt': 'requests\n' });
    expect(detectChecks(plain, {})).toMatchObject({ lint: null, typecheck: null, test: 'python -m pytest -x -q --tb=short || uv run python -m pytest -x -q --tb=short' });
  });

  it('detects Xcode with and without a scheme', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'App.xcodeproj'), { recursive: true });
    const destination = "-destination 'platform=iOS Simulator,name=iPhone 16'";
    expect(detectChecks(dir, {}, { listXcodeSchemes: () => ["My'App"] })).toMatchObject({
      build: `xcodebuild build -scheme 'My'\\''App' ${destination}`,
      test: `xcodebuild test -scheme 'My'\\''App' ${destination}`,
    });
    expect(detectChecks(dir, {}, { listXcodeSchemes: () => [] })).toMatchObject({
      build: `xcodebuild build ${destination}`,
      test: `xcodebuild test ${destination}`,
    });
  });

  it('lets configured commands win and ignores blank ones', async () => {
    const dir = await tempDir();
    await files(dir, { 'package.json': JSON.stringify({ scripts: { build: 'tsc' } }) });
    const checks = detectChecks(dir, { build_command: 'make all', test_command: '   ', lint_command: 'lint-it', typecheck_command: 42 });
    expect(checks).toMatchObject({ build: 'make all', test: 'npm test', lint: 'lint-it', typecheck: null });
    expect(checks.sources).toEqual({ build: 'config', typecheck: 'none', lint: 'config', test: 'detected' });
  });

  it('returns nulls for an empty directory and tolerates malformed package.json', async () => {
    const empty = await tempDir();
    expect(detectChecks(empty, {})).toEqual({
      build: null, typecheck: null, lint: null, test: null,
      sources: { build: 'none', typecheck: 'none', lint: 'none', test: 'none' },
    });
    const broken = await tempDir();
    await files(broken, { 'package.json': '{not json' });
    expect(detectChecks(broken, {})).toMatchObject({ build: null, test: 'npm test' });
  });

  it('serves checks.detect from project config and rejects arguments', async () => {
    const dir = await repoWithConfig({ build_command: 'make all' });
    expect(((await checksDetect([], dir)).data as { build: string }).build).toBe('make all');
    await expect(checksDetect(['extra'], dir)).rejects.toThrow(GSDError);
  });
});

describe('build.run-checks', () => {
  it('runs a set and reports pass, fail and skipped commands', async () => {
    const dir = await repoWithConfig({
      build_command: `${NODE} -e "process.exit(0)"`,
      test_command: `${NODE} -e "process.exit(3)"`,
      build_check_timeout_seconds: 60,
    });
    const result = await run(dir, ['--phase', '3', '--set', 'full']);
    expect([result.set, result.label, result.passed]).toEqual(['full', 'full', false]);
    expect(result.results.map((r) => [r.name, r.skipped, r.exit, r.timed_out, r.preexisting])).toEqual([
      ['build', false, 0, false, false],
      ['typecheck', true, null, false, false],
      ['lint', true, null, false, false],
      ['test', false, 3, false, false],
    ]);
    expect(result.results[0].commit).toBe(git(dir, 'rev-parse', 'HEAD'));
    expect(git(dir, 'status', '--porcelain')).toBe('');
  }, 30_000);

  it('times out long commands', async () => {
    const dir = await repoWithConfig({ build_command: `${NODE} -e "setTimeout(()=>{},10000)"`, build_check_timeout_seconds: 1 });
    const started = Date.now();
    const [result] = (await run(dir, ['--phase', '3', '--set', 'wave', '--only', 'build'])).results;
    expect([result.timed_out, result.exit]).toEqual([true, null]);
    expect(Date.now() - started).toBeLessThan(8000);
  }, 30_000);

  it('marks failures that also failed in the baseline as preexisting', async () => {
    const dir = await repoWithConfig({
      build_command: `${NODE} -e "process.exit(0)"`,
      test_command: `${NODE} -e "process.exit(1)"`,
      build_check_timeout_seconds: 60,
    });
    const baseline = await run(dir, ['--phase', '3', '--set', 'full', '--label', 'baseline']);
    expect(baseline.results.find((r) => r.name === 'test')?.preexisting).toBe(false);
    await files(dir, { '.planning/config.json': JSON.stringify({ workflow: {
      build_command: `${NODE} -e "process.exit(2)"`,
      test_command: `${NODE} -e "process.exit(1)"`,
      build_check_timeout_seconds: 60,
    } }) });
    const full = await run(dir, ['--phase', '3', '--set', 'full']);
    expect(full.results.find((r) => r.name === 'test')?.preexisting).toBe(true);
    expect(full.results.find((r) => r.name === 'build')?.preexisting).toBe(false);
  }, 30_000);

  it('tracks the commit of each command in latest.json', async () => {
    const dir = await repoWithConfig({
      build_command: `${NODE} -e "process.exit(0)"`,
      test_command: `${NODE} -e "process.exit(0)"`,
      build_check_timeout_seconds: 60,
    });
    const first = git(dir, 'rev-parse', 'HEAD');
    await run(dir, ['--phase', '3', '--set', 'full']);
    await files(dir, { 'src.txt': 'change\n' });
    git(dir, 'add', 'src.txt');
    git(dir, 'commit', '-q', '-m', 'change');
    const second = git(dir, 'rev-parse', 'HEAD');
    await run(dir, ['--phase', '3', '--set', 'wave', '--only', 'build']);
    const latest = readLatestChecks(dir, '03');
    expect([latest.build.commit, latest.build.passed]).toEqual([second, true]);
    expect([latest.test.commit, latest.test.passed]).toEqual([first, true]);
    expect([latest.lint.skipped, latest.lint.passed]).toEqual([true, false]);
  }, 30_000);

  it('keeps the last 200 output lines', async () => {
    const dir = await repoWithConfig({
      build_command: `${NODE} -e "for(let i=0;i<500;i++)console.log('line '+i)"`,
      build_check_timeout_seconds: 60,
    });
    const [result] = (await run(dir, ['--phase', '3', '--set', 'wave', '--only', 'build'])).results;
    const lines = result.output_tail.split('\n');
    expect([lines.length, lines[0], lines[199]]).toEqual([200, 'line 300', 'line 499']);
  }, 30_000);

  it('reports a missing git repository', async () => {
    const dir = await tempDir();
    expect((await buildRunChecks(['--phase', '3', '--set', 'quick'], dir)).data).toEqual({ error: 'git_repository_required' });
  });

  it.each([
    [[]],
    [['--set', 'full']],
    [['--phase', '3']],
    [['--phase', '3', '--set', 'bogus']],
    [['--phase', '3', '--set', 'full', '--only', 'deploy']],
    [['--phase', '3', '--set', 'quick', '--only', 'test']],
    [['--phase', '3', '--set', 'full', '--label', 'Bad/Label']],
    [['--phase', '3', '--set', 'full', '--set', 'wave']],
    [['--phase', '../x', '--set', 'full']],
    [['--phase', '3', '--set', 'full', 'extra']],
  ])('rejects invalid arguments %j', async (args) => {
    const dir = await repoWithConfig({});
    await expect(buildRunChecks(args, dir)).rejects.toThrow(GSDError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sdk && npx vitest run src/query/build-shared.test.ts src/query/build-checks.test.ts`
Expected: FAIL with `Failed to load url ./build-shared.js` and `./build-checks.js`.

- [ ] **Step 3: Implement `build-shared.ts`**

Create `sdk/src/query/build-shared.ts`:

```ts
/**
 * Shared helpers for the build query handlers.
 *
 * Flag parsing that enforces the CLI negative-input rules, git access without a
 * shell, phase resolution, and the per-phase state directory that keeps check
 * results out of the working tree (<git-common-dir>/fvgsd/build/<phase>).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { findPhase } from './phase.js';

export interface FlagSpec { values?: readonly string[]; booleans?: readonly string[] }
export interface ParsedFlags { flags: Record<string, string | boolean>; positionals: string[] }

function invalid(message: string): GSDError {
  return new GSDError(message, ErrorClassification.Validation);
}

/** Parse `--name value`, `--name=value` and boolean flags; everything else is positional. */
export function parseFlags(args: readonly string[], spec: FlagSpec): ParsedFlags {
  const values = new Set(spec.values ?? []);
  const booleans = new Set(spec.booleans ?? []);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i]);
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!values.has(name) && !booleans.has(name)) throw invalid(`unknown flag --${name}`);
    if (Object.prototype.hasOwnProperty.call(flags, name)) throw invalid(`duplicate flag --${name}`);
    if (booleans.has(name)) {
      if (eq !== -1) throw invalid(`--${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = args[i + 1] === undefined ? undefined : String(args[i + 1]);
      i += 1;
    }
    if (value === undefined || value.startsWith('--')) throw invalid(`missing value for --${name}`);
    if (value.trim() === '') throw invalid(`empty value for --${name}`);
    if (value.startsWith('=')) throw invalid(`malformed value for --${name}`);
    flags[name] = value;
  }
  return { flags, positionals };
}

export interface GitResult { ok: boolean; code: number; stdout: string; stderr: string }

/** Run git with an argv array (never a shell). Trailing whitespace is trimmed; leading spaces are kept for porcelain output. */
export function runGit(cwd: string, args: readonly string[]): GitResult {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const code = result.status ?? 1;
  return {
    ok: code === 0 && !result.error,
    code,
    stdout: (result.stdout ?? '').replace(/\s+$/, ''),
    stderr: (result.stderr ?? '').replace(/\s+$/, ''),
  };
}

/** Absolute git common dir, shared by every linked worktree; null outside a repository. */
export function gitCommonDir(projectDir: string): string | null {
  const result = runGit(projectDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return result.ok && result.stdout ? result.stdout : null;
}

/** Full SHA of HEAD, or null when there is no repository or no commit. */
export function headCommit(projectDir: string): string | null {
  const result = runGit(projectDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  return result.ok && /^[0-9a-f]{40,64}$/.test(result.stdout) ? result.stdout : null;
}

export interface BuildPhase { number: string; padded: string; name: string; dir: string; dirAbs: string }

/** Resolve a phase argument to its on-disk directory; null when the phase has no directory. */
export async function resolveBuildPhase(projectDir: string, phaseArg: string, workstream?: string): Promise<BuildPhase | null> {
  const trimmed = typeof phaseArg === 'string' ? phaseArg.trim() : '';
  if (!trimmed || trimmed.includes('\0')) return null;
  const found = await findPhase([trimmed], projectDir, workstream);
  const data = found.data as Record<string, unknown>;
  if (!data.found || typeof data.directory !== 'string' || typeof data.phase_number !== 'string') return null;
  const padded = data.phase_number;
  return {
    number: padded.replace(/^0+(?=\d)/, ''),
    padded,
    name: typeof data.phase_name === 'string' ? data.phase_name : '',
    dir: data.directory,
    dirAbs: join(projectDir, data.directory),
  };
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** <git-common-dir>/fvgsd/build/<padded>; null outside a repository. Throws for unsafe segments. */
export function buildStateDir(projectDir: string, padded: string): string | null {
  if (!SAFE_SEGMENT.test(padded)) throw invalid(`invalid phase for the build state directory: ${padded}`);
  const common = gitCommonDir(projectDir);
  return common ? join(common, 'fvgsd', 'build', padded) : null;
}

/** Write JSON through a temp file and rename, creating parent directories. */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  renameSync(tmp, filePath);
}
```

- [ ] **Step 4: Implement `build-checks.ts`**

Create `sdk/src/query/build-checks.ts`:

```ts
/**
 * Build checks — `checks.detect` and `build.run-checks`.
 *
 * Resolves build/typecheck/lint/test commands (configured values first, then the
 * detection rules execute-phase's post-merge gate used in shell) and runs a set of
 * them with a timeout. Results are stored under <git-common-dir>/fvgsd/build/<P>/:
 * `<label>.json` for each run and `latest.json` with each command's latest result.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { loadConfig } from '../config.js';
import { normalizePhaseName, toPosixPath } from './helpers.js';
import { buildStateDir, headCommit, parseFlags, writeJsonAtomic } from './build-shared.js';
import type { QueryHandler } from './utils.js';

export type CheckName = 'build' | 'typecheck' | 'lint' | 'test';
export const CHECK_NAMES: readonly CheckName[] = ['build', 'typecheck', 'lint', 'test'];
export type CheckSet = 'quick' | 'wave' | 'full';
export const CHECK_SETS: Readonly<Record<CheckSet, readonly CheckName[]>> = Object.freeze({
  quick: ['typecheck', 'lint'],
  wave: ['build', 'typecheck'],
  full: ['build', 'typecheck', 'lint', 'test'],
});
export type CheckSource = 'config' | 'detected' | 'none';
export interface DetectedChecks {
  build: string | null;
  typecheck: string | null;
  lint: string | null;
  test: string | null;
  sources: Record<CheckName, CheckSource>;
}
export interface DetectDeps { listXcodeSchemes?: (projectPath: string) => string[] }
export interface CheckResult {
  name: CheckName;
  command: string | null;
  commit: string | null;
  exit: number | null;
  timed_out: boolean;
  skipped: boolean;
  duration_ms: number;
  preexisting: boolean;
  output_tail: string;
}
export interface RunChecksData { set: CheckSet; label: string; passed: boolean; results: CheckResult[] }
export interface LatestCheckEntry {
  command: string | null;
  commit: string | null;
  exit: number | null;
  timed_out: boolean;
  skipped: boolean;
  passed: boolean;
  at: string;
}

const XCODE_DESTINATION = "-destination 'platform=iOS Simulator,name=iPhone 16'";
const PYTHON_SKIP = new Set(['.planning', 'node_modules', '.git', '.venv', 'venv', '__pycache__']);
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TAIL_BYTES = 256 * 1024;
const TAIL_LINES = 200;
const DEFAULT_TIMEOUT_SECONDS = 1800;

function invalid(message: string): GSDError {
  return new GSDError(message, ErrorClassification.Validation);
}

function readText(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hasRecipe(text: string | null, name: string): boolean {
  return text !== null && new RegExp(`^${name}:`, 'm').test(text);
}

function justfileText(projectDir: string): string | null {
  for (const name of ['Justfile', 'justfile']) {
    const text = readText(join(projectDir, name));
    if (text !== null) return text;
  }
  return null;
}

function packageInfo(projectDir: string): { exists: boolean; scripts: Record<string, unknown> } {
  const text = readText(join(projectDir, 'package.json'));
  if (text === null) return { exists: false, scripts: {} };
  try {
    const parsed = JSON.parse(text) as { scripts?: unknown };
    const scripts = parsed && typeof parsed.scripts === 'object' && parsed.scripts !== null ? parsed.scripts as Record<string, unknown> : {};
    return { exists: true, scripts };
  } catch {
    return { exists: true, scripts: {} };
  }
}

function hasScript(scripts: Record<string, unknown>, name: string): boolean {
  return typeof scripts[name] === 'string' && (scripts[name] as string).trim() !== '';
}

function findXcodeProject(projectDir: string): string | null {
  const found: string[] = [];
  const scan = (dir: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.name.endsWith('.xcodeproj')) found.push(full);
      else if (depth < 2 && !entry.name.startsWith('.')) scan(full, depth + 1);
    }
  };
  scan(projectDir, 1);
  return found.sort()[0] ?? null;
}

function defaultListXcodeSchemes(projectPath: string): string[] {
  const result = spawnSync('xcodebuild', ['-list', '-json', '-project', projectPath], { encoding: 'utf-8', timeout: 30_000 });
  if (result.status !== 0 || !result.stdout) return [];
  try {
    const schemes = (JSON.parse(result.stdout) as { project?: { schemes?: unknown } }).project?.schemes;
    return Array.isArray(schemes) ? schemes.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function pythonFiles(projectDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (found.length >= 5000) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (PYTHON_SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.py')) found.push(toPosixPath(relative(projectDir, full)));
    }
  };
  walk(projectDir);
  return found.sort().slice(0, 20);
}

/** Resolve the four check commands: non-empty configured values win, then detection. */
export function detectChecks(projectDir: string, workflowConfig: Record<string, unknown>, deps: DetectDeps = {}): DetectedChecks {
  const configured = (key: string): string | null => {
    const value = workflowConfig[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };
  const exists = (name: string): boolean => existsSync(join(projectDir, name));
  const makefile = readText(join(projectDir, 'Makefile'));
  const justfile = justfileText(projectDir);
  const pkg = packageInfo(projectDir);
  const pyproject = readText(join(projectDir, 'pyproject.toml'));
  const isPython = pyproject !== null || exists('requirements.txt');
  const xcodeProject = findXcodeProject(projectDir);
  let scheme: string | null | undefined;
  const xcode = (action: 'build' | 'test'): string | null => {
    if (!xcodeProject) return null;
    if (scheme === undefined) scheme = (deps.listXcodeSchemes ?? defaultListXcodeSchemes)(xcodeProject)[0] ?? null;
    return scheme
      ? `xcodebuild ${action} -scheme ${shellQuote(scheme)} ${XCODE_DESTINATION}`
      : `xcodebuild ${action} ${XCODE_DESTINATION}`;
  };

  const detectBuild = (): string | null => {
    const fromXcode = xcode('build');
    if (fromXcode) return fromXcode;
    if (hasRecipe(makefile, 'build')) return 'make build';
    if (justfile !== null) return 'just build';
    if (exists('Cargo.toml')) return 'cargo build';
    if (exists('go.mod')) return 'go build ./...';
    if (isPython) {
      const files = pythonFiles(projectDir);
      return files.length > 0 ? `python -m py_compile ${files.map(shellQuote).join(' ')}` : null;
    }
    return hasScript(pkg.scripts, 'build') ? 'npm run build' : null;
  };
  const detectTest = (): string | null => {
    const fromXcode = xcode('test');
    if (fromXcode) return fromXcode;
    if (hasRecipe(makefile, 'test')) return 'make test';
    if (justfile !== null) return 'just test';
    if (pkg.exists) return 'npm test';
    if (exists('Cargo.toml')) return 'cargo test';
    if (exists('go.mod')) return 'go test ./...';
    return isPython ? 'python -m pytest -x -q --tb=short || uv run python -m pytest -x -q --tb=short' : null;
  };
  const detectTypecheck = (): string | null => {
    if (hasScript(pkg.scripts, 'typecheck')) return 'npm run typecheck';
    if (hasScript(pkg.scripts, 'type-check')) return 'npm run type-check';
    if (hasRecipe(makefile, 'typecheck')) return 'make typecheck';
    if (hasRecipe(justfile, 'typecheck')) return 'just typecheck';
    if (exists('tsconfig.json')) return 'npx tsc --noEmit';
    if ((pyproject !== null && /^\[tool\.mypy\b/m.test(pyproject)) || exists('mypy.ini')) return 'mypy .';
    return null;
  };
  const detectLint = (): string | null => {
    if (hasScript(pkg.scripts, 'lint')) return 'npm run lint';
    if (hasRecipe(makefile, 'lint')) return 'make lint';
    if (hasRecipe(justfile, 'lint')) return 'just lint';
    if (exists('Cargo.toml')) return 'cargo clippy';
    if (exists('go.mod')) return 'go vet ./...';
    if ((pyproject !== null && /^\[tool\.ruff\b/m.test(pyproject)) || exists('ruff.toml') || exists('.ruff.toml')) return 'ruff check .';
    return null;
  };

  const detectors: Record<CheckName, () => string | null> = { build: detectBuild, typecheck: detectTypecheck, lint: detectLint, test: detectTest };
  const result = { sources: {} } as DetectedChecks;
  for (const name of CHECK_NAMES) {
    const fromConfig = configured(`${name}_command`);
    const command = fromConfig ?? detectors[name]();
    result[name] = command;
    result.sources[name] = fromConfig ? 'config' : command ? 'detected' : 'none';
  }
  return result;
}

export const checksDetect: QueryHandler = async (args, projectDir, workstream) => {
  const { positionals } = parseFlags(args, {});
  if (positionals.length > 0) throw invalid('checks.detect takes no arguments');
  const config = await loadConfig(projectDir, workstream);
  return { data: detectChecks(projectDir, config.workflow as unknown as Record<string, unknown>) };
};

function tailOf(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-TAIL_LINES).join('\n');
}

function killTree(child: ChildProcess): void {
  if (process.platform !== 'win32' && typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Fall through to killing the shell only.
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // Already exited.
  }
}

function runShellCommand(command: string, cwd: string, timeoutMs: number): Promise<{ exit: number | null; timedOut: boolean; tail: string; durationMs: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    let buffer = '';
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const append = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      if (buffer.length > TAIL_BYTES) buffer = buffer.slice(buffer.length - TAIL_BYTES);
    };
    const finish = (exit: number | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exit: timedOut ? null : exit, timedOut, tail: tailOf(buffer), durationMs: Date.now() - started });
    };
    let child: ChildProcess;
    try {
      child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      append(err instanceof Error ? err.message : String(err));
      finish(127);
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (err) => {
      append(`\n${err.message}\n`);
      finish(127);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function isFailure(result: { exit: number | null; timed_out: boolean; skipped: boolean }): boolean {
  return !result.skipped && (result.timed_out || result.exit !== 0);
}

async function withLock<T>(lockDir: string, fn: () => T): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let acquired = false;
    try {
      mkdirSync(lockDir);
      acquired = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let stale = false;
      try {
        stale = Date.now() - statSync(lockDir).mtimeMs > 60_000;
      } catch {
        stale = false;
      }
      if (stale) rmSync(lockDir, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (acquired) {
      try {
        return fn();
      } finally {
        rmSync(lockDir, { recursive: true, force: true });
      }
    }
  }
  throw new GSDError(`could not acquire ${lockDir}`, ErrorClassification.Execution);
}

/** Latest result per check name for a phase; {} when nothing has run. */
export function readLatestChecks(projectDir: string, padded: string): Record<string, LatestCheckEntry> {
  const dir = buildStateDir(projectDir, padded);
  if (!dir) return {};
  const parsed = readJson(join(dir, 'latest.json'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, LatestCheckEntry> : {};
}

export const buildRunChecks: QueryHandler = async (args, projectDir, workstream) => {
  const { flags, positionals } = parseFlags(args, { values: ['phase', 'set', 'label', 'only'] });
  if (positionals.length > 0) throw invalid(`unexpected argument: ${positionals[0]}`);
  if (typeof flags.phase !== 'string') throw invalid('--phase is required');
  const padded = normalizePhaseName(flags.phase.trim());
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(padded)) throw invalid(`invalid --phase: ${flags.phase}`);
  if (typeof flags.set !== 'string') throw invalid('--set is required');
  if (!Object.prototype.hasOwnProperty.call(CHECK_SETS, flags.set)) throw invalid('--set must be quick, wave or full');
  const set = flags.set as CheckSet;
  const label = typeof flags.label === 'string' ? flags.label : set;
  if (!LABEL_RE.test(label)) throw invalid(`invalid --label: ${label}`);
  let names = [...CHECK_SETS[set]];
  if (typeof flags.only === 'string') {
    const only = flags.only.split(',').map((item) => item.trim()).filter(Boolean);
    for (const name of only) {
      if (!(CHECK_NAMES as readonly string[]).includes(name)) throw invalid(`unknown check in --only: ${name}`);
    }
    names = names.filter((name) => only.includes(name));
    if (names.length === 0) throw invalid(`--only selects no checks from set ${set}`);
  }

  const stateDir = buildStateDir(projectDir, padded);
  if (!stateDir) return { data: { error: 'git_repository_required' } };

  const config = await loadConfig(projectDir, workstream);
  const workflow = config.workflow as unknown as Record<string, unknown>;
  const detected = detectChecks(projectDir, workflow);
  const timeoutRaw = workflow.build_check_timeout_seconds;
  const timeoutSeconds = typeof timeoutRaw === 'number' && Number.isInteger(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_SECONDS;
  const commit = headCommit(projectDir);
  const baselineRaw = label === 'baseline' ? null : readJson(join(stateDir, 'baseline.json'));
  const baselineResults = baselineRaw && Array.isArray((baselineRaw as RunChecksData).results) ? (baselineRaw as RunChecksData).results : [];

  const results: CheckResult[] = [];
  for (const name of names) {
    const command = detected[name];
    if (command === null) {
      results.push({ name, command: null, commit, exit: null, timed_out: false, skipped: true, duration_ms: 0, preexisting: false, output_tail: '' });
      continue;
    }
    const outcome = await runShellCommand(command, projectDir, timeoutSeconds * 1000);
    const current = { exit: outcome.exit, timed_out: outcome.timedOut, skipped: false };
    const preexisting = isFailure(current)
      && baselineResults.some((prior) => prior.name === name && prior.command === command && isFailure(prior));
    results.push({
      name,
      command,
      commit,
      exit: outcome.exit,
      timed_out: outcome.timedOut,
      skipped: false,
      duration_ms: outcome.durationMs,
      preexisting,
      output_tail: outcome.tail,
    });
  }

  const data: RunChecksData = { set, label, passed: results.every((r) => !isFailure(r)), results };
  writeJsonAtomic(join(stateDir, `${label}.json`), data);
  await withLock(join(stateDir, 'latest.lock'), () => {
    const latestPath = join(stateDir, 'latest.json');
    const existing = readJson(latestPath);
    const latest: Record<string, LatestCheckEntry> = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing as Record<string, LatestCheckEntry>
      : {};
    const at = new Date().toISOString();
    for (const r of results) {
      latest[r.name] = { command: r.command, commit: r.commit, exit: r.exit, timed_out: r.timed_out, skipped: r.skipped, passed: !r.skipped && !isFailure(r), at };
    }
    writeJsonAtomic(latestPath, latest);
  });
  return { data };
};
```

- [ ] **Step 5: Register the queries and regenerate aliases**

In `sdk/src/query/command-manifest.non-family.ts`, replace:

```ts
  { canonical: 'agent.classify-failure', aliases: ['agent classify-failure'], mutation: false, outputMode: 'json' },
] as const;
```

with:

```ts
  { canonical: 'agent.classify-failure', aliases: ['agent classify-failure'], mutation: false, outputMode: 'json' },

  { canonical: 'checks.detect', aliases: ['checks detect'], mutation: false, outputMode: 'json' },
  { canonical: 'build.run-checks', aliases: ['build run-checks'], mutation: false, outputMode: 'json' },
] as const;
```

In `sdk/src/query/command-static-catalog-domain.ts`, replace:

```ts
import { promptBudget } from './prompt-budget.js';
```

with:

```ts
import { promptBudget } from './prompt-budget.js';
import { checksDetect, buildRunChecks } from './build-checks.js';
```

and replace:

```ts
  ['prompt-budget', promptBudget],
] as const;
```

with:

```ts
  ['prompt-budget', promptBudget],
  // ── Build queries ──
  ['checks.detect', checksDetect],
  ['checks detect', checksDetect],
  ['build.run-checks', buildRunChecks],
  ['build run-checks', buildRunChecks],
] as const;
```

Regenerate and check:

```bash
(cd sdk && npx tsx scripts/gen-command-aliases.ts)
npm run check:alias-drift
```

Expected: the generator rewrites `sdk/src/query/command-aliases.generated.ts` and `get-shit-done/bin/lib/command-aliases.generated.cjs`, and the drift check exits 0.

- [ ] **Step 6: Switch the post-merge gate to `checks.detect`**

In `get-shit-done/workflows/execute-phase/steps/post-merge-gate.md`, replace the Step A detection block. It runs from the line `# Resolve build command: project config > Xcode > Makefile > language sniff` through the `fi` that closes `if [ -z "$BUILD_CMD" ]; then` (the lines just before `# Run build with 5-minute timeout`):

```bash
# Resolve build command: project config > Xcode > Makefile > language sniff
BUILD_CMD=$(fvgsd-sdk query config-get workflow.build_command --default "" 2>/dev/null || true)
if [ -z "$BUILD_CMD" ]; then
  XCODEPROJ=$(find . -maxdepth 2 -name "*.xcodeproj" -not -path "*/node_modules/*" 2>/dev/null | head -1)
  if [ -n "$XCODEPROJ" ]; then
    # Xcode project: get first scheme from xcodebuild -list -json
    XCODE_SCHEME=$(xcodebuild -list -json -project "$XCODEPROJ" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('project',{}).get('schemes',[None])[0] or '')" 2>/dev/null || true)
    if [ -n "$XCODE_SCHEME" ]; then
      BUILD_CMD="xcodebuild build -scheme '$XCODE_SCHEME' -destination 'platform=iOS Simulator,name=iPhone 16'"
    else
      BUILD_CMD="xcodebuild build -destination 'platform=iOS Simulator,name=iPhone 16'"
    fi
  elif [ -f "Makefile" ] && grep -q "^build:" Makefile; then
    BUILD_CMD="make build"
  elif [ -f "Justfile" ] || [ -f "justfile" ]; then
    BUILD_CMD="just build"
  elif [ -f "Cargo.toml" ]; then
    BUILD_CMD="cargo build"
  elif [ -f "go.mod" ]; then
    BUILD_CMD="go build ./..."
  elif [ -f "pyproject.toml" ] || [ -f "requirements.txt" ]; then
    BUILD_CMD="python -m py_compile $(find . -name '*.py' -not -path './.planning/*' -not -path './node_modules/*' | head -20 | tr '\n' ' ')"
  elif [ -f "package.json" ] && grep -q '"build"' package.json; then
    BUILD_CMD="npm run build"
  else
    BUILD_CMD=""
    echo "⚠ No build command detected — skipping build gate"
  fi
fi
```

with:

```bash
# Resolve build and test commands once: workflow.build_command / workflow.test_command win,
# otherwise checks.detect applies the Xcode > Makefile > language rules.
CHECKS_JSON=$(fvgsd-sdk query checks.detect 2>/dev/null || echo '{}')
BUILD_CMD=$(printf '%s' "$CHECKS_JSON" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{try{process.stdout.write(JSON.parse(s).build||"");}catch{}})')
if [ -z "$BUILD_CMD" ]; then
  echo "⚠ No build command detected — skipping build gate"
fi
```

Replace the Step B detection block. It runs from the line `# Resolve test command: project config > Xcode > Makefile > language sniff` through the `fi` that closes `if [ -z "$TEST_CMD" ]; then` (the lines just before `# Run test suite with 5-minute timeout`):

```bash
# Resolve test command: project config > Xcode > Makefile > language sniff
TEST_CMD=$(fvgsd-sdk query config-get workflow.test_command --default "" 2>/dev/null || true)
if [ -z "$TEST_CMD" ]; then
  XCODEPROJ=$(find . -maxdepth 2 -name "*.xcodeproj" -not -path "*/node_modules/*" 2>/dev/null | head -1)
  if [ -n "$XCODEPROJ" ]; then
    # Xcode project: reuse scheme detected above (or re-detect)
    if [ -z "${XCODE_SCHEME:-}" ]; then
      XCODE_SCHEME=$(xcodebuild -list -json -project "$XCODEPROJ" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('project',{}).get('schemes',[None])[0] or '')" 2>/dev/null || true)
    fi
    if [ -n "$XCODE_SCHEME" ]; then
      TEST_CMD="xcodebuild test -scheme '$XCODE_SCHEME' -destination 'platform=iOS Simulator,name=iPhone 16'"
    else
      TEST_CMD="xcodebuild test -destination 'platform=iOS Simulator,name=iPhone 16'"
    fi
  elif [ -f "Makefile" ] && grep -q "^test:" Makefile; then
    TEST_CMD="make test"
  elif [ -f "Justfile" ] || [ -f "justfile" ]; then
    TEST_CMD="just test"
  elif [ -f "package.json" ]; then
    TEST_CMD="npm test"
  elif [ -f "Cargo.toml" ]; then
    TEST_CMD="cargo test"
  elif [ -f "go.mod" ]; then
    TEST_CMD="go test ./..."
  elif [ -f "pyproject.toml" ] || [ -f "requirements.txt" ]; then
    TEST_CMD="python -m pytest -x -q --tb=short 2>&1 || uv run python -m pytest -x -q --tb=short"
  else
    TEST_CMD="true"
    echo "⚠ No test runner detected — skipping post-merge test gate"
  fi
fi
```

with:

```bash
# Test command from the same checks.detect result as Step A.
[ -n "${CHECKS_JSON:-}" ] || CHECKS_JSON=$(fvgsd-sdk query checks.detect 2>/dev/null || echo '{}')
TEST_CMD=$(printf '%s' "$CHECKS_JSON" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d;}).on("end",()=>{try{process.stdout.write(JSON.parse(s).test||"");}catch{}})')
if [ -z "$TEST_CMD" ]; then
  TEST_CMD="true"
  echo "⚠ No test runner detected — skipping post-merge test gate"
fi
```

Leave the timeout and exit handling below each block unchanged.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
(cd sdk && npx vitest run src/query/build-shared.test.ts src/query/build-checks.test.ts src/query/command-seam-coverage.test.ts)
(cd sdk && npx tsc --noEmit)
node --test tests/gsd-sdk-query-registry-integration.test.cjs tests/feat-3598-generator-correctness.test.cjs
```

Expected: all pass.

- [ ] **Step 8: Compare the root suite with the baseline**

```bash
npm test > "$WS/task-2-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-2-root.log"
```

Expected: `"newFailures": []`.

- [ ] **Step 9: Commit**

```bash
git add sdk/src/query/build-shared.ts sdk/src/query/build-shared.test.ts sdk/src/query/build-checks.ts sdk/src/query/build-checks.test.ts \
  sdk/src/query/command-manifest.non-family.ts sdk/src/query/command-static-catalog-domain.ts sdk/src/query/command-aliases.generated.ts \
  get-shit-done/bin/lib/command-aliases.generated.cjs get-shit-done/workflows/execute-phase/steps/post-merge-gate.md
git commit -m "feat(sdk): add checks.detect and build.run-checks"
```

---

### Task 3: `build.check-brief`, `build.waves`, brief format reference

**Files:**
- Create:
  - `sdk/src/query/build-brief.ts`
  - `get-shit-done/references/build-brief.md`
- Modify:
  - `sdk/src/query/build-shared.ts` (add `phaseRequirementIds`)
  - `sdk/src/query/command-manifest.non-family.ts`
  - `sdk/src/query/command-static-catalog-domain.ts`
  - generated alias files
  - `docs/INVENTORY.md`
  - `docs/INVENTORY-MANIFEST.json`
- Test:
  - `sdk/src/query/build-brief.test.ts`
  - `sdk/src/query/build-shared.test.ts` (append)

**Interfaces:**
- Consumes:
  - `parseFlags` from `build-shared.ts` (Task 2)
  - `roadmapGetPhase` from `sdk/src/query/roadmap.ts`
  - `extractFrontmatter` from `sdk/src/query/frontmatter.ts`
  - `FRONTMATTER_SCHEMAS` from `sdk/src/query/frontmatter-mutation.ts`
  - `extractPhaseToken` and `toPosixPath` from `sdk/src/query/helpers.ts`
- Produces:
  - `phaseRequirementIds` in `build-shared.ts`
  - every `build-brief.ts` name in the registry (`BriefSlice`, `BriefError`, `LoadedBrief`, `loadBrief`, `normalizeSlices`, `validateBrief`, `computeWaves`, `globToRegExp`, `fileMatchesGlob`, `globsOverlap`, `ownsOverlap`, `buildCheckBrief`, `buildWaves`)
  - the queries `build.check-brief` and `build.waves`

- [ ] **Step 1: Write the failing tests**

Append to `sdk/src/query/build-shared.test.ts`. Add `phaseRequirementIds` to the existing `./build-shared.js` import:

```ts
describe('phaseRequirementIds', () => {
  it('reads the IDs listed in the phase ROADMAP section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-reqs-'));
    await mkdir(join(dir, '.planning'), { recursive: true });
    await writeFile(join(dir, '.planning', 'ROADMAP.md'), [
      '# Roadmap', '', '## v1.0: Test', '',
      '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '**Requirements:** [AUTH-01, AUTH-02] AUTH-03', '',
      '### Phase 4: Billing', '', '**Requirements:** TBD', '',
    ].join('\n'));
    await writeFile(join(dir, '.planning', 'STATE.md'), ['---', 'milestone: v1.0', '---', '', '# State', ''].join('\n'));
    expect(await phaseRequirementIds(dir, '3')).toEqual(['AUTH-01', 'AUTH-02', 'AUTH-03']);
    expect(await phaseRequirementIds(dir, '03')).toEqual(['AUTH-01', 'AUTH-02', 'AUTH-03']);
    expect(await phaseRequirementIds(dir, '4')).toEqual([]);
    expect(await phaseRequirementIds(dir, '9')).toEqual([]);
    expect(await phaseRequirementIds(dir, '')).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when ROADMAP.md is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-reqs-none-'));
    expect(await phaseRequirementIds(dir, '3')).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});
```

Create `sdk/src/query/build-brief.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import {
  buildCheckBrief, buildWaves, computeWaves, fileMatchesGlob, globToRegExp, globsOverlap, ownsOverlap, type BriefSlice,
} from './build-brief.js';

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

const BRIEF = '.planning/phases/03-user-auth/03-01-PLAN.md';
const ROADMAP = [
  '# Roadmap', '', '## v1.0: Test', '',
  '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '**Requirements:** AUTH-01, AUTH-02', '',
].join('\n');

const HEAD = [
  'phase: 03-user-auth', 'plan: 01', 'type: execute', 'kind: brief', 'wave: 1', 'depends_on: []',
  'files_modified: [src/auth/session.ts]', 'autonomous: true', 'requirements: [AUTH-01, AUTH-02]',
  'user_setup: []', 'gap_closure: false',
  'must_haves:', '  truths:', '    - "A user can sign in"', '  artifacts: []', '  key_links: []',
];
const SLICES = [
  'slices:',
  '  - id: s1', '    goal: "Session model"', '    owns: ["src/auth/**"]', '    after: []', '    strong: false',
  '  - id: s2', '    goal: "Login routes"', '    owns: ["src/routes/auth/**"]', '    after: [s1]', '    strong: true',
];
const BODY = ['<objective>', 'Users can sign in.', '</objective>', '', '## Approach', 'Sessions first.'];

function briefText(frontmatter: string[] = [...HEAD, ...SLICES], body: string[] = BODY): string {
  return ['---', ...frontmatter, '---', '', ...body, ''].join('\n');
}

async function project(brief: string, roadmap = ROADMAP): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-brief-'));
  dirs.push(dir);
  await mkdir(join(dir, '.planning', 'phases', '03-user-auth'), { recursive: true });
  await writeFile(join(dir, '.planning', 'ROADMAP.md'), roadmap);
  await writeFile(join(dir, '.planning', 'STATE.md'), ['---', 'milestone: v1.0', '---', '', '# State', ''].join('\n'));
  await writeFile(join(dir, BRIEF), brief);
  return dir;
}

async function check(brief: string, roadmap?: string): Promise<{ valid: boolean; errors: Array<{ field: string; message: string }> }> {
  const dir = await project(brief, roadmap);
  return (await buildCheckBrief([BRIEF], dir)).data as { valid: boolean; errors: Array<{ field: string; message: string }> };
}

function slice(id: string, owns: string[], after: string[] = []): BriefSlice {
  return { id, goal: id, owns, after, strong: false };
}

describe('build.check-brief', () => {
  it('accepts a valid brief', async () => {
    expect(await check(briefText())).toEqual({ valid: true, errors: [] });
  });

  it('reports missing plan schema fields in schema order', async () => {
    const head = HEAD.filter((line) => !line.startsWith('wave:') && !line.startsWith('autonomous:'));
    const result = await check(briefText([...head, ...SLICES]));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.field)).toEqual(['wave', 'autonomous']);
  });

  it('requires kind: brief', async () => {
    const head = HEAD.map((line) => (line === 'kind: brief' ? 'kind: plan' : line));
    expect((await check(briefText([...head, ...SLICES]))).errors.map((e) => e.field)).toEqual(['kind']);
  });

  it('requires requirements only when the ROADMAP phase lists IDs', async () => {
    const head = HEAD.map((line) => (line.startsWith('requirements:') ? 'requirements: []' : line));
    expect((await check(briefText([...head, ...SLICES]))).errors.map((e) => e.field)).toEqual(['requirements']);
    const noIds = ROADMAP.replace('**Requirements:** AUTH-01, AUTH-02', '');
    expect((await check(briefText([...head, ...SLICES]), noIds)).valid).toBe(true);
  });

  it('reports a dependency cycle', async () => {
    const slices = SLICES.map((line) => (line === '    after: []' ? '    after: [s2]' : line));
    expect((await check(briefText([...HEAD, ...slices]))).errors).toEqual([
      { field: 'slices', message: 'dependency cycle: s1 -> s2 -> s1' },
    ]);
  });

  it('reports bad and duplicate ids, empty owns and unknown after ids', async () => {
    const slices = [
      'slices:',
      '  - id: s1', '    goal: "A"', '    owns: ["a/**"]', '    after: []',
      '  - id: s1', '    goal: "B"', '    owns: ["b/**"]', '    after: [s9]',
      '  - id: slice3', '    goal: "C"', '    owns: []', '    after: []',
    ];
    expect((await check(briefText([...HEAD, ...slices]))).errors.map((e) => e.field)).toEqual([
      'slices[1].id', 'slices[2].id', 'slices[2].owns', 'slices[1].after[0]',
    ]);
  });

  it('requires at least one slice and an objective block', async () => {
    expect((await check(briefText(HEAD))).errors.map((e) => e.field)).toEqual(['slices']);
    expect((await check(briefText(undefined, ['## Approach', 'No objective.']))).errors.map((e) => e.field)).toEqual(['objective']);
  });

  it('rejects missing arguments, missing files and paths outside the project', async () => {
    const dir = await project(briefText());
    await expect(buildCheckBrief([], dir)).rejects.toThrow(GSDError);
    await expect(buildCheckBrief(['../outside.md'], dir)).rejects.toThrow(GSDError);
    await expect(buildCheckBrief(['/etc/hosts'], dir)).rejects.toThrow(GSDError);
    await expect(buildCheckBrief(['.planning/phases/03-user-auth/missing.md'], dir)).rejects.toThrow(GSDError);
  });
});

describe('build.waves', () => {
  it('returns waves for a valid brief', async () => {
    const dir = await project(briefText());
    expect((await buildWaves([BRIEF], dir)).data).toEqual({ waves: [['s1'], ['s2']] });
  });

  it('refuses briefs whose slices are invalid', async () => {
    const slices = SLICES.map((line) => (line === '    after: []' ? '    after: [s2]' : line));
    const dir = await project(briefText([...HEAD, ...slices]));
    const data = (await buildWaves([BRIEF], dir)).data as { error: string; errors: Array<{ field: string }> };
    expect(data.error).toBe('invalid_brief');
    expect(data.errors.map((e) => e.field)).toEqual(['slices']);
  });
});

describe('computeWaves', () => {
  it('orders slices by dependencies', () => {
    expect(computeWaves([slice('s2', ['src/b/**'], ['s1']), slice('s1', ['src/a/**']), slice('s3', ['src/c/**'], ['s1'])]))
      .toEqual([['s1'], ['s2', 's3']]);
  });

  it('runs disjoint slices together, in numeric id order', () => {
    expect(computeWaves([slice('s10', ['x/**']), slice('s2', ['y/**'])])).toEqual([['s2', 's10']]);
  });

  it('splits overlapping owns across waves and moves dependents later', () => {
    expect(computeWaves([slice('s1', ['src/auth/**']), slice('s2', ['src/auth/session.ts']), slice('s3', ['docs/**'], ['s2'])]))
      .toEqual([['s1'], ['s2'], ['s3']]);
  });
});

describe('globs', () => {
  it.each([
    ['src/auth/**', 'src/auth/session.ts', true],
    ['src/auth/**', 'src/auth/deep/a.ts', true],
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/a/b/c.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
    ['migrations/*auth*.sql', 'migrations/001_auth_users.sql', true],
    ['app/{login,logout}/**', 'app/logout/page.tsx', true],
    ['app/{login,logout}/**', 'app/signup/page.tsx', false],
    ['file?.ts', 'file1.ts', true],
    ['[!a]x.ts', 'bx.ts', true],
    ['[!a]x.ts', 'ax.ts', false],
    ['./src/a.ts', 'src/a.ts', true],
    ['src\\win\\a.ts', 'src/win/a.ts', true],
    ['a.b', 'axb', false],
  ])('glob %s matches %s: %s', (glob, file, expected) => {
    expect(fileMatchesGlob(file, glob)).toBe(expected);
  });

  it.each([
    ['src/auth/**', 'src/auth/session.ts', true],
    ['src/auth/**', 'src/routes/**', false],
    ['src/**', 'src/auth/*.ts', true],
    ['src/a.ts', './src/a.ts', true],
    ['src/a.ts', 'src/b.ts', false],
    ['src/*/x.ts', 'src/a/**', true],
    ['lib/**', 'src/**', false],
  ])('globsOverlap(%s, %s) = %s in both directions', (a, b, expected) => {
    expect(globsOverlap(a, b)).toBe(expected);
    expect(globsOverlap(b, a)).toBe(expected);
  });

  it('checks every pair in ownsOverlap and treats unbalanced braces literally', () => {
    expect(ownsOverlap(['docs/**', 'src/a/**'], ['src/a/x.ts'])).toBe(true);
    expect(ownsOverlap(['docs/**'], ['src/**'])).toBe(false);
    expect(globToRegExp('a{b').test('a{b')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sdk && npx vitest run src/query/build-brief.test.ts src/query/build-shared.test.ts`
Expected: FAIL with `Failed to load url ./build-brief.js`, and `phaseRequirementIds is not a function` in `build-shared.test.ts`.

- [ ] **Step 3: Add `phaseRequirementIds` to `build-shared.ts`**

In `sdk/src/query/build-shared.ts`, replace:

```ts
import { findPhase } from './phase.js';
```

with:

```ts
import { findPhase } from './phase.js';
import { roadmapGetPhase } from './roadmap.js';
```

Append to the end of the file:

```ts
/** Requirement IDs from the phase's `**Requirements:**` ROADMAP line; [] when absent or TBD. */
export async function phaseRequirementIds(projectDir: string, phase: string, workstream?: string): Promise<string[]> {
  if (!phase || !phase.trim()) return [];
  let section: string | undefined;
  try {
    const result = await roadmapGetPhase([phase.trim()], projectDir, workstream);
    const data = result.data as Record<string, unknown>;
    section = typeof data.section === 'string' ? data.section : undefined;
  } catch {
    return [];
  }
  const match = section?.match(/^\*\*Requirements:?\*\*[^\S\n]*:?[^\S\n]*([^\n]*)$/m);
  if (!match) return [];
  const ids = match[1]
    .replace(/[[\]]/g, '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '' && item.toUpperCase() !== 'TBD');
  return [...new Set(ids)];
}
```

- [ ] **Step 4: Implement `build-brief.ts`**

Create `sdk/src/query/build-brief.ts`:

```ts
/**
 * Build brief queries — `build.check-brief` and `build.waves`.
 *
 * The brief is `{P}-{NN}-PLAN.md` with `kind: brief`. check-brief validates only the
 * fields code reads (spec "Brief"); waves orders slices by `after` and keeps slices
 * whose `owns` globs overlap out of the same wave.
 */

import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { extractFrontmatter } from './frontmatter.js';
import { FRONTMATTER_SCHEMAS } from './frontmatter-mutation.js';
import { extractPhaseToken, toPosixPath } from './helpers.js';
import { parseFlags, phaseRequirementIds } from './build-shared.js';
import type { QueryHandler } from './utils.js';

export interface BriefSlice { id: string; goal: string; owns: string[]; after: string[]; strong: boolean }
export interface BriefError { field: string; message: string }
export interface LoadedBrief { absPath: string; relPath: string; content: string; frontmatter: Record<string, unknown>; slices: BriefSlice[] }

const SLICE_ID_RE = /^s[0-9]+$/;
const GLOB_META = /[*?[{]/;

function invalid(message: string): GSDError {
  return new GSDError(message, ErrorClassification.Validation);
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Read and parse a brief inside the project. Throws GSDError(Validation) when missing or outside. */
export async function loadBrief(projectDir: string, briefPath: string): Promise<LoadedBrief> {
  if (typeof briefPath !== 'string' || briefPath.trim() === '' || briefPath.includes('\0')) throw invalid('brief path required');
  const root = resolve(projectDir);
  const absPath = isAbsolute(briefPath) ? resolve(briefPath) : resolve(root, briefPath);
  if (!isInside(root, absPath)) throw invalid(`brief path must be inside the project: ${briefPath}`);
  let content: string;
  let realFile: string;
  try {
    realFile = await realpath(absPath);
    content = await readFile(realFile, 'utf-8');
  } catch {
    throw invalid(`brief not found: ${briefPath}`);
  }
  if (!isInside(await realpath(root), realFile)) throw invalid(`brief path must be inside the project: ${briefPath}`);
  const frontmatter = extractFrontmatter(content);
  return { absPath, relPath: toPosixPath(relative(root, absPath)), content, frontmatter, slices: normalizeSlices(frontmatter) };
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter((item) => item !== '');
  if (typeof value === 'string' && value.trim() !== '' && value.trim() !== '[]') return [value.trim()];
  return [];
}

/** Tolerant slice normalization: missing `after` → [], `strong` "true" → true. */
export function normalizeSlices(frontmatter: Record<string, unknown>): BriefSlice[] {
  const raw = frontmatter.slices;
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const item = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    return {
      id: typeof item.id === 'string' ? item.id.trim() : '',
      goal: typeof item.goal === 'string' ? item.goal : '',
      owns: listOf(item.owns),
      after: listOf(item.after),
      strong: item.strong === true || item.strong === 'true',
    };
  });
}

function sliceNumber(id: string): number {
  const n = Number.parseInt(id.slice(1), 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

function compareSlices(a: BriefSlice, b: BriefSlice): number {
  return sliceNumber(a.id) - sliceNumber(b.id) || a.id.localeCompare(b.id);
}

function findCycle(slices: readonly BriefSlice[]): string[] | null {
  const byId = new Map(slices.map((s) => [s.id, s]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const mark = state.get(id);
    if (mark === 'done') return null;
    if (mark === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of byId.get(id)?.after ?? []) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const s of [...slices].sort(compareSlices)) {
    const cycle = visit(s.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Check the fields code reads. Nothing else about the brief is checked. */
export function validateBrief(brief: LoadedBrief, requirementIds: readonly string[]): BriefError[] {
  const errors: BriefError[] = [];
  const fm = brief.frontmatter;
  for (const key of FRONTMATTER_SCHEMAS.plan.required) {
    if (fm[key] === undefined || fm[key] === '') errors.push({ field: key, message: 'required' });
  }
  if (fm.kind !== 'brief') errors.push({ field: 'kind', message: 'must be "brief"' });
  if (requirementIds.length > 0 && listOf(Array.isArray(fm.requirements) ? fm.requirements : []).length === 0) {
    errors.push({ field: 'requirements', message: `must list the phase requirement IDs (${requirementIds.join(', ')})` });
  }

  const rawSlices = fm.slices;
  if (!Array.isArray(rawSlices) || rawSlices.length === 0) {
    errors.push({ field: 'slices', message: 'at least one slice is required' });
  } else {
    const ids = new Set<string>();
    rawSlices.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push({ field: `slices[${i}]`, message: 'must be a mapping with id, goal, owns and after' });
        return;
      }
      const item = entry as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!SLICE_ID_RE.test(id)) errors.push({ field: `slices[${i}].id`, message: 'must match ^s[0-9]+$' });
      else if (ids.has(id)) errors.push({ field: `slices[${i}].id`, message: `duplicate slice id ${id}` });
      else ids.add(id);
      const owns = item.owns;
      if (!Array.isArray(owns) || owns.length === 0 || owns.some((glob) => typeof glob !== 'string' || glob.trim() === '')) {
        errors.push({ field: `slices[${i}].owns`, message: 'must list at least one non-empty glob' });
      }
    });
    brief.slices.forEach((s, i) => {
      s.after.forEach((dep, j) => {
        if (!ids.has(dep)) errors.push({ field: `slices[${i}].after[${j}]`, message: `unknown slice ${dep}` });
      });
    });
    const cycle = findCycle(brief.slices.filter((s) => ids.has(s.id)));
    if (cycle) errors.push({ field: 'slices', message: `dependency cycle: ${cycle.join(' -> ')}` });
  }

  const body = brief.content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  if (!/<objective>[\s\S]*?<\/objective>/.test(body)) errors.push({ field: 'objective', message: '<objective> block is required' });
  return errors;
}

/** Ordered waves: a slice runs after its `after` slices; overlapping `owns` never share a wave. */
export function computeWaves(slices: readonly BriefSlice[]): string[][] {
  const byId = new Map(slices.map((s) => [s.id, s]));
  const indegree = new Map<string, number>(slices.map((s) => [s.id, 0]));
  const dependents = new Map<string, string[]>(slices.map((s) => [s.id, []]));
  for (const s of slices) {
    for (const dep of new Set(s.after)) {
      if (!byId.has(dep)) continue;
      indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
      dependents.get(dep)!.push(s.id);
    }
  }
  const ready = slices.filter((s) => indegree.get(s.id) === 0).sort(compareSlices);
  const waveOf = new Map<string, number>();
  const waves: string[][] = [];
  while (ready.length > 0) {
    const current = ready.shift()!;
    let wave = 0;
    for (const dep of current.after) {
      const depWave = waveOf.get(dep);
      if (depWave !== undefined) wave = Math.max(wave, depWave + 1);
    }
    while ((waves[wave] ?? []).some((otherId) => ownsOverlap(byId.get(otherId)!.owns, current.owns))) wave += 1;
    waveOf.set(current.id, wave);
    (waves[wave] ??= []).push(current.id);
    for (const next of dependents.get(current.id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) {
        ready.push(byId.get(next)!);
        ready.sort(compareSlices);
      }
    }
  }
  if (waveOf.size !== slices.length) throw invalid('brief slices contain a dependency cycle');
  return waves.filter((w) => Array.isArray(w) && w.length > 0);
}

function normalizePattern(pattern: string): string {
  let value = pattern.trim().replace(/\\/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  return value.replace(/\/{2,}/g, '/');
}

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Glob to RegExp: `**` (any segments), `*`, `?`, `[..]` / `[!..]`, `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
  const g = normalizePattern(glob);
  let re = '';
  let braces = 0;
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      const atSegmentStart = i === 0 || g[i - 1] === '/';
      if (g[i + 1] === '*' && atSegmentStart && g[i + 2] === '/') {
        re += '(?:[^/]*/)*';
        i += 2;
      } else if (g[i + 1] === '*' && atSegmentStart && i + 2 === g.length) {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
        if (g[i + 1] === '*') i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const close = g.indexOf(']', i + 1);
      if (close === -1) {
        re += '\\[';
        continue;
      }
      let body = g.slice(i + 1, close);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      re += `[${body.replace(/\\/g, '\\\\')}]`;
      i = close;
    } else if (c === '{') {
      braces += 1;
      re += '(?:';
    } else if (c === '}' && braces > 0) {
      braces -= 1;
      re += ')';
    } else if (c === ',' && braces > 0) {
      re += '|';
    } else {
      re += escapeLiteral(c);
    }
  }
  if (braces > 0) return new RegExp(`^${escapeLiteral(g)}$`);
  return new RegExp(`^${re}$`);
}

export function fileMatchesGlob(file: string, glob: string): boolean {
  return globToRegExp(glob).test(normalizePattern(file));
}

function literalPrefix(glob: string): string[] {
  const segments = normalizePattern(glob).split('/').filter(Boolean);
  const index = segments.findIndex((segment) => GLOB_META.test(segment));
  return index === -1 ? segments : segments.slice(0, index);
}

/** Conservative overlap test: may report overlap that doesn't exist, never misses a literal match. */
export function globsOverlap(a: string, b: string): boolean {
  const aGlob = GLOB_META.test(a);
  const bGlob = GLOB_META.test(b);
  if (!aGlob && !bGlob) return normalizePattern(a) === normalizePattern(b);
  if (!aGlob) return fileMatchesGlob(a, b);
  if (!bGlob) return fileMatchesGlob(b, a);
  const pa = literalPrefix(a);
  const pb = literalPrefix(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    if (pa[i] !== pb[i]) return false;
  }
  return true;
}

export function ownsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((x) => b.some((y) => globsOverlap(x, y)));
}

function briefPathArg(args: readonly string[], usage: string): string {
  const { positionals } = parseFlags(args, {});
  if (positionals.length !== 1) throw invalid(usage);
  return positionals[0];
}

export const buildCheckBrief: QueryHandler = async (args, projectDir, workstream) => {
  const brief = await loadBrief(projectDir, briefPathArg(args, 'usage: build.check-brief <path>'));
  const phaseValue = typeof brief.frontmatter.phase === 'string' ? brief.frontmatter.phase : '';
  const requirementIds = phaseValue ? await phaseRequirementIds(projectDir, extractPhaseToken(phaseValue), workstream) : [];
  const errors = validateBrief(brief, requirementIds);
  return { data: { valid: errors.length === 0, errors } };
};

export const buildWaves: QueryHandler = async (args, projectDir) => {
  const brief = await loadBrief(projectDir, briefPathArg(args, 'usage: build.waves <path>'));
  const errors = validateBrief(brief, []).filter((e) => e.field === 'slices' || e.field.startsWith('slices['));
  if (errors.length > 0) return { data: { error: 'invalid_brief', errors } };
  return { data: { waves: computeWaves(brief.slices) } };
};
```

- [ ] **Step 5: Register the queries and regenerate aliases**

In `sdk/src/query/command-manifest.non-family.ts`, replace:

```ts
  { canonical: 'build.run-checks', aliases: ['build run-checks'], mutation: false, outputMode: 'json' },
```

with:

```ts
  { canonical: 'build.run-checks', aliases: ['build run-checks'], mutation: false, outputMode: 'json' },
  { canonical: 'build.check-brief', aliases: ['build check-brief'], mutation: false, outputMode: 'json' },
  { canonical: 'build.waves', aliases: ['build waves'], mutation: false, outputMode: 'json' },
```

In `sdk/src/query/command-static-catalog-domain.ts`, replace:

```ts
import { checksDetect, buildRunChecks } from './build-checks.js';
```

with:

```ts
import { checksDetect, buildRunChecks } from './build-checks.js';
import { buildCheckBrief, buildWaves } from './build-brief.js';
```

and replace:

```ts
  ['build run-checks', buildRunChecks],
```

with:

```ts
  ['build run-checks', buildRunChecks],
  ['build.check-brief', buildCheckBrief],
  ['build check-brief', buildCheckBrief],
  ['build.waves', buildWaves],
  ['build waves', buildWaves],
```

Run:

```bash
(cd sdk && npx tsx scripts/gen-command-aliases.ts)
npm run check:alias-drift
```

Expected: the drift check exits 0.

- [ ] **Step 6: Write the brief format reference and its inventory row**

Create `get-shit-done/references/build-brief.md`:

````markdown
# Build Brief Format

The build brief is `{P}-{NN}-PLAN.md` in the phase folder. It keeps the PLAN file name, so status checks, routing and the plan index treat it as a plan. Code reads everything in its frontmatter.

## Frontmatter

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

- `slices[].owns`: globs for the files the slice changes (`**`, `*`, `?`, `[..]`, `{a,b}`). Write directories as `dir/**`. Slices whose globs overlap never build in the same wave.
- `slices[].after`: ids of slices that must finish first. Order slices that share an interface this way.
- `slices[].strong`: `true` for a slice that needs the stronger model.
- `user_setup`: steps only the user can take (accounts, secrets, hardware). They are asked before building.
- `requirements`: every requirement ID from the phase's ROADMAP section.

## Body

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

## What `build.check-brief` checks

`fvgsd-sdk query build.check-brief <path>` returns `{ "valid": bool, "errors": [{ "field": "slices[1].after[0]", "message": "…" }] }` and checks only:

- the plan frontmatter fields `phase`, `plan`, `type`, `wave`, `depends_on`, `files_modified`, `autonomous` and `must_haves`
- `kind: brief`
- `requirements` is non-empty when the phase's ROADMAP section lists requirement IDs
- `slices` has at least one entry; ids match `^s[0-9]+$` and are unique; every `after` id exists; there are no cycles; `owns` is non-empty
- an `<objective>` block is present

Fix any errors in the same turn. Nothing else about the brief is checked. `fvgsd-sdk query build.waves <path>` then turns the slices into ordered waves.

## Gap briefs

A `--gaps` build writes the next free plan number with:
- `gap_closure: true`
- `depends_on: ["{P}-{previous NN}"]`
- `wave` set to the previous brief's wave plus one

Its slices cover only the gaps listed in `{P}-VERIFICATION.md`.
````

In `docs/INVENTORY.md`, replace:

```markdown
## References (61 shipped)
```

with:

```markdown
## References (62 shipped)
```

Directly after the `verify-mvp-mode.md` row, the last row of the Workflow References table, insert:

```markdown
| `build-brief.md` | Build brief format: frontmatter read by code, body sections, and the fields `build.check-brief` validates. |
```

In the `few-shot-examples` note below the references tables, replace:

```markdown
> **Subdirectory:** `get-shit-done/references/few-shot-examples/` contains additional few-shot examples (`plan-checker.md`, `verifier.md`) that are referenced from specific agents. These are not counted in the 61 top-level references.
```

with:

```markdown
> **Subdirectory:** `get-shit-done/references/few-shot-examples/` contains additional few-shot examples (`plan-checker.md`, `verifier.md`) that are referenced from specific agents. These are not counted in the 62 top-level references.
```

Regenerate the manifest: `node scripts/gen-inventory-manifest.cjs --write`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
(cd sdk && npx vitest run src/query/build-brief.test.ts src/query/build-shared.test.ts src/query/command-seam-coverage.test.ts)
(cd sdk && npx tsc --noEmit)
node --test tests/inventory-counts.test.cjs tests/inventory-manifest-sync.test.cjs tests/gsd-sdk-query-registry-integration.test.cjs tests/feat-3598-generator-correctness.test.cjs
node scripts/gen-inventory-manifest.cjs --check
```

Expected: all pass.

- [ ] **Step 8: Compare the root suite with the baseline**

```bash
npm test > "$WS/task-3-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-3-root.log"
```

Expected: `"newFailures": []`.

- [ ] **Step 9: Commit**

```bash
git add sdk/src/query/build-brief.ts sdk/src/query/build-brief.test.ts sdk/src/query/build-shared.ts sdk/src/query/build-shared.test.ts \
  sdk/src/query/command-manifest.non-family.ts sdk/src/query/command-static-catalog-domain.ts sdk/src/query/command-aliases.generated.ts \
  get-shit-done/bin/lib/command-aliases.generated.cjs get-shit-done/references/build-brief.md docs/INVENTORY.md docs/INVENTORY-MANIFEST.json
git commit -m "feat(sdk): add build.check-brief and build.waves"
```

---

### Task 4: `fvgsd-builder` agent, verifier build mode, model row and installer

**Files:**
- Create: `agents/fvgsd-builder.md`
- Modify: `agents/fvgsd-verifier.md` (new `<build_mode>` section after `</mvp_mode_verification>`)
- Modify: `sdk/shared/model-catalog.json`
- Modify: `bin/install.js` (`stripUnsupportedAgentKeys`, the agent install loop, `CODEX_AGENT_SANDBOX`, exports)
- Modify: `tests/codex-config.test.cjs`
- Modify: `get-shit-done/references/model-profiles.md`, `docs/CONFIGURATION.md`, `docs/AGENTS.md`, `docs/INVENTORY.md`
- Regenerate: `docs/INVENTORY-MANIFEST.json`
- Test: `tests/fvgsd-builder-agent.test.cjs`

**Interfaces:**
- Consumes:
  - `fvgsd-sdk query build.check-brief <path>` (Task 3) and `fvgsd-sdk query build.run-checks --phase <P> --set quick --label quick-<slice>` (Task 2)
  - `fvgsd-sdk query commit`
  - the registry's Prompt contracts
- Produces:
  - agent `fvgsd-builder` with brief and slice modes, returning `## BRIEF RESULT` and `## SLICE RESULT`
  - a `<build_mode>` section in `fvgsd-verifier`
  - `stripUnsupportedAgentKeys(content: string, runtime: string): string`, exported from `bin/install.js`
  - catalog row `fvgsd-builder`: quality opus, balanced sonnet, budget sonnet, adaptive sonnet

Docs in this task must not contain the literal `/fvgsd-build` token: `tests/docs-parity-live-registry.test.cjs` requires every `/fvgsd-*` token in `docs/` to name an existing command, and the command arrives in Task 10.

- [ ] **Step 1: Write the failing test**

Create `tests/fvgsd-builder-agent.test.cjs`:

```js
// allow-test-rule: source-text-is-the-product
// agents/fvgsd-builder.md is loaded verbatim by every runtime; its frontmatter
// and result headings are the deployed contract the build workflow parses.

'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('./helpers.cjs');
const {
  stripUnsupportedAgentKeys,
  convertClaudeToGeminiAgent,
  convertClaudeToOpencodeFrontmatter,
  convertClaudeToKiloFrontmatter,
  CODEX_AGENT_SANDBOX,
} = require('../bin/install.js');
const { catalog, MODEL_PROFILES } = require('../get-shit-done/bin/lib/model-catalog.cjs');

const BUILDER_PATH = path.join(__dirname, '..', 'agents', 'fvgsd-builder.md');

function readBuilder() {
  return fs.readFileSync(BUILDER_PATH, 'utf8');
}

function headings(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());
}

describe('fvgsd-builder agent file', () => {
  test('frontmatter names the builder, its tools and its effort', () => {
    const fm = parseFrontmatter(readBuilder());
    assert.equal(fm.name, 'fvgsd-builder');
    assert.equal(fm.description, 'Writes the build brief for a phase, or builds one slice of it, for /fvgsd-build.');
    assert.equal(fm.tools, 'Read, Write, Edit, Bash, Grep, Glob');
    assert.equal(fm.effort, 'high');
  });

  test('stays within the 10KB builder budget', () => {
    const size = fs.statSync(BUILDER_PATH).size;
    assert.ok(size <= 10 * 1024, `fvgsd-builder.md is ${size} bytes`);
  });

  test('declares both result headings the build workflow parses', () => {
    const found = headings(readBuilder());
    assert.ok(found.includes('BRIEF RESULT'), 'missing ## BRIEF RESULT');
    assert.ok(found.includes('SLICE RESULT'), 'missing ## SLICE RESULT');
  });
});

describe('agent frontmatter keys per runtime', () => {
  test('stripUnsupportedAgentKeys keeps effort only for Claude Code', () => {
    const content = readBuilder();
    assert.equal(parseFrontmatter(stripUnsupportedAgentKeys(content, 'claude')).effort, 'high');
    for (const runtime of ['gemini', 'opencode', 'kilo', 'qwen', 'hermes', 'codex']) {
      const fm = parseFrontmatter(stripUnsupportedAgentKeys(content, runtime));
      assert.equal(Object.hasOwn(fm, 'effort'), false, `${runtime} kept effort`);
      assert.equal(fm.name, 'fvgsd-builder', `${runtime} lost name`);
    }
  });

  test('gemini, opencode and kilo converters emit no effort key', () => {
    const outputs = [
      convertClaudeToGeminiAgent(stripUnsupportedAgentKeys(readBuilder(), 'gemini')),
      convertClaudeToOpencodeFrontmatter(stripUnsupportedAgentKeys(readBuilder(), 'opencode'), { isAgent: true }),
      convertClaudeToKiloFrontmatter(stripUnsupportedAgentKeys(readBuilder(), 'kilo'), { isAgent: true }),
    ];
    for (const output of outputs) {
      assert.equal(Object.hasOwn(parseFrontmatter(output), 'effort'), false);
    }
  });

  test('content without frontmatter is returned unchanged', () => {
    assert.equal(stripUnsupportedAgentKeys('no frontmatter here', 'gemini'), 'no frontmatter here');
  });

  test('Codex runs the builder with workspace-write', () => {
    assert.equal(CODEX_AGENT_SANDBOX['fvgsd-builder'], 'workspace-write');
  });
});

describe('fvgsd-builder model profile', () => {
  test('uses the executor tiers in the execution phase', () => {
    assert.deepEqual(catalog.agents['fvgsd-builder'], {
      golden: 'opus',
      balanced: 'sonnet',
      budget: 'sonnet',
      phaseType: 'execution',
      routingTier: 'standard',
    });
    assert.equal(MODEL_PROFILES['fvgsd-builder'].balanced, 'sonnet');
    assert.equal(MODEL_PROFILES['fvgsd-builder'].adaptive, 'sonnet');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/fvgsd-builder-agent.test.cjs`
Expected: FAIL, with `ENOENT` for `agents/fvgsd-builder.md` and `stripUnsupportedAgentKeys is not a function`.

- [ ] **Step 3: Create the builder agent**

Create `agents/fvgsd-builder.md`:

````markdown
---
name: fvgsd-builder
description: Writes the build brief for a phase, or builds one slice of it, for /fvgsd-build.
tools: Read, Write, Edit, Bash, Grep, Glob
color: green
effort: high
# hooks:
#   PostToolUse:
#     - matcher: "Write|Edit"
#       hooks:
#         - type: command
#           command: "npx eslint --fix $FILE 2>/dev/null || true"
---

<role>
You are the fvgsd builder. The build workflow spawns you in one of two modes:

- **brief** — write the phase's build brief (`{P}-{NN}-PLAN.md`) and commit it.
- **slice** — build one slice of that brief, check it, and commit it.

The lead passes paths in a `<build_inputs>` block. Read the files yourself. You never spawn agents.

**ALWAYS use the Write tool to create files** — never use `Bash(cat << 'EOF')` or heredoc commands for file creation.
</role>

<inputs>
`<build_inputs>` holds `key: value` lines:

| Key | Meaning |
|---|---|
| `mode` | `brief` or `slice` |
| `phase_dir` | Phase folder, for example `.planning/phases/03-user-auth` |
| `brief` | Brief path, `{phase_dir}/{P}-{NN}-PLAN.md` |
| `slice`, `goal`, `owns` | Slice id, goal and owned globs (slice mode) |
| `base_commit` | Commit the slice starts from |
| `context`, `research`, `milestone_brief`, `roadmap`, `requirements`, `requirement_ids` | Phase inputs; `research` and `milestone_brief` may be empty |
| `commands_json` | `{ "build", "typecheck", "lint", "test" }`; `null` means that check is skipped |
| `continue_to_slice` | `true`: after a one-slice brief with no `user_setup`, build `s1` in this same run |
| `gaps`, `verification` | `gaps: true`: write a gap brief for the gaps listed in `verification`, the VERIFICATION.md path (optional) |
| `brief_errors_json` | Brief retry: the `build.check-brief` errors to fix (optional) |
| `fix_goal`, `fix_problems_json` | Fix round: what to fix, and the problems as JSON (optional) |
| `merge_from`, `other_slice_notes`, `worktree_path` | Merge conflict: branch to merge in, the other slice's notes, and the worktree holding your slice branch (optional) |
| `known_failures` | Check failures that already existed before this slice (optional) |

`{P}` is the padded phase number at the start of the `phase_dir` folder name (for example `03`).
Read `./CLAUDE.md` and project skills (`.claude/skills/`, `.agents/skills/`) when they exist, and follow them.
</inputs>

<brief_mode>
**Retry** (`brief_errors_json` is set): the brief already exists. Fix exactly the `build.check-brief` errors listed there, change nothing else, and continue at step 3.

1. Read `~/.claude/fvgsd/references/build-brief.md`, then every input file, then the code the phase will touch.
2. Write the brief with the Write tool. Aim for 100–200 lines:
   - Frontmatter exactly as the reference shows: `kind: brief`, `slices`, `must_haves`, and `requirements` listing every id in `requirement_ids`.
   - Slices are vertical: each one delivers something testable on its own. Order slices that share a contract with `after`, and mark hard slices `strong: true`.
   - Slices whose `owns` globs overlap must be ordered with `after`.
   - The Decisions table lists every `D-XX` from the CONTEXT `<decisions>` block, with where it lands or why it is deferred.
   - Put interfaces that slices share in Approach, so slices agree without talking to each other.
   - Anything the user must do first (accounts, secrets, hardware) goes in `user_setup`.
   - **Gap brief** (`gaps: true`): read `verification`. Set `gap_closure: true`, `depends_on: ["{P}-{previous NN}"]` naming the latest earlier brief in `phase_dir`, and `wave` to that brief's wave plus one. Slices cover only the gaps listed in `verification`.
3. Run `fvgsd-sdk query build.check-brief <brief>`. Fix every reported error and run it again until `valid` is `true`.
4. Commit: `fvgsd-sdk query commit "docs({P}): build brief" --files <brief>`.
5. Return:

```text
## BRIEF RESULT
brief: .planning/phases/03-user-auth/03-01-PLAN.md
slices: [s1, s2, s3]
user_setup: []
```

Go straight on to slice mode for `s1` only when `continue_to_slice: true`, the brief you wrote has exactly one slice, and its `user_setup` is empty. The slice's goal and `owns` come from the brief, and `base_commit` is the brief commit; return the SLICE RESULT after the BRIEF RESULT. Otherwise stop after the BRIEF RESULT.
</brief_mode>

<slice_mode>
**Worktree check.** Run this first, and only when you run in an isolated worktree (`.git` is a file, not a directory):

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "HEAD" ] || echo "$BRANCH" | grep -Eq '^(main|master|develop|trunk|release/.*)$'; then
  echo "BLOCKED: worktree HEAD is '$BRANCH'"
  exit 1
fi
if [ "$(git merge-base HEAD "$BASE_COMMIT")" != "$(git rev-parse "$BASE_COMMIT")" ]; then
  git reset --hard "$BASE_COMMIT"
fi
```

`BASE_COMMIT` is the `base_commit` input. If the first check fails, return `status: blocked` with the reason in `question`.

**Build the slice:**
1. Read the brief's Approach and your slice section, the CONTEXT decisions, and the code under `owns`.
2. Implement the slice goal. Keep edits inside `owns`. When a change outside `owns` is unavoidable, keep it minimal and list those files in `outside_owned_files`.
3. Add or update tests for the behavior you built.
4. Run checks whenever you want feedback, and always before committing:
   - `fvgsd-sdk query build.run-checks --phase {P} --set quick --label quick-{slice}` (typecheck and lint)
   - the tests relevant to this slice: the `test` command from `commands_json`, narrowed to your files with a path or name filter
   Failures listed in `known_failures`, or marked `preexisting: true`, are not yours. Every other failure must be fixed before you report `done`.
5. Commit once: stage explicit paths (`git add -- <files>`), then `git commit -m "feat({P}-{slice}): <goal>"`. A slice ends with exactly one `feat` commit.
6. If you must stop early, commit the work so far as `chore({P}-{slice}): partial — <reason>` and return `status: partial`.
7. If a decision only the user can make blocks you, commit any partial work, put the question in `question`, and return `status: blocked`.

**Fix goal** (`fix_goal` is set): fix the problems in `fix_problems_json`. Rerun the checks those problems name, plus the quick checks. Commit each logical fix as `fix({P}-{slice}): <what>`.

**Merge goal** (`merge_from` is set): work inside `worktree_path`. Run `git merge <merge_from>` and resolve the conflicts using `other_slice_notes` and your own slice goal. Run the quick checks, then commit `fix({P}-{slice}): resolve merge with <other slice id>`.
</slice_mode>

<git_rules>
- Never pass `--no-verify`; hooks run on every commit.
- Never run `git stash`, `git push`, `git branch -D`, `git worktree remove`, `git clean`, or `git reset --hard` (except the base correction above).
- Never edit `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, the summary or VERIFICATION.md. Edit the brief only in brief mode. The lead owns the rest.
- Stage explicit paths only; never `git add -A` or `git add .`.
</git_rules>

<slice_result>
Return exactly:

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

Fill `branch` (`git rev-parse --abbrev-ref HEAD`) and `worktree_path` (`git rev-parse --show-toplevel`) only when you ran in an isolated worktree.
</slice_result>
````

- [ ] **Step 4: Add the verifier build mode**

In `agents/fvgsd-verifier.md`, find this line:

```markdown
</mvp_mode_verification>
```

and insert this block directly after it (before the blank line that precedes `<output>`):

````markdown

<build_mode>

## Build Mode

This section applies only when your prompt contains a `<build_mode>` block. That block holds `key: value` lines: `brief`, `verification_path`, `human_uat_path`, `human_checks` (`defer` or `block`), `checks_json`, `stubs_json`, `slice_results`, `diff_stat`, `changed_files`, `context`, `roadmap`, `requirement_ids`, `recheck_gaps`.

It changes the standard process as follows:

1. **Must-haves:** take `must_haves` (truths, artifacts, key_links) from the brief's frontmatter. There are no other PLAN files to read.
2. **Checks:** the checks have already run, so do not rerun the full test suite. `checks_json` is the full `build.run-checks` result:
   - a failing result with `preexisting: false` is a gap
   - list `preexisting: true` failures in the report, but don't make them gaps
   - you may run targeted probes: one test file, one endpoint, one CLI call
3. **Stubs:** every `stubs_json` finding is a gap, unless the surrounding code shows it is tracked work.
4. **Coverage:** check every CONTEXT `<decisions>` entry, every ROADMAP success criterion, and every id in `requirement_ids` against the changed code (`changed_files`, `diff_stat`).
5. **Report:** write `verification_path` in the VERIFICATION.md format from `<output>` (frontmatter `phase`, `verified`, `status`, `score`, plus `gaps`).
6. **Human-only checks** (visual or manual flows) go to `human_uat_path`:

   ```markdown
   ---
   status: partial
   phase: {phase_num}-{phase_name}
   source: [{phase_num}-VERIFICATION.md]
   started: [now ISO]
   updated: [now ISO]
   ---

   ## Current Test

   [awaiting human testing]

   ## Tests

   ### {N}. {item description}
   expected: {expected behavior}
   result: [pending]

   ## Summary

   total: {count}
   passed: 0
   issues: 0
   pending: {count}
   skipped: 0
   blocked: 0

   ## Gaps
   ```

   With `human_checks: defer`, these items do not change `status` (Step 9 rule 2 does not apply). With `human_checks: block`, set `status: human_needed` when any exist.
7. **Recheck:** when `recheck_gaps` lists gaps, re-verify only those gaps and whatever the fix commits touched. Then rewrite `verification_path` with the updated status, score and remaining gaps.
8. **Do not commit.** The lead commits both files through `build.finalize`.

</build_mode>
````

- [ ] **Step 5: Add the model catalog row**

In `sdk/shared/model-catalog.json`, find:

```json
    "fvgsd-executor":               { "golden": "opus",   "balanced": "sonnet", "budget": "sonnet", "phaseType": "execution",    "routingTier": "standard" },
```

and insert directly after it:

```json
    "fvgsd-builder":                { "golden": "opus",   "balanced": "sonnet", "budget": "sonnet", "phaseType": "execution",    "routingTier": "standard" },
```

- [ ] **Step 6: Update the installer**

In `bin/install.js`, make four edits.

**Edit 1 — the new function.** Insert this directly before the line `function convertClaudeToGeminiAgent(content) {`:

```js
// Agent frontmatter keys only Claude Code reads. Other runtimes ignore them or
// reject the agent file (Gemini CLI validates agent frontmatter), so they are
// removed before any runtime conversion.
const CLAUDE_ONLY_AGENT_KEYS = ['effort'];

function stripUnsupportedAgentKeys(content, runtime) {
  if (runtime === 'claude' || typeof content !== 'string' || !content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  const frontmatter = content
    .slice(0, end)
    .split('\n')
    .filter((line) => !CLAUDE_ONLY_AGENT_KEYS.some((key) => line.startsWith(`${key}:`)))
    .join('\n');
  return frontmatter + content.slice(end);
}

```

**Edit 2 — the agent install loop.** Replace:

```js
        content = processAttribution(content, getCommitAttribution(runtime));
        // Convert frontmatter for runtime compatibility (agents need different handling)
        if (isOpencode) {
```

with:

```js
        content = processAttribution(content, getCommitAttribution(runtime));
        content = stripUnsupportedAgentKeys(content, runtime);
        // Convert frontmatter for runtime compatibility (agents need different handling)
        if (isOpencode) {
```

**Edit 3 — the Codex sandbox.** Replace:

```js
  'fvgsd-debugger': 'workspace-write',
  'fvgsd-plan-checker': 'read-only',
```

with:

```js
  'fvgsd-debugger': 'workspace-write',
  'fvgsd-builder': 'workspace-write',
  'fvgsd-plan-checker': 'read-only',
```

**Edit 4 — the exports.** In the `module.exports` object, replace:

```js
    convertClaudeToGeminiAgent,
    convertClaudeAgentToCodexAgent,
```

with:

```js
    convertClaudeToGeminiAgent,
    stripUnsupportedAgentKeys,
    convertClaudeAgentToCodexAgent,
```

- [ ] **Step 7: Update the Codex sandbox test**

In `tests/codex-config.test.cjs`, replace:

```js
  test('has all 11 agents mapped', () => {
    const agentNames = Object.keys(CODEX_AGENT_SANDBOX);
    assert.strictEqual(agentNames.length, 11, 'has 11 agents');
  });

  test('workspace-write agents have write tools', () => {
    const writeAgents = [
      'fvgsd-executor', 'fvgsd-planner', 'fvgsd-phase-researcher',
      'fvgsd-project-researcher', 'fvgsd-research-synthesizer', 'fvgsd-verifier',
      'fvgsd-codebase-mapper', 'fvgsd-roadmapper', 'fvgsd-debugger',
    ];
```

with:

```js
  test('has all 12 agents mapped', () => {
    const agentNames = Object.keys(CODEX_AGENT_SANDBOX);
    assert.strictEqual(agentNames.length, 12, 'has 12 agents');
  });

  test('workspace-write agents have write tools', () => {
    const writeAgents = [
      'fvgsd-executor', 'fvgsd-planner', 'fvgsd-phase-researcher',
      'fvgsd-project-researcher', 'fvgsd-research-synthesizer', 'fvgsd-verifier',
      'fvgsd-codebase-mapper', 'fvgsd-roadmapper', 'fvgsd-debugger', 'fvgsd-builder',
    ];
```

- [ ] **Step 8: Update the model and agent docs**

**`get-shit-done/references/model-profiles.md`** — three edits:

1. After the row `| fvgsd-executor | opus | sonnet | sonnet | sonnet | inherit |`, insert:

   ```markdown
   | fvgsd-builder | opus | sonnet | sonnet | sonnet | inherit |
   ```

2. Replace `` | `execution` | fvgsd-executor, fvgsd-debugger, fvgsd-doc-writer | `` with:

   ```markdown
   | `execution` | fvgsd-executor, fvgsd-builder, fvgsd-debugger, fvgsd-doc-writer |
   ```

3. In the row that starts `` | `standard` | fvgsd-executor, fvgsd-phase-researcher, ``, replace `fvgsd-executor, fvgsd-phase-researcher,` with `fvgsd-executor, fvgsd-builder, fvgsd-phase-researcher,`.

**`docs/CONFIGURATION.md`** — four edits:

1. After the row `| fvgsd-executor | Opus | Sonnet | Sonnet | Inherit |`, insert:

   ```markdown
   | fvgsd-builder | Opus | Sonnet | Sonnet | Inherit |
   ```

2. Replace `> **All 33 shipped agents have explicit per-profile tier assignments**` with `> **All 34 shipped agents have explicit per-profile tier assignments**`.

3. Replace `` | `execution` | `fvgsd-executor`, `fvgsd-debugger`, `fvgsd-doc-writer` | `` with:

   ```markdown
   | `execution` | `fvgsd-executor`, `fvgsd-builder`, `fvgsd-debugger`, `fvgsd-doc-writer` |
   ```

4. In the agent default tiers table, in the row that starts `` | `standard` | fvgsd-advisor-researcher, fvgsd-ai-researcher, ``, replace `fvgsd-advisor-researcher, fvgsd-ai-researcher, fvgsd-code-fixer,` with `fvgsd-advisor-researcher, fvgsd-ai-researcher, fvgsd-builder, fvgsd-code-fixer,`.

**`docs/AGENTS.md`** — five edits:

1. Replace `plus concise stubs for 12 advanced/specialized agents (33 shipped agents total)` with `plus concise stubs for 13 advanced/specialized agents (34 shipped agents total)`.
2. Replace `Twelve additional shipped agents (pattern-mapper,` with `Thirteen additional shipped agents (builder, pattern-mapper,`.
3. Replace `For the authoritative 33-agent roster` with `For the authoritative 34-agent roster`.
4. Replace `Twelve additional agents ship under` with `Thirteen additional agents ship under`, and `The 12 advanced/specialized agents listed above` with `The 13 advanced/specialized agents listed above`.
5. Insert this stub directly before the line `### fvgsd-pattern-mapper`:

   ```markdown
   ### fvgsd-builder

   **Role:** Writes a phase's build brief, or builds one slice of it, for the plan-and-execute build workflow (`get-shit-done/workflows/build.md`).

   | Property | Value |
   |----------|-------|
   | **Spawned by** | The build workflow (brief mode once per build; slice mode once per slice, fix group or merge conflict) |
   | **Parallelism** | One per slice within a wave, in isolated worktrees where the runtime supports it |
   | **Tools** | Read, Write, Edit, Bash, Grep, Glob |
   | **Model (balanced)** | Sonnet (brief mode and `strong` slices use the planning-tier model) |
   | **Color** | Green |
   | **Produces** | `{phase}-{N}-PLAN.md` with `kind: brief`, or one `feat({phase}-{slice})` commit per slice |

   **Key behaviors:**
   - Checks its own brief with `build.check-brief` and commits it
   - Runs `build.run-checks --set quick --label quick-{slice}` plus slice-relevant tests before its one `feat` commit
   - Never edits STATE.md, ROADMAP.md, REQUIREMENTS.md, the summary or VERIFICATION.md

   ---

   ```

**`docs/INVENTORY.md`** — two edits:

1. Replace `## Agents (33 shipped)` with `## Agents (34 shipped)`.
2. Insert this row directly before the row that starts `| fvgsd-pattern-mapper |`:

   ```markdown
   | fvgsd-builder | Writes the build brief for a phase, or builds one slice of it (brief and slice modes). | `build.md` workflow | advanced stub |
   ```

Regenerate the inventory manifest:

```bash
node scripts/gen-inventory-manifest.cjs --write
```

- [ ] **Step 9: Run the tests**

Run:

```bash
node --test tests/fvgsd-builder-agent.test.cjs tests/model-profiles.test.cjs tests/agent-frontmatter.test.cjs tests/agent-size-budget.test.cjs tests/codex-config.test.cjs tests/inventory-counts.test.cjs tests/inventory-manifest-sync.test.cjs tests/agents-doc-parity.test.cjs tests/gsd-sdk-query-registry-integration.test.cjs tests/agent-install-validation.test.cjs tests/docs-parity-live-registry.test.cjs tests/bug-3677-agent-colon-namespace-leak.test.cjs
```

Expected: PASS.
- `agent-frontmatter` finds the anti-heredoc sentence, the `# hooks:` comment and the required `color:` key.
- `agent-size-budget` keeps the builder under 500 lines and the verifier under its LARGE budget of 1000.
- `gsd-sdk-query-registry-integration` resolves `build.check-brief`, `build.run-checks` and `commit`.

Then run the root suite compare from "Verification" with `<N>` = `4`. Expected: `"newFailures": []`.

- [ ] **Step 10: Commit**

```bash
git add agents/fvgsd-builder.md agents/fvgsd-verifier.md sdk/shared/model-catalog.json bin/install.js tests/codex-config.test.cjs tests/fvgsd-builder-agent.test.cjs get-shit-done/references/model-profiles.md docs/CONFIGURATION.md docs/AGENTS.md docs/INVENTORY.md docs/INVENTORY-MANIFEST.json
git commit -m "feat(build): add fvgsd-builder agent and verifier build mode"
```

---

### Task 5: Shared debt-marker scan and `build.scan-stubs`

**Files:**
- Create: `sdk/src/debt-markers.ts`, `sdk/src/query/build-stubs.ts`
- Modify: `sdk/src/phase-runner.ts`
- Modify: `sdk/src/query/build-shared.ts` (append)
- Modify: `sdk/src/query/command-manifest.non-family.ts`, `sdk/src/query/command-static-catalog-domain.ts`
- Regenerate: `sdk/src/query/command-aliases.generated.ts`, `get-shit-done/bin/lib/command-aliases.generated.cjs`
- Test: `sdk/src/debt-markers.test.ts`, `sdk/src/query/build-stubs.test.ts`

**Interfaces:**
- Consumes: `parseFlags` and `runGit` from `sdk/src/query/build-shared.ts` (Task 2).
- Produces:
  - `DebtMarkerFinding`, `isDebtScannable(file)`, `hasFormalDebtReference(text)` and `findDebtMarkers(file, content)` from `sdk/src/debt-markers.ts`
  - `ChangedFile`, `changedFilesSince(projectDir, base): ChangedFile[]` and `codeHead(projectDir): string | null` (first-parent history) in `build-shared.ts`
  - query `build.scan-stubs --base <commit>`, which returns `[{ file, line, marker }]`

- [ ] **Step 1: Write the failing tests**

Create `sdk/src/debt-markers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findDebtMarkers, hasFormalDebtReference, isDebtScannable } from './debt-markers.js';

describe('findDebtMarkers', () => {
  it('reports unresolved markers with file, line, upper-case marker and trimmed text', () => {
    expect(findDebtMarkers('src/a.ts', 'const a = 1;\n  // FIXME: hash passwords  \n')).toEqual([
      { file: 'src/a.ts', line: 2, marker: 'FIXME', text: '// FIXME: hash passwords' },
    ]);
  });

  it('matches lowercase markers and markers followed by punctuation', () => {
    expect(findDebtMarkers('a.ts', '// fixme: lowercase\n// TBD.').map((f) => [f.line, f.marker])).toEqual([
      [1, 'FIXME'],
      [2, 'TBD'],
    ]);
  });

  it('ignores dotted and embedded words', () => {
    expect(findDebtMarkers('a.ts', 'const note = "xxx.yyy";\nconst prefix = "TBDX";')).toEqual([]);
  });

  it('allows markers that cite tracked work after the marker', () => {
    const content = ['// FIXME #123 tracked', '// TBD see DEF-AUTH-7', '// XXX: pr 42 follow-up', '// FIXME later, then issue #9'].join('\n');
    expect(findDebtMarkers('a.ts', content)).toEqual([]);
  });

  it('does not let earlier issue text excuse a later marker', () => {
    expect(findDebtMarkers('a.ts', '// issue #9 earlier then FIXME later').map((f) => f.marker)).toEqual(['FIXME']);
  });

  it('reports one finding per line and handles CRLF', () => {
    expect(findDebtMarkers('a.ts', '// FIXME and TBD on one line')).toHaveLength(1);
    expect(findDebtMarkers('a.ts', 'ok\r\n// XXX: crlf\r\n').map((f) => f.line)).toEqual([2]);
  });
});

describe('hasFormalDebtReference', () => {
  it('recognizes DEF ids, issue and PR numbers, and #N after whitespace', () => {
    expect(hasFormalDebtReference('DEF-12')).toBe(true);
    expect(hasFormalDebtReference('see issue 42')).toBe(true);
    expect(hasFormalDebtReference('pull request #7')).toBe(true);
    expect(hasFormalDebtReference('tracked in #88')).toBe(true);
    expect(hasFormalDebtReference('"#12"')).toBe(false);
    expect(hasFormalDebtReference('no reference')).toBe(false);
  });
});

describe('isDebtScannable', () => {
  it('skips markdown files', () => {
    expect(isDebtScannable('README.md')).toBe(false);
    expect(isDebtScannable('docs/guide.MARKDOWN')).toBe(false);
    expect(isDebtScannable('src/app.ts')).toBe(true);
  });
});
```

Create `sdk/src/query/build-stubs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildScanStubs } from './build-stubs.js';
import { changedFilesSince, codeHead } from './build-shared.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', message);
}

let dir: string;
let base: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-stubs-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await mkdir(join(dir, 'src'), { recursive: true });
  await mkdir(join(dir, '.planning'), { recursive: true });
  await writeFile(join(dir, 'src', 'old.ts'), 'export const old = 1;\n');
  await writeFile(join(dir, 'src', 'gone.ts'), '// FIXME: remove this file\n');
  await writeFile(join(dir, 'src', 'move.ts'), 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n');
  commitAll(dir, 'base');
  base = git(dir, 'rev-parse', 'HEAD');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('build.scan-stubs', () => {
  it('reports markers only in files changed since the base', async () => {
    await writeFile(join(dir, 'src', 'session.ts'), 'export const a = 1;\n// FIXME: hash passwords\n');
    commitAll(dir, 'session');
    const { data } = await buildScanStubs(['--base', base], dir);
    expect(data).toEqual([{ file: 'src/session.ts', line: 2, marker: 'FIXME' }]);
  });

  it('ignores markdown, .planning, deleted files and markers that cite tracked work', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'notes.md'), 'TBD: write docs\n');
    await writeFile(join(dir, '.planning', 'tool.ts'), '// FIXME in planning\n');
    await writeFile(join(dir, 'src', 'ok.ts'), '// FIXME #123 tracked\n');
    await rm(join(dir, 'src', 'gone.ts'));
    commitAll(dir, 'changes');
    const { data } = await buildScanStubs(['--base', base], dir);
    expect(data).toEqual([]);
  });

  it('rejects a missing or unknown base', async () => {
    await expect(buildScanStubs([], dir)).rejects.toThrow(GSDError);
    await expect(buildScanStubs(['--base', 'not-a-commit'], dir)).rejects.toThrow(GSDError);
  });
});

describe('changedFilesSince and codeHead', () => {
  it('reports added, modified, deleted and renamed paths outside .planning', async () => {
    await writeFile(join(dir, 'src', 'new.ts'), 'export const n = 1;\n');
    await writeFile(join(dir, 'src', 'old.ts'), 'export const old = 2;\n');
    await rm(join(dir, 'src', 'gone.ts'));
    git(dir, 'mv', 'src/move.ts', 'src/moved.ts');
    await writeFile(join(dir, '.planning', 'STATE.md'), '# State\n');
    commitAll(dir, 'mixed changes');
    const changes = changedFilesSince(dir, base).sort((a, b) => a.path.localeCompare(b.path));
    expect(changes).toEqual([
      { status: 'D', path: 'src/gone.ts' },
      { status: 'R', path: 'src/moved.ts' },
      { status: 'A', path: 'src/new.ts' },
      { status: 'M', path: 'src/old.ts' },
    ]);
  });

  it('codeHead ignores commits that only touch .planning', async () => {
    await writeFile(join(dir, 'src', 'code.ts'), 'export const x = 1;\n');
    commitAll(dir, 'code');
    const codeCommit = git(dir, 'rev-parse', 'HEAD');
    await writeFile(join(dir, '.planning', 'STATE.md'), '# State\n');
    commitAll(dir, 'docs only');
    expect(codeHead(dir)).toBe(codeCommit);
  });

  it('codeHead returns the merge commit after a --no-ff merge', async () => {
    const main = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    git(dir, 'checkout', '-q', '-b', 'slice');
    await writeFile(join(dir, 'src', 'slice.ts'), 'export const s = 1;\n');
    commitAll(dir, 'feat(03-s1): slice');
    git(dir, 'checkout', '-q', main);
    git(dir, 'merge', '-q', '--no-ff', '-m', 'chore(03-s1): merge slice branch', 'slice');
    expect(codeHead(dir)).toBe(git(dir, 'rev-parse', 'HEAD'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sdk && npx vitest run src/debt-markers.test.ts src/query/build-stubs.test.ts`
Expected: FAIL, with `Failed to load url ./debt-markers.js` and `./build-stubs.js`, and `changedFilesSince` not exported.

- [ ] **Step 3: Create the shared marker module**

Create `sdk/src/debt-markers.ts`:

```ts
/**
 * Debt-marker scan shared by the phase runner's architectural-debt gate and
 * the build.scan-stubs query.
 *
 * A TBD/FIXME/XXX marker is allowed only when the text after it on the same
 * line references tracked follow-up work (issue/PR number or DEF-* id).
 */

export interface DebtMarkerFinding {
  file: string;
  line: number;
  marker: string;
  text: string;
}

const MARKER_PATTERN = /(?:^|[^\w.])(TBD|FIXME|XXX)(?=\b(?:\.(?:\s|$)|[^\w.]|$))/i;

export function isDebtScannable(file: string): boolean {
  return !/\.(md|markdown)$/i.test(file);
}

export function hasFormalDebtReference(text: string): boolean {
  return /\bDEF-[A-Z0-9-]+\b/i.test(text)
    || /\b(?:issue|issues|pr|pull request)\s+#?\d+\b/i.test(text)
    || /(?:^|\s)#\d+\b/.test(text);
}

export function findDebtMarkers(file: string, content: string): DebtMarkerFinding[] {
  const findings: DebtMarkerFinding[] = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const match = MARKER_PATTERN.exec(line);
    if (!match) return;
    if (hasFormalDebtReference(line.slice(match.index))) return;
    findings.push({ file, line: index + 1, marker: match[1].toUpperCase(), text: line.trim() });
  });
  return findings;
}
```

- [ ] **Step 4: Point PhaseRunner at the shared module**

In `sdk/src/phase-runner.ts`, make four edits.

1. After `import { checkResearchGate } from './research-gate.js';`, add:

   ```ts
   import { isDebtScannable, findDebtMarkers, type DebtMarkerFinding } from './debt-markers.js';
   ```

2. Replace:

   ```ts
   interface ArchitecturalDebtFinding {
     file: string;
     line: number;
     marker: string;
     text: string;
   }
   ```

   with:

   ```ts
   type ArchitecturalDebtFinding = DebtMarkerFinding;
   ```

3. In `checkArchitecturalDebt`, replace `if (this.shouldScanForArchitecturalDebt(file)) {` with `if (isDebtScannable(file)) {`, and replace `findings.push(...this.findUnresolvedDebtMarkers(file, content));` with `findings.push(...findDebtMarkers(file, content));`.

4. Delete this block (it sits directly before `private resolveProjectPath`):

   ```ts
     private shouldScanForArchitecturalDebt(file: string): boolean {
       return !/\.(md|markdown)$/i.test(file);
     }

     private findUnresolvedDebtMarkers(file: string, content: string): ArchitecturalDebtFinding[] {
       const findings: ArchitecturalDebtFinding[] = [];
       const markerPattern = /(?:^|[^\w.])(TBD|FIXME|XXX)(?=\b(?:\.(?:\s|$)|[^\w.]|$))/i;
       const lines = content.split(/\r?\n/);

       lines.forEach((line, index) => {
         const match = markerPattern.exec(line);
         if (match) {
           const markerSegment = line.slice(match.index);
           if (this.hasFormalDebtReference(markerSegment)) return;

           findings.push({
             file,
             line: index + 1,
             marker: match[1].toUpperCase(),
             text: line.trim(),
           });
         }
       });

       return findings;
     }

     private hasFormalDebtReference(line: string): boolean {
       return /\bDEF-[A-Z0-9-]+\b/i.test(line) || /\b(?:issue|issues|pr|pull request)\s+#?\d+\b/i.test(line) || /(?:^|\s)#\d+\b/.test(line);
     }

   ```

- [ ] **Step 5: Add the git change helpers**

Append to the end of `sdk/src/query/build-shared.ts`:

```ts
// ─── Changed files (Task 5) ─────────────────────────────────────────────────

export interface ChangedFile {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  path: string;
}

/**
 * Files changed between `base` and HEAD, relative to the project directory,
 * excluding `.planning/`. Renames and copies report the new path.
 */
export function changedFilesSince(projectDir: string, base: string): ChangedFile[] {
  const result = runGit(projectDir, [
    'diff', '--name-status', '-z', '--find-renames', '--relative', `${base}..HEAD`, '--', '.', ':(exclude).planning',
  ]);
  if (!result.ok || result.stdout === '') return [];
  const parts = result.stdout.split('\0');
  if (parts[parts.length - 1] === '') parts.pop();
  const changes: ChangedFile[] = [];
  let index = 0;
  while (index < parts.length) {
    const letter = (parts[index] ?? '').charAt(0);
    index += 1;
    if (letter === 'R' || letter === 'C') {
      index += 1; // skip the old path
      const path = parts[index];
      index += 1;
      if (path) changes.push({ status: letter, path });
    } else {
      const path = parts[index];
      index += 1;
      if (path && (letter === 'A' || letter === 'M' || letter === 'D' || letter === 'T')) {
        changes.push({ status: letter, path });
      }
    }
  }
  return changes;
}

/**
 * Latest commit on the first-parent line that changed files outside `.planning/`, or null.
 * `--first-parent` makes a `--no-ff` slice merge count as the change, instead of the
 * slice commit that history simplification would otherwise follow.
 */
export function codeHead(projectDir: string): string | null {
  const result = runGit(projectDir, ['log', '-1', '--first-parent', '--format=%H', '--', '.', ':(exclude).planning']);
  return result.ok && /^[0-9a-f]{40,64}$/.test(result.stdout) ? result.stdout : null;
}
```

- [ ] **Step 6: Create the query**

Create `sdk/src/query/build-stubs.ts`:

```ts
/**
 * build.scan-stubs — debt markers (TBD/FIXME/XXX) in files changed since a
 * base commit. Deleted files, markdown and `.planning/` are skipped.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { findDebtMarkers, isDebtScannable } from '../debt-markers.js';
import { changedFilesSince, parseFlags, runGit } from './build-shared.js';
import type { QueryHandler } from './utils.js';

export const buildScanStubs: QueryHandler = async (args, projectDir) => {
  const { flags, positionals } = parseFlags(args, { values: ['base'] });
  if (positionals.length > 0) {
    throw new GSDError(`unexpected argument: ${positionals[0]}`, ErrorClassification.Validation);
  }
  if (typeof flags.base !== 'string') {
    throw new GSDError('--base <commit> is required', ErrorClassification.Validation);
  }
  const verified = runGit(projectDir, ['rev-parse', '--verify', '--quiet', `${flags.base}^{commit}`]);
  if (!verified.ok) {
    throw new GSDError(`--base does not name a commit: ${flags.base}`, ErrorClassification.Validation);
  }

  const root = resolve(projectDir);
  const findings: Array<{ file: string; line: number; marker: string }> = [];
  for (const change of changedFilesSince(projectDir, verified.stdout)) {
    if (change.status === 'D' || !isDebtScannable(change.path)) continue;
    const absolute = resolve(root, change.path);
    const rel = relative(root, absolute);
    if (rel.startsWith('..') || isAbsolute(rel)) continue;
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    for (const finding of findDebtMarkers(change.path, readFileSync(absolute, 'utf-8'))) {
      findings.push({ file: finding.file, line: finding.line, marker: finding.marker });
    }
  }
  return { data: findings };
};
```

- [ ] **Step 7: Register the query and regenerate aliases**

In `sdk/src/query/command-manifest.non-family.ts`, insert directly before `  { canonical: 'agent.classify-failure', aliases: ['agent classify-failure'], mutation: false, outputMode: 'json' },`:

```ts
  { canonical: 'build.scan-stubs', aliases: ['build scan-stubs'], mutation: false, outputMode: 'json' },
```

In `sdk/src/query/command-static-catalog-domain.ts`:

1. After `import { promptBudget } from './prompt-budget.js';`, add:

   ```ts
   import { buildScanStubs } from './build-stubs.js';
   ```

2. After `  ['prompt-budget', promptBudget],`, add:

   ```ts
     ['build.scan-stubs', buildScanStubs],
     ['build scan-stubs', buildScanStubs],
   ```

Then run:

```bash
(cd sdk && npx tsx scripts/gen-command-aliases.ts)
npm run check:alias-drift
```

Expected: the generator rewrites both alias files, and `check:alias-drift` exits 0.

- [ ] **Step 8: Run the tests**

Run:

```bash
(cd sdk && npm run build && npx vitest run src/debt-markers.test.ts src/query/build-stubs.test.ts src/phase-runner.test.ts src/query/command-seam-coverage.test.ts src/query/registry-assembly.test.ts)
node --test tests/feat-3598-generator-correctness.test.cjs tests/gsd-sdk-query-registry-integration.test.cjs
```

Expected: PASS. `tsc` compiles, and the phase-runner debt-marker tests pass unchanged.

Then run the root suite compare from "Verification" with `<N>` = `5`. Expected: `"newFailures": []`.

- [ ] **Step 9: Commit**

```bash
git add sdk/src/debt-markers.ts sdk/src/debt-markers.test.ts sdk/src/query/build-stubs.ts sdk/src/query/build-stubs.test.ts sdk/src/query/build-shared.ts sdk/src/phase-runner.ts sdk/src/query/command-manifest.non-family.ts sdk/src/query/command-static-catalog-domain.ts sdk/src/query/command-aliases.generated.ts get-shit-done/bin/lib/command-aliases.generated.cjs
git commit -m "feat(build): add build.scan-stubs over files changed since a base commit"
```

---

### Task 6: `build.merge-wave`

**Files:**
- Create: `sdk/src/query/build-merge.ts`
- Modify: `sdk/src/query/command-manifest.non-family.ts`, `sdk/src/query/command-static-catalog-domain.ts`
- Regenerate: `sdk/src/query/command-aliases.generated.ts`, `get-shit-done/bin/lib/command-aliases.generated.cjs`
- Test: `sdk/src/query/build-merge.integration.test.ts`

**Interfaces:**
- Consumes: `parseFlags` and `runGit` from `sdk/src/query/build-shared.ts` (Task 2); `normalizePhaseName` from `sdk/src/query/helpers.ts`.
- Produces: `MergeWaveData` and query `build.merge-wave --phase <P> --base <commit> (--results <json> | --results-file <path>)` (mutation).
  - It merges each finished, isolated slice branch with `--no-ff`, in numeric slice-id order.
  - It aborts conflicting merges, leaving the tree clean, and reports conflict and deletion paths unquoted (`git -c core.quotepath=off`), so non-ASCII names stay readable. A branch passes the base check when `--base` is an ancestor of its merge base with HEAD, so a conflict-resolved branch merges when the lead reruns it with the same wave base.
  - It removes merged worktrees and their branches.
  - Result shape: `{ merged, conflicts, blocked, skipped, cleaned }`.

- [ ] **Step 1: Write the failing integration test**

Create `sdk/src/query/build-merge.integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildMergeWave, type MergeWaveData } from './build-merge.js';

interface SliceInput { slice: string; status: string; branch: string; worktree_path: string; commits: string[] }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function initRepo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  git(dir, 'init', '-q');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'config', 'user.email', 'test@test.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(dir, 'shared.txt'), 'line one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return git(dir, 'rev-parse', 'HEAD');
}

async function addSlice(repo: string, root: string, slice: string, file: string, content: string): Promise<SliceInput> {
  const branch = `worktree-agent-${slice}`;
  const worktree = join(root, `wt-${slice}`);
  git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
  await writeFile(join(worktree, file), content);
  git(worktree, 'add', '--', file);
  git(worktree, 'commit', '-q', '-m', `feat(03-${slice}): ${file}`);
  return { slice, status: 'done', branch, worktree_path: worktree, commits: [git(worktree, 'rev-parse', 'HEAD')] };
}

async function merge(cwd: string, base: string, results: unknown): Promise<MergeWaveData> {
  const { data } = await buildMergeWave(['--phase', '3', '--base', base, '--results', JSON.stringify(results)], cwd);
  return data as MergeWaveData;
}

let root: string;
let repo: string;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fvgsd-merge-wave-'));
  repo = join(root, 'repo');
  base = await initRepo(repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('build.merge-wave', () => {
  it('merges disjoint slices in slice order and removes their worktrees and branches', async () => {
    const s1 = await addSlice(repo, root, 's1', 'a.txt', 'a\n');
    const s2 = await addSlice(repo, root, 's2', 'b.txt', 'b\n');
    const data = await merge(repo, base, [s2, s1]);
    expect(data).toEqual({ merged: ['s1', 's2'], conflicts: [], blocked: [], skipped: [], cleaned: [s1.worktree_path, s2.worktree_path] });
    expect(existsSync(s1.worktree_path)).toBe(false);
    expect(existsSync(s2.worktree_path)).toBe(false);
    expect(git(repo, 'branch', '--list', 'worktree-agent-*')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('chore(03-s2): merge slice branch');
  });

  it('aborts a conflicting merge, keeps the tree clean and leaves that worktree in place', async () => {
    const s1 = await addSlice(repo, root, 's1', 'shared.txt', 'from s1\n');
    const s2 = await addSlice(repo, root, 's2', 'shared.txt', 'from s2\n');
    const data = await merge(repo, base, [s1, s2]);
    expect(data.merged).toEqual(['s1']);
    expect(data.conflicts).toEqual([{ slice: 's2', files: ['shared.txt'] }]);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(existsSync(s2.worktree_path)).toBe(true);
  });

  it('reports non-ASCII conflict paths unquoted', async () => {
    await writeFile(join(repo, 'café.txt'), 'base\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'accented file');
    const accentedBase = git(repo, 'rev-parse', 'HEAD');
    const s1 = await addSlice(repo, root, 's1', 'café.txt', 'from s1\n');
    const s2 = await addSlice(repo, root, 's2', 'café.txt', 'from s2\n');
    const data = await merge(repo, accentedBase, [s1, s2]);
    expect(data.merged).toEqual(['s1']);
    expect(data.conflicts).toEqual([{ slice: 's2', files: ['café.txt'] }]);
  });

  it('merges a conflicting slice on the retry after its branch merges the current branch in', async () => {
    const s1 = await addSlice(repo, root, 's1', 'shared.txt', 'from s1\n');
    const s2 = await addSlice(repo, root, 's2', 'shared.txt', 'from s2\n');
    expect((await merge(repo, base, [s1, s2])).conflicts.map((entry) => entry.slice)).toEqual(['s2']);
    expect(() => git(s2.worktree_path, 'merge', '-q', '--no-edit', 'main')).toThrow();
    await writeFile(join(s2.worktree_path, 'shared.txt'), 'from s1 and s2\n');
    git(s2.worktree_path, 'add', '--', 'shared.txt');
    git(s2.worktree_path, 'commit', '-q', '-m', 'fix(03-s2): resolve merge with s1');
    const data = await merge(repo, base, [s2]);
    expect(data).toEqual({ merged: ['s2'], conflicts: [], blocked: [], skipped: [], cleaned: [s2.worktree_path] });
    expect(git(repo, 'show', 'HEAD:shared.txt')).toBe('from s1 and s2');
  });

  it('works when the project is itself a linked worktree of another repository', async () => {
    const candidate = join(root, 'candidate');
    git(repo, 'worktree', 'add', '-q', '-b', 'candidate-branch', candidate, 'HEAD');
    const candidateBase = git(candidate, 'rev-parse', 'HEAD');
    const s1 = await addSlice(candidate, root, 's1', 'c.txt', 'c\n');
    const data = await merge(candidate, candidateBase, [s1]);
    expect(data.merged).toEqual(['s1']);
    expect(data.cleaned).toEqual([s1.worktree_path]);
    expect(git(candidate, 'log', '-1', '--format=%s')).toBe('chore(03-s1): merge slice branch');
    expect(git(candidate, 'status', '--porcelain')).toBe('');
  });

  it('blocks a dirty slice worktree and a slice that did not start from the base', async () => {
    const dirty = await addSlice(repo, root, 's1', 'a.txt', 'a\n');
    await writeFile(join(dirty.worktree_path, 'scratch.txt'), 'uncommitted\n');
    const dirtyData = await merge(repo, base, [dirty]);
    expect(dirtyData.blocked.map((entry) => [entry.slice, entry.reason])).toEqual([['s1', 'worktree_dirty']]);
    expect(dirtyData.merged).toEqual([]);

    const s2 = await addSlice(repo, root, 's2', 'b.txt', 'b\n');
    await writeFile(join(repo, 'later.txt'), 'later\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'later');
    const later = git(repo, 'rev-parse', 'HEAD');
    const baseData = await merge(repo, later, [s2]);
    expect(baseData.blocked.map((entry) => [entry.slice, entry.reason])).toEqual([['s2', 'base_mismatch']]);
  });

  it('blocks a slice that deletes more than five files outside .planning', async () => {
    for (let i = 1; i <= 6; i += 1) await writeFile(join(repo, `f${i}.txt`), `${i}\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'six files');
    const wideBase = git(repo, 'rev-parse', 'HEAD');
    const branch = 'worktree-agent-s1';
    const worktree = join(root, 'wt-s1');
    git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'HEAD');
    git(worktree, 'rm', '-q', 'f1.txt', 'f2.txt', 'f3.txt', 'f4.txt', 'f5.txt', 'f6.txt');
    git(worktree, 'commit', '-q', '-m', 'feat(03-s1): remove files');
    const data = await merge(repo, wideBase, [{ slice: 's1', status: 'done', branch, worktree_path: worktree }]);
    expect(data.blocked.map((entry) => entry.reason)).toEqual(['bulk_deletions']);
    expect(data.merged).toEqual([]);
  });

  it('skips unfinished or non-isolated slices and blocks protected or malformed branches without running them', async () => {
    const data = await merge(repo, base, [
      { slice: 's1', status: 'partial', branch: 'worktree-agent-s1', worktree_path: '' },
      { slice: 's2', status: 'done', branch: '', worktree_path: '' },
      { slice: 's3', status: 'done', branch: 'main', worktree_path: '' },
      { slice: 's4', status: 'done', branch: 'worktree-agent-x;touch pwned', worktree_path: '' },
    ]);
    expect(data.skipped).toEqual([{ slice: 's1', reason: 'not_done' }, { slice: 's2', reason: 'not_isolated' }]);
    expect(data.blocked.map((entry) => [entry.slice, entry.reason])).toEqual([['s3', 'protected_branch'], ['s4', 'invalid_branch']]);
    expect(existsSync(join(repo, 'pwned'))).toBe(false);
    expect(existsSync(join(root, 'pwned'))).toBe(false);
  });

  it('reads results from --results-file', async () => {
    const s1 = await addSlice(repo, root, 's1', 'a.txt', 'a\n');
    const resultsFile = join(root, 'results.json');
    await writeFile(resultsFile, JSON.stringify([s1]));
    const { data } = await buildMergeWave(['--phase', '3', '--base', base, '--results-file', resultsFile], repo);
    expect((data as MergeWaveData).merged).toEqual(['s1']);
  });

  it('refuses to merge into a main tree with uncommitted tracked changes', async () => {
    const s1 = await addSlice(repo, root, 's1', 'a.txt', 'a\n');
    await writeFile(join(repo, 'shared.txt'), 'edited\n');
    const { data } = await buildMergeWave(['--phase', '3', '--base', base, '--results', JSON.stringify([s1])], repo);
    expect(data).toEqual({ error: 'working_tree_dirty' });
  });

  it('rejects missing, conflicting and malformed inputs', async () => {
    await expect(buildMergeWave(['--phase', '3', '--results', '[]'], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', base], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', base, '--results', '[]', '--results-file', 'r.json'], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', base, '--results', '{"slice":"s1"}'], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', base, '--results', 'not json'], repo)).rejects.toThrow(GSDError);
    await expect(buildMergeWave(['--phase', '3', '--base', 'not-a-commit', '--results', '[]'], repo)).rejects.toThrow(GSDError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sdk && npx vitest run --project integration src/query/build-merge.integration.test.ts`
Expected: FAIL with `Failed to load url ./build-merge.js`.

- [ ] **Step 3: Create the query**

Create `sdk/src/query/build-merge.ts`:

```ts
/**
 * build.merge-wave — merge a wave's isolated slice branches into the current
 * branch, abort conflicting merges cleanly, and remove merged worktrees.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { normalizePhaseName } from './helpers.js';
import { parseFlags, runGit } from './build-shared.js';
import type { QueryHandler } from './utils.js';

type BlockReason =
  | 'invalid_branch' | 'protected_branch' | 'branch_mismatch' | 'worktree_dirty'
  | 'base_mismatch' | 'bulk_deletions' | 'merge_failed' | 'cleanup_failed';

export interface MergeWaveData {
  merged: string[];
  conflicts: Array<{ slice: string; files: string[] }>;
  blocked: Array<{ slice: string; reason: BlockReason; detail: string }>;
  skipped: Array<{ slice: string; reason: 'not_done' | 'not_isolated' }>;
  cleaned: string[];
}

interface SliceResultInput {
  slice: string;
  status: string;
  branch: string;
  worktree_path: string;
}

const BULK_DELETION_LIMIT = 5;
const PROTECTED_BRANCH = /^(?:main|master|develop|trunk|release\/.+)$/;

function sliceOrder(slice: string): number {
  const match = /^s(\d+)$/.exec(slice);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseResults(raw: string): SliceResultInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GSDError('slice results must be valid JSON', ErrorClassification.Validation);
  }
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new GSDError('slice results must be a JSON array of objects', ErrorClassification.Validation);
  }
  return parsed.map((item, index) => {
    const record = item as Record<string, unknown>;
    const slice = text(record.slice);
    if (!/^s\d+$/.test(slice) && slice !== 'fix') {
      throw new GSDError(`slice results[${index}].slice must be a slice id like s1`, ErrorClassification.Validation);
    }
    return { slice, status: text(record.status), branch: text(record.branch), worktree_path: text(record.worktree_path) };
  });
}

function readResults(projectDir: string, flags: Record<string, string | boolean>): string {
  const inline = flags.results;
  const file = flags['results-file'];
  if ((typeof inline === 'string') === (typeof file === 'string')) {
    throw new GSDError('pass exactly one of --results <json> or --results-file <path>', ErrorClassification.Validation);
  }
  if (typeof inline === 'string') return inline;
  const absolute = resolve(projectDir, file as string);
  if (!existsSync(absolute)) {
    throw new GSDError(`--results-file not found: ${String(file)}`, ErrorClassification.Validation);
  }
  return readFileSync(absolute, 'utf-8');
}

function lines(output: string): string[] {
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

export const buildMergeWave: QueryHandler = async (args, projectDir) => {
  const { flags, positionals } = parseFlags(args, { values: ['phase', 'base', 'results', 'results-file'] });
  if (positionals.length > 0) {
    throw new GSDError(`unexpected argument: ${positionals[0]}`, ErrorClassification.Validation);
  }
  if (typeof flags.phase !== 'string') throw new GSDError('--phase <P> is required', ErrorClassification.Validation);
  if (typeof flags.base !== 'string') throw new GSDError('--base <commit> is required', ErrorClassification.Validation);
  const results = parseResults(readResults(projectDir, flags)).sort((a, b) => sliceOrder(a.slice) - sliceOrder(b.slice));
  const padded = normalizePhaseName(flags.phase);

  const baseCheck = runGit(projectDir, ['rev-parse', '--verify', '--quiet', `${flags.base}^{commit}`]);
  if (!baseCheck.ok) {
    throw new GSDError(`--base does not name a commit: ${flags.base}`, ErrorClassification.Validation);
  }
  const base = baseCheck.stdout;

  const status = runGit(projectDir, ['status', '--porcelain', '--untracked-files=no']);
  if (!status.ok) return { data: { error: 'git_repository_required' } };
  if (status.stdout !== '') return { data: { error: 'working_tree_dirty' } };

  const current = runGit(projectDir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const currentBranch = current.ok ? current.stdout : '';
  const data: MergeWaveData = { merged: [], conflicts: [], blocked: [], skipped: [], cleaned: [] };
  const block = (slice: string, reason: BlockReason, detail: string): void => {
    data.blocked.push({ slice, reason, detail });
  };

  for (const result of results) {
    const { slice, branch } = result;
    if (result.status !== 'done') {
      data.skipped.push({ slice, reason: 'not_done' });
      continue;
    }
    if (!branch) {
      data.skipped.push({ slice, reason: 'not_isolated' });
      continue;
    }
    if (!runGit(projectDir, ['check-ref-format', '--branch', branch]).ok) {
      block(slice, 'invalid_branch', branch);
      continue;
    }
    if (branch === currentBranch || PROTECTED_BRANCH.test(branch)) {
      block(slice, 'protected_branch', branch);
      continue;
    }

    const worktree = result.worktree_path ? resolve(projectDir, result.worktree_path) : '';
    if (worktree) {
      const head = existsSync(worktree) ? runGit(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']) : null;
      if (!head || !head.ok || head.stdout !== branch) {
        block(slice, 'branch_mismatch', head ? head.stdout || head.stderr : `missing worktree ${worktree}`);
        continue;
      }
      const worktreeStatus = runGit(worktree, ['status', '--porcelain', '--untracked-files=all']);
      if (!worktreeStatus.ok || worktreeStatus.stdout !== '') {
        block(slice, 'worktree_dirty', worktreeStatus.stdout || worktreeStatus.stderr);
        continue;
      }
    }

    // The branch must have started at the wave base. A conflict-resolved branch
    // has merged the current branch in, so its merge base with HEAD is newer,
    // but the wave base is still an ancestor of that merge base.
    const mergeBase = runGit(projectDir, ['merge-base', 'HEAD', branch]);
    if (!mergeBase.ok || !runGit(projectDir, ['merge-base', '--is-ancestor', base, mergeBase.stdout]).ok) {
      block(slice, 'base_mismatch', mergeBase.stdout || mergeBase.stderr);
      continue;
    }

    // core.quotepath=off: non-ASCII paths come back as UTF-8, not as quoted octal escapes.
    const deletions = runGit(projectDir, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=D', `${mergeBase.stdout}..${branch}`]);
    const deleted = deletions.ok ? lines(deletions.stdout).filter((file) => !file.startsWith('.planning/')) : [];
    if (deleted.length > BULK_DELETION_LIMIT) {
      block(slice, 'bulk_deletions', deleted.join('\n'));
      continue;
    }

    const mergeResult = runGit(projectDir, ['merge', '--no-ff', '--no-edit', '-m', `chore(${padded}-${slice}): merge slice branch`, branch]);
    if (!mergeResult.ok) {
      // A failing pre-merge-commit or commit-msg hook also leaves MERGE_HEAD, but
      // with no unmerged paths; that is a failed merge, not a conflict.
      const inProgress = runGit(projectDir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).ok;
      const files = inProgress ? lines(runGit(projectDir, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=U']).stdout) : [];
      if (inProgress) runGit(projectDir, ['merge', '--abort']);
      if (files.length > 0) data.conflicts.push({ slice, files });
      else block(slice, 'merge_failed', mergeResult.stderr || mergeResult.stdout);
      continue;
    }
    data.merged.push(slice);

    if (!worktree) continue;
    let removed = runGit(projectDir, ['worktree', 'remove', '--force', worktree]);
    if (!removed.ok) {
      runGit(projectDir, ['worktree', 'unlock', worktree]);
      removed = runGit(projectDir, ['worktree', 'remove', '--force', worktree]);
    }
    if (!removed.ok) {
      block(slice, 'cleanup_failed', removed.stderr);
      continue;
    }
    data.cleaned.push(worktree);
    const deletedBranch = runGit(projectDir, ['branch', '-D', branch]);
    if (!deletedBranch.ok) block(slice, 'cleanup_failed', deletedBranch.stderr);
  }

  return { data };
};
```

- [ ] **Step 4: Register the query and regenerate aliases**

In `sdk/src/query/command-manifest.non-family.ts`, insert directly before `  { canonical: 'agent.classify-failure', aliases: ['agent classify-failure'], mutation: false, outputMode: 'json' },`:

```ts
  { canonical: 'build.merge-wave', aliases: ['build merge-wave'], mutation: true, outputMode: 'json' },
```

In `sdk/src/query/command-static-catalog-domain.ts`:

1. After `import { promptBudget } from './prompt-budget.js';`, add:

   ```ts
   import { buildMergeWave } from './build-merge.js';
   ```

2. After `  ['prompt-budget', promptBudget],`, add:

   ```ts
     ['build.merge-wave', buildMergeWave],
     ['build merge-wave', buildMergeWave],
   ```

Then run:

```bash
(cd sdk && npx tsx scripts/gen-command-aliases.ts)
npm run check:alias-drift
```

Expected: both alias files are rewritten, and `check:alias-drift` exits 0.

- [ ] **Step 5: Run the tests**

Run:

```bash
(cd sdk && npm run build && npx vitest run --project integration src/query/build-merge.integration.test.ts && npx vitest run src/query/command-seam-coverage.test.ts src/query/registry-assembly.test.ts src/query/query-command-semantics.test.ts)
node --test tests/feat-3598-generator-correctness.test.cjs tests/gsd-sdk-query-registry-integration.test.cjs
```

Expected: PASS. `registry-assembly` finds both `build.merge-wave` names among the mutation commands.

Then run the root suite compare from "Verification" with `<N>` = `6`. Expected: `"newFailures": []`.

- [ ] **Step 6: Commit**

```bash
git add sdk/src/query/build-merge.ts sdk/src/query/build-merge.integration.test.ts sdk/src/query/command-manifest.non-family.ts sdk/src/query/command-static-catalog-domain.ts sdk/src/query/command-aliases.generated.ts get-shit-done/bin/lib/command-aliases.generated.cjs
git commit -m "feat(build): add build.merge-wave for isolated slice branches"
```

---

### Task 7: `build.group-problems`

**Files:**
- Create: `sdk/src/query/build-problems.ts`
- Test: `sdk/src/query/build-problems.test.ts`
- Modify: `sdk/src/query/command-manifest.non-family.ts`, `sdk/src/query/command-static-catalog-domain.ts`
- Regenerate: `sdk/src/query/command-aliases.generated.ts`, `get-shit-done/bin/lib/command-aliases.generated.cjs`

**Interfaces:**
- Consumes:
  - `parseFlags` and `runGit` from `./build-shared.js` (Task 2)
  - `loadBrief`, `fileMatchesGlob` and the `BriefSlice` type from `./build-brief.js` (Task 3)
- Produces:
  - the types `ProblemKind`, `BuildProblem` and `ProblemGroup` (registry)
  - `buildGroupProblems: QueryHandler`, registered as `build.group-problems`, returning `{ groups: ProblemGroup[]; batches: string[][] }`
  - `ownerOfFile(projectDir, file, slices, cache?) → string`
  - `groupProblems(projectDir, slices, problems) → { groups, batches }`
  - `parseProblems(raw) → BuildProblem[]`

Rules from the spec's "Fix rounds":
1. **Owner of a file:**
   - the first slice, in brief order, with an `owns` glob that matches the file
   - else the slice that owns the most tracked files directly in the same directory
   - else `fix`
2. **Assignment:** a problem goes to the owner of its first file. A problem without files goes to `fix`.
3. **Batches:** groups that share no file run in the same batch. Groups without files form the final batch.

- [ ] **Step 1: Write the failing test**

Create `sdk/src/query/build-problems.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { buildGroupProblems } from './build-problems.js';

const BRIEF_PATH = '.planning/phases/03-user-auth/03-01-PLAN.md';
const BRIEF = [
  '---',
  'phase: 03-user-auth',
  'plan: 01',
  'type: execute',
  'kind: brief',
  'wave: 1',
  'depends_on: []',
  'files_modified: []',
  'autonomous: true',
  'requirements: [AUTH-01]',
  'must_haves:',
  '  truths: []',
  'slices:',
  '  - id: s1',
  '    goal: "Session model"',
  '    owns: ["src/auth/**", "src/shared/auth-*.ts"]',
  '    after: []',
  '  - id: s2',
  '    goal: "Login routes"',
  '    owns: ["src/routes/auth/**"]',
  '    after: [s1]',
  '---',
  '<objective>',
  'Users can sign in.',
  '</objective>',
  '',
].join('\n');

type Grouped = { groups: Array<{ slice: string; problems: unknown[]; files: string[] }>; batches: string[][] };

let dir: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

async function group(problems: unknown): Promise<Grouped> {
  const result = await buildGroupProblems(['--brief', BRIEF_PATH, '--problems', JSON.stringify(problems)], dir);
  return result.data as Grouped;
}

async function expectValidation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(GSDError);
  expect((error as GSDError).classification).toBe('validation');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-problems-'));
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  const tracked = [BRIEF_PATH, 'src/auth/session.ts', 'src/routes/auth/login.ts', 'src/shared/auth-util.ts', 'src/shared/auth-token.ts', 'docs/guide.md'];
  for (const file of tracked) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), file === BRIEF_PATH ? BRIEF : '// tracked\n');
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: fixture');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('build.group-problems', () => {
  it('maps problems to the slice whose owns glob matches the first file', async () => {
    const data = await group([
      { kind: 'check', summary: 'tsc: session type error', files: ['src/auth/session.ts'] },
      { kind: 'gap', summary: 'logout route missing', files: ['src/routes/auth/login.ts'] },
    ]);
    expect(data.groups.map((g) => g.slice)).toEqual(['s1', 's2']);
    expect(data.groups[0].files).toEqual(['src/auth/session.ts']);
    expect(data.batches).toEqual([['s1', 's2']]);
  });

  it('assigns an unowned file to the slice owning most files in its directory', async () => {
    const data = await group([{ kind: 'stub', summary: 'FIXME left in index', files: ['src/shared/index.ts'] }]);
    expect(data.groups).toEqual([
      { slice: 's1', problems: [{ kind: 'stub', summary: 'FIXME left in index', files: ['src/shared/index.ts'] }], files: ['src/shared/index.ts'] },
    ]);
  });

  it('uses the fix group when no slice owns the file or its directory', async () => {
    const data = await group([{ kind: 'review', summary: 'guide contradicts API', files: ['docs/guide.md'] }]);
    expect(data.groups.map((g) => g.slice)).toEqual(['fix']);
  });

  it('puts problems without files in a fix group in its own final batch', async () => {
    const data = await group([
      { kind: 'check', summary: 'npm test failed' },
      { kind: 'check', summary: 'lint error', files: ['src/auth/session.ts'] },
    ]);
    expect(data.groups.map((g) => g.slice)).toEqual(['s1', 'fix']);
    expect(data.batches).toEqual([['s1'], ['fix']]);
  });

  it('splits groups that share a file into separate batches', async () => {
    const data = await group([
      { kind: 'gap', summary: 'session not wired to login', files: ['src/auth/session.ts', 'src/routes/auth/login.ts'] },
      { kind: 'check', summary: 'login test fails', files: ['src/routes/auth/login.ts'] },
    ]);
    expect(data.groups.map((g) => [g.slice, g.files])).toEqual([
      ['s1', ['src/auth/session.ts', 'src/routes/auth/login.ts']],
      ['s2', ['src/routes/auth/login.ts']],
    ]);
    expect(data.batches).toEqual([['s1'], ['s2']]);
  });

  it('rejects malformed input', async () => {
    await expectValidation(buildGroupProblems(['--brief', BRIEF_PATH, '--problems', '{bad'], dir));
    await expectValidation(buildGroupProblems(['--brief', BRIEF_PATH, '--problems', JSON.stringify([{ kind: 'lint', summary: 'x' }])], dir));
    await expectValidation(buildGroupProblems(['--brief', BRIEF_PATH, '--problems', JSON.stringify([{ kind: 'gap', summary: '   ' }])], dir));
    await expectValidation(buildGroupProblems(['--brief', BRIEF_PATH], dir));
    await expectValidation(buildGroupProblems(['--brief', '.planning/phases/03-user-auth/03-09-PLAN.md', '--problems', '[]'], dir));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd sdk && npx vitest run src/query/build-problems.test.ts`
Expected: FAIL. Vitest cannot resolve `./build-problems.js`.

- [ ] **Step 3: Write the module**

Create `sdk/src/query/build-problems.ts`:

```ts
/**
 * build.group-problems — map remaining build problems (new check failures,
 * verifier gaps, stub findings, critical review findings) to the brief slice
 * that owns their files, so the lead can start one fixing builder per group.
 */

import { readFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { parseFlags, runGit } from './build-shared.js';
import { fileMatchesGlob, loadBrief, type BriefSlice } from './build-brief.js';
import type { QueryHandler } from './utils.js';

export type ProblemKind = 'check' | 'gap' | 'stub' | 'review';
export interface BuildProblem { id?: string; kind: ProblemKind; summary: string; files?: string[] }
export interface ProblemGroup { slice: string; problems: BuildProblem[]; files: string[] }

const PROBLEM_KINDS: readonly ProblemKind[] = ['check', 'gap', 'stub', 'review'];

function invalid(message: string): never {
  throw new GSDError(message, ErrorClassification.Validation);
}

function normalizeFile(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function parseProblems(raw: string): BuildProblem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid('problems must be valid JSON');
  }
  if (!Array.isArray(parsed)) invalid('problems must be a JSON array');
  return parsed.map((item: unknown, index: number): BuildProblem => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid(`problems[${index}] must be an object`);
    const record = item as Record<string, unknown>;
    if (!PROBLEM_KINDS.includes(record.kind as ProblemKind)) {
      invalid(`problems[${index}].kind must be one of ${PROBLEM_KINDS.join(', ')}`);
    }
    if (typeof record.summary !== 'string' || record.summary.trim() === '') {
      invalid(`problems[${index}].summary must be a non-empty string`);
    }
    if (record.id !== undefined && typeof record.id !== 'string') invalid(`problems[${index}].id must be a string`);
    const problem: BuildProblem = { kind: record.kind as ProblemKind, summary: record.summary as string };
    if (typeof record.id === 'string') problem.id = record.id;
    if (record.files !== undefined) {
      if (!Array.isArray(record.files) || record.files.some((file) => typeof file !== 'string' || file.trim() === '')) {
        invalid(`problems[${index}].files must be a list of non-empty strings`);
      }
      problem.files = (record.files as string[]).map(normalizeFile);
    }
    return problem;
  });
}

function directChildren(projectDir: string, dir: string, cache: Map<string, string[]>): string[] {
  const cached = cache.get(dir);
  if (cached) return cached;
  const listed = runGit(projectDir, ['-c', 'core.quotepath=off', 'ls-files', '--', dir]);
  const children = listed.ok
    ? listed.stdout.split('\n').map(normalizeFile).filter((file) => file !== '' && posix.dirname(file) === dir)
    : [];
  cache.set(dir, children);
  return children;
}

export function ownerOfFile(
  projectDir: string,
  file: string,
  slices: readonly BriefSlice[],
  cache: Map<string, string[]> = new Map(),
): string {
  for (const slice of slices) {
    if (slice.owns.some((glob) => fileMatchesGlob(file, glob))) return slice.id;
  }
  const children = directChildren(projectDir, posix.dirname(file), cache);
  let owner = 'fix';
  let best = 0;
  for (const slice of slices) {
    const count = children.filter((child) => slice.owns.some((glob) => fileMatchesGlob(child, glob))).length;
    if (count > best) {
      owner = slice.id;
      best = count;
    }
  }
  return owner;
}

export function groupProblems(
  projectDir: string,
  slices: readonly BriefSlice[],
  problems: readonly BuildProblem[],
): { groups: ProblemGroup[]; batches: string[][] } {
  const cache = new Map<string, string[]>();
  const bySlice = new Map<string, { problems: BuildProblem[]; files: Set<string> }>();
  for (const problem of problems) {
    const files = problem.files ?? [];
    const slice = files.length > 0 ? ownerOfFile(projectDir, files[0], slices, cache) : 'fix';
    const entry = bySlice.get(slice) ?? { problems: [], files: new Set<string>() };
    entry.problems.push(problem);
    for (const file of files) entry.files.add(file);
    bySlice.set(slice, entry);
  }

  const groups: ProblemGroup[] = [...slices.map((slice) => slice.id), 'fix']
    .filter((id) => bySlice.has(id))
    .map((id) => ({ slice: id, problems: bySlice.get(id)!.problems, files: [...bySlice.get(id)!.files] }));

  const batches: Array<{ slices: string[]; files: Set<string> }> = [];
  const fileless: string[] = [];
  for (const group of groups) {
    if (group.files.length === 0) {
      fileless.push(group.slice);
      continue;
    }
    const batch = batches.find((candidate) => group.files.every((file) => !candidate.files.has(file)));
    if (batch) {
      batch.slices.push(group.slice);
      for (const file of group.files) batch.files.add(file);
    } else {
      batches.push({ slices: [group.slice], files: new Set(group.files) });
    }
  }
  const ordered = batches.map((batch) => batch.slices);
  if (fileless.length > 0) ordered.push(fileless);
  return { groups, batches: ordered };
}

export const buildGroupProblems: QueryHandler = async (args, projectDir) => {
  const { flags } = parseFlags(args, { values: ['brief', 'problems', 'problems-file'] });
  if (typeof flags.brief !== 'string') invalid('--brief <path> is required');
  const inline = flags.problems;
  const fromFile = flags['problems-file'];
  if ((inline === undefined) === (fromFile === undefined)) {
    invalid('pass exactly one of --problems <json> or --problems-file <path>');
  }

  const brief = await loadBrief(projectDir, flags.brief);
  let raw: string;
  if (typeof inline === 'string') {
    raw = inline;
  } else {
    const filePath = String(fromFile);
    try {
      raw = await readFile(isAbsolute(filePath) ? filePath : resolve(projectDir, filePath), 'utf-8');
    } catch {
      invalid(`cannot read problems file: ${filePath}`);
    }
  }
  return { data: groupProblems(projectDir, brief.slices, parseProblems(raw)) };
};
```

- [ ] **Step 4: Register the query**

In `sdk/src/query/command-manifest.non-family.ts`, insert this line directly above `  { canonical: 'agent.classify-failure', aliases: ['agent classify-failure'], mutation: false, outputMode: 'json' },`:

```ts
  { canonical: 'build.group-problems', aliases: ['build group-problems'], mutation: false, outputMode: 'json' },
```

In `sdk/src/query/command-static-catalog-domain.ts`, make two insertions:
- directly below `import { promptBudget } from './prompt-budget.js';`, add:

  ```ts
  import { buildGroupProblems } from './build-problems.js';
  ```

- directly above `  ['prompt-budget', promptBudget],`, add:

  ```ts
    ['build.group-problems', buildGroupProblems],
    ['build group-problems', buildGroupProblems],
  ```

Regenerate the aliases and check them:

```bash
(cd sdk && npx tsx scripts/gen-command-aliases.ts)
npm run check:alias-drift
```

Expected: the generator exits 0, and `check:alias-drift` exits 0.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd sdk && npx vitest run src/query/build-problems.test.ts src/query/command-definition.test.ts src/query/command-seam-coverage.test.ts`
Expected: PASS.

Run: `node --test tests/gsd-sdk-query-registry-integration.test.cjs tests/feat-3598-generator-correctness.test.cjs`
Expected: PASS.

- [ ] **Step 6: Compare the root suite with the baseline**

```bash
npm test > "$WS/task-7-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-7-root.log"
```

Expected: `"newFailures": []`.

- [ ] **Step 7: Commit**

```bash
git add sdk/src/query/build-problems.ts sdk/src/query/build-problems.test.ts \
  sdk/src/query/command-manifest.non-family.ts sdk/src/query/command-static-catalog-domain.ts \
  sdk/src/query/command-aliases.generated.ts get-shit-done/bin/lib/command-aliases.generated.cjs
git commit -m "feat(sdk): add build.group-problems query"
```

---

### Task 8: `init.build`

**Files:**
- Create: `sdk/src/query/build-init.ts`
- Modify: `sdk/src/query/build-shared.ts` (add `listPhasePlanFiles`, `readVerification`)
- Modify: `sdk/src/query/command-manifest.init.ts`, `sdk/src/query/command-family-handlers.ts`, `get-shit-done/bin/lib/init-command-router.cjs`
- Regenerate: `sdk/src/query/command-aliases.generated.ts`, `get-shit-done/bin/lib/command-aliases.generated.cjs`
- Test: `sdk/src/query/build-init.test.ts`, `tests/fvgsd-init-build-router.test.cjs`

**Interfaces:**
- Consumes:
  - Task 1: `resolveRuntimeCapabilities` from `../runtime-capabilities.js`
  - Task 2: `parseFlags`, `runGit`, `gitCommonDir`, `headCommit`, `resolveBuildPhase` and `BuildPhase` from `./build-shared.js`; `detectChecks` from `./build-checks.js`
  - Task 3: `phaseRequirementIds`
  - Task 4: the catalog row for `fvgsd-builder`
  - Task 5: `codeHead`
  - existing code: `loadConfig`, `resolveModel`, `detectRuntime`, `SUPPORTED_RUNTIMES`, `extractFrontmatter`, `planningPaths`, `normalizePhaseName`, `escapeRegex` and `toPosixPath`
- Produces:
  - `listPhasePlanFiles(phaseDirAbs, padded): PhasePlanFile[]` and `readVerification(phaseDirAbs, padded): VerificationInfo | null` in `build-shared.ts`. `VerificationInfo.path` is absolute.
  - `initBuild: QueryHandler`, registered as `init.build`, returning the registry shape (`resume.verification` is `{ path, status }` with a project-relative path, or null)
  - `baseline.needs_run` per Decision 15 (`last_passing_commit` and `code_head` have identical code trees), and `--runtime` values outside `SUPPORTED_RUNTIMES`, including an unreplaced `__FVGSD_RUNTIME__`, resolved by `detectRuntime`
  - `fvgsd-tools init build <phase>`, routed to it

Resume rules (spec "Setup", plus planning decision 3), evaluated for the target plan:
- **Target plan:**
  - without `--gaps`: the highest-numbered brief; with no brief, a phase that has other plans is `classic`, and one with no plans gets plan `01`
  - with `--gaps`: that brief when it has `gap_closure: true` and no summary; otherwise the next free plan number
- **Base commit:** the commit that first added the brief, or HEAD when the brief is absent or uncommitted.
- **Commit scan** over `<base>..HEAD`:
  - `feat({P}-sN):` marks a slice done
  - `chore({P}-sN): partial` marks it partial
  - `fix({P}-sN|fix):` counts as slice work
- **State, first match wins:**
  1. no brief → `new`
  2. summary + VERIFICATION `passed` → `complete`
  3. summary + VERIFICATION `human_needed` → `human_needed`
  4. no slice commit → `brief_written`
  5. a slice lacks `feat` → `slices_in_progress`
  6. VERIFICATION.md missing or older (mtime) than the last `feat`/`fix` commit → `verifying`
  7. status `gaps_found` → `gaps_found`
  8. otherwise → `summarizing`

- [ ] **Step 1: Write the failing SDK test**

Create `sdk/src/query/build-init.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { resolveRuntimeCapabilities } from '../runtime-capabilities.js';
import { initBuild } from './build-init.js';
import { listPhasePlanFiles, readVerification } from './build-shared.js';

const PHASE_DIR = '.planning/phases/03-user-auth';
const ROADMAP = [
  '# Roadmap',
  '',
  '- [ ] **Phase 3: User Auth**',
  '- [ ] **Phase 4: Profiles**',
  '',
  '### Phase 3: User Auth',
  '',
  '**Goal:** Users can sign in',
  '**Requirements:** AUTH-01, AUTH-02',
  '',
  '### Phase 4: Profiles',
  '',
  '**Goal:** Users can edit their profile',
  '**Requirements:** PROF-01',
  '',
].join('\n');

function brief(nn: string, gap = false): string {
  return [
    '---',
    'phase: 03-user-auth',
    `plan: ${nn}`,
    'type: execute',
    'kind: brief',
    'wave: 1',
    'depends_on: []',
    'files_modified: []',
    'autonomous: true',
    'requirements: [AUTH-01, AUTH-02]',
    `gap_closure: ${gap}`,
    'must_haves:',
    '  truths: []',
    'slices:',
    '  - id: s1',
    '    goal: "Session model"',
    '    owns: ["src/auth/**"]',
    '    after: []',
    '  - id: s2',
    '    goal: "Login routes"',
    '    owns: ["src/routes/**"]',
    '    after: [s1]',
    '---',
    '<objective>',
    'Users can sign in.',
    '</objective>',
    '',
  ].join('\n');
}

function verification(status: string): string {
  return ['---', 'phase: 03-user-auth', 'verified: 2026-09-13T10:00:00Z', `status: ${status}`, 'score: 2/2', '---', '', '# Verification', ''].join('\n');
}

let dir: string;
let savedRuntime: string | undefined;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function put(file: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), content);
}

async function commit(file: string, content: string, message: string): Promise<string> {
  await put(file, content);
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

async function init(...args: string[]): Promise<Record<string, any>> {
  return (await initBuild(args, dir)).data as Record<string, any>;
}

beforeEach(async () => {
  savedRuntime = process.env.FVGSD_RUNTIME;
  delete process.env.FVGSD_RUNTIME;
  dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-init-'));
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  await put('.planning/config.json', JSON.stringify({ model_profile: 'balanced' }));
  await put('.planning/ROADMAP.md', ROADMAP);
  await put('.planning/STATE.md', '# State\n\n**Current Phase:** 3\n');
  await put('.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in\n- [ ] **AUTH-02**: stay signed in\n');
  await commit(`${PHASE_DIR}/03-CONTEXT.md`, '# Context\n', 'docs(03): context');
});

afterEach(async () => {
  if (savedRuntime === undefined) delete process.env.FVGSD_RUNTIME;
  else process.env.FVGSD_RUNTIME = savedRuntime;
  await rm(dir, { recursive: true, force: true });
});

describe('init.build', () => {
  it('returns phase, inputs, commands, runtime, config, models, resume and baseline', async () => {
    await put('.planning/config.json', JSON.stringify({ model_profile: 'balanced', workflow: { build_command: 'make all' } }));
    const head = git('rev-parse', 'HEAD');
    const data = await init('3');
    expect(data.phase_found).toBe(true);
    expect(data.phase).toEqual({ number: '3', padded: '03', name: 'user-auth', dir: PHASE_DIR });
    expect(data.inputs).toEqual({
      context: `${PHASE_DIR}/03-CONTEXT.md`, research: null, spec: null, ui_spec: null, milestone_brief: null,
      roadmap: '.planning/ROADMAP.md', requirements: '.planning/REQUIREMENTS.md', requirement_ids: ['AUTH-01', 'AUTH-02'],
    });
    expect(data.commands).toEqual({ build: 'make all', typecheck: null, lint: null, test: null });
    expect(data.runtime).toEqual({ name: 'claude', ...resolveRuntimeCapabilities('claude') });
    expect(data.config).toEqual({
      research: true, fix_rounds: 2, human_checks: 'defer', code_review: false, parallel: 'auto', engine: 'agents',
      max_concurrent_agents: 3, check_timeout_seconds: 1800, mode: 'interactive', security_enforcement: true, commit_docs: true,
    });
    expect(data.models).toEqual({ brief: 'opus', slice: 'sonnet', strong: 'opus', verifier: 'sonnet' });
    expect(data.resume).toEqual({
      state: 'new', plan: '01', brief: null, summary: null, done_slices: [], partial_slices: [], base_commit: head, verification: null,
    });
    expect(data.baseline).toEqual({ last_passing_commit: null, code_head: null, needs_run: true });
  });

  it('finds research, spec, UI spec and the milestone brief', async () => {
    await put(`${PHASE_DIR}/03-RESEARCH.md`, '# Research\n');
    await put(`${PHASE_DIR}/03-SPEC.md`, '# Spec\n');
    await put(`${PHASE_DIR}/03-UI-SPEC.md`, '# UI spec\n');
    await put('.planning/MILESTONE-BRIEF.md', '# Milestone\n');
    const { inputs } = await init('3');
    expect([inputs.research, inputs.spec, inputs.ui_spec, inputs.milestone_brief]).toEqual([
      `${PHASE_DIR}/03-RESEARCH.md`, `${PHASE_DIR}/03-SPEC.md`, `${PHASE_DIR}/03-UI-SPEC.md`, '.planning/MILESTONE-BRIEF.md',
    ]);
  });

  it('derives every resume state from files and git', async () => {
    const base = await commit(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'), 'docs(03): build brief');
    expect((await init('3')).resume).toMatchObject({ state: 'brief_written', plan: '01', brief: `${PHASE_DIR}/03-01-PLAN.md`, base_commit: base });

    await commit('src/auth/session.ts', 'export {};\n', 'feat(03-s1): session model');
    await commit('src/routes/wip.ts', 'export {};\n', 'chore(03-s2): partial — waiting for the session API');
    expect((await init('3')).resume).toMatchObject({ state: 'slices_in_progress', done_slices: ['s1'], partial_slices: ['s2'] });

    await commit('src/routes/login.ts', 'export {};\n', 'feat(03-s2): login routes');
    expect((await init('3')).resume.state).toBe('verifying');

    const verificationPath = join(dir, PHASE_DIR, '03-VERIFICATION.md');
    await writeFile(verificationPath, verification('gaps_found'));
    expect((await init('3')).resume).toMatchObject({
      state: 'gaps_found', verification: { path: `${PHASE_DIR}/03-VERIFICATION.md`, status: 'gaps_found' },
    });

    const past = new Date(Date.now() - 3_600_000);
    await utimes(verificationPath, past, past);
    expect((await init('3')).resume.state).toBe('verifying');

    await writeFile(verificationPath, verification('passed'));
    expect((await init('3')).resume.state).toBe('summarizing');

    await put(`${PHASE_DIR}/03-01-SUMMARY.md`, '# Summary\n');
    expect((await init('3')).resume).toMatchObject({ state: 'complete', summary: `${PHASE_DIR}/03-01-SUMMARY.md` });

    await writeFile(verificationPath, verification('human_needed'));
    expect((await init('3')).resume.state).toBe('human_needed');
  });

  it('reports classic when the phase already has plans that are not briefs', async () => {
    await commit(`${PHASE_DIR}/03-01-PLAN.md`, '---\nphase: 03-user-auth\nplan: 01\n---\n# Plan\n', 'docs(03): plan');
    expect((await init('3')).resume).toMatchObject({ state: 'classic', plan: null, brief: null });
  });

  it('targets the next plan for --gaps, then resumes an unfinished gap brief', async () => {
    await commit(`${PHASE_DIR}/03-01-PLAN.md`, brief('01'), 'docs(03): build brief');
    await commit(`${PHASE_DIR}/03-01-SUMMARY.md`, '# Summary\n', 'docs(03): build summary and verification');
    expect((await init('3', '--gaps')).resume).toMatchObject({ state: 'new', plan: '02', brief: null });

    await commit(`${PHASE_DIR}/03-02-PLAN.md`, brief('02', true), 'docs(03): build brief');
    expect((await init('3', '--gaps')).resume).toMatchObject({ state: 'brief_written', plan: '02' });
    expect((await init('3')).resume).toMatchObject({ state: 'brief_written', plan: '02' });
  });

  it('skips the baseline only when the latest passing commit has the code head tree', async () => {
    const summary = (completed: string, passedAt: string) => [
      '---', 'phase: 02-setup', 'plan: 01', 'kind: build-summary', 'subsystem: setup', 'tags: [setup]',
      'build:', `  completed: ${completed}`, `  checks_passed_at: ${passedAt}`, '---', '', '# Summary', '',
    ].join('\n');
    const first = await commit('src/app.ts', 'export const a = 1;\n', 'feat(02-s1): app');
    const head = await commit('src/app.ts', 'export const a = 2;\n', 'fix(02-s1): app value');
    await put('.planning/phases/02-setup/02-01-SUMMARY.md', summary('2026-09-13T10:00:00Z', head));
    await put('.planning/phases/02-setup/02-02-SUMMARY.md', summary('2026-09-12T10:00:00Z', first));
    expect((await init('3')).baseline).toEqual({ last_passing_commit: head, code_head: head, needs_run: false });

    const next = await commit('src/app.ts', 'export const a = 3;\n', 'chore: bump');
    expect((await init('3')).baseline).toEqual({ last_passing_commit: head, code_head: next, needs_run: true });

    const restored = await commit('src/app.ts', 'export const a = 2;\n', 'chore: restore the app value');
    expect((await init('3')).baseline).toEqual({ last_passing_commit: head, code_head: restored, needs_run: false });
  });

  it('resolves the runtime from --runtime, falling back to detection for unsupported values', async () => {
    expect((await init('3', '--runtime', 'codex')).runtime).toEqual({ name: 'codex', ...resolveRuntimeCapabilities('codex') });
    expect((await init('3', '--runtime', 'not-a-runtime')).runtime.name).toBe('claude');
    expect((await init('3', '--runtime', '__FVGSD_RUNTIME__')).runtime.name).toBe('claude');
    process.env.FVGSD_RUNTIME = 'gemini';
    expect((await init('3')).runtime.name).toBe('gemini');
    expect((await init('3', '--runtime', '__FVGSD_RUNTIME__')).runtime.name).toBe('gemini');
  });

  it('normalizes build config values', async () => {
    const configFor = async (config: Record<string, unknown>) => {
      await put('.planning/config.json', JSON.stringify(config));
      return (await init('3')).config;
    };
    expect((await configFor({ parallelization: false })).parallel).toBe('off');
    expect(await configFor({ parallelization: { enabled: true, max_concurrent_agents: 5 } })).toMatchObject({ parallel: 'auto', max_concurrent_agents: 5 });
    expect((await configFor({ workflow: { use_worktrees: false } })).parallel).toBe('off');
    expect((await configFor({ workflow: { build_parallel: 'off' } })).parallel).toBe('off');
    expect((await configFor({ workflow: { build_fix_rounds: 9 } })).fix_rounds).toBe(5);
    expect((await configFor({ workflow: { build_fix_rounds: -1 } })).fix_rounds).toBe(0);
    expect(await configFor({
      mode: 'yolo', commit_docs: false,
      workflow: { research: false, build_human_checks: 'block', build_engine: 'workflow', build_code_review: true, build_check_timeout_seconds: 60, security_enforcement: false },
    })).toMatchObject({
      research: false, human_checks: 'block', engine: 'workflow', code_review: true, check_timeout_seconds: 60,
      mode: 'yolo', security_enforcement: false, commit_docs: false,
    });
  });

  it('reports inherit models when the project has no config.json', async () => {
    await rm(join(dir, '.planning', 'config.json'));
    expect((await init('3')).models).toEqual({ brief: 'inherit', slice: 'inherit', strong: 'inherit', verifier: 'inherit' });
  });

  it('handles a missing phase, a missing argument and a directory outside git', async () => {
    expect(await init('9')).toEqual({ phase_found: false, phase: { number: '9', padded: '09' } });
    const error = await initBuild([], dir).then(() => null, (err: unknown) => err);
    expect(error).toBeInstanceOf(GSDError);
    const outside = await mkdtemp(join(tmpdir(), 'fvgsd-build-init-nogit-'));
    const data = (await initBuild(['3'], outside)).data;
    await rm(outside, { recursive: true, force: true });
    expect(data).toEqual({ error: 'git_repository_required' });
  });
});

describe('build-shared plan readers', () => {
  it('lists slugged plans with kind, gap flag, slice ids and summaries', async () => {
    await put(`${PHASE_DIR}/03-02-auth-hardening-PLAN.md`, brief('02', true));
    await put(`${PHASE_DIR}/03-02-auth-hardening-SUMMARY.md`, '# Summary\n');
    await put(`${PHASE_DIR}/03-01-PLAN.md`, '---\nphase: 03-user-auth\nplan: 01\n---\n');
    const plans = listPhasePlanFiles(join(dir, PHASE_DIR), '03');
    expect(plans.map((plan) => [plan.nn, plan.kind, plan.gapClosure, plan.sliceIds, plan.hasSummary])).toEqual([
      ['01', null, false, [], false],
      ['02', 'brief', true, ['s1', 's2'], true],
    ]);
    expect(readVerification(join(dir, PHASE_DIR), '03')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the SDK test to verify it fails**

Run: `cd sdk && npx vitest run src/query/build-init.test.ts`
Expected: FAIL. Vitest cannot resolve `./build-init.js`.

- [ ] **Step 3: Write the failing router test**

Create `tests/fvgsd-init-build-router.test.cjs`:

```js
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runGsdTools, createTempGitProject, cleanup } = require('./helpers.cjs');

describe('fvgsd-tools init build', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject('fvgsd-init-build-');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), ['# Roadmap', '', '### Phase 3: User Auth', '', '**Goal:** Users can sign in', ''].join('\n'));
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-user-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-CONTEXT.md'), '# Context\n');
    execFileSync('git', ['add', '-A'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-q', '-m', 'docs(03): context'], { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => cleanup(tmpDir));

  test('routes to the SDK init.build handler', () => {
    const result = runGsdTools(['init', 'build', '3'], tmpDir, { HOME: tmpDir });
    assert.ok(result.success, `init build failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_found, true);
    assert.strictEqual(output.resume.state, 'new');
    assert.strictEqual(output.resume.plan, '01');
  });
});
```

- [ ] **Step 4: Run the router test to verify it fails**

Run: `npm run build:sdk && node --test tests/fvgsd-init-build-router.test.cjs`
Expected: FAIL. The command exits non-zero with `Unknown init workflow: build`.

- [ ] **Step 5: Add the plan and verification readers to `build-shared.ts`**

In `sdk/src/query/build-shared.ts`, make sure the file imports `readdirSync`, `readFileSync` and `statSync` from `node:fs`, `join` from `node:path`, and `extractFrontmatter` from `./frontmatter.js`. Extend the existing import statements instead of adding duplicate ones.

Then append to the end of the file:

```ts
// ─── Plan and verification readers (init.build, routing) ────────────────────

export interface PhasePlanFile {
  file: string;
  nn: string;
  num: number;
  kind: string | null;
  gapClosure: boolean;
  sliceIds: string[];
  hasSummary: boolean;
}

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Plans named `{padded}-{NN}[-slug]-PLAN.md`, sorted by plan number. */
export function listPhasePlanFiles(phaseDirAbs: string, padded: string): PhasePlanFile[] {
  let files: string[];
  try {
    files = readdirSync(phaseDirAbs);
  } catch {
    return [];
  }
  const prefix = escapeForPattern(padded);
  const planPattern = new RegExp(`^${prefix}-(\\d{2,})(?:-[^/]*)?-PLAN\\.md$`);
  const plans: PhasePlanFile[] = [];
  for (const file of files) {
    const match = file.match(planPattern);
    if (!match) continue;
    const nn = match[1];
    const summaryPattern = new RegExp(`^${prefix}-${nn}(?:-[^/]*)?-SUMMARY\\.md$`);
    let frontmatter: Record<string, unknown> = {};
    try {
      frontmatter = extractFrontmatter(readFileSync(join(phaseDirAbs, file), 'utf-8'));
    } catch {
      // An unreadable plan is reported without kind, like a classic plan.
    }
    const slices = Array.isArray(frontmatter.slices) ? frontmatter.slices : [];
    plans.push({
      file,
      nn,
      num: Number.parseInt(nn, 10),
      kind: typeof frontmatter.kind === 'string' && frontmatter.kind !== '' ? frontmatter.kind : null,
      gapClosure: frontmatter.gap_closure === true || frontmatter.gap_closure === 'true',
      sliceIds: slices
        .map((slice) => (slice && typeof slice === 'object' ? String((slice as Record<string, unknown>).id ?? '') : ''))
        .filter((id) => id !== ''),
      hasSummary: files.some((candidate) => summaryPattern.test(candidate)),
    });
  }
  return plans.sort((a, b) => a.num - b.num || a.file.localeCompare(b.file));
}

export interface VerificationInfo {
  /** Absolute path of `{padded}-VERIFICATION.md`. */
  path: string;
  status: string | null;
  mtimeMs: number;
}

export function readVerification(phaseDirAbs: string, padded: string): VerificationInfo | null {
  const path = join(phaseDirAbs, `${padded}-VERIFICATION.md`);
  try {
    const { mtimeMs } = statSync(path);
    const frontmatter = extractFrontmatter(readFileSync(path, 'utf-8'));
    const status = typeof frontmatter.status === 'string' && frontmatter.status.trim() !== '' ? frontmatter.status.trim() : null;
    return { path, status, mtimeMs };
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Write the handler**

Create `sdk/src/query/build-init.ts`:

```ts
/**
 * init.build — one JSON bundle for the /fvgsd-build lead: phase paths and
 * inputs, check commands, runtime capabilities, build config, models, the
 * resume state derived from files and git, and the baseline decision.
 * See docs/superpowers/specs/2026-09-12-fvgsd-build-design.md "Setup".
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { loadConfig } from '../config.js';
import { SUPPORTED_RUNTIMES } from '../model-catalog.js';
import { resolveRuntimeCapabilities } from '../runtime-capabilities.js';
import { resolveModel } from './config-query.js';
import { extractFrontmatter } from './frontmatter.js';
import { detectRuntime, escapeRegex, normalizePhaseName, planningPaths, toPosixPath } from './helpers.js';
import { detectChecks } from './build-checks.js';
import {
  codeHead,
  gitCommonDir,
  headCommit,
  listPhasePlanFiles,
  parseFlags,
  phaseRequirementIds,
  readVerification,
  resolveBuildPhase,
  runGit,
  type BuildPhase,
  type PhasePlanFile,
} from './build-shared.js';
import type { QueryHandler } from './utils.js';

type ResumeState =
  | 'new' | 'brief_written' | 'slices_in_progress' | 'verifying' | 'gaps_found'
  | 'summarizing' | 'complete' | 'human_needed' | 'classic';

function relPath(projectDir: string, absPath: string): string {
  return toPosixPath(relative(projectDir, absPath));
}

function findInput(files: readonly string[], name: string, exclude?: string): string | null {
  const matches = (file: string, candidate: string) => file === candidate || file.endsWith(`-${candidate}`);
  return files.find((file) => matches(file, name) && !(exclude && matches(file, exclude))) ?? null;
}

async function modelFor(agent: string, projectDir: string, workstream?: string): Promise<string> {
  const { data } = await resolveModel([agent], projectDir, workstream);
  const model = (data as Record<string, unknown>).model;
  return typeof model === 'string' && model !== '' ? model : 'inherit';
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function buildConfig(config: Record<string, unknown>) {
  const workflow = (config.workflow ?? {}) as Record<string, unknown>;
  const parallelization = config.parallelization;
  const parallelObject = typeof parallelization === 'object' && parallelization !== null
    ? parallelization as Record<string, unknown>
    : null;
  const parallelEnabled = parallelObject ? parallelObject.enabled !== false : parallelization !== false;
  const rounds = workflow.build_fix_rounds;
  return {
    research: workflow.research !== false,
    fix_rounds: typeof rounds === 'number' && Number.isInteger(rounds) ? Math.min(5, Math.max(0, rounds)) : 2,
    human_checks: workflow.build_human_checks === 'block' ? 'block' : 'defer',
    code_review: workflow.build_code_review === true,
    parallel: workflow.build_parallel === 'off' || !parallelEnabled || workflow.use_worktrees === false ? 'off' : 'auto',
    engine: workflow.build_engine === 'workflow' ? 'workflow' : 'agents',
    max_concurrent_agents: positiveInt(parallelObject?.max_concurrent_agents) ?? 3,
    check_timeout_seconds: positiveInt(workflow.build_check_timeout_seconds) ?? 1800,
    mode: String(config.mode ?? 'interactive'),
    security_enforcement: workflow.security_enforcement !== false,
    commit_docs: config.commit_docs !== false,
  };
}

interface SliceScan { done: Set<string>; partial: Set<string>; touched: Set<string>; lastWorkSeconds: number | null }

function scanSliceCommits(projectDir: string, base: string, padded: string): SliceScan {
  const scan: SliceScan = { done: new Set(), partial: new Set(), touched: new Set(), lastWorkSeconds: null };
  const log = runGit(projectDir, ['log', '--format=%H%x09%ct%x09%s', `${base}..HEAD`]);
  if (!log.ok) return scan;
  const scope = escapeRegex(padded);
  const feat = new RegExp(`^feat\\(${scope}-(s\\d+)\\):`);
  const fix = new RegExp(`^fix\\(${scope}-(s\\d+|fix)\\):`);
  const partial = new RegExp(`^chore\\(${scope}-(s\\d+)\\): partial`);
  for (const line of log.stdout.split('\n')) {
    const [, seconds, ...subjectParts] = line.split('\t');
    const subject = subjectParts.join('\t');
    const featMatch = subject.match(feat);
    const fixMatch = featMatch ? null : subject.match(fix);
    const partialMatch = featMatch || fixMatch ? null : subject.match(partial);
    const slice = (featMatch ?? fixMatch ?? partialMatch)?.[1];
    if (!slice) continue;
    scan.touched.add(slice);
    if (featMatch) scan.done.add(slice);
    if (partialMatch) scan.partial.add(slice);
    const time = Number(seconds);
    if ((featMatch || fixMatch) && Number.isFinite(time)) scan.lastWorkSeconds = Math.max(scan.lastWorkSeconds ?? 0, time);
  }
  return scan;
}

function oldestAddCommit(projectDir: string, relFile: string): string | null {
  const log = runGit(projectDir, ['log', '--diff-filter=A', '--format=%H', '--', relFile]);
  if (!log.ok || log.stdout === '') return null;
  const lines = log.stdout.split('\n');
  return lines[lines.length - 1];
}

function resolveResume(projectDir: string, phase: BuildPhase, gaps: boolean, head: string): Record<string, unknown> {
  const plans = listPhasePlanFiles(phase.dirAbs, phase.padded);
  const briefs = plans.filter((plan) => plan.kind === 'brief');
  const latestBrief = briefs.length > 0 ? briefs[briefs.length - 1] : null;
  const info = readVerification(phase.dirAbs, phase.padded);
  const verification = info ? { path: relPath(projectDir, info.path), status: info.status } : null;
  const untouched = { done_slices: [] as string[], partial_slices: [] as string[] };

  let target: PhasePlanFile | null = null;
  let plan: string;
  if (!gaps && latestBrief) {
    target = latestBrief;
    plan = latestBrief.nn;
  } else if (!gaps && plans.length > 0) {
    return { state: 'classic', plan: null, brief: null, summary: null, ...untouched, base_commit: head, verification };
  } else if (!gaps) {
    plan = '01';
  } else if (latestBrief && latestBrief.gapClosure && !latestBrief.hasSummary) {
    target = latestBrief;
    plan = latestBrief.nn;
  } else {
    plan = String(plans.reduce((max, candidate) => Math.max(max, candidate.num), 0) + 1).padStart(2, '0');
  }

  if (!target) {
    return { state: 'new', plan, brief: null, summary: null, ...untouched, base_commit: head, verification };
  }

  const briefRel = `${phase.dir}/${target.file}`;
  const base = oldestAddCommit(projectDir, briefRel) ?? head;
  const scan = scanSliceCommits(projectDir, base, phase.padded);
  const slices = target.sliceIds;
  const done = slices.filter((id) => scan.done.has(id));
  const partial = slices.filter((id) => !scan.done.has(id) && scan.partial.has(id));
  const status = info?.status ?? null;
  const fresh = info !== null && (scan.lastWorkSeconds === null || info.mtimeMs >= scan.lastWorkSeconds * 1000);

  let state: ResumeState;
  if (target.hasSummary && status === 'passed') state = 'complete';
  else if (target.hasSummary && status === 'human_needed') state = 'human_needed';
  else if (scan.touched.size === 0) state = 'brief_written';
  else if (done.length < slices.length) state = 'slices_in_progress';
  else if (!fresh) state = 'verifying';
  else if (status === 'gaps_found') state = 'gaps_found';
  else state = 'summarizing';

  return {
    state,
    plan,
    brief: briefRel,
    summary: target.hasSummary ? `${phase.dir}/${phase.padded}-${target.nn}-SUMMARY.md` : null,
    done_slices: done,
    partial_slices: partial,
    base_commit: base,
    verification,
  };
}

function lastPassingCommit(projectDir: string, workstream?: string): string | null {
  const phasesDir = planningPaths(projectDir, workstream).phases;
  let dirs: string[];
  try {
    dirs = readdirSync(phasesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return null;
  }
  let best: { completed: number; commit: string | null } | null = null;
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(join(phasesDir, dir)).filter((file) => file.endsWith('-SUMMARY.md'));
    } catch {
      continue;
    }
    for (const file of files) {
      let frontmatter: Record<string, unknown>;
      try {
        frontmatter = extractFrontmatter(readFileSync(join(phasesDir, dir, file), 'utf-8'));
      } catch {
        continue;
      }
      const build = frontmatter.build;
      if (frontmatter.kind !== 'build-summary' || !build || typeof build !== 'object') continue;
      const record = build as Record<string, unknown>;
      const completed = Date.parse(String(record.completed ?? ''));
      if (!Number.isFinite(completed)) continue;
      const raw = record.checks_passed_at;
      // Only a full SHA reaches git: the value comes from a planning file.
      const commit = typeof raw === 'string' && /^[0-9a-f]{40,64}$/.test(raw) ? raw : null;
      if (!best || completed > best.completed) best = { completed, commit };
    }
  }
  return best ? best.commit : null;
}

export const initBuild: QueryHandler = async (args, projectDir, workstream) => {
  const { flags, positionals } = parseFlags(args, { values: ['phase', 'runtime'], booleans: ['gaps'] });
  const phaseArg = typeof flags.phase === 'string' ? flags.phase : positionals[0];
  if (!phaseArg) {
    throw new GSDError('phase required for init build', ErrorClassification.Validation);
  }

  const head = gitCommonDir(projectDir) === null ? null : headCommit(projectDir);
  if (head === null) return { data: { error: 'git_repository_required' } };

  const phase = await resolveBuildPhase(projectDir, phaseArg, workstream);
  if (!phase) {
    const padded = normalizePhaseName(phaseArg);
    return { data: { phase_found: false, phase: { number: padded.replace(/^0+(?=\d)/, ''), padded } } };
  }

  const config = await loadConfig(projectDir, workstream);
  const configRecord = config as unknown as Record<string, unknown>;
  const paths = planningPaths(projectDir, workstream);
  let files: string[] = [];
  try {
    files = readdirSync(phase.dirAbs).sort();
  } catch {
    files = [];
  }
  const phaseFile = (name: string | null) => (name ? `${phase.dir}/${name}` : null);
  const milestoneBrief = ['MILESTONE-CONTEXT.md', 'MILESTONE-BRIEF.md']
    .map((name) => join(paths.planning, name))
    .find((candidate) => existsSync(candidate));

  const detected = detectChecks(projectDir, (configRecord.workflow ?? {}) as Record<string, unknown>);
  // A --runtime value outside the supported runtimes, including the installer token
  // __FVGSD_RUNTIME__ left unreplaced, falls back to detection.
  const runtimeFlag = flags.runtime;
  const runtimeName = typeof runtimeFlag === 'string' && (SUPPORTED_RUNTIMES as readonly string[]).includes(runtimeFlag)
    ? runtimeFlag
    : detectRuntime(configRecord as { runtime?: unknown });
  const planningModel = await modelFor('fvgsd-planner', projectDir, workstream);
  const lastPassing = lastPassingCommit(projectDir, workstream);
  const code = codeHead(projectDir);
  // Decision 15: the last passing checks still count when that commit has code_head's code tree.
  const needsRun = lastPassing === null || code === null
    || !runGit(projectDir, ['diff', '--quiet', lastPassing, code, '--', '.', ':(exclude).planning']).ok;

  return {
    data: {
      phase_found: true,
      phase: { number: phase.number, padded: phase.padded, name: phase.name, dir: phase.dir },
      inputs: {
        context: phaseFile(findInput(files, 'CONTEXT.md')),
        research: phaseFile(findInput(files, 'RESEARCH.md')),
        spec: phaseFile(findInput(files, 'SPEC.md', 'UI-SPEC.md')),
        ui_spec: phaseFile(findInput(files, 'UI-SPEC.md')),
        milestone_brief: milestoneBrief ? relPath(projectDir, milestoneBrief) : null,
        roadmap: relPath(projectDir, paths.roadmap),
        requirements: existsSync(paths.requirements) ? relPath(projectDir, paths.requirements) : null,
        requirement_ids: await phaseRequirementIds(projectDir, phase.number, workstream),
      },
      commands: { build: detected.build, typecheck: detected.typecheck, lint: detected.lint, test: detected.test },
      runtime: { name: runtimeName, ...resolveRuntimeCapabilities(runtimeName) },
      config: buildConfig(configRecord),
      models: {
        brief: planningModel,
        slice: await modelFor('fvgsd-builder', projectDir, workstream),
        strong: planningModel,
        verifier: await modelFor('fvgsd-verifier', projectDir, workstream),
      },
      resume: resolveResume(projectDir, phase, flags.gaps === true, head),
      baseline: { last_passing_commit: lastPassing, code_head: code, needs_run: needsRun },
    },
  };
};
```

- [ ] **Step 7: Register `init.build`**

**`sdk/src/query/command-manifest.init.ts`.** Directly below the line
`  { family: 'init', canonical: 'init.remove-workspace', aliases: ['init remove-workspace'], mutation: false, outputMode: 'json' },`
add:

```ts
  { family: 'init', canonical: 'init.build', aliases: ['init build'], mutation: false, outputMode: 'json' },
```

**`sdk/src/query/command-family-handlers.ts`.** Directly below `import { initNewProject, initProgress, initManager } from './init-complex.js';`, add:

```ts
import { initBuild } from './build-init.js';
```

and directly below `    'init.remove-workspace': initRemoveWorkspace,`, add:

```ts
    'init.build': initBuild,
```

**`get-shit-done/bin/lib/init-command-router.cjs`.**

1. In the header comment, replace
   ```
    * CJS-only subcommands: none.
    * SDK-only (unsupported in CJS router): none.
   ```
   with
   ```
    * CJS-only subcommands: none.
    * SDK-only (no CJS fallback): build.
   ```
2. Replace this block:

```js
      'remove-workspace': sdkHandler(
        'init.remove-workspace',
        args.slice(2),
        args.slice(1),
        () => init.cmdInitRemoveWorkspace(cwd, args[2], raw),
      ),
    },
```

with:

```js
      'remove-workspace': sdkHandler(
        'init.remove-workspace',
        args.slice(2),
        args.slice(1),
        () => init.cmdInitRemoveWorkspace(cwd, args[2], raw),
      ),
      build: sdkHandler(
        'init.build',
        args.slice(2),
        args.slice(1),
        () => error('init build requires the fvgsd SDK — run npm run build:sdk'),
      ),
    },
```

Regenerate the aliases and check them:

```bash
(cd sdk && npx tsx scripts/gen-command-aliases.ts)
npm run check:alias-drift
```

Expected: both exit 0. `INIT_SUBCOMMANDS` in `get-shit-done/bin/lib/command-aliases.generated.cjs` now includes `build`.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
(cd sdk && npx vitest run src/query/build-init.test.ts src/query/command-definition.test.ts src/query/command-seam-coverage.test.ts)
npm run build:sdk
node --test tests/fvgsd-init-build-router.test.cjs tests/feat-3598-generator-correctness.test.cjs tests/gsd-sdk-query-registry-integration.test.cjs
```

Expected: PASS.

- [ ] **Step 9: Compare the root suite with the baseline**

```bash
npm test > "$WS/task-8-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-8-root.log"
```

Expected: `"newFailures": []`.

- [ ] **Step 10: Commit**

```bash
git add sdk/src/query/build-init.ts sdk/src/query/build-init.test.ts sdk/src/query/build-shared.ts \
  sdk/src/query/command-manifest.init.ts sdk/src/query/command-family-handlers.ts \
  sdk/src/query/command-aliases.generated.ts get-shit-done/bin/lib/command-aliases.generated.cjs \
  get-shit-done/bin/lib/init-command-router.cjs tests/fvgsd-init-build-router.test.cjs
git commit -m "feat(sdk): add init.build query"
```

---

### Task 9: `build.finalize`, summary reference and tool-chain integration test

**Files:**
- Create: `sdk/src/query/build-finalize.ts`, `get-shit-done/references/build-summary.md`
- Test: `sdk/src/query/build-finalize.test.ts`, `sdk/src/query/build-chain.integration.test.ts`
- Modify: `sdk/src/query/command-manifest.non-family.ts`, `sdk/src/query/command-static-catalog-domain.ts`, `docs/INVENTORY.md`
- Regenerate: `sdk/src/query/command-aliases.generated.ts`, `get-shit-done/bin/lib/command-aliases.generated.cjs`, `docs/INVENTORY-MANIFEST.json`

**Interfaces:**
- Consumes:
  - Task 2: `parseFlags`, `runGit`, `resolveBuildPhase`, `buildStateDir`, `writeJsonAtomic`, `readLatestChecks`, `buildRunChecks`
  - Task 3: `phaseRequirementIds`, `buildWaves`
  - Task 5: `changedFilesSince`, `codeHead`
  - Task 6: `buildMergeWave`
  - Task 8: `listPhasePlanFiles`, `readVerification`, `initBuild`
  - existing handlers: `parseDecisions`, `stateUpdateProgress`, `stateRecordMetric`, `roadmapUpdatePlanProgress`, `requirementsMarkComplete`, `phaseComplete`, `commit`, `roadmapAnalyze`, `stateJson`, `routeNextAction`
- Produces:
  - `upsertFrontmatterKeys(content, owned): string`
  - `buildFinalize: QueryHandler`, registered as `build.finalize` (mutation), with the registry arguments and results
  - `--requirements-completed` is optional: omit it when no requirement IDs were completed, since `parseFlags` rejects empty values
  - `build.checks_passed_at` follows Decision 15, and ID coverage searches the brief plus the summary as the lead wrote it (finalize-owned keys excluded)

Order inside finalize (spec "Summary and finalize"):
1. Fill the summary frontmatter.
2. Check ID coverage over the brief and the summary as the lead wrote it (finalize-owned keys, including `requirements-completed`, don't count); when any ID is missing, return `{ ok: false, missing }` before any state change.
3. Update STATE, ROADMAP and REQUIREMENTS through the existing handlers; mark the phase complete only when VERIFICATION.md is `passed`.
4. Commit.

- [ ] **Step 1: Write the failing unit test**

Create `sdk/src/query/build-finalize.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { GSDError } from '../errors.js';
import { extractFrontmatter, stripFrontmatter } from './frontmatter.js';
import { buildFinalize, upsertFrontmatterKeys } from './build-finalize.js';
import { buildStateDir, codeHead, writeJsonAtomic } from './build-shared.js';

const PHASE_DIR = '.planning/phases/03-user-auth';
const SUMMARY_PATH = `${PHASE_DIR}/03-01-SUMMARY.md`;
const ROADMAP = [
  '# Roadmap', '', '- [ ] **Phase 3: User Auth**', '- [ ] **Phase 4: Profiles**', '',
  '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '**Requirements:** AUTH-01, AUTH-02', '',
  '### Phase 4: Profiles', '', '**Goal:** Users can edit their profile', '**Requirements:** PROF-01', '',
].join('\n');
const CONTEXT = ['# Phase 3 Context', '', '<decisions>', '### Sessions', '- **D-01:** Hash passwords with argon2id', '- **D-02:** Sessions last 30 days', '</decisions>', ''].join('\n');
const BRIEF = [
  '---', 'phase: 03-user-auth', 'plan: 01', 'type: execute', 'kind: brief', 'wave: 1', 'depends_on: []',
  'files_modified: []', 'autonomous: true', 'requirements: [AUTH-01]', 'must_haves:', '  truths: []',
  'slices:', '  - id: s1', '    goal: "Session model"', '    owns: ["src/**"]', '    after: []',
  '---', '<objective>', 'Users can sign in.', '</objective>', '',
].join('\n');
const VERIFICATION = ['---', 'phase: 03-user-auth', 'verified: 2026-09-13T10:00:00Z', 'status: passed', 'score: 1/1', '---', '', '# Verification', ''].join('\n');

function summary(body: string[], frontmatter = ['subsystem: auth', 'tags: [auth, sessions]', 'provides:', '  - "session cookies"']): string {
  return ['---', ...frontmatter, '---', '', '# Phase 3: User Auth — Build Summary', '', ...body, ''].join('\n');
}

const COVERING_BODY = [
  '## Decisions', '', '| Decision | Status | Notes |', '|---|---|---|', '| D-01 | done | argon2id |', '',
  '### D-02: thirty-day sessions', '', '<requirements>AUTH-02 verified by the login tests</requirements>',
];

let dir: string;
let base: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function put(file: string, content: string): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), content);
}

/** Commit new src/app.ts content and return the commit. */
async function commitSource(content: string, message: string): Promise<string> {
  await put('src/app.ts', content);
  git('add', 'src/app.ts');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

function passedAt(commit: string) {
  return { command: 'node -e 0', commit, exit: 0, timed_out: false, skipped: false, passed: true, at: '2026-09-13T10:00:00Z' };
}

function finalize(requirements = 'AUTH-01,AUTH-02', tier = 'sequential') {
  return buildFinalize([
    '--phase', '3', '--plan', '01', '--base', base, '--engine', 'agents', '--tier', tier,
    '--fix-rounds', '1', '--requirements-completed', requirements,
  ], dir);
}

async function expectValidation(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(GSDError);
  expect((error as GSDError).classification).toBe('validation');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-finalize-'));
  git('init', '-q');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  await put('.planning/config.json', JSON.stringify({ commit_docs: true }));
  await put('.planning/ROADMAP.md', ROADMAP);
  await put('.planning/STATE.md', '# Project State\n\n**Current Phase:** 3\n**Status:** Executing\n');
  await put('.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in\n- [ ] **AUTH-02**: stay signed in\n');
  await put(`${PHASE_DIR}/03-CONTEXT.md`, CONTEXT);
  await put('src/app.ts', 'export const app = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore: initial');
  await put(`${PHASE_DIR}/03-01-PLAN.md`, BRIEF);
  git('add', '-A');
  git('commit', '-q', '-m', 'docs(03): build brief');
  base = git('rev-parse', 'HEAD');
  await put('src/app.ts', 'export const app = 2;\n');
  await put('src/auth/session.ts', 'export const session = true;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'feat(03-s1): session model');
  await put(`${PHASE_DIR}/03-VERIFICATION.md`, VERIFICATION);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('build.finalize', () => {
  it('fills frontmatter, finds IDs in tables, headings and XML, updates state and commits', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    // Only AUTH-01 is passed, so AUTH-02 must be found in the summary's XML block.
    const data = (await finalize('AUTH-01')).data as Record<string, unknown>;
    expect(data).toMatchObject({ ok: true, phase_complete: true });
    expect(typeof data.commit).toBe('string');

    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm).toMatchObject({
      phase: '03-user-auth', plan: '01', kind: 'build-summary', subsystem: 'auth', tags: ['auth', 'sessions'],
      provides: ['session cookies'], 'key-files': { created: ['src/auth/session.ts'], modified: ['src/app.ts'] },
      'requirements-completed': ['AUTH-01'],
    });
    expect(fm.build).toMatchObject({ engine: 'agents', tier: 'sequential', slices: ['s1'], fix_rounds: '1', checks_passed_at: 'null' });
    expect(Number.parseInt(String(fm.duration), 10)).toBeGreaterThanOrEqual(1);
    expect(git('log', '-1', '--format=%s')).toBe('docs(03): build summary and verification');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('refuses when a decision or requirement ID is missing and leaves state untouched', async () => {
    await put(SUMMARY_PATH, summary(['| D-01 | done | argon2id |', 'D-020 is a different decision.']));
    const stateBefore = await readFile(join(dir, '.planning/STATE.md'), 'utf-8');
    const headBefore = git('rev-parse', 'HEAD');
    const data = (await finalize('AUTH-01')).data;
    expect(data).toEqual({ ok: false, missing: { decisions: ['D-02'], requirements: ['AUTH-02'] } });
    expect(await readFile(join(dir, '.planning/STATE.md'), 'utf-8')).toBe(stateBefore);
    expect(git('rev-parse', 'HEAD')).toBe(headBefore);
  });

  it('does not count an ID passed only in --requirements-completed, on the first run or a rerun', async () => {
    await put(SUMMARY_PATH, summary(['## Decisions', '', '| Decision | Status | Notes |', '|---|---|---|', '| D-01 | done | argon2id |', '| D-02 | done | 30-day sessions |']));
    const refused = { ok: false, missing: { decisions: [], requirements: ['AUTH-02'] } };
    expect((await finalize('AUTH-01,AUTH-02')).data).toEqual(refused);
    // The first run wrote requirements-completed: [AUTH-01, AUTH-02] into the summary frontmatter.
    expect((await finalize('AUTH-01,AUTH-02')).data).toEqual(refused);
    const written = await readFile(join(dir, SUMMARY_PATH), 'utf-8');
    await writeFile(join(dir, SUMMARY_PATH), `${written}\n## Follow-ups\n\n- AUTH-02 is covered by the login tests\n`);
    expect((await finalize('AUTH-01,AUTH-02')).data).toMatchObject({ ok: true });
  });

  it('sets checks_passed_at only when every non-skipped check passed at the code head', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const head = codeHead(dir)!;
    const entry = (overrides: Record<string, unknown>) => ({
      command: 'node -e 0', commit: head, exit: 0, timed_out: false, skipped: false, passed: true, at: '2026-09-13T10:00:00Z', ...overrides,
    });
    writeJsonAtomic(join(buildStateDir(dir, '03')!, 'latest.json'), {
      build: entry({}),
      lint: entry({ command: null, commit: null, exit: null, skipped: true, passed: false }),
    });
    await finalize();
    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm.build).toMatchObject({ checks: { build: 'pass', lint: 'skipped' }, checks_passed_at: head });
  });

  it('leaves checks_passed_at null when a check failed or timed out', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const head = codeHead(dir)!;
    writeJsonAtomic(join(buildStateDir(dir, '03')!, 'latest.json'), {
      build: { command: 'node -e 0', commit: head, exit: 0, timed_out: false, skipped: false, passed: true, at: '2026-09-13T10:00:00Z' },
      test: { command: 'node -e 1', commit: head, exit: null, timed_out: true, skipped: false, passed: false, at: '2026-09-13T10:00:00Z' },
    });
    await finalize();
    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm.build).toMatchObject({ checks: { build: 'pass', test: 'timeout' }, checks_passed_at: 'null' });
  });

  it('counts results recorded at an earlier commit with the same code tree after a fix round', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const fullRun = codeHead(dir)!;
    await commitSource('export const app = 3;\n', 'fix(03-s1): try another app value');
    const head = await commitSource('export const app = 2;\n', 'fix(03-s1): restore the app value');
    expect(codeHead(dir)).toBe(head);
    // The fix round reran only build; test keeps its result from the full run.
    writeJsonAtomic(join(buildStateDir(dir, '03')!, 'latest.json'), { build: passedAt(head), test: passedAt(fullRun) });
    await finalize();
    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm.build).toMatchObject({ checks: { build: 'pass', test: 'pass' }, checks_passed_at: head });
  });

  it('leaves checks_passed_at null when a result was recorded at a commit with a different code tree', async () => {
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    const tried = await commitSource('export const app = 3;\n', 'fix(03-s1): try another app value');
    const head = await commitSource('export const app = 2;\n', 'fix(03-s1): restore the app value');
    writeJsonAtomic(join(buildStateDir(dir, '03')!, 'latest.json'), { build: passedAt(head), test: passedAt(tried) });
    await finalize();
    const fm = extractFrontmatter(await readFile(join(dir, SUMMARY_PATH), 'utf-8'));
    expect(fm.build).toMatchObject({ checks: { build: 'pass', test: 'pass' }, checks_passed_at: 'null' });
  });

  it('rejects a summary without subsystem or tags, a missing summary, a missing brief and a bad tier', async () => {
    await expectValidation(finalize());
    await put(SUMMARY_PATH, summary(COVERING_BODY, ['tags: [auth]']));
    await expectValidation(finalize());
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    await expectValidation(finalize('AUTH-01', 'everywhere'));
    await expectValidation(buildFinalize(['--phase', '3', '--plan', '02', '--base', base, '--engine', 'agents', '--tier', 'inline', '--fix-rounds', '0'], dir));
  });

  it('does not commit when commit_docs is false', async () => {
    await put('.planning/config.json', JSON.stringify({ commit_docs: false }));
    await put(SUMMARY_PATH, summary(COVERING_BODY));
    expect((await finalize()).data).toMatchObject({ ok: true, commit: null });
  });
});

describe('upsertFrontmatterKeys', () => {
  it('writes owned keys first and keeps the other blocks and the body', () => {
    const original = ['---', 'subsystem: auth', 'plan: 99', 'provides:', '  - "session cookies"', '---', '', '# Body', '', 'Text.', ''].join('\n');
    const result = upsertFrontmatterKeys(original, { plan: '01', build: { checks: {}, checks_passed_at: null, slices: ['s1'] } });
    expect(extractFrontmatter(result)).toMatchObject({ plan: '01', subsystem: 'auth', provides: ['session cookies'], build: { checks_passed_at: 'null', slices: ['s1'] } });
    expect(stripFrontmatter(result)).toBe(stripFrontmatter(original));
  });
});
```

- [ ] **Step 2: Run the unit test to verify it fails**

Run: `cd sdk && npx vitest run src/query/build-finalize.test.ts`
Expected: FAIL. Vitest cannot resolve `./build-finalize.js`.

- [ ] **Step 3: Write the failing tool-chain integration test**

Create `sdk/src/query/build-chain.integration.test.ts`. It follows the spec's "Tool chain without a model":

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizePhaseName } from './helpers.js';
import { buildWaves } from './build-brief.js';
import { buildMergeWave } from './build-merge.js';
import { buildRunChecks } from './build-checks.js';
import { initBuild } from './build-init.js';
import { buildFinalize } from './build-finalize.js';
import { roadmapAnalyze, requirementsMarkComplete } from './roadmap.js';
import { stateJson } from './state.js';
import { routeNextAction } from './route-next-action.js';

const PHASE_DIR = '.planning/phases/03-user-auth';
const BRIEF_PATH = `${PHASE_DIR}/03-01-PLAN.md`;
const tempDirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function put(root: string, file: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), content);
}

afterEach(async () => {
  while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true });
});

describe('build tool chain without a model', () => {
  it('builds, merges, checks, verifies and finalizes a two-slice phase', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-build-chain-'));
    const worktrees = await mkdtemp(join(tmpdir(), 'fvgsd-build-chain-wt-'));
    tempDirs.push(dir, worktrees);
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');

    await put(dir, '.planning/config.json', JSON.stringify({
      commit_docs: true,
      workflow: { build_command: 'node -e "process.exit(0)"', test_command: 'node -e "process.exit(0)"' },
    }));
    await put(dir, '.planning/ROADMAP.md', [
      '# Roadmap', '', '- [ ] **Phase 3: User Auth**', '- [ ] **Phase 4: Profiles**', '',
      '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '**Requirements:** AUTH-01, AUTH-02', '',
      '### Phase 4: Profiles', '', '**Goal:** Users can edit their profile', '**Requirements:** PROF-01', '',
    ].join('\n'));
    await put(dir, '.planning/STATE.md', '# Project State\n\n**Current Phase:** 3\n**Status:** Executing\n');
    await put(dir, '.planning/REQUIREMENTS.md', '- [ ] **AUTH-01**: sign in\n- [ ] **AUTH-02**: stay signed in\n');
    await put(dir, `${PHASE_DIR}/03-CONTEXT.md`, ['# Context', '', '<decisions>', '- **D-01:** argon2id hashing', '- **D-02:** 30-day sessions', '</decisions>', ''].join('\n'));
    await put(dir, BRIEF_PATH, [
      '---', 'phase: 03-user-auth', 'plan: 01', 'type: execute', 'kind: brief', 'wave: 1', 'depends_on: []',
      'files_modified: [src/auth/session.ts, src/routes/login.ts]', 'autonomous: true', 'requirements: [AUTH-01, AUTH-02]',
      'must_haves:', '  truths: []', 'slices:',
      '  - id: s1', '    goal: "Session model"', '    owns: ["src/auth/**"]', '    after: []',
      '  - id: s2', '    goal: "Login route"', '    owns: ["src/routes/**"]', '    after: []',
      '---', '<objective>', 'Users can sign in.', '</objective>', '',
      '## Decisions', '| Decision | Where it lands | Status |', '|---|---|---|',
      '| D-01 | s1: argon2id in src/auth/session.ts | planned |', '| D-02 | s1: session expiry | planned |', '',
    ].join('\n'));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'docs(03): build brief');
    const base = git(dir, 'rev-parse', 'HEAD');

    const { waves } = (await buildWaves([BRIEF_PATH], dir)).data as { waves: string[][] };
    expect(waves).toEqual([['s1', 's2']]);

    const results = [];
    for (const [slice, file, goal] of [['s1', 'src/auth/session.ts', 'session model'], ['s2', 'src/routes/login.ts', 'login route']]) {
      const worktree = join(worktrees, slice);
      git(dir, 'worktree', 'add', '-q', '-b', `worktree-agent-${slice}`, worktree, base);
      await put(worktree, file, `export const ${slice} = true;\n`);
      git(worktree, 'add', '-A');
      git(worktree, 'commit', '-q', '-m', `feat(03-${slice}): ${goal}`);
      results.push({ slice, status: 'done', commits: [git(worktree, 'rev-parse', 'HEAD')], branch: `worktree-agent-${slice}`, worktree_path: worktree });
    }

    const merge = (await buildMergeWave(['--phase', '3', '--base', base, '--results', JSON.stringify(results)], dir)).data as { merged: string[]; conflicts: unknown[] };
    expect(merge).toMatchObject({ merged: ['s1', 's2'], conflicts: [] });

    const checks = (await buildRunChecks(['--phase', '3', '--set', 'full'], dir)).data as { passed: boolean };
    expect(checks.passed).toBe(true);

    const before = (await initBuild(['3'], dir)).data as { resume: { state: string; base_commit: string; done_slices: string[] } };
    expect(before.resume).toMatchObject({ state: 'verifying', base_commit: base, done_slices: ['s1', 's2'] });

    await put(dir, `${PHASE_DIR}/03-VERIFICATION.md`, ['---', 'phase: 03-user-auth', 'verified: 2026-09-13T10:00:00Z', 'status: passed', 'score: 2/2', '---', '', '# Verification', ''].join('\n'));
    await put(dir, `${PHASE_DIR}/03-01-SUMMARY.md`, [
      '---', 'subsystem: auth', 'tags: [auth]', '---', '', '# Phase 3: User Auth — Build Summary', '',
      '## Decisions', '| Decision | Status | Notes |', '|---|---|---|', '| D-01 | done | argon2id |', '| D-02 | done | 30-day sessions |', '',
    ].join('\n'));

    const finalized = (await buildFinalize([
      '--phase', '3', '--plan', '01', '--base', before.resume.base_commit, '--engine', 'agents', '--tier', 'parallel',
      '--fix-rounds', '0', '--requirements-completed', 'AUTH-01,AUTH-02',
    ], dir)).data;
    expect(finalized).toMatchObject({ ok: true, phase_complete: true });

    const roadmap = (await roadmapAnalyze([], dir)).data as { phases: Array<{ number: string; roadmap_complete: boolean }> };
    expect(roadmap.phases.find((phase) => phase.number === '3')?.roadmap_complete).toBe(true);
    const requirements = (await requirementsMarkComplete(['AUTH-01,AUTH-02'], dir)).data as { already_complete: string[] };
    expect(requirements.already_complete).toEqual(['AUTH-01', 'AUTH-02']);
    const state = (await stateJson([], dir)).data as { current_phase: unknown };
    expect(normalizePhaseName(String(state.current_phase))).toBe('04');
    expect((await routeNextAction([], dir)).data).toMatchObject({ command: '/fvgsd-discuss-phase', args: '04' });
    expect(((await initBuild(['3'], dir)).data as { resume: { state: string } }).resume.state).toBe('complete');
  }, 120_000);
});
```

- [ ] **Step 4: Run the integration test to verify it fails**

Run: `cd sdk && npx vitest run --project integration src/query/build-chain.integration.test.ts`
Expected: FAIL. Vitest cannot resolve `./build-finalize.js`.

- [ ] **Step 5: Write the handler**

Create `sdk/src/query/build-finalize.ts`:

```ts
/**
 * build.finalize — close a build: fill the summary frontmatter, check that
 * every CONTEXT decision and phase requirement ID appears in the brief or in
 * the summary as the lead wrote it, update STATE, ROADMAP and REQUIREMENTS
 * through the existing handlers, and commit. See the spec's "Summary and finalize".
 */

import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { GSDError, ErrorClassification } from '../errors.js';
import { commit } from './commit.js';
import { parseDecisions } from './decisions.js';
import { extractFrontmatter } from './frontmatter.js';
import { escapeRegex, planningPaths, toPosixPath } from './helpers.js';
import { phaseComplete } from './phase-lifecycle.js';
import { requirementsMarkComplete } from './roadmap.js';
import { roadmapUpdatePlanProgress } from './roadmap-update-plan-progress.js';
import { stateRecordMetric, stateUpdateProgress } from './state-mutation.js';
import { readLatestChecks } from './build-checks.js';
import {
  changedFilesSince,
  codeHead,
  listPhasePlanFiles,
  parseFlags,
  phaseRequirementIds,
  readVerification,
  resolveBuildPhase,
  runGit,
} from './build-shared.js';
import type { QueryHandler } from './utils.js';

const ENGINES = ['agents', 'workflow'];
const TIERS = ['parallel', 'sequential', 'inline'];
const SHA_RE = /^[0-9a-f]{40,64}$/;

function invalid(message: string): never {
  throw new GSDError(message, ErrorClassification.Validation);
}

function yamlScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = String(value);
  // No ':' in plain scalars: extractFrontmatter reads a list item such as `- a:b` as a map.
  const plain = /^[A-Za-z0-9_./@+-][A-Za-z0-9_ ./@+-]*$/.test(text)
    && text.trim() === text
    && !/^(?:true|false|null|yes|no|on|off|~)$/i.test(text);
  return plain ? text : JSON.stringify(text);
}

function yamlLines(key: string, value: unknown, indent: string): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}${key}: []`];
    return [`${indent}${key}:`, ...value.map((item) => `${indent}  - ${yamlScalar(item)}`)];
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return [`${indent}${key}: {}`];
    return [`${indent}${key}:`, ...entries.flatMap(([child, childValue]) => yamlLines(child, childValue, `${indent}  `))];
  }
  return [`${indent}${key}: ${yamlScalar(value)}`];
}

/** The frontmatter lines outside `ownedKeys` (nested lines follow their key), and the body. */
function withoutOwnedKeys(content: string, ownedKeys: ReadonlySet<string>): { kept: string[]; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const kept: string[] = [];
  if (match) {
    let keep = true;
    for (const line of match[1].split('\n')) {
      const key = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*):(?:\s|$)/)?.[1];
      if (key !== undefined) keep = !ownedKeys.has(key);
      if (keep) kept.push(line);
    }
  }
  return { kept, body: match ? normalized.slice(match[0].length) : `\n${normalized}` };
}

/** Write `owned` keys first; keep every other top-level frontmatter block and the body unchanged. */
export function upsertFrontmatterKeys(content: string, owned: Record<string, unknown>): string {
  const { kept, body } = withoutOwnedKeys(content, new Set(Object.keys(owned)));
  const lines = [...Object.entries(owned).flatMap(([key, value]) => yamlLines(key, value, '')), ...kept];
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

function mentions(text: string, id: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegex(id)}(?![A-Za-z0-9_-])`).test(text);
}

/** Decision 15: a result recorded at `commit` counts for `head` when both have the same tree outside `.planning/`. */
function sameCodeTree(projectDir: string, commit: string | null, head: string): boolean {
  if (typeof commit !== 'string' || !SHA_RE.test(commit)) return false;
  return commit === head || runGit(projectDir, ['diff', '--quiet', commit, head, '--', '.', ':(exclude).planning']).ok;
}

function firstAddTime(projectDir: string, relFile: string): string | null {
  const log = runGit(projectDir, ['log', '--diff-filter=A', '--format=%cI', '--', relFile]);
  if (!log.ok || log.stdout === '') return null;
  const lines = log.stdout.split('\n');
  return lines[lines.length - 1];
}

export const buildFinalize: QueryHandler = async (args, projectDir, workstream) => {
  const { flags } = parseFlags(args, {
    values: ['phase', 'plan', 'base', 'engine', 'tier', 'fix-rounds', 'requirements-completed'],
  });
  const phaseArg = flags.phase;
  const plan = flags.plan;
  const base = flags.base;
  const engine = flags.engine;
  const tier = flags.tier;
  if (typeof phaseArg !== 'string') invalid('--phase is required');
  if (typeof plan !== 'string' || !/^\d{2,}$/.test(plan)) invalid('--plan must be a plan number such as 01');
  if (typeof base !== 'string' || !runGit(projectDir, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) {
    invalid('--base must name an existing commit');
  }
  if (typeof engine !== 'string' || !ENGINES.includes(engine)) invalid(`--engine must be one of ${ENGINES.join(', ')}`);
  if (typeof tier !== 'string' || !TIERS.includes(tier)) invalid(`--tier must be one of ${TIERS.join(', ')}`);
  const fixRounds = Number(flags['fix-rounds']);
  if (typeof flags['fix-rounds'] !== 'string' || !Number.isInteger(fixRounds) || fixRounds < 0) {
    invalid('--fix-rounds must be a non-negative integer');
  }
  const completedRaw = flags['requirements-completed'];
  const completedIds = typeof completedRaw === 'string'
    ? [...new Set(completedRaw.split(/[,\s]+/).map((id) => id.trim()).filter(Boolean))]
    : [];

  const phase = await resolveBuildPhase(projectDir, phaseArg, workstream);
  if (!phase) invalid(`phase ${phaseArg} not found`);
  const planFile = listPhasePlanFiles(phase.dirAbs, phase.padded).find((candidate) => candidate.nn === plan);
  if (!planFile || planFile.kind !== 'brief') invalid(`no build brief for plan ${plan} in ${phase.dir}`);
  const summaryRel = `${phase.dir}/${phase.padded}-${plan}-SUMMARY.md`;
  const summaryAbs = join(projectDir, summaryRel);
  if (!existsSync(summaryAbs)) invalid(`write ${summaryRel} (body, subsystem, tags) before running build.finalize`);
  const summaryContent = await readFile(summaryAbs, 'utf-8');
  const leadFrontmatter = extractFrontmatter(summaryContent);
  const missingKeys = ['subsystem', 'tags'].filter((key) => leadFrontmatter[key] === undefined || leadFrontmatter[key] === '');
  if (missingKeys.length > 0) invalid(`summary frontmatter is missing: ${missingKeys.join(', ')}`);

  // 1. Summary frontmatter
  const now = new Date();
  const briefRel = `${phase.dir}/${planFile.file}`;
  const startedIso = firstAddTime(projectDir, briefRel) ?? now.toISOString();
  const startedMs = Date.parse(startedIso);
  const minutes = Number.isFinite(startedMs) ? Math.max(1, Math.round((now.getTime() - startedMs) / 60000)) : 1;
  const changes = changedFilesSince(projectDir, base);
  const created = changes.filter((change) => change.status === 'A').map((change) => change.path);
  const modified = changes.filter((change) => change.status !== 'A' && change.status !== 'D').map((change) => change.path);

  const head = codeHead(projectDir);
  const checks: Record<string, string> = {};
  let ran = 0;
  let allPassedAtHead = head !== null;
  for (const [name, entry] of Object.entries(readLatestChecks(projectDir, phase.padded))) {
    if (entry.skipped) {
      checks[name] = 'skipped';
      continue;
    }
    ran += 1;
    checks[name] = entry.passed ? 'pass' : entry.timed_out ? 'timeout' : 'fail';
    if (!entry.passed || head === null || !sameCodeTree(projectDir, entry.commit, head)) allPassedAtHead = false;
  }

  const owned: Record<string, unknown> = {
    phase: basename(phase.dir),
    plan,
    kind: 'build-summary',
    duration: `${minutes}min`,
    completed: now.toISOString().slice(0, 10),
    'key-files': { created, modified },
    'requirements-completed': completedIds,
    build: {
      started: startedIso,
      completed: now.toISOString(),
      engine,
      tier,
      slices: planFile.sliceIds,
      fix_rounds: fixRounds,
      checks,
      checks_passed_at: allPassedAtHead && ran > 0 ? head : null,
    },
  };
  await writeFile(summaryAbs, upsertFrontmatterKeys(summaryContent, owned), 'utf-8');

  // 2. ID coverage over the brief and the summary as the lead wrote it. Keys finalize owns,
  // requirements-completed included (from this run or an earlier one), never count.
  const contextFile = readdirSync(phase.dirAbs).sort().find((file) => file === 'CONTEXT.md' || file.endsWith('-CONTEXT.md'));
  const decisionIds = contextFile
    ? [...new Set(parseDecisions(await readFile(join(phase.dirAbs, contextFile), 'utf-8')).map((decision) => decision.id))]
    : [];
  const requirementIds = await phaseRequirementIds(projectDir, phase.number, workstream);
  const leadSummary = withoutOwnedKeys(summaryContent, new Set(Object.keys(owned)));
  const searchable = [await readFile(join(phase.dirAbs, planFile.file), 'utf-8'), ...leadSummary.kept, leadSummary.body].join('\n');
  const missing = {
    decisions: decisionIds.filter((id) => !mentions(searchable, id)),
    requirements: requirementIds.filter((id) => !mentions(searchable, id)),
  };
  if (missing.decisions.length > 0 || missing.requirements.length > 0) {
    return { data: { ok: false, missing } };
  }

  // 3. State updates through the existing handlers
  const warnings: string[] = [];
  const step = async (label: string, run: () => Promise<{ data: unknown }>): Promise<boolean> => {
    try {
      const { data } = await run();
      const error = data && typeof data === 'object' ? (data as Record<string, unknown>).error : undefined;
      if (typeof error !== 'string') return true;
      warnings.push(`${label}: ${error}`);
    } catch (err) {
      warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  };
  await step('state.update-progress', () => stateUpdateProgress([], projectDir, workstream));
  await step('state.record-metric', () => stateRecordMetric([
    '--phase', phase.padded, '--plan', plan, '--duration', `${minutes}min`,
    '--tasks', String(planFile.sliceIds.length), '--files', String(created.length + modified.length),
  ], projectDir, workstream));
  await step('roadmap.update-plan-progress', () => roadmapUpdatePlanProgress([phase.padded], projectDir, workstream));
  if (completedIds.length > 0) {
    await step('requirements.mark-complete', () => requirementsMarkComplete(completedIds, projectDir, workstream));
  }
  const verification = readVerification(phase.dirAbs, phase.padded);
  const phaseCompleted = verification?.status === 'passed'
    && await step('phase.complete', () => phaseComplete([phase.padded], projectDir, workstream));

  // 4. Commit
  const paths = planningPaths(projectDir, workstream);
  const files = [summaryAbs, verification?.path ?? '', join(phase.dirAbs, `${phase.padded}-HUMAN-UAT.md`), paths.state, paths.roadmap, paths.requirements]
    .filter((file) => file !== '' && existsSync(file))
    .map((file) => toPosixPath(relative(projectDir, file)));
  let commitHash: string | null = null;
  try {
    const { data } = await commit([`docs(${phase.padded}): build summary and verification`, '--files', ...files], projectDir, workstream);
    const record = data as Record<string, unknown>;
    if (record.committed === true && typeof record.hash === 'string') commitHash = record.hash;
    else if (typeof record.reason === 'string' && record.reason !== 'commit_docs disabled') warnings.push(`commit: ${record.reason}`);
  } catch (err) {
    warnings.push(`commit: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { data: { ok: true, phase_complete: phaseCompleted === true, commit: commitHash, warnings } };
};
```

- [ ] **Step 6: Register the query**

In `sdk/src/query/command-manifest.non-family.ts`, insert this line directly above `  { canonical: 'agent.classify-failure', aliases: ['agent classify-failure'], mutation: false, outputMode: 'json' },`:

```ts
  { canonical: 'build.finalize', aliases: ['build finalize'], mutation: true, outputMode: 'json' },
```

In `sdk/src/query/command-static-catalog-domain.ts`, make two insertions:
- directly below `import { promptBudget } from './prompt-budget.js';`, add:

  ```ts
  import { buildFinalize } from './build-finalize.js';
  ```

- directly above `  ['prompt-budget', promptBudget],`, add:

  ```ts
    ['build.finalize', buildFinalize],
    ['build finalize', buildFinalize],
  ```

Regenerate the aliases and check them:

```bash
(cd sdk && npx tsx scripts/gen-command-aliases.ts)
npm run check:alias-drift
```

Expected: both exit 0.

- [ ] **Step 7: Write the summary reference**

Create `get-shit-done/references/build-summary.md`:

````markdown
# Build Summary Format

After verification and fix rounds, the build lead writes `{P}-{NN}-SUMMARY.md` and runs `fvgsd-sdk query build.finalize`. Finalize owns part of the frontmatter. The lead owns the rest of the frontmatter and the whole body.

## Frontmatter the lead writes

```yaml
---
subsystem: auth            # required: primary area (auth, payments, ui, api, database, infra, testing, …)
tags: [sessions, argon2]   # required: searchable technologies
provides:                  # optional: what later phases can rely on
  - "Session cookies with 30-day expiry"
key-decisions:             # optional
  - "argon2id for password hashing"
---
```

## Frontmatter finalize writes

Finalize overwrites these keys on every run. Don't write them by hand.

| Key | Value |
|---|---|
| `phase`, `plan`, `kind` | phase folder name, plan number, `build-summary` |
| `duration`, `completed` | minutes since the brief was committed; today's date |
| `key-files.created`, `key-files.modified` | `git diff --name-status <base>..HEAD` outside `.planning/` |
| `requirements-completed` | the IDs passed with `--requirements-completed` |
| `build` | `started`, `completed`, `engine`, `tier`, `slices`, `fix_rounds`, `checks`, `checks_passed_at` |

`checks_passed_at` is the latest first-parent commit outside `.planning/`. It is set only when at least one check ran and every non-skipped check's latest result passed at a commit whose code tree (everything outside `.planning/`) is identical to that commit's, otherwise it is `null`. The next build uses it to decide whether a baseline run is needed. Every key finalize doesn't own stays exactly as the lead wrote it.

## Body

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

## ID coverage

Finalize collects every `D-XX` from the CONTEXT `<decisions>` blocks and every requirement ID in the phase's ROADMAP section. It then searches the brief and the summary as the lead wrote it for each one. Keys finalize writes don't count, so an ID passed only with `--requirements-completed` is still missing.
- **Where a match counts:** anywhere, whether a table cell, a heading, prose or an XML block.
- **Whole IDs only:** `D-01` inside `D-010` doesn't count.

When an ID is missing, finalize changes no state and returns:

```json
{ "ok": false, "missing": { "decisions": ["D-04"], "requirements": ["AUTH-03"] } }
```

To fix it:
1. Add one line per missing ID to the summary: a Decisions row such as `| D-04 | deferred | moved to a later phase per CONTEXT |`, or a Follow-ups line for a requirement.
2. Run finalize again with the same arguments.

## Result

```json
{ "ok": true, "phase_complete": true, "commit": "<sha>", "warnings": [] }
```

- **`phase_complete`** is true only when VERIFICATION.md has `status: passed`.
- **`commit`** is null when `commit_docs` is false.
- **`warnings`** lists state updates that reported an error. Mention them in the final output.
````

- [ ] **Step 8: Add the reference to the inventory**

In `docs/INVENTORY.md`:

1. Change the heading `## References (62 shipped)` (Task 3 raised it to 62) to `## References (63 shipped)`.
2. In the "Workflow References" table, directly below the row that starts with ``| `verify-mvp-mode.md` |``, add this row. It deliberately names no slash command, because docs may only name commands that already exist, and the build command only arrives in Task 10:

   ```markdown
   | `build-summary.md` | Build summary format: the frontmatter keys the lead writes versus those `build.finalize` writes, and the ID coverage rule. |
   ```
3. In the `few-shot-examples` note below the references tables, replace `These are not counted in the 62 top-level references.` (Task 3 set it to 62) with `These are not counted in the 63 top-level references.`, so it matches the heading.

Regenerate the manifest:

```bash
node scripts/gen-inventory-manifest.cjs --write
node scripts/gen-inventory-manifest.cjs --check
```

Expected: `--check` exits 0.

- [ ] **Step 9: Run the tests to verify they pass**

```bash
(cd sdk && npx vitest run src/query/build-finalize.test.ts src/query/command-definition.test.ts src/query/command-seam-coverage.test.ts)
(cd sdk && npx vitest run --project integration src/query/build-chain.integration.test.ts)
node --test tests/inventory-counts.test.cjs tests/inventory-manifest-sync.test.cjs tests/inventory-source-parity.test.cjs tests/docs-parity-live-registry.test.cjs tests/gsd-sdk-query-registry-integration.test.cjs tests/feat-3598-generator-correctness.test.cjs
```

Expected: PASS.

- [ ] **Step 10: Compare both suites with the baselines**

This task completes the build queries, so run the SDK suite as well as the root suite:

```bash
npm test > "$WS/task-9-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-9-root.log"
(cd sdk && npm test > "../$WS/task-9-sdk.log" 2>&1)
node "$WS/compare-failures.cjs" "$WS/baseline-sdk.log" "$WS/task-9-sdk.log"
```

Expected: both print `"newFailures": []`.

- [ ] **Step 11: Commit**

```bash
git add sdk/src/query/build-finalize.ts sdk/src/query/build-finalize.test.ts sdk/src/query/build-chain.integration.test.ts \
  sdk/src/query/command-manifest.non-family.ts sdk/src/query/command-static-catalog-domain.ts \
  sdk/src/query/command-aliases.generated.ts get-shit-done/bin/lib/command-aliases.generated.cjs \
  get-shit-done/references/build-summary.md docs/INVENTORY.md docs/INVENTORY-MANIFEST.json
git commit -m "feat(sdk): add build.finalize query and summary reference"
```

---

### Task 10: `/fvgsd-build` command and workflow

**Files:**
- Create: `commands/gsd/build.md`
- Create: `get-shit-done/workflows/build.md`
- Create: `tests/fvgsd-build-command.test.cjs`
- Modify: `get-shit-done/bin/lib/clusters.cjs`, `get-shit-done/bin/lib/install-profiles.cjs`, `tests/runtime-artifact-layout-install-profiles.test.cjs`, `commands/gsd/ns-workflow.md`
- Modify: `docs/COMMANDS.md`, `docs/USER-GUIDE.md`, `README.md`, `docs/AGENTS.md`, `docs/INVENTORY.md`, `docs/INVENTORY-MANIFEST.json` (regenerated)

**Interfaces:**
- **Consumes:**
  - `init.build` (Task 8)
  - `build.check-brief` and `build.waves` (Task 3)
  - `build.run-checks` (Task 2)
  - `build.scan-stubs` (Task 5)
  - `build.merge-wave` (Task 6)
  - `build.group-problems` (Task 7)
  - `build.finalize` and `get-shit-done/references/build-summary.md` (Task 9)
  - the `fvgsd-builder` agent and the verifier `<build_mode>` block (Task 4)
  - existing queries `agent-skills`, `resolve-model`, `commit`, `state.begin-phase`, `state.add-blocker`, `roadmap.analyze`
- **Produces:**
  - the slash command `/fvgsd-build` (skill stem `build`)
  - workflow steps `parse_args`, `initialize`, `research`, `baseline`, `brief`, `approve`, `waves`, `checks`, `verify`, `fix_rounds`, `summary`, `next`
  - end markers `## BUILD COMPLETE`, `## BUILD GAPS FOUND`, `## BUILD BLOCKED`, `## BUILD STOPPED`, which Task 12 routes on

- [ ] **Step 1: Write the failing test**

Create `tests/fvgsd-build-command.test.cjs`:

```js
// allow-test-rule: source-text-is-the-product
// commands/gsd/build.md and get-shit-done/workflows/build.md are loaded verbatim by the
// runtime: their frontmatter, step list, agent roster and end markers are the deployed contract.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('./helpers.cjs');
const { loadSkillsManifest, PROFILES } = require('../get-shit-done/bin/lib/install-profiles.cjs');
const { CLUSTERS } = require('../get-shit-done/bin/lib/clusters.cjs');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands', 'gsd');
const COMMAND_PATH = path.join(COMMANDS_DIR, 'build.md');
const WORKFLOW_PATH = path.join(ROOT, 'get-shit-done', 'workflows', 'build.md');

const STEP_NAMES = ['parse_args', 'initialize', 'research', 'baseline', 'brief', 'approve', 'waves', 'checks', 'verify', 'fix_rounds', 'summary', 'next'];
const END_MARKERS = ['## BUILD BLOCKED', '## BUILD COMPLETE', '## BUILD GAPS FOUND', '## BUILD STOPPED'];
const AGENTS = ['fvgsd-builder', 'fvgsd-code-reviewer', 'fvgsd-phase-researcher', 'fvgsd-verifier'];

function workflowSteps(content) {
  return [...content.matchAll(/<step name="([^"]+)">([\s\S]*?)<\/step>/g)].map((m) => ({ name: m[1], body: m[2] }));
}

describe('/fvgsd-build command', () => {
  test('frontmatter names the command and its arguments', () => {
    const fm = parseFrontmatter(fs.readFileSync(COMMAND_PATH, 'utf8'));
    assert.equal(fm.name, 'fvgsd:build');
    assert.equal(fm['argument-hint'], '<phase> [--confirm] [--gaps] [--research-only] [--brief-only]');
  });

  test('requires the commands its body routes to', () => {
    const manifest = loadSkillsManifest(COMMANDS_DIR);
    assert.deepEqual([...manifest.get('build')].sort(), ['discuss-phase', 'execute-phase', 'verify-work']);
  });

  test('names every agent the workflow spawns so install profiles stage them', () => {
    const manifest = loadSkillsManifest(COMMANDS_DIR);
    const referenced = manifest.get('_calls_agents_build');
    for (const agent of AGENTS) {
      assert.ok(referenced.includes(agent), `${agent} is not named in commands/gsd/build.md`);
    }
  });

  test('ships in the core and standard profiles and the core loop cluster', () => {
    assert.ok(PROFILES.core.includes('build'));
    assert.ok(PROFILES.standard.includes('build'));
    assert.ok(CLUSTERS.core_loop.includes('build'));
  });
});

describe('build workflow', () => {
  test('keeps its steps in order', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    assert.deepEqual(workflowSteps(content).map((step) => step.name), STEP_NAMES);
  });

  test('stays within 400 lines', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
    assert.ok(lines <= 400, `build.md has ${lines} lines`);
  });

  test('lists exactly the spawned agent types', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const block = content.match(/<available_agent_types>([\s\S]*?)<\/available_agent_types>/);
    assert.ok(block, 'missing <available_agent_types>');
    const listed = [...block[1].matchAll(/^- (fvgsd-[a-z-]+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(listed, AGENTS);
  });

  test('no runner-visible line is removed by the SDK prompt sanitizer', async () => {
    // The SDK phase runner keeps only <purpose> and the steps, then drops whole lines
    // that hold slash commands or interactive directives (sdk/src/prompt-sanitizer.ts).
    const { sanitizePrompt } = await import('../sdk/dist/prompt-sanitizer.js');
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const purpose = content.match(/<purpose>([\s\S]*?)<\/purpose>/)[1];
    const lines = [purpose, ...workflowSteps(content).map((step) => step.body)]
      .join('\n')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const removed = lines.filter((line) => sanitizePrompt(line).trim() !== line.trim());
    assert.deepEqual(removed, []);
  });

  test('the next step prints the four end markers', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const next = workflowSteps(content).find((step) => step.name === 'next');
    assert.ok(next, 'missing next step');
    const markers = [...next.body.matchAll(/^## BUILD [A-Z ]+$/gm)].map((m) => m[0]);
    assert.deepEqual([...new Set(markers)].sort(), END_MARKERS);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/fvgsd-build-command.test.cjs`
Expected: FAIL — `ENOENT: no such file or directory, open '.../commands/gsd/build.md'`, and `PROFILES.core` has no `build`.

- [ ] **Step 3: Create the command**

Create `commands/gsd/build.md`:

````markdown
---
name: fvgsd:build
description: Plan and execute a discussed phase in one step with slices, checks, and verification
argument-hint: "<phase> [--confirm] [--gaps] [--research-only] [--brief-only]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Agent
  - TodoWrite
  - AskUserQuestion
requires: [discuss-phase, execute-phase, verify-work]
---
<objective>
Take a discussed phase to a verified implementation in one run: research only when RESEARCH.md is missing, write a short build brief, build it in vertical slices, run the project's checks, verify once, fix what remains in capped rounds, and write the build summary.

Agents: fvgsd-builder writes the brief and builds slices, fvgsd-verifier verifies in build mode, fvgsd-phase-researcher runs only when RESEARCH.md is missing, and fvgsd-code-reviewer runs only when `workflow.build_code_review` is true.

Prerequisite: the phase has CONTEXT.md from /fvgsd:discuss-phase. A phase that already has plans from plan-phase continues with /fvgsd:execute-phase. When human-only checks remain after the build, follow up with /fvgsd:verify-work.

Flag handling rule:
- The flags documented below are available behaviors, not implied active behaviors.
- A flag is active only when its literal token appears in `$ARGUMENTS`.
- If a documented flag is absent from `$ARGUMENTS`, treat it as inactive.
</objective>

<execution_context>
@~/.claude/fvgsd/workflows/build.md
@~/.claude/fvgsd/references/ui-brand.md
</execution_context>

<runtime_note>
**Copilot (VS Code):** Use `vscode_askquestions` wherever this workflow calls `AskUserQuestion`.
</runtime_note>

<context>
Phase: $ARGUMENTS

**Available optional flags (documentation only — not automatically active):**
- `--confirm` — show the brief's objective, slices and decisions, and ask before building.
- `--gaps` — build a follow-up plan that closes the gaps listed in the phase's VERIFICATION.md.
- `--research-only` — research the phase (only when RESEARCH.md is missing), then stop.
- `--brief-only` — write and check the brief, then stop.

Context files are resolved inside the workflow via `fvgsd-sdk query init.build`, and agents receive paths, not file contents.
</context>

<process>
Execute end-to-end.
Preserve all workflow gates (brief check, approval, user setup, slice results, merges, checks, verification, fix-round cap, finalize).
</process>
````

Add the execution-branch guard:

```bash
node scripts/sync-execution-branch-guards.cjs
npm run check:execution-branch-guards
```

Expected: the check exits 0, and the script has inserted this block directly after the frontmatter of `commands/gsd/build.md`:

```markdown
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch ensure "build" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>
```

- [ ] **Step 4: Create the workflow**

Create `get-shit-done/workflows/build.md`:

````markdown
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
- `gaps_found` with `resume.summary` not null → say gaps remain; `OUTCOME=gaps`, `NEXT=build {PHASE} --gaps` → `next`.

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

`waves` lists slice ids in the order they must run. Skip slices already done (`resume.done_slices`, or a kept `status: done` result); a kept `blocked` or `partial` result goes to **Slice results** below. For every other slice the builder prompt is:

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
4. For each `conflicts` entry: spawn one builder without `isolation`, with `merge_from: {current branch}`, `worktree_path: {that slice's worktree}`, `other_slice_notes: {the other slices' notes}` and `fix_goal: merge {merge_from} into this slice branch and resolve the conflict in {files}`. It commits `fix({P}-{slice}): resolve merge with {other}`. Then rerun `build.merge-wave` with only that slice's result and `--base "$(git rev-parse HEAD)"`, because the slice branch now contains the current HEAD.
5. Show each `blocked` entry (slice, reason, detail) together with each `skipped` entry (slice, reason). Any `blocked` entry → `OUTCOME=blocked` → `next`.

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

Add results that fail (`exit` not 0 or `timed_out`) with `preexisting: false` to `KNOWN_FAILURES` for the next wave. Do not stop for them; the fix rounds handle what remains.
</step>

<step name="checks">
```bash
fvgsd-sdk query build.run-checks --phase {N} --set full
fvgsd-sdk query build.scan-stubs --base "{BASE}"
```

A **new failure** is a result that is not skipped, fails (`exit` not 0 or `timed_out`), and either has `preexisting: false` or has `preexisting: true` with an `output_tail` naming different failing tests or errors than the baseline's (`$(git rev-parse --git-common-dir)/fvgsd/build/{P}/baseline.json`). Record skipped commands as skipped.

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
4. Rerun only what failed, plus build and typecheck:
   ```bash
   fvgsd-sdk query build.run-checks --phase {N} --set full --only <failed names>,build,typecheck
   fvgsd-sdk query build.scan-stubs --base "{BASE}"
   ```
5. Recheck: spawn the verifier with the same `<build_mode>` block, updated `checks_json` and `stubs_json`, and `recheck_gaps:` set to the open gaps' truths. It rewrites `{VERIFICATION}`.
6. Rebuild the problem list. If the count is not lower than `PREV_COUNT`, stop the loop.

When problems remain, VERIFICATION.md keeps `status: gaps_found` and they go into the summary's Follow-ups.
</step>

<step name="summary">
Read `~/.claude/fvgsd/references/build-summary.md`. With the Write tool, write `{SUMMARY}`: frontmatter holding only `subsystem` and `tags` (finalize fills the rest), then the body sections from that reference — what each slice built with commit hashes, the Decisions table covering every D-XX in CONTEXT, deviations from the brief, checks (including pre-existing failures and skipped commands), verification status linking `{P}-VERIFICATION.md`, review Warning/Info findings, and follow-ups.

`IDS` = the requirement IDs this build satisfied: every ID in `inputs.requirement_ids` when verification passed, otherwise only those VERIFICATION.md shows satisfied.

```bash
fvgsd-sdk query build.finalize --phase {N} --plan {PLAN} --base "{BASE}" --engine agents --tier {TIER} --fix-rounds {ROUND} --requirements-completed "{IDS joined with commas}"
```

Pass `--requirements-completed` only when `IDS` holds at least one ID; otherwise omit the flag, because an empty value is rejected.

- `ok: false` → for every ID in `missing.decisions` and `missing.requirements`, add a line to the summary saying where it landed or why it was deferred, then run finalize again.
- `ok: true` → keep `phase_complete`, `commit` and `warnings`. `OUTCOME=complete` when VERIFICATION.md is `passed` (or `human_needed` with `human_checks: defer`), `OUTCOME=gaps` when it is `gaps_found`, and `OUTCOME=stopped` when it is `human_needed` with `human_checks: block`.
</step>

<step name="next">
If a background baseline is still running, wait for it to finish. Then print a short actions-taken report: slices built, merge-wave `blocked` and `skipped` slices, commits, checks (pass, fail, skipped, pre-existing), verification status, fix rounds used, and any `warnings`.

Then suggest one next command in this runtime's command form (the fvgsd command prefix followed by the name and arguments below). Use `NEXT` when a step set it; otherwise:
- The phase is complete → `fvgsd-sdk query roadmap.analyze`: take the first later phase that is not complete. Suggest `build <it>` only when it has CONTEXT.md (`has_context` true) and no plans yet (`disk_status` `discussed` or `researched`), `discuss-phase <it>` otherwise, and `complete-milestone` when no phase remains.
- Gaps remain → `build {N} --gaps`
- HUMAN-UAT items are pending → `verify-work {N}`

When `fvgsd-sdk query config-get workflow.build_mode --default true` prints `false`, suggest `plan-phase` in place of `build` in any suggestion above or in `NEXT` (`build {N} --gaps` becomes `plan-phase {N} --gaps`).

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
````

Check the length:

```bash
wc -l get-shit-done/workflows/build.md
```

Expected: 400 or fewer (the content above is 342 lines).

The SDK phase runner keeps only `<purpose>` and the steps, then `sdk/src/prompt-sanitizer.ts` deletes every line holding a slash-command token (a slash, the fvgsd or gsd prefix, then `-` or `:`), `AskUserQuestion(`, `SlashCommand(`, "ask the user" or "wait for the user". So the workflow names commands without the slash (for example `discuss-phase 3`) and never writes those phrases. The new test checks this with the real sanitizer.

- [ ] **Step 5: Register the command surface**

In `get-shit-done/bin/lib/clusters.cjs`, replace:

```js
  core_loop: Object.freeze([
    'new-project',
    'discuss-phase',
```

with:

```js
  core_loop: Object.freeze([
    'new-project',
    'discuss-phase',
    'build',
```

In `get-shit-done/bin/lib/install-profiles.cjs`, replace:

```js
 *  - core     — nine skills covering the main project loop and Vibe entry surface
```

with:

```js
 *  - core     — ten skills covering the main project loop and Vibe entry surface
```

Replace:

```js
  core: Object.freeze([
    'new-project',
    'discuss-phase',
```

with:

```js
  core: Object.freeze([
    'new-project',
    'discuss-phase',
    'build',
```

and replace:

```js
    // Core loop
    'new-project',
    'discuss-phase',
```

with:

```js
    // Core loop
    'new-project',
    'discuss-phase',
    'build',
```

In `tests/runtime-artifact-layout-install-profiles.test.cjs`, replace:

```js
  test('PROFILES.core contains the 9 main-loop skills (including Vibe routing)', () => {
    const core = PROFILES.core;
    assert.ok(Array.isArray(core), 'core should be an array');
    const sorted = [...core].sort();
    assert.deepStrictEqual(sorted, [
      'discuss-phase',
```

with:

```js
  test('PROFILES.core contains the 10 main-loop skills (including build and Vibe routing)', () => {
    const core = PROFILES.core;
    assert.ok(Array.isArray(core), 'core should be an array');
    const sorted = [...core].sort();
    assert.deepStrictEqual(sorted, [
      'build',
      'discuss-phase',
```

This renames one test title; list the old title under `missingTitles` in your report.

In `commands/gsd/ns-workflow.md`:
- Replace `description: "workflow | discuss plan execute verify phase progress"` with `description: "workflow | discuss build plan execute verify phase progress"`.
- Replace `requires: [discuss-phase, spec-phase, plan-phase, execute-phase, verify-work, phase, progress, ultraplan-phase, plan-review-convergence]` with `requires: [discuss-phase, spec-phase, build, plan-phase, execute-phase, verify-work, phase, progress, ultraplan-phase, plan-review-convergence]`.
- Replace the row `| Clarify what a phase delivers | fvgsd-spec-phase |` with:

```markdown
| Clarify what a phase delivers | fvgsd-spec-phase |
| Plan and execute a discussed phase in one step | fvgsd-build |
```

- [ ] **Step 6: Document the command**

In `docs/COMMANDS.md`, insert this block immediately before the line `` ### `/fvgsd-plan-phase` ``:

````markdown
### `/fvgsd-build`

Plan and execute a discussed phase in one step: a short brief, vertical slices (parallel where the runtime allows), the project's own checks, one verifier pass, and capped fix rounds.

| Argument | Required | Description |
|----------|----------|-------------|
| `N` | **Yes** | Phase number to build |

| Flag | Description |
|------|-------------|
| `--confirm` | Show the brief's objective, slices and decisions, and ask before building |
| `--gaps` | Build a follow-up plan that closes the gaps listed in VERIFICATION.md |
| `--research-only` | Research the phase (only when RESEARCH.md is missing), then stop |
| `--brief-only` | Write and check the brief, then stop |

**Prerequisites:** the phase has CONTEXT.md (`/fvgsd-discuss-phase N`)
**Produces:** `{phase}-{N}-PLAN.md` (the brief), `{phase}-{N}-SUMMARY.md`, `{phase}-VERIFICATION.md`, plus `{phase}-RESEARCH.md` when it was missing and `{phase}-HUMAN-UAT.md` when human-only checks exist

With `workflow.build_mode: true` (the default), `/fvgsd-progress`, `/fvgsd-manager`, `/fvgsd-autonomous` and `/fvgsd-discuss-phase --chain` suggest this command instead of plan-phase and execute-phase. See [Configuration](CONFIGURATION.md) for the `workflow.build_*` settings.

```bash
/fvgsd-build 3               # Build phase 3
/fvgsd-build 3 --confirm     # Review the brief before any code is written
/fvgsd-build 3 --gaps        # Close the gaps verification found
```

---

````

In `docs/USER-GUIDE.md`, insert this block immediately before the line `### 3. Execute`:

````markdown
**Or build it in one step:**

```
/fvgsd-build 1
```

`/fvgsd-build` replaces the plan and execute steps for a discussed phase. It writes a short brief (`01-01-PLAN.md`), builds it in vertical slices, runs your build, typecheck, lint and test commands, verifies once, fixes what remains in up to two rounds, and writes `01-01-SUMMARY.md` and `01-VERIFICATION.md`. With `workflow.build_mode: true` (the default), next-step suggestions point to it; the separate steps below stay available.

````

In the same file, replace:

```markdown
| `--skip-research` | `/fvgsd-plan-phase` | Skip research agents when the domain is already familiar |
```

with:

```markdown
| `--skip-research` | `/fvgsd-plan-phase` | Skip research agents when the domain is already familiar |
| `--confirm` | `/fvgsd-build` | Review the brief before any code is written |
| `--gaps` | `/fvgsd-build` | Close the gaps a build's verification found |
```

In `README.md`, replace:

```markdown
For an existing codebase, run `/fvgsd-map-codebase` before `/fvgsd-new-project`.
```

with:

```markdown
For a discussed phase, `/fvgsd-build 1` replaces the plan and execute steps: it writes a short brief, builds it in slices, runs your checks and verifies the result. `/fvgsd-plan-phase` and `/fvgsd-execute-phase` stay available.

For an existing codebase, run `/fvgsd-map-codebase` before `/fvgsd-new-project`.
```

In `docs/INVENTORY.md`:
- Replace `## Commands (68 shipped)` with `## Commands (69 shipped)`.
- Insert this row immediately before the `/fvgsd-plan-phase` row:
  `` | `/fvgsd-build` | Plan and execute a discussed phase in one step with slices, checks, and verification. | [commands/gsd/build.md](../commands/gsd/build.md) | ``
- Replace `## Workflows (88 shipped)` with `## Workflows (89 shipped)`.
- Insert this row immediately after the `autonomous.md` row:
  `` | `build.md` | Plan and execute a discussed phase in one run: brief, slices, checks, verification, fix rounds and summary. | `/fvgsd-build` | ``

Task 4 named the build workflow as the builder's spawner, because `tests/docs-parity-live-registry.test.cjs` rejects `/fvgsd-build` in docs until the command exists. Now that it exists, point both entries at the command:
- In `docs/INVENTORY.md`, replace `` | fvgsd-builder | Writes the build brief for a phase, or builds one slice of it (brief and slice modes). | `build.md` workflow | advanced stub | `` with `` | fvgsd-builder | Writes the build brief for a phase, or builds one slice of it (brief and slice modes). | `/fvgsd-build` | advanced stub | ``.
- In `docs/AGENTS.md`, replace `| **Spawned by** | The build workflow (brief mode once per build; slice mode once per slice, fix group or merge conflict) |` with ``| **Spawned by** | `/fvgsd-build` (brief mode once per build; slice mode once per slice, fix group or merge conflict) |``.

Regenerate the manifest:

```bash
node scripts/gen-inventory-manifest.cjs --write
node scripts/gen-inventory-manifest.cjs --check
```

Expected: the check exits 0.

- [ ] **Step 7: Run the tests and checks**

```bash
(cd sdk && npm run build)   # the sanitizer test imports sdk/dist/prompt-sanitizer.js
node --test tests/fvgsd-build-command.test.cjs
node scripts/lint-command-contract.cjs
npm run lint:descriptions
npm run lint:skill-deps
npm run check:execution-branch-guards
node --test tests/command-contract.test.cjs tests/runtime-artifact-layout-surface.test.cjs tests/runtime-artifact-layout-install-profiles.test.cjs tests/agent-frontmatter.test.cjs tests/workflow-size-budget.test.cjs tests/commands-doc-parity.test.cjs tests/inventory-counts.test.cjs tests/inventory-manifest-sync.test.cjs tests/inventory-source-parity.test.cjs tests/bug-3683-command-cross-reference-invariant.test.cjs tests/gsd-sdk-query-registry-integration.test.cjs tests/docs-parity-live-registry.test.cjs tests/lint-skill-deps.test.cjs tests/bug-3735-profiles-core-includes-surface.test.cjs
```

Expected:
- **New test:** all tests in `tests/fvgsd-build-command.test.cjs` pass.
- **Lints and checks:** every lint and check command exits 0.
- **Listed test files:** they pass, apart from failures already in `baseline-root.log`. At baseline, `workflow-size-budget.test.cjs` already fails for `execute-phase.md` (1816 lines over its 1810 budget); `build.md` must not add a failure.

If `tests/gsd-sdk-query-registry-integration.test.cjs` reports an unresolved `fvgsd-sdk query <name>` from `build.md`, the query it names is missing from an earlier task's registration. Fix that registration; don't rename the query in the workflow.

- [ ] **Step 8: Run the root suite against the baseline**

```bash
npm test > "$WS/task-10-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-10-root.log"
```

Expected: `"newFailures": []`. `missingTitles` lists only the renamed title `PROFILES.core contains the 9 main-loop skills (including Vibe routing)`.

- [ ] **Step 9: Commit**

```bash
git add commands/gsd/build.md get-shit-done/workflows/build.md tests/fvgsd-build-command.test.cjs \
  get-shit-done/bin/lib/clusters.cjs get-shit-done/bin/lib/install-profiles.cjs \
  tests/runtime-artifact-layout-install-profiles.test.cjs commands/gsd/ns-workflow.md \
  docs/COMMANDS.md docs/USER-GUIDE.md README.md docs/AGENTS.md docs/INVENTORY.md docs/INVENTORY-MANIFEST.json
git commit -m "feat: add /fvgsd-build command and workflow"
```

---

### Task 11: Plan `kind`, `route.next-action` and manager recommendations

**Files:**
- Modify: `sdk/src/types.ts` (`PlanInfo`)
- Modify: `sdk/src/query/phase.ts` (`phasePlanIndex`) and `get-shit-done/bin/lib/phase.cjs` (`cmdPhasePlanIndex`)
- Modify: `sdk/src/query/route-next-action.ts`
- Modify: `sdk/src/query/init-complex.ts` (`initManager`) and `get-shit-done/bin/lib/init.cjs` (`cmdInitManager`)
- Test: `sdk/src/query/phase.test.ts`, `tests/phase.test.cjs`, `sdk/src/query/route-next-action.test.ts`, `sdk/src/query/init-complex.test.ts`, `tests/init-manager.test.cjs`

**Interfaces:**
- Consumes:
  - `listPhasePlanFiles(phaseDirAbs, padded): PhasePlanFile[]` and `readVerification(phaseDirAbs, padded): VerificationInfo | null` from `sdk/src/query/build-shared.ts` (Task 8)
  - the `workflow.build_mode` default `true` (Task 1)
- Produces:
  - **`phase-plan-index`:** every plan carries `kind: string | null`.
  - **`route.next-action` in build mode:** returns `/fvgsd-build` with `args` `NN` or `NN --gaps`. A phase with RESEARCH.md but no CONTEXT.md and no plans gets `/fvgsd-discuss-phase` instead, because a build needs CONTEXT.md.
  - **Manager (TS and CJS):** `recommended_actions[]` can contain `action: 'build'` with command `/fvgsd-build N` or `/fvgsd-build N --gaps`. CJS renders them with `formatGsdSlash('build', runtime)`. In build mode, a `researched` phase without CONTEXT.md gets `action: 'discuss'`.
  - **`workflow.build_mode: false`:** every output is unchanged, except that a phase with an unfinished `kind: brief` plan still routes to `/fvgsd-build N` (Decision 13: execute-phase refuses briefs). The discussed-phase build suggestion and `--gaps` stay gated by `workflow.build_mode`.

- [ ] **Step 1: Write the failing plan-index tests**

In `sdk/src/query/phase.test.ts`, add this test inside `describe('phasePlanIndex', ...)`, directly after the `parses files_modified from frontmatter` test:

```ts
  it('reports each plan kind from frontmatter, null when absent', async () => {
    const phase11 = join(tmpDir, '.planning', 'phases', '11-build');
    await mkdir(phase11, { recursive: true });
    await writeFile(join(phase11, '11-01-PLAN.md'), '---\nphase: 11-build\nplan: 01\nkind: brief\n---\n<objective>\nBuild it.\n</objective>\n');

    const briefPlans = ((await phasePlanIndex(['11'], tmpDir)).data as Record<string, unknown>).plans as Array<Record<string, unknown>>;
    expect(briefPlans.map(p => p.kind)).toEqual(['brief']);

    const classicPlans = ((await phasePlanIndex(['9'], tmpDir)).data as Record<string, unknown>).plans as Array<Record<string, unknown>>;
    expect(classicPlans.map(p => p.kind)).toEqual([null, null, null]);
  });
```

In `tests/phase.test.cjs`, add this test inside `describe('phase-plan-index command', ...)`, directly after `empty phase directory returns empty plans array`:

```js
  test('reports each plan kind from frontmatter, null when absent', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-PLAN.md'), ['---', 'phase: 03-api', 'plan: 01', 'kind: brief', '---', '<objective>', 'Build the API.', '</objective>', ''].join('\n'));
    fs.writeFileSync(path.join(phaseDir, '03-02-PLAN.md'), ['---', 'phase: 03-api', 'plan: 02', '---', '<objective>', 'Classic plan.', '</objective>', ''].join('\n'));

    const result = runGsdTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.plans.map((plan) => [plan.id, plan.kind]), [['03-01', 'brief'], ['03-02', null]]);
  });
```

- [ ] **Step 2: Write the failing routing tests**

Replace `sdk/src/query/route-next-action.test.ts` with the file below. The first two expectations are fixed from the stale `/gsd-new-project` and `/gsd-resume-work` (the source has returned `/fvgsd-…` since the rename).

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { routeNextAction } from './route-next-action.js';

describe('routeNextAction', () => {
  it('suggests new-project when STATE.md is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-rna-'));
    await mkdir(join(dir, '.planning'), { recursive: true });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({
      command: '/fvgsd-new-project',
      reason: expect.stringContaining('STATE.md'),
    });
  });

  it('routes to resume-work when paused', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-rna-'));
    await mkdir(join(dir, '.planning'), { recursive: true });
    await writeFile(
      join(dir, '.planning', 'STATE.md'),
      `---
milestone: v1.0
---

**Paused At:** Phase 2

`,
      'utf-8',
    );
    await writeFile(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n', 'utf-8');
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({
      command: '/fvgsd-resume-work',
    });
  });

  it('blocks when .continue-here.md exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fvgsd-rna-'));
    await mkdir(join(dir, '.planning'), { recursive: true });
    await writeFile(join(dir, '.planning', '.continue-here.md'), 'checkpoint\n', 'utf-8');
    await writeFile(
      join(dir, '.planning', 'STATE.md'),
      `---
milestone: v1.0
---

**Current Phase:** 3

`,
      'utf-8',
    );
    await writeFile(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n', 'utf-8');
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({
      command: '',
      gates: expect.objectContaining({ continue_here: true }),
    });
  });
});

const PHASE = '.planning/phases/03-user-auth';
const BRIEF = ['---', 'phase: 03-user-auth', 'plan: 01', 'type: execute', 'kind: brief', '---', '<objective>', 'Sign-in flow.', '</objective>', ''].join('\n');
const CLASSIC_PLAN = ['---', 'phase: 03-user-auth', 'plan: 01', 'type: execute', '---', '<objective>', 'Sign-in flow.', '</objective>', ''].join('\n');

/** `files` entries override the base fixture; a null value leaves that file out. */
async function buildProject(files: Record<string, string | null>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fvgsd-rna-build-'));
  const base: Record<string, string> = {
    '.planning/STATE.md': ['---', 'milestone: v1.0', '---', '', '**Current Phase:** 3', ''].join('\n'),
    '.planning/ROADMAP.md': ['# Roadmap', '', '## v1.0: Launch', '', '### Phase 3: User Auth', '', '**Goal:** Users can sign in', '', '### Phase 4: Billing', '', '**Goal:** Users can pay', ''].join('\n'),
    [`${PHASE}/03-CONTEXT.md`]: '# Context\n',
  };
  for (const [rel, content] of Object.entries({ ...base, ...files })) {
    if (content === null) continue;
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf-8');
  }
  return dir;
}

describe('routeNextAction — build mode', () => {
  it('routes a discussed phase with no plans to /fvgsd-build', async () => {
    const { data } = await routeNextAction([], await buildProject({}));
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03' });
  });

  it('keeps /fvgsd-plan-phase when workflow.build_mode is false', async () => {
    const dir = await buildProject({ '.planning/config.json': JSON.stringify({ workflow: { build_mode: false } }) });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-plan-phase', args: '03' });
  });

  it('routes a researched phase without CONTEXT.md to /fvgsd-discuss-phase', async () => {
    const dir = await buildProject({ [`${PHASE}/03-CONTEXT.md`]: null, [`${PHASE}/03-RESEARCH.md`]: '# Research\n' });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-discuss-phase', args: '03' });
  });

  it('resumes /fvgsd-build when an incomplete plan is a brief', async () => {
    const { data } = await routeNextAction([], await buildProject({ [`${PHASE}/03-01-PLAN.md`]: BRIEF }));
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03', reason: 'Build in progress — resume' });
  });

  it('resumes /fvgsd-build for an unfinished brief even when workflow.build_mode is false', async () => {
    const dir = await buildProject({
      '.planning/config.json': JSON.stringify({ workflow: { build_mode: false } }),
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03', reason: 'Build in progress — resume' });
  });

  it('keeps /fvgsd-execute-phase for an incomplete classic plan', async () => {
    const { data } = await routeNextAction([], await buildProject({ [`${PHASE}/03-01-PLAN.md`]: CLASSIC_PLAN }));
    expect(data).toMatchObject({ command: '/fvgsd-execute-phase', args: '03' });
  });

  it('routes a build phase whose verification found gaps to /fvgsd-build --gaps', async () => {
    const dir = await buildProject({
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: '# Summary\n',
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: gaps_found', '---', '', '# Verification', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-build', args: '03 --gaps', reason: 'Verification found gaps' });
  });

  it('keeps /fvgsd-verify-work for verification gaps when workflow.build_mode is false', async () => {
    const dir = await buildProject({
      '.planning/config.json': JSON.stringify({ workflow: { build_mode: false } }),
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: '# Summary\n',
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: gaps_found', '---', '', '# Verification', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-verify-work' });
  });

  it('advances to the next phase once a build phase passed verification', async () => {
    const dir = await buildProject({
      [`${PHASE}/03-01-PLAN.md`]: BRIEF,
      [`${PHASE}/03-01-SUMMARY.md`]: '# Summary\n',
      [`${PHASE}/03-VERIFICATION.md`]: ['---', 'phase: 03-user-auth', 'status: passed', '---', ''].join('\n'),
    });
    const { data } = await routeNextAction([], dir);
    expect(data).toMatchObject({ command: '/fvgsd-discuss-phase', args: '4' });
  });
});
```

- [ ] **Step 3: Write the failing manager tests**

**SDK (`sdk/src/query/init-complex.test.ts`).** In the top-level `beforeEach`, pin the existing tests to classic routing. The `workflow:` line on its own also matches inside the more deeply indented configs of the `initNewProject` and `initProgress` tests, so replace these three lines, which occur once:

```ts
      quick_branch_template: null,
    },
    workflow: { research: true, plan_check: true, verifier: true, nyquist_validation: true },
```

with

```ts
      quick_branch_template: null,
    },
    workflow: { research: true, plan_check: true, verifier: true, nyquist_validation: true, build_mode: false },
```

Append at the end of the file:

```ts
describe('initManager — build mode', () => {
  const BRIEF = ['---', 'phase: 20-auth', 'plan: 01', 'kind: brief', '---', '<objective>', 'Build it.', '</objective>', ''].join('\n');

  async function scaffold(
    phases: Array<{ number: string; slug: string; dependsOn?: string; files: Record<string, string> }>,
    buildMode = true,
  ): Promise<void> {
    await writeFile(join(tmpDir, '.planning', 'config.json'), JSON.stringify({ model_profile: 'balanced', commit_docs: false, workflow: { build_mode: buildMode } }));
    const roadmap = ['# Roadmap', '', '## v3.0: SDK-First Migration', ''];
    for (const phase of phases) {
      roadmap.push(`### Phase ${phase.number}: ${phase.slug}`, '', '**Goal:** Build it', '', `**Depends on:** ${phase.dependsOn ?? 'None'}`, '');
      const dir = join(tmpDir, '.planning', 'phases', `${phase.number}-${phase.slug}`);
      await mkdir(dir, { recursive: true });
      for (const [name, content] of Object.entries(phase.files)) {
        await writeFile(join(dir, name), content);
      }
    }
    await writeFile(join(tmpDir, '.planning', 'ROADMAP.md'), roadmap.join('\n'));
  }

  async function actions(): Promise<Array<Record<string, unknown>>> {
    const data = (await initManager([], tmpDir)).data as Record<string, unknown>;
    return (data.recommended_actions as Array<Record<string, unknown>>).map(({ phase, action, command }) => ({ phase, action, command }));
  }

  it('recommends build for a discussed phase whose dependencies are complete', async () => {
    await scaffold([
      { number: '20', slug: 'base', files: { '20-01-PLAN.md': BRIEF, '20-01-SUMMARY.md': '# Done' } },
      { number: '21', slug: 'next', dependsOn: 'Phase 20', files: { '21-CONTEXT.md': '# Context' } },
    ]);
    expect(await actions()).toEqual([{ phase: '21', action: 'build', command: '/fvgsd-build 21' }]);
  });

  it('does not recommend build while a dependency is incomplete', async () => {
    await scaffold([
      { number: '20', slug: 'base', files: { '20-01-PLAN.md': '---\nphase: 20-base\nplan: 01\n---\n' } },
      { number: '21', slug: 'next', dependsOn: 'Phase 20', files: { '21-CONTEXT.md': '# Context' } },
    ]);
    expect((await actions()).filter(a => a.phase === '21')).toEqual([]);
  });

  it('resumes build for a planned phase whose plan is a brief', async () => {
    await scaffold([{ number: '20', slug: 'auth', files: { '20-CONTEXT.md': '# Context', '20-01-PLAN.md': BRIEF } }]);
    expect(await actions()).toEqual([{ phase: '20', action: 'build', command: '/fvgsd-build 20' }]);
  });

  it('resumes build for an unfinished brief even when workflow.build_mode is false', async () => {
    await scaffold([{ number: '20', slug: 'auth', files: { '20-CONTEXT.md': '# Context', '20-01-PLAN.md': BRIEF } }], false);
    expect(await actions()).toEqual([{ phase: '20', action: 'build', command: '/fvgsd-build 20' }]);
  });

  it('recommends a gap build when a complete build phase has verification gaps', async () => {
    await scaffold([{
      number: '20',
      slug: 'auth',
      files: {
        '20-01-PLAN.md': BRIEF,
        '20-01-SUMMARY.md': '# Done',
        '20-VERIFICATION.md': '---\nphase: 20-auth\nstatus: gaps_found\n---\n',
      },
    }]);
    expect(await actions()).toEqual([{ phase: '20', action: 'build', command: '/fvgsd-build 20 --gaps' }]);
  });

  it('keeps the plan recommendation when workflow.build_mode is false', async () => {
    await scaffold([{ number: '20', slug: 'auth', files: { '20-CONTEXT.md': '# Context' } }], false);
    expect(await actions()).toEqual([{ phase: '20', action: 'plan', command: '/fvgsd-plan-phase 20' }]);
  });

  it('recommends discuss for a researched phase without CONTEXT.md', async () => {
    await scaffold([{ number: '20', slug: 'auth', files: { '20-RESEARCH.md': '# Research' } }]);
    expect(await actions()).toEqual([{ phase: '20', action: 'discuss', command: '/fvgsd-discuss-phase 20' }]);
  });
});
```

**CJS (`tests/init-manager.test.cjs`).** Add this helper directly after the `writeState` helper:

```js
// The existing describes below assert the classic plan/execute routing.
function writeClassicConfig(tmpDir) {
  fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ workflow: { build_mode: false } }));
}
```

In `describe('init manager', ...)` and in `describe('init manager — cross-milestone dependency satisfaction (#2267)', ...)`, replace each

```js
  beforeEach(() => {
    tmpDir = createTempProject();
  });
```

with

```js
  beforeEach(() => {
    tmpDir = createTempProject();
    writeClassicConfig(tmpDir);
  });
```

Append at the end of the file:

```js
describe('init manager — build mode', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    writeState(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writePhaseFile(num, slug, name, content) {
    const padded = String(num).padStart(2, '0');
    const dir = path.join(tmpDir, '.planning', 'phases', `${padded}-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name.replace('{P}', padded)), content);
  }

  const brief = ['---', 'phase: 01-auth', 'plan: 01', 'kind: brief', '---', '<objective>', 'Build it.', '</objective>', ''].join('\n');

  function actionsFor(env = { FVGSD_RUNTIME: 'claude' }) {
    const result = runGsdTools('init manager', tmpDir, env);
    assert.ok(result.success, `Command failed: ${result.error}`);
    return JSON.parse(result.output).recommended_actions.map(({ phase, action, command }) => ({ phase, action, command }));
  }

  test('recommends build for a discussed phase whose dependencies are complete', () => {
    writeRoadmap(tmpDir, [
      { number: '1', name: 'Base', complete: true },
      { number: '2', name: 'Next', depends_on: 'Phase 1' },
    ]);
    scaffoldPhase(tmpDir, 1, { slug: 'base', context: true, plans: 1, summaries: 1 });
    scaffoldPhase(tmpDir, 2, { slug: 'next', context: true });
    assert.deepStrictEqual(actionsFor(), [{ phase: '2', action: 'build', command: '/fvgsd-build 2' }]);
  });

  test('does not recommend build while a dependency is incomplete', () => {
    writeRoadmap(tmpDir, [
      { number: '1', name: 'Base' },
      { number: '2', name: 'Next', depends_on: 'Phase 1' },
    ]);
    scaffoldPhase(tmpDir, 1, { slug: 'base', context: true, plans: 1 });
    scaffoldPhase(tmpDir, 2, { slug: 'next', context: true });
    assert.deepStrictEqual(actionsFor().filter((a) => a.phase === '2'), []);
  });

  test('resumes build for a planned phase whose plan is a brief', () => {
    writeRoadmap(tmpDir, [{ number: '1', name: 'Auth' }]);
    writePhaseFile(1, 'auth', '{P}-CONTEXT.md', '# Context');
    writePhaseFile(1, 'auth', '{P}-01-PLAN.md', brief);
    assert.deepStrictEqual(actionsFor(), [{ phase: '1', action: 'build', command: '/fvgsd-build 1' }]);
  });

  test('resumes build for an unfinished brief even when workflow.build_mode is false', () => {
    writeClassicConfig(tmpDir);
    writeRoadmap(tmpDir, [{ number: '1', name: 'Auth' }]);
    writePhaseFile(1, 'auth', '{P}-CONTEXT.md', '# Context');
    writePhaseFile(1, 'auth', '{P}-01-PLAN.md', brief);
    assert.deepStrictEqual(actionsFor(), [{ phase: '1', action: 'build', command: '/fvgsd-build 1' }]);
  });

  test('recommends a gap build for a complete build phase whose verification found gaps', () => {
    writeRoadmap(tmpDir, [{ number: '1', name: 'Auth' }]);
    writePhaseFile(1, 'auth', '{P}-01-PLAN.md', brief);
    writePhaseFile(1, 'auth', '{P}-01-SUMMARY.md', '# Summary');
    writePhaseFile(1, 'auth', '{P}-VERIFICATION.md', ['---', 'phase: 01-auth', 'status: gaps_found', '---', ''].join('\n'));
    assert.deepStrictEqual(actionsFor(), [{ phase: '1', action: 'build', command: '/fvgsd-build 1 --gaps' }]);
  });

  test('renders build commands in the codex skill form', () => {
    writeRoadmap(tmpDir, [{ number: '3', name: 'Api' }]);
    scaffoldPhase(tmpDir, 3, { slug: 'api', context: true });
    assert.deepStrictEqual(actionsFor({ FVGSD_RUNTIME: 'codex' }), [{ phase: '3', action: 'build', command: '$fvgsd-build 3' }]);
  });

  test('keeps the plan recommendation when workflow.build_mode is false', () => {
    writeClassicConfig(tmpDir);
    writeRoadmap(tmpDir, [{ number: '1', name: 'Auth' }]);
    scaffoldPhase(tmpDir, 1, { slug: 'auth', context: true });
    assert.deepStrictEqual(actionsFor(), [{ phase: '1', action: 'plan', command: '/fvgsd-plan-phase 1' }]);
  });

  test('recommends discuss for a researched phase without CONTEXT.md', () => {
    writeRoadmap(tmpDir, [{ number: '1', name: 'Auth' }]);
    scaffoldPhase(tmpDir, 1, { slug: 'auth', research: true });
    assert.deepStrictEqual(actionsFor(), [{ phase: '1', action: 'discuss', command: '/fvgsd-discuss-phase 1' }]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
(cd sdk && npx vitest run src/query/phase.test.ts src/query/route-next-action.test.ts src/query/init-complex.test.ts)
node --test tests/phase.test.cjs tests/init-manager.test.cjs
```

Expected failures:
- **kind tests:** receive `undefined` instead of `'brief'`/`null`.
- **Build-mode routing tests:** receive `/fvgsd-plan-phase` or `/fvgsd-execute-phase` instead of `/fvgsd-build` or `/fvgsd-discuss-phase`. The verification-gaps test with `workflow.build_mode: false` already passes.
- **Build-mode manager tests:** receive `plan`/`execute` actions or `[]`.

The existing manager tests pass, because they are pinned to `build_mode: false`.

- [ ] **Step 5: Add `kind` to the plan index**

In `sdk/src/types.ts`, replace

```ts
export interface PlanInfo {
  id: string;
  wave: number;
  depends_on: string[];
  autonomous: boolean;
  objective: string | null;
  files_modified: string[];
  task_count: number;
  has_summary: boolean;
}
```

with

```ts
export interface PlanInfo {
  id: string;
  wave: number;
  depends_on: string[];
  autonomous: boolean;
  objective: string | null;
  files_modified: string[];
  task_count: number;
  has_summary: boolean;
  /** Frontmatter `kind` (e.g. `brief` for /fvgsd-build plans), null when absent. */
  kind?: string | null;
}
```

In `sdk/src/query/phase.ts` (`phasePlanIndex`), make three edits:
1. Add `kind: string | null;` as the last field of `interface RawPlan`.
2. In `rawPlans.push({ … })`, add after `hasSummary,`:
   ```ts
      kind: typeof fm.kind === 'string' && fm.kind.trim() !== '' ? fm.kind.trim() : null,
   ```
3. In the `const plan: Record<string, unknown> = { … }` literal, add after `has_summary: raw.hasSummary,`:
   ```ts
      kind: raw.kind,
   ```

In `get-shit-done/bin/lib/phase.cjs` (`cmdPhasePlanIndex`), make the same two edits:
- after `hasSummary,` in `rawPlans.push({ … })`:
  ```js
      kind: typeof fm.kind === 'string' && fm.kind.trim() !== '' ? fm.kind.trim() : null,
  ```
- after `has_summary: raw.hasSummary,` in `const plan = { … }`:
  ```js
      kind: raw.kind,
  ```

- [ ] **Step 6: Route build phases in `route.next-action`**

In `sdk/src/query/route-next-action.ts`, replace the imports

```ts
import { planningPaths, normalizePhaseName, comparePhaseNum } from './helpers.js';
import { stateJson } from './state.js';
import { roadmapAnalyze } from './roadmap.js';
import { findPhase } from './phase.js';
```

with

```ts
import { loadConfig } from '../config.js';
import { extractFrontmatter } from './frontmatter.js';
import { planningPaths, normalizePhaseName, comparePhaseNum } from './helpers.js';
import { stateJson } from './state.js';
import { roadmapAnalyze } from './roadmap.js';
import { findPhase, phasePlanIndex } from './phase.js';
```

Add these helpers directly after the `verificationPassed` function:

```ts
/** `workflow.build_mode` (default true); unreadable config keeps the default. */
async function isBuildMode(projectDir: string, workstream?: string): Promise<boolean> {
  try {
    const config = await loadConfig(projectDir, workstream);
    const workflow = (config as Record<string, unknown>).workflow as Record<string, unknown> | undefined;
    return workflow?.build_mode !== false;
  } catch {
    return true;
  }
}

/** Plan kinds from phase-plan-index; empty when the index cannot be built. */
async function planKinds(
  phase: string,
  projectDir: string,
  workstream?: string,
): Promise<Array<{ kind: string | null; has_summary: boolean }>> {
  try {
    const index = await phasePlanIndex([phase], projectDir, workstream);
    const plans = ((index.data as Record<string, unknown>).plans as Array<Record<string, unknown>> | undefined) ?? [];
    return plans.map((plan) => ({
      kind: typeof plan.kind === 'string' ? plan.kind : null,
      has_summary: plan.has_summary === true,
    }));
  } catch {
    return [];
  }
}

/** Frontmatter `status` of the phase VERIFICATION.md, null when absent. */
async function verificationStatus(phaseDirAbs: string): Promise<string | null> {
  try {
    const files = await readdir(phaseDirAbs);
    const vf = files.find(f => f === 'VERIFICATION.md' || f.endsWith('-VERIFICATION.md'));
    if (!vf) return null;
    const fm = extractFrontmatter(await readFile(join(phaseDirAbs, vf), 'utf-8'));
    return typeof fm.status === 'string' ? fm.status : null;
  } catch {
    return null;
  }
}
```

Replace

```ts
  const phaseDirAbs = pd.directory ? join(projectDir, pd.directory as string) : '';
```

with

```ts
  const phaseDirAbs = pd.directory ? join(projectDir, pd.directory as string) : '';
  const buildMode = await isBuildMode(projectDir, workstream);
```

Replace the Route 3 `data` fields

```ts
        command: '/fvgsd-plan-phase',
        args: cp,
        reason: 'Context exists but no PLAN.md files',
```

with

```ts
        // A build needs CONTEXT.md: a phase with only RESEARCH.md is discussed first.
        command: !buildMode ? '/fvgsd-plan-phase' : hasContext ? '/fvgsd-build' : '/fvgsd-discuss-phase',
        args: cp,
        reason: !buildMode
          ? 'Context exists but no PLAN.md files'
          : hasContext
            ? 'Context exists — build the phase (plan and execute in one step)'
            : 'Research exists but no CONTEXT.md — discuss the phase before building',
```

Replace the whole Route 4 block

```ts
  // Route 4
  if (incomplete.length > 0) {
    const ctx = await buildContext(currentPhase);
    return {
      data: {
        command: '/fvgsd-execute-phase',
        args: cp,
        reason: `${incomplete.length} plan(s) still need SUMMARY.md`,
```

with

```ts
  // Route 4
  if (incomplete.length > 0) {
    const ctx = await buildContext(currentPhase);
    // Decision 13: execute-phase refuses briefs, so an unfinished brief resumes
    // /fvgsd-build even when workflow.build_mode is false.
    const resumeBuild = (await planKinds(cp, projectDir, workstream)).some(plan => plan.kind === 'brief' && !plan.has_summary);
    return {
      data: {
        command: resumeBuild ? '/fvgsd-build' : '/fvgsd-execute-phase',
        args: cp,
        reason: resumeBuild ? 'Build in progress — resume' : `${incomplete.length} plan(s) still need SUMMARY.md`,
```

Directly before `  // Summaries match plans — verification / advance`, insert:

```ts
  // Route 4b — a /fvgsd-build phase whose verification found gaps
  if (buildMode && phaseDirAbs) {
    const isBuildPhase = (await planKinds(cp, projectDir, workstream)).some(plan => plan.kind === 'brief');
    if (isBuildPhase && (await verificationStatus(phaseDirAbs)) === 'gaps_found') {
      const ctx = await buildContext(currentPhase);
      return {
        data: {
          command: '/fvgsd-build',
          args: `${cp} --gaps`,
          reason: 'Verification found gaps',
          current_phase: currentPhase,
          phase_name: displayName,
          gates,
          context: ctx,
        },
      };
    }
  }

```

- [ ] **Step 7: Recommend `build` in the SDK manager**

In `sdk/src/query/init-complex.ts`, add after `import { withProjectRoot } from './init.js';`:

```ts
import { listPhasePlanFiles, readVerification } from './build-shared.js';
```

In `initManager`, replace

```ts
  const phases: Record<string, unknown>[] = [];
  let pMatch: RegExpExecArray | null;
```

with

```ts
  const phases: Record<string, unknown>[] = [];
  const buildInfo = new Map<string, { hasBrief: boolean; incompleteBrief: boolean; verification: string | null }>();
  let pMatch: RegExpExecArray | null;
```

In `initManager` (not `initProgress`), inside the `if (dirMatch)` block, replace:

```ts
        if (newestMtime > 0) {
          lastActivity = new Date(newestMtime).toISOString();
          isActive = (now - newestMtime) < 300000; // 5 minutes
        }
```

with:

```ts
        if (newestMtime > 0) {
          lastActivity = new Date(newestMtime).toISOString();
          isActive = (now - newestMtime) < 300000; // 5 minutes
        }

        // Build facts in their own try/catch: a read failure here must not turn the phase into no_directory.
        try {
          const planFiles = listPhasePlanFiles(fullDir, normalized);
          buildInfo.set(phaseNum, {
            hasBrief: planFiles.some(plan => plan.kind === 'brief'),
            incompleteBrief: planFiles.some(plan => plan.kind === 'brief' && !plan.hasSummary),
            verification: readVerification(fullDir, normalized)?.status ?? null,
          });
        } catch { /* no build facts: the classic recommendations apply */ }
```

Replace the block that starts at `  const recommendedActions: Record<string, unknown>[] = [];` and ends at the closing `  }` of its `for (const phase of phases)` loop (the loop that pushes the `execute`, `plan` and `discuss` actions) with:

```ts
  const workflowConfig = (config as Record<string, unknown>).workflow as Record<string, unknown> | undefined;
  const buildMode = workflowConfig?.build_mode !== false;
  const independentOf = (phaseNumber: string, active: Record<string, unknown>[]): boolean =>
    active.every(a => !reaches(phaseNumber, a.number as string) && !reaches(a.number as string, phaseNumber));

  const recommendedActions: Record<string, unknown>[] = [];
  for (const phase of phases) {
    const status = phase.disk_status as string;
    const number = phase.number as string;
    if (/^999(?:\.|$)/.test(number)) continue;

    const info = buildInfo.get(number);
    if (info?.hasBrief) {
      // Decision 13: an unfinished brief resumes build even with build_mode off;
      // the --gaps suggestion still follows build_mode.
      const gaps = buildMode && status === 'complete' && !phase.roadmap_complete && info.verification === 'gaps_found';
      const resume = (status === 'planned' || status === 'partial') && info.incompleteBrief && Boolean(phase.deps_satisfied);
      if (gaps || resume) {
        if (independentOf(number, activeExecuting) && independentOf(number, activePlanning)) {
          recommendedActions.push({
            phase: phase.number,
            phase_name: phase.name,
            action: 'build',
            reason: gaps ? 'Verification found gaps' : 'Build in progress — resume',
            command: gaps ? `/fvgsd-build ${phase.number} --gaps` : `/fvgsd-build ${phase.number}`,
          });
        }
        continue;
      }
    }
    if (status === 'complete') continue;

    if (status === 'planned' && phase.deps_satisfied) {
      const action = {
        phase: phase.number,
        phase_name: phase.name,
        action: 'execute',
        reason: `${phase.plan_count} plans ready, dependencies met`,
        command: `/fvgsd-execute-phase ${phase.number}`,
      };
      const isAllowed = activeExecuting.length === 0 ||
        activeExecuting.every(a => !reaches(phase.number as string, a.number as string) && !reaches(a.number as string, phase.number as string));
      if (isAllowed) recommendedActions.push(action);
    } else if (status === 'discussed' || status === 'researched') {
      if (buildMode && !phase.has_context) {
        // A build needs CONTEXT.md: a researched phase without it is discussed first.
        recommendedActions.push({
          phase: phase.number,
          phase_name: phase.name,
          action: 'discuss',
          reason: 'Research exists but no CONTEXT.md',
          command: `/fvgsd-discuss-phase ${phase.number}`,
        });
      } else if (buildMode) {
        if (phase.deps_satisfied && independentOf(number, activeExecuting) && independentOf(number, activePlanning)) {
          recommendedActions.push({
            phase: phase.number,
            phase_name: phase.name,
            action: 'build',
            reason: 'Context gathered, ready to build',
            command: `/fvgsd-build ${phase.number}`,
          });
        }
      } else {
        const action = {
          phase: phase.number,
          phase_name: phase.name,
          action: 'plan',
          reason: 'Context gathered, ready for planning',
          command: `/fvgsd-plan-phase ${phase.number}`,
        };
        const isAllowed = activePlanning.length === 0 ||
          activePlanning.every(a => !reaches(phase.number as string, a.number as string) && !reaches(a.number as string, phase.number as string));
        if (isAllowed) recommendedActions.push(action);
      }
    } else if ((status === 'empty' || status === 'no_directory') && phase.is_next_to_discuss) {
      recommendedActions.push({
        phase: phase.number,
        phase_name: phase.name,
        action: 'discuss',
        reason: 'Unblocked, ready to gather context',
        command: `/fvgsd-discuss-phase ${phase.number}`,
      });
    }
  }
```

- [ ] **Step 8: Recommend `build` in the CJS manager**

In `get-shit-done/bin/lib/init.cjs`, add after `const { formatGsdSlash, resolveRuntime } = require('./runtime-slash.cjs');`:

```js
const { extractFrontmatter } = require('./frontmatter.cjs');
```

Add directly after `function listPhasePlanFiles(phaseDir) { … }`:

```js
// `workflow.build_mode` (default true). A raw read keeps loadConfig's flat
// shape unchanged; unreadable config keeps the default.
function readBuildMode(cwd) {
  try {
    const raw = platformReadSync(path.join(planningDir(cwd), 'config.json'));
    if (raw === null) return true;
    const parsed = JSON.parse(raw);
    return !(parsed && parsed.workflow && parsed.workflow.build_mode === false);
  } catch {
    return true;
  }
}

// /fvgsd-build facts for one phase directory: any brief plan, any brief still
// missing its SUMMARY, and the VERIFICATION.md frontmatter status.
function readPhaseBuildInfo(phaseDir) {
  const info = { hasBrief: false, incompleteBrief: false, verification: null };
  try {
    const summaries = new Set(listPhaseSummaryFiles(phaseDir).map((file) => path.basename(file)));
    for (const planFile of listPhasePlanFiles(phaseDir).map((file) => path.basename(file))) {
      const raw = platformReadSync(path.join(phaseDir, planFile));
      if (raw === null || extractFrontmatter(raw).kind !== 'brief') continue;
      info.hasBrief = true;
      if (!summaries.has(planFile.replace(/PLAN\.md$/, 'SUMMARY.md'))) info.incompleteBrief = true;
    }
    const verificationFile = fs.readdirSync(phaseDir).find((file) => file === 'VERIFICATION.md' || file.endsWith('-VERIFICATION.md'));
    const verificationRaw = verificationFile ? platformReadSync(path.join(phaseDir, verificationFile)) : null;
    if (verificationRaw !== null) {
      const status = extractFrontmatter(verificationRaw).status;
      info.verification = typeof status === 'string' ? status : null;
    }
  } catch {
    // Unreadable phase files leave the defaults: no build recommendation.
  }
  return info;
}
```

In `cmdInitManager`, replace

```js
  while ((_cbMatch = _cbPattern.exec(content)) !== null) {
    _checkboxStates.set(_cbMatch[2], _cbMatch[1].toLowerCase() === 'x');
  }
```

with

```js
  while ((_cbMatch = _cbPattern.exec(content)) !== null) {
    _checkboxStates.set(_cbMatch[2], _cbMatch[1].toLowerCase() === 'x');
  }
  const buildInfoByPhase = new Map();
```

In `cmdInitManager`, inside the `if (dirMatch)` block, add after the line that assigns `hasResearch`:

```js
        buildInfoByPhase.set(phaseNum, readPhaseBuildInfo(fullDir));
```

Replace the block from `  // Compute recommended actions (execute > plan > discuss)` through the closing `  }` of its `for (const phase of phases)` loop with:

```js
  // Compute recommended actions (execute > plan > discuss). While
  // workflow.build_mode is on, build replaces plan and suggests --gaps.
  // An unfinished brief resumes build in either mode (execute-phase refuses briefs).
  // Skip BACKLOG phases (999.x numbering) — they are parked ideas, not active work
  const buildMode = readBuildMode(cwd);
  const recommendedActions = [];
  for (const phase of phases) {
    if (/^999(?:\.|$)/.test(phase.number)) continue;

    const buildInfo = buildInfoByPhase.get(phase.number);
    if (buildInfo && buildInfo.hasBrief) {
      const gaps = buildMode && phase.disk_status === 'complete' && !phase.roadmap_complete && buildInfo.verification === 'gaps_found';
      const resume = (phase.disk_status === 'planned' || phase.disk_status === 'partial') && buildInfo.incompleteBrief && phase.deps_satisfied;
      if (gaps || resume) {
        recommendedActions.push({
          phase: phase.number,
          phase_name: phase.name,
          action: 'build',
          reason: gaps ? 'Verification found gaps' : 'Build in progress — resume',
          command: `${formatGsdSlash('build', _slashRuntime)} ${phase.number}${gaps ? ' --gaps' : ''}`,
        });
        continue;
      }
    }
    if (phase.disk_status === 'complete') continue;

    if (phase.disk_status === 'planned' && phase.deps_satisfied) {
      recommendedActions.push({
        phase: phase.number,
        phase_name: phase.name,
        action: 'execute',
        reason: `${phase.plan_count} plans ready, dependencies met`,
        command: `${formatGsdSlash('execute-phase', _slashRuntime)} ${phase.number}`,
      });
    } else if (phase.disk_status === 'discussed' || phase.disk_status === 'researched') {
      if (!buildMode) {
        recommendedActions.push({
          phase: phase.number,
          phase_name: phase.name,
          action: 'plan',
          reason: 'Context gathered, ready for planning',
          command: `${formatGsdSlash('plan-phase', _slashRuntime)} ${phase.number}`,
        });
      } else if (!phase.has_context) {
        // A build needs CONTEXT.md: a researched phase without it is discussed first.
        recommendedActions.push({
          phase: phase.number,
          phase_name: phase.name,
          action: 'discuss',
          reason: 'Research exists but no CONTEXT.md',
          command: `${formatGsdSlash('discuss-phase', _slashRuntime)} ${phase.number}`,
        });
      } else if (phase.deps_satisfied) {
        recommendedActions.push({
          phase: phase.number,
          phase_name: phase.name,
          action: 'build',
          reason: 'Context gathered, ready to build',
          command: `${formatGsdSlash('build', _slashRuntime)} ${phase.number}`,
        });
      }
    } else if ((phase.disk_status === 'empty' || phase.disk_status === 'no_directory') && phase.is_next_to_discuss) {
      recommendedActions.push({
        phase: phase.number,
        phase_name: phase.name,
        action: 'discuss',
        reason: 'Unblocked, ready to gather context',
        command: `${formatGsdSlash('discuss-phase', _slashRuntime)} ${phase.number}`,
      });
    }
  }
```

Replace

```js
  const filteredActions = recommendedActions.filter(action => {
    if (action.action === 'execute' && activeExecuting.length > 0) {
```

with

```js
  const filteredActions = recommendedActions.filter(action => {
    if (action.action === 'build') {
      // A build plans and executes, so it must be independent of all active work.
      return [...activeExecuting, ...activePlanning].every(active => !hasDepRelationship(action.phase, active.number));
    }
    if (action.action === 'execute' && activeExecuting.length > 0) {
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
(cd sdk && npm run build && npx vitest run src/query/phase.test.ts src/query/route-next-action.test.ts src/query/init-complex.test.ts src/phase-runner.test.ts)
node --test tests/phase.test.cjs tests/init-manager.test.cjs tests/bug-3584-runtime-slash-emitters.test.cjs tests/bug-2268-parallel-discuss.test.cjs tests/execute-phase-wave.test.cjs
```

Expected: all pass. If `tests/bug-3584-runtime-slash-emitters.test.cjs` checks the prefix of every recommended command, the new `/fvgsd-build` and `$fvgsd-build` commands satisfy it unchanged.

- [ ] **Step 10: Compare the root suite with the baseline**

```bash
npm test > "$WS/task-11-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-11-root.log"
```

Expected: `"newFailures": []`. If a test outside the files above pins a manager `plan` action or an exact `phase-plan-index` plan object, pin it the same way instead of loosening it:
- a manager test: write `{ "workflow": { "build_mode": false } }` into its fixture config
- a plan-index test: add `kind: null` to its expected plan

Name every such file in your report, and add it to the `git add` paths in Step 11.

- [ ] **Step 11: Commit**

```bash
git add sdk/src/types.ts sdk/src/query/phase.ts get-shit-done/bin/lib/phase.cjs sdk/src/query/route-next-action.ts sdk/src/query/init-complex.ts get-shit-done/bin/lib/init.cjs sdk/src/query/phase.test.ts tests/phase.test.cjs sdk/src/query/route-next-action.test.ts sdk/src/query/init-complex.test.ts tests/init-manager.test.cjs
git commit -m "feat: route build phases to /fvgsd-build in next-action and the manager

Plan indexes report each plan's kind. With workflow.build_mode on, discussed
phases route to /fvgsd-build and build phases whose verification found gaps
route to /fvgsd-build --gaps. Unfinished brief plans resume /fvgsd-build in
either mode, because execute-phase refuses briefs. Also fixes the stale
/gsd-new-project and /gsd-resume-work expectations in route-next-action.test.ts."
```

---

### Task 12: Workflow routing prompts and the execute-phase guard

**Files:**
- Modify: `get-shit-done/workflows/do.md`, `get-shit-done/workflows/next.md`, `get-shit-done/workflows/progress.md`, `get-shit-done/workflows/manager.md`, `get-shit-done/workflows/autonomous.md`, `get-shit-done/workflows/transition.md`, `get-shit-done/workflows/discuss-phase/modes/chain.md`, `get-shit-done/workflows/execute-phase.md`
- Create: `tests/fvgsd-build-routing-prompts.test.cjs`

**Interfaces:**
- **Consumes:**
  - `/fvgsd-build` and its end markers `## BUILD COMPLETE`, `## BUILD GAPS FOUND`, `## BUILD BLOCKED`, `## BUILD STOPPED` (Task 10)
  - the plan `kind` in `phase-plan-index` (Task 11)
  - manager `build` actions whose commands are `/fvgsd-build N` or `/fvgsd-build N --gaps` (Task 11)
  - `workflow.build_mode` (Task 1)
- **Produces:** prompt-level routing only; no code interfaces.

A plan with `kind: brief` always routes to `/fvgsd-build`, even when `workflow.build_mode` is `false`, because execute-phase refuses to run briefs (the Step 10 guard). `workflow.build_mode` only decides what a phase with no plans gets.

- [ ] **Step 1: Write the failing test**

Create `tests/fvgsd-build-routing-prompts.test.cjs`:

```js
// allow-test-rule: source-text-is-the-product
// Workflow .md files are loaded verbatim by the runtime; their routing tables,
// handler headings and Skill() calls are the deployed routing contract.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOWS = path.join(__dirname, '..', 'get-shit-done', 'workflows');

function read(relPath) {
  return fs.readFileSync(path.join(WORKFLOWS, relPath), 'utf8');
}

function stepBody(content, name) {
  const match = content.match(new RegExp(`<step name="${name}"[^>]*>([\\s\\S]*?)</step>`));
  assert.ok(match, `step ${name} not found`);
  return match[1];
}

function tableRows(markdown) {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && !/^\|[\s:|-]+\|$/.test(line))
    .slice(1)
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

function headingSection(content, heading) {
  const lines = content.split('\n');
  const start = lines.indexOf(heading);
  assert.ok(start !== -1, `${heading} not found`);
  const end = lines.findIndex((line, index) => index > start && /^#{1,3} /.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

describe('workflow prompts route discussed phases to /fvgsd-build', () => {
  test('do.md routes "build phase N" to /fvgsd:build before plan-phase', () => {
    const rows = tableRows(stepBody(read('do.md'), 'route'))
      .map(([intent, route]) => ({ intent, route: route.replace(/`/g, '') }));
    const build = rows.findIndex((row) => row.route === '/fvgsd:build');
    const plan = rows.findIndex((row) => row.route === '/fvgsd:plan-phase');
    assert.ok(build !== -1, 'no /fvgsd:build row');
    assert.ok(build < plan, 'the /fvgsd:build row must precede the plan-phase row');
    const execute = rows.find((row) => row.route === '/fvgsd:execute-phase');
    assert.ok(!/build phase/i.test(execute.intent), 'the execute-phase row still claims "build phase N"');
  });

  test('manager.md has a Build Phase N handler that runs the build skill', () => {
    const section = headingSection(read('manager.md'), '### Build Phase N');
    assert.ok(section.includes('Skill(skill=\\"fvgsd-build\\"'));
  });

  test('chain mode and autonomous mode launch the build skill', () => {
    assert.ok(read(path.join('discuss-phase', 'modes', 'chain.md')).includes('Skill(skill="fvgsd-build"'));
    assert.ok(read('autonomous.md').includes('Skill(skill="fvgsd-build"'));
  });

  test('execute-phase stops before running a build brief', () => {
    const body = stepBody(read('execute-phase.md'), 'initialize');
    assert.ok(body.includes('was started with /fvgsd-build — run /fvgsd-build ${PHASE_ARG} to resume.'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/fvgsd-build-routing-prompts.test.cjs`
Expected: FAIL — `no /fvgsd:build row`, `### Build Phase N not found`, and the chain, autonomous and execute-phase assertions fail.

- [ ] **Step 3: `do.md`**

Replace:

```markdown
| Planning a specific phase or "plan phase N" | `/fvgsd:plan-phase` | Direct planning request |
| Executing a phase or "build phase N", "run phase N" | `/fvgsd:execute-phase` | Direct execution request |
```

with:

```markdown
| Building a discussed phase or "build phase N" | `/fvgsd:build` | Plan and execute in one step |
| Planning a specific phase or "plan phase N" | `/fvgsd:plan-phase` | Direct planning request |
| Executing a phase or "run phase N", "execute phase N" | `/fvgsd:execute-phase` | Direct execution request |
```

Insert this paragraph immediately before the line that starts `**Requires \`.planning/\` directory:**`:

```markdown
**Build mode:** before dispatching `/fvgsd:build`, run `fvgsd-sdk query config-get workflow.build_mode --default true`. When it prints `false`, route "build phase N" to `/fvgsd:execute-phase` instead, or to `/fvgsd:plan-phase` when the phase has no plans yet. Keep `/fvgsd:build` when `fvgsd-sdk query phase-plan-index N` shows a plan with `has_summary: false` and `kind: "brief"`, because execute-phase refuses build briefs.

```

- [ ] **Step 4: `next.md`**

Replace:

```markdown
**Route 3: Phase has context but no plans → plan**
If the current phase has CONTEXT.md (or RESEARCH.md) but no PLAN.md files:
→ Next action: `/fvgsd:plan-phase <current-phase>`

**Route 4: Phase has plans but incomplete summaries → execute**
If plans exist but not all have matching summaries:
→ Next action: `/fvgsd:execute-phase <current-phase>`
```

with:

```markdown
**Route 3: Phase has context but no plans → build (or plan)**
If the current phase has CONTEXT.md (or RESEARCH.md) but no PLAN.md files, run `fvgsd-sdk query config-get workflow.build_mode --default true`:
→ Prints `true` and the phase has CONTEXT.md: `/fvgsd:build <current-phase>`
→ Prints `true` and the phase has only RESEARCH.md: `/fvgsd:discuss-phase <current-phase>` (a build needs CONTEXT.md)
→ Otherwise: `/fvgsd:plan-phase <current-phase>`

**Route 4: Phase has plans but incomplete summaries → resume the build (or execute)**
If plans exist but not all have matching summaries, run `fvgsd-sdk query phase-plan-index <current-phase>`:
→ A plan with `has_summary: false` has `kind: "brief"`: `/fvgsd:build <current-phase>` (resumes the build; execute-phase refuses briefs)
→ Otherwise: `/fvgsd:execute-phase <current-phase>`

**Route 4b: Build phase has verification gaps → gap build**
If `fvgsd-sdk query config-get workflow.build_mode --default true` prints `true`, a plan in the current phase has `kind: "brief"`, every plan has a summary, and the phase VERIFICATION.md frontmatter has `status: gaps_found`:
→ Next action: `/fvgsd:build <current-phase> --gaps`
```

- [ ] **Step 5: `progress.md`**

In the Step 2 routing table, replace:

```markdown
| uat_with_gaps > 0 | UAT gaps need fix plans | Go to **Route E** |
```

with:

```markdown
| uat_with_gaps > 0 | UAT gaps need fix plans | Go to **Route E** |
| summaries = plans, a plan has `kind: brief`, VERIFICATION.md has `status: gaps_found`, `workflow.build_mode` is true | Build left gaps | Go to **Route E.3** |
```

In Route A, replace:

```markdown
Find the first PLAN.md without matching SUMMARY.md.
Read its `<objective>` section.
```

with:

```markdown
Find the first PLAN.md without matching SUMMARY.md.
Read its `<objective>` section and its frontmatter `kind`.

**If `kind` is `brief`**, a build is in progress: show `/fvgsd:build {phase} ${FVGSD_WS}` (it resumes the build) instead of `/fvgsd:execute-phase` in the block below. This holds even when `workflow.build_mode` is `false`, because execute-phase refuses build briefs.
```

In Route B, replace the line:

```markdown
**If CONTEXT.md exists:**
```

with:

````markdown
**If CONTEXT.md exists and `fvgsd-sdk query config-get workflow.build_mode --default true` prints `true`:**

```
---

## ▶ Next Up — [${PROJECT_CODE}] ${PROJECT_TITLE}

**Phase {N}: {Name}** — {Goal from ROADMAP.md}
<sub>✓ Context gathered, ready to build</sub>

`/clear` then:

`/fvgsd:build {phase-number} ${FVGSD_WS}`

---

**Also available:**
- `/fvgsd:plan-phase {phase-number} ${FVGSD_WS}` — plan and execute as separate steps

---
```

**If CONTEXT.md exists and build mode is off:**
````

Insert this block immediately before the line `**Step 3: Check milestone status (only when phase complete)**`:

````markdown
**Route E.3: Build left verification gaps**

A plan in this phase has `kind: brief`, every plan has a summary, and `{phase_num}-VERIFICATION.md` has `status: gaps_found`.

```
---

## ⚠ Build Gaps Found

**{phase_num}-VERIFICATION.md** lists {N} gaps.

`/clear` then:

`/fvgsd:build {phase} --gaps ${FVGSD_WS}`

---

**Also available:**
- `/fvgsd:verify-work {phase} ${FVGSD_WS}` — check the build by hand first

---
```

---

````

- [ ] **Step 6: `manager.md`**

Make these replacements:
1. In `<purpose>`, `dispatches discuss inline and plan/execute as background agents` → `dispatches discuss inline and plan/execute/build as background agents`.
2. `1. Collect all background actions (execute and plan recommendations) — there can be multiple of each.` → `1. Collect all background actions (execute, plan, and build recommendations) — there can be multiple of each.`
3. In the "Display recommendations compactly" block, replace
   ```
   Continue:
     → Execute Phase 32 (background)
     → Plan Phase 34 (background)
   ```
   (two-space indent before each arrow) with
   ```
   Continue:
     → Execute Phase 32 (background)
     → Build Phase 33 (background)
     → Plan Phase 34 (background)
   ```
4. `1. **Spawn all background agents first** (plan/execute) — dispatch them in parallel using the Plan Phase N / Execute Phase N handlers below.` → `1. **Spawn all background agents first** (plan/execute/build) — dispatch them in parallel using the Plan Phase N / Execute Phase N / Build Phase N handlers below.`
5. Replace every occurrence (there are two) of `if the failed action was execution. Loop to dashboard after.` with ``if the failed action was execution, or `Skill(skill="fvgsd-build", args="{N}")` if the failed action was a build. Loop to dashboard after.``
6. `- [ ] Recommendations prioritize: execute > plan > discuss` → `- [ ] Recommendations prioritize: execute and build > plan > discuss`. After the line `- [ ] Execute phases spawn background Task agents — return to dashboard immediately`, add `- [ ] Build phases spawn background Task agents — return to dashboard immediately`.

Then replace the end of the Execute Phase N handler:

````markdown
◆ Spawning executor for Phase {N}: {phase_name}...
```

Loop back to dashboard step.
````

with:

````markdown
◆ Spawning executor for Phase {N}: {phase_name}...
```

Loop back to dashboard step.

### Build Phase N

Building runs autonomously: one command plans, builds, verifies and summarizes the phase. Spawn a background agent that delegates to the Skill pipeline. When the recommended command ends in `--gaps`, pass `--gaps` too:

```
Agent(
  description="Build phase {N}: {phase_name}",
  run_in_background=true,
  prompt="You are running the GSD build workflow for phase {N} of the project.

Working directory: {cwd}
Phase: {N} — {phase_name}
Goal: {goal}

Run the build Skill (args=\"{N} --gaps\" when the recommended command ends in --gaps):
Skill(skill=\"fvgsd-build\", args=\"{N}\")

Important: You are running in the background. Do NOT use AskUserQuestion — make autonomous decisions. When the build needs an answer it records a blocker in STATE.md and stops with its BUILD BLOCKED marker; report that. Do NOT use --no-verify on git commits."
)
```

> **ORCHESTRATOR RULE — CODEX RUNTIME**: After calling Agent() above with `run_in_background=true`, do NOT do any build work for this phase independently. Return to the dashboard immediately and wait for the background agent to report back.

Display:

```
◆ Spawning builder for Phase {N}: {phase_name}...
```

Loop back to dashboard step.
````

- [ ] **Step 7: `autonomous.md`**

Insert this block immediately before the line `**3b. Plan**`:

````markdown
**3b′. Build mode**

```bash
BUILD_MODE=$(fvgsd-sdk query config-get workflow.build_mode --default true 2>/dev/null || echo "true")
```

**If `BUILD_MODE` is not `false`, or `fvgsd-sdk query phase-plan-index ${PHASE_NUM}` shows a plan with `has_summary: false` and `kind: "brief"` (execute-phase refuses briefs):** run one build step instead of 3b, 3c and 3c.5, then continue at 3d (post-execution routing). Skip the 3c.5 code review: the build reviews its own diff when `workflow.build_code_review` is true.

**If `INTERACTIVE` is set:** dispatch the build as a background agent, and wait for it before post-execution routing for this phase:

```
Agent(
  description="Build phase ${PHASE_NUM}: ${PHASE_NAME}",
  run_in_background=true,
  prompt="Run build for phase ${PHASE_NUM}: Skill(skill=\"fvgsd-build\", args=\"${PHASE_NUM}\")"
)
```

**If `INTERACTIVE` is NOT set (default):**

```
Skill(skill="fvgsd-build", args="${PHASE_NUM}")
```

Verify the build produced a brief: re-run `init phase-op` and check `has_plans`. If false → go to handle_blocker: "Build for phase ${PHASE_NUM} did not produce a brief."

**Otherwise:** continue with 3b and 3c.

````

In 3d, replace:

````markdown
On **"Run gap closure"**: Execute gap closure cycle (limit: 1 attempt):

```
Skill(skill="fvgsd-plan-phase", args="${PHASE_NUM} --gaps")
```
````

with:

````markdown
On **"Run gap closure"**: Execute gap closure cycle (limit: 1 attempt).

**If `BUILD_MODE` is not `false`:** run the gap build, then go straight to "Re-read verification status" below:

```
Skill(skill="fvgsd-build", args="${PHASE_NUM} --gaps")
```

**If `BUILD_MODE` is `false`:**

```
Skill(skill="fvgsd-plan-phase", args="${PHASE_NUM} --gaps")
```
````

- [ ] **Step 8: `transition.md`**

In `<internal_workflow>`, replace:

```markdown
- `/fvgsd:discuss-phase {N}` — discuss a phase before planning
```

with:

```markdown
- `/fvgsd:discuss-phase {N}` — discuss a phase before planning
- `/fvgsd:build {N}` — plan and execute a discussed phase in one step
```

In the yolo block, replace:

````markdown
**If CONTEXT.md exists:**

```
Phase [X] marked complete.

Next: Phase [X+1] — [Name]

⚡ Auto-continuing: Plan Phase [X+1] in detail
```

Exit skill and invoke SlashCommand("/fvgsd:plan-phase [X+1] --auto ${FVGSD_WS}")
````

with:

````markdown
**If CONTEXT.md exists and `fvgsd-sdk query config-get workflow.build_mode --default true` prints `true`:**

```
Phase [X] marked complete.

Next: Phase [X+1] — [Name]

⚡ Auto-continuing: Build Phase [X+1]
```

Exit skill and invoke SlashCommand("/fvgsd:build [X+1] ${FVGSD_WS}")

**If CONTEXT.md exists and build mode is off:**

```
Phase [X] marked complete.

Next: Phase [X+1] — [Name]

⚡ Auto-continuing: Plan Phase [X+1] in detail
```

Exit skill and invoke SlashCommand("/fvgsd:plan-phase [X+1] --auto ${FVGSD_WS}")
````

In the interactive block, replace:

````markdown
**If CONTEXT.md exists:**

```
## ✓ Phase [X] Complete
````

with:

````markdown
**If CONTEXT.md exists and `fvgsd-sdk query config-get workflow.build_mode --default true` prints `true`:**

```
## ✓ Phase [X] Complete

---

## ▶ Next Up — [${PROJECT_CODE}] ${PROJECT_TITLE}

**Phase [X+1]: [Name]** — [Goal from ROADMAP.md]
<sub>✓ Context gathered, ready to build</sub>

`/clear` then:

`/fvgsd:build [X+1] ${FVGSD_WS}`

---

**Also available:**
- `/fvgsd:plan-phase [X+1] ${FVGSD_WS}` — plan and execute as separate steps
- `/fvgsd:discuss-phase [X+1] ${FVGSD_WS}` — revisit context

---
```

**If CONTEXT.md exists and build mode is off:**

```
## ✓ Phase [X] Complete
````

- [ ] **Step 9: `discuss-phase/modes/chain.md`**

Replace:

```markdown
- After discussion completes, **auto-advance to plan-phase → execute-phase**
  (same downstream behavior as `--auto`).
```

with:

```markdown
- After discussion completes, **auto-advance to `/fvgsd:build`** when
  `workflow.build_mode` is true, or to plan-phase → execute-phase when it is
  false (same downstream behavior as `--auto`).
```

Replace:

```markdown
5. **If `--auto` flag present OR `--chain` flag present OR `AUTO_MODE` is
   true:** display banner and launch plan-phase.
```

with:

````markdown
5. **If `--auto` flag present OR `--chain` flag present OR `AUTO_MODE` is
   true:** check build mode first:
   ```bash
   BUILD_MODE=$(fvgsd-sdk query config-get workflow.build_mode --default true 2>/dev/null || echo "true")
   ```

   **If `BUILD_MODE` is not `false`:** display the banner with
   `GSD ► AUTO-ADVANCING TO BUILD`, then launch the build with the Skill tool
   (the same flat-nesting reason as the plan-phase launch below):
   ```
   Skill(skill="fvgsd-build", args="${PHASE} ${FVGSD_WS}")
   ```
   Handle the build's end marker:
   - `## BUILD COMPLETE` → show the PHASE COMPLETE banner from step 6 with
     `Next: /fvgsd:discuss-phase ${NEXT_PHASE} ${WAS_CHAIN ? "--chain" : "--auto"} ${FVGSD_WS}`
   - `## BUILD GAPS FOUND` → `Auto-advance stopped: Gaps found during the build.`
     and `Continue: /fvgsd:build ${PHASE} --gaps ${FVGSD_WS}`
   - `## BUILD BLOCKED` or `## BUILD STOPPED` → `Auto-advance stopped: The build needs input.`
     and `Continue: /fvgsd:build ${PHASE} ${FVGSD_WS}`

   Skip the plan-phase launch and step 6.

   **If `BUILD_MODE` is `false`:** display banner and launch plan-phase.
````

- [ ] **Step 10: `execute-phase.md` guard**

In `<step name="initialize">`, replace:

```markdown
**If `plan_count` is 0:** Error — no plans found in phase.
```

with:

```markdown
**If `plan_count` is 0:** Error — no plans found in phase.
**If the phase was started with `/fvgsd-build`:** run `fvgsd-sdk query phase-plan-index "${PHASE_ARG}"`. When any plan with `has_summary: false` has `kind: "brief"`, stop with: `Phase ${PHASE_ARG} was started with /fvgsd-build — run /fvgsd-build ${PHASE_ARG} to resume.`
```

This makes `execute-phase.md` 1817 lines. `tests/workflow-size-budget.test.cjs` already fails at baseline for this file (1816 lines against its 1810 budget); it stays one failing test with the same title.

- [ ] **Step 11: Run the tests**

```bash
node --test tests/fvgsd-build-routing-prompts.test.cjs tests/bug-2643-skill-frontmatter-name.test.cjs tests/workflow-size-budget.test.cjs tests/gsd-sdk-query-registry-integration.test.cjs tests/agent-frontmatter.test.cjs
```

Expected: `tests/fvgsd-build-routing-prompts.test.cjs` passes. The other files pass apart from the failures already in `baseline-root.log`, which include the `execute-phase` size budget test. The `discuss-phase/modes/chain.md` regression test in `tests/workflow-size-budget.test.cjs` still passes, because chain.md keeps "plan-phase" and "auto-advance".

- [ ] **Step 12: Run the root suite against the baseline**

```bash
npm test > "$WS/task-12-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-12-root.log"
```

Expected: `"newFailures": []` and no `missingTitles`.

- [ ] **Step 13: Commit**

```bash
git add get-shit-done/workflows/do.md get-shit-done/workflows/next.md get-shit-done/workflows/progress.md \
  get-shit-done/workflows/manager.md get-shit-done/workflows/autonomous.md get-shit-done/workflows/transition.md \
  get-shit-done/workflows/discuss-phase/modes/chain.md get-shit-done/workflows/execute-phase.md \
  tests/fvgsd-build-routing-prompts.test.cjs
git commit -m "feat: route discussed phases to /fvgsd-build in workflow prompts"
```

---

### Task 13: SDK runner fixes

**Files:**
- Modify: `sdk/src/phase-runner.ts`
- Modify: `sdk/src/context-engine.ts`
- Test: `sdk/src/phase-runner.test.ts`
- Test: `sdk/src/context-engine.test.ts`

**Interfaces:**
- **Consumes:**
  - `runGit(cwd, args): GitResult` and `changedFilesSince(projectDir, base): ChangedFile[]` from `sdk/src/query/build-shared.ts` (Tasks 2 and 5)
  - `isDebtScannable(file)` and `findDebtMarkers(file, content)` from `sdk/src/debt-markers.ts` (Task 5)
- **Produces:**
  - `ContextEngine.resolveContextFiles(phaseType: PhaseType, phaseDir?: string): Promise<ContextFiles>`, where `phaseDir` is project-relative or absolute; Task 14 extends it
  - `PhaseRunner` threads the phase directory into `runStep`, `runPlanCheckStep`, `runSelfDiscussStep`, `runVerifyStep` and `executeSinglePlan`

- [ ] **Step 1: Write the failing tests**

In `sdk/src/phase-runner.test.ts`, add `import { execFileSync } from 'node:child_process';` after the `node:os` import. Replace the whole `it('handles zero plans gracefully', ...)` block with:

```ts
    it('fails the execute step when the phase has no plans', async () => {
      const phaseOp = makePhaseOp({ has_context: true, plan_count: 0, has_plans: true });
      const config = makeConfig({ workflow: { research: false, verifier: false, skip_discuss: true, plan_check: false } as any });
      const deps = makeDeps({ config });
      (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
      (deps.tools.phasePlanIndex as ReturnType<typeof vi.fn>).mockResolvedValue(makePlanIndex(0));

      const runner = new PhaseRunner(deps);
      const result = await runner.run('1');

      const executeStep = result.steps.find(s => s.step === PhaseStepType.Execute);
      expect(executeStep).toBeDefined();
      expect(executeStep!.success).toBe(false);
      expect(executeStep!.error).toBe('no plans found');
    });

    it('keeps the execute step successful when every plan already has a summary', async () => {
      const phaseOp = makePhaseOp({ has_context: true, plan_count: 1, has_plans: true });
      const config = makeConfig({ workflow: { research: false, verifier: false, skip_discuss: true, plan_check: false } as any });
      const deps = makeDeps({ config });
      (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
      const index = makePlanIndex(1);
      index.plans[0].has_summary = true;
      (deps.tools.phasePlanIndex as ReturnType<typeof vi.fn>).mockResolvedValue(index);

      const result = await new PhaseRunner(deps).run('1');

      const executeStep = result.steps.find(s => s.step === PhaseStepType.Execute);
      expect(executeStep!.success).toBe(true);
      expect(executeStep!.planResults).toHaveLength(0);
    });
```

Add these helpers after `getEmittedEvents`, near the top of the file:

```ts
function gitIn(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
}

/**
 * Repo with an initial commit, a brief plan, then a committed src/x.ts containing sourceLine.
 * The brief is committed unless trackPlanning is false, which git-ignores .planning/.
 */
async function commitBriefPhase(projectDir: string, sourceLine: string, trackPlanning = true): Promise<string> {
  const phaseDir = join(projectDir, '.planning', 'phases', '01-auth');
  await mkdir(phaseDir, { recursive: true });
  await mkdir(join(projectDir, 'src'), { recursive: true });
  gitIn(projectDir, 'init', '-q');
  gitIn(projectDir, 'config', 'user.email', 'test@test.com');
  gitIn(projectDir, 'config', 'user.name', 'Test');
  gitIn(projectDir, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(projectDir, 'README.md'), '# fixture\n', 'utf-8');
  if (!trackPlanning) await writeFile(join(projectDir, '.gitignore'), '.planning/\n', 'utf-8');
  gitIn(projectDir, 'add', '-A');
  gitIn(projectDir, 'commit', '-q', '-m', 'initial');
  await writeFile(join(phaseDir, '01-01-PLAN.md'), '---\nkind: brief\nfiles_modified: []\n---\n', 'utf-8');
  if (trackPlanning) {
    gitIn(projectDir, 'add', '-A');
    gitIn(projectDir, 'commit', '-q', '-m', 'docs(01): build brief');
  }
  await writeFile(join(projectDir, 'src', 'x.ts'), `export const retries = 1;\n${sourceLine}\n`, 'utf-8');
  gitIn(projectDir, 'add', '-A');
  gitIn(projectDir, 'commit', '-q', '-m', 'feat(01-s1): retries');
  return phaseDir;
}
```

Inside `describe('verification routing', ...)`, after the test `'keeps phase pending when changed phase files contain unresolved TBD/FIXME/XXX markers'`, add:

```ts
    it('scans files changed since the first plan commit when the plan is a brief', async () => {
      const projectDir = await mkdtemp(join(tmpdir(), 'fvgsd-brief-debt-'));
      tempProjectDirs.push(projectDir);
      const phaseDir = await commitBriefPhase(projectDir, '// FIXME handle retries');
      const phaseOp = makePhaseOp({ phase_dir: phaseDir, has_context: true, has_plans: true, plan_count: 1 });
      const config = makeConfig({ workflow: { research: false, skip_discuss: true, plan_check: false } as any });
      const deps = makeDeps({ projectDir, config });
      (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
      const brief = makeParsedPlan([]);
      mockParsePlanFile.mockResolvedValue({ ...brief, frontmatter: { ...brief.frontmatter, kind: 'brief' } } as any);

      const result = await new PhaseRunner(deps).run('1');

      const verifyStep = result.steps.find(s => s.step === PhaseStepType.Verify);
      expect(verifyStep?.success).toBe(false);
      expect(verifyStep?.error).toBe('verification_gaps_found');
      expect(deps.tools.phaseComplete).not.toHaveBeenCalled();
    });

    it('passes the brief debt scan when the marker cites tracked work', async () => {
      const projectDir = await mkdtemp(join(tmpdir(), 'fvgsd-brief-tracked-'));
      tempProjectDirs.push(projectDir);
      const phaseDir = await commitBriefPhase(projectDir, '// FIXME #12 handle retries');
      const phaseOp = makePhaseOp({ phase_dir: phaseDir, has_context: true, has_plans: true, plan_count: 1 });
      const config = makeConfig({ workflow: { research: false, skip_discuss: true, plan_check: false } as any });
      const deps = makeDeps({ projectDir, config });
      (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
      const brief = makeParsedPlan([]);
      mockParsePlanFile.mockResolvedValue({ ...brief, frontmatter: { ...brief.frontmatter, kind: 'brief' } } as any);

      const result = await new PhaseRunner(deps).run('1');

      expect(result.success).toBe(true);
      expect(deps.tools.phaseComplete).toHaveBeenCalledWith('1');
    });

    it('falls back to the first phase-scoped commit when the brief was never committed', async () => {
      const projectDir = await mkdtemp(join(tmpdir(), 'fvgsd-brief-untracked-'));
      tempProjectDirs.push(projectDir);
      const phaseDir = await commitBriefPhase(projectDir, '// FIXME handle retries', false);
      const phaseOp = makePhaseOp({ phase_dir: phaseDir, has_context: true, has_plans: true, plan_count: 1 });
      const config = makeConfig({ workflow: { research: false, skip_discuss: true, plan_check: false } as any });
      const deps = makeDeps({ projectDir, config });
      (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
      const brief = makeParsedPlan([]);
      mockParsePlanFile.mockResolvedValue({ ...brief, frontmatter: { ...brief.frontmatter, kind: 'brief' } } as any);

      const result = await new PhaseRunner(deps).run('1');

      const verifyStep = result.steps.find(s => s.step === PhaseStepType.Verify);
      expect(verifyStep?.error).toBe('verification_gaps_found');
      expect(deps.tools.phaseComplete).not.toHaveBeenCalled();
    });
```

In `sdk/src/context-engine.test.ts`, inside `describe('resolveContextFiles', ...)`, add:

```ts
    it('prefers phase-folder CONTEXT.md and RESEARCH.md when phaseDir is given', async () => {
      await createPlanningDir(projectDir, {
        'STATE.md': '# State',
        'ROADMAP.md': '# Roadmap',
        'CONTEXT.md': '# Root context',
      });
      const phaseDir = join('.planning', 'phases', '03-user-auth');
      await mkdir(join(projectDir, phaseDir), { recursive: true });
      await writeFile(join(projectDir, phaseDir, '03-CONTEXT.md'), '# Phase context', 'utf-8');
      await writeFile(join(projectDir, phaseDir, '03-RESEARCH.md'), '# Phase research', 'utf-8');

      const files = await new ContextEngine(projectDir).resolveContextFiles(PhaseType.Plan, phaseDir);

      expect(files.context).toBe('# Phase context');
      expect(files.research).toBe('# Phase research');
    });

    it('falls back to the .planning root when the phase folder has no match', async () => {
      await createPlanningDir(projectDir, {
        'STATE.md': '# State',
        'ROADMAP.md': '# Roadmap',
        'CONTEXT.md': '# Root context',
      });
      const phaseDir = join('.planning', 'phases', '04-empty');
      await mkdir(join(projectDir, phaseDir), { recursive: true });

      const files = await new ContextEngine(projectDir).resolveContextFiles(PhaseType.Plan, phaseDir);

      expect(files.context).toBe('# Root context');
      expect(files.research).toBeUndefined();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sdk && npx vitest run src/phase-runner.test.ts src/context-engine.test.ts`
Expected: FAIL in these four tests:
- `fails the execute step when the phase has no plans` (success is `true`)
- `scans files changed since the first plan commit when the plan is a brief` (verify succeeds)
- `falls back to the first phase-scoped commit when the brief was never committed` (verify succeeds)
- `prefers phase-folder CONTEXT.md and RESEARCH.md when phaseDir is given` (the root context is returned)

- [ ] **Step 3: Fail the execute step when there are no plans**

In `sdk/src/phase-runner.ts` `runExecuteStep`, insert before the line `    // Filter to incomplete plans only (has_summary === false)`:

```ts
    if (planIndex.plans.length === 0) {
      const durationMs = Date.now() - stepStart;
      const error = 'no plans found';
      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step: PhaseStepType.Execute,
        success: false,
        durationMs,
        error,
      });
      return { step: PhaseStepType.Execute, success: false, durationMs, error };
    }

```

- [ ] **Step 4: Scan changed files for briefs and file-less plans**

In `sdk/src/phase-runner.ts`, keep the `import { isDebtScannable, findDebtMarkers, type DebtMarkerFinding } from './debt-markers.js';` line that Task 5 added, and add this one after it:

```ts
import { runGit, changedFilesSince } from './query/build-shared.js';
```

Replace the whole `checkArchitecturalDebt` method, including its doc comment, with the code below. Task 5 already replaced the private marker helpers with `debt-markers.ts`; delete any of `shouldScanForArchitecturalDebt`, `findUnresolvedDebtMarkers` or `hasFormalDebtReference` that still exist. `ArchitecturalDebtFinding` stays the type alias Task 5 made it: `type ArchitecturalDebtFinding = DebtMarkerFinding;`.

```ts
  /**
   * Block phase completion when source files changed by this phase still contain
   * unresolved TBD/FIXME/XXX comments. Markers are allowed only when the same
   * line references tracked follow-up work (issue/PR number or DEF-* id).
   *
   * Classic plans are scanned by their declared `files_modified` and task
   * `files`. Build briefs (`kind: brief`), and plans that declare no files, are
   * scanned by the files changed since the phase started (`.planning/`
   * excluded; see changedPhaseFiles).
   */
  private async checkArchitecturalDebt(phaseNumber: string): Promise<ArchitecturalDebtCheck> {
    let phaseOp: PhaseOpInfo;
    try {
      phaseOp = await this.tools.initPhaseOp(phaseNumber);
    } catch (err) {
      this.logger?.warn(`Could not initialize phase ${phaseNumber} for architectural debt check: ${err instanceof Error ? err.message : String(err)}`);
      return { pass: false, findings: [], reason: 'scan_error' };
    }

    let planPaths: string[];
    try {
      planPaths = await this.listPhasePlanPaths(phaseOp.phase_dir);
    } catch {
      return { pass: false, findings: [], reason: 'scan_error' };
    }
    if (phaseOp.has_plans && planPaths.length === 0) {
      this.logger?.warn(`No phase plans found for architectural debt check in phase ${phaseNumber}`);
      return { pass: false, findings: [], reason: 'scan_error' };
    }

    const filesToScan = new Set<string>();
    let hasBrief = false;
    for (const planPath of planPaths) {
      try {
        const parsedPlan = await parsePlanFile(planPath);
        if ((parsedPlan.frontmatter as unknown as Record<string, unknown>).kind === 'brief') {
          hasBrief = true;
        }
        for (const file of this.extractPlanFiles(parsedPlan)) {
          if (isDebtScannable(file)) {
            filesToScan.add(file);
          }
        }
      } catch (err) {
        this.logger?.warn(`Could not parse plan for architectural debt check (${planPath}): ${err instanceof Error ? err.message : String(err)}`);
        return { pass: false, findings: [], reason: 'scan_error' };
      }
    }

    if (hasBrief || filesToScan.size === 0) {
      filesToScan.clear();
      for (const file of this.changedPhaseFiles(phaseOp.phase_dir, phaseOp.padded_phase)) {
        filesToScan.add(file);
      }
    }

    const findings: ArchitecturalDebtFinding[] = [];
    for (const file of filesToScan) {
      const absolutePath = this.resolveProjectPath(file);
      if (!absolutePath) {
        findings.push({ file, line: 0, marker: 'path', text: 'File is outside the project root' });
        continue;
      }

      try {
        const content = await readFile(absolutePath, 'utf-8');
        findings.push(...findDebtMarkers(file, content));
      } catch (err) {
        const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
        if (code === 'ENOENT') {
          continue;
        }

        findings.push({
          file,
          line: 0,
          marker: 'read',
          text: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const hasDebtMarkers = findings.some(({ marker }) => marker !== 'path' && marker !== 'read');
    return {
      pass: findings.length === 0,
      findings,
      reason: findings.length === 0 ? undefined : hasDebtMarkers ? 'markers_found' : 'scan_error',
    };
  }

  /**
   * Files changed since the phase started: the parent of the oldest commit that
   * added a `*-PLAN.md` in the phase folder or, when no plan was ever committed
   * (for example `.planning/` is not tracked), the parent of the oldest commit
   * whose subject starts `feat(<padded>-`, `fix(<padded>-` or `chore(<padded>-`.
   * With neither, nothing is scanned. Returns [] outside a git repository.
   * A root commit is diffed against the empty tree.
   */
  private changedPhaseFiles(phaseDir: string, paddedPhase: string): string[] {
    const root = this.realpathForBoundary(resolve(this.projectDir));
    const absolutePhaseDir = this.resolveProjectPath(phaseDir);
    if (!root || !absolutePhaseDir) return [];
    const relPhaseDir = relative(root, absolutePhaseDir).split('\\').join('/');

    const log = runGit(this.projectDir, ['log', '--diff-filter=A', '--format=%H', '--', `${relPhaseDir}/*-PLAN.md`]);
    const addCommits = log.ok ? log.stdout.split('\n').filter(Boolean) : [];
    const firstPhaseCommit = addCommits[addCommits.length - 1] ?? this.firstPhaseScopedCommit(paddedPhase);
    if (!firstPhaseCommit) return [];

    const parent = runGit(this.projectDir, ['rev-parse', '--verify', '--quiet', `${firstPhaseCommit}^`]);
    const base = parent.ok && parent.stdout
      ? parent.stdout
      : runGit(this.projectDir, ['hash-object', '-t', 'tree', '/dev/null']).stdout;
    if (!base) return [];

    return changedFilesSince(this.projectDir, base)
      .filter((entry) => entry.status !== 'D' && isDebtScannable(entry.path))
      .map((entry) => entry.path);
  }

  /** Oldest commit whose subject starts `feat(<padded>-`, `fix(<padded>-` or `chore(<padded>-`; undefined when none. */
  private firstPhaseScopedCommit(paddedPhase: string): string | undefined {
    if (!paddedPhase) return undefined;
    const scope = paddedPhase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const subject = new RegExp(`^(?:feat|fix|chore)\\(${scope}-`);
    const log = runGit(this.projectDir, ['log', '--format=%H%x09%s']);
    if (!log.ok) return undefined;
    const matches = log.stdout
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([sha, ...rest]) => Boolean(sha) && subject.test(rest.join('\t')))
      .map(([sha]) => sha);
    return matches[matches.length - 1];
  }
```

- [ ] **Step 5: Look up CONTEXT.md and RESEARCH.md in the phase folder**

In `sdk/src/context-engine.ts`:

1. Change the import `import { readFile, access } from 'node:fs/promises';` to `import { readFile, access, readdir } from 'node:fs/promises';`.
2. After the closing `};` of `PHASE_FILE_MANIFEST`, add:
   ```ts
   /** Manifest keys looked up in the phase folder (`NN-CONTEXT.md`, `CONTEXT.md`) before the .planning/ root. */
   const PHASE_FOLDER_KEYS: ReadonlySet<keyof ContextFiles> = new Set<keyof ContextFiles>(['context', 'research']);
   ```
3. Replace `  private readonly planningDir: string;` with:
   ```ts
     private readonly projectDir: string;
     private readonly planningDir: string;
   ```
   Insert `    this.projectDir = projectDir;` as the first line of the constructor body.
4. Replace `  async resolveContextFiles(phaseType: PhaseType): Promise<ContextFiles> {` with `  async resolveContextFiles(phaseType: PhaseType, phaseDir?: string): Promise<ContextFiles> {`. In that method, replace `      const filePath = join(this.planningDir, spec.filename);` with `      const filePath = await this.locateFile(spec, phaseDir);`.
5. Add this method directly above the `readFileIfExists` doc comment:
   ```ts
     /**
      * Resolve where a manifest file is read from. CONTEXT.md and RESEARCH.md are
      * looked up in the phase folder first (first sorted `*-CONTEXT.md` or
      * `CONTEXT.md`), then at the .planning/ root.
      */
     private async locateFile(spec: FileSpec, phaseDir?: string): Promise<string> {
       if (phaseDir && PHASE_FOLDER_KEYS.has(spec.key)) {
         const dir = isAbsolute(phaseDir) ? phaseDir : join(this.projectDir, phaseDir);
         try {
           const match = (await readdir(dir))
             .filter((name) => name === spec.filename || name.endsWith(`-${spec.filename}`))
             .sort()[0];
           if (match) return join(dir, match);
         } catch {
           // Missing phase folder: use the .planning/ root.
         }
       }
       return join(this.planningDir, spec.filename);
     }
   ```
   Change `import { join } from 'node:path';` to `import { isAbsolute, join } from 'node:path';`.

- [ ] **Step 6: Thread the phase directory through the runner**

In `sdk/src/phase-runner.ts`:
1. **Method signatures:**
   - Add an optional last parameter `phaseDir?: string` to `runPlanCheckStep`, `runSelfDiscussStep`, `runStep` and `runVerifyStep` (in `runVerifyStep` it goes after `options?: PhaseRunnerOptions`).
   - Inside each of those four methods, pass it as the second argument of `this.contextEngine.resolveContextFiles(...)`.
   - In `runVerifyStep`, also append `phaseDir` to its gap-closure call `this.runStep(PhaseStepType.Plan, phaseNumber, sessionOpts)`.
2. **`executeSinglePlan`:** change `this.contextEngine.resolveContextFiles(phaseType)` to `this.contextEngine.resolveContextFiles(phaseType, phaseOp.phase_dir)`.
3. **`run()`:** append `, phaseOp.phase_dir` as the last argument of every `this.runSelfDiscussStep(`, `this.runStep(`, `this.runPlanCheckStep(` and `this.runVerifyStep(` call.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd sdk && npx vitest run src/phase-runner.test.ts src/context-engine.test.ts src/tool-scoping.test.ts && npx tsc --noEmit`
Expected: all tests PASS; `tsc` exits 0.

- [ ] **Step 8: Commit**

```bash
git add sdk/src/phase-runner.ts sdk/src/context-engine.ts sdk/src/phase-runner.test.ts sdk/src/context-engine.test.ts
git commit -m "fix(sdk): fail empty execute steps, scan brief changes for debt, read phase-folder context"
```

---

### Task 14: SDK runner Build step

**Files:**
- Modify: `sdk/src/types.ts`
- Modify: `sdk/src/tool-scoping.ts`
- Modify: `sdk/src/context-engine.ts`
- Modify: `sdk/src/phase-prompt.ts`
- Modify: `sdk/src/session-runner.ts`
- Modify: `sdk/src/phase-runner.ts`
- Test: `sdk/src/phase-runner.test.ts`
- Test: `sdk/src/context-engine.test.ts`
- Test: `sdk/src/tool-scoping.test.ts`
- Test: `sdk/src/phase-runner.integration.test.ts` (fixture only)
- Test: `sdk/src/lifecycle-e2e.integration.test.ts` (fixture only)

**Interfaces:**
- **Consumes:**
  - `init.build` (Task 8), read through `tools.exec('init.build', [phase])` → `resume.state`
  - `ContextEngine.resolveContextFiles(phaseType, phaseDir?)` (Task 13)
  - `WorkflowConfig.build_mode` (Task 1)
  - `get-shit-done/workflows/build.md` (Task 10)
- **Produces:**
  - `PhaseType.Build`, `PhaseStepType.Build` and `ContextFiles.milestone`
  - `PromptFactory.buildPrompt(phaseType, plan, contextFiles, phaseDir?, args?)`
  - `PHASE_WORKFLOW_MAP[Build] = 'build.md'`
  - with `workflow.build_mode === true`, `PhaseRunner.run()` runs Research (`build.md --research-only`) → Build → Verify (state read from `init.build`) → Advance (skipped when the ROADMAP already marks the phase complete)

- [ ] **Step 1: Write the failing tests**

In `sdk/src/tool-scoping.test.ts`, append:

```ts
describe('build phase tools', () => {
  it('lets the build lead edit files and spawn agents, with no agent definition', () => {
    expect(getToolsForPhase(PhaseType.Build)).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent']);
    expect(PHASE_AGENT_MAP[PhaseType.Build]).toBeNull();
  });
});
```

In `sdk/src/context-engine.test.ts`, inside `describe('resolveContextFiles', ...)`, add:

```ts
    it('resolves the build manifest with the MILESTONE-BRIEF.md fallback', async () => {
      await createPlanningDir(projectDir, {
        'STATE.md': '# State',
        'ROADMAP.md': '# Roadmap',
        'REQUIREMENTS.md': '# Requirements',
        'MILESTONE-BRIEF.md': '# Milestone brief',
      });
      const phaseDir = join('.planning', 'phases', '03-user-auth');
      await mkdir(join(projectDir, phaseDir), { recursive: true });
      await writeFile(join(projectDir, phaseDir, '03-CONTEXT.md'), '# Phase context', 'utf-8');

      const files = await new ContextEngine(projectDir).resolveContextFiles(PhaseType.Build, phaseDir);

      expect(files.context).toBe('# Phase context');
      expect(files.requirements).toBe('# Requirements');
      expect(files.milestone).toBe('# Milestone brief');
    });

    it('prefers MILESTONE-CONTEXT.md over MILESTONE-BRIEF.md', async () => {
      await createPlanningDir(projectDir, {
        'STATE.md': '# State',
        'ROADMAP.md': '# Roadmap',
        'CONTEXT.md': '# Context',
        'MILESTONE-CONTEXT.md': '# Milestone context',
        'MILESTONE-BRIEF.md': '# Milestone brief',
      });

      const files = await new ContextEngine(projectDir).resolveContextFiles(PhaseType.Build);

      expect(files.milestone).toBe('# Milestone context');
    });
```

In `sdk/src/phase-runner.test.ts`:
1. **`makeConfig`:** keep existing tests on the classic path by replacing
   ```ts
       workflow: {
         ...CONFIG_DEFAULTS.workflow,
         ...(overrides.workflow ?? {}),
       },
   ```
   with
   ```ts
       workflow: {
         ...CONFIG_DEFAULTS.workflow,
         build_mode: false,
         ...(overrides.workflow ?? {}),
       },
   ```
2. **Step type tests:**
   - In `it('has all expected step values', ...)`, add `expect(PhaseStepType.Build).toBe('build');`.
   - Rename `it('has exactly 7 members', ...)` to `it('has exactly 8 members', ...)` and change `toHaveLength(7)` to `toHaveLength(8)`. This is an intentional change.
3. **Prompt arguments:** inside `describe('PromptFactory', ...)` → `describe('buildPrompt', ...)`, add:
   ```ts
       it('appends the arguments section for build prompts', async () => {
         await writeFile(join(workflowsDir, 'build.md'), makeWorkflowContent('Build the phase.', ['Initialize']));
         const factory = makeFactory();

         const prompt = await factory.buildPrompt(PhaseType.Build, null, { state: '# State' }, '.planning/phases/03-user-auth', '3 --gaps');

         expect(prompt).toContain('Build the phase.');
         expect(prompt).toContain('## Arguments\n\n$ARGUMENTS: 3 --gaps');
         expect(prompt.indexOf('## Arguments')).toBeLessThan(prompt.indexOf('## Context'));
       });
   ```
4. **Build mode:** inside `describe('PhaseRunner', ...)`, after `describe('verification routing', ...)`, add:
   ```ts
     describe('build mode (workflow.build_mode)', () => {
       function buildConfig(workflow: Record<string, unknown> = {}) {
         return makeConfig({ workflow: { build_mode: true, research: false, skip_discuss: true, plan_check: false, ...workflow } as any });
       }

       function mockBuildStates(deps: PhaseRunnerDeps, states: string[]): void {
         const queue = [...states];
         (deps.tools.exec as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
           if (cmd === 'init.build') {
             const state = queue.length > 1 ? queue.shift()! : queue[0];
             return Promise.resolve({ resume: { state } });
           }
           return Promise.resolve(undefined);
         });
       }

       it('runs research, build, verify and advance through build.md', async () => {
         const phaseOp = makePhaseOp({ has_context: true, has_research: false, has_plans: true, plan_count: 1 });
         const deps = makeDeps({ config: buildConfig({ research: true }) });
         (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
         mockBuildStates(deps, ['complete']);

         const result = await new PhaseRunner(deps).run('1');

         expect(result.steps.map(s => s.step)).toEqual([
           PhaseStepType.Research, PhaseStepType.Build, PhaseStepType.Verify, PhaseStepType.Advance,
         ]);
         expect(mockRunPhaseStepSession.mock.calls.map(call => call[1])).toEqual([PhaseStepType.Research, PhaseStepType.Build]);
         expect(mockRunPhaseStepSession.mock.calls[1][3]).toMatchObject({
           allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],
           maxTurns: 200,
         });
         const buildPrompt = deps.promptFactory.buildPrompt as ReturnType<typeof vi.fn>;
         expect(buildPrompt.mock.calls.map(call => [call[0], call[4]])).toEqual([
           [PhaseType.Build, '1 --research-only'],
           [PhaseType.Build, '1'],
         ]);
         expect(result.success).toBe(true);
       });

       it('reads the verification state from init.build without a verifier session', async () => {
         const phaseOp = makePhaseOp({ has_context: true, has_plans: true, plan_count: 1 });
         const deps = makeDeps({ config: buildConfig() });
         (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
         mockBuildStates(deps, ['complete']);

         const result = await new PhaseRunner(deps).run('1');

         expect(deps.tools.exec).toHaveBeenCalledWith('init.build', ['1']);
         expect(mockRunPhaseStepSession.mock.calls.map(call => call[1])).not.toContain(PhaseStepType.Verify);
         expect(result.steps.find(s => s.step === PhaseStepType.Verify)?.success).toBe(true);
       });

       it('reruns build with --gaps when verification found gaps', async () => {
         const phaseOp = makePhaseOp({ has_context: true, has_plans: true, plan_count: 1 });
         const deps = makeDeps({ config: buildConfig() });
         (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
         mockBuildStates(deps, ['gaps_found', 'complete']);

         const result = await new PhaseRunner(deps).run('1');

         const buildPrompt = deps.promptFactory.buildPrompt as ReturnType<typeof vi.fn>;
         expect(buildPrompt.mock.calls.map(call => call[4])).toEqual(['1', '1 --gaps']);
         expect(result.success).toBe(true);
       });

       it('fails verify with verification_gaps_found when gaps remain after the reruns', async () => {
         const phaseOp = makePhaseOp({ has_context: true, has_plans: true, plan_count: 1 });
         const deps = makeDeps({ config: buildConfig() });
         (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
         mockBuildStates(deps, ['gaps_found']);

         const result = await new PhaseRunner(deps).run('1');

         const verifyStep = result.steps.find(s => s.step === PhaseStepType.Verify);
         expect(verifyStep?.error).toBe('verification_gaps_found');
         expect(deps.tools.phaseComplete).not.toHaveBeenCalled();
       });

       it('treats a retry answer to human_needed as reject', async () => {
         const phaseOp = makePhaseOp({ has_context: true, has_plans: true, plan_count: 1 });
         const deps = makeDeps({ config: buildConfig() });
         (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
         mockBuildStates(deps, ['human_needed']);
         const onVerificationReview = vi.fn().mockResolvedValue('retry');

         const result = await new PhaseRunner(deps).run('1', { callbacks: { onVerificationReview } });

         expect(onVerificationReview).toHaveBeenCalledTimes(1);
         expect(result.steps.find(s => s.step === PhaseStepType.Verify)?.error).toBe('halted_by_callback');
         const buildPrompt = deps.promptFactory.buildPrompt as ReturnType<typeof vi.fn>;
         expect(buildPrompt.mock.calls.map(call => call[4])).toEqual(['1']);
         expect(deps.tools.phaseComplete).not.toHaveBeenCalled();
         expect(result.success).toBe(false);
       });

       it('skips phase.complete when the roadmap already marks the phase complete', async () => {
         const phaseOp = makePhaseOp({ has_context: true, has_plans: true, plan_count: 1 });
         const deps = makeDeps({ config: buildConfig() });
         (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);
         (deps.tools.roadmapAnalyze as ReturnType<typeof vi.fn>).mockResolvedValue({
           phases: [{ number: '01', disk_status: 'complete', roadmap_complete: true, phase_name: 'Authentication' }],
         });
         mockBuildStates(deps, ['complete']);

         const result = await new PhaseRunner(deps).run('1');

         expect(deps.tools.phaseComplete).not.toHaveBeenCalled();
         expect(result.steps.find(s => s.step === PhaseStepType.Advance)?.success).toBe(true);
       });

       it('keeps the classic path when build_mode is false', async () => {
         const phaseOp = makePhaseOp({ has_context: true, has_plans: true, plan_count: 1 });
         const deps = makeDeps({ config: makeConfig({ workflow: { research: false, skip_discuss: true, plan_check: false } as any }) });
         (deps.tools.initPhaseOp as ReturnType<typeof vi.fn>).mockResolvedValue(phaseOp);

         const result = await new PhaseRunner(deps).run('1');

         const stepTypes = result.steps.map(s => s.step);
         expect(stepTypes).toContain(PhaseStepType.Plan);
         expect(stepTypes).toContain(PhaseStepType.Execute);
         expect(stepTypes).not.toContain(PhaseStepType.Build);
         expect(deps.tools.exec).not.toHaveBeenCalledWith('init.build', expect.anything());
       });
     });
   ```

In `sdk/src/phase-runner.integration.test.ts`, in `createTempPlanningDir`, replace the lines below. `createMultiWavePlanningDir` has the same `workflow` object after `parallelization: true,`, so the `commit_docs` line keeps the match unique:
```ts
      commit_docs: false,
      workflow: {
        research: true,
        verifier: true,
        auto_advance: true,
        skip_discuss: false,
      },
```
with the same lines plus `build_mode: false,` after `skip_discuss: false,`. This shared fixture keeps tests 2–4 on the classic path: tests 2 and 3 read it through `loadConfig(tmpDir)`, and test 4 through `GSD.runPhase`. `sdk/src/milestone-runner.test.ts` needs no change, because it mocks `PhaseRunner` entirely.

`sdk/src/lifecycle-e2e.integration.test.ts` asserts the classic lifecycle through `GSD.runPhase` on the project InitRunner creates, and it has no config of its own. Pin that project to the classic path. Replace:

```ts
import { mkdtemp, rm, readFile, stat, readdir } from 'node:fs/promises';
```

with:

```ts
import { mkdtemp, rm, readFile, stat, readdir, writeFile } from 'node:fs/promises';
```

and replace:

```ts
    // Collect all events during the phase lifecycle
    const events: GSDEvent[] = [];
```

with:

```ts
    // This test asserts the classic lifecycle, and workflow.build_mode defaults to true.
    const configPath = join(tmpDir, '.planning', 'config.json');
    const projectConfig = existsSync(configPath) ? JSON.parse(await readFile(configPath, 'utf-8')) : {};
    projectConfig.workflow = { ...(projectConfig.workflow ?? {}), build_mode: false };
    await writeFile(configPath, `${JSON.stringify(projectConfig, null, 2)}\n`, 'utf-8');

    // Collect all events during the phase lifecycle
    const events: GSDEvent[] = [];
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd sdk && npx vitest run src/phase-runner.test.ts src/context-engine.test.ts src/tool-scoping.test.ts`
Expected: FAIL. `PhaseType.Build` and `PhaseStepType.Build` are undefined, and the build-mode tests still run the classic steps.

- [ ] **Step 3: Add the Build types, tools, manifest entry and prompt arguments**

1. **`sdk/src/types.ts`:**
   - In `enum PhaseType`, replace `  Repair = 'repair',\n}` with `  Repair = 'repair',\n  Build = 'build',\n}`.
   - In `enum PhaseStepType`, replace `  Verify = 'verify',\n  Advance = 'advance',` with `  Verify = 'verify',\n  Build = 'build',\n  Advance = 'advance',`.
   - In `interface ContextFiles`, replace `  plan?: string;\n  summary?: string;\n}` with:
     ```ts
       plan?: string;
       summary?: string;
       /** MILESTONE-CONTEXT.md, or MILESTONE-BRIEF.md when that is missing. */
       milestone?: string;
     }
     ```
2. **`sdk/src/tool-scoping.ts`:**
   - After `  [PhaseType.Repair]: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],`, add `  [PhaseType.Build]: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Agent'],`.
   - After `  [PhaseType.Repair]: null,`, add `  [PhaseType.Build]: null,`.
3. **`sdk/src/session-runner.ts`:** in `stepTypeToPhaseType`, replace `    verify: PhaseType.Verify,\n  };` with `    verify: PhaseType.Verify,\n    build: PhaseType.Build,\n  };`.
4. **`sdk/src/context-engine.ts`:**
   - In `interface FileSpec`, after `  filename: string;`, add:
     ```ts
       /** Other names tried at the .planning/ root when `filename` is missing. */
       fallbacks?: string[];
     ```
   - In `PHASE_FILE_MANIFEST`, after the `[PhaseType.Discuss]` entry, add:
     ```ts
       [PhaseType.Build]: [
         { key: 'state', filename: 'STATE.md', required: true },
         { key: 'roadmap', filename: 'ROADMAP.md', required: true },
         { key: 'context', filename: 'CONTEXT.md', required: true },
         { key: 'research', filename: 'RESEARCH.md', required: false },
         { key: 'requirements', filename: 'REQUIREMENTS.md', required: false },
         { key: 'milestone', filename: 'MILESTONE-CONTEXT.md', fallbacks: ['MILESTONE-BRIEF.md'], required: false },
       ],
     ```
   - In `locateFile` (Task 13), replace its last line `    return join(this.planningDir, spec.filename);` with:
     ```ts
         const primary = join(this.planningDir, spec.filename);
         if (!spec.fallbacks || (await this.readFileIfExists(primary)) !== undefined) return primary;
         for (const name of spec.fallbacks) {
           const candidate = join(this.planningDir, name);
           if ((await this.readFileIfExists(candidate)) !== undefined) return candidate;
         }
         return primary;
     ```
   - In the `truncatable` array, after `      { key: 'summary', filename: 'SUMMARY.md' },`, add `      { key: 'milestone', filename: 'MILESTONE-CONTEXT.md' },`.
5. **`sdk/src/phase-prompt.ts`:**
   - After `  [PhaseType.Repair]: 'execute-plan.md',`, add `  [PhaseType.Build]: 'build.md',`.
   - In `buildPrompt`, replace `    phaseDir?: string,\n  ): Promise<string> {` with `    phaseDir?: string,\n    args?: string,\n  ): Promise<string> {`.
   - Directly after the line `    // ── VARIABLE SUFFIX (project-specific, changes per run) ──`, add:
     ```ts

         // ── Arguments (build.md reads them as $ARGUMENTS) ──
         if (args && args.trim() !== '') {
           sections.push(`## Arguments\n\n$ARGUMENTS: ${args.trim()}`);
         }
     ```
   - In `formatContextFiles`, after `      summary: 'Summary (SUMMARY.md)',`, add `      milestone: 'Milestone brief (MILESTONE-CONTEXT.md)',`.
6. **`sdk/src/config.ts`:** run `grep -n "build_mode" sdk/src/config.ts`. Expected: a `build_mode?: boolean;` line in `WorkflowConfig`, added in Task 1. If there is no match, add `  build_mode?: boolean;` to `WorkflowConfig` after `context_coverage_gate: boolean;`.

- [ ] **Step 4: Add the build path to `PhaseRunner`**

In `sdk/src/phase-runner.ts`:

**Imports.** After `import { checkResearchGate } from './research-gate.js';`, add:

```ts
import { getToolsForPhase } from './tool-scoping.js';
import { normalizePhaseName } from './query/helpers.js';
```

**Headless override.** After the `PhaseRunnerDeps` interface, add:

```ts
/** Prepended to build.md prompts: the SDK runner has no human to answer questions. */
const HEADLESS_BUILD_OVERRIDE = [
  '## HEADLESS MODE — MANDATORY OVERRIDE',
  '',
  'This session runs headless under the fvgsd SDK phase runner. No human is present.',
  '',
  '- Do not use AskUserQuestion and do not wait for input.',
  '- Treat `--confirm` as absent, even where a workflow step asks for approval.',
  '- Record every question you would ask, and every `user_setup` item, with `fvgsd-sdk query state.add-blocker --text "<question>"`, then end with `## BUILD BLOCKED`.',
  '',
  '---',
  '',
].join('\n');
```

**Branch in `run()`.** Insert directly before the line `    // ── Step 2: Research ──`:

```ts
    // ── Build mode: research → build → verify (status read) → advance ──
    if (this.config.workflow.build_mode === true) {
      if (!halted) {
        halted = await this.runBuildLifecycle(phaseNumber, phaseOp, sessionOpts, callbacks, options, steps);
      }
      return this.finishRun(phaseNumber, phaseName, steps, halted, startTime);
    }

```

**Shared tail.** In `run()`, replace everything from `    const totalDurationMs = Date.now() - startTime;` through the end of the `return { ... };` that closes `run()` with:

```ts
    return this.finishRun(phaseNumber, phaseName, steps, halted, startTime);
```

Then add this method directly after `run()`. Its body is the code just removed from `run()`, unchanged:

```ts
  /** Totals, the phase_complete event and the result object shared by both lifecycles. */
  private finishRun(
    phaseNumber: string,
    phaseName: string,
    steps: PhaseStepResult[],
    halted: boolean,
    startTime: number,
  ): PhaseRunnerResult {
    const totalDurationMs = Date.now() - startTime;
    const totalCostUsd = steps.reduce((sum, s) => {
      const stepCost = s.planResults?.reduce((c, pr) => c + pr.totalCostUsd, 0) ?? 0;
      return sum + stepCost;
    }, 0);
    const success = !halted && steps.every(s => s.success);

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseComplete,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      phaseName,
      success,
      totalCostUsd,
      totalDurationMs,
      stepsCompleted: steps.length,
    });

    return {
      phaseNumber,
      phaseName,
      steps,
      success,
      totalCostUsd,
      totalDurationMs,
    };
  }
```

**Advance.** In `runAdvanceStep`:
- Change the parameter list to `(phaseNumber: string, _sessionOpts: SessionOptions, callbacks: HumanGateCallbacks, skipIfComplete = false)`.
- Replace
  ```ts
      try {
        await this.tools.phaseComplete(phaseNumber);
  ```
  with
  ```ts
      const alreadyComplete = skipIfComplete && await this.isPhaseMarkedComplete(phaseNumber);
      try {
        if (!alreadyComplete) {
          await this.tools.phaseComplete(phaseNumber);
        }
  ```

**Step mapping.** In `stepToPhaseType`, after `      [PhaseStepType.Verify]: PhaseType.Verify,`, add `      [PhaseStepType.Build]: PhaseType.Build,`.

**Build methods.** Directly above the line `  // ─── Helpers ───────────────────────────────────────────────────────────`, add:

```ts
  // ─── Build lifecycle (workflow.build_mode) ────────────────────────────

  /** Research (only when RESEARCH.md is missing), gate, Build, Verify, Advance. Returns true when halted. */
  private async runBuildLifecycle(
    phaseNumber: string,
    initialPhaseOp: PhaseOpInfo,
    sessionOpts: SessionOptions,
    callbacks: HumanGateCallbacks,
    options: PhaseRunnerOptions | undefined,
    steps: PhaseStepResult[],
  ): Promise<boolean> {
    let phaseOp = initialPhaseOp;

    if (this.config.workflow.research && !phaseOp.has_research) {
      const researchResult = await this.retryOnce('research', () =>
        this.runBuildSession(PhaseStepType.Research, phaseNumber, sessionOpts, `${phaseNumber} --research-only`, phaseOp.phase_dir));
      steps.push(researchResult);
      phaseOp = await this.requeryPhaseOp(phaseNumber, phaseOp);
    }

    if (phaseOp.has_research) {
      const gateResult = await this.checkResearchGate(phaseOp);
      if (!gateResult.pass) {
        const error = `RESEARCH.md has unresolved open questions: ${gateResult.unresolvedQuestions.join(', ')}`;
        this.logger?.warn(error, { phase: phaseNumber });
        const decision = await this.invokeBlockerCallback(callbacks, phaseNumber, PhaseStepType.Research, error);
        if (decision === 'stop') return true;
      }
    }

    const buildResult = await this.retryOnce('build', () =>
      this.runBuildSession(PhaseStepType.Build, phaseNumber, sessionOpts, phaseNumber, phaseOp.phase_dir));
    steps.push(buildResult);
    phaseOp = await this.requeryPhaseOp(phaseNumber, phaseOp);
    if (!phaseOp.has_plans || phaseOp.plan_count === 0) {
      const decision = await this.invokeBlockerCallback(callbacks, phaseNumber, PhaseStepType.Build, 'No brief created after build step');
      if (decision === 'stop') return true;
    }

    const verifyResult = await this.runBuildVerifyStep(phaseNumber, sessionOpts, callbacks, options, phaseOp.phase_dir);
    steps.push(verifyResult);
    if (!verifyResult.success && verifyResult.error === 'halted_by_callback') return true;

    if (verifyResult.success) {
      steps.push(await this.runAdvanceStep(phaseNumber, sessionOpts, callbacks, true));
    } else {
      this.logger?.warn(`Skipping advance for phase ${phaseNumber}: build verification did not pass`);
    }
    return false;
  }

  /** One headless session that follows build.md with the given arguments. */
  private async runBuildSession(
    step: PhaseStepType,
    phaseNumber: string,
    sessionOpts: SessionOptions,
    args: string,
    phaseDir: string,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step,
    });

    let planResult: PlanResult;
    try {
      const contextFiles = await this.contextEngine.resolveContextFiles(PhaseType.Build, phaseDir);
      const prompt = HEADLESS_BUILD_OVERRIDE
        + await this.promptFactory.buildPrompt(PhaseType.Build, null, contextFiles, phaseDir, args);
      planResult = await runPhaseStepSession(
        prompt,
        step,
        this.config,
        {
          ...sessionOpts,
          allowedTools: getToolsForPhase(PhaseType.Build),
          maxTurns: (sessionOpts.maxTurns ?? 50) * 4,
          maxBudgetUsd: (sessionOpts.maxBudgetUsd ?? 5) * 4,
        },
        this.eventStream,
        { phase: PhaseType.Build },
      );
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step,
        success: false,
        durationMs,
        error: errorMsg,
      });
      return { step, success: false, durationMs, error: errorMsg };
    }

    const durationMs = Date.now() - stepStart;
    const error = planResult.error?.messages.join('; ') || undefined;
    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: planResult.sessionId,
      phaseNumber,
      step,
      success: planResult.success,
      durationMs,
      error,
    });
    return { step, success: planResult.success, durationMs, error, planResults: [planResult] };
  }

  /**
   * Verify for build mode: no verifier session. Reads init.build resume.state
   * (complete / human_needed / gaps_found / other) and reruns Build — with
   * --gaps for gaps_found, as a resume otherwise — up to maxGapRetries times.
   * For human_needed, a `retry` answer from the verification callback halts like `reject`.
   */
  private async runBuildVerifyStep(
    phaseNumber: string,
    sessionOpts: SessionOptions,
    callbacks: HumanGateCallbacks,
    options: PhaseRunnerOptions | undefined,
    phaseDir: string,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();
    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Verify,
    });

    const maxGapRetries = options?.maxGapRetries ?? 1;
    let reruns = 0;
    let outcome: VerificationOutcome = 'status_unreadable';
    const allPlanResults: PlanResult[] = [];

    while (true) {
      let state: string;
      try {
        state = await this.readBuildState(phaseNumber);
      } catch (err) {
        this.logger?.warn(`Could not read build state for phase ${phaseNumber}: ${err instanceof Error ? err.message : String(err)}`);
        outcome = 'status_unreadable';
        break;
      }

      if (state === 'complete') {
        const debtCheck = await this.checkArchitecturalDebt(phaseNumber);
        if (debtCheck.pass) {
          outcome = 'passed';
        } else {
          this.logger?.warn(`Verification blocked by architectural debt in phase ${phaseNumber}`, {
            phase: phaseNumber,
            reason: debtCheck.reason,
            findingCount: debtCheck.findings.length,
          });
          outcome = 'architectural_debt';
        }
        break;
      }

      if (state === 'human_needed') {
        outcome = 'human_needed';
        const decision = await this.invokeVerificationCallback(callbacks, phaseNumber, {
          step: PhaseStepType.Verify,
          success: false,
          durationMs: Date.now() - stepStart,
          planResults: allPlanResults,
        });
        // Only `accept` continues. `retry` is treated as `reject`: a build has nothing to rerun for
        // human-only checks (verify-work answers them), and re-reading the same state cannot change it.
        if (decision === 'accept') break;
        const durationMs = Date.now() - stepStart;
        this.eventStream.emitEvent({
          type: GSDEventType.PhaseStepComplete,
          timestamp: new Date().toISOString(),
          sessionId: '',
          phaseNumber,
          step: PhaseStepType.Verify,
          success: false,
          durationMs,
          error: 'halted_by_callback',
        });
        return { step: PhaseStepType.Verify, success: false, durationMs, error: 'halted_by_callback', planResults: allPlanResults };
      }

      outcome = 'gaps_found';
      if (reruns >= maxGapRetries) break;
      reruns++;
      const args = state === 'gaps_found' ? `${phaseNumber} --gaps` : phaseNumber;
      this.logger?.info(`Build rerun ${reruns}/${maxGapRetries} for phase ${phaseNumber} (state: ${state})`);
      const rerun = await this.runBuildSession(PhaseStepType.Build, phaseNumber, sessionOpts, args, phaseDir);
      if (rerun.planResults) allPlanResults.push(...rerun.planResults);
    }

    const durationMs = Date.now() - stepStart;
    const verifySuccess = outcome === 'passed';
    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Verify,
      success: verifySuccess,
      durationMs,
      ...(!verifySuccess && { error: this.verificationErrorForOutcome(outcome) }),
    });
    return {
      step: PhaseStepType.Verify,
      success: verifySuccess,
      durationMs,
      planResults: allPlanResults,
      ...(!verifySuccess && { error: this.verificationErrorForOutcome(outcome) }),
    };
  }

  /** `init.build` resume.state; throws when the query returns no state (error, phase not found). */
  private async readBuildState(phaseNumber: string): Promise<string> {
    const raw = await this.tools.exec('init.build', [phaseNumber]);
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null | undefined;
    const resume = data?.resume as Record<string, unknown> | undefined;
    if (typeof resume?.state !== 'string' || resume.state === '') {
      throw new Error(`init.build returned no resume.state for phase ${phaseNumber}`);
    }
    return resume.state;
  }

  private async requeryPhaseOp(phaseNumber: string, fallback: PhaseOpInfo): Promise<PhaseOpInfo> {
    try {
      return await this.tools.initPhaseOp(phaseNumber);
    } catch {
      return fallback;
    }
  }

  /** True when roadmap.analyze reports the phase complete (build.finalize already ran phase.complete). */
  private async isPhaseMarkedComplete(phaseNumber: string): Promise<boolean> {
    try {
      const analysis = await this.tools.roadmapAnalyze();
      const target = normalizePhaseName(phaseNumber);
      return Boolean(analysis?.phases?.some(
        (phase) => normalizePhaseName(String(phase.number)) === target && phase.roadmap_complete === true,
      ));
    } catch {
      return false;
    }
  }

```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd sdk && npx vitest run src/phase-runner.test.ts src/context-engine.test.ts src/tool-scoping.test.ts src/assembled-prompts.test.ts src/milestone-runner.test.ts && npx tsc --noEmit`
Expected: all PASS; `tsc` exits 0.

`assembled-prompts.test.ts` builds a prompt for every `PhaseType`, including `build` from the real `get-shit-done/workflows/build.md`. If it reports a blocked pattern for the `build` phase, reword the matching line in `build.md` so it keeps its meaning. Don't exempt the phase.

- [ ] **Step 6: Run the SDK suite against the baseline**

```bash
(cd sdk && npm test > "../$WS/task-14-sdk.log" 2>&1)
node "$WS/compare-failures.cjs" "$WS/baseline-sdk.log" "$WS/task-14-sdk.log"
```

Expected: `"newFailures": []`.

- [ ] **Step 7: Commit**

```bash
git add sdk/src/types.ts sdk/src/tool-scoping.ts sdk/src/context-engine.ts sdk/src/phase-prompt.ts sdk/src/session-runner.ts sdk/src/phase-runner.ts sdk/src/config.ts sdk/src/phase-runner.test.ts sdk/src/context-engine.test.ts sdk/src/tool-scoping.test.ts sdk/src/phase-runner.integration.test.ts sdk/src/lifecycle-e2e.integration.test.ts
git commit -m "feat(sdk): run /fvgsd-build from the phase runner when workflow.build_mode is on"
```

---

### Task 15: VibeClaw `feature-build`

**Files:**
- Create: `get-shit-done/vibe/templates/workflows/feature-build.yaml`
- Modify: `get-shit-done/bin/lib/vibe/schemas.cjs` (`normalizeWorkflow`)
- Modify: `get-shit-done/bin/lib/vibe/orchestrator.cjs` (template copy list, `buildContext`)
- Modify: `get-shit-done/bin/lib/vibe/entry-router.cjs` (`LIFECYCLE_ENTRIES`)
- Modify: `get-shit-done/vibe/templates/routes/cheap.yaml`, `get-shit-done/vibe/templates/routes/quality.yaml`
- Modify: `docs/VIBECLAW.md`, `docs/MULTI-TOOL-WALKTHROUGH.md`
- Test: `tests/vibe-core.test.cjs`, `tests/vibe-entry-router.test.cjs`

**Interfaces:**
- Consumes: the `fvgsd:build` command and its flags `--research-only` and `--brief-only` (Task 10).
- Produces:
  - A stage contract's `gsd` is `{ command }`, or `{ command, args }` when `args` is non-empty. Each arg matches `^--[a-z][a-z0-9-]*$`; anything else raises `SCHEMA_INVALID`.
  - A candidate context's `gsd` is `{ command, args, invocation }`, where `invocation` is `formatGsdSlash([command, ...args].join(' '), tool)`.
  - `resolveCommandEntry('build')` maps to the `build` stage of `feature-build`.

- [ ] **Step 1: Write the failing tests**

In `tests/vibe-core.test.cjs`, replace

```js
    assert.deepEqual(
      vibe.listWorkflows().map((workflow) => workflow.name),
      ['feature-development', 'milestone-bootstrap', 'project-bootstrap'],
    );
```

with

```js
    assert.deepEqual(
      vibe.listWorkflows().map((workflow) => workflow.name),
      ['feature-build', 'feature-development', 'milestone-bootstrap', 'project-bootstrap'],
    );
```

Add these tests directly after the test `renders the assigned GSD command in each tool-native fvgsd form`:

```js
  test('feature-build passes gsd args through to every tool-native invocation', () => {
    const workflow = vibe.loadWorkflow('feature-build');
    assert.deepEqual(Object.keys(workflow.stages), ['research', 'discuss', 'brief', 'build', 'verify', 'review']);
    assert.equal(workflow.stages.build.mutates_source, true);
    assert.deepEqual(workflow.stages.research.gsd, { command: 'fvgsd:build', args: ['--research-only'] });
    assert.deepEqual(workflow.stages.brief.gsd, { command: 'fvgsd:build', args: ['--brief-only'] });
    assert.deepEqual(workflow.stages.build.gsd, { command: 'fvgsd:build' });

    vibe.startRun('feature-build', { id: 'build-context' });
    const invocations = ['claude', 'codex', 'gemini'].map((tool) => {
      const context = vibe.context(vibe.prepareStage('research', { tool }).candidate.id);
      return [tool, context.gsd.args, context.gsd.invocation];
    });
    assert.deepEqual(invocations, [
      ['claude', ['--research-only'], '/fvgsd-build --research-only'],
      ['codex', ['--research-only'], '$fvgsd-build --research-only'],
      ['gemini', ['--research-only'], '/fvgsd:build --research-only'],
    ]);
  });

  test('rejects gsd args that are not --flag values', () => {
    const workflowsDir = path.join(project, '.planning-fvgsd-vibe', 'workflows');
    const writeWorkflow = (name, argsLines) => fs.writeFileSync(path.join(workflowsDir, `${name}.yaml`), [
      'version: 1',
      `name: ${name}`,
      'stages:',
      '  build:',
      '    mutates_source: true',
      '    gsd:',
      '      command: fvgsd:build',
      ...argsLines,
      '',
    ].join('\n'), 'utf8');
    writeWorkflow('bad-arg-item', ['      args:', '        - rm -rf']);
    writeWorkflow('bad-arg-scalar', ['      args: --research-only']);
    assert.throws(() => vibe.loadWorkflow('bad-arg-item'), expectCode('SCHEMA_INVALID'));
    assert.throws(() => vibe.loadWorkflow('bad-arg-scalar'), expectCode('SCHEMA_INVALID'));
  });

  test('bundled routes assign default tools to the brief and build stages', () => {
    assert.deepEqual(
      ['cheap', 'quality'].map((name) => {
        const route = vibe.loadRoute(name);
        return [name, route.stages.brief.tool, route.stages.build.tool];
      }),
      [['cheap', 'codex', 'opencode'], ['quality', 'codex', 'claude-router']],
    );
  });
```

In `tests/vibe-entry-router.test.cjs`, in the test `normalizes runtime-native command forms and maps lifecycle workflows`, add after `assert.equal(resolveCommandEntry('review').stage, 'review');`:

```js
    assert.deepEqual(resolveCommandEntry('build'), {
      command: 'build',
      orchestratable: true,
      kind: 'lifecycle',
      workflow: 'feature-build',
      stage: 'build',
      generated_workflow: false,
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/vibe-core.test.cjs tests/vibe-entry-router.test.cjs`

Expected failures:
- the workflow list lacks `feature-build`
- `loadWorkflow('feature-build')` throws `STATE_NOT_FOUND`
- `loadRoute('cheap').stages.brief` is `undefined`
- `resolveCommandEntry('build')` returns a generated `build-workflow` entry

- [ ] **Step 3: Create the template**

Create `get-shit-done/vibe/templates/workflows/feature-build.yaml`:

```yaml
version: 1
name: feature-build
description: Research, optional discussion and brief, then build, verify, and review a phase with /fvgsd-build.
stages:
  research:
    description: Research the feature and persist evidence for the build.
    mutates_source: false
    requires_git_candidate: true
    input:
      required: false
      promoted_stages: []
    output:
      - research_artifact
      - summary
    completion:
      - research artifact persisted
      - candidate summary written
      - candidate work committed when tracked
    gsd:
      command: fvgsd:build
      args:
        - --research-only
  discuss:
    description: Capture operator decisions using the existing GSD discussion workflow.
    optional: true
    mutates_source: false
    requires_git_candidate: true
    input:
      required: true
      promoted_stages:
        - research
    output:
      - context_artifact
      - summary
    completion:
      - decisions persisted
      - candidate summary written
    gsd:
      command: fvgsd:discuss-phase
  brief:
    description: Write the build brief from the latest promoted research or discussion without changing source.
    optional: true
    mutates_source: false
    requires_git_candidate: true
    input:
      required: true
      promoted_stages:
        - research
        - discuss
    output:
      - plan_artifact
      - summary
    completion:
      - build brief committed
      - build brief passes build.check-brief
      - candidate summary written
    gsd:
      command: fvgsd:build
      args:
        - --brief-only
  build:
    description: Build the phase from the promoted brief, discussion, or research in an isolated candidate branch and worktree.
    mutates_source: true
    requires_git_candidate: true
    input:
      required: true
      promoted_stages:
        - brief
        - discuss
        - research
    output:
      - source_commit
      - verification_artifact
      - summary
    completion:
      - implementation complete
      - build checks run
      - build summary and verification committed
      - all candidate changes committed
      - candidate summary written
    gsd:
      command: fvgsd:build
  verify:
    description: Verify the promoted implementation without selecting a winner automatically.
    mutates_source: false
    requires_git_candidate: true
    input:
      required: true
      promoted_stages:
        - build
    output:
      - verification_artifact
      - summary
    completion:
      - verification executed
      - evidence persisted
      - candidate summary written
    gsd:
      command: fvgsd:verify-work
  review:
    description: Review the promoted verification result and implementation.
    mutates_source: false
    requires_git_candidate: true
    input:
      required: true
      promoted_stages:
        - verify
    output:
      - review_artifact
      - summary
    completion:
      - review findings persisted
      - candidate summary written
    gsd:
      command: fvgsd:review
```

- [ ] **Step 4: Validate `gsd.args`**

In `get-shit-done/bin/lib/vibe/schemas.cjs`, add directly before `function normalizeWorkflow(value) {`:

```js
const GSD_ARG_PATTERN = /^--[a-z][a-z0-9-]*$/;

function normalizeGsd(raw, stage) {
  if (!raw || typeof raw !== 'object') return { command: '' };
  const args = raw.args ?? [];
  invariant(
    Array.isArray(args) && args.every((arg) => typeof arg === 'string' && GSD_ARG_PATTERN.test(arg)),
    'SCHEMA_INVALID',
    `workflow.stages.${stage}.gsd.args must be a list of --flag values`,
  );
  return { command: String(raw.command || ''), ...(args.length ? { args: [...args] } : {}) };
}
```

In `normalizeWorkflow`, replace

```js
      gsd: raw.gsd && typeof raw.gsd === 'object' ? { command: String(raw.gsd.command || '') } : { command: '' },
```

with

```js
      gsd: normalizeGsd(raw.gsd, stage),
```

- [ ] **Step 5: Copy the template and render args**

In `get-shit-done/bin/lib/vibe/orchestrator.cjs`, replace

```js
        ['workflows', 'feature-development.yaml'],
```

with

```js
        ['workflows', 'feature-development.yaml'],
        ['workflows', 'feature-build.yaml'],
```

In `buildContext`, replace

```js
    const gsdCommand = candidate.contract.gsd.command || null;
```

with

```js
    const gsdCommand = candidate.contract.gsd.command || null;
    const gsdArgs = candidate.contract.gsd.args || [];
```

and replace

```js
      gsd: {
        command: gsdCommand,
        invocation: gsdCommand ? formatGsdSlash(gsdCommand, candidate.tool.id) : null,
      },
```

with

```js
      gsd: {
        command: gsdCommand,
        args: gsdArgs,
        invocation: gsdCommand ? formatGsdSlash([gsdCommand, ...gsdArgs].join(' '), candidate.tool.id) : null,
      },
```

`renderContextMarkdown` already prints `context.gsd.invocation`, so the Markdown context shows the flags without further changes.

- [ ] **Step 6: Route the `build` lifecycle entry and add route defaults**

In `get-shit-done/bin/lib/vibe/entry-router.cjs`, replace

```js
  review: Object.freeze({ workflow: 'feature-development', stage: 'review' }),
});
```

with

```js
  review: Object.freeze({ workflow: 'feature-development', stage: 'review' }),
  build: Object.freeze({ workflow: 'feature-build', stage: 'build' }),
});
```

In `get-shit-done/vibe/templates/routes/cheap.yaml`, replace

```yaml
  plan:
    tool: codex
  execute:
    tool: opencode
```

with

```yaml
  plan:
    tool: codex
  brief:
    tool: codex
  execute:
    tool: opencode
  build:
    tool: opencode
```

In `get-shit-done/vibe/templates/routes/quality.yaml`, replace

```yaml
  plan:
    tool: codex
  execute:
    tool: claude-router
```

with

```yaml
  plan:
    tool: codex
  brief:
    tool: codex
  execute:
    tool: claude-router
  build:
    tool: claude-router
```

- [ ] **Step 7: Update the docs**

In `docs/VIBECLAW.md`, replace

```markdown
| `feature-development` | `research`, optional `discuss`, `plan`, `execute`, `verify`, `review` | Repeatable phase delivery lifecycle |

The `feature-development` workflow declares contracts for:
```

with

```markdown
| `feature-development` | `research`, optional `discuss`, `plan`, `execute`, `verify`, `review` | Repeatable phase delivery lifecycle |
| `feature-build` | `research`, optional `discuss`, optional `brief`, `build`, `verify`, `review` | Phase delivery with `/fvgsd-build`, which plans and executes in one stage |

`feature-build` runs `/fvgsd-build` in three stages: `research` passes `--research-only`, `brief` passes `--brief-only`, and `build` runs the command without flags. A stage passes flags through `gsd.args`, a list of `--flag` values appended to the rendered invocation.

The `feature-development` workflow declares contracts for:
```

In `docs/MULTI-TOOL-WALKTHROUGH.md`, replace

```markdown
Initialization installs three bundled workflows:
```

with

```markdown
Initialization installs four bundled workflows:
```

and replace

```markdown
| `feature-development` | Research → optional discuss → plan → execute → verify → review |
```

with

```markdown
| `feature-development` | Research → optional discuss → plan → execute → verify → review |
| `feature-build` | Research → optional discuss → optional brief → build → verify → review, with `/fvgsd-build` |
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test tests/vibe-*.test.cjs tests/docs-parity-live-registry.test.cjs`
Expected: all pass. If an existing VibeClaw test deepEquals a candidate context's whole `gsd` object, add `args: []` to that expected object. That is intentional: contexts now always carry `args`. Name the file in your report, and add it to the `git add` paths in Step 10.

- [ ] **Step 9: Compare the root suite with the baseline**

```bash
npm test > "$WS/task-15-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-15-root.log"
```

Expected: `"newFailures": []`.

- [ ] **Step 10: Commit**

```bash
git add get-shit-done/vibe/templates/workflows/feature-build.yaml get-shit-done/bin/lib/vibe/schemas.cjs get-shit-done/bin/lib/vibe/orchestrator.cjs get-shit-done/bin/lib/vibe/entry-router.cjs get-shit-done/vibe/templates/routes/cheap.yaml get-shit-done/vibe/templates/routes/quality.yaml docs/VIBECLAW.md docs/MULTI-TOOL-WALKTHROUGH.md tests/vibe-core.test.cjs tests/vibe-entry-router.test.cjs
git commit -m "feat(vibe): add the feature-build workflow with gsd.args

VibeClaw gains a feature-build workflow whose research, brief and build
stages run /fvgsd-build with --research-only, --brief-only or no flags.
Stage contracts validate gsd.args, candidate contexts render the flags in
each tool's invocation, the build lifecycle entry maps to feature-build,
and both routes assign tools to the brief and build stages."
```

---

### Task 16: Changeset and full verification

**Files:**
- Create: one `.changeset/*.md` fragment
- Modify: `docs/INVENTORY.md` and `docs/INVENTORY-MANIFEST.json`, only if the checks below report drift

- [ ] **Step 1: Add the changeset fragment**

```bash
npm run changeset -- --type Added --body "Add /fvgsd-build: one command plans and executes a discussed phase with a short brief, vertical slices built in parallel where the runtime allows, command-based checks, one verifier pass, capped fix rounds and a build summary. plan-phase and execute-phase stay available, and workflow.build_mode: false restores their routing."
```

The fragment's `pr` is filled in when a pull request is opened (`npm run lint:changeset` requires a positive integer).

- [ ] **Step 2: Run every check**

```bash
node scripts/gen-inventory-manifest.cjs --check
node scripts/lint-command-contract.cjs
npm run lint:tests
npm run lint:test-file-count
npm run lint:descriptions
npm run lint:skill-deps
npm run check:execution-branch-guards
npm run check:identity-fresh
npm run check:alias-drift
npm run check:configuration-fresh
(cd sdk && npx tsc --noEmit)
```

Expected: every command exits 0. If the inventory check reports drift, run `node scripts/gen-inventory-manifest.cjs --write`, then run the check again.

- [ ] **Step 3: Run both suites against the baselines**

```bash
npm test > "$WS/task-16-root.log" 2>&1
node "$WS/compare-failures.cjs" "$WS/baseline-root.log" "$WS/task-16-root.log"
(cd sdk && npm test > "../$WS/task-16-sdk.log" 2>&1)
node "$WS/compare-failures.cjs" "$WS/baseline-sdk.log" "$WS/task-16-sdk.log"
```

Expected: both print `"newFailures": []`. Explain every `missingTitles` entry.

- [ ] **Step 4: Check the spec's success criteria against the code**

Confirm each item with a file reference in your report:
- **Planning files:** a build adds only the brief, summary, VERIFICATION.md, RESEARCH.md (when missing) and HUMAN-UAT.md (when human-only checks exist). See `get-shit-done/workflows/build.md`.
- **Document checks:** no agent reviews planning documents. The only document checks are `build.check-brief` and the ID coverage in `build.finalize`.
- **Test runs:** at most one baseline full run plus one end-of-build full run. Fix rounds rerun only the failed commands plus build and typecheck.
- **Agent count:** a single-slice phase with no fixes starts at most the builder and the verifier (plus the researcher when RESEARCH.md is missing), because `continue_to_slice` is set.

- [ ] **Step 5: Commit**

```bash
git add .changeset docs/INVENTORY.md docs/INVENTORY-MANIFEST.json
git commit -m "chore: add /fvgsd-build changeset"
```

---

### Task 17: Manual acceptance (ask the maintainer first)

**Files:** none (verification only).

**This task installs fvgsd somewhere real. Get the maintainer's explicit go-ahead, and their choice of install target and project, before Step 2.** The maintainer's UTM test VM is the default install target, instead of this machine's runtime folders.

- [ ] **Step 1: Ask the maintainer**

Ask the maintainer for:
- where to install (the test VM or this machine)
- which project to use: it needs a phase whose CONTEXT.md exists and no plans, plus an earlier phase that was built with `/fvgsd-plan-phase` and `/fvgsd-execute-phase`

- [ ] **Step 2: Install from the branch (after approval)**

Use the documented clone sequence in that environment:

```bash
npm install && npm run build:hooks && node bin/install.js --claude --global
```

- [ ] **Step 3: Run the build**

In a Claude Code session in the chosen project, run `/fvgsd-build <phase>`, and let it run to its end marker.

- [ ] **Step 4: Collect the comparison**

For the new phase and the earlier plan/execute phase, record:
- **Planning files:** new files under the phase folder (`git log --name-status --diff-filter=A -- .planning/phases/<dir>`)
- **Wall-clock time:**
  - new phase: the summary's `build.started` and `build.completed`
  - earlier phase: the first PLAN commit time and the last SUMMARY commit time
- **Fix rounds:** `build.fix_rounds` in the summary
- **Verification:** `status` from each VERIFICATION.md

- [ ] **Step 5: Report**

Report the table from Step 4, the end marker the build printed, and any step where the workflow needed manual help. Don't fix anything in the maintainer's project during this task.
