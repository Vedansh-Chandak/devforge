/**
 * @devforge/errors — envelope + lifecycle tests (DF-025 Phases 3 & 8).
 */
import { describe, expect, it } from "vitest";
import {
  toEnvelope,
  isCancellation,
  isTimeout,
  redactSecretText,
  safeMessage,
  LifecycleEmitter,
  lifecycle,
} from "./index.js";

describe("error envelope construction", () => {
  it("maps a plain Error to a deterministic SYSTEM envelope", () => {
    const envelope = toEnvelope(new Error("boom"));
    expect(envelope.category).toBe("SYSTEM");
    expect(envelope.component).toBe("unknown");
    expect(envelope.retryable).toBe(false);
    expect(envelope.message).toBe("boom");
    expect(typeof envelope.timestamp).toBe("string");
    expect(envelope.code.length).toBeGreaterThan(0);
  });

  it("preserves the cause chain", () => {
    const cause = new Error("root cause");
    const outer = new Error("wrapped", { cause });
    const envelope = toEnvelope(outer);
    expect(envelope.cause).toBe(cause);
  });

  it("detects cancellation from name, code, and message", () => {
    expect(isCancellation(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(
      toEnvelope(new Error("Cancelled by user", { cause: undefined }) as never),
    ).toBeDefined();
    const coded = new Error("cancelled") as Error & { code: string };
    coded.name = "CustomError";
    coded.code = "CANCELLED";
    expect(isCancellation(coded)).toBe(true);
    const envelope = toEnvelope(coded as unknown);
    expect(envelope.category).toBe("CANCELLATION");
    expect(envelope.retryable).toBe(false);
    expect(envelope.code).toBe("CANCELLED");
  });

  it("detects timeout from code and message", () => {
    const timed = new Error("Request timed out after 1000ms") as Error & { code: string };
    timed.name = "ModelProviderError";
    timed.code = "TIMEOUT";
    expect(isTimeout(timed)).toBe(true);
    const envelope = toEnvelope(timed);
    expect(envelope.category).toBe("TIMEOUT");
    expect(envelope.retryable).toBe(false);
  });

  it("distinguishes user errors from system errors", () => {
    const user = new Error("bad input") as Error & { code: string };
    user.code = "INVALID_REQUEST";
    expect(toEnvelope(user).category).toBe("USER");

    const sys = new Error("provider exploded") as Error & { code: string };
    sys.code = "PROVIDER_ERROR";
    expect(toEnvelope(sys).category).toBe("SYSTEM");
  });

  it("detects retryable errors from the retryable flag", () => {
    const retryable = new Error("throttled") as Error & {
      retryable: boolean;
      code: string;
    };
    retryable.retryable = true;
    retryable.code = "RATE_LIMITED";
    expect(toEnvelope(retryable).retryable).toBe(true);
  });

  it("derives codes from class names deterministically", () => {
    class WorkspaceToastError extends Error {}
    const err = new WorkspaceToastError("x");
    const envelope = toEnvelope(err);
    expect(envelope.code).toBe("WORKSPACE_TOAST");
    expect(envelope.component).toBe("workspace");
  });

  it("detects the component from known error class names", () => {
    class ExecutorBoomError extends Error {}
    class GitSplitError extends Error {}
    class MemoryLooseError extends Error {}
    class ToolLostError extends Error {}
    expect(toEnvelope(new ExecutorBoomError("x")).component).toBe("execution");
    expect(toEnvelope(new GitSplitError("x")).component).toBe("git");
    expect(toEnvelope(new MemoryLooseError("x")).component).toBe("memory");
    expect(toEnvelope(new ToolLostError("x")).component).toBe("tools");
  });

  it("applies explicit options over detected values", () => {
    const envelope = toEnvelope(new Error("x"), {
      code: "CUSTOM_CODE",
      component: "cli",
      operation: "plan",
      retryable: true,
      metadata: { attempt: 1 },
    });
    expect(envelope.code).toBe("CUSTOM_CODE");
    expect(envelope.component).toBe("cli");
    expect(envelope.operation).toBe("plan");
    expect(envelope.retryable).toBe(true);
    expect(envelope.metadata).toEqual({ attempt: 1 });
  });

  it("uses an injected clock for deterministic timestamps", () => {
    const envelope = toEnvelope(new Error("x"), { now: () => "2026-01-01T00:00:00.000Z" });
    expect(envelope.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is safe with non-Error unknown values", () => {
    expect(toEnvelope("plain string").message).toBe("plain string");
    expect(safeMessage(undefined)).toBe("unknown error");
    expect(toEnvelope(null).category).toBe("SYSTEM");
  });
});

describe("message redaction", () => {
  it("redacts API-key-shaped and bearer tokens", () => {
    const message =
      "Authorization: Bearer sk-abc123def456; api_key=supersecret12345; API-KEY: xyz";
    const redacted = redactSecretText(message);
    expect(redacted).not.toContain("sk-abc123def456");
    expect(redacted).not.toContain("supersecret12345");
    expect(redacted).not.toContain("xyz");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts environment interpolation", () => {
    const redacted = redactSecretText("token=${OPENAI_API_KEY} via process.env.OPENAI_API_KEY");
    expect(redacted).not.toContain("OPENAI_API_KEY");
  });

  it("redacts private key blocks", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END RSA PRIVATE KEY-----";
    const redacted = redactSecretText(pem);
    expect(redacted).not.toContain("MIIEvQIBADANBg");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts URL userinfo", () => {
    const redacted = redactSecretText("connect to https://user:pass@example.com/db");
    expect(redacted).not.toContain("user:pass");
    expect(redacted).toContain("[REDACTED]@");
  });

  it("applies redaction through toEnvelope by default", () => {
    const envelope = toEnvelope(new Error("Bearer sk-secret-1234"));
    expect(envelope.message).not.toContain("sk-secret-1234");
  });

  it("can skip redaction when explicitly requested", () => {
    const envelope = toEnvelope(new Error("Bearer sk-secret-1234"), {
      skipRedaction: true,
    });
    expect(envelope.message).toContain("sk-secret-1234");
  });
});

describe("lifecycle events", () => {
  it("emits deterministic sequence and ids", () => {
    const emitter = new LifecycleEmitter({ now: () => "2026-01-01T00:00:00.000Z" });
    const first = emitter.emit(lifecycle.planningStarted());
    const second = emitter.emit(lifecycle.planningCompleted());
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
    expect(first.id).toBe("planner:0");
    expect(second.id).toBe("planner:1");
    expect(first.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("preserves deterministic ordering via sequence", () => {
    const emitter = new LifecycleEmitter({ now: () => "2026-01-01T00:00:00.000Z" });
    emitter.emit(lifecycle.taskStarted());
    emitter.emit(lifecycle.planningStarted());
    emitter.emit(lifecycle.planningCompleted());
    emitter.emit(lifecycle.verificationStarted());
    emitter.emit(lifecycle.taskCompleted());
    expect(emitter.events.map((e) => e.operation)).toEqual([
      "task",
      "planning",
      "planning",
      "verification",
      "task",
    ]);
    expect(emitter.count).toBe(5);
  });

  it("filters events by operation", () => {
    const emitter = new LifecycleEmitter();
    emitter.emit(lifecycle.repairStarted(1));
    emitter.emit(lifecycle.verificationStarted());
    emitter.emit(lifecycle.repairCompleted());
    expect(emitter.eventsFor("repair").length).toBe(2);
    expect(emitter.eventsFor("verification").length).toBe(1);
  });

  it("carries safe metadata only", () => {
    const emitter = new LifecycleEmitter();
    const event = emitter.emit(
      lifecycle.modelCallCompleted({ model: "gpt-4o", finishReason: "stop" }),
    );
    expect(event.metadata).toEqual({ model: "gpt-4o", finishReason: "stop" });
  });

  it("represents cancellation, timeout, and failure distinctly", () => {
    const emitter = new LifecycleEmitter();
    const cancelled = emitter.emit(lifecycle.cancellation("user pressed ctrl-c"));
    const timedOut = emitter.emit(lifecycle.timeout("plan exceeded 30s"));
    const failed = emitter.emit(lifecycle.failure("verification failed"));
    expect(cancelled.status).toBe("cancelled");
    expect(timedOut.status).toBe("timed_out");
    expect(failed.status).toBe("failed");
  });

  it("represents repair attempts with attempt metadata", () => {
    const emitter = new LifecycleEmitter();
    emitter.emit(lifecycle.repairStarted(3));
    const attempts = emitter.eventsFor("repair").filter((e) => e.status === "started");
    expect(attempts[0]?.metadata).toEqual({ attempt: 3 });
  });
});