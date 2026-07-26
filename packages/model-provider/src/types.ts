/**
 * DevForge Model Provider Abstraction
 * Provider-neutral interface for language models
 */

export type MessageRole = 'system' | 'user' | 'assistant';

export type FinishReason = 
  | 'stop' 
  | 'length' 
  | 'tool_call' 
  | 'content_filter' 
  | 'error' 
  | 'unknown';

export interface ModelMessage {
  role: MessageRole;
  content: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ModelResponse {
  content: string;
  model?: string;
  finishReason?: FinishReason;
  usage?: ModelUsage;
}

export interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}