import { describe, it, expect } from 'vitest';
import { RUNTIME_CAPABILITY_KEYS, capabilityTableRuntimes, resolveRuntimeCapabilities } from './runtime-capabilities.js';

function allSwitches(value: boolean): Record<string, boolean> {
  return Object.fromEntries(RUNTIME_CAPABILITY_KEYS.map((key) => [key, value]));
}

describe('runtime capabilities', () => {
  it('lists the seven switches in spec order', () => {
    expect([...RUNTIME_CAPABILITY_KEYS]).toEqual([
      'spawn_agents', 'parallel_agents', 'worktree_isolation', 'per_call_model',
      'agent_effort', 'background_tasks', 'workflow_scripts',
    ]);
  });

  it('turns every switch on for claude', () => {
    expect(resolveRuntimeCapabilities('claude')).toEqual(allSwitches(true));
  });

  it('resolves unknown and hostile runtime names to all false', () => {
    for (const name of ['unknown-runtime', '', '__proto__', 'constructor', '../claude']) {
      expect(resolveRuntimeCapabilities(name)).toEqual(allSwitches(false));
    }
  });

  it('covers the fifteen installable runtimes', () => {
    expect(capabilityTableRuntimes()).toEqual([
      'antigravity', 'augment', 'claude', 'cline', 'codebuddy', 'codex', 'copilot', 'cursor',
      'gemini', 'hermes', 'kilo', 'opencode', 'qwen', 'trae', 'windsurf',
    ]);
  });
});
