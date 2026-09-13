// allow-test-rule: integration-test-input
// Reads shipped source files (commands/gsd/*.md, agents/*.md, bin/install.js) as
// real test fixture input for installer/converter functions like
// convertClaudeToCopilotContent() and the install.js plumbing. Those files are
// not inspected for string presence; they are inputs whose *transformation* or
// installation behavior is being asserted. The converter-purity test on
// bin/lib/*.cjs uses a synthetic input string instead (per #3584:
// runtime-slash.cjs eliminated literal /gsd: refs from runtime CJS, so reading
// verify.cjs is no longer a meaningful fixture for testing the converter).

/**
 * GSD Tools Tests - Copilot Install Plumbing
 *
 * Tests for Copilot runtime directory resolution, config paths,
 * and integration with the multi-runtime installer.
 *
 * Requirements: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06
 */

process.env.FVGSD_TEST_MODE = '1';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const os = require('os');
const fs = require('fs');
const { parseFrontmatter, createTempDir, cleanup } = require('./helpers.cjs');

const {
  getDirName,
  getGlobalDir,
  getConfigDirFromHome,
  claudeToCopilotTools,
  convertCopilotToolName,
  convertClaudeToCopilotContent,
  convertClaudeCommandToCopilotSkill,
  convertClaudeAgentToCopilotAgent,
  FVGSD_COPILOT_INSTRUCTIONS_MARKER,
  FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER,
  mergeCopilotInstructions,
  stripGsdFromCopilotInstructions,
  writeManifest,
  reportLocalPatches,
  installRuntimeArtifacts,
} = require('../bin/install.js');

// ─── Profile resolution for installRuntimeArtifacts tests ────────────────────
const _gsdLibDir = path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib');
const { loadSkillsManifest, resolveProfile } = require(path.join(_gsdLibDir, 'install-profiles.cjs'));
const _manifest = loadSkillsManifest();
const resolvedProfileFull = resolveProfile({ modes: [], manifest: _manifest });

// ─── getDirName ─────────────────────────────────────────────────────────────────

describe('getDirName (Copilot)', () => {
  test('returns .github for copilot', () => {
    assert.strictEqual(getDirName('copilot'), '.github');
  });

  test('does not break existing runtimes', () => {
    assert.strictEqual(getDirName('claude'), '.claude');
    assert.strictEqual(getDirName('opencode'), '.opencode');
    assert.strictEqual(getDirName('gemini'), '.gemini');
    assert.strictEqual(getDirName('kilo'), '.kilo');
    assert.strictEqual(getDirName('codex'), '.codex');
  });
});

// ─── getGlobalDir ───────────────────────────────────────────────────────────────

describe('getGlobalDir (Copilot)', () => {
  let originalCopilotConfigDir;

  beforeEach(() => {
    originalCopilotConfigDir = process.env.COPILOT_CONFIG_DIR;
  });

  afterEach(() => {
    if (originalCopilotConfigDir !== undefined) {
      process.env.COPILOT_CONFIG_DIR = originalCopilotConfigDir;
    } else {
      delete process.env.COPILOT_CONFIG_DIR;
    }
  });

  test('returns ~/.copilot with no env var or explicit dir', () => {
    delete process.env.COPILOT_CONFIG_DIR;
    const result = getGlobalDir('copilot');
    assert.strictEqual(result, path.join(os.homedir(), '.copilot'));
  });

  test('returns explicit dir when provided', () => {
    const result = getGlobalDir('copilot', '/custom/path');
    assert.strictEqual(result, '/custom/path');
  });

  test('respects COPILOT_CONFIG_DIR env var', () => {
    process.env.COPILOT_CONFIG_DIR = '~/custom-copilot';
    const result = getGlobalDir('copilot');
    assert.strictEqual(result, path.join(os.homedir(), 'custom-copilot'));
  });

  test('explicit dir takes priority over COPILOT_CONFIG_DIR', () => {
    process.env.COPILOT_CONFIG_DIR = '~/env-path';
    const result = getGlobalDir('copilot', '/explicit/path');
    assert.strictEqual(result, '/explicit/path');
  });

  test('does not break existing runtimes', () => {
    assert.strictEqual(getGlobalDir('claude'), path.join(os.homedir(), '.claude'));
    assert.strictEqual(getGlobalDir('codex'), path.join(os.homedir(), '.codex'));
  });
});

// ─── getConfigDirFromHome ───────────────────────────────────────────────────────

describe('getConfigDirFromHome (Copilot)', () => {
  test('returns .github path string for local (isGlobal=false)', () => {
    assert.strictEqual(getConfigDirFromHome('copilot', false), "'.github'");
  });

  test('returns .copilot path string for global (isGlobal=true)', () => {
    assert.strictEqual(getConfigDirFromHome('copilot', true), "'.copilot'");
  });

  test('does not break existing runtimes', () => {
    assert.strictEqual(getConfigDirFromHome('opencode', true), "'.config', 'opencode'");
    assert.strictEqual(getConfigDirFromHome('claude', true), "'.claude'");
    assert.strictEqual(getConfigDirFromHome('gemini', true), "'.gemini'");
    assert.strictEqual(getConfigDirFromHome('kilo', true), "'.config', 'kilo'");
    assert.strictEqual(getConfigDirFromHome('codex', true), "'.codex'");
  });
});

// ─── Source code integration checks ─────────────────────────────────────────────

describe('Source code integration (Copilot)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'install.js'), 'utf8');

  test('CLI-01: --copilot flag parsing exists', () => {
    assert.ok(src.includes("args.includes('--copilot')"), '--copilot flag parsed');
  });

  test('CLI-03: --all array includes copilot', () => {
    assert.ok(
      src.includes("'copilot'") && src.includes('selectedRuntimes = ['),
      '--all includes copilot runtime'
    );
  });

  test('CLI-06: banner text includes Copilot', () => {
    assert.ok(src.includes('Copilot'), 'banner mentions Copilot');
  });

  test('CLI-06: help text includes --copilot', () => {
    assert.ok(src.includes('--copilot'), 'help text has --copilot option');
  });

  test('CLI-02: promptRuntime runtimeMap has Copilot as option 7', () => {
    assert.ok(src.includes("'7': 'copilot'"), 'runtimeMap has 7 -> copilot');
  });

  test('CLI-02: promptRuntime allRuntimes array includes copilot', () => {
    const allMatch = src.match(/const allRuntimes = \[([^\]]+)\]/);
    assert.ok(allMatch && allMatch[1].includes('copilot'), 'allRuntimes includes copilot');
  });

  test('CLI-02: promptRuntime keeps Kilo above OpenCode in allRuntimes', () => {
    const allMatch = src.match(/const allRuntimes = \[([^\]]+)\]/);
    assert.ok(allMatch, 'allRuntimes array found');
    assert.ok(allMatch[1].indexOf("'kilo'") < allMatch[1].indexOf("'opencode'"), 'kilo appears before opencode');
  });

  test('isCopilot variable exists in install function', () => {
    assert.ok(src.includes("const isCopilot = runtime === 'copilot'"), 'isCopilot defined');
  });

  test('hooks are skipped for Copilot', () => {
    assert.ok(src.includes('!isCodex && !isCopilot'), 'hooks skip check includes copilot');
  });

  test('--both flag unchanged (still claude + opencode only)', () => {
    // Verify the else-if-hasBoth maps to ['claude', 'opencode'] — NOT including copilot
    const bothUsage = src.indexOf('} else if (hasBoth)');
    assert.ok(bothUsage > 0, 'hasBoth usage exists');
    const bothSection = src.substring(bothUsage, bothUsage + 200);
    assert.ok(bothSection.includes("['claude', 'opencode']"), '--both maps to claude+opencode');
    assert.ok(!bothSection.includes('copilot'), '--both does NOT include copilot');
  });
});

// ─── convertCopilotToolName ─────────────────────────────────────────────────────

describe('convertCopilotToolName', () => {
  test('maps Read to read', () => {
    assert.strictEqual(convertCopilotToolName('Read'), 'read');
  });

  test('maps Write to edit', () => {
    assert.strictEqual(convertCopilotToolName('Write'), 'edit');
  });

  test('maps Edit to edit (same as Write)', () => {
    assert.strictEqual(convertCopilotToolName('Edit'), 'edit');
  });

  test('maps Bash to execute', () => {
    assert.strictEqual(convertCopilotToolName('Bash'), 'execute');
  });

  test('maps Grep to search', () => {
    assert.strictEqual(convertCopilotToolName('Grep'), 'search');
  });

  test('maps Glob to search (same as Grep)', () => {
    assert.strictEqual(convertCopilotToolName('Glob'), 'search');
  });

  test('maps Task to agent', () => {
    assert.strictEqual(convertCopilotToolName('Task'), 'agent');
  });

  test('maps WebSearch to web', () => {
    assert.strictEqual(convertCopilotToolName('WebSearch'), 'web');
  });

  test('maps WebFetch to web (same as WebSearch)', () => {
    assert.strictEqual(convertCopilotToolName('WebFetch'), 'web');
  });

  test('maps TodoWrite to todo', () => {
    assert.strictEqual(convertCopilotToolName('TodoWrite'), 'todo');
  });

  test('maps AskUserQuestion to ask_user', () => {
    assert.strictEqual(convertCopilotToolName('AskUserQuestion'), 'ask_user');
  });

  test('maps SlashCommand to skill', () => {
    assert.strictEqual(convertCopilotToolName('SlashCommand'), 'skill');
  });

  test('maps mcp__context7__ prefix to io.github.upstash/context7/', () => {
    assert.strictEqual(
      convertCopilotToolName('mcp__context7__resolve-library-id'),
      'io.github.upstash/context7/resolve-library-id'
    );
  });

  test('maps mcp__context7__* wildcard', () => {
    assert.strictEqual(
      convertCopilotToolName('mcp__context7__*'),
      'io.github.upstash/context7/*'
    );
  });

  test('lowercases unknown tools as fallback', () => {
    assert.strictEqual(convertCopilotToolName('SomeNewTool'), 'somenewtool');
  });

  test('mapping constant has 13 entries (12 direct + mcp handled separately)', () => {
    assert.strictEqual(Object.keys(claudeToCopilotTools).length, 12);
  });
});

// ─── convertClaudeToCopilotContent ──────────────────────────────────────────────

describe('convertClaudeToCopilotContent', () => {
  test('replaces ~/.claude/ with .github/ in local mode (default)', () => {
    assert.strictEqual(
      convertClaudeToCopilotContent('see ~/.claude/foo'),
      'see .github/foo'
    );
  });

  test('replaces ~/.claude/ with ~/.copilot/ in global mode', () => {
    assert.strictEqual(
      convertClaudeToCopilotContent('see ~/.claude/foo', true),
      'see ~/.copilot/foo'
    );
  });

  test('replaces ./.claude/ with ./.github/', () => {
    assert.strictEqual(
      convertClaudeToCopilotContent('at ./.claude/bar'),
      'at ./.github/bar'
    );
  });

  test('replaces bare .claude/ with .github/', () => {
    assert.strictEqual(
      convertClaudeToCopilotContent('in .claude/baz'),
      'in .github/baz'
    );
  });

  test('replaces $HOME/.claude/ with .github/ in local mode (default)', () => {
    assert.strictEqual(
      convertClaudeToCopilotContent('"$HOME/.claude/config"'),
      '".github/config"'
    );
  });

  test('replaces $HOME/.claude/ with $HOME/.copilot/ in global mode', () => {
    assert.strictEqual(
      convertClaudeToCopilotContent('"$HOME/.claude/config"', true),
      '"$HOME/.copilot/config"'
    );
  });

  test('converts gsd: to gsd- in command names', () => {
    assert.strictEqual(
      convertClaudeToCopilotContent('run /fvgsd:health or fvgsd:progress'),
      'run /fvgsd-health or fvgsd-progress'
    );
  });

  test('handles mixed content in local mode', () => {
    const input = 'Config at ~/.claude/settings and $HOME/.claude/config.\n' +
      'Local at ./.claude/data and .claude/commands.\n' +
      'Run fvgsd:health and /fvgsd:progress.';
    const result = convertClaudeToCopilotContent(input);
    assert.ok(result.includes('.github/settings'), 'tilde path converted to local');
    assert.ok(!result.includes('$HOME/.claude/'), '$HOME path converted');
    assert.ok(result.includes('./.github/data'), 'dot-slash path converted');
    assert.ok(result.includes('.github/commands'), 'bare path converted');
    assert.ok(result.includes('fvgsd-health'), 'command name converted');
    assert.ok(result.includes('/fvgsd-progress'), 'slash command converted');
  });

  test('handles mixed content in global mode', () => {
    const input = 'Config at ~/.claude/settings and $HOME/.claude/config.\n' +
      'Local at ./.claude/data and .claude/commands.\n' +
      'Run fvgsd:health and /fvgsd:progress.';
    const result = convertClaudeToCopilotContent(input, true);
    assert.ok(result.includes('~/.copilot/settings'), 'tilde path converted to global');
    assert.ok(result.includes('$HOME/.copilot/config'), '$HOME path converted to global');
    assert.ok(result.includes('./.github/data'), 'dot-slash path converted');
    assert.ok(result.includes('.github/commands'), 'bare path converted');
  });

  test('does not double-replace in local mode', () => {
    const input = '~/.claude/foo and ./.claude/bar and .claude/baz';
    const result = convertClaudeToCopilotContent(input);
    assert.ok(!result.includes('.github/.github/'), 'no .github/.github/ artifact');
    assert.strictEqual(result, '.github/foo and ./.github/bar and .github/baz');
  });

  test('does not double-replace in global mode', () => {
    const input = '~/.claude/foo and ./.claude/bar and .claude/baz';
    const result = convertClaudeToCopilotContent(input, true);
    assert.ok(!result.includes('.copilot/.github/'), 'no .copilot/.github/ artifact');
    assert.strictEqual(result, '~/.copilot/foo and ./.github/bar and .github/baz');
  });

  test('preserves content with no matches', () => {
    assert.strictEqual(
      convertClaudeToCopilotContent('hello world'),
      'hello world'
    );
  });
});

// ─── convertClaudeCommandToCopilotSkill ─────────────────────────────────────────

describe('convertClaudeCommandToCopilotSkill', () => {
  test('converts frontmatter with all fields', () => {
    const input = `---
name: fvgsd:health
description: Diagnose planning directory health
argument-hint: [--repair]
allowed-tools:
  - Read
  - Bash
  - Write
  - AskUserQuestion
---

Body content here referencing ~/.claude/foo and fvgsd:health.`;

    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-health');
    const fm = parseFrontmatter(result);
    assert.equal(fm.name, 'fvgsd-health', 'name uses param');
    assert.equal(fm.description, 'Diagnose planning directory health', 'description preserved (quoted per #2876)');
    assert.equal(fm['argument-hint'], '[--repair]', 'argument-hint round-trips');
    assert.ok(result.includes('allowed-tools: Read, Bash, Write, AskUserQuestion'), 'tools comma-separated');
    assert.ok(result.includes('.github/foo'), 'CONV-06 applied to body (local mode default)');
    assert.ok(result.includes('fvgsd-health'), 'CONV-07 applied to body');
    assert.ok(!result.includes('fvgsd:health'), 'no gsd: references remain');
  });

  test('handles skill without allowed-tools', () => {
    const input = `---
name: fvgsd:help
description: Show available GSD commands
---

Help content.`;

    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-help');
    const fm = parseFrontmatter(result);
    assert.equal(fm.name, 'fvgsd-help', 'name set');
    assert.equal(fm.description, 'Show available GSD commands', 'description preserved');
    assert.ok(!('allowed-tools' in fm), 'no allowed-tools line');
  });

  test('handles skill without argument-hint', () => {
    const input = `---
name: fvgsd:progress
description: Show project progress
allowed-tools:
  - Read
  - Bash
---

Progress body.`;

    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-progress');
    assert.ok(!result.includes('argument-hint:'), 'no argument-hint line');
    assert.ok(result.includes('allowed-tools: Read, Bash'), 'tools present');
  });

  test('argument-hint with inner single quotes uses double-quote YAML delimiter', () => {
    const input = `---
name: fvgsd:new-milestone
description: Start milestone
argument-hint: "[milestone name, e.g., 'v1.1 Notifications']"
allowed-tools:
  - Read
---

Body.`;

    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-new-milestone');
    assert.ok(result.includes(`argument-hint: "[milestone name, e.g., 'v1.1 Notifications']"`), 'inner single quotes preserved with double-quote delimiter');
  });

  test('applies CONV-06 path conversion to body (local mode)', () => {
    const input = `---
name: gsd:test
description: Test skill
---

Check ~/.claude/settings and ./.claude/local and $HOME/.claude/global.`;

    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-test');
    assert.ok(result.includes('.github/settings'), 'tilde path converted to local');
    assert.ok(result.includes('./.github/local'), 'dot-slash path converted');
    assert.ok(result.includes('.github/global'), '$HOME path converted to local');
  });

  test('applies CONV-06 path conversion to body (global mode)', () => {
    const input = `---
name: gsd:test
description: Test skill
---

Check ~/.claude/settings and ./.claude/local and $HOME/.claude/global.`;

    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-test', true);
    assert.ok(result.includes('~/.copilot/settings'), 'tilde path converted to global');
    assert.ok(result.includes('./.github/local'), 'dot-slash path converted');
    assert.ok(result.includes('$HOME/.copilot/global'), '$HOME path converted to global');
  });

  test('applies CONV-07 command name conversion to body', () => {
    const input = `---
name: gsd:test
description: Test skill
---

Run fvgsd:health and /fvgsd:progress for diagnostics.`;

    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-test');
    assert.ok(result.includes('fvgsd-health'), 'fvgsd:health converted');
    assert.ok(result.includes('/fvgsd-progress'), '/fvgsd:progress converted');
    assert.ok(!result.match(/gsd:[a-z]/), 'no gsd: command refs remain');
  });

  test('handles content without frontmatter (local mode)', () => {
    const input = 'Just some markdown with ~/.claude/path and fvgsd:health.';
    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-test');
    assert.ok(result.includes('.github/path'), 'CONV-06 applied (local)');
    assert.ok(result.includes('fvgsd-health'), 'CONV-07 applied');
    assert.ok(!result.includes('---'), 'no frontmatter added');
  });

  test('preserves agent field in frontmatter', () => {
    const input = `---
name: fvgsd:execute-phase
description: Execute a phase
agent: fvgsd-planner
allowed-tools:
  - Read
  - Bash
---

Body.`;

    const result = convertClaudeCommandToCopilotSkill(input, 'fvgsd-execute-phase');
    assert.ok(result.includes('agent: fvgsd-planner'), 'agent field preserved');
  });
});

// ─── convertClaudeAgentToCopilotAgent ───────────────────────────────────────────

describe('convertClaudeAgentToCopilotAgent', () => {
  test('maps and deduplicates tools', () => {
    const input = `---
name: fvgsd-executor
description: Executes GSD plans
tools: Read, Write, Edit, Bash, Grep, Glob
color: yellow
---

Agent body.`;

    const result = convertClaudeAgentToCopilotAgent(input);
    assert.ok(result.includes("tools: ['read', 'edit', 'execute', 'search']"), 'tools mapped and deduped');
  });

  test('formats tools as JSON array', () => {
    const input = `---
name: gsd-test
description: Test agent
tools: Read, Bash
---

Body.`;

    const result = convertClaudeAgentToCopilotAgent(input);
    assert.ok(result.match(/tools: \['[a-z_]+'(, '[a-z_]+')*\]/), 'tools formatted as JSON array');
  });

  test('preserves name description and color', () => {
    const input = `---
name: fvgsd-executor
description: Executes GSD plans with atomic commits
tools: Read, Bash
color: yellow
---

Body.`;

    const result = convertClaudeAgentToCopilotAgent(input);
    const fm = parseFrontmatter(result);
    assert.equal(fm.name, 'fvgsd-executor', 'name preserved');
    assert.equal(fm.description, 'Executes GSD plans with atomic commits', 'description preserved');
    assert.equal(fm.color, 'yellow', 'color preserved');
  });

  test('handles mcp__context7__ tools', () => {
    const input = `---
name: gsd-researcher
description: Research agent
tools: Read, Bash, mcp__context7__resolve-library-id
color: cyan
---

Body.`;

    const result = convertClaudeAgentToCopilotAgent(input);
    assert.ok(result.includes('io.github.upstash/context7/resolve-library-id'), 'mcp tool mapped');
    assert.ok(!result.includes('mcp__context7__'), 'no mcp__ prefix remains');
  });

  test('handles agent with no tools field', () => {
    const input = `---
name: gsd-empty
description: Empty agent
color: green
---

Body.`;

    const result = convertClaudeAgentToCopilotAgent(input);
    assert.ok(result.includes('tools: []'), 'missing tools produces []');
  });

  test('applies CONV-06 and CONV-07 to body (local mode)', () => {
    const input = `---
name: gsd-test
description: Test
tools: Read
---

Check ~/.claude/settings and run fvgsd:health.`;

    const result = convertClaudeAgentToCopilotAgent(input);
    assert.ok(result.includes('.github/settings'), 'CONV-06 applied (local)');
    assert.ok(result.includes('fvgsd-health'), 'CONV-07 applied');
    assert.ok(!result.includes('~/.claude/'), 'no ~/.claude/ remains');
    assert.ok(!result.match(/gsd:[a-z]/), 'no gsd: command refs remain');
  });

  test('applies CONV-06 and CONV-07 to body (global mode)', () => {
    const input = `---
name: gsd-test
description: Test
tools: Read
---

Check ~/.claude/settings and run fvgsd:health.`;

    const result = convertClaudeAgentToCopilotAgent(input, true);
    assert.ok(result.includes('~/.copilot/settings'), 'CONV-06 applied (global)');
    assert.ok(result.includes('fvgsd-health'), 'CONV-07 applied');
  });

  test('handles content without frontmatter (local mode)', () => {
    const input = 'Just markdown with ~/.claude/path and fvgsd:health.';
    const result = convertClaudeAgentToCopilotAgent(input);
    assert.ok(result.includes('.github/path'), 'CONV-06 applied (local)');
    assert.ok(result.includes('fvgsd-health'), 'CONV-07 applied');
    assert.ok(!result.includes('---'), 'no frontmatter added');
  });
});

// ─── installRuntimeArtifacts (copilot integration) ─────────────────────────────

describe('installRuntimeArtifacts (copilot integration)', () => {
  // Pivoted from copyCommandsAsCopilotSkills(srcDir, tempDir, 'gsd') shim to
  // installRuntimeArtifacts('copilot', configDir, 'global', resolvedProfileFull).
  // Output layout: <configDir>/skills/gsd-<stem>/SKILL.md (destSubpath='skills', prefix='fvgsd-').
  const srcDir = path.join(__dirname, '..', 'commands', 'gsd');
  let configDir;

  beforeEach(() => {
    configDir = createTempDir('fvgsd-copilot-skills-');
  });

  afterEach(() => {
    cleanup(configDir);
  });

  test('creates skill folders from source commands', () => {
    installRuntimeArtifacts('copilot', configDir, 'global', resolvedProfileFull);

    const skillsDir = path.join(configDir, 'skills');
    // Check specific folders exist
    assert.ok(fs.existsSync(path.join(skillsDir, 'fvgsd-health')), 'fvgsd-health folder exists');
    assert.ok(fs.existsSync(path.join(skillsDir, 'fvgsd-health', 'SKILL.md')), 'fvgsd-health/SKILL.md exists');
    assert.ok(fs.existsSync(path.join(skillsDir, 'fvgsd-help')), 'fvgsd-help folder exists');
    assert.ok(fs.existsSync(path.join(skillsDir, 'fvgsd-progress')), 'fvgsd-progress folder exists');

    // Count fvgsd-* directories — should match number of source command files
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('fvgsd-'));
    const expectedSkillCount = fs.readdirSync(srcDir)
      .filter(f => f.endsWith('.md')).length;
    assert.strictEqual(dirs.length, expectedSkillCount, `expected ${expectedSkillCount} skill folders, got ${dirs.length}`);
  });

  test('skill content has Copilot frontmatter format', () => {
    installRuntimeArtifacts('copilot', configDir, 'global', resolvedProfileFull);

    const skillsDir = path.join(configDir, 'skills');
    const skillContent = fs.readFileSync(path.join(skillsDir, 'fvgsd-health', 'SKILL.md'), 'utf8');
    // Frontmatter format checks
    assert.ok(skillContent.startsWith('---\nname: fvgsd-health\n'), 'starts with name: fvgsd-health');
    assert.ok(skillContent.includes('allowed-tools: Read, Bash, Write, AskUserQuestion'),
      'allowed-tools is comma-separated');
    assert.ok(!skillContent.includes('allowed-tools:\n  -'), 'NOT YAML multiline format');
    // CONV-06/07 applied
    assert.ok(!skillContent.includes('~/.claude/'), 'no ~/.claude/ references');
    assert.ok(!skillContent.match(/gsd:[a-z]/), 'no gsd: command references');
  });

  test('generates fvgsd-autonomous skill from autonomous.md command', () => {
    // Fail-fast: source command must exist
    const srcFile = path.join(srcDir, 'autonomous.md');
    assert.ok(fs.existsSync(srcFile), 'commands/gsd/autonomous.md must exist as source');

    installRuntimeArtifacts('copilot', configDir, 'global', resolvedProfileFull);

    const skillsDir = path.join(configDir, 'skills');
    // Skill folder and file created
    assert.ok(fs.existsSync(path.join(skillsDir, 'fvgsd-autonomous')), 'fvgsd-autonomous folder exists');
    assert.ok(fs.existsSync(path.join(skillsDir, 'fvgsd-autonomous', 'SKILL.md')), 'fvgsd-autonomous/SKILL.md exists');

    const skillContent = fs.readFileSync(path.join(skillsDir, 'fvgsd-autonomous', 'SKILL.md'), 'utf8');
    const fm = parseFrontmatter(skillContent);

    // Frontmatter: name converted from fvgsd:autonomous to fvgsd-autonomous
    assert.equal(fm.name, 'fvgsd-autonomous', 'name is fvgsd-autonomous');
    assert.equal(
      fm.description,
      'Run all remaining phases autonomously — discuss→plan→execute per phase',
      'description preserved (round-trips through #2876 yamlQuote)',
    );
    // argument-hint round-trips
    assert.equal(fm['argument-hint'], '[--from N] [--to N] [--only N] [--interactive]', 'argument-hint round-trips');
    // allowed-tools comma-separated
    assert.ok(skillContent.includes('allowed-tools: Read, Write, Bash, Glob, Grep, AskUserQuestion, Agent'),
      'allowed-tools is comma-separated');
    // No Claude-format remnants
    assert.ok(!skillContent.includes('allowed-tools:\n  -'), 'NOT YAML multiline format');
    assert.ok(!skillContent.includes('~/.claude/'), 'no ~/.claude/ references in body');
  });

  test('autonomous skill body converts gsd: to gsd- (CONV-07)', () => {
    // Use convertClaudeToCopilotContent directly on the command body content
    const srcContent = fs.readFileSync(path.join(srcDir, 'autonomous.md'), 'utf8');
    const result = convertClaudeToCopilotContent(srcContent);

    // fvgsd:autonomous references should be converted to fvgsd-autonomous
    assert.ok(!result.match(/gsd:[a-z]/), 'no gsd: command references remain after conversion');
    // Specific: fvgsd:discuss-phase, fvgsd:plan-phase, fvgsd:execute-phase mentioned in body
    // The body references fvgsd-tools.cjs (not a gsd: command) — those should be unaffected
    // But /fvgsd:autonomous → /fvgsd-autonomous, fvgsd:discuss-phase → fvgsd-discuss-phase etc.
    if (srcContent.includes('fvgsd:autonomous')) {
      assert.ok(result.includes('fvgsd-autonomous'), 'fvgsd:autonomous converted to fvgsd-autonomous');
    }
    // Path conversion: ~/.claude/ → .github/
    assert.ok(!result.includes('~/.claude/'), 'no ~/.claude/ paths remain');
  });

  test('cleans up old skill directories on re-run', () => {
    const skillsDir = path.join(configDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    // Stale GSD-managed dir must be pruned
    const staleDir = path.join(skillsDir, 'fvgsd-old-stale-skill');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'SKILL.md'), 'stale content');

    // Non-GSD dir should survive (installRuntimeArtifacts never prunes non-gsd-*)
    fs.mkdirSync(path.join(skillsDir, 'user-custom'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'user-custom', 'SKILL.md'), 'user content');

    installRuntimeArtifacts('copilot', configDir, 'global', resolvedProfileFull);

    // Real skills are present after install
    assert.ok(fs.existsSync(path.join(skillsDir, 'fvgsd-health')), 'real dirs still exist');
    // Stale GSD-prefixed dir is removed by pre-prune
    assert.ok(!fs.existsSync(staleDir), 'stale fvgsd-* dir removed by pre-prune');
    // Non-GSD dir is preserved
    assert.ok(fs.existsSync(path.join(skillsDir, 'user-custom')), 'non-GSD dir preserved');
  });
});

// ─── Copilot agent conversion - real files ──────────────────────────────────────

describe('Copilot agent conversion - real files', () => {
  const agentsSrc = path.join(__dirname, '..', 'agents');

  test('converts fvgsd-executor agent correctly', () => {
    const content = fs.readFileSync(path.join(agentsSrc, 'fvgsd-executor.md'), 'utf8');
    const result = convertClaudeAgentToCopilotAgent(content);

    assert.ok(result.startsWith('---\nname: fvgsd-executor\n'), 'starts with correct name');
    // Verify deduplication happened and core tools are present (not hardcoded exact list)
    const toolsLine = result.split('\n').find(l => l.startsWith('tools:'));
    assert.ok(toolsLine, 'tools line present in converted output');
    assert.ok(toolsLine.includes("'read'"), 'Read mapped to read');
    assert.ok(toolsLine.includes("'edit'"), 'Write/Edit deduplicated to edit');
    assert.ok(toolsLine.includes("'execute'"), 'Bash mapped to execute');
    assert.ok(toolsLine.includes("'search'"), 'Grep/Glob deduplicated to search');
    // Input tools count > output tools count (deduplication occurred)
    const inputTools = content.match(/^tools:\s*\[([^\]]+)\]/m)?.[1].split(',').length ?? 0;
    const outputTools = toolsLine.replace(/^tools:\s*\[/, '').replace(/\].*$/, '').split(',').length;
    assert.ok(inputTools === 0 || outputTools <= inputTools, 'deduplication reduced or preserved tool count');
    assert.ok(result.includes('color: yellow'), 'color preserved');
    assert.ok(!result.includes('~/.claude/'), 'no ~/.claude/ in body');
  });

  test('converts agent with mcp wildcard tools correctly', () => {
    const content = fs.readFileSync(path.join(agentsSrc, 'fvgsd-phase-researcher.md'), 'utf8');
    const result = convertClaudeAgentToCopilotAgent(content);

    const toolsLine = result.split('\n').find(l => l.startsWith('tools:'));
    assert.ok(toolsLine.includes('io.github.upstash/context7/*'), 'mcp wildcard mapped in tools');
    assert.ok(!toolsLine.includes('mcp__context7__'), 'no mcp__ prefix in tools line');
    assert.ok(toolsLine.includes("'web'"), 'WebSearch/WebFetch deduplicated to web');
    assert.ok(toolsLine.includes("'read'"), 'Read mapped');
  });

  test('all 18 agents convert without error', () => {
    const agents = fs.readdirSync(agentsSrc)
      .filter(f => f.startsWith('fvgsd-') && f.endsWith('.md'));
    const expectedAgentCount = fs.readdirSync(agentsSrc)
      .filter(f => f.startsWith('fvgsd-') && f.endsWith('.md')).length;
    assert.strictEqual(agents.length, expectedAgentCount, `expected ${expectedAgentCount} agents, got ${agents.length}`);

    for (const agentFile of agents) {
      const content = fs.readFileSync(path.join(agentsSrc, agentFile), 'utf8');
      const result = convertClaudeAgentToCopilotAgent(content);
      assert.ok(result.startsWith('---\n'), `${agentFile} should have frontmatter`);
      assert.ok(result.includes('tools:'), `${agentFile} should have tools field`);
      assert.ok(!result.includes('~/.claude/'), `${agentFile} should not contain ~/.claude/`);
    }
  });
});

// ─── Copilot content conversion - engine files ─────────────────────────────────

describe('Copilot content conversion - engine files', () => {
  test('converts engine .md files correctly (local mode default)', () => {
    const healthMd = fs.readFileSync(
      path.join(__dirname, '..', 'get-shit-done', 'workflows', 'health.md'), 'utf8'
    );
    const result = convertClaudeToCopilotContent(healthMd);

    assert.ok(!result.includes('~/.claude/'), 'no ~/.claude/ references remain');
    assert.ok(!result.includes('$HOME/.claude/'), 'no $HOME/.claude/ references remain');
    assert.ok(!result.match(/\/gsd:[a-z]/), 'no /gsd: command references remain');
    assert.ok(!result.match(/(?<!\/)gsd:[a-z]/), 'no bare gsd: command references remain');
    // Local mode: ~ and $HOME resolve to .github (repo-relative, no ./ prefix)
    assert.ok(result.includes('.github/'), 'paths converted to .github for local');
    assert.ok(result.includes('fvgsd-health'), 'command name converted');
  });

  test('converts engine .md files correctly (global mode)', () => {
    const healthMd = fs.readFileSync(
      path.join(__dirname, '..', 'get-shit-done', 'workflows', 'health.md'), 'utf8'
    );
    const result = convertClaudeToCopilotContent(healthMd, true);

    assert.ok(!result.includes('~/.claude/'), 'no ~/.claude/ references remain');
    assert.ok(!result.includes('$HOME/.claude/'), 'no $HOME/.claude/ references remain');
    // Global mode: ~ and $HOME resolve to .copilot
    if (healthMd.includes('$HOME/.claude/')) {
      assert.ok(result.includes('$HOME/.copilot/'), '$HOME path converted to .copilot');
    }
    assert.ok(result.includes('fvgsd-health'), 'command name converted');
  });

  test('converts engine .cjs files correctly', () => {
    // #3584: bin/lib/*.cjs no longer hardcodes `/gsd:<cmd>` literals — runtime
    // emissions now flow through `runtime-slash.cjs::formatGsdSlash()` which
    // already produces the runtime-routable shape. The Copilot install
    // converter still needs to handle source files that DO contain literal
    // colon-form references (commands/gsd/*.md, workflow .md files, etc.), so
    // assert the converter contract against a synthetic input that mirrors the
    // shape those files have.
    const synthetic = [
      'Run /fvgsd:new-project to initialize.',
      'On error, run /fvgsd:health --repair to regenerate.',
      'For phase work, use /fvgsd:execute-phase 1.',
    ].join('\n');
    const result = convertClaudeToCopilotContent(synthetic);

    assert.ok(!result.match(/gsd:[a-z]/), 'no gsd: references remain after conversion');
    assert.ok(result.includes('fvgsd-new-project'), 'fvgsd:new-project converted to hyphen form');
    assert.ok(result.includes('fvgsd-health'), 'fvgsd:health converted to hyphen form');
    assert.ok(result.includes('fvgsd-execute-phase'), 'fvgsd:execute-phase converted to hyphen form');
  });
});

// ─── Copilot instructions merge/strip ──────────────────────────────────────────

describe('Copilot instructions merge/strip', () => {
  let tmpDir;

  const gsdContent = '- Follow project conventions\n- Use structured workflows';

  function makeGsdBlock(content) {
    return FVGSD_COPILOT_INSTRUCTIONS_MARKER + '\n' + content.trim() + '\n' + FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER;
  }

  describe('mergeCopilotInstructions', () => {
    let tmpMergeDir;

    beforeEach(() => {
      tmpMergeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-merge-'));
    });

    afterEach(() => {
      fs.rmSync(tmpMergeDir, { recursive: true, force: true });
    });

    test('creates file from scratch when none exists', () => {
      const filePath = path.join(tmpMergeDir, 'copilot-instructions.md');
      mergeCopilotInstructions(filePath, gsdContent);

      assert.ok(fs.existsSync(filePath), 'file was created');
      const result = fs.readFileSync(filePath, 'utf8');
      assert.ok(result.includes(FVGSD_COPILOT_INSTRUCTIONS_MARKER), 'has opening marker');
      assert.ok(result.includes(FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER), 'has closing marker');
      assert.ok(result.includes('Follow project conventions'), 'has GSD content');
    });

    test('replaces GSD section when both markers present', () => {
      const filePath = path.join(tmpMergeDir, 'copilot-instructions.md');
      const oldContent = '# User Setup\n\n' +
        makeGsdBlock('- Old GSD content') +
        '\n\n# User Notes\n';
      fs.writeFileSync(filePath, oldContent);

      mergeCopilotInstructions(filePath, gsdContent);
      const result = fs.readFileSync(filePath, 'utf8');

      assert.ok(result.includes('# User Setup'), 'user content before preserved');
      assert.ok(result.includes('# User Notes'), 'user content after preserved');
      assert.ok(!result.includes('Old GSD content'), 'old GSD content removed');
      assert.ok(result.includes('Follow project conventions'), 'new GSD content inserted');
    });

    test('appends to existing file when no markers present', () => {
      const filePath = path.join(tmpMergeDir, 'copilot-instructions.md');
      const userContent = '# My Custom Instructions\n\nDo things my way.\n';
      fs.writeFileSync(filePath, userContent);

      mergeCopilotInstructions(filePath, gsdContent);
      const result = fs.readFileSync(filePath, 'utf8');

      assert.ok(result.includes('# My Custom Instructions'), 'original content preserved');
      assert.ok(result.includes('Do things my way.'), 'original text preserved');
      assert.ok(result.includes(FVGSD_COPILOT_INSTRUCTIONS_MARKER), 'GSD block appended');
      assert.ok(result.includes('Follow project conventions'), 'GSD content appended');
      // Verify separator exists
      assert.ok(result.includes('Do things my way.\n\n' + FVGSD_COPILOT_INSTRUCTIONS_MARKER),
        'double newline separator before GSD block');
    });

    test('handles file that is GSD-only (re-creates cleanly)', () => {
      const filePath = path.join(tmpMergeDir, 'copilot-instructions.md');
      const gsdOnly = makeGsdBlock('- Old instructions') + '\n';
      fs.writeFileSync(filePath, gsdOnly);

      const newContent = '- Updated instructions';
      mergeCopilotInstructions(filePath, newContent);
      const result = fs.readFileSync(filePath, 'utf8');

      assert.ok(!result.includes('Old instructions'), 'old content removed');
      assert.ok(result.includes('Updated instructions'), 'new content present');
      assert.ok(result.includes(FVGSD_COPILOT_INSTRUCTIONS_MARKER), 'has opening marker');
      assert.ok(result.includes(FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER), 'has closing marker');
    });

    test('preserves user content before and after markers', () => {
      const filePath = path.join(tmpMergeDir, 'copilot-instructions.md');
      const content = '# My Setup\n\n' +
        makeGsdBlock('- old content') +
        '\n\n# My Notes\n';
      fs.writeFileSync(filePath, content);

      mergeCopilotInstructions(filePath, gsdContent);
      const result = fs.readFileSync(filePath, 'utf8');

      assert.ok(result.includes('# My Setup'), 'content before markers preserved');
      assert.ok(result.includes('# My Notes'), 'content after markers preserved');
      assert.ok(result.includes('Follow project conventions'), 'new GSD content between markers');
      // Verify ordering: before → GSD → after
      const setupIdx = result.indexOf('# My Setup');
      const markerIdx = result.indexOf(FVGSD_COPILOT_INSTRUCTIONS_MARKER);
      const notesIdx = result.indexOf('# My Notes');
      assert.ok(setupIdx < markerIdx, 'user setup comes before GSD block');
      assert.ok(markerIdx < notesIdx, 'GSD block comes before user notes');
    });
  });

  describe('stripGsdFromCopilotInstructions', () => {
    test('returns null when content is GSD-only', () => {
      const content = makeGsdBlock('- GSD instructions only') + '\n';
      const result = stripGsdFromCopilotInstructions(content);
      assert.strictEqual(result, null, 'returns null for GSD-only content');
    });

    test('returns cleaned content when user content exists before markers', () => {
      const content = '# My Setup\n\nCustom rules here.\n\n' +
        makeGsdBlock('- GSD stuff') + '\n';
      const result = stripGsdFromCopilotInstructions(content);

      assert.ok(result !== null, 'does not return null');
      assert.ok(result.includes('# My Setup'), 'user content preserved');
      assert.ok(result.includes('Custom rules here.'), 'user text preserved');
      assert.ok(!result.includes(FVGSD_COPILOT_INSTRUCTIONS_MARKER), 'opening marker removed');
      assert.ok(!result.includes(FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER), 'closing marker removed');
      assert.ok(!result.includes('GSD stuff'), 'GSD content removed');
    });

    test('returns cleaned content when user content exists after markers', () => {
      const content = makeGsdBlock('- GSD stuff') + '\n\n# My Notes\n\nPersonal notes.\n';
      const result = stripGsdFromCopilotInstructions(content);

      assert.ok(result !== null, 'does not return null');
      assert.ok(result.includes('# My Notes'), 'user content after preserved');
      assert.ok(result.includes('Personal notes.'), 'user text after preserved');
      assert.ok(!result.includes(FVGSD_COPILOT_INSTRUCTIONS_MARKER), 'opening marker removed');
      assert.ok(!result.includes('GSD stuff'), 'GSD content removed');
    });

    test('returns cleaned content preserving both before and after', () => {
      const content = '# Before\n\n' + makeGsdBlock('- GSD middle') + '\n\n# After\n';
      const result = stripGsdFromCopilotInstructions(content);

      assert.ok(result !== null, 'does not return null');
      assert.ok(result.includes('# Before'), 'content before preserved');
      assert.ok(result.includes('# After'), 'content after preserved');
      assert.ok(!result.includes('GSD middle'), 'GSD content removed');
      assert.ok(!result.includes(FVGSD_COPILOT_INSTRUCTIONS_MARKER), 'markers removed');
    });

    test('returns original content when no markers found', () => {
      const content = '# Just user content\n\nNo GSD markers here.\n';
      const result = stripGsdFromCopilotInstructions(content);
      assert.strictEqual(result, content, 'returns content unchanged');
    });
  });

  describe('upstream GSD instructions block in the same file', () => {
    const upstreamBlock = [
      '<!-- GSD Configuration — managed by get-shit-done installer -->',
      '- Upstream workflow rules',
      '- Upstream conventions',
      '<!-- /GSD Configuration -->',
    ].join('\n');
    const original = `# My Setup\n\nCustom rules here.\n\n${upstreamBlock}\n`;
    let tmpUpstreamDir;

    beforeEach(() => {
      tmpUpstreamDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-copilot-upstream-'));
    });

    afterEach(() => {
      fs.rmSync(tmpUpstreamDir, { recursive: true, force: true });
    });

    test('merging twice leaves upstream block and user text byte-identical and writes one fvgsd block', () => {
      const filePath = path.join(tmpUpstreamDir, 'copilot-instructions.md');
      fs.writeFileSync(filePath, original);

      mergeCopilotInstructions(filePath, gsdContent);
      mergeCopilotInstructions(filePath, gsdContent);
      const result = fs.readFileSync(filePath, 'utf8');

      const kept = original.trimEnd();
      assert.strictEqual(result.slice(0, kept.length), kept, 'user text and upstream block unchanged');
      assert.strictEqual(result.split(FVGSD_COPILOT_INSTRUCTIONS_MARKER).length - 1, 1, 'one fvgsd open marker');
      assert.strictEqual(result.split(FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER).length - 1, 1, 'one fvgsd close marker');
    });

    test('strip removes only the fvgsd block and leaves upstream block and user text byte-identical', () => {
      const fvgsdLast = `${original.trimEnd()}\n\n${makeGsdBlock(gsdContent)}\n`;
      assert.strictEqual(stripGsdFromCopilotInstructions(fvgsdLast), original, 'fvgsd block after upstream block');

      const fvgsdFirst = `${makeGsdBlock(gsdContent)}\n\n${upstreamBlock}\n`;
      assert.strictEqual(stripGsdFromCopilotInstructions(fvgsdFirst), `${upstreamBlock}\n`, 'fvgsd block before upstream block');
    });
  });
});

// ─── Copilot uninstall skill removal ───────────────────────────────────────────

describe('Copilot uninstall skill removal', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-uninstall-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('identifies fvgsd-* skill directories for removal', () => {
    // Create Copilot-like skills directory structure
    const skillsDir = path.join(tmpDir, 'skills');
    fs.mkdirSync(path.join(skillsDir, 'fvgsd-foo'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'fvgsd-foo', 'SKILL.md'), '# Foo');
    fs.mkdirSync(path.join(skillsDir, 'fvgsd-bar'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'fvgsd-bar', 'SKILL.md'), '# Bar');
    fs.mkdirSync(path.join(skillsDir, 'custom-skill'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'custom-skill', 'SKILL.md'), '# Custom');

    // Test the pattern: read skills, filter fvgsd-* entries
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const gsdSkills = entries
      .filter(e => e.isDirectory() && e.name.startsWith('fvgsd-'))
      .map(e => e.name);
    const nonGsdSkills = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('fvgsd-'))
      .map(e => e.name);

    assert.deepStrictEqual(gsdSkills.sort(), ['fvgsd-bar', 'fvgsd-foo'], 'identifies fvgsd-* skills');
    assert.deepStrictEqual(nonGsdSkills, ['custom-skill'], 'preserves non-gsd skills');
  });

  test('cleans GSD section from copilot-instructions.md on uninstall', () => {
    const content = '# My Setup\n\nMy custom rules.\n\n' +
      FVGSD_COPILOT_INSTRUCTIONS_MARKER + '\n' +
      '- GSD managed content\n' +
      FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER + '\n';

    const result = stripGsdFromCopilotInstructions(content);

    assert.ok(result !== null, 'does not return null when user content exists');
    assert.ok(result.includes('# My Setup'), 'user content preserved');
    assert.ok(result.includes('My custom rules.'), 'user text preserved');
    assert.ok(!result.includes('GSD managed content'), 'GSD content removed');
    assert.ok(!result.includes(FVGSD_COPILOT_INSTRUCTIONS_MARKER), 'markers removed');
  });

  test('deletes copilot-instructions.md when GSD-only on uninstall', () => {
    const content = FVGSD_COPILOT_INSTRUCTIONS_MARKER + '\n' +
      '- Only GSD content\n' +
      FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER + '\n';

    const result = stripGsdFromCopilotInstructions(content);

    assert.strictEqual(result, null, 'returns null signaling file deletion');
  });
});

// ─── Copilot manifest and patches fixes ────────────────────────────────────────

describe('Copilot manifest and patches fixes', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writeManifest hashes skills for Copilot runtime', () => {
    // Create minimal get-shit-done dir (required by writeManifest)
    const gsdDir = path.join(tmpDir, IDENTITY.installDir, 'bin');
    fs.mkdirSync(gsdDir, { recursive: true });
    fs.writeFileSync(path.join(gsdDir, 'verify.cjs'), '// verify stub');

    // Create Copilot skills directory
    const skillDir = path.join(tmpDir, 'skills', 'fvgsd-test');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill\n\nA test skill.');

    const manifest = writeManifest(tmpDir, 'copilot');

    // Check manifest file was written
    const manifestPath = path.join(tmpDir, 'fvgsd-file-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest file created');

    // Read and verify skills are hashed
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const skillKey = 'skills/fvgsd-test/SKILL.md';
    assert.ok(data.files[skillKey], 'skill file hashed in manifest');
    assert.ok(typeof data.files[skillKey] === 'string', 'hash is a string');
    assert.ok(data.files[skillKey].length === 64, 'hash is SHA-256 (64 hex chars)');
  });

  describe('reportLocalPatches', () => {
    let originalLog;
    let logs;

    beforeEach(() => {
      originalLog = console.log;
      logs = [];
      console.log = (...args) => logs.push(args.join(' '));
    });

    afterEach(() => {
      console.log = originalLog;
    });

    test('reportLocalPatches shows /fvgsd-update --reapply for Copilot', () => {
      // Create patches directory with metadata
      const patchesDir = path.join(tmpDir, 'fvgsd-local-patches');
      fs.mkdirSync(patchesDir, { recursive: true });
      fs.writeFileSync(path.join(patchesDir, 'backup-meta.json'), JSON.stringify({
        from_version: '1.0',
        files: ['skills/gsd-test/SKILL.md']
      }));

      const result = reportLocalPatches(tmpDir, 'copilot');

      assert.ok(result.length > 0, 'returns patched files list');
      const output = logs.join('\n');
      // Asserts the consolidated form. /gsd-reapply-patches was removed in
      // 1.39 (PR #2824) and folded into a flag on /fvgsd-update — see #3010.
      // Negative assertion guards against regression to the dead command.
      assert.ok(output.includes('/fvgsd-update --reapply'), 'uses consolidated /fvgsd-update --reapply form for Copilot');
      assert.ok(!output.includes('/gsd-reapply-patches'), 'does not reference removed /gsd-reapply-patches command');
      assert.ok(!output.includes('/gsd:reapply-patches'), 'does not use colon format');
    });

    test('reportLocalPatches shows /fvgsd-update --reapply for Claude', () => {
      // Create patches directory with metadata
      const patchesDir = path.join(tmpDir, 'fvgsd-local-patches');
      fs.mkdirSync(patchesDir, { recursive: true });
      fs.writeFileSync(path.join(patchesDir, 'backup-meta.json'), JSON.stringify({
        from_version: '1.0',
        files: ['get-shit-done/bin/verify.cjs']
      }));

      const result = reportLocalPatches(tmpDir, 'claude');

      assert.ok(result.length > 0, 'returns patched files list');
      const output = logs.join('\n');
      assert.ok(output.includes('/fvgsd-update --reapply'), 'uses consolidated /fvgsd-update --reapply form for Claude');
      assert.ok(!output.includes('/gsd-reapply-patches'), 'does not reference removed /gsd-reapply-patches command');
      assert.ok(!output.includes('/gsd:reapply-patches'), 'does not use colon format for Claude');
    });
  });
});

// ============================================================================
// E2E Integration Tests — Copilot Install & Uninstall
// ============================================================================

const { execFileSync } = require('child_process');
const crypto = require('crypto');

const INSTALL_PATH = path.join(__dirname, '..', 'bin', 'install.js');
const EXPECTED_SKILLS = fs.readdirSync(path.join(__dirname, '..', 'commands', 'gsd'))
  .filter(f => f.endsWith('.md')).length;
const EXPECTED_AGENTS = fs.readdirSync(path.join(__dirname, '..', 'agents'))
  .filter(f => f.startsWith('fvgsd-') && f.endsWith('.md')).length;

function runCopilotInstall(cwd) {
  const env = { ...process.env };
  delete env.FVGSD_TEST_MODE;
  return execFileSync(process.execPath, [INSTALL_PATH, '--copilot', '--local', '--no-sdk'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
}

function runCopilotUninstall(cwd) {
  const env = { ...process.env };
  delete env.FVGSD_TEST_MODE;
  return execFileSync(process.execPath, [INSTALL_PATH, '--copilot', '--local', '--uninstall', '--no-sdk'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
}

describe('E2E: Copilot full install verification', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-e2e-'));
    runCopilotInstall(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('installs expected number of skill directories', () => {
    const skillsDir = path.join(tmpDir, '.github', 'skills');
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const gsdSkills = entries.filter(e => e.isDirectory() && e.name.startsWith('fvgsd-'));
    assert.strictEqual(gsdSkills.length, EXPECTED_SKILLS,
      `Expected ${EXPECTED_SKILLS} skill directories, got ${gsdSkills.length}`);
  });

  test('each skill directory contains SKILL.md', () => {
    const skillsDir = path.join(tmpDir, '.github', 'skills');
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const gsdSkills = entries.filter(e => e.isDirectory() && e.name.startsWith('fvgsd-'));
    for (const skill of gsdSkills) {
      const skillMdPath = path.join(skillsDir, skill.name, 'SKILL.md');
      assert.ok(fs.existsSync(skillMdPath),
        `Missing SKILL.md in ${skill.name}`);
    }
  });

  test('installs expected number of agent files', () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    const files = fs.readdirSync(agentsDir);
    const gsdAgents = files.filter(f => f.startsWith('fvgsd-') && f.endsWith('.agent.md'));
    assert.strictEqual(gsdAgents.length, EXPECTED_AGENTS,
      `Expected ${EXPECTED_AGENTS} agent files, got ${gsdAgents.length}`);
  });

  test('installs all expected agent files', () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    const files = fs.readdirSync(agentsDir);
    const gsdAgents = files.filter(f => f.startsWith('fvgsd-') && f.endsWith('.agent.md')).sort();
    const expected = [
      'fvgsd-advisor-researcher.agent.md',
      'fvgsd-ai-researcher.agent.md',
      'fvgsd-assumptions-analyzer.agent.md',
      'fvgsd-code-fixer.agent.md',
      'fvgsd-code-reviewer.agent.md',
      'fvgsd-codebase-mapper.agent.md',
      'fvgsd-debug-session-manager.agent.md',
      'fvgsd-debugger.agent.md',
      'fvgsd-doc-classifier.agent.md',
      'fvgsd-doc-synthesizer.agent.md',
      'fvgsd-doc-verifier.agent.md',
      'fvgsd-doc-writer.agent.md',
      'fvgsd-domain-researcher.agent.md',
      'fvgsd-eval-auditor.agent.md',
      'fvgsd-eval-planner.agent.md',
      'fvgsd-executor.agent.md',
      'fvgsd-framework-selector.agent.md',
      'fvgsd-integration-checker.agent.md',
      'fvgsd-intel-updater.agent.md',
      'fvgsd-nyquist-auditor.agent.md',
      'fvgsd-pattern-mapper.agent.md',
      'fvgsd-phase-researcher.agent.md',
      'fvgsd-plan-checker.agent.md',
      'fvgsd-planner.agent.md',
      'fvgsd-project-researcher.agent.md',
      'fvgsd-research-synthesizer.agent.md',
      'fvgsd-roadmapper.agent.md',
      'fvgsd-security-auditor.agent.md',
      'fvgsd-ui-auditor.agent.md',
      'fvgsd-ui-checker.agent.md',
      'fvgsd-ui-researcher.agent.md',
      'fvgsd-user-profiler.agent.md',
      'fvgsd-verifier.agent.md',
    ].sort();
    assert.deepStrictEqual(gsdAgents, expected);
  });

  test('generates copilot-instructions.md with GSD markers', () => {
    const instrPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    assert.ok(fs.existsSync(instrPath), 'copilot-instructions.md should exist');
    const content = fs.readFileSync(instrPath, 'utf-8');
    assert.ok(content.includes(FVGSD_COPILOT_INSTRUCTIONS_MARKER),
      'Should contain the fvgsd open marker');
    assert.ok(content.includes(FVGSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER),
      'Should contain the fvgsd close marker');
  });

  test('creates manifest with correct structure', () => {
    const manifestPath = path.join(tmpDir, '.github', 'fvgsd-file-manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'fvgsd-file-manifest.json should exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.ok(manifest.version, 'manifest should have version');
    assert.ok(manifest.timestamp, 'manifest should have timestamp');
    assert.ok(manifest.files && typeof manifest.files === 'object',
      'manifest should have files object');
    assert.ok(Object.keys(manifest.files).length > 0,
      'manifest files should not be empty');
  });

  test('manifest contains expected file categories', () => {
    const manifestPath = path.join(tmpDir, '.github', 'fvgsd-file-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const keys = Object.keys(manifest.files);

    const skillEntries = keys.filter(k => k.startsWith('skills/'));
    const agentEntries = keys.filter(k => k.startsWith('agents/'));
    const engineEntries = keys.filter(k => k.startsWith(`${IDENTITY.installDir}/`));

    assert.strictEqual(skillEntries.length, EXPECTED_SKILLS,
      `Expected ${EXPECTED_SKILLS} skill manifest entries, got ${skillEntries.length}`);
    assert.strictEqual(agentEntries.length, EXPECTED_AGENTS,
      `Expected ${EXPECTED_AGENTS} agent manifest entries, got ${agentEntries.length}`);
    assert.ok(engineEntries.length > 0,
      'Should have get-shit-done/ engine manifest entries');
  });

  test('manifest SHA256 hashes match actual file contents', () => {
    const manifestPath = path.join(tmpDir, '.github', 'fvgsd-file-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const githubDir = path.join(tmpDir, '.github');

    for (const [relPath, expectedHash] of Object.entries(manifest.files)) {
      const filePath = path.join(githubDir, relPath);
      assert.ok(fs.existsSync(filePath),
        `Manifest references ${relPath} but file does not exist`);
      const content = fs.readFileSync(filePath);
      const actualHash = crypto.createHash('sha256').update(content).digest('hex');
      assert.strictEqual(actualHash, expectedHash,
        `SHA256 mismatch for ${relPath}: expected ${expectedHash}, got ${actualHash}`);
    }
  });

  test('engine directory contains required subdirectories and files', () => {
    const engineDir = path.join(tmpDir, '.github', IDENTITY.installDir);
    const requiredDirs = ['bin', 'references', 'templates', 'workflows'];
    const requiredFiles = ['CHANGELOG.md', 'VERSION'];

    for (const dir of requiredDirs) {
      const dirPath = path.join(engineDir, dir);
      assert.ok(fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory(),
        `Engine should contain directory: ${dir}`);
    }
    for (const file of requiredFiles) {
      const filePath = path.join(engineDir, file);
      assert.ok(fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
        `Engine should contain file: ${file}`);
    }
  });
});

describe('E2E: Copilot uninstall verification', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-e2e-'));
    runCopilotInstall(tmpDir);
    runCopilotUninstall(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('removes engine directory', () => {
    const engineDir = path.join(tmpDir, '.github', IDENTITY.installDir);
    assert.ok(!fs.existsSync(engineDir),
      'get-shit-done directory should not exist after uninstall');
  });

  test('removes copilot-instructions.md', () => {
    const instrPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    assert.ok(!fs.existsSync(instrPath),
      'copilot-instructions.md should not exist after uninstall');
  });

  test('removes all GSD skill directories', () => {
    const skillsDir = path.join(tmpDir, '.github', 'skills');
    if (fs.existsSync(skillsDir)) {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      const gsdSkills = entries.filter(e => e.isDirectory() && e.name.startsWith('fvgsd-'));
      assert.strictEqual(gsdSkills.length, 0,
        `Expected 0 GSD skill directories after uninstall, found: ${gsdSkills.map(e => e.name).join(', ')}`);
    }
  });

  test('removes all GSD agent files', () => {
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    if (fs.existsSync(agentsDir)) {
      const files = fs.readdirSync(agentsDir);
      const gsdAgents = files.filter(f => f.startsWith('fvgsd-') && f.endsWith('.agent.md'));
      assert.strictEqual(gsdAgents.length, 0,
        `Expected 0 GSD agent files after uninstall, found: ${gsdAgents.join(', ')}`);
    }
  });

  describe('preserves non-GSD content', () => {
    let td;

    beforeEach(() => {
      td = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-e2e-preserve-'));
      runCopilotInstall(td);
    });

    afterEach(() => {
      fs.rmSync(td, { recursive: true, force: true });
    });

    test('preserves non-GSD content in skills directory', () => {
      // Add non-GSD custom skill
      const customSkillDir = path.join(td, '.github', 'skills', 'my-custom-skill');
      fs.mkdirSync(customSkillDir, { recursive: true });
      fs.writeFileSync(path.join(customSkillDir, 'SKILL.md'), '# My Custom Skill\n');
      // Uninstall
      runCopilotUninstall(td);
      // Verify custom content preserved
      assert.ok(fs.existsSync(path.join(customSkillDir, 'SKILL.md')),
        'Non-GSD skill directory and SKILL.md should be preserved after uninstall');
    });

    test('preserves non-GSD content in agents directory', () => {
      // Add non-GSD custom agent
      const customAgentPath = path.join(td, '.github', 'agents', 'my-agent.md');
      fs.writeFileSync(customAgentPath, '# My Custom Agent\n');
      // Uninstall
      runCopilotUninstall(td);
      // Verify custom content preserved
      assert.ok(fs.existsSync(customAgentPath),
        'Non-GSD agent file should be preserved after uninstall');
    });
  });
});

// ─── Claude uninstall: user file preservation (#1423) ─────────────────────────

function runClaudeInstall(cwd) {
  const env = { ...process.env };
  delete env.FVGSD_TEST_MODE;
  return execFileSync(process.execPath, [INSTALL_PATH, '--claude', '--local', '--no-sdk'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
}

function runClaudeUninstall(cwd) {
  const env = { ...process.env };
  delete env.FVGSD_TEST_MODE;
  return execFileSync(process.execPath, [INSTALL_PATH, '--claude', '--local', '--uninstall', '--no-sdk'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });
}

describe('Claude uninstall preserves user-generated files (#1423)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fvgsd-preserve-'));
    runClaudeInstall(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('preserves USER-PROFILE.md across uninstall', () => {
    const profilePath = path.join(tmpDir, '.claude', IDENTITY.installDir, 'USER-PROFILE.md');
    const content = '# Developer Profile\n\nAutonomy: High\nGenerated: 2026-03-29\n';
    fs.writeFileSync(profilePath, content);

    runClaudeUninstall(tmpDir);

    assert.ok(fs.existsSync(profilePath), 'USER-PROFILE.md should survive uninstall');
    assert.strictEqual(fs.readFileSync(profilePath, 'utf-8'), content, 'content should be identical');
  });

  test('preserves dev-preferences.md across uninstall', () => {
    // commands/fvgsd/ is this install's command folder; commands/gsd/ belongs to an upstream GSD install.
    const content = '---\nname: dev-preferences\n---\n# Preferences\nUse TypeScript strict.\n';
    const prefsPaths = [IDENTITY.commandPrefix, 'gsd'].map((namespace) =>
      path.join(tmpDir, '.claude', 'commands', namespace, 'dev-preferences.md'));
    for (const prefsPath of prefsPaths) {
      fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
      fs.writeFileSync(prefsPath, content);
    }

    runClaudeUninstall(tmpDir);

    for (const prefsPath of prefsPaths) {
      assert.ok(fs.existsSync(prefsPath), `${path.relative(tmpDir, prefsPath)} should survive uninstall`);
      assert.strictEqual(fs.readFileSync(prefsPath, 'utf-8'), content, 'content should be identical');
    }
  });

  test('still removes GSD engine files during uninstall', () => {
    const profilePath = path.join(tmpDir, '.claude', IDENTITY.installDir, 'USER-PROFILE.md');
    fs.writeFileSync(profilePath, '# Profile\n');

    // Verify engine files exist before uninstall
    const binDir = path.join(tmpDir, '.claude', IDENTITY.installDir, 'bin');
    assert.ok(fs.existsSync(binDir), 'bin/ should exist before uninstall');

    runClaudeUninstall(tmpDir);

    // Engine files gone, user file preserved
    assert.ok(!fs.existsSync(binDir), 'bin/ should be removed after uninstall');
    assert.ok(fs.existsSync(profilePath), 'USER-PROFILE.md should survive');
  });

  test('clean uninstall when no user files exist', () => {
    runClaudeUninstall(tmpDir);

    const gsdDir = path.join(tmpDir, '.claude', IDENTITY.installDir);
    const cmdDir = path.join(tmpDir, '.claude', 'commands', IDENTITY.commandPrefix);
    // Directories should be fully removed when no user files to preserve
    assert.ok(!fs.existsSync(gsdDir), 'get-shit-done/ should not exist after clean uninstall');
    assert.ok(!fs.existsSync(cmdDir), `commands/${IDENTITY.commandPrefix}/ should not exist after clean uninstall`);
  });
});
