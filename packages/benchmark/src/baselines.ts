/**
 * @devforge/benchmark — Baseline adapters (DF-024).
 *
 * Baselines provide deterministic, scripted "agents" so the framework can be
 * tested end-to-end with no real model. There are two built-ins:
 *
 * - {@link DeterministicBaselineAgent}: identical behavior for every task.
 * - {@link ScriptedBaselineAgent}: per-task (or per-category) behavior map.
 *
 * Future baselines (single-agent, autonomous, multi-agent, memory on/off,
 * different model providers) are added by implementing {@link BenchmarkAgent}
 * or composing these baselines; no core DevForge classes are required.
 */
import type { Clock } from "./clock.js";
import type { Cancellation } from "./execution.js";
import { CancelledError, TimeoutError } from "./errors.js";
import {
  type AdapterTelemetry,
  type AgentPlanInput,
  type AgentPlanResult,
  type AgentRunInput,
  type AgentRunResult,
  type AgentStepInput,
  type AgentStepResult,
  type BenchmarkAgent,
  type BenchmarkTask,
  type FilePatch,
} from "./types.js";

/** Fully scripted behavior for a baseline adapter. */
export interface BaselineBehavior {
  readonly outcome: "pass" | "fail";
  /** Fixed duration reports, not measured — fully deterministic. */
  readonly planDurationMs?: number;
  readonly executeDurationMs?: number;
  readonly repairDurationMs?: number;
  readonly filesWritten?: Readonly<Record<string, string>>;
  readonly patch?: FilePatch;
  readonly planSummary?: string;
  readonly planSteps?: readonly string[];
  readonly commands?: readonly string[];
  /** 1-based attempt index that finally succeeds (repair loop). */
  readonly attemptsToSucceed?: number;
  readonly telemetry?: Partial<AdapterTelemetry>;
}

export interface Script {
  readonly byTask?: Readonly<Record<string, BaselineBehavior>>;
  readonly byCategory?: Readonly<Record<string, BaselineBehavior>>;
  readonly default?: BaselineBehavior;
}

function telemetryFrom(
  behavior: BaselineBehavior,
  repairSteps: number,
): AdapterTelemetry {
  return {
    tokenUsage: behavior.telemetry?.tokenUsage,
    modelCalls: behavior.telemetry?.modelCalls,
    toolCalls: behavior.telemetry?.toolCalls,
    memoryRetrievalCount: behavior.telemetry?.memoryRetrievalCount,
    memoryHitRate: behavior.telemetry?.memoryHitRate,
    attemptedRepairs: repairSteps,
  };
}

function durationMs(behavior: BaselineBehavior, key: keyof BaselineBehavior): number {
  const value = behavior[key];
  return typeof value === "number" ? value : 0;
}

function check(context: AgentRunInput["context"], step: string): void {
  context.deadline.check(`baseline.${step}`);
  context.cancellation.check(`baseline.${step}`);
}

/**
 * Scripted baseline: picks a behavior from an explicit task/category map with
 * an optional catch-all default. Behavior resolution is deterministic.
 */
export class ScriptedBaselineAgent implements BenchmarkAgent {
  readonly name: string;
  readonly version: string;

  constructor(
    private readonly script: Script,
    options: { name?: string; version?: string } = {},
  ) {
    this.name = options.name ?? "scripted-baseline";
    this.version = options.version ?? "1.0.0";
  }

  /** Deterministic behavior resolution for a task. */
  behaviorFor(task: BenchmarkTask): BaselineBehavior {
    const exact = this.script.byTask?.[task.id];
    if (exact) return exact;
    const category = this.script.byCategory?.[task.category];
    if (category) return category;
    if (this.script.default) return this.script.default;
    return { outcome: "pass" };
  }

  async plan(input: AgentPlanInput): Promise<AgentPlanResult> {
    const behavior = this.behaviorFor(input.task);
    check(input.context, "plan");
    return {
      summary: behavior.planSummary ?? `baseline plan for ${input.task.id}`,
      steps: behavior.planSteps ?? [],
      durationMs: durationMs(behavior, "planDurationMs"),
    };
  }

  async execute(input: AgentStepInput): Promise<AgentStepResult> {
    const behavior = this.behaviorFor(input.task);
    check(input.context, "execute");
    return {
      intent: input.kind === "repair" ? `repair ${input.task.id}` : `execute ${input.task.id}`,
      status: "success",
      message: "scripted success",
      commandsRun: [...(behavior.commands ?? [])],
      durationMs: durationMs(behavior, "executeDurationMs"),
    };
  }

  async repair(input: AgentStepInput): Promise<AgentStepResult> {
    const behavior = this.behaviorFor(input.task);
    check(input.context, "repair");
    return {
      intent: `repair ${input.task.id}`,
      status: input.kind === "repair" ? "success" : "failed",
      message: "scripted repair",
      commandsRun: [...(behavior.commands ?? [])],
      durationMs: durationMs(behavior, "repairDurationMs"),
    };
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const behavior = this.behaviorFor(input.task);
    const attemptsToSucceed = Math.max(1, behavior.attemptsToSucceed ?? 1);
    const plan = await this.plan({ ...input, kind: "plan" });

    const steps: AgentStepResult[] = [];
    let repairSteps = 0;
    let finalStep: AgentStepResult | null = null;

    for (let attempt = 1; attempt <= attemptsToSucceed; attempt += 1) {
      check(input.context, `attempt ${attempt}`);
      if (attempt < attemptsToSucceed) {
        const failed = await this.execute({ ...input, kind: "execute" });
        steps.push({ ...failed, status: "failed", message: "scripted failure (retry)" });
        if (this.repair) {
          const repaired = await this.repair({ ...input, kind: "repair" });
          steps.push(repaired);
          repairSteps += 1;
        }
        continue;
      }
      finalStep = await this.execute({ ...input, kind: "execute" });
      steps.push(finalStep);
    }

    const agentStatus =
      finalStep === null || finalStep.status === "failed"
        ? "failed"
        : behavior.outcome === "fail"
          ? "failed"
          : "success";

    return {
      status: agentStatus,
      plan,
      steps,
      filesWritten: behavior.filesWritten ?? {},
      patch: behavior.patch,
      telemetry: telemetryFrom(behavior, repairSteps),
      note: agentStatus === "success" ? "scripted baseline success" : "scripted baseline failure",
    };
  }
}

/** Deterministic baseline: identical behavior for every task. */
export class DeterministicBaselineAgent extends ScriptedBaselineAgent {
  constructor(
    behavior: BaselineBehavior,
    options: { name?: string; version?: string } = {},
  ) {
    super({ default: behavior }, { name: options.name ?? "deterministic-baseline", version: options.version ?? "1.0.0" });
  }
}

/** Baseline that always passes, optionally writing files. */
export function createPassBaseline(
  options: {
    name?: string;
    files?: Readonly<Record<string, string>>;
  } = {},
): BenchmarkAgent {
  return new DeterministicBaselineAgent(
    { outcome: "pass", filesWritten: options.files },
    { name: options.name ?? "pass-baseline" },
  );
}

/** Baseline that always fails verification. */
export function createFailBaseline(
  options: { name?: string } = {},
): BenchmarkAgent {
  return new DeterministicBaselineAgent(
    { outcome: "fail" },
    { name: options.name ?? "fail-baseline" },
  );
}

export type { Clock, Cancellation };

export { CancelledError, TimeoutError };