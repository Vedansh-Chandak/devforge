/**
 * @devforge/multi-agent — Message factories (DF-022).
 *
 * Deterministic structured messages that flow through a {@link Conversation}.
 * Factories produce *drafts* without a run id or sequence index; the
 * conversation stamps `runId` and `index` atomically in post order, so
 * message ordering is always deterministic regardless of who constructs them.
 */

import type { AgentRole, Message, MessageType, TaskKind, TaskStatus } from './types.js';

/** A draft message lacking only runId and index (stamped by the conversation). */
export interface MessageDraft {
  readonly type: MessageType;
  readonly at: number;
  readonly taskId?: string;
  readonly role?: AgentRole;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly summary: string;
}

/** Assemble a full message from a draft, given runId and index. */
export function buildMessage(runId: string, index: number, draft: MessageDraft): Message {
  return {
    id: `${runId}:${index}`,
    runId,
    index,
    type: draft.type,
    at: draft.at,
    taskId: draft.taskId,
    role: draft.role,
    payload: draft.payload ?? {},
    summary: draft.summary,
  };
}

interface Base {
  readonly at: number;
}

/** Test shorthand for the canonical `kind` of a task kind. */
export function canonicalKind(
  kind: TaskKind,
): 'FILE' | 'PATCH' | 'DOC' | 'TEST' | 'PLAN' | 'NOTE' {
  switch (kind) {
    case 'IMPLEMENT':
      return 'FILE';
    case 'REPAIR':
      return 'PATCH';
    case 'DOCUMENT':
      return 'DOC';
    case 'TEST':
      return 'TEST';
    case 'PLAN':
      return 'PLAN';
    default:
      return 'NOTE';
  }
}

export function runStarted(input: Base & { readonly goal: string }): MessageDraft {
  return {
    type: 'RUN_STARTED',
    at: input.at,
    payload: { goal: input.goal },
    summary: `run started: ${input.goal}`,
  };
}

export function taskAssigned(input: Base & {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly title: string;
}): MessageDraft {
  return {
    type: 'TASK_ASSIGNED',
    at: input.at,
    taskId: input.taskId,
    role: input.role,
    payload: { title: input.title },
    summary: `assigned ${input.taskId} to ${input.role}`,
  };
}

export function taskProgress(input: Base & {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly note: string;
}): MessageDraft {
  return {
    type: 'TASK_PROGRESS',
    at: input.at,
    taskId: input.taskId,
    role: input.role,
    payload: { note: input.note },
    summary: `progress on ${input.taskId}: ${input.note}`,
  };
}

export function taskSucceeded(input: Base & {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly artifacts: number;
}): MessageDraft {
  return {
    type: 'TASK_SUCCEEDED',
    at: input.at,
    taskId: input.taskId,
    role: input.role,
    payload: { artifacts: input.artifacts },
    summary: `task ${input.taskId} succeeded`,
  };
}

export function taskFailed(input: Base & {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly code: string;
  readonly message: string;
}): MessageDraft {
  return {
    type: 'TASK_FAILED',
    at: input.at,
    taskId: input.taskId,
    role: input.role,
    payload: { code: input.code, message: input.message },
    summary: `task ${input.taskId} failed: ${input.message}`,
  };
}

export function taskSkipped(input: Base & {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly reason: string;
}): MessageDraft {
  return {
    type: 'TASK_SKIPPED',
    at: input.at,
    taskId: input.taskId,
    role: input.role,
    payload: { reason: input.reason },
    summary: `task ${input.taskId} skipped: ${input.reason}`,
  };
}

export function taskCancelled(input: Base & {
  readonly taskId: string;
  readonly role: AgentRole;
}): MessageDraft {
  return {
    type: 'TASK_CANCELLED',
    at: input.at,
    taskId: input.taskId,
    role: input.role,
    payload: {},
    summary: `task ${input.taskId} cancelled`,
  };
}

export function confirmationPending(input: Base & {
  readonly taskId: string;
  readonly role: AgentRole;
  readonly title: string;
}): MessageDraft {
  return {
    type: 'CONFIRMATION_PENDING',
    at: input.at,
    taskId: input.taskId,
    role: input.role,
    payload: { title: input.title },
    summary: `confirmation pending for ${input.taskId}`,
  };
}

export function confirmationApproved(input: Base & { readonly taskId: string }): MessageDraft {
  return {
    type: 'CONFIRMATION_APPROVED',
    at: input.at,
    taskId: input.taskId,
    payload: {},
    summary: `confirmation approved for ${input.taskId}`,
  };
}

export function confirmationRejected(input: Base & { readonly taskId: string }): MessageDraft {
  return {
    type: 'CONFIRMATION_REJECTED',
    at: input.at,
    taskId: input.taskId,
    payload: {},
    summary: `confirmation rejected for ${input.taskId}`,
  };
}

export function verificationStarted(input: Base & {
  readonly targets: readonly string[];
}): MessageDraft {
  return {
    type: 'VERIFICATION_STARTED',
    at: input.at,
    payload: { targets: input.targets },
    summary: `verification started (${input.targets.join(', ')})`,
  };
}

export function verificationPassed(input: Base & { readonly durationMs: number }): MessageDraft {
  return {
    type: 'VERIFICATION_PASSED',
    at: input.at,
    payload: { durationMs: input.durationMs },
    summary: 'verification passed',
  };
}

export function verificationFailed(input: Base & {
  readonly failedTargetId: string | null;
  readonly durationMs: number;
}): MessageDraft {
  return {
    type: 'VERIFICATION_FAILED',
    at: input.at,
    payload: { failedTargetId: input.failedTargetId, durationMs: input.durationMs },
    summary: `verification failed${input.failedTargetId ? ` at ${input.failedTargetId}` : ''}`,
  };
}

export function repairRequested(input: Base & {
  readonly target: string;
  readonly failure: string;
  readonly attempt: number;
}): MessageDraft {
  return {
    type: 'REPAIR_REQUESTED',
    at: input.at,
    payload: { target: input.target, failure: input.failure, attempt: input.attempt },
    summary: `repair requested for ${input.target}`,
  };
}

export function reviewComment(input: Base & {
  readonly taskId: string;
  readonly path: string;
  readonly blocking: boolean;
  readonly comment: string;
}): MessageDraft {
  return {
    type: 'REVIEW_COMMENT',
    at: input.at,
    taskId: input.taskId,
    role: 'REVIEWER',
    payload: { path: input.path, blocking: input.blocking, comment: input.comment },
    summary: `review comment on ${input.path}: ${input.comment}`,
  };
}

export function merged(input: Base & {
  readonly files: number;
  readonly conflicts: number;
}): MessageDraft {
  return {
    type: 'MERGED',
    at: input.at,
    payload: { files: input.files, conflicts: input.conflicts },
    summary: `merged ${input.files} file(s), ${input.conflicts} conflict(s)`,
  };
}

export function conflict(input: Base & {
  readonly path: string;
  readonly taskIds: readonly string[];
}): MessageDraft {
  return {
    type: 'CONFLICT',
    at: input.at,
    payload: { path: input.path, taskIds: input.taskIds },
    summary: `merge conflict on ${input.path}`,
  };
}

export function runCompleted(input: Base & {
  readonly outcome: string;
  readonly ok: boolean;
}): MessageDraft {
  return {
    type: 'RUN_COMPLETED',
    at: input.at,
    payload: { outcome: input.outcome, ok: input.ok },
    summary: `run completed with outcome ${input.outcome}`,
  };
}

export function runCancelled(input: Base): MessageDraft {
  return {
    type: 'RUN_CANCELLED',
    at: input.at,
    payload: {},
    summary: 'run cancelled',
  };
}

export function runTimedOut(input: Base): MessageDraft {
  return {
    type: 'RUN_TIMED_OUT',
    at: input.at,
    payload: {},
    summary: 'run timed out',
  };
}

/** Map a {@link TaskStatus} to the message type used to report it. */
export function statusMessageType(status: TaskStatus): MessageType | null {
  switch (status) {
    case 'SUCCEEDED':
      return 'TASK_SUCCEEDED';
    case 'FAILED':
      return 'TASK_FAILED';
    case 'SKIPPED':
      return 'TASK_SKIPPED';
    case 'CANCELLED':
      return 'TASK_CANCELLED';
    default:
      return null;
  }
}
