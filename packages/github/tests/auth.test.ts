/**
 * Authentication tests (DF-021).
 *
 * Covers PAT/OAuth header generation, GitHub App JWT signing and the
 * installation-token flow, credential validation, and both the file-backed
 * and in-memory credential stores. All clocks and fetches are injected so
 * nothing touches the network or wall-clock time.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AuthManager,
  FileCredentialStore,
  MemoryCredentialStore,
  signAppJwt,
  validateCredential,
} from '../src/auth.js';
import { GitHubAppTokenError, GitHubAuthError } from '../src/errors.js';
import { FakeResponse, patCredential, TEST_RSA_PRIVATE_KEY } from './helpers/mock.js';
import type { AppCredential, OAuthCredential } from '../src/types.js';

const FIXED_NOW = 1_700_000_000_000;

function appCredential(overrides: Partial<AppCredential> = {}): AppCredential {
  return {
    kind: 'app',
    appId: '12345',
    privateKey: TEST_RSA_PRIVATE_KEY,
    installationId: 987,
    ...overrides,
  };
}

function oauthCredential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    kind: 'oauth',
    accessToken: 'oauth-token-abc',
    refreshToken: 'refresh-xyz',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    ...overrides,
  };
}

describe('AuthManager PAT', () => {
  it('emits a Bearer authorization header', async () => {
    const manager = new AuthManager(patCredential(), { now: () => FIXED_NOW });
    const headers = await manager.headers();
    expect(headers.authorization).toBe('Bearer test-pat-token-1234567890');
  });

  it('reports the pat auth method', async () => {
    const manager = new AuthManager(patCredential());
    expect(manager.method).toBe('pat');
  });

  it('throws on an empty PAT token', async () => {
    const manager = new AuthManager(patCredential({ token: '   ' }), { now: () => FIXED_NOW });
    await expect(manager.headers()).rejects.toThrow(GitHubAuthError);
  });

  it('is deterministic for a fixed clock', async () => {
    const a = await new AuthManager(patCredential(), { now: () => FIXED_NOW }).headers();
    const b = await new AuthManager(patCredential(), { now: () => FIXED_NOW }).headers();
    expect(a).toEqual(b);
  });
});

describe('AuthManager OAuth', () => {
  it('uses the OAuth access token as a Bearer credential', async () => {
    const manager = new AuthManager(oauthCredential(), { now: () => FIXED_NOW });
    const headers = await manager.headers();
    expect(headers.authorization).toBe('Bearer oauth-token-abc');
    expect(manager.method).toBe('oauth');
  });

  it('throws when the OAuth access token is empty', async () => {
    const manager = new AuthManager(oauthCredential({ accessToken: '' }), { now: () => FIXED_NOW });
    await expect(manager.headers()).rejects.toThrow(GitHubAuthError);
  });

  it('accepts a credential without refresh details', async () => {
    const manager = new AuthManager(
      oauthCredential({ refreshToken: undefined, clientId: undefined, clientSecret: undefined }),
      { now: () => FIXED_NOW },
    );
    const headers = await manager.headers();
    expect(headers.authorization).toBe('Bearer oauth-token-abc');
  });
});

describe('AuthManager GitHub App', () => {
  const tokenResponse = {
    token: 'installation-token-1',
    expires_at: new Date(FIXED_NOW + 3_600_000).toISOString(),
  };

  function callCountFetch(): { fetch: typeof fetch; count: () => number } {
    let n = 0;
    return {
      fetch: (() => {
        n += 1;
        return Promise.resolve(new FakeResponse({ body: tokenResponse }));
      }) as typeof fetch,
      count: () => n,
    };
  }

  it('mints an installation access token via a signed JWT POST', async () => {
    const { fetch, count } = callCountFetch();
    const manager = new AuthManager(appCredential(), { fetch, now: () => FIXED_NOW });
    const headers = await manager.headers();
    expect(headers.authorization).toBe('Bearer installation-token-1');
    expect(count()).toBe(1);
  });

  it('caches the installation token until near expiry', async () => {
    const { fetch, count } = callCountFetch();
    const manager = new AuthManager(appCredential(), { fetch, now: () => FIXED_NOW });
    await manager.headers();
    await manager.headers();
    await manager.headers();
    expect(count()).toBe(1);
  });

  it('re-requests the token after it approaches expiry', async () => {
    let current = FIXED_NOW;
    const { fetch, count } = callCountFetch();
    const manager = new AuthManager(appCredential(), {
      fetch,
      now: () => current,
    });
    await manager.headers();
    expect(count()).toBe(1);
    // 2 hours later: the cached token is well past its 30s grace window.
    current = FIXED_NOW + 7_200_000;
    await manager.headers();
    expect(count()).toBe(2);
  });

  it('translates a non-2xx token response into GitHubAppTokenError', async () => {
    const fetch = (() => Promise.resolve(new FakeResponse({ status: 401, body: { message: 'Bad credentials' } }))) as typeof fetch;
    const manager = new AuthManager(appCredential(), { fetch, now: () => FIXED_NOW });
    await expect(manager.headers()).rejects.toThrow(GitHubAppTokenError);
  });

  it('rejects a malformed token response', async () => {
    const fetch = (() => Promise.resolve(new FakeResponse({ status: 201, body: { nope: true } }))) as typeof fetch;
    const manager = new AuthManager(appCredential(), { fetch, now: () => FIXED_NOW });
    await expect(manager.headers()).rejects.toThrow(GitHubAppTokenError);
  });

  it('propagates network failures as GitHubAppTokenError', async () => {
    const fetch = (() => Promise.reject(new Error('socket hang up'))) as typeof fetch;
    const manager = new AuthManager(appCredential(), { fetch, now: () => FIXED_NOW });
    await expect(manager.headers()).rejects.toThrow(GitHubAppTokenError);
  });

  it('throws when installationId is missing', async () => {
    const manager = new AuthManager(appCredential({ installationId: undefined }), {
      fetch: (() => Promise.resolve(new FakeResponse({ body: tokenResponse }))) as typeof fetch,
      now: () => FIXED_NOW,
    });
    await expect(manager.headers()).rejects.toThrow(GitHubAppTokenError);
  });

  it('throws when constructed without any credential', () => {
    expect(() => new AuthManager(null as never)).toThrow(GitHubAuthError);
  });
});

describe('signAppJwt', () => {
  it('produces a three-part base64url JWT that embeds iat/exp/iss', () => {
    const jwt = signAppJwt(appCredential(), FIXED_NOW);
    const parts = jwt.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0] ?? '', 'base64url').toString('utf-8'));
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf-8'));
    expect(header.alg).toBe('RS256');
    expect(payload.iss).toBe('12345');
    expect(payload.iat).toBe(FIXED_NOW / 1000);
    expect(payload.exp - payload.iat).toBe(540);
  });

  it('is deterministic for a fixed clock and key', () => {
    expect(signAppJwt(appCredential(), FIXED_NOW)).toBe(signAppJwt(appCredential(), FIXED_NOW));
  });

  it('changes when the clock changes', () => {
    expect(signAppJwt(appCredential(), FIXED_NOW)).not.toBe(signAppJwt(appCredential(), FIXED_NOW + 1000));
  });

  it('throws on a missing private key', () => {
    expect(() => signAppJwt(appCredential({ privateKey: '' }), FIXED_NOW)).toThrow(GitHubAuthError);
  });
});

describe('validateCredential', () => {
  it('accepts valid credentials of each kind', () => {
    expect(() => validateCredential(patCredential())).not.toThrow();
    expect(() => validateCredential(appCredential())).not.toThrow();
    expect(() => validateCredential(oauthCredential())).not.toThrow();
  });

  it('rejects missing credentials', () => {
    expect(() => validateCredential(null as never)).toThrow(GitHubAuthError);
  });

  it('rejects empty PAT tokens', () => {
    expect(() => validateCredential(patCredential({ token: '' }))).toThrow(GitHubAuthError);
  });

  it('rejects empty app ids', () => {
    expect(() => validateCredential(appCredential({ appId: '' }))).toThrow(GitHubAuthError);
  });

  it('rejects empty private keys', () => {
    expect(() => validateCredential(appCredential({ privateKey: ' ' }))).toThrow(GitHubAuthError);
  });

  it('rejects empty OAuth access tokens', () => {
    expect(() => validateCredential(oauthCredential({ accessToken: '' }))).toThrow(GitHubAuthError);
  });
});

describe('MemoryCredentialStore', () => {
  it('round-trips a credential with a distinct clone', async () => {
    const store = new MemoryCredentialStore();
    await store.save(patCredential());
    const loaded = await store.load();
    expect(loaded).toEqual(patCredential());
    expect(loaded).not.toBe(store.load() as never);
  });

  it('returns null when empty', async () => {
    const store = new MemoryCredentialStore();
    expect(await store.load()).toBeNull();
  });

  it('clears stored credentials', async () => {
    const store = new MemoryCredentialStore();
    await store.save(patCredential());
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('round-trips app and oauth credentials', async () => {
    const store = new MemoryCredentialStore();
    await store.save(appCredential());
    expect(await store.load()).toEqual(appCredential());
    await store.save(oauthCredential());
    expect(await store.load()).toEqual(oauthCredential());
  });
});

describe('FileCredentialStore', () => {
  function tempPath(): string {
    return path.join(
      os.tmpdir(),
      `devforge-gh-creds-${process.pid}-${Math.random().toString(36).slice(2, 10)}.json`,
    );
  }

  it('saves and loads a credential with restrictive permissions', async () => {
    const filePath = tempPath();
    const store = new FileCredentialStore({ filePath });
    await store.save(patCredential());
    const mode = fs.statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
    const loaded = await store.load();
    expect(loaded).toEqual(patCredential());
    await fs.promises.rm(filePath, { force: true });
  });

  it('returns null when the file does not exist', async () => {
    const store = new FileCredentialStore({ filePath: tempPath() });
    expect(await store.load()).toBeNull();
  });

  it('clears an existing file', async () => {
    const filePath = tempPath();
    const store = new FileCredentialStore({ filePath });
    await store.save(patCredential());
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('rejects a malformed stored credential', async () => {
    const filePath = tempPath();
    await fs.promises.writeFile(filePath, JSON.stringify({ kind: 'pat', token: '' }), 'utf-8');
    const store = new FileCredentialStore({ filePath });
    await expect(store.load()).rejects.toThrow(GitHubAuthError);
    await fs.promises.rm(filePath, { force: true });
  });

  it('rejects an unknown stored credential kind', async () => {
    const filePath = tempPath();
    await fs.promises.writeFile(filePath, JSON.stringify({ kind: 'nope' }), 'utf-8');
    const store = new FileCredentialStore({ filePath });
    await expect(store.load()).rejects.toThrow(GitHubAuthError);
    await fs.promises.rm(filePath, { force: true });
  });
});