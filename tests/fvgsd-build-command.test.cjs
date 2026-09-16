// allow-test-rule: source-text-is-the-product
// commands/gsd/build.md and get-shit-done/workflows/build.md are loaded verbatim by the
// runtime: their frontmatter, step list, agent roster and end markers are the deployed contract.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('./helpers.cjs');
const { loadSkillsManifest, PROFILES } = require('../get-shit-done/bin/lib/install-profiles.cjs');
const { CLUSTERS } = require('../get-shit-done/bin/lib/clusters.cjs');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands', 'gsd');
const COMMAND_PATH = path.join(COMMANDS_DIR, 'build.md');
const WORKFLOW_PATH = path.join(ROOT, 'get-shit-done', 'workflows', 'build.md');

const STEP_NAMES = ['parse_args', 'initialize', 'research', 'baseline', 'brief', 'approve', 'waves', 'checks', 'verify', 'fix_rounds', 'summary', 'next'];
const END_MARKERS = ['## BUILD BLOCKED', '## BUILD COMPLETE', '## BUILD GAPS FOUND', '## BUILD STOPPED'];
const AGENTS = ['fvgsd-builder', 'fvgsd-code-reviewer', 'fvgsd-phase-researcher', 'fvgsd-verifier'];

function workflowSteps(content) {
  return [...content.matchAll(/<step name="([^"]+)">([\s\S]*?)<\/step>/g)].map((m) => ({ name: m[1], body: m[2] }));
}

describe('/fvgsd-build command', () => {
  test('frontmatter names the command and its arguments', () => {
    const fm = parseFrontmatter(fs.readFileSync(COMMAND_PATH, 'utf8'));
    assert.equal(fm.name, 'fvgsd:build');
    assert.equal(fm['argument-hint'], '<phase> [--confirm] [--gaps] [--research-only] [--brief-only]');
  });

  test('requires the commands its body routes to', () => {
    const manifest = loadSkillsManifest(COMMANDS_DIR);
    assert.deepEqual([...manifest.get('build')].sort(), ['discuss-phase', 'execute-phase', 'verify-work']);
  });

  test('names every agent the workflow spawns so install profiles stage them', () => {
    const manifest = loadSkillsManifest(COMMANDS_DIR);
    const referenced = manifest.get('_calls_agents_build');
    for (const agent of AGENTS) {
      assert.ok(referenced.includes(agent), `${agent} is not named in commands/gsd/build.md`);
    }
  });

  test('ships in the core and standard profiles and the core loop cluster', () => {
    assert.ok(PROFILES.core.includes('build'));
    assert.ok(PROFILES.standard.includes('build'));
    assert.ok(CLUSTERS.core_loop.includes('build'));
  });
});

describe('build workflow', () => {
  test('keeps its steps in order', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    assert.deepEqual(workflowSteps(content).map((step) => step.name), STEP_NAMES);
  });

  test('stays within 400 lines', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const lines = content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
    assert.ok(lines <= 400, `build.md has ${lines} lines`);
  });

  test('lists exactly the spawned agent types', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const block = content.match(/<available_agent_types>([\s\S]*?)<\/available_agent_types>/);
    assert.ok(block, 'missing <available_agent_types>');
    const listed = [...block[1].matchAll(/^- (fvgsd-[a-z-]+)/gm)].map((m) => m[1]).sort();
    assert.deepEqual(listed, AGENTS);
  });

  test('no runner-visible line is removed by the SDK prompt sanitizer', async () => {
    // The SDK phase runner keeps only <purpose> and the steps, then drops whole lines
    // that hold slash commands or interactive directives (sdk/src/prompt-sanitizer.ts).
    const { sanitizePrompt } = await import('../sdk/dist/prompt-sanitizer.js');
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const purpose = content.match(/<purpose>([\s\S]*?)<\/purpose>/)[1];
    const lines = [purpose, ...workflowSteps(content).map((step) => step.body)]
      .join('\n')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const removed = lines.filter((line) => sanitizePrompt(line).trim() !== line.trim());
    assert.deepEqual(removed, []);
  });

  test('the waves step respawns a slice that returned partial without a question, once', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const waves = workflowSteps(content).find((step) => step.name === 'waves');
    const rule = waves.body.split('\n').find((line) => line.startsWith('- `partial` without a `question` →'));
    assert.ok(
      rule
        && rule.includes('`other_slice_notes: "chore({P}-{id}): partial exists — continue from it"`')
        && rule.includes('A second `partial` makes the slice `blocked`'),
      `missing or incomplete partial-slice rule: ${rule}`,
    );
  });

  test('the next step prints the four end markers', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const next = workflowSteps(content).find((step) => step.name === 'next');
    assert.ok(next, 'missing next step');
    const markers = [...next.body.matchAll(/^## BUILD [A-Z ]+$/gm)].map((m) => m[0]);
    assert.deepEqual([...new Set(markers)].sort(), END_MARKERS);
  });
});
