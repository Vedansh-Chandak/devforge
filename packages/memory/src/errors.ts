/**
 * @devforge/memory — Error hierarchy (DF-023).
 */

import type { MemoryType } from "./types.js";

export type MemoryErrorCode =
  | "INVALID_RECORD"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "REPOSITORY_MISMATCH"
  | "STORAGE_CORRUPT"
  | "LIMIT_EXCEEDED"
  | "CLOSED"
  | "INVALID_ID";

/** Base error for every failure surfaced by the memory package. */
export class MemoryError extends Error {
  readonly code: MemoryErrorCode;

  constructor(code: MemoryErrorCode, message: string) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
  }
}

/** Thrown when a record violates the invariants of its memory type. */
export class InvalidRecordError extends MemoryError {
  constructor(message: string) {
    super("INVALID_RECORD", message);
  }
}

/** Thrown when a target record cannot be found. */
export class NotFoundError extends MemoryError {
  readonly id: string;

  constructor(id: string) {
    super("NOT_FOUND", `Memory record not found: ${id}`);
    this.id = id;
  }
}

/** Thrown when a record would create a conflicting non-deterministic state. */
export class DuplicateRecordError extends MemoryError {
  readonly id: string;

  constructor(id: string, message: string) {
    super("DUPLICATE", message);
    this.id = id;
  }
}

/** Thrown when a record's repositoryId does not match the owning repository. */
export class RepositoryMismatchError extends MemoryError {
  readonly expected: string;
  readonly actual: string;

  constructor(expected: string, actual: string) {
    super(
      "REPOSITORY_MISMATCH",
      `Memory record repository '${actual}' does not match repository '${expected}'`,
    );
    this.expected = expected;
    this.actual = actual;
  }
}

/** Thrown when persisted storage cannot be trusted and recovery is needed. */
export class StorageCorruptError extends MemoryError {
  readonly path: string;

  constructor(path: string, message: string) {
    super("STORAGE_CORRUPT", message);
    this.path = path;
  }
}

/** Thrown when a store rejects a write that exceeds a configured bound. */
export class LimitExceededError extends MemoryError {
  constructor(message: string) {
    super("LIMIT_EXCEEDED", message);
  }
}

/** Thrown when an operation targets a closed memory instance. */
export class ClosedMemoryError extends MemoryError {
  constructor() {
    super("CLOSED", "The memory instance is closed.");
  }
}

/** Validate a memory type; throws {@link InvalidRecordError} on bad input. */
export function assertMemoryType(type: string): asserts type is MemoryType {
  if (
    type !== "architecture" &&
    type !== "convention" &&
    type !== "decision" &&
    type !== "task" &&
    type !== "failure" &&
    type !== "session"
  ) {
    throw new InvalidRecordError(`Unknown memory type: ${type}`);
  }
}