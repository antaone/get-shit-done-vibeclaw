# Canary Stream

fvgsd has no npm channels: R28 removed every npm-publish workflow, so there is no `canary`, `next`, or `latest` dist-tag to install from. A pre-release build is simply a branch or commit checked out in your fvgsd clone and installed with `node bin/install.js`. This page describes tracking the long-lived `dev` integration branch — GSD's earliest preview line — before its work has any expectation of stability.

## Stream policy

GSD's release lines are fed by exactly one git branch each. **Streams do not mix.**

| Branch | Line | Audience | Stability |
|---|---|---|---|
| `dev` | canary | Contributors, willing early adopters | Best-effort. May regress between commits. Roll-forward only. |
| `main` (pre-tag) | next / RC | Maintainers, RC testers | Release-candidate quality. Bug-bar enforced. |
| `main` (tagged release) | latest | Everyone else | Production stable. The default branch to install from. |

`dev` is the integration branch for in-flight feature work (typically multi-PR vertical slices like the MVP/TDD/UAT track in 1.50.0). When the dev work stabilizes, it promotes to `main` as an RC train (tagged `vX.Y.Z-rc.N`), and after the RC train bakes, the same train promotes again to a stable `vX.Y.Z` tag.

A canary commit NEVER becomes an RC directly, and an RC NEVER becomes a stable release directly — every promotion goes through a fresh tag.

## Installing canary

```bash
# From your fvgsd clone
git fetch origin
git checkout dev
git pull --ff-only
npm install
node bin/install.js --claude --global
```

Pin to an exact canary commit instead of `dev` by checking out its SHA before running the installer. The installer's defensive purge rewrites stale config blocks left by older GSD versions, so reinstalling on top of an existing project is safe.

## When to install canary

✅ **Do** install canary when you want to:
- Exercise in-flight planning/execution/verification features early and report findings
- Validate a fix you've contributed to `dev` is reachable end-to-end
- Help shake out canary-bake items (rough edges that won't ship to `next` until resolved)

❌ **Do NOT** install canary on:
- Production projects you depend on for delivery
- A machine where rolling back means recreating GSD state (use a profile or a workspace instead)
- A demo or onboarding setup — install from `main` so audiences see the stable surface

## Rolling back from canary

```bash
# Back to the current stable, from your fvgsd clone
git checkout main
git pull --ff-only
npm install
node bin/install.js --claude --global

# Or pin to a specific RC tag instead of `main`
git checkout vX.Y.Z-rc.N
```

If you have a local project that interacted with canary-only features (for instance, an MVP-mode phase planned by 1.50.0-canary), the planner artifacts in `.planning/` remain valid — older GSD versions will just ignore the `**Mode:** mvp` field on phases.

## Reporting issues against canary

File against the [issue tracker](https://github.com/gsd-build/get-shit-done/issues) with the `bug` template. Include the exact canary version (`fvgsd --version` reports it) so triage can route the report back into the `dev` stream rather than the stable stream.

## Where to look next

- Active canary release notes: [`docs/RELEASE-v1.50.0-canary.3.md`](RELEASE-v1.50.0-canary.3.md)
- Stable release notes: [`CHANGELOG.md`](../CHANGELOG.md)
- Stream architecture rationale: discussed across [#2727](https://github.com/gsd-build/get-shit-done/issues/2727), [#2773](https://github.com/gsd-build/get-shit-done/issues/2773) (codex schema-break and the resulting promotion bottleneck that motivated explicit stream isolation)
