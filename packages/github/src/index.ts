/**
 * @devforge/github — GitHub Integration & CI Automation (DF-021).
 *
 * Public entry point for the GitHub subsystem. Exposes the client, auth,
 * services (issues, pull requests, reviews, comments, checks, actions),
 * repository adapter, webhook parsing, event bus, diff/patch tooling, and
 * the typed error hierarchy. All downstream packages should import from here.
 */

export * from './types.js';
export * from './errors.js';

export {
  GitHubClient,
  createGitHubClient,
  mapHttpError,
} from './client.js';
export type {
  RequestOptions,
  ApiResponse,
  FetchRequest,
  Page,
} from './client.js';

export {
  AuthManager,
  FileCredentialStore,
  MemoryCredentialStore,
  signAppJwt,
  validateCredential,
} from './auth.js';
export type {
  AuthHeaders,
  CredentialStore,
  FileCredentialStoreOptions,
  AuthResult,
  AuthMethodName,
} from './auth.js';

export { IssuesService, normalizeIssue } from './issues.js';
export type {
  CreateIssueOptions,
  UpdateIssueOptions,
  LinkedIssue,
} from './issues.js';

export { PullRequestsService, reviewHeader, normalizePullRequest } from './pull-requests.js';
export type {
  CreatePullRequestOptions,
  UpdatePullRequestOptions,
  PullRequestDescription,
} from './pull-requests.js';

export { ReviewEngine, defaultRules, REVIEW_CATEGORIES } from './reviews.js';
export type {
  ReviewSeverity,
  ReviewCategory,
  ReviewFinding,
  ReviewReport,
  ReviewOptions,
} from './reviews.js';

export { CommentsService } from './comments.js';

export { ChecksService } from './checks.js';
export type { CreateCheckRunOptions } from './checks.js';

export { ActionsService } from './actions.js';
export type { FixCiOptions, MonitoredRun, RepairAgent } from './actions.js';

export {
  RepositoryAdapter,
  validateRef,
  normalizeCommit,
  normalizeUser,
  normalizeChangedFile,
  normalizeRepository,
} from './repository.js';
export type {
  CloneOptions,
  LocalRepository,
  RepositoryAdapterConfig,
} from './repository.js';

export {
  parseWebhook,
  verifySignature,
  toGitHubEvent,
  isSupportedEvent,
} from './webhooks.js';
export type { WebhookHeaders } from './webhooks.js';

export { EventBus } from './events.js';
export type { EventHandler, EventFilter } from './events.js';

export {
  parseDiff,
  parseChangedFile,
  parseChangedFiles,
  diffStats,
  changedLines,
  addedLines,
  isEmptyDiff,
} from './diff.js';
export type {
  DiffLineKind,
  DiffLine,
  DiffHunk,
  ParsedFileDiff,
  ChangedLine,
  DiffStats,
} from './diff.js';

export {
  applyPatches,
  applyToText,
  insertion,
  replacement,
  fromChangedLine,
  patchFingerprint,
} from './patch.js';
export type { SuggestedPatch, PatchResult } from './patch.js';

export {
  CHECK_STATUSES,
  CHECK_CONCLUSIONS,
  isCheckStatus,
  isCheckConclusion,
  conclusionForPass,
  conclusionForOutcome,
  statusLabel,
  conclusionLabel,
  isPassing,
  isFailing,
  summarizeCheckRun,
  failureStatusLine,
} from './status.js';
export type { PassState } from './status.js';
