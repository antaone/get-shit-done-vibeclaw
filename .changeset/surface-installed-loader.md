---
type: Fixed
pr: null
---
`/fvgsd-surface profile`, `enable`, `disable` and `reset` now work from an installed copy. The installed engine looked for `bin/install.js` beside itself, which only exists in a clone, so any change to the skill surface failed with "Cannot find module". It now loads the installer from the clone named in the install record.
