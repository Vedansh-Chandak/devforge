/**
 * @devforge/execution — Deterministic command validation.
 *
 * Validates CommandRequest before execution. Rejects:
 * - empty commands
 * - absolute executable paths
 * - relative traversal
 * - shell metacharacters
 * - shell expansion
 * - pipes
 * - redirects
 * - background execution
 * - multiple commands
 * - unknown executables
 */

import type { Command, CommandRequest } from './types.js';
import {
  ALLOWED_COMMANDS,
} from './types.js';
import {
  MAX_COMMAND_LENGTH,
  MAX_ARGS,
  MAX_ARG_LENGTH,
  MAX_ENV_VARS,
  MAX_ENV_KEY_LENGTH,
  MAX_ENV_VALUE_LENGTH,
  SHELL_METACHARACTERS,
  SHELL_EXPANSION_PATTERNS,
  MULTIPLE_COMMAND_PATTERNS,
} from './limits.js';
import { CommandValidationError, COMMAND_ERROR_CODES } from './errors.js';

export type CommandValidation =
  | {
      readonly ok: true;
      readonly request: CommandRequest;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly reason: string;
    };

const ABSOLUTE_PATH_REGEX = /^\//;
const DRIVE_LETTER_REGEX = /^[A-Za-z]:/;
const RELATIVE_PATH_REGEX = /^\.\.?[/\\]/;
const TRAVERSAL_REGEX = /\.\./;
const CONTROL_CHAR_REGEX = /[\u0000-\u001f]/;

function hasShellMetacharacters(input: string): boolean {
  return SHELL_METACHARACTERS.some((char) => input.includes(char));
}

function hasShellExpansion(input: string): boolean {
  return SHELL_EXPANSION_PATTERNS.some((pattern) => pattern.test(input));
}

function hasMultipleCommands(input: string): boolean {
  return MULTIPLE_COMMAND_PATTERNS.some((pattern) => pattern.test(input));
}

function isAbsolutePath(input: string): boolean {
  return ABSOLUTE_PATH_REGEX.test(input) || DRIVE_LETTER_REGEX.test(input);
}

function hasTraversal(input: string): boolean {
  return TRAVERSAL_REGEX.test(input);
}

function hasControlCharacters(input: string): boolean {
  return CONTROL_CHAR_REGEX.test(input);
}

export function validateCommand(request: CommandRequest): CommandValidation {
  if (!request.command || typeof request.command !== 'string') {
    return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: 'Command must not be empty' };
  }

  if (request.command.length > MAX_COMMAND_LENGTH) {
    return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: `Command name exceeds maximum length (${MAX_COMMAND_LENGTH})` };
  }

  if (isAbsolutePath(request.command)) {
    return { ok: false, code: COMMAND_ERROR_CODES.ABSOLUTE_EXECUTABLE, reason: 'Absolute executable paths are not allowed' };
  }

  if (hasTraversal(request.command)) {
    return { ok: false, code: COMMAND_ERROR_CODES.RELATIVE_TRAVERSAL, reason: 'Command contains path traversal' };
  }

  if (RELATIVE_PATH_REGEX.test(request.command)) {
    return { ok: false, code: COMMAND_ERROR_CODES.RELATIVE_EXECUTABLE, reason: 'Relative executable paths are not allowed' };
  }

  if (hasControlCharacters(request.command)) {
    return { ok: false, code: COMMAND_ERROR_CODES.SHELL_METACHARACTER, reason: 'Command contains control characters' };
  }

  if (hasShellExpansion(request.command)) {
    return { ok: false, code: COMMAND_ERROR_CODES.SHELL_EXPANSION, reason: 'Command contains shell expansion' };
  }

  if (hasMultipleCommands(request.command)) {
    return { ok: false, code: COMMAND_ERROR_CODES.MULTIPLE_COMMANDS, reason: 'Command contains multiple commands' };
  }

  if (hasShellMetacharacters(request.command)) {
    return { ok: false, code: COMMAND_ERROR_CODES.SHELL_METACHARACTER, reason: 'Command contains shell metacharacters' };
  }

  if (!ALLOWED_COMMANDS.includes(request.command as Command)) {
    return { ok: false, code: COMMAND_ERROR_CODES.UNKNOWN_EXECUTABLE, reason: `Executable "${request.command}" is not in the allowlist` };
  }

  if (!Array.isArray(request.args)) {
    return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: 'Args must be an array' };
  }

  if (request.args.length > MAX_ARGS) {
    return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: `Too many arguments (max ${MAX_ARGS})` };
  }

  for (const arg of request.args) {
    if (typeof arg !== 'string') {
      return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: 'All arguments must be strings' };
    }
    if (arg.length > MAX_ARG_LENGTH) {
      return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: `Argument exceeds maximum length (${MAX_ARG_LENGTH})` };
    }
    if (hasControlCharacters(arg)) {
      return { ok: false, code: COMMAND_ERROR_CODES.SHELL_METACHARACTER, reason: 'Argument contains control characters' };
    }
    if (hasShellExpansion(arg)) {
      return { ok: false, code: COMMAND_ERROR_CODES.SHELL_EXPANSION, reason: 'Argument contains shell expansion' };
    }
    if (hasMultipleCommands(arg)) {
      return { ok: false, code: COMMAND_ERROR_CODES.MULTIPLE_COMMANDS, reason: 'Argument contains multiple commands' };
    }
    if (hasShellMetacharacters(arg)) {
      return { ok: false, code: COMMAND_ERROR_CODES.SHELL_METACHARACTER, reason: 'Argument contains shell metacharacters' };
    }
  }

  if (request.environment !== undefined) {
    if (typeof request.environment !== 'object' || request.environment === null) {
      return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: 'Environment must be an object' };
    }
    const envKeys = Object.keys(request.environment);
    if (envKeys.length > MAX_ENV_VARS) {
      return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: `Too many environment variables (max ${MAX_ENV_VARS})` };
    }
    for (const key of envKeys) {
      if (typeof key !== 'string' || key.length > MAX_ENV_KEY_LENGTH) {
        return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: `Environment key exceeds maximum length (${MAX_ENV_KEY_LENGTH})` };
      }
      const value = request.environment[key];
      if (typeof value !== 'string' || value.length > MAX_ENV_VALUE_LENGTH) {
        return { ok: false, code: COMMAND_ERROR_CODES.EMPTY_COMMAND, reason: `Environment value for "${key}" exceeds maximum length (${MAX_ENV_VALUE_LENGTH})` };
      }
    }
  }

  return { ok: true, request };
}

export { COMMAND_ERROR_CODES };