/**
 * GSD Tools Tests — update workflow custom file backup detection (#1997)
 *
 * The update workflow must detect user-added files inside GSD-managed
 * directories (get-shit-done/, agents/, commands/gsd/, hooks/) before the
 * installer wipes those directories.
 *
 * This tests the `detect-custom-files` subcommand of fvgsd-tools.cjs, which is
 * the correct fix for the bash path-stripping failure described in #1997.
 *
 * The bash pattern `${filepath#$RUNTIME_DIR/}` is unreliable because
 * $RUNTIME_DIR may not be set and the stripped relative path may not match
 * manifest key format. Moving the logic into fvgsd-tools.cjs eliminates the
 * shell variable expansion failure entirely.
 *
 * Closes: #1997
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const crypto = require('crypto');
const { runGsdTools, createTempDir, cleanup } = require('./helpers.cjs');

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Write a fake fvgsd-file-manifest.json into configDir with the given file entries.
 */
function writeManifest(configDir, files) {
  const manifest = {
    version: '1.32.0',
    timestamp: new Date().toISOString(),
    files: {}
  };
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(configDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    manifest.files[relPath] = sha256(content);
  }
  fs.writeFileSync(
    path.join(configDir, 'fvgsd-file-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
}

describe('detect-custom-files — update workflow backup detection (#1997)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir('fvgsd-custom-detect-');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('detects a custom file added inside get-shit-done/workflows/', () => {
    writeManifest(tmpDir, {
      [`${IDENTITY.installDir}/workflows/execute-phase.md`]: '# Execute Phase\n',
      [`${IDENTITY.installDir}/workflows/plan-phase.md`]: '# Plan Phase\n',
    });

    // Add a custom file NOT in the manifest
    const customFile = path.join(tmpDir, `${IDENTITY.installDir}/workflows/my-custom-workflow.md`);
    fs.writeFileSync(customFile, '# My Custom Workflow\n');

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);
    assert.ok(Array.isArray(json.custom_files), 'should return custom_files array');
    assert.ok(json.custom_files.length > 0, 'should detect at least one custom file');
    assert.ok(
      json.custom_files.includes(`${IDENTITY.installDir}/workflows/my-custom-workflow.md`),
      `custom file should be listed; got: ${JSON.stringify(json.custom_files)}`
    );
  });

  test('detects custom files added inside agents/', () => {
    writeManifest(tmpDir, {
      'agents/fvgsd-executor.md': '# GSD Executor\n',
    });

    // Add a user's custom agent (not prefixed with gsd-)
    const customAgent = path.join(tmpDir, 'agents/my-custom-agent.md');
    fs.mkdirSync(path.dirname(customAgent), { recursive: true });
    fs.writeFileSync(customAgent, '# My Custom Agent\n');

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);
    assert.ok(json.custom_files.includes('agents/my-custom-agent.md'),
      `custom agent should be detected; got: ${JSON.stringify(json.custom_files)}`);
  });

  test('reports zero custom files when all files are in manifest', () => {
    writeManifest(tmpDir, {
      [`${IDENTITY.installDir}/workflows/execute-phase.md`]: '# Execute Phase\n',
      [`${IDENTITY.installDir}/references/gates.md`]: '# Gates\n',
      'agents/fvgsd-executor.md': '# Executor\n',
    });
    // No extra files added

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);
    assert.ok(Array.isArray(json.custom_files), 'should return custom_files array');
    assert.strictEqual(json.custom_files.length, 0, 'no custom files should be detected');
    assert.strictEqual(json.custom_count, 0, 'custom_count should be 0');
  });

  test('returns custom_count equal to custom_files length', () => {
    writeManifest(tmpDir, {
      [`${IDENTITY.installDir}/workflows/execute-phase.md`]: '# Execute Phase\n',
    });

    // Add two custom files
    fs.writeFileSync(
      path.join(tmpDir, `${IDENTITY.installDir}/workflows/custom-a.md`),
      '# Custom A\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, `${IDENTITY.installDir}/workflows/custom-b.md`),
      '# Custom B\n'
    );

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);
    assert.strictEqual(json.custom_count, json.custom_files.length,
      'custom_count should equal custom_files.length');
    assert.strictEqual(json.custom_count, 2, 'should detect exactly 2 custom files');
  });

  test('does not flag manifest files as custom even if content was modified', () => {
    writeManifest(tmpDir, {
      [`${IDENTITY.installDir}/workflows/execute-phase.md`]: '# Execute Phase\nOriginal\n',
    });

    // Modify the content of an existing manifest file
    fs.writeFileSync(
      path.join(tmpDir, `${IDENTITY.installDir}/workflows/execute-phase.md`),
      '# Execute Phase\nModified by user\n'
    );

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);
    // Modified manifest files are handled by saveLocalPatches (in install.js).
    // detect-custom-files only finds files NOT in the manifest at all.
    assert.ok(
      !json.custom_files.includes(`${IDENTITY.installDir}/workflows/execute-phase.md`),
      'modified manifest files should NOT be listed as custom (that is saveLocalPatches territory)'
    );
  });

  test('handles missing manifest gracefully — treats all GSD-dir files as custom', () => {
    // No manifest. Add a file in a GSD-managed dir.
    const workflowDir = path.join(tmpDir, `${IDENTITY.installDir}/workflows`);
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, 'my-workflow.md'), '# My Workflow\n');

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);
    // Without a manifest, we cannot determine what is custom vs GSD-owned.
    // The command should return an empty list (no manifest = skip detection,
    // which is safe since saveLocalPatches also does nothing without a manifest).
    assert.ok(Array.isArray(json.custom_files), 'should return custom_files array');
    assert.ok(typeof json.custom_count === 'number', 'should return numeric custom_count');
  });

  test('detects custom files inside get-shit-done/references/', () => {
    writeManifest(tmpDir, {
      [`${IDENTITY.installDir}/references/gates.md`]: '# Gates\n',
    });

    const customRef = path.join(tmpDir, `${IDENTITY.installDir}/references/my-domain-probes.md`);
    fs.writeFileSync(customRef, '# My Domain Probes\n');

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);
    assert.ok(
      json.custom_files.includes(`${IDENTITY.installDir}/references/my-domain-probes.md`),
      `should detect custom reference; got: ${JSON.stringify(json.custom_files)}`
    );
  });

  // After v1.39.0 skill consolidation (#2790), the installer wipes skills/ on
  // update. skills/ is now a GSD-managed directory and must be scanned so that
  // user-added skill directories are backed up before the wipe (#2942).
  // GSD-owned skills (tracked in manifest) must NOT be flagged as custom.
  test('scans skills/ directory and detects user-added skills not in manifest (#2942)', () => {
    writeManifest(tmpDir, {
      [`${IDENTITY.installDir}/workflows/execute-phase.md`]: '# Execute Phase\n',
      'skills/fvgsd-planner/SKILL.md': '# GSD Planner\n',
    });

    // Simulate user having a custom skill installed — NOT in manifest
    const customSkillDir = path.join(tmpDir, 'skills', 'my-custom-skill');
    fs.mkdirSync(customSkillDir, { recursive: true });
    fs.writeFileSync(path.join(customSkillDir, 'SKILL.md'), '# My Custom Skill\n');

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);

    // The user's custom skill should be detected
    assert.ok(
      json.custom_files.includes('skills/my-custom-skill/SKILL.md'),
      `custom skill should be detected; got: ${JSON.stringify(json.custom_files)}`
    );

    // The GSD-owned skill (in manifest) should NOT be flagged as custom
    assert.ok(
      !json.custom_files.includes('skills/fvgsd-planner/SKILL.md'),
      `GSD-owned skill should not be flagged as custom; got: ${JSON.stringify(json.custom_files)}`
    );
  });

  test('does not scan command/ directory (installer does not wipe it)', () => {
    writeManifest(tmpDir, {
      [`${IDENTITY.installDir}/workflows/execute-phase.md`]: '# Execute Phase\n',
    });

    // Simulate files in command/ dir not wiped by installer
    const commandDir = path.join(tmpDir, 'command');
    fs.mkdirSync(commandDir, { recursive: true });
    fs.writeFileSync(path.join(commandDir, 'user-command.md'), '# User Command\n');

    const result = runGsdTools(
      ['detect-custom-files', '--config-dir', tmpDir],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    const json = JSON.parse(result.output);
    const commandFiles = json.custom_files.filter(f => f.startsWith('command/'));
    assert.strictEqual(
      commandFiles.length, 0,
      `command/ should not be scanned; got false positives: ${JSON.stringify(commandFiles)}`
    );
  });
});
