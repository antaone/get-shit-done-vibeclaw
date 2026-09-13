'use strict';

/**
 * Reverse-direction parity: every row declared in docs/INVENTORY.md must
 * resolve to a real file on the filesystem. Complements the forward tests
 * (actual ⊆ INVENTORY) with the reverse direction (INVENTORY ⊆ actual),
 * catching ghost entries left behind when artifacts are deleted or renamed.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');

const ROOT = path.resolve(__dirname, '..');
const INVENTORY = fs.readFileSync(path.join(ROOT, 'docs', 'INVENTORY.md'), 'utf8');

/** Extract the text of a named top-level section (## Header ... next ##). */
function section(header) {
  const start = INVENTORY.indexOf('## ' + header);
  if (start === -1) return '';
  const next = INVENTORY.indexOf('\n## ', start + 1);
  return next === -1 ? INVENTORY.slice(start) : INVENTORY.slice(start, next);
}

/** Extract backtick-quoted filenames from column-1 table cells. */
function backtickNames(text, ext) {
  const re = new RegExp('\\|\\s*`([^`]+\\.' + ext + ')`\\s*\\|', 'gm');
  const names = [];
  let m;
  while ((m = re.exec(text)) !== null) names.push(m[1]);
  return names;
}

/** Extract agent names from `| fvgsd-xxx | ...` rows (no backticks). */
function agentNames(text) {
  const re = new RegExp(`^\\|\\s*(${IDENTITY.agentPrefix}[a-z0-9-]+)\\s*\\|`, 'gm');
  const names = [];
  let m;
  while ((m = re.exec(text)) !== null) names.push(m[1]);
  return names;
}

/** Extract relative source paths from markdown links in Commands section. */
function commandSourcePaths(text) {
  const re = /\[commands\/gsd\/[^\]]+\]\(\.\.\/(commands\/gsd\/[^)]+)\)/g;
  const paths = [];
  let m;
  while ((m = re.exec(text)) !== null) paths.push(m[1]);
  return paths;
}

describe('INVENTORY.md declared artifacts exist on the filesystem (ghost-entry guard)', () => {
  describe('Agents', () => {
    const names = agentNames(section('Agents'));
    test('parses at least one Agents row', () => {
      assert.ok(names.length > 0, 'no agent rows parsed from the INVENTORY.md Agents section');
    });
    for (const name of names) {
      test(name, () => {
        const p = path.join(ROOT, 'agents', name + '.md');
        assert.ok(
          fs.existsSync(p),
          'INVENTORY.md declares agent "' + name + '" but agents/' + name + '.md does not exist — remove the ghost row or restore the file',
        );
      });
    }
  });

  describe('Commands', () => {
    const paths = commandSourcePaths(section('Commands'));
    test('parses at least one Commands source path', () => {
      assert.ok(paths.length > 0, 'no command source paths parsed from the INVENTORY.md Commands section');
    });
    for (const rel of paths) {
      test(rel, () => {
        const p = path.join(ROOT, rel);
        assert.ok(
          fs.existsSync(p),
          'INVENTORY.md declares source "' + rel + '" but the file does not exist — remove the ghost row or restore the file',
        );
      });
    }
  });

  describe('Workflows', () => {
    const names = backtickNames(section('Workflows'), 'md');
    test('parses at least one Workflows row', () => {
      assert.ok(names.length > 0, 'no workflow rows parsed from the INVENTORY.md Workflows section');
    });
    for (const name of names) {
      test(name, () => {
        const p = path.join(ROOT, 'get-shit-done', 'workflows', name);
        assert.ok(
          fs.existsSync(p),
          'INVENTORY.md declares workflow "' + name + '" but get-shit-done/workflows/' + name + ' does not exist — remove the ghost row or restore the file',
        );
      });
    }
  });

  describe('References', () => {
    const names = backtickNames(section('References'), 'md');
    test('parses at least one References row', () => {
      assert.ok(names.length > 0, 'no reference rows parsed from the INVENTORY.md References section');
    });
    for (const name of names) {
      test(name, () => {
        const p = path.join(ROOT, 'get-shit-done', 'references', name);
        assert.ok(
          fs.existsSync(p),
          'INVENTORY.md declares reference "' + name + '" but get-shit-done/references/' + name + ' does not exist — remove the ghost row or restore the file',
        );
      });
    }
  });

  describe('CLI Modules', () => {
    const names = backtickNames(section('CLI Modules'), 'cjs');
    test('parses at least one CLI Modules row', () => {
      assert.ok(names.length > 0, 'no CLI module rows parsed from the INVENTORY.md CLI Modules section');
    });
    for (const name of names) {
      test(name, () => {
        const p = path.join(ROOT, 'get-shit-done', 'bin', 'lib', name);
        assert.ok(
          fs.existsSync(p),
          'INVENTORY.md declares CLI module "' + name + '" but get-shit-done/bin/lib/' + name + ' does not exist — remove the ghost row or restore the file',
        );
      });
    }
  });

  describe('Hooks', () => {
    const jsNames = backtickNames(section('Hooks'), 'js');
    const shNames = backtickNames(section('Hooks'), 'sh');
    test('parses at least one Hooks row', () => {
      assert.ok(jsNames.length + shNames.length > 0, 'no hook rows parsed from the INVENTORY.md Hooks section');
    });
    for (const name of [...jsNames, ...shNames]) {
      test(name, () => {
        const p = path.join(ROOT, 'hooks', name);
        assert.ok(
          fs.existsSync(p),
          'INVENTORY.md declares hook "' + name + '" but hooks/' + name + ' does not exist — remove the ghost row or restore the file',
        );
      });
    }
  });
});
