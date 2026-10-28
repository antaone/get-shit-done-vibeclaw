'use strict';

// applySurface re-stages skills from source. It must apply the same per-runtime
// rewrites the installer applies (the __FVGSD_RUNTIME__ token, config paths), so
// a skill it writes is byte-identical to the installed one.

process.env.FVGSD_TEST_MODE = '1';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempDir, cleanup } = require('./helpers.cjs');
const { installRuntimeArtifacts } = require('../bin/install.js');
const { loadSkillsManifest, resolveProfile } = require('../get-shit-done/bin/lib/install-profiles.cjs');
const { resolveRuntimeArtifactLayout } = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');
const { writeSurface, applySurface } = require('../get-shit-done/bin/lib/surface.cjs');
const { CLUSTERS } = require('../get-shit-done/bin/lib/clusters.cjs');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands', 'gsd');
const MANIFEST = loadSkillsManifest(COMMANDS_DIR);
const dirs = [];

afterEach(() => {
  while (dirs.length) cleanup(dirs.pop());
});

describe('applySurface runtime rewrites', () => {
  for (const runtime of ['claude', 'codex']) {
    test(`${runtime}: re-staged skills match the installed ones and carry no runtime token`, () => {
      const configDir = createTempDir(`fvgsd-surface-rewrites-${runtime}-`);
      dirs.push(configDir);
      installRuntimeArtifacts(runtime, configDir, 'global', resolveProfile({ modes: ['full'], manifest: MANIFEST }));
      const skill = path.join(configDir, 'skills', 'fvgsd-dod', 'SKILL.md');
      const installed = fs.readFileSync(skill, 'utf8');

      writeSurface(configDir, { baseProfile: 'repo-session', disabledClusters: [], explicitAdds: [], explicitRemoves: [] });
      applySurface(configDir, resolveRuntimeArtifactLayout(runtime, configDir, 'global'), MANIFEST, CLUSTERS);

      assert.equal(fs.readFileSync(skill, 'utf8'), installed);
      for (const entry of fs.readdirSync(path.join(configDir, 'skills'))) {
        const file = path.join(configDir, 'skills', entry, 'SKILL.md');
        if (fs.existsSync(file)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /__FVGSD_RUNTIME__/, entry);
      }
      assert.match(installed, new RegExp(`--runtime ${runtime}\``));
    });
  }
});
