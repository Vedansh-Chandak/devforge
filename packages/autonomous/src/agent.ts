/**
 * @devforge/autonomous — The autonomous coding agent (DF-019).
 *
 * Orchestrates the full loop: plan → repository context → initial patch →
 * apply → verify → repair until success or a configurable stop condition.
 * The confidence engine decides whether it may continue without confirmation;
 * the attempt history prevents duplicate generation; the rollback manager
 * restores prior workspace state on failure.
 *
 * All execution goes through injected primitives from @devforge/execution —
 * never direct process spawning.
 */

import type {
  CodePatch,
  CommandRunner,
  GitService,
  PatchEngine,
  ReasoningModel,
  VerificationTarget,
  Workspace,
} from '@devforge/execution';
import {
  createCommandRunner,
  createGitService,
  validatePatchesFull,
  Workspace as WorkspaceClass,
} from '@devforge/execution';
import type { ExecutionPlan } from '@devforge/planner';
import { Planner } from '@devforge/planner';
import type {
  AgentEvent,
  AgentOutcome,
  AgentResult,
  ConfidenceScore,
  ContextProvider,
  TerminationReason,
  VerificationSnapshot,
} from './types.js';
import { AUTONOMOUS_DEFAULTS } from './types.js';
import {
  AutonomousPatchError,
  AutonomousValidationError,
} from './errors.js';
import {
  AttemptHistory,
  estimatePatchTokens,
  fingerprintPatches,
  patchSummary,
} from './attempt-history.js';
import {
  confidenceGate,
  DeterministicConfidenceEvaluator,
  type ConfidenceEvaluator,
  type ConfidenceGateDecision,
} from './confidence.js';
import {
  DeterministicPatchSelector,
  type PatchSelectionResult,
} from './patch-selector.js';
import { VerificationLoop } from './verification-loop.js';
import { TerminationController } from './termination.js';
import { RollbackManager } from './rollback.js';
import { RepairLoop } from './repair-loop.js';

const CANCELLED_REASON = 'cancelled by user';

/** Wired environment the agent runs inside. */
export interface AgentEnvironment {
  readonly workspaceRoot: string;
  readonly workspace?: Workspace;
  readonly runner?: CommandRunner;
  readonly git?: GitService;
  /** Verification targets. Defaults to a single typecheck target. */
  readonly targets?: readonly VerificationTarget[];
  /** Hard deadline for a single verification run (ms). */
  readonly verificationTimeoutMs?: number;
}

/** Full agent configuration. */
export interface AutonomousAgentConfig {
  readonly goal: string;
  readonly environment: AgentEnvironment;
  readonly planner?: Planner;
  readonly patchEngine?: PatchEngine;
  readonly reasoningModel?: ReasoningModel;
  readonly confidence?: ConfidenceEvaluator;
  readonly confidenceThreshold?: number;
  readonly maxAttempts?: number;
  readonly maxPatchGenerations?: number;
  readonly overallTimeoutMs?: number;
  readonly rollbackEnabled?: boolean;
  /** Restore the workspace when a run ends without success. */
  readonly rollbackOnFailure?: boolean;
  /** Detect externally-applied repository changes and stop. */
  readonly detectRepositoryChanges?: boolean;
  /** Keep going automatically after a gated (below-threshold) patch. */
  readonly continueBeyondThreshold?: boolean;
  readonly confirmationHandler?: (score: ConfidenceScore) => boolean | Promise<boolean>;
  readonly context?: readonly string[];
  readonly contextProvider?: ContextProvider;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly onEvent?: (event: AgentEvent) => void;
}

/** Mutable counters for a single run. */
interface MutableCounters {
  patchesGenerated: number;
  repairAttempts: number;
  rollbacks: number;
  tokens: number;
  modelCalls: number;
}

/** Mutable report bookkeeping for a single run. */
interface RunState {
  plan: ExecutionPlan | null;
  verifications: VerificationSnapshot[];
  confidenceGatePassed: boolean;
}

const emptyContext: ContextProvider = {
  name: 'none',
  get: async () => [],
};

function planAsContext(plan: ExecutionPlan | null): readonly string[] {
  if (!plan) return [];
  return [`PLAN: ${plan.summary}`, ...plan.expectedOutputs];
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function outcomeForReason(reason: TerminationReason): AgentOutcome {
  switch (reason) {
    case 'VERIFICATION_PASSED':
      return 'SUCCESS';
    case 'USER_CANCELLED':
      return 'CANCELLED';
    case 'CONFIDENCE_BELOW_THRESHOLD':
      return 'REJECTED';
    default:
      return 'FAILED';
  }
}

function selectionPatches(selection: PatchSelectionResult): readonly CodePatch[] {
  return selection.selected.map((entry) => entry.patch);
}

function selectionFiles(selection: PatchSelectionResult): readonly string[] {
  return Array.from(
    new Set(selection.selected.map((entry) => entry.patch.file)),
  ).sort();
}

function bestSelectedScore(selection: PatchSelectionResult): ConfidenceScore {
  const best = selection.selected[0];
  if (!best) {
    throw new AutonomousValidationError('cannot gate an empty selection');
  }
  return best.score;
}

/** Combine several signals into a single one that mirrors the sink. */
function mergeSignals(
  ...signals: readonly (AbortSignal | undefined)[]
): AbortSignal {
  const controller = new AbortController();
  const forward = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) forward();
    else signal.addEventListener('abort', forward, { once: true });
  }
  return controller.signal;
}

/**
 * The autonomous software engineering agent. One instance runs exactly once.
 */
export class AutonomousAgent {
  private readonly config: AutonomousAgentConfig;
  private readonly workspace: Workspace;
  private readonly runner: CommandRunner;
  private readonly git: GitService | null;
  private readonly targets: readonly VerificationTarget[];
  private readonly confidence: ConfidenceEvaluator;
  private readonly confidenceThreshold: number;
  private readonly maxAttempts: number;
  private readonly maxPatchGenerations: number;
  private readonly overallTimeoutMs: number;
  private readonly rollbackEnabled: boolean;
  private readonly rollbackOnFailure: boolean;
  private readonly detectRepositoryChanges: boolean;
  private readonly continueBeyondThreshold: boolean;
  private readonly contextSeed: readonly string[];
  private readonly contextProvider: ContextProvider;
  private readonly now: () => number;
  private readonly runSignal: AbortSignal;
  private readonly cancelController = new AbortController();

  private status: AgentResult['status'] = 'IDLE';
  private finished = false;
  private lastReport: AgentResult | null = null;
  private eventSequence = 0;
  private readonly attemptHistory = new AttemptHistory();

  constructor(config: AutonomousAgentConfig) {
    const env = config.environment;
    if (!env || !env.workspaceRoot) {
      throw new AutonomousValidationError('environment.workspaceRoot is required');
    }
    this.config = config;
    this.workspace = env.workspace ?? new WorkspaceClass({ root: env.workspaceRoot });
    this.runner = env.runner ?? createCommandRunner({ workspaceRoot: env.workspaceRoot });
    this.git = env.git ?? createGitService({ workspaceRoot: env.workspaceRoot, runner: this.runner });
    this.targets =
      env.targets ??
      [
        {
          id: 'typecheck',
          command: 'tsc',
          args: ['--noEmit'],
          cwd: env.workspaceRoot,
        },
      ];
    this.confidence = config.confidence ?? new DeterministicConfidenceEvaluator();
    this.confidenceThreshold =
      config.confidenceThreshold ?? AUTONOMOUS_DEFAULTS.confidenceThreshold;
    this.maxAttempts = config.maxAttempts ?? AUTONOMOUS_DEFAULTS.maxAttempts;
    this.maxPatchGenerations =
      config.maxPatchGenerations ?? AUTONOMOUS_DEFAULTS.maxPatchGenerations;
    this.overallTimeoutMs = config.overallTimeoutMs ?? AUTONOMOUS_DEFAULTS.timeoutMs;
    this.rollbackEnabled = config.rollbackEnabled ?? true;
    this.rollbackOnFailure = config.rollbackOnFailure ?? this.rollbackEnabled;
    this.detectRepositoryChanges = config.detectRepositoryChanges ?? false;
    this.continueBeyondThreshold = config.continueBeyondThreshold ?? false;
    this.contextSeed = config.context ?? [];
    this.contextProvider = config.contextProvider ?? emptyContext;
    this.now = config.now ?? (() => Date.now());
    this.runSignal = mergeSignals(config.signal, this.cancelController.signal);
  }

  get statusName(): AgentResult['status'] {
    return this.status;
  }

  get goal(): string {
    return this.config.goal;
  }

  /** Most recent report; throws when the agent has not run yet. */
  report(): AgentResult {
    if (!this.lastReport) {
      throw new AutonomousValidationError('agent has not run yet');
    }
    return this.lastReport;
  }

  /** Cancel a running agent (internal, no external signal required). */
  cancel(reason: string = CANCELLED_REASON): void {
    if (this.cancelController.signal.aborted) return;
    this.cancelController.abort(reason);
  }

  private emit(message: string, attempt: number): void {
    this.eventSequence += 1;
    const event: AgentEvent = {
      sequence: this.eventSequence,
      status: this.status,
      attempt,
      goal: this.config.goal,
      message,
      at: this.now(),
    };
    this.config.onEvent?.(event);
  }

  private requirePatchEngine(): PatchEngine {
    if (!this.config.patchEngine) {
      throw new AutonomousValidationError('a patchEngine is required to generate patches');
    }
    return this.config.patchEngine;
  }

  /**
   * Execute the full autonomous loop to completion. Always resolves with an
   * {@link AgentResult}; throws only on hard configuration misuse.
   */
  async run(): Promise<AgentResult> {
    if (this.finished) {
      throw new AutonomousValidationError('agent has already been run; create a new instance');
    }
    const startedAt = this.now();
    const counters: MutableCounters = {
      patchesGenerated: 0,
      repairAttempts: 0,
      rollbacks: 0,
      tokens: 0,
      modelCalls: 0,
    };
    const runState: RunState = {
      plan: null,
      verifications: [],
      confidenceGatePassed: true,
    };
    const attemptHistory = this.attemptHistory;
    this.status = 'PLANNING';

    // ── 1. Plan (optional) ──────────────────────────────────────────────
    if (this.config.planner) {
      try {
        const planResult = await this.config.planner.plan(this.config.goal);
        if (planResult.ok) {
          runState.plan = planResult.plan;
          this.emit(`planned ${planResult.plan.steps.length} steps`, 0);
        } else {
          return this.finalize(
            runState, counters, startedAt,
            'PLANNING_FAILED', planResult.error.message, null,
          );
        }
      } catch (error) {
        return this.finalize(
          runState, counters, startedAt, 'PLANNING_FAILED',
          `planner raised: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    if (this.runSignal.aborted) {
      return this.finalize(runState, counters, startedAt, 'USER_CANCELLED', 'cancelled before context', null);
    }

    // ── 2. Repository context ───────────────────────────────────────────
    this.status = 'GATHERING_CONTEXT';
    let context: readonly string[] = this.contextSeed;
    try {
      const extra = await this.contextProvider.get({ goal: this.config.goal });
      context = [...this.contextSeed, ...extra];
      if (extra.length > 0) this.emit(`gathered ${extra.length} context unit(s)`, 0);
    } catch (error) {
      return this.finalize(
        runState, counters, startedAt, 'PATCH_GENERATION_FAILED',
        `repository context failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    const verification = new VerificationLoop({
      runner: this.runner,
      cwd: this.workspace.root,
      targets: this.targets,
      totalTimeoutMs: this.config.environment.verificationTimeoutMs ?? this.overallTimeoutMs,
      now: this.now,
    });
    const selector = new DeterministicPatchSelector(this.confidence);
    const rollback = new RollbackManager(this.workspace, this.rollbackEnabled, {
      now: this.now,
    });
    const termination = new TerminationController({
      maxAttempts: this.maxAttempts,
      timeoutMs: this.overallTimeoutMs,
      confidenceThreshold: this.confidenceThreshold,
      duplicateWindow: 2,
    });
    const gate = confidenceGate(this.confidenceThreshold);

    // External-repository baseline (optional).
    let baseline: readonly string[] | null = null;
    if (this.detectRepositoryChanges) {
      baseline = await this.snapshotRepositoryFiles();
      if (baseline === null) {
        return this.finalize(
          runState, counters, startedAt, 'REPOSITORY_CHANGED_EXTERNALLY',
          'no usable repository baseline for change detection', null,
        );
      }
    }

    // ── 3. Initial generation ───────────────────────────────────────────
    this.status = 'GENERATING';
    let initialPatches: readonly CodePatch[];
    try {
      counters.modelCalls += 1;
      const engine = this.requirePatchEngine();
      initialPatches = await engine.generate({
        goal: this.config.goal,
        context: [...context, ...planAsContext(runState.plan)],
        generatedCount: 0,
        signal: this.runSignal,
      });
      counters.patchesGenerated += initialPatches.length;
      this.emit(`initial generation produced ${initialPatches.length} patch(es)`, 1);
    } catch (error) {
      return this.finalize(
        runState, counters, startedAt, 'PATCH_GENERATION_FAILED',
        `initial generation failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    if (this.runSignal.aborted) {
      return this.finalize(runState, counters, startedAt, 'USER_CANCELLED', 'cancelled during generation', null);
    }

    // ── 4. First cycle: select → gate → apply → verify ─────────────────
    this.status = 'VERIFYING';
    const firstSelection = selector.select(initialPatches, {
      context: { goal: this.config.goal, attempt: 1, failures: 0 },
    });
    if (firstSelection.selected.length === 0) {
      return this.finalize(
        runState, counters, startedAt, 'PATCH_GENERATION_FAILED',
        'no initial patch survived selection', null,
      );
    }

    const firstScore = bestSelectedScore(firstSelection);
    const gateDecision = await this.resolveGate(firstScore, gate);
    runState.confidenceGatePassed = gateDecision.proceed;
    if (!gateDecision.proceed) {
      attemptHistory.record({
        attempt: 1,
        patchIds: firstSelection.selected.map((entry) => entry.patch.id),
        files: selectionFiles(firstSelection),
        summary: patchSummary(selectionPatches(firstSelection)),
        fingerprint: fingerprintPatches(selectionPatches(firstSelection)),
        verificationOk: false,
        failureReason: gateDecision.message,
        tokens: estimatePatchTokens(selectionPatches(firstSelection)),
        durationMs: 0,
        confidence: firstScore.confidence,
        startedAt: this.now(),
      });
      this.status = 'WAITING_CONFIRMATION';
      return this.finalize(
        runState, counters, startedAt, 'CONFIDENCE_BELOW_THRESHOLD', gateDecision.message, null,
      );
    }

    const firstToken = await rollback.snapshotFor(selectionFiles(firstSelection));
    try {
      await this.applyPatches(selectionPatches(firstSelection));
    } catch (error) {
      await rollback.restoreToken(firstToken.token);
      return this.finalize(
        runState, counters, startedAt, 'PATCH_GENERATION_FAILED',
        `patch application failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    const firstRun = await verification.run(this.runSignal);
    runState.verifications.push(firstRun.snapshot);
    counters.tokens += estimatePatchTokens(selectionPatches(firstSelection));
    attemptHistory.record({
      attempt: 1,
      patchIds: firstSelection.selected.map((entry) => entry.patch.id),
      files: selectionFiles(firstSelection),
      summary: patchSummary(selectionPatches(firstSelection)),
      fingerprint: fingerprintPatches(selectionPatches(firstSelection)),
      verificationOk: firstRun.ok,
      failureReason: firstRun.ok ? undefined : firstRun.diagnostics.summary,
      tokens: estimatePatchTokens(selectionPatches(firstSelection)),
      durationMs: firstRun.snapshot.durationMs,
      confidence: firstScore.confidence,
      startedAt: this.now() - firstRun.snapshot.durationMs,
    });
    if (firstRun.ok) {
      rollback.clear();
      this.status = 'COMPLETED';
      return this.finalize(runState, counters, startedAt, 'VERIFICATION_PASSED', 'verification passed on the first attempt', null);
    }

    if (firstRun.timedOut) {
      await rollback.restoreToken(firstToken.token);
      counters.rollbacks += 1;
      return this.finalize(runState, counters, startedAt, 'TIMEOUT', 'initial verification timed out', null);
    }

    await rollback.restoreToken(firstToken.token);
    counters.rollbacks += 1;

    // ── 5. Repair loop ──────────────────────────────────────────────────
    this.status = 'REPAIRING';
    const repairMax = Math.max(0, Math.min(this.maxAttempts, this.maxPatchGenerations - 1));
    if (repairMax === 0) {
      return this.finalize(
        runState, counters, startedAt, 'MAX_ATTEMPTS_REACHED', 'no repair budget remains', null,
      );
    }

    const repairLoop = new RepairLoop({
      goal: this.config.goal,
      context: [...context, ...planAsContext(runState.plan)],
      initialDiagnostics: firstRun.diagnostics,
      reasoningModel: this.config.reasoningModel ?? null,
      patchEngine: this.requirePatchEngine(),
      patchSelector: selector,
      confidence: this.confidence,
      confidenceThreshold: this.confidenceThreshold,
      termination,
      attemptHistory,
      verification,
      rollback,
      maxAttempts: repairMax,
      applyPatches: (patches) => this.applyPatches(patches),
      now: this.now,
      startedAt,
      attemptOffset: 1,
      signal: this.runSignal,
      onEvent: (message, attempt) => {
        this.emit(`repair: ${message}`, attempt);
      },
    });

    let repairOutcome;
    try {
      repairOutcome = await repairLoop.run();
    } catch (error) {
      return this.finalize(
        runState, counters, startedAt, 'PATCH_GENERATION_FAILED',
        `repair loop raised: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    counters.repairAttempts += repairOutcome.attempts;
    counters.patchesGenerated += repairOutcome.patchesGenerated;
    counters.tokens += repairOutcome.tokens;
    runState.verifications.push(...repairOutcome.verifications.map((run) => run.snapshot));

    if (repairOutcome.success) {
      this.status = 'COMPLETED';
      return this.finalize(
        runState, counters, startedAt, 'VERIFICATION_PASSED', repairOutcome.message, null,
      );
    }

    if (this.rollbackOnFailure && rollback.isDirty) {
      try {
        await rollback.restoreAll();
        counters.rollbacks += 1;
      } catch (error) {
        // surface through the final report only
      }
    }
    this.status = 'FAILED';
    return this.finalize(
      runState, counters, startedAt, repairOutcome.reason, repairOutcome.message, null,
    );
  }

  /** Resolve whether a (possibly gated) patch set may proceed. */
  private async resolveGate(
    score: ConfidenceScore,
    gate: ReturnType<typeof confidenceGate>,
  ): Promise<{ proceed: boolean; message: string }> {
    const decision: ConfidenceGateDecision = gate.check(score);
    if (decision.pass || this.continueBeyondThreshold) {
      return { proceed: true, message: decision.message };
    }
    if (this.config.confirmationHandler) {
      this.status = 'WAITING_CONFIRMATION';
      const accepted = await this.config.confirmationHandler(score);
      if (accepted) this.status = 'VERIFYING';
      return { proceed: accepted, message: decision.message };
    }
    return { proceed: false, message: decision.message };
  }

  /** Validate and apply a batch of patches to the workspace. */
  private async applyPatches(patches: readonly CodePatch[]): Promise<void> {
    const validated = await validatePatchesFull(patches, this.workspace, {
      validateExistence: true,
      validateHash: true,
    });
    for (const patch of validated) {
      switch (patch.operation) {
        case 'CREATE':
          await this.workspace.createFile(patch.file, patch.newContent ?? '');
          break;
        case 'MODIFY':
          await this.workspace.writeFile(patch.file, patch.newContent ?? '');
          break;
        case 'DELETE':
          await this.workspace.deleteFile(patch.file);
          break;
      }
    }
  }

  /** Baseline of changed repository files, or null when unavailable. */
  private async snapshotRepositoryFiles(): Promise<readonly string[] | null> {
    try {
      if (!this.git) return null;
      const info = await this.git.repositoryInfo();
      if (!info.isRepository) return null;
      const files = await this.git.changedFiles();
      return files.slice().sort();
    } catch {
      return null;
    }
  }

  /** Whether the repository changed externally since the baseline. */
  private async repositoryChanged(baseline: readonly string[] | null): Promise<boolean> {
    if (baseline === null || !this.git) return false;
    try {
      const current = await this.git.changedFiles();
      return !sameStringArray(baseline, current.slice().sort());
    } catch {
      return false;
    }
  }

  /** Assemble and cache the terminal report. */
  private finalize(
    state: RunState,
    counters: MutableCounters,
    startedAt: number,
    reason: TerminationReason,
    message: string,
    error: Error | null,
  ): AgentResult {
    const finishedAt = this.now();
    const outcome = outcomeForReason(reason);
    const attempts = this.attemptHistory.list();
    const report: AgentResult = {
      outcome,
      goal: this.config.goal,
      status: this.status,
      terminationIndex: attempts.length,
      terminationReason: reason,
      terminationMessage: message,
      attempts,
      verifications: state.verifications,
      patchesGenerated: counters.patchesGenerated,
      repairAttempts: counters.repairAttempts,
      rollbacks: counters.rollbacks,
      tokens: counters.tokens,
      durationMs: finishedAt - startedAt,
      startedAt,
      finishedAt,
      plan: state.plan,
      confidenceGatePassed: state.confidenceGatePassed,
      error,
    };
    this.lastReport = report;
    this.finished = true;
    return report;
  }
}
