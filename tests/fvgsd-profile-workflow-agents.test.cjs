'use strict';

// A profile install stages only the agents its skills reference. Skills load
// workflow files that spawn more agents, so the skills manifest must follow
// those workflows, or a reduced profile ships commands whose agents are missing.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSkillsManifest, resolveProfile, PROFILES } = require('../get-shit-done/bin/lib/install-profiles.cjs');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands', 'gsd');
const WORKFLOWS_DIR = path.join(ROOT, 'get-shit-done', 'workflows');
const AGENTS = new Set(fs.readdirSync(path.join(ROOT, 'agents')).map((f) => f.replace(/\.md$/, '')));
const MANIFEST = loadSkillsManifest(COMMANDS_DIR);
const REF = /(?:~|\$HOME)\/\.claude\/fvgsd\/workflows\/([A-Za-z0-9_\-/]+\.md)/g;

// Independent of the manifest code: every agent a skill's command or workflow tree spawns.
function spawnedBy(skill) {
  const spawned = new Set();
  const seen = new Set();
  const queue = [path.join(COMMANDS_DIR, `${skill}.md`)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !fs.existsSync(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(REF)) queue.push(path.join(WORKFLOWS_DIR, m[1]));
    for (const m of text.matchAll(/subagent_type\s*[=:]\s*["']?(fvgsd-[a-z-]+)/g)) {
      if (AGENTS.has(m[1])) spawned.add(m[1]);
    }
  }
  return spawned;
}

describe('profile installs stage the agents their workflows spawn', () => {
  test('every command stages every agent its workflows spawn', () => {
    const skills = [...MANIFEST.keys()].filter((key) => !key.startsWith('_calls_agents_'));
    for (const skill of skills) {
      const resolved = resolveProfile({ modes: ['only'], manifest: MANIFEST, _profilesOverride: { only: [skill] } });
      for (const agent of spawnedBy(skill)) {
        assert.ok(resolved.agents.has(agent), `${skill} spawns ${agent} but its profile does not stage it`);
      }
    }
  });

  for (const profile of Object.keys(PROFILES).filter((name) => PROFILES[name] !== '*')) {
    test(`${profile}: every surfaced skill has its agents`, () => {
      const resolved = resolveProfile({ modes: [profile], manifest: MANIFEST });
      for (const skill of resolved.skills) {
        for (const agent of spawnedBy(skill)) assert.ok(resolved.agents.has(agent), `${profile}/${skill} needs ${agent}`);
      }
    });
  }

  test('prose mentions in workflows do not stage agents', () => {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'fvgsd-manifest-'));
    try {
      fs.mkdirSync(path.join(dir, 'commands', 'gsd'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'get-shit-done', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'commands', 'gsd', 'demo.md'), '---\nname: fvgsd:demo\n---\n@~/.claude/fvgsd/workflows/demo.md\n');
      fs.writeFileSync(path.join(dir, 'get-shit-done', 'workflows', 'demo.md'),
        'Unlike fvgsd-planner, this spawns:\nAgent(subagent_type="fvgsd-verifier")\n@~/.claude/fvgsd/workflows/nested.md\n');
      fs.writeFileSync(path.join(dir, 'get-shit-done', 'workflows', 'nested.md'), 'Task(subagent_type: fvgsd-debugger)\n');
      const manifest = loadSkillsManifest(path.join(dir, 'commands', 'gsd'));
      assert.deepEqual([...manifest.get('_calls_agents_demo')].sort(), ['fvgsd-debugger', 'fvgsd-verifier']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
