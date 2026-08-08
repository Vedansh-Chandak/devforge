import type { AgentResult } from '../types.js';

/** Build a minimal terminal agent result for task-manager tests. */
export function terminalResult(reason: AgentResult['terminationReason']): AgentResult {
  const outcome =
    reason === 'VERIFICATION_PASSED'
      ? 'SUCCESS'
      : reason === 'USER_CANCELLED'
        ? 'CANCELLED'
        : 'FAILED';
  return {
    outcome,
    goal: 'g',
    status: 'COMPLETED',
    terminationIndex: 1,
    terminationReason: reason,
    terminationMessage: 'done',
    attempts: [],
    verifications: [],
    patchesGenerated: 0,
    repairAttempts: 0,
    rollbacks: 0,
    tokens: 0,
    durationMs: 1,
    startedAt: 0,
    finishedAt: 1,
    plan: null,
    confidenceGatePassed: true,
    error: null,
  };
}