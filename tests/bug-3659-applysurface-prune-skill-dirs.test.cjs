'use strict';
/**
 * Regression test for bug #3659
 *
 * applySurface did not prune ~/.claude/skills/vgsd-STEM dirs when a cluster
 * was disabled. install/uninstall both prune correctly via _removeGsdEntries;
 * applySurface called _syncGsdDir with the right logic but the surface.md spec
 * directed the AI to use RUNTIME_CONFIG_DIR=~/.claude/skills (the skills dir
 * itself) instead of the base Claude config dir (~/.claude).
 *
 * When runtimeConfigDir = ~/.claude/skills and scope = 'global':
 *   kind.destSubpath = 'skills'
 *   dest = path.join('~/.claude/skills', 'skills') = ~/.claude/skills/skills  WRONG
 *
 * The pruning ran against the wrong (non-existent) dir so stale vgsd-Y dirs
 * were never removed from ~/.claude/skills/.
 *
 * Fix:
 *   1. surface.md RUNTIME_CONFIG_DIR changed to use the base Claude config dir
 *      (getGlobalDir('claude') = ~/.claude), not ~/.claude/skills.
 *   2. Surface state file moves to <configDir>/.vgsd-surface.json at the config
 *      root, matching install/uninstall conventions.
 *   3. applySurface is called with scope='global' so the skills kind is active.
 *
 * Tests:
 *   a) disabled cluster vgsd-STEM dirs are REMOVED from ~/.claude/skills/
 *   b) vgsd-STEM dirs in the retain set are preserved
 *   c) non-gsd dirs are UNTOUCHED (user-owned)
 *   d) idempotence: running applySurface twice produces the same on-disk state
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { writeSurface, applySurface } = require('../get-shit-done/bin/lib/surface.cjs');
const { loadSkillsManifest } = require('../get-shit-done/bin/lib/install-profiles.cjs');
const { CLUSTERS } = require('../get-shit-done/bin/lib/clusters.cjs');
const { resolveRuntimeArtifactLayout } = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');
const { createTempDir, cleanup } = require('./helpers.cjs');

const REAL_COMMANDS_DIR = path.join(__dirname, '..', 'commands', 'gsd');

/**
 * Build a minimal fixture simulating a Claude global install.
 *
 * configDir  — analogous to ~/.claude
 * skillsDir  — analogous to ~/.claude/skills (contains vgsd-* dirs)
 *
 * Pre-populated with:
 *   vgsd-explore/SKILL.md  — in research_ideate cluster (will be disabled)
 *   vgsd-help/SKILL.md     — in core_loop cluster (will remain enabled)
 *   my-custom-skill/       — user-owned, not vgsd-prefixed (must never be touched)
 */
function createFixture() {
  const configDir = createTempDir('gsd-bug3659-');
  const skillsDir = path.join(configDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const gsdExplore = path.join(skillsDir, 'vgsd-explore');
  const gsdHelp = path.join(skillsDir, 'vgsd-help');
  const userSkill = path.join(skillsDir, 'my-custom-skill');

  for (const d of [gsdExplore, gsdHelp, userSkill]) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), '# skill\n', 'utf8');
  }

  return { configDir, skillsDir, gsdExplore, gsdHelp, userSkill };
}

/**
 * Extended fixture that also includes a user-created vgsd-* directory.
 * Used by the all-clusters-disabled counter-test to prove the manifest-membership
 * gate (Finding 1 fix) protects user-owned vgsd-* dirs from data loss.
 */
function createFixtureWithUserGsdDir() {
  const base = createFixture();
  const userGsdDir = path.join(base.skillsDir, 'vgsd-mything');
  fs.mkdirSync(userGsdDir, { recursive: true });
  fs.writeFileSync(path.join(userGsdDir, 'SKILL.md'), '# user skill\n', 'utf8');
  return { ...base, userGsdDir };
}

describe('bug-3659: applySurface prunes ~/.claude/skills/vgsd-*/ on cluster disable', () => {
  test('(a) disabled cluster vgsd-* dirs are removed from skills dir', (t) => {
    const { configDir, skillsDir, gsdExplore, gsdHelp } = createFixture();
    t.after(() => cleanup(configDir));

    // Surface state at configDir (= ~/.claude), NOT at skillsDir (= ~/.claude/skills).
    // This is the corrected location after the fix.
    writeSurface(configDir, {
      baseProfile: 'full',
      disabledClusters: ['research_ideate'], // contains 'explore'
      explicitAdds: [],
      explicitRemoves: [],
    });

    const manifest = loadSkillsManifest(REAL_COMMANDS_DIR);
    // scope='global' gives the skills kind for Claude (destSubpath='skills', prefix='vgsd-')
    const layout = resolveRuntimeArtifactLayout('claude', configDir, 'global');
    applySurface(configDir, layout, manifest, CLUSTERS);

    // vgsd-explore is in the research_ideate cluster which was disabled:
    // it must be pruned from skillsDir.
    assert.ok(
      !fs.existsSync(gsdExplore),
      'vgsd-explore/ must be removed from skills dir when research_ideate cluster is disabled'
    );

    // vgsd-help is in core_loop (not disabled) and must survive.
    assert.ok(
      fs.existsSync(gsdHelp),
      'vgsd-help/ must be preserved when its cluster is not disabled'
    );
  });

  test('(b) vgsd-* dirs in retained clusters are preserved', (t) => {
    const { configDir, skillsDir, gsdHelp } = createFixture();
    t.after(() => cleanup(configDir));

    // Disable a cluster that does NOT include help (core_loop has help)
    writeSurface(configDir, {
      baseProfile: 'full',
      disabledClusters: ['research_ideate'],
      explicitAdds: [],
      explicitRemoves: [],
    });

    const manifest = loadSkillsManifest(REAL_COMMANDS_DIR);
    const layout = resolveRuntimeArtifactLayout('claude', configDir, 'global');
    applySurface(configDir, layout, manifest, CLUSTERS);

    assert.ok(
      fs.existsSync(gsdHelp),
      'vgsd-help/ must be preserved — core_loop cluster remains enabled'
    );
  });

  test('(c) non-gsd user dirs are untouched', (t) => {
    const { configDir, skillsDir, userSkill } = createFixture();
    t.after(() => cleanup(configDir));

    writeSurface(configDir, {
      baseProfile: 'full',
      disabledClusters: ['research_ideate'],
      explicitAdds: [],
      explicitRemoves: [],
    });

    const manifest = loadSkillsManifest(REAL_COMMANDS_DIR);
    const layout = resolveRuntimeArtifactLayout('claude', configDir, 'global');
    applySurface(configDir, layout, manifest, CLUSTERS);

    assert.ok(
      fs.existsSync(userSkill),
      'my-custom-skill/ (non-vgsd user dir) must be preserved by applySurface'
    );
    assert.ok(
      fs.existsSync(path.join(userSkill, 'SKILL.md')),
      'user skill SKILL.md must be untouched'
    );
  });

  test('(d) idempotence: running applySurface twice produces identical on-disk state', (t) => {
    const { configDir, skillsDir, gsdExplore, gsdHelp, userSkill } = createFixture();
    t.after(() => cleanup(configDir));

    writeSurface(configDir, {
      baseProfile: 'full',
      disabledClusters: ['research_ideate'],
      explicitAdds: [],
      explicitRemoves: [],
    });

    const manifest = loadSkillsManifest(REAL_COMMANDS_DIR);
    const layout = resolveRuntimeArtifactLayout('claude', configDir, 'global');

    // First apply
    applySurface(configDir, layout, manifest, CLUSTERS);
    const afterFirst = fs.readdirSync(skillsDir).sort();

    // Second apply — must produce exactly the same set
    applySurface(configDir, layout, manifest, CLUSTERS);
    const afterSecond = fs.readdirSync(skillsDir).sort();

    assert.deepStrictEqual(
      afterSecond,
      afterFirst,
      'skills dir contents must be identical after two consecutive applySurface calls (idempotent)'
    );

    // Double-check the pruned dir is gone after both runs
    assert.ok(
      !fs.existsSync(gsdExplore),
      'vgsd-explore/ must remain absent after second applySurface call'
    );

    // User dir must survive both runs
    assert.ok(
      fs.existsSync(userSkill),
      'my-custom-skill/ must survive both applySurface calls'
    );
  });

  test('(e) all-clusters-disabled: all vgsd-owned dirs removed; user dirs and user vgsd-* dirs survive', (t) => {
    // Counter-test for Finding 1 (data-loss class) and Finding 3 (missing coverage).
    //
    // Disables EVERY cluster so the resolved skill set is empty.
    // Assertions:
    //   1. vgsd-explore/ — GSD-owned, disabled cluster → REMOVED
    //   2. vgsd-help/    — GSD-owned, disabled cluster → REMOVED
    //   3. my-custom-skill/ — user-owned, no vgsd- prefix → PRESERVED
    //   4. vgsd-mything/ — prefix match but NOT in manifest → PRESERVED (Finding 1 fix)
    const { configDir, skillsDir, gsdExplore, gsdHelp, userSkill, userGsdDir } =
      createFixtureWithUserGsdDir();
    t.after(() => cleanup(configDir));

    const allClusters = Object.keys(CLUSTERS);

    writeSurface(configDir, {
      baseProfile: 'full',
      disabledClusters: allClusters,
      explicitAdds: [],
      explicitRemoves: [],
    });

    const manifest = loadSkillsManifest(REAL_COMMANDS_DIR);
    const layout = resolveRuntimeArtifactLayout('claude', configDir, 'global');
    applySurface(configDir, layout, manifest, CLUSTERS);

    // 1. GSD-owned dirs in now-disabled clusters must be removed.
    assert.ok(
      !fs.existsSync(gsdExplore),
      'vgsd-explore/ must be removed when all clusters are disabled'
    );
    assert.ok(
      !fs.existsSync(gsdHelp),
      'vgsd-help/ must be removed when all clusters are disabled'
    );

    // 2. Non-gsd user dir must be preserved regardless.
    assert.ok(
      fs.existsSync(userSkill),
      'my-custom-skill/ (non-vgsd user dir) must survive when all clusters are disabled'
    );

    // 3. User-created vgsd-* dir NOT in the manifest must be preserved.
    //    This is the critical Finding 1 regression guard: without the manifest-membership
    //    gate, vgsd-mything/ would have been silently deleted.
    assert.ok(
      fs.existsSync(userGsdDir),
      'vgsd-mything/ (user-created vgsd-* dir not in manifest) must be preserved — ' +
      'prefix match alone must not trigger deletion (Finding 1 data-loss fix)'
    );
  });
});
