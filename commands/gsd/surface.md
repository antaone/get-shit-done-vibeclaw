---
name: fvgsd:surface
description: Toggle which skills are surfaced — apply a profile, list, or disable a cluster without reinstall
argument-hint: "[list|status|profile <name>|disable <cluster>|enable <cluster>|reset]"
allowed-tools:
  - Read
  - Write
  - Bash
requires: [config, update]
---
<execution_branch_guard>
Before reading execution context, invoking another skill, or changing project state, run:
`node "$HOME/.claude/fvgsd/bin/fvgsd-tools.cjs" execution-branch inspect "surface" --runtime __FVGSD_RUNTIME__`

Parse the JSON response:
- Continue only when `allowed` is `true`.
- If `allowed` is `false`, stop and show its `message` and `hint`.
- If the hint names `fvgsd-vibe`, offer to route the requested command through that installed Vibe control surface instead of leaving the user with terminal-only steps.
- If `action` is `created` or `adopted`, tell the user which `branch` is active once.
- For `reused` or `inspected`, continue silently.
</execution_branch_guard>

<objective>
Manage the current runtime's command or skill surface without reinstall. Reads/writes
`$HOME/.claude/.fvgsd-surface.json` (sibling to `$HOME/.claude/.fvgsd-profile`) and
re-stages the active runtime artifact destinations in place. The installer rewrites
that base path and `__FVGSD_RUNTIME__` for the active tool.

Sub-commands: list · status · profile · disable · enable · reset
</objective>

## Sub-command routing

Parse the first token of $ARGUMENTS:

| Token | Action |
|---|---|
| `list` | Show enabled + disabled clusters and skills |
| `status` | Alias for `list` plus token cost summary |
| `profile <name>` | Write `baseProfile` and re-stage |
| `profile <n1>,<n2>` | Composed profiles (comma-separated, no spaces) |
| `disable <cluster>` | Add cluster to `disabledClusters`, re-stage |
| `enable <cluster>` | Remove cluster from `disabledClusters`, re-stage |
| `reset` | Delete `.fvgsd-surface.json`, return to install-time profile |
| *(none)* | Treat as `list` |

---

## list / status

Call `listSurface(runtimeConfigDir, manifest, CLUSTERS)` from
`~/.claude/fvgsd/bin/lib/surface.cjs`. Display:

```
Enabled (N skills, ~T tokens):
  core_loop:   new-project  discuss-phase  plan-phase  execute-phase  help  update
  audit_review: …
  …

Disabled:
  utility:  health  stats  settings  …

Token cost: ~T (budget cap ~500 tokens for 200k context @ 1%)
```

For `status` also append:

```
Base profile:   standard  (from .fvgsd-surface.json)
Install profile: standard  (from .fvgsd-profile)
```

---

## profile \<name\>

1. Read current surface: `readSurface(runtimeConfigDir)` → if null, seed from `readActiveProfile(runtimeConfigDir)`.
2. Set `surfaceState.baseProfile = name`.
3. `writeSurface(runtimeConfigDir, surfaceState)`.
4. Resolve and re-apply:
   ```js
   const layout = resolveRuntimeArtifactLayout(runtime, runtimeConfigDir, scope);
   applySurface(runtimeConfigDir, layout, manifest, CLUSTERS);
   ```
5. Confirm: "Surface updated to profile `<name>`. N skills enabled."

---

## disable \<cluster\>

Valid cluster names: `core_loop`, `audit_review`, `milestone`, `research_ideate`,
`workspace_state`, `docs`, `ui`, `ai_eval`, `ns_meta`, `utility`.

1. Validate cluster name against `Object.keys(CLUSTERS)`.
2. Read or initialize surface state.
3. Add cluster to `surfaceState.disabledClusters` (deduplicate).
4. `writeSurface` → resolve layout → `applySurface`:
   ```js
   const layout = resolveRuntimeArtifactLayout(runtime, runtimeConfigDir, scope);
   applySurface(runtimeConfigDir, layout, manifest, CLUSTERS);
   ```
5. Confirm: "Disabled cluster `<cluster>`. N skills removed from surface."

---

## enable \<cluster\>

1. Read surface state; if null, nothing to enable — print "No surface delta active."
2. Remove cluster from `surfaceState.disabledClusters`.
3. `writeSurface` → resolve layout → `applySurface`:
   ```js
   const layout = resolveRuntimeArtifactLayout(runtime, runtimeConfigDir, scope);
   applySurface(runtimeConfigDir, layout, manifest, CLUSTERS);
   ```
4. Confirm: "Enabled cluster `<cluster>`. N skills added back to surface."

---

## reset

1. Check if `.fvgsd-surface.json` exists.
2. Delete it.
3. Re-apply using only `readActiveProfile(runtimeConfigDir)` (install-time profile).
4. Confirm: "Surface reset to install-time profile `<name>`."

---

## runtimeConfigDir resolution

The `runtimeConfigDir` for `applySurface` is the **base config directory for the
installed runtime**, not a nested `skills`, `commands`, or `command` directory.
The installer rewrites `$HOME/.claude/` below to that configured directory.

```bash
# Values below are installer-resolved for the active runtime.
RUNTIME="__FVGSD_RUNTIME__"
RUNTIME_CONFIG_DIR="$HOME/.claude/"
SCOPE="global"

# Artifact destinations are derived from runtime layout
# via resolveRuntimeArtifactLayout(RUNTIME, RUNTIME_CONFIG_DIR, SCOPE)
# then applySurface(RUNTIME_CONFIG_DIR, layout, manifest, CLUSTERS)
```

For a project-local installation, set `SCOPE="local"` and use that project's
runtime config directory. Never infer the destination directory manually; use
`resolveRuntimeArtifactLayout('__FVGSD_RUNTIME__', runtimeConfigDir, scope)` so
Claude Code and Codex skills, Gemini namespaced TOML commands, and OpenCode flat
commands are each re-staged in their native layout.

Surface state is stored at `${RUNTIME_CONFIG_DIR}/.fvgsd-surface.json`
(i.e. `$HOME/.claude/.fvgsd-surface.json` before installer path rewriting).

---

## Error handling

- Unknown cluster name → list valid cluster names, exit without writing.
- Unknown profile name → list known profiles (`core`, `standard`, `repo-session`, `full`), exit.
- Missing `surface.cjs` → prompt: "Run `npm i -g get-shit-done` to reinstall GSD."

<execution_context>
Runtime: `__FVGSD_RUNTIME__`
Runtime config directory: `$HOME/.claude/`
Surface state file: `$HOME/.claude/.fvgsd-surface.json`
Install profile marker: `$HOME/.claude/.fvgsd-profile`
Managed artifact destinations: derive with `resolveRuntimeArtifactLayout('__FVGSD_RUNTIME__', runtimeConfigDir, scope)`
Engine module: `$HOME/.claude/fvgsd/bin/lib/surface.cjs`
Cluster definitions: `$HOME/.claude/fvgsd/bin/lib/clusters.cjs`
</execution_context>
