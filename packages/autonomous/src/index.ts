/**
 * @devforge/autonomous — Autonomous coding agent (DF-019).
 *
 * Turns DevForge into a self-improving software engineering agent that plans,
 * generates patches, applies them, verifies, repairs, and retries until success
 * or a configurable stop condition.
 */

// Agent orchestrator
export { AutonomousAgent } from './agent.js';
export type {
  AgentEnvironment,
  AutonomousAgentConfig,
} from './agent.js';

// Repair loop
export { RepairLoop } from './repair-loop.js';
export type {
  RepairOutcome,
  RepairLoopOptions,
  ApplyPatchesFn,
} from './repair-loop.js';

// Patch selection
export { DeterministicPatchSelector, selectBestPatch, selectionConfidence, selectedFiles } from './patch-selector.js';
export type {
  PatchSelector,
  PatchSelectionResult,
  ScoredPatch,
  SelectedPatch,
  SelectorOptions,
} from './patch-selector.js';

// Verification loop
export { VerificationLoop, TIMEOUT_ABORT_REASON } from './verification-loop.js';
export type {
  VerificationLoopConfig,
  VerificationRun,
} from './verification-loop.js';

// Task manager
export { TaskManager } from './task-manager.js';
export type {
  TaskSpec,
  TaskRunner,
  TaskOutcome,
  TaskManagerOptions,
} from './task-manager.js';

// Attempt history
export {
  AttemptHistory,
  fingerprintPatches,
  patchSummary,
  estimatePatchTokens,
  diffAttempts,
  FINGERPRINT_PREFIX,
} from './attempt-history.js';

// Confidence engine
export {
  DeterministicConfidenceEvaluator,
  deterministicConfidence,
  fixedConfidence,
  DefaultConfidenceGate,
  confidenceGate,
  clearsThreshold,
  maxConfidence,
  riskOf,
  compareRisk,
  RISK_ORDER,
} from './confidence.js';
export type {
  ConfidenceContext,
  ConfidenceEvaluator,
  ConfidenceGate,
  ConfidenceGateDecision,
} from './confidence.js';

// Rollback
export { RollbackManager } from './rollback.js';
export type {
  RollbackToken,
  RollbackHooks,
  RestoreFn,
} from './rollback.js';

// Termination
export { TerminationController } from './termination.js';
export type {
  TerminationState,
  TerminationDecision,
  TerminationRules,
} from './termination.js';

// Errors
export {
  AUTONOMOUS_ERROR_CODES,
  AutonomousError,
  AutonomousValidationError,
  AutonomousCancellationError,
  AutonomousTimeoutError,
  AutonomousConfidenceError,
  AutonomousDuplicateError,
  AutonomousMaxAttemptsError,
  AutonomousRollbackError,
  AutonomousPatchError,
  AutonomousPlanningError,
} from './errors.js';
export type {
  AutonomousErrorCode,
  AutonomousErrorOptions,
} from './errors.js';

// Types
export {
  AUTONOMOUS_DEFAULTS,
} from './types.js';
export type {
  AgentStatus,
  AgentOutcome,
  AgentEvent,
  AgentResult,
  AttemptRecord,
  ConfidenceScore,
  ContextProvider,
  ContextRequest,
  RiskLevel,
  TerminationReason,
  VerificationSnapshot,
  AutonomousBudgets,
} from './types.js';