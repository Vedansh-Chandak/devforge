/**
 * Deterministic test infrastructure for @devforge/github.
 *
 * Provides:
 *   - MockFetch: URL/method-routed fetch with canned or scripted responses,
 *     link-header pagination, and request recording.
 *   - makeClient: a GitHubClient bound to a PAT credential and MockFetch.
 *   - MockCommandRunner / MockGitService: deterministic git fakes.
 *
 * Everything here is synchronous-construction and clock-injectable so tests
 * have zero nondeterminism (no real network, no real timers beyond injected
 * sleep/now).
 */

import { GitHubClient } from '../../src/client.js';
import type { GitHubClientConfig, PatCredential } from '../../src/types.js';
import type { CommandRunner, GitService } from '@devforge/execution';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** A canned response body value or a scripted producer. */
export type MockResponse =
  | {
      readonly status?: number;
      readonly body?: unknown;
      readonly headers?: Readonly<Record<string, string>>;
    }
  | ((url: string, requestIndex: number) => {
      readonly status?: number;
      readonly body?: unknown;
      readonly headers?: Readonly<Record<string, string>>;
    });

/** A minimal fake Response matching the subset GitHubClient uses. */
export class FakeResponse implements Response {
  readonly status: number;
  readonly ok: boolean;
  private readonly headersMap: Record<string, string>;
  private readonly bodyText: string;

  constructor(options: { status?: number; body?: unknown; headers?: Readonly<Record<string, string>> } = {}) {
    this.status = options.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headersMap = { ...(options.headers ?? {}) };
    this.bodyText =
      options.body === undefined
        ? ''
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
  }

  get headers(): Headers {
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(this.headersMap)) {
      map.set(key.toLowerCase(), value);
    }
    return {
      get: (name: string) => map.get(name.toLowerCase()) ?? null,
      has: (name: string) => map.has(name.toLowerCase()),
      forEach: (cb: (value: string, key: string) => void) => {
        for (const [key, value] of map) cb(value, key);
      },
    } as unknown as Headers;
  }

  async text(): Promise<string> {
    return this.bodyText;
  }

  async json(): Promise<unknown> {
    return JSON.parse(this.bodyText);
  }
}

/** A scriptable fetch bound to a route table. */
export class MockFetch {
  readonly requests: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  readonly baseUrl: string;
  private readonly pathPrefix: string;
  private routes: Map<string, MockResponse>;
  private fallback: MockResponse;
  private scripted: Array<() => MockResponse>;

  constructor(options: {
    baseUrl?: string;
    routes?: Readonly<Record<string, MockResponse>>;
    fallback?: MockResponse;
  } = {}) {
    this.baseUrl = options.baseUrl ?? 'https://api.github.com';
    this.pathPrefix = new URL(this.baseUrl).pathname.replace(/\/$/, '');
    this.routes = new Map(Object.entries(options.routes ?? {}));
    this.fallback = options.fallback ?? { status: 404, body: { message: 'Not Found' } };
    this.scripted = [];
  }

  /** Add a route by pathname+search (e.g. `/repos/a/b`, `/repos/a/b?state=open`). */
  on(path: string, response: MockResponse): this {
    this.routes.set(path, response);
    return this;
  }

  /** Remove a route. */
  off(path: string): this {
    this.routes.delete(path);
    return this;
  }

  /** Clear all routes. */
  reset(): this {
    this.routes.clear();
    this.scripted = [];
    this.requests.length = 0;
    return this;
  }

  /** Queue a scripted production to run before the route table. */
  sequence(...steps: MockResponse[]): this {
    this.scripted.push(...steps);
    return this;
  }

  /** Record a request (for assertions after the interaction). */
  private record(url: string, init: RequestInit | undefined): void {
    this.requests.push({
      url,
      method: String(init?.method ?? 'GET'),
      headers: Object.fromEntries(
        Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
      ),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
  }

  lastRequest(): (typeof this.requests)[number] | undefined {
    return this.requests[this.requests.length - 1];
  }

  /** The fetch implementation (reassignable for scripting atypical failures). */
  fn: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    this.record(url, init);
    const parsed = new URL(url);
    let path = `${parsed.pathname}${parsed.search}`;
    if (this.pathPrefix.length > 0 && path.startsWith(this.pathPrefix)) {
      path = path.slice(this.pathPrefix.length) || '/';
    }
    const requestIndex = this.requests.length - 1;

    const scriptedStep = scriptedStepIfAny(this.scripted, this.requests.length);
    const response =
      scriptedStep !== undefined
        ? scriptedStep
        : resolveRoute(this.routes.get(path));

    const resolved =
      typeof response === 'function' ? response(url, requestIndex) : response;
    return new FakeResponse(resolved);
  };
}

function scriptedStepIfAny(
  scripted: Array<() => MockResponse>,
  requestCount: number,
): (() => MockResponse) | undefined {
  if (scripted.length === 0) return undefined;
  const index = Math.min(requestCount - 1, scripted.length - 1);
  return scripted[index];
}

function resolveRoute(route: MockResponse | undefined): MockResponse {
  return route ?? { status: 404, body: { message: 'Not Found' } };
}

const TEST_TOKEN = 'test-pat-token-1234567890';

/** A real throwaway RSA key so JWT signing works in tests. */
const TEST_RSA_PAIR = (() => {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
})();

/** PEM-encoded private key for GitHub App auth tests. */
export const TEST_RSA_PRIVATE_KEY = TEST_RSA_PAIR.privateKey.export({
  type: 'pkcs1',
  format: 'pem',
}) as unknown as string;

/** A PAT credential for tests. */
export function patCredential(overrides: Partial<PatCredential> = {}): PatCredential {
  return { kind: 'pat', token: TEST_TOKEN, ...overrides };
}

/** Build a GitHubClient wired to a fresh MockFetch. */
export function makeClient(
  routes: Readonly<Record<string, MockResponse>> = {},
  overrides: Partial<GitHubClientConfig> = {},
): { client: GitHubClient; fetch: MockFetch } {
  const fetch = new MockFetch({ routes });
  const client = createClient({ fetch: fetch.fn, credential: patCredential(), ...overrides });
  return { client, fetch };
}

/** Create a client with explicit config (auth tests use their own). */
export function createClient(config: GitHubClientConfig): GitHubClient {
  return new GitHubClient(config);
}

/** Resolve a route value to a plain object (for route tables). */
export function json(
  body: unknown,
  options: { status?: number; headers?: Record<string, string> } = {},
): MockResponse {
  return { body, ...(options.status !== undefined ? { status: options.status } : {}), headers: options.headers };
}

/** Build a GitHub `Link` header for pagination tests. */
export function linkHeader(entries: ReadonlyArray<[string, string]>): string {
  return entries.map(([rel, url]) => `<${url}>; rel="${rel}"`).join(', ');
}

/** A deterministic command runner that records commands and returns canned results. */
export class MockCommandRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];
  private pending: Array<{ stdout?: string; stderr?: string; exitCode?: number }> = [];

  constructor(initial: Array<{ stdout?: string; stderr?: string; exitCode?: number }> = []) {
    this.pending = [...initial];
  }

  enqueue(result: { stdout?: string; stderr?: string; exitCode?: number }): this {
    this.pending.push(result);
    return this;
  }

  async run(request: { command: string; args?: readonly string[]; cwd?: string }): Promise<{
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    this.calls.push({ command: request.command, args: request.args ?? [], cwd: request.cwd });
    const result = this.pending.shift() ?? { stdout: '', stderr: '', exitCode: 0 };
    return {
      success: (result.exitCode ?? 0) === 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0,
    };
  }
}

/** A deterministic git service fake. */
export class MockGitService implements GitService {
  readonly workspaceRoot = '/fake/root';
  currentBranchName: string | null = 'main';
  headHash: string | null = '0123456789abcdef0123456789abcdef01234567';

  async status(): Promise<import('@devforge/execution').GitStatus> {
    return { clean: true, entries: [] };
  }

  async diff(): Promise<import('@devforge/execution').GitDiff> {
    return { empty: true, text: '', files: [] };
  }

  async diffCached(): Promise<import('@devforge/execution').GitDiff> {
    return { empty: true, text: '', files: [] };
  }

  async changedFiles(): Promise<readonly string[]> {
    return [];
  }

  async currentBranch(): Promise<string | null> {
    return this.currentBranchName;
  }

  async branches(): Promise<readonly import('@devforge/execution').GitBranch[]> {
    return [{ name: this.currentBranchName ?? 'main', isCurrent: true }];
  }

  async head(): Promise<import('@devforge/execution').GitCommit | null> {
    if (!this.headHash) return null;
    return { hash: this.headHash, shortHash: this.headHash.slice(0, 7) };
  }

  async add(_paths: readonly string[]): Promise<void> {}

  async restore(_paths: readonly string[]): Promise<void> {}

  async commit(message: string): Promise<import('@devforge/execution').GitCommit> {
    const hash = `cafef00d${message.length.toString(16).padStart(8, '0')}cafef00d`;
    return { hash, shortHash: hash.slice(0, 7) };
  }

  async isRepository(): Promise<boolean> {
    return true;
  }

  async repositoryRoot(): Promise<string> {
    return this.workspaceRoot;
  }

  async repositoryInfo(): Promise<import('@devforge/execution').GitRepositoryInfo> {
    const branch = this.currentBranchName;
    const head = await this.head();
    return {
      isRepository: true,
      root: this.workspaceRoot,
      branch,
      head,
      changedFileCount: 0,
      clean: true,
    };
  }

  invalidateRepositoryCache(): void {}
}

export { GitHubClient };