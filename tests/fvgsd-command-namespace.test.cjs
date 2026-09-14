'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createTempDir, cleanup } = require('./helpers.cjs');
const {
  convertClaudeCommandToCodexSkill,
  convertClaudeToCliineMarkdown,
  convertClaudeToOpencodeFrontmatter,
  convertSlashCommandsToGeminiMentions,
  installRuntimeArtifacts,
} = require('../bin/install.js');
const { resolveRuntimeArtifactLayout } = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');
const { loadSkillsManifest, resolveProfile } = require('../get-shit-done/bin/lib/install-profiles.cjs');
const { formatGsdSlash } = require('../get-shit-done/bin/lib/runtime-slash.cjs');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands', 'gsd');
const PROFILE = resolveProfile({ modes: ['core'], manifest: loadSkillsManifest(COMMANDS_DIR) });

describe('VibeClaw public command namespace', () => {
  test('runtime formatter emits fvgsd in each runtime-native shape', () => {
    assert.equal(formatGsdSlash('plan-phase 1', 'claude'), '/fvgsd-plan-phase 1');
    assert.equal(formatGsdSlash('plan-phase 1', 'gemini'), '/fvgsd:plan-phase 1');
    assert.equal(formatGsdSlash('plan-phase 1', 'codex'), '$fvgsd-plan-phase 1');
    assert.equal(formatGsdSlash('/gsd:plan-phase 1', 'claude'), '/fvgsd-plan-phase 1');
    assert.equal(formatGsdSlash('$gsd-plan-phase 1', 'codex'), '$fvgsd-plan-phase 1');
  });

  test('every public artifact layout uses fvgsd while agent roles keep gsd', () => {
    const runtimes = [
      'claude', 'cursor', 'gemini', 'codex', 'copilot', 'antigravity',
      'windsurf', 'augment', 'trae', 'qwen', 'hermes', 'codebuddy',
      'cline', 'opencode', 'kilo',
    ];

    for (const runtime of runtimes) {
      const scope = runtime === 'claude' ? 'local' : 'global';
      const layout = resolveRuntimeArtifactLayout(runtime, '/tmp/fvgsd-layout', scope);
      for (const kind of layout.kinds) {
        if (kind.kind === 'agents') {
          assert.equal(kind.prefix, 'fvgsd-');
          continue;
        }
        assert.ok(
          kind.prefix === 'fvgsd-' || kind.destSubpath.endsWith('/fvgsd'),
          `${runtime}/${kind.kind} must use fvgsd: ${JSON.stringify(kind)}`,
        );
      }
    }
  });

  test('legacy command references convert to fvgsd for Gemini, Codex, OpenCode, and Cline', () => {
    assert.equal(convertSlashCommandsToGeminiMentions('Run /gsd-plan-phase 1'), 'Run /fvgsd:plan-phase 1');

    const source = [
      '---',
      'name: gsd:plan-phase',
      'description: Plan',
      '---',
      '',
      'Run /gsd:execute-phase 1.',
    ].join('\n');
    const codex = convertClaudeCommandToCodexSkill(source, 'fvgsd-plan-phase');
    assert.match(codex, /\$fvgsd-execute-phase 1/);
    assert.doesNotMatch(codex, /\$gsd-|\/gsd[:-]/);

    const opencode = convertClaudeToOpencodeFrontmatter(source);
    assert.match(opencode, /\/fvgsd-execute-phase 1/);
    assert.doesNotMatch(opencode, /\/gsd[:-]/);

    const cline = convertClaudeToCliineMarkdown(source);
    assert.match(cline, /\/fvgsd-execute-phase 1/);
    assert.doesNotMatch(cline, /\/gsd[:-]/);
  });

  test('canonical command metadata and references no longer emit the legacy namespace', () => {
    const commandNames = fs.readdirSync(COMMANDS_DIR)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.slice(0, -3));
    const commandAlternation = commandNames
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    const legacyReference = new RegExp(`(?<![A-Za-z0-9_-])gsd[:-](?:${commandAlternation})(?=[^A-Za-z0-9_-]|$)`);

    for (const file of fs.readdirSync(COMMANDS_DIR).filter((name) => name.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
      assert.match(content, /^name: fvgsd[:-]/m, `${file} must declare a fvgsd command name`);
      assert.doesNotMatch(content, legacyReference, `${file} contains a legacy GSD command reference`);
    }
  });

  test('runtime-loaded prompt sources contain no legacy public command references', () => {
    const commandNames = fs.readdirSync(COMMANDS_DIR)
      .filter((file) => file.endsWith('.md'))
      .map((file) => file.slice(0, -3));
    const commandAlternation = commandNames
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    // A following "/" marks a path or repository slug (the upstream gsd-build/get-shit-done), not a command.
    const legacyReference = new RegExp(`(?<![A-Za-z0-9_-])(?:/|\\$)?gsd[:-](?:${commandAlternation})(?=[^A-Za-z0-9_/-]|$)`);
    const roots = [
      COMMANDS_DIR,
      path.join(ROOT, 'agents'),
      path.join(ROOT, 'get-shit-done'),
    ];
    const promptFiles = [];

    function collectMarkdown(current) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) collectMarkdown(target);
        else if (entry.name.endsWith('.md') && entry.name !== 'CHANGELOG.md') promptFiles.push(target);
      }
    }

    for (const root of roots) collectMarkdown(root);
    for (const file of promptFiles) {
      const content = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(
        content,
        legacyReference,
        `${path.relative(ROOT, file)} contains a legacy public GSD command reference`,
      );
    }
  });

  test('reinstall preserves commands/gsd and writes the fvgsd namespace without migrating into it', (t) => {
    const configDir = createTempDir('fvgsd-upgrade-');
    t.after(() => cleanup(configDir));

    const legacyCommands = path.join(configDir, 'commands', 'gsd');
    fs.mkdirSync(legacyCommands, { recursive: true });
    fs.writeFileSync(path.join(legacyCommands, 'help.md'), '# old help\n');
    fs.writeFileSync(path.join(legacyCommands, 'dev-preferences.md'), '# preferences\n');

    installRuntimeArtifacts('gemini', configDir, 'global', PROFILE);

    assert.equal(fs.readFileSync(path.join(legacyCommands, 'help.md'), 'utf8'), '# old help\n');
    assert.equal(fs.readFileSync(path.join(legacyCommands, 'dev-preferences.md'), 'utf8'), '# preferences\n');
    assert.ok(fs.existsSync(path.join(configDir, 'commands', 'fvgsd', 'help.md')));
    assert.equal(fs.existsSync(path.join(configDir, 'commands', 'fvgsd', 'dev-preferences.md')), false);
  });
});
