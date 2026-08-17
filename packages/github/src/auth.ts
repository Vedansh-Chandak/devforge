/**
 * @devforge/github — Authentication (DF-021).
 *
 * Supports three credential kinds:
 *   - Personal Access Token (PAT)
 *   - GitHub App (JWT signing + installation access tokens)
 *   - OAuth access tokens (with optional refresh)
 *
 * Credentials can be stored securely via a {@link CredentialStore}. The
 * default store writes a JSON file with 0600 permissions; injectable stores
 * make tests deterministic.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AppCredential, GitHubCredential, OAuthCredential, PatCredential } from './types.js';
import { GitHubAppTokenError, GitHubAuthError } from './errors.js';

/** How an auth manager authorizes a request. */
export interface AuthHeaders {
  readonly authorization: string;
  readonly accept?: string;
}

/** Injectable credential persistence. */
export interface CredentialStore {
  /** Read the stored credential, or null when none is present. */
  load(): Promise<GitHubCredential | null>;
  /** Persist the credential (created with restrictive permissions). */
  save(credential: GitHubCredential): Promise<void>;
  /** Remove any stored credential. */
  clear(): Promise<void>;
}

/** Options for the default file-based credential store. */
export interface FileCredentialStoreOptions {
  /** Absolute path to the credentials file. Defaults to ~/.devforge/github-credentials.json. */
  readonly filePath?: string;
}

const DEFAULT_FILE = (): string =>
  path.join(os.homedir(), '.devforge', 'github-credentials.json');

/** Sanitize a PEM private key for storage (unused; kept for shape stability). */
function sanitizePrivateKey(key: string): string {
  return key.trim();
}

function serialize(credential: GitHubCredential): Record<string, unknown> {
  switch (credential.kind) {
    case 'pat':
      return { kind: 'pat', token: credential.token, scopes: credential.scopes };
    case 'app':
      return {
        kind: 'app',
        appId: credential.appId,
        privateKey: sanitizePrivateKey(credential.privateKey),
        installationId: credential.installationId,
      };
    case 'oauth':
      return {
        kind: 'oauth',
        accessToken: credential.accessToken,
        refreshToken: credential.refreshToken,
        clientId: credential.clientId,
        clientSecret: credential.clientSecret,
      };
  }
}

function deserialize(raw: Record<string, unknown>): GitHubCredential {
  const kind = raw['kind'];
  if (kind === 'pat') {
    if (typeof raw['token'] !== 'string' || raw['token'].length === 0) {
      throw new GitHubAuthError('Stored PAT credential is malformed');
    }
    return {
      kind: 'pat',
      token: raw['token'],
      scopes: Array.isArray(raw['scopes']) ? raw['scopes'].map(String) : undefined,
    };
  }
  if (kind === 'app') {
    if (typeof raw['appId'] !== 'string' || typeof raw['privateKey'] !== 'string') {
      throw new GitHubAuthError('Stored GitHub App credential is malformed');
    }
    return {
      kind: 'app',
      appId: raw['appId'],
      privateKey: raw['privateKey'],
      installationId:
        typeof raw['installationId'] === 'number' ? raw['installationId'] : undefined,
    };
  }
  if (kind === 'oauth') {
    if (typeof raw['accessToken'] !== 'string') {
      throw new GitHubAuthError('Stored OAuth credential is malformed');
    }
    return {
      kind: 'oauth',
      accessToken: raw['accessToken'],
      refreshToken: typeof raw['refreshToken'] === 'string' ? raw['refreshToken'] : undefined,
      clientId: typeof raw['clientId'] === 'string' ? raw['clientId'] : undefined,
      clientSecret: typeof raw['clientSecret'] === 'string' ? raw['clientSecret'] : undefined,
    };
  }
  throw new GitHubAuthError(`Unsupported stored credential kind: ${String(kind)}`);
}

/**
 * Default credential store: a JSON file at ~/.devforge/github-credentials.json
 * created with 0600 permissions. Injectable for deterministic tests.
 */
export class FileCredentialStore implements CredentialStore {
  private readonly filePath: string;

  constructor(options: FileCredentialStoreOptions = {}) {
    this.filePath = options.filePath ?? DEFAULT_FILE();
  }

  async load(): Promise<GitHubCredential | null> {
    try {
      const text = await fs.promises.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return deserialize(parsed as Record<string, unknown>);
    } catch (error) {
      if (error instanceof GitHubAuthError) throw error;
      return null;
    }
  }

  async save(credential: GitHubCredential): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(serialize(credential), null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await fs.promises.chmod(this.filePath, 0o600);
  }

  async clear(): Promise<void> {
    try {
      await fs.promises.unlink(this.filePath);
    } catch {
      // nothing to clear
    }
  }
}

/** In-memory credential store for tests and ephemeral sessions. */
export class MemoryCredentialStore implements CredentialStore {
  private credential: GitHubCredential | null = null;

  async load(): Promise<GitHubCredential | null> {
    return this.credential ? structuredClone(this.credential) : null;
  }

  async save(credential: GitHubCredential): Promise<void> {
    this.credential = structuredClone(credential);
  }

  async clear(): Promise<void> {
    this.credential = null;
  }
}

/** Resolved auth headers plus a description of the method. */
export interface AuthResult {
  readonly method: AuthMethodName;
  readonly headers: AuthHeaders;
}

export type AuthMethodName = 'pat' | 'app' | 'oauth';

/**
 * Resolves a credential into the authorization header used for API calls.
 * App credentials transparently obtain an installation access token using the
 * signed JWT flow. Token acquisition is cached until the token nears expiry.
 */
export class AuthManager {
  private readonly credential: GitHubCredential;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private cachedInstallationToken: { token: string; expiresAt: number } | null = null;

  constructor(
    credential: GitHubCredential,
    config: { fetch?: typeof fetch; now?: () => number } = {},
  ) {
    if (!credential) {
      throw new GitHubAuthError('No GitHub credential provided', {
        code: 'AUTH_MISSING',
      });
    }
    this.credential = credential;
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = config.now ?? (() => Date.now());
  }

  get method(): AuthMethodName {
    return this.credential.kind;
  }

  async headers(): Promise<AuthHeaders> {
    switch (this.credential.kind) {
      case 'pat':
        return this.patHeaders(this.credential);
      case 'oauth':
        return this.oauthHeaders(this.credential);
      case 'app':
        return this.appHeaders(this.credential);
    }
  }

  private patHeaders(credential: PatCredential): AuthHeaders {
    if (credential.token.trim().length === 0) {
      throw new GitHubAuthError('PAT token must not be empty');
    }
    return { authorization: `Bearer ${credential.token}` };
  }

  private oauthHeaders(credential: OAuthCredential): AuthHeaders {
    if (credential.accessToken.trim().length === 0) {
      throw new GitHubAuthError('OAuth access token must not be empty');
    }
    return { authorization: `Bearer ${credential.accessToken}` };
  }

  private async appHeaders(credential: AppCredential): Promise<AuthHeaders> {
    const token = await this.installationToken(credential);
    return { authorization: `Bearer ${token}` };
  }

  /** Obtain (and cache) a GitHub App installation access token. */
  private async installationToken(credential: AppCredential): Promise<string> {
    const now = this.now();
    if (this.cachedInstallationToken && this.cachedInstallationToken.expiresAt > now + 30_000) {
      return this.cachedInstallationToken.token;
    }

    const jwt = signAppJwt(credential, now);
    const installationId = credential.installationId;
    if (installationId === undefined) {
      // Resolve the installation for the app owner's default installation.
      throw new GitHubAppTokenError(
        'installationId is required to mint an installation token',
      );
    }

    const endpoint = `https://api.github.com/app/installations/${installationId}/access_tokens`;
    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'devforge',
        },
      });
    } catch (error) {
      throw new GitHubAppTokenError(
        `Failed to request installation token: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new GitHubAppTokenError(
        `Installation token request failed with HTTP ${response.status}`,
        { status: response.status },
      );
    }

    let json: Record<string, unknown>;
    try {
      json = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new GitHubAppTokenError('Installation token response was not JSON');
    }

    if (typeof json['token'] !== 'string' || typeof json['expires_at'] !== 'string') {
      throw new GitHubAppTokenError('Installation token response is malformed');
    }

    const expiresAt = Date.parse(json['expires_at']);
    if (Number.isNaN(expiresAt)) {
      throw new GitHubAppTokenError('Installation token expiry is unparsable');
    }

    this.cachedInstallationToken = { token: json['token'], expiresAt };
    return json['token'];
  }
}

/**
 * Sign a JWT for the GitHub App using an RS256 HMAC over the PEM private key.
 * The header/claims are deterministic for a given clock.
 */
export function signAppJwt(credential: AppCredential, now: number): string {
  if (!credential.privateKey || credential.privateKey.trim().length === 0) {
    throw new GitHubAuthError('GitHub App private key must not be empty');
  }
  const header = { alg: 'RS256', typ: 'JWT' };
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + 60 * 9; // GitHub caps app JWTs at 10 minutes
  const payload = {
    iat: issuedAt,
    exp: expiresAt,
    iss: credential.appId,
  };
  const encode = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(credential.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

/** Verify that a credential is structurally valid. */
export function validateCredential(credential: GitHubCredential): void {
  if (!credential) throw new GitHubAuthError('No credential provided', { code: 'AUTH_MISSING' });
  switch (credential.kind) {
    case 'pat':
      if (!credential.token || credential.token.trim().length === 0) {
        throw new GitHubAuthError('PAT token must not be empty');
      }
      break;
    case 'app':
      if (!credential.appId || credential.appId.trim().length === 0) {
        throw new GitHubAuthError('GitHub App appId must not be empty');
      }
      if (!credential.privateKey || credential.privateKey.trim().length === 0) {
        throw new GitHubAuthError('GitHub App private key must not be empty');
      }
      break;
    case 'oauth':
      if (!credential.accessToken || credential.accessToken.trim().length === 0) {
        throw new GitHubAuthError('OAuth access token must not be empty');
      }
      break;
  }
}
