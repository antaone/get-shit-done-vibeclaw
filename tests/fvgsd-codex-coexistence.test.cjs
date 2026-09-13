'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const { mergeCodexConfig, stripGsdFromCodexConfig, codexConfigLayout, parseTomlToObject } = require('../bin/install.js');

const GSD_BLOCK = [
  '# GSD Agent Configuration — managed by get-shit-done installer',
  '',
  '[agents.gsd-planner]',
  'description = "GSD planner"',
  'config_file = "agents/gsd-planner.toml"',
  '',
].join('\n');
const GSD_AGENT = { description: 'GSD planner', config_file: 'agents/gsd-planner.toml' };
const OWN_BLOCK = `${IDENTITY.codexMarker}\n\n[agents.fvgsd-planner]\ndescription = "fvgsd planner"\nconfig_file = "agents/fvgsd-planner.toml"\n`;

test('fvgsd block is written above the GSD marker and replaced in place', (t) => {
  const dir = createTempDir('fvgsd-codex-');
  t.after(() => cleanup(dir));
  const configPath = path.join(dir, 'config.toml');
  fs.writeFileSync(configPath, `model = "gpt-5"\n\n${GSD_BLOCK}`);
  mergeCodexConfig(configPath, OWN_BLOCK);
  mergeCodexConfig(configPath, OWN_BLOCK);
  const content = fs.readFileSync(configPath, 'utf8');
  const layout = codexConfigLayout(content);
  assert.deepEqual(layout.markers.map((m) => m.owner), ['fvgsd', 'gsd']);
  assert.deepEqual(layout.agentSections.map((s) => s.name), ['fvgsd-planner', 'gsd-planner']);
  const parsed = parseTomlToObject(content);
  assert.equal(parsed.model, 'gpt-5');
  assert.deepEqual(parsed.agents['gsd-planner'], GSD_AGENT);
});

test('reinstall leaves the GSD marker and everything below it byte-identical', (t) => {
  const dir = createTempDir('fvgsd-codex-');
  t.after(() => cleanup(dir));
  const configPath = path.join(dir, 'config.toml');
  // Two blank lines and CRLF lines below the marker: neither may be normalized.
  const gsdRegion = `${GSD_BLOCK}\n\n[agents.gsd-verifier]\r\ndescription = "GSD verifier"\r\nconfig_file = "agents/gsd-verifier.toml"\r\n`;
  fs.writeFileSync(configPath, `model = "gpt-5"\n\n${gsdRegion}`);
  mergeCodexConfig(configPath, OWN_BLOCK);
  mergeCodexConfig(configPath, OWN_BLOCK);
  const content = fs.readFileSync(configPath, 'utf8');
  assert.equal(content.slice(-gsdRegion.length), gsdRegion);
  assert.deepEqual(codexConfigLayout(content).agentSections.map((s) => s.name), ['fvgsd-planner', 'gsd-planner', 'gsd-verifier']);
});

test('uninstall keeps codex_hooks and GSD sections while GSD is installed', () => {
  const content = `[features]\ncodex_hooks = true\n\n${IDENTITY.codexMarker}\n${IDENTITY.codexHooksOwnershipPrefix}section\n\n` +
    `[agents.fvgsd-planner]\ndescription = "x"\nconfig_file = "y"\n\n${GSD_BLOCK}`;
  const cleaned = stripGsdFromCodexConfig(content, { foreignHooksRemain: true });
  const parsed = parseTomlToObject(cleaned);
  assert.equal(parsed.features.codex_hooks, true);
  assert.equal(parsed.agents['fvgsd-planner'], undefined);
  assert.deepEqual(parsed.agents['gsd-planner'], GSD_AGENT);
  assert.deepEqual(codexConfigLayout(cleaned).markers.map((m) => m.owner), ['gsd']);
});

test('uninstall removes the codex_hooks flag fvgsd owns when nothing else needs it', () => {
  const content = `[features]\ncodex_hooks = true\n\n${IDENTITY.codexMarker}\n${IDENTITY.codexHooksOwnershipPrefix}section\n\n` +
    '[agents.fvgsd-planner]\ndescription = "x"\nconfig_file = "y"\n';
  assert.equal(stripGsdFromCodexConfig(content, { foreignHooksRemain: false }), null);
});
