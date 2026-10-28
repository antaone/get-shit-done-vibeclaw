// allow-test-rule: source-text-is-the-product
// commands/gsd/{step,deploy,handoff,pause-work}.md and workflows/pause-work.md are
// loaded verbatim by the runtime: their frontmatter, the agents they name and the
// queries they call are the deployed contract.

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('./helpers.cjs');
const { loadSkillsManifest, resolveProfile } = require('../get-shit-done/bin/lib/install-profiles.cjs');

const ROOT = path.join(__dirname, '..');
const COMMANDS_DIR = path.join(ROOT, 'commands', 'gsd');

function command(name) {
  return fs.readFileSync(path.join(COMMANDS_DIR, `${name}.md`), 'utf8');
}

const COMMANDS = {
  step: {
    hint: '<spec-path> <phase|new> [--scope NAME] [--target TEXT] [--deploy ENV] [--yes]',
    agents: ['fvgsd-spec-digester', 'fvgsd-deploy-runner', 'fvgsd-proof-collector', 'fvgsd-handoff-keeper'],
  },
  deploy: { hint: '<env> [--ref BRANCH] [--approval TEXT]', agents: ['fvgsd-deploy-runner', 'fvgsd-handoff-keeper'] },
  handoff: { hint: '[entry text] [--step LABEL]', agents: ['fvgsd-handoff-keeper'] },
};

describe('/fvgsd-step, /fvgsd-deploy and /fvgsd-handoff', () => {
  for (const [name, spec] of Object.entries(COMMANDS)) {
    test(`${name}: frontmatter, branch guard and the agents it spawns`, () => {
      const content = command(name);
      const fm = parseFrontmatter(content);
      assert.equal(fm.name, `fvgsd:${name}`);
      assert.equal(fm['argument-hint'], spec.hint);
      assert.match(content, new RegExp(`execution-branch ensure "${name}"`));
      for (const agent of spec.agents) {
        assert.match(content, new RegExp(`subagent_type="${agent}"`), `${name} spawns ${agent}`);
      }
      assert.match(content, /resolve-model <agent> --pick model/);
    });
  }

  test('step builds through /fvgsd-build, reuses passing build checks and keeps one approval', () => {
    const content = command('step');
    assert.match(content, /Skill\(skill="fvgsd-build", args="\{phase\}"\)/);
    assert.match(content, /fvgsd\/build\/\{P\}\/latest\.json/);
    assert.match(content, /build\.run-checks --set full --label dod --phase \{phase\} --tail 20/);
    assert.match(content, /This is the step's one approval/);
    assert.match(content, /never reads the spec itself/);
  });

  test('deploy and step never push without asking', () => {
    for (const name of ['step', 'deploy']) {
      assert.match(command(name), /ask whether to push HEAD/, name);
    }
  });

  test('handoff reads pack.handoff_path with a default so an unset key does not fail', () => {
    assert.match(command('handoff'), /config-get pack\.handoff_path --default ""/);
  });
});

describe('/fvgsd-pause-work records the pause in the handoff notes', () => {
  test('the command may spawn agents and names the handoff keeper', () => {
    const content = command('pause-work');
    const frontmatter = content.slice(0, content.indexOf('\n---', 3));
    assert.match(frontmatter, /^allowed-tools:\n(?: {2}- \w+\n)*? {2}- Agent$/m);
    assert.match(content, /fvgsd-handoff-keeper/);
  });

  test('the workflow spawns the keeper only when pack.handoff_path is set, before confirm', () => {
    const workflow = fs.readFileSync(path.join(ROOT, 'get-shit-done', 'workflows', 'pause-work.md'), 'utf8');
    const steps = [...workflow.matchAll(/<step name="([^"]+)">/g)].map((m) => m[1]);
    assert.ok(steps.indexOf('handoff_notes') > steps.indexOf('commit'), 'after commit');
    assert.ok(steps.indexOf('handoff_notes') < steps.indexOf('confirm'), 'before confirm');
    const body = workflow.slice(workflow.indexOf('<step name="handoff_notes">'), workflow.indexOf('<step name="confirm">'));
    assert.match(body, /config-get pack\.handoff_path --default ""/);
    assert.match(body, /subagent_type="fvgsd-handoff-keeper"/);
    assert.match(body, /HANDOFF\.json and `\.continue-here\.md` stay as written/);
  });
});

describe('repo-session profile stages the step commands and their agents', () => {
  test('includes step, deploy and handoff and the four specialist agents', () => {
    const resolved = resolveProfile({ modes: ['repo-session'], manifest: loadSkillsManifest(COMMANDS_DIR) });
    for (const skill of ['step', 'deploy', 'handoff', 'pack', 'dod', 'build']) assert.ok(resolved.skills.has(skill), skill);
    for (const agent of COMMANDS.step.agents) assert.ok(resolved.agents.has(agent), agent);
  });
});
