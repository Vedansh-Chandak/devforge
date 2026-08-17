/**
 * @devforge/execution — Autonomous coding repair engine (DF-016B).
 *
 * Orchestrates the full autonomous coding loop: patch generation → validation
 * → workspace transaction → verification → repair with budgets and cancellation.
 */

import { Workspace } from '../workspace/workspace.js';
import { WorkspaceTransaction } from '../workspace/transaction.js';
import type { CommandRunner } from '../command/types.js';
import type { VerificationTarget, VerificationResult } from '../executor/types.js';
import { runVerification } from '../executor/verification.js';
import type { CodePatch, NormalizedPatch, CodingBudgets } from './patch-model.js';
import { hashText } from './patch-model.js';
import { validatePatchesFull } from './patch-validator.js';
import type { PatchEngine } from './patch-engine.js';
import type { CodingModel } from './coding-model.js';
import type { ReasoningModel, FailureAnalysisInput, RepairDecisionInput } from './reasoning-model.js';
import { captureDiagnostics, Diagnostics } from './diagnostics.js';
import {
  CodingEventBus,
  CodingEventType,
  type CodingEvent,
  type CodingEventInput,
} from './coding-events.js';
import {
  RepairBudgetExceededError,
  CodingModelError,
  ReasoningError,
  PatchGenerationError,
  DiagnosticsError,
} from './coding-errors.js';

/** Configuration for the autonomous coding engine. */
export interface CodingEngineConfig {
  readonly workspace: Workspace;
  readonly runner: CommandRunner;
  readonly patchEngine: PatchEngine;
  readonly codingModel?: CodingModel;
  readonly reasoningModel?: ReasoningModel;
  readonly verificationTargets: readonly VerificationTarget[];
  readonly cwd: string;
  readonly budgets?: Partial<CodingBudgets>;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}

/** Transaction record for reporting. */
export interface TransactionRecord {
  readonly order: number;
  readonly kind: 'initial' | 'repair';
  readonly patchesApplied: number;
  readonly status: 'COMMITTED' | 'ROLLED_BACK';
  readonly committedAt?: number;
  readonly rolledBackAt?: number;
}

/** Mutable transaction record for internal tracking. */
interface MutableTransactionRecord {
  order: number;
  kind: 'initial' | 'repair';
  patchesApplied: number;
  status: 'COMMITTED' | 'ROLLED_BACK';
  committedAt?: number;
  rolledBackAt?: number;
}

/** Result of a single apply-and-verify cycle. */
interface ApplyVerifyResult {
  readonly success: boolean;
  readonly transaction: TransactionRecord;
  readonly verification: VerificationResult;
  readonly diagnostics?: Diagnostics;
}

/** Final report from the coding engine. */
export interface CodingReport {
  readonly outcome: 'SUCCESS' | 'BUDGET_EXCEEDED' | 'CANCELLED' | 'FAILED';
  readonly transactions: readonly TransactionRecord[];
  readonly patchesGenerated: number;
  readonly patchCalls: number;
  readonly repairAttempts: number;
  readonly modelCalls: number;
  readonly verificationRuns: number;
  readonly diagnostics: readonly Diagnostics[];
  readonly rollbackCount: number;
  readonly events: readonly CodingEvent[];
  readonly executionTimeMs: number;
  readonly error?: Error;
}

/** Mutable counters for budget tracking. */
interface BudgetCounters {
  repairAttempts: number;
  patchGenerations: number;
  verificationRuns: number;
  modelCalls: number;
  patchesGenerated: number;
  rollbackCount: number;
  transactions: TransactionRecord[];
}

/** The autonomous coding engine. */
export class AutonomousCodingEngine {
  private readonly workspace: Workspace;
  private readonly runner: CommandRunner;
  private readonly patchEngine: PatchEngine;
  private readonly reasoningModel: ReasoningModel | null;
  private readonly verificationTargets: readonly VerificationTarget[];
  private readonly cwd: string;
  private readonly budgets: Required<CodingBudgets>;
  private readonly now: () => number;
  private readonly signal: AbortSignal | undefined;
  private readonly eventBus: CodingEventBus;
  private readonly counters: BudgetCounters;
  private readonly startTime: number;
  private finished = false;

  constructor(config: CodingEngineConfig) {
    this.workspace = config.workspace;
    this.runner = config.runner;
    this.patchEngine = config.patchEngine;
    this.reasoningModel = config.reasoningModel ?? null;
    this.verificationTargets = config.verificationTargets;
    this.cwd = config.cwd;
    this.budgets = {
      maxRepairAttempts: config.budgets?.maxRepairAttempts ?? 3,
      maxPatchGenerations: config.budgets?.maxPatchGenerations ?? 5,
      maxVerificationRuns: config.budgets?.maxVerificationRuns ?? 5,
      maxPatchBytes: config.budgets?.maxPatchBytes ?? 256 * 1024,
      maxTotalPatchBytes: config.budgets?.maxTotalPatchBytes ?? 1024 * 1024,
    };
    this.now = config.now ?? (() => Date.now());
    this.signal = config.signal;
    this.startTime = this.now();

    const runId = `coding-${this.startTime.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.eventBus = new CodingEventBus(runId, this.now);

    this.counters = {
      repairAttempts: 0,
      patchGenerations: 0,
      verificationRuns: 0,
      modelCalls: 0,
      patchesGenerated: 0,
      rollbackCount: 0,
      transactions: [],
    };
  }

  get events(): readonly CodingEvent[] {
    return this.eventBus.events;
  }

  get runId(): string {
    return this.eventBus.runId;
  }

  onEvent(listener: (event: CodingEvent) => void): () => void {
    return this.eventBus.onEvent(listener);
  }

  /** Check cancellation signal. */
  private checkCancelled(): void {
    if (this.signal?.aborted) {
      const reason = `Cancelled: ${this.signal.reason ?? 'aborted'}`;
      this.eventBus.emit({ type: 'CodingCancelled', reason } as CodingEventInput);
      const error = new CodingModelError(reason, { code: 'CODING_CANCELLED' });
      throw error;
    }
  }

  /** Check budget limits and throw RepairBudgetExceededError if exceeded. */
  private checkBudgets(phase: 'patch' | 'verify' | 'repair'): void {
    if (phase === 'patch' && this.counters.patchGenerations >= this.budgets.maxPatchGenerations) {
      throw new RepairBudgetExceededError(
        `Patch generation budget exceeded: ${this.counters.patchGenerations}/${this.budgets.maxPatchGenerations}`,
        'maxPatchGenerations',
        this.budgets.maxPatchGenerations,
        this.counters.patchGenerations,
      );
    }
    if (phase === 'verify' && this.counters.verificationRuns >= this.budgets.maxVerificationRuns) {
      throw new RepairBudgetExceededError(
        `Verification budget exceeded: ${this.counters.verificationRuns}/${this.budgets.maxVerificationRuns}`,
        'maxVerificationRuns',
        this.budgets.maxVerificationRuns,
        this.counters.verificationRuns,
      );
    }
    if (phase === 'repair' && this.counters.repairAttempts >= this.budgets.maxRepairAttempts) {
      throw new RepairBudgetExceededError(
        `Repair attempts budget exceeded: ${this.counters.repairAttempts}/${this.budgets.maxRepairAttempts}`,
        'maxRepairAttempts',
        this.budgets.maxRepairAttempts,
        this.counters.repairAttempts,
      );
    }
  }

  /** Apply patches via workspace transaction and run verification. */
  private async applyAndVerify(
    patches: readonly NormalizedPatch[],
    kind: 'initial' | 'repair',
  ): Promise<ApplyVerifyResult> {
    this.checkCancelled();
    this.checkBudgets('patch');

    const order = this.counters.transactions.length;
    const transaction = this.workspace.beginTransaction();

    // Record operations in transaction
    for (const patch of patches) {
      switch (patch.operation) {
        case 'CREATE':
          transaction.create(patch.file, patch.newContent ?? '');
          break;
        case 'MODIFY':
          transaction.write(patch.file, patch.newContent ?? '');
          break;
        case 'DELETE':
          transaction.delete(patch.file);
          break;
      }
    }

    this.eventBus.emit({
      type: 'WorkspaceTransactionStarted',
      attempt: this.counters.repairAttempts + 1,
      patchesCount: patches.length,
    } as CodingEventInput);

    // Commit transaction (applies to filesystem with backups)
    await transaction.commit();

    const committedAt = this.now();
    const transactionRecord: MutableTransactionRecord = {
      order,
      kind,
      patchesApplied: patches.length,
      status: 'COMMITTED',
      committedAt,
    };
    this.counters.transactions.push({ ...transactionRecord });

    this.eventBus.emit({
      type: 'WorkspaceTransactionCommitted',
      attempt: this.counters.repairAttempts + 1,
      operationsApplied: patches.length,
    } as CodingEventInput);

    // Run verification
    this.checkBudgets('verify');
    this.counters.verificationRuns += 1;

    this.eventBus.emit({
      type: 'CodingVerificationStarted',
      attempt: this.counters.repairAttempts + 1,
      targetIds: this.verificationTargets.map((t) => t.id),
    } as CodingEventInput);

    const verification = await runVerification(this.runner, this.verificationTargets, {
      cwd: this.cwd,
      abortSignal: this.signal,
      now: this.now,
    });

    if (this.signal?.aborted) {
      // Rollback on cancellation
      await transaction.rollback();
      const rolledBackAt = this.now();
      transactionRecord.status = 'ROLLED_BACK';
      transactionRecord.rolledBackAt = rolledBackAt;
      this.counters.rollbackCount += 1;

      this.eventBus.emit({
        type: 'WorkspaceTransactionRolledBack',
        attempt: this.counters.repairAttempts + 1,
        reason: 'cancelled',
      } as CodingEventInput);

      // Update the counters with the rolled back status
      this.counters.transactions[this.counters.transactions.length - 1] = { ...transactionRecord };

      throw new CodingModelError('Cancelled during verification', { code: 'CODING_CANCELLED' });
    }

    if (verification.ok) {
      this.eventBus.emit({
        type: 'CodingVerificationPassed',
        attempt: this.counters.repairAttempts + 1,
        durationMs: verification.durationMs,
      } as CodingEventInput);
      return {
        success: true,
        transaction: { ...transactionRecord },
        verification,
      };
    }

    // Verification failed - rollback
    this.eventBus.emit({
      type: 'CodingVerificationFailed',
      attempt: this.counters.repairAttempts + 1,
      targetId: verification.failedTargetId ?? 'unknown',
      exitCode: verification.targets.find((t) => !t.success)?.exitCode ?? null,
    } as CodingEventInput);

    await transaction.rollback();
    const rolledBackAt = this.now();
    transactionRecord.status = 'ROLLED_BACK';
    transactionRecord.rolledBackAt = rolledBackAt;
    this.counters.rollbackCount += 1;

    // Update the counters with the rolled back status
    this.counters.transactions[this.counters.transactions.length - 1] = { ...transactionRecord };

    this.eventBus.emit({
      type: 'WorkspaceTransactionRolledBack',
      attempt: this.counters.repairAttempts + 1,
      reason: 'verification failed',
    } as CodingEventInput);

    // Capture diagnostics
    const diagnostics = captureDiagnostics(verification);
    this.eventBus.emit({
      type: 'DiagnosticsCaptured',
      diagnosticsCount: diagnostics.diagnostics.length,
      categories: Array.from(
        new Set(diagnostics.diagnostics.map((d) => d.category)),
      ),
      verificationDurationMs: diagnostics.verificationDurationMs,
    } as CodingEventInput);

    return {
      success: false,
      transaction: transactionRecord,
      verification,
      diagnostics,
    };
  }

  /** Run the repair loop after initial verification failure. */
  private async runRepairLoop(
    goal: string,
    context: readonly string[],
    initialDiagnostics: Diagnostics,
  ): Promise<{ success: boolean; diagnostics: Diagnostics; error?: Error }> {
    this.eventBus.emit({
      type: 'RepairStarted',
      maxAttempts: this.budgets.maxRepairAttempts,
    } as CodingEventInput);

    let lastDiagnostics = initialDiagnostics;

    for (let attempt = 1; attempt <= this.budgets.maxRepairAttempts; attempt++) {
      this.checkCancelled();
      this.checkBudgets('repair');

      this.counters.repairAttempts = attempt;

      if (!this.reasoningModel) {
        throw new ReasoningError('No reasoning model configured for repair');
      }

      // Analyze failure
      const analysisInput: FailureAnalysisInput = {
        goal,
        diagnostics: lastDiagnostics,
        attempt,
      };
      this.counters.modelCalls += 1;
      let analysis;
      try {
        analysis = await this.reasoningModel.analyzeFailure(analysisInput);
      } catch (error) {
        if (error instanceof ReasoningError) throw error;
        throw new ReasoningError(
          `Reasoning model analyzeFailure failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      // Decide repair
      const decisionInput: RepairDecisionInput = {
        goal,
        diagnostics: lastDiagnostics,
        analysis,
        attempt,
      };
      this.counters.modelCalls += 1;
      let decision;
      try {
        decision = await this.reasoningModel.decideRepair(decisionInput);
      } catch (error) {
        if (error instanceof ReasoningError) throw error;
        throw new ReasoningError(
          `Reasoning model decideRepair failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      if (decision.strategy === 'ABORT') {
        return { success: false, diagnostics: lastDiagnostics, error: new RepairBudgetExceededError('Repair aborted by model', 'abort', 0, 1) };
      }

      this.eventBus.emit({
        type: 'RepairAttempt',
        attempt,
        strategy: decision.strategy,
        targetFiles: decision.targetFiles,
        modelCalls: this.counters.modelCalls,
      } as CodingEventInput);

      // Generate repair patches
      this.checkBudgets('patch');
      this.counters.patchGenerations += 1;

      const patchRequest = {
        goal,
        context: [...context, `REPAIR ATTEMPT ${attempt}: ${decision.reason}`],
        generatedCount: this.counters.patchesGenerated,
        signal: this.signal,
      };

      this.eventBus.emit({
        type: 'PatchGenerationStarted',
        goal,
        generatedCount: this.counters.patchesGenerated,
      } as CodingEventInput);

      let patches: readonly CodePatch[];
      try {
        patches = await this.patchEngine.generate(patchRequest);
      } catch (error) {
        if (error instanceof PatchGenerationError) throw error;
        throw new PatchGenerationError(
          `Patch generation failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }

      this.counters.patchesGenerated += patches.length;
      this.counters.modelCalls += 1;

      this.eventBus.emit({
        type: 'PatchGenerated',
        patchesCount: patches.length,
        patchIds: patches.map((p) => p.id),
        modelCalls: this.counters.modelCalls,
      } as CodingEventInput);

      // Full validation (structural + workspace)
      let validatedPatches: readonly NormalizedPatch[];
      try {
        validatedPatches = await validatePatchesFull(patches, this.workspace, {
          maxPatchBytes: this.budgets.maxPatchBytes,
          maxTotalPatchBytes: this.budgets.maxTotalPatchBytes,
          validateExistence: true,
          validateHash: true,
        });
      } catch (error) {
        if (error instanceof Error && 'violations' in error) {
          this.eventBus.emit({
            type: 'PatchValidationFailed',
            violationCount: (error as { violations: readonly { code: string; message: string }[] }).violations.length,
            violations: (error as { violations: readonly { code: string; message: string; patchId?: string; file?: string }[] }).violations,
          } as CodingEventInput);
        }
        throw error;
      }

      // Apply and verify
      const result = await this.applyAndVerify(validatedPatches, 'repair');

      if (result.success) {
        this.eventBus.emit({
          type: 'RepairSucceeded',
          attempt,
          totalAttempts: attempt,
        } as CodingEventInput);
        return { success: true, diagnostics: result.diagnostics ?? lastDiagnostics };
      }

      lastDiagnostics = result.diagnostics ?? lastDiagnostics;
    }

    // Exhausted all attempts
    this.eventBus.emit({
      type: 'RepairFailed',
      attemptsExhausted: this.budgets.maxRepairAttempts,
      budgetExceeded: 'maxRepairAttempts',
    } as CodingEventInput);

    return {
      success: false,
      diagnostics: lastDiagnostics,
      error: new RepairBudgetExceededError(
        `All ${this.budgets.maxRepairAttempts} repair attempts exhausted`,
        'maxRepairAttempts',
        this.budgets.maxRepairAttempts,
        this.budgets.maxRepairAttempts,
      ),
    };
  }

  /** Execute the full autonomous coding flow. */
  async run(request: { goal: string; context?: readonly string[] }): Promise<CodingReport> {
    if (this.finished) {
      throw new Error('Engine already finished; create a new instance');
    }

    const { goal, context = [] } = request;
    this.checkCancelled();

    // Initial patch generation
    this.counters.patchGenerations += 1;
    this.counters.modelCalls += 1;

    this.eventBus.emit({
      type: 'PatchGenerationStarted',
      goal,
      generatedCount: this.counters.patchesGenerated,
    } as CodingEventInput);

    let initialPatches: readonly CodePatch[];
    try {
      initialPatches = await this.patchEngine.generate({
        goal,
        context,
        generatedCount: this.counters.patchesGenerated,
        signal: this.signal,
      });
    } catch (error) {
      if (error instanceof PatchGenerationError) throw error;
      throw new PatchGenerationError(
        `Initial patch generation failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    this.counters.patchesGenerated += initialPatches.length;

    this.eventBus.emit({
      type: 'PatchGenerated',
      patchesCount: initialPatches.length,
      patchIds: initialPatches.map((p) => p.id),
      modelCalls: this.counters.modelCalls,
    } as CodingEventInput);

    // Full validation
    let validatedPatches: readonly NormalizedPatch[];
    try {
      validatedPatches = await validatePatchesFull(initialPatches, this.workspace, {
        maxPatchBytes: this.budgets.maxPatchBytes,
        maxTotalPatchBytes: this.budgets.maxTotalPatchBytes,
        validateExistence: true,
        validateHash: true,
      });
    } catch (error) {
      if (error instanceof Error && 'violations' in error) {
        this.eventBus.emit({
          type: 'PatchValidationFailed',
          violationCount: (error as { violations: readonly { code: string; message: string }[] }).violations.length,
          violations: (error as { violations: readonly { code: string; message: string; patchId?: string; file?: string }[] }).violations,
        } as CodingEventInput);
      }
      throw error;
    }

    // Initial apply and verify
    let currentDiagnostics: Diagnostics = createEmptyDiagnostics();
    let initialResult;
    try {
      initialResult = await this.applyAndVerify(validatedPatches, 'initial');
    } catch (error) {
      if (error instanceof RepairBudgetExceededError) {
        this.finished = true;
        return this.buildReport('BUDGET_EXCEEDED', currentDiagnostics, error);
      }
      if (error instanceof ReasoningError) {
        this.finished = true;
        return this.buildReport('BUDGET_EXCEEDED', currentDiagnostics, error);
      }
      throw error;
    }
    currentDiagnostics = initialResult.diagnostics ?? currentDiagnostics;

    if (initialResult.success) {
      this.finished = true;
      return this.buildReport('SUCCESS', currentDiagnostics);
    }

    // Repair loop
    let repairResult;
    try {
      repairResult = await this.runRepairLoop(goal, context, initialResult.diagnostics!);
    } catch (error) {
      if (error instanceof RepairBudgetExceededError) {
        this.finished = true;
        return this.buildReport('BUDGET_EXCEEDED', currentDiagnostics, error);
      }
      if (error instanceof ReasoningError) {
        this.finished = true;
        return this.buildReport('BUDGET_EXCEEDED', currentDiagnostics, error);
      }
      throw error;
    }

    this.finished = true;

    if (repairResult.success) {
      return this.buildReport('SUCCESS', repairResult.diagnostics);
    }

    if (repairResult.error instanceof RepairBudgetExceededError) {
      return this.buildReport('BUDGET_EXCEEDED', repairResult.diagnostics, repairResult.error);
    }

    return this.buildReport('FAILED', repairResult.diagnostics, repairResult.error);
  }

  private buildReport(
    outcome: CodingReport['outcome'],
    diagnostics: Diagnostics,
    error?: Error,
  ): CodingReport {
    const executionTimeMs = this.now() - this.startTime;
    return {
      outcome,
      transactions: [...this.counters.transactions],
      patchesGenerated: this.counters.patchesGenerated,
      patchCalls: this.counters.patchGenerations,
      repairAttempts: this.counters.repairAttempts,
      modelCalls: this.counters.modelCalls,
      verificationRuns: this.counters.verificationRuns,
      diagnostics: [diagnostics],
      rollbackCount: this.counters.rollbackCount,
      events: this.eventBus.events,
      executionTimeMs,
      error,
    };
  }
}

function createEmptyDiagnostics(): Diagnostics {
  return {
    source: 'verification',
    diagnostics: [],
    stderr: [],
    verificationDurationMs: 0,
    summary: 'Verification passed on first attempt',
  };
}

/** Factory function for the autonomous coding engine. */
export function createCodingEngine(config: CodingEngineConfig): AutonomousCodingEngine {
  return new AutonomousCodingEngine(config);
}