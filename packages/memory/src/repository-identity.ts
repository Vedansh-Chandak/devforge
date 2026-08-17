/**
 * @devforge/memory — Stable repository identity (DF-023).
 *
 * Memory is scoped by a stable deterministic identity, never by mutable
 * filesystem paths alone. Callers with access to Git can supply the stronger
 * `remoteUrl` (e.g. the origin remote) so the identity survives moves on disk;
 * when omitted, the identity falls back to a normalized absolute root.
 * This module never executes commands — identity resolution is purely
 * deterministic over provided inputs.
 */
import { resolve } from "node:path";
import { basename } from "node:path";
import { sha256 } from "./ids.js";
import { InvalidRecordError } from "./errors.js";
import type { RepositoryIdentity, RepositoryIdentityInput } from "./types.js";

export type { RepositoryIdentity, RepositoryIdentityInput };

/** Normalize an absolute path deterministically without touching disk. */
export function normalizeRoot(root: string): string {
  if (!root || root.length === 0) {
    throw new InvalidRecordError("Repository root must not be empty.");
  }
  return resolve(root);
}

/**
 * Build the stable identity for a repository. Deterministic: identical inputs
 * always yield an identical identity object.
 */
export function createRepositoryIdentity(
  input: RepositoryIdentityInput,
): RepositoryIdentity {
  const root = normalizeRoot(input.root);
  let id: string;
  let source: RepositoryIdentity["source"];
  if (input.remoteUrl && input.remoteUrl.length > 0) {
    id = sha256(`remote:${input.remoteUrl}`);
    source = "remote";
  } else if (input.name && input.name.length > 0) {
    id = sha256(`name:${input.name}`);
    source = "name";
  } else {
    id = sha256(`root:${root}`);
    source = "root";
  }
  const name = input.name?.trim() ?? basename(root) ?? root;
  return { id, name: name.length > 0 ? name : root, root, source };
}

/** True when two identities address the same repository (by stable id). */
export function identitiesEqual(
  a: RepositoryIdentity,
  b: RepositoryIdentity,
): boolean {
  return a.id === b.id;
}

/**
 * Reconcile two identities that should describe the same checkout. When both
 * carry compatible remote URLs the remote identity wins because it is the
 * strongest invariant.
 */
export function reconcileIdentities(
  primary: RepositoryIdentity,
  secondary: RepositoryIdentity,
): RepositoryIdentity {
  if (primary.source === "remote") return primary;
  if (secondary.source === "remote") return secondary;
  return primary;
}

/** True when the identity was derived from a remote URL. */
export function isRemoteIdentity(identity: RepositoryIdentity): boolean {
  return identity.source === "remote";
}