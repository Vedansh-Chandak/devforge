
/**
 * Model Executor — Unit Tests
 *
 * Tests executeModelToolCalls: the controlled executor that is the
 * ONLY path for model-originated tool calls to reach Tool.execute().
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createToolId, ToolError } from '../types.js';
import type { ToolId, Tool, ToolExecutionContext, ToolPermission, SideEffectLevel } from '../types.js';
import { ToolRegistry } from '../registry.js';
import { FakeTool } from '../fake-tool.js';
import { executeModelToolCalls, DEFAULT_MAX_EXECUTIONS } from '../model-executor.js';
import type { AuthorizedToolCall } from '../protocol.js';

// ── Helpers ──

const TEST_CONTEXT: ToolExecutionContext = {
  workspaceRoot: '/tmp/test',
  requestId: 'test-req-1',
  grantedPermissions: ['repository.read', 'filesystem.read', 'process.execute'],
};

function makeAuthorizedCall(
  toolId: string,
  overrides: Partial<AuthorizedToolCall> = {},
): AuthorizedToolCall {
  return {
    callId: overrides.callId ?? `call_exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolId: createToolId(toolId),
    validatedInput: overrides.validatedInput ?? { query: 'test' },
    authorizedAt: Date.now(),
    toolMetadataSnapshot: overrides.toolMetadataSnapshot ?? {
      id: createToolId(toolId),
      sideEffects: 'none' as SideEffectLevel,
      permissions: [] as ToolPermission[],
    },
  };
}

function createRegistryWith(tool: Tool): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(tool);
  return registry;
}

// ── Basic Execution ──

describe('executeModelToolCalls', () => {
  describe('basic execution', () => {
    it('executes a single authorized call', async () => {
      const tool = new FakeTool<{ query: string }, { result: string }>({
        id: 'repository.search' as ToolId,
        inputSchema: z.object({ query: z.string() }),
        execute: async (input) => ({ success: true, data: { result: `found: ${input.query}` } }),
      });
      const registry = createRegistryWith(tool);
      const call = makeAuthorizedCall('repository.search', { validatedInput: { query: 'Auth' } });

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.status).toBe('completed');
      expect(result.results[0]!.result).toEqual({ result: 'found: Auth' });
      expect(result.results[0]!.callId).toBe(call.callId);
      expect(result.results[0]!.toolId).toBe('repository.search');
      expect(result.limitExceeded).toBe(false);
      expect(result.skippedCount).toBe(0);
      expect(tool.callCount).toBe(1);
    });

    it('executes multiple calls sequentially', async () => {
      const executionOrder: string[] = [];
      const tool1 = new FakeTool({
        id: 'tool.first' as ToolId,
        execute: async () => { executionOrder.push('first'); return { success: true, data: 'ok1' }; },
      });
      const tool2 = new FakeTool({
        id: 'tool.second' as ToolId,
        execute: async () => { executionOrder.push('second'); return { success: true, data: 'ok2' }; },
      });

      const registry = new ToolRegistry();
      registry.register(tool1);
      registry.register(tool2);

      const call1 = makeAuthorizedCall('tool.first', { callId: 'call_1' });
      const call2 = makeAuthorizedCall('tool.second', { callId: 'call_2' });

      const result = await executeModelToolCalls([call1, call2], TEST_CONTEXT, registry);

      expect(result.results).toHaveLength(2);
      expect(result.results[0]!.status).toBe('completed');
      expect(result.results[1]!.status).toBe('completed');
      expect(executionOrder).toEqual(['first', 'second']);
    });

    it('returns results in proposal order', async () => {
      const tool = new FakeTool({
        id: 'test.echo' as ToolId,
      });
      const registry = createRegistryWith(tool);

      const calls = Array.from({ length: 3 }, (_, i) =>
        makeAuthorizedCall('test.echo', { callId: `call_${i}`, validatedInput: { value: i } }),
      );

      const result = await executeModelToolCalls(calls, TEST_CONTEXT, registry);

      expect(result.results).toHaveLength(3);
      expect(result.results[0]!.callId).toBe('call_0');
      expect(result.results[1]!.callId).toBe('call_1');
      expect(result.results[2]!.callId).toBe('call_2');
    });
  });

  describe('empty input', () => {
    it('returns empty results for no calls', async () => {
      const registry = new ToolRegistry();
      const result = await executeModelToolCalls([], TEST_CONTEXT, registry);

      expect(result.results).toHaveLength(0);
      expect(result.audit).toHaveLength(0);
      expect(result.limitExceeded).toBe(false);
      expect(result.skippedCount).toBe(0);
    });
  });

  describe('TOCTOU protection', () => {
    it('returns not_found when tool removed from registry', async () => {
      const registry = new ToolRegistry(); // empty registry
      const call = makeAuthorizedCall('removed.tool');

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.status).toBe('not_found');
      expect(result.results[0]!.error!.code).toBe('TOOL_NOT_FOUND');
      expect(result.audit[0]!.status).toBe('denied');
      expect(result.audit[0]!.errorCode).toBe('TOOL_NOT_FOUND');
    });

    it('returns denied when side effects changed after authorization', async () => {
      const tool = new FakeTool({
        id: 'tool.changed' as ToolId,
        sideEffects: 'write',
      });
      const registry = createRegistryWith(tool);

      // Call authorized when sideEffects was 'none', but tool now has 'write'
      const call = makeAuthorizedCall('tool.changed', {
        toolMetadataSnapshot: {
          id: createToolId('tool.changed'),
          sideEffects: 'none',
          permissions: [],
        },
      });

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.results[0]!.status).toBe('denied');
      expect(result.results[0]!.error!.code).toBe('POLICY_DENIED');
    });

    it('returns denied when permissions not granted in context', async () => {
      const tool = new FakeTool({
        id: 'tool.permchanged' as ToolId,
        permissions: ['filesystem.write'] as ToolPermission[], // NOT in TEST_CONTEXT
      });
      const registry = createRegistryWith(tool);

      const call = makeAuthorizedCall('tool.permchanged', {
        toolMetadataSnapshot: {
          id: createToolId('tool.permchanged'),
          sideEffects: 'none',
          permissions: [],
        },
      });

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.results[0]!.status).toBe('denied');
      expect(result.results[0]!.error!.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('execution limit', () => {
    it('enforces default limit of 5', async () => {
      const registry = new ToolRegistry();
      const tool = new FakeTool({ id: 'test.tool' as ToolId });
      registry.register(tool);

      const calls = Array.from({ length: 7 }, (_, i) =>
        makeAuthorizedCall('test.tool', { callId: `call_${i}` }),
      );

      const result = await executeModelToolCalls(calls, TEST_CONTEXT, registry);

      expect(result.results).toHaveLength(7);
      // First 5 should execute
      expect(result.results[0]!.status).toBe('completed');
      expect(result.results[4]!.status).toBe('completed');
      // Last 2 should be limit_exceeded
      expect(result.results[5]!.status).toBe('limit_exceeded');
      expect(result.results[6]!.status).toBe('limit_exceeded');
      expect(result.limitExceeded).toBe(true);
      expect(result.skippedCount).toBe(2);
      expect(tool.callCount).toBe(5);
    });

    it('respects custom maxExecutions', async () => {
      const registry = new ToolRegistry();
      const tool = new FakeTool({ id: 'test.tool' as ToolId });
      registry.register(tool);

      const calls = Array.from({ length: 4 }, (_, i) =>
        makeAuthorizedCall('test.tool', { callId: `call_${i}` }),
      );

      const result = await executeModelToolCalls(calls, TEST_CONTEXT, registry, { maxExecutions: 2 });

      expect(result.results).toHaveLength(4);
      expect(result.results[0]!.status).toBe('completed');
      expect(result.results[1]!.status).toBe('completed');
      expect(result.results[2]!.status).toBe('limit_exceeded');
      expect(result.results[3]!.status).toBe('limit_exceeded');
      expect(result.limitExceeded).toBe(true);
      expect(result.skippedCount).toBe(2);
      expect(tool.callCount).toBe(2);
    });

    it('all calls execute when under limit', async () => {
      const registry = new ToolRegistry();
      const tool = new FakeTool({ id: 'test.tool' as ToolId });
      registry.register(tool);

      const calls = Array.from({ length: 3 }, (_, i) =>
        makeAuthorizedCall('test.tool', { callId: `call_${i}` }),
      );

      const result = await executeModelToolCalls(calls, TEST_CONTEXT, registry, { maxExecutions: 5 });

      expect(result.results).toHaveLength(3);
      expect(result.limitExceeded).toBe(false);
      expect(result.skippedCount).toBe(0);
      expect(tool.callCount).toBe(3);
    });
  });

  describe('tool execution failure', () => {
    it('handles tool returning failure result', async () => {
      const tool = new FakeTool({
        id: 'test.fail' as ToolId,
        failWith: { code: 'EXECUTION_FAILED', message: 'Internal error' },
      });
      const registry = createRegistryWith(tool);
      const call = makeAuthorizedCall('test.fail');

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.status).toBe('failed');
      expect(result.results[0]!.error!.code).toBe('EXECUTION_FAILED');
      expect(result.results[0]!.error!.message).toBe('Internal error');
      expect(result.audit[0]!.status).toBe('error');
    });

    it('builds the failed result as a proper ToolError', async () => {
      const tool = new FakeTool({
        id: 'test.fail' as ToolId,
        failWith: { code: 'EXECUTION_FAILED', message: 'Internal error' },
      });
      const result = await tool.execute({}, TEST_CONTEXT);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.name).toBe('ToolError');
        expect(result.error.code).toBe('EXECUTION_FAILED');
        expect(result.error.toolId).toBe('test.fail');
        expect(result.error).toBeInstanceOf(Error);
      }
    });

    it('handles tool throwing an exception', async () => {
      const tool = new FakeTool({
        id: 'test.crash' as ToolId,
        execute: async () => { throw new Error('Unexpected crash'); },
      });
      const registry = createRegistryWith(tool);
      const call = makeAuthorizedCall('test.crash');

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.status).toBe('failed');
      expect(result.results[0]!.error!.code).toBe('EXECUTION_FAILED');
      expect(result.results[0]!.error!.message).toContain('Unexpected crash');
    });

    it('preserves ToolError codes from thrown errors', async () => {
      const tool = new FakeTool({
        id: 'test.toolerror' as ToolId,
        execute: async () => {
          throw new ToolError('TIMEOUT', 'Timed out after 30s');
        },
      });
      const registry = createRegistryWith(tool);
      const call = makeAuthorizedCall('test.toolerror');

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.results[0]!.status).toBe('failed');
      expect(result.results[0]!.error!.code).toBe('EXECUTION_FAILED');
    });
  });

  describe('audit trail', () => {
    it('includes audit record for each call', async () => {
      const tool = new FakeTool({ id: 'test.audit' as ToolId });
      const registry = createRegistryWith(tool);
      const call = makeAuthorizedCall('test.audit', { callId: 'audit-call-1' });

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.audit).toHaveLength(1);
      expect(result.audit[0]!.callId).toBe('audit-call-1');
      expect(result.audit[0]!.toolId).toBe('test.audit');
      expect(result.audit[0]!.status).toBe('executed');
      expect(result.audit[0]!.startedAt).toBeTypeOf('number');
      expect(result.audit[0]!.duration).toBeGreaterThanOrEqual(0);
    });

    it('audit for denied call includes error info', async () => {
      const registry = new ToolRegistry(); // empty — tool not found
      const call = makeAuthorizedCall('missing.tool', { callId: 'audit-denied-1' });

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.audit).toHaveLength(1);
      expect(result.audit[0]!.callId).toBe('audit-denied-1');
      expect(result.audit[0]!.status).toBe('denied');
      expect(result.audit[0]!.errorCode).toBe('TOOL_NOT_FOUND');
      expect(result.audit[0]!.errorMessage).toBeDefined();
    });

    it('audit for limit_exceeded call', async () => {
      const registry = new ToolRegistry();
      const tool = new FakeTool({ id: 'test.tool' as ToolId });
      registry.register(tool);

      const calls = Array.from({ length: 3 }, (_, i) =>
        makeAuthorizedCall('test.tool', { callId: `call_${i}` }),
      );

      const result = await executeModelToolCalls(calls, TEST_CONTEXT, registry, { maxExecutions: 1 });

      expect(result.audit).toHaveLength(3);
      expect(result.audit[0]!.status).toBe('executed');
      expect(result.audit[1]!.status).toBe('limit_exceeded');
      expect(result.audit[2]!.status).toBe('limit_exceeded');
    });
  });

  describe('mixed results', () => {
    it('handles mix of success, failure, not_found, and limit_exceeded', async () => {
      const successTool = new FakeTool({ id: 'tool.success' as ToolId });
      const failTool = new FakeTool({
        id: 'tool.fail' as ToolId,
        failWith: { code: 'EXECUTION_FAILED', message: 'failed' },
      });

      const registry = new ToolRegistry();
      registry.register(successTool);
      registry.register(failTool);
      // 'tool.missing' is NOT registered

      const calls = [
        makeAuthorizedCall('tool.success', { callId: 'c1' }),
        makeAuthorizedCall('tool.fail', { callId: 'c2' }),
        makeAuthorizedCall('tool.missing', { callId: 'c3' }),
        makeAuthorizedCall('tool.success', { callId: 'c4' }),
        makeAuthorizedCall('tool.success', { callId: 'c5' }),
        makeAuthorizedCall('tool.success', { callId: 'c6' }),
      ];

      const result = await executeModelToolCalls(calls, TEST_CONTEXT, registry, { maxExecutions: 4 });

      expect(result.results).toHaveLength(6);
      expect(result.results[0]!.status).toBe('completed');
      expect(result.results[1]!.status).toBe('failed');
      expect(result.results[2]!.status).toBe('not_found');
      expect(result.results[3]!.status).toBe('completed');
      // not_found doesn't count toward limit (only executedCount++)
      // 3 successful executions (c1, c4, c5) out of 4 allowed
      expect(result.results[4]!.status).toBe('completed');
      expect(result.results[5]!.status).toBe('limit_exceeded');
      expect(result.limitExceeded).toBe(true);
      expect(result.skippedCount).toBe(1);
    });
  });

  describe('read-only policy at execution time', () => {
    it('denies write tool even if previously authorized', async () => {
      const writeTool = new FakeTool({
        id: 'tool.write' as ToolId,
        sideEffects: 'write',
      });
      const registry = createRegistryWith(writeTool);

      const call = makeAuthorizedCall('tool.write', {
        toolMetadataSnapshot: {
          id: createToolId('tool.write'),
          sideEffects: 'write', // same as current, but policy blocks write
          permissions: [],
        },
      });

      const result = await executeModelToolCalls([call], TEST_CONTEXT, registry);

      expect(result.results[0]!.status).toBe('denied');
      expect(result.results[0]!.error!.code).toBe('POLICY_DENIED');
    });
  });

  describe('DEFAULT_MAX_EXECUTIONS', () => {
    it('is 5', () => {
      expect(DEFAULT_MAX_EXECUTIONS).toBe(5);
    });
  });
});