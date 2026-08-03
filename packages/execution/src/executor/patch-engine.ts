/**
 * @devforge/execution — PatchEngine interface and implementation (DF-016B).
 *
 * The PatchEngine coordinates patch generation via CodingModel and provides
 * structural validation. Workspace-aware validation is handled separately.
 */

import type { CodingModel, CodingModelRequest } from './coding-model.js';
import type { CodePatch } from './patch-model.js';
import { validatePatchStructureBatch, defaultPatchValidationConfig } from './patch-validator.js';
import { PatchGenerationError } from './coding-errors.js';

/** Request to generate patches. */
export interface PatchGenerationRequest {
  readonly goal: string;
  readonly context: readonly string[];
  readonly generatedCount: number;
  readonly signal?: AbortSignal;
}

/** Result of patch generation with metadata. */
export interface PatchGenerationResult {
  readonly patches: readonly CodePatch[];
  readonly structuralValidation: {
    readonly valid: boolean;
    readonly violations: readonly PatchViolation[];
  };
}

/** PatchEngine interface — injectable for different implementations. */
export interface PatchEngine {
  readonly name?: string;
  /**
   * Generate patches for a coding request.
   * Performs structural validation; throws PatchGenerationError on failure.
   */
  generate(request: PatchGenerationRequest): Promise<readonly CodePatch[]>;
}

/** Violation type for structural validation results. */
export interface PatchViolation {
  readonly code: string;
  readonly message: string;
  readonly patchId?: string;
  readonly file?: string;
}

/** Configuration for the default patch engine. */
export interface PatchEngineConfig {
  /** Coding model to use for generation. */
  readonly model: CodingModel;
  /** Structural validation config. */
  readonly validationConfig?: PatchEngineValidationConfig;
}

/** Structural validation config. */
export interface PatchEngineValidationConfig {
  readonly maxPatchBytes?: number;
  readonly maxTotalPatchBytes?: number;
}

/** Default patch engine implementation. */
export class DefaultPatchEngine implements PatchEngine {
  readonly name: string;
  private readonly model: CodingModel;
  private readonly validationConfig: Required<PatchEngineValidationConfig>;
  private generationCount = 0;

  constructor(config: PatchEngineConfig) {
    this.name = `default-patch-engine${config.model.name ? `(${config.model.name})` : ''}`;
    this.model = config.model;
    this.validationConfig = {
      maxPatchBytes: config.validationConfig?.maxPatchBytes ?? 256 * 1024,
      maxTotalPatchBytes: config.validationConfig?.maxTotalPatchBytes ?? 1024 * 1024,
    };
  }

  /** Number of times generate() has been called. */
  get generations(): number {
    return this.generationCount;
  }

  async generate(request: PatchGenerationRequest): Promise<readonly CodePatch[]> {
    if (request.signal?.aborted) {
      throw new PatchGenerationError('Patch generation cancelled', { code: 'CODING_CANCELLED' });
    }

    // Convert to CodingModelRequest
    const modelRequest: CodingModelRequest = {
      goal: request.goal,
      context: request.context,
      generatedCount: request.generatedCount,
      signal: request.signal,
    };

    // Generate patches via model
    let patches: CodePatch[];
    try {
      patches = await this.model.generatePatch(modelRequest);
    } catch (error) {
      if (error instanceof PatchGenerationError) throw error;
      throw new PatchGenerationError(
        `Coding model failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    // Structural validation
    const validation = validatePatchStructureBatch(patches, {
      maxPatchBytes: this.validationConfig.maxPatchBytes,
      maxTotalPatchBytes: this.validationConfig.maxTotalPatchBytes,
    });

    if (!validation.valid) {
      throw new PatchGenerationError('Structural validation failed', {
        code: 'PATCH_VALIDATION_FAILED',
        cause: validation.violations,
      });
    }

    this.generationCount += 1;
    return validation.normalized;
  }
}

/** Factory for the default patch engine. */
export function createPatchEngine(config: PatchEngineConfig): PatchEngine {
  return new DefaultPatchEngine(config);
}

/**
 * A patch engine that returns fixed patches (for testing without a model).
 */
export function fixedPatchEngine(
  patches: readonly CodePatch[],
  name = 'fixed',
): PatchEngine {
  let callCount = 0;
  return {
    name,
    async generate(): Promise<readonly CodePatch[]> {
      callCount += 1;
      return patches.map((p) => ({ ...p }));
    },
  };
}

/**
 * A patch engine that fails with a specific error (for testing).
 */
export function failingPatchEngine(error: Error): PatchEngine {
  return {
    name: 'failing',
    async generate(): Promise<readonly CodePatch[]> {
      throw error;
    },
  };
}

/**
 * A patch engine that wraps another and counts calls (for testing).
 */
export function countingPatchEngine(inner: PatchEngine): PatchEngine & { readonly calls: number } {
  let calls = 0;
  const wrapper: PatchEngine = {
    name: `counting(${inner.name ?? 'unknown'})`,
    async generate(request: PatchGenerationRequest): Promise<readonly CodePatch[]> {
      calls += 1;
      return inner.generate(request);
    },
  };
  return Object.defineProperty(wrapper, 'calls', { get: () => calls }) as PatchEngine & {
    readonly calls: number;
  };
}