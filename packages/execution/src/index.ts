/**
 * @devforge/execution — Execution subsystem entry point.
 *
 * Implements the Workspace subsystem (DF-013 Phase 1): sandboxed file
 * operations, deferred transactions with automatic rollback, deterministic
 * validation, in-memory backups, and a dependency-free line diff.
 *
 * Implements command execution (DF-014) and git integration (DF-015). The
 * executor (DF-016) is exported as a placeholder so later phases can import
 * stable symbols.
 */

// Workspace subsystem
export { Workspace, WorkspaceTransaction } from './workspace/index.js';
export {
  BackupStore,
  createSnapshot,
  restoreSnapshot,
  validatePath,
  validateContent,
  validateSymlinkEscape,
  validateWorkspaceRoot,
  generateTextDiff,
  renderDiff,
  PATH_VALIDATION_CODES,
  CONTENT_VALIDATION_CODES,
  MAX_DIFF_CELLS,
} from './workspace/index.js';
export type {
  BackupSnapshot,
  BackupEntry,
  SymlinkEscapeResult,
  TextDiff,
  DiffHunk,
  DiffLine,
  DiffLineKind,
} from './workspace/index.js';

// Shared types
export type {
  WorkspacePath,
  FileContent,
  FileInfo,
  WorkspaceOptions,
  TransactionStatus,
  TransactionOperation,
  AppliedOperation,
  TransactionResult,
  PathValidation,
  ContentValidation,
} from './types.js';
export { DEFAULT_MAX_FILE_SIZE } from './types.js';

// Errors
export {
  WorkspaceError,
  WorkspaceValidationError,
  WorkspacePermissionError,
  WorkspaceConflictError,
  WorkspaceTransactionError,
  WORKSPACE_ERROR_CODES,
} from './errors.js';
export type { WorkspaceErrorCode, WorkspaceErrorOptions } from './errors.js';

// Command Runner (DF-014)
export {
  createCommandRunner,
  validateCommand,
  createSandbox,
  buildEnvironment,
  buildEnvironmentFromProcess,
  type CommandRunnerConfig,
  type CommandValidation,
  type SandboxValidation,
  type SandboxConfig,
  type EnvironmentMap,
  type BuildEnvironmentInput,
} from './command/index.js';
export type {
  Command,
  CommandRequest,
  CommandResult,
  CommandRunner,
} from './command/index.js';
export {
  ALLOWED_COMMANDS,
  ALLOWLIST_ENV_VARS,
  CommandError,
  CommandValidationError,
  CommandSandboxError,
  CommandTimeoutError,
  CommandCancellationError,
  CommandExecutionError,
  COMMAND_ERROR_CODES,
} from './command/index.js';
export type { CommandErrorCode, CommandErrorOptions } from './command/index.js';
export {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  MAX_MAX_OUTPUT_BYTES,
} from './command/index.js';

// Git subsystem (DF-015)
export { createGitService, GitServiceImpl } from './git/index.js';
export type {
  GitService,
  GitServiceConfig,
  GitRepositoryDetection,
} from './git/index.js';
export type {
  GitStatus,
  GitFileStatus,
  GitFileStatusKind,
  GitDiff,
  GitDiffFile,
  GitDiffFileStatus,
  GitDiffHunk,
  GitDiffLine,
  GitDiffLineKind,
  GitBranch,
  GitCommit,
  GitRepositoryInfo,
} from './git/index.js';
export {
  DEFAULT_MAX_COMMIT_MESSAGE_LENGTH,
  DEFAULT_MAX_COMMIT_LINES,
} from './git/index.js';
export {
  GitError,
  GitValidationError,
  GitRepositoryError,
  GitCommandError,
  GitParseError,
  GIT_ERROR_CODES,
} from './git/index.js';
export type { GitErrorCode, GitErrorOptions } from './git/index.js';
export {
  validateRepoRoot,
  validateGitPaths,
  validateCommitMessage,
  parseGitStatus,
  parseGitDiff,
  renderUnifiedDiff,
  parseGitBranches,
  parseCurrentBranch,
  parseHead,
  parseRepositoryDetection,
} from './git/index.js';
export type {
  RepoRootValidation,
  GitPathsValidation,
  GitCommitLimits,
  CommitMessageValidation,
} from './git/index.js';

// Executor subsystem (DF-016A)
export {
  createExecutor,
  ExecutorEngine,
  StateMachine,
  EXECUTOR_STATES,
  EXECUTOR_STATE_NAMES,
  CANCELLABLE_STATES,
  TERMINAL_STATES,
  CONFIRMATION_STATES,
  isExecutorState,
  buildSchedule,
  isTopologicalOrder,
  EXECUTION_EVENT_TYPES,
  EXECUTION_EVENT_TYPE_VALUES,
  STEP_EVENT_TYPES,
  runVerification,
  typecheckTarget,
  defaultVerificationTargets,
  buildExecutionReport,
  makeRollbackToken,
  tokenizeRollback,
  collateRollbackRecords,
  ExecutorError,
  ExecutorValidationError,
  ExecutorSchedulingError,
  ExecutorExecutionError,
  ExecutorVerificationError,
  ExecutorCancellationError,
  EXECUTOR_ERROR_CODES,
} from './executor/index.js';
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
  Schedule,
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
  ReportInput,
  RunVerificationOptions,
  ExecutorErrorCode,
  ExecutorErrorOptions,
} from './executor/index.js';

// Model Integration (DF-016C)
export {
  ProviderCodingModel,
  ProviderReasoningModel,
  ModelIntegrationError,
  PromptError,
  ParseError,
  PatchParseError,
  ReasoningParseError,
  ProviderError,
  CancellationError,
  isProviderError,
  isParseError,
  isCancellationError,
  OUTPUT_TAGS,
  buildPatchSystemPrompt,
  buildPatchUserPrompt,
  buildPatchPrompt,
  buildFailureAnalysisSystemPrompt,
  buildFailureAnalysisUserPrompt,
  buildFailureAnalysisPrompt,
  buildRepairDecisionSystemPrompt,
  buildRepairDecisionUserPrompt,
  buildRepairDecisionPrompt,
  buildDocumentationSystemPrompt,
  buildDocumentationUserPrompt,
  buildDocumentationPrompt,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildReviewPrompt,
  buildModelRequest,
  parsePatches,
  parseFailureAnalysis,
  parseRepairDecision,
} from './models/index.js';
export type {
  ModelSettings,
  ProviderModelOptions,
  ProviderCodingModelOptions,
  ProviderReasoningModelOptions,
  ReasoningResult,
  ParseResult,
  ParseFailure,
  ParseErrorCode,
  IntegrationErrorOptions,
  ParseFailureOptions,
  ModelProvider,
  ModelMessage,
  ModelRequest,
  ModelResponse,
} from './models/index.js';
