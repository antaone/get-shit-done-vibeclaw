<purpose>
Detect current project state and automatically advance to the next logical GSD workflow step.
Reads project state to determine: discuss → plan → execute → verify → complete progression.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="detect_state">
Read project state to determine current position:

```bash
# Get state snapshot
fvgsd-sdk query state.json 2>/dev/null || echo "{}"
```

Also read:
- `.planning/STATE.md` — current phase, progress, plan counts
- `.planning/ROADMAP.md` — milestone structure and phase list

Extract:
- `current_phase` — which phase is active
- `plan_of` / `plans_total` — plan execution progress
- `progress` — overall percentage
- `status` — active, paused, etc.

If no `.planning/` directory exists:
```
No GSD project detected. Run `/fvgsd:new-project` to get started.
```
Exit.
</step>

<step name="safety_gates">
Run hard-stop checks before routing. Exit on first hit unless `--force` was passed.

If `--force` flag was passed, skip all gates and the consecutive guard.
Print a one-line warning: `⚠ --force: skipping safety gates`
Then proceed directly to `determine_next_action`.

**Gate 1: Unresolved checkpoint**
Check if `.planning/.continue-here.md` exists:
```bash
[ -f .planning/.continue-here.md ]
```
If found:
```
⛔ Hard stop: Unresolved checkpoint

`.planning/.continue-here.md` exists — a previous session left
unfinished work that needs manual review before advancing.

Read the file, resolve the issue, then delete it to continue.
Use `--force` to bypass this check.
```
Exit (do not route).

**Gate 2: Error state**
Check if STATE.md contains `status: error` or `status: failed`:
If found:
```
⛔ Hard stop: Project in error state

STATE.md shows status: {status}. Resolve the error before advancing.
Run `/fvgsd:health` to diagnose, or manually fix STATE.md.
Use `--force` to bypass this check.
```
Exit.

**Gate 3: Unchecked verification**
Check if the current phase has a VERIFICATION.md with any `FAIL` items that don't have overrides:
If found:
```
⛔ Hard stop: Unchecked verification failures

VERIFICATION.md for phase {N} has {count} unresolved FAIL items.
Address the failures or add overrides before advancing to the next phase.
Use `--force` to bypass this check.
```
Exit.

**Prior-phase completeness scan:**
After passing all three hard-stop gates, scan all phases that precede the current phase in ROADMAP.md order for incomplete work. For each prior phase number `N`, use `fvgsd-sdk query find-phase <N>` JSON (plans, summaries, incomplete_plans, etc.) to inspect that phase.

Detect three categories of incomplete work:
1. **Plans without summaries** — a PLAN.md exists in a prior phase directory but no matching SUMMARY.md exists (execution started but not completed).
2. **Verification failures not overridden** — a prior phase has a VERIFICATION.md with `FAIL` items that have no override annotation.
3. **CONTEXT.md without plans** — a prior phase directory has a CONTEXT.md but no PLAN.md files (discussion happened, planning never ran).

If no incomplete prior work is found, continue to `determine_next_action` silently with no interruption.

If incomplete prior work is found, show a structured completeness report:
```
⚠ Prior phase has incomplete work

Phase {N} — "{name}" has unresolved items:
  • Plan {N}-{M} ({slug}): executed but no SUMMARY.md
  [... additional items ...]

Advancing before resolving these may cause:
  • Verification gaps — future phase verification won't have visibility into what prior phases shipped
  • Context loss — plans that ran without summaries leave no record for future agents

Options:
  [C] Continue and defer these items to backlog
  [S] Stop and resolve manually (recommended)
  [F] Force advance without recording deferral

Choice [S]:
```

**If the user chooses "Stop" (S or Enter/default):** Exit without routing.

**If the user chooses "Continue and defer" (C):**
1. For each incomplete item, create a backlog entry in `ROADMAP.md` under `## Backlog` using the existing `999.x` numbering scheme:
```markdown
### Phase 999.{N}: Follow-up — Phase {src} incomplete plans (BACKLOG)

**Goal:** Resolve plans that ran without producing summaries during Phase {src} execution
**Source phase:** {src}
**Deferred at:** {date} during /fvgsd:progress --next advancement to Phase {dest}
**Plans:**
- [ ] {N}-{M}: {slug} (ran, no SUMMARY.md)
```
2. Commit the deferral record:
```bash
fvgsd-sdk query commit "docs: defer incomplete Phase {src} items to backlog"
```
3. Continue routing to `determine_next_action` immediately — no second prompt.

**If the user chooses "Force" (F):** Continue to `determine_next_action` without recording deferral.
</step>

<step name="spike_sketch_notice">
Check for pending spike/sketch work and surface a notice (does not change routing):

```bash
# Check for pending spikes (verdict: PENDING in any README)
PENDING_SPIKES=$(grep -rl 'verdict: PENDING' .planning/spikes/*/README.md 2>/dev/null | wc -l | tr -d ' ')

# Check for pending sketches (winner: null in any README)
PENDING_SKETCHES=$(grep -rl 'winner: null' .planning/sketches/*/README.md 2>/dev/null | wc -l | tr -d ' ')
```

If either count is > 0, display before routing:
```
⚠ Pending exploratory work:
  {PENDING_SPIKES} spike(s) with unresolved verdicts in .planning/spikes/
  {PENDING_SKETCHES} sketch(es) without a winning variant in .planning/sketches/

  Resume with `/fvgsd:spike` or `/fvgsd:sketch`, or continue with phase work below.
```

Only show lines for non-zero counts. If both are 0, skip this notice entirely.
</step>

<step name="determine_next_action">
Apply routing rules based on state:

**Route 1: No phases exist yet → discuss**
If ROADMAP has phases but no phase directories exist on disk:
→ Next action: `/fvgsd:discuss-phase <first-phase>`

**Route 2: Phase exists but has no CONTEXT.md or RESEARCH.md → discuss**
If the current phase directory exists but has neither CONTEXT.md nor RESEARCH.md:
→ Next action: `/fvgsd:discuss-phase <current-phase>`

**Route 3: Phase has context but no plans → build (or plan)**
If the current phase has CONTEXT.md (or RESEARCH.md) but no PLAN.md files, run `fvgsd-sdk query config-get workflow.build_mode --default true`:
→ Prints `true` and the phase has CONTEXT.md: `/fvgsd:build <current-phase>`
→ Prints `true` and the phase has only RESEARCH.md: `/fvgsd:discuss-phase <current-phase>` (a build needs CONTEXT.md)
→ Otherwise: `/fvgsd:plan-phase <current-phase>`

**Route 4: Phase has plans but incomplete summaries → resume the build (or execute)**
If plans exist but not all have matching summaries, run `fvgsd-sdk query phase-plan-index <current-phase>`:
→ A plan has `kind: "brief"` and either `has_summary: false`, or a matching `{P}-{NN}-SUMMARY.md` whose frontmatter lacks `kind: build-summary`: `/fvgsd:build <current-phase>` (resumes the build; execute-phase refuses briefs)
→ Otherwise: `/fvgsd:execute-phase <current-phase>`

**Route 4a: Build phase has an unfinalized summary → resume the build**
If a plan in the current phase has `kind: "brief"` and a matching `{P}-{NN}-SUMMARY.md` whose frontmatter lacks `kind: build-summary`, regardless of `workflow.build_mode`:
→ Next action: `/fvgsd:build <current-phase>` (resumes the build; execute-phase refuses briefs)

**Route 4b: Build phase has verification gaps → gap build**
If `fvgsd-sdk query config-get workflow.build_mode --default true` prints `true`, a plan in the current phase has `kind: "brief"`, every plan has a summary, and the phase VERIFICATION.md frontmatter has `status: gaps_found`:
→ Next action: `/fvgsd:build <current-phase> --gaps`

**Route 5: All plans have summaries → verify and complete**
If all plans in the current phase have summaries:
→ Next action: `/fvgsd:verify-work`

**Route 6: Phase complete, next phase exists → advance**
If the current phase is complete and the next phase exists in ROADMAP:
→ Next action: `/fvgsd:discuss-phase <next-phase>`

**Route 7: All phases complete → complete milestone**
If all phases are complete:
→ Next action: `/fvgsd:complete-milestone`

**Route 8: Paused → resume**
If STATE.md shows paused_at:
→ Next action: `/fvgsd:resume-work`
</step>

<step name="show_and_execute">
Display the determination:

```
## GSD Next

**Current:** Phase [N] — [name] | [progress]%
**Status:** [status description]

▶ **Next step:** `/fvgsd-[command] [args]`
  [One-line explanation of why this is the next step]
```

Then immediately invoke the determined command via SlashCommand.
Do not ask for confirmation — the whole point of `/fvgsd:progress --next` is zero-friction advancement.
</step>

</process>

<success_criteria>
- [ ] Project state correctly detected
- [ ] Next action correctly determined from routing rules
- [ ] Command invoked immediately without user confirmation
- [ ] Clear status shown before invoking
</success_criteria>
