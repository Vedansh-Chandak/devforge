import { describe, expect, it } from 'vitest';
import {
  agentMetrics,
  buildReport,
  buildTimeline,
  graphNodes,
  mergeSummary,
  type ReportInput,
} from '../src/execution/report.js';
import { Conversation } from '../src/conversation.js';
import { buildSchedule } from '../src/scheduler.js';
import { runStarted, runCompleted, taskAssigned, taskSucceeded } from '../src/message.js';
import type { Task, TaskResult } from '../src/types.js';

const plan = (tasks: readonly Task[]): ReportInput['taskPlan'] => tasks;

function resultsFor(...taskResults: TaskResult[]): readonly TaskResult[] {
  return taskResults;
}

const mkResult = (overrides: Partial<TaskResult>): TaskResult => ({
  taskId: 'a',
  role: 'CODER',
  kind: 'IMPLEMENT',
  ok: true,
  status: 'SUCCEEDED',
  artifacts: [],
  messages: [],
  attempts: 1,
  durationMs: 10,
  error: null,
  batch: 0,
  ...overrides,
});

function reportInput(overrides: Partial<ReportInput> = {}): ReportInput {
  const tasks: readonly Task[] = [
    {
      id: 'a',
      title: 'A',
      description: 'A',
      kind: 'IMPLEMENT',
      role: 'CODER',
      dependsOn: [],
      requiresConfirmation: false,
      timeoutMs: 1000,
      maxRetries: 1,
    },
    {
      id: 'b',
      title: 'B',
      description: 'B',
      kind: 'IMPLEMENT',
      role: 'CODER',
      dependsOn: ['a'],
      requiresConfirmation: false,
      timeoutMs: 1000,
      maxRetries: 1,
    },
  ];
  return {
    runId: 'run-1',
    goal: 'goal',
    outcome: 'SUCCESS',
    ok: true,
    startedAt: 0,
    finishedAt: 50,
    conversation: new Conversation('run-1'),
    schedule: buildSchedule(tasks),
    tasks: resultsFor(mkResult({}), mkResult({ taskId: 'b', status: 'SUCCEEDED', durationMs: 20, batch: 1 })),
    taskPlan: tasks,
    repair: { repairRequests: 0, repairTaskIds: [], repaired: 0, unresolved: [] },
    review: { comments: 0, paths: [], blocking: 0 },
    merge: { files: 2, deduped: 0, merged: 2, conflicts: 0, unresolved: 0 },
    verification: { ok: true, targets: ['typecheck'], failedTargetId: null, durationMs: 5, attempts: 1, cancelled: false },
    ...overrides,
  };
}

describe('buildTimeline', () => {
  it('derives entries from the conversation in order', () => {
    const c = new Conversation('r');
    c.post(runStarted({ at: 0, goal: 'g' }));
    c.post(taskAssigned({ at: 1, taskId: 'a', role: 'CODER', title: 'A' }));
    c.post(taskSucceeded({ at: 2, taskId: 'a', role: 'CODER', artifacts: 1 }));
    c.post(runCompleted({ at: 3, outcome: 'SUCCESS', ok: true }));
    const timeline = buildTimeline(c);
    expect(timeline.map((t) => t.type)).toEqual([
      'RUN_STARTED',
      'TASK_ASSIGNED',
      'TASK_SUCCEEDED',
      'RUN_COMPLETED',
    ]);
    expect(timeline.map((t) => t.index)).toEqual([0, 1, 2, 3]);
    expect(timeline[1]!.taskId).toBe('a');
  });
});

describe('agentMetrics', () => {
  it('reports counts per role', () => {
    const metrics = agentMetrics([
      mkResult({}),
      mkResult({ taskId: 'b', kind: 'IMPLEMENT', status: 'FAILED', ok: false, error: { code: 'X', message: 'x', retryable: false }, attempts: 2, durationMs: 5 }),
      mkResult({ taskId: 'c', role: 'PLANNER', kind: 'PLAN', status: 'SKIPPED', ok: false, attempts: 0 }),
    ]);
    const coder = metrics.find((m) => m.role === 'CODER')!;
    expect(coder.attempted).toBe(2);
    expect(coder.succeeded).toBe(1);
    expect(coder.failed).toBe(1);
    expect(coder.retried).toBe(1);
    expect(coder.totalDurationMs).toBe(15);
    const planner = metrics.find((m) => m.role === 'PLANNER')!;
    expect(planner.skipped).toBe(1);
  });

  it('counts artifacts from succeeded tasks', () => {
    const metrics = agentMetrics([
      mkResult({ artifacts: [{ path: 'a.ts', kind: 'FILE', content: 'x', id: 'a:impl' }] }),
    ]);
    const coder = metrics.find((m) => m.role === 'CODER')!;
    expect(coder.artifactCount).toBe(1);
  });

  it('always returns all six roles in canonical order', () => {
    const metrics = agentMetrics([]);
    expect(metrics.map((m) => m.role)).toEqual([
      'PLANNER',
      'CODER',
      'TESTER',
      'REVIEWER',
      'REPAIR',
      'DOCUMENTATION',
    ]);
  });

  it('records cancelled tasks', () => {
    const metrics = agentMetrics([mkResult({ status: 'CANCELLED', ok: false })]);
    const coder = metrics.find((m) => m.role === 'CODER')!;
    expect(coder.cancelled).toBe(1);
  });
});

describe('graphNodes', () => {
  it('builds nodes in schedule order with plan metadata', () => {
    const input = reportInput();
    const nodes = graphNodes(input.schedule, input.tasks, input.taskPlan);
    expect(nodes.map((n) => n.taskId)).toEqual(['a', 'b']);
    expect(nodes[1]).toMatchObject({ title: 'B', dependsOn: ['a'], batch: 1 });
  });

  it('ignores results without a schedule slot', () => {
    const input = reportInput({
      tasks: resultsFor(mkResult({ taskId: 'zz' })),
    });
    const nodes = graphNodes(input.schedule, input.tasks, input.taskPlan);
    expect(nodes).toEqual([]);
  });

  it('falls back to taskId when a plan entry is missing', () => {
    const input = reportInput({
      taskPlan: [],
    });
    const nodes = graphNodes(input.schedule, input.tasks, input.taskPlan);
    expect(nodes[0]!.title).toBe('a');
  });
});

describe('buildReport', () => {
  it('assembles a complete deterministic report', () => {
    const input = reportInput();
    const report = buildReport(input);
    expect(report.runId).toBe('run-1');
    expect(report.goal).toBe('goal');
    expect(report.outcome).toBe('SUCCESS');
    expect(report.ok).toBe(true);
    expect(report.durationMs).toBe(50);
    expect(report.timeline.length).toBe(0);
    expect(report.agents).toHaveLength(6);
    expect(report.graph).toHaveLength(2);
    expect(report.verification?.ok).toBe(true);
    expect(report.taskResults).toHaveLength(2);
  });

  it('reports duration as an absolute value', () => {
    const report = buildReport(reportInput({ startedAt: 100, finishedAt: 150 }));
    expect(report.durationMs).toBe(50);
  });

  it('clamps negative durations to zero', () => {
    const report = buildReport(reportInput({ startedAt: 100, finishedAt: 40 }));
    expect(report.durationMs).toBe(0);
  });

  it('is deterministic across invocations', () => {
    const input = reportInput();
    expect(buildReport(input)).toEqual(buildReport(input));
  });
});

describe('mergeSummary', () => {
  it('derives a summary from merge counts', () => {
    expect(mergeSummary(3, 1, 2, 1, 0)).toEqual({ files: 3, deduped: 1, merged: 2, conflicts: 1, unresolved: 0 });
  });
});