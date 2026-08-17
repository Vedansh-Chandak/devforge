/**
 * @devforge/errors — cross-system error envelope (DF-025 Phase 3).
 *
 * A dependency-free, additive model for passing structured errors across
 * package boundaries. It does NOT replace existing per-package error classes
 * (ModelProviderError, ToolError, ExecutorError, ...) — it provides a uniform
 * envelope that any consumer (notably the CLI and reports) can map to, with:
 *
 *   - deterministic `code`
 *   - a `category` that separates user vs system errors, cancellation vs
 *     failure, and timeout vs generic failure
 *   - `retryable` so retry loops can decide deterministically
 *   - preserved `cause` chain
 *   - optional `operation` / `component` / `timestamp` / `metadata`
 *   - message redaction: never stringify arbitrary Error objects that may
 *     contain secrets or environment information into user-facing output
 */

/** High-level error bucket used across the system. */
export type ErrorCategory =
  /** Caused by invalid user input or user action (not a system fault). */
  | "USER"
  /** Caused by an internal system failure (model, tool, infra, bug). */
  | "SYSTEM"
  /** Cancellation (user or caller requested stop). Distinct from failure. */
  | "CANCELLATION"
  /** A deadline/timer elapsed. Distinct from generic failure. */
  | "TIMEOUT";

/** Deterministic string code attached to every envelope. */
export type ErrorCode = string;

/** Machine-readable components that may produce errors. */
export type ErrorComponent =
  | "cli"
  | "config"
  | "brain"
  | "planner"
  | "execution"
  | "workspace"
  | "command-runner"
  | "git"
  | "verification"
  | "repair"
  | "autonomous"
  | "multi-agent"
  | "memory"
  | "model-provider"
  | "tools"
  | "runtime"
  | "benchmark"
  | "github"
  | "unknown";

/**
 * The uniform error envelope. Every field except `message` and `code` is
 * optional so existing errors can be wrapped without inventing data.
 */
export interface ErrorEnvelope {
  /** Deterministic, stable error code (e.g. "MODEL_TIMEOUT", "REPO_MUTATED"). */
  readonly code: ErrorCode;
  /** Human-readable message. MUST be redacted before reaching user output. */
  readonly message: string;
  /** Error category. Defaults to "SYSTEM". */
  readonly category: ErrorCategory;
  /** Whether a deterministic retry may help. Defaults to `false`. */
  readonly retryable: boolean;
  /** Original cause, when an error was wrapped. Never leaked into output. */
  readonly cause?: unknown;
  /** The operation that failed (e.g. "plan", "generate", "verify"). */
  readonly operation?: string;
  /** The component that produced the error. Defaults to "unknown". */
  readonly component: ErrorComponent;
  /** ISO timestamp of when the envelope was created. */
  readonly timestamp: string;
  /** Arbitrary safe metadata. Secret values must be redacted before set. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Options controlling envelope construction. */
export interface EnvelopeOptions {
  /** Stable code. When absent, derived from category if possible. */
  readonly code?: ErrorCode;
  /** Override component. Detected from the error when omitted. */
  readonly component?: ErrorComponent;
  /** Operation name (e.g. "plan", "generate"). Defaults to "unknown". */
  readonly operation?: string;
  /** Force retryable. Detected from the error when omitted. */
  readonly retryable?: boolean;
  /** Extra safe metadata. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Timestamp source. Defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
  /** When true, no char-level redaction is applied to the message. */
  readonly skipRedaction?: boolean;
}

/** True when a value is an Error instance. */
export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

/** Extract a safe message from an unknown thrown value. */
export function safeMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value === null || value === undefined) return "unknown error";
  try {
    return String(value);
  } catch {
    return "unknown error";
  }
}

/** Detect errors that represent a cancellation. */
export function isCancellationError(value: unknown): value is Error {
  if (isError(value)) {
    const className = classNameOf(value);
    if (className.includes("Cancell") || className.includes("Abort")) return true;
    const name = value.name ?? "";
    if (name.includes("AbortError") || name.includes("Cancell")) return true;
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" && /CANCELLED|CANCELED|ABORT/i.test(code)) {
      return true;
    }
  }
  return false;
}

/** Detect errors that represent a timeout. */
export function isTimeoutError(value: unknown): value is Error {
  if (isError(value)) {
    const className = classNameOf(value);
    if (className.includes("Timeout")) return true;
    const name = value.name ?? "";
    if (name.includes("Timeout")) return true;
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" && /TIMEOUT|DEADLINE/i.test(code)) return true;
    const message = value.message ?? "";
    if (/timed out after|deadline exceeded|timeout occurred/i.test(message)) {
      return true;
    }
  }
  return false;
}

/** Detect retryable errors by common shape heuristics. */
function detectRetryable(value: unknown): boolean {
  if (isError(value)) {
    const retryable = (value as { retryable?: unknown }).retryable;
    if (typeof retryable === "boolean") return retryable;
    const code = (value as { code?: string }).code;
    if (typeof code === "string") {
      if (isCancellationError(value) || isTimeoutError(value)) return false;
      return /RATE_LIMITED|NETWORK|RETRYABLE|PROVIDER_ERROR/i.test(code);
    }
  }
  return false;
}

/**
 * Deterministic redaction of secret-shaped material inside error messages so
 * API keys, bearer tokens, passwords, private-key blocks and environment
 * interpolations never reach user-facing output, logs, or reports.
 */
export function redactSecretText(value: string): string {
  let output = value;
  output = output.replace(/\$\{([A-Z0-9_]+)\}/gi, "[REDACTED]");
  output = output.replace(/process\.env\.([A-Z0-9_]+)/gi, "[REDACTED]");
  output = output.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  output = output.replace(
    /\b(API[-_ ]?KEY|AUTHORIZATION|X-API-KEY|X-AUTH-TOKEN)\s*[:=]\s*("[^"]*"|\S+)/gi,
    (_match, header: string) => `${header}=[REDACTED]`,
  );
  output = output.replace(
    /-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g,
    "-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----",
  );
  output = output.replace(
    /(\b\w+:\/\/)([^/@\s]+)@/g,
    (_match, scheme: string) => `${scheme}[REDACTED]@`,
  );
  return output;
}

/**
 * Build a {@link ErrorEnvelope} from any thrown/unknown value without throwing
 * itself. Safe to use in catch-all handlers and top-level CLI boundaries.
 */
export function toEnvelope(value: unknown, options: EnvelopeOptions = {}): ErrorEnvelope {
  const now = options.now ?? (() => new Date().toISOString());
  const message = safeMessage(value);

  let category: ErrorCategory = "SYSTEM";
  if (isCancellationError(value)) {
    category = "CANCELLATION";
  } else if (isTimeoutError(value)) {
    category = "TIMEOUT";
  } else if (isUserError(value)) {
    category = "USER";
  }

  const component = options.component ?? detectComponent(value);
  const code =
    options.code ??
    detectCode(value) ??
    fallbackCode(category, component);
  const retryable = options.retryable ?? detectRetryable(value);

  return {
    code,
    message: options.skipRedaction ? message : redactSecretText(message),
    category,
    retryable,
    ...(value instanceof Error && value.cause !== undefined
      ? { cause: value.cause }
      : {}),
    operation: options.operation,
    component,
    timestamp: now(),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}

/** True for structurally-identified user/validation errors. */
function isUserError(value: unknown): boolean {
  if (!isError(value)) return false;
  const code = (value as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return /VALIDATION|INVALID|NOT_FOUND|USAGE|CONFIG|PERMISSION|DENIED|EMPTY|REQUIRED|UNSUPPORTED/i.test(
    code,
  );
}

/** Detect a component from error shape/class name. */
function detectComponent(value: unknown): ErrorComponent {
  if (!isError(value)) return "unknown";
  const name = classNameOf(value);
  if (name.includes("Config")) return "config";
  if (name.includes("Provider")) return "model-provider";
  if (name.includes("Planning")) return "planner";
  if (name.includes("Tool")) return "tools";
  if (name.includes("Command") || name.includes("Sandbox") || name.includes("Git")) {
    return name.includes("Git") ? "git" : "command-runner";
  }
  if (name.includes("Workspace")) return "workspace";
  if (name.includes("Executor") || name.includes("Verification")) {
    return name.includes("Verification") ? "verification" : "execution";
  }
  if (name.includes("Autonomous") || name.includes("Repair")) {
    return name.includes("Repair") ? "repair" : "autonomous";
  }
  if (name.includes("MultiAgent")) return "multi-agent";
  if (name.includes("Memory")) return "memory";
  if (name.includes("Runtime")) return "runtime";
  if (name.includes("Benchmark")) return "benchmark";
  if (name.includes("Cli")) return "cli";
  return "unknown";
}

/** Extract a stable code from structurally-typed errors. */
function detectCode(value: unknown): ErrorCode | undefined {
  if (isError(value)) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    const className = classNameOf(value);
    if (className && !CLASS_NAME_IGNORED.has(className)) {
      return snakeOf(className.replace(/(?:Error|Cancellation)$/i, ""));
    }
  }
  return undefined;
}

const CLASS_NAME_IGNORED = new Set(["Error", "TypeError", "RangeError", "EvalError", "URIError", "SyntaxError", "ReferenceError"]);

/** The declared class name of an error instance (constructor). */
function classNameOf(value: Error): string {
  const ctor = (value as { constructor?: { name?: string } }).constructor;
  return ctor?.name && ctor.name.length > 0 ? ctor.name : value.name;
}

/** Deterministic fallback code from category + component. */
function fallbackCode(category: ErrorCategory, component: ErrorComponent): string {
  const comp = component === "unknown" ? "SYSTEM" : component.toUpperCase().replaceAll("-", "_");
  switch (category) {
    case "CANCELLATION":
      return `${comp}_CANCELLED`;
    case "TIMEOUT":
      return `${comp}_TIMEOUT`;
    case "USER":
      return `${comp}_INVALID`;
    default:
      return `${comp}_ERROR`;
  }
}

/** Convert a class name to a deterministic UPPER_SNAKE code. */
function snakeOf(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
}

/** Short helpers for hot paths. */
export function isCancellation(value: unknown): boolean {
  return isCancellationError(value);
}

export function isTimeout(value: unknown): boolean {
  return isTimeoutError(value);
}