/**
 * Context Builder — maps Runtime PipelineContext metadata to ComposerContext.
 *
 * This is the translation layer between the Runtime's repository intelligence
 * output (symbolGraph, knowledgeGraph, parsedFiles, repositoryTree) and the
 * structured ComposerContext that the PromptComposer expects.
 *
 * Dependency direction: Brain → Runtime types + Prompt Composer types.
 * No imports from Runtime module itself — only uses the metadata shape.
 */

import type { ComposerContext, ComposerSymbol, ComposerDependency, ComposerArchitecture } from '@devforge/prompt-composer';

/**
 * The shape of PipelineContext.metadata produced by DevForgeRuntime.
 * Matches packages/runtime/src/types.ts PipelineContext.metadata.
 */
export interface RuntimeMetadata {
  repositoryTree?: unknown;
  parsedFiles?: unknown[];
  symbolGraph?: {
    symbols?: unknown[];
    dependencies?: unknown[];
  };
  knowledgeGraph?: {
    modules?: unknown[];
    services?: unknown[];
    dependencies?: unknown[];
  };
}

/**
 * Build a ComposerContext from Runtime pipeline metadata.
 * This function never throws — it gracefully handles missing or malformed data.
 */
export function buildContextFromMetadata(metadata: Record<string, unknown>): ComposerContext {
  const ctx: ComposerContext = {};

  const symbols = extractSymbols(metadata);
  if (symbols.length > 0) {
    ctx.symbols = symbols;
  }

  const deps = extractDependencies(metadata);
  if (deps.length > 0) {
    ctx.dependencies = deps;
  }

  const arch = extractArchitecture(metadata);
  if (Object.keys(arch).length > 0) {
    ctx.architecture = arch;
  }

  const searchResults = extractSearchResults(metadata);
  if (searchResults.length > 0) {
    ctx.searchResults = searchResults;
  }

  return ctx;
}

function extractSymbols(metadata: Record<string, unknown>): ComposerSymbol[] {
  const symbols: ComposerSymbol[] = [];

  // Try symbolGraph.symbols
  const symbolGraph = metadata.symbolGraph as { symbols?: unknown[] } | undefined;
  if (symbolGraph?.symbols && Array.isArray(symbolGraph.symbols)) {
    for (const s of symbolGraph.symbols) {
      if (!s || typeof s !== 'object') continue;
      const sym = s as Record<string, unknown>;
      symbols.push({
        name: String(sym.name ?? sym.symbolName ?? ''),
        kind: typeof sym.kind === 'string' ? sym.kind : undefined,
        file: typeof sym.filePath === 'string' ? sym.filePath : undefined,
        module: typeof sym.module === 'string' ? sym.module : undefined,
      });
    }
  }

  // Fallback: try parsedFiles
  if (symbols.length === 0 && Array.isArray(metadata.parsedFiles)) {
    for (const f of metadata.parsedFiles) {
      if (!f || typeof f !== 'object') continue;
      const file = f as Record<string, unknown>;
      const filePath = typeof file.filePath === 'string' ? file.filePath : undefined;

      // Extract exports as symbols
      for (const field of ['exports', 'classes', 'interfaces', 'functions'] as const) {
        const items = file[field];
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const it = item as Record<string, unknown>;
          const name = typeof it.name === 'string' ? it.name : (typeof it === 'string' ? item : undefined);
          if (typeof name === 'string') {
            symbols.push({
              name,
              kind: field === 'exports' ? 'export' : field === 'classes' ? 'class' : field === 'interfaces' ? 'interface' : 'function',
              file: filePath,
            });
          }
        }
      }
    }
  }

  return symbols;
}

function extractDependencies(metadata: Record<string, unknown>): ComposerDependency[] {
  const deps: ComposerDependency[] = [];

  // Try symbolGraph.dependencies
  const symbolGraph = metadata.symbolGraph as { dependencies?: unknown[] } | undefined;
  if (symbolGraph?.dependencies && Array.isArray(symbolGraph.dependencies)) {
    for (const d of symbolGraph.dependencies) {
      if (!d || typeof d !== 'object') continue;
      const dep = d as Record<string, unknown>;
      const from = typeof dep.from === 'string' ? dep.from : typeof dep.source === 'string' ? dep.source : undefined;
      const to = typeof dep.to === 'string' ? dep.to : typeof dep.target === 'string' ? dep.target : undefined;
      if (from && to) {
        deps.push({ from, to });
      }
    }
  }

  // Fallback: knowledgeGraph.dependencies
  if (deps.length === 0) {
    const kg = metadata.knowledgeGraph as { dependencies?: unknown[] } | undefined;
    if (kg?.dependencies && Array.isArray(kg.dependencies)) {
      for (const d of kg.dependencies) {
        if (!d || typeof d !== 'object') continue;
        const dep = d as Record<string, unknown>;
        const from = typeof dep.from === 'string' ? dep.from : undefined;
        const to = typeof dep.to === 'string' ? dep.to : undefined;
        if (from && to) {
          deps.push({ from, to });
        }
      }
    }
  }

  return deps;
}

function extractArchitecture(metadata: Record<string, unknown>): ComposerArchitecture {
  const arch: ComposerArchitecture = {};

  const kg = metadata.knowledgeGraph as {
    modules?: unknown[];
    services?: unknown[];
  } | undefined;

  if (kg?.modules && Array.isArray(kg.modules)) {
    const modules: string[] = [];
    for (const m of kg.modules) {
      if (typeof m === 'string') {
        modules.push(m);
      } else if (m && typeof m === 'object') {
        const mod = m as Record<string, unknown>;
        if (typeof mod.name === 'string') modules.push(mod.name);
      }
    }
    if (modules.length > 0) arch.modules = modules;
  }

  if (kg?.services && Array.isArray(kg.services)) {
    const services: string[] = [];
    for (const s of kg.services) {
      if (typeof s === 'string') {
        services.push(s);
      } else if (s && typeof s === 'object') {
        const svc = s as Record<string, unknown>;
        if (typeof svc.name === 'string') services.push(svc.name);
      }
    }
    if (services.length > 0) arch.services = services;
  }

  return arch;
}

/**
 * Extract search results (currently: all symbols as candidates).
 * In a future story, this could use embeddings or keyword matching.
 */
function extractSearchResults(metadata: Record<string, unknown>): ComposerSymbol[] {
  // For now, search results come from the same symbol data
  // The PromptComposer handles question-matching formatting
  return [];
}