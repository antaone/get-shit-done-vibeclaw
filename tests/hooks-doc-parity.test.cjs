'use strict';

/**
 * For every `hooks/fvgsd/*.(js|sh)`, assert the hook (as `fvgsd/<file>`) appears as a
 * row in docs/INVENTORY.md's Hooks table. docs/ARCHITECTURE.md's hook
 * table is allowed to lag — INVENTORY.md is authoritative.
 *
 * Related: docs readiness refresh, lane-12 recommendation.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');

const ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(ROOT, 'hooks', IDENTITY.hooksDir);
const INVENTORY_MD = fs.readFileSync(path.join(ROOT, 'docs', 'INVENTORY.md'), 'utf8');

// INVENTORY.md lists shipped hooks as `fvgsd/<file>`.
const hookFiles = fs
  .readdirSync(HOOKS_DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && /\.(js|sh)$/.test(e.name))
  .map((e) => `${IDENTITY.hooksDir}/${e.name}`);

function mentionedInInventoryHooks(filename) {
  // Row form: | `filename.js` | event | purpose |
  const rowRe = new RegExp(`\\|\\s*\\\`${filename.replace(/\./g, '\\.')}\\\`\\s*\\|`, 'm');
  return rowRe.test(INVENTORY_MD);
}

describe('every shipped hook has a row in INVENTORY.md', () => {
  test('hooks/fvgsd ships at least one .js/.sh hook', () => {
    assert.ok(hookFiles.length > 0, `no .js/.sh hook files found under ${HOOKS_DIR}`);
  });

  for (const file of hookFiles) {
    test(file, () => {
      assert.ok(
        mentionedInInventoryHooks(file),
        `hooks/${file} has no row in docs/INVENTORY.md Hooks table — add one`,
      );
    });
  }
});
