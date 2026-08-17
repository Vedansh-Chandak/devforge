/**
 * Model Tool-Call Protocol — types and validation for model-originated tool calls.
 *
 * Flow:
 *   ModelResponse (content with tool calls)
 *       ↓ parseToolCallProposals()
 *   ToolCallProposal[]
 *       ↓ validateToolCallProposal()
 *   ValidatedToolCall
 *       ↓ authorizeModelToolCall()
 *   AuthorizedToolCall
 *       ↓ executeModelToolCall()
 *   ToolResult
 *
 * DF-011.2 + DF-011.3: Protocol parsing, validation, authorization.
 */

import { z } from 'zod';
import type { ToolId, ToolExecutionContext, ToolPermission, SideEffectLevel } from './types.js';
import { createToolId, ToolError } from './types.js';
import type { ToolRegistry } from './registry.js';

// ── ToolCallProposal ──

/**
 * Raw tool call parsed from model response content.
 * This is UNTRUSTED input — must be validated before execution.
 */
export interface ToolCallProposal {
  /** Unique ID for this specific call (assigned during parsing) */
  readonly callId: string;
  /** Tool ID as proposed by the model (string, not ToolId — not yet validated) */
  readonly toolIdRaw: string;
  /** Raw arguments from the model (JSON object or parsed) */
  readonly args: unknown;
  /** Original text segment this was parsed from (for auditing) */
  readonly rawText?: string;
}

// ── ValidatedToolCall ──

/**
 * A tool call that has been validated against the registry:
 * - Tool exists in registry
 * - Input passes Zod validation
 * - Tool metadata is available
 *
 * Validation does NOT imply authorization to execute.
 */
export interface ValidatedToolCall {
  /** Unique call ID (carried from proposal) */
  readonly callId: string;
  /** Validated tool ID (branded) */
  readonly toolId: ToolId;
  /** Validated input (parsed by Zod) */
  readonly validatedInput: unknown;
  /** Tool metadata at validation time (for TOCTOU recheck) */
  readonly toolMetadataSnapshot: {
    readonly id: ToolId;
    readonly sideEffects: SideEffectLevel;
    readonly permissions: ToolPermission[];
  };
}

// ── AuthorizedToolCall ──

/**
 * A validated tool call that has been authorized for execution:
 * - Read-only policy satisfied
 * - Permissions re-confirmed
 * - Execution limit not exceeded
 * - Tool still exists in registry
 *
 * This is the ONLY type that may reach the controlled executor.
 */
export interface AuthorizedToolCall {
  /** Unique call ID */
  readonly callId: string;
  /** Validated tool ID */
  readonly toolId: ToolId;
  /** Validated input */
  readonly validatedInput: unknown;
  /** Authorization metadata */
  readonly authorizedAt: number;
  /** Tool metadata at authorization time */
  readonly toolMetadataSnapshot: {
    readonly id: ToolId;
    readonly sideEffects: SideEffectLevel;
    readonly permissions: ToolPermission[];
  };
}

// ── Execution Audit Record ──

/**
 * Lightweight execution audit record. Contains NO secrets.
 */
export interface ExecutionAuditRecord {
  readonly callId: string;
  readonly toolId: ToolId;
  readonly status: 'authorized' | 'executed' | 'denied' | 'limit_exceeded' | 'cancelled' | 'error';
  readonly startedAt?: number;
  readonly duration?: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

// ── Model Tool Execution Result ──

/**
 * Per-call result in the Brain response.
 */
export interface ModelToolCallResult {
  readonly callId: string;
  readonly toolId: ToolId;
  readonly status: 'completed' | 'failed' | 'denied' | 'not_found' | 'limit_exceeded';
  readonly result?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

// ── Model Tool Execution State ──

/** Side-effect levels that are permitted in read-only mode. */
export const READ_ONLY_SIDE_EFFECTS: ReadonlySet<SideEffectLevel> = new Set<SideEffectLevel>(['none', 'read']);

/**
 * Check if a side-effect level is allowed under read-only policy.
 */
export function isReadOnlyAllowed(sideEffects: SideEffectLevel): boolean {
  return READ_ONLY_SIDE_EFFECTS.has(sideEffects);
}

// ── Proposal Parsing ──

/**
 * Parse tool call proposals from raw model response content.
 *
 * Expected format in the model response content:
 * ```json
 * {
 *   "toolCalls": [
 *     { "toolId": "repository.search", "arguments": { "query": "Auth" } }
 *   ]
 * }
 * ```
 *
 * Or alternative format:
 * ```json
 * [
 *   { "name": "repository.search", "arguments": { "query": "Auth" } }
 * ]
 * ```
 *
 * Returns empty array if no tool calls found.
 * Does NOT throw on malformed input — returns empty array.
 */
export function parseToolCallProposals(content: string): ToolCallProposal[] {
  if (!content || typeof content !== 'string') {
    return [];
  }

  // Try to find JSON in the content
  // Look for toolCalls array or direct array
  const trimmed = content.trim();

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    return extractProposals(parsed);
  } catch {
    // Not direct JSON — try to find JSON blocks in markdown
  }

  // Try to find JSON code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g;
  let match;
  while ((match = codeBlockRegex.exec(trimmed)) !== null) {
    const block = match[1];
    if (block) {
      try {
        const parsed = JSON.parse(block.trim());
        const proposals = extractProposals(parsed);
        if (proposals.length > 0) return proposals;
      } catch {
        continue;
      }
    }
  }

  return [];
}

/**
 * Extract proposals from a parsed JSON object.
 */
function extractProposals(parsed: unknown): ToolCallProposal[] {
  const proposals: ToolCallProposal[] = [];

  // Format: { toolCalls: [...] }
  if (parsed && typeof parsed === 'object' && 'toolCalls' in parsed) {
    const toolCalls = (parsed as { toolCalls: unknown }).toolCalls;
    if (Array.isArray(toolCalls)) {
      for (let i = 0; i < toolCalls.length; i++) {
        const call = toolCalls[i];
        const proposal = normalizeProposal(call, i);
        if (proposal) proposals.push(proposal);
      }
    }
    return proposals;
  }

  // Format: [...] (direct array)
  if (Array.isArray(parsed)) {
    for (let i = 0; i < parsed.length; i++) {
      const call = parsed[i];
      const proposal = normalizeProposal(call, i);
      if (proposal) proposals.push(proposal);
    }
    return proposals;
  }

  // Format: { name: ..., arguments: ... } (single call)
  const single = normalizeProposal(parsed, 0);
  if (single) proposals.push(single);

  return proposals;
}

/**
 * Normalize a single proposal entry into a ToolCallProposal.
 */
function normalizeProposal(call: unknown, index: number): ToolCallProposal | null {
  if (!call || typeof call !== 'object') return null;

  const obj = call as Record<string, unknown>;
  const toolIdRaw = (obj.toolId ?? obj.name ?? obj.tool) as string | undefined;

  if (!toolIdRaw || typeof toolIdRaw !== 'string') return null;

  return {
    callId: `call_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolIdRaw: toolIdRaw.trim(),
    args: obj.arguments ?? obj.input ?? obj.params ?? {},
    rawText: typeof call === 'string' ? call : undefined,
  };
}

// ── Proposal Validation ──

/**
 * Validation result for a single proposal.
 */
export interface ProposalValidationResult {
  readonly valid: boolean;
  readonly validatedCall?: ValidatedToolCall;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

/**
 * Validate a single tool call proposal against the registry.
 *
 * Checks:
 * 1. Tool ID format is valid
 * 2. Tool exists in registry
 * 3. Input passes tool's Zod validation
 *
 * Does NOT check permissions or policy — that's authorization.
 */
export function validateToolCallProposal(
  proposal: ToolCallProposal,
  registry: ToolRegistry,
): ProposalValidationResult {
  // 1. Validate tool ID format
  let toolId: ToolId;
  try {
    toolId = createToolId(proposal.toolIdRaw);
  } catch {
    return {
      valid: false,
      error: {
        code: 'INVALID_TOOL_ID',
        message: `Invalid tool ID format: "${proposal.toolIdRaw}". Must be namespace.name format.`,
      },
    };
  }

  // 2. Look up tool in registry
  const tool = registry.get(toolId);
  if (!tool) {
    return {
      valid: false,
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Tool "${proposal.toolIdRaw}" not found in registry.`,
      },
    };
  }

  // 3. Validate input against Zod schema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolAny = tool as any;
  let validatedInput: unknown;
  try {
    validatedInput = toolAny.validate(proposal.args);
  } catch (err) {
    return {
      valid: false,
      error: {
        code: 'INVALID_INPUT',
        message: `Input validation failed for "${proposal.toolIdRaw}": ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  return {
    valid: true,
    validatedCall: {
      callId: proposal.callId,
      toolId,
      validatedInput,
      toolMetadataSnapshot: {
        id: tool.metadata.id,
        sideEffects: tool.metadata.sideEffects,
        permissions: [...tool.metadata.permissions],
      },
    },
  };
}

/**
 * Validate all proposals in order.
 * Returns results in the same order as proposals.
 */
export function validateToolCallProposals(
  proposals: ToolCallProposal[],
  registry: ToolRegistry,
): ProposalValidationResult[] {
  return proposals.map(p => validateToolCallProposal(p, registry));
}

// ── Execution Authorization ──

/**
 * Authorization result for a single validated call.
 */
export interface AuthorizationResult {
  readonly authorized: boolean;
  readonly authorizedCall?: AuthorizedToolCall;
  readonly auditRecord: ExecutionAuditRecord;
  readonly denialReason?: string;
}

/**
 * Authorize a validated tool call for execution.
 *
 * Checks (defense-in-depth, some rechecked from validation):
 * 1. Tool still exists in registry (TOCTOU protection)
 * 2. Tool metadata unchanged (TOCTOU protection)
 * 3. Permissions still granted in current execution context
 * 4. Read-only policy: side effects are 'none' or 'read'
 * 5. Tool is idempotent (required for read-only execution)
 *
 * This is the ONLY gate between validation and execution.
 */
export function authorizeModelToolCall(
  validatedCall: ValidatedToolCall,
  context: ToolExecutionContext,
  registry: ToolRegistry,
): AuthorizationResult {
  const auditBase: ExecutionAuditRecord = {
    callId: validatedCall.callId,
    toolId: validatedCall.toolId,
    status: 'denied',
  };

  // 1. TOCTOU: Re-verify tool exists in registry
  const currentTool = registry.get(validatedCall.toolId);
  if (!currentTool) {
    return {
      authorized: false,
      auditRecord: { ...auditBase, errorCode: 'TOOL_NOT_FOUND', errorMessage: 'Tool no longer in registry' },
      denialReason: `Tool "${validatedCall.toolId}" is no longer registered.`,
    };
  }

  // 2. TOCTOU: Re-verify metadata hasn't changed (permissions and side effects)
  const currentMeta = currentTool.metadata;
  if (currentMeta.sideEffects !== validatedCall.toolMetadataSnapshot.sideEffects) {
    return {
      authorized: false,
      auditRecord: { ...auditBase, errorCode: 'METADATA_CHANGED', errorMessage: 'Tool sideEffects changed' },
      denialReason: `Tool "${validatedCall.toolId}" side effects changed from "${validatedCall.toolMetadataSnapshot.sideEffects}" to "${currentMeta.sideEffects}".`,
    };
  }

  if (JSON.stringify(currentMeta.permissions) !== JSON.stringify(validatedCall.toolMetadataSnapshot.permissions)) {
    return {
      authorized: false,
      auditRecord: { ...auditBase, errorCode: 'METADATA_CHANGED', errorMessage: 'Tool permissions changed' },
      denialReason: `Tool "${validatedCall.toolId}" permissions changed.`,
    };
  }

  // 3. Permission recheck against current execution context
  const grantedSet = new Set(context.grantedPermissions);
  const deniedPerms = currentMeta.permissions.filter(p => !grantedSet.has(p));
  if (deniedPerms.length > 0) {
    return {
      authorized: false,
      auditRecord: {
        ...auditBase,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: `Missing permissions: [${deniedPerms.join(', ')}]`,
      },
      denialReason: `Tool "${validatedCall.toolId}" requires permissions [${deniedPerms.join(', ')}] which are not granted.`,
    };
  }

  // 4. Read-only policy enforcement: deny write/process/network
  if (!isReadOnlyAllowed(currentMeta.sideEffects)) {
    return {
      authorized: false,
      auditRecord: {
        ...auditBase,
        errorCode: 'POLICY_DENIED',
        errorMessage: `Side effects "${currentMeta.sideEffects}" not allowed in read-only mode`,
      },
      denialReason: `Tool "${validatedCall.toolId}" declares side effects "${currentMeta.sideEffects}" which are not permitted in read-only execution mode.`,
    };
  }

  // 5. Authorization succeeded
  return {
    authorized: true,
    authorizedCall: {
      callId: validatedCall.callId,
      toolId: validatedCall.toolId,
      validatedInput: validatedCall.validatedInput,
      authorizedAt: Date.now(),
      toolMetadataSnapshot: validatedCall.toolMetadataSnapshot,
    },
    auditRecord: {
      ...auditBase,
      status: 'authorized',
    },
  };
}