/**
 * Repository Tools — Factory and Registration
 *
 * Creates all read-only repository tools and registers them in a ToolRegistry.
 *
 * Usage:
 *   const tools = createRepositoryTools({ runtime, workspaceRoot });
 *   registerRepositoryTools(registry, tools);
 */

import { ToolRegistry } from '../registry.js';
import type { Tool } from '../types.js';
import type { RuntimeBridge } from './types.js';
import type { ReadFileConfig } from './read-file.js';
import { createSearchTool } from './search.js';
import { createFindSymbolTool } from './find-symbol.js';
import { createDependenciesTool } from './dependencies.js';
import { createArchitectureTool } from './architecture.js';
import { createReadFileTool } from './read-file.js';

// Re-export individual tool creators for direct access
export { createSearchTool } from './search.js';
export { createFindSymbolTool } from './find-symbol.js';
export { createDependenciesTool } from './dependencies.js';
export { createArchitectureTool } from './architecture.js';
export { createReadFileTool } from './read-file.js';

// Re-export types
export type * from './types.js';

/** All five repository tools created together. */
export interface RepositoryTools {
  readonly search: Tool;
  readonly findSymbol: Tool;
  readonly dependencies: Tool;
  readonly architecture: Tool;
  readonly readFile: Tool;
}

/** Dependencies for creating repository tools. */
export interface CreateRepositoryToolsOptions {
  /** Initialized RuntimeBridge providing analyzed repository data. */
  runtime: RuntimeBridge;
  /** Absolute path to workspace root. */
  workspaceRoot: string;
  /** Maximum file size for readFile (bytes). Default: 1MB. */
  maxFileBytes?: number;
}

/**
 * Create all five repository tools.
 *
 * Tools share the same RuntimeBridge — no duplicate Runtime instances.
 * Each tool is independent and can be used individually.
 *
 * @param options - RuntimeBridge, workspaceRoot, and optional config
 * @returns All five repository tools
 */
export function createRepositoryTools(options: CreateRepositoryToolsOptions): RepositoryTools {
  const { runtime, workspaceRoot, maxFileBytes } = options;

  const readFileConfig: ReadFileConfig = { workspaceRoot, maxFileBytes };

  return {
    search: createSearchTool(runtime),
    findSymbol: createFindSymbolTool(runtime),
    dependencies: createDependenciesTool(runtime),
    architecture: createArchitectureTool(runtime),
    readFile: createReadFileTool(readFileConfig),
  };
}

/**
 * Register all repository tools into a ToolRegistry.
 *
 * @param registry - The registry to add tools to
 * @param tools - Repository tools from createRepositoryTools()
 * @returns Array of registration results for inspection
 */
export function registerRepositoryTools(
  registry: ToolRegistry,
  tools: RepositoryTools,
): Array<{ id: string; success: boolean; reason?: string }> {
  const allTools: Tool[] = [
    tools.search,
    tools.findSymbol,
    tools.dependencies,
    tools.architecture,
    tools.readFile,
  ];

  return allTools.map(tool => {
    const result = registry.register(tool);
    return {
      id: tool.metadata.id,
      success: result.success,
      reason: result.success ? undefined : result.reason,
    };
  });
}