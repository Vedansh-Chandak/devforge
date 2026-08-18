/**
 * Controlled Model Executor — executes AuthorizedToolCalls through the registry.
 *
 * Security invariants:
 *   - ONLY accepts AuthorizedToolCall (not raw proposals, not raw toolId+args)
 *   - Rechecks tool existence and metadata immediately before execution (TOCTOU)
 *   - Permission recheck at execution time
 *   - Read-only policy enforced
 *   - Execution limit per response
 *   - Sequential execution in proposal order
 *   - Returns structured results with audit metadata
 *
 * This executor is the ONLY path for model-originated tool calls to reach Tool.execute().
 * Programmatic execution APIs from DF-011.0 exist separately via executeTool().
 */

import type { Tool, ToolId, ToolExecutionContext, ToolResult, ToolPermission, SideEffectLevel } from './types.js';
import { ToolError } from './types.js';
import type { ToolRegistry } from './registry.js';
import type {
  AuthorizedToolCall,
  ExecutionAuditRecord,
  ModelToolCallResult,
} from './protocol.js';
import { isReadOnlyAllowed } from './protocol.js';

// ── Configuration ──

/** Default maximum number of model-originated tool executions per response. */
export const DEFAULT_MAX_EXECUTIONS = 5;

/** Configuration for the model executor. */
export interface ModelExecutorConfig {
  /** Maximum number of tool executions per response. Default: 5. */
  maxExecutions?: number;
}

// ── Execution Result ──

/**
 * Complete result of model-originated tool execution for a single response.
 */
export interface ModelExecutionResult {
  /** All per-call results, in proposal order */
  readonly results: ModelToolCallResult[];
  /** Audit trail (safe metadata only) */
  readonly audit: ExecutionAuditRecord[];
  /** Whether execution was cut short due to limit */
  readonly limitExceeded: boolean;
  /** Number of calls that were skipped due to limit */
  readonly skippedCount: number;
}

// ── Controlled Executor ──

/**
 * Execute a batch of authorized tool calls through the registry.
 *
 * Semantics:
 *   - Calls execute sequentially in proposal order
 *   - Mixed valid/invalid: rejected calls are skipped, valid calls execute independently
 *   - Execution limit: if exceeded, remaining calls are skipped with 'limit_exceeded'
 *   - Each call gets a fresh TOCTOU recheck immediately before Tool.execute()
 *
 * @param authorizedCalls - Calls that have passed validation AND authorization
 * @param context - Execution context (permissions, workspace, requestId)
 * @param registry - Tool registry for final TOCTOU recheck + execution
 * @param config - Optional executor configuration
 * @returns Structured results with audit trail
 */
export async function executeModelToolCalls(
  authorizedCalls: readonly AuthorizedToolCall[],
  context: ToolExecutionContext,
  registry: ToolRegistry,
  config?: ModelExecutorConfig,
): Promise<ModelExecutionResult> {
  const maxExecutions = config?.maxExecutions ?? DEFAULT_MAX_EXECUTIONS;
  const results: ModelToolCallResult[] = [];
  const audit: ExecutionAuditRecord[] = [];
  let executedCount = 0;
  let limitExceeded = false;
  let skippedCount = 0;

  for (const call of authorizedCalls) {
    // Check execution limit
    if (executedCount >= maxExecutions) {
      limitExceeded = true;
      skippedCount++;
      const limitResult: ModelToolCallResult = {
        callId: call.callId,
        toolId: call.toolId,
        status: 'limit_exceeded',
        error: {
          code: 'EXECUTION_LIMIT',
          message: `Execution limit of ${maxExecutions} reached. Call skipped.`,
        },
      };
      results.push(limitResult);
      audit.push({
        callId: call.callId,
        toolId: call.toolId,
        status: 'limit_exceeded',
      });
      continue;
    }

    // TOCTOU recheck: tool still exists
    const tool = registry.get(call.toolId);
    if (!tool) {
      const notFoundResult: ModelToolCallResult = {
        callId: call.callId,
        toolId: call.toolId,
        status: 'not_found',
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Tool "${call.toolId}" is no longer registered.`,
        },
      };
      results.push(notFoundResult);
      audit.push({
        callId: call.callId,
        toolId: call.toolId,
        status: 'denied',
        errorCode: 'TOOL_NOT_FOUND',
        errorMessage: 'Tool no longer in registry at execution time',
      });
      continue;
    }

    // TOCTOU recheck: metadata still satisfies read-only policy
    const currentMeta = tool.metadata;
    if (!isReadOnlyAllowed(currentMeta.sideEffects)) {
      const policyResult: ModelToolCallResult = {
        callId: call.callId,
        toolId: call.toolId,
        status: 'denied',
        error: {
          code: 'POLICY_DENIED',
          message: `Tool "${call.toolId}" side effects "${currentMeta.sideEffects}" not allowed.`,
        },
      };
      results.push(policyResult);
      audit.push({
        callId: call.callId,
        toolId: call.toolId,
        status: 'denied',
        errorCode: 'POLICY_DENIED',
        errorMessage: `Side effects "${currentMeta.sideEffects}" changed or not allowed`,
      });
      continue;
    }

    // TOCTOU recheck: permissions still granted
    const grantedSet = new Set(context.grantedPermissions);
    const deniedPerms = currentMeta.permissions.filter((p: ToolPermission) => !grantedSet.has(p));
    if (deniedPerms.length > 0) {
      const permResult: ModelToolCallResult = {
        callId: call.callId,
        toolId: call.toolId,
        status: 'denied',
        error: {
          code: 'PERMISSION_DENIED',
          message: `Missing permissions: [${deniedPerms.join(', ')}]`,
        },
      };
      results.push(permResult);
      audit.push({
        callId: call.callId,
        toolId: call.toolId,
        status: 'denied',
        errorCode: 'PERMISSION_DENIED',
        errorMessage: `Missing permissions: [${deniedPerms.join(', ')}]`,
      });
      continue;
    }

    // Execute the tool
    const startedAt = Date.now();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolAny = tool as Tool<any, any>;
      const toolResult: ToolResult<unknown> = await toolAny.execute(call.validatedInput, context);
      const duration = Date.now() - startedAt;

      if (toolResult.success) {
        results.push({
          callId: call.callId,
          toolId: call.toolId,
          status: 'completed',
          result: toolResult.data,
        });
        audit.push({
          callId: call.callId,
          toolId: call.toolId,
          status: 'executed',
          startedAt,
          duration,
        });
      } else {
        // Tool returned a structured error
        const toolError = toolResult.error;
        results.push({
          callId: call.callId,
          toolId: call.toolId,
          status: 'failed',
          error: {
            code: toolError instanceof ToolError ? toolError.code : 'EXECUTION_FAILED',
            message: toolError instanceof Error ? toolError.message : 'Tool execution failed',
          },
        });
        audit.push({
          callId: call.callId,
          toolId: call.toolId,
          status: 'error',
          startedAt,
          duration,
          errorCode: toolError instanceof ToolError ? toolError.code : 'EXECUTION_FAILED',
          errorMessage: toolError instanceof Error ? toolError.message : 'Tool execution failed',
        });
      }
    } catch (err) {
      const duration = Date.now() - startedAt;
      const errorMessage = err instanceof Error ? err.message : String(err);
      results.push({
        callId: call.callId,
        toolId: call.toolId,
        status: 'failed',
        error: {
          code: 'EXECUTION_FAILED',
          message: errorMessage,
        },
      });
      audit.push({
        callId: call.callId,
        toolId: call.toolId,
        status: 'error',
        startedAt,
        duration,
        errorCode: 'EXECUTION_FAILED',
        errorMessage,
      });
    }

    executedCount++;
  }

  return {
    results,
    audit,
    limitExceeded,
    skippedCount,
  };
}