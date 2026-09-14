// allow-test-rule: source-text-is-the-product
// agents/fvgsd-builder.md is loaded verbatim by every runtime; its frontmatter
// and result headings are the deployed contract the build workflow parses.

'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('./helpers.cjs');
const {
  stripUnsupportedAgentKeys,
  convertClaudeToGeminiAgent,
  convertClaudeToOpencodeFrontmatter,
  convertClaudeToKiloFrontmatter,
  CODEX_AGENT_SANDBOX,
} = require('../bin/install.js');
const { catalog, MODEL_PROFILES } = require('../get-shit-done/bin/lib/model-catalog.cjs');

const BUILDER_PATH = path.join(__dirname, '..', 'agents', 'fvgsd-builder.md');

function readBuilder() {
  return fs.readFileSync(BUILDER_PATH, 'utf8');
}

function headings(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim());
}

describe('fvgsd-builder agent file', () => {
  test('frontmatter names the builder, its tools and its effort', () => {
    const fm = parseFrontmatter(readBuilder());
    assert.equal(fm.name, 'fvgsd-builder');
    assert.equal(fm.description, 'Writes the build brief for a phase, or builds one slice of it, for /fvgsd-build.');
    assert.equal(fm.tools, 'Read, Write, Edit, Bash, Grep, Glob');
    assert.equal(fm.effort, 'high');
  });

  test('stays within the 10KB builder budget', () => {
    const size = fs.statSync(BUILDER_PATH).size;
    assert.ok(size <= 10 * 1024, `fvgsd-builder.md is ${size} bytes`);
  });

  test('declares both result headings the build workflow parses', () => {
    const found = headings(readBuilder());
    assert.ok(found.includes('BRIEF RESULT'), 'missing ## BRIEF RESULT');
    assert.ok(found.includes('SLICE RESULT'), 'missing ## SLICE RESULT');
  });
});

describe('agent frontmatter keys per runtime', () => {
  test('stripUnsupportedAgentKeys keeps effort only for Claude Code', () => {
    const content = readBuilder();
    assert.equal(parseFrontmatter(stripUnsupportedAgentKeys(content, 'claude')).effort, 'high');
    for (const runtime of ['gemini', 'opencode', 'kilo', 'qwen', 'hermes', 'codex']) {
      const fm = parseFrontmatter(stripUnsupportedAgentKeys(content, runtime));
      assert.equal(Object.hasOwn(fm, 'effort'), false, `${runtime} kept effort`);
      assert.equal(fm.name, 'fvgsd-builder', `${runtime} lost name`);
    }
  });

  test('gemini, opencode and kilo converters emit no effort key', () => {
    const outputs = [
      convertClaudeToGeminiAgent(stripUnsupportedAgentKeys(readBuilder(), 'gemini')),
      convertClaudeToOpencodeFrontmatter(stripUnsupportedAgentKeys(readBuilder(), 'opencode'), { isAgent: true }),
      convertClaudeToKiloFrontmatter(stripUnsupportedAgentKeys(readBuilder(), 'kilo'), { isAgent: true }),
    ];
    for (const output of outputs) {
      assert.equal(Object.hasOwn(parseFrontmatter(output), 'effort'), false);
    }
  });

  test('content without frontmatter is returned unchanged', () => {
    assert.equal(stripUnsupportedAgentKeys('no frontmatter here', 'gemini'), 'no frontmatter here');
  });

  test('Codex runs the builder with workspace-write', () => {
    assert.equal(CODEX_AGENT_SANDBOX['fvgsd-builder'], 'workspace-write');
  });
});

describe('fvgsd-builder model profile', () => {
  test('uses the executor tiers in the execution phase', () => {
    assert.deepEqual(catalog.agents['fvgsd-builder'], {
      golden: 'opus',
      balanced: 'sonnet',
      budget: 'sonnet',
      phaseType: 'execution',
      routingTier: 'standard',
    });
    assert.equal(MODEL_PROFILES['fvgsd-builder'].balanced, 'sonnet');
    assert.equal(MODEL_PROFILES['fvgsd-builder'].adaptive, 'sonnet');
  });
});
