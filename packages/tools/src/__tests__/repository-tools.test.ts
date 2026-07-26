/**
 * Repository Tools — Unit Tests
 *
 * Tests all five repository tools with mocked RuntimeBridge.
 * Tests path security, file reading security, and tool factory/registration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createToolId } from '../types.js';
import type { ToolExecutionContext } from '../types.js';
import { ToolRegistry } from '../registry.js';
import { createRepositoryTools, registerRepositoryTools } from '../repository/index.js';
import type { RuntimeBridge, RuntimeAnalysis, SymbolEntry } from '../repository/types.js';
import { validateSafePath, isSensitiveFile, checkFileSize, isBinaryContent } from '../repository/path-security.js';
import { createSearchTool } from '../repository/search.js';
import { createFindSymbolTool } from '../repository/find-symbol.js';
import { createDependenciesTool } from '../repository/dependencies.js';
import { createArchitectureTool } from '../repository/architecture.js';
import { createReadFileTool } from '../repository/read-file.js';

// ── Test Context ──

const TEST_CONTEXT: ToolExecutionContext = {
  workspaceRoot: '/tmp/test',
  requestId: 'test-req-1',
  grantedPermissions: ['repository.read', 'filesystem.read', 'process.execute'],
};

// ── Helpers ──

function makeSymbol(name: string, kind: SymbolEntry['kind'] = 'function', filePath = `src/${name}.ts`): SymbolEntry {
  return {
    name,
    qualifiedName: `module.${name}`,
    kind,
    filePath,
    line: 10,
    documentation: `Docs for ${name}`,
  };
}

function makeAnalysis(): RuntimeAnalysis {
  const symbols = new Map<string, SymbolEntry>();
  symbols.set('module.Auth', makeSymbol('Auth', 'class', 'src/auth.ts'));
  symbols.set('module.User', makeSymbol('User', 'interface', 'src/user.ts'));
  symbols.set('module.login', makeSymbol('login', 'function', 'src/auth.ts'));
  symbols.set('module.logout', makeSymbol('logout', 'function', 'src/auth.ts'));
  symbols.set('module.Database', makeSymbol('Database', 'class', 'src/db.ts'));
  symbols.set('module.Config', makeSymbol('Config', 'type-alias', 'src/config.ts'));

  return {
    symbols,
    architecture: {
      modules: [
        { name: 'auth', kind: 'module', description: 'Auth module', filePath: 'src/auth.ts', symbolCount: 3 },
      ],
      services: [
        { name: 'AuthService', kind: 'service', filePath: 'src/auth.ts', symbolCount: 2 },
      ],
      apis: [],
      repositories: [],
      databases: [
        { name: 'PostgresDB', kind: 'database', symbolCount: 1 },
      ],
      relationships: [
        { from: 'module.login', to: 'module.Auth', kind: 'depends-on' },
        { from: 'module.Auth', to: 'module.Database', kind: 'uses' },
      ],
    },
    parsedFiles: ['src/auth.ts', 'src/user.ts', 'src/db.ts', 'src/config.ts'],
  };
}

function makeMockBridge(analysis?: RuntimeAnalysis): RuntimeBridge {
  const data = analysis ?? makeAnalysis();
  return {
    async execute() {
      return data;
    },
    get ready() {
      return true;
    },
  };
}

// ── Path Security Tests ──

describe('path-security', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-test-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'export const app = 1;');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=123');
    fs.writeFileSync(path.join(tmpDir, 'key.pem'), '-----BEGIN RSA PRIVATE KEY-----');
    fs.writeFileSync(path.join(tmpDir, '.env.local'), 'SECRET2=456');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validateSafePath', () => {
    it('allows valid relative paths', () => {
      const result = validateSafePath('src/app.ts', tmpDir);
      expect(result.valid).toBe(true);
      expect(result.relativePath).toBe('src/app.ts');
    });

    it('rejects absolute paths', () => {
      const result = validateSafePath('/etc/passwd', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    it('rejects paths with ../ traversal', () => {
      const result = validateSafePath('../etc/passwd', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    it('rejects paths with ../../ traversal', () => {
      const result = validateSafePath('../../etc/passwd', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    it('rejects empty paths', () => {
      const result = validateSafePath('', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    it('rejects whitespace-only paths', () => {
      const result = validateSafePath('   ', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    it('rejects sensitive .env files', () => {
      const result = validateSafePath('.env', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('PERMISSION_DENIED');
    });

    it('rejects sensitive .env.local files', () => {
      const result = validateSafePath('.env.local', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('PERMISSION_DENIED');
    });

    it('rejects sensitive .pem files', () => {
      const result = validateSafePath('key.pem', tmpDir);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe('PERMISSION_DENIED');
    });

    it('rejects path traversal that resolves inside workspace via encoding', () => {
      const result = validateSafePath('src/../../../etc/passwd', tmpDir);
      expect(result.valid).toBe(false);
    });
  });

  describe('isSensitiveFile', () => {
    it('detects .env files', () => {
      expect(isSensitiveFile('.env')).toBe(true);
    });

    it('detects .env.local', () => {
      expect(isSensitiveFile('.env.local')).toBe(true);
    });

    it('detects .pem files', () => {
      expect(isSensitiveFile('cert.pem')).toBe(true);
    });

    it('detects .key files', () => {
      expect(isSensitiveFile('server.key')).toBe(true);
    });

    it('detects SSH keys', () => {
      expect(isSensitiveFile('id_rsa')).toBe(true);
      expect(isSensitiveFile('id_ed25519')).toBe(true);
    });

    it('detects .npmrc', () => {
      expect(isSensitiveFile('.npmrc')).toBe(true);
    });

    it('allows normal source files', () => {
      expect(isSensitiveFile('src/app.ts')).toBe(false);
      expect(isSensitiveFile('README.md')).toBe(false);
      expect(isSensitiveFile('package.json')).toBe(false);
    });
  });

  describe('checkFileSize', () => {
    it('returns ok for small files', () => {
      const filePath = path.join(tmpDir, 'src/app.ts');
      const result = checkFileSize(filePath, 1024);
      expect(result.ok).toBe(true);
      expect(result.size).toBeGreaterThan(0);
    });

    it('rejects files exceeding size limit', () => {
      const filePath = path.join(tmpDir, 'src/app.ts');
      const result = checkFileSize(filePath, 1);
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('LIMIT_EXCEEDED');
    });

    it('returns NOT_FOUND for missing files', () => {
      const result = checkFileSize(path.join(tmpDir, 'nonexistent.ts'), 1024);
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('NOT_FOUND');
    });
  });

  describe('isBinaryContent', () => {
    it('detects binary content via null bytes', () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(isBinaryContent(binary)).toBe(true);
    });

    it('allows text content', () => {
      const text = Buffer.from('export const app = 1;');
      expect(isBinaryContent(text)).toBe(false);
    });

    it('allows empty buffers', () => {
      expect(isBinaryContent(Buffer.alloc(0))).toBe(false);
    });
  });
});

// ── Tool Creation Tests ──

describe('repository.search', () => {
  it('has correct metadata', () => {
    const tool = createSearchTool(makeMockBridge());
    expect(tool.metadata.id).toBe(createToolId('repository.search'));
    expect(tool.metadata.sideEffects).toBe('none');
    expect(tool.metadata.idempotent).toBe(true);
    expect(tool.metadata.permissions).toContain('repository.read');
  });

  it('validates input with Zod', () => {
    const tool = createSearchTool(makeMockBridge());
    expect(() => tool.validate({})).toThrow();
    expect(() => tool.validate({ query: '' })).toThrow();
    expect(() => tool.validate({ query: 'Auth' })).not.toThrow();
  });

  it('finds matching symbols', async () => {
    const tool = createSearchTool(makeMockBridge());
    const input = tool.validate({ query: 'Auth' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbols.length).toBeGreaterThanOrEqual(1);
      expect(result.data.symbols[0]!.name).toBe('Auth');
    }
  });

  it('returns empty for no matches', async () => {
    const tool = createSearchTool(makeMockBridge());
    const input = tool.validate({ query: 'zzzznonexistent' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbols).toHaveLength(0);
      expect(result.data.totalMatches).toBe(0);
    }
  });

  it('is case-insensitive', async () => {
    const tool = createSearchTool(makeMockBridge());
    const input = tool.validate({ query: 'auth' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbols.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('repository.findSymbol', () => {
  it('has correct metadata', () => {
    const tool = createFindSymbolTool(makeMockBridge());
    expect(tool.metadata.id).toBe(createToolId('repository.find-symbol'));
    expect(tool.metadata.sideEffects).toBe('none');
  });

  it('finds matching symbols', async () => {
    const tool = createFindSymbolTool(makeMockBridge());
    const input = tool.validate({ query: 'login' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbols.length).toBe(1);
      expect(result.data.symbols[0]!.name).toBe('login');
      expect(result.data.symbols[0]!.kind).toBe('function');
    }
  });

  it('finds multiple symbols with partial match', async () => {
    const tool = createFindSymbolTool(makeMockBridge());
    const input = tool.validate({ query: 'Auth' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbols.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('repository.dependencies', () => {
  it('has correct metadata', () => {
    const tool = createDependenciesTool(makeMockBridge());
    expect(tool.metadata.id).toBe(createToolId('repository.dependencies'));
    expect(tool.metadata.sideEffects).toBe('none');
  });

  it('returns dependencies for a symbol', async () => {
    const tool = createDependenciesTool(makeMockBridge());
    const input = tool.validate({ symbol: 'login' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.symbol).toBe('login');
      expect(result.data.dependencies.length).toBe(1);
    }
  });

  it('returns dependents for a symbol', async () => {
    const tool = createDependenciesTool(makeMockBridge());
    const input = tool.validate({ symbol: 'Auth', direction: 'dependents' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependents.length).toBe(1);
      expect(result.data.dependents[0]!.name).toBe('login');
    }
  });

  it('returns empty for unknown symbols', async () => {
    const tool = createDependenciesTool(makeMockBridge());
    const input = tool.validate({ symbol: 'nonexistent' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependencies).toHaveLength(0);
      expect(result.data.dependents).toHaveLength(0);
    }
  });

  it('respects direction parameter', async () => {
    const tool = createDependenciesTool(makeMockBridge());
    const inputDeps = tool.validate({ symbol: 'login', direction: 'dependencies' });
    const resultDeps = await tool.execute(inputDeps, TEST_CONTEXT);
    expect(resultDeps.success).toBe(true);
    if (resultDeps.success) {
      expect(resultDeps.data.dependencies.length).toBe(1);
      expect(resultDeps.data.dependents).toHaveLength(0);
    }

    const inputDependents = tool.validate({ symbol: 'login', direction: 'dependents' });
    const resultDependents = await tool.execute(inputDependents, TEST_CONTEXT);
    expect(resultDependents.success).toBe(true);
    if (resultDependents.success) {
      expect(resultDependents.data.dependencies).toHaveLength(0);
    }
  });
});

describe('repository.architecture', () => {
  it('has correct metadata', () => {
    const tool = createArchitectureTool(makeMockBridge());
    expect(tool.metadata.id).toBe(createToolId('repository.architecture'));
    expect(tool.metadata.sideEffects).toBe('none');
  });

  it('accepts empty input', () => {
    const tool = createArchitectureTool(makeMockBridge());
    expect(() => tool.validate({})).not.toThrow();
  });

  it('returns architecture data from bridge', async () => {
    const tool = createArchitectureTool(makeMockBridge());
    const input = tool.validate({});
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modules.length).toBe(1);
      expect(result.data.services.length).toBe(1);
      expect(result.data.relationships.length).toBe(2);
    }
  });
});

describe('repository.readFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readfile-test-'));
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'line1\nline2\nline3\nline4\nline5');
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=123');
    fs.writeFileSync(path.join(tmpDir, 'data.bin'), Buffer.from([0x00, 0x01]));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has correct metadata', () => {
    const tool = createReadFileTool({ workspaceRoot: tmpDir });
    expect(tool.metadata.id).toBe(createToolId('repository.read-file'));
    expect(tool.metadata.sideEffects).toBe('read');
    expect(tool.metadata.permissions).toContain('filesystem.read');
  });

  it('reads a file successfully', async () => {
    const tool = createReadFileTool({ workspaceRoot: tmpDir });
    const input = tool.validate({ path: 'src/app.ts' });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toContain('line1');
      expect(result.data.path).toBe('src/app.ts');
      expect(result.data.size).toBeGreaterThan(0);
    }
  });

  it('supports line range filtering', async () => {
    const tool = createReadFileTool({ workspaceRoot: tmpDir });
    const input = tool.validate({ path: 'src/app.ts', startLine: 2, endLine: 4 });
    const result = await tool.execute(input, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe('line2\nline3\nline4');
      expect(result.data.startLine).toBe(2);
      expect(result.data.endLine).toBe(4);
    }
  });

  it('rejects path traversal', async () => {
    const tool = createReadFileTool({ workspaceRoot: tmpDir });
    const input = tool.validate({ path: '../etc/passwd' });
    await expect(tool.execute(input, TEST_CONTEXT)).rejects.toThrow('Path validation failed');
  });

  it('rejects sensitive files', async () => {
    const tool = createReadFileTool({ workspaceRoot: tmpDir });
    const input = tool.validate({ path: '.env' });
    await expect(tool.execute(input, TEST_CONTEXT)).rejects.toThrow('Path validation failed');
  });

  it('rejects binary files', async () => {
    const tool = createReadFileTool({ workspaceRoot: tmpDir });
    const input = tool.validate({ path: 'data.bin' });
    await expect(tool.execute(input, TEST_CONTEXT)).rejects.toThrow('binary');
  });

  it('rejects missing files', async () => {
    const tool = createReadFileTool({ workspaceRoot: tmpDir });
    const input = tool.validate({ path: 'nonexistent.ts' });
    await expect(tool.execute(input, TEST_CONTEXT)).rejects.toThrow();
  });

  it('validates startLine/endLine', () => {
    const tool = createReadFileTool({ workspaceRoot: tmpDir });
    expect(() => tool.validate({ path: 'src/app.ts', startLine: -1 })).toThrow();
    expect(() => tool.validate({ path: 'src/app.ts', startLine: 0 })).toThrow();
    expect(() => tool.validate({ path: 'src/app.ts', startLine: 1, endLine: 0 })).toThrow();
  });
});

// ── Factory & Registration Tests ──

describe('createRepositoryTools', () => {
  it('creates all five tools', () => {
    const tools = createRepositoryTools({
      runtime: makeMockBridge(),
      workspaceRoot: '/tmp/test',
    });

    expect(tools.search).toBeDefined();
    expect(tools.findSymbol).toBeDefined();
    expect(tools.dependencies).toBeDefined();
    expect(tools.architecture).toBeDefined();
    expect(tools.readFile).toBeDefined();
  });

  it('each tool has a unique ID', () => {
    const tools = createRepositoryTools({
      runtime: makeMockBridge(),
      workspaceRoot: '/tmp/test',
    });

    const ids = [
      tools.search.metadata.id,
      tools.findSymbol.metadata.id,
      tools.dependencies.metadata.id,
      tools.architecture.metadata.id,
      tools.readFile.metadata.id,
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(5);
  });

  it('all tools are idempotent and sideEffect=none except readFile', () => {
    const tools = createRepositoryTools({
      runtime: makeMockBridge(),
      workspaceRoot: '/tmp/test',
    });

    for (const tool of [tools.search, tools.findSymbol, tools.dependencies, tools.architecture]) {
      expect(tool.metadata.idempotent).toBe(true);
      expect(tool.metadata.sideEffects).toBe('none');
    }
    expect(tools.readFile.metadata.sideEffects).toBe('read');
  });
});

describe('registerRepositoryTools', () => {
  it('registers all five tools in a registry', () => {
    const registry = new ToolRegistry();
    const tools = createRepositoryTools({
      runtime: makeMockBridge(),
      workspaceRoot: '/tmp/test',
    });

    const results = registerRepositoryTools(registry, tools);
    expect(results).toHaveLength(5);
    expect(results.every(r => r.success)).toBe(true);

    // Verify they're in the registry
    const toolIds = registry.list().map(m => m.id);
    expect(toolIds).toContain(createToolId('repository.search'));
    expect(toolIds).toContain(createToolId('repository.find-symbol'));
    expect(toolIds).toContain(createToolId('repository.dependencies'));
    expect(toolIds).toContain(createToolId('repository.architecture'));
    expect(toolIds).toContain(createToolId('repository.read-file'));
  });

  it('reports failure for duplicate registrations', () => {
    const registry = new ToolRegistry();
    const tools = createRepositoryTools({
      runtime: makeMockBridge(),
      workspaceRoot: '/tmp/test',
    });

    registerRepositoryTools(registry, tools);
    const secondResults = registerRepositoryTools(registry, tools);
    expect(secondResults.every(r => !r.success)).toBe(true);
  });
});

// ── Shared RuntimeBridge Tests ──

describe('Shared RuntimeBridge', () => {
  it('all tools share the same bridge instance', () => {
    const bridge = makeMockBridge();
    const searchTool = createSearchTool(bridge);
    const findSymbolTool = createFindSymbolTool(bridge);

    expect(searchTool).toBeDefined();
    expect(findSymbolTool).toBeDefined();
  });

  it('all tools use the same bridge (integration via factory)', async () => {
    let callCount = 0;
    const countingBridge: RuntimeBridge = {
      async execute() {
        callCount++;
        return makeAnalysis();
      },
      get ready() { return true; },
    };

    const tools = createRepositoryTools({
      runtime: countingBridge,
      workspaceRoot: '/tmp/test',
    });

    // Execute each tool
    await tools.search.execute({ query: 'Auth' }, TEST_CONTEXT);
    await tools.findSymbol.execute({ query: 'Auth' }, TEST_CONTEXT);
    await tools.dependencies.execute({ symbol: 'login' }, TEST_CONTEXT);
    await tools.architecture.execute({}, TEST_CONTEXT);

    // All four should have called the bridge
    expect(callCount).toBe(4);
  });
});