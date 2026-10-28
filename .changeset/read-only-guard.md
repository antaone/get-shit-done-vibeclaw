---
type: Fixed
pr: null
---
Commands that change no code (`/fvgsd-dod`, `/fvgsd-handoff`, `/fvgsd-pack`, `/fvgsd-progress`, `/fvgsd-stats`, `/fvgsd-surface`, plus `/fvgsd-help` and `/fvgsd-vibe`) now pass the execution-branch guard on a Vibe integration branch and outside a Git repository, and never create an execution branch. Code-changing commands such as `/fvgsd-build`, `/fvgsd-step`, `/fvgsd-deploy` and `/fvgsd-quick` still require a Vibe candidate.
