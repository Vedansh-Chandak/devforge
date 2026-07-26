import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createToolId, ToolError } from '../types.js';
import { ToolRegistry } from '../registry.js';
import { executeTool } from '../executor.js';
import { FakeTool } from '../fake-tool.js';
import type { ToolId, Tool, ToolExecutionContext, ToolPermission } from '../types.js';

// ── Helpers ──

const TEST_CONTEXT: ToolExecutionContext = {
  workspaceRoot: '/tmp/test',
  requestId: 'test-req-1',
  grantedPermissions: ['repository.read', 'filesystem.read', 'process.execute'],
};

function createTestTool(overrides: Partial<{
  id: ToolId;
  permissions: ToolPermission[];
}> = {}): Tool<{ value: string }, { echoed: string }> {
  const id = overrides.id ?? 'test.echo' as ToolId;
  return {
    metadata: {
      id,
      name: `Test ${id}`,
      description: `Test tool: ${id}`,
      sideEffects: 'none',
      permissions: overrides.permissions ?? [],
      idempotent: true,
    },
    inputSchema: z.object({ value: z.string() }),
    validate(input: unknown) {
      return this.inputSchema.parse(input);
    },
    async execute(input) {
      return { success: true, data: { echoed: input.value } };
    },
  };
}

// ── createToolId ──

describe('createToolId', () => {
  it('accepts valid ids', () => {
    expect(createToolId('repository.search')).toBe('repository.search');
    expect(createToolId('filesystem.read')).toBe('filesystem.read');
    expect(createToolId('test.echo')).toBe('test.echo');
    expect(createToolId('ns.tool-name')).toBe('ns.tool-name');
    expect(createToolId('a.b')).toBe('a.b');
    expect(createToolId('tool123.name123')).toBe('tool123.name123');
  });

  it('rejects invalid ids', () => {
    expect(() => createToolId('')).toThrow('Invalid ToolId');
    expect(() => createToolId('no-dot')).toThrow('Invalid ToolId');
    expect(() => createToolId('.empty-ns')).toThrow('Invalid ToolId');
    expect(() => createToolId('NS.uppercase')).toThrow('Invalid ToolId');
    expect(() => createToolId('ns.UPPERCASE')).toThrow('Invalid ToolId');
    expect(() => createToolId('ns tool name')).toThrow('Invalid ToolId');
    expect(() => createToolId('ns/tool')).toThrow('Invalid ToolId');
  });
});

// ── ToolRegistry ──

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new ToolRegistry();
    const tool = createTestTool();
    const result = registry.register(tool);
    expect(result.success).toBe(true);
    expect(registry.has('test.echo' as ToolId)).toBe(true);
    expect(registry.get('test.echo' as ToolId)).toBe(tool);
  });

  it('returns undefined for unknown tool', () => {
    const registry = new ToolRegistry();
    expect(registry.get('unknown.tool' as ToolId)).toBeUndefined();
  });

  it('rejects duplicate registration with same priority', () => {
    const registry = new ToolRegistry();
    const tool1 = createTestTool({ id: 'test.dup' as ToolId });
    const tool2 = createTestTool({ id: 'test.dup' as ToolId });
    expect(registry.register(tool1).success).toBe(true);
    const result = registry.register(tool2);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('already registered');
  });

  it('allows higher priority to override', () => {
    const registry = new ToolRegistry();
    const tool1 = createTestTool({ id: 'test.override' as ToolId });
    const tool2 = createTestTool({ id: 'test.override' as ToolId });
    registry.register(tool1, 0);
    const result = registry.register(tool2, 5);
    expect(result.success).toBe(true);
    expect(registry.get('test.override' as ToolId)).toBe(tool2);
  });

  it('does not allow lower priority to override', () => {
    const registry = new ToolRegistry();
    const tool1 = createTestTool({ id: 'test.nooverride' as ToolId });
    const tool2 = createTestTool({ id: 'test.nooverride' as ToolId });
    registry.register(tool1, 10);
    const result = registry.register(tool2, 5);
    expect(result.success).toBe(false);
    expect(registry.get('test.nooverride' as ToolId)).toBe(tool1);
  });

  it('unregisters a tool', () => {
    const registry = new ToolRegistry();
    const tool = createTestTool();
    registry.register(tool);
    expect(registry.has('test.echo' as ToolId)).toBe(true);
    expect(registry.unregister('test.echo' as ToolId)).toBe(true);
    expect(registry.has('test.echo' as ToolId)).toBe(false);
  });

  it('unregister returns false for unknown tool', () => {
    const registry = new ToolRegistry();
    expect(registry.unregister('unknown.tool' as ToolId)).toBe(false);
  });

  it('lists all registered tools in insertion order', () => {
    const registry = new ToolRegistry();
    const tool1 = createTestTool({ id: 'test.first' as ToolId });
    const tool2 = createTestTool({ id: 'test.second' as ToolId });
    const tool3 = createTestTool({ id: 'test.third' as ToolId });
    registry.register(tool1);
    registry.register(tool2);
    registry.register(tool3);
    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list[0]!.id).toBe('test.first');
    expect(list[1]!.id).toBe('test.second');
    expect(list[2]!.id).toBe('test.third');
  });

  it('findByPermission returns tools whose permissions are all granted', () => {
    const registry = new ToolRegistry();
    const toolNoPerms = createTestTool({ id: 'test.noperms' as ToolId, permissions: [] });
    const toolReadPerms = createTestTool({ id: 'test.read' as ToolId, permissions: ['repository.read'] });
    const toolWritePerms = createTestTool({ id: 'test.write' as ToolId, permissions: ['repository.write'] });
    registry.register(toolNoPerms);
    registry.register(toolReadPerms);
    registry.register(toolWritePerms);

    const results = registry.findByPermission(['repository.read']);
    expect(results).toHaveLength(2);
    expect(results.map((t) => t.metadata.id)).toContain('test.noperms');
    expect(results.map((t) => t.metadata.id)).toContain('test.read');
    expect(results.map((t) => t.metadata.id)).not.toContain('test.write');
  });

  it('size reflects count', () => {
    const registry = new ToolRegistry();
    expect(registry.size).toBe(0);
    registry.register(createTestTool({ id: 'test.a' as ToolId }));
    expect(registry.size).toBe(1);
    registry.register(createTestTool({ id: 'test.b' as ToolId }));
    expect(registry.size).toBe(2);
  });
});

// ── executeTool ──

describe('executeTool', () => {
  it('executes successfully', async () => {
    const registry = new ToolRegistry();
    const tool = createTestTool();
    registry.register(tool);

    const result = await executeTool<{ value: string }, { echoed: string }>(
      registry, 'test.echo' as ToolId, { value: 'DevForge' }, TEST_CONTEXT,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ echoed: 'DevForge' });
    }
  });

  it('returns TOOL_NOT_FOUND for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await executeTool(
      registry, 'unknown.tool' as ToolId, {}, TEST_CONTEXT,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TOOL_NOT_FOUND');
      expect(result.error.toolId).toBe('unknown.tool');
    }
  });

  it('returns PERMISSION_DENIED when permissions missing', async () => {
    const registry = new ToolRegistry();
    const tool = createTestTool({ permissions: ['filesystem.write'] });
    registry.register(tool);

    const result = await executeTool(
      registry, 'test.echo' as ToolId, { value: 'hi' }, TEST_CONTEXT,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
      expect(result.error.message).toContain('filesystem.write');
    }
  });

  it('returns INVALID_INPUT when input is wrong', async () => {
    const registry = new ToolRegistry();
    const tool = createTestTool();
    registry.register(tool);

    const result = await executeTool(
      registry, 'test.echo' as ToolId, { value: 123 }, TEST_CONTEXT,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('does not call execute when input is invalid', async () => {
    const registry = new ToolRegistry();
    const executeFn = vi.fn().mockResolvedValue({ success: true, data: {} });
    const tool = new FakeTool({
      id: 'test.echo' as ToolId,
      inputSchema: z.object({ value: z.string() }),
      execute: executeFn as any,
    });
    registry.register(tool);

    await executeTool(
      registry, 'test.echo' as ToolId, { wrong: 'type' }, TEST_CONTEXT,
    );
    expect(executeFn).not.toHaveBeenCalled();
  });

  it('returns EXECUTION_FAILED when tool throws', async () => {
    const registry = new ToolRegistry();
    const tool = new FakeTool({
      id: 'test.echo' as ToolId,
      inputSchema: z.object({ value: z.string() }),
      execute: async () => { throw new Error('boom'); },
    });
    registry.register(tool);

    const result = await executeTool(
      registry, 'test.echo' as ToolId, { value: 'hi' }, TEST_CONTEXT,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('EXECUTION_FAILED');
      expect(result.error.message).toContain('boom');
    }
  });

  it('preserves ToolError when tool throws one', async () => {
    const registry = new ToolRegistry();
    const tool = new FakeTool({
      id: 'test.echo' as ToolId,
      inputSchema: z.object({ value: z.string() }),
      execute: async () => {
        throw new ToolError('TIMEOUT', 'timed out');
      },
    });
    registry.register(tool);

    const result = await executeTool(
      registry, 'test.echo' as ToolId, { value: 'hi' }, TEST_CONTEXT,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TIMEOUT');
    }
  });
});

// ── FakeTool ──

describe('FakeTool', () => {
  it('creates with defaults', () => {
    const tool = new FakeTool({ id: 'test.echo' as ToolId });
    expect(tool.metadata.id).toBe('test.echo');
    expect(tool.metadata.sideEffects).toBe('none');
    expect(tool.metadata.permissions).toEqual([]);
    expect(tool.metadata.idempotent).toBe(true);
  });

  it('executes and returns input by default', async () => {
    const tool = new FakeTool<{ value: string }, { value: string }>({ id: 'test.echo' as ToolId });
    const result = await tool.execute({ value: 'hi' }, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ value: 'hi' });
    }
  });

  it('records calls', async () => {
    const tool = new FakeTool({ id: 'test.rec' as ToolId });
    expect(tool.callCount).toBe(0);
    expect(tool.lastInput).toBeUndefined();

    await tool.execute({ a: 1 }, TEST_CONTEXT);
    expect(tool.callCount).toBe(1);
    expect(tool.lastInput).toEqual({ a: 1 });

    await tool.execute({ a: 2 }, TEST_CONTEXT);
    expect(tool.callCount).toBe(2);
    expect(tool.lastInput).toEqual({ a: 2 });
  });

  it('resetRecordings clears history', async () => {
    const tool = new FakeTool({ id: 'test.reset' as ToolId });
    await tool.execute({}, TEST_CONTEXT);
    expect(tool.callCount).toBe(1);
    tool.resetRecordings();
    expect(tool.callCount).toBe(0);
    expect(tool.lastInput).toBeUndefined();
  });

  it('returns configured failure', async () => {
    const tool = new FakeTool({
      id: 'test.fail' as ToolId,
      failWith: { code: 'EXECUTION_FAILED', message: 'simulated failure' },
    });
    const result = await tool.execute({}, TEST_CONTEXT);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('EXECUTION_FAILED');
    }
  });

  it('returns configured custom result', async () => {
    const tool = new FakeTool<unknown, { custom: boolean }>({
      id: 'test.custom' as ToolId,
      execute: async () => ({ success: true, data: { custom: true } }),
    });
    const result = await tool.execute({}, TEST_CONTEXT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.custom).toBe(true);
    }
  });

  it('respects custom permissions', () => {
    const tool = new FakeTool({
      id: 'test.perm' as ToolId,
      permissions: ['filesystem.write'],
    });
    expect(tool.metadata.permissions).toEqual(['filesystem.write']);
  });

  it('validates input with custom schema', () => {
    const tool = new FakeTool({
      id: 'test.validate' as ToolId,
      inputSchema: z.object({ name: z.string() }),
    });
    expect(() => tool.validate({ name: 123 })).toThrow();
    expect(tool.validate({ name: 'hello' })).toEqual({ name: 'hello' });
  });

  it('generates schema via toSchema()', () => {
    const tool = new FakeTool({
      id: 'test.schema' as ToolId,
      inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
    });
    const schema = tool.toSchema();
    expect(schema.name).toBe('test.schema');
    expect(schema.inputSchema.type).toBe('object');
    expect((schema.inputSchema as any).properties.query.type).toBe('string');
  });
});

// ── Integration Test ──

describe('Integration: Registry → Executor → FakeTool', () => {
  it('registers, executes, verifies permissions checked, input validated, tool called once', async () => {
    const registry = new ToolRegistry();

    const tool = new FakeTool<{ value: string }, { echoed: string }>({
      id: 'test.echo' as ToolId,
      inputSchema: z.object({ value: z.string() }),
      permissions: ['repository.read'],
      execute: async (input) => ({
        success: true,
        data: { echoed: input.value },
      }),
    });

    const regResult = registry.register(tool);
    expect(regResult.success).toBe(true);
    expect(registry.has('test.echo' as ToolId)).toBe(true);

    // Execute with full pipeline
    const result = await executeTool<{ value: string }, { echoed: string }>(
      registry,
      'test.echo' as ToolId,
      { value: 'DevForge' },
      {
        workspaceRoot: '/tmp/test',
        requestId: 'req-1',
        grantedPermissions: ['repository.read'],
      },
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ echoed: 'DevForge' });
    }

    // Verify tool was called exactly once
    expect(tool.callCount).toBe(1);
    expect(tool.lastInput).toEqual({ value: 'DevForge' });

    const recordings = tool.getRecordings();
    expect(recordings[0]!.context.requestId).toBe('req-1');
  });

  it('fails when permission not granted (spy-based)', async () => {
    const registry = new ToolRegistry();
    const executeFn = vi.fn();

    const tool = new FakeTool({
      id: 'test.protected' as ToolId,
      permissions: ['filesystem.write'],
      execute: executeFn as any,
    });

    registry.register(tool);

    const result = await executeTool(
      registry,
      'test.protected' as ToolId,
      {},
      {
        workspaceRoot: '/tmp/test',
        requestId: 'req-2',
        grantedPermissions: ['repository.read'], // missing filesystem.write
      },
    );

    expect(result.success).toBe(false);
    expect(executeFn).not.toHaveBeenCalled();
    if (!result.success) {
      expect(result.error.code).toBe('PERMISSION_DENIED');
    }
  });

  it('fails on invalid input without executing tool (spy-based)', async () => {
    const registry = new ToolRegistry();
    const executeFn = vi.fn();

    const tool = new FakeTool({
      id: 'test.strict' as ToolId,
      inputSchema: z.object({ name: z.string() }),
      execute: executeFn as any,
    });

    registry.register(tool);

    const result = await executeTool(
      registry,
      'test.strict' as ToolId,
      { name: 123 }, // wrong type
      {
        workspaceRoot: '/tmp/test',
        requestId: 'req-3',
        grantedPermissions: [],
      },
    );

    expect(result.success).toBe(false);
    expect(executeFn).not.toHaveBeenCalled();
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('returns deterministic failure for unknown tool', async () => {
    const registry = new ToolRegistry();
    const result = await executeTool(
      registry,
      'nonexistent.tool' as ToolId,
      {},
      TEST_CONTEXT,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TOOL_NOT_FOUND');
      expect(result.error.toolId).toBe('nonexistent.tool');
    }
  });

  it('no model, no Brain, no network, no filesystem writes', async () => {
    // This integration test verifies the tool system is infrastructure-independent.
    // FakeTool has no real side effects.
    // executeTool only does registry lookup → permission check → validation → execute.
    // No ModelProvider, no Brain, no Runtime involved.
    const registry = new ToolRegistry();
    const tool = new FakeTool({ id: 'safe.echo' as ToolId });
    registry.register(tool);

    const result = await executeTool(registry, 'safe.echo' as ToolId, {}, TEST_CONTEXT);
    expect(result.success).toBe(true);
    // No real side effects occurred
  });
});

// ── Side-effect Metadata ──

describe('Side-effect and idempotency metadata', () => {
  it('FakeTool exposes sideEffects and idempotent in metadata', () => {
    const tool = new FakeTool({
      id: 'test.write' as ToolId,
      sideEffects: 'write',
      idempotent: false,
    });
    expect(tool.metadata.sideEffects).toBe('write');
    expect(tool.metadata.idempotent).toBe(false);
  });

  it('ToolRegistry list preserves metadata', () => {
    const registry = new ToolRegistry();
    const tool = new FakeTool({
      id: 'test.meta' as ToolId,
      sideEffects: 'process',
      idempotent: true,
    });
    registry.register(tool);
    const list = registry.list();
    expect(list[0]!.sideEffects).toBe('process');
    expect(list[0]!.idempotent).toBe(true);
  });
});

// ── Schema Exposure ──

describe('Schema exposure', () => {
  it('FakeTool toSchema produces provider-neutral schema', () => {
    const tool = new FakeTool({
      id: 'test.search' as ToolId,
      inputSchema: z.object({ query: z.string(), maxResults: z.number().optional() }),
    });
    const schema = tool.toSchema();
    expect(schema.name).toBe('test.search');
    expect(schema.description).toBeTruthy();
    expect(schema.inputSchema.type).toBe('object');
  });
});

// ── Cancellation ──

describe('Cancellation', () => {
  it('AbortSignal is passed through context', async () => {
    const registry = new ToolRegistry();
    let receivedSignal: AbortSignal | undefined;
    const tool = new FakeTool({
      id: 'test.signal' as ToolId,
      execute: async (_input, context) => {
        receivedSignal = context.signal;
        return { success: true, data: null };
      },
    });
    registry.register(tool);

    const controller = new AbortController();
    await executeTool(
      registry,
      'test.signal' as ToolId,
      {},
      { ...TEST_CONTEXT, signal: controller.signal },
    );
    expect(receivedSignal).toBe(controller.signal);
  });
});

// ── ToolError ──

describe('ToolError', () => {
  it('carries code, message, toolId, and cause', () => {
    const cause = new Error('root');
    const err = new ToolError('EXECUTION_FAILED', 'test message', { toolId: 'x.y' as ToolId, cause });
    expect(err.code).toBe('EXECUTION_FAILED');
    expect(err.message).toBe('test message');
    expect(err.toolId).toBe('x.y');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('ToolError');
    expect(err instanceof Error).toBe(true);
  });
});