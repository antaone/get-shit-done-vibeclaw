---
type: Fixed
pr: null
---
`vibe cleanup` now removes a prepared candidate that was never used: its branch still sits at its base commit and its worktree is clean. The candidate is marked `failed` with `cleanup.unused`, so the next-step suggestions stop offering it. A prepared candidate with commits or uncommitted changes is still refused.
