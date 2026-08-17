import type { ModelRequest } from '@devforge/model-provider';

/**
 * Intent kinds supported by the prompt composer.
 * Mirrors Brain's IntentKind without creating a dependency.
 */
export type IntentKind =
  | 'ExplainCode'
  | 'FindSymbol'
  | 'FindDependencies'
  | 'Architecture'
  | 'Search'
  | 'Unknown';

/**
 * Structured symbol information from Runtime
 */
export interface ComposerSymbol {
  name: string;
  kind?: string;
  file?: string;
  module?: string;
  location?: string;
}

/**
 * Structured dependency information
 */
export interface ComposerDependency {
  from: string;
  to: string;
}

/**
 * Structured architecture information
 */
export interface ComposerArchitecture {
  modules?: string[];
  services?: string[];
  apis?: string[];
  repositories?: string[];
  databases?: string[];
  relationships?: ComposerDependency[];
}

/**
 * Runtime context provided to the composer
 */
export interface ComposerContext {
  symbols?: ComposerSymbol[];
  dependencies?: ComposerDependency[];
  architecture?: ComposerArchitecture;
  searchResults?: ComposerSymbol[];
  raw?: string;
}

/**
 * Input to the Prompt Composer
 */
export interface ComposerInput {
  question: string;
  intent: IntentKind;
  context: ComposerContext;
}

/**
 * Configuration for the Prompt Composer
 */
export interface PromptComposerConfig {
  /** Maximum characters for the combined user message content */
  maxContextChars?: number;
}

/**
 * Result of prompt composition
 */
export interface ComposerResult {
  request: ModelRequest;
  truncated: boolean;
}