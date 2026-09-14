// Installs fvgsd for every supported runtime into a temp config dir (HOME
// overridden) and checks where fvgsd-builder lands, in which agent format, and
// that only Claude Code keeps the effort frontmatter key.

'use strict';

process.env.FVGSD_TEST_MODE = '1';

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const IDENTITY = require('../get-shit-done/bin/lib/identity.cjs');
const { ALLOWED_RUNTIMES } = require('../get-shit-done/bin/lib/runtime-artifact-layout.cjs');
const { cleanup, parseFrontmatter } = require('./helpers.cjs');
const { INSTALL_SCRIPT, BUILD_SCRIPT, HOOKS_DIST, RUNTIME_META, installerEnv } = require('./helpers/install-shared.cjs');
const { parseTomlToObject } = require('../bin/install.js');

const AGENT = 'fvgsd-builder';
const RUNTIMES = [...ALLOWED_RUNTIMES].sort();

// resolveRuntimeArtifactLayout declares an agents kind only for Claude Code's
// local scope. A global install writes every runtime's agents to <config>/agents/
// through the installer's agent loop and records them in the install manifest,
// so that is where these tests look.
//
// Per runtime: the installed file name, and the frontmatter keys that runtime's
// agent converter keeps or adds. Only Claude Code keeps effort.
const INSTALLED_AGENT = {
  antigravity: { file: `${AGENT}.md`, keys: ['color', 'description', 'name', 'tools'] },
  augment: { file: `${AGENT}.md`, keys: ['description', 'name'] },
  claude: { file: `${AGENT}.md`, keys: ['color', 'description', 'effort', 'name', 'tools'] },
  cline: { file: `${AGENT}.md`, keys: ['description', 'name'] },
  codebuddy: { file: `${AGENT}.md`, keys: ['description', 'name'] },
  codex: { file: `${AGENT}.md`, keys: ['description', 'name'] },
  copilot: { file: `${AGENT}.agent.md`, keys: ['color', 'description', 'name', 'tools'] },
  cursor: { file: `${AGENT}.md`, keys: ['description', 'name'] },
  gemini: { file: `${AGENT}.md`, keys: ['description', 'name', 'tools'] },
  hermes: { file: `${AGENT}.md`, keys: ['color', 'description', 'name', 'tools'] },
  kilo: { file: `${AGENT}.md`, keys: ['description', 'mode', 'name', 'permission'] },
  opencode: { file: `${AGENT}.md`, keys: ['description', 'mode', 'name'] },
  qwen: { file: `${AGENT}.md`, keys: ['color', 'description', 'name', 'tools'] },
  trae: { file: `${AGENT}.md`, keys: ['description', 'name'] },
  windsurf: { file: `${AGENT}.md`, keys: ['description', 'name'] },
};

// Installs into <temp HOME>/<the runtime's global config folder> and returns that folder.
function installGlobal(t, runtime) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${IDENTITY.tempPrefix}builder-${runtime}-`)));
  t.after(() => cleanup(root));
  const configDir = path.join(root, RUNTIME_META[runtime].globalSuffix);
  const result = spawnSync(process.execPath, [INSTALL_SCRIPT, `--${runtime}`, '--global', '--config-dir', configDir, '--no-sdk'], {
    cwd: root,
    encoding: 'utf8',
    env: installerEnv({ HOME: root, USERPROFILE: root }),
  });
  assert.equal(result.status, 0, `${runtime} install exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  return configDir;
}

describe('fvgsd-builder installs in every runtime', () => {
  before(() => {
    if (!fs.existsSync(path.join(HOOKS_DIST, IDENTITY.hooksDir))) {
      execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: 'pipe' });
    }
  });

  test('every supported runtime has install metadata and an expected agent format', () => {
    assert.deepEqual(RUNTIMES.filter((runtime) => !RUNTIME_META[runtime]), []);
    assert.deepEqual(Object.keys(INSTALLED_AGENT).sort(), RUNTIMES);
  });

  for (const runtime of RUNTIMES) {
    test(`${runtime}: installs ${AGENT} in the runtime's agent format`, (t) => {
      const configDir = installGlobal(t, runtime);
      const { file, keys } = INSTALLED_AGENT[runtime];

      const manifest = JSON.parse(fs.readFileSync(path.join(configDir, IDENTITY.manifestFile), 'utf8'));
      const recorded = Object.keys(manifest.files).filter((rel) => rel.startsWith(`agents/${AGENT}.`));
      assert.deepEqual(recorded, [`agents/${file}`]);

      const frontmatter = parseFrontmatter(fs.readFileSync(path.join(configDir, 'agents', file), 'utf8'));
      assert.equal(frontmatter.name, AGENT);
      if (runtime === 'claude') {
        assert.equal(frontmatter.effort, 'high');
      } else {
        assert.equal(Object.hasOwn(frontmatter, 'effort'), false, `${runtime} kept effort`);
      }
      assert.deepEqual(Object.keys(frontmatter).sort(), keys);

      if (runtime === 'codex') {
        const role = parseTomlToObject(fs.readFileSync(path.join(configDir, 'agents', `${AGENT}.toml`), 'utf8'));
        assert.equal(role.name, AGENT);
        assert.equal(role.sandbox_mode, 'workspace-write');
        assert.equal(Object.hasOwn(role, 'effort'), false);
        const config = parseTomlToObject(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
        assert.equal(config.agents[AGENT].config_file, path.join(configDir, 'agents', `${AGENT}.toml`).replace(/\\/g, '/'));
      }
    });
  }
});
