/**
 * @devforge/multi-agent — Documentation agent (DF-022).
 *
 * Updates documentation. The default backend produces a deterministic DOC
 * artifact describing the task.
 */

import type { AgentContext } from '../context.js';
import type { Artifact, Task } from '../types.js';
import type { AgentBackend, AgentOutput, RoleAgent } from './agent.js';
import { okOutput } from './agent.js';

/** Default backend: produce a documentation artifact. */
export async function defaultDocsBackend(task: Task): Promise<AgentOutput> {
  const path = task.target ?? `docs/${docSlug(task.title)}.md`;
  const artifact: Artifact = {
    path,
    kind: 'DOC',
    content: `# ${title(task.title)}\n\nDocumentation for task ${task.id}.\n\n- derived from: ${task.description}\n`,
    id: `${task.id}:doc`,
  };
  return okOutput([artifact], [`updated documentation ${path} for ${task.id}`]);
}

/** Slugify a title (shared). */
export function docSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'doc';
}

/** Sentence-cased display title. */
export function title(phrase: string): string {
  const cleaned = phrase.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return 'Documentation';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Create a documentation agent around an optional backend. */
export function createDocumentationAgent(backend?: AgentBackend): RoleAgent {
  const impl = backend ?? defaultDocsBackend;
  return {
    role: 'DOCUMENTATION',
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
