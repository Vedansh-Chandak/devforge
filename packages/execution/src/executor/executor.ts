/**
 * @devforge/execution — The Executor engine (DF-016A).
 *
 * A deterministic orchestration engine. Given a validated ExecutionPlan it:
 *  1. validates the plan against the planner schema,
 *  2. schedules steps in a stable topological order,
 *  3. dispatches each step to a handler, coordinating Workspace, CommandRunner
 *     and GitService through injected dependencies,
 *  4. pauses on steps marked `requiresConfirmation` (resume() continues),
 *  5. honours cancellation (AbortSignal / cancel()) between steps, during
 *     verification, and before a confirmation wait,
 *  6. records rollback metadata only — never performing automatic rollback,
 *  7. emits a deterministic, timestamped event stream.
 *
 * The executor never spawns a process directly: verification and commands go
 * exclusively through the injected CommandRunner.
 */

import { validatePlan } from '@devforge/planner';
import type { ExecutionPlan, PlanStep } from '@devforge/planner';
import { createCommandRunner } from '../command/index.js';
import { createGitService } from '../git/index.js';
import { Workspace } from '../workspace/index.js';
import {
  ExecutorCancellationError,
  ExecutorError,
  ExecutorExecutionError,
  ExecutorValidationError,
  ExecutorVerificationError,
} from './errors.js';
import type { ExecutionEvent, ExecutionEventInput } from './events.js';
import { EXECUTION_EVENT_TYPES } from './events.js';
import { buildSchedule } from './scheduler.js';
import { StateMachine } from './state-machine.js';
import {
  buildExecutionReport,
  collateRollbackRecords,
  tokenizeRollback,
} from './report.js';
import { defaultVerificationTargets, runVerification } from './verification.js';
import type {
  Executor,
  ExecutorConfig,
  ExecuteOptions,
  ExecutionReport,
  ExecutionStatus,
  RollbackCapable,
  RollbackKind,
  StepContext,
  StepExecutionRecord,
  StepHandler,
  StepResult,
  VerificationTarget,
  CommandSpec,
} from './types.js';
import type { CommandRunner } from '../command/types.js';
import type { GitService } from '../git/types.js';
import type { PlanStepType } from '@devforge/planner';

/** Deterministic plan id derived from the goal when none is supplied. */
function derivePlanId(goal: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < goal.length; i++) {
    hash ^= goal.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `plan-${(hash >>> 0).toString(36)}`;
}

/** Map a step type to a rollback kind, or null when not rollback-capable. */
function rollbackKindForType(type: PlanStep['type']): RollbackKind | null {
  switch (type) {
    case 'EDIT':
      return 'WORKSPACE_WRITE';
    case 'CREATE':
      return 'WORKSPACE_CREATE';
    case 'DELETE':
      return 'WORKSPACE_DELETE';
    case 'COMMAND':
      return 'COMMAND';
    default:
      return null;
  }
}

/**
 * The executor implementation. One instance owns a single event stream and
 * serialises runs: calling execute() while another run is active throws.
 */
export class ExecutorEngine implements Executor {
  private readonly root: string;
  private readonly runner: CommandRunner;
  private readonly git: GitService;
  private readonly workspace: Workspace;
  private readonly handlers: Partial<Record<PlanStepType, StepHandler>>;
  private readonly commandSteps: Readonly<Record<string, CommandSpec>>;
  private readonly verificationTargets: readonly VerificationTarget[];
  private readonly rollbackCapableSteps: ReadonlySet<string>;
  private readonly now: () => number;

  private readonly machine = new StateMachine();
  private controller = new AbortController();
  private cancelReason: string | null = null;
  private running = false;
  private resumeWaiters: Array<() => void> = [];

  private eventStore: ExecutionEvent[] = [];
  private sequence = 0;
  private listeners = new Set<(event: ExecutionEvent) => void>();

  private stepRecords: MutableStepRecord[] = [];
  private run: RunState | null = null;
  private finishedAtMs: number | null = null;
  private terminalError: ExecutionReport['error'] = undefined;
  private currentStepId: string | null = null;

  constructor(config: ExecutorConfig) {
    this.root = config.workspaceRoot;
    this.now = config.now ?? (() => Date.now());
    this.runner =
      config.runner ??
      createCommandRunner({ workspaceRoot: config.workspaceRoot });
    this.git =
      config.git ??
      createGitService({
        workspaceRoot: config.workspaceRoot,
        runner: this.runner,
      });
    this.workspace =
      config.workspace ?? new Workspace({ root: config.workspaceRoot });
    this.handlers = config.handlers ?? {};
    this.commandSteps = config.commandSteps ?? {};
    this.verificationTargets =
      config.verificationTargets ??
      defaultVerificationTargets(config.workspaceRoot);
    this.rollbackCapableSteps = new Set(config.rollbackCapableSteps ?? []);
  }

  get status(): ExecutionStatus {
    return this.statusOf();
  }

  get state() {
    return this.machine.state;
  }

  get events(): readonly ExecutionEvent[] {
    return [...this.eventStore];
  }

  onEvent(listener: (event: ExecutionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Snapshot of the current execution report (mid-flight or terminal). */
  report(): ExecutionReport {
    const run = this.run;
    if (!run) {
      throw new ExecutorError('No execution has run yet');
    }
    const rollback = collateRollbackRecords(this.stepRecords);
    return buildExecutionReport({
      planId: run.planId,
      goal: run.plan.goal,
      summary: run.plan.summary,
      status: this.statusOf(),
      startedAtMs: run.startedAtMs,
      finishedAtMs: this.finishedAtMs,
      steps: this.stepRecords,
      rollback,
      error: this.terminalError,
      eventCount: this.eventStore.length,
      now: this.now,
    });
  }

  async execute(
    plan: ExecutionPlan,
    options: ExecuteOptions = {},
  ): Promise<ExecutionReport> {
    if (this.running) {
      throw new ExecutorError('Executor is already running');
    }

    this.resetRunState(options.planId ?? derivePlanId(plan.goal), plan);
    this.machine.reset();
    this.running = true;

    const external = options.signal;
    const onExternalAbort = (): void => {
      this.controller.abort('Aborted by caller signal');
      this.flushResumeWaiters();
    };
    if (external?.aborted) {
      onExternalAbort();
    } else {
      external?.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      await this.runPlan(plan);
    } finally {
      external?.removeEventListener('abort', onExternalAbort);
    }

    return this.report();
  }

  resume(): void {
    if (this.machine.state !== 'WAIT_CONFIRMATION') {
      throw new ExecutorError(
        'Cannot resume: execution is not awaiting confirmation',
        { code: 'RESUME_INVALID' },
      );
    }
    this.flushResumeWaiters();
  }

  cancel(reason = 'Cancelled by user'): void {
    this.cancelReason = reason;
    this.controller.abort(reason);
    this.flushResumeWaiters();
  }

  // ── Internals ────────────────────────────────────────────────────────

  private resetRunState(planId: string, plan: ExecutionPlan): void {
    this.eventStore = [];
    this.sequence = 0;
    this.stepRecords = [];
    this.run = { planId, plan, startedAtMs: this.now() };
    this.finishedAtMs = null;
    this.terminalError = undefined;
    this.currentStepId = null;
    this.cancelReason = null;
    if (this.controller.signal.aborted) {
      this.controller = new AbortController();
    }
  }

  private emit(input: ExecutionEventInput): void {
    const event = {
      ...input,
      sequence: this.sequence,
      timestamp: this.now(),
      planId: this.run?.planId ?? '',
    } as ExecutionEvent;
    this.sequence += 1;
    this.eventStore.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private flushResumeWaiters(): void {
    const waiters = this.resumeWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }

  private statusOf(): ExecutionStatus {
    if (this.machine.awaitingConfirmation) {
      return 'WAITING_CONFIRMATION';
    }
    if (this.running && !this.machine.done) {
      return 'RUNNING';
    }
    const state = this.machine.state;
    if (state === 'DONE') return 'COMPLETED';
    if (state === 'EXECUTION_FAILED') return 'FAILED';
    if (state === 'CANCELLED') return 'CANCELLED';
    return 'IDLE';
  }

  private async runPlan(plan: ExecutionPlan): Promise<void> {
    this.emit({
      type: EXECUTION_EVENT_TYPES.EXECUTION_STARTED,
      goal: plan.goal,
    });
    if (this.controller.signal.aborted) {
      this.cancelPath(this.cancelReason ?? 'Aborted before plan started');
      return;
    }

    const validation = validatePlan(plan as unknown);
    if (!validation.valid) {
      const message = `Plan failed validation: ${validation.errors[0] ?? 'unknown error'}`;
      this.failRun(
        new ExecutorValidationError(message, { code: 'INVALID_PLAN' }),
        message,
      );
      return;
    }

    this.machine.transition('PLAN_VALIDATED');
    this.emit({
      type: EXECUTION_EVENT_TYPES.PLAN_VALIDATED,
      stepCount: plan.steps.length,
    });

    let schedule;
    try {
      schedule = buildSchedule(plan);
    } catch (error) {
      this.failRun(
        error instanceof ExecutorError
          ? error
          : new ExecutorValidationError(String(error), { code: 'EMPTY_PLAN' }),
        error instanceof Error ? error.message : 'Scheduling failed',
      );
      return;
    }

    this.machine.transition('READY');

    for (const stepId of schedule.order) {
      this.currentStepId = stepId;
      if (this.controller.signal.aborted) {
        this.cancelPath(this.cancelReason ?? 'Aborted before step');
        return;
      }

      const step = schedule.steps.get(stepId)!;
      this.machine.transition('STEP_STARTED');
      this.emit({
        type: EXECUTION_EVENT_TYPES.STEP_STARTED,
        stepId,
        title: step.title,
      });
      this.beginStepRecord(step);

      if (step.requiresConfirmation) {
        this.machine.transition('WAIT_CONFIRMATION');
        this.emit({
          type: EXECUTION_EVENT_TYPES.EXECUTION_PAUSED,
          stepId,
          reason: `Step requires confirmation: ${step.title}`,
        });
        await this.waitForResume();
        if (this.controller.signal.aborted) {
          this.cancelPath(
            this.cancelReason ?? 'Aborted while waiting for confirmation',
          );
          return;
        }
      }

      this.machine.transition('STEP_EXECUTING');

      let result: StepResult;
      try {
        result = await this.dispatch(step);
      } catch (error) {
        if (this.controller.signal.aborted) {
          this.cancelPath(this.cancelReason ?? 'Aborted during step');
          return;
        }
        this.failStep(step, error);
        return;
      }

      if (this.controller.signal.aborted) {
        this.cancelPath(this.cancelReason ?? 'Aborted after step');
        return;
      }

      if (!result.ok) {
        this.failStep(
          step,
          new ExecutorExecutionError(`Step "${stepId}" reported failure`, {
            code: 'STEP_EXECUTION_FAILED',
            stepId,
          }),
        );
        return;
      }

      this.completeStep(step, result);

      const remaining =
        schedule.order.indexOf(stepId) < schedule.order.length - 1;
      this.machine.transition(remaining ? 'NEXT_STEP' : 'DONE');
      if (!remaining) {
        break;
      }
    }

    if (!this.machine.done) {
      this.machine.transition('DONE');
    }
    this.emit({
      type: EXECUTION_EVENT_TYPES.EXECUTION_COMPLETED,
      durationMs: this.now() - this.run!.startedAtMs,
      stepCount: this.stepRecords.length,
    });
    this.finish('COMPLETED');
  }

  private async waitForResume(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.resumeWaiters.push(resolve);
    });
  }

  private async dispatch(step: PlanStep): Promise<StepResult> {
    const handler = this.handlers[step.type];
    const ctx: StepContext = {
      step,
      plan: this.run!.plan,
      workspace: this.workspace,
      runner: this.runner,
      git: this.git,
      signal: this.controller.signal,
      clock: this.now,
    };
    if (handler) {
      return handler(ctx);
    }
    if (step.type === 'COMMAND') {
      return this.runCommandStep(step, ctx);
    }
    if (step.type === 'VERIFY') {
      return this.runVerifyStep(step, ctx);
    }
    throw new ExecutorValidationError(
      `No handler registered for step type "${step.type}"`,
      { code: 'NO_HANDLER', stepId: step.id },
    );
  }

  private async runCommandStep(
    step: PlanStep,
    ctx: StepContext,
  ): Promise<StepResult> {
    const spec = this.commandSteps?.[step.id];
    if (!spec) {
      throw new ExecutorValidationError(
        `No command specification for step "${step.id}"`,
        { code: 'COMMAND_SPEC_MISSING', stepId: step.id },
      );
    }
    const result = await this.runner.run({
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd ?? this.root,
      timeoutMs: spec.timeoutMs,
      maxOutputBytes: spec.maxOutputBytes,
      allowFailure: spec.allowFailure,
      abortSignal: ctx.signal,
    });
    if (!result.success) {
      throw new ExecutorExecutionError(
        `Command step "${step.id}" failed with exit code ${result.exitCode ?? 'null'}`,
        { code: 'STEP_EXECUTION_FAILED', stepId: step.id },
      );
    }
    return {
      ok: true,
      summary: `${spec.command} ${spec.args.join(' ')}`,
      output: result.stdout,
    };
  }

  private async runVerifyStep(
    step: PlanStep,
    ctx: StepContext,
  ): Promise<StepResult> {
    const targets = this.verificationTargets;
    this.emit({
      type: EXECUTION_EVENT_TYPES.VERIFICATION_STARTED,
      stepId: step.id,
      targetIds: targets.map((target) => target.id),
    });
    const result = await runVerification(this.runner, targets, {
      cwd: this.root,
      abortSignal: ctx.signal,
      now: ctx.clock,
    });
    if (result.cancelled) {
      throw new ExecutorCancellationError(
        `Verification cancelled during step "${step.id}"`,
        { code: 'CANCELLED', stepId: step.id },
      );
    }
    if (!result.ok) {
      const failed = result.targets.find((target) => !target.success);
      this.emit({
        type: EXECUTION_EVENT_TYPES.VERIFICATION_FAILED,
        stepId: step.id,
        targetId: failed?.targetId ?? 'unknown',
        exitCode: failed?.exitCode ?? null,
      });
      throw new ExecutorVerificationError(
        `Verification failed for step "${step.id}" at target "${failed?.targetId ?? 'unknown'}"`,
        { code: 'VERIFICATION_FAILED', stepId: step.id },
      );
    }
    this.emit({
      type: EXECUTION_EVENT_TYPES.VERIFICATION_PASSED,
      stepId: step.id,
      durationMs: result.durationMs,
    });
    return {
      ok: true,
      summary: `verification passed (${targets.map((target) => target.id).join(', ')})`,
    };
  }

  private beginStepRecord(step: PlanStep): void {
    this.stepRecords.push({
      stepId: step.id,
      title: step.title,
      type: step.type,
      status: 'COMPLETED',
      startedAt: new Date(this.now()).toISOString(),
      finishedAt: null,
      durationMs: 0,
    });
  }

  private completeStep(step: PlanStep, result: StepResult): void {
    const record = this.findStepRecord(step.id);
    const startedMs = Date.parse(record.startedAt);
    const finishedMs = this.now();
    record.finishedAt = new Date(finishedMs).toISOString();
    record.durationMs = finishedMs - startedMs;
    record.summary = result.summary;
    record.output = result.output;
    record.rollback = this.collectRollback(step, result);

    this.machine.transition('STEP_COMPLETED');
    this.emit({
      type: EXECUTION_EVENT_TYPES.STEP_COMPLETED,
      stepId: step.id,
      durationMs: record.durationMs,
    });
  }

  private collectRollback(
    step: PlanStep,
    result: StepResult,
  ): readonly RollbackCapable[] {
    const capabilities: RollbackCapable[] = [];
    if (this.rollbackCapableSteps.has(step.id)) {
      const kind = rollbackKindForType(step.type);
      if (kind) {
        capabilities.push({
          stepId: step.id,
          kind,
          token: '',
          description: `rollback-capable ${step.type} step`,
        });
      }
    }
    for (const operation of result.rollback ?? []) {
      capabilities.push({ ...operation, stepId: step.id, token: '' });
    }
    return tokenizeRollback(step.id, capabilities);
  }

  private failStep(step: PlanStep, error: unknown): void {
    const record = this.findStepRecord(step.id);
    const startedMs = Date.parse(record.startedAt);
    const finishedMs = this.now();
    record.finishedAt = new Date(finishedMs).toISOString();
    record.durationMs = finishedMs - startedMs;
    record.status = 'FAILED';
    record.error = {
      code:
        error instanceof ExecutorError ? error.code : 'STEP_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };

    this.machine.transition('STEP_FAILED');
    this.emit({
      type: EXECUTION_EVENT_TYPES.STEP_FAILED,
      stepId: step.id,
      errorCode: record.error.code,
      message: record.error.message,
    });
    this.machine.transition('EXECUTION_FAILED');
    this.terminalError = {
      code: record.error.code,
      message: record.error.message,
      stepId: step.id,
    };
    this.emit({
      type: EXECUTION_EVENT_TYPES.EXECUTION_FAILED,
      errorCode: record.error.code,
      message: record.error.message,
      stepId: step.id,
    });
    this.finish('FAILED');
    throw error instanceof ExecutorError
      ? error
      : new ExecutorExecutionError(String(error), {
          code: 'STEP_EXECUTION_FAILED',
          stepId: step.id,
        });
  }

  private failRun(error: ExecutorError, message: string): void {
    this.terminalError = { code: error.code, message };
    if (!this.machine.done) {
      if (this.machine.state === 'STEP_FAILED') {
        this.machine.transition('EXECUTION_FAILED');
      } else {
        try {
          this.machine.transition('EXECUTION_FAILED');
        } catch {
          // Already terminal: leave the machine as-is.
        }
      }
    }
    this.emit({
      type: EXECUTION_EVENT_TYPES.EXECUTION_FAILED,
      errorCode: error.code,
      message,
    });
    this.finish('FAILED');
    throw error;
  }

  private cancelPath(reason: string): void {
    this.emit({
      type: EXECUTION_EVENT_TYPES.EXECUTION_CANCELLED,
      reason,
    });
    if (!this.machine.done) {
      this.machine.transition('CANCELLED');
    }
    this.finish('CANCELLED');
    throw new ExecutorCancellationError(reason, {
      code: 'CANCELLED',
      planId: this.run?.planId,
      stepId: this.currentStepId ?? undefined,
    });
  }

  private finish(status: ExecutionStatus): void {
    this.finishedAtMs = this.now();
    this.running = false;
  }

  private findStepRecord(stepId: string): MutableStepRecord {
    const record = this.stepRecords.find(
      (candidate) => candidate.stepId === stepId,
    );
    if (!record) {
      throw new ExecutorError(`Internal error: no record for step "${stepId}"`);
    }
    return record;
  }
}

/** Mutable working copy of a step record while a run is in progress. */
interface MutableStepRecord {
  stepId: string;
  title: string;
  type: PlanStepType;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  summary?: string;
  output?: string;
  error?: StepExecutionRecord['error'];
  rollback?: readonly RollbackCapable[];
}

/** Snapshot of a run kept for report construction. */
interface RunState {
  readonly planId: string;
  readonly plan: ExecutionPlan;
  readonly startedAtMs: number;
}

/** Create a deterministic executor bound to a workspace root. */
export function createExecutor(config: ExecutorConfig): Executor {
  return new ExecutorEngine(config);
}
