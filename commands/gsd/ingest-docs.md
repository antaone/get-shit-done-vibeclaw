---
name: vgsd:ingest-docs
description: Bootstrap or merge a .planning/ setup from existing ADRs, PRDs, SPECs, and docs in a repo.
argument-hint: "[path] [--mode new|merge] [--manifest <file>] [--resolve auto|interactive]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" execution-branch ensure "ingest-docs" --runtime __VGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `vgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Build the full `.planning/` setup (or merge into an existing one) from multiple pre-existing planning documents — ADRs, PRDs, SPECs, DOCs — in one pass.

- **Net-new bootstrap** (`--mode new`, default when `.planning/` is absent): produces PROJECT.md + REQUIREMENTS.md + ROADMAP.md + STATE.md from synthesized doc content, delegating final generation to `gsd-roadmapper`.
- **Merge into existing** (`--mode merge`, default when `.planning/` is present): appends phases and requirements derived from the ingested docs; hard-blocks any contradiction with existing locked decisions.

Auto-synthesizes most conflicts using the precedence rule `ADR > SPEC > PRD > DOC` (overridable via manifest). Surfaces unresolved cases in `.planning/INGEST-CONFLICTS.md` with three buckets: auto-resolved, competing-variants, unresolved-blockers. The BLOCKER gate from the shared conflict engine prevents any destination file from being written when unresolved contradictions exist.

**Inputs:** directory-convention discovery (`docs/adr/`, `docs/prd/`, `docs/specs/`, `docs/rfc/`, root-level `{ADR,PRD,SPEC,RFC}-*.md`), or an explicit `--manifest <file>` YAML listing `{path, type, precedence?}` per doc.

**v1 constraints:** hard cap of 50 docs per invocation; `--resolve interactive` is reserved for a future release.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/ingest-docs.md
@~/.claude/get-shit-done/references/ui-brand.md
@~/.claude/get-shit-done/references/gate-prompts.md
@~/.claude/get-shit-done/references/doc-conflict-engine.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
Execute the ingest-docs workflow end-to-end. Preserve all approval gates (discovery, conflict report, routing) and the BLOCKER safety rule.
</process>
