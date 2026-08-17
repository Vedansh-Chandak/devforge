/**
 * @devforge/vscode-extension — Error types (DF-020).
 *
 * Typed errors for the extension host, the DevForge client, the language
 * server, and the providers. Each error carries a stable machine code that
 * the views and the CLI mapping can rely on.
 */

/** Machine-readable error codes for the extension layer. */
export type ExtensionErrorCode =
  | 'CONFIG_ERROR'
  | 'NO_WORKSPACE'
  | 'CLIENT_ERROR'
  | 'SESSION_ERROR'
  | 'COMMAND_ERROR'
  | 'LANGUAGE_SERVER_ERROR'
  | 'DIFF_ERROR'
  | 'CANCELLED'
  | 'UNKNOWN';

/** Base class for all DevForge extension errors. */
export class DevForgeExtensionError extends Error {
  readonly code: ExtensionErrorCode;

  constructor(message: string, code: ExtensionErrorCode = 'UNKNOWN') {
    super(message);
    this.name = new.target.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Configuration could not be read or validated. */
export class ExtensionConfigError extends DevForgeExtensionError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
  }
}

/** No workspace folder is open (or the workspace root cannot be resolved). */
export class NoWorkspaceError extends DevForgeExtensionError {
  constructor(message = 'No workspace folder is open.') {
    super(message, 'NO_WORKSPACE');
  }
}

/** The DevForge client failed to initialize or execute. */
export class DevForgeClientError extends DevForgeExtensionError {
  constructor(message: string) {
    super(message, 'CLIENT_ERROR');
  }
}

/** Session creation or management failed. */
export class SessionError extends DevForgeExtensionError {
  constructor(message: string) {
    super(message, 'SESSION_ERROR');
  }
}

/** A command handler failed. */
export class CommandError extends DevForgeExtensionError {
  constructor(message: string) {
    super(message, 'COMMAND_ERROR');
  }
}

/** The language server could not start or process a request. */
export class LanguageServerError extends DevForgeExtensionError {
  constructor(message: string) {
    super(message, 'LANGUAGE_SERVER_ERROR');
  }
}

/** The diff provider could not render or apply a patch. */
export class DiffError extends DevForgeExtensionError {
  constructor(message: string) {
    super(message, 'DIFF_ERROR');
  }
}

/** The operation was cancelled by the user. */
export class CancelledError extends DevForgeExtensionError {
  constructor(message = 'Operation cancelled.') {
    super(message, 'CANCELLED');
  }
}

/**
 * Render any unknown error to a single line with a stable code. Stack traces
 * are only included when `debug` is true.
 */
export function formatExtensionError(error: unknown, debug: boolean): string {
  if (error instanceof DevForgeExtensionError) {
    if (debug && error.stack) {
      return `[${error.code}] ${error.message}\n${error.stack}`;
    }
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    if (debug && error.stack) {
      return `[UNKNOWN] ${error.message}\n${error.stack}`;
    }
    return `[UNKNOWN] ${error.message}`;
  }
  return `[UNKNOWN] ${String(error)}`;
}
