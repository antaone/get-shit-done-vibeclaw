---
type: Fixed
pr: null
---
`/fvgsd-surface` now writes skills and commands exactly as the installer does. It used to skip the installer's per-runtime rewrites, so re-staged skills kept the `__FVGSD_RUNTIME__` placeholder in their execution-branch guard line and the unrewritten config paths.
