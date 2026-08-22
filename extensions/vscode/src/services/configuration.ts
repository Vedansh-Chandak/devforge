/**
 * @devforge/vscode-extension — Configuration service (DF-020).
 *
 * Reads the `devforge.*` settings (settings.json) and exposes a validated
 * {@link ExtensionConfiguration}. The `vscode` namespace is injected so the
 * service is fully unit-testable in Node.
 */

import type {
  ExtensionConfiguration,
  RawExtensionSettings,
  ExtensionLogLevel,
} from '../types.js';
import { toCliOptions } from '../types.js';
import type { CliOptions } from '@vedansh78/cli';
import { ExtensionConfigError } from '../errors.js';

/** Default values for every extension setting. */
export const DEFAULT_EXTENSION_CONFIG: ExtensionConfiguration = {
  provider: 'fake',
  model: '',
  baseUrl: '',
  apiKey: '',
  maxAttempts: 3,
  autoRepair: true,
  confirmRiskyChanges: true,
  autoApprove: false,
  logLevel: 'info',
} as const;

/** The log levels accepted by the extension. */
export const EXTENSION_LOG_LEVELS: readonly ExtensionLogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
];

/** Environment variable names the extension can forward to the engine. */
export const ENV_KEYS = {
  provider: 'DEVFORGE_PROVIDER',
  model: 'DEVFORGE_MODEL',
  baseUrl: 'DEVFORGE_BASE_URL',
  apiKey: 'DEVFORGE_API_KEY',
  maxAttempts: 'DEVFORGE_MAX_REPAIR_ATTEMPTS',
  logLevel: 'DEVFORGE_LOG_LEVEL',
} as const;

/** Environment overrides forwarded to the engine during context creation. */
export type EnvOverrides = Readonly<Record<string, string | undefined>>;

/** Abstraction over the VS Code configuration API (injected). */
export interface ConfigurationReader {
  /** Read a single `devforge.<key>` setting, or undefined when unset. */
  get<T>(key: string): T | undefined;
}

/** Reader backed by the real VS Code workspace configuration API. */
export interface VscodeConfigurationLike {
  get<T>(section: string): T | undefined;
}

/** A reader that proxies to a VS Code `WorkspaceConfiguration` namespace. */
export class WorkspaceConfigurationReader implements ConfigurationReader {
  private readonly config: VscodeConfigurationLike;

  constructor(config: VscodeConfigurationLike) {
    this.config = config;
  }

  get<T>(key: string): T | undefined {
    return this.config.get<T>(key);
  }
}

/**
 * Map raw settings into a complete configuration, applying defaults and
 * validating value ranges. Returns the resolved config or throws an
 * {@link ExtensionConfigError} when a setting is malformed.
 */
export function resolveConfiguration(raw: RawExtensionSettings): ExtensionConfiguration {
  const logLevel = raw.logLevel ?? DEFAULT_EXTENSION_CONFIG.logLevel;
  if (!EXTENSION_LOG_LEVELS.includes(logLevel)) {
    throw new ExtensionConfigError(`Invalid devforge.logLevel "${raw.logLevel}": expected one of ${EXTENSION_LOG_LEVELS.join(', ')}`);
  }

  if (raw.provider !== undefined && raw.provider !== 'fake' && raw.provider !== 'openai-compatible') {
    throw new ExtensionConfigError(`Invalid devforge.provider "${raw.provider}": expected "fake" or "openai-compatible"`);
  }

  if (raw.maxAttempts !== undefined) {
    if (!Number.isInteger(raw.maxAttempts) || raw.maxAttempts < 0) {
      throw new ExtensionConfigError('devforge.maxAttempts must be a non-negative integer');
    }
  }

  if (raw.provider === 'openai-compatible') {
    const model = raw.model ?? DEFAULT_EXTENSION_CONFIG.model;
    const baseUrl = raw.baseUrl ?? DEFAULT_EXTENSION_CONFIG.baseUrl;
    if (!model) throw new ExtensionConfigError('devforge.provider "openai-compatible" requires devforge.model');
    if (!baseUrl) throw new ExtensionConfigError('devforge.provider "openai-compatible" requires devforge.baseUrl');
  }

  return {
    provider: raw.provider ?? DEFAULT_EXTENSION_CONFIG.provider,
    model: raw.model ?? DEFAULT_EXTENSION_CONFIG.model,
    baseUrl: raw.baseUrl ?? DEFAULT_EXTENSION_CONFIG.baseUrl,
    apiKey: raw.apiKey ?? DEFAULT_EXTENSION_CONFIG.apiKey,
    maxAttempts: raw.maxAttempts ?? DEFAULT_EXTENSION_CONFIG.maxAttempts,
    autoRepair: raw.autoRepair ?? DEFAULT_EXTENSION_CONFIG.autoRepair,
    confirmRiskyChanges: raw.confirmRiskyChanges ?? DEFAULT_EXTENSION_CONFIG.confirmRiskyChanges,
    autoApprove: raw.autoApprove ?? DEFAULT_EXTENSION_CONFIG.autoApprove,
    logLevel,
  };
}

/** Read raw settings from a {@link ConfigurationReader}. */
export function readRawSettings(reader: ConfigurationReader): RawExtensionSettings {
  return {
    provider: reader.get<'fake' | 'openai-compatible'>('provider'),
    model: reader.get<string>('model'),
    baseUrl: reader.get<string>('baseUrl'),
    apiKey: reader.get<string>('apiKey'),
    maxAttempts: reader.get<number>('maxAttempts'),
    autoRepair: reader.get<boolean>('autoRepair'),
    confirmRiskyChanges: reader.get<boolean>('confirmRiskyChanges'),
    autoApprove: reader.get<boolean>('autoApprove'),
    logLevel: reader.get<ExtensionLogLevel>('logLevel'),
  };
}

/**
 * Compute engine environment overrides for settings that were explicitly
 * configured. Only explicitly-set settings are forwarded so project/user
 * `devforge.json` files retain their precedence over defaults.
 */
export function toEnvOverrides(raw: RawExtensionSettings): EnvOverrides {
  const env: Record<string, string | undefined> = {};
  if (raw.provider !== undefined) env[ENV_KEYS.provider] = raw.provider;
  if (raw.model !== undefined) env[ENV_KEYS.model] = raw.model;
  if (raw.baseUrl !== undefined) env[ENV_KEYS.baseUrl] = raw.baseUrl;
  if (raw.apiKey !== undefined) env[ENV_KEYS.apiKey] = raw.apiKey;
  if (raw.maxAttempts !== undefined) env[ENV_KEYS.maxAttempts] = String(raw.maxAttempts);
  if (raw.logLevel !== undefined) env[ENV_KEYS.logLevel] = raw.logLevel;
  return env;
}

/**
 * The extension configuration service. Wraps a {@link ConfigurationReader},
 * resolves raw settings into a validated {@link ExtensionConfiguration}, and
 * derives CLI options for the engine.
 */
export class Configuration {
  private readonly reader: ConfigurationReader;
  private readonly onDidChange: (config: ExtensionConfiguration) => void;

  constructor(reader: ConfigurationReader, onDidChange?: (config: ExtensionConfiguration) => void) {
    this.reader = reader;
    this.onDidChange = onDidChange ?? (() => undefined);
  }

  /** Resolve and validate the current configuration. */
  read(): ExtensionConfiguration {
    return resolveConfiguration(readRawSettings(this.reader));
  }

  /** Derive CLI options (json/debug/autoApprove) from the current config. */
  toCliOptions(): CliOptions {
    return toCliOptions(this.read());
  }

  /** Derive engine environment overrides from explicitly-set settings. */
  toEnvOverrides(): EnvOverrides {
    return toEnvOverrides(readRawSettings(this.reader));
  }

  /** Notify subscribers that the configuration changed. */
  notifyChanged(): void {
    this.onDidChange(this.read());
  }
}
