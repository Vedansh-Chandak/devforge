/**
 * @devforge/multi-agent — Role agent contract (DF-022).
 *
 * A role agent executes a single task and returns a structured result. Each
 * role wraps an injectable deterministic *backend* (the actual implementation
 * delegate). Production backends delegate to existing engines; tests inject
 * scripted backends. This keeps role behaviour deterministic and reusable.
 */

import type { AgentRole, Artifact, Task, TaskError, TaskResult } from '../types.js';
import type { AgentContext } from '../context.js';

/** Output produced by a role backend for one task. */
export interface AgentOutput {
  readonly ok: boolean;
  readonly artifacts: readonly Artifact[];
  readonly messages: readonly string[];
  readonly error?: TaskError | null;
}

/** A backend executes the actual work for a role. */
export type AgentBackend = (task: Task, ctx: AgentContext) => Promise<AgentOutput>;

/** A registered role agent. */
export interface RoleAgent {
  readonly role: AgentRole;
  run(task: Task, ctx: AgentContext): Promise<TaskResult>;
}

/** Build a TaskResult from an output + attempt bookkeeping. */
export function outputToResult(
  task: Task,
  output: AgentOutput,
  ctx: AgentContext,
  attempts: number,
  status?: TaskResult['status'],
): TaskResult {
  const ok = output.ok;
  return {
    taskId: task.id,
    role: task.role,
    kind: task.kind,
    ok,
    status: status ?? (ok ? 'SUCCEEDED' : 'FAILED'),
    artifacts: output.artifacts,
    messages: output.messages,
    attempts,
    durationMs: 0,
    error: output.error ?? null,
  };
}

/** Convenience: a successful output with artifacts. */
export function okOutput(artifacts: readonly Artifact[] = [], messages: readonly string[] = []): AgentOutput {
  return { ok: true, artifacts, messages };
}

/** Convenience: a failed output with an error. */
export function failOutput(code: string, message: string, retryable = false): AgentOutput {
  return {
    ok: false,
    artifacts: [],
    messages: [],
    error: { code, message, retryable },
  };
}
