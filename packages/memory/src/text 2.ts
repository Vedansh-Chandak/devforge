/**
 * @devforge/memory — Deterministic text preprocessing and memory indexing (DF-023).
 *
 * Tokenization and the canonical free-text projection of a memory record are
 * pure and deterministic: identical input yields identical output. Both the
 * store's primitive search and the retrieval/ranking layers build on these.
 */
import { compare, stableStringify } from "./ids.js";
import { REDACTED } from "./secrets.js";
import type { MemoryRecord } from "./types.js";

/** Split text into lowercased alphanumeric tokens in source order. */
export function tokenize(input: string): readonly string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);
}

/** Set of unique tokens for a piece of text, sorted deterministically. */
export function uniqueTokens(input: string): readonly string[] {
  const set = new Set(tokenize(input));
  return Array.from(set).sort(compare);
}

export interface TokenSet {
  readonly tokens: readonly string[];
  readonly lookups: ReadonlySet<string>;
}

/** A sorted, O(1)-lookup token bag for a text span. */
export function tokenSet(input: string): TokenSet {
  const tokens = uniqueTokens(input);
  return { tokens, lookups: new Set(tokens) };
}

/** Count unique query tokens present in the target text. */
export function tokenHits(
  queryTokens: readonly string[],
  target: string,
): number {
  const set = new Set<string>();
  for (const token of tokenize(target)) {
    if (queryTokens.includes(token)) set.add(token);
  }
  return set.size;
}

/** Jaccard overlap between two token sets, 0 when disjoint. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let inter = 0;
  for (const token of aSet) {
    if (bSet.has(token)) inter += 1;
  }
  const union = new Set<string>([...aSet, ...bSet]).size;
  return inter / union;
}

/** True when every query token appears in the text (word-boundary exact). */
export function containsAllTokens(
  queryTokens: readonly string[],
  target: string,
): boolean {
  if (queryTokens.length === 0) return false;
  const targetTokens = new Set(tokenize(target));
  return queryTokens.every((token) => targetTokens.has(token));
}

/** True when the raw (whitespace-normalized) query appears in the text. */
export function containsPhrase(query: string, target: string): boolean {
  if (query.length === 0) return false;
  const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedTarget = target.replace(/\s+/g, " ").toLowerCase();
  return normalizedTarget.includes(normalizedQuery);
}

/**
 * Canonical free-text projection of a memory record, used for indexing,
 * retrieval, ranking, and summarization inputs. Never contains secrets that
 * would not reach disk: markers are kept opaque.
 */
export function memoryText(record: MemoryRecord): string {
  const parts: string[] = [record.title];
  switch (record.type) {
    case "architecture":
      parts.push(record.data.owner, record.data.responsibility);
      parts.push(...record.data.constraints);
      break;
    case "convention":
      parts.push(record.data.category, record.data.convention);
      break;
    case "decision":
      parts.push(
        record.data.decision,
        record.data.rationale,
        record.data.affectedArea,
      );
      break;
    case "task":
      parts.push(
        record.data.task,
        record.data.outcome,
        ...record.data.affectedFiles,
        ...record.data.tests,
        ...record.data.failures,
        ...record.data.repairs,
      );
      break;
    case "failure":
      parts.push(
        record.data.fingerprint,
        record.data.errorCategory,
        record.data.affectedSubsystem,
        record.data.attemptedSolution,
        record.data.result,
      );
      break;
    case "session":
      parts.push(
        record.data.sessionId,
        record.data.userRequest,
        ...record.data.actions,
        record.data.result,
        ...record.data.discoveries,
      );
      break;
  }
  parts.push(...record.tags);
  return parts.join(" ");
}

/** A permanent unique determinism check across structured content. */
export function contentHash(
  repositoryId: string,
  type: string,
  title: string,
  data: unknown,
): string {
  return (stableStringify as (value: unknown) => string)({
    repositoryId,
    type,
    title,
    data,
  });
}

/** Omit per-run fields so structurally identical records compare equal. */
export function sameContent<T>(a: T, b: T, fields: readonly (keyof T)[]): boolean {
  if (a === b) return true;
  return fields.every((field) => a[field] === b[field]);
}

/** Deterministic marker for redacted text reused in summaries. */
export { REDACTED };