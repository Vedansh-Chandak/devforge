import { BaseModelProvider } from '../provider.js';
import type { ModelRequest, ModelResponse } from '../types.js';
import { ModelProviderError } from '../errors.js';

export interface FakeProviderConfig {
  response?: ModelResponse;
  error?: {
    message: string;
    code: 'AUTHENTICATION_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'NETWORK_ERROR' | 'INVALID_REQUEST' | 'MODEL_NOT_FOUND' | 'PROVIDER_ERROR' | 'UNKNOWN';
    retryable?: boolean;
  };
  delay?: number;
}

export class FakeModelProvider extends BaseModelProvider {
  readonly id = 'fake-provider';

  private config: FakeProviderConfig;
  private requestHistory: ModelRequest[] = [];

  constructor(config: FakeProviderConfig = {}) {
    super();
    this.config = config;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.validateRequest(request);
    this.requestHistory.push(request);

    if (this.config.delay) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delay));
    }

    if (this.config.error) {
      throw new ModelProviderError(this.config.error.message, {
        provider: this.id,
        code: this.config.error.code,
        retryable: this.config.error.retryable,
      });
    }

    return this.config.response ?? {
      content: 'Fake response',
      model: 'fake-model',
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
    };
  }

  getRequestHistory(): ModelRequest[] {
    return [...this.requestHistory];
  }

  clearHistory(): void {
    this.requestHistory = [];
  }
}