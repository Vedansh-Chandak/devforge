/**
 * @devforge/multi-agent — Collaborative multi-agent platform (DF-022).
 *
 * Turns DevForge into a team of role agents (Planner, Coder, Reviewer,
 * Tester, Repair, Documentation) coordinated over a deterministic schedule
 * and shared structured conversation. Existing engines (Planner, Executor)
 * are reused; this package adds orchestration only.
 */

// Shared vocabulary
export type {
  AgentRole,
  TaskKind,
  TaskStatus,
  ArtifactKind,
  Artifact,
  PatchRange,
  Task,
  TaskResult,
  TaskError,
  Schedule,
  ScheduleBatch,
  RunOutcome,
  RunResult,
  MessageType,
  Message,
  TimelineEntry,
  AgentMetrics,
  ExecutionGraphNode,
  RepairSummary,
  ReviewSummary,
  MergeSummary,
  VerificationSummary,
  FinalReport,
} from './types.js';
export {
  AGENT_ROLES,
  TASK_KINDS,
  TASK_STATUSES,
  ARTIFACT_KINDS,
  MESSAGE_TYPES,
  rolePriority,
} from './types.js';

// Errors
export {
  MULTI_AGENT_ERROR_CODES,
  MultiAgentError,
  MultiAgentDecompositionError,
  MultiAgentValidationError,
  MultiAgentCycleError,
  MultiAgentDuplicateError,
  MultiAgentMissingDependencyError,
  MultiAgentSchedulingError,
  MultiAgentExecutionError,
  MultiAgentRoleUnavailableError,
  MultiAgentMergeConflictError,
  MultiAgentMergeViolationError,
  MultiAgentVerificationError,
  MultiAgentCancellationError,
  MultiAgentTimeoutError,
  MultiAgentConfirmationError,
  MultiAgentInternalError,
  isMultiAgentError,
} from './errors.js';
export type { MultiAgentErrorCode } from './errors.js';

// Conversation + messages
export { Conversation } from './conversation.js';
export type { ConversationListener, ConversationOptions } from './conversation.js';
export { buildMessage } from './message.js';
export {
  runStarted,
  taskAssigned,
  taskProgress,
  taskSucceeded,
  taskFailed,
  taskSkipped,
  taskCancelled,
  confirmationPending,
  confirmationApproved,
  confirmationRejected,
  verificationStarted,
  verificationPassed,
  verificationFailed,
  repairRequested,
  reviewComment,
  merged,
  conflict,
  runCompleted,
  runCancelled,
  runTimedOut,
  statusMessageType,
  canonicalKind,
} from './message.js';
export type { MessageDraft } from './message.js';

// Context
export { ArtifactStore, createContext, isAborted } from './context.js';
export type { AgentContext, AgentContextOptions } from './context.js';

// Agent pool
export { AgentPool } from './agent-pool.js';

// Role agents
export type { RoleAgent, AgentBackend, AgentOutput } from './roles/agent.js';
export { okOutput, failOutput, outputToResult } from './roles/agent.js';
export { createPlannerAgent, defaultPlannerBackend } from './roles/planner-agent.js';
export {
  ROLE_MODEL_MAP,
  modelRoleFor,
  resolveModelRolesFor,
  resolveConfiguredModelRole,
} from './roles/model-roles.js';
export type { AgentRoleModelMapping, ModelRouterLike } from './roles/model-roles.js';
export { createCoderAgent, defaultCoderBackend, slug, fnName } from './roles/coder-agent.js';
export {
  createReviewerAgent,
  defaultReviewerBackend,
  reviewArtifacts,
  type ReviewNote,
} from './roles/reviewer-agent.js';
export { createTesterAgent, defaultTesterBackend, testPathFor } from './roles/tester-agent.js';
export { createRepairAgent, defaultRepairBackend, repairError } from './roles/repair-agent.js';
export {
  createDocumentationAgent,
  defaultDocsBackend,
  docSlug,
} from './roles/documentation-agent.js';

// Selection
export { decomposeRequest, titleToPath, titleCase, toTask } from './selection/task-decomposer.js';
export type { DecomposedTask, DecomposeOptions } from './selection/task-decomposer.js';
export { roleForKind, kindForRole, dependentRoles, routeTask, routeTasks } from './selection/task-router.js';
export {
  edges,
  detectDuplicates,
  detectMissingDependencies,
  detectCycles,
  topologicalOrder,
  validateGraph,
} from './selection/dependency-graph.js';
export type { GraphValidation } from './selection/dependency-graph.js';

// Scheduling + parallel execution
export { Scheduler, buildSchedule, statusMessageOf } from './scheduler.js';
export type { SchedulerOptions, ScheduleOutcome, TaskAttemptRunner } from './scheduler.js';
export { ParallelRunner } from './execution/parallel-runner.js';
export type { ParallelRunnerOptions } from './execution/parallel-runner.js';

// Merge + conflicts
export { MergeManager, mergeResults, mergeableArtifacts } from './execution/merge-manager.js';
export type { MergeManagerOptions, MergeOutcome, MergeConflict } from './execution/merge-manager.js';
export {
  ConflictResolver,
  resolvePath,
  rangesOverlap,
  patchesOverlap,
  defaultStrategy,
  CONFLICT_STRATEGIES,
} from './execution/conflict-resolver.js';
export type { ConflictStrategy, Contribution, Resolution, ConflictResolverOptions } from './execution/conflict-resolver.js';

// Verification (reuses the executor)
export { ExecutorVerifier, fixedVerifier, toSummary } from './execution/verification.js';
export type { Verifier, VerifyOptions } from './execution/verification.js';

// Reporting
export { buildReport, buildTimeline, agentMetrics, graphNodes, mergeSummary } from './execution/report.js';
export type { ReportInput } from './execution/report.js';

// Coordinator
export { Coordinator, COORDINATOR_DEFAULTS } from './coordinator.js';
export type {
  CoordinatorConfig,
  CoordinatorDeps,
  RunOptions,
  ConfirmationMode,
} from './coordinator.js';