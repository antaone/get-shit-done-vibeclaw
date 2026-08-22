---
name: vgsd:vibe
description: Route any GSD workflow through one or more isolated Vibe candidates
argument-hint: "[command] [--tool TOOL ...] [--run RUN] [--launch] [--multi-machine --remote REMOTE]"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
requires: [help, surface]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" execution-branch inspect "vibe" --runtime __VGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `vgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Provide the AI-native control surface for VibeClaw. Inspect the current Git,
GSD, and Vibe state; choose the correct starting point; and route a public
`vgsd` workflow through one or more isolated candidates without requiring the
user to reconstruct terminal commands.

This gateway supports the complete command surface. Project, milestone, and
phase lifecycle commands reuse their bundled multi-stage workflows. Commands
such as `quick`, `fast`, `debug`, `autonomous`, `code-review`, `audit-fix`, UI
work, documentation, spikes, and future public commands receive a durable
single-command workflow automatically.
</objective>

<execution_context>
Installed Vibe CLI: `node "$HOME/.claude/get-shit-done/bin/vibe.cjs"`
Runtime identity: `__VGSD_RUNTIME__`
User request: `$ARGUMENTS`
</execution_context>

<process>
1. Determine the target public command from `$ARGUMENTS`. Accept bare,
   hyphenated, colon-style, and equivalent runtime-native forms. If no
   command was supplied, inspect `.planning/`, `.planning-vibe/`, and the
   current project state, then ask whether the user is starting a project,
   milestone, phase workflow, quick task, fast task, debug session, or another
   installed command. Confirm the target command is present in this runtime's
   installed surface before preparing it. If a reduced profile omitted the
   target, offer to enable the full surface with `vgsd-surface profile full`
   or rerun the installer; do not create a candidate with a dead invocation.

2. Inspect before changing state:

   ```bash
   node "$HOME/.claude/get-shit-done/bin/vibe.cjs" entry inspect "<command>" --runtime __VGSD_RUNTIME__ --json
   ```

3. Follow the returned action:
   - `initialize-git`: inspect the directory first, explain what will be
     included, initialize Git, and obtain approval before creating a baseline
     commit. Never stage secrets or unrelated generated files. If the user
     requested multi-machine handoff, also confirm an existing Git remote after
     the baseline; ask for its name/URL when absent and do not create an external
     repository or publish to a guessed destination.
   - `create-baseline`: inspect pending files and obtain approval for the
     baseline commit.
   - `choose-mode`: ask for direct GSD, one Vibe candidate, or multiple Vibe
     candidates. Direct mode invokes the requested `vgsd` command normally. If
     `vibe_requires_baseline` is true and a Vibe mode is selected, review the
     pending files and obtain approval before creating the baseline commit.
   - `migrate-planning-commands`: show the affected `.planning/` files and the
     exact legacy-to-`vgsd` replacements returned by inspection. Obtain approval
     before changing these committed project artifacts, then run:

     ```bash
     node "$HOME/.claude/get-shit-done/bin/vibe.cjs" entry migrate "<command>" --runtime __VGSD_RUNTIME__ --json
     ```

     Review the resulting diff, obtain approval for the migration commit, commit
     only the reviewed `.planning/` changes, and inspect again before preparing
     candidates. Never rewrite `gsd-tools`, `gsd-sdk`, URLs, unknown file types,
     or non-command prose.
   - `continue-candidate`: invoke the assigned command in the current candidate.
   - `return-integration`: do not prepare from the current candidate. Show the
     returned `project_root` and continue orchestration from that integration
     worktree.
   - `resolve-active-run`: show the active run and ask whether to resume/finish
     it or explicitly start a named new run. Never replace it silently.
   - `prepare`: ask for one or multiple candidates unless the user already
     specified tools or a count.
   - `continue-direct`: run the control command directly.

4. Before preparing candidates, list available adapters when tool selection is
   not already clear:

   ```bash
   node "$HOME/.claude/get-shit-done/bin/vibe.cjs" tool list --json
   node "$HOME/.claude/get-shit-done/bin/vibe.cjs" tool detect --json
   ```

   In local mode, detection confirms the executable available to the
   coordinator. In multi-machine mode, an explicit `--tool` may name an adapter
   installed only on its worker; do not reject it merely because coordinator
   detection chooses a different local runtime. Confirm that the worker has the
   matching installed `vgsd` surface.

   If the user requested workers in independent clones or supplied
   `--multi-machine`, enable the Git handoff guard before starting the run:

   ```bash
   node "$HOME/.claude/get-shit-done/bin/vibe.cjs" mode multi-machine --remote origin --json
   ```

   Confirm the remote name instead of assuming `origin` when more than one
   remote exists. Multi-machine mode requires remote access and atomically
   publishes each candidate branch plus its identity tag. Use `mode local` to
   return to path-bound worktrees, but never change mode during an active run.

5. Prepare every selected tool in one operation. Repeat `--tool` for N runs:

   ```bash
   node "$HOME/.claude/get-shit-done/bin/vibe.cjs" entry prepare "<command>" --runtime __VGSD_RUNTIME__ --tool codex --tool claude --json
   ```

   Preserve explicit `--run`, `--id`, `--route`, and `--base` choices. Do not
   invent a historical base or silently replace an active run.

6. Present each candidate's tool, branch, worktree, context path, and native
   `vgsd` invocation. In multi-machine mode, also present the remote, identity
   tag, fetch, tracked-checkout, commit, and push steps. The worker runs only
   the native target command; candidate completion and promotion remain on the
   coordinator. If the user requested managed launch, call `stage launch` for
   each local candidate; add `--execute` only when the user explicitly requested
   immediate execution. Interactive workflows may be better opened manually in
   their candidate worktrees.

7. Manage later lifecycle requests through this same installed CLI:
   - inspect: `status`, `context`, `candidates`, `history`
   - advance: `next`, `stage prepare`, `stage launch`
   - finish: `stage complete`, `promote`. For multi-machine candidates,
     `stage complete` fetches and verifies the exact pushed worker commit before
     publishing a completion marker; `promote` verifies that marker and pushes
     the promoted integration branch.
   - recover: `run resume`, `cleanup`

8. Never run the requested mutating workflow in the integration worktree after
   Vibe initialization. Candidate completion and promotion remain separate,
   explicit actions.
</process>

<success_criteria>
- The starting state was discovered rather than assumed.
- Legacy public `gsd` command references in brownfield `.planning/` Markdown
  were either absent or explicitly reviewed, migrated, and committed before the
  candidate base was created.
- Direct, single-candidate, and N-candidate execution are all available.
- Every candidate begins from the recorded exact base commit.
- Multi-machine workers are accepted only through the published identity tag,
  assigned tool/command, tracked remote branch, commit ancestry, and live
  remote checks.
- Multi-machine completion requires a clean committed result pushed to the
  configured remote; promotion remains coordinator-owned and pushes the
  integration branch.
- The user receives runtime-native workflow invocations, not terminal-only
  recovery instructions.
- Promotion remains explicit.
</success_criteria>
