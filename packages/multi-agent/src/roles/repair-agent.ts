/**
 * @devforge/multi-agent — Repair agent (DF-022).
 *
 * Repairs failures (verification failures, review blocks). The default
 * backend produces a deterministic repair patch for the reported target.
 */

import type { AgentContext } from '../context.js';
import type { Artifact, Task, TaskError } from '../types.js';
import type { AgentBackend, AgentOutput, RoleAgent } from './agent.js';
import { okOutput } from './agent.js';

/** Default backend: produce a deterministic repair patch. */
export async function defaultRepairBackend(task: Task): Promise<AgentOutput> {
  const path = task.target ?? `src/${slug(task.title)}.ts`;
  const artifact: Artifact = {
    path,
    kind: 'PATCH',
    content: `/* repair for ${task.id} */\n// fixed after failure\n`,
    id: `${task.id}:repair`,
    hunks: [{ startLine: 1, lineCount: 2 }],
  };
  return okOutput(
    [artifact],
    [`applied repair for ${task.id}`],
  );
}

/** A repair task previously failed — expose as an error so retry/handling can proceed. */
export function repairError(reason: string): TaskError {
  return { code: 'MA_REPAIR_FAILED', message: reason, retryable: false };
}

/** Slugify a title (shared). */
export function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'repair';
}

/** Create a repair agent around an optional backend. */
export function createRepairAgent(backend?: AgentBackend): RoleAgent {
  const impl = backend ?? defaultRepairBackend;
  return {
    role: 'REPAIR',
    async run(task: Task, ctx: AgentContext) {
      const output = await impl(task, ctx);
      return {
        taskId: task.id,
        role: task.role,
        kind: task.kind,
        ok: output.ok,
        status: output.ok ? 'SUCCEEDED' : 'FAILED',
        artifacts: output.artifacts,
        messages: output.messages,
        attempts: 1,
        durationMs: 0,
        error: output.error ?? null,
      };
    },
  };
}
