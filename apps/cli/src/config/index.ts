/**
 * @devforge/cli — Configuration subsystem (M1).
 */

export type {
  DevForgeConfig,
  RawDevForgeConfig,
  ProviderKind,
  LogLevel,
} from './config.js';
export {
  DEFAULT_CONFIG,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
} from './config.js';

export { validateConfig, isProviderKind } from './validator.js';
export type { ConfigValidationResult } from './validator.js';

export { loadConfig, loadFromEnv, loadJsonFile, userConfigPath } from './loader.js';