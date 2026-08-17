import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DevForgeRuntime, createRuntime } from '../runtime.js';
import type { RuntimeConfig } from '../types.js';

const { mockRepositoryTree } = vi.hoisted(() => ({
  mockRepositoryTree: {
    root: {
      type: 'directory' as const,
      name: 'workspace',
      relativePath: '',
      absolutePath: '/test/workspace',
      children: [
        {
          type: 'directory' as const,
          name: 'src',
          relativePath: 'src',
          absolutePath: '/test/workspace/src',
          children: [
            {
              type: 'file' as const,
              name: 'test.ts',
              relativePath: 'src/test.ts',
              absolutePath: '/test/workspace/src/test.ts',
              extension: 'ts',
              size: 100,
            },
          ],
        },
      ],
    },
    rootPath: '/test/workspace',
    scannedAt: new Date().toISOString(),
    totalNodes: 2,
  },
}));

vi.mock('@devforge/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@devforge/repository-indexer', () => ({
  scanRepository: vi.fn().mockResolvedValue(mockRepositoryTree),
}));

vi.mock('@devforge/parser-typescript', () => ({
  parseTypeScript: vi.fn().mockResolvedValue({
    filePath: '/test/workspace/src/test.ts',
    imports: [],
    exports: [],
    classes: [],
    interfaces: [],
    enums: [],
    functions: [],
    typeAliases: [],
    syntaxErrors: [],
  }),
}));

vi.mock('@devforge/symbol-graph', () => ({
  buildSymbolGraph: vi.fn().mockResolvedValue({
    nodes: new Map(),
    edges: [],
  }),
}));

vi.mock('@devforge/knowledge-graph', () => ({
  buildKnowledgeGraph: vi.fn().mockResolvedValue({
    nodes: [],
    edges: [],
  }),
}));

describe('DevForgeRuntime', () => {
  let config: RuntimeConfig;
  let runtime: DevForgeRuntime;

  beforeEach(() => {
    config = {
      workspaceRoot: '/test/workspace',
    };
    runtime = new DevForgeRuntime(config);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create runtime with config', () => {
      expect(runtime).toBeInstanceOf(DevForgeRuntime);
    });

    it('should accept workspace root in config', () => {
      const customConfig: RuntimeConfig = {
        workspaceRoot: '/custom/path',
      };
      const customRuntime = new DevForgeRuntime(customConfig);
      expect(customRuntime).toBeInstanceOf(DevForgeRuntime);
    });
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(runtime.initialize()).resolves.not.toThrow();
    });

    it('should warn on double initialization', async () => {
      await runtime.initialize();
      await expect(runtime.initialize()).resolves.not.toThrow();
    });
  });

  describe('execute', () => {
    it('should execute all pipeline stages', async () => {
      const result = await runtime.execute();
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('duration');
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return success when all stages pass', async () => {
      const result = await runtime.execute();
      expect(result.success).toBe(true);
    });

    it('should include context with workspace root', async () => {
      const result = await runtime.execute();
      expect(result.context.workspaceRoot).toBe(config.workspaceRoot);
    });
  });

  describe('dispose', () => {
    it('should dispose without error', async () => {
      await expect(runtime.dispose()).resolves.not.toThrow();
    });
  });
});

describe('createRuntime', () => {
  it('should create runtime instance', () => {
    const config: RuntimeConfig = {
      workspaceRoot: '/test/workspace',
    };
    const runtime = createRuntime(config);
    expect(runtime).toBeInstanceOf(DevForgeRuntime);
  });
});
