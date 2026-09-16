# Build Summary Format

After verification and fix rounds, the build lead writes `{P}-{NN}-SUMMARY.md` and runs `fvgsd-sdk query build.finalize`. Finalize owns part of the frontmatter. The lead owns the rest of the frontmatter and the whole body.

## Frontmatter the lead writes

```yaml
---
subsystem: auth            # required: primary area (auth, payments, ui, api, database, infra, testing, …)
tags: [sessions, argon2]   # required: searchable technologies
provides:                  # optional: what later phases can rely on
  - "Session cookies with 30-day expiry"
key-decisions:             # optional
  - "argon2id for password hashing"
---
```

## Frontmatter finalize writes

Finalize overwrites these keys on every run. Don't write them by hand.

| Key | Value |
|---|---|
| `phase`, `plan`, `kind` | phase folder name, plan number, `build-summary` |
| `duration`, `completed` | minutes since the brief was committed; today's date |
| `key-files.created`, `key-files.modified` | `git diff --name-status <base>..HEAD` outside `.planning/` |
| `requirements-completed` | the IDs passed with `--requirements-completed` |
| `build` | `started`, `completed`, `engine`, `tier`, `slices`, `fix_rounds`, `checks`, `checks_passed_at` |

`checks_passed_at` is the latest first-parent commit outside `.planning/`. It is set only when at least one check ran and every non-skipped check's latest result passed at a commit whose code tree (everything outside `.planning/`) is identical to that commit's, otherwise it is `null`. The next build uses it to decide whether a baseline run is needed. Every key finalize doesn't own stays exactly as the lead wrote it.

A build never re-baselines at a HEAD that holds its own commits. A gap build (`--gaps`, or a resumed gap brief) and a build resumed past `brief_written` skip the baseline and keep the phase's `baseline.json`, so failures an earlier build of the phase introduced still count as new; without a `baseline.json`, every failure counts as new. A `baseline.json` already taken at the current code tree is not run again either.

## Body

```markdown
# Phase 3: User Auth — Build Summary

**One-line outcome.**

## What was built
Per slice: what it delivered, with commit hashes.

## Decisions
| Decision | Status | Notes |
|---|---|---|
| D-01 | done | argon2id hashing in src/auth/password.ts |

## Deviations from the brief

## Checks
Commands and results, including any pre-existing failures.

## Verification
Status and a link to 03-VERIFICATION.md.

## Follow-ups
Remaining gaps, deferred human checks, deferred decisions.
```

## ID coverage

Finalize collects every `D-XX` from the CONTEXT `<decisions>` blocks and every requirement ID in the phase's ROADMAP section. It then searches the brief and the summary as the lead wrote it for each one. Keys finalize writes don't count, so an ID passed only with `--requirements-completed` is still missing.
- **Where a match counts:** anywhere, whether a table cell, a heading, prose or an XML block.
- **Whole IDs only:** `D-01` inside `D-010` doesn't count.

When an ID is missing, finalize changes no state and returns:

```json
{ "ok": false, "missing": { "decisions": ["D-04"], "requirements": ["AUTH-03"] } }
```

To fix it:
1. Add one line per missing ID to the summary: a Decisions row such as `| D-04 | deferred | moved to a later phase per CONTEXT |`, or a Follow-ups line for a requirement.
2. Run finalize again with the same arguments.

## Result

```json
{ "ok": true, "phase_complete": true, "commit": "<sha>", "warnings": [] }
```

- **`phase_complete`** is true only when VERIFICATION.md has `status: passed`.
- **`commit`** is null when `commit_docs` is false.
- **`warnings`** lists, as `<step>: <message>`, state updates that failed or changed nothing, requirement IDs that REQUIREMENTS.md doesn't contain, and the warnings `phase.complete` returns. Mention them in the final output.
