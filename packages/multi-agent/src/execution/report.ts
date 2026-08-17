/**
 * @devforge/multi-agent — Report builder (DF-022).
 *
 * Produces the final {@link FinalReport}: a deterministic timeline, per-agent
 * metrics, the execution graph, repair and review summaries, merge summary,
 * verification summary and overall outcome. All aggregations are pure and
 * deterministic.
 */

import type {
  AgentMetrics,
  AgentRole,
  ExecutionGraphNode,
  FinalReport,
  MergeSummary,
  RepairSummary,
  ReviewSummary,
  RunOutcome,
  Task,
  TaskResult,
  TimelineEntry,
  VerificationSummary,
} from '../types.js';
import { AGENT_ROLES } from '../types.js';
import type { Conversation } from '../conversation.js';
import type { Schedule } from '../types.js';

/** Mutable local accumulator for per-agent metrics. */
type MutableMetrics = { -readonly [K in keyof AgentMetrics]: AgentMetrics[K] };

/** Inputs required to build a report. */
export interface ReportInput {
  readonly runId: string;
  readonly goal: string;
  readonly outcome: RunOutcome;
  readonly ok: boolean;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly conversation: Conversation;
  readonly schedule: Schedule;
  readonly tasks: readonly TaskResult[];
  /** Original (planned) tasks — provides dependency edges for the graph. */
  readonly taskPlan: readonly Task[];
  readonly repair: RepairSummary;
  readonly review: ReviewSummary;
  readonly merge: MergeSummary;
  readonly verification: VerificationSummary | null;
}

/** Derive the timeline from the shared conversation. */
export function buildTimeline(conversation: Conversation): readonly TimelineEntry[] {
  return conversation.all().map((message) => ({
    index: message.index,
    at: message.at,
    type: message.type,
    taskId: message.taskId,
    role: message.role,
    summary: message.summary,
  }));
}

/** Aggregate per-agent metrics from task results. */
export function agentMetrics(tasks: readonly TaskResult[]): readonly AgentMetrics[] {
  const byRole = new Map<AgentRole, MutableMetrics>();
  for (const role of AGENT_ROLES) {
    byRole.set(role, {
      role,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      retried: 0,
      totalDurationMs: 0,
      artifactCount: 0,
    });
  }
  for (const task of tasks) {
    const m = byRole.get(task.role);
    if (!m) continue;
    m.attempted += 1;
    if (task.status === 'SUCCEEDED') m.succeeded += 1;
    if (task.status === 'FAILED') m.failed += 1;
    if (task.status === 'SKIPPED') m.skipped += 1;
    if (task.status === 'CANCELLED') m.cancelled += 1;
    m.retried += Math.max(0, task.attempts - 1);
    m.totalDurationMs += task.durationMs;
    m.artifactCount += task.artifacts.length;
  }
  return AGENT_ROLES.map((role) => byRole.get(role)!);
}

/** Build the execution graph nodes from the schedule, results and plan. */
export function graphNodes(
  schedule: Schedule,
  tasks: readonly TaskResult[],
  taskPlan: readonly Task[],
): readonly ExecutionGraphNode[] {
  const resultById = new Map(tasks.map((t) => [t.taskId, t]));
  const planById = new Map(taskPlan.map((t) => [t.id, t]));
  const nodes: ExecutionGraphNode[] = [];
  for (const id of schedule.order) {
    const task = resultById.get(id);
    if (!task) continue;
    const plan = planById.get(id);
    nodes.push({
      taskId: task.taskId,
      title: plan?.title ?? task.taskId,
      role: task.role,
      kind: task.kind,
      status: task.status,
      dependsOn: plan?.dependsOn ?? [],
      attempts: task.attempts,
      durationMs: task.durationMs,
      batch: task.batch ?? 0,
    });
  }
  return nodes;
}

/** Build the final report deterministically. */
export function buildReport(input: ReportInput): FinalReport {
  return {
    runId: input.runId,
    goal: input.goal,
    outcome: input.outcome,
    ok: input.ok,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(0, input.finishedAt - input.startedAt),
    timeline: buildTimeline(input.conversation),
    agents: agentMetrics(input.tasks),
    graph: graphNodes(input.schedule, input.tasks, input.taskPlan),
    repair: input.repair,
    review: input.review,
    merge: input.merge,
    verification: input.verification,
    taskResults: input.tasks,
  };
}

/** Derive a MergeSummary from counts. */
export function mergeSummary(
  files: number,
  deduped: number,
  merged: number,
  conflicts: number,
  unresolved: number,
): MergeSummary {
  return { files, deduped, merged, conflicts, unresolved };
}
