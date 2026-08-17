/**
 * @devforge/benchmark — Typed errors (DF-024).
 *
 * Every failure mode of the benchmark framework raises a {@link BenchmarkError}
 * subtype so callers can distinguish dataset problems, fixture problems,
 * execution problems, and persistence problems without string matching.
 */

/** Base class for all benchmark framework errors. */
export class BenchmarkError extends Error {
  /** Stable, machine-readable error code. */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Raised when a dataset cannot be parsed, loaded, or satisfies its schema. */
export class DatasetError extends BenchmarkError {
  constructor(message: string) {
    super(message, "dataset");
  }
}

/** Raised when a task or dataset fails structural validation. */
export class TaskValidationError extends BenchmarkError {
  constructor(message: string) {
    super(message, "task_validation");
  }
}

/** Raised when a fixture cannot be created, initialized, or cleaned up. */
export class FixtureError extends BenchmarkError {
  constructor(message: string) {
    super(message, "fixture");
  }
}

/** Raised when a task exceeds its configured time budget. */
export class TimeoutError extends BenchmarkError {
  constructor(message: string) {
    super(message, "timeout");
  }
}

/** Raised when a run is cancelled while inside an execution step. */
export class CancelledError extends BenchmarkError {
  constructor(message: string) {
    super(message, "cancelled");
  }
}

/** Raised when a DevForge adapter misbehaves. */
export class AdapterError extends BenchmarkError {
  constructor(message: string) {
    super(message, "adapter");
  }
}

/** Raised when task execution fails for a non-cancellation, non-timeout reason. */
export class TaskExecutionError extends BenchmarkError {
  constructor(message: string) {
    super(message, "task_execution");
  }
}

/** Raised when a grader cannot grade the configured verification. */
export class GraderError extends BenchmarkError {
  constructor(message: string) {
    super(message, "grader");
  }
}

/** Raised when the result store cannot read or write a run. */
export class ResultStoreError extends BenchmarkError {
  constructor(message: string) {
    super(message, "result_store");
  }
}

/** Raised when an artifact cannot be stored or read back. */
export class ArtifactAccessError extends BenchmarkError {
  constructor(message: string) {
    super(message, "artifact");
  }
}

/** Raised when stored data fails integrity checks (checksum/schema). */
export class CorruptStoreError extends BenchmarkError {
  constructor(message: string) {
    super(message, "corrupt_store");
  }
}

/** Raised when a regression evaluation cannot be performed. */
export class RegressionError extends BenchmarkError {
  constructor(message: string) {
    super(message, "regression");
  }
}