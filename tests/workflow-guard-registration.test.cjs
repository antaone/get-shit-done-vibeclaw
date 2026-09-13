// allow-test-rule: pending-migration-to-typed-ir [#2974]
// Tracked in #2974 for migration to typed-IR assertions per CONTRIBUTING.md
// "Prohibited: Raw Text Matching on Test Outputs". Per-file review may
// reclassify some entries as source-text-is-the-product during migration.

/**
 * Regression guard for #1767: fvgsd/workflow-guard.js must be registered in settings.json
 *
 * The hook file is built, copied, and installed — but was never registered as a
 * PreToolUse hook entry in install.js. This test ensures the registration block
 * exists with the correct structure.
 *
 * Also tests the broader anti-pattern: every managed JS hook the installer ships
 * (the settings.json hooks among the files it writes under hooks/fvgsd/) should
 * have a corresponding registration block.
 */
process.env.FVGSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { listOwnHookFiles } = require('../bin/install.js');
const { isManagedHookBasename } = require('../get-shit-done/bin/lib/shell-command-projection.cjs');

const INSTALL_JS = path.join(__dirname, '..', 'bin', 'install.js');
const BUILT_HOOKS_DIR = path.join(__dirname, '..', 'hooks', 'dist', 'fvgsd');
const BUILD_HOOKS_SCRIPT = path.join(__dirname, '..', 'scripts', 'build-hooks.js');

describe('workflow-guard hook registration (#1767)', () => {
  test('install.js constructs a command path variable for fvgsd/workflow-guard.js', () => {
    const content = fs.readFileSync(INSTALL_JS, 'utf-8');
    const lines = content.split('\n');
    // Every registered JS hook has a command variable constructed via
    // buildHookCommand() or string concatenation. Filter out references
    // that are only in the cleanup/uninstall arrays.
    const commandConstructionLines = lines.filter(line =>
      line.includes('fvgsd/workflow-guard.js') &&
      (line.includes('buildHookCommand') || line.includes("'node '"))
    );
    assert.ok(
      commandConstructionLines.length > 0,
      [
        'install.js must construct a command path for fvgsd/workflow-guard.js',
        '(e.g. buildHookCommand or node + dirName pattern).',
        'Currently only referenced in gsdHooks cleanup array.',
      ].join(' ')
    );
  });

  test('install.js has a hasWorkflowGuardHook dedup check', () => {
    const content = fs.readFileSync(INSTALL_JS, 'utf-8');
    // Every registered hook has a dedup check: hasXxxHook = settings.hooks[...].some(...)
    const hasDedup = content.includes('hasWorkflowGuardHook') ||
      content.includes('hasWorkflowGuard');
    assert.ok(
      hasDedup,
      'install.js must have a dedup check variable for workflow-guard (like hasPromptGuardHook)'
    );
  });

  test('install.js pushes workflow-guard entry with correct matcher', () => {
    const content = fs.readFileSync(INSTALL_JS, 'utf-8');
    // Extract the section between "workflow-guard" command construction
    // and the next console.log confirmation. The push block should have:
    // matcher: 'Write|Edit' and command referencing workflow-guard
    const workflowGuardSection = content.match(
      /workflowGuardCommand[\s\S]*?console\.log\([^)]*workflow.guard/i
    );
    assert.ok(
      workflowGuardSection,
      'install.js must have a push block for workflow-guard with a console.log confirmation'
    );
  });
});

describe('hook registration completeness anti-pattern guard', () => {
  test('every managed JS hook the installer ships has a command construction in install.js', () => {
    if (!fs.existsSync(BUILT_HOOKS_DIR)) {
      execFileSync(process.execPath, [BUILD_HOOKS_SCRIPT], { stdio: 'pipe' });
    }
    const content = fs.readFileSync(INSTALL_JS, 'utf-8');
    // JS hooks among the files install writes under hooks/fvgsd/ that settings.json registers
    const jsHooks = listOwnHookFiles().filter((hook) =>
      hook.endsWith('.js') && isManagedHookBasename(hook, { surface: 'settings-json' }));
    assert.ok(jsHooks.length > 0, 'the installer must ship managed JS hooks');

    const missing = [];
    for (const hook of jsHooks) {
      // Each JS hook should have a buildHookCommand or 'node ' command construction
      // that references the hook filename (not just the uninstall filter)
      const lines = content.split('\n').filter(line =>
        line.includes(hook) &&
        (line.includes('buildHookCommand') || line.includes("'node '"))
      );
      if (lines.length === 0) {
        missing.push(hook);
      }
    }

    assert.strictEqual(
      missing.length, 0,
      [
        'Every managed JS hook the installer ships must have a command construction in install.js.',
        'Missing registration for:',
        ...missing.map(h => `  - ${h}`),
      ].join('\n')
    );
  });
});
