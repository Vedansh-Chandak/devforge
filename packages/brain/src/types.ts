import type { ModelUsage, FinishReason } from '@devforge/model-provider';

export type IntentKind =
  | 'ExplainCode'
  | 'FindSymbol'
  | 'FindDependencies'
  | 'Architecture'
  | 'Search'
  | 'Unknown';

export interface RuntimeInterface {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  execute(): Promise<RuntimeResult>;
}

export interface RuntimeResult {
  success: boolean;
  context: unknown;
  duration: number;
}

export interface ModelProviderInterface {
  readonly id: string;
  generate(request: {
    messages: { role: string; content: string }[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<ModelProviderResponse>;
}

export interface ModelProviderResponse {
  content: string;
  model?: string;
  finishReason?: FinishReason;
  usage?: ModelUsage;
}

export interface BrainToolExecutionConfig {
  /** Whether model-originated tool execution is enabled. Default: false. */
  enabled: boolean;
  /** Execution mode. Only 'read-only' is supported. */
  execution: 'read-only';
  /** Maximum tool executions per response. Default: 5. */
  maxExecutions?: number;
}

export interface BrainConfig {
  runtime: RuntimeInterface;
  provider?: ModelProviderInterface;
  /** Max characters for the combined user message content (default: 100000) */
  maxContextChars?: number;
  /** Tool execution configuration. Disabled by default. */
  toolExecution?: BrainToolExecutionConfig;
  /** Tool registry for model-originated tool execution (required if toolExecution.enabled) */
  toolRegistry?: unknown;
  /** Provider of execution context for model-originated tool calls */
  executionContextProvider?: () => unknown;
}

export interface BrainState {
  initialized: boolean;
}

export interface ClassifyIntentResult {
  intent: IntentKind;
  confidence: number;
  keywords: string[];
}

/**
 * Result when the brain classifies the intent but does not call the model.
 * Returned for Unknown intents, invalid input, or when no provider is configured.
 */
export interface AskClassifiedResult {
  question: string;
  intent: IntentKind;
  status: 'classified';
  timestamp: string;
  runtimeReady: boolean;
}

/**
 * Result when the brain completes the full pipeline and calls the model.
 */
export interface BrainAnswer {
  question: string;
  intent: IntentKind;
  status: 'answered';
  answer: string;
  model: {
    provider: string;
    model?: string;
    finishReason?: FinishReason;
    usage?: ModelUsage;
  };
  metadata: {
    contextTruncated: boolean;
    duration: number;
    runtimeDuration: number;
    providerDuration: number;
  };
}

/**
 * Result when the brain encounters invalid input.
 */
export interface BrainInvalidInput {
  question: string;
  intent: IntentKind;
  status: 'invalid';
  error: string;
}

/**
 * Result when the provider fails.
 */
export interface BrainProviderError {
  question: string;
  intent: IntentKind;
  status: 'provider_error';
  error: string;
  errorCode?: string;
  retryable?: boolean;
}

/**
 * Per-call tool execution result in the Brain response.
 */
export interface BrainToolCallResult {
  readonly callId: string;
  readonly toolId: string;
  readonly status: 'completed' | 'failed' | 'denied' | 'not_found' | 'limit_exceeded';
  readonly result?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Result when the brain executes model-originated tool calls and stops.
 * No second model call is made. ToolResult is NOT sent back to the model.
 */
export interface BrainToolExecuted {
  question: string;
  intent: IntentKind;
  status: 'tool_executed';
  toolCalls: BrainToolCallResult[];
  metadata: {
    contextTruncated: boolean;
    duration: number;
    runtimeDuration: number;
    providerDuration: number;
    toolExecutionDuration: number;
    totalToolCalls: number;
    successfulCalls: number;
    failedCalls: number;
  };
}

export type AskResult = AskClassifiedResult | BrainAnswer | BrainInvalidInput | BrainProviderError | BrainToolExecuted;
