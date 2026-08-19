---
name: vgsd-ideate
description: "exploration capture | explore sketch spike spec capture"
argument-hint: ""
allowed-tools:
  - Read
  - Skill
requires: [capture, explore, sketch, spike, spec-phase]
---

Route to the appropriate exploration / capture skill based on the user's intent.
`gsd-note`, `gsd-add-todo`, `gsd-add-backlog`, and `gsd-plant-seed` were folded
into `vgsd-capture` (with `--note`, default, `--backlog`, `--seed` modes) by
#2790. The capture target lists pending todos via `--list`.

| User wants | Invoke |
|---|---|
| Explore an idea or opportunity | vgsd-explore |
| Sketch out a rough design or plan | vgsd-sketch |
| Time-boxed technical spike | vgsd-spike |
| Write a spec for a phase | vgsd-spec-phase |
| Capture a thought (todo / note / backlog / seed) | vgsd-capture |

Invoke the matched skill directly using the Skill tool.
