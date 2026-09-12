'use strict';

const path = require('path');
const { execTool } = require('../shell-command-projection.cjs');
const { VibeError } = require('./errors.cjs');

class ToolAdapterRegistry {
  constructor(adapters = []) {
    this.adapters = new Map();
    adapters.forEach((adapter) => this.register(adapter));
  }

  register(adapter) {
    if (!adapter || typeof adapter.id !== 'string' || !adapter.id) {
      throw new TypeError('Tool adapter requires an id');
    }
    if (this.adapters.has(adapter.id)) throw new TypeError(`Duplicate tool adapter '${adapter.id}'`);
    this.adapters.set(adapter.id, Object.freeze({
      supportsNonInteractive: false,
      supportsResume: false,
      envMarkers: [],
      executables: [adapter.id],
      ...adapter,
    }));
    return this;
  }

  has(id) { return this.adapters.has(id); }

  get(id) {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new VibeError('TOOL_UNKNOWN', `Unknown tool '${id}'`, { known_tools: this.list().map((item) => item.id) });
    return adapter;
  }

  list() {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      display_name: adapter.displayName,
      supports_non_interactive: adapter.supportsNonInteractive,
      supports_resume: adapter.supportsResume,
      executables: [...adapter.executables],
    }));
  }

  detect(options = {}) {
    const env = options.env || process.env;
    if (options.explicit) return { tool: this.get(options.explicit).id, source: 'explicit' };
    if (env.VIBE_TOOL) return { tool: this.get(env.VIBE_TOOL).id, source: 'environment' };
    for (const adapter of this.adapters.values()) {
      if (adapter.envMarkers.some((key) => env[key])) return { tool: adapter.id, source: `marker:${adapter.envMarkers.find((key) => env[key])}` };
    }
    if (options.probeExecutables) {
      for (const adapter of this.adapters.values()) {
        for (const executable of adapter.executables) {
          const result = execTool(executable, ['--version'], { timeout: 1500 });
          if (result.exitCode === 0) return { tool: adapter.id, source: `executable:${executable}` };
        }
      }
    }
    return { tool: null, source: 'undetected' };
  }

  buildPrompt(id, context) {
    const adapter = this.get(id);
    if (adapter.buildPrompt) return adapter.buildPrompt(context);
    return defaultPrompt(context, adapter);
  }

  buildCommand(id, context) {
    const adapter = this.get(id);
    if (!adapter.buildCommand) throw new VibeError('LAUNCH_UNSUPPORTED', `Tool '${id}' does not provide a managed launch command`);
    return adapter.buildCommand(context, this.buildPrompt(id, context));
  }
}

function defaultPrompt(context, adapter) {
  return [
    `You are the ${adapter.displayName || adapter.id} runtime assigned to VibeClaw candidate ${context.candidate_id}.`,
    `Read the complete stage context at ${context.context_file}.`,
    `Work only in ${context.worktree || context.project.root}.`,
    'Do not promote the candidate. Persist the required outputs, commit candidate work when required, then let the operator run vibe stage complete.',
  ].join(' ');
}

function command(program, args, context, extraEnv = {}) {
  return {
    program,
    args,
    cwd: context.worktree || context.project.root,
    env: {
      VIBE_CANDIDATE_ID: context.candidate_id,
      VIBE_TOOL: context.tool.id,
      FVGSD_RUNTIME: context.tool.id,
      ...extraEnv,
    },
  };
}

function createDefaultRegistry() {
  return new ToolAdapterRegistry([
    {
      id: 'codex', displayName: 'Codex', envMarkers: ['CODEX_THREAD_ID'], executables: ['codex'],
      supportsNonInteractive: true, supportsResume: true,
      buildCommand: (context, prompt) => command('codex', ['exec', '--cd', context.worktree || context.project.root, prompt], context),
    },
    {
      id: 'claude', displayName: 'Claude Code', envMarkers: ['CLAUDE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT'], executables: ['claude'],
      supportsNonInteractive: true, supportsResume: true,
      buildCommand: (context, prompt) => command('claude', ['--print', prompt], context),
    },
    {
      id: 'claude-router', displayName: 'Claude Code Router', envMarkers: ['CLAUDE_ROUTER_SESSION_ID'], executables: ['ccr'],
      supportsNonInteractive: false, supportsResume: false,
      buildCommand: (context) => command('ccr', ['code'], context),
    },
    {
      id: 'opencode', displayName: 'OpenCode', envMarkers: ['OPENCODE_SESSION_ID'], executables: ['opencode'],
      supportsNonInteractive: true, supportsResume: true,
      buildCommand: (context, prompt) => command('opencode', ['run', prompt], context),
    },
    {
      id: 'gemini', displayName: 'Gemini CLI', envMarkers: ['GEMINI_SESSION_ID'], executables: ['gemini'],
      supportsNonInteractive: true, supportsResume: true,
      buildCommand: (context, prompt) => command('gemini', ['--prompt', prompt], context),
    },
    {
      id: 'grok', displayName: 'Grok Build', envMarkers: ['GROK_SESSION_ID'], executables: ['grok'],
      supportsNonInteractive: false, supportsResume: false,
      buildCommand: (context) => command('grok', [], context),
    },
  ]);
}

function shellQuote(value) {
  const text = String(value);
  if (process.platform === 'win32') return `"${text.replace(/"/g, '\\"')}"`;
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

function renderCommand(spec) {
  return [spec.program, ...spec.args].map(shellQuote).join(' ');
}

module.exports = { ToolAdapterRegistry, createDefaultRegistry, defaultPrompt, renderCommand };
