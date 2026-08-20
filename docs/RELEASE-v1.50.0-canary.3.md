# v1.50.0-canary.3 Release Notes

This canary cut introduces the VibeClaw orchestration gateway: a repository-backed way to prepare one or more guarded GSD executions before a workflow starts, run them with different AI tools, compare their results, and explicitly promote the chosen candidate.

## Install from this repository

```bash
git clone <repository-url>
cd get-shit-done-vibeclaw
npm install
npm link
```

The root `npm install` now prepares the nested SDK automatically when `sdk/dist/cli.js` is missing. To rebuild it explicitly, run `npm run build:sdk` from the repository root. After linking, `vibe`, `get-shit-done-cc`, `gsd-tools`, and `gsd-sdk` are available from the terminal.

Install the GSD surface for each runtime you plan to use:

```bash
get-shit-done-cc --codex --global
get-shit-done-cc --gemini --global
get-shit-done-cc --claude --global
```

## Vibe before workflow execution

Start orchestration from the integration worktree with the native Vibe gateway:

```text
/vgsd-vibe new-project --tool gemini --tool codex --tool claude
/vgsd-vibe new-milestone --tool codex --tool claude
/vgsd-vibe execute-phase --tool codex --tool opencode
/vgsd-vibe quick --tool codex
/vgsd-vibe fast --tool claude
/vgsd-vibe debug --tool codex --tool claude
```

Use `/vgsd:vibe` in Gemini CLI and `$vgsd-vibe` in Codex. The gateway inspects Git and planning state, can initialize a greenfield repository with an approved baseline, and prepares exact-base candidate branches and worktrees before printing the matching native workflow command.

Direct mutating `vgsd` commands remain safe: before Vibe exists they create a standalone `vgsd/<runtime>/<command>/<execution-id>` branch; after Vibe initializes, commands reject the integration worktree and require a prepared candidate.

## Multi-machine Git handoffs

Candidates can run in separate clones on different machines:

```text
/vgsd-vibe execute-phase --multi-machine --remote origin --tool codex --tool opencode --tool claude
```

Preparation pushes each candidate branch plus a portable identity tag. Worker guards verify the assigned branch, command, tool, base ancestry, and completion state. Completion requires a committed and pushed result; promotion fetches and revalidates the handoff before updating and pushing the integration branch.

The coordinator needs VibeClaw and authenticated access to the shared Git remote. Each worker needs only its assigned runtime, the VibeClaw-aware `vgsd` installation, and access to the same remote.

## Documentation

- [VibeClaw guide](VIBECLAW.md) covers greenfield, brownfield, quick/fix/debug, milestones, features, and recovery scenarios.
- [Multi-tool walkthrough](MULTI-TOOL-WALKTHROUGH.md) provides complete local-worktree and multi-machine flows.

## Validation

The focused orchestration, execution-guard, install, registry, and documentation release suite passes 301 tests with two expected Windows permission skips. The multi-machine suite passes its three Git handoff scenarios, generated guard content is synchronized, skill dependencies lint cleanly, and `git diff --check` reports no whitespace errors.

The broad legacy suite still contains unrelated assertions for the former public `gsd` namespace and historical install layout; those are not represented as passing release gates for this canary.
