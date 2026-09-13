'use strict';
process.env.FVGSD_TEST_MODE = '1';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { CHECK_REASON } = require(
  path.join(__dirname, '..', 'get-shit-done', 'bin', 'check-latest-version.cjs'),
);

// checkLatestVersion() itself (disabled, never spawns) is covered by
// tests/fvgsd-update-check-disabled.test.cjs. This file now only pins the
// CHECK_REASON enum shape — the success/error-path tests that exercised the
// npm-spawning code (#2992) were removed with that code (fvgsd identity
// Task 10): fvgsd is not published to npm, so those paths are unreachable.

describe('Bug #2992: deterministic latest-version check', () => {
  test('CHECK_REASON enum exposes the documented codes, including DISABLED', () => {
    assert.deepEqual(
      Object.keys(CHECK_REASON).sort(),
      ['DISABLED', 'FAIL_INVALID_OUTPUT', 'FAIL_NPM_FAILED', 'OK'],
    );
  });
});
