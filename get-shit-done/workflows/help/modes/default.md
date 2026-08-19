<purpose>
One-page newcomer-oriented tour of GSD. Output ONLY the `<reference>` content below. No additions.
</purpose>

<reference>
# GSD — Get Shit Done

Plan-driven development for solo agentic work with Claude Code. GSD turns a vague idea into a hierarchical plan, then executes it phase by phase with state tracking and atomic commits.

## Start here (3 commands)

```text
/vgsd:new-project        # Greenfield: questioning → research → requirements → roadmap
/vgsd:plan-phase 1       # Create a detailed plan for phase 1
/vgsd:execute-phase 1    # Execute all plans in the phase
```

Existing codebase? Run `/vgsd:map-codebase` first to ground GSD in your code.

## Common commands

| Command | Purpose |
|---|---|
| `/vgsd:progress` | Where am I, what's next — also routes freeform intent with `--do "..."` |
| `/vgsd:quick` | Small ad-hoc task with GSD guarantees (planning dir + atomic commit) |
| `/vgsd:fast "<task>"` | Trivial inline change — no subagents, ≤3 file edits |
| `/vgsd:discuss-phase <N>` | Capture vision and decisions before planning |
| `/vgsd:debug "<symptom>"` | Persistent debug session, survives `/clear` |
| `/vgsd:capture` | Save an idea, todo, note, seed, or backlog item |
| `/vgsd:verify-work <N>` | Conversational UAT for a completed phase |
| `/vgsd:ship <N>` | Open a PR from a completed phase |
| `/vgsd:help --full` | Complete reference (every command, every flag) |

## Want more?

```text
/vgsd:help --brief         # 10-line refresher of top commands
/vgsd:help --full          # complete reference
/vgsd:help <topic>         # one section only — see topics below
/vgsd:help --brief <topic> # compact scoped lookup — signature + one-line summary
```

Topics: `workflow` · `planning` · `execute` · `quick` · `debug` · `capture` · `ship` · `config` · `milestones` · `spike` · `sketch` · `review` · `audit` · `progress`

## Update GSD

```bash
npx get-shit-done-cc@latest
```
</reference>
