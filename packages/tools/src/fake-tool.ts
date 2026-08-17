/**
 * FakeTool — testing utility for tool system tests.
 *
 * Supports:
 * - deterministic output
 * - request/input recording
 * - configurable metadata and permissions
 * - simulated failures
 * - simulated delay
 */

import { z } from 'zod';
import {
  ToolError,
  type Tool,
  type ToolErrorCode,
  type ToolId,
  type ToolMetadata,
  type ToolPermission,
  type ToolExecutionContext,
  type ToolResult,
  type SideEffectLevel,
} from './types.js';

export interface FakeToolConfig<TInput = unknown, TOutput = unknown> {
  /** Tool ID (namespace.name format) */
  id: ToolId;
  /** Tool name (display) */
  name?: string;
  /** Tool description */
  description?: string;
  /** Required permissions (default: []) */
  permissions?: ToolPermission[];
  /** Side-effect level (default: 'none') */
  sideEffects?: SideEffectLevel;
  /** Whether tool is idempotent (default: true) */
  idempotent?: boolean;
  /** Zod schema for input validation (default: z.unknown()) */
  inputSchema?: z.ZodType<TInput>;
  /** Function that returns the tool result */
  execute?: (input: TInput, context: ToolExecutionContext) => ToolResult<TOutput> | Promise<ToolResult<TOutput>>;
  /** If set, the tool will fail with this error code */
  failWith?: { code: string; message: string };
  /** Delay in ms before returning (default: 0) */
  delayMs?: number;
}

export interface FakeToolRecording {
  input: unknown;
  context: ToolExecutionContext;
  timestamp: number;
}

/**
 * A fake tool for testing. Records all executions and can simulate
 * configurable behavior without real side effects.
 */
export class FakeTool<TInput = unknown, TOutput = unknown> implements Tool<TInput, TOutput> {
  readonly metadata: ToolMetadata;
  readonly inputSchema: z.ZodType<TInput>;

  private readonly config: FakeToolConfig<TInput, TOutput>;
  private readonly recordings: FakeToolRecording[] = [];

  constructor(config: FakeToolConfig<TInput, TOutput>) {
    this.config = config;
    this.metadata = {
      id: config.id,
      name: config.name ?? config.id,
      description: config.description ?? `Fake tool: ${config.id}`,
      sideEffects: config.sideEffects ?? 'none',
      permissions: config.permissions ?? [],
      idempotent: config.idempotent ?? true,
    };
    this.inputSchema = config.inputSchema ?? z.unknown() as z.ZodType<TInput>;
  }

  validate(input: unknown): TInput {
    return this.inputSchema.parse(input);
  }

  async execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>> {
    // Record the execution
    this.recordings.push({
      input,
      context,
      timestamp: Date.now(),
    });

    // Simulate delay if configured
    if (this.config.delayMs && this.config.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }

    // Simulate failure if configured
    if (this.config.failWith) {
      return {
        success: false,
        error: new ToolError(
          this.config.failWith.code as ToolErrorCode,
          this.config.failWith.message,
          { toolId: this.config.id },
        ),
      };
    }

    // Execute the configured function or return success
    if (this.config.execute) {
      return this.config.execute(input, context);
    }

    return {
      success: true,
      data: input as unknown as TOutput,
    };
  }

  /** Get all recorded executions */
  getRecordings(): FakeToolRecording[] {
    return [...this.recordings];
  }

  /** Get the number of times this tool was executed */
  get callCount(): number {
    return this.recordings.length;
  }

  /** Get the last recorded input, or undefined if never called */
  get lastInput(): TInput | undefined {
    if (this.recordings.length === 0) return undefined;
    const last = this.recordings[this.recordings.length - 1];
    return last ? (last.input as TInput) : undefined;
  }

  /** Reset all recordings */
  resetRecordings(): void {
    this.recordings.length = 0;
  }

  /** Get the provider-neutral schema for model exposure */
  toSchema(): { name: ToolId; description: string; inputSchema: Record<string, unknown> } {
    return {
      name: this.metadata.id,
      description: this.metadata.description,
      inputSchema: this.inputSchemaToJSON(),
    };
  }

  private inputSchemaToJSON(): Record<string, unknown> {
    // Basic JSON Schema derivation from Zod v4
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return zodToJsonField(this.inputSchema as any);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function zodToJsonField(schema: any): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return { type: 'object' };

  // Zod v4 uses _zod.def or _def internally
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def: any = schema._zod?.def ?? schema._def;

  if (!def) return { type: 'object' };

  switch (def.type) {
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'array': {
      const inner = def.element ?? def.items;
      return { type: 'array', items: inner ? zodToJsonField(inner) : { type: 'object' } };
    }
    case 'object': {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const shape = def.shape ?? {};
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonField(value);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const innerDef: any = (value as any)?._zod?.def ?? (value as any)?._def;
        if (innerDef?.type !== 'optional') {
          required.push(key);
        } else {
          // Unwrap optional and check inner type for required detection
        }
      }
      return { type: 'object', properties, required };
    }
    case 'optional': {
      const inner = def.innerType ?? def.unwrap?.();
      return inner ? zodToJsonField(inner) : { type: 'object' };
    }
    default:
      return { type: 'object' };
  }
}
