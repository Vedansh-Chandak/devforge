/**
 * @devforge/tools — Tool System Core
 *
 * Provider-neutral tool abstraction for DevForge.
 * Defines tool contracts, registry, executor, and testing utilities.
 */

// Types & Contracts
export type {
  ToolId,
  ToolMetadata,
  ToolExecutionContext,
  ToolResult,
  ToolSuccessResult,
  ToolErrorResult,
  ToolErrorCode,
  SideEffectLevel,
  ToolPermission,
  ToolSchema,
  ToolRegistryEntry,
  ToolRegistryRegistrationResult,
} from './types.js';

export { createToolId, ToolError } from './types.js';
export type { Tool } from './types.js';

// Registry
export { ToolRegistry } from './registry.js';

// Executor
export { executeTool } from './executor.js';

// FakeTool (testing)
export { FakeTool } from './fake-tool.js';
export type { FakeToolConfig, FakeToolRecording } from './fake-tool.js';

// Repository Tools
export {
  createRepositoryTools,
  registerRepositoryTools,
  createSearchTool,
  createFindSymbolTool,
  createDependenciesTool,
  createArchitectureTool,
  createReadFileTool,
} from './repository/index.js';
export type {
  RepositoryTools,
  CreateRepositoryToolsOptions,
} from './repository/index.js';
export type * from './repository/types.js';
export { validateSafePath, checkFileSize, isBinaryContent, isSensitiveFile } from './repository/path-security.js';

// Protocol (DF-011.2/3)
export type {
  ToolCallProposal,
  ValidatedToolCall,
  AuthorizedToolCall,
  ExecutionAuditRecord,
  ModelToolCallResult,
  ProposalValidationResult,
  AuthorizationResult,
} from './protocol.js';
export {
  parseToolCallProposals,
  validateToolCallProposal,
  validateToolCallProposals,
  authorizeModelToolCall,
  isReadOnlyAllowed,
  READ_ONLY_SIDE_EFFECTS,
} from './protocol.js';

// Model Executor (DF-011.3)
export type {
  ModelExecutorConfig,
  ModelExecutionResult,
} from './model-executor.js';
export {
  executeModelToolCalls,
  DEFAULT_MAX_EXECUTIONS,
} from './model-executor.js';
