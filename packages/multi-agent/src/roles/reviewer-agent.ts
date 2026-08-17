/**
 * @devforge/multi-agent — Reviewer agent (DF-022).
 *
 * Reviews the architecture/quality of produced artifacts and emits
 * deterministic review comments into the conversation. The default backend
 * inspects artifacts for obvious markers and returns blocking/non-blocking
 * comments plus a REVIEW artifact.
 */

import type { AgentContext } from '../context.js';
import type { Artifact, Task } from '../types.js';
import type { AgentBackend, AgentOutput, RoleAgent } from './agent.js';
import { okOutput, failOutput } from './agent.js';
import { reviewComment } from '../message.js';

/** A structurally sound review comment. */
export interface ReviewNote {
  readonly path: string;
  readonly line: number;
  readonly blocking: boolean;
  readonly comment: string;
}

/** Default review logic — deterministic heuristics over the artifact store. */
export function reviewArtifacts(artifacts: readonly Artifact[]): ReviewNote[] {
  const notes: ReviewNote[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== 'FILE' && artifact.kind !== 'TEST') continue;
    const lines = artifact.content.split('\n');
    const todoCount = artifact.content.split('TODO').length - 1;
    if (todoCount > 0) {
      notes.push({
        path: artifact.path,
        line: 1,
        blocking: todoCount > 2,
        comment: `${todoCount} TODO marker(s) present; resolve before merge`,
      });
    }
    if (!lines.some((line) => /export\s+(function|const|class)/.test(line))) {
      notes.push({
        path: artifact.path,
        line: 1,
        blocking: true,
        comment: 'no exported symbol detected',
      });
    }
  }
  return notes;
}

/** Default backend: review current artifacts in the shared store. */
export async function defaultReviewerBackend(task: Task, ctx: AgentContext): Promise<AgentOutput> {
  const targets = task.target ? [task.target] : ctx.artifacts.all().map((a) => a.path);
  const reviewed = ctx.artifacts.all().filter((a) => targets.includes(a.path));
  const notes = reviewArtifacts(reviewed);

  const comments: string[] = [];
  const artifacts: Artifact[] = [];
  for (const note of notes) {
    comments.push(`[${note.blocking ? 'BLOCK' : 'warn'}] ${note.path}: ${note.comment}`);
    ctx.conversation.post(
      reviewComment({
        at: ctx.now(),
        taskId: task.id,
        path: note.path,
        blocking: note.blocking,
        comment: note.comment,
      }),
    );
  }

  const blockingCount = notes.filter((n) => n.blocking).length;
  artifacts.push({
    path: `review/${task.id}.md`,
    kind: 'NOTE',
    content: `# Review\n\ncomments: ${notes.length}\nblocking: ${blockingCount}`,
    id: `${task.id}:review`,
  });

  if (blockingCount > 0) {
    return failOutput('MA_REVIEW_BLOCKING', `${blockingCount} blocking review comment(s)`, true);
  }
  return okOutput(artifacts, comments.length > 0 ? comments : [`reviewed ${reviewed.length} artifact(s)`]);
}

/** Create a reviewer agent around an optional backend. */
export function createReviewerAgent(backend?: AgentBackend): RoleAgent {
  const impl = backend ?? defaultReviewerBackend;
  return {
    role: 'REVIEWER',
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
