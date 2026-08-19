# GSD Canonical Artifact Registry

This directory contains the template files for every artifact that GSD workflows officially produce. The table below is the authoritative index: **if a `.planning/` root file is not listed here, `vgsd-health` will flag it as W019** (unrecognized artifact).

Agents should query this file before treating a `.planning/` file as authoritative. If the file name does not appear below, it is not a canonical GSD artifact.

---

## `.planning/` Root Artifacts

These files live directly at `.planning/` — not inside phase subdirectories.

| File | Template | Produced by | Purpose |
|------|----------|-------------|---------|
| `PROJECT.md` | `project.md` | `/vgsd:new-project` | Project identity, goals, requirements summary |
| `ROADMAP.md` | `roadmap.md` | `/vgsd:new-milestone`, `/vgsd:new-project` | Phase plan with milestones and progress tracking |
| `STATE.md` | `state.md` | `/vgsd:new-project`, `/vgsd:health --repair` | Current session state, active phase, last activity |
| `REQUIREMENTS.md` | `requirements.md` | `/vgsd:new-milestone` | Functional requirements with traceability |
| `MILESTONES.md` | `milestone.md` | `/vgsd:complete-milestone` | Log of completed milestones with accomplishments |
| `BACKLOG.md` | *(inline)* | `/vgsd-add-backlog` | Pending ideas and deferred work |
| `LEARNINGS.md` | *(inline)* | `/vgsd:extract-learnings`, `/vgsd:execute-phase` | Phase retrospective learnings for future plans |
| `THREADS.md` | *(inline)* | `/vgsd:thread` | Persistent discussion threads |
| `config.json` | `config.json` | `/vgsd:new-project`, `/vgsd:health --repair` | Project-specific GSD configuration |
| `CLAUDE.md` | `claude-md.md` | `/vgsd-profile` | Auto-assembled Claude Code context file |
| `RETROSPECTIVE.md` | *(inline)* | `/vgsd:complete-milestone` | Living milestone retrospective updated at each milestone close |

### Version-stamped artifacts (pattern: `vX.Y-*.md`)

| Pattern | Produced by | Purpose |
|---------|-------------|---------|
| `vX.Y-MILESTONE-AUDIT.md` | `/vgsd:audit-milestone` | Milestone audit report before archiving |

These files are archived to `.planning/milestones/` by `/vgsd:complete-milestone`. Finding them at the `.planning/` root after completion indicates the archive step was skipped.

---

## Phase Subdirectory Artifacts (`.planning/phases/NN-name/`)

These files live inside a phase directory. They are NOT checked by W019 (which only inspects the `.planning/` root).

| File Pattern | Template | Produced by | Purpose |
|-------------|----------|-------------|---------|
| `NN-MM-PLAN.md` | `phase-prompt.md` | `/vgsd:plan-phase` | Executable implementation plan |
| `NN-MM-SUMMARY.md` | `summary.md` | `/vgsd:execute-phase` | Post-execution summary with learnings |
| `NN-CONTEXT.md` | `context.md` | `/vgsd:discuss-phase` | Scoped discussion decisions for the phase |
| `NN-RESEARCH.md` | `research.md` | `/vgsd:plan-phase`, `/vgsd:plan-phase --research-phase <N>` | Technical research for the phase |
| `NN-VALIDATION.md` | `VALIDATION.md` | `/vgsd:plan-phase` (Nyquist) | Validation architecture (Nyquist method) |
| `NN-UAT.md` | `UAT.md` | `/vgsd:validate-phase` | User acceptance test results |
| `NN-PATTERNS.md` | *(inline)* | `/vgsd:plan-phase` (pattern mapper) | Analog file mapping for the phase |
| `NN-UI-SPEC.md` | `UI-SPEC.md` | `/vgsd:ui-phase` | UI design contract |
| `NN-SECURITY.md` | `SECURITY.md` | `/vgsd:secure-phase` | Security threat model |
| `NN-AI-SPEC.md` | `AI-SPEC.md` | `/vgsd:ai-integration-phase` | AI integration spec with eval strategy |
| `NN-DEBUG.md` | `DEBUG.md` | `/vgsd:debug` | Debug session log |
| `NN-REVIEWS.md` | *(inline)* | `/vgsd:review` | Cross-AI review feedback |

---

## Milestone Archive (`.planning/milestones/`)

Files archived by `/vgsd:complete-milestone`. These are never checked by W019.

| File Pattern | Source |
|-------------|--------|
| `vX.Y-ROADMAP.md` | Snapshot of ROADMAP.md at milestone close |
| `vX.Y-REQUIREMENTS.md` | Snapshot of REQUIREMENTS.md at milestone close |
| `vX.Y-MILESTONE-AUDIT.md` | Moved from `.planning/` root |
| `vX.Y-phases/` | Archived phase directories (if `--archive-phases` used) |

---

## Adding a New Canonical Artifact

When a new workflow produces a `.planning/` root file:

1. Add the file name to `CANONICAL_EXACT` in `get-shit-done/bin/lib/artifacts.cjs`
2. Add a row to the **`.planning/` Root Artifacts** table above
3. Add the template to `get-shit-done/templates/` if one exists
