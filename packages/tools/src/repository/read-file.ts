/**
 * repository.readFile — Read a repository source file safely.
 *
 * This is the most security-sensitive tool in this story.
 *
 * Security guarantees:
 * - ONLY reads files inside the configured workspace root
 * - Defends against path traversal (../, symlink escapes, encoded traversal)
 * - Enforces sensitive file policy (no .env, .pem, .key, etc.)
 * - Enforces file size limits
 * - Detects and rejects binary files
 * - Returns repository-relative paths only (never absolute host paths)
 *
 * Line numbers are 1-based.
 */

import * as fs from 'node:fs';
import { z } from 'zod';
import { createToolId } from '../types.js';
import type { Tool, ToolPermission } from '../types.js';
import type { ReadFileResult } from './types.js';
import { DEFAULT_MAX_FILE_BYTES } from './types.js';
import { validateSafePath, checkFileSize, isBinaryContent } from './path-security.js';

/** Configuration for readFile security policies. */
export interface ReadFileConfig {
  /** Maximum allowed file size in bytes. Default: 1MB. */
  readonly maxFileBytes?: number;
  /** Absolute path to workspace root. */
  readonly workspaceRoot: string;
}

/** Zod input schema for repository.readFile */
const readFileInputSchema = z.object({
  path: z.string().min(1, 'Path must not be empty'),
  startLine: z.number().int().positive('startLine must be a positive integer').optional(),
  endLine: z.number().int().positive('endLine must be a positive integer').optional(),
});

type ReadFileInput = z.infer<typeof readFileInputSchema>;

const TOOL_ID = createToolId('repository.read-file');

/**
 * Create the repository.readFile tool.
 *
 * @param config - Security configuration including workspace root
 */
export function createReadFileTool(config: ReadFileConfig): Tool<ReadFileInput, ReadFileResult> {
  const workspaceRoot = config.workspaceRoot;
  const maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  return {
    metadata: {
      id: TOOL_ID,
      name: 'Read File',
      description: 'Read a repository source file safely. Returns text content with line numbers. Supports optional line range filtering. All paths are repository-relative.',
      sideEffects: 'read',
      permissions: ['filesystem.read'] as ToolPermission[],
      idempotent: true,
    },
    inputSchema: readFileInputSchema,

    validate(input: unknown): ReadFileInput {
      return readFileInputSchema.parse(input);
    },

    async execute(input: ReadFileInput): Promise<{ success: true; data: ReadFileResult }> {
      // Step 1: Validate path security
      const pathResult = validateSafePath(input.path, workspaceRoot);
      if (!pathResult.valid) {
        throw new Error(`Path validation failed: ${pathResult.error}`);
      }

      const absolutePath = pathResult.canonicalPath!;
      const relativePath = pathResult.relativePath!;

      // Step 2: Check file size
      const sizeResult = checkFileSize(absolutePath, maxFileBytes);
      if (!sizeResult.ok) {
        throw new Error(`File check failed: ${sizeResult.error}`);
      }

      // Step 3: Read file as buffer first to check for binary content
      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(absolutePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('File not found');
        }
        throw new Error(`Failed to read file: ${String(err)}`);
      }

      // Step 4: Detect binary files
      if (isBinaryContent(buffer)) {
        throw new Error('File appears to be binary and cannot be read as text');
      }

      // Step 5: Decode as UTF-8 text
      const content = buffer.toString('utf-8');
      const lines = content.split('\n');

      // Step 6: Apply line range if specified
      const startLine = input.startLine ?? 1;
      const endLine = input.endLine ?? lines.length;

      // Validate line range
      if (startLine > endLine) {
        throw new Error('startLine must not exceed endLine');
      }
      if (startLine > lines.length) {
        throw new Error(`startLine (${startLine}) exceeds file length (${lines.length} lines)`);
      }

      // Clamp endLine to actual file length
      const clampedEnd = Math.min(endLine, lines.length);

      // Extract the requested range (1-based indexing)
      const selectedLines = lines.slice(startLine - 1, clampedEnd);
      const selectedContent = selectedLines.join('\n');

      const truncated = endLine > lines.length;

      return {
        success: true,
        data: {
          path: relativePath,
          content: selectedContent,
          size: sizeResult.size!,
          startLine: startLine,
          endLine: clampedEnd,
          truncated,
        },
      };
    },
  };
}