/**
 * @devforge/cli — explain command (M2).
 *
 * Repository Indexer → Parser → Knowledge Graph → Brain → Markdown explanation
 * No planner. No executor.
 */

import type { ExecutionContext } from '../services/session.js';
import { DevForgeRuntime } from '@devforge/runtime';
import { DevForgeBrain } from '@devforge/brain';
import type { ModelProvider } from '@devforge/model-provider';
import { FakeModelProvider } from '@devforge/model-provider';
import type { RepositoryTree } from '@devforge/repository-indexer';
import type { SymbolGraph, ParsedFile } from '@devforge/symbol-graph';
import type { KnowledgeGraph } from '@devforge/knowledge-graph';

/** Handler for `devforge explain <topic>`. */
export async function handleExplain(ctx: ExecutionContext, topic: string): Promise<string> {
  const { repository, services, config, options } = ctx;
  const { brain } = services;

  // Run the full indexing pipeline via Runtime to get knowledge graph
  const runtime = new DevForgeRuntime({ workspaceRoot: repository.root });
  await runtime.initialize();
  
  const runtimeResult = await runtime.execute();
  await runtime.dispose();

  // Build markdown explanation from the knowledge graph
  let output = `# Explanation: ${topic}\n\n`;
  output += `**Repository:** ${repository.root}\n`;
  if (repository.branch) output += `**Branch:** ${repository.branch}\n`;
  output += `\n`;

  // Add knowledge graph summary
  const metadata = runtimeResult.context.metadata as Record<string, unknown>;
  const knowledgeGraph = metadata.knowledgeGraph as KnowledgeGraph | undefined;
  const symbolGraph = metadata.symbolGraph as SymbolGraph | undefined;
  const parsedFiles = metadata.parsedFiles as ParsedFile[] | undefined;
  const repositoryTree = metadata.repositoryTree as RepositoryTree | undefined;

  if (repositoryTree) {
    output += `## Repository Structure\n`;
    output += `- Total nodes: ${repositoryTree.totalNodes}\n`;
    output += `- Root: ${repositoryTree.rootPath}\n\n`;
  }

  if (symbolGraph) {
    output += `## Symbol Graph\n`;
    output += `- Symbols: ${symbolGraph.nodes.size}\n`;
    output += `- Edges: ${symbolGraph.edges.length}\n\n`;
    
    // Show top symbols
    const symbols = Array.from(symbolGraph.nodes.values()).slice(0, 20);
    if (symbols.length > 0) {
      output += `### Key Symbols\n`;
      for (const symbol of symbols) {
        output += `- **${symbol.name}** (${symbol.kind}) in ${symbol.filePath}\n`;
      }
      output += `\n`;
    }
  }

  if (knowledgeGraph) {
    output += `## Knowledge Graph\n`;
    output += `- Nodes: ${knowledgeGraph.nodes.size}\n`;
    output += `- Edges: ${knowledgeGraph.edges.length}\n\n`;
    
    const nodes = Array.from(knowledgeGraph.nodes.values()).slice(0, 15);
    if (nodes.length > 0) {
      output += `### Architectural Components\n`;
      for (const node of nodes) {
        output += `- **${node.name}** (${node.kind}): ${node.properties.description ?? 'no description'}\n`;
      }
      output += `\n`;
    }
  }

  if (parsedFiles && parsedFiles.length > 0) {
    output += `## Parsed Files (${parsedFiles.length})\n`;
    for (const file of parsedFiles.slice(0, 10)) {
      output += `- ${file.filePath}: ${file.classes.length} classes, ${file.functions.length} functions, ${file.interfaces.length} interfaces\n`;
    }
    output += `\n`;
  }

  // Use Brain for natural language explanation if provider available
  const brainResult = await brain.ask(`Explain: ${topic} in the context of this codebase`, { signal: ctx.signal });
  
  if (brainResult.status === 'answered') {
    output += `## AI Explanation\n\n${brainResult.answer}\n`;
  } else if (brainResult.status === 'classified') {
    output += `## AI Explanation\n\n*Unable to generate explanation (intent: ${brainResult.intent}, confidence: ${Math.round(brainResult.confidence * 100)}%). No provider configured or unknown intent.*\n`;
  } else if (brainResult.status === 'provider_error') {
    output += `## AI Explanation\n\n*Provider error: ${brainResult.error}*\n`;
  }

  if (options.debug) {
    output += `\n---\n*Debug: runtime took ${runtimeResult.duration}ms, success: ${runtimeResult.success}*`;
  }

  return output;
}