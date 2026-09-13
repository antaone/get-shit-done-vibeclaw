'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rewriteHookCommandReferences } = require('../bin/install.js');

test('hook command references use the target runtime shape', () => {
  const sample = "Run /gsd:pause-work or /gsd-new-project, not gsd-sdk.";
  assert.deepEqual(rewriteHookCommandReferences(sample, 'claude').references, [
    { from: '/gsd:pause-work', to: '/fvgsd-pause-work' },
    { from: '/gsd-new-project', to: '/fvgsd-new-project' },
  ]);
  assert.deepEqual(rewriteHookCommandReferences(sample, 'codex').references.map((r) => r.to), ['$fvgsd-pause-work', '$fvgsd-new-project']);
});
