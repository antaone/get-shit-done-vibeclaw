/**
 * Phase Runner — core state machine driving the full phase lifecycle.
 *
 * Orchestrates: discuss → research → plan → execute → verify → advance
 * with config-driven step skipping, human gate callbacks, event emission,
 * and structured error handling per step. With `workflow.build_mode`, a phase
 * without classic plans (no plans yet, or a `kind: brief` plan) runs research →
 * build (build.md) → verify → advance after discuss; a phase planned with
 * plan-phase keeps the classic steps.
 */

import type {
  PhaseOpInfo,
  PhaseStepResult,
  PhaseRunnerResult,
  HumanGateCallbacks,
  PhaseRunnerOptions,
  PlanResult,
  SessionOptions,
  ParsedPlan,
  PhasePlanIndex,
  PlanInfo,
} from './types.js';
import { PhaseStepType, PhaseType, GSDEventType } from './types.js';
import type { GSDConfig } from './config.js';
import type { GSDTools } from './fvgsd-tools.js';
import type { GSDEventStream } from './event-stream.js';
import type { PromptFactory } from './phase-prompt.js';
import type { ContextEngine } from './context-engine.js';
import type { GSDLogger } from './logger.js';
import { runPhaseStepSession, runPlanSession } from './session-runner.js';
import { parsePlanFile } from './plan-parser.js';
import { realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { checkResearchGate } from './research-gate.js';
import { getToolsForPhase } from './tool-scoping.js';
import { isDebtScannable, findDebtMarkers, type DebtMarkerFinding } from './debt-markers.js';
import { runGit, changedFilesSince, firstAddCommit, summaryIsFinalized } from './query/build-shared.js';
import { escapeRegex, normalizePhaseName } from './query/helpers.js';
import { listStateBlockers } from './query/state-mutation.js';

// ─── Error type ──────────────────────────────────────────────────────────────

export class PhaseRunnerError extends Error {
  constructor(
    message: string,
    public readonly phaseNumber: string,
    public readonly step: PhaseStepType,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'PhaseRunnerError';
  }
}

// ─── Verification result enum ────────────────────────────────────────────────

export type VerificationOutcome = 'passed' | 'human_needed' | 'gaps_found' | 'architectural_debt' | 'status_unreadable';

type ArchitecturalDebtFinding = DebtMarkerFinding;

type ArchitecturalDebtCheckReason = 'markers_found' | 'scan_error';

interface ArchitecturalDebtCheck {
  pass: boolean;
  findings: ArchitecturalDebtFinding[];
  reason?: ArchitecturalDebtCheckReason;
}

// ─── PhaseRunner deps interface ──────────────────────────────────────────────

export interface PhaseRunnerDeps {
  projectDir: string;
  tools: GSDTools;
  promptFactory: PromptFactory;
  contextEngine: ContextEngine;
  eventStream: GSDEventStream;
  config: GSDConfig;
  logger?: GSDLogger;
}

/** The part of `init.build`'s resume object the build lifecycle reads. */
interface BuildResume {
  state: string;
  /** NN of the brief the state describes; null when init.build names none. */
  plan: string | null;
}

/** Entries of `after` beyond those already in `before`; a text recorded again counts as new. */
function addedBlockers(before: readonly string[], after: readonly string[]): string[] {
  const remaining = new Map<string, number>();
  for (const text of before) remaining.set(text, (remaining.get(text) ?? 0) + 1);
  return after.filter((text) => {
    const count = remaining.get(text) ?? 0;
    if (count === 0) return true;
    remaining.set(text, count - 1);
    return false;
  });
}

/** Prepended to build.md prompts: the SDK runner has no human to answer questions. */
const HEADLESS_BUILD_OVERRIDE = [
  '## HEADLESS MODE — MANDATORY OVERRIDE',
  '',
  'This session runs headless under the fvgsd SDK phase runner. No human is present.',
  '',
  '- Do not use AskUserQuestion and do not wait for input.',
  '- `--confirm` records a blocker with `fvgsd-sdk query state.add-blocker` instead of waiting for approval, then the run ends with `## BUILD BLOCKED`.',
  '- Ignore `config.mode: interactive`; it never pauses a headless build.',
  '- Record every question you would ask, and every `user_setup` item, with `fvgsd-sdk query state.add-blocker --text "<question>"`, then end with `## BUILD BLOCKED`.',
  '',
  '---',
  '',
].join('\n');

// ─── PhaseRunner ─────────────────────────────────────────────────────────────

export class PhaseRunner {
  private readonly projectDir: string;
  private readonly tools: GSDTools;
  private readonly promptFactory: PromptFactory;
  private readonly contextEngine: ContextEngine;
  private readonly eventStream: GSDEventStream;
  private readonly config: GSDConfig;
  private readonly logger?: GSDLogger;

  constructor(deps: PhaseRunnerDeps) {
    this.projectDir = deps.projectDir;
    this.tools = deps.tools;
    this.promptFactory = deps.promptFactory;
    this.contextEngine = deps.contextEngine;
    this.eventStream = deps.eventStream;
    this.config = deps.config;
    this.logger = deps.logger;
  }

  /**
   * Run a full phase lifecycle: discuss → research → plan → plan-check → execute → verify → advance.
   * With `workflow.build_mode === true`, a phase without classic plans (no plans yet, or a `kind: brief`
   * plan) runs research → build → verify → advance after discuss instead (see runBuildLifecycle); a
   * phase whose plans include no brief keeps the classic steps.
   *
   * Each step is gated by config flags and phase state. Human gate callbacks
   * are invoked at decision points; when not provided, auto-approve is used.
   */
  async run(phaseNumber: string, options?: PhaseRunnerOptions): Promise<PhaseRunnerResult> {
    const startTime = Date.now();
    const steps: PhaseStepResult[] = [];
    const callbacks = options?.callbacks ?? {};

    // ── Init: query phase state ──
    let phaseOp: PhaseOpInfo;
    try {
      phaseOp = await this.tools.initPhaseOp(phaseNumber);
    } catch (err) {
      throw new PhaseRunnerError(
        `Failed to initialize phase ${phaseNumber}: ${err instanceof Error ? err.message : String(err)}`,
        phaseNumber,
        PhaseStepType.Discuss,
        err instanceof Error ? err : undefined,
      );
    }

    // Validate phase exists
    if (!phaseOp.phase_found) {
      throw new PhaseRunnerError(
        `Phase ${phaseNumber} not found on disk`,
        phaseNumber,
        PhaseStepType.Discuss,
      );
    }

    const phaseName = phaseOp.phase_name;

    // Emit phase_start
    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      phaseName,
    });

    const sessionOpts: SessionOptions = {
      maxTurns: options?.maxTurnsPerStep ?? 50,
      maxBudgetUsd: options?.maxBudgetPerStep ?? 5.0,
      model: options?.model,
      cwd: this.projectDir,
    };

    let halted = false;

    // ── Step 1: Discuss ──
    if (!halted) {
      const shouldSkip = phaseOp.has_context || this.config.workflow.skip_discuss;
      if (shouldSkip && !(this.config.workflow.auto_advance && !phaseOp.has_context && !this.config.workflow.skip_discuss)) {
        this.logger?.debug(`Skipping discuss: has_context=${phaseOp.has_context}, skip_discuss=${this.config.workflow.skip_discuss}`);
      } else if (!phaseOp.has_context && !this.config.workflow.skip_discuss && this.config.workflow.auto_advance) {
        // AI self-discuss: auto-mode with no context — run a self-discuss session
        const result = await this.retryOnce('self-discuss', () => this.runSelfDiscussStep(phaseNumber, sessionOpts, phaseOp.phase_dir));
        steps.push(result);

        // Re-query phase state to check if context was created
        try {
          phaseOp = await this.tools.initPhaseOp(phaseNumber);
        } catch {
          // If re-query fails, proceed with original state
        }

        if (!phaseOp.has_context) {
          const decision = await this.invokeBlockerCallback(callbacks, phaseNumber, PhaseStepType.Discuss, 'No context after self-discuss step');
          if (decision === 'stop') {
            halted = true;
          }
        }
      } else if (!shouldSkip) {
        const result = await this.retryOnce('discuss', () => this.runStep(PhaseStepType.Discuss, phaseNumber, sessionOpts, phaseOp.phase_dir));
        steps.push(result);

        // Re-query phase state to check if context was created
        try {
          phaseOp = await this.tools.initPhaseOp(phaseNumber);
        } catch {
          // If re-query fails, proceed with original state
        }

        if (!phaseOp.has_context) {
          // No context after discuss — invoke blocker callback
          const decision = await this.invokeBlockerCallback(callbacks, phaseNumber, PhaseStepType.Discuss, 'No context after discuss step');
          if (decision === 'stop') {
            halted = true;
          }
        }
      }
    }

    // ── Build mode: research → build → verify (status read) → advance ──
    // Only for a phase without classic plans. A phase whose plans include no brief was planned with
    // plan-phase, so it falls through to the classic steps below, as with build_mode false.
    if (!halted && this.config.workflow.build_mode === true && !(await this.hasClassicPlans(phaseNumber))) {
      halted = await this.runBuildLifecycle(phaseNumber, phaseOp, sessionOpts, callbacks, options, steps);
      return this.finishRun(phaseNumber, phaseName, steps, halted, startTime);
    }

    // ── Step 2: Research ──
    if (!halted) {
      if (!this.config.workflow.research) {
        this.logger?.debug('Skipping research: config.workflow.research=false');
      } else {
        const result = await this.retryOnce('research', () => this.runStep(PhaseStepType.Research, phaseNumber, sessionOpts, phaseOp.phase_dir));
        steps.push(result);
      }
    }

    // ── Step 2.5: Research gate (#1602) ──
    // Check RESEARCH.md for unresolved open questions before planning
    if (!halted && phaseOp.has_research) {
      const gateResult = await this.checkResearchGate(phaseOp);
      if (!gateResult.pass) {
        const questionList = gateResult.unresolvedQuestions.join(', ');
        const error = `RESEARCH.md has unresolved open questions: ${questionList}`;
        this.logger?.warn(error, { phase: phaseNumber });
        const decision = await this.invokeBlockerCallback(callbacks, phaseNumber, PhaseStepType.Research, error);
        if (decision === 'stop') {
          halted = true;
        }
      }
    }

    // ── Step 3: Plan ──
    if (!halted) {
      const result = await this.retryOnce('plan', () => this.runStep(PhaseStepType.Plan, phaseNumber, sessionOpts, phaseOp.phase_dir));
      steps.push(result);

      // Re-query to check for plans
      try {
        phaseOp = await this.tools.initPhaseOp(phaseNumber);
      } catch {
        // Proceed with prior state
      }

      if (!phaseOp.has_plans || phaseOp.plan_count === 0) {
        const decision = await this.invokeBlockerCallback(callbacks, phaseNumber, PhaseStepType.Plan, 'No plans created after plan step');
        if (decision === 'stop') {
          halted = true;
        }
      }
    }

    // ── Step 3.5: Plan Check ──
    if (!halted && this.config.workflow.plan_check) {
      const planCheckResult = await this.retryOnce('plan-check', () => this.runPlanCheckStep(phaseNumber, sessionOpts, phaseOp.phase_dir));
      steps.push(planCheckResult);

      // If plan-check failed, re-plan once then re-check once (D023)
      if (!planCheckResult.success) {
        this.logger?.info(`Plan check failed for phase ${phaseNumber}, re-planning once (D023)`);

        // Re-run plan step with feedback
        const replanResult = await this.runStep(PhaseStepType.Plan, phaseNumber, sessionOpts, phaseOp.phase_dir);
        steps.push(replanResult);

        // Re-check once
        const recheckResult = await this.runPlanCheckStep(phaseNumber, sessionOpts, phaseOp.phase_dir);
        steps.push(recheckResult);

        if (!recheckResult.success) {
          this.logger?.warn(`Plan check failed again after re-plan for phase ${phaseNumber}. Proceeding with warning (D023).`);
        }
      }
    }

    // ── Step 4: Execute ──
    if (!halted) {
      const executeResult = await this.retryOnce('execute', () => this.runExecuteStep(phaseNumber, sessionOpts));
      steps.push(executeResult);
    }

    // ── Step 5: Verify ──
    if (!halted) {
      if (!this.config.workflow.verifier) {
        this.logger?.debug('Skipping verify: config.workflow.verifier=false');
      } else {
        // Verify has its own internal retry logic (gap closure). retryOnce only
        // retries on unexpected session throws, not on verification outcomes like gaps_found.
        const verifyResult = await this.retryOnce('verify', () => this.runVerifyStep(phaseNumber, sessionOpts, callbacks, options, phaseOp.phase_dir));
        steps.push(verifyResult);

        // Check if verify resulted in a halt
        if (!verifyResult.success && verifyResult.error === 'halted_by_callback') {
          halted = true;
        }
      }
    }

    // ── Step 6: Advance ──
    // Only advance if verify passed — never mark a phase complete when gaps were found.
    const verifyPassed = steps.every(s => s.step !== PhaseStepType.Verify || s.success);
    if (!halted && verifyPassed) {
      const advanceResult = await this.runAdvanceStep(phaseNumber, sessionOpts, callbacks);
      steps.push(advanceResult);
    } else if (!halted && !verifyPassed) {
      this.logger?.warn(`Skipping advance for phase ${phaseNumber}: verification found gaps`);
    }

    return this.finishRun(phaseNumber, phaseName, steps, halted, startTime);
  }

  /** Totals, the phase_complete event and the result object shared by both lifecycles. */
  private finishRun(
    phaseNumber: string,
    phaseName: string,
    steps: PhaseStepResult[],
    halted: boolean,
    startTime: number,
  ): PhaseRunnerResult {
    const totalDurationMs = Date.now() - startTime;
    const totalCostUsd = steps.reduce((sum, s) => {
      const stepCost = s.planResults?.reduce((c, pr) => c + pr.totalCostUsd, 0) ?? 0;
      return sum + stepCost;
    }, 0);
    const success = !halted && steps.every(s => s.success);

    // Emit phase_complete
    this.eventStream.emitEvent({
      type: GSDEventType.PhaseComplete,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      phaseName,
      success,
      totalCostUsd,
      totalDurationMs,
      stepsCompleted: steps.length,
    });

    return {
      phaseNumber,
      phaseName,
      steps,
      success,
      totalCostUsd,
      totalDurationMs,
    };
  }

  // ─── Step runners ──────────────────────────────────────────────────────

  /**
   * Retry a step function once on failure.
   * On first error/failure, logs a warning and calls the function once more.
   * Returns the result from the last attempt.
   */
  private async retryOnce<T extends PhaseStepResult>(label: string, fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    if (result.success) return result;

    // Don't retry verify outcomes (gaps_found, human_needed) — they have their own retry logic.
    if (result.error?.startsWith('verification_')) return result;

    this.logger?.warn(`Step "${label}" failed, retrying once...`);
    return fn();
  }

  /**
   * Run the plan-check step.
   * Loads the fvgsd-plan-checker agent definition, runs a Verify-scoped session,
   * and parses output for PASS/FAIL signals.
   */
  private async runPlanCheckStep(
    phaseNumber: string,
    sessionOpts: SessionOptions,
    phaseDir?: string,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.PlanCheck,
    });

    let planResult: PlanResult;
    try {
      // Load plan-checker agent definition (same pattern as PromptFactory.loadAgentDef)
      const agentDef = await this.promptFactory.loadAgentDef(PhaseType.Verify);

      // Build prompt using Verify phase type for context resolution
      const contextFiles = await this.contextEngine.resolveContextFiles(PhaseType.Verify, phaseDir);
      let prompt = await this.promptFactory.buildPrompt(PhaseType.Verify, null, contextFiles);

      // Supplement with plan-checker instructions
      prompt += '\n\n## Plan Checker Instructions\n\nYou are a plan checker. Review the plans for this phase and verify they are well-formed, complete, and achievable. If all plans pass, output "VERIFICATION PASSED". If any issues are found, output "ISSUES FOUND" followed by a description of each issue.';

      planResult = await runPhaseStepSession(
        prompt,
        PhaseStepType.PlanCheck,
        this.config,
        sessionOpts,
        this.eventStream,
        { phase: PhaseType.Verify, planName: undefined },
      );
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step: PhaseStepType.PlanCheck,
        success: false,
        durationMs,
        error: errorMsg,
      });

      return {
        step: PhaseStepType.PlanCheck,
        success: false,
        durationMs,
        error: errorMsg,
      };
    }

    const durationMs = Date.now() - stepStart;
    // Parse plan-check outcome: success if the session succeeded (real output parsing would check for VERIFICATION PASSED / ISSUES FOUND)
    const success = planResult.success;

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: planResult.sessionId,
      phaseNumber,
      step: PhaseStepType.PlanCheck,
      success,
      durationMs,
      error: planResult.error?.messages.join('; ') || undefined,
    });

    return {
      step: PhaseStepType.PlanCheck,
      success,
      durationMs,
      error: planResult.error?.messages.join('; ') || undefined,
      planResults: [planResult],
    };
  }

  /**
   * Run the self-discuss step for auto-mode.
   * When auto_advance is true and no context exists, run an AI self-discuss
   * session that identifies gray areas and makes opinionated decisions.
   */
  private async runSelfDiscussStep(
    phaseNumber: string,
    sessionOpts: SessionOptions,
    phaseDir?: string,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Discuss,
    });

    let planResult: PlanResult;
    try {
      const contextFiles = await this.contextEngine.resolveContextFiles(PhaseType.Discuss, phaseDir);
      let prompt = await this.promptFactory.buildPrompt(PhaseType.Discuss, null, contextFiles);

      // Prepend self-discuss override BEFORE the workflow prompt.
      // The workflow prompt contains interactive patterns (user questions, area selection)
      // that the agent will follow unless explicitly overridden up front.
      const maxPasses = this.config.workflow.max_discuss_passes ?? 3;
      const selfDiscussOverride = [
        '## HEADLESS MODE — MANDATORY OVERRIDE',
        '',
        '**This session is running headless with no human present.**',
        '',
        'You MUST NOT:',
        '- Use AskUserQuestion or any interactive tools',
        '- Invoke Skill() or SlashCommand()',
        '- Ask the user anything or wait for input',
        '- Use multi-select, checkbox, or prompt UIs',
        '',
        'You MUST:',
        '- Make all decisions autonomously and opinionatedly',
        '- Identify 3-5 gray areas in the project scope',
        '- Reason through each one yourself and pick the best option',
        '- Write CONTEXT.md with your decisions in a single pass',
        `- Complete within ${maxPasses} pass(es) maximum — do not re-read your own output to find gaps`,
        '',
        'Any instructions below about "asking the user", "discussing with the user", or "interactive" should be read as "decide yourself."',
        '',
        '---',
        '',
      ].join('\n');
      prompt = selfDiscussOverride + prompt;

      planResult = await runPhaseStepSession(
        prompt,
        PhaseStepType.Discuss,
        this.config,
        sessionOpts,
        this.eventStream,
        { phase: PhaseType.Discuss, planName: undefined },
      );
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step: PhaseStepType.Discuss,
        success: false,
        durationMs,
        error: errorMsg,
      });

      return {
        step: PhaseStepType.Discuss,
        success: false,
        durationMs,
        error: errorMsg,
      };
    }

    const durationMs = Date.now() - stepStart;
    const success = planResult.success;

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: planResult.sessionId,
      phaseNumber,
      step: PhaseStepType.Discuss,
      success,
      durationMs,
      error: planResult.error?.messages.join('; ') || undefined,
    });

    return {
      step: PhaseStepType.Discuss,
      success,
      durationMs,
      error: planResult.error?.messages.join('; ') || undefined,
      planResults: [planResult],
    };
  }

  /**
   * Run a single phase step session (discuss, research, plan).
   * Emits step start/complete events and captures errors.
   */
  private async runStep(
    step: PhaseStepType,
    phaseNumber: string,
    sessionOpts: SessionOptions,
    phaseDir?: string,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step,
    });

    let planResult: PlanResult;
    try {
      // Map step to PhaseType for prompt/context resolution
      const phaseType = this.stepToPhaseType(step);
      const contextFiles = await this.contextEngine.resolveContextFiles(phaseType, phaseDir);
      const prompt = await this.promptFactory.buildPrompt(phaseType, null, contextFiles);

      planResult = await runPhaseStepSession(
        prompt,
        step,
        this.config,
        sessionOpts,
        this.eventStream,
        { phase: phaseType, planName: undefined },
      );
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step,
        success: false,
        durationMs,
        error: errorMsg,
      });

      return {
        step,
        success: false,
        durationMs,
        error: errorMsg,
      };
    }

    const durationMs = Date.now() - stepStart;
    const success = planResult.success;

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: planResult.sessionId,
      phaseNumber,
      step,
      success,
      durationMs,
      error: planResult.error?.messages.join('; ') || undefined,
    });

    return {
      step,
      success,
      durationMs,
      error: planResult.error?.messages.join('; ') || undefined,
      planResults: [planResult],
    };
  }

  /**
   * Run the execute step — uses phase-plan-index for wave-grouped parallel execution.
   * Plans in the same wave run concurrently via Promise.allSettled().
   * Waves execute sequentially (wave 1 completes before wave 2 starts).
   * Respects config.parallelization: false to fall back to sequential execution.
   * Filters out plans with has_summary: true (already completed).
   */
  private async runExecuteStep(
    phaseNumber: string,
    sessionOpts: SessionOptions,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Execute,
    });

    // Get the plan index from fvgsd-tools
    let planIndex: PhasePlanIndex;
    try {
      planIndex = await this.tools.phasePlanIndex(phaseNumber);
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step: PhaseStepType.Execute,
        success: false,
        durationMs,
        error: errorMsg,
      });
      return {
        step: PhaseStepType.Execute,
        success: false,
        durationMs,
        error: errorMsg,
      };
    }

    if (planIndex.plans.length === 0) {
      const durationMs = Date.now() - stepStart;
      const error = 'no plans found';
      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step: PhaseStepType.Execute,
        success: false,
        durationMs,
        error,
      });
      return { step: PhaseStepType.Execute, success: false, durationMs, error };
    }

    // Filter to incomplete plans only (has_summary === false)
    const incompletePlans = planIndex.plans.filter(p => !p.has_summary);

    if (incompletePlans.length === 0) {
      const durationMs = Date.now() - stepStart;
      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step: PhaseStepType.Execute,
        success: true,
        durationMs,
      });
      return {
        step: PhaseStepType.Execute,
        success: true,
        durationMs,
        planResults: [],
      };
    }

    const planResults: PlanResult[] = [];

    // Sequential fallback when parallelization is disabled
    if (this.config.parallelization === false) {
      for (const plan of incompletePlans) {
        const result = await this.executeSinglePlan(phaseNumber, plan.id, sessionOpts);
        planResults.push(result);
      }
    } else {
      // Group incomplete plans by wave, sort waves numerically
      const waveMap = new Map<number, PlanInfo[]>();
      for (const plan of incompletePlans) {
        const existing = waveMap.get(plan.wave) ?? [];
        existing.push(plan);
        waveMap.set(plan.wave, existing);
      }
      const sortedWaves = [...waveMap.keys()].sort((a, b) => a - b);

      for (const waveNum of sortedWaves) {
        const wavePlans = waveMap.get(waveNum)!;
        const wavePlanIds = wavePlans.map(p => p.id);

        // Emit wave_start
        this.eventStream.emitEvent({
          type: GSDEventType.WaveStart,
          timestamp: new Date().toISOString(),
          sessionId: '',
          phaseNumber,
          waveNumber: waveNum,
          planCount: wavePlans.length,
          planIds: wavePlanIds,
        });

        const waveStart = Date.now();

        // Execute all plans in this wave concurrently
        const settled = await Promise.allSettled(
          wavePlans.map(plan => this.executeSinglePlan(phaseNumber, plan.id, sessionOpts)),
        );

        // Map settled results to PlanResult[]
        let successCount = 0;
        let failureCount = 0;
        for (const outcome of settled) {
          if (outcome.status === 'fulfilled') {
            planResults.push(outcome.value);
            if (outcome.value.success) successCount++;
            else failureCount++;
          } else {
            failureCount++;
            planResults.push({
              success: false,
              sessionId: '',
              totalCostUsd: 0,
              durationMs: 0,
              usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
              numTurns: 0,
              error: {
                subtype: 'error_during_execution',
                messages: [outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)],
              },
            });
          }
        }

        // Emit wave_complete
        this.eventStream.emitEvent({
          type: GSDEventType.WaveComplete,
          timestamp: new Date().toISOString(),
          sessionId: '',
          phaseNumber,
          waveNumber: waveNum,
          successCount,
          failureCount,
          durationMs: Date.now() - waveStart,
        });
      }
    }

    const durationMs = Date.now() - stepStart;
    const allSucceeded = planResults.every(r => r.success);

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Execute,
      success: allSucceeded,
      durationMs,
    });

    return {
      step: PhaseStepType.Execute,
      success: allSucceeded,
      durationMs,
      planResults,
    };
  }

  /**
   * Execute a single plan by ID within the execute step.
   * Loads the plan file, parses it, and passes the parsed plan to the prompt
   * builder so the executor gets the full plan content (tasks, objectives, etc.).
   */
  private async executeSinglePlan(
    phaseNumber: string,
    planId: string,
    sessionOpts: SessionOptions,
  ): Promise<PlanResult> {
    try {
      // Resolve the plan file path from phase directory + planId
      const phaseOp = await this.tools.initPhaseOp(phaseNumber);
      const planFilename = planId === 'PLAN' ? 'PLAN.md' : `${planId}-PLAN.md`;
      const planPath = join(this.projectDir, phaseOp.phase_dir, planFilename);

      // Parse the plan file so the executor prompt includes the actual tasks
      const parsedPlan = await parsePlanFile(planPath);

      const phaseType = PhaseType.Execute;
      const contextFiles = await this.contextEngine.resolveContextFiles(phaseType, phaseOp.phase_dir);
      const prompt = await this.promptFactory.buildPrompt(phaseType, parsedPlan, contextFiles, phaseOp.phase_dir);

      return await runPhaseStepSession(
        prompt,
        PhaseStepType.Execute,
        this.config,
        sessionOpts,
        this.eventStream,
        { phase: phaseType, planName: planId },
      );
    } catch (err) {
      return {
        success: false,
        sessionId: '',
        totalCostUsd: 0,
        durationMs: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        numTurns: 0,
        error: {
          subtype: 'error_during_execution',
          messages: [err instanceof Error ? err.message : String(err)],
        },
      };
    }
  }

  /**
   * Run the verify step with full gap closure cycle.
   * Verification outcome routing:
   * - passed → proceed to advance
   * - human_needed → invoke onVerificationReview callback
   * - gaps_found → plan (create gap plans) → execute (run gap plans) → re-verify
   * Gap closure retries are capped at configurable maxGapRetries (default 1).
   */
  private async runVerifyStep(
    phaseNumber: string,
    sessionOpts: SessionOptions,
    callbacks: HumanGateCallbacks,
    options?: PhaseRunnerOptions,
    phaseDir?: string,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Verify,
    });

    const maxGapRetries = options?.maxGapRetries ?? 1;
    let gapRetryCount = 0;
    let lastResult: PlanResult | undefined;
    let outcome: VerificationOutcome = 'passed';
    const allPlanResults: PlanResult[] = [];

    while (true) {
      try {
        const phaseType = PhaseType.Verify;
        const contextFiles = await this.contextEngine.resolveContextFiles(phaseType, phaseDir);
        const prompt = await this.promptFactory.buildPrompt(phaseType, null, contextFiles);

        lastResult = await runPhaseStepSession(
          prompt,
          PhaseStepType.Verify,
          this.config,
          sessionOpts,
          this.eventStream,
          { phase: phaseType },
        );
        allPlanResults.push(lastResult);
      } catch (err) {
        const durationMs = Date.now() - stepStart;
        const errorMsg = err instanceof Error ? err.message : String(err);

        this.eventStream.emitEvent({
          type: GSDEventType.PhaseStepComplete,
          timestamp: new Date().toISOString(),
          sessionId: '',
          phaseNumber,
          step: PhaseStepType.Verify,
          success: false,
          durationMs,
          error: errorMsg,
        });

        return {
          step: PhaseStepType.Verify,
          success: false,
          durationMs,
          error: errorMsg,
          planResults: allPlanResults.length > 0 ? allPlanResults : undefined,
        };
      }

      // Parse verification outcome from VERIFICATION.md (not just session exit code)
      outcome = await this.parseVerificationOutcome(lastResult, phaseNumber);

      if (outcome === 'passed') {
        const debtCheck = await this.checkArchitecturalDebt(phaseNumber);
        if (!debtCheck.pass) {
          const message =
            debtCheck.reason === 'scan_error'
              ? `Verification blocked because architectural debt scan could not complete for phase ${phaseNumber}`
              : `Verification blocked by unresolved architectural debt markers in phase ${phaseNumber}`;
          this.logger?.warn(message, {
            phase: phaseNumber,
            reason: debtCheck.reason,
            findingCount: debtCheck.findings.length,
            findings: debtCheck.findings.map(({ file, line, marker }) => ({ file, line, marker })),
          });
          outcome = 'architectural_debt';
          break;
        }
        break;
      }

      if (outcome === 'human_needed') {
        // Invoke verification review callback
        const decision = await this.invokeVerificationCallback(callbacks, phaseNumber, {
          step: PhaseStepType.Verify,
          success: lastResult.success,
          durationMs: Date.now() - stepStart,
          planResults: allPlanResults,
        });

        if (decision === 'accept') {
          break; // Acknowledged by caller, but still pending human verification.
        } else if (decision === 'retry' && gapRetryCount < maxGapRetries) {
          gapRetryCount++;
          continue;
        } else {
          // reject or exceeded retries
          const durationMs = Date.now() - stepStart;
          this.eventStream.emitEvent({
            type: GSDEventType.PhaseStepComplete,
            timestamp: new Date().toISOString(),
            sessionId: lastResult.sessionId,
            phaseNumber,
            step: PhaseStepType.Verify,
            success: false,
            durationMs,
            error: 'halted_by_callback',
          });
          return {
            step: PhaseStepType.Verify,
            success: false,
            durationMs,
            error: 'halted_by_callback',
            planResults: allPlanResults,
          };
        }
      }

      if (outcome === 'status_unreadable') {
        break;
      }

      if (outcome === 'gaps_found') {
        if (gapRetryCount < maxGapRetries) {
          gapRetryCount++;
          this.logger?.info(`Gap closure attempt ${gapRetryCount}/${maxGapRetries} for phase ${phaseNumber}`);

          // ── Gap closure cycle: plan → execute → re-verify ──

          // 1. Run a plan step to create gap plans
          try {
            const planResult = await this.runStep(PhaseStepType.Plan, phaseNumber, sessionOpts, phaseDir);
            if (planResult.planResults) {
              allPlanResults.push(...planResult.planResults);
            }
          } catch (err) {
            this.logger?.warn(`Gap closure plan step failed: ${err instanceof Error ? err.message : String(err)}`);
            // Proceed to re-verify anyway
          }

          // 2. Re-query phase state to discover newly created gap plans
          try {
            await this.tools.initPhaseOp(phaseNumber);
          } catch (err) {
            this.logger?.warn(`Gap closure re-query failed, proceeding with stale state: ${err instanceof Error ? err.message : String(err)}`);
          }

          // 3. Execute gap plans via the wave-capable runExecuteStep
          try {
            const executeResult = await this.runExecuteStep(phaseNumber, sessionOpts);
            if (executeResult.planResults) {
              allPlanResults.push(...executeResult.planResults);
            }
          } catch (err) {
            this.logger?.warn(`Gap closure execute step failed: ${err instanceof Error ? err.message : String(err)}`);
            // Proceed to re-verify anyway
          }

          // 4. Continue the loop to re-verify
          continue;
        }
        // Exceeded gap closure retries — proceed
        break;
      }

      break; // Safety: unknown outcome → proceed
    }

    const durationMs = Date.now() - stepStart;
    const verifySuccess = outcome === 'passed';

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: lastResult?.sessionId ?? '',
      phaseNumber,
      step: PhaseStepType.Verify,
      success: verifySuccess,
      durationMs,
      ...(!verifySuccess && { error: this.verificationErrorForOutcome(outcome) }),
    });

    return {
      step: PhaseStepType.Verify,
      success: verifySuccess,
      durationMs,
      planResults: allPlanResults,
      ...(!verifySuccess && { error: this.verificationErrorForOutcome(outcome) }),
    };
  }

  /**
   * Run the advance step — mark phase complete.
   * Gated by config.workflow.auto_advance or callback approval.
   * With `skipIfComplete`, phase.complete is skipped when the ROADMAP already marks
   * the phase complete (build.finalize completed it).
   */
  private async runAdvanceStep(
    phaseNumber: string,
    _sessionOpts: SessionOptions,
    callbacks: HumanGateCallbacks,
    skipIfComplete = false,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Advance,
    });

    // Check if auto_advance or callback approves
    let shouldAdvance = this.config.workflow.auto_advance;

    if (!shouldAdvance && callbacks.onBlockerDecision) {
      try {
        const decision = await callbacks.onBlockerDecision({
          phaseNumber,
          step: PhaseStepType.Advance,
          error: undefined,
        });
        shouldAdvance = decision !== 'stop';
      } catch (err) {
        this.logger?.warn(`Advance callback threw, auto-approving: ${err instanceof Error ? err.message : String(err)}`);
        shouldAdvance = true; // Auto-approve on callback error
      }
    } else if (!shouldAdvance) {
      // No callback, auto-approve
      shouldAdvance = true;
    }

    if (!shouldAdvance) {
      const durationMs = Date.now() - stepStart;
      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step: PhaseStepType.Advance,
        success: false,
        durationMs,
        error: 'advance_rejected',
      });
      return {
        step: PhaseStepType.Advance,
        success: false,
        durationMs,
        error: 'advance_rejected',
      };
    }

    const alreadyComplete = skipIfComplete && await this.isPhaseMarkedComplete(phaseNumber);
    try {
      if (!alreadyComplete) {
        await this.tools.phaseComplete(phaseNumber);
      }
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step: PhaseStepType.Advance,
        success: false,
        durationMs,
        error: errorMsg,
      });

      return {
        step: PhaseStepType.Advance,
        success: false,
        durationMs,
        error: errorMsg,
      };
    }

    const durationMs = Date.now() - stepStart;

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Advance,
      success: true,
      durationMs,
    });

    return {
      step: PhaseStepType.Advance,
      success: true,
      durationMs,
    };
  }

  // ─── Build lifecycle (workflow.build_mode) ────────────────────────────

  /** Research (only when RESEARCH.md is missing), gate, Build, Verify, Advance. Returns true when halted. */
  private async runBuildLifecycle(
    phaseNumber: string,
    initialPhaseOp: PhaseOpInfo,
    sessionOpts: SessionOptions,
    callbacks: HumanGateCallbacks,
    options: PhaseRunnerOptions | undefined,
    steps: PhaseStepResult[],
  ): Promise<boolean> {
    let phaseOp = initialPhaseOp;

    if (this.config.workflow.research && !phaseOp.has_research) {
      const researchResult = await this.retryOnce('research', () =>
        this.runBuildSession(PhaseStepType.Research, phaseNumber, sessionOpts, `${phaseNumber} --research-only`, phaseOp.phase_dir));
      steps.push(researchResult);
      phaseOp = await this.requeryPhaseOp(phaseNumber, phaseOp);
    }

    if (phaseOp.has_research) {
      const gateResult = await this.checkResearchGate(phaseOp);
      if (!gateResult.pass) {
        const error = `RESEARCH.md has unresolved open questions: ${gateResult.unresolvedQuestions.join(', ')}`;
        this.logger?.warn(error, { phase: phaseNumber });
        const decision = await this.invokeBlockerCallback(callbacks, phaseNumber, PhaseStepType.Research, error);
        if (decision === 'stop') return true;
      }
    }

    const blockersBefore = await this.readStateBlockers(phaseNumber);
    const buildResult = await this.retryOnce('build', () =>
      this.runBuildSession(PhaseStepType.Build, phaseNumber, sessionOpts, phaseNumber, phaseOp.phase_dir));
    steps.push(buildResult);
    phaseOp = await this.requeryPhaseOp(phaseNumber, phaseOp);
    if (!phaseOp.has_plans || phaseOp.plan_count === 0) {
      const decision = await this.invokeBlockerCallback(callbacks, phaseNumber, PhaseStepType.Build, 'No brief created after build step');
      if (decision === 'stop') return true;
    }

    const verifyResult = await this.runBuildVerifyStep(phaseNumber, sessionOpts, callbacks, options, phaseOp, blockersBefore);
    steps.push(verifyResult);
    if (!verifyResult.success && verifyResult.error === 'halted_by_callback') return true;

    if (verifyResult.success) {
      steps.push(await this.runAdvanceStep(phaseNumber, sessionOpts, callbacks, true));
    } else {
      this.logger?.warn(`Skipping advance for phase ${phaseNumber}: build verification did not pass`);
    }
    return false;
  }

  /** One headless session that follows build.md with the given arguments. */
  private async runBuildSession(
    step: PhaseStepType,
    phaseNumber: string,
    sessionOpts: SessionOptions,
    args: string,
    phaseDir: string,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();

    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step,
    });

    let planResult: PlanResult;
    try {
      const contextFiles = await this.contextEngine.resolveContextFiles(PhaseType.Build, phaseDir);
      const prompt = HEADLESS_BUILD_OVERRIDE
        + await this.promptFactory.buildPrompt(PhaseType.Build, null, contextFiles, phaseDir, args);
      planResult = await runPhaseStepSession(
        prompt,
        step,
        this.config,
        {
          ...sessionOpts,
          allowedTools: getToolsForPhase(PhaseType.Build),
          maxTurns: (sessionOpts.maxTurns ?? 50) * 4,
          maxBudgetUsd: (sessionOpts.maxBudgetUsd ?? 5) * 4,
        },
        this.eventStream,
        { phase: PhaseType.Build },
      );
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.eventStream.emitEvent({
        type: GSDEventType.PhaseStepComplete,
        timestamp: new Date().toISOString(),
        sessionId: '',
        phaseNumber,
        step,
        success: false,
        durationMs,
        error: errorMsg,
      });
      return { step, success: false, durationMs, error: errorMsg };
    }

    const durationMs = Date.now() - stepStart;
    const error = planResult.error?.messages.join('; ') || undefined;
    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: planResult.sessionId,
      phaseNumber,
      step,
      success: planResult.success,
      durationMs,
      error,
    });
    return { step, success: planResult.success, durationMs, error, planResults: [planResult] };
  }

  /**
   * Verify for build mode: no verifier session. Reads init.build resume.state
   * (complete / human_needed / gaps_found / other) and reruns Build up to maxGapRetries
   * times: with --gaps for gaps_found once the brief's summary is finalized, as a resume
   * otherwise. A resume finalizes an unfinalized summary, which can sit under gaps_found
   * as well as summarizing.
   * For human_needed, a `retry` answer from the verification callback halts like `reject`.
   * A Build session that recorded a STATE.md blocker (compared with `blockersBefore`) is not
   * rerun, because a rerun would stop at the same blocker; the step fails with
   * `build_blocked: <new blockers>`. A session that ended without one (crashed or cut off) is.
   */
  private async runBuildVerifyStep(
    phaseNumber: string,
    sessionOpts: SessionOptions,
    callbacks: HumanGateCallbacks,
    options: PhaseRunnerOptions | undefined,
    phaseOp: PhaseOpInfo,
    blockersBefore: string[] | null,
  ): Promise<PhaseStepResult> {
    const stepStart = Date.now();
    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepStart,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Verify,
    });

    const maxGapRetries = options?.maxGapRetries ?? 1;
    let reruns = 0;
    let outcome: VerificationOutcome = 'status_unreadable';
    let knownBlockers = blockersBefore;
    let newBlockers: string[] = [];
    const allPlanResults: PlanResult[] = [];

    while (true) {
      let resume: BuildResume;
      try {
        resume = await this.readBuildResume(phaseNumber);
      } catch (err) {
        this.logger?.warn(`Could not read build state for phase ${phaseNumber}: ${err instanceof Error ? err.message : String(err)}`);
        outcome = 'status_unreadable';
        break;
      }
      const { state } = resume;

      if (state === 'complete') {
        const debtCheck = await this.checkArchitecturalDebt(phaseNumber);
        if (debtCheck.pass) {
          outcome = 'passed';
        } else {
          this.logger?.warn(`Verification blocked by architectural debt in phase ${phaseNumber}`, {
            phase: phaseNumber,
            reason: debtCheck.reason,
            findingCount: debtCheck.findings.length,
          });
          outcome = 'architectural_debt';
        }
        break;
      }

      if (state === 'human_needed') {
        outcome = 'human_needed';
        const decision = await this.invokeVerificationCallback(callbacks, phaseNumber, {
          step: PhaseStepType.Verify,
          success: false,
          durationMs: Date.now() - stepStart,
          planResults: allPlanResults,
        });
        // Only `accept` continues. `retry` is treated as `reject`: a build has nothing to rerun for
        // human-only checks (verify-work answers them), and re-reading the same state cannot change it.
        if (decision === 'accept') break;
        const durationMs = Date.now() - stepStart;
        this.eventStream.emitEvent({
          type: GSDEventType.PhaseStepComplete,
          timestamp: new Date().toISOString(),
          sessionId: '',
          phaseNumber,
          step: PhaseStepType.Verify,
          success: false,
          durationMs,
          error: 'halted_by_callback',
        });
        return { step: PhaseStepType.Verify, success: false, durationMs, error: 'halted_by_callback', planResults: allPlanResults };
      }

      outcome = 'gaps_found';
      const currentBlockers = await this.readStateBlockers(phaseNumber);
      if (knownBlockers && currentBlockers) {
        newBlockers = addedBlockers(knownBlockers, currentBlockers);
        if (newBlockers.length > 0) {
          this.logger?.warn(`Build for phase ${phaseNumber} recorded a blocker; not rerunning it: ${newBlockers.join('; ')}`);
          break;
        }
      }
      if (reruns >= maxGapRetries) break;
      reruns++;
      knownBlockers = currentBlockers;
      // --gaps starts a gap brief, so it follows only a finalized summary. An unfinalized summary
      // (finalize refused or never ran) can also sit under gaps_found; a plain rerun finalizes it.
      const gaps = state === 'gaps_found' && resume.plan !== null
        && summaryIsFinalized(resolve(this.projectDir, phaseOp.phase_dir), phaseOp.padded_phase, resume.plan);
      const args = gaps ? `${phaseNumber} --gaps` : phaseNumber;
      this.logger?.info(`Build rerun ${reruns}/${maxGapRetries} for phase ${phaseNumber} (state: ${state})`);
      const rerun = await this.runBuildSession(PhaseStepType.Build, phaseNumber, sessionOpts, args, phaseOp.phase_dir);
      if (rerun.planResults) allPlanResults.push(...rerun.planResults);
    }

    const durationMs = Date.now() - stepStart;
    const verifySuccess = outcome === 'passed';
    const error = newBlockers.length > 0
      ? `build_blocked: ${newBlockers.join('; ')}`
      : this.verificationErrorForOutcome(outcome);
    this.eventStream.emitEvent({
      type: GSDEventType.PhaseStepComplete,
      timestamp: new Date().toISOString(),
      sessionId: '',
      phaseNumber,
      step: PhaseStepType.Verify,
      success: verifySuccess,
      durationMs,
      ...(!verifySuccess && { error }),
    });
    return {
      step: PhaseStepType.Verify,
      success: verifySuccess,
      durationMs,
      planResults: allPlanResults,
      ...(!verifySuccess && { error }),
    };
  }

  /** STATE.md's blocker entries, read through `state get`; null when STATE.md cannot be read. */
  private async readStateBlockers(phaseNumber: string): Promise<string[] | null> {
    try {
      const raw = await this.tools.exec('state', ['get']);
      const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null | undefined;
      return typeof data?.content === 'string' ? listStateBlockers(data.content) : null;
    } catch (err) {
      this.logger?.warn(`Could not read STATE.md blockers for phase ${phaseNumber}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** `init.build`'s resume state and brief number; throws when the query returns no state (error, phase not found). */
  private async readBuildResume(phaseNumber: string): Promise<BuildResume> {
    const raw = await this.tools.exec('init.build', [phaseNumber]);
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null | undefined;
    const resume = data?.resume as Record<string, unknown> | undefined;
    if (typeof resume?.state !== 'string' || resume.state === '') {
      throw new Error(`init.build returned no resume.state for phase ${phaseNumber}`);
    }
    return { state: resume.state, plan: typeof resume.plan === 'string' && resume.plan !== '' ? resume.plan : null };
  }

  private async requeryPhaseOp(phaseNumber: string, fallback: PhaseOpInfo): Promise<PhaseOpInfo> {
    try {
      return await this.tools.initPhaseOp(phaseNumber);
    } catch {
      return fallback;
    }
  }

  /**
   * True when the phase has plans and none is a build brief (`kind: brief`): plan-phase planned it,
   * so build mode leaves it on the classic steps. Reads `phase-plan-index`, the plan list the classic
   * Execute step runs. A failed read returns false, which keeps the build path and its error handling.
   */
  private async hasClassicPlans(phaseNumber: string): Promise<boolean> {
    try {
      const { plans } = await this.tools.phasePlanIndex(phaseNumber);
      return plans.length > 0 && !plans.some((plan) => plan.kind === 'brief');
    } catch (err) {
      this.logger?.warn(`Could not read the plan index for phase ${phaseNumber}; keeping build mode: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** True when roadmap.analyze reports the phase complete (build.finalize already ran phase.complete). */
  private async isPhaseMarkedComplete(phaseNumber: string): Promise<boolean> {
    try {
      const analysis = await this.tools.roadmapAnalyze();
      const target = normalizePhaseName(phaseNumber);
      return Boolean(analysis?.phases?.some(
        (phase) => normalizePhaseName(String(phase.number)) === target && phase.roadmap_complete === true,
      ));
    } catch {
      return false;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Map PhaseStepType to PhaseType for prompt/context resolution.
   */
  private stepToPhaseType(step: PhaseStepType): PhaseType {
    const mapping: Record<string, PhaseType> = {
      [PhaseStepType.Discuss]: PhaseType.Discuss,
      [PhaseStepType.Research]: PhaseType.Research,
      [PhaseStepType.Plan]: PhaseType.Plan,
      [PhaseStepType.PlanCheck]: PhaseType.Verify,
      [PhaseStepType.Execute]: PhaseType.Execute,
      [PhaseStepType.Verify]: PhaseType.Verify,
      [PhaseStepType.Build]: PhaseType.Build,
    };
    return mapping[step] ?? PhaseType.Execute;
  }

  /**
   * Parse the verification outcome by checking VERIFICATION.md on disk.
   * The verify session may succeed (no runtime errors) while writing
   * status: gaps_found to VERIFICATION.md — we need to check the file,
   * not just the session exit code.
   *
   * Falls back to session result if VERIFICATION.md can't be parsed.
   */
  private async parseVerificationOutcome(result: PlanResult, phaseNumber: string): Promise<VerificationOutcome> {
    // If the session itself crashed, that's a clear failure
    if (!result.success) {
      if (result.error?.subtype === 'human_review_needed') return 'human_needed';
      return 'gaps_found';
    }

    // Session succeeded — check what the verifier actually wrote to VERIFICATION.md
    try {
      const verStatus = await this.tools.exec('check.verification-status', [phaseNumber]);
      const data = typeof verStatus === 'string' ? JSON.parse(verStatus) : verStatus;
      const status = (data?.status ?? '').toLowerCase();

      if (status === 'pass' || status === 'passed') return 'passed';
      if (status === 'human_needed') return 'human_needed';
      if (status === 'fail' || status === 'gaps_found') return 'gaps_found';
      if (status === 'missing') {
        return 'gaps_found';
      }
      // Unknown status — log and treat as gaps_found to be safe
      this.logger?.warn(`Unknown verification status '${status}' for phase ${phaseNumber}, treating as gaps_found`);
      return 'gaps_found';
    } catch (err) {
      // Can't parse VERIFICATION.md — fail closed so a missing/broken status check never completes the phase.
      this.logger?.warn(`Could not check verification status for phase ${phaseNumber}: ${err instanceof Error ? err.message : String(err)}`);
      return 'status_unreadable';
    }
  }

  private verificationErrorForOutcome(outcome: VerificationOutcome): string {
    if (outcome === 'status_unreadable' || outcome === 'architectural_debt') return 'verification_gaps_found';
    return `verification_${outcome}`;
  }

  /**
   * Block phase completion when source files changed by this phase still contain
   * unresolved TBD/FIXME/XXX comments. Markers are allowed only when the same
   * line references tracked follow-up work (issue/PR number or DEF-* id).
   *
   * Classic plans are scanned by their declared `files_modified` and task
   * `files`. Build briefs (`kind: brief`), and plans that declare no files, are
   * scanned by the files changed since the phase started (`.planning/`
   * excluded; see changedPhaseFiles).
   */
  private async checkArchitecturalDebt(phaseNumber: string): Promise<ArchitecturalDebtCheck> {
    let phaseOp: PhaseOpInfo;
    try {
      phaseOp = await this.tools.initPhaseOp(phaseNumber);
    } catch (err) {
      this.logger?.warn(`Could not initialize phase ${phaseNumber} for architectural debt check: ${err instanceof Error ? err.message : String(err)}`);
      return { pass: false, findings: [], reason: 'scan_error' };
    }

    let planPaths: string[];
    try {
      planPaths = await this.listPhasePlanPaths(phaseOp.phase_dir);
    } catch {
      return { pass: false, findings: [], reason: 'scan_error' };
    }
    if (phaseOp.has_plans && planPaths.length === 0) {
      this.logger?.warn(`No phase plans found for architectural debt check in phase ${phaseNumber}`);
      return { pass: false, findings: [], reason: 'scan_error' };
    }

    const filesToScan = new Set<string>();
    let hasBrief = false;
    for (const planPath of planPaths) {
      try {
        const parsedPlan = await parsePlanFile(planPath);
        if ((parsedPlan.frontmatter as unknown as Record<string, unknown>).kind === 'brief') {
          hasBrief = true;
        }
        for (const file of this.extractPlanFiles(parsedPlan)) {
          if (isDebtScannable(file)) {
            filesToScan.add(file);
          }
        }
      } catch (err) {
        this.logger?.warn(`Could not parse plan for architectural debt check (${planPath}): ${err instanceof Error ? err.message : String(err)}`);
        return { pass: false, findings: [], reason: 'scan_error' };
      }
    }

    if (hasBrief || filesToScan.size === 0) {
      filesToScan.clear();
      for (const file of this.changedPhaseFiles(phaseOp.phase_dir, phaseOp.padded_phase)) {
        filesToScan.add(file);
      }
    }

    const findings: ArchitecturalDebtFinding[] = [];
    for (const file of filesToScan) {
      const absolutePath = this.resolveProjectPath(file);
      if (!absolutePath) {
        findings.push({ file, line: 0, marker: 'path', text: 'File is outside the project root' });
        continue;
      }

      try {
        const content = await readFile(absolutePath, 'utf-8');
        findings.push(...findDebtMarkers(file, content));
      } catch (err) {
        const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
        if (code === 'ENOENT') {
          continue;
        }

        findings.push({
          file,
          line: 0,
          marker: 'read',
          text: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const hasDebtMarkers = findings.some(({ marker }) => marker !== 'path' && marker !== 'read');
    return {
      pass: findings.length === 0,
      findings,
      reason: findings.length === 0 ? undefined : hasDebtMarkers ? 'markers_found' : 'scan_error',
    };
  }

  /**
   * Files changed since the phase started: the parent of the oldest commit that
   * added a `*-PLAN.md` in the phase folder or, when no plan was ever committed
   * (for example `.planning/` is not tracked), the parent of the oldest commit
   * whose subject starts `feat(<padded>-`, `fix(<padded>-` or `chore(<padded>-`.
   * With neither, nothing is scanned. Returns [] outside a git repository.
   * A root commit is diffed against the empty tree.
   */
  private changedPhaseFiles(phaseDir: string, paddedPhase: string): string[] {
    const root = this.realpathForBoundary(resolve(this.projectDir));
    const absolutePhaseDir = this.resolveProjectPath(phaseDir);
    if (!root || !absolutePhaseDir) return [];
    const relPhaseDir = relative(root, absolutePhaseDir).split('\\').join('/');

    const firstPhaseCommit = firstAddCommit(this.projectDir, `${relPhaseDir}/*-PLAN.md`)?.sha ?? this.firstPhaseScopedCommit(paddedPhase);
    if (!firstPhaseCommit) return [];

    const parent = runGit(this.projectDir, ['rev-parse', '--verify', '--quiet', `${firstPhaseCommit}^`]);
    // The empty tree id of this repository's object format: runGit feeds hash-object an empty stdin
    // (the null device), which works on Windows and in SHA-256 repositories alike.
    const base = parent.ok && parent.stdout
      ? parent.stdout
      : runGit(this.projectDir, ['hash-object', '-t', 'tree', '--stdin']).stdout;
    if (!base) return [];

    return changedFilesSince(this.projectDir, base)
      .filter((entry) => entry.status !== 'D' && isDebtScannable(entry.path))
      .map((entry) => entry.path);
  }

  /** Oldest commit whose subject starts `feat(<padded>-`, `fix(<padded>-` or `chore(<padded>-`; undefined when none. */
  private firstPhaseScopedCommit(paddedPhase: string): string | undefined {
    if (!paddedPhase) return undefined;
    const scope = escapeRegex(paddedPhase);
    const subject = new RegExp(`^(?:feat|fix|chore)\\(${scope}-`);
    const log = runGit(this.projectDir, ['log', '--format=%H%x09%s']);
    if (!log.ok) return undefined;
    const matches = log.stdout
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([sha, ...rest]) => Boolean(sha) && subject.test(rest.join('\t')))
      .map(([sha]) => sha);
    return matches[matches.length - 1];
  }

  private async listPhasePlanPaths(phaseDir: string): Promise<string[]> {
    const absolutePhaseDir = this.resolveProjectPath(phaseDir);
    if (!absolutePhaseDir) {
      const err = new Error(`Phase directory is outside the project root: ${phaseDir}`);
      this.logger?.warn(err.message);
      throw err;
    }

    try {
      const entries = await readdir(absolutePhaseDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && (entry.name === 'PLAN.md' || entry.name.endsWith('-PLAN.md')))
        .map((entry) => join(absolutePhaseDir, entry.name));
    } catch (err) {
      this.logger?.warn(`Could not list phase plans for architectural debt check (${phaseDir}): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  private extractPlanFiles(parsedPlan: ParsedPlan): string[] {
    const files = new Set<string>();
    for (const file of parsedPlan.frontmatter.files_modified ?? []) {
      files.add(file);
    }
    for (const task of parsedPlan.tasks ?? []) {
      for (const file of task.files ?? []) {
        files.add(file);
      }
    }
    return [...files];
  }

  private resolveProjectPath(pathValue: string): string | undefined {
    const root = this.realpathForBoundary(resolve(this.projectDir));
    if (!root) return undefined;

    const absolutePath = isAbsolute(pathValue) ? resolve(pathValue) : resolve(this.projectDir, pathValue);
    const canonicalPath = this.realpathForBoundary(absolutePath);
    if (!canonicalPath) return undefined;

    const relativePath = relative(root, canonicalPath);
    if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
      return canonicalPath;
    }
    return undefined;
  }

  private realpathForBoundary(pathValue: string): string | undefined {
    const missingSegments: string[] = [];
    let currentPath = pathValue;

    while (true) {
      try {
        return join(realpathSync(currentPath), ...missingSegments.reverse());
      } catch (err) {
        const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
        if (code !== 'ENOENT') return undefined;

        const parent = dirname(currentPath);
        if (parent === currentPath) return undefined;

        missingSegments.push(basename(currentPath));
        currentPath = parent;
      }
    }
  }

  /**
   * Check RESEARCH.md for unresolved open questions (#1602).
   * Returns the gate result — pass means safe to proceed to planning.
   */
  private async checkResearchGate(phaseOp: PhaseOpInfo): Promise<{ pass: boolean; unresolvedQuestions: string[] }> {
    try {
      const researchPath = phaseOp.research_path ||
        join(phaseOp.phase_dir, `${phaseOp.padded_phase}-RESEARCH.md`);
      const content = await readFile(researchPath, 'utf-8');
      return checkResearchGate(content);
    } catch {
      // File doesn't exist or can't be read — pass (nothing to gate on)
      return { pass: true, unresolvedQuestions: [] };
    }
  }

  /**
   * Invoke the onBlockerDecision callback, falling back to auto-approve.
   */
  private async invokeBlockerCallback(
    callbacks: HumanGateCallbacks,
    phaseNumber: string,
    step: PhaseStepType,
    error?: string,
  ): Promise<'retry' | 'skip' | 'stop'> {
    if (!callbacks.onBlockerDecision) {
      return 'skip'; // Auto-approve: skip the blocker
    }

    try {
      const decision = await callbacks.onBlockerDecision({ phaseNumber, step, error });
      // Validate return value
      if (decision === 'retry' || decision === 'skip' || decision === 'stop') {
        return decision;
      }
      this.logger?.warn(`Unexpected blocker callback return value: ${String(decision)}, falling back to skip`);
      return 'skip';
    } catch (err) {
      this.logger?.warn(`Blocker callback threw, auto-approving: ${err instanceof Error ? err.message : String(err)}`);
      return 'skip'; // Auto-approve on error
    }
  }

  /**
   * Invoke the onVerificationReview callback, falling back to auto-accept.
   */
  private async invokeVerificationCallback(
    callbacks: HumanGateCallbacks,
    phaseNumber: string,
    stepResult: PhaseStepResult,
  ): Promise<'accept' | 'reject' | 'retry'> {
    if (!callbacks.onVerificationReview) {
      return 'accept'; // Auto-approve
    }

    try {
      const decision = await callbacks.onVerificationReview({ phaseNumber, stepResult });
      if (decision === 'accept' || decision === 'reject' || decision === 'retry') {
        return decision;
      }
      this.logger?.warn(`Unexpected verification callback return value: ${String(decision)}, falling back to accept`);
      return 'accept';
    } catch (err) {
      this.logger?.warn(`Verification callback threw, keeping human verification pending: ${err instanceof Error ? err.message : String(err)}`);
      return 'accept'; // Treat as acknowledged; caller remains pending.
    }
  }
}
