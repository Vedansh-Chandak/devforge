/**
 * @devforge/benchmark — Injectable environment and randomness (DF-024).
 *
 * The framework never reads `process.env` directly; every lookup goes through
 * a {@link Environment} so executions are reproducible and secret values can be
 * fed into redaction. Randomness is injected through a seeded {@link RandomSource}
 * so identical seeds produce identical behavior.
 */

/** Key/value environment access, injectable for tests. */
export interface Environment {
  get(name: string): string | undefined;
}

/** Reads the real `process.env`. */
export class SystemEnvironment implements Environment {
  get(name: string): string | undefined {
    return process.env[name];
  }
}

/** Deterministic environment backed by an explicit map. */
export class FakeEnvironment implements Environment {
  constructor(private readonly values: Readonly<Record<string, string>>) {}

  get(name: string): string | undefined {
    return Object.prototype.hasOwnProperty.call(this.values, name)
      ? this.values[name]
      : undefined;
  }
}

/** Suffixes that mark an environment variable as credential-shaped. */
export const SECRET_SUFFIXES = [
  "API_KEY",
  "APIKEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "CREDENTIALS",
  "PRIVATE_KEY",
  "AUTHORIZATION",
  "AUTH_TOKEN",
  "CLIENT_SECRET",
] as const;

/** True when an environment variable name looks like a credential. */
export function isSecretEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return (SECRET_SUFFIXES as readonly string[]).some((suffix) =>
    upper.endsWith(suffix),
  );
}

/** Default probe set used when collecting secrets from a real environment. */
export const SENSITIVE_ENV_NAMES: readonly string[] = [
  "GITHUB_TOKEN",
  "GITHUB_PAT",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "DATABASE_URL",
  "DB_PASSWORD",
  "SLACK_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "GOOGLE_API_KEY",
  "REDIS_PASSWORD",
  "JWT_SECRET",
  "PRIVATE_KEY",
];

/**
 * Values of sensitive environment variables, for feeding a redactor.
 * `names` is an explicit, deterministic probe set so the result is identical
 * for identical environments.
 */
export function secretValuesFrom(
  environment: Environment,
  names: readonly string[] = SENSITIVE_ENV_NAMES,
): string[] {
  const values: string[] = [];
  for (const name of names) {
    if (!isSecretEnvName(name)) continue;
    const value = environment.get(name);
    if (value !== undefined && value.length > 0) values.push(value);
  }
  return values;
}

/**
 * Deterministic PRNG. Identical seeds always produce identical streams.
 * Implementation: Mulberry32.
 */
export interface RandomSource {
  next(): number;
}

/** Mulberry32 — fast, deterministic, small-state PRNG. */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Bounded integer from a random source — `[0, maxExclusive)`. */
export function randomInt(random: RandomSource, maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  return Math.floor(random.next() * maxExclusive);
}

/** Deterministic pick from a non-empty list. */
export function randomChoice<T>(random: RandomSource, items: readonly T[]): T {
  if (items.length === 0) {
    throw new RangeError("randomChoice requires at least one item");
  }
  return items[randomInt(random, items.length)] as T;
}