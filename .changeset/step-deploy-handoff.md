---
type: Added
pr: null
---
Add `/fvgsd-step`, `/fvgsd-deploy` and `/fvgsd-handoff`. `/fvgsd-step <spec> <phase|new>` digests a step spec into the phase's CONTEXT.md, builds it, runs the definition-of-done checks, optionally deploys (`--deploy ENV`), collects proof and updates the handoff, with one approval before the build. `/fvgsd-deploy` runs one `pack.deploy` environment and asks for the owner's yes on gated ones. `/fvgsd-handoff` keeps the handoff notes short. `/fvgsd-pause-work` now also adds an entry to the handoff notes when `pack.handoff_path` is set, and the `repo-session` profile includes the three new commands.
