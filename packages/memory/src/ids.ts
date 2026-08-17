/**
 * @devforge/memory — Deterministic IDs and canonical serialization (DF-023).
 *
 * Memory IDs are content-derived where possible so identical records collapse
 * to the same ID and every duplicate is handled the same way on every run.
 */
import { createHash } from "node:crypto";

/** SHA-256 hex digest. Deterministic for identical inputs. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Truncated SHA-256 usable as a compact stable ID. */
export function shortHash(input: string, length = 16): string {
  return sha256(input).slice(0, length);
}

/** Sort two strings lexicographically for canonical output. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deterministic stable stringification: object keys are sorted recursively,
 * arrays preserve order, primitives use JSON semantics. The output of two
 * structurally-equal values is byte-identical regardless of key insertion.
 */
export function stableStringify(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareStrings);
  const parts: string[] = [];
  for (const key of keys) {
    const serialized = serialize(record[key]);
    if (serialized === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(",")}}`;
}

export { compareStrings as compare };