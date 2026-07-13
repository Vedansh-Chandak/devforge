# Execution Engine Architecture Design

**Story ID**: DF-009.2
**Status**: DESIGN REVIEW
**Version**: 1.0
**Date**: 2026-07-13

---

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXECUTION ENGINE                                    │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────┐
    │  ExecutionPlan  │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                      PLAN VALIDATOR                                  │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │ Schema      │  │ Dependency  │  │ Tool        │  │ Resource  │  │
    │  │ Validation  │  │ Check       │  │ Availability│  │ Estimates │  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    EXECUTION SCHEDULER                               │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  DAG        │  │  Topological│  │  Parallel   │  │  Resource │  │
    │  │  Builder    │  │  Sort       │  │  Grouping   │  │  Pool     │  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    TOOL REGISTRY                                     │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  Tool       │  │  Schema     │  │  Permission │  │  Metrics  │  │
    │  │  Catalog    │  │  Validator  │  │  Gate       │  │  Collector│  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    EXECUTION STATE MACHINE                           │
    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
    │  │ PENDING  │─▶│ RUNNING  │─▶│ COMPLETED│  │  FAILED  │           │
    │  └──────────┘  └────┬─────┘  └──────────┘  └────┬─────┘           │
    │                     │                           │                   │
    │                     ▼                           ▼                   │
    │              ┌──────────┐                ┌──────────┐              │
    │              │  RETRY   │                │CANCELLED │              │
    │              └──────────┘                └──────────┘              │
    └─────────────────────────────────────────────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    TOOL EXECUTOR                                     │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  Invoker    │  │  Timeout    │  │  Side Effect│  │  Result   │  │
    │  │  (sync/async)│  │  Guard      │  │  Tracker    │  │  Normalizer│  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    EXECUTION CONTEXT                                 │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  Step       │  │  Variable   │  │  Artifact   │  │  Event    │  │
    │  │  Results    │  │  Store      │  │  Store      │  │  Log      │  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
             │
             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    REPLAY ENGINE                                     │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  Trace      │  │  Deterministic│  │  Snapshot   │  │  Diff     │  │
    │  │  Recorder   │  │  Replay       │  │  Restore    │  │  Comparator│  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Types

### 2.1 ExecutionPlan

```typescript
// src/execution-engine/types/plan.ts

export interface ExecutionPlan {
  /** Unique plan identifier */
  id: PlanId;

  /** Human-readable plan name */
  name: string;

  /** Plan version for schema evolution */
  version: number;

  /** Ordered steps to execute */
  steps: PlanStep[];

  /** Global plan metadata */
  metadata: PlanMetadata;

  /** Resource requirements for the entire plan */
  resources: ResourceRequirements;

  /** Plan-level timeout (ms) */
  timeoutMs: number;

  /** Retry policy for the entire plan */
  retryPolicy?: RetryPolicy;

  /** Variables available to all steps */
  variables: VariableMap;

  /** Artifacts expected from this plan */
  expectedArtifacts: ArtifactSpec[];
}

export interface PlanStep {
  /** Unique step identifier within the plan */
  id: StepId;

  /** Human-readable step name */
  name: string;

  /** Tool to invoke */
  tool: ToolRef;

  /** Input parameters (can reference variables/artifacts) */
  input: StepInput;

  /** Output mapping to variables/artifacts */
  output: StepOutput;

  /** Step dependencies (must complete before this step) */
  dependsOn: StepId[];

  /** Step-level timeout (ms), overrides plan timeout */
  timeoutMs?: number;

  /** Step-level retry policy, overrides plan retry policy */
  retryPolicy?: RetryPolicy;

  /** Whether this step can run in parallel with independent steps */
  parallelizable: boolean;

  /** Condition to evaluate before execution (optional) */
  condition?: ConditionExpression;

  /** Step metadata */
  metadata: StepMetadata;
}

export interface ToolRef {
  /** Tool namespace (e.g., "filesystem", "git", "shell") */
  namespace: string;

  /** Tool name within namespace (e.g., "read", "write", "exec") */
  name: string;

  /** Tool version (semver) */
  version: string;
}

export interface StepInput {
  /** Static parameters */
  params: Record<string, JsonValue>;

  /** References to variables from previous steps: ${variables.varName} */
  variableRefs: string[];

  /** References to artifacts from previous steps: ${artifacts.artifactId} */
  artifactRefs: string[];
}

export interface StepOutput {
  /** Map tool output fields to variable names */
  variables: Record<string, string>;  // outputField -> variableName

  /** Map tool output fields to artifact IDs */
  artifacts: Record<string, string>;  // outputField -> artifactId

  /** Whether to capture stdout/stderr as artifacts */
  captureOutput: boolean;
}
```

### 2.2 Tool Abstraction

```typescript
// src/execution-engine/types/tool.ts

export interface Tool {
  /** Tool metadata */
  readonly metadata: ToolMetadata;

  /** JSON Schema for input validation */
  readonly inputSchema: JSONSchema;

  /** JSON Schema for output validation */
  readonly outputSchema: JSONSchema;

  /** Execute the tool */
  execute(input: ToolInput, context: ExecutionContext): Promise<ToolResult>;

  /** Validate input without executing */
  validateInput(input: ToolInput): ValidationResult;

  /** Estimate resource usage */
  estimateResources(input: ToolInput): ResourceEstimate;
}

export interface ToolMetadata {
  namespace: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  /** Whether tool has side effects (writes files, mutates state) */
  hasSideEffects: boolean;
  /** Whether tool is idempotent */
  idempotent: boolean;
  /** Required permissions */
  permissions: Permission[];
  /** Maximum concurrent executions */
  maxConcurrency: number;
}

export interface ToolInput {
  params: Record<string, JsonValue>;
  context: ExecutionContext;
}

export interface ToolResult {
  /** Success status */
  success: boolean;

  /** Result data (validated against outputSchema) */
  data: JsonValue;

  /** Error information if failed */
  error?: ToolError;

  /** Execution metadata */
  metadata: ToolResultMetadata;
}

export interface ToolResultMetadata {
  /** Execution duration in ms */
  durationMs: number;

  /** Resources consumed */
  resourcesUsed: ResourceUsage;

  /** Side effects produced */
  sideEffects: SideEffect[];

  /** Artifacts created */
  artifacts: Artifact[];

  /** Structured logs */
  logs: LogEntry[];
}
```

### 2.3 Side Effects

```typescript
// src/execution-engine/types/side-effects.ts

export type SideEffectType =
  | 'FILE_WRITE'
  | 'FILE_DELETE'
  | 'FILE_MOVE'
  | 'DIR_CREATE'
  | 'DIR_DELETE'
  | 'PROCESS_SPAWN'
  | 'NETWORK_REQUEST'
  | 'ENV_VAR_SET'
  | 'STATE_MUTATION'
  | 'ARTIFACT_CREATE'
  | 'CUSTOM';

export interface SideEffect {
  type: SideEffectType;
  /** Unique identifier for this side effect */
  id: string;
  /** Tool that produced this effect */
  tool: ToolRef;
  /** Step that produced this effect */
  stepId: StepId;
  /** Timestamp */
  timestamp: number;
  /** Human-readable description */
  description: string;
  /** Structured data for replay/reversal */
  payload: JsonValue;
  /** Whether this effect can be reversed */
  reversible: boolean;
  /** Reversal information if applicable */
  reversal?: ReversalInfo;
}

export interface ReversalInfo {
  /** Tool to invoke for reversal */
  tool: ToolRef;
  /** Input for reversal tool */
  input: Record<string, JsonValue>;
  /** Whether reversal is automatic on failure */
  autoReverse: boolean;
}

export interface SideEffectTracker {
  /** Record a side effect */
  record(effect: SideEffect): void;

  /** Get all effects for a step */
  getForStep(stepId: StepId): SideEffect[];

  /** Get all effects for a plan execution */
  getForExecution(executionId: ExecutionId): SideEffect[];

  /** Reverse effects (for rollback) */
  reverse(effects: SideEffect[], context: ExecutionContext): Promise<ReversalResult>;

  /** Check if any irreversible effects exist */
  hasIrreversibleEffects(executionId: ExecutionId): boolean;
}
```

---

## 3. Tool Registration

### 3.1 Registry Interface

```typescript
// src/execution-engine/registry/tool-registry.ts

export interface ToolRegistry {
  /** Register a tool implementation */
  register(tool: Tool): RegistrationResult;

  /** Unregister a tool */
  unregister(ref: ToolRef): boolean;

  /** Get tool by reference */
  get(ref: ToolRef): Tool | undefined;

  /** Find tools by namespace */
  getByNamespace(namespace: string): Tool[];

  /** Find tools by tag */
  getByTag(tag: string): Tool[];

  /** List all registered tools */
  list(): ToolMetadata[];

  /** Validate tool exists and is compatible */
  validate(ref: ToolRef, input: ToolInput): ValidationResult;
}

export interface ToolRegistration {
  tool: Tool;
  /** Priority for conflict resolution (higher wins) */
  priority: number;
  /** Whether this is a built-in tool */
  builtin: boolean;
  /** Registration timestamp */
  registeredAt: number;
}

export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolRegistration>();
  private byNamespace = new Map<string, Set<string>>();
  private byTag = new Map<string, Set<string>>();

  register(tool: Tool): RegistrationResult {
    const key = this.makeKey(tool.metadata);
    const existing = this.tools.get(key);

    if (existing && existing.priority >= tool.priority) {
      return { success: false, reason: 'Higher priority registration exists' };
    }

    const registration: ToolRegistration = {
      tool,
      priority: tool.priority ?? 0,
      builtin: false,
      registeredAt: Date.now(),
    };

    this.tools.set(key, registration);
    this.addToIndex(this.byNamespace, tool.metadata.namespace, key);
    tool.metadata.tags.forEach(tag => this.addToIndex(this.byTag, tag, key));

    return { success: true, key };
  }

  private makeKey(meta: ToolMetadata): string {
    return `${meta.namespace}:${meta.name}@${meta.version}`;
  }
}
```

### 3.2 Built-in Tools

```typescript
// Core tools shipped with the engine
export const BUILTIN_TOOLS = {
  // Filesystem
  'filesystem:read': { hasSideEffects: false, idempotent: true },
  'filesystem:write': { hasSideEffects: true, idempotent: true },
  'filesystem:delete': { hasSideEffects: true, idempotent: false },
  'filesystem:list': { hasSideEffects: false, idempotent: true },
  'filesystem:glob': { hasSideEffects: false, idempotent: true },

  // Shell/Process
  'shell:exec': { hasSideEffects: true, idempotent: false },
  'shell:spawn': { hasSideEffects: true, idempotent: false },

  // Git
  'git:status': { hasSideEffects: false, idempotent: true },
  'git:diff': { hasSideEffects: false, idempotent: true },
  'git:commit': { hasSideEffects: true, idempotent: false },
  'git:push': { hasSideEffects: true, idempotent: false },

  // Code
  'code:search': { hasSideEffects: false, idempotent: true },
  'code:edit': { hasSideEffects: true, idempotent: false },
  'code:analyze': { hasSideEffects: false, idempotent: true },

  // Network
  'http:request': { hasSideEffects: false, idempotent: false },

  // Artifacts
  'artifact:create': { hasSideEffects: true, idempotent: true },
  'artifact:read': { hasSideEffects: false, idempotent: true },

  // Variables
  'variable:set': { hasSideEffects: true, idempotent: true },
  'variable:get': { hasSideEffects: false, idempotent: true },
};
```

---

## 4. Execution State Machine

### 4.1 States

```typescript
// src/execution-engine/state/state-machine.ts

export type ExecutionState =
  | 'PENDING'       // Plan validated, not started
  | 'RUNNING'       // Actively executing steps
  | 'PAUSED'        // Paused by user or condition
  | 'COMPLETED'     // All steps succeeded
  | 'FAILED'        // Step failed, no retries left
  | 'CANCELLED'     // Explicitly cancelled
  | 'RETRYING'      // Waiting to retry a step
  | 'ROLLING_BACK'; // Reversing side effects

export interface ExecutionStateMachine {
  readonly currentState: ExecutionState;
  readonly executionId: ExecutionId;

  /** Transition to new state */
  transition(to: ExecutionState, reason: string): TransitionResult;

  /** Check if transition is valid */
  canTransition(to: ExecutionState): boolean;

  /** Get valid next states */
  getValidTransitions(): ExecutionState[];
}

const STATE_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  PENDING: ['RUNNING', 'CANCELLED'],
  RUNNING: ['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED', 'RETRYING', 'ROLLING_BACK'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  RETRYING: ['RUNNING', 'FAILED', 'CANCELLED'],
  ROLLING_BACK: ['FAILED', 'CANCELLED'],
  COMPLETED: [],      // Terminal
  FAILED: [],         // Terminal
  CANCELLED: [],      // Terminal
};
```

### 4.2 Execution Context

```typescript
// src/execution-engine/context/execution-context.ts

export interface ExecutionContext {
  /** Unique execution identifier */
  executionId: ExecutionId;

  /** Plan being executed */
  plan: ExecutionPlan;

  /** Current step being executed */
  currentStep?: StepId;

  /** Variable store (shared across steps) */
  variables: VariableStore;

  /** Artifact store */
  artifacts: ArtifactStore;

  /** Side effect tracker */
  sideEffects: SideEffectTracker;

  /** Event log for replay */
  eventLog: EventLog;

  /** Resource pool */
  resources: ResourcePool;

  /** Execution start time */
  startTime: number;

  /** Execution metadata */
  metadata: ExecutionMetadata;
}

export interface VariableStore {
  /** Get variable value */
  get(name: string): JsonValue | undefined;

  /** Set variable value */
  set(name: string, value: JsonValue): void;

  /** Check if variable exists */
  has(name: string): boolean;

  /** Get all variables */
  all(): Record<string, JsonValue>;

  /** Create child scope (for parallel branches) */
  fork(): VariableStore;

  /** Merge child scope back */
  merge(child: VariableStore): void;
}

export interface ArtifactStore {
  /** Store artifact */
  put(id: string, artifact: Artifact): void;

  /** Retrieve artifact */
  get(id: string): Artifact | undefined;

  /** Check existence */
  has(id: string): boolean;

  /** List all artifacts */
  list(): Artifact[];
}
```

---

## 5. Failure Model

### 5.1 Error Classification

```typescript
// src/execution-engine/failure/error-types.ts

export enum ErrorCategory {
  /** Tool not found or not registered */
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',

  /** Input validation failed */
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  /** Tool execution threw an error */
  TOOL_ERROR = 'TOOL_ERROR',

  /** Step timeout exceeded */
  TIMEOUT = 'TIMEOUT',

  /** Resource exhausted (memory, disk, rate limit) */
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',

  /** Permission denied */
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  /** Dependency failed (upstream step) */
  DEPENDENCY_FAILED = 'DEPENDENCY_FAILED',

  /** Condition evaluated to false */
  CONDITION_FALSE = 'CONDITION_FALSE',

  /** Plan cancelled by user */
  CANCELLED = 'CANCELLED',

  /** Internal engine error */
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  /** Side effect reversal failed */
  REVERSAL_FAILED = 'REVERSAL_FAILED',
}

export enum ErrorSeverity {
  /** Retry may succeed */
  TRANSIENT = 'TRANSIENT',

  /** Retry won't help, but plan can continue */
  RECOVERABLE = 'RECOVERABLE',

  /** Plan must stop */
  FATAL = 'FATAL',
}

export interface ToolError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  /** Original error if available */
  cause?: Error;
  /** Structured details for programmatic handling */
  details: Record<string, JsonValue>;
  /** Whether retry is recommended */
  retryable: boolean;
  /** Suggested retry delay (ms) */
  retryAfterMs?: number;
}

export interface StepFailure {
  stepId: StepId;
  error: ToolError;
  attemptNumber: number;
  timestamp: number;
  /** Side effects produced before failure */
  partialEffects: SideEffect[];
}
```

### 5.2 Failure Handling Strategy

```typescript
// src/execution-engine/failure/failure-handler.ts

export interface FailureHandler {
  /** Determine how to handle a step failure */
  handle(failure: StepFailure, context: ExecutionContext): FailureResolution;
}

export type FailureResolution =
  | { type: 'RETRY'; delayMs: number; maxRetries: number }
  | { type: 'SKIP'; reason: string }
  | { type: 'FAIL_PLAN'; reason: string }
  | { type: 'ROLLBACK'; reason: string }
  | { type: 'COMPENSATE'; compensationStep: PlanStep; reason: string };

export class DefaultFailureHandler implements FailureHandler {
  handle(failure: StepFailure, context: ExecutionContext): FailureResolution {
    const { error } = failure;

    // Fatal errors: stop immediately
    if (error.severity === ErrorSeverity.FATAL) {
      return { type: 'FAIL_PLAN', reason: error.message };
    }

    // Non-retryable errors: fail or skip based on step config
    if (!error.retryable) {
      const step = context.plan.steps.find(s => s.id === failure.stepId);
      if (step?.metadata?.optional) {
        return { type: 'SKIP', reason: `Optional step failed: ${error.message}` };
      }
      return { type: 'FAIL_PLAN', reason: `Non-retryable error: ${error.message}` };
    }

    // Transient errors: retry with backoff
    if (error.severity === ErrorSeverity.TRANSIENT) {
      const retryPolicy = this.getRetryPolicy(failure.stepId, context);
      if (failure.attemptNumber >= retryPolicy.maxRetries) {
        return { type: 'FAIL_PLAN', reason: `Max retries (${retryPolicy.maxRetries}) exceeded` };
      }
      const delay = this.calculateBackoff(failure.attemptNumber, retryPolicy, error.retryAfterMs);
      return { type: 'RETRY', delayMs: delay, maxRetries: retryPolicy.maxRetries };
    }

    // Recoverable errors: check for compensation
    const step = context.plan.steps.find(s => s.id === failure.stepId);
    if (step?.metadata?.compensation) {
      return {
        type: 'COMPENSATE',
        compensationStep: step.metadata.compensation,
        reason: `Compensating for: ${error.message}`
      };
    }

    // Default: retry with backoff
    const retryPolicy = this.getRetryPolicy(failure.stepId, context);
    if (failure.attemptNumber >= retryPolicy.maxRetries) {
      return { type: 'FAIL_PLAN', reason: `Max retries exceeded` };
    }
    const delay = this.calculateBackoff(failure.attemptNumber, retryPolicy);
    return { type: 'RETRY', delayMs: delay, maxRetries: retryPolicy.maxRetries };
  }
}
```

---

## 6. Retry Model

### 6.1 Retry Policy

```typescript
// src/execution-engine/retry/retry-policy.ts

export interface RetryPolicy {
  /** Maximum retry attempts (0 = no retry) */
  maxRetries: number;

  /** Base delay in ms */
  baseDelayMs: number;

  /** Maximum delay in ms */
  maxDelayMs: number;

  /** Backoff multiplier */
  backoffMultiplier: number;

  /** Jitter factor (0-1) */
  jitterFactor: number;

  /** Retryable error categories (empty = all retryable) */
  retryableCategories: ErrorCategory[];

  /** Non-retryable error categories */
  nonRetryableCategories: ErrorCategory[];

  /** Timeout per attempt (ms) */
  attemptTimeoutMs?: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2.0,
  jitterFactor: 0.1,
  retryableCategories: [
    ErrorCategory.TIMEOUT,
    ErrorCategory.RESOURCE_EXHAUSTED,
    ErrorCategory.TOOL_ERROR,
  ],
  nonRetryableCategories: [
    ErrorCategory.VALIDATION_ERROR,
    ErrorCategory.PERMISSION_DENIED,
    ErrorCategory.TOOL_NOT_FOUND,
  ],
};
```

### 6.2 Retry Execution

```typescript
// src/execution-engine/retry/retry-executor.ts

export interface RetryExecutor {
  /** Execute with retry logic */
  execute<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy,
    context: RetryContext
  ): Promise<RetryResult<T>>;
}

export interface RetryContext {
  stepId: StepId;
  executionId: ExecutionId;
  attemptNumber: number;
  previousErrors: ToolError[];
}

export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: ToolError;
  attempts: number;
  totalDurationMs: number;
}

export class DefaultRetryExecutor implements RetryExecutor {
  async execute<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy,
    context: RetryContext
  ): Promise<RetryResult<T>> {
    let lastError: ToolError | undefined;
    let attempts = 0;
    const startTime = Date.now();

    while (attempts <= policy.maxRetries) {
      attempts++;

      try {
        // Apply attempt timeout if configured
        const result = policy.attemptTimeoutMs
          ? await this.withTimeout(operation(), policy.attemptTimeoutMs)
          : await operation();

        return {
          success: true,
          value: result,
          attempts,
          totalDurationMs: Date.now() - startTime,
        };
      } catch (error) {
        lastError = this.normalizeError(error);

        // Check if we should retry
        if (!this.shouldRetry(lastError, policy, attempts)) {
          break;
        }

        // Calculate delay and wait
        if (attempts <= policy.maxRetries) {
          const delay = this.calculateDelay(attempts, policy, lastError);
          await this.sleep(delay);
        }
      }
    }

    return {
      success: false,
      error: lastError,
      attempts,
      totalDurationMs: Date.now() - startTime,
    };
  }

  private shouldRetry(error: ToolError, policy: RetryPolicy, attempt: number): boolean {
    if (attempt > policy.maxRetries) return false;
    if (!error.retryable) return false;
    if (policy.nonRetryableCategories.includes(error.category)) return false;
    if (policy.retryableCategories.length > 0 &&
        !policy.retryableCategories.includes(error.category)) {
      return false;
    }
    return true;
  }

  private calculateDelay(attempt: number, policy: RetryPolicy, error?: ToolError): number {
    // Use error-suggested delay if available
    if (error?.retryAfterMs) {
      return Math.min(error.retryAfterMs, policy.maxDelayMs);
    }

    // Exponential backoff with jitter
    const baseDelay = Math.min(
      policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
      policy.maxDelayMs
    );

    const jitter = baseDelay * policy.jitterFactor * Math.random();
    return Math.floor(baseDelay + jitter);
  }
}
```

---

## 7. Parallel Execution

### 7.1 Dependency Graph & Scheduling

```typescript
// src/execution-engine/scheduler/parallel-scheduler.ts

export interface ParallelScheduler {
  /** Schedule plan steps for execution */
  schedule(plan: ExecutionPlan): ScheduleResult;
}

export interface ScheduleResult {
  /** Execution phases (each phase can run in parallel) */
  phases: ExecutionPhase[];

  /** Total estimated duration */
  estimatedDurationMs: number;

  /** Maximum parallelism */
  maxParallelism: number;
}

export interface ExecutionPhase {
  /** Phase number */
  phase: number;

  /** Steps that can run in parallel */
  steps: ScheduledStep[];

  /** Phase dependencies */
  dependsOn: number[];
}

export interface ScheduledStep {
  step: PlanStep;
  /** Estimated start time */
  earliestStartMs: number;
  /** Estimated duration */
  estimatedDurationMs: number;
  /** Required resources */
  resources: ResourceRequirements;
}

export class TopologicalScheduler implements ParallelScheduler {
  schedule(plan: ExecutionPlan): ScheduleResult {
    // Build dependency graph
    const graph = this.buildGraph(plan);

    // Topological sort with parallel grouping
    const phases = this.topologicalSort(graph);

    // Assign phases and calculate timing
    return this.assignTiming(phases, plan);
  }

  private buildGraph(plan: ExecutionPlan): DependencyGraph {
    const nodes = new Map<StepId, StepNode>();
    const edges: StepEdge[] = [];

    for (const step of plan.steps) {
      nodes.set(step.id, {
        step,
        parallelizable: step.parallelizable,
        estimatedDuration: this.estimateStepDuration(step),
        resources: this.estimateStepResources(step),
      });
    }

    for (const step of plan.steps) {
      for (const depId of step.dependsOn) {
        edges.push({ from: depId, to: step.id });
      }
    }

    return { nodes, edges };
  }

  private topologicalSort(graph: DependencyGraph): StepNode[][] {
    const inDegree = new Map<StepId, number>();
    const adjacency = new Map<StepId, StepId[]>();

    // Initialize
    for (const [id] of graph.nodes) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }

    // Build adjacency and in-degrees
    for (const edge of graph.edges) {
      adjacency.get(edge.from)!.push(edge.to);
      inDegree.set(edge.to, inDegree.get(edge.to)! + 1);
    }

    // Kahn's algorithm with parallel grouping
    const phases: StepNode[][] = [];
    let queue = Array.from(graph.nodes.values())
      .filter(node => inDegree.get(node.step.id) === 0);

    while (queue.length > 0) {
      // Group parallelizable nodes
      const parallelizable = queue.filter(n => n.parallelizable);
      const sequential = queue.filter(n => !n.parallelizable);

      // Parallelizable nodes go in same phase
      if (parallelizable.length > 0) {
        phases.push(parallelizable);
      }

      // Sequential nodes each get their own phase
      for (const node of sequential) {
        phases.push([node]);
      }

      // Process this phase
      const nextQueue: StepNode[] = [];
      for (const node of [...parallelizable, ...sequential]) {
        for (const neighborId of adjacency.get(node.step.id)!) {
          const newDegree = inDegree.get(neighborId)! - 1;
          inDegree.set(neighborId, newDegree);
          if (newDegree === 0) {
            nextQueue.push(graph.nodes.get(neighborId)!);
          }
        }
      }
      queue = nextQueue;
    }

    return phases;
  }
}
```

### 7.2 Resource Pool

```typescript
// src/execution-engine/resources/resource-pool.ts

export interface ResourcePool {
  /** Acquire resources for a step */
  acquire(requirements: ResourceRequirements): Promise<ResourceLease>;

  /** Release resources */
  release(lease: ResourceLease): void;

  /** Get available resources */
  getAvailable(): ResourceAvailability;
}

export interface ResourceRequirements {
  /** CPU cores needed */
  cpu?: number;

  /** Memory in MB */
  memoryMb?: number;

  /** Disk space in MB */
  diskMb?: number;

  /** Network bandwidth (concurrent connections) */
  network?: number;

  /** Custom resource types */
  custom?: Record<string, number>;
}

export interface ResourceLease {
  /** Lease ID */
  id: string;

  /** Resources granted */
  granted: ResourceRequirements;

  /** Lease expiration */
  expiresAt: number;

  /** Release the lease */
  release(): void;
}

export class DefaultResourcePool implements ResourcePool {
  private total: ResourceRequirements;
  private allocated = new Map<string, ResourceRequirements>();

  constructor(total: ResourceRequirements) {
    this.total = total;
  }

  async acquire(requirements: ResourceRequirements): Promise<ResourceLease> {
    // Wait until resources available
    while (!this.canAllocate(requirements)) {
      await this.sleep(100);
    }

    const leaseId = crypto.randomUUID();
    this.allocated.set(leaseId, requirements);

    return {
      id: leaseId,
      granted: requirements,
      expiresAt: Date.now() + 300000, // 5 min default
      release: () => this.release({ id: leaseId, granted: requirements, expiresAt: 0, release: () => {} }),
    };
  }

  private canAllocate(requirements: ResourceRequirements): boolean {
    const used = this.getUsed();
    return (
      (!requirements.cpu || used.cpu + requirements.cpu <= this.total.cpu!) &&
      (!requirements.memoryMb || used.memoryMb + requirements.memoryMb <= this.total.memoryMb!) &&
      (!requirements.diskMb || used.diskMb + requirements.diskMb <= this.total.diskMb!) &&
      (!requirements.network || used.network + requirements.network <= this.total.network!)
    );
  }
}
```

---

## 8. Deterministic Replay

### 8.1 Trace Recording

```typescript
// src/execution-engine/replay/trace-recorder.ts

export interface TraceRecorder {
  /** Record an event */
  record(event: TraceEvent): void;

  /** Get complete trace */
  getTrace(): ExecutionTrace;

  /** Serialize trace for storage */
  serialize(): string;

  /** Deserialize trace */
  static deserialize(data: string): TraceRecorder;
}

export interface TraceEvent {
  /** Event type */
  type: TraceEventType;

  /** Timestamp (monotonic) */
  timestamp: number;

  /** Execution ID */
  executionId: ExecutionId;

  /** Step ID if applicable */
  stepId?: StepId;

  /** Event payload */
  payload: JsonValue;
}

export type TraceEventType =
  | 'PLAN_START'
  | 'PLAN_COMPLETE'
  | 'PLAN_FAILED'
  | 'STEP_START'
  | 'STEP_COMPLETE'
  | 'STEP_FAILED'
  | 'STEP_RETRY'
  | 'TOOL_INVOKE'
  | 'TOOL_RESULT'
  | 'VARIABLE_SET'
  | 'VARIABLE_GET'
  | 'ARTIFACT_CREATE'
  | 'ARTIFACT_READ'
  | 'SIDE_EFFECT'
  | 'RESOURCE_ACQUIRE'
  | 'RESOURCE_RELEASE'
  | 'STATE_TRANSITION';

export interface ExecutionTrace {
  executionId: ExecutionId;
  planId: PlanId;
  startTime: number;
  endTime?: number;
  events: TraceEvent[];
  finalState: ExecutionState;
  finalVariables: Record<string, JsonValue>;
  finalArtifacts: Artifact[];
  sideEffects: SideEffect[];
}
```

### 8.2 Deterministic Replay

```typescript
// src/execution-engine/replay/replay-engine.ts

export interface ReplayEngine {
  /** Replay an execution trace */
  replay(trace: ExecutionTrace, options?: ReplayOptions): Promise<ReplayResult>;
}

export interface ReplayOptions {
  /** Whether to actually execute tools (false = dry run) */
  executeTools: boolean;

  /** Override specific tool implementations */
  toolOverrides?: Map<string, Tool>;

  /** Step filter (only replay certain steps) */
  stepFilter?: StepId[];

  /** Whether to verify side effects match */
  verifySideEffects: boolean;

  /** Whether to verify variable values match */
  verifyVariables: boolean;
}

export interface ReplayResult {
  /** Whether replay matched original */
  matched: boolean;

  /** Differences found */
  differences: ReplayDifference[];

  /** Replay execution trace */
  replayTrace: ExecutionTrace;

  /** Verification details */
  verification: VerificationResult;
}

export interface ReplayDifference {
  type: 'VARIABLE_MISMATCH' | 'ARTIFACT_MISMATCH' | 'SIDE_EFFECT_MISMATCH' | 'TOOL_RESULT_MISMATCH' | 'TIMING_DIFFERENCE';
  stepId: StepId;
  expected: JsonValue;
  actual: JsonValue;
  description: string;
}

export class DeterministicReplayEngine implements ReplayEngine {
  async replay(trace: ExecutionTrace, options: ReplayOptions = {}): Promise<ReplayResult> {
    const {
      executeTools = false,
      toolOverrides = new Map(),
      verifySideEffects = true,
      verifyVariables = true,
    } = options;

    const differences: ReplayDifference[] = [];
    const replayEvents: TraceEvent[] = [];

    // Reconstruct execution context from trace
    const context = this.reconstructContext(trace);

    // Replay each event in order
    for (const event of trace.events) {
      const replayEvent = await this.replayEvent(event, context, {
        executeTools,
        toolOverrides,
      });
      replayEvents.push(replayEvent);

      // Verify if enabled
      if (verifyVariables && event.type === 'VARIABLE_SET') {
        this.verifyVariable(event, replayEvent, differences);
      }
      if (verifySideEffects && event.type === 'SIDE_EFFECT') {
        this.verifySideEffect(event, replayEvent, differences);
      }
    }

    return {
      matched: differences.length === 0,
      differences,
      replayTrace: {
        ...trace,
        events: replayEvents,
        endTime: Date.now(),
      },
      verification: {
        variablesVerified: verifyVariables,
        sideEffectsVerified: verifySideEffects,
        totalChecks: differences.length + (verifyVariables ? 1 : 0) + (verifySideEffects ? 1 : 0),
      },
    };
  }

  private verifyVariable(original: TraceEvent, replayed: TraceEvent, differences: ReplayDifference[]): void {
    if (!this.deepEqual(original.payload, replayed.payload)) {
      differences.push({
        type: 'VARIABLE_MISMATCH',
        stepId: original.stepId!,
        expected: original.payload,
        actual: replayed.payload,
        description: `Variable value differs at step ${original.stepId}`,
      });
    }
  }
}
```

---

## 9. Public API

### 9.1 Core Interface

```typescript
// src/execution-engine/execution-engine.ts

export interface ExecutionEngine {
  /** Execute a plan */
  execute(plan: ExecutionPlan, options?: ExecutionOptions): Promise<ExecutionResult>;

  /** Execute a plan with streaming updates */
  executeStream(plan: ExecutionPlan, options?: ExecutionOptions): AsyncIterable<ExecutionUpdate>;

  /** Validate a plan without executing */
  validate(plan: ExecutionPlan): ValidationResult;

  /** Get execution status */
  getStatus(executionId: ExecutionId): ExecutionStatus | undefined;

  /** Cancel an execution */
  cancel(executionId: ExecutionId): Promise<CancelResult>;

  /** Pause an execution */
  pause(executionId: ExecutionId): Promise<PauseResult>;

  /** Resume a paused execution */
  resume(executionId: ExecutionId): Promise<ResumeResult>;

  /** Retry a failed execution from failure point */
  retry(executionId: ExecutionId, options?: RetryOptions): Promise<ExecutionResult>;

  /** Replay an execution */
  replay(trace: ExecutionTrace, options?: ReplayOptions): Promise<ReplayResult>;
}

export interface ExecutionOptions {
  /** Initial variable values */
  initialVariables?: VariableMap;

  /** Resource limits */
  resourceLimits?: ResourceRequirements;

  /** Execution timeout (ms) */
  timeoutMs?: number;

  /** Whether to record trace for replay */
  recordTrace: boolean;

  /** Custom tool registry (merged with default) */
  toolRegistry?: ToolRegistry;

  /** Event callbacks */
  onStepStart?: (step: PlanStep, context: ExecutionContext) => void;
  onStepComplete?: (step: PlanStep, result: StepResult, context: ExecutionContext) => void;
  onStepFailed?: (step: PlanStep, error: ToolError, context: ExecutionContext) => void;
  onStateChange?: (from: ExecutionState, to: ExecutionState, context: ExecutionContext) => void;
}

export interface ExecutionResult {
  /** Execution ID */
  executionId: ExecutionId;

  /** Final state */
  state: ExecutionState;

  /** Plan ID */
  planId: PlanId;

  /** Start time */
  startTime: number;

  /** End time */
  endTime: number;

  /** Total duration */
  durationMs: number;

  /** Step results */
  stepResults: Map<StepId, StepResult>;

  /** Final variables */
  variables: VariableMap;

  /** Created artifacts */
  artifacts: Artifact[];

  /** Side effects */
  sideEffects: SideEffect[];

  /** Execution trace (if recorded) */
  trace?: ExecutionTrace;

  /** Error if failed */
  error?: ToolError;
}

export interface StepResult {
  stepId: StepId;
  success: boolean;
  output?: JsonValue;
  error?: ToolError;
  durationMs: number;
  attempts: number;
  sideEffects: SideEffect[];
  artifacts: Artifact[];
}
```

### 9.2 Factory

```typescript
// src/execution-engine/execution-engine-factory.ts

export interface ExecutionEngineFactory {
  /** Create engine with default configuration */
  createDefault(): ExecutionEngine;

  /** Create engine with custom configuration */
  create(config: EngineConfig): ExecutionEngine;
}

export interface EngineConfig {
  /** Tool registry */
  toolRegistry: ToolRegistry;

  /** Resource pool */
  resourcePool: ResourcePool;

  /** Default retry policy */
  defaultRetryPolicy: RetryPolicy;

  /** Failure handler */
  failureHandler: FailureHandler;

  /** Trace recorder */
  traceRecorder: TraceRecorder;

  /** Scheduler */
  scheduler: ParallelScheduler;

  /** Maximum concurrent executions */
  maxConcurrentExecutions: number;

  /** Default execution timeout (ms) */
  defaultTimeoutMs: number;

  /** Enable deterministic mode (for replay) */
  deterministic: boolean;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  toolRegistry: new DefaultToolRegistry(),
  resourcePool: new DefaultResourcePool({ cpu: 4, memoryMb: 2048, diskMb: 10240 }),
  defaultRetryPolicy: DEFAULT_RETRY_POLICY,
  failureHandler: new DefaultFailureHandler(),
  traceRecorder: new InMemoryTraceRecorder(),
  scheduler: new TopologicalScheduler(),
  maxConcurrentExecutions: 10,
  defaultTimeoutMs: 300000, // 5 minutes
  deterministic: false,
};
```

---

## 10. Future Extension Points

### 10.1 Plugin Interfaces

```typescript
// Extension points for customization

export interface ToolPlugin {
  name: string;
  tools: Tool[];
  initialize(registry: ToolRegistry): Promise<void>;
  shutdown(): Promise<void>;
}

export interface SchedulerPlugin {
  name: string;
  schedule(plan: ExecutionPlan, graph: DependencyGraph): ScheduleResult;
}

export interface FailureHandlerPlugin {
  name: string;
  handle(failure: StepFailure, context: ExecutionContext): FailureResolution;
}

export interface ResourcePlugin {
  name: string;
  type: string;
  acquire(requirements: ResourceRequirements): Promise<ResourceLease>;
  release(lease: ResourceLease): void;
}

export interface TraceExporterPlugin {
  name: string;
  export(trace: ExecutionTrace): Promise<void>;
}

export interface StatePersistencePlugin {
  name: string;
  save(executionId: ExecutionId, context: ExecutionContext): Promise<void>;
  load(executionId: ExecutionId): Promise<ExecutionContext | null>;
}
```

### 10.2 Planned Extensions

| Extension | Description |
|-----------|-------------|
| **Distributed Execution** | Execute steps across multiple machines |
| **Checkpoint/Resume** | Persistent execution state for long-running plans |
| **Cost Tracking** | Track API costs, compute costs per execution |
| **Policy Engine** | OPA-style policies for step approval |
| **Streaming Results** | Real-time result streaming to consumers |
| **Plan Templates** | Parameterized plan templates with validation |
| **Visual Debugger** | Step-through execution with breakpoints |
| **Chaos Testing** | Fault injection for resilience testing |

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Tool side effects not tracked** | Medium | High | Mandatory side effect declaration in tool metadata |
| **Race conditions in parallel execution** | Medium | High | Resource pool with proper locking, deterministic scheduling |
| **Unbounded resource consumption** | Low | High | Resource pool limits, step timeouts, global execution timeout |
| **Non-deterministic tool behavior** | Medium | Medium | Tool sandboxing, deterministic mode flag, replay verification |
| **Cascading failures** | Medium | High | Dependency failure handling, circuit breaker pattern |
| **Replay divergence** | Medium | Medium | Strict tool contracts, versioned tool schemas, snapshot isolation |
| **Memory leaks in long executions** | Low | Medium | Trace rotation, artifact TTL, explicit cleanup hooks |
| **Tool version conflicts** | Medium | Medium | Semver-based resolution, explicit version pinning in plans |

---

## 12. Recommendation

**Adopt this architecture** with the following implementation priority:

1. **Phase 1 (Core)**: Tool registry, basic executor, sequential execution, failure handling
2. **Phase 2 (Parallel)**: Topological scheduler, resource pool, parallel execution
3. **Phase 3 (Reliability)**: Retry engine, side effect tracking, rollback
4. **Phase 4 (Observability)**: Trace recorder, replay engine, metrics
5. **Phase 5 (Advanced)**: Distributed execution, checkpoint/resume, policy engine

**Key Principles**:
- Engine is **purely operational** - no planning, no LLM, no prompting
- **Tools are the only extensibility point** - everything else is configuration
- **Determinism by default** - replay must work without tool cooperation
- **Failure is a first-class citizen** - explicit handling at every level
- **Resource-aware** - no unbounded execution

---

*End of Design Document*