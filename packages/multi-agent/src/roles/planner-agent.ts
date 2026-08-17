/**
 * @devforge/multi-agent — Planner agent (DF-022).
 *
 * Creates execution plans. Reuses the existing planner (`parseRequest` +
 * `buildDeterministicPlan`) to derive a validated plan artifact when no
 * custom backend is supplied.
 */

import type { AgentContext } from '../context.js';
import type { Artifact, Task } from '../types.js';
import type { AgentBackend, AgentOutput, RoleAgent } from './agent.js';
import { okOutput } from './agent.js';
import { buildPlanFor } from '../selection/task-decomposer.js';

/** Default backend: reuse the planner to produce a PLAN artifact. */
export async function defaultPlannerBackend(task: Task): Promise<AgentOutput> {
  const plan = buildPlanFor(task.description || task.title);
  const artifact: Artifact = {
    path: `plan/${task.id}.json`,
    kind: 'PLAN',
    content: summarizePlan(plan.summary, plan.steps.length),
    id: `${task.id}:plan`,
  };
  return okOutput([artifact], [`plan for ${task.id}: ${plan.summary}`]);
}

function summarizePlan(summary: string, steps: number): string {
  return `# Plan\n\nsummary: ${summary}\nsteps: ${steps}`;
}

/** Create a planner agent around an optional backend. */
export function createPlannerAgent(backend?: AgentBackend): RoleAgent {
  const impl = backend ?? defaultPlannerBackend;
  return {
    role: 'PLANNER',
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
