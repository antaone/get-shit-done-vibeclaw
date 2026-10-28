---
type: Added
pr: null
---
Add the project pack and `/fvgsd-dod`. A `pack` section in `.planning/config.json` holds project facts for fvgsd's agents (deploy targets, migrations, candidate naming, message prefix, handoff file); `/fvgsd-pack show|init` prints it or drafts it from the repo. `/fvgsd-dod` runs the full check set once and prints one table. Checks gain `workflow.extra_check_commands` and an `off` value for each of the four check commands, and `build.run-checks` runs without `--phase` and takes `--tail`. `workflow.research: on-gap` makes `/fvgsd-build` research only the Open Questions in CONTEXT.md, `workflow.build_verify_report: lite` asks the build verifier for a must-haves table without narrative, and the `repo-session` surface profile lists only the day-to-day skills.
