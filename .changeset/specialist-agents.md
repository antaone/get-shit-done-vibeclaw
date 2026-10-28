---
type: Added
pr: null
---
Add four specialist agents with short prompts and capped results: `fvgsd-deploy-runner` runs one deploy from `pack.deploy` and refuses owner-gated targets without a recorded approval, `fvgsd-proof-collector` probes a spec's done-when items and writes the evidence file, `fvgsd-handoff-keeper` appends to the handoff file, rolls old entries to history and flags a stale STATE.md, and `fvgsd-spec-digester` turns a long step spec into the phase's CONTEXT.md with Done when and Open Questions sections.
