/**
 * repository.architecture — Expose Runtime architecture intelligence.
 *
 * Returns structured architecture data from the RuntimeBridge:
 * modules, services, APIs, repositories, databases, relationships.
 * No additional architectural inference inside the tool.
 */

import { z } from 'zod';
import { createToolId } from '../types.js';
import type { Tool, ToolPermission } from '../types.js';
import type { RuntimeBridge, ArchitectureData } from './types.js';

/** Zod input schema for repository.architecture (empty — no filters yet) */
const architectureInputSchema = z.object({});

type ArchitectureInput = z.infer<typeof architectureInputSchema>;

const TOOL_ID = createToolId('repository.architecture');

/**
 * Create the repository.architecture tool.
 *
 * @param bridge - RuntimeBridge for accessing analyzed repository data
 */
export function createArchitectureTool(bridge: RuntimeBridge): Tool<ArchitectureInput, ArchitectureData> {
  return {
    metadata: {
      id: TOOL_ID,
      name: 'Architecture',
      description: 'Expose repository architecture intelligence: modules, services, APIs, repositories, databases, and their relationships.',
      sideEffects: 'none',
      permissions: ['repository.read'] as ToolPermission[],
      idempotent: true,
    },
    inputSchema: architectureInputSchema,

    validate(input: unknown): ArchitectureInput {
      return architectureInputSchema.parse(input);
    },

    async execute(): Promise<{ success: true; data: ArchitectureData }> {
      const analysis = await bridge.execute();

      return {
        success: true,
        data: analysis.architecture,
      };
    },
  };
}