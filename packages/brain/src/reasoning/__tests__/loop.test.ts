import { describe, it, expect } from 'vitest';
import {
  createToolId,
  FakeTool,
  ToolRegistry,
  type ToolExecutionContext,
} from '@devforge/tools';
import type { ModelMessage, ModelResponse } from '@devforge/model-provider';
import { ReasoningLoop } from '../loop.js';
import { isTruncatedEvidence, type ReasoningLimits } from '../index.js';

const EXECUTION_CONTEXT: ToolExecutionContext = {
  workspaceRoot: '/test',
  requestId: 'loop-test',
  grantedPermissions: [],
};

function toolContent(toolId: string, args: unknown): string {
  return JSON.stringify({ toolCalls: [{ toolId, arguments: args }] });
}

function toolContentMulti(calls: ReadonlyArray<{ toolId: string; args: unknown }>): string {
  return JSON.stringify({ toolCalls: calls.map((c) => ({ toolId: c.toolId, arguments: c.args })) });
}

function readTool(dataFactory: (input: unknown) => unknown): FakeTool {
  return new FakeTool({
    id: createToolId('test.read'),
    sideEffects: 'read',
    permissions: [],
    execute: (input) => ({ success: true, data: dataFactory(input) }),
  });
}

interface ScriptedGen {
  generate: (messages: readonly ModelMessage[]) => Promise<ModelResponse>;
  readonly calls: number;
  readonly requests: readonly ModelMessage[][];
}

function scriptedResponses(contents: readonly string[]): ScriptedGen {
  let calls = 0;
  const requests: ModelMessage[][] = [];
  return {
    generate: async (messages) => {
      requests.push([...messages]);
      const content = contents[calls] ?? 'fallback text answer';
      calls++;
      return { content, model: 'fake-model', finishReason: 'stop' as const };
    },
    get calls() {
      return calls;
    },
    get requests() {
      return requests;
    },
  };
}

async function runLoop(input: {
  contents: readonly string[];
  tool?: FakeTool;
  limits?: Partial<ReasoningLimits>;
  signal?: AbortSignal;
  nowMs?: () => number;
}): Promise<{ result: Awaited<ReturnType<ReasoningLoop['execute']>>; gen: ScriptedGen; registry: ToolRegistry }> {
  const registry = new ToolRegistry();
  if (input.tool) {
    registry.register(input.tool);
  }
  const gen = scriptedResponses(input.contents);
  const loop = new ReasoningLoop();
  const result = await loop.execute({
    messages: [{ role: 'user', content: 'Test query' }],
    generate: gen.generate,
    limits: input.limits,
    signal: input.signal,
    nowMs: input.nowMs,
    toolExecution: {
      registry,
      executionContextProvider: () => EXECUTION_CONTEXT,
    },
  });
  return { result, gen, registry };
}

describe('ReasoningLoop', () => {
  it('runs multiple reasoning rounds and returns a final answer', async () => {
    const tool = readTool((input) => input);
    const { result, gen } = await runLoop({
      tool,
      contents: [
        toolContent('test.read', { q: 1 }),
        toolContent('test.read', { q: 2 }),
        'Final answer here',
      ],
    });

    expect(result.status).toBe('answered');
    expect(result.terminationReason).toBe('TEXT_FINAL_ANSWER');
    expect(result.finalAnswer).toBe('Final answer here');
    expect(result.state.providerCalls).toBe(3);
    expect(result.state.toolRoundsCompleted).toBe(2);
    expect(result.state.totalToolExecutions).toBe(2);
    expect(result.state.consecutiveNoProgressRounds).toBe(0);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.evidence).toHaveLength(2);
    expect(gen.requests).toHaveLength(3);

    // Evidence is fed back as a *user* message (tool evidence, never system).
    expect(gen.requests[1]).toHaveLength(2);
    expect(gen.requests[1]![1]!.role).toBe('user');
    expect(gen.requests[1]![1]!.content).toContain('[Tool evidence round 1]');
  });

  it('suppresses duplicate tool calls within a single round', async () => {
    const tool = readTool((input) => input);
    const { result } = await runLoop({
      tool,
      contents: [
        toolContentMulti([
          { toolId: 'test.read', args: { q: 1 } },
          { toolId: 'test.read', args: { q: 1 } },
        ]),
        'Answer',
      ],
    });

    expect(result.status).toBe('answered');
    expect(result.state.duplicateSuppressions).toBe(1);
    expect(result.state.totalToolExecutions).toBe(1);
    expect(result.state.providerCalls).toBe(2);
    expect(tool.callCount).toBe(1);
  });

  it('terminates when the repeated-tool limit is exceeded', async () => {
    const tool = readTool((input) => input);
    const { result } = await runLoop({
      tool,
      limits: { maxRepeatedToolCalls: 1 },
      contents: [toolContent('test.read', { q: 1 }), toolContent('test.read', { q: 1 })],
    });

    expect(result.status).toBe('tool_executed');
    expect(result.terminationReason).toBe('REPEATED_TOOL_CALL_LIMIT');
    expect(result.state.providerCalls).toBe(2);
    expect(result.state.totalToolExecutions).toBe(1);
    expect(result.state.toolRoundsCompleted).toBe(2);
  });

  it('terminates at the model-call limit', async () => {
    const tool = readTool((input) => input);
    const { result } = await runLoop({
      tool,
      limits: { maxModelCalls: 2 },
      contents: [toolContent('test.read', { q: 1 }), toolContent('test.read', { q: 2 })],
    });

    expect(result.status).toBe('tool_executed');
    expect(result.terminationReason).toBe('MODEL_CALL_LIMIT');
    expect(result.state.providerCalls).toBe(2);
    expect(result.state.totalToolExecutions).toBe(2);
  });

  it('terminates after consecutive no-progress rounds', async () => {
    const tool = readTool(() => ({ ok: true }));
    const { result } = await runLoop({
      tool,
      contents: [
        toolContent('test.read', { q: 1 }),
        toolContent('test.read', { q: 2 }),
        toolContent('test.read', { q: 3 }),
      ],
    });

    expect(result.status).toBe('tool_executed');
    expect(result.terminationReason).toBe('NO_PROGRESS');
    expect(result.state.consecutiveNoProgressRounds).toBe(2);
    expect(result.state.providerCalls).toBe(3);
    expect(result.state.totalToolExecutions).toBe(3);
  });

  it('bounds accumulated evidence by maxEvidenceBytes', async () => {
    const tool = readTool((input) => input);
    const { result } = await runLoop({
      tool,
      limits: { maxEvidenceBytes: 200 },
      contents: [toolContent('test.read', { payload: 'x'.repeat(300) }), 'Answer'],
    });

    expect(result.state.totalEvidenceBytes).toBeLessThanOrEqual(200);
    expect(result.evidence).toHaveLength(1);
    expect(isTruncatedEvidence(result.evidence[0]!.result)).toBe(true);
  });

  it('stops immediately when cancelled', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const tool = readTool((input) => input);
    const { result } = await runLoop({
      tool,
      signal: ctrl.signal,
      contents: [toolContent('test.read', { q: 1 })],
    });

    expect(result.terminationReason).toBe('CANCELLED');
    expect(result.status).toBe('provider_error');
    expect(result.providerError?.code).toBe('CANCELLED');
    expect(result.state.providerCalls).toBe(0);
    expect(result.state.totalToolExecutions).toBe(0);
  });

  it('stops when the deadline is exceeded', async () => {
    let now = 0;
    const tool = new FakeTool({
      id: createToolId('test.read'),
      sideEffects: 'read',
      execute: (input) => {
        now = 5_000;
        return { success: true, data: input };
      },
    });
    const registry = new ToolRegistry();
    registry.register(tool);
    const gen = scriptedResponses([toolContent('test.read', { q: 1 })]);
    const loop = new ReasoningLoop();
    const result = await loop.execute({
      messages: [{ role: 'user', content: 'Test query' }],
      generate: gen.generate,
      nowMs: () => now,
      limits: { maxDurationMs: 1_000 },
      toolExecution: {
        registry,
        executionContextProvider: () => EXECUTION_CONTEXT,
      },
    });

    expect(result.status).toBe('tool_executed');
    expect(result.terminationReason).toBe('TIME_LIMIT');
    expect(result.state.providerCalls).toBe(1);
    expect(result.state.totalToolExecutions).toBe(1);
    expect(gen.calls).toBe(1);
  });

  it('never executes denied tools and terminates when all are rejected', async () => {
    const writeTool = new FakeTool({
      id: createToolId('test.write'),
      sideEffects: 'write',
      permissions: [],
    });
    const registry = new ToolRegistry();
    registry.register(writeTool);
    const loop = new ReasoningLoop();
    const result = await loop.execute({
      messages: [{ role: 'user', content: 'Test query' }],
      generate: scriptedResponses([toolContent('test.write', { path: 'x' })]).generate,
      toolExecution: {
        registry,
        executionContextProvider: () => EXECUTION_CONTEXT,
      },
    });

    expect(result.status).toBe('tool_executed');
    expect(result.terminationReason).toBe('ALL_TOOLS_REJECTED');
    expect(writeTool.callCount).toBe(0);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe('denied');
  });

  it('never executes unknown tool proposals', async () => {
    const tool = readTool((input) => input);
    const registry = new ToolRegistry();
    registry.register(tool);
    const loop = new ReasoningLoop();
    const result = await loop.execute({
      messages: [{ role: 'user', content: 'Test query' }],
      generate: scriptedResponses([
        toolContent('nope.missing', {}),
        'Answer',
      ]).generate,
      toolExecution: {
        registry,
        executionContextProvider: () => EXECUTION_CONTEXT,
      },
    });

    expect(result.status).toBe('tool_executed');
    expect(result.terminationReason).toBe('ALL_TOOLS_REJECTED');
    expect(tool.callCount).toBe(0);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.status).toBe('denied');
  });
});
