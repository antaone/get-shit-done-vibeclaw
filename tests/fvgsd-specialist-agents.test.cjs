// allow-test-rule: source-text-is-the-product
// agents/fvgsd-{deploy-runner,proof-collector,handoff-keeper,spec-digester}.md are
// loaded verbatim by every runtime; their frontmatter, input blocks and result
// headings are the contract the calling session parses.

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
  convertClaudeAgentToCodexAgent,
  CODEX_AGENT_SANDBOX,
} = require('../bin/install.js');
const { catalog, MODEL_PROFILES } = require('../get-shit-done/bin/lib/model-catalog.cjs');

const AGENTS = {
  'fvgsd-deploy-runner': { inputs: 'deploy_inputs', results: ['DEPLOY RESULT', 'DEPLOY REFUSED'], tools: 'Read, Bash, Grep, Glob' },
  'fvgsd-proof-collector': { inputs: 'proof_inputs', results: ['PROOF RESULT', 'PROOF BLOCKED'], tools: 'Read, Write, Bash, Grep, Glob' },
  'fvgsd-handoff-keeper': { inputs: 'handoff_inputs', results: ['HANDOFF STATUS', 'HANDOFF REFUSED'], tools: 'Read, Write, Bash, Grep, Glob' },
  'fvgsd-spec-digester': { inputs: 'digest_inputs', results: ['DIGEST RESULT', 'DIGEST REFUSED'], tools: 'Read, Write, Bash, Grep, Glob' },
};

function read(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'agents', `${name}.md`), 'utf8');
}

for (const [name, spec] of Object.entries(AGENTS)) {
  describe(`${name} agent file`, () => {
    test('frontmatter names the agent and its tools', () => {
      const fm = parseFrontmatter(read(name));
      assert.equal(fm.name, name);
      assert.equal(fm.tools, spec.tools);
      assert.match(fm.description, /\S/);
    });

    test('stays under the 6KB specialist budget', () => {
      const size = Buffer.byteLength(read(name));
      assert.ok(size < 6 * 1024, `${name}.md is ${size} bytes`);
    });

    test('opens with its return contract and names its input block', () => {
      const body = read(name).replace(/^---[\s\S]*?\n---\n/, '').trimStart();
      assert.ok(body.startsWith('<return_contract>'), 'return contract comes first');
      const contract = body.slice(0, body.indexOf('</return_contract>'));
      for (const heading of spec.results) assert.match(contract, new RegExp(`^## ${heading}$`, 'm'), heading);
      assert.match(body, new RegExp(`<${spec.inputs}>`));
    });

    test('reads project facts from the pack instead of guessing', () => {
      assert.match(read(name), /never (guess|invent|pick)/i);
    });

    test('converts for Gemini and Codex, and Codex can write', () => {
      const gemini = parseFrontmatter(convertClaudeToGeminiAgent(stripUnsupportedAgentKeys(read(name), 'gemini')));
      assert.equal(gemini.name, name);
      assert.match(convertClaudeAgentToCodexAgent(read(name)), new RegExp(name));
      assert.equal(CODEX_AGENT_SANDBOX[name], 'workspace-write');
    });

    test('has model tiers for every profile', () => {
      const entry = catalog.agents[name];
      assert.ok(entry, `${name} is in the model catalog`);
      for (const profile of ['golden', 'balanced', 'budget']) assert.match(entry[profile], /^(opus|sonnet|haiku)$/);
      assert.ok(MODEL_PROFILES[name], `${name} has resolved profiles`);
    });
  });
}

describe('specialist agent contracts', () => {
  test('the deploy runner refuses owner-gated targets without a recorded approval', () => {
    const content = read('fvgsd-deploy-runner');
    assert.match(content, /`needs_owner: true` and `owner_approval` is empty/);
    assert.match(content, /You never push/);
  });

  test('the spec digester writes Done when and Open Questions that the build reads', () => {
    const content = read('fvgsd-spec-digester');
    assert.match(content, /### Done when/);
    assert.match(content, /`<open_questions>`/);
    assert.match(content, /fvgsd-sdk query find-phase/);
  });

  test('the handoff keeper never edits STATE.md and checks it through state queries', () => {
    const content = read('fvgsd-handoff-keeper');
    assert.match(content, /never edit STATE\.md yourself/);
    assert.match(content, /fvgsd-sdk query state\.validate/);
  });
});
