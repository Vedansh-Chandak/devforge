import type { ModelRequest } from '@devforge/model-provider';
import type {
  ComposerInput,
  PromptComposerConfig,
  ComposerResult,
} from './types.js';
import { SYSTEM_MESSAGE } from './templates.js';
import { buildUserContent, truncateContent } from './formatter.js';

const DEFAULT_MAX_CONTEXT_CHARS = 100000;

/**
 * Deterministic prompt composer.
 * Converts question + intent + structured context into a provider-neutral ModelRequest.
 * Never calls a model. Never produces side effects.
 */
export class PromptComposer {
  private maxContextChars: number;

  constructor(config?: PromptComposerConfig) {
    this.maxContextChars = config?.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  }

  /**
   * Compose a ModelRequest from input.
   * Returns null for Unknown intent — no model request should be generated.
   */
  compose(input: ComposerInput): ComposerResult | null {
    const { question, intent, context } = input;

    if (intent === 'Unknown') {
      return null;
    }

    const userContent = buildUserContent(question, context);
    const { content: truncatedContent, truncated } = truncateContent(
      userContent,
      this.maxContextChars,
    );

    const request: ModelRequest = {
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: truncatedContent },
      ],
    };

    return { request, truncated };
  }
}

/**
 * Standalone function interface for composing prompts.
 */
export function composePrompt(
  input: ComposerInput,
  config?: PromptComposerConfig,
): ComposerResult | null {
  const composer = new PromptComposer(config);
  return composer.compose(input);
}