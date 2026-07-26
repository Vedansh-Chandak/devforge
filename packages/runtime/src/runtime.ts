import { logger } from '@devforge/logger';
import { scanRepository } from '@devforge/repository-indexer';
import { parseTypeScript } from '@devforge/parser-typescript';
import { buildSymbolGraph } from '@devforge/symbol-graph';
import { buildKnowledgeGraph } from '@devforge/knowledge-graph';
import type { RepositoryTree, FileNode } from '@devforge/repository-indexer';
import type { ParseResult } from '@devforge/parser-typescript';
import type { ParsedFile, SymbolGraph } from '@devforge/symbol-graph';
import type { KnowledgeGraph } from '@devforge/knowledge-graph';
import {
  RuntimeConfig,
  PipelineContext,
  RuntimeResult,
  PipelineStage,
} from './types.js';

function convertToParsedFile(parseResult: ParseResult, filePath: string): ParsedFile {
  return {
    filePath,
    imports: parseResult.imports,
    exports: parseResult.exports,
    classes: parseResult.classes,
    interfaces: parseResult.interfaces,
    enums: parseResult.enums,
    functions: parseResult.functions,
    typeAliases: parseResult.typeAliases,
    syntaxErrors: parseResult.syntaxErrors,
  };
}

export class DevForgeRuntime {
  private config: RuntimeConfig;
  private stages: PipelineStage[] = [];
  private initialized = false;

  constructor(config: RuntimeConfig) {
    this.config = config;
    this.setupStages();
  }

  private setupStages(): void {
    this.stages = [
      {
        name: 'repository-indexer',
        execute: async (context: PipelineContext) => {
          logger.info('Running repository indexer...');
          const tree = await scanRepository(this.config.workspaceRoot);
          return {
            ...context,
            metadata: {
              ...context.metadata,
              repositoryTree: tree,
            },
          };
        },
      },
      {
        name: 'typescript-parser',
        execute: async (context: PipelineContext) => {
          logger.info('Parsing TypeScript files...');
          const tree = context.metadata.repositoryTree as RepositoryTree | undefined;
          if (!tree) {
            throw new Error('Repository tree not found in context');
          }

          const tsFiles = this.collectTypeScriptFiles(tree.root);
          const parsedFiles: ParsedFile[] = [];

          for (const file of tsFiles) {
            try {
              const result = await parseTypeScript(file.absolutePath);
              parsedFiles.push(convertToParsedFile(result, file.absolutePath));
            } catch (error) {
              logger.warn(`Failed to parse ${file.absolutePath}: ${error}`);
            }
          }

          return {
            ...context,
            metadata: {
              ...context.metadata,
              parsedFiles,
            },
          };
        },
      },
      {
        name: 'symbol-graph',
        execute: async (context: PipelineContext) => {
          logger.info('Building symbol graph...');
          const parsedFiles = context.metadata.parsedFiles as ParsedFile[] | undefined;
          if (!parsedFiles) {
            throw new Error('Parsed files not found in context');
          }

          const symbolGraph = buildSymbolGraph(parsedFiles);
          return {
            ...context,
            metadata: {
              ...context.metadata,
              symbolGraph,
            },
          };
        },
      },
      {
        name: 'knowledge-graph',
        execute: async (context: PipelineContext) => {
          logger.info('Building knowledge graph...');
          const symbolGraph = context.metadata.symbolGraph as SymbolGraph | undefined;
          const parsedFiles = context.metadata.parsedFiles as ParsedFile[] | undefined;

          if (!symbolGraph || !parsedFiles) {
            throw new Error('Symbol graph or parsed files not found in context');
          }

          const knowledgeGraph = buildKnowledgeGraph(symbolGraph, parsedFiles);
          return {
            ...context,
            metadata: {
              ...context.metadata,
              knowledgeGraph,
            },
          };
        },
      },
    ];
  }

  private collectTypeScriptFiles(node: FileNode | { type: 'directory'; children: RepositoryTree['root']['children'] }): FileNode[] {
    const files: FileNode[] = [];
    
    if ('type' in node && node.type === 'file' && (node.extension === 'ts' || node.extension === 'tsx')) {
      files.push(node);
    } else if ('type' in node && node.type === 'directory' && node.children) {
      for (const child of node.children) {
        files.push(...this.collectTypeScriptFiles(child as any));
      }
    }
    
    return files;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Runtime already initialized');
      return;
    }

    logger.info('Initializing DevForge Runtime...');
    logger.info(`Workspace: ${this.config.workspaceRoot}`);
    
    this.initialized = true;
    logger.info('Runtime initialized successfully');
  }

  async execute(): Promise<RuntimeResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    
    const initialContext: PipelineContext = {
      workspaceRoot: this.config.workspaceRoot,
      metadata: {},
      errors: [],
    };

    let context = initialContext;

    for (const stage of this.stages) {
      const stageStart = Date.now();
      try {
        logger.info(`Executing stage: ${stage.name}`);
        context = await stage.execute(context);
        logger.info(`Stage ${stage.name} completed in ${Date.now() - stageStart}ms`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Stage ${stage.name} failed: ${errorMessage}`);
        context.errors.push({
          stage: stage.name,
          message: errorMessage,
          timestamp: new Date(),
        });
      }
    }

    const duration = Date.now() - startTime;
    const success = context.errors.length === 0;

    logger.info(`Runtime execution completed in ${duration}ms - Success: ${success}`);

    return {
      success,
      context,
      duration,
    };
  }

  async dispose(): Promise<void> {
    logger.info('Disposing runtime...');
    this.initialized = false;
    logger.info('Runtime disposed');
  }
}

export function createRuntime(config: RuntimeConfig): DevForgeRuntime {
  return new DevForgeRuntime(config);
}
