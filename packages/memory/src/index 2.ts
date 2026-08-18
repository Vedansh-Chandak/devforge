/**
 * @devforge/memory — Project memory & knowledge base (DF-023).
 *
 * A repository-scoped, deterministic, bounded memory system. Foundational
 * infrastructure: it never executes commands, never modifies repository files
 * (beyond its own scoped store), never generates patches, and never makes
 * execution decisions.
 */
export {
  RepositoryMemory,
  type RepositoryMemoryOptions,
  type RepositoryMemoryLoadResult,
  type MemoryFacade,
} from "./repository-memory.js";
export {
  createRepositoryIdentity,
  normalizeRoot,
  identitiesEqual,
  reconcileIdentities,
  isRemoteIdentity,
} from "./repository-identity.js";
export type {
  RepositoryIdentityInput,
  RepositoryIdentity,
  IdInput,
  MemoryRecord,
  MemoryRecordBase,
  MemoryRecordOf,
  MemoryType,
  PayloadByType,
  ArchitecturePayload,
  ConventionPayload,
  DecisionPayload,
  TaskPayload,
  FailurePayload,
  SessionPayload,
  ConventionCategory,
  TaskOutcome,
  FailureResult,
  SerializationContext,
} from "./types.js";
export {
  MEMORY_TYPES,
  CONVENTION_CATEGORIES,
  TASK_OUTCOMES,
  FAILURE_RESULTS,
  DEFAULT_CONFIDENCE,
  DEFAULT_IMPORTANCE,
  HIGH_CONFIDENCE,
  DEFAULT_REPOSITORY_ID,
} from "./types.js";

export {
  MemoryStore,
  StoreMutation,
  type MemoryStoreConfig,
  type MemorySearchOptions,
  type MemorySearchResult,
  type MutationOp,
} from "./memory-store.js";

export {
  MemoryError,
  InvalidRecordError,
  NotFoundError,
  DuplicateRecordError,
  RepositoryMismatchError,
  StorageCorruptError,
  LimitExceededError,
  ClosedMemoryError,
  assertMemoryType,
  type MemoryErrorCode,
} from "./errors.js";

export {
  sha256,
  shortHash,
  stableStringify,
  compare,
} from "./ids.js";

export {
  redactSecrets,
  entropyOf,
  looksRandom,
  REDACTED,
  type RedactionOptions,
} from "./secrets.js";

export {
  tokenize,
  uniqueTokens,
  tokenSet,
  tokenHits,
  jaccard,
  containsAllTokens,
  containsPhrase,
  memoryText,
  contentHash,
  sameContent,
  type TokenSet,
} from "./text.js";

export {
  MemoryPersistence,
  serializeRecords,
  deserializeRecords,
  redactMemoryRecord,
  realFileSystem,
  PERSISTENCE_VERSION,
  RECORDS_FILE,
  DEFAULT_MEMORY_DIR,
  type MemoryPersistenceConfig,
  type MemoryFileSystem,
  type PersistedState,
  type PersistResult,
  type PersistedFile,
} from "./persistence.js";

export {
  scoreRecord,
  rankRecords,
  compareRanked,
  RANKING_WEIGHTS,
  DEFAULT_TYPE_WEIGHTS,
  type RankInput,
  type RankedMemory,
  type RankedSignals,
  type RankedResult,
} from "./ranking.js";

export {
  retrieve,
  type RetrieveOptions,
  type RetrievalResult,
  type RetrieveInput,
} from "./retrieval.js";

export {
  buildArchitectureRecord,
  ArchitectureMemory,
  type ArchitectureInput,
  type ArchitecturePatch,
} from "./architecture.js";
export {
  buildConventionRecord,
  ConventionMemory,
  type ConventionInput,
  type ConventionPatch,
} from "./conventions.js";
export {
  buildDecisionRecord,
  DecisionMemory,
  type DecisionInput,
  type DecisionPatch,
  type SupersedeResult,
} from "./decisions.js";
export {
  buildTaskRecord,
  TaskMemory,
  type TaskInput,
  type TaskPatch,
} from "./task.js";
export {
  buildFailureRecord,
  FailureMemory,
  failureFingerprint,
  type FailureInput,
  type FailurePatch,
} from "./failure.js";
export {
  buildSessionRecord,
  SessionMemory,
  type SessionInput,
  type SessionPatch,
} from "./session-memory.js";
export {
  HistoryRecorder,
  type HistoryRecorderConfig,
  type HistoryRecordResult,
  type HistoryBase,
  type SuccessfulRepairEvent,
  type FailedRepairEvent,
  type BuildOrTestFailureEvent,
} from "./history.js";
export {
  buildMemoryRecord,
  defaultIdFactory,
  clamp01,
  TypedRepositoryMemory,
  type MemoryContext,
  type RecordBuildOptions,
} from "./record-builder.js";

export {
  collectGarbage,
  isProtected,
  evictionPriority,
  defaultGcConfig,
  type GcConfig,
  type GcResult,
  type GcLimit,
  type CollectGarbageDeps,
} from "./garbage-collector.js";

export {
  DeterministicSummarizer,
  deterministicSummarizer,
  TYPE_LABELS,
  type Summarizer,
} from "./summarizer.js";