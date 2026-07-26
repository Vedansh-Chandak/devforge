export interface RuntimeConfig {
  workspaceRoot: string;
  config?: {
    repositoryIndexer?: Record<string, unknown>;
    symbolGraph?: Record<string, unknown>;
    knowledgeGraph?: Record<string, unknown>;
  };
}

export interface PipelineStage {
  name: string;
  execute: (context: PipelineContext) => Promise<PipelineContext>;
}

export interface PipelineContext {
  workspaceRoot: string;
  metadata: Record<string, unknown>;
  errors: PipelineError[];
}

export interface PipelineError {
  stage: string;
  message: string;
  timestamp: Date;
}

export interface RuntimeResult {
  success: boolean;
  context: PipelineContext;
  duration: number;
}
