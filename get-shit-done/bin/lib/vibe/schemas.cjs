'use strict';

const IDENTITY = require('../identity.cjs');
const { invariant, VibeError } = require('./errors.cjs');

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TOOL_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const STAGE_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

function assertObject(value, label) {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'SCHEMA_INVALID', `${label} must be a mapping`);
}

function assertId(value, label, pattern = ID_PATTERN) {
  invariant(typeof value === 'string' && pattern.test(value), 'SCHEMA_INVALID', `${label} must use lowercase letters, numbers, and hyphens`);
  return value;
}

function normalizeConfig(value) {
  assertObject(value, 'config');
  invariant(value.version === 1, 'SCHEMA_INVALID', 'config.version must be 1');
  const defaultRoute = assertId(value.default_route, 'config.default_route');
  const git = value.git || {};
  assertObject(git, 'config.git');
  invariant(git.candidate_branches !== false, 'SCHEMA_INVALID', 'config.git.candidate_branches must be true in schema version 1');
  const worktrees = git.worktrees ?? 'auto';
  invariant(['auto', 'always', 'never'].includes(worktrees), 'SCHEMA_INVALID', 'config.git.worktrees must be auto, always, or never');
  const worktreeRoot = String(git.worktree_root || IDENTITY.vibeWorktreeRoot).replace(/\\/g, '/');
  invariant(
    worktreeRoot === IDENTITY.vibeWorktreeRoot || worktreeRoot.startsWith(`${IDENTITY.vibeWorktreeRoot}/`),
    'SCHEMA_INVALID',
    `config.git.worktree_root must stay under ${IDENTITY.vibeWorktreeRoot}`,
  );
  const promotionStrategy = String(git.promotion_strategy || 'fast-forward');
  invariant(promotionStrategy === 'fast-forward', 'SCHEMA_INVALID', 'Only fast-forward promotion is supported in schema version 1');
  const multiMachine = git.multi_machine === true;
  const remote = String(git.remote || 'origin').trim();
  invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(remote), 'SCHEMA_INVALID', 'config.git.remote must be a simple Git remote name');
  const promotion = value.promotion || {};
  assertObject(promotion, 'config.promotion');
  invariant((promotion.mode ?? 'manual') === 'manual', 'SCHEMA_INVALID', 'Only manual promotion is supported in schema version 1');
  return {
    version: 1,
    project_name: String(value.project_name || ''),
    default_route: defaultRoute,
    git: {
      candidate_branches: git.candidate_branches !== false,
      worktrees,
      worktree_root: worktreeRoot,
      promotion_strategy: promotionStrategy,
      multi_machine: multiMachine,
      remote,
    },
    promotion: { mode: 'manual' },
  };
}

function normalizeRoute(value, knownTools) {
  assertObject(value, 'route');
  invariant((value.version ?? 1) === 1, 'SCHEMA_INVALID', 'route.version must be 1');
  const name = assertId(value.name, 'route.name');
  assertObject(value.stages, 'route.stages');
  const stages = {};
  for (const [stage, assignment] of Object.entries(value.stages)) {
    assertId(stage, `route.stages.${stage}`, STAGE_PATTERN);
    const tool = typeof assignment === 'string' ? assignment : assignment && assignment.tool;
    assertId(tool, `route.stages.${stage}.tool`, TOOL_PATTERN);
    if (knownTools && !knownTools.has(tool)) {
      throw new VibeError('TOOL_UNKNOWN', `Route '${name}' references unknown tool '${tool}'`, { route: name, stage, tool });
    }
    stages[stage] = { tool };
  }
  return { version: value.version ?? 1, name, description: String(value.description || ''), stages };
}

const GSD_ARG_PATTERN = /^--[a-z][a-z0-9-]*$/;

function normalizeGsd(raw, stage) {
  if (!raw || typeof raw !== 'object') return { command: '' };
  const args = raw.args ?? [];
  invariant(
    Array.isArray(args) && args.every((arg) => typeof arg === 'string' && GSD_ARG_PATTERN.test(arg)),
    'SCHEMA_INVALID',
    `workflow.stages.${stage}.gsd.args must be a list of --flag values`,
  );
  return { command: String(raw.command || ''), ...(args.length ? { args: [...args] } : {}) };
}

function normalizeWorkflow(value) {
  assertObject(value, 'workflow');
  invariant((value.version ?? 1) === 1, 'SCHEMA_INVALID', 'workflow.version must be 1');
  const name = assertId(value.name, 'workflow.name');
  assertObject(value.stages, 'workflow.stages');
  const stages = {};
  for (const [stage, raw] of Object.entries(value.stages)) {
    assertId(stage, `workflow.stages.${stage}`, STAGE_PATTERN);
    assertObject(raw, `workflow.stages.${stage}`);
    const input = raw.input || {};
    assertObject(input, `workflow.stages.${stage}.input`);
    let promotedStages = input.promoted_stages ?? [];
    if (typeof promotedStages === 'string') promotedStages = [promotedStages];
    invariant(Array.isArray(promotedStages), 'SCHEMA_INVALID', `workflow.stages.${stage}.input.promoted_stages must be a list`);
    invariant(!(input.required === true && promotedStages.length === 0), 'SCHEMA_INVALID', `workflow.stages.${stage} requires at least one promoted input stage`);
    promotedStages.forEach((item) => assertId(item, `workflow.stages.${stage}.input.promoted_stages`, STAGE_PATTERN));
    const output = raw.output ?? [];
    invariant(Array.isArray(output), 'SCHEMA_INVALID', `workflow.stages.${stage}.output must be a list`);
    stages[stage] = {
      description: String(raw.description || ''),
      optional: raw.optional === true,
      mutates_source: raw.mutates_source === true,
      requires_result_commit: raw.requires_result_commit === undefined
        ? raw.mutates_source === true
        : raw.requires_result_commit === true,
      requires_git_candidate: raw.requires_git_candidate !== false,
      input: {
        required: input.required !== false && promotedStages.length > 0,
        promoted_stages: promotedStages,
      },
      output: output.map(String),
      completion: Array.isArray(raw.completion) ? raw.completion.map(String) : [],
      gsd: normalizeGsd(raw.gsd, stage),
    };
  }
  invariant(Object.keys(stages).length > 0, 'SCHEMA_INVALID', `Workflow '${name}' must define at least one stage`);
  for (const [stage, contract] of Object.entries(stages)) {
    for (const inputStage of contract.input.promoted_stages) {
      invariant(stages[inputStage], 'SCHEMA_INVALID', `Stage '${stage}' references unknown input stage '${inputStage}'`);
      invariant(
        Object.keys(stages).indexOf(inputStage) < Object.keys(stages).indexOf(stage),
        'SCHEMA_INVALID',
        `Stage '${stage}' must reference an earlier input stage, not '${inputStage}'`,
      );
    }
  }
  return { version: value.version ?? 1, name, description: String(value.description || ''), stages };
}

function assertRun(value) {
  assertObject(value, 'run manifest');
  invariant(value.schema_version === 1, 'STATE_CORRUPT', 'Run manifest schema_version must be 1');
  assertId(value.id, 'run.id');
  invariant(value.workflow_snapshot && value.route_snapshot, 'STATE_CORRUPT', `Run '${value.id}' is missing route/workflow snapshots`);
  return value;
}

function assertCandidate(value) {
  assertObject(value, 'candidate manifest');
  invariant(value.schema_version === 1, 'STATE_CORRUPT', 'Candidate manifest schema_version must be 1');
  assertId(value.id, 'candidate.id');
  assertId(value.run_id, 'candidate.run_id');
  assertId(value.stage, 'candidate.stage', STAGE_PATTERN);
  invariant(value.tool && typeof value.tool.id === 'string', 'STATE_CORRUPT', `Candidate '${value.id}' has no tool identity`);
  invariant(value.git && Object.prototype.hasOwnProperty.call(value.git, 'base_commit'), 'STATE_CORRUPT', `Candidate '${value.id}' has no Git provenance`);
  return value;
}

module.exports = {
  ID_PATTERN,
  TOOL_PATTERN,
  STAGE_PATTERN,
  assertId,
  normalizeConfig,
  normalizeRoute,
  normalizeWorkflow,
  assertRun,
  assertCandidate,
};
