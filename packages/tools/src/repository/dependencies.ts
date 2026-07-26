/**
 * repository.dependencies — Inspect dependencies for a symbol using Runtime.
 *
 * Queries the RuntimeBridge's analyzed data for dependency and dependent
 * relationships of a given symbol. Preserves directionality clearly.
 */

import { z } from 'zod';
import { createToolId } from '../types.js';
import type { Tool, ToolPermission } from '../types.js';
import type { RuntimeBridge, DependencyResult, DependencyEdge, SymbolKind } from './types.js';
import { DEFAULT_MAX_QUERY_LENGTH } from './types.js';

const MAX_QUERY_LENGTH = DEFAULT_MAX_QUERY_LENGTH;

/** Zod input schema for repository.dependencies */
const dependenciesInputSchema = z.object({
  symbol: z.string().min(1, 'Symbol name must not be empty').max(MAX_QUERY_LENGTH, `Symbol name must not exceed ${MAX_QUERY_LENGTH} characters`),
  direction: z.enum(['dependencies', 'dependents', 'both']).default('both'),
});

type DependenciesInput = z.infer<typeof dependenciesInputSchema>;

const TOOL_ID = createToolId('repository.dependencies');

/**
 * Create the repository.dependencies tool.
 *
 * @param bridge - RuntimeBridge for accessing analyzed repository data
 */
export function createDependenciesTool(bridge: RuntimeBridge): Tool<DependenciesInput, DependencyResult> {
  return {
    metadata: {
      id: TOOL_ID,
      name: 'Symbol Dependencies',
      description: 'Inspect dependencies for a symbol. Shows what the symbol depends on, what depends on it, or both.',
      sideEffects: 'none',
      permissions: ['repository.read'] as ToolPermission[],
      idempotent: true,
    },
    inputSchema: dependenciesInputSchema,

    validate(input: unknown): DependenciesInput {
      return dependenciesInputSchema.parse(input);
    },

    async execute(input: DependenciesInput): Promise<{ success: true; data: DependencyResult }> {
      const analysis = await bridge.execute();
      const query = input.symbol.trim().toLowerCase();
      const direction = input.direction;

      // Find the target symbol
      let targetSymbol: { name: string; qualifiedName: string } | undefined;
      for (const [key, symbol] of analysis.symbols) {
        if (
          key.toLowerCase() === query ||
          symbol.name.toLowerCase() === query ||
          symbol.qualifiedName.toLowerCase() === query
        ) {
          targetSymbol = symbol;
          break;
        }
      }

      if (!targetSymbol) {
        return {
          success: true,
          data: {
            symbol: input.symbol,
            dependencies: [],
            dependents: [],
          },
        };
      }

      // Resolve dependencies and dependents from the symbol graph edges
      const dependencies: DependencyEdge[] = [];
      const dependents: DependencyEdge[] = [];

      // Build edge data from symbol graph
      // The RuntimeBridge provides a flat symbol map — we infer relationships
      // from the architecture data's relationships array
      if (analysis.architecture?.relationships) {
        for (const rel of analysis.architecture.relationships) {
          if (rel.from === targetSymbol.qualifiedName || rel.from === targetSymbol.name) {
            // This symbol depends on rel.to
            const depSymbol = analysis.symbols.get(rel.to);
            if (depSymbol) {
              dependencies.push({
                name: depSymbol.name,
                kind: depSymbol.kind as SymbolKind,
                edgeKind: rel.kind,
                filePath: depSymbol.filePath,
              });
            }
          }
          if (rel.to === targetSymbol.qualifiedName || rel.to === targetSymbol.name) {
            // rel.from depends on this symbol
            const depSymbol = analysis.symbols.get(rel.from);
            if (depSymbol) {
              dependents.push({
                name: depSymbol.name,
                kind: depSymbol.kind as SymbolKind,
                edgeKind: rel.kind,
                filePath: depSymbol.filePath,
              });
            }
          }
        }
      }

      // Deterministic ordering
      dependencies.sort((a, b) => a.name.localeCompare(b.name));
      dependents.sort((a, b) => a.name.localeCompare(b.name));

      return {
        success: true,
        data: {
          symbol: input.symbol,
          dependencies: direction === 'dependents' ? [] : dependencies,
          dependents: direction === 'dependencies' ? [] : dependents,
        },
      };
    },
  };
}