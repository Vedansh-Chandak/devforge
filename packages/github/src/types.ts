/**
 * @devforge/github — Core types (DF-021).
 *
 * Shared, deterministic types for the GitHub integration subsystem. These are
 * the stable contracts used by the client, services, and the repository
 * adapter. No side effects live here.
 */

/** A fully-qualified repository reference `owner/name`. */
export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

/** A repository reference with an optional host override. */
export interface GitHubTarget extends RepoRef {
  readonly host?: string;
}

/** A GitHub user or org (shallow REST shape). */
export interface GitHubUser {
  readonly login: string;
  readonly id: number;
  readonly avatarUrl?: string;
  readonly url?: string;
  readonly type?: string;
}

/** Repository metadata returned by `GET /repos/{owner}/{name}`. */
export interface GitHubRepository {
  readonly id: number;
  readonly fullName: string;
  readonly owner: GitHubUser;
  readonly name: string;
  readonly description: string | null;
  readonly private: boolean;
  readonly fork: boolean;
  readonly htmlUrl: string;
  readonly cloneUrl: string;
  readonly sshUrl: string;
  readonly defaultBranch: string;
  readonly pushedAt?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly size?: number;
  readonly stargazersCount?: number;
  readonly forksCount?: number;
  readonly openIssuesCount?: number;
  readonly language?: string;
  readonly archived?: boolean;
  readonly disabled?: boolean;
}

/** A branch on the remote. */
export interface GitHubBranch {
  readonly name: string;
  readonly sha: string;
  readonly protected: boolean;
}

/** A lightweight commit object. */
export interface GitHubCommit {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
  readonly authorName: string | null;
  readonly authorEmail: string | null;
  readonly authorLogin: string | null;
  readonly authoredAt?: string;
  readonly committedAt?: string;
  readonly parents?: readonly string[];
}

/** A repository tag. */
export interface GitHubTag {
  readonly name: string;
  readonly sha: string;
}

/** A contributor to a repository. */
export interface GitHubContributor {
  readonly login: string;
  readonly id: number;
  readonly contributions: number;
}

/** Issue/PR state machine values exposed by the API. */
export type GitHubIssueState = 'open' | 'closed';

/** A label attached to an issue or PR. */
export interface GitHubLabel {
  readonly name: string;
  readonly color?: string;
  readonly description?: string | null;
}

/** An issue on a repository. */
export interface GitHubIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: GitHubIssueState;
  readonly user: GitHubUser | null;
  readonly labels: readonly GitHubLabel[];
  readonly assignees: readonly GitHubUser[];
  readonly locked: boolean;
  readonly comments: number;
  readonly htmlUrl: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly closedAt?: string | null;
  readonly pullRequest?: boolean;
  readonly milestone?: { title: string } | null;
}

/** A pull request (full REST shape). */
export interface GitHubPullRequest {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: GitHubIssueState;
  readonly user: GitHubUser | null;
  readonly labels: readonly GitHubLabel[];
  readonly htmlUrl: string;
  readonly diffUrl: string;
  readonly patchUrl: string;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly merged: boolean;
  readonly mergeable: boolean | null;
  readonly changedFiles?: number;
  readonly additions?: number;
  readonly deletions?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly closedAt?: string | null;
  readonly mergedAt?: string | null;
}

/** A single file changed in a PR. */
export interface GitHubChangedFile {
  readonly filename: string;
  readonly status: GitHubFileStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly changes: number;
  readonly previousFilename?: string;
  readonly contentsUrl?: string;
  readonly rawUrl?: string;
  /** Unified diff patch body as returned by the API, when present. */
  readonly patch?: string;
}

/** File change kinds reported by the PR files API. */
export type GitHubFileStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'copied'
  | 'changed'
  | 'unchanged';

/** A comment on an issue or PR (issue comment). */
export interface GitHubComment {
  readonly id: number;
  readonly body: string;
  readonly user: GitHubUser | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly htmlUrl?: string;
}

/** A review comment attached to a specific diff line. */
export interface GitHubReviewComment {
  readonly id: number;
  readonly body: string;
  readonly path: string;
  readonly line?: number;
  readonly position?: number;
  readonly user: GitHubUser | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly diffHunk?: string;
}

/** A submitted review on a pull request. */
export interface GitHubReview {
  readonly id: number;
  readonly user: GitHubUser | null;
  readonly state: GitHubReviewState;
  readonly body: string | null;
  readonly commitId: string | null;
  readonly submittedAt?: string;
}

/** Review submission states. */
export type GitHubReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

/** Check run status values. */
export type CheckRunStatus = 'queued' | 'in_progress' | 'completed';

/** Check run conclusion values. */
export type CheckRunConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'stale'
  | 'skipped';

/** A check run as reported by the Checks API. */
export interface CheckRun {
  readonly id: number;
  readonly name: string;
  readonly headSha: string;
  readonly status: CheckRunStatus;
  readonly conclusion: CheckRunConclusion | null;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly htmlUrl?: string;
  readonly detailsUrl?: string;
}

/** Output payload for creating/updating a check run. */
export interface CheckRunOutput {
  readonly title?: string;
  readonly summary: string;
  readonly text?: string;
  readonly annotations?: readonly CheckAnnotation[];
}

/** An annotation attached to a check run. */
export interface CheckAnnotation {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly startColumn?: number;
  readonly endColumn?: number;
  readonly annotationLevel: 'notice' | 'warning' | 'failure';
  readonly message: string;
  readonly title?: string;
}

/** A workflow definition. */
export interface GitHubWorkflow {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly state: 'active' | 'disabled_manually' | 'disabled_inactivity' | 'disabled_default_branch';
  readonly htmlUrl?: string;
}

/** A single workflow run. */
export interface GitHubWorkflowRun {
  readonly id: number;
  readonly name: string | null;
  readonly headBranch: string;
  readonly headSha: string;
  readonly runNumber: number;
  readonly status: WorkflowRunStatus;
  readonly conclusion: WorkflowRunConclusion | null;
  readonly event: string;
  readonly workflowId: number;
  readonly displayTitle: string;
  readonly runAttempt?: number;
  readonly htmlUrl?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly completedAt?: string | null;
}

/** Workflow run lifecycle status values. */
export type WorkflowRunStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'requested'
  | 'waiting'
  | 'pending';

/** Terminal conclusion values for a workflow run. */
export type WorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'stale'
  | 'skipped'
  | 'startup_failure';

/** A job within a workflow run. */
export interface WorkflowJob {
  readonly id: number;
  readonly name: string;
  readonly status: WorkflowRunStatus;
  readonly conclusion: WorkflowRunConclusion | null;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly steps?: readonly WorkflowStep[];
}

/** A step within a workflow job. */
export interface WorkflowStep {
  readonly name: string;
  readonly status: WorkflowRunStatus;
  readonly conclusion: WorkflowRunConclusion | null;
  readonly number: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

/** An analyzed workflow failure. */
export interface WorkflowFailureAnalysis {
  readonly runId: number;
  readonly failed: boolean;
  readonly conclusion: WorkflowRunConclusion | null;
  readonly failedJobs: readonly FailedJob[];
  readonly summary: string;
}

/** A job that failed, with the interesting log lines. */
export interface FailedJob {
  readonly id: number;
  readonly name: string;
  readonly failedSteps: readonly string[];
  readonly logSnippet: string;
}

/** Outcome of a single workflow retry cycle. */
export interface RetryOutcome {
  readonly attempt: number;
  readonly runId: number;
  readonly status: WorkflowRunStatus;
  readonly conclusion: WorkflowRunConclusion | null;
  readonly repaired: boolean;
  readonly message: string;
}

/** Full result of the fix-ci repair loop. */
export interface FixCiResult {
  readonly succeeded: boolean;
  readonly attempts: readonly RetryOutcome[];
  readonly finalConclusion: WorkflowRunConclusion | null;
  readonly repairPatches: number;
  readonly stoppedAfterRetries: boolean;
}

/** Webhook event names supported by the system. */
export type WebhookEventName =
  | 'push'
  | 'pull_request'
  | 'issue'
  | 'workflow_run'
  | 'check_suite'
  | 'check_run'
  | 'repository_dispatch';

/** A parsed webhook event. */
export interface WebhookEvent {
  readonly name: WebhookEventName;
  /** The `action` field when the payload carries one (e.g. "opened"). */
  readonly action?: string;
  readonly payload: Record<string, unknown>;
  readonly signature?: string;
  readonly deliveryId?: string;
}

/** An emitted event on the internal event bus. */
export interface GitHubEvent {
  readonly type: WebhookEventName;
  readonly action?: string;
  readonly payload: Record<string, unknown>;
}

/** Credential kinds supported by the auth layer. */
export type CredentialKind = 'pat' | 'app' | 'oauth';

/** A PAT credential. */
export interface PatCredential {
  readonly kind: 'pat';
  readonly token: string;
  readonly scopes?: readonly string[];
}

/** A GitHub App credential. */
export interface AppCredential {
  readonly kind: 'app';
  readonly appId: string;
  /** PEM-encoded private key. */
  readonly privateKey: string;
  /** Optional installation id; resolved lazily when omitted. */
  readonly installationId?: number;
}

/** An OAuth credential (token refresh optional). */
export interface OAuthCredential {
  readonly kind: 'oauth';
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
}

/** Union of all supported credentials. */
export type GitHubCredential = PatCredential | AppCredential | OAuthCredential;

/** Values describing the effective auth method for a request. */
export type AuthMethod = 'token' | 'app-installation';

/** Config passed to the GitHub HTTP client. */
export interface GitHubClientConfig {
  /** Resolved credential used to authenticate requests. */
  readonly credential: GitHubCredential;
  /** API root. Defaults to https://api.github.com. */
  readonly baseUrl?: string;
  /** Default timeout per request in ms. */
  readonly timeoutMs?: number;
  /** Maximum retry attempts for transient failures. */
  readonly maxRetries?: number;
  /** User agent sent with requests. */
  readonly userAgent?: string;
  /** Injectable fetch (tests use deterministic mocks). */
  readonly fetch?: typeof fetch;
  /** Injectable clock. */
  readonly now?: () => number;
}
