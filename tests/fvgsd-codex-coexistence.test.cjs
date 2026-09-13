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

test('user multiline strings and blank-line runs stay byte-identical through two merges and a strip', (t) => {
  const dir = createTempDir('fvgsd-codex-');
  t.after(() => cleanup(dir));
  const configPath = path.join(dir, 'config.toml');
  const userPart = [
    'model = "gpt-5"',
    '',
    '[profiles.work]',
    'developer_instructions = """',
    'First paragraph.',
    '',
    '',
    'Second paragraph.',
    '"""',
    '',
    '',
    '',
    '[tui]',
    'notifications = true',
    '',
  ].join('\n');
  const instructions = 'First paragraph.\n\n\nSecond paragraph.\n';
  const original = `${userPart}\n${GSD_BLOCK}`;
  fs.writeFileSync(configPath, original);

  mergeCodexConfig(configPath, OWN_BLOCK);
  mergeCodexConfig(configPath, OWN_BLOCK);
  const merged = fs.readFileSync(configPath, 'utf8');
  assert.equal(merged.slice(0, userPart.length), userPart, 'user text is unchanged after two merges');
  assert.equal(parseTomlToObject(merged).profiles.work.developer_instructions, instructions);

  const stripped = stripGsdFromCodexConfig(merged);
  assert.equal(stripped, original, 'strip restores the file');
  assert.equal(parseTomlToObject(stripped).profiles.work.developer_instructions, instructions);
});

test('strip keeps [features] keys in their table and removes only tables its own cleanup empties', () => {
  const ownBlock = `${IDENTITY.codexMarker}\n\n[agents.fvgsd-planner]\ndescription = "x"\nconfig_file = "y"\n`;

  const keysAfterBlankLine = stripGsdFromCodexConfig(`model = "gpt-5"\n\n[features]\n\nweb_search = true\n\n${ownBlock}`);
  assert.deepEqual(parseTomlToObject(keysAfterBlankLine), { model: 'gpt-5', features: { web_search: true } });

  const userEmptyTable = 'model = "gpt-5"\n\n[features]\n\n[tui]\nnotifications = true\n';
  assert.equal(stripGsdFromCodexConfig(`${userEmptyTable}\n${ownBlock}`), userEmptyTable, 'an already-empty table stays');

  const emptiedFeatures = stripGsdFromCodexConfig(`model = "gpt-5"\n\n[features]\nmulti_agent = true\n\n${ownBlock}`);
  assert.deepEqual(parseTomlToObject(emptiedFeatures), { model: 'gpt-5' }, 'a [features] table the cleanup empties is removed');

  const emptiedAgents = stripGsdFromCodexConfig(`model = "gpt-5"\n\n[agents]\n${ownBlock}`);
  assert.deepEqual(parseTomlToObject(emptiedAgents), { model: 'gpt-5' }, 'an [agents] table the cleanup empties is removed');
});

test('strip and a merge + strip round trip leave the GSD region byte-identical at the end of the file', (t) => {
  const dir = createTempDir('fvgsd-codex-');
  t.after(() => cleanup(dir));
  const configPath = path.join(dir, 'config.toml');
  const regions = {
    'GSD region ending with a blank line': `${GSD_BLOCK}\n`,
    'CRLF GSD region under an LF first line': GSD_BLOCK.replace(/\n/g, '\r\n'),
  };
  for (const [label, gsdRegion] of Object.entries(regions)) {
    const original = `model = "gpt-5"\n\n${gsdRegion}`;
    const installed = `model = "gpt-5"\n\n${OWN_BLOCK}\n${gsdRegion}`;
    assert.equal(stripGsdFromCodexConfig(installed, { foreignHooksRemain: true }), original, `${label}: strip`);

    fs.writeFileSync(configPath, original);
    mergeCodexConfig(configPath, OWN_BLOCK);
    const roundTrip = stripGsdFromCodexConfig(fs.readFileSync(configPath, 'utf8'), { foreignHooksRemain: true });
    assert.equal(roundTrip, original, `${label}: merge + strip`);
  }
});
