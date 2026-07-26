/**
 * repository.search — Search repository intelligence using Runtime.
 *
 * Searches symbol names via RuntimeBridge analyzed data.
 * No embeddings, no AI, no model calls — pure structured symbol lookup.
 */

import { z } from 'zod';
import { createToolId } from '../types.js';
import type { Tool, ToolPermission } from '../types.js';
import type { RuntimeBridge, SearchResult, SymbolEntry } from './types.js';
import { DEFAULT_MAX_QUERY_LENGTH } from './types.js';

const MAX_QUERY_LENGTH = DEFAULT_MAX_QUERY_LENGTH;

/** Zod input schema for repository.search */
const searchInputSchema = z.object({
  query: z.string().min(1, 'Search query must not be empty').max(MAX_QUERY_LENGTH, `Search query must not exceed ${MAX_QUERY_LENGTH} characters`),
});

type SearchInput = z.infer<typeof searchInputSchema>;
type SearchOutput = SearchResult;

const TOOL_ID = createToolId('repository.search');

/**
 * Create the repository.search tool.
 *
 * @param bridge - RuntimeBridge for accessing analyzed repository data
 */
export function createSearchTool(bridge: RuntimeBridge): Tool<SearchInput, SearchOutput> {
  return {
    metadata: {
      id: TOOL_ID,
      name: 'Search Repository',
      description: 'Search repository intelligence for symbols matching a query. Returns matching symbols with name, kind, file location, and documentation.',
      sideEffects: 'none',
      permissions: ['repository.read'] as ToolPermission[],
      idempotent: true,
    },
    inputSchema: searchInputSchema,

    validate(input: unknown): SearchInput {
      return searchInputSchema.parse(input);
    },

    async execute(input: SearchInput): Promise<{ success: true; data: SearchOutput }> {
      const analysis = await bridge.execute();
      const query = input.query.trim().toLowerCase();

      // Search symbols by name matching (case-insensitive substring match)
      const matches: SymbolEntry[] = [];
      for (const [key, symbol] of analysis.symbols) {
        // Match against both short name and qualified name
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