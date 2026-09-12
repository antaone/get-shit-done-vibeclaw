#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sourceCore = path.resolve(__dirname, '..', 'get-shit-done', 'bin', 'lib', 'vibe', 'index.cjs');
const installedCore = path.resolve(__dirname, 'lib', 'vibe', 'index.cjs');
const {
  VibeOrchestrator,
  VibeError,
  createDefaultRegistry,
  inspectVibeEntry,
  migrateLegacyPlanningCommands,
  prepareVibeEntry,
} = require(fs.existsSync(sourceCore) ? sourceCore : installedCore);

function takeFlag(tokens, name) {
  const index = tokens.indexOf(name);
  if (index === -1) return false;
  tokens.splice(index, 1);
  return true;
}

function takeOption(tokens, name, options = {}) {
  const values = [];
  while (true) {
    const index = tokens.findIndex((token) => token === name || token.startsWith(`${name}=`));
    if (index === -1) break;
    const token = tokens[index];
    let value;
    if (token.startsWith(`${name}=`)) {
      value = token.slice(name.length + 1);
      tokens.splice(index, 1);
    } else {
      value = tokens[index + 1];
      if (!value || value.startsWith('--')) throw new VibeError('ARGUMENT_INVALID', `${name} requires a value`);
      tokens.splice(index, 2);
    }
    values.push(value);
    if (!options.repeat) break;
  }
  return options.repeat ? values : (values[0] ?? null);
}

function numericOption(value, name) {
  if (value === null) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new VibeError('ARGUMENT_INVALID', `${name} must be a non-negative number`);
  return number;
}

function assertNoArgs(tokens) {
  if (tokens.length) throw new VibeError('ARGUMENT_INVALID', `Unexpected arguments: ${tokens.join(' ')}`);
}

function help() {
  return `VibeClaw repository orchestration

Usage:
  vibe init [--project <dir>] [--json]
  vibe entry inspect <fvgsd-command> [--runtime <runtime>]
  vibe entry migrate <fvgsd-command> [--runtime <runtime>] [--dry-run]
  vibe entry prepare <fvgsd-command> [--runtime <runtime>] [--tool <tool> ...] [--run <run>] [--id <run>] [--multi-machine --remote <name>]
  vibe mode show|local|multi-machine [--remote <name>]
  vibe route list|show <name>|use <name>
  vibe run start <workflow> [--id <run>] [--route <route>] [--base <commit>]
  vibe run resume <run> | show [run] | list
  vibe status [--run <run>] [--json]
  vibe next [--run <run>] [--prepare] [--tool <tool>]
  vibe stage prepare <stage> [--run <run>] [--tool <tool>]
  vibe stage launch <candidate> [--execute]
  vibe stage complete <candidate> [--summary <text>] [--artifact <path> ...]
  vibe context [candidate] [--json]
  vibe candidates [stage] [--run <run>] [--json]
  vibe promote <candidate> [--replace]
  vibe history [--run <run>] [--stage <stage>]
  vibe cleanup <candidate> [--delete-branch]
  vibe tool list|detect

Every lifecycle and inspection command supports --json. Managed launch is optional;
without --execute, stage launch prints the command and leaves execution to the operator.`;
}

function prettyStatus(status) {
  const lines = [
    `Project: ${status.project}`,
    `Workflow Run: ${status.run.id}`,
    `Workflow: ${status.run.workflow}`,
    `Route: ${status.run.route}`,
    `Integration: ${status.run.integration_branch} @ ${status.run.integration_commit.slice(0, 12)}`,
    `Coordination: ${status.run.coordination.mode}${status.run.coordination.mode === 'multi-machine' ? ` via ${status.run.coordination.remote}` : ''}`,
    '',
  ];
  for (const stage of status.stages) {
    lines.push(stage.id.toUpperCase());
    if (stage.candidates.length === 0) {
      lines.push(`  ○ waiting${stage.default_tool ? ` — default tool: ${stage.default_tool}` : ''}`);
    } else {
      for (const candidate of stage.candidates) {
        const mark = candidate.status === 'promoted' ? '✓' : candidate.status === 'completed' ? '✓' : '○';
        const promotion = candidate.promotion === 'promoted' ? 'PROMOTED' : candidate.promotion;
        lines.push(`  ${mark} ${candidate.id}  ${candidate.status}  ${promotion}`);
        if (candidate.health.worktree === 'missing' || candidate.health.branch === 'missing') {
          lines.push(`    health: worktree=${candidate.health.worktree}, branch=${candidate.health.branch}`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function prettyCandidate(candidate) {
  return [
    `Candidate: ${candidate.id}`,
    `Run: ${candidate.run_id}`,
    `Stage: ${candidate.stage}`,
    `Tool: ${candidate.tool.id}`,
    `Status: ${candidate.status}`,
    `Promotion: ${candidate.promotion.status}`,
    `Base: ${candidate.git.base_commit}`,
    `Branch: ${candidate.git.branch || 'none'}`,
    `Worktree: ${candidate.git.worktree || candidate.project_root}`,
    `Coordination: ${candidate.git.handoff && candidate.git.handoff.mode === 'multi-machine' ? `multi-machine via ${candidate.git.handoff.remote}` : 'local'}`,
  ].join('\n');
}

function emit(value, json, pretty) {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${pretty ? pretty(value) : String(value)}\n`);
}

function createOrchestrator(projectArg, initialize) {
  const start = path.resolve(projectArg || process.cwd());
  return initialize
    ? new VibeOrchestrator({ projectRoot: start })
    : VibeOrchestrator.discover(start);
}

function main(argv = process.argv.slice(2)) {
  const tokens = [...argv];
  const json = takeFlag(tokens, '--json');
  const project = takeOption(tokens, '--project');
  if (takeFlag(tokens, '--help') || takeFlag(tokens, '-h') || tokens.length === 0) {
    process.stdout.write(`${help()}\n`);
    return 0;
  }

  const command = tokens.shift();
  if (command === 'entry') {
    const action = tokens.shift();
    const fvgsdCommand = tokens.shift();
    if (!fvgsdCommand) throw new VibeError('ARGUMENT_INVALID', 'Usage: vibe entry inspect|migrate|prepare <fvgsd-command>');
    const cwd = path.resolve(project || process.cwd());
    if (action === 'inspect') {
      const runtime = takeOption(tokens, '--runtime');
      assertNoArgs(tokens);
      const result = inspectVibeEntry({ cwd, command: fvgsdCommand, runtime });
      emit(result, json, (value) => [
        `Command: /fvgsd:${value.command}`,
        `Action: ${value.action}`,
        `Reason: ${value.reason}`,
        value.workflow ? `Workflow: ${value.workflow}` : null,
        value.stage ? `Stage: ${value.stage}` : null,
        value.message,
      ].filter(Boolean).join('\n'));
      return 0;
    }
    if (action === 'migrate') {
      const runtime = takeOption(tokens, '--runtime');
      const dryRun = takeFlag(tokens, '--dry-run');
      assertNoArgs(tokens);
      const result = migrateLegacyPlanningCommands(cwd, { runtime, dryRun });
      emit({ command: fvgsdCommand, ...result }, json, (value) => [
        `Planning files scanned: ${value.scanned_files}`,
        `Legacy command references: ${value.total_references}`,
        `Files affected: ${value.affected_files.length}`,
        value.migrated ? `Migrated for runtime: ${value.runtime}` : dryRun ? `Dry run for runtime: ${value.runtime}` : 'No migration needed.',
      ].join('\n'));
      return 0;
    }
    if (action === 'prepare') {
      const runtime = takeOption(tokens, '--runtime');
      const tools = takeOption(tokens, '--tool', { repeat: true });
      const runId = takeOption(tokens, '--run');
      const id = takeOption(tokens, '--id');
      const route = takeOption(tokens, '--route');
      const base = takeOption(tokens, '--base');
      const multiMachine = takeFlag(tokens, '--multi-machine');
      const local = takeFlag(tokens, '--local');
      if (multiMachine && local) throw new VibeError('ARGUMENT_INVALID', '--multi-machine and --local are mutually exclusive');
      const remote = takeOption(tokens, '--remote');
      assertNoArgs(tokens);
      const result = prepareVibeEntry({
        cwd,
        command: fvgsdCommand,
        runtime,
        tools,
        runId,
        id,
        route,
        base,
        coordinationMode: multiMachine ? 'multi-machine' : local ? 'local' : null,
        remote,
      });
      emit(result, json, (value) => [
        `Run: ${value.run.id}`,
        `Workflow: ${value.workflow}`,
        `Stage: ${value.stage}`,
        ...value.candidates.flatMap((candidate) => [
          '',
          `Candidate: ${candidate.id}`,
          `Tool: ${candidate.tool}`,
          `Worktree: ${candidate.worktree}`,
          candidate.handoff && candidate.handoff.mode === 'multi-machine' ? `Handoff: ${candidate.handoff.remote} / ${candidate.handoff.tag}` : null,
          candidate.handoff && candidate.handoff.mode === 'multi-machine' ? `Fetch: ${candidate.handoff.fetch_command}` : null,
          candidate.handoff && candidate.handoff.mode === 'multi-machine' ? `Checkout: ${candidate.handoff.checkout_command}` : null,
          `Command: ${candidate.invocation}`,
          `Context: ${candidate.context}`,
        ].filter(Boolean)),
        '',
        value.next_action,
      ].join('\n'));
      return 0;
    }
    throw new VibeError('ARGUMENT_INVALID', 'Usage: vibe entry inspect|migrate|prepare <fvgsd-command>');
  }
  const orchestrator = createOrchestrator(project, command === 'init');
  let result;

  if (command === 'init') {
    assertNoArgs(tokens);
    result = orchestrator.initialize();
    emit(result, json, (value) => {
      const count = value.standalone_executions ? value.standalone_executions.length : 0;
      return `VibeClaw initialized at ${value.state_root}${value.already_initialized ? ' (already initialized)' : ''}\nStandalone fvgsd executions discovered: ${count}`;
    });
    return 0;
  }

  if (command === 'mode') {
    const action = tokens.shift() || 'show';
    const remote = takeOption(tokens, '--remote');
    assertNoArgs(tokens);
    if (action === 'show') result = orchestrator.mode();
    else if (action === 'local' || action === 'multi-machine') result = orchestrator.setMode(action, { remote });
    else throw new VibeError('ARGUMENT_INVALID', 'Usage: vibe mode show|local|multi-machine [--remote <name>]');
    emit(result, json, (value) => `Coordination mode: ${value.mode}\nRemote: ${value.remote}`);
    return 0;
  }

  if (command === 'route') {
    const action = tokens.shift();
    if (action === 'list') {
      assertNoArgs(tokens);
      result = orchestrator.listRoutes();
      emit(result, json, (routes) => routes.map((route) => `${route.name}\t${route.description}`).join('\n'));
    } else if (action === 'show') {
      const name = tokens.shift();
      assertNoArgs(tokens);
      result = orchestrator.loadRoute(name);
      emit(result, json, (route) => [`Route: ${route.name}`, ...Object.entries(route.stages).map(([stage, assignment]) => `${stage}\t${assignment.tool}`)].join('\n'));
    } else if (action === 'use') {
      const name = tokens.shift();
      assertNoArgs(tokens);
      result = orchestrator.useRoute(name);
      emit(result, json, (route) => `Default route: ${route.name}`);
    } else throw new VibeError('ARGUMENT_INVALID', 'Usage: vibe route list|show <name>|use <name>');
    return 0;
  }

  if (command === 'run') {
    const action = tokens.shift();
    if (action === 'start') {
      const workflow = tokens.shift();
      const id = takeOption(tokens, '--id');
      const route = takeOption(tokens, '--route');
      const base = takeOption(tokens, '--base');
      assertNoArgs(tokens);
      result = orchestrator.startRun(workflow, { id, route, base });
      emit(result, json, (run) => `Run ${run.id} started\nWorkflow: ${run.workflow}\nRoute: ${run.route}\nBase: ${run.base_commit}\nBranch: ${run.integration_branch}`);
    } else if (action === 'resume') {
      const runId = tokens.shift();
      assertNoArgs(tokens);
      result = orchestrator.resumeRun(runId);
      emit(result, json, (run) => `Active run: ${run.id}`);
    } else if (action === 'show') {
      const runId = tokens.shift() || null;
      assertNoArgs(tokens);
      result = orchestrator.loadRun(runId);
      emit(result, json, (run) => `Run: ${run.id}\nWorkflow: ${run.workflow}\nRoute: ${run.route}\nStatus: ${run.status}`);
    } else if (action === 'list') {
      assertNoArgs(tokens);
      result = orchestrator.listRuns();
      emit(result, json, (runs) => runs.map((run) => `${run.id}\t${run.workflow}\t${run.route}\t${run.status}`).join('\n'));
    } else throw new VibeError('ARGUMENT_INVALID', 'Usage: vibe run start|resume|show|list');
    return 0;
  }

  if (command === 'status') {
    const runId = takeOption(tokens, '--run');
    assertNoArgs(tokens);
    result = orchestrator.status(runId);
    emit(result, json, prettyStatus);
    return 0;
  }

  if (command === 'next') {
    const runId = takeOption(tokens, '--run');
    const prepare = takeFlag(tokens, '--prepare');
    const tool = takeOption(tokens, '--tool');
    assertNoArgs(tokens);
    result = orchestrator.next(runId);
    if (prepare && result.stage) result = orchestrator.prepareStage(result.stage, { runId, tool });
    emit(result, json, (value) => value.candidate
      ? prettyCandidate(value.candidate)
      : value.stage ? `Next: ${value.stage}\nTool: ${value.tool}\nAction: ${value.action}` : 'Workflow complete');
    return 0;
  }

  if (command === 'stage') {
    const action = tokens.shift();
    if (action === 'prepare') {
      const stage = tokens.shift();
      const runId = takeOption(tokens, '--run');
      const tool = takeOption(tokens, '--tool');
      assertNoArgs(tokens);
      result = orchestrator.prepareStage(stage, { runId, tool });
      emit(result, json, (value) => `${prettyCandidate(value.candidate)}\nContext: ${value.context.context_file}`);
    } else if (action === 'launch') {
      const candidateId = tokens.shift();
      const execute = takeFlag(tokens, '--execute');
      assertNoArgs(tokens);
      result = orchestrator.launchCandidate(candidateId);
      if (execute) result.execution = orchestrator.executeLaunch(result);
      emit(result, json, (value) => `Candidate: ${value.candidate.id}\nWorktree: ${value.command.cwd}\nContext: ${value.context.context_file}\nCommand: ${value.rendered_command}${value.execution ? `\nExit: ${value.execution.exit_code}` : ''}`);
    } else if (action === 'complete') {
      const candidateId = tokens.shift();
      const summary = takeOption(tokens, '--summary');
      const artifacts = takeOption(tokens, '--artifact', { repeat: true });
      const durationSeconds = numericOption(takeOption(tokens, '--duration-seconds'), '--duration-seconds');
      const estimatedCost = numericOption(takeOption(tokens, '--estimated-cost'), '--estimated-cost');
      const inputTokens = numericOption(takeOption(tokens, '--input-tokens'), '--input-tokens');
      const outputTokens = numericOption(takeOption(tokens, '--output-tokens'), '--output-tokens');
      const notes = takeOption(tokens, '--notes');
      const rating = numericOption(takeOption(tokens, '--rating'), '--rating');
      assertNoArgs(tokens);
      result = orchestrator.completeCandidate(candidateId, {
        summary, artifacts, durationSeconds, estimatedCost, inputTokens, outputTokens, notes, rating,
      });
      emit(result, json, prettyCandidate);
    } else throw new VibeError('ARGUMENT_INVALID', 'Usage: vibe stage prepare|launch|complete');
    return 0;
  }

  if (command === 'context') {
    const candidateId = tokens.shift() || null;
    assertNoArgs(tokens);
    result = orchestrator.context(candidateId, { cwd: project || process.cwd(), env: process.env });
    emit(result, json, (context) => orchestrator.renderContextMarkdown(context).trimEnd());
    return 0;
  }

  if (command === 'candidates') {
    const stage = tokens.length && !tokens[0].startsWith('--') ? tokens.shift() : null;
    const runId = takeOption(tokens, '--run');
    assertNoArgs(tokens);
    result = orchestrator.listCandidates({ stage, runId });
    emit(result, json, (candidates) => candidates.map((candidate) => `${candidate.id}\t${candidate.tool.id}\t${candidate.status}\t${candidate.promotion.status}`).join('\n'));
    return 0;
  }

  if (command === 'promote') {
    const candidateId = tokens.shift();
    const replace = takeFlag(tokens, '--replace');
    assertNoArgs(tokens);
    result = orchestrator.promote(candidateId, { replace });
    emit(result, json, (promotion) => `Promoted: ${promotion.candidate_id}\nStage: ${promotion.stage}\nIntegration commit: ${promotion.integration_commit}\nStrategy: ${promotion.strategy}`);
    return 0;
  }

  if (command === 'history') {
    const runId = takeOption(tokens, '--run');
    const stage = takeOption(tokens, '--stage');
    assertNoArgs(tokens);
    result = orchestrator.history({ runId, stage });
    emit(result, json, (events) => events.map((event) => `${event.occurred_at}\t${event.type}\t${event.data.candidate_id || event.data.run_id || ''}`).join('\n'));
    return 0;
  }

  if (command === 'cleanup') {
    const candidateId = tokens.shift();
    const deleteBranch = takeFlag(tokens, '--delete-branch');
    assertNoArgs(tokens);
    result = orchestrator.cleanup(candidateId, { deleteBranch });
    emit(result, json, (value) => `Worktree removed: ${value.worktree_removed || value.worktree_missing}\nBranch deleted: ${value.branch_deleted}`);
    return 0;
  }

  if (command === 'tool') {
    const action = tokens.shift();
    const registry = createDefaultRegistry();
    if (action === 'list') result = registry.list();
    else if (action === 'detect') result = registry.detect({ env: process.env, probeExecutables: true });
    else throw new VibeError('ARGUMENT_INVALID', 'Usage: vibe tool list|detect');
    assertNoArgs(tokens);
    emit(result, json, (value) => Array.isArray(value)
      ? value.map((tool) => `${tool.id}\t${tool.display_name}`).join('\n')
      : `Tool: ${value.tool || 'undetected'}\nSource: ${value.source}`);
    return 0;
  }

  throw new VibeError('ARGUMENT_INVALID', `Unknown command '${command}'\n\n${help()}`);
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    const json = process.argv.includes('--json');
    const payload = {
      error: error.code || 'INTERNAL_ERROR',
      message: error.message,
      details: error.details || null,
    };
    if (json) process.stderr.write(`${JSON.stringify(payload)}\n`);
    else process.stderr.write(`vibe: ${payload.message}${payload.details && payload.details.hint ? `\n${payload.details.hint}` : ''}\n`);
    process.exitCode = error instanceof VibeError ? 2 : 1;
  }
}

module.exports = { main, help, prettyStatus };
