<purpose>
One-page newcomer-oriented tour of GSD. Output ONLY the `<reference>` content below. No additions.
</purpose>

<reference>
# GSD — Get Shit Done

Plan-driven development for solo agentic work with Claude Code. GSD turns a vague idea into a hierarchical plan, then executes it phase by phase with state tracking and atomic commits.

## Start here (3 commands)

```text
/fvgsd:new-project        # Greenfield: questioning → research → requirements → roadmap
/fvgsd:plan-phase 1       # Create a detailed plan for phase 1
/fvgsd:execute-phase 1    # Execute all plans in the phase
```

Existing codebase? Run `/fvgsd:map-codebase` first to ground GSD in your code.

## Common commands

| Command | Purpose |
|---|---|
| `/fvgsd:progress` | Where am I, what's next — also routes freeform intent with `--do "..."` |
| `/fvgsd:quick` | Small ad-hoc task with GSD guarantees (planning dir + atomic commit) |
| `/fvgsd:fast "<task>"` | Trivial inline change — no subagents, ≤3 file edits |
| `/fvgsd:discuss-phase <N>` | Capture vision and decisions before planning |
| `/fvgsd:debug "<symptom>"` | Persistent debug session, survives `/clear` |
| `/fvgsd:capture` | Save an idea, todo, note, seed, or backlog item |
| `/fvgsd:verify-work <N>` | Conversational UAT for a completed phase |
| `/fvgsd:ship <N>` | Open a PR from a completed phase |
| `/fvgsd:help --full` | Complete reference (every command, every flag) |

## Want more?

```text
/fvgsd:help --brief         # 10-line refresher of top commands
/fvgsd:help --full          # complete reference
/fvgsd:help <topic>         # one section only — see topics below
/fvgsd:help --brief <topic> # compact scoped lookup — signature + one-line summary
```

Topics: `workflow` · `planning` · `execute` · `quick` · `debug` · `capture` · `ship` · `config` · `milestones` · `spike` · `sketch` · `review` · `audit` · `progress`

## Update GSD

```bash
npx fvgsd@latest
```
</reference>
