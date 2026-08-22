/**
 * @devforge/memory — Shared type definitions (DF-023).
 *
 * Explicit, discriminated memory records scoped to a repository. Records are
 * immutable-on-persist snapshots: every field is `readonly`, and all text
 * reaching persistence is redacted. This module is dependency-free.
 */

/** The six supported memory record categories. */
export const MEMORY_TYPES = [
  "architecture",
  "convention",
  "decision",
  "task",
  "failure",
  "session",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Categories used by convention memories. */
export const CONVENTION_CATEGORIES = [
  "naming",
  "formatting",
  "testing",
  "dependencies",
  "patterns",
  "other",
] as const;

export type ConventionCategory = (typeof CONVENTION_CATEGORIES)[number];

/** Verdict recorded for a task memory. */
export const TASK_OUTCOMES = ["success", "failure", "partial"] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];

/** Verdict recorded for a failure memory. */
export const FAILURE_RESULTS = [
  "resolved",
  "unresolved",
  "workaround",
  "unknown",
] as const;
export type FailureResult = (typeof FAILURE_RESULTS)[number];

/** Architecture knowledge: structure, subsystems, constraints. */
export interface ArchitecturePayload {
  /** The module, package, or subsystem the fact is about. */
  readonly owner: string;
  /** One-line statement of what the owner is responsible for. */
  readonly responsibility: string;
  /** Architectural constraints that apply to the owner. */
  readonly constraints: readonly string[];
}

/** A repository-specific coding convention. */
export interface ConventionPayload {
  readonly category: ConventionCategory;
  /** The convention itself, e.g. "use pnpm" or "single quotes". */
  readonly convention: string;
}

/** A recorded architecture decision together with its rationale. */
export interface DecisionPayload {
  /** The decision statement, e.g. "All Git ops go through GitService". */
  readonly decision: string;
  /** Why the decision was made. */
  readonly rationale: string;
  /** The subsystem/area the decision affects. */
  readonly affectedArea: string;
}

/** An execution task with outcome and repair bookkeeping. */
export interface TaskPayload {
  readonly task: string;
  readonly outcome: TaskOutcome;
  readonly affectedFiles: readonly string[];
  readonly tests: readonly string[];
  readonly failures: readonly string[];
  /** Short descriptions of repairs that made the task succeed. */
  readonly repairs: readonly string[];
}

/** A recorded failure with fingerprint and resolution status. */
export interface FailurePayload {
  /** Deterministic key identifying the failure across occurrences. */
  readonly fingerprint: string;
  /** Coarse category, e.g. "build", "test", "runtime", "type". */
  readonly errorCategory: string;
  readonly affectedSubsystem: string;
  readonly attemptedSolution: string;
  readonly result: FailureResult;
}

/** A summarized agent session scoped to the repository. */
export interface SessionPayload {
  readonly sessionId: string;
  readonly userRequest: string;
  readonly actions: readonly string[];
  readonly result: string;
  readonly discoveries: readonly string[];
}

/** Maps each memory type to its typed payload. */
export interface PayloadByType {
  architecture: ArchitecturePayload;
  convention: ConventionPayload;
  decision: DecisionPayload;
  task: TaskPayload;
  failure: FailurePayload;
  session: SessionPayload;
}

/** The shared envelope every memory record carries. */
export interface MemoryRecordBase<T extends object> {
  /** Stable, deterministic ID derived from content (or explicitly injected). */
  readonly id: string;
  readonly type: MemoryType;
  /** Stable repository identity the record is scoped to. */
  readonly repositoryId: string;
  /** Short human-readable subject line. */
  readonly title: string;
  /** Epoch milliseconds at creation. */
  readonly createdAt: number;
  /** Epoch milliseconds of the last modification. */
  readonly updatedAt: number;
  /** Caller-provided confidence in [0, 1]. Used for ranking and GC. */
  readonly confidence: number;
  /** Caller-provided importance in [0, 1]. Used for GC ordering. */
  readonly importance: number;
  readonly tags: readonly string[];
  /** Who recorded it, when known (e.g. a decision's source). */
  readonly source?: string;
  /** ID of the record that superseded this one (retained historically). */
  readonly supersededBy?: string;
  /** ID of the record this one supersedes. */
  readonly supersedes?: string;
  readonly data: T;
}

/**
 * The discriminated union of all memory records. Narrowing on `type` narrows
 * `data` to the corresponding payload.
 */
export type MemoryRecord = {
  [T in MemoryType]: MemoryRecordBase<PayloadByType[T]> & { readonly type: T };
}[MemoryType];

/** Narrow the union to a single memory type. */
export type MemoryRecordOf<T extends MemoryType> = MemoryRecord & {
  readonly type: T;
};

/** Input for a deterministic memory ID. */
export interface IdInput {
  readonly repositoryId: string;
  readonly type: MemoryType;
  /** Stable seed string; identical seeds produce identical IDs. */
  readonly seed: string;
}

/** A stable, deterministic repository identity. */
export interface RepositoryIdentity {
  /** Stable opaque hash; the only key used for scoping and storage. */
  readonly id: string;
  /** Human-friendly display name (last path segment when auto-derived). */
  readonly name: string;
  /** Absolute root path, normalized, when known. */
  readonly root: string;
  /** What produced the identity. */
  readonly source: "remote" | "name" | "root";
}

/** Inputs accepted by {@link createRepositoryIdentity}. */
export interface RepositoryIdentityInput {
  /** Absolute path of the repository root. */
  readonly root: string;
  /** Stronger identity: e.g. the git origin remote URL. */
  readonly remoteUrl?: string;
  /** Optional explicit name. */
  readonly name?: string;
}

/** Everything a record needs for deterministic serialization. */
export interface SerializationContext {
  readonly repositoryId: string;
  /** Deterministic stringifier producing key-sorted JSON. */
  readonly stringify: (value: unknown) => string;
  /** Deterministic redaction applied to persisted text. */
  readonly redact: (text: string) => string;
}

export const DEFAULT_REPOSITORY_ID = "unknown-repository";

export const DEFAULT_CONFIDENCE = 0.5;
export const DEFAULT_IMPORTANCE = 0.5;
export const HIGH_CONFIDENCE = 0.8;