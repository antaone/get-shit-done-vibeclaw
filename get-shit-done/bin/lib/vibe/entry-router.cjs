'use strict';

const fs = require('node:fs');
const path = require('node:path');
const IDENTITY = require('../identity.cjs');
const { VibeOrchestrator } = require('./orchestrator.cjs');
const { VibeStore, atomicWrite } = require('./store.cjs');
const { VibeError, invariant } = require('./errors.cjs');
const { formatGsdSlash } = require('../runtime-slash.cjs');
const git = require('./git.cjs');

const COMMAND_PREFIX_RE = new RegExp(`^${IDENTITY.commandPrefix}(?::|-)`);

const LIFECYCLE_ENTRIES = Object.freeze({
  'new-project': Object.freeze({ workflow: 'project-bootstrap', stage: 'project' }),
  'new-milestone': Object.freeze({ workflow: 'milestone-bootstrap', stage: 'milestone' }),
  'discuss-phase': Object.freeze({ workflow: 'feature-development', stage: 'discuss' }),
  'plan-phase': Object.freeze({ workflow: 'feature-development', stage: 'plan' }),
  'execute-phase': Object.freeze({ workflow: 'feature-development', stage: 'execute' }),
  'verify-work': Object.freeze({ workflow: 'feature-development', stage: 'verify' }),
  review: Object.freeze({ workflow: 'feature-development', stage: 'review' }),
  build: Object.freeze({ workflow: 'feature-build', stage: 'build' }),
});

const DIRECT_COMMANDS = new Set([
  'config',
  'help',
  'settings',
  'surface',
  'update',
  'vibe',
]);

const COMMAND_DESCRIPTIONS = Object.freeze({
  quick: 'Execute a compact GSD task with candidate isolation and explicit promotion.',
  fast: 'Execute a small inline change in an isolated candidate.',
  debug: 'Diagnose or fix a defect with durable Vibe candidate provenance.',
  autonomous: 'Run the autonomous GSD workflow inside an isolated candidate.',
  'code-review': 'Review code, and optionally fix findings, in an isolated candidate.',
  'audit-fix': 'Apply audit fixes in an isolated candidate.',
  'secure-phase': 'Run the security workflow in an isolated candidate.',
  'ui-phase': 'Run the UI implementation workflow in an isolated candidate.',
  'ui-review': 'Run UI review and any requested corrections in an isolated candidate.',
  'docs-update': 'Update project documentation in an isolated candidate.',
  'map-codebase': 'Generate codebase intelligence without mixing competing candidates.',
  explore: 'Explore and persist an idea as an isolated candidate result.',
  spike: 'Run a bounded feasibility spike in an isolated candidate.',
  sketch: 'Produce a design sketch in an isolated candidate.',
  forensics: 'Investigate workflow failures and persist a forensic report.',
  'add-tests': 'Add focused test coverage in an isolated candidate.',
});

const LEGACY_COMMAND_REFERENCE = /(?<![A-Za-z0-9_:/-])([/$])gsd([:-])([a-z][a-z0-9-]*)(?=$|[^A-Za-z0-9_-])/gi;
const LEGACY_NON_COMMAND_TOKENS = new Set(['sdk', 'tools']);

function normalizeRuntime(value) {
  return String(value || process.env.FVGSD_RUNTIME || 'claude').trim().toLowerCase() || 'claude';
}

function planningMarkdownFiles(projectRoot) {
  const planningRoot = path.join(path.resolve(projectRoot), '.planning');
  if (!fs.existsSync(planningRoot)) return [];
  invariant(!fs.lstatSync(planningRoot).isSymbolicLink(), 'PLANNING_PATH_UNSAFE', 'Legacy command migration will not traverse a symbolic-link .planning directory', {
    path: planningRoot,
  });

  const files = [];
  const pending = [planningRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(target);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function lineAndColumn(content, offset) {
  const before = content.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function rewriteLegacyCommandReferences(content, runtime) {
  const references = [];
  const rewritten = String(content).replace(
    LEGACY_COMMAND_REFERENCE,
    (legacy, _sigil, _separator, command, offset) => {
      const normalizedCommand = command.toLowerCase();
      if (LEGACY_NON_COMMAND_TOKENS.has(normalizedCommand)) return legacy;
      const replacement = formatGsdSlash(normalizedCommand, runtime);
      const position = lineAndColumn(content, offset);
      references.push({
        ...position,
        command: normalizedCommand,
        legacy,
        replacement,
      });
      return replacement;
    },
  );
  return { content: rewritten, references };
}

function planLegacyPlanningCommandMigration(projectRoot, runtime) {
  const root = path.resolve(projectRoot);
  const effectiveRuntime = normalizeRuntime(runtime);
  const files = planningMarkdownFiles(root);
  const changes = [];
  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8');
    const rewritten = rewriteLegacyCommandReferences(before, effectiveRuntime);
    if (rewritten.references.length === 0) continue;
    changes.push({
      path: file,
      relative_path: path.relative(root, file).split(path.sep).join('/'),
      before,
      after: rewritten.content,
      references: rewritten.references,
    });
  }
  return { root, runtime: effectiveRuntime, scanned_files: files.length, changes };
}

function publicMigrationReport(plan, migrated = false) {
  return {
    schema_version: 1,
    runtime: plan.runtime,
    planning_dir: path.join(plan.root, '.planning'),
    scanned_files: plan.scanned_files,
    affected_files: plan.changes.map((change) => ({
      path: change.relative_path,
      reference_count: change.references.length,
      references: change.references,
    })),
    total_references: plan.changes.reduce((total, change) => total + change.references.length, 0),
    migrated,
  };
}

function inspectLegacyPlanningCommands(projectRoot, options = {}) {
  return publicMigrationReport(planLegacyPlanningCommandMigration(projectRoot, options.runtime));
}

function migrateLegacyPlanningCommands(projectRoot, options = {}) {
  const plan = planLegacyPlanningCommandMigration(projectRoot, options.runtime);
  if (options.dryRun || plan.changes.length === 0) return publicMigrationReport(plan, false);
  const writeFile = options.writeFile || atomicWrite;
  const written = [];
  try {
    for (const change of plan.changes) {
      writeFile(change.path, change.after);
      written.push(change);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const change of written.reverse()) {
      try { writeFile(change.path, change.before); } catch (rollbackError) {
        rollbackFailures.push({ path: change.relative_path, message: rollbackError.message });
      }
    }
    throw new VibeError('PLANNING_COMMAND_MIGRATION_FAILED', 'Could not migrate legacy command references; previously written files were rolled back', {
      cause: error.message,
      rollback_failures: rollbackFailures,
    });
  }
  return publicMigrationReport(plan, true);
}

function normalizeCommand(value) {
  let command = String(value || '').trim().toLowerCase();
  command = command.replace(/^\$/, '').replace(/^\//, '');
  command = command.replace(COMMAND_PREFIX_RE, '');
  command = command.replace(/^gsd(?::|-)/, '');
  invariant(/^[a-z][a-z0-9-]*$/.test(command), 'COMMAND_INVALID', `Invalid fvgsd command '${value || ''}'`);
  return command;
}

function resolveCommandEntry(value) {
  const command = normalizeCommand(value);
  const lifecycle = LIFECYCLE_ENTRIES[command];
  if (lifecycle) {
    return {
      command,
      orchestratable: true,
      kind: 'lifecycle',
      workflow: lifecycle.workflow,
      stage: lifecycle.stage,
      generated_workflow: false,
    };
  }
  if (DIRECT_COMMANDS.has(command)) {
    return {
      command,
      orchestratable: false,
      kind: 'control',
      workflow: null,
      stage: null,
      generated_workflow: false,
    };
  }
  return {
    command,
    orchestratable: true,
    kind: 'command',
    workflow: `${command}-workflow`,
    stage: 'task',
    generated_workflow: true,
  };
}

function commandWorkflow(entry) {
  invariant(entry.kind === 'command', 'COMMAND_WORKFLOW_INVALID', `Command '${entry.command}' does not use a generated workflow`);
  return {
    version: 1,
    name: entry.workflow,
    description: `Vibe-managed execution of /fvgsd:${entry.command}.`,
    stages: {
      task: {
        description: COMMAND_DESCRIPTIONS[entry.command] || `Run /fvgsd:${entry.command} and persist its requested result.`,
        mutates_source: true,
        requires_result_commit: false,
        requires_git_candidate: true,
        input: { required: false, promoted_stages: [] },
        output: ['workflow_artifacts', 'source_commit_when_changed', 'summary'],
        completion: [
          `the /fvgsd:${entry.command} workflow completed`,
          'requested artifacts and source changes persisted',
          'relevant checks run when source changed',
          'candidate summary written',
          'all candidate changes committed when tracked',
        ],
        gsd: { command: `${IDENTITY.commandPrefix}:${entry.command}` },
      },
    },
  };
}

function findStore(cwd) {
  try {
    return VibeStore.discover(cwd);
  } catch (error) {
    if (error instanceof VibeError && error.code === 'NOT_INITIALIZED') return null;
    throw error;
  }
}

function inspectRepository(cwd, gitOptions = {}) {
  let root;
  try {
    root = git.ensureRepository(cwd, gitOptions);
  } catch (error) {
    if (error instanceof VibeError && error.code === 'GIT_REQUIRED') {
      return { available: false, root: null, head: null, branch: null, reason: 'git_repository_required' };
    }
    throw error;
  }
  let head = null;
  let branch = null;
  try { head = git.resolveCommit(root, 'HEAD', gitOptions); } catch (error) {
    if (!(error instanceof VibeError && error.code === 'GIT_COMMIT_UNKNOWN')) throw error;
  }
  try { branch = git.currentBranch(root, gitOptions); } catch (error) {
    if (!(error instanceof VibeError && error.code === 'GIT_DETACHED')) throw error;
  }
  const dirty = head ? git.sourceDirty(root, gitOptions) : [];
  return { available: true, root, head, branch, dirty, reason: head ? null : 'git_baseline_required' };
}

function candidateForWorktree(store, repoRoot) {
  const matches = store.listCandidateIds()
    .map((id) => store.loadCandidate(id))
    .filter((candidate) => candidate.git && candidate.git.worktree
      && path.resolve(candidate.git.worktree) === path.resolve(repoRoot));
  return matches.length === 1 ? matches[0] : null;
}

function summarizeExistingCandidates(orchestrator, run, stage) {
  const state = run.stages && run.stages[stage];
  if (!state || !Array.isArray(state.candidates)) return [];
  return state.candidates.map((id) => {
    const candidate = orchestrator.loadCandidate(id);
    return {
      id: candidate.id,
      tool: candidate.tool.id,
      status: candidate.status,
      worktree: candidate.git.worktree,
      branch: candidate.git.branch,
    };
  });
}

function inspectVibeEntry(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const entry = resolveCommandEntry(options.command);
  if (!entry.orchestratable) {
    return {
      ...entry,
      action: 'continue-direct',
      reason: 'control_command',
      message: `/fvgsd:${entry.command} manages the local GSD/Vibe surface and does not need a candidate.`,
    };
  }

  const repository = inspectRepository(cwd, options.gitOptions);
  if (!repository.available) {
    return {
      ...entry,
      action: 'initialize-git',
      reason: repository.reason,
      repository,
      message: 'Vibe orchestration needs a Git repository and a baseline commit before candidates can be created.',
    };
  }
  if (!repository.head) {
    return {
      ...entry,
      action: 'create-baseline',
      reason: repository.reason,
      repository,
      message: 'Create a reviewed baseline commit before preparing Vibe candidates.',
    };
  }

  const store = findStore(cwd);
  if (!store) {
    const legacyPlanningCommands = inspectLegacyPlanningCommands(repository.root, { runtime: options.runtime });
    if (repository.dirty.length === 0 && legacyPlanningCommands.total_references > 0) {
      return {
        ...entry,
        action: 'migrate-planning-commands',
        reason: 'legacy_planning_command_namespace',
        repository,
        legacy_planning_commands: legacyPlanningCommands,
        message: `Found ${legacyPlanningCommands.total_references} legacy GSD command reference(s) in ${legacyPlanningCommands.affected_files.length} committed planning file(s). Review and migrate them before preparing Vibe candidates.`,
      };
    }
    return {
      ...entry,
      action: 'choose-mode',
      reason: 'vibe_not_initialized',
      repository,
      choices: ['direct', 'vibe-single', 'vibe-multi'],
      vibe_requires_baseline: repository.dirty.length > 0,
      message: repository.dirty.length > 0
        ? 'This command can run directly; Vibe candidate modes first need the pending integration changes reviewed and committed or otherwise resolved.'
        : 'This command can run directly or through one or more isolated Vibe candidates.',
    };
  }

  const orchestrator = new VibeOrchestrator({ projectRoot: store.projectRoot, store, gitOptions: options.gitOptions });
  const coordination = orchestrator.mode();
  const candidate = candidateForWorktree(store, repository.root);
  if (candidate) {
    const assigned = normalizeCommand(candidate.contract && candidate.contract.gsd && candidate.contract.gsd.command || 'unknown');
    const matches = assigned === entry.command;
    const active = ['prepared', 'running'].includes(candidate.status);
    return {
      ...entry,
      action: matches && active ? 'continue-candidate' : 'return-integration',
      reason: !matches ? 'candidate_command_mismatch' : active ? 'matching_candidate' : 'candidate_not_active',
      repository,
      coordination,
      project_root: store.projectRoot,
      candidate: {
        id: candidate.id,
        command: assigned,
        tool: candidate.tool.id,
        status: candidate.status,
        worktree: candidate.git.worktree,
        branch: candidate.git.branch,
      },
      message: matches && active
        ? `Continue /fvgsd:${entry.command} inside Vibe candidate '${candidate.id}'.`
        : !matches
          ? `This worktree belongs to /fvgsd:${assigned}; return to '${store.projectRoot}' to prepare /fvgsd:${entry.command}.`
          : `Candidate '${candidate.id}' is ${candidate.status}; return to '${store.projectRoot}' to inspect or prepare further work.`,
    };
  }

  if (repository.dirty.length > 0) {
    return {
      ...entry,
      action: 'create-baseline',
      reason: 'integration_worktree_dirty',
      repository,
      coordination,
      project_root: store.projectRoot,
      message: 'Review and commit or otherwise resolve integration-worktree changes before preparing Vibe candidates.',
    };
  }

  const legacyPlanningCommands = inspectLegacyPlanningCommands(repository.root, { runtime: options.runtime });
  if (legacyPlanningCommands.total_references > 0) {
    return {
      ...entry,
      action: 'migrate-planning-commands',
      reason: 'legacy_planning_command_namespace',
      repository,
      coordination,
      project_root: store.projectRoot,
      legacy_planning_commands: legacyPlanningCommands,
      message: `Found ${legacyPlanningCommands.total_references} legacy GSD command reference(s) in ${legacyPlanningCommands.affected_files.length} committed planning file(s). Review and migrate them before preparing Vibe candidates.`,
    };
  }

  let activeRun = null;
  const activeRunId = store.loadActiveRunId();
  if (activeRunId) activeRun = orchestrator.loadRun(activeRunId);
  const reusable = activeRun && activeRun.status === 'active'
    && activeRun.workflow === entry.workflow
    && activeRun.workflow_snapshot.stages[entry.stage];
  const conflict = activeRun && activeRun.status === 'active' && !reusable;
  return {
    ...entry,
    action: conflict ? 'resolve-active-run' : 'prepare',
    reason: reusable ? 'active_run_matches' : conflict ? 'active_run_conflict' : 'vibe_integration_worktree',
    repository,
    coordination,
    project_root: store.projectRoot,
    run: activeRun ? { id: activeRun.id, workflow: activeRun.workflow, status: activeRun.status } : null,
    reuse_active_run: Boolean(reusable),
    existing_candidates: reusable ? summarizeExistingCandidates(orchestrator, activeRun, entry.stage) : [],
    choices: conflict ? ['resume-active', 'finish-active', 'start-new-run'] : ['vibe-single', 'vibe-multi'],
    message: reusable
      ? `Prepare one or more '${entry.stage}' candidates in active run '${activeRun.id}'.`
      : conflict
        ? `Active run '${activeRun.id}' uses '${activeRun.workflow}'. Resolve it or explicitly name a new run before starting '${entry.workflow}'.`
        : `Start '${entry.workflow}' and prepare one or more isolated candidates before running /fvgsd:${entry.command}.`,
  };
}

function ensureGeneratedWorkflow(orchestrator, entry) {
  if (!entry.generated_workflow) return orchestrator.loadWorkflow(entry.workflow);
  const workflowPath = orchestrator.workflowPath(entry.workflow);
  if (!fs.existsSync(workflowPath)) {
    orchestrator.store.writeYaml(workflowPath, commandWorkflow(entry));
  }
  const workflow = orchestrator.loadWorkflow(entry.workflow);
  invariant(
    workflow.stages[entry.stage] && normalizeCommand(workflow.stages[entry.stage].gsd.command) === entry.command,
    'COMMAND_WORKFLOW_MISMATCH',
    `Workflow '${entry.workflow}' does not route to /fvgsd:${entry.command}`,
  );
  return workflow;
}

function prepareVibeEntry(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const entry = resolveCommandEntry(options.command);
  invariant(entry.orchestratable, 'COMMAND_NOT_ORCHESTRATABLE', `/fvgsd:${entry.command} runs directly and cannot be prepared as a candidate`);
  const repository = inspectRepository(cwd, options.gitOptions);
  invariant(repository.available, 'GIT_REQUIRED', 'Initialize Git before preparing Vibe candidates');
  invariant(repository.head, 'GIT_COMMIT_UNKNOWN', 'Create a reviewed baseline commit before preparing Vibe candidates');
  invariant(repository.branch, 'GIT_DETACHED', 'Check out an integration branch before preparing Vibe candidates');
  invariant(repository.dirty.length === 0, 'INTEGRATION_DIRTY', 'Review and commit or otherwise resolve integration-worktree changes before preparing Vibe candidates', {
    files: repository.dirty,
  });
  const legacyPlanningCommands = inspectLegacyPlanningCommands(repository.root, { runtime: options.runtime });
  invariant(
    legacyPlanningCommands.total_references === 0,
    'LEGACY_PLANNING_COMMANDS',
    `Migrate ${legacyPlanningCommands.total_references} legacy GSD command reference(s) before preparing Vibe candidates`,
    {
      legacy_planning_commands: legacyPlanningCommands,
      hint: `Run vibe entry migrate ${entry.command} --runtime ${legacyPlanningCommands.runtime}, review the diff, and commit the migration.`,
    },
  );

  let store = findStore(cwd);
  let orchestrator;
  let initialized = null;
  if (!store) {
    orchestrator = new VibeOrchestrator({ projectRoot: repository.root, gitOptions: options.gitOptions });
    initialized = orchestrator.initialize();
    store = orchestrator.store;
  } else {
    orchestrator = new VibeOrchestrator({ projectRoot: store.projectRoot, store, gitOptions: options.gitOptions });
  }
  invariant(
    path.resolve(repository.root) === path.resolve(orchestrator.projectRoot),
    'INTEGRATION_WORKTREE_REQUIRED',
    'Prepare new candidates from the Vibe integration worktree, not from an existing candidate worktree',
  );

  if (options.coordinationMode) {
    orchestrator.setMode(options.coordinationMode, { remote: options.remote });
  }

  ensureGeneratedWorkflow(orchestrator, entry);
  const previousActiveRunId = store.loadActiveRunId();
  let run = null;
  let startedNewRun = false;
  if (options.runId) {
    run = orchestrator.loadRun(options.runId);
    invariant(run.workflow === entry.workflow, 'RUN_WORKFLOW_MISMATCH', `Run '${run.id}' uses '${run.workflow}', not '${entry.workflow}'`);
    orchestrator.resumeRun(run.id);
  } else if (previousActiveRunId) {
    const active = orchestrator.loadRun(previousActiveRunId);
    if (active.status === 'active' && active.workflow === entry.workflow && active.workflow_snapshot.stages[entry.stage]) {
      run = active;
    } else if (active.status === 'active') {
      invariant(
        options.id,
        'ACTIVE_RUN_CONFLICT',
        `Active run '${active.id}' uses '${active.workflow}'; finish it, resume it explicitly, or pass --id after choosing to start a new '${entry.workflow}' run`,
      );
    }
  }
  if (!run) {
    run = orchestrator.startRun(entry.workflow, {
      id: options.id || null,
      route: options.route || null,
      base: options.base || null,
      entryStage: entry.kind === 'lifecycle' ? entry.stage : null,
    });
    startedNewRun = true;
  }

  const tools = Array.isArray(options.tools) ? options.tools.filter(Boolean) : [];
  const requestedTools = tools.length > 0 ? tools : [options.tool || null];
  const prepared = requestedTools.map((tool) => orchestrator.prepareStage(entry.stage, {
    runId: run.id,
    tool,
    env: options.env || process.env,
    // fvgsd-vibe is an explicit workflow entry selector. Starting at plan,
    // execute, verify, or review consumes the reviewed integration base when
    // there is no earlier Vibe promotion; ordinary stage preparation keeps
    // the stricter promotion requirement.
    allowUnpromotedInput: entry.kind === 'lifecycle' && startedNewRun,
  }));
  const candidates = prepared.map(({ candidate, context }) => ({
    id: candidate.id,
    tool: candidate.tool.id,
    status: candidate.status,
    branch: candidate.git.branch,
    worktree: candidate.git.worktree,
    context: context.context_file,
    invocation: context.gsd.invocation,
    completion_command: context.completion_command,
    promotion_command: context.promotion_command,
    handoff: context.handoff,
  }));
  const coordination = orchestrator.mode();
  return {
    schema_version: 1,
    command: entry.command,
    workflow: entry.workflow,
    stage: entry.stage,
    initialized: Boolean(initialized),
    initialization: initialized,
    previous_active_run_id: previousActiveRunId,
    run: { id: run.id, workflow: run.workflow, route: run.route, base_commit: run.base_commit, coordination },
    candidates,
    next_action: coordination.multi_machine
      ? 'On each worker, fetch the handoff, check out its candidate branch, run the assigned fvgsd command, commit, and push. Then complete, compare, and promote from the coordinator.'
      : candidates.length === 1
        ? 'Run the assigned fvgsd command in the candidate worktree, then complete and promote it.'
        : 'Run each candidate independently, complete them, compare their results, and promote one.',
  };
}

module.exports = {
  LIFECYCLE_ENTRIES,
  DIRECT_COMMANDS,
  normalizeCommand,
  resolveCommandEntry,
  commandWorkflow,
  inspectLegacyPlanningCommands,
  migrateLegacyPlanningCommands,
  inspectVibeEntry,
  prepareVibeEntry,
};
