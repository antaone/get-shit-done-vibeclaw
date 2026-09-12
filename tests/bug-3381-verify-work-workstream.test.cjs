// allow-test-rule: source-text-is-the-product — verify-work.md is a runtime workflow contract.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('bug #3381: verify-work forwards workstream context', () => {
  test('workflow forwards ${FVGSD_WS} to workstream-sensitive SDK queries', () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, '..', 'get-shit-done', 'workflows', 'verify-work.md'),
      'utf8',
    );

    assert.match(workflow, /FVGSD_WS=""/, 'verify-work must initialize FVGSD_WS');
    assert.match(
      workflow,
      /grep -qE -- '--ws\[\[:space:\]\]\+\[\^\[:space:\]\]\+'/,
      'verify-work must detect --ws in $ARGUMENTS',
    );
    assert.match(
      workflow,
      /grep -oE -- '--ws\[\[:space:\]\]\+\[\^\[:space:\]\]\+'/,
      'verify-work must extract the --ws flag pair from $ARGUMENTS',
    );
    assert.match(
      workflow,
      /PHASE_ARG=\$\(echo "\$ARGUMENTS" \| sed -E 's\/--ws\[\[:space:\]\]\+\[\^\[:space:\]\]\+\/\/g' \| xargs\)/,
      'verify-work must derive PHASE_ARG after removing --ws',
    );
    assert.match(
      workflow,
      /fvgsd-sdk query init\.verify-work "\$\{PHASE_ARG\}" \$\{FVGSD_WS\}/,
      'init.verify-work must receive FVGSD_WS so phase_dir resolves in workstreams',
    );
    assert.match(
      workflow,
      /fvgsd-sdk query phase\.mvp-mode "\$\{phase_number\}" \$\{FVGSD_WS\} --pick active/,
      'phase.mvp-mode must receive FVGSD_WS so roadmap mode is workstream-scoped',
    );
    assert.match(
      workflow,
      /fvgsd-sdk query roadmap\.get-phase "\$\{phase_number\}" \$\{FVGSD_WS\} --pick goal/,
      'roadmap.get-phase must receive FVGSD_WS so goals are workstream-scoped',
    );
  });
});
