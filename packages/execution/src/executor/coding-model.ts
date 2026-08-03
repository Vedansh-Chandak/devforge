/**
 * @devforge/execution — CodingModel interface and reference implementation (DF-016B).
 *
 * The CodingModel generates code patches from a request. This module defines
 * the interface and provides a deterministic fake implementation for testing.
 */

import type { CodePatch } from './patch-model.js';
import { CodingModelError } from './coding-errors.js';

/** Input to the coding model. */
export interface CodingModelRequest {
  /** High-level goal or task description. */
  readonly goal: string;
  /** Contextual information (file contents, errors, etc.). */
  readonly context: readonly string[];
  /** Number of patches already generated in this run (for budget tracking). */
  readonly generatedCount: number;
  /** Optional abort signal for cancellation. */
  readonly signal?: AbortSignal;
}

/** CodingModel interface — injectable for different providers. */
export interface CodingModel {
  /** Human-readable model identifier. */
  readonly name?: string;
  /**
   * Generate a batch of code patches.
   * @throws {CodingModelError} on cancellation, provider error, or budget exceeded.
   */
  generatePatch(input: CodingModelRequest): Promise<CodePatch[]>;
}

/** Result of a scripted coding model call for test introspection. */
export interface ScriptedCodingModel {
  model: CodingModel;
  readonly getCalls: () => number;
}

/**
 * Creates a deterministic fake CodingModel that returns pre-defined patch sets.
 * Exhausts the provided sets in order, then throws CodingModelError on subsequent calls.
 */
export function scriptedCodingModel(
  patchSets: readonly (readonly CodePatch[])[] = [],
): ScriptedCodingModel {
  let index = 0;
  let callCount = 0;

  const model: CodingModel = {
    name: 'scripted',
    async generatePatch(input: CodingModelRequest): Promise<CodePatch[]> {
      if (input.signal?.aborted) {
        throw new CodingModelError('Coding model cancelled', { code: 'CODING_CANCELLED' });
      }
      callCount += 1;
      const set = patchSets[index];
      if (!set) {
        throw new CodingModelError(
          `Scripted coding model exhausted: no patch set at index ${index}`,
          { code: 'PATCH_GENERATION_FAILED', patchId: `set-${index}` },
        );
      }
      index += 1;
      // Return deep copies to prevent mutation
      return set.map((p) => ({ ...p }));
    },
  };

  return { model, getCalls: () => callCount };
}

/**
 * Creates a CodingModel that always returns the same fixed patch set.
 * Useful for simple deterministic tests.
 */
export function fixedCodingModel(patches: readonly CodePatch[]): CodingModel {
  return {
    name: 'fixed',
    async generatePatch(): Promise<CodePatch[]> {
      return patches.map((p) => ({ ...p }));
    },
  };
}

/**
 * Creates a CodingModel that fails with a specific error.
 * Useful for testing error handling paths.
 */
export function failingCodingModel(error: Error): CodingModel {
  return {
    name: 'failing',
    async generatePatch(): Promise<CodePatch[]> {
      throw error;
    },
  };
}

/**
 * Creates a CodingModel that checks the abort signal and throws on cancellation.
 * Useful for testing cancellation propagation.
 */
export function cancellingCodingModel(): CodingModel {
  return {
    name: 'cancelling',
    async generatePatch(input: CodingModelRequest): Promise<CodePatch[]> {
      if (input.signal?.aborted) {
        throw new CodingModelError('Operation cancelled by signal', { code: 'CODING_CANCELLED' });
      }
      // If not cancelled, throw to indicate no patches generated
      throw new CodingModelError('No patches generated', { code: 'PATCH_GENERATION_FAILED' });
    },
  };
}

/**
 * Creates a CodingModel that delegates to a custom generator function.
 * The generator receives the request and returns patches or throws.
 */
export function customCodingModel(
  generator: (input: CodingModelRequest) => Promise<CodePatch[]>,
  name = 'custom',
): CodingModel {
  return {
    name,
    async generatePatch(input: CodingModelRequest): Promise<CodePatch[]> {
      return generator(input);
    },
  };
}