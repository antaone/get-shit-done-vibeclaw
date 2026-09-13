/**
 * Regression test for bug #2334
 *
 * /gsd-quick crashed with `command not found: fvgsd-sdk` (exit code 127) when
 * the fvgsd-sdk binary was not installed or not in PATH. The workflow's Step 2
 * called `fvgsd-sdk query init.quick` directly with no pre-flight check and no
 * fallback, so missing fvgsd-sdk caused an immediate abort with no helpful message.
 *
 * Fix: Step 2 must check for fvgsd-sdk in PATH before invoking it. If absent,
 * emit a human-readable error pointing users to the install command.
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, '..', 'get-shit-done', 'workflows', 'quick.md');

// allow-test-rule: source-text-is-the-product
// quick.md is the AI instruction workflow — the `command -v fvgsd-sdk` guard IS the fix.
// There is no behavioral equivalent: the check runs inside the AI agent, not in fvgsd-tools.

describe('bug #2334: quick workflow fvgsd-sdk pre-flight check', () => {
  let content;

  test('workflow file exists', () => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), 'workflows/quick.md should exist');
    content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  });

  test('Step 2 checks for fvgsd-sdk before invoking it', () => {
    content = content || fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    // The check must appear before the first fvgsd-sdk invocation in Step 2
    const step2Start = content.indexOf('**Step 2:');
    assert.ok(step2Start !== -1, 'Step 2 must exist in quick workflow');

    const firstSdkCall = content.indexOf('fvgsd-sdk query init.quick', step2Start);
    assert.ok(firstSdkCall !== -1, 'fvgsd-sdk query init.quick must be present in Step 2');

    // Find any fvgsd-sdk availability check between the Step 2 heading and the first call
    const step2Section = content.slice(step2Start, firstSdkCall);
    const hasCommandCheck = step2Section.includes('command -v fvgsd-sdk') || step2Section.includes('which fvgsd-sdk');
    assert.ok(
      hasCommandCheck,
      'Step 2 must check for fvgsd-sdk in PATH (via `command -v fvgsd-sdk` or `which fvgsd-sdk`) ' +
      'before calling `fvgsd-sdk query init.quick`. Without this guard, the workflow crashes ' +
      'with exit code 127 when fvgsd-sdk is not installed (root cause of #2334).'
    );
  });

  test('pre-flight error message references the install command', () => {
    content = content || fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    const step2Start = content.indexOf('**Step 2:');
    const firstSdkCall = content.indexOf('fvgsd-sdk query init.quick', step2Start);
    const step2Section = content.slice(step2Start, firstSdkCall);

    // fvgsd is not published to npm (R51): the hint must run the installer
    // from a clone, or point at the update command — not `npm install -g`.
    const hasInstallHint = step2Section.includes('node bin/install.js')
      || step2Section.includes('/fvgsd:update')
      || step2Section.includes('fvgsd-update')
      || step2Section.includes('/gsd-update');
    assert.ok(
      hasInstallHint,
      'Pre-flight error must include a hint on how to install query-capable fvgsd-sdk ' +
      '(node bin/install.js from a clone, or /fvgsd:update)'
    );
  });
});
