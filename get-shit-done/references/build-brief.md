# Build Brief Format

The build brief is `{P}-{NN}-PLAN.md` in the phase folder. It keeps the PLAN file name, so status checks, routing and the plan index treat it as a plan. Code reads everything in its frontmatter.

## Frontmatter

```yaml
---
phase: 03-user-auth
plan: 01
type: execute
kind: brief
wave: 1
depends_on: []
files_modified: [src/auth/session.ts, src/auth/password.ts, src/routes/auth/login.ts]
autonomous: true
requirements: [AUTH-01, AUTH-02]
user_setup: []
gap_closure: false
must_haves:
  truths:
    - "A user with valid credentials can sign in and stays signed in after a reload"
  artifacts: []   # same item format as get-shit-done/templates/phase-prompt.md
  key_links: []   # same item format as get-shit-done/templates/phase-prompt.md
slices:
  - id: s1
    goal: "Session model and password hashing"
    owns: ["src/auth/**", "migrations/*auth*.sql"]
    after: []
    strong: false
  - id: s2
    goal: "Login and logout routes"
    owns: ["src/routes/auth/**", "app/login/**"]
    after: [s1]
    strong: false
---
```

- `slices[].owns`: globs for the files the slice changes (`**`, `*`, `?`, `[..]`, `{a,b}`). Write directories as `dir/**`. Slices whose globs overlap never build in the same wave.
- `slices[].after`: ids of slices that must finish first. Order slices that share an interface this way.
- `slices[].strong`: `true` for a slice that needs the stronger model.
- `user_setup`: steps only the user can take (accounts, secrets, hardware). They are asked before building.
- `requirements`: every requirement ID from the phase's ROADMAP section.

## Body

```markdown
<objective>
What this phase delivers and why, in one to three paragraphs. The plan index reads the first line.
</objective>

## Approach
Key design choices, interfaces shared between slices, and data flow.

## Slices
### s1 — Session model and password hashing
Owns: src/auth/**, migrations/*auth*.sql
Done when: …

## Decisions
| Decision | Where it lands | Status |
|---|---|---|
| D-01 | s1: argon2id hashing in src/auth/password.ts | planned |
| D-04 | — | deferred: SSO moves to a later phase per CONTEXT |

## Checks
build: npm run build · typecheck: npx tsc --noEmit · lint: npm run lint · test: npm test

## Risks
A short list, plus threat notes when `security_enforcement` is on.

## Judgment calls
The choices CONTEXT left to Claude's discretion, and what was chosen.
```

The target length is 100 to 200 lines. This is guidance only and is not checked.

## What `build.check-brief` checks

`fvgsd-sdk query build.check-brief <path>` returns `{ "valid": bool, "errors": [{ "field": "slices[1].after[0]", "message": "…" }] }` and checks only:

- the plan frontmatter fields `phase`, `plan`, `type`, `wave`, `depends_on`, `files_modified`, `autonomous` and `must_haves`
- `kind: brief`
- `requirements` is non-empty when the phase's ROADMAP section lists requirement IDs
- `slices` has at least one entry; ids match `^s[0-9]+$` and are unique; every `after` id exists; there are no cycles; `owns` is non-empty
- an `<objective>` block is present

Fix any errors in the same turn. Nothing else about the brief is checked. `fvgsd-sdk query build.waves <path>` then turns the slices into ordered waves.

## Gap briefs

A `--gaps` build writes the next free plan number with:
- `gap_closure: true`
- `depends_on: ["{P}-{previous NN}"]`
- `wave` set to the previous brief's wave plus one

Its slices cover only the gaps listed in `{P}-VERIFICATION.md`.
