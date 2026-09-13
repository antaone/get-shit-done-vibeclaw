#!/usr/bin/env node
'use strict';

/**
 * Deterministic latest-version check for /fvgsd-update (#2992).
 *
 * This script used to run `npm view fvgsd version` so the executing model
 * could not shortcut the prescription and invent npm queries against
 * wrong-shaped names. fvgsd is not published to npm at all — it installs
 * from a local clone — so the npm lookup would always fail. checkLatestVersion()
 * is now a hardcoded disabled result: it never spawns anything, npm included.
 *
 * /fvgsd-update instead reads the clone location the installer recorded at
 * install time (`.fvgsd-source`, see IDENTITY.sourceFile) and pulls +
 * reinstalls from it — see get-shit-done/workflows/update.md.
 *
 * Tests assert on the typed CHECK_REASON enum and the structured result
 * record, never on console prose. See CONTRIBUTING.md "Prohibited: Raw
 * Text Matching on Test Outputs".
 */

const CHECK_REASON = Object.freeze({
  OK: 'ok',
  FAIL_NPM_FAILED: 'fail_npm_failed',
  FAIL_INVALID_OUTPUT: 'fail_invalid_output',
  DISABLED: 'disabled',
});

/**
 * fvgsd never queries npm for its own version. Always returns the disabled
 * result without spawning anything — the pre-fvgsd `spawn` injection point
 * is gone along with the npm call it used to test.
 */
function checkLatestVersion() {
  return {
    ok: false,
    reason: CHECK_REASON.DISABLED,
    detail: 'fvgsd does not query npm; run /fvgsd-update to pull your clone',
  };
}

function main() {
  const json = process.argv.includes('--json');
  const r = checkLatestVersion();
  if (json) {
    process.stdout.write(JSON.stringify(r) + '\n');
  } else {
    process.stderr.write(`check-latest-version: ${r.reason}: ${r.detail}\n`);
  }
  // r.ok is always false — checkLatestVersion() only ever returns DISABLED.
  process.exit(1);
}

if (require.main === module) main();

module.exports = { checkLatestVersion, CHECK_REASON };
