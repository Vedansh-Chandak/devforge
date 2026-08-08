import { DuplicateFileError } from "./errors.js";

/**
 * A stable, dependency-free FNV-1a 32-bit hash returned as an 8-character hex
 * string. Deterministic across runs and platforms, which the cache relies on
 * for incremental differentials.
 */
export function fingerprint(content: string): string {
  let hashValue = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    hashValue ^= content.charCodeAt(i);
    hashValue = Math.imul(hashValue, 0x01000193);
    hashValue >>>= 0;
  }
  return hashValue.toString(16).padStart(8, "0");
}

/** A fingerprint for a whole graph built from `fingerprints`. */
export function graphHash(fingerprints: Iterable<string>): string {
  return fingerprint(Array.from(fingerprints).sort().join("|"));
}

/** Result of {@link IncrementalCache.diff} describing what must go and stay. */
export interface CacheDiff {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly retained: ReadonlyArray<string>;
}

/**
 * Incremental, in-memory content cache keyed by relative repository path.
 *
 * Internally it stores the latest fingerprint for each known path as well as
 * AST/graph digests. `diff` accepts a full set of current fingerprints and
 * returns exactly the files that need to be re-read and re-parsed.
 */
export class IncrementalCache {
  private readonly fingerprints = new Map<string, string>();
  private readonly astHashes = new Map<string, string>();
  private _graphDigest: string | undefined;

  constructor(private readonly hashFn: (content: string) => string = fingerprint) {}

  has(path: string): boolean {
    return this.fingerprints.has(path);
  }

  get(path: string): string | undefined {
    return this.fingerprints.get(path);
  }

  set(path: string, content: string): void {
    this.fingerprints.set(path, this.hashFn(content));
    this.astHashes.set(path, this.hashFn(content));
  }

  invalidate(path: string): void {
    this.fingerprints.delete(path);
    this.astHashes.delete(path);
  }

  get size(): number {
    return this.fingerprints.size;
  }

  get paths(): ReadonlyArray<string> {
    return Array.from(this.fingerprints.keys());
  }

  get graphDigest(): string | undefined {
    return this._graphDigest;
  }

  recordGraphDigest(fingerprints: Iterable<string>): string {
    this._graphDigest = graphHash(fingerprints);
    return this._graphDigest;
  }

  /**
   * Given freshly-scanned fingerprints, resolve which files must change.
   * Paths not previously known are new; known paths whose fingerprint differs
   * are changed; previously known paths no longer present are removed; the
   * rest are retained and may be served from the current parse cache.
   */
  diff(current: ReadonlyMap<string, string>): CacheDiff {
    const added: string[] = [];
    const changed: string[] = [];
    const removed: string[] = [];
    const retained: string[] = [];

    for (const [path, fp] of current) {
      if (!this.fingerprints.has(path)) {
        added.push(path);
      } else if (this.fingerprints.get(path) !== fp) {
        changed.push(path);
      } else {
        retained.push(path);
      }
    }
    for (const path of this.paths) {
      if (!current.has(path)) {
        removed.push(path);
      }
    }

    return { added, changed, removed, retained };
  }

  /**
   * Register a batch of files whose content is now known, detecting
   * duplicates.
   */
  register(fileContents: ReadonlyMap<string, string>): void {
    for (const [path, content] of fileContents) {
      if (this.fingerprints.has(path)) {
        throw new DuplicateFileError(path);
      }
      this.set(path, content);
    }
  }
}