import { RepositoryContextService } from "../src/index.js";

/** Index an in-memory repository from a path->content record. */
export function indexRepo(files: Record<string, string>): RepositoryContextService {
  const engine = new RepositoryContextService();
  engine.indexFromContents(new Map(Object.entries(files)));
  return engine;
}

/** A small, deterministic authentication-flavored repository used across tests. */
export function makeAuthRepo(): Record<string, string> {
  return {
    "auth/types.ts": `
export interface AuthConfig {
  issuer: string;
  expiresIn: number;
}
export type AuthResult = { ok: boolean; token: string | null };
export interface TokenParser {
  parse(raw: string): AuthResult;
}
`,
    "auth/token.ts": `
import type { AuthResult, TokenParser } from "./types";

export class JwtParser implements TokenParser {
  parse(raw: string): AuthResult {
    return { ok: true, token: raw };
  }
}

export function parseToken(raw: string): AuthResult {
  return { ok: true, token: raw };
}
`,
    "auth/auth-service.ts": `
import type { AuthConfig } from "./types";
import { JwtParser, parseToken } from "./token";

export class AuthService {
  constructor(private readonly config: AuthConfig) {}

  authenticate(token: string): boolean {
    return parseToken(token).ok;
  }

  parser(): JwtParser {
    return new JwtParser();
  }
}
`,
    "auth/barrel.ts": `
export { AuthService } from "./auth-service";
export { JwtParser, parseToken } from "./token";
export type { AuthConfig, AuthResult, TokenParser } from "./types";
`,
    "core/logger.ts": `
export interface Logger {
  log(message: string): void;
}

export class ConsoleLogger implements Logger {
  log(message: string): void {
    console.log(message);
  }
}

export function createLogger(): Logger {
  return new ConsoleLogger();
}
`,
    "core/hasher.ts": `
import type { Logger } from "./logger";

export function sha256(input: string, logger?: Logger): string {
  logger?.log("hashing");
  return input;
}
`,
    "index.ts": `
import { AuthService } from "./auth/auth-service";
export { AuthService };
export default AuthService;
`,
  };
}

/** Repository that imports nothing (a leaf graph). */
export function makeLeafRepo(): Record<string, string> {
  return {
    "src/util.ts": `
export function identity<T>(value: T): T {
  return value;
}
`,
  };
}

/** Two files that import each other, producing a cycle. */
export function makeCycleRepo(): Record<string, string> {
  return {
    "src/a.ts": `
import { b } from "./b";
export function a(): string {
  return b();
}
`,
    "src/b.ts": `
import { a } from "./a";
export function b(): string {
  return a();
}
`,
  };
}

/** A chain used to test transitive dependency traversal. */
export function makeChainRepo(): Record<string, string> {
  return {
    "src/entry.ts": `
import { mid } from "./mid";
export const entry = mid;
`,
    "src/mid.ts": `
import { leaf } from "./leaf";
export const mid = leaf;
`,
    "src/leaf.ts": `
export const leaf = 1;
`,
    "src/other.ts": `
export const other = 2;
`,
  };
}
