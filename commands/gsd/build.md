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
