/**
 * @devforge/core — Application Composition Layer
 *
 * Single entry point for creating a fully-wired DevForge application.
 *
 * Usage:
 *   import { createDevForge } from '@devforge/core';
 *   const app = await createDevForge({ repository: { root: '/path' }, model: { provider: 'fake' } });
 *   await app.initialize();
 *   const result = await app.ask('Explain authentication');
 *   await app.dispose();
 */

export { createDevForge } from './app.js';
export { createModelProvider, createRawModelProvider } from './provider-factory.js';
export { createModelRouterFromConfig } from './router.js';
export { validateConfig, validateProviderConfig, parseEnvConfig, mergeConfig } from './config.js';
export { DevForgeConfigError } from './types.js';
export type {
  DevForgeConfig,
  DevForgeApplication,
  DevForgeDiagnosticsResult,
  DevForgeEnvConfig,
  ModelProviderConfig,
  ProviderKind,
  FakeProviderConfig,
  OpenAICompatibleProviderConfig,
  GeminiProviderConfig,
  AnthropicProviderConfig,
  RoleModelsConfig,
} from './types.js';