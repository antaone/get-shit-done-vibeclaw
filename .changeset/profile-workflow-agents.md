---
type: Fixed
pr: null
---
Profile installs (`--profile=core`, `standard`, `repo-session`, and `/fvgsd-surface`) now install every agent their commands' workflows spawn. Agents were only counted when a command named them in its own file, so for example `repo-session` and `core` installed `/fvgsd-plan-phase` without `fvgsd-pattern-mapper`, and `/fvgsd-new-project` without its researchers and roadmapper.
