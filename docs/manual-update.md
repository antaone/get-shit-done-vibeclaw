# Manual Update (Non-npm Install)

fvgsd is not published to npm. The normal way to update is `/fvgsd-update`, which pulls the clone fvgsd was installed from and reinstalls. Use this procedure when `/fvgsd-update` can't find an install record (for example, before the first install), or you would rather run the steps yourself.

## Prerequisites

- Node.js installed
- This repo cloned locally (`git clone https://github.com/antaone/get-shit-done-vibeclaw.git`)

## Steps

```bash
# 1. Pull latest code
git pull --ff-only

# 2. Install dependencies
npm install

# 3. Build the hooks dist (required — hooks/dist/ is generated, not checked in as source)
npm run build:hooks

# 4. Run the installer directly
node bin/install.js --claude --global

# 5. Clear the update cache so the statusline indicator resets
rm -f ~/.cache/fvgsd/update-check.json
```

**Step 6 — Restart your runtime** to pick up the new commands and agents.

## Runtime flags

Replace `--claude` with the flag for your runtime:

| Runtime | Flag |
|---|---|
| Claude Code | `--claude` |
| Gemini CLI | `--gemini` |
| OpenCode | `--opencode` |
| Kilo | `--kilo` |
| Codex | `--codex` |
| Copilot | `--copilot` |
| Cursor | `--cursor` |
| Windsurf | `--windsurf` |
| Augment | `--augment` |
| All runtimes | `--all` |

Use `--local` instead of `--global` for a project-scoped install.

## What the installer replaces

The installer performs a clean wipe-and-replace of fvgsd-managed directories only:

- `~/.claude/fvgsd/` — workflows, references, templates
- `~/.claude/commands/fvgsd/` — slash commands
- `~/.claude/agents/fvgsd-*.md` — fvgsd agents
- `~/.claude/hooks/fvgsd/` — compiled hooks

**What is preserved:**
- Custom agents not prefixed with `fvgsd-`
- Custom commands outside `commands/fvgsd/`
- Your `CLAUDE.md` files
- Custom hooks

Locally modified fvgsd files are automatically backed up to `fvgsd-local-patches/` before the install. Run `/fvgsd-update --reapply` after updating to merge your modifications back in.
