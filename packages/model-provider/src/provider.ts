import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from './types.js';
import { ModelProviderError } from './errors.js';

/**
 * Base class for model provider implementations
 */
export abstract class BaseModelProvider implements ModelProvider {
  abstract readonly id: string;

  abstract generate(request: ModelRequest): Promise<ModelResponse>;

  protected validateRequest(request: ModelRequest): void {
    if (!request.messages || request.messages.length === 0) {
      throw new ModelProviderError('Request must contain at least one message', {
        provider: this.id,
        code: 'INVALID_REQUEST',
      });
    }

    for (const message of request.messages) {
      if (!message.content || typeof message.content !== 'string') {
        throw new ModelProviderError('Message content must be a non-empty string', {
          provider: this.id,
          code: 'INVALID_REQUEST',
        });
      }

      if (!['system', 'user', 'assistant'].includes(message.role)) {
        throw new ModelProviderError(`Invalid message role: ${message.role}`, {
          provider: this.id,
          code: 'INVALID_REQUEST',
        });
      }
    }
  }
}