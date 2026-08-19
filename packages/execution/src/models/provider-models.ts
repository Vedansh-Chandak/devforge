/**
 * @devforge/execution — Provider-backed Models (DF-016C).
 *
 * CodingModel and ReasoningModel implementations backed by a ModelProvider.
 * They build prompts, call the provider, parse the response, and translate
 * provider/parse failures into the executor error contract (CodingModelError /
 * ReasoningError).
 */

import type { ModelProvider } from '@devforge/model-provider';
import { ModelProviderError, isModelProviderError, redactSecrets } from '@devforge/model-provider';
import type { CodePatch } from '../executor/patch-model.js';
import type { CodingModel, CodingModelRequest } from '../executor/coding-model.js';
import type { ReasoningModel, FailureAnalysis, RepairDecision, FailureAnalysisInput, RepairDecisionInput } from '../executor/reasoning-model.js';
import { CodingModelError, ReasoningError } from '../executor/coding-errors.js';
import type { ModelSettings } from './types.js';
import { parsePatches } from './patch-parser.js';
import { parseFailureAnalysis, parseRepairDecision } from './reasoning-parser.js';
import { buildPatchPrompt, buildFailureAnalysisPrompt, buildRepairDecisionPrompt } from './prompt-builder.js';

/** Default generation settings. */
const DEFAULT_SETTINGS: Required<Pick<ModelSettings, 'temperature' | 'maxTokens'>> = {
  temperature: 0.2,
  maxTokens: 8192,
};

/** Options for a provider-backed CodingModel. */
export interface ProviderCodingModelOptions {
  readonly provider: ModelProvider;
  readonly settings?: ModelSettings;
  readonly name?: string;
}

/** Options for a provider-backed ReasoningModel. */
export interface ProviderReasoningModelOptions {
  readonly provider: ModelProvider;
  readonly settings?: ModelSettings;
  readonly name?: string;
}

/**
 * CodingModel backed by a ModelProvider.
 * Builds the patch prompt, calls generate, parses and validates the output.
 */
export class ProviderCodingModel implements CodingModel {
  readonly name?: string;
  readonly provider: ModelProvider;
  readonly settings: ModelSettings;

  constructor(options: ProviderCodingModelOptions) {
    this.provider = options.provider;
    this.settings = options.settings ?? {};
    this.name = options.name ?? `${options.provider.id}-coding`;
  }

  async generatePatch(input: CodingModelRequest): Promise<CodePatch[]> {
    if (input.signal?.aborted) {
      throw new CodingModelError('Coding model cancelled', { code: 'CODING_CANCELLED' });
    }

    const messages = buildPatchPrompt(input, this.settings.systemPrompt);
    const request = {
      messages,
      temperature: this.settings.temperature ?? DEFAULT_SETTINGS.temperature,
      maxTokens: this.settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens,
      signal: input.signal,
    };

    let response;
    try {
      response = await this.provider.generate(request);
    } catch (error) {
      throw translateProviderError(error, CodingModelError);
    }

    const parsed = parsePatches(response.content);
    if (!parsed.ok) {
      throw new CodingModelError(
        `Failed to parse patch output: ${parsed.error.message}`,
        { code: 'PATCH_GENERATION_FAILED', cause: parsed.error },
      );
    }

    return Array.from(parsed.value);
  }
}

/**
 * ReasoningModel backed by a ModelProvider.
 * Runs failure analysis and repair decisions through the provider.
 */
export class ProviderReasoningModel implements ReasoningModel {
  readonly name?: string;
  readonly provider: ModelProvider;
  readonly settings: ModelSettings;

  constructor(options: ProviderReasoningModelOptions) {
    this.provider = options.provider;
    this.settings = options.settings ?? {};
    this.name = options.name ?? `${options.provider.id}-reasoning`;
  }

  async analyzeFailure(input: FailureAnalysisInput): Promise<FailureAnalysis> {
    const messages = buildFailureAnalysisPrompt(input, this.settings.systemPrompt);
    const request = {
      messages,
      temperature: this.settings.temperature ?? DEFAULT_SETTINGS.temperature,
      maxTokens: this.settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens,
      signal: input.signal,
    };

    let response;
    try {
      response = await this.provider.generate(request);
    } catch (error) {
      throw translateProviderError(error, ReasoningError);
    }

    const parsed = parseFailureAnalysis(response.content);
    if (!parsed.ok) {
      throw new ReasoningError(
        `Failed to parse failure analysis: ${parsed.error.message}`,
        { cause: parsed.error },
      );
    }

    return parsed.value;
  }

  async decideRepair(input: RepairDecisionInput): Promise<RepairDecision> {
    const messages = buildRepairDecisionPrompt(input, this.settings.systemPrompt);
    const request = {
      messages,
      temperature: this.settings.temperature ?? DEFAULT_SETTINGS.temperature,
      maxTokens: this.settings.maxTokens ?? DEFAULT_SETTINGS.maxTokens,
      signal: input.signal,
    };

    let response;
    try {
      response = await this.provider.generate(request);
    } catch (error) {
      throw translateProviderError(error, ReasoningError);
    }

    const parsed = parseRepairDecision(response.content);
    if (!parsed.ok) {
      throw new ReasoningError(
        `Failed to parse repair decision: ${parsed.error.message}`,
        { cause: parsed.error },
      );
    }

    return parsed.value;
  }
}

/** Translate a thrown provider error into the executor error contract. */
function translateProviderError(
  error: unknown,
  Ctor: typeof CodingModelError | typeof ReasoningError,
): Error {
  const safeMessage = (message: string): string => redactSecrets(message);
  const cause = sanitizedCause(error);
  if (error instanceof ModelProviderError) {
    if (error.retryable || error.code === 'RATE_LIMITED' || error.code === 'TIMEOUT' || error.code === 'NETWORK_ERROR') {
      return new Ctor(`Provider error (retryable): ${safeMessage(error.message)}`, {
        cause,
      });
    }
    return new Ctor(`Provider error: ${safeMessage(error.message)}`, { cause });
  }
  if (isModelProviderError(error)) {
    return new Ctor(`Provider error: ${safeMessage(error.message)}`, { cause });
  }
  if (error instanceof Error) {
    return new Ctor(`Model call failed: ${safeMessage(error.message)}`, { cause });
  }
  return new Ctor(`Model call failed: ${safeMessage(String(error))}`);
}

/** Redacted clone of an upstream error so secrets never ride in `cause`. */
function sanitizedCause(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const message = redactSecrets(error.message);
  const clone = new Error(message);
  clone.name = error.name;
  return clone;
}