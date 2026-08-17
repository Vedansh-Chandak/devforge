/**
 * repository.findSymbol — Find repository symbols using Runtime.
 *
 * Searches the symbol graph for symbols matching a query.
 * Returns structured symbol information: name, kind, file, line, documentation.
 * Preserves multiple matches — does not arbitrarily select the first.
 */

import { z } from 'zod';
import { createToolId } from '../types.js';
import type { Tool, ToolPermission } from '../types.js';
import type { RuntimeBridge, SymbolEntry } from './types.js';
import { DEFAULT_MAX_QUERY_LENGTH } from './types.js';

const MAX_QUERY_LENGTH = DEFAULT_MAX_QUERY_LENGTH;

/** Zod input schema for repository.findSymbol */
const findSymbolInputSchema = z.object({
  query: z.string().min(1, 'Query must not be empty').max(MAX_QUERY_LENGTH, `Query must not exceed ${MAX_QUERY_LENGTH} characters`),
});

type FindSymbolInput = z.infer<typeof findSymbolInputSchema>;

export interface FindSymbolOutput {
  readonly query: string;
  readonly symbols: ReadonlyArray<SymbolEntry>;
  readonly totalMatches: number;
}

const TOOL_ID = createToolId('repository.find-symbol');

/**
 * Create the repository.findSymbol tool.
 *
 * @param bridge - RuntimeBridge for accessing analyzed repository data
 */
export function createFindSymbolTool(bridge: RuntimeBridge): Tool<FindSymbolInput, FindSymbolOutput> {
  return {
    metadata: {
      id: TOOL_ID,
      name: 'Find Symbol',
      description: 'Find repository symbols matching a query. Returns symbol name, kind, file location, line number, and documentation if available.',
      sideEffects: 'none',
      permissions: ['repository.read'] as ToolPermission[],
      idempotent: true,
    },
    inputSchema: findSymbolInputSchema,

    validate(input: unknown): FindSymbolInput {
      return findSymbolInputSchema.parse(input);
    },

    async execute(input: FindSymbolInput): Promise<{ success: true; data: FindSymbolOutput }> {
      const analysis = await bridge.execute();
      const query = input.query.trim().toLowerCase();

      // Find symbols matching the query
      const matches: SymbolEntry[] = [];
      for (const [key, symbol] of analysis.symbols) {
        if (
          key.toLowerCase().includes(query) ||
          symbol.name.toLowerCase().includes(query)
        ) {
          matches.push(symbol);
        }
      }

      // Deterministic ordering: sort by qualified name
      matches.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));

      return {
        success: true,
        data: {
          query: input.query,
          symbols: matches,
          totalMatches: matches.length,
        },
      };
    },
  };
}