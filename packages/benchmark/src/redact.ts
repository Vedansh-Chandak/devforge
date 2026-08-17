/**
 * @devforge/benchmark — Deterministic redaction (DF-024).
 *
 * Benchmark artifacts, reports, and stored results must never leak API keys,
 * tokens, passwords, or Git/model credentials. Redaction reuses
 * `@devforge/memory`'s deterministic {@link redactSecrets} engine and augments
 * it with environment-derived known secrets. Identical input yields identical
 * output on every call.
 */
import { redactSecrets, REDACTED } from "@devforge/memory";
import type { Environment } from "./environment.js";
import { secretValuesFrom } from "./environment.js";

export { REDACTED };

export interface RedactOptions {
  /** Values to always redact (credentials, tokens, passwords). */
  readonly knownSecrets?: readonly string[];
  /** Env-derived secrets added to {@link knownSecrets}. */
  readonly environment?: Environment;
  /** Disables high-entropy heuristic detection. */
  readonly disableHeuristic?: boolean;
}

/** Redact marks every secret-shaped site with {@link REDACTED}. */
export function redactValue(
  value: string,
  options: RedactOptions = {},
): string {
  const known = new Set<string>();
  for (const secret of options.knownSecrets ?? []) {
    if (secret.length > 0) known.add(secret);
  }
  if (options.environment) {
    for (const secret of secretValuesFrom(options.environment)) {
      known.add(secret);
    }
  }
  return redactSecrets(value, {
    knownSecrets: Array.from(known),
    disableHeuristic: options.disableHeuristic,
  });
}

/** Batch redaction that preserves object structure and key order. */
export function redactRecord<T>(value: T, options: RedactOptions = {}): T {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      return redactValue(value, options) as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactRecord(item, options)) as unknown as T;
  }
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    next[key] = redactRecord(record[key], options);
  }
  return next as T;
}

/** True when the input still contains any of the given secret values. */
export function containsSecret(
  value: string,
  secrets: readonly string[],
): boolean {
  const present = new Set<string>();
  for (const secret of secrets) {
    if (secret.length > 0 && value.includes(secret)) present.add(secret);
  }
  return present.size > 0;
}