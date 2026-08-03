import { describe, it, expect } from 'vitest';
import { buildEnvironment, type EnvironmentMap } from '../src/command/environment.js';
import { ALLOWLIST_ENV_VARS } from '../src/command/types.js';

describe('buildEnvironment', () => {
  const baseEnv: EnvironmentMap = {
    PATH: '/usr/bin',
    HOME: '/home/user',
    TMPDIR: '/tmp',
    CI: 'true',
    NODE_ENV: 'test',
    TERM: 'xterm',
    LANG: 'en_US.UTF-8',
    SECRET_KEY: 'leaked',
    RANDOM_VAR: 'random',
  };

  it('keeps only allowlisted variables from the base environment', () => {
    const result = buildEnvironment(baseEnv);
    expect(Object.keys(result).sort()).toEqual([...ALLOWLIST_ENV_VARS].sort());
  });

  it('preserves allowlisted values', () => {
    const result = buildEnvironment(baseEnv);
    expect(result.PATH).toBe('/usr/bin');
    expect(result.HOME).toBe('/home/user');
    expect(result.TMPDIR).toBe('/tmp');
    expect(result.CI).toBe('true');
    expect(result.NODE_ENV).toBe('test');
    expect(result.TERM).toBe('xterm');
    expect(result.LANG).toBe('en_US.UTF-8');
  });

  it('drops variables not on the allowlist', () => {
    const result = buildEnvironment(baseEnv);
    expect(result.SECRET_KEY).toBeUndefined();
    expect(result.RANDOM_VAR).toBeUndefined();
  });

  it('never includes arbitrary parent variables', () => {
    const result = buildEnvironment({ MY_VAR: 'x', NODE_OPTIONS: '--max-old-space-size=1' });
    expect(result.MY_VAR).toBeUndefined();
    expect(result.NODE_OPTIONS).toBeUndefined();
  });

  it('merges explicit environment variables', () => {
    const result = buildEnvironment(baseEnv, { FOO: 'bar', BAZ: 'qux' });
    expect(result.FOO).toBe('bar');
    expect(result.BAZ).toBe('qux');
  });

  it('explicit variables override allowlisted values', () => {
    const result = buildEnvironment(baseEnv, { NODE_ENV: 'production', PATH: '/custom' });
    expect(result.NODE_ENV).toBe('production');
    expect(result.PATH).toBe('/custom');
  });

  it('explicit variables override non-allowlisted keys verbatim', () => {
    const result = buildEnvironment({}, { CUSTOM: 'v' });
    expect(result.CUSTOM).toBe('v');
  });

  it('returns an empty object when base and explicit are empty', () => {
    expect(buildEnvironment({})).toEqual({});
  });

  it('omits allowlisted keys that are undefined in the base', () => {
    const result = buildEnvironment({ PATH: '/usr/bin' });
    expect(result.HOME).toBeUndefined();
    expect(result.PATH).toBe('/usr/bin');
  });

  it('does not mutate the base environment', () => {
    const original = { ...baseEnv };
    buildEnvironment(baseEnv, { NODE_ENV: 'prod' });
    expect(baseEnv).toEqual(original);
  });

  it('is deterministic for identical inputs', () => {
    const a = buildEnvironment(baseEnv, { FOO: 'bar' });
    const b = buildEnvironment(baseEnv, { FOO: 'bar' });
    expect(a).toEqual(b);
  });

  it('is deterministic across repeated calls', () => {
    const a = Object.keys(buildEnvironment(baseEnv)).join(',');
    const b = Object.keys(buildEnvironment(baseEnv)).join(',');
    expect(a).toBe(b);
  });

  it('treats an undefined explicit env the same as an empty object', () => {
    expect(buildEnvironment(baseEnv, undefined)).toEqual(buildEnvironment(baseEnv, {}));
  });

  it('does not read process.env implicitly', () => {
    const result = buildEnvironment({});
    for (const key of Object.keys(process.env)) {
      expect(result[key]).toBeUndefined();
    }
  });

  it('allows an explicit variable to shadow a dropped base variable', () => {
    const result = buildEnvironment({ SECRET_KEY: 'base' }, { SECRET_KEY: 'explicit' });
    expect(result.SECRET_KEY).toBe('explicit');
  });

  it('handles the full allowlist present in base plus explicit merge', () => {
    const result = buildEnvironment(baseEnv, { EXTRA: '1', NODE_ENV: 'production' });
    const keys = Object.keys(result).sort();
    expect(keys).toEqual([...ALLOWLIST_ENV_VARS, 'EXTRA'].sort());
    expect(result.NODE_ENV).toBe('production');
    expect(result.EXTRA).toBe('1');
  });
});
