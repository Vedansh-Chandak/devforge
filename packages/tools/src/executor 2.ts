/**
 * ToolExecutor — programmatic tool execution pipeline.
 *
 * Pipeline: Registry Lookup → Permission Check → Input Validation → Tool.execute()
 *
 * No model involvement. No planner. No ExecutionPlan DAG.
 * Direct programmatic execution only.
 */

import type { Tool, ToolId, ToolResult, ToolExecutionContext, ToolPermission } from './types.js';
import { ToolError } from './types.js';
import type { ToolRegistry } from './registry.js';

/**
 * Execute a tool through the registry.
 *
 * Flow:
 *   1. Tool ID → Registry Lookup
 *   2. Permission Check (required ⊆ granted)
 *   3. Input Validation (Zod schema)
 *   4. Tool.execute()
 *
 * @throws {ToolError} with descriptive codes for each failure mode
 */
export async function executeTool<TInput, TOutput>(
  registry: ToolRegistry,
  toolId: ToolId,
  input: unknown,
  context: ToolExecutionContext,
): Promise<ToolResult<TOutput>> {
  // 1. Registry Lookup
  const tool = registry.get(toolId);
  if (!tool) {
    return {
      success: false,
      error: new ToolError('TOOL_NOT_FOUND', `Tool "${toolId}" not found in registry`, { toolId }),
    };
  }

  // 2. Permission Check
  const requiredPermissions = tool.metadata.permissions;
  const grantedSet = new Set(context.grantedPermissions);
  const denied = requiredPermissions.filter((p: ToolPermission) => !grantedSet.has(p));
  if (denied.length > 0) {
    return {
      success: false,
      error: new ToolError(
        'PERMISSION_DENIED',
        `Tool "${toolId}" requires permissions [${denied.join(', ')}] which are not granted`,
        { toolId },
      ),
    };
  }

  // 3. Input Validation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolAny = tool as Tool<any, any>;
  let validatedInput: TInput;
  try {
    validatedInput = toolAny.validate(input) as TInput;
  } catch (err) {
    return {
      success: false,
      error: new ToolError(
        'INVALID_INPUT',
        `Input validation failed for tool "${toolId}": ${err instanceof Error ? err.message : String(err)}`,
        { toolId, cause: err },
      ),
    };
  }

  // 4. Execute
  try {
    return await toolAny.execute(validatedInput, context);
  } catch (err) {
    // Tool threw — do not let raw errors masquerade as success
    if (err instanceof ToolError) {
      return { success: false, error: err };
    }
    return {
      success: false,
      error: new ToolError(
        'EXECUTION_FAILED',
        `Tool "${toolId}" execution failed: ${err instanceof Error ? err.message : String(err)}`,
        { toolId, cause: err },
      ),
    };
  }
}