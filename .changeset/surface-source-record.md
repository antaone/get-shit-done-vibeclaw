---
type: Fixed
pr: null
---
`/fvgsd-surface` works from an installed copy again. The surface engine in `<config>/fvgsd/bin/lib` now finds the clone through the install record the installer writes beside it (`<config>/fvgsd/.fvgsd-source`), instead of failing with "could not locate commands/gsd". Agents also stage from the clone rather than from the installed agents folder. Engines run from a clone, including the installer, still use their own tree.
