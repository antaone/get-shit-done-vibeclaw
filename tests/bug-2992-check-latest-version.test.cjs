'use strict';
process.env.FVGSD_TEST_MODE = '1';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { CHECK_REASON } = require(
  path.join(__dirname, '..', 'get-shit-done', 'bin', 'check-latest-version.cjs'),
);

// checkLatestVersion() itself (disabled, never spawns) is covered by
// tests/fvgsd-update-check-disabled.test.cjs. This file only pins the
// CHECK_REASON enum shape.

describe('Bug #2992: deterministic latest-version check', () => {
  test('CHECK_REASON enum exposes the documented codes, including DISABLED', () => {
    assert.deepEqual(
      Object.keys(CHECK_REASON).sort(),
      ['DISABLED', 'FAIL_INVALID_OUTPUT', 'FAIL_NPM_FAILED', 'OK'],
    );
  });
});
