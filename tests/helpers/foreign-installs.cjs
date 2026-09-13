'use strict';

/**
 * Seeds fake upstream GSD and vgsd installs into a runtime config directory and
 * snapshots it for tests/fvgsd-coexistence.install.test.cjs. This file uses
 * gsd/vgsd names on purpose and is excluded from scripts/rename-identity.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Markers upstream GSD's installer writes into files it shares with other installs.
const FOREIGN_MARKERS = Object.freeze({
  codexConfig: '# GSD Agent Configuration — managed by get-shit-done installer',
  copilotOpen: '<!-- GSD Configuration — managed by get-shit-done installer -->',
  copilotClose: '<!-- /GSD Configuration -->',
});

// Runtimes whose config root gets GSD's CommonJS marker package.json from GSD's
// installer (bin/install.js at v1.42.3 skips it only for Codex, Copilot, Cursor,
// Windsurf, Trae and Cline). fvgsd must neither rewrite nor remove it.
const COMMONJS_MARKER_RUNTIMES = new Set([
  'claude', 'antigravity', 'augment', 'codebuddy', 'gemini', 'hermes', 'kilo', 'opencode', 'qwen',
]);

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function hookCommand(configDir, name) {
  return `node "${configDir.replace(/\\/g, '/')}/hooks/${name}"`;
}

function seedForeignInstalls(configDir, runtime) {
  const settings = {
    statusLine: { type: 'command', command: hookCommand(configDir, 'gsd-statusline.js') },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(configDir, 'gsd-check-update.js') }] }],
      PostToolUse: [{
        matcher: 'Bash|Edit|Write|MultiEdit|Agent|Task',
        hooks: [{ type: 'command', command: hookCommand(configDir, 'gsd-context-monitor.js'), timeout: 10 }],
      }],
    },
  };
  const files = {
    'get-shit-done/VERSION': '1.42.3\n',
    'get-shit-done/workflows/help.md': '# gsd help\n',
    'agents/gsd-planner.md': '---\nname: gsd-planner\n---\n',
    'skills/gsd-help/SKILL.md': '---\nname: gsd-help\n---\n',
    'skills/vgsd-help/SKILL.md': '---\nname: vgsd-help\n---\n',
    'commands/gsd/help.md': '---\nname: gsd:help\n---\n',
    'commands/vgsd/help.md': '---\nname: vgsd:help\n---\n',
    'command/gsd-help.md': '---\nname: gsd-help\n---\n',
    'hooks/gsd-statusline.js': '// gsd-hook-version: 1.42.3\n',
    'hooks/gsd-context-monitor.js': '// gsd-hook-version: 1.42.3\n',
    'hooks/gsd-check-update.js': '// gsd-hook-version: 1.42.3\n',
    'hooks/lib/git-cmd.js': 'module.exports = {};\n',
    'gsd-file-manifest.json': `${JSON.stringify({ version: '1.42.3', files: { 'agents/gsd-planner.md': 'x' } }, null, 2)}\n`,
    'settings.json': `${JSON.stringify(settings, null, 2)}\n`,
  };
  if (runtime === 'codex') {
    // Shapes fvgsd's merge and strip must keep byte for byte: a blank line after a
    // table header, a run of blank lines between tables, blank lines inside a
    // multiline string, and the trailing blank line GSD's installer leaves.
    files['config.toml'] = [
      'model = "gpt-5"',
      '',
      '[features]',
      '',
      'codex_hooks = true',
      '',
      '',
      '[profiles.work]',
      'developer_instructions = """',
      'First paragraph.',
      '',
      '',
      'Second paragraph.',
      '"""',
      '',
      FOREIGN_MARKERS.codexConfig,
      '',
      '[agents.gsd-planner]',
      'description = "GSD planner"',
      'config_file = "agents/gsd-planner.toml"',
      '',
      '',
    ].join('\n');
    files['agents/gsd-planner.toml'] = 'developer_instructions = "plan"\n';
    files['hooks.json'] = `${JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(configDir, 'gsd-check-update.js') }] }] },
    }, null, 2)}\n`;
  }
  if (runtime === 'copilot') {
    // User text followed by upstream's managed block, the way upstream's installer
    // leaves a user's file after appending its block to it.
    files['copilot-instructions.md'] = [
      '# Team Copilot rules',
      '',
      'Prefer small, reviewed changes.',
      '',
      FOREIGN_MARKERS.copilotOpen,
      '# Instructions for GSD',
      '',
      '- Use the get-shit-done skill when the user asks for GSD or uses a `gsd-*` command.',
      '- Load the matching skill from `skills/gsd-*` before acting on a GSD command.',
      FOREIGN_MARKERS.copilotClose,
      '',
    ].join('\n');
  }
  if (runtime === 'gemini') {
    // Upstream GSD's Gemini installer turns on sub-agents in the shared settings.json.
    files['settings.json'] = `${JSON.stringify({ ...settings, experimental: { enableAgents: true } }, null, 2)}\n`;
  }
  if (runtime === 'cline') {
    // Upstream GSD's plain-text rules file at the config root.
    files['.clinerules'] = [
      '# GSD — Get Shit Done',
      '',
      '- GSD workflows live in `get-shit-done/workflows/`. Load the relevant workflow when',
      '  the user runs a `/gsd-*` command.',
      '- GSD agents live in `agents/`. Use the matching agent when spawning subagents.',
      '- GSD tools are at `get-shit-done/bin/gsd-tools.cjs`. Run with `node`.',
      '',
    ].join('\n');
  }
  if (runtime === 'opencode' || runtime === 'kilo') {
    const key = `${configDir.replace(/\\/g, '/')}/get-shit-done/*`;
    files[`${runtime}.json`] = `${JSON.stringify({ permission: { read: { [key]: 'allow' } } }, null, 2)}\n`;
  }
  if (COMMONJS_MARKER_RUNTIMES.has(runtime)) {
    // The exact bytes GSD's installer writes, so an fvgsd install that wrote the
    // same marker would still pass the hash check; only removing it would not.
    files['package.json'] = '{"type":"commonjs"}\n';
  }
  for (const [rel, content] of Object.entries(files)) writeFile(configDir, rel, content);
  return Object.keys(files).sort();
}

function listFiles(root, rel = '') {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(root, child));
    else out.push(child);
  }
  return out.sort();
}

function snapshot(configDir, relPaths) {
  return Object.fromEntries(relPaths.map((rel) => [
    rel,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(configDir, rel))).digest('hex'),
  ]));
}

module.exports = { FOREIGN_MARKERS, seedForeignInstalls, listFiles, snapshot };
