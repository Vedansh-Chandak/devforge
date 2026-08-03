/**
 * @devforge/execution — Git subsystem (DF-015).
 *
 * The ONLY subsystem allowed to interact with Git. All commands run through
 * the CommandRunner; validation and parsing live in pure modules.
 */

// Service
export { createGitService, GitServiceImpl } from './service.js';

// Types
export type {
  GitService,
  GitServiceConfig,
  GitRepositoryDetection,
} from './types.js';
export type {
  GitStatus,
  GitFileStatus,
  GitFileStatusKind,
  GitDiff,
  GitDiffFile,
  GitDiffFileStatus,
  GitDiffHunk,
  GitDiffLine,
  GitDiffLineKind,
  GitBranch,
  GitCommit,
  GitRepositoryInfo,
} from './types.js';
export {
  DEFAULT_MAX_COMMIT_MESSAGE_LENGTH,
  DEFAULT_MAX_COMMIT_LINES,
} from './types.js';

// Errors
export { GIT_ERROR_CODES } from './errors.js';
export {
  GitError,
  GitValidationError,
  GitRepositoryError,
  GitCommandError,
  GitParseError,
} from './errors.js';
export type { GitErrorCode, GitErrorOptions } from './errors.js';

// Validator
export {
  validateRepoRoot,
  validateGitPaths,
  validateCommitMessage,
} from './validator.js';
export type {
  RepoRootValidation,
  GitPathsValidation,
  GitCommitLimits,
  CommitMessageValidation,
} from './validator.js';

// Parser
export {
  parseGitStatus,
  parseGitDiff,
  renderUnifiedDiff,
  parseGitBranches,
  parseCurrentBranch,
  parseHead,
  parseRepositoryDetection,
} from './parser.js';
