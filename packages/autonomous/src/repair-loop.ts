/**
 * @devforge/autonomous — Repair loop (DF-019).
 *
 * After every failed verification the loop collects compiler errors, test
 * failures, linter output, runtime output, reasoning summaries, and repository
 * context; asks the ReasoningModel for a diagnosis; generates a repair patch
 * through the CodingModel / PatchEngine; applies, verifies, and retries until
 * success, a stop condition, or the budget is exhausted.
 */

import type { CodePatch, Diagnostics, PatchEngine, ReasoningModel } from '@devforge/execution';
import { defaultAnalysis, defaultDecision } from '@devforge/execution';
import type { AttemptRecord, TerminationReason } from './types.js';
import { AttemptHistory, estimatePatchTokens, fingerprintPatches, patchSummary } from './attempt-history.js';
import { confidenceGate, type ConfidenceEvaluator } from './confidence.js';
import type { PatchSelector, SelectedPatch } from './patch-selector.js';
import type { RollbackManager, RollbackToken } from './rollback.js';
import type { TerminationController } from './termination.js';
import type { VerificationLoop, VerificationRun } from './verification-loop.js';
import { AutonomousDuplicateError, AutonomousPatchError } from './errors.js';

/** Function that applies normalized patches to the workspace. */
export type ApplyPatchesFn = (patches: readonly CodePatch[]) => Promise<void>;

/** Outcome of one repair-loop execution. */
export interface RepairOutcome {
  readonly success: boolean;
  readonly attempts: number;
  readonly reason: TerminationReason;
  readonly message: string;
  readonly verifications: readonly VerificationRun[];
  /** Total patches returned by the generation engine across repairs. */
  readonly patchesGenerated: number;
  /** Estimated total tokens consumed across repairs. */
  readonly tokens: number;
}

/** Options that configure a single repair-loop run. */
export interface RepairLoopOptions {
  readonly goal: string;
  readonly context: readonly string[];
  readonly initialDiagnostics: Diagnostics;
  readonly reasoningModel: ReasoningModel | null;
  readonly patchEngine: PatchEngine;
  readonly patchSelector: PatchSelector;
  readonly confidence: ConfidenceEvaluator;
  readonly confidenceThreshold: number;
  readonly termination: TerminationController;
  readonly attemptHistory: AttemptHistory;
  readonly verification: VerificationLoop;
  readonly rollback: RollbackManager;
  readonly maxAttempts: number;
  readonly applyPatches: ApplyPatchesFn;
  readonly now: () => number;
  readonly startedAt: number;
  /** Offset added to attempt numbers so the caller has a global sequence. */
  readonly attemptOffset?: number;
  readonly signal?: AbortSignal;
  readonly onEvent?: (message: string, attempt: number) => void;
}

/** Controller of the repair loop. */
export class RepairLoop {
  private readonly options: RepairLoopOptions;

  constructor(options: RepairLoopOptions) {
    this.options = options;
  }

  static create(options: RepairLoopOptions): RepairLoop {
    return new RepairLoop(options);
  }

  /** Run repair iterations until success or a stop condition. */
  async run(): Promise<RepairOutcome> {
    const {
      goal,
      context,
      initialDiagnostics,
      maxAttempts,
      termination,
      confidence,
      confidenceThreshold,
      patchEngine,
      patchSelector,
      attemptHistory,
      verification,
      rollback,
      applyPatches,
      now,
      signal,
    } = this.options;

    let diagnostics = initialDiagnostics;
    const verifications: VerificationRun[] = [];
    const offset = this.options.attemptOffset ?? 0;
    let totalPatches = 0;
    let totalTokens = 0;
    const done = (
      success: boolean,
      attempts: number,
      reason: TerminationReason,
      message: string,
    ): RepairOutcome => ({
      success,
      attempts,
      reason,
      message,
      verifications,
      patchesGenerated: totalPatches,
      tokens: totalTokens,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const globalAttempt = offset + attempt;
      if (signal?.aborted) {
        return done(false, attempt - 1, 'USER_CANCELLED', 'repair loop cancelled');
      }

      const term = termination.evaluate({
        attempt: globalAttempt,
        startedAt: this.options.startedAt,
        now: now(),
        lastFingerprint: undefined,
        fingerprintCount: 0,
      });
      if (term.stop && term.reason !== 'VERIFICATION_PASSED') {
        return done(
          false,
          attempt - 1,
          term.reason as TerminationReason,
          term.message,
        );
      }

      this.options.onEvent?.(`repair attempt ${attempt}`, attempt);

      // 1. Diagnose the failure with the Reasoning model.
      const analysisInput = {
        goal: this.options.goal,
        diagnostics,
        attempt,
      };
      let analysis;
      let decision;
      try {
        if (this.options.reasoningModel) {
          analysis = await this.options.reasoningModel.analyzeFailure(analysisInput);
          decision = await this.options.reasoningModel.decideRepair({
            goal: this.options.goal,
            diagnostics,
            analysis,
            attempt,
          });
        } else {
          analysis = defaultAnalysis(analysisInput);
          decision = defaultDecision({
            ...analysisInput,
            analysis,
          });
        }
      } catch (error) {
        return done(
          false,
          attempt - 1,
          'NO_REPAIR_PATH',
          `reasoning failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (decision.strategy === 'ABORT') {
        return done(false, attempt - 1, 'NO_REPAIR_PATH', decision.reason);
      }

      const repairInstructions = context.concat([
        `REPAIR ATTEMPT ${attempt}`,
        `diagnosis: ${analysis.diagnosis}`,
        `strategy: ${decision.strategy} (${decision.scope})`,
        decision.reason,
      ]);

      // 2. Generate a repair patch set.
      let patches: readonly CodePatch[];
      try {
        patches = await patchEngine.generate({
          goal: this.options.goal,
          context: repairInstructions,
          generatedCount: attemptHistory.size,
          signal,
        });
      } catch (error) {
        throw new AutonomousPatchError(
          `Repair generation failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error, attempt },
        );
      }
      totalPatches += patches.length;
      totalTokens += estimatePatchTokens(patches);
      if (patches.length === 0) {
        return done(false, attempt - 1, 'PATCH_GENERATION_FAILED', 'repair generated no patches');
      }

      // 3. Deterministically select the best patches.
      const selection = patchSelector.select(patches, {
        context: { goal: this.options.goal, attempt, failures: attempt - 1 },
      });
      const selected = selection.selected;
      if (selected.length === 0) {
        return done(false, attempt - 1, 'PATCH_GENERATION_FAILED', 'no patch survived selection');
      }

      // 4. Never generate the same patch twice.
      const fingerprint = fingerprintPatchSet(selected);
      if (attemptHistory.isDuplicate(selectedPatches(selected), globalAttempt)) {
        return done(false, attempt, 'DUPLICATE_PATCH', `patch set ${fingerprint} repeats an earlier attempt`);
      }

      // 5. Confidence gate.
      const best = selected[0]!.score;
      const gate = confidenceGate(confidenceThreshold);
      const gateDecision = gate.check(best);
      if (!gateDecision.pass) {
        attemptHistory.record({
          attempt: globalAttempt,
          patchIds: selected.map((entry) => entry.patch.id),
          files: selectedFiles(selected),
          summary: patchSummary(selectedPatches(selected)),
          fingerprint,
          verificationOk: false,
          failureReason: gateDecision.message,
          tokens: estimatePatchTokens(selectedPatches(selected)),
          durationMs: 0,
          confidence: best.confidence,
          startedAt: now(),
        });
        return done(false, attempt, 'CONFIDENCE_BELOW_THRESHOLD', gateDecision.message);
      }

      // 6. Snapshot, apply, verify.
      const token = await rollback.snapshotFor(selectedFiles(selected));
      await applyPatches(selectedPatches(selected));
      const run = await verification.run(signal);
      verifications.push(run);

      try {
        attemptHistory.record({
          attempt: globalAttempt,
          patchIds: selectedPatches(selected).map((patch) => patch.id),
          files: selectedFiles(selected),
          summary: patchSummary(selectedPatches(selected)),
          fingerprint,
          verificationOk: run.ok,
          failureReason: run.ok ? undefined : summarizeFailure(run, diagnostics),
          tokens: estimatePatchTokens(selectedPatches(selected)),
          durationMs: run.snapshot.durationMs,
          confidence: best.confidence,
          startedAt: now() - run.snapshot.durationMs,
        });
      } catch {
        // History recording is best-effort; never mask loop result.
      }

      if (run.ok) {
        rollback.clear();
        return done(true, attempt, 'VERIFICATION_PASSED', 'repair verified successfully');
      }

      diagnostics = run.diagnostics;
      await this.restoreQuietly(rollback, token);

      if (run.timedOut) {
        return done(false, attempt, 'TIMEOUT', 'verification timed out during repair');
      }
    }

    return done(false, maxAttempts, 'MAX_ATTEMPTS_REACHED', `all ${maxAttempts} repair attempts exhausted`);
  }

  private async restoreQuietly(rollback: RollbackManager, token: RollbackToken): Promise<void> {
    try {
      await rollback.restoreToken(token.token);
    } catch {
      // keep best effort; the agent surfaces the rollback failure via the report
    }
  }
}

function fingerprintPatchSet(selected: readonly SelectedPatch[]): string {
  return fingerprintPatches(selectedPatches(selected));
}

function selectedPatches(selected: readonly SelectedPatch[]): readonly CodePatch[] {
  return selected.map((entry) => entry.patch);
}

function selectedFiles(selected: readonly SelectedPatch[]): readonly string[] {
  return Array.from(new Set(selectedPatches(selected).map((patch) => patch.file))).sort();
}

function summarizeFailure(run: VerificationRun, prior: Diagnostics): string {
  if (run.timedOut) return 'verification timed out';
  if (run.cancelled) return 'verification cancelled';
  const failed = run.snapshot.result.failedTargetId;
  const summary = run.diagnostics.summary || prior.summary;
  return failed !== undefined ? `${failed}: ${summary}` : summary;
}