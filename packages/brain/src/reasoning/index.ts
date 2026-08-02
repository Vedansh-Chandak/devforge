/**
 * DF-011.5 Phase 1 — bounded reasoning building blocks.
 *
 * This module barrel re-exports the pure reasoning infrastructure used by
 * the brain. Phase 1 does not touch the brain itself; it only provides
 * the deterministic primitives a future reasoning loop will consume.
 */

export * from './limits.js';
export * from './fingerprint.js';
export * from './state.js';
export * from './evidence.js';
export * from './progress.js';
