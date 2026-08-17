export type ContextErrorCode =
  | "NOT_INDEXED"
  | "FILE_NOT_FOUND"
  | "SYMBOL_NOT_FOUND"
  | "INVALID_QUERY"
  | "INVALID_PATH"
  | "DUPLICATE_FILE"
  | "SCAN_FAILED";

/** Base error type for every failure surfaced by the context engine. */
export class ContextEngineError extends Error {
  readonly code: ContextErrorCode;

  constructor(code: ContextErrorCode, message: string) {
    super(message);
    this.name = "ContextEngineError";
    this.code = code;
  }
}

/** Thrown when an operation requires an index that has not been built yet. */
export class IndexNotReadyError extends ContextEngineError {
  constructor(message = "Repository index has not been built yet.") {
    super("NOT_INDEXED", message);
  }
}

/** Thrown when a requested file is not present in the index. */
export class FileNotFoundError extends ContextEngineError {
  readonly filePath: string;

  constructor(filePath: string) {
    super("FILE_NOT_FOUND", `File not found in repository index: ${filePath}`);
    this.filePath = filePath;
  }
}

/** Thrown when a requested symbol cannot be resolved. */
export class SymbolNotFoundError extends ContextEngineError {
  readonly symbolName: string;

  constructor(symbolName: string) {
    super("SYMBOL_NOT_FOUND", `Symbol not found in repository index: ${symbolName}`);
    this.symbolName = symbolName;
  }
}

/** Thrown when a query is empty or otherwise unusable. */
export class InvalidQueryError extends ContextEngineError {
  constructor(message: string) {
    super("INVALID_QUERY", message);
  }
}

/** Thrown when a file path is malformed or escapes the index root. */
export class InvalidPathError extends ContextEngineError {
  readonly filePath: string;

  constructor(filePath: string) {
    super("INVALID_PATH", `Invalid repository file path: ${filePath}`);
    this.filePath = filePath;
  }
}

/** Thrown when the same logical file is registered more than once. */
export class DuplicateFileError extends ContextEngineError {
  readonly filePath: string;

  constructor(filePath: string) {
    super("DUPLICATE_FILE", `Duplicate file registered for the same path: ${filePath}`);
    this.filePath = filePath;
  }
}

/** Thrown when scanning a repository root fails (wraps scan failures). */
export class ScanFailedError extends ContextEngineError {
  readonly root: string;

  constructor(root: string, message: string) {
    super("SCAN_FAILED", message);
    this.root = root;
  }
}