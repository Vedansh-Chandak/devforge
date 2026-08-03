/**
 * @devforge/execution — Executor subsystem (DF-016A + DF-016B).
 *
 * A deterministic orchestration engine that executes planner ExecutionPlans
 * by coordinating the Workspace, CommandRunner, and GitService subsystems.
 *
 * DF-016B adds autonomous coding: patch generation, validation, repair loops,
 * and workspace transaction integration with deterministic budgets and events.
 */

// Engine
export { createExecutor, ExecutorEngine } from './executor.js';

// State machine
export {
  StateMachine,
  EXECUTOR_STATES,
  EXECUTOR_STATE_NAMES,
  CANCELLABLE_STATES,
  TERMINAL_STATES,
  CONFIRMATION_STATES,
  isExecutorState,
} from './state-machine.js';

// Scheduler
export { buildSchedule, isTopologicalOrder } from './scheduler.js';
export type { Schedule } from './scheduler.js';

// Events
export {
  EXECUTION_EVENT_TYPES,
  EXECUTION_EVENT_TYPE_VALUES,
  STEP_EVENT_TYPES,
} from './events.js';
export type {
  ExecutionEventType,
  ExecutionEvent,
  ExecutionEventInput,
  ExecutionStartedEvent,
  PlanValidatedEvent,
  StepStartedEvent,
  StepCompletedEvent,
  StepFailedEvent,
  VerificationStartedEvent,
  VerificationPassedEvent,
  VerificationFailedEvent,
  ExecutionPausedEvent,
  ExecutionCancelledEvent,
  ExecutionCompletedEvent,
  ExecutionFailedEvent,
} from './events.js';

// Verification
export {
  runVerification,
  typecheckTarget,
  defaultVerificationTargets,
} from './verification.js';
export type { RunVerificationOptions } from './verification.js';

// Report
export {
  buildExecutionReport,
  makeRollbackToken,
  tokenizeRollback,
  collateRollbackRecords,
} from './report.js';
export type { ReportInput } from './report.js';

// Errors
export {
  ExecutorError,
  ExecutorValidationError,
  ExecutorSchedulingError,
  ExecutorExecutionError,
  ExecutorVerificationError,
  ExecutorCancellationError,
  EXECUTOR_ERROR_CODES,
} from './errors.js';
export type { ExecutorErrorCode, ExecutorErrorOptions } from './errors.js';

// Types
export type {
  Executor,
  ExecutorConfig,
  ExecuteOptions,
  ExecutionStatus,
  ExecutorStateName,
  CommandSpec,
  VerificationTarget,
  VerificationOutcome,
  VerificationResult,
  RollbackKind,
  RollbackCapable,
  RollbackRecord,
  StepResult,
  StepContext,
  StepHandler,
  StepError,
  StepExecutionRecord,
  ReportError,
  ExecutionReport,
} from './types.js';

// DF-016B: Autonomous Coding Layer
// Patch model
export type {
  CodePatch,
  CodePatchOperation,
  NormalizedPatch,
  PatchValidationConfig,
  PatchViolation,
  PatchStructureValidationResult,
  CodingBudgets,
} from './patch-model.js';
export { CODING_BUDGETS, hashText, hashTextSHA256, defaultPatchValidationConfig } from './patch-model.js';

// Coding errors
export {
  CODING_ERROR_CODES,
  CodingError,
  PatchValidationError,
  RepairBudgetExceededError,
  PatchGenerationError,
  DiagnosticsError,
  ReasoningError,
  CodingModelError,
} from './coding-errors.js';
export type { CodingErrorCode, CodingErrorOptions } from './coding-errors.js';

// Coding model
export type {
  CodingModel,
  CodingModelRequest,
  ScriptedCodingModel,
} from './coding-model.js';
export {
  scriptedCodingModel,
  fixedCodingModel,
  failingCodingModel,
  cancellingCodingModel,
  customCodingModel,
} from './coding-model.js';

// Reasoning model
export type {
  ReasoningModel,
  FailureAnalysis,
  RepairDecision,
  FailureAnalysisInput,
  RepairDecisionInput,
  ScriptedReasoningModel,
} from './reasoning-model.js';
export {
  scriptedReasoningModel,
  fixedReasoningModel,
  failingReasoningModel,
  cancellingReasoningModel,
  customReasoningModel,
  defaultAnalysis,
  defaultDecision,
} from './reasoning-model.js';

// Patch validator
export {
  validatePatchStructureBatch,
  validatePatchesWorkspace,
  validatePatchesFull,
} from './patch-validator.js';

// Patch engine
export type {
  PatchEngine,
  PatchGenerationRequest,
  PatchGenerationResult,
  PatchEngineConfig,
  PatchEngineValidationConfig,
} from './patch-engine.js';
export {
  DefaultPatchEngine,
  createPatchEngine,
  fixedPatchEngine,
  failingPatchEngine,
  countingPatchEngine,
} from './patch-engine.js';

// Diagnostics
export {
  captureDiagnostics,
  captureCommandDiagnostics,
} from './diagnostics.js';
export type {
  Diagnostic,
  DiagnosticSeverity,
  Diagnostics,
  DiagnosticsConfig,
} from './diagnostics.js';

// Repair engine
export {
  AutonomousCodingEngine,
  createCodingEngine,
} from './repair.js';
export type {
  CodingEngineConfig,
  CodingReport,
  TransactionRecord,
} from './repair.js';

// Coding events
export {
  CodingEventBus,
  CODING_EVENT_TYPES,
  CODING_EVENT_TYPE_VALUES,
} from './coding-events.js';
export type {
  CodingEventType,
  CodingEvent,
  CodingEventInput,
  PatchGenerationStartedEvent,
  PatchGeneratedEvent,
  PatchValidationFailedEvent,
  WorkspaceTransactionStartedEvent,
  WorkspaceTransactionCommittedEvent,
  WorkspaceTransactionRolledBackEvent,
  RepairStartedEvent,
  RepairAttemptEvent,
  RepairSucceededEvent,
  RepairFailedEvent,
  DiagnosticsCapturedEvent,
  CodingVerificationStartedEvent,
  CodingVerificationPassedEvent,
  CodingVerificationFailedEvent,
  CodingCancelledEvent,
  DiagnosticCategory,
} from './coding-events.js';
