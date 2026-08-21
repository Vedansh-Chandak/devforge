/**
 * DF-029B — First-Run Setup & Model Configuration test matrix.
 *
 * Covers (per requirement 13):
 *   - empty/unconfigured installation
 *   - valid configuration
 *   - invalid provider
 *   - invalid model
 *   - missing credential
 *   - environment credential
 *   - secret masking
 *   - role routing
 *   - reasoning/coding/fast configuration
 *   - JSON output
 *   - configuration precedence
 *   - malformed config
 *   - CI / non-interactive mode
 *   - doctor output
 *   - config output
 *   - clean temporary HOME/config directory
 *
 * No network calls: providers are constructed lazily by the router and never
 * dial out during resolution. All fixtures live in OS temp dirs and the test
 * controls HOME + DEVFORGE_* so it is hermetic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadConfig,
  validateConfig,
  userConfigPath,
} from '../services/config-loader.js';
import {
  resolveModelRoutes,
  summarizeRoleRoutes,
  hasExplicitModelConfig,
} from '../services/model-routes.js';
import { handleDoctor } from '../commands/doctor.js';
import { handleConfig } from '../commands/config.js';
import type { ModelConfigurationSummary } from '../commands/doctor.js';
import type { LightCliContext } from '../services/session.js';
import { runEnvironmentChecks } from '../services/environment.js';
import type { DevForgeConfig, CliOptions, RawDevForgeConfig } from '../types.js';

/** Minimal repository object: tool-specific checks stay inert (no execSync). */
const FAKE_REPO = {
  root: '/tmp',
  workspaceRoot: '/tmp',
  hasGit: false,
  hasPackageJson: true,
  packageJsonName: 'x',
  packageManager: 'pnpm',
  isMonorepo: false,
  isPnpmWorkspace: false,
  isNpmYarnWorkspace: false,
  hasLockfile: false,
  tsconfig: null,
  testFramework: null,
  lintCommand: null,
  buildTool: null,
} as unknown as LightCliContext['repository'];

/** Build a lightweight CLI context for inspection-command handlers. */
function makeCtx(cwd: string, config: DevForgeConfig, options: Partial<CliOptions> = {}): LightCliContext {
  return {
    cwd,
    config,
    repository: FAKE_REPO,
    options: { json: false, debug: false, autoApprove: false, ...options },
    signal: undefined,
    services: {
      workspace: {} as never,
      logger: {} as never,
      output: {} as never,
      progress: {} as never,
      environment: runEnvironmentChecks(FAKE_REPO, config),
    },
  } as unknown as LightCliContext;
}

let savedHome: string | undefined;
let savedDevforge: Record<string, string | undefined>;
let tempHome: string;
let extraFiles: string[] = [];

beforeEach(async () => {
  // Capture and isolate environment WITHOUT reassigning process.env (which does
  // not propagate to os.homedir()). HOME is restored in place; DEVFORGE_* keys
  // are deleted (beforeEach always re-cleans them so test-added keys can't leak).
  savedHome = process.env.HOME;
  savedDevforge = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('DEVFORGE_')) {
      savedDevforge[key] = process.env[key];
      delete process.env[key];
    }
  }
  tempHome = await mkdtemp(path.join(tmpdir(), 'devforge-home-'));
  // Mutate HOME in place so os.homedir() picks it up.
  if (savedHome !== undefined) process.env.HOME = tempHome;
  else delete process.env.HOME;
  extraFiles = [];
});

afterEach(async () => {
  // Restore HOME in place (never reassign process.env).
  if (savedHome !== undefined) process.env.HOME = savedHome;
  else delete process.env.HOME;
  // Restore any pre-existing DEVFORGE_* keys.
  for (const [k, v] of Object.entries(savedDevforge)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const f of extraFiles) {
    try {
      await rm(f, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  try {
    await rm(tempHome, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** Write a .devforge.json project file into `dir`. */
async function writeProject(dir: string, obj: unknown): Promise<void> {
  const p = path.join(dir, '.devforge.json');
  await writeFile(p, JSON.stringify(obj), 'utf-8');
  extraFiles.push(p);
  extraFiles.push(dir);
}

/** Write a user-global ~/.devforge/config.json. */
async function writeUser(obj: unknown): Promise<string> {
  const dir = path.join(tempHome, '.devforge');
  await mkdir(dir, { recursive: true });
  const p = path.join(dir, 'config.json');
  await writeFile(p, JSON.stringify(obj), 'utf-8');
  extraFiles.push(p);
  extraFiles.push(dir);
  return p;
}

const newDir = async (prefix: string): Promise<string> => {
  const d = await mkdtemp(path.join(tmpdir(), prefix));
  extraFiles.push(d);
  return d;
};

describe('empty / unconfigured installation', () => {
  it('loadConfig on an empty dir resolves defaults without crashing', async () => {
    const dir = await newDir('df-empty-');
    const { config, sources, credentialSource } = await loadConfig(dir);
    expect(config.provider).toBe('fake');
    expect(sources).toEqual([]);
    expect(credentialSource).toBe('none');
  });

  it('doctor does not crash and explains missing model configuration', async () => {
    const dir = await newDir('df-empty-');
    const { config } = await loadConfig(dir);
    const out = (await handleDoctor(makeCtx(dir, config), false)) as string;
    expect(out).toContain('model-configuration');
    expect(out).toContain('no model provider configured');
    expect(out).toContain('DEVFORGE_MODEL_PROVIDER');
  });

  it('doctor --json reports a modelConfiguration summary with all roles unresolved', async () => {
    const dir = await newDir('df-empty-');
    const { config } = await loadConfig(dir);
    const payload = (await handleDoctor(makeCtx(dir, config, { json: true }), false)) as {
      checks: readonly unknown[];
      allOk: boolean;
      modelConfiguration: ModelConfigurationSummary;
    };
    expect(payload.modelConfiguration.configured).toBe(false);
    expect(payload.modelConfiguration.missingRoles).toEqual(['reasoning', 'coding', 'fast']);
    expect(payload.modelConfiguration.routes.length).toBe(3);
    expect(payload.modelConfiguration.routes.every((r) => r.provider === 'fake')).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('sk-');
  });

  it('config shows defaults-only state safely', async () => {
    const dir = await newDir('df-empty-');
    const { config } = await loadConfig(dir);
    const out = (await handleConfig(makeCtx(dir, config))) as string;
    expect(out).toContain('(defaults only)');
    expect(out).toContain('API key');
    expect(out).toContain('(none)');
    expect(out).toContain('Route · reasoning');
    expect(out).toContain('fake');
  });

  it('config --json uses precedence line and masked apiKey with credentialSource none', async () => {
    const dir = await newDir('df-empty-');
    const { config } = await loadConfig(dir);
    const payload = (await handleConfig(makeCtx(dir, config, { json: true }))) as {
      credentialSource: string;
      apiKey?: string;
    };
    expect(payload.credentialSource).toBe('none');
    expect(payload.apiKey).toBeUndefined();
    const out = (await handleConfig(makeCtx(dir, config))) as string;
    expect(out).toContain('CLI flags > environment > ./.devforge.json > ~/.devforge/config.json > defaults');
  });
});

describe('valid configuration', () => {
  it('gemini + role models load and route deterministically', async () => {
    const dir = await newDir('df-valid-');
    await writeProject(dir, {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: 'sk-valid-secret',
      roleModels: {
        reasoning: 'gemini-2.5-pro',
        coding: 'gemini-2.5-flash',
        fast: 'gemini-2.5-flash-lite',
      },
    });
    const { config, credentialSource } = await loadConfig(dir);
    expect(config.provider).toBe('gemini');
    expect(credentialSource).toBe('project');

    const routes = resolveModelRoutes(config);
    expect(routes.find((r) => r.role === 'reasoning')?.model).toBe('gemini-2.5-pro');
    expect(routes.find((r) => r.role === 'coding')?.model).toBe('gemini-2.5-flash');
    expect(routes.find((r) => r.role === 'fast')?.model).toBe('gemini-2.5-flash-lite');
    expect(routes.every((r) => r.source === 'explicit')).toBe(true);
  });

  it('doctor marks a fully-configured installation as configured', async () => {
    const dir = await newDir('df-valid-');
    await writeProject(dir, {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: 'sk-valid-secret',
      roleModels: { reasoning: 'gemini-2.5-pro', coding: 'gemini-2.5-flash', fast: 'gemini-2.5-flash-lite' },
    });
    const { config } = await loadConfig(dir);
    const payload = (await handleDoctor(makeCtx(dir, config, { json: true }), false)) as {
      modelConfiguration: ModelConfigurationSummary;
    };
    expect(payload.modelConfiguration.configured).toBe(true);
    expect(payload.modelConfiguration.configuredRoles).toEqual(['reasoning', 'coding', 'fast']);
    expect(payload.modelConfiguration.missingRoles).toEqual([]);
  });
});

describe('invalid configurations', () => {
  it('invalid provider is rejected with a clean error listing the valid kinds', async () => {
    const res = validateConfig({ provider: 'ollama', model: 'x' } as unknown as RawDevForgeConfig);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(' ')).toContain('gemini');
    // Only field names appear in validation messages — never secret values.
    expect(res.errors.join(' ')).not.toContain('sk-');
  });

  it('loadConfig throws on an invalid provider without leaking secrets', async () => {
    const dir = await newDir('df-bad-');
    await writeProject(dir, { provider: 'ollama', model: 'x', apiKey: 'sk-should-not-leak' });
    await expect(loadConfig(dir)).rejects.toThrow(/Invalid configuration/);
    let msg = '';
    try {
      await loadConfig(dir);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('ollama');
    expect(msg).not.toContain('sk-should-not-leak');
  });

  it('openai-compatible without baseUrl is invalid', async () => {
    const res = validateConfig({ provider: 'openai-compatible', model: 'x' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(' ')).toContain('baseUrl');
  });

  it('gemini without model is invalid', async () => {
    const res = validateConfig({ provider: 'gemini' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(' ')).toContain('model');
  });
});

describe('missing credential', () => {
  it('real provider without key still loads (key optional) and doctor flags missing credential', async () => {
    const dir = await newDir('df-nocred-');
    await writeProject(dir, { provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    const { config } = await loadConfig(dir);
    // configuration validates; provider check surfaces missing credentials.
    const env = runEnvironmentChecks(FAKE_REPO, config);
    const providerCheck = env.find((c) => c.name === 'provider');
    expect(providerCheck?.ok).toBe(false);
    expect(providerCheck?.fix).toContain('DEVFORGE_MODEL_API_KEY');

    const out = (await handleDoctor(makeCtx(dir, config), false)) as string;
    expect(out).not.toContain('sk-');
    // model-configuration is "ok" (explicitly configured) — only credential is missing.
    expect(out).toContain('model-configuration');
  });
});

describe('credentials', () => {
  it('environment credential resolves and is masked everywhere', async () => {
    process.env.DEVFORGE_MODEL_PROVIDER = 'gemini';
    process.env.DEVFORGE_MODEL = 'gemini-2.5-flash';
    process.env.DEVFORGE_MODEL_API_KEY = 'sk-environment-secret';

    const dir = await newDir('df-env-');
    const { config, credentialSource } = await loadConfig(dir);
    expect(config.apiKey).toBe('sk-environment-secret');
    expect(credentialSource).toBe('environment');

    const json = (await handleConfig(makeCtx(dir, config, { json: true })) as { apiKey: string }).apiKey;
    expect(json).toBe('***');

    const out = (await handleConfig(makeCtx(dir, config))) as string;
    expect(out).toContain('***');
    expect(out).not.toContain('sk-environment-secret');
  });

  it('apiKeyEnv credential reference resolves from a named env var (never stored on disk)', async () => {
    process.env.MY_CI_KEY = 'sk-referenced-secret';
    const dir = await newDir('df-ref-');
    await writeProject(dir, { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKeyEnv: 'MY_CI_KEY' });
    const { config, credentialSource } = await loadConfig(dir);
    expect(config.apiKey).toBe('sk-referenced-secret');
    expect(credentialSource).toBe('project');

    const out = (await handleConfig(makeCtx(dir, config))) as string;
    expect(out).not.toContain('sk-referenced-secret');
    expect(out).toContain('***');
  });

  it('explicit apiKey wins over apiKeyEnv', async () => {
    process.env.MY_CI_KEY = 'sk-referenced-secret';
    const raw = { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'sk-explicit', apiKeyEnv: 'MY_CI_KEY' } as unknown as RawDevForgeConfig;
    const res = validateConfig(raw);
    expect(res.ok).toBe(true);
    const dir = await newDir('df-win-');
    await writeProject(dir, raw);
    const { config } = await loadConfig(dir);
    expect(config.apiKey).toBe('sk-explicit');
  });

  it('apiKeyEnv referencing a missing var is treated as no credential (no crash)', async () => {
    const dir = await newDir('df-missing-ref-');
    await writeProject(dir, { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKeyEnv: 'DOES_NOT_EXIST' });
    const { config } = await loadConfig(dir);
    expect(config.apiKey).toBeUndefined();
    const env = runEnvironmentChecks(FAKE_REPO, config);
    expect(env.find((c) => c.name === 'provider')?.ok).toBe(false);
  });

  it('apiKeyEnv must be a valid env var name', async () => {
    const res = validateConfig({ provider: 'fake', apiKeyEnv: '1bad name' } as unknown as RawDevForgeConfig);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(' ')).toContain('apiKeyEnv');
  });
});

describe('secret masking', () => {
  it('a real key is never printed in doctor or config output', async () => {
    const dir = await newDir('df-secret-');
    const secret = 'sk-do-not-leak-1234567890';
    await writeProject(dir, { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: secret });
    const { config } = await loadConfig(dir);

    const cfgOut = (await handleConfig(makeCtx(dir, config))) as string;
    expect(cfgOut).not.toContain(secret);
    expect(cfgOut).toContain('***');

    const docOut = (await handleDoctor(makeCtx(dir, config), false)) as string;
    expect(docOut).not.toContain(secret);

    const docJson = (await handleDoctor(makeCtx(dir, config, { json: true }), false)) as unknown as Record<string, unknown>;
    expect(JSON.stringify(docJson)).not.toContain(secret);

    const cfgJson = (await handleConfig(makeCtx(dir, config, { json: true }))) as unknown as Record<string, unknown>;
    expect(JSON.stringify(cfgJson)).not.toContain(secret);
  });

  it('every resolved route apiKey is masked', async () => {
    const dir = await newDir('df-routes-');
    await writeProject(dir, {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      apiKey: 'sk-route-secret',
      roleModels: { reasoning: 'gemini-2.5-pro', coding: 'gemini-2.5-flash', fast: 'gemini-2.5-flash-lite' },
    });
    const { config } = await loadConfig(dir);
    const routes = resolveModelRoutes(config);
    for (const r of routes) {
      expect(r.apiKey).toBe('***');
    }
  });
});

describe('role routing / reasoning / coding / fast', () => {
  it('distinct role models route per role (explicit source)', async () => {
    const dir = await newDir('df-roles-');
    await writeProject(dir, {
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-roles',
      roleModels: { reasoning: 'openai/gpt-oss-120b:free', coding: 'cohere/north-mini-code:free', fast: 'openai/gpt-oss-20b:free' },
    });
    const { config } = await loadConfig(dir);
    const routes = resolveModelRoutes(config);
    expect(routes.find((r) => r.role === 'reasoning')?.model).toBe('openai/gpt-oss-120b:free');
    expect(routes.find((r) => r.role === 'coding')?.model).toBe('cohere/north-mini-code:free');
    expect(routes.find((r) => r.role === 'fast')?.model).toBe('openai/gpt-oss-20b:free');
  });

  it('partial roles fall back to the default model for unspecified roles', async () => {
    const dir = await newDir('df-partial-');
    await writeProject(dir, {
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-partial',
      roleModels: { coding: 'cohere/north-mini-code:free' },
    });
    const { config } = await loadConfig(dir);
    const routes = resolveModelRoutes(config);
    const coding = routes.find((r) => r.role === 'coding');
    const reasoning = routes.find((r) => r.role === 'reasoning');
    expect(coding?.source).toBe('explicit');
    expect(coding?.model).toBe('cohere/north-mini-code:free');
    expect(reasoning?.source).toBe('default');
    expect(reasoning?.model).toBe('openai/gpt-oss-120b:free');
  });

  it('summarizeRoleRoutes preserves reasoning/coding/fast order', async () => {
    const dir = await newDir('df-order-');
    const { config } = await loadConfig(dir);
    const status = summarizeRoleRoutes(resolveModelRoutes(config));
    expect(status.map((s) => s.role)).toEqual(['reasoning', 'coding', 'fast']);
  });

  it('hasExplicitModelConfig is false for pure defaults, true for any explicit setting', async () => {
    const dir = await newDir('df-has-');
    const empty = await loadConfig(dir);
    expect(hasExplicitModelConfig(empty.config)).toBe(false);

    await writeProject(dir, { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'sk-x' });
    const configured = await loadConfig(dir);
    expect(hasExplicitModelConfig(configured.config)).toBe(true);
  });
});

describe('JSON output', () => {
  it('doctor --json is a single parseable object with checks/allOk/modelConfiguration', async () => {
    const dir = await newDir('df-json-');
    await writeProject(dir, { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'sk-json' });
    const { config } = await loadConfig(dir);
    const payload = (await handleDoctor(makeCtx(dir, config, { json: true }), false)) as {
      checks: unknown[];
      allOk: boolean;
      modelConfiguration: ModelConfigurationSummary;
    };
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(typeof payload.allOk).toBe('boolean');
    expect(payload.modelConfiguration).toBeDefined();
    expect(payload.modelConfiguration.provider).toBe('gemini');
  });

  it('config --json payload has the documented shape', async () => {
    const dir = await newDir('df-jsoncfg-');
    await writeProject(dir, { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'sk-jsoncfg' });
    const { config } = await loadConfig(dir);
    const payload = (await handleConfig(makeCtx(dir, config, { json: true }))) as unknown as Record<string, unknown>;
    expect(payload.provider).toBe('gemini');
    expect(payload.apiKey).toBe('***');
    expect(payload.credentialSource).toBe('project');
    expect(Array.isArray(payload.routes)).toBe(true);
    expect(Array.isArray(payload.sources)).toBe(true);
  });
});

describe('configuration precedence (env > project > user > defaults)', () => {
  it('environment overrides project overrides user overrides defaults', async () => {
    const dir = await newDir('df-prec-');
    await writeUser({ provider: 'gemini', model: 'user-model', apiKey: 'sk-user' });
    await writeProject(dir, { model: 'project-model' });
    process.env.DEVFORGE_MODEL = 'env-model';

    const { config, sources } = await loadConfig(dir);
    expect(config.provider).toBe('gemini'); // from user
    expect(config.model).toBe('env-model'); // from env (highest)
    expect(config.apiKey).toBe('sk-user'); // from user
    expect(sources).toContain(path.join(dir, '.devforge.json'));
    expect(sources).toContain(path.join(tempHome, '.devforge', 'config.json'));
  });

  it('removing env falls back to project model', async () => {
    const dir = await newDir('df-prec2-');
    await writeUser({ provider: 'gemini', model: 'user-model', apiKey: 'sk-user' });
    await writeProject(dir, { model: 'project-model' });
    const { config } = await loadConfig(dir);
    expect(config.model).toBe('project-model');
    expect(config.provider).toBe('gemini');
  });

  it('removing project falls back to user model', async () => {
    const dir = await newDir('df-prec3-');
    await writeUser({ provider: 'anthropic', model: 'user-model', apiKey: 'sk-user' });
    const { config } = await loadConfig(dir);
    expect(config.model).toBe('user-model');
    expect(config.provider).toBe('anthropic');
  });

  it('no files fall back to defaults', async () => {
    const dir = await newDir('df-prec4-');
    const { config } = await loadConfig(dir);
    expect(config.provider).toBe('fake');
  });
});

describe('malformed config', () => {
  it('malformed JSON project file is ignored (treated as absent, no crash)', async () => {
    const dir = await newDir('df-malformed-');
    const p = path.join(dir, '.devforge.json');
    await writeFile(p, '{ this is not valid json', 'utf-8');
    extraFiles.push(p);
    const { config, sources } = await loadConfig(dir);
    expect(config.provider).toBe('fake');
    expect(sources).toEqual([]);
  });

  it('wrong-typed values produce validation errors (no secret leak)', async () => {
    const dir = await newDir('df-wrongtype-');
    const secret = 'sk-not-leaked';
    await writeProject(dir, { provider: 'fake', timeoutMs: 'soon', temperature: 'hot', apiKey: secret });
    await expect(loadConfig(dir)).rejects.toThrow(/Invalid configuration/);
    let msg = '';
    try {
      await loadConfig(dir);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('Invalid configuration');
    expect(msg).not.toContain(secret);
  });
});

describe('CI / non-interactive mode', () => {
  it('env-only configuration works end-to-end with no stdin/TTY interaction', async () => {
    process.env.DEVFORGE_MODEL_PROVIDER = 'gemini';
    process.env.DEVFORGE_MODEL = 'gemini-2.5-flash';
    process.env.DEVFORGE_MODEL_API_KEY = 'sk-ci-secret';
    process.env.DEVFORGE_REASONING_MODEL = 'gemini-2.5-pro';
    process.env.DEVFORGE_CODING_MODEL = 'gemini-2.5-flash';
    process.env.DEVFORGE_FAST_MODEL = 'gemini-2.5-flash-lite';

    const dir = await newDir('df-ci-');
    const { config, credentialSource } = await loadConfig(dir);
    expect(credentialSource).toBe('environment');

    const docOut = (await handleDoctor(makeCtx(dir, config, { json: true }), false)) as {
      modelConfiguration: ModelConfigurationSummary;
    };
    expect(docOut.modelConfiguration.configured).toBe(true);
    expect(docOut.modelConfiguration.configuredRoles).toEqual(['reasoning', 'coding', 'fast']);

    const cfgOut = (await handleConfig(makeCtx(dir, config))) as string;
    expect(cfgOut).not.toContain('sk-ci-secret');
    expect(cfgOut).toContain('***');
  });

  it('doctor --json under CI is a single machine-readable object', async () => {
    process.env.DEVFORGE_MODEL_PROVIDER = 'fake';
    const dir = await newDir('df-ci2-');
    const { config } = await loadConfig(dir);
    const payload = (await handleDoctor(makeCtx(dir, config, { json: true }), false)) as {
      allOk: boolean;
    };
    expect(typeof payload.allOk).toBe('boolean');
  });
});

describe('clean temporary HOME / config directory', () => {
  it('userConfigPath points inside the temp HOME and user config is picked up', async () => {
    const expected = path.join(tempHome, '.devforge', 'config.json');
    expect(userConfigPath()).toBe(expected);

    await writeUser({ provider: 'openai-compatible', model: 'openai/gpt-oss-120b:free', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-usercfg' });
    const dir = await newDir('df-userhome-');
    const { config, sources, credentialSource } = await loadConfig(dir);
    expect(config.provider).toBe('openai-compatible');
    expect(credentialSource).toBe('user');
    expect(sources).toContain(expected);
  });

  it('doctor and config run cleanly against an empty temp HOME', async () => {
    const dir = await newDir('df-emptyhome-');
    const { config } = await loadConfig(dir);
    const doc = (await handleDoctor(makeCtx(dir, config), false)) as string;
    expect(typeof doc).toBe('string');
    expect(doc.length).toBeGreaterThan(0);
    const cfg = (await handleConfig(makeCtx(dir, config))) as string;
    expect(cfg).toContain('DevForge Config');
  });
});
