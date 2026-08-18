/**
 * Tool System Types — core contracts for the DevForge tool abstraction.
 *
 * This file defines the provider-neutral Tool interface, metadata,
 * identity, side-effects, permissions, execution context, results,
 * errors, and model-facing schemas.
 */

import type { z } from 'zod';

// ── Tool Identity ──

/**
 * Branded string type for Tool IDs.
 * Format: `namespace.name` (e.g. `repository.search`, `filesystem.read`).
 */
export type ToolId = string & { readonly __brand: 'ToolId' };

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9-]*$/;

/**
 * Validate and construct a ToolId.
 * @throws {Error} if the id doesn't match namespace.name format
 */
export function createToolId(id: string): ToolId {
  if (!TOOL_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid ToolId "${id}". Must match pattern: namespace.name ` +
      `(lowercase alphanumeric, dots as separator, e.g. "repository.search").`,
    );
  }
  return id as ToolId;
}

// ── Side Effects ──

/** Declares the side-effect level of a tool. */
export type SideEffectLevel = 'none' | 'read' | 'write' | 'process' | 'network';

// ── Permissions ──

/** Permission primitives that tools declare as requirements. */
export type ToolPermission =
  | 'repository.read'
  | 'repository.write'
  | 'filesystem.read'
  | 'filesystem.write'
  | 'process.execute'
  | 'network.access';

// ── Tool Metadata ──

export interface ToolMetadata {
  /** Stable unique identifier (namespace.name format) */
  id: ToolId;
  /** Human-readable display name */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Side-effect classification */
  sideEffects: SideEffectLevel;
  /** Permissions required to execute this tool */
  permissions: ToolPermission[];
  /** Whether the tool is idempotent (same input → same output, no extra side effects) */
  idempotent: boolean;
}

// ── Tool Execution Context ──

export interface ToolExecutionContext {
  /** Absolute path to the workspace root */
  workspaceRoot: string;
  /** Unique request ID for tracing */
  requestId: string;
  /** Permissions granted for this execution */
  grantedPermissions: ToolPermission[];
  /** Abort signal for cancellation support */
  signal?: AbortSignal;
}

// ── Tool Result ──

export interface ToolSuccessResult<T> {
  success: true;
  data: T;
}

export interface ToolErrorResult {
  success: false;
  error: ToolError;
}

export type ToolResult<T> = ToolSuccessResult<T> | ToolErrorResult;

// ── Tool Error ──

export type ToolErrorCode =
  | 'TOOL_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'PERMISSION_DENIED'
  | 'EXECUTION_FAILED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'CONFLICT'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly toolId?: ToolId;
  readonly cause?: unknown;

  constructor(code: ToolErrorCode, message: string, options?: { toolId?: ToolId; cause?: unknown }) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.toolId = options?.toolId;
    this.cause = options?.cause;
  }
}

// ── Tool Interface ──

export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Tool metadata including identity, side effects, permissions */
  readonly metadata: ToolMetadata;

  /** Zod schema for input validation */
  readonly inputSchema: z.ZodType<TInput>;

  /**
   * Validate raw input against the input schema.
   * Returns validated input or throws.
   */
  validate(input: unknown): TInput;

  /**
   * Execute the tool with validated input.
   * Must NOT perform side effects not declared in metadata.
   */
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}

// ── Tool Schema (provider-neutral, for model exposure) ──

export interface ToolSchema {
  /** Tool identifier */
  name: ToolId;
  /** Human-readable description for model consumption */
  description: string;
  /** JSON Schema-compatible input description */
  inputSchema: Record<string, unknown>;
}

// ── Registry Types ──

export type ToolRegistryEntry = {
  tool: Tool;
  /** Priority for conflict resolution (higher wins). Default: 0 */
  priority: number;
};

export interface ToolRegistryRegistrationResult {
  success: boolean;
  toolId?: ToolId;
  reason?: string;
}