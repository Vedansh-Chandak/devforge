/** Shared helper types for the typed memory facades (DF-023). */
export type StoreConfigLike = { now?: () => number };

export type StoreProps = { now?: () => number };

/**
 * Partial patch shape used by typed `update` operations: the core payload
 * fields plus the mutable envelope fields.
 */
export type TypePatch<I extends object, K extends keyof I> = Partial<Pick<I, K>> &
  Partial<{
    confidence?: number;
    importance?: number;
    tags?: readonly string[];
    source?: string;
  }>;