'use strict';

/**
 * Seeds fake upstream GSD and vgsd installs into a runtime config directory and
 * snapshots it for tests/fvgsd-coexistence.install.test.cjs. This file uses
 * gsd/vgsd names on purpose and is excluded from scripts/rename-identity.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
    files['config.toml'] = [
      'model = "gpt-5"',
      '',
      '[features]',
      'codex_hooks = true',
      '',
      '# GSD Agent Configuration — managed by get-shit-done installer',
      '',
      '[agents.gsd-planner]',
      'description = "GSD planner"',
      'config_file = "agents/gsd-planner.toml"',
      '',
    ].join('\n');
    files['agents/gsd-planner.toml'] = 'developer_instructions = "plan"\n';
    files['hooks.json'] = `${JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(configDir, 'gsd-check-update.js') }] }] },
    }, null, 2)}\n`;
  }
  if (runtime === 'opencode' || runtime === 'kilo') {
    const key = `${configDir.replace(/\\/g, '/')}/get-shit-done/*`;
    files[`${runtime}.json`] = `${JSON.stringify({ permission: { read: { [key]: 'allow' } } }, null, 2)}\n`;
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

module.exports = { seedForeignInstalls, listFiles, snapshot };
