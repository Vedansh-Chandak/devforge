/**
 * Deterministic tool fingerprinting (DF-011.5 Phase 1).
 *
 * stableStringify() serialises a value such that two structurally-equal
 * values always produce the same string, regardless of key insertion order.
 * Arrays preserve their original order. No external dependencies.
 */

/**
 * Deterministic JSON serialisation with recursively sorted object keys.
 *
 * - Object keys are sorted lexicographically at every level.
 * - Array element order is preserved.
 * - undefined / function / symbol values are omitted from objects and
 *   serialised as null in arrays, mirroring JSON.stringify semantics.
 * - Unsupported primitives (bigint) fall back to String(value).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(value: unknown): unknown {
  if (value === null) return null;

  const t = typeof value;
  switch (t) {
    case 'string':
    case 'number':
    case 'boolean':
      return value;
    case 'bigint':
      return String(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      // JSON.stringify drops these at object level; arrays map to null.
      return undefined;
    case 'object':
      break;
    default:
      return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const n = normalise(item);
      return n === undefined ? null : n;
    });
  }

  // Plain object (or class instance treated as one).
  const out: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    const n = normalise((value as Record<string, unknown>)[key]);
    if (n !== undefined) {
      out[key] = n;
    }
  }
  return out;
}

/**
 * Build a stable, deterministic fingerprint string for a tool invocation.
 * Two calls with the same toolId and structurally-equal args always
 * produce the same fingerprint, regardless of argument key order.
 */
export function createToolFingerprint(toolId: string, args: unknown): string {
  return `${toolId}:${stableStringify(args ?? null)}`;
}
