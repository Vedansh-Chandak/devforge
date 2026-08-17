/**
 * @devforge/vscode-extension — Shared type definitions (DF-020).
 *
 * Wire types shared between the extension host, the DevForge client, the
 * language server, and the VS Code views. No logic lives here.
 */

import type {
  CliOptions,
  DevForgeConfig as CliDevForgeConfig,
  ExecutionContext,
  LightCliContext,
  RepositoryContext,
} from '@devforge/cli';
import type { GitDiff } from '@devforge/execution';
import type { ExecutionPlan, PlanResult } from '@devforge/planner';

/** Minimal logger surface used across the extension host. */
export interface LoggerLike {
  trace?(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** The set of DevForge commands exposed by the extension. */
export type DevForgeCommand =
  | 'ask'
  | 'plan'
  | 'fix'
  | 'review'
  | 'run'
  | 'explain'
  | 'status'
  | 'doctor';

/** All command identifiers known to the extension. */
export const DEVFORGE_COMMANDS: readonly DevForgeCommand[] = [
  'ask',
  'plan',
  'fix',
  'review',
  'run',
  'explain',
  'status',
  'doctor',
] as const;

/** Whether a command requires the full execution context (AI + executor). */
export function isHeavyCommand(command: DevForgeCommand): boolean {
  return command === 'ask' || command === 'plan' || command === 'fix' ||
    command === 'review' || command === 'run' || command === 'explain';
}

/** A machine-readable error surfaced by the client. */
export interface DevForgeCommandError {
  readonly code: string;
  readonly message: string;
}

/** Result of running a single DevForge command through the client. */
export interface CommandResult {
  readonly command: DevForgeCommand;
  /** Arguments passed to the command (question/goal/topic). */
  readonly args: readonly string[];
  readonly ok: boolean;
  /** Markdown/human readable rendering for the chat panel. */
  readonly text: string;
  /** Structured payload (ExecutionReport, CodingReport, PlanResult, ...). */
  readonly data: unknown;
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  readonly error?: DevForgeCommandError;
}

/** Result of a structured planning request. */
export type PlanQueryResult =
  | { readonly ok: true; readonly plan: ExecutionPlan }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } };

/** Payload for a diff preview document (used by the diff provider). */
export interface DiffDocument {
  /** The diff document uri. */
  readonly uri: string;
  /** Unified diff text (left = HEAD, right = working tree). */
  readonly text: string;
  /** Files touched by the diff. */
  readonly files: readonly string[];
  /** Whether a patch is currently pending (awaiting apply/reject). */
  readonly pending: boolean;
  /** Original patch id for apply/reject routing. */
  readonly patchId?: string;
}

/** Resolved DevForge extension configuration (see services/configuration.ts). */
export interface ExtensionConfiguration {
  /** Model provider kind. */
  readonly provider: CliDevForgeConfig['provider'];
  /** Model identifier for openai-compatible providers. */
  readonly model: string;
  /** Base URL for openai-compatible providers. */
  readonly baseUrl: string;
  /** API key for openai-compatible providers. */
  readonly apiKey: string;
  /** Maximum repair attempts (devforge.maxAttempts). */
  readonly maxAttempts: number;
  /** Automatically repair failures (devforge.autoRepair). */
  readonly autoRepair: boolean;
  /** Confirm risky changes before applying them (devforge.confirmRiskyChanges). */
  readonly confirmRiskyChanges: boolean;
  /** Auto-approve confirmation-gated plan steps (devforge.autoApprove). */
  readonly autoApprove: boolean;
  /** Log verbosity (devforge.logLevel). */
  readonly logLevel: CliDevForgeConfig['logLevel'];
}

/** Raw settings shape read from `devforge.*` VS Code settings keys. */
export interface RawExtensionSettings {
  readonly provider?: CliDevForgeConfig['provider'];
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly maxAttempts?: number;
  readonly autoRepair?: boolean;
  readonly confirmRiskyChanges?: boolean;
  readonly autoApprove?: boolean;
  readonly logLevel?: CliDevForgeConfig['logLevel'];
}

/** Log levels accepted by the extension and forwarded to the engine. */
export type ExtensionLogLevel = CliDevForgeConfig['logLevel'];

/** A single entry in the task history view. */
export interface TaskRecord {
  readonly id: string;
  readonly command: DevForgeCommand;
  readonly args: readonly string[];
  readonly startedAt: number;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly summary: string;
}

/** A single session bound to a workspace root. */
export interface DevForgeSession {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly createdAt: number;
  /** Activity recorded for this session (task history). */
  readonly tasks: readonly TaskRecord[];
}

/** Minimal structural shape of the CLI contexts used by the extension. */
export type { CliOptions, ExecutionContext, LightCliContext, RepositoryContext };
export type { CliDevForgeConfig };
export type { GitDiff, ExecutionPlan, PlanResult };

/** Build CLI options from an extension configuration. */
export function toCliOptions(config: ExtensionConfiguration): CliOptions {
  return {
    json: true,
    debug: config.logLevel === 'debug' || config.logLevel === 'trace',
    autoApprove: config.autoApprove,
  };
}

/** Convert a CLI PlanningError/result into a PlanQueryResult. */
export function planResultToQueryResult(result: PlanResult): PlanQueryResult {
  if (result.ok) {
    return { ok: true, plan: result.plan };
  }
  return {
    ok: false,
    error: { code: result.error.code, message: result.error.message, retryable: result.error.retryable },
  };
}
