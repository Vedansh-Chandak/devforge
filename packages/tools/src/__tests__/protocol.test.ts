/**
 * Tool Protocol — Unit Tests
 *
 * Tests parseToolCallProposals, validateToolCallProposal,
 * authorizeModelToolCall, isReadOnlyAllowed — the provider-neutral
 * bridge between AI models and the tool execution layer.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createToolId } from '../types.js';
import type { ToolId, Tool, ToolExecutionContext, ToolPermission } from '../types.js';
import { ToolRegistry } from '../registry.js';
import { FakeTool } from '../fake-tool.js';
import {
  parseToolCallProposals,
  validateToolCallProposal,
  validateToolCallProposals,
  authorizeModelToolCall,
  isReadOnlyAllowed,
} from '../protocol.js';
import type { ToolCallProposal, ValidatedToolCall } from '../protocol.js';

// ── Helpers ──

const TEST_CONTEXT: ToolExecutionContext = {
  workspaceRoot: '/tmp/test',
  requestId: 'test-req-1',
  grantedPermissions: ['repository.read', 'filesystem.read', 'process.execute'],
};

function createMockTool(
  id: string,
  overrides: Partial<{ permissions: ToolPermission[]; sideEffects: 'none' | 'read' | 'write' | 'process' | 'network' }> = {},
): Tool {
  return {
    metadata: {
      id: createToolId(id),
      name: id,
      description: `Test tool: ${id}`,
      sideEffects: overrides.sideEffects ?? 'none',
      permissions: overrides.permissions ?? [],
      idempotent: true,
    },
    inputSchema: z.object({ query: z.string() }),
    validate(input: unknown) {
      return this.inputSchema.parse(input);
    },
    async execute(input) {
      return { success: true, data: { result: `processed: ${(input as { query: string }).query}` } };
    },
  };
}

function makeProposal(toolIdRaw: string, args: unknown = {}): ToolCallProposal {
  return {
    callId: `call_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    toolIdRaw,
    args,
  };
}

function makeValidatedCall(
  toolId: string,
  overrides: Partial<ValidatedToolCall> = {},
): ValidatedToolCall {
  return {
    callId: overrides.callId ?? `call_valid_${Date.now()}`,
    toolId: createToolId(toolId),
    validatedInput: overrides.validatedInput ?? { query: 'test' },
    toolMetadataSnapshot: overrides.toolMetadataSnapshot ?? {
      id: createToolId(toolId),
      sideEffects: 'none',
      permissions: [],
    },
  };
}

// ── isReadOnlyAllowed ──

describe('isReadOnlyAllowed', () => {
  it('allows "none"', () => {
    expect(isReadOnlyAllowed('none')).toBe(true);
  });

  it('allows "read"', () => {
    expect(isReadOnlyAllowed('read')).toBe(true);
  });

  it('denies "write"', () => {
    expect(isReadOnlyAllowed('write')).toBe(false);
  });

  it('denies "process"', () => {
    expect(isReadOnlyAllowed('process')).toBe(false);
  });

  it('denies "network"', () => {
    expect(isReadOnlyAllowed('network')).toBe(false);
  });
});

// ── parseToolCallProposals ──

describe('parseToolCallProposals', () => {
  describe('empty/malformed input', () => {
    it('returns empty for empty string', () => {
      expect(parseToolCallProposals('')).toEqual([]);
    });

    it('returns empty for non-JSON text', () => {
      expect(parseToolCallProposals('Hello, here is my answer')).toEqual([]);
    });

    it('returns empty for null-like input', () => {
      expect(parseToolCallProposals(null as unknown as string)).toEqual([]);
      expect(parseToolCallProposals(undefined as unknown as string)).toEqual([]);
    });
  });

  describe('toolCalls format', () => {
    it('parses { toolCalls: [...] } format', () => {
      const content = JSON.stringify({
        toolCalls: [
          { toolId: 'repository.search', arguments: { query: 'Auth' } },
        ],
      });

      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.toolIdRaw).toBe('repository.search');
      expect(proposals[0]!.args).toEqual({ query: 'Auth' });
      expect(proposals[0]!.callId).toMatch(/^call_/);
    });

    it('parses multiple tool calls', () => {
      const content = JSON.stringify({
        toolCalls: [
          { toolId: 'repository.search', arguments: { query: 'Auth' } },
          { toolId: 'repository.find-symbol', arguments: { query: 'UserService' } },
        ],
      });

      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(2);
      expect(proposals[0]!.toolIdRaw).toBe('repository.search');
      expect(proposals[1]!.toolIdRaw).toBe('repository.find-symbol');
    });
  });

  describe('direct array format', () => {
    it('parses [...] format', () => {
      const content = JSON.stringify([
        { name: 'repository.search', arguments: { query: 'Auth' } },
      ]);

      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.toolIdRaw).toBe('repository.search');
    });
  });

  describe('single call format', () => {
    it('parses { name: ..., arguments: ... } as a single call', () => {
      const content = JSON.stringify({
        name: 'repository.search',
        arguments: { query: 'Auth' },
      });

      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.toolIdRaw).toBe('repository.search');
    });
  });

  describe('markdown code blocks', () => {
    it('parses JSON inside ```json code blocks', () => {
      const content = 'Here is the tool call:\n```json\n' + JSON.stringify({
        toolCalls: [{ toolId: 'repository.search', arguments: { query: 'test' } }],
      }) + '\n```';

      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.toolIdRaw).toBe('repository.search');
    });

    it('parses JSON inside ``` code blocks (no language tag)', () => {
      const content = '```\n' + JSON.stringify({
        toolCalls: [{ toolId: 'repository.architecture', arguments: {} }],
      }) + '\n```';

      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.toolIdRaw).toBe('repository.architecture');
    });
  });

  describe('field name variants', () => {
    it('accepts "tool" field name', () => {
      const content = JSON.stringify({ toolCalls: [{ tool: 'test.tool', arguments: {} }] });
      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.toolIdRaw).toBe('test.tool');
    });

    it('accepts "input" field name for arguments', () => {
      const content = JSON.stringify({ toolCalls: [{ toolId: 'test.tool', input: { x: 1 } }] });
      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.args).toEqual({ x: 1 });
    });

    it('accepts "params" field name for arguments', () => {
      const content = JSON.stringify({ toolCalls: [{ toolId: 'test.tool', params: { y: 2 } }] });
      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.args).toEqual({ y: 2 });
    });

    it('defaults args to {} when no arguments field', () => {
      const content = JSON.stringify({ toolCalls: [{ toolId: 'test.tool' }] });
      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.args).toEqual({});
    });
  });

  describe('invalid entries are skipped', () => {
    it('skips entries without toolId/name/tool', () => {
      const content = JSON.stringify({
        toolCalls: [
          { arguments: { query: 'test' } }, // no toolId
          { toolId: 'valid.tool', arguments: { query: 'ok' } },
        ],
      });
      const proposals = parseToolCallProposals(content);
      expect(proposals).toHaveLength(1);
      expect(proposals[0]!.toolIdRaw).toBe('valid.tool');
    });
  });
});

// ── validateToolCallProposal ──

describe('validateToolCallProposal', () => {
  describe('valid proposals', () => {
    it('validates a correct proposal', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('repository.search'));

      const proposal = makeProposal('repository.search', { query: 'Auth' });
      const result = validateToolCallProposal(proposal, registry);

      expect(result.valid).toBe(true);
      expect(result.validatedCall).toBeDefined();
      expect(result.validatedCall!.toolId).toBe('repository.search');
      expect(result.validatedCall!.callId).toBe(proposal.callId);
    });

    it('validates tool with no required args', () => {
      const registry = new ToolRegistry();
      registry.register(new FakeTool({
        id: 'repository.architecture' as ToolId,
        inputSchema: z.object({}),
      }));

      const proposal = makeProposal('repository.architecture', {});
      const result = validateToolCallProposal(proposal, registry);

      expect(result.valid).toBe(true);
    });
  });

  describe('invalid tool ID', () => {
    it('rejects invalid tool ID format', () => {
      const registry = new ToolRegistry();
      const proposal = makeProposal('nodash', { query: 'test' });
      const result = validateToolCallProposal(proposal, registry);

      expect(result.valid).toBe(false);
      expect(result.error!.code).toBe('INVALID_TOOL_ID');
    });

    it('rejects uppercase tool ID', () => {
      const registry = new ToolRegistry();
      const proposal = makeProposal('Repository.Search', { query: 'test' });
      const result = validateToolCallProposal(proposal, registry);

      expect(result.valid).toBe(false);
      expect(result.error!.code).toBe('INVALID_TOOL_ID');
    });
  });

  describe('tool not found', () => {
    it('rejects proposal for unknown tool', () => {
      const registry = new ToolRegistry();
      const proposal = makeProposal('nonexistent.tool', { query: 'test' });
      const result = validateToolCallProposal(proposal, registry);

      expect(result.valid).toBe(false);
      expect(result.error!.code).toBe('TOOL_NOT_FOUND');
    });
  });

  describe('input validation', () => {
    it('rejects invalid input', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('repository.search'));

      const proposal = makeProposal('repository.search', { query: 123 }); // wrong type
      const result = validateToolCallProposal(proposal, registry);

      expect(result.valid).toBe(false);
      expect(result.error!.code).toBe('INVALID_INPUT');
    });

    it('rejects missing required fields', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('repository.search'));

      const proposal = makeProposal('repository.search', {}); // missing 'query'
      const result = validateToolCallProposal(proposal, registry);

      expect(result.valid).toBe(false);
      expect(result.error!.code).toBe('INVALID_INPUT');
    });
  });

  describe('snapshot captures metadata', () => {
    it('captures tool metadata at validation time', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('repository.search', {
        permissions: ['repository.read'],
        sideEffects: 'none',
      }));

      const proposal = makeProposal('repository.search', { query: 'Auth' });
      const result = validateToolCallProposal(proposal, registry);

      expect(result.valid).toBe(true);
      expect(result.validatedCall!.toolMetadataSnapshot.sideEffects).toBe('none');
      expect(result.validatedCall!.toolMetadataSnapshot.permissions).toEqual(['repository.read']);
    });
  });
});

// ── validateToolCallProposals (batch) ──

describe('validateToolCallProposals', () => {
  it('validates a batch and returns results in order', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('repository.search'));
    registry.register(createMockTool('repository.find-symbol'));

    const proposals = [
      makeProposal('repository.search', { query: 'Auth' }),
      makeProposal('nonexistent.tool', { query: 'nope' }),
      makeProposal('repository.find-symbol', { query: 'User' }),
    ];

    const results = validateToolCallProposals(proposals, registry);

    expect(results).toHaveLength(3);
    expect(results[0]!.valid).toBe(true);
    expect(results[1]!.valid).toBe(false);
    expect(results[1]!.error!.code).toBe('TOOL_NOT_FOUND');
    expect(results[2]!.valid).toBe(true);
  });
});

// ── authorizeModelToolCall ──

describe('authorizeModelToolCall', () => {
  describe('successful authorization', () => {
    it('authorizes a valid read-only tool call', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('repository.search', { permissions: ['repository.read'] }));

      const validated = makeValidatedCall('repository.search', {
        toolMetadataSnapshot: {
          id: createToolId('repository.search'),
          sideEffects: 'none',
          permissions: ['repository.read'],
        },
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(true);
      expect(result.authorizedCall).toBeDefined();
      expect(result.authorizedCall!.callId).toBe(validated.callId);
      expect(result.auditRecord.status).toBe('authorized');
    });
  });

  describe('TOCTOU protection', () => {
    it('denies when tool is removed from registry', () => {
      const registry = new ToolRegistry();
      // Don't register the tool

      const validated = makeValidatedCall('removed.tool');
      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(false);
      expect(result.denialReason).toContain('no longer registered');
      expect(result.auditRecord.errorCode).toBe('TOOL_NOT_FOUND');
    });

    it('denies when tool sideEffects changed', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('tool.write', { sideEffects: 'write' }));

      const validated = makeValidatedCall('tool.write', {
        toolMetadataSnapshot: {
          id: createToolId('tool.write'),
          sideEffects: 'none', // snapshot says 'none' but current is 'write'
          permissions: [],
        },
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(false);
      expect(result.auditRecord.errorCode).toBe('METADATA_CHANGED');
    });

    it('denies when tool permissions changed', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('tool.secure', { permissions: ['filesystem.write'] }));

      const validated = makeValidatedCall('tool.secure', {
        toolMetadataSnapshot: {
          id: createToolId('tool.secure'),
          sideEffects: 'none',
          permissions: [], // snapshot says no perms but current has 'admin.write'
        },
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(false);
      expect(result.auditRecord.errorCode).toBe('METADATA_CHANGED');
    });
  });

  describe('permission recheck', () => {
    it('denies when permissions not granted', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('filesystem.write', { permissions: ['filesystem.write'] }));

      const validated = makeValidatedCall('filesystem.write', {
        toolMetadataSnapshot: {
          id: createToolId('filesystem.write'),
          sideEffects: 'none',
          permissions: ['filesystem.write'],
        },
      });

      const contextNoPerms: ToolExecutionContext = {
        ...TEST_CONTEXT,
        grantedPermissions: ['repository.read'],
      };

      const result = authorizeModelToolCall(validated, contextNoPerms, registry);

      expect(result.authorized).toBe(false);
      expect(result.auditRecord.errorCode).toBe('PERMISSION_DENIED');
      expect(result.denialReason).toContain('filesystem.write');
    });
  });

  describe('read-only policy enforcement', () => {
    it('denies tools with write side effects', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('tool.write', { sideEffects: 'write' }));

      const validated = makeValidatedCall('tool.write', {
        toolMetadataSnapshot: {
          id: createToolId('tool.write'),
          sideEffects: 'write',
          permissions: [],
        },
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(false);
      expect(result.auditRecord.errorCode).toBe('POLICY_DENIED');
      expect(result.denialReason).toContain('write');
    });

    it('denies tools with process side effects', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('tool.proc', { sideEffects: 'process' }));

      const validated = makeValidatedCall('tool.proc', {
        toolMetadataSnapshot: {
          id: createToolId('tool.proc'),
          sideEffects: 'process',
          permissions: [],
        },
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(false);
      expect(result.auditRecord.errorCode).toBe('POLICY_DENIED');
    });

    it('denies tools with network side effects', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('tool.net', { sideEffects: 'network' }));

      const validated = makeValidatedCall('tool.net', {
        toolMetadataSnapshot: {
          id: createToolId('tool.net'),
          sideEffects: 'network',
          permissions: [],
        },
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(false);
      expect(result.auditRecord.errorCode).toBe('POLICY_DENIED');
    });

    it('allows tools with read side effects', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('tool.read', { sideEffects: 'read' }));

      const validated = makeValidatedCall('tool.read', {
        toolMetadataSnapshot: {
          id: createToolId('tool.read'),
          sideEffects: 'read',
          permissions: [],
        },
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(true);
    });

    it('allows tools with none side effects', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('tool.none', { sideEffects: 'none' }));

      const validated = makeValidatedCall('tool.none', {
        toolMetadataSnapshot: {
          id: createToolId('tool.none'),
          sideEffects: 'none',
          permissions: [],
        },
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(true);
    });
  });

  describe('audit record', () => {
    it('includes callId and toolId in audit', () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool('test.tool'));

      const validated = makeValidatedCall('test.tool', {
        callId: 'audit-test-call',
      });

      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.auditRecord.callId).toBe('audit-test-call');
      expect(result.auditRecord.toolId).toBe('test.tool');
    });

    it('audit records denial reason on failure', () => {
      const registry = new ToolRegistry();
      // Don't register tool

      const validated = makeValidatedCall('missing.tool');
      const result = authorizeModelToolCall(validated, TEST_CONTEXT, registry);

      expect(result.authorized).toBe(false);
      expect(result.auditRecord.status).toBe('denied');
      expect(result.auditRecord.errorCode).toBeDefined();
      expect(result.auditRecord.errorMessage).toBeDefined();
    });
  });
});

// ── Full pipeline: parse → validate → authorize ──

describe('full pipeline: parse → validate → authorize', () => {
  it('parses, validates, and authorizes a tool call from model content', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('repository.search', { permissions: ['repository.read'] }));

    const modelContent = JSON.stringify({
      toolCalls: [
        { toolId: 'repository.search', arguments: { query: 'authentication' } },
      ],
    });

    // 1. Parse
    const proposals = parseToolCallProposals(modelContent);
    expect(proposals).toHaveLength(1);

    // 2. Validate
    const validations = validateToolCallProposals(proposals, registry);
    expect(validations).toHaveLength(1);
    expect(validations[0]!.valid).toBe(true);

    // 3. Authorize
    const authResult = authorizeModelToolCall(
      validations[0]!.validatedCall!,
      TEST_CONTEXT,
      registry,
    );
    expect(authResult.authorized).toBe(true);
    expect(authResult.authorizedCall).toBeDefined();
    expect(authResult.auditRecord.status).toBe('authorized');
  });

  it('pipeline rejects at validation for unknown tool', () => {
    const registry = new ToolRegistry();

    const modelContent = JSON.stringify({
      toolCalls: [
        { toolId: 'nonexistent.tool', arguments: {} },
      ],
    });

    const proposals = parseToolCallProposals(modelContent);
    const validations = validateToolCallProposals(proposals, registry);

    expect(validations[0]!.valid).toBe(false);
    expect(validations[0]!.error!.code).toBe('TOOL_NOT_FOUND');
  });

  it('pipeline rejects at authorization for write-side-effect tool', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool('filesystem.write', { sideEffects: 'write' }));

    const modelContent = JSON.stringify({
      toolCalls: [
        { toolId: 'filesystem.write', arguments: { query: 'rm -rf /' } },
      ],
    });

    const proposals = parseToolCallProposals(modelContent);
    const validations = validateToolCallProposals(proposals, registry);

    expect(validations[0]!.valid).toBe(true); // validation passes

    const authResult = authorizeModelToolCall(
      validations[0]!.validatedCall!,
      TEST_CONTEXT,
      registry,
    );

    expect(authResult.authorized).toBe(false); // authorization blocks
    expect(authResult.auditRecord.errorCode).toBe('POLICY_DENIED');
  });
});