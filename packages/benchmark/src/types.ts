/**
 * @devforge/benchmark — Core schema (DF-024).
 *
 * Central types for benchmark tasks, datasets, adapters, executions,
 * evaluation, and results. Every timestamp and identifier here is
 * deterministic under an injected clock; every ordering has a documented
 * tie-break.
 */
import type { TaskRunContext } from "./execution.js";

/* ------------------------------------------------------------------ *
 * Task schema                                                         *
 * ------------------------------------------------------------------ */

/** Categories a benchmark task can represent. */
export type TaskCategory =
  | "BUG_FIX"
  | "FEATURE"
  | "REFACTOR"
  | "TEST_REPAIR"
  | "BUILD_FIX"
  | "CONFIGURATION"
  | "DOCUMENTATION"
  | "EXPLORATION"
  | "REPAIR";

export const TASK_CATEGORIES: readonly TaskCategory[] = [
  "BUG_FIX",
  "FEATURE",
  "REFACTOR",
  "TEST_REPAIR",
  "BUILD_FIX",
  "CONFIGURATION",
  "DOCUMENTATION",
  "EXPLORATION",
  "REPAIR",
];

/** Metadata-only difficulty; never a hidden scoring multiplier. */
export type TaskDifficulty = "EASY" | "MEDIUM" | "HARD" | "EXPERT";

export const TASK_DIFFICULTIES: readonly TaskDifficulty[] = [
  "EASY",
  "MEDIUM",
  "HARD",
  "EXPERT",
];

/** Identifies the repository a task executes against. */
export interface RepositoryRef {
  readonly id: string;
  readonly source?: string;
}

/**
 * A single objective benchmark task. It never assumes the work modifies
 * files: verification drives the outcome via {@link Verification}.
 */
export interface BenchmarkTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly repository: RepositoryRef;
  readonly baseRevision: string;
  /** Commands run during fixture initialization, before the agent starts. */
  readonly setup: readonly string[];
  readonly expectedBehavior: ExpectedBehavior;
  readonly verification: Verification;
  readonly timeoutMs: number;
  readonly tags: readonly string[];
  readonly difficulty: TaskDifficulty;
  readonly category: TaskCategory;
  /** Per-task semantic version; inherited from dataset 1 when unset. */
  readonly version?: number;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Human-oriented description plus the structural verification criteria. */
export interface ExpectedBehavior {
  readonly summary: string;
  readonly criteria?: readonly string[];
}

/** Deterministic verification tree. */
export type Verification =
  | { readonly kind: "tests"; readonly mustPass: readonly string[] }
  | { readonly kind: "build"; readonly command: string }
  | { readonly kind: "files"; readonly expected: readonly string[]; readonly forbidden?: readonly string[] }
  | {
      readonly kind: "diff";
      readonly expectedPaths: readonly string[];
      readonly forbiddenPaths?: readonly string[];
    }
  | { readonly kind: "command"; readonly command: string; readonly expectExitCode: number }
  | { readonly kind: "composite"; readonly all?: readonly Verification[]; readonly any?: readonly Verification[] };

export function isVerification(value: unknown): value is Verification {
  return typeof value === "object" && value !== null;
}

/* ------------------------------------------------------------------ *
 * Dataset                                                             *
 * ------------------------------------------------------------------ */

/** Initial source state of a fixture repository at `baseRevision`. */
export interface DatasetRepository {
  readonly id: string;
  readonly description: string;
  readonly isGit: boolean;
  readonly files: Readonly<Record<string, string>>;
}

/** A versioned bundle of fixture repositories and tasks. */
export interface BenchmarkDataset {
  readonly datasetName: string;
  readonly datasetVersion: string;
  /** Version of the dataset schema; bumps when fields change meaning. */
  readonly schemaVersion: number;
  readonly repositories: readonly DatasetRepository[];
  readonly tasks: readonly BenchmarkTask[];
  readonly metadata?: Readonly<Record<string, string>>;
}

/* ------------------------------------------------------------------ *
 * Adapter                                                            *
 * ------------------------------------------------------------------ */

/**
 * Telemetry observed through an adapter. Unmeasurable fields stay `undefined`;
 * the framework never fabricates token, latency, or model statistics.
 */
export interface AdapterTelemetry {
  readonly tokenUsage?: number;
  readonly modelCalls?: number;
  readonly toolCalls?: number;
  readonly memoryRetrievalCount?: number;
  readonly memoryHitRate?: number;
  readonly attemptedRepairs: number;
}

/** One file as the adapter intends it to exist after execution. */
export interface FilePatchChange {
  readonly path: string;
  readonly before?: string;
  readonly after?: string;
}

/** Structured diff produced by an adapter, applied/graded deterministically. */
export interface FilePatch {
  readonly changes: readonly FilePatchChange[];
}

export interface AgentPlanResult {
  readonly summary: string;
  readonly steps: readonly string[];
  readonly durationMs: number;
}

export interface AgentStepResult {
  readonly intent: string;
  readonly status: "success" | "failed";
  readonly message: string;
  readonly commandsRun: readonly string[];
  readonly durationMs: number;
}

export interface AgentRunResult {
  readonly status: "success" | "failed" | "error";
  readonly plan: AgentPlanResult;
  readonly steps: readonly AgentStepResult[];
  readonly filesWritten: Readonly<Record<string, string>>;
  readonly patch?: FilePatch;
  readonly telemetry: AdapterTelemetry;
  readonly note?: string;
}

/**
 * Abstraction around DevForge execution. The benchmark package never depends
 * on AutonomousAgent or MultiAgent internals; integrations implement this
 * contract (optionally via generated adapters).
 */
export interface BenchmarkAgent {
  readonly name: string;
  readonly version: string;
  plan(input: AgentPlanInput): Promise<AgentPlanResult>;
  execute(input: AgentStepInput): Promise<AgentStepResult>;
  repair?(input: AgentStepInput): Promise<AgentStepResult>;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export type AgentStepKind = "plan" | "execute" | "repair";

export interface AgentPlanInput {
  readonly kind: "plan";
  readonly task: BenchmarkTask;
  readonly fixture: RepositoryFixtureAbstraction;
  readonly context: TaskRunContext;
}

export interface AgentStepInput {
  readonly kind: AgentStepKind;
  readonly task: BenchmarkTask;
  readonly fixture: RepositoryFixtureAbstraction;
  readonly context: TaskRunContext;
}

export interface AgentRunInput {
  readonly task: BenchmarkTask;
  readonly fixture: RepositoryFixtureAbstraction;
  readonly context: TaskRunContext;
}

/** Surface used by adapters so they never touch real paths directly. */
export interface RepositoryFixtureAbstraction {
  readFile(relativePath: string): Promise<string | null>;
  writeFile(relativePath: string, content: string): Promise<void>;
  listFiles(): Promise<string[]>;
}

/* ------------------------------------------------------------------ *
 * Execution / evaluation                                              *
 * ------------------------------------------------------------------ */

export type TaskStatus =
  | "passed"
  | "failed"
  | "verification_failed"
  | "timeout"
  | "cancelled"
  | "error";

export type TaskOutcomeLabel =
  | "success"
  | "failed"
  | "verification_failed"
  | "timeout"
  | "cancelled"
  | "error";

/** Objective signals observable from a task execution. */
export interface EvaluationSignals {
  readonly buildPasses: boolean | null;
  readonly testsPass: boolean | null;
  readonly expectedTestsPass: boolean | null;
  readonly unexpectedTestsFail: boolean | null;
  readonly filesChanged: boolean | null;
  readonly expectedFilesChanged: boolean | null;
  readonly forbiddenFilesChanged: boolean | null;
  readonly patchApplies: boolean | null;
  readonly verificationSucceeds: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly regressionDetected: boolean | null;
  /** Recorded, but never alone decides success (see evaluation). */
  readonly agentReportedSuccess: boolean;
}

export interface EvaluationResult {
  readonly status: TaskStatus;
  readonly outcome: TaskOutcomeLabel;
  readonly signals: EvaluationSignals;
  readonly reasons: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Results                                                             *
 * ------------------------------------------------------------------ */

export interface PatchStats {
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
}

/** Grader verdict attached to a task result (kept lean for serialization). */
export interface GraderResultSummary {
  readonly kind: string;
  readonly passed: boolean;
  readonly score: number;
  readonly reason: string;
  readonly evidence: readonly string[];
}

export interface TaskResult {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly category: TaskCategory;
  readonly difficulty: TaskDifficulty;
  readonly taskVersion: number;
  readonly repositoryId: string;
  readonly baseRevision: string;
  readonly status: TaskStatus;
  readonly outcome: TaskOutcomeLabel;
  readonly score: number;
  readonly attempts: number;
  readonly repairAttempts: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number;
  readonly grader: {
    readonly kind: string;
    readonly passed: boolean;
    readonly score: number;
    readonly reason: string;
    readonly evidence: readonly string[];
  };
  readonly signals: EvaluationSignals;
  readonly evidence: readonly string[];
  readonly errors: readonly string[];
  readonly patchStats: PatchStats | null;
  readonly telemetry: AdapterTelemetry;
}

/** Snapshot of everything that identifies a run historically. */
export interface RunConfiguration {
  readonly order: "dataset" | "id";
  readonly concurrency: number;
  readonly retries: number;
  readonly randomSeed: number;
  readonly adapterName: string;
  readonly adapterVersion: string;
  readonly model: Readonly<Record<string, string>>;
  readonly memory: Readonly<Record<string, string>>;
  readonly agent: Readonly<Record<string, string>>;
}

export interface BenchmarkResult {
  readonly resultId: string;
  readonly name: string;
  readonly datasetName: string;
  readonly datasetVersion: string;
  readonly datasetSchemaVersion: number;
  readonly benchmarkVersion: string;
  readonly devforgeVersion: string;
  readonly createdAtMs: number;
  readonly configuration: RunConfiguration;
  readonly tasks: readonly TaskResult[];
  readonly counts: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly verificationFailed: number;
    readonly timeout: number;
    readonly cancelled: number;
    readonly error: number;
  };
}

export interface SuiteResult {
  readonly suiteId: string;
  readonly name: string;
  readonly taskIds: readonly string[];
  readonly result: BenchmarkResult;
}

/* ------------------------------------------------------------------ *
 * Comparisons / regression                                            *
 * ------------------------------------------------------------------ */

export interface TaskDelta {
  readonly taskId: string;
  readonly beforeStatus: TaskStatus;
  readonly afterStatus: TaskStatus;
  readonly beforeScore: number;
  readonly afterScore: number;
  readonly scoreDelta: number;
  readonly latencyDeltaMs: number;
  readonly attemptsDelta: number;
  readonly repairDelta: number;
}

export interface RunComparison {
  readonly runAId: string;
  readonly runBId: string;
  readonly tasks: readonly TaskDelta[];
  readonly improved: number;
  readonly regressed: number;
  readonly unchanged: number;
  readonly successRateDelta: number;
  readonly verificationDelta: number;
  readonly latencyDeltaMs: number;
  readonly attemptDelta: number;
  readonly repairDelta: number;
  readonly memoryImpact: {
    readonly retrievalDelta: number | null;
    readonly hitRateDelta: number | null;
  };
}

export interface RegressionThresholds {
  readonly minSuccessRate?: number;
  readonly maxRegressionRate?: number;
  readonly maxTimeoutRate?: number;
  readonly maxLatencyIncreaseMs?: number;
  readonly minVerificationRate?: number;
}

export interface RegressionViolation {
  readonly name: string;
  readonly threshold: number;
  readonly actual: number;
  readonly message: string;
}

export interface RegressionEvaluation {
  readonly passed: boolean;
  readonly violations: readonly RegressionViolation[];
}

/* ------------------------------------------------------------------ *
 * Verification outputs (evidence feeding graders)                    *
 * ------------------------------------------------------------------ */

export interface CommandResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface TestSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly byName: Readonly<Record<string, boolean>>;
  readonly failureNames: readonly string[];
}

export interface VerificationOutputs {
  readonly commandResults: Readonly<Record<string, CommandResult>>;
  readonly testSummary: TestSummary | null;
  readonly buildStatus: boolean | null;
  readonly presentFiles: readonly string[];
  /** Full current contents (path → content) for diff/dup checks. */
  readonly contents: Readonly<Record<string, string>>;
  readonly patch: FilePatch | null;
}

/* ------------------------------------------------------------------ *
 * Version constants                                                   *
 * ------------------------------------------------------------------ */

/** Format version of benchmark serialization (dataset schema). */
export const DATASET_SCHEMA_VERSION = 1;
/** Framework version recorded on every result. */
export const BENCHMARK_VERSION = "1.0.0";