/**
 * @devforge/multi-agent — Tester agent (DF-022).
 *
 * Creates tests for produced artifacts. The default backend derives a test
 * artifact from the coder's implementation, keeping output deterministic.
 */

import type { AgentContext } from '../context.js';
import type { Artifact, Task } from '../types.js';
import type { AgentBackend, AgentOutput, RoleAgent } from './agent.js';
import { okOutput } from './agent.js';

/** Default backend: produce a test file for the target path. */
export async function defaultTesterBackend(task: Task): Promise<AgentOutput> {
  const path = testPathFor(task.target ?? `src/${slug(task.title)}.ts`);
  const artifact: Artifact = {
    path,
    kind: 'TEST',
    content: `// tests for ${task.id}\nimport { describe, it, expect } from 'vitest';\n\ndescribe('${task.title}', () => {\n  it('behaves', () => {\n    expect(true).toBe(true);\n  });\n});\n`,
    id: `${task.id}:test`,
  };
  return okOutput([artifact], [`wrote tests to ${path} for ${task.id}`]);
}

/** Map a source path to its test path. */
export function testPathFor(path: string): string {
  return path.replace(/\.ts$/, '.test.ts').replace(/^src\//, 'tests/');
}

/** Slugify a title (shared with coder). */
export function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'code';
}

/** Create a tester agent around an optional backend. */
export function createTesterAgent(backend?: AgentBackend): RoleAgent {
  const impl = backend ?? defaultTesterBackend;
  return {
    role: 'TESTER',
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
