'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const IDENTITY = require('../identity.cjs');
const { VibeStore } = require('./store.cjs');
const { createDefaultRegistry, renderCommand } = require('./adapters.cjs');
const { formatGsdSlash } = require('../runtime-slash.cjs');
const { discoverStandaloneExecutions } = require('../execution-branch.cjs');
const {
  assertId,
  normalizeConfig,
  normalizeRoute,
  normalizeWorkflow,
  assertRun,
  assertCandidate,
} = require('./schemas.cjs');
const git = require('./git.cjs');
const { VibeError, invariant } = require('./errors.cjs');

function iso(now) { return new Date(now).toISOString(); }
function toPosix(value) { return String(value).split(path.sep).join('/'); }

function within(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

class VibeOrchestrator {
  constructor(options = {}) {
    this.projectRoot = path.resolve(options.projectRoot || process.cwd());
    this.store = options.store || new VibeStore(this.projectRoot, options.storeOptions);
    this.registry = options.registry || createDefaultRegistry();
    this.now = options.now || (() => Date.now());
    this.gitOptions = options.gitOptions || {};
  }

  static discover(startDir, options = {}) {
    const store = VibeStore.discover(startDir, options.storeOptions);
    return new VibeOrchestrator({ ...options, projectRoot: store.projectRoot, store });
  }

  event(type, data = {}) {
    return {
      schema_version: 1,
      id: crypto.randomUUID(),
      type,
      occurred_at: iso(this.now()),
      actor: { type: 'human', id: process.env.USER || process.env.USERNAME || 'operator' },
      data,
    };
  }

  initialize() {
    const existed = this.store.exists();
    this.store.initialize();
    return this.store.withLock('orchestration', () => {
      const configPath = this.store.paths.config;
      if (!fs.existsSync(configPath)) {
        this.store.writeYaml(configPath, {
          version: 1,
          project_name: path.basename(this.projectRoot),
          default_route: 'cheap',
          git: {
            candidate_branches: true,
            worktrees: 'auto',
            worktree_root: IDENTITY.vibeWorktreeRoot,
            promotion_strategy: 'fast-forward',
            multi_machine: false,
            remote: 'origin',
          },
          promotion: { mode: 'manual' },
        });
      } else {
        this.loadConfig();
      }

      const templateRoot = path.resolve(__dirname, '..', '..', '..', 'vibe', 'templates');
      const copied = [];
      for (const [kind, name] of [
        ['routes', 'cheap.yaml'],
        ['routes', 'quality.yaml'],
        ['workflows', 'feature-development.yaml'],
        ['workflows', 'feature-build.yaml'],
        ['workflows', 'project-bootstrap.yaml'],
        ['workflows', 'milestone-bootstrap.yaml'],
      ]) {
        const source = path.join(templateRoot, kind, name);
        const destination = path.join(this.store.root, kind, name);
        if (!fs.existsSync(destination)) {
          invariant(fs.existsSync(source), 'TEMPLATE_MISSING', `Bundled VibeClaw template is missing: ${source}`);
          fs.copyFileSync(source, destination);
          copied.push(toPosix(path.relative(this.projectRoot, destination)));
        }
      }
      this.listRoutes();
      this.listWorkflows();
      const exclude = git.ensurePrivateWorktreeExclude(this.projectRoot, this.gitOptions);
      const standaloneExecutions = discoverStandaloneExecutions(this.projectRoot, { gitOptions: this.gitOptions });
      const standaloneState = {
        schema_version: 1,
        discovered_at: iso(this.now()),
        executions: standaloneExecutions,
      };
      let standaloneChanged = true;
      if (fs.existsSync(this.store.paths.standaloneExecutions)) {
        const previous = this.store.readJson(this.store.paths.standaloneExecutions, 'Standalone execution state');
        standaloneChanged = JSON.stringify(previous.executions || []) !== JSON.stringify(standaloneExecutions);
        if (!standaloneChanged) standaloneState.discovered_at = previous.discovered_at || standaloneState.discovered_at;
      }
      if (standaloneChanged || !fs.existsSync(this.store.paths.standaloneExecutions)) {
        this.store.writeJson(this.store.paths.standaloneExecutions, standaloneState);
        if (standaloneExecutions.length > 0) {
          this.store.appendEvent(this.event('standalone-executions.discovered', {
            count: standaloneExecutions.length,
            branches: standaloneExecutions.map((execution) => execution.branch),
          }));
        }
      }
      if (!existed) this.store.appendEvent(this.event('project.initialized', { project_root: this.projectRoot }));
      return {
        initialized: true,
        already_initialized: existed,
        project_root: this.projectRoot,
        state_root: this.store.root,
        templates_created: copied,
        worktree_exclude: exclude,
        standalone_executions: standaloneExecutions,
        standalone_execution_state: this.store.paths.standaloneExecutions,
      };
    });
  }

  loadConfig() {
    return normalizeConfig(this.store.readYaml(this.store.paths.config, 'VibeClaw config'));
  }

  mode() {
    const config = this.loadConfig();
    return {
      mode: config.git.multi_machine ? 'multi-machine' : 'local',
      multi_machine: config.git.multi_machine,
      remote: config.git.remote,
    };
  }

  setMode(mode, options = {}) {
    invariant(['local', 'multi-machine'].includes(mode), 'MODE_INVALID', "Mode must be 'local' or 'multi-machine'");
    return this.store.withLock('orchestration', () => {
      const config = this.loadConfig();
      const nextMultiMachine = mode === 'multi-machine';
      const nextRemote = String(options.remote || config.git.remote || 'origin');
      const currentMode = config.git.multi_machine ? 'multi-machine' : 'local';
      const activeRunId = this.store.loadActiveRunId();
      if (activeRunId) {
        const activeRun = this.loadRun(activeRunId);
        const changesMode = currentMode !== mode || (nextMultiMachine && config.git.remote !== nextRemote);
        invariant(!(activeRun.status === 'active' && changesMode), 'MODE_ACTIVE_RUN', `Finish active run '${activeRun.id}' before changing the Vibe coordination mode`);
      }
      if (nextMultiMachine) git.ensureRemote(this.projectRoot, nextRemote, this.gitOptions);
      config.git.multi_machine = nextMultiMachine;
      config.git.remote = nextRemote;
      this.store.writeYaml(this.store.paths.config, config);
      const result = { mode, multi_machine: nextMultiMachine, remote: nextRemote };
      this.store.appendEvent(this.event('coordination.mode-selected', result));
      return result;
    });
  }

  routePath(name) {
    assertId(name, 'route name');
    return path.join(this.store.paths.routes, `${name}.yaml`);
  }

  workflowPath(name) {
    assertId(name, 'workflow name');
    return path.join(this.store.paths.workflows, `${name}.yaml`);
  }

  loadRoute(name) {
    const route = normalizeRoute(this.store.readYaml(this.routePath(name), `Route '${name}'`), new Set(this.registry.list().map((item) => item.id)));
    invariant(route.name === name, 'SCHEMA_INVALID', `Route filename '${name}' does not match route.name '${route.name}'`);
    return route;
  }

  listRoutes() {
    if (!fs.existsSync(this.store.paths.routes)) return [];
    return fs.readdirSync(this.store.paths.routes)
      .filter((name) => name.endsWith('.yaml'))
      .sort()
      .map((name) => this.loadRoute(name.slice(0, -5)));
  }

  useRoute(name) {
    const route = this.loadRoute(name);
    return this.store.withLock('orchestration', () => {
      const config = this.loadConfig();
      config.default_route = route.name;
      this.store.writeYaml(this.store.paths.config, config);
      this.store.appendEvent(this.event('route.selected', { route: route.name }));
      return route;
    });
  }

  loadWorkflow(name) {
    const workflow = normalizeWorkflow(this.store.readYaml(this.workflowPath(name), `Workflow '${name}'`));
    invariant(workflow.name === name, 'SCHEMA_INVALID', `Workflow filename '${name}' does not match workflow.name '${workflow.name}'`);
    return workflow;
  }

  listWorkflows() {
    if (!fs.existsSync(this.store.paths.workflows)) return [];
    return fs.readdirSync(this.store.paths.workflows)
      .filter((name) => name.endsWith('.yaml'))
      .sort()
      .map((name) => this.loadWorkflow(name.slice(0, -5)));
  }

  nextRunId(workflowName) {
    const prefix = workflowName.split('-')[0].slice(0, 24);
    const expression = new RegExp(`^${prefix}-(\\d{3})$`);
    const values = this.store.listRunIds()
      .map((id) => id.match(expression))
      .filter(Boolean)
      .map((match) => Number(match[1]));
    return `${prefix}-${String((values.length ? Math.max(...values) : 0) + 1).padStart(3, '0')}`;
  }

  startRun(workflowName, options = {}) {
    const workflow = this.loadWorkflow(workflowName);
    const config = this.loadConfig();
    const route = this.loadRoute(options.route || config.default_route);
    const stageOrder = Object.keys(workflow.stages);
    const entryIndex = options.entryStage ? stageOrder.indexOf(options.entryStage) : 0;
    invariant(entryIndex >= 0, 'STAGE_UNKNOWN', `Workflow '${workflow.name}' has no entry stage '${options.entryStage}'`);
    return this.store.withLock('orchestration', () => {
      const id = options.id || this.nextRunId(workflow.name);
      assertId(id, 'run id');
      invariant(!fs.existsSync(this.store.runPath(id)), 'RUN_EXISTS', `Run '${id}' already exists; use vibe run resume ${id}`);
      const repoRoot = git.ensureRepository(this.projectRoot, this.gitOptions);
      invariant(repoRoot === path.resolve(this.projectRoot), 'PROJECT_ROOT_MISMATCH', 'VibeClaw must be initialized at the Git worktree root');
      const baseCommit = git.resolveCommit(repoRoot, options.base || 'HEAD', this.gitOptions);
      const integrationBranch = git.currentBranch(repoRoot, this.gitOptions);
      const integrationHead = git.resolveCommit(repoRoot, 'HEAD', this.gitOptions);
      invariant(
        baseCommit === integrationHead,
        'RUN_BASE_MISMATCH',
        `Run base ${baseCommit} must match the current integration head ${integrationHead}`,
        { base_commit: baseCommit, integration_head: integrationHead, integration_branch: integrationBranch },
      );
      const timestamp = iso(this.now());
      const stages = {};
      for (const [index, stage] of stageOrder.entries()) {
        stages[stage] = { candidates: [], promoted_candidate_id: null };
        if (options.entryStage && index < entryIndex) {
          stages[stage].skipped = true;
          stages[stage].skip_reason = `run entered at '${options.entryStage}'`;
        }
      }
      const run = {
        schema_version: 1,
        id,
        workflow: workflow.name,
        workflow_snapshot: workflow,
        route: route.name,
        route_snapshot: route,
        status: 'active',
        base_commit: baseCommit,
        integration_branch: integrationBranch,
        coordination: {
          mode: config.git.multi_machine ? 'multi-machine' : 'local',
          remote: config.git.remote,
        },
        created_at: timestamp,
        updated_at: timestamp,
        stage_counters: {},
        stages,
        promotions: {},
      };
      if (options.entryStage) run.entry_stage = options.entryStage;
      this.store.saveRun(run);
      this.store.setActiveRun(id);
      this.store.appendEvent(this.event('run.started', {
        run_id: id,
        workflow: workflow.name,
        route: route.name,
        base_commit: baseCommit,
        integration_branch: integrationBranch,
        coordination_mode: run.coordination.mode,
        remote: run.coordination.remote,
        entry_stage: options.entryStage || null,
      }));
      return run;
    });
  }

  loadRun(runId = null) {
    const id = runId || this.store.loadActiveRunId();
    invariant(id, 'RUN_NOT_ACTIVE', 'No active workflow run; start or resume one first');
    return assertRun(this.store.loadRun(id));
  }

  resumeRun(runId) {
    const run = this.loadRun(runId);
    invariant(run.status === 'active', 'RUN_NOT_ACTIVE', `Run '${runId}' is ${run.status}`);
    return this.store.withLock('orchestration', () => {
      this.store.setActiveRun(runId);
      this.store.appendEvent(this.event('run.resumed', { run_id: runId }));
      return run;
    });
  }

  listRuns() {
    return this.store.listRunIds().map((id) => assertRun(this.store.loadRun(id)));
  }

  resolveInput(run, stage, options = {}) {
    const contract = run.workflow_snapshot.stages[stage];
    const order = Object.keys(run.workflow_snapshot.stages);
    const stageIndex = order.indexOf(stage);
    const allowed = new Set(contract.input.promoted_stages);
    let selected = null;
    for (let index = stageIndex - 1; index >= 0; index -= 1) {
      const candidateStage = order[index];
      if (!allowed.has(candidateStage)) continue;
      if (run.promotions[candidateStage]) {
        selected = run.promotions[candidateStage];
        break;
      }
    }
    if (contract.input.required && !selected && options.allowUnpromoted !== true) {
      throw new VibeError('INPUT_NOT_PROMOTED', `Stage '${stage}' requires a promoted input from: ${[...allowed].join(', ')}`);
    }
    if (!selected) return null;
    const candidate = assertCandidate(this.store.loadCandidate(selected.candidate_id));
    return {
      stage: selected.stage,
      candidate_id: selected.candidate_id,
      commit: selected.integration_commit,
      result_commit: selected.result_commit,
      artifacts: candidate.outputs.artifacts,
    };
  }

  resolveTool(run, stage, explicitTool, env = process.env) {
    if (explicitTool) return { tool: this.registry.get(explicitTool).id, source: 'explicit' };
    if (env.VIBE_TOOL) return this.registry.detect({ env, probeExecutables: false });
    const routeAssignment = run.route_snapshot.stages[stage];
    if (routeAssignment && routeAssignment.tool) return { tool: this.registry.get(routeAssignment.tool).id, source: `route:${run.route}` };
    const detected = this.registry.detect({ env, probeExecutables: true });
    invariant(detected.tool, 'TOOL_UNRESOLVED', `No tool assignment found for stage '${stage}'`);
    return detected;
  }

  prepareStage(stage, options = {}) {
    return this.store.withLock('orchestration', () => {
      const run = this.loadRun(options.runId);
      invariant(run.status === 'active', 'RUN_NOT_ACTIVE', `Run '${run.id}' is ${run.status}`);
      const contract = run.workflow_snapshot.stages[stage];
      invariant(contract, 'STAGE_UNKNOWN', `Workflow '${run.workflow}' has no stage '${stage}'`);
      const toolSelection = this.resolveTool(run, stage, options.tool, options.env || process.env);
      const input = this.resolveInput(run, stage, { allowUnpromoted: options.allowUnpromotedInput });
      const baseCommit = input ? input.commit : run.base_commit;
      const sequence = (run.stage_counters[stage] || 0) + 1;
      const suffix = `${toolSelection.tool}-${String(sequence).padStart(3, '0')}`;
      const candidateId = `${run.id}-${stage}-${suffix}`;
      assertId(candidateId, 'candidate id');
      invariant(!fs.existsSync(this.store.candidatePath(candidateId)), 'CANDIDATE_EXISTS', `Candidate '${candidateId}' already exists`);
      const branch = `vibe/${run.id}/${stage}/${suffix}`;
      const config = this.loadConfig();
      const coordination = run.coordination || {
        mode: config.git.multi_machine ? 'multi-machine' : 'local',
        remote: config.git.remote,
      };
      invariant(
        !(contract.requires_git_candidate && config.git.worktrees === 'never'),
        'WORKTREE_REQUIRED_BY_CONTRACT',
        `Stage '${stage}' requires Git worktree isolation but config.git.worktrees is 'never'`,
      );
      const worktree = contract.requires_git_candidate
        ? path.resolve(this.projectRoot, config.git.worktree_root, candidateId)
        : null;
      const timestamp = iso(this.now());
      const candidate = {
        schema_version: 1,
        id: candidateId,
        run_id: run.id,
        workflow: run.workflow,
        stage,
        project_root: this.projectRoot,
        contract,
        tool: { id: toolSelection.tool, adapter: toolSelection.tool, selection: toolSelection.source },
        route: { name: run.route },
        input,
        git: {
          required: contract.requires_git_candidate,
          base_commit: baseCommit,
          branch: contract.requires_git_candidate ? branch : null,
          worktree,
          result_commit: null,
          integration_commit: null,
          handoff: null,
        },
        status: 'prepared',
        prepared_at: timestamp,
        started_at: null,
        completed_at: null,
        outputs: { summary: null, artifacts: [] },
        metrics: {
          duration_seconds: null,
          estimated_cost: null,
          input_tokens: null,
          output_tokens: null,
        },
        notes: null,
        rating: null,
        promotion: { status: 'candidate', promoted_at: null, superseded_at: null },
        cleanup: { worktree_removed_at: null, branch_deleted_at: null },
      };

      let preparedGit = null;
      let preparedHandoff = null;
      try {
        if (contract.requires_git_candidate) {
          if (coordination.mode === 'multi-machine') {
            const dirty = git.sourceDirty(this.projectRoot, this.gitOptions);
            invariant(dirty.length === 0, 'INTEGRATION_DIRTY', 'Multi-machine handoff requires a clean committed integration tree before candidates are published', { files: dirty });
          }
          preparedGit = git.prepareCandidateWorktree({
            projectRoot: this.projectRoot,
            baseCommit,
            branch,
            worktreePath: worktree,
          }, this.gitOptions);
          candidate.git.base_commit = preparedGit.base_commit;
          candidate.git.worktree = preparedGit.worktree;
          if (coordination.mode === 'multi-machine') {
            preparedHandoff = git.publishCandidateHandoff({
              projectRoot: this.projectRoot,
              run,
              candidate,
              remote: coordination.remote,
            }, this.gitOptions);
            candidate.git.handoff = preparedHandoff;
          }
        }
        this.store.saveCandidate(candidate);
        const context = this.buildContext(candidate, run);
        this.saveContext(candidate.id, context);
        run.stage_counters[stage] = sequence;
        run.stages[stage].candidates.push(candidate.id);
        run.updated_at = timestamp;
        this.store.saveRun(run);
        this.store.appendEvent(this.event('candidate.prepared', {
          candidate_id: candidate.id,
          run_id: run.id,
          stage,
          tool: candidate.tool.id,
          base_commit: candidate.git.base_commit,
          branch: candidate.git.branch,
          worktree: candidate.git.worktree,
          handoff: candidate.git.handoff,
        }));
        return { candidate, context };
      } catch (error) {
        if (preparedHandoff) {
          try { git.rollbackPublishedHandoff(candidate, this.gitOptions); } catch { /* preserve the preparation error */ }
        }
        if (preparedGit) {
          git.rollbackPreparedWorktree({
            projectRoot: this.projectRoot,
            branch,
            worktreePath: worktree,
            baseCommit: preparedGit.base_commit,
          }, this.gitOptions);
        }
        throw error;
      }
    });
  }

  buildContext(candidate, run = this.loadRun(candidate.run_id)) {
    const adapter = this.registry.get(candidate.tool.id);
    const contextPath = this.store.contextPath(candidate.id, 'markdown');
    const summaryPath = path.join(this.store.candidateDir(candidate.id), 'summary.md');
    const gsdCommand = candidate.contract.gsd.command || null;
    const gsdArgs = candidate.contract.gsd.args || [];
    const handoff = candidate.git.handoff && candidate.git.handoff.mode === 'multi-machine'
      ? {
        ...candidate.git.handoff,
        branch: candidate.git.branch,
        fetch_command: `git fetch ${candidate.git.handoff.remote} --tags`,
        checkout_command: `git switch --track -c ${candidate.git.branch} ${candidate.git.handoff.remote}/${candidate.git.branch}`,
        push_command: `git push ${candidate.git.handoff.remote} HEAD:${candidate.git.branch}`,
        receive_command: `vibe stage complete ${candidate.id}`,
      }
      : { mode: 'local' };
    return {
      schema_version: 1,
      project: {
        name: this.loadConfig().project_name || path.basename(this.projectRoot),
        root: this.projectRoot,
        gsd_planning: path.join(this.projectRoot, '.planning'),
        orchestration: this.store.root,
      },
      run: { id: run.id, status: run.status, base_commit: run.base_commit, integration_branch: run.integration_branch },
      workflow: { name: run.workflow },
      stage: { id: candidate.stage, contract: candidate.contract },
      tool: { ...candidate.tool, display_name: adapter.displayName },
      route: candidate.route,
      candidate_id: candidate.id,
      responsibility: candidate.promotion.status === 'promoted' ? 'promoted' : 'candidate',
      input: candidate.input,
      base_commit: candidate.git.base_commit,
      branch: candidate.git.branch,
      worktree: candidate.git.worktree,
      coordination: run.coordination || { mode: handoff.mode, remote: handoff.remote || null },
      handoff,
      expected_outputs: candidate.contract.output,
      completion_requirements: candidate.contract.completion,
      gsd: {
        command: gsdCommand,
        args: gsdArgs,
        invocation: gsdCommand ? formatGsdSlash([gsdCommand, ...gsdArgs].join(' '), candidate.tool.id) : null,
      },
      persistence: {
        manifest: this.store.candidatePath(candidate.id),
        context: contextPath,
        summary: summaryPath,
        outputs: path.join(this.store.candidateDir(candidate.id), 'outputs'),
      },
      context_file: contextPath,
      completion_command: `vibe stage complete ${candidate.id}`,
      promotion_command: `vibe promote ${candidate.id}`,
      promotion: candidate.promotion,
    };
  }

  renderContextMarkdown(context) {
    const input = context.input
      ? `${context.input.stage} / ${context.input.candidate_id} @ ${context.input.commit}`
      : 'none (run base)';
    const artifacts = context.input && context.input.artifacts.length
      ? context.input.artifacts.map((item) => `- ${item.stored_path}`).join('\n')
      : '- none';
    const handoff = context.handoff && context.handoff.mode === 'multi-machine'
      ? `## Multi-machine Git handoff\n\n` +
        `Remote: ${context.handoff.remote}\n` +
        `Identity tag: ${context.handoff.tag}\n` +
        `Fetch: ${context.handoff.fetch_command}\n` +
        `Checkout: ${context.handoff.checkout_command}\n` +
        `Push result: ${context.handoff.push_command}\n` +
        `Coordinator receive/complete: ${context.handoff.receive_command}\n\n` +
        `The worker must commit every result, keep the branch descended from the recorded base, and push it before coordinator completion. Do not run promotion from the worker clone.\n\n`
      : '';
    return `# VibeClaw Stage Context\n\n` +
      `Project: ${context.project.name}\n` +
      `Project root: ${context.project.root}\n` +
      `Run: ${context.run.id}\n` +
      `Workflow: ${context.workflow.name}\n` +
      `Stage: ${context.stage.id}\n` +
      `Tool: ${context.tool.id}\n` +
      `Route: ${context.route.name}\n` +
      `Candidate: ${context.candidate_id}\n` +
      `Responsibility: ${context.responsibility}\n` +
      `Input: ${input}\n` +
      `Base commit: ${context.base_commit}\n` +
      `Branch: ${context.branch || 'none'}\n` +
      `Worktree: ${context.worktree || context.project.root}\n\n` +
      handoff +
      `## Assignment\n\n${context.stage.contract.description || 'Follow the stage contract below.'}\n\n` +
      `## Existing GSD action\n\n${context.gsd.invocation || 'No canonical GSD command is assigned.'}\n\n` +
      `## Promoted input artifacts\n\n${artifacts}\n\n` +
      `## Expected outputs\n\n${context.expected_outputs.map((item) => `- ${item}`).join('\n') || '- none'}\n\n` +
      `## Completion requirements\n\n${context.completion_requirements.map((item) => `- ${item}`).join('\n') || '- none'}\n\n` +
      `Write the candidate summary to: ${context.persistence.summary}\n` +
      `Persist additional candidate artifacts under: ${context.persistence.outputs}\n\n` +
      `Completion: ${context.completion_command}\n` +
      `Promotion is human-controlled and separate: ${context.promotion_command}\n\n` +
      `Do not edit ${IDENTITY.vibeStateDir} or ${IDENTITY.vibeWorktreeRoot.split('/')[0]} from the candidate branch. Tools do not communicate with each other; all handoff is through persisted repository state.\n`;
  }

  saveContext(candidateId, context) {
    this.store.writeJson(this.store.contextPath(candidateId), context);
    fs.writeFileSync(this.store.contextPath(candidateId, 'markdown'), this.renderContextMarkdown(context), 'utf8');
  }

  loadCandidate(candidateId) {
    return assertCandidate(this.store.loadCandidate(candidateId));
  }

  resolveContextCandidate(candidateId, cwd = process.cwd(), env = process.env) {
    if (candidateId) return this.loadCandidate(candidateId);
    if (env.VIBE_CANDIDATE_ID) return this.loadCandidate(env.VIBE_CANDIDATE_ID);
    const location = path.resolve(cwd);
    const worktreeMatches = this.store.listCandidateIds()
      .map((id) => this.loadCandidate(id))
      .filter((candidate) => candidate.git.worktree && within(candidate.git.worktree, location));
    if (worktreeMatches.length === 1) return worktreeMatches[0];
    const run = this.loadRun();
    const active = Object.values(run.stages)
      .flatMap((stage) => stage.candidates)
      .map((id) => this.loadCandidate(id))
      .filter((candidate) => ['prepared', 'running'].includes(candidate.status));
    invariant(active.length === 1, 'CONTEXT_AMBIGUOUS', 'Specify a candidate ID because context is ambiguous', {
      candidates: active.map((candidate) => candidate.id),
    });
    return active[0];
  }

  context(candidateId = null, options = {}) {
    const candidate = this.resolveContextCandidate(candidateId, options.cwd, options.env);
    const context = this.buildContext(candidate);
    this.saveContext(candidate.id, context);
    return context;
  }

  launchCandidate(candidateId) {
    return this.store.withLock('orchestration', () => {
      const candidate = this.loadCandidate(candidateId);
      invariant(['prepared', 'running'].includes(candidate.status), 'CANDIDATE_NOT_LAUNCHABLE', `Candidate '${candidate.id}' is ${candidate.status}`);
      if (!candidate.started_at) candidate.started_at = iso(this.now());
      candidate.status = 'running';
      this.store.saveCandidate(candidate);
      const context = this.buildContext(candidate);
      this.saveContext(candidate.id, context);
      const command = this.registry.buildCommand(candidate.tool.id, context);
      this.store.appendEvent(this.event('candidate.launched', {
        run_id: candidate.run_id,
        stage: candidate.stage,
        candidate_id: candidate.id,
        tool: candidate.tool.id,
      }));
      return { candidate, context, command, rendered_command: renderCommand(command) };
    });
  }

  executeLaunch(launch) {
    const result = childProcess.spawnSync(launch.command.program, launch.command.args, {
      cwd: launch.command.cwd,
      env: { ...process.env, ...launch.command.env },
      stdio: 'inherit',
    });
    return { exit_code: result.status ?? 1, signal: result.signal || null, error: result.error ? result.error.message : null };
  }

  copyArtifact(candidate, artifactPath) {
    invariant(typeof artifactPath === 'string' && artifactPath.trim(), 'ARTIFACT_INVALID', 'Artifact path must be non-empty');
    const sourceRoot = candidate.git.worktree || this.projectRoot;
    const source = path.resolve(sourceRoot, artifactPath);
    invariant(within(sourceRoot, source), 'ARTIFACT_UNSAFE', `Artifact must stay inside candidate workspace: ${artifactPath}`);
    invariant(fs.existsSync(source), 'ARTIFACT_MISSING', `Candidate artifact does not exist: ${artifactPath}`);
    invariant(
      within(fs.realpathSync.native(sourceRoot), fs.realpathSync.native(source)),
      'ARTIFACT_UNSAFE',
      `Artifact cannot traverse a symbolic link outside the candidate workspace: ${artifactPath}`,
    );
    const relative = path.relative(sourceRoot, source);
    const destination = path.join(this.store.candidateDir(candidate.id), 'outputs', relative);
    invariant(within(path.join(this.store.candidateDir(candidate.id), 'outputs'), destination), 'ARTIFACT_UNSAFE', `Unsafe artifact destination: ${artifactPath}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
    return {
      source_path: toPosix(relative),
      stored_path: toPosix(path.relative(this.projectRoot, destination)),
    };
  }

  completeCandidate(candidateId, options = {}) {
    return this.store.withLock('orchestration', () => {
      const candidate = this.loadCandidate(candidateId);
      invariant(['prepared', 'running'].includes(candidate.status), 'CANDIDATE_NOT_COMPLETABLE', `Candidate '${candidate.id}' is ${candidate.status}`);
      const multiMachine = candidate.git && candidate.git.handoff && candidate.git.handoff.mode === 'multi-machine';
      const receivedHandoff = multiMachine ? git.receiveCandidateHandoff(candidate, this.gitOptions) : null;
      const artifactPaths = options.artifacts || [];
      const sourceRoot = candidate.git.worktree || this.projectRoot;
      const allowedDirtyPaths = artifactPaths.map((artifactPath) => {
        invariant(typeof artifactPath === 'string' && artifactPath.trim(), 'ARTIFACT_INVALID', 'Artifact path must be non-empty');
        const source = path.resolve(sourceRoot, artifactPath);
        invariant(within(sourceRoot, source), 'ARTIFACT_UNSAFE', `Artifact must stay inside candidate workspace: ${artifactPath}`);
        invariant(fs.existsSync(source), 'ARTIFACT_MISSING', `Candidate artifact does not exist: ${artifactPath}`);
        invariant(
          within(fs.realpathSync.native(sourceRoot), fs.realpathSync.native(source)),
          'ARTIFACT_UNSAFE',
          `Artifact cannot traverse a symbolic link outside the candidate workspace: ${artifactPath}`,
        );
        return toPosix(path.relative(sourceRoot, source));
      });
      let resultCommit = candidate.git.base_commit;
      if (candidate.git.required) {
        resultCommit = git.completeCandidateGit(candidate, {
          ...this.gitOptions,
          allowedDirtyPaths,
          requireResultCommit: multiMachine,
        });
      }

      const summaryPath = path.join(this.store.candidateDir(candidate.id), 'summary.md');
      if (options.summary) fs.writeFileSync(summaryPath, `${String(options.summary).trim()}\n`, 'utf8');
      invariant(fs.existsSync(summaryPath) && fs.readFileSync(summaryPath, 'utf8').trim(), 'SUMMARY_REQUIRED', `Candidate '${candidate.id}' requires a non-empty summary`, {
        path: summaryPath,
      });

      const artifacts = [];
      for (const artifact of artifactPaths) artifacts.push(this.copyArtifact(candidate, artifact));
      const completionHandoff = multiMachine ? git.publishCompletionHandoff(candidate, resultCommit, this.gitOptions) : null;
      const completedAt = this.now();
      candidate.git.result_commit = resultCommit;
      if (multiMachine) {
        candidate.git.handoff.received_commit = receivedHandoff.received_commit;
        candidate.git.handoff.completed_commit = completionHandoff.commit;
        candidate.git.handoff.completed_at = iso(completedAt);
      }
      candidate.outputs.summary = toPosix(path.relative(this.projectRoot, summaryPath));
      candidate.outputs.artifacts.push(...artifacts);
      candidate.started_at = candidate.started_at || candidate.prepared_at;
      candidate.completed_at = iso(completedAt);
      candidate.status = 'completed';
      const derivedDuration = Math.max(0, Math.round((completedAt - Date.parse(candidate.started_at)) / 1000));
      candidate.metrics = {
        duration_seconds: options.durationSeconds ?? derivedDuration,
        estimated_cost: options.estimatedCost ?? null,
        input_tokens: options.inputTokens ?? null,
        output_tokens: options.outputTokens ?? null,
      };
      if (options.notes !== undefined) candidate.notes = options.notes;
      if (options.rating !== undefined) candidate.rating = options.rating;
      this.store.saveCandidate(candidate);
      const context = this.buildContext(candidate);
      this.saveContext(candidate.id, context);
      this.store.appendEvent(this.event('candidate.completed', {
        run_id: candidate.run_id,
        stage: candidate.stage,
        candidate_id: candidate.id,
        result_commit: resultCommit,
        handoff: candidate.git.handoff,
        artifacts: candidate.outputs.artifacts,
        metrics: candidate.metrics,
      }));
      return candidate;
    });
  }

  promote(candidateId, options = {}) {
    return this.store.withLock('orchestration', () => {
      const candidate = this.loadCandidate(candidateId);
      invariant(candidate.status === 'completed' || candidate.status === 'promoted', 'CANDIDATE_NOT_COMPLETE', `Candidate '${candidate.id}' must be completed before promotion`);
      const run = this.loadRun(candidate.run_id);
      const current = run.promotions[candidate.stage] || this.store.loadCurrentPromotion(run.id, candidate.stage);
      if (current && current.candidate_id === candidate.id) return current;
      const order = Object.keys(run.workflow_snapshot.stages);
      const stageIndex = order.indexOf(candidate.stage);
      const downstream = order.slice(stageIndex + 1).filter((stage) => run.promotions[stage]);
      invariant(!(current && downstream.length), 'DOWNSTREAM_PROMOTED', `Cannot replace '${candidate.stage}' while downstream stages are promoted`, { stages: downstream });

      const intent = {
        schema_version: 1,
        status: 'pending',
        run_id: run.id,
        stage: candidate.stage,
        candidate_id: candidate.id,
        replace: options.replace === true,
        previous_promotion: current || null,
        created_at: iso(this.now()),
      };
      this.store.writePromotionIntent(intent);
      let gitResult;
      try {
        if (candidate.git.required) {
          gitResult = git.promoteCandidateGit({
            projectRoot: this.projectRoot,
            run,
            candidate,
            currentPromotion: current,
            replace: options.replace === true,
          }, this.gitOptions);
        } else {
          invariant(!current || options.replace === true, 'PROMOTION_EXISTS', `Stage '${candidate.stage}' already has a promotion`);
          gitResult = {
            strategy: current ? 'record-only-replacement' : 'record-only',
            previous_integration_commit: current ? current.integration_commit : candidate.git.base_commit,
            integration_commit: candidate.git.result_commit || candidate.git.base_commit,
          };
        }
      } catch (error) {
        intent.status = 'failed';
        intent.failed_at = iso(this.now());
        intent.error = { code: error.code || 'INTERNAL_ERROR', message: error.message };
        this.store.writePromotionIntent(intent);
        this.store.appendEvent(this.event('promotion.failed', {
          run_id: run.id,
          stage: candidate.stage,
          candidate_id: candidate.id,
          error: intent.error,
        }));
        throw error;
      }
      intent.git_result = gitResult;
      intent.status = 'git-complete';
      this.store.writePromotionIntent(intent);

      const promotedAt = iso(this.now());
      const promotion = this.store.savePromotion({
        schema_version: 1,
        run_id: run.id,
        workflow: run.workflow,
        stage: candidate.stage,
        candidate_id: candidate.id,
        tool: candidate.tool.id,
        route: candidate.route.name,
        result_commit: candidate.git.result_commit,
        integration_commit: gitResult.integration_commit,
        previous_candidate_id: current ? current.candidate_id : null,
        strategy: gitResult.strategy,
        promoted_at: promotedAt,
      });

      if (current && current.candidate_id !== candidate.id) {
        const previous = this.loadCandidate(current.candidate_id);
        previous.promotion.status = 'superseded';
        previous.promotion.superseded_at = promotedAt;
        previous.status = 'completed';
        this.store.saveCandidate(previous);
      }
      candidate.promotion.status = 'promoted';
      candidate.promotion.promoted_at = promotedAt;
      candidate.git.integration_commit = gitResult.integration_commit;
      candidate.status = 'promoted';
      this.store.saveCandidate(candidate);
      run.promotions[candidate.stage] = promotion;
      run.stages[candidate.stage].promoted_candidate_id = candidate.id;
      if (candidate.stage === order[order.length - 1]) run.status = 'completed';
      run.updated_at = promotedAt;
      this.store.saveRun(run);
      this.store.clearPromotionIntent(run.id, candidate.stage);
      this.saveContext(candidate.id, this.buildContext(candidate, run));
      this.store.appendEvent(this.event('candidate.promoted', promotion));
      return promotion;
    });
  }

  listCandidates(options = {}) {
    const run = this.loadRun(options.runId);
    let ids = Object.values(run.stages).flatMap((stage) => stage.candidates);
    let candidates = ids.map((id) => this.loadCandidate(id));
    if (options.stage) candidates = candidates.filter((candidate) => candidate.stage === options.stage);
    return candidates;
  }

  candidateHealth(candidate) {
    const health = { worktree: 'not-required', branch: 'not-required' };
    if (candidate.git.required) {
      health.worktree = candidate.git.worktree && fs.existsSync(candidate.git.worktree) ? 'present' : 'missing';
      const head = candidate.git.branch ? git.branchHead(this.projectRoot, candidate.git.branch, this.gitOptions) : null;
      health.branch = !head ? 'missing' : candidate.git.result_commit && head !== candidate.git.result_commit ? 'advanced' : 'present';
    }
    return health;
  }

  status(runId = null) {
    const run = this.loadRun(runId);
    const stageOrder = Object.keys(run.workflow_snapshot.stages);
    const latestPromotion = [...stageOrder].reverse()
      .map((stage) => run.promotions[stage])
      .find(Boolean);
    const stages = [];
    for (const [stage, stageState] of Object.entries(run.stages)) {
      const candidates = stageState.candidates.map((id) => {
        const candidate = this.loadCandidate(id);
        return {
          id: candidate.id,
          tool: candidate.tool.id,
          status: candidate.status,
          promotion: candidate.promotion.status,
          result_commit: candidate.git.result_commit,
          health: this.candidateHealth(candidate),
        };
      });
      stages.push({
        id: stage,
        default_tool: run.route_snapshot.stages[stage] ? run.route_snapshot.stages[stage].tool : null,
        promoted_candidate_id: stageState.promoted_candidate_id,
        candidates,
      });
    }
    return {
      schema_version: 1,
      project: this.loadConfig().project_name || path.basename(this.projectRoot),
      project_root: this.projectRoot,
      run: {
        id: run.id,
        workflow: run.workflow,
        route: run.route,
        status: run.status,
        base_commit: run.base_commit,
        integration_branch: run.integration_branch,
        integration_commit: latestPromotion ? latestPromotion.integration_commit : run.base_commit,
        coordination: run.coordination || { mode: 'local', remote: this.loadConfig().git.remote },
      },
      stages,
    };
  }

  next(runId = null) {
    const run = this.loadRun(runId);
    for (const stage of Object.keys(run.workflow_snapshot.stages)) {
      if (run.stages[stage].skipped === true) continue;
      if (!run.promotions[stage]) {
        const contract = run.workflow_snapshot.stages[stage];
        const existingIds = run.stages[stage].candidates;
        if (contract.optional && existingIds.length === 0) continue;
        const assignment = this.resolveTool(run, stage, null, process.env);
        const candidates = existingIds.map((id) => this.loadCandidate(id));
        return {
          run_id: run.id,
          stage,
          tool: assignment.tool,
          tool_source: assignment.source,
          candidates: candidates.map((candidate) => ({ id: candidate.id, status: candidate.status })),
          action: candidates.some((candidate) => ['prepared', 'running', 'completed'].includes(candidate.status))
            ? 'inspect-or-promote-candidate'
            : 'prepare-candidate',
        };
      }
    }
    return { run_id: run.id, action: 'workflow-complete', stage: null, tool: null, candidates: [] };
  }

  history(options = {}) {
    return this.store.readEvents().filter((event) => {
      if (options.runId && event.data.run_id !== options.runId) return false;
      if (options.stage && event.data.stage !== options.stage) return false;
      return true;
    });
  }

  cleanup(candidateId, options = {}) {
    return this.store.withLock('orchestration', () => {
      const candidate = this.loadCandidate(candidateId);
      invariant(['completed', 'promoted', 'failed'].includes(candidate.status), 'CANDIDATE_ACTIVE', `Cannot clean candidate '${candidate.id}' while it is ${candidate.status}`);
      invariant(!(options.deleteBranch && candidate.promotion.status === 'promoted'), 'BRANCH_PROMOTED', 'Promoted candidate branches are preserved');
      const result = git.cleanupCandidateWorktree(candidate, { deleteBranch: options.deleteBranch === true, ...this.gitOptions });
      const timestamp = iso(this.now());
      if (result.worktree_removed || result.worktree_missing) candidate.cleanup.worktree_removed_at = timestamp;
      if (result.branch_deleted) candidate.cleanup.branch_deleted_at = timestamp;
      this.store.saveCandidate(candidate);
      this.store.appendEvent(this.event('candidate.cleaned', {
        run_id: candidate.run_id,
        stage: candidate.stage,
        candidate_id: candidate.id,
        ...result,
      }));
      return result;
    });
  }
}

module.exports = { VibeOrchestrator };
