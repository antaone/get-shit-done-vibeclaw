'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const projection = require(path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib', 'shell-command-projection.cjs'));
const install = require(path.join(__dirname, '..', 'bin', 'install.js'));

const {
  hookCommandNeedsPowerShellCallOperator,
  formatHookCommandForRuntime,
  isManagedHookBasename,
  isManagedHookCommand,
  projectLocalHookPrefix,
  projectLegacySettingsHookCommand,
  projectPortableHookBaseDir,
} = projection;
const { buildHookCommand, rewriteLegacyManagedNodeHookCommands } = install;

describe('bug #3413: Shell Command Projection Module uses runtime-aware hook policy', () => {
  test('Gemini on Windows requires PowerShell call operator', () => {
    assert.equal(
      hookCommandNeedsPowerShellCallOperator({ platform: 'win32', runtime: 'gemini' }),
      true,
    );
    assert.equal(
      formatHookCommandForRuntime('"C:/node.exe" "C:/hook.js"', { platform: 'win32', runtime: 'gemini' }),
      '& "C:/node.exe" "C:/hook.js"',
    );
  });

  test('Claude on Windows stays shell-neutral', () => {
    assert.equal(
      hookCommandNeedsPowerShellCallOperator({ platform: 'win32', runtime: 'claude' }),
      false,
    );
    assert.equal(
      formatHookCommandForRuntime('"C:/node.exe" "C:/hook.js"', { platform: 'win32', runtime: 'claude' }),
      '"C:/node.exe" "C:/hook.js"',
    );
  });

  test('runtime omitted stays conservative (no PowerShell prefix)', () => {
    assert.equal(
      formatHookCommandForRuntime('"C:/node.exe" "C:/hook.js"', { platform: 'win32' }),
      '"C:/node.exe" "C:/hook.js"',
    );
  });
});

describe('bug #3413: installer hook surfaces consume runtime-aware projection', () => {
  test('buildHookCommand emits shell-neutral Claude hook command on Windows', () => {
    const cmd = buildHookCommand('C:/Users/me/.claude', 'fvgsd/check-update.js', {
      platform: 'win32',
      runtime: 'claude',
    });
    assert.equal(cmd.startsWith('& '), false, `Claude hook command must not use PowerShell prefix: ${cmd}`);
  });

  test('rewriteLegacyManagedNodeHookCommands removes stale PowerShell prefix for Claude on Windows', () => {
    const settings = {
      hooks: {
        SessionStart: [{
          hooks: [{ type: 'command', command: '& "/usr/local/bin/node" "C:/Users/me/.claude/hooks/fvgsd/check-update.js"' }],
        }],
      },
    };
    const changed = rewriteLegacyManagedNodeHookCommands(settings, '"/usr/local/bin/node"', {
      platform: 'win32',
      runtime: 'claude',
    });
    assert.equal(changed, true);
    assert.equal(
      settings.hooks.SessionStart[0].hooks[0].command,
      '"/usr/local/bin/node" "C:/Users/me/.claude/hooks/fvgsd/check-update.js"',
    );
  });
});

describe('bug #3439: shell projection module owns managed-hook policy and legacy rewrite projection', () => {
  test('isManagedHookBasename is surface-aware', () => {
    assert.equal(isManagedHookBasename('/x/hooks/fvgsd/check-update.js', { surface: 'settings-json' }), true);
    assert.equal(isManagedHookBasename('/x/hooks/fvgsd/statusline.js', { surface: 'settings-json' }), true);
    assert.equal(isManagedHookBasename('/x/hooks/fvgsd/statusline.js', { surface: 'codex-toml' }), false);
    assert.equal(isManagedHookBasename('/x/hooks/custom-hook.js', { surface: 'settings-json' }), false);
  });

  test('projectLegacySettingsHookCommand preserves non-Windows script token shape', () => {
    const command = projectLegacySettingsHookCommand({
      absoluteRunner: '"/usr/local/bin/node"',
      scriptPath: '/x/hooks/fvgsd/statusline.js',
      scriptToken: "'/x/hooks/fvgsd/statusline.js'",
      platform: 'linux',
      runtime: 'claude',
    });
    assert.equal(command, `"/usr/local/bin/node" '/x/hooks/fvgsd/statusline.js'`);
  });

  test('projectLegacySettingsHookCommand normalizes Windows managed paths and runtime wrapper policy', () => {
    const command = projectLegacySettingsHookCommand({
      absoluteRunner: '"C:/nvm4w/nodejs/node.exe"',
      scriptPath: 'C:\\Users\\me\\.gemini\\hooks\\fvgsd/prompt-guard.js',
      scriptToken: "'C:\\Users\\me\\.gemini\\hooks\\fvgsd/prompt-guard.js'",
      platform: 'win32',
      runtime: 'gemini',
    });
    assert.equal(command, '& "C:/nvm4w/nodejs/node.exe" "C:/Users/me/.gemini/hooks/fvgsd/prompt-guard.js"');
  });

  test('projectLocalHookPrefix centralizes runtime-specific project-dir interpolation policy', () => {
    assert.equal(projectLocalHookPrefix({ runtime: 'gemini', dirName: '.gemini' }), '.gemini');
    assert.equal(projectLocalHookPrefix({ runtime: 'antigravity', dirName: '.agent' }), '.agent');
    assert.equal(
      projectLocalHookPrefix({ runtime: 'claude', dirName: '.claude' }),
      '"$CLAUDE_PROJECT_DIR"/.claude',
    );
  });

  test('projectPortableHookBaseDir centralizes $HOME interpolation policy', () => {
    assert.equal(
      projectPortableHookBaseDir({
        configDir: '/Users/me/.claude',
        homeDir: '/Users/me',
      }),
      '$HOME/.claude',
    );
    assert.equal(
      projectPortableHookBaseDir({
        configDir: 'C:\\Users\\me\\.claude',
        homeDir: 'C:\\Users\\me',
      }),
      '$HOME/.claude',
    );
    assert.equal(
      projectPortableHookBaseDir({
        configDir: '/opt/custom/.claude',
        homeDir: '/Users/me',
      }),
      '/opt/custom/.claude',
    );
  });

  test('isManagedHookCommand classifies managed settings hooks and leaves user commands untouched', () => {
    assert.equal(
      isManagedHookCommand('"/usr/local/bin/node" "/Users/me/.claude/hooks/fvgsd/statusline.js"', {
        surface: 'settings-json',
      }),
      true,
    );
    assert.equal(
      isManagedHookCommand('"C:/Program Files/Git/bin/bash.exe" "C:/Users/me/.claude/hooks/fvgsd/session-state.sh"', {
        surface: 'settings-json',
      }),
      true,
    );
    assert.equal(
      isManagedHookCommand('bash /Users/me/.claude/hooks/custom-lint.sh', {
        surface: 'settings-json',
      }),
      false,
    );
  });

  test('isManagedHookCommand supports codex surfaces and recognises no legacy aliases', () => {
    const command = '"/usr/local/bin/node" "/Users/me/.codex/hooks/fvgsd/check-update.js"';
    assert.equal(
      isManagedHookCommand(command, {
        surface: 'codex-toml',
      }),
      true,
    );
    assert.equal(
      isManagedHookCommand('"/usr/local/bin/node" "/Users/me/.codex/hooks/fvgsd-update-check.js"', {
        surface: 'codex-toml',
      }),
      false,
    );
    assert.equal(
      isManagedHookCommand('"/usr/local/bin/node" "/Users/me/.codex/hooks/fvgsd-update-check.js"', {
        surface: 'codex-toml',
        includeLegacyAliases: true,
      }),
      false,
    );
  });
});

describe('stripUrlCredentials strips embedded userinfo before a remote URL is recorded (.fvgsd-source)', () => {
  const { stripUrlCredentials } = projection;

  test('strips a user:password pair from an HTTPS remote', () => {
    assert.equal(
      stripUrlCredentials('https://user:token@github.com/org/repo.git'),
      'https://github.com/org/repo.git',
    );
  });

  test('strips a GitHub-style token-as-username remote (no password)', () => {
    assert.equal(
      stripUrlCredentials('https://ghp_aBc123@github.com/org/repo.git'),
      'https://github.com/org/repo.git',
    );
  });

  test('strips userinfo from an ssh:// URL too — the field is informational only, never executed', () => {
    assert.equal(
      stripUrlCredentials('ssh://git@github.com/org/repo.git'),
      'ssh://github.com/org/repo.git',
    );
  });

  test('leaves an HTTPS remote with no credentials unchanged', () => {
    assert.equal(
      stripUrlCredentials('https://github.com/org/repo.git'),
      'https://github.com/org/repo.git',
    );
  });

  test('leaves SCP-style SSH remotes unchanged (not parseable as a URL, no userinfo to strip)', () => {
    const scp = 'git@github.com:org/repo.git';
    assert.equal(stripUrlCredentials(scp), scp);
  });

  test('passes non-string input through unchanged (e.g. null when there is no origin remote)', () => {
    assert.equal(stripUrlCredentials(null), null);
    assert.equal(stripUrlCredentials(undefined), undefined);
  });
});
