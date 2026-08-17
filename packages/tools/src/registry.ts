/**
 * ToolRegistry — central registry for tool instances.
 *
 * Lookup is O(1) via Map. List returns tools in insertion order.
 * Duplicate registration is rejected unless new tool has higher priority.
 */

import type { Tool, ToolId, ToolMetadata, ToolPermission, ToolRegistryEntry, ToolRegistryRegistrationResult } from './types.js';

export class ToolRegistry {
  private readonly entries = new Map<ToolId, ToolRegistryEntry>();

  /**
   * Register a tool. Rejects if a tool with the same ID exists
   * and has equal or higher priority.
   */
  register(tool: Tool, priority: number = 0): ToolRegistryRegistrationResult {
    const id = tool.metadata.id;
    const existing = this.entries.get(id);

    if (existing && existing.priority >= priority) {
      return {
        success: false,
        toolId: id,
        reason: `Tool "${id}" already registered with priority ${existing.priority} >= ${priority}`,
      };
    }

    this.entries.set(id, { tool, priority });
    return { success: true, toolId: id };
  }

  /**
   * Unregister a tool by ID.
   * @returns true if the tool was found and removed, false otherwise.
   */
  unregister(toolId: ToolId): boolean {
    return this.entries.delete(toolId);
  }

  /**
   * Get a tool by ID. O(1).
   * @returns the tool if found, undefined otherwise.
   */
  get(toolId: ToolId): Tool | undefined {
    return this.entries.get(toolId)?.tool;
  }

  /**
   * Check if a tool is registered. O(1).
   */
  has(toolId: ToolId): boolean {
    return this.entries.has(toolId);
  }

  /**
   * List all registered tool metadata, in insertion order.
   */
  list(): ToolMetadata[] {
    const result: ToolMetadata[] = [];
    for (const entry of this.entries.values()) {
      result.push(entry.tool.metadata);
    }
    return result;
  }

  /**
   * Find all tools that require at least one of the given permissions
   * as part of their declared permission set.
   *
   * More precisely: returns tools whose required permissions are all
   * available within the granted set.
   */
  findByPermission(grantedPermissions: ToolPermission[]): Tool[] {
    const granted = new Set(grantedPermissions);
    const result: Tool[] = [];
    for (const entry of this.entries.values()) {
      const required = entry.tool.metadata.permissions;
      if (required.length === 0 || required.every((p) => granted.has(p))) {
        result.push(entry.tool);
      }
    }
    return result;
  }

  /**
   * Get the number of registered tools.
   */
  get size(): number {
    return this.entries.size;
  }
}