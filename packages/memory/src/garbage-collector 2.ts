/**
 * @devforge/memory — Bounded, deterministic garbage collection (DF-023).
 *
 * Enforces maximum record count, maximum storage size, expiration, duplicate
 * cleanup, and (caller-driven) obsolete-memory cleanup. Collection is fully
 * deterministic: identical inputs produce identical survivors and removal
 * order. Protected records — architecture/decision kinds above a confidence
 * threshold, or explicitly pinned IDs — are never evicted merely for age.
 */
import { compare } from "./ids.js";
import { contentHash } from "./text.js";
import { HIGH_CONFIDENCE, type MemoryRecord, type MemoryType } from "./types.js";

export interface GcConfig {
  /** Maximum record count after collection. */
  readonly maxRecords?: number;
  /** Maximum serialized byte budget after collection. */
  readonly maxBytes?: number;
  /** Records older than this (ms) are expiration candidates. */
  readonly maxAgeMs?: number;
  /** Memory types never evicted by GC (default: architecture, decision). */
  readonly protectedTypes?: readonly MemoryType[];
  /** Confidence at/above which a record is protected (default 0.8). */
  readonly protectHighConfidenceAbove?: number;
  /** Explicitly pinned record IDs. */
  readonly protectedIds?: readonly string[];
  /** Skip content-duplicate removal (default false => always dedupe). */
  readonly skipDuplicateCleanup?: boolean;
  /** Collector clock for age checks (default Date.now). */
  readonly now?: () => number;
}

export type GcLimit = "duplicates" | "age" | "records" | "bytes";

export interface GcResult {
  readonly removed: readonly MemoryRecord[];
  /** Reason per removed record id. */
  readonly reasons: ReadonlyMap<string, GcLimit>;
  readonly remaining: readonly MemoryRecord[];
  readonly sizeBefore: number;
  readonly sizeAfter: number;
  readonly protected: readonly MemoryRecord[];
}

const DEFAULT_PROTECTED: readonly MemoryType[] = ["architecture", "decision"];

export function defaultGcConfig(): Required<
  Pick<GcConfig, "protectedTypes" | "protectHighConfidenceAbove" | "skipDuplicateCleanup">
> {
  return {
    protectedTypes: [...DEFAULT_PROTECTED],
    protectHighConfidenceAbove: HIGH_CONFIDENCE,
    skipDuplicateCleanup: false,
  };
}

/** Pure deterministic protection predicate. */
export function isProtected(record: MemoryRecord, config: GcConfig): boolean {
  const defaults = defaultGcConfig();
  const protectedTypes = new Set(
    config.protectedTypes ?? defaults.protectedTypes,
  );
  const threshold =
    config.protectHighConfidenceAbove ?? defaults.protectHighConfidenceAbove;
  if (config.protectedIds?.includes(record.id)) return true;
  if (protectedTypes.has(record.type) && record.confidence >= threshold) {
    return true;
  }
  return false;
}

/** Deterministic eviction ordering: weakest first. */
export function evictionPriority(a: MemoryRecord, b: MemoryRecord): number {
  const pa = a.importance * a.confidence;
  const pb = b.importance * b.confidence;
  if (pa !== pb) return pa - pb;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  // Deterministic final tie-break: larger id evicted first, so the surviving
  // duplicate of an equal-age pair is the one with the smaller id.
  return compare(a.id, b.id) * -1;
}

export interface CollectGarbageDeps {
  readonly sizeOf: (records: readonly MemoryRecord[]) => number;
  readonly duplicateKey: (record: MemoryRecord) => string;
}

const DEFAULT_DEPS: CollectGarbageDeps = {
  sizeOf: (records) => {
    let bytes = 0;
    for (const record of records) {
      bytes += Buffer.byteLength(JSON.stringify(record), "utf8");
    }
    return bytes;
  },
  duplicateKey: (record) =>
    contentHash(record.repositoryId, record.type, record.title, record.data),
};

/**
 * Run the collection pipeline over a snapshot of records. Pure and
 * deterministic; the repository facade persists the surviving records.
 */
export function collectGarbage(
  records: readonly MemoryRecord[],
  config: GcConfig = {},
  deps: CollectGarbageDeps = DEFAULT_DEPS,
): GcResult {
  const now = config.now?.() ?? Date.now();
  const removed: MemoryRecord[] = [];
  const reasons = new Map<string, GcLimit>();
  let working = records.slice();

  function markRemoved(record: MemoryRecord, reason: GcLimit): void {
    removed.push(record);
    reasons.set(record.id, reason);
  }

  // 1. Duplicate cleanup: one survivor per content key.
  if (!(config.skipDuplicateCleanup ?? defaultGcConfig().skipDuplicateCleanup)) {
    const keepByKey = new Map<string, MemoryRecord>();
    for (const record of working) {
      const key = deps.duplicateKey(record);
      const existing = keepByKey.get(key);
      if (!existing || newerThan(record, existing)) keepByKey.set(key, record);
    }
    const survivors = new Set(
      Array.from(keepByKey.values()).map((record) => record.id),
    );
    for (const record of working) {
      if (!survivors.has(record.id)) markRemoved(record, "duplicates");
    }
    working = working.filter((record) => !reasons.has(record.id));
  }

  // 2. Expiration (protected records are exempt).
  if (config.maxAgeMs !== undefined && config.maxAgeMs >= 0) {
    for (const record of working) {
      const age = now - record.createdAt;
      if (age > config.maxAgeMs && !isProtected(record, config)) {
        markRemoved(record, "age");
      }
    }
    working = working.filter((record) => !reasons.has(record.id));
  }

  // 3. Maximum record count.
  if (config.maxRecords !== undefined && config.maxRecords >= 0) {
    const evictable = working
      .filter((record) => !isProtected(record, config))
      .slice()
      .sort(evictionPriority);
    const overage = Math.max(0, working.length - config.maxRecords);
    const toEvict = new Set(evictable.slice(0, overage).map((r) => r.id));
    for (const record of working) {
      if (toEvict.has(record.id)) markRemoved(record, "records");
    }
    working = working.filter((record) => !reasons.has(record.id));
  }

  // 4. Maximum serialized size.
  if (config.maxBytes !== undefined && config.maxBytes >= 0) {
    const evictable = working
      .filter((record) => !isProtected(record, config))
      .slice()
      .sort(evictionPriority);
    for (const candidate of evictable) {
      if (deps.sizeOf(working) <= config.maxBytes) break;
      if (!working.some((record) => record.id === candidate.id)) continue;
      markRemoved(candidate, "bytes");
      working = working.filter((record) => record.id !== candidate.id);
    }
  }

  const protectedRecords = working
    .filter((record) => isProtected(record, config))
    .sort((a, b) => compare(a.id, b.id));

  const sizeBefore = deps.sizeOf(records);
  const sizeAfter = deps.sizeOf(working);
  removed.sort((a, b) => compare(a.id, b.id));

  return {
    removed,
    reasons,
    remaining: working,
    sizeBefore,
    sizeAfter,
    protected: protectedRecords,
  };
}

function newerThan(a: MemoryRecord, b: MemoryRecord): boolean {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}