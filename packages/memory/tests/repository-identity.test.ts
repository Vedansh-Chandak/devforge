import { describe, expect, it } from "vitest";
import {
  createRepositoryIdentity,
  normalizeRoot,
  identitiesEqual,
  reconcileIdentities,
  isRemoteIdentity,
} from "../src/repository-identity.js";
import { InvalidRecordError } from "../src/errors.js";

describe("createRepositoryIdentity", () => {
  it("is deterministic for identical inputs", () => {
    const a = createRepositoryIdentity({ root: "/repos/alpha" });
    const b = createRepositoryIdentity({ root: "/repos/alpha" });
    expect(a).toEqual(b);
  });

  it("derives different ids for different roots", () => {
    const a = createRepositoryIdentity({ root: "/repos/alpha" });
    const b = createRepositoryIdentity({ root: "/repos/beta" });
    expect(a.id).not.toBe(b.id);
  });

  it("encodes broader identity (name) over root", () => {
    const byRoot = createRepositoryIdentity({ root: "/tmp/alpha" });
    const byName = createRepositoryIdentity({ root: "/tmp/alpha", name: "devforge" });
    expect(byName.id).not.toBe(byRoot.id);
    expect(byName.name).toBe("devforge");
    expect(byName.source).toBe("name");
  });

  it("prefers remote URL as the strongest identity", () => {
    const remote = createRepositoryIdentity({
      root: "/workspace/a",
      remoteUrl: "git@github.com:org/repo.git",
    });
    expect(remote.id).toBe(
      createRepositoryIdentity({
        root: "/elsewhere/b",
        remoteUrl: "git@github.com:org/repo.git",
      }).id,
    );
    expect(remote.source).toBe("remote");
  });

  it("derives the same remote identity regardless of checkout path", () => {
    const i1 = createRepositoryIdentity({ root: "/a", remoteUrl: "u" });
    const i2 = createRepositoryIdentity({ root: "/b/c/d", remoteUrl: "u" });
    expect(i1.id).toBe(i2.id);
  });

  it("uses the last path segment as the display name by default", () => {
    const identity = createRepositoryIdentity({ root: "/repos/my-project" });
    expect(identity.name).toBe("my-project");
  });

  it("normalizes trailing slashes and dots deterministically", () => {
    const a = createRepositoryIdentity({ root: "/repos/code/" });
    const b = createRepositoryIdentity({ root: "/repos/code/./" });
    expect(a.root).toBe(b.root);
  });

  it("rejects empty roots", () => {
    expect(() => createRepositoryIdentity({ root: "" })).toThrow(InvalidRecordError);
  });

  it("rejects root composed only of whitespace", () => {
    expect(() => createRepositoryIdentity({ root: "" })).toThrow(InvalidRecordError);
  });
});

describe("normalizeRoot", () => {
  it("resolves relative segments", () => {
    expect(normalizeRoot("/a/b/../c")).toBe("/a/c");
  });

  it("is deterministic across identical inputs", () => {
    expect(normalizeRoot("/x/./y")).toBe(normalizeRoot("/x/y"));
  });
});

describe("identitiesEqual", () => {
  it("returns true for equal ids", () => {
    const a = createRepositoryIdentity({ root: "/r" });
    const b = createRepositoryIdentity({ root: "/r" });
    expect(identitiesEqual(a, b)).toBe(true);
  });

  it("returns false for different repositories", () => {
    const a = createRepositoryIdentity({ root: "/r1" });
    const b = createRepositoryIdentity({ root: "/r2" });
    expect(identitiesEqual(a, b)).toBe(false);
  });

  it("equates a remote identity with an identically-remote checkout", () => {
    const a = createRepositoryIdentity({ root: "/one", remoteUrl: "git@host:o/r" });
    const b = createRepositoryIdentity({ root: "/two", remoteUrl: "git@host:o/r" });
    expect(identitiesEqual(a, b)).toBe(true);
  });
});

describe("reconcileIdentities", () => {
  it("prefers the remote identity", () => {
    const root = createRepositoryIdentity({ root: "/r" });
    const remote = createRepositoryIdentity({ root: "/r", remoteUrl: "u" });
    const merged = reconcileIdentities(root, remote);
    expect(merged.source).toBe("remote");
    expect(merged.id).toBe(remote.id);
  });

  it("keeps the primary when neither is remote", () => {
    const primary = createRepositoryIdentity({ root: "/r", name: "n" });
    const secondary = createRepositoryIdentity({ root: "/r" });
    expect(reconcileIdentities(primary, secondary).id).toBe(primary.id);
  });
});

describe("isRemoteIdentity", () => {
  it("detects remote-derived identities", () => {
    expect(isRemoteIdentity(createRepositoryIdentity({ root: "/r", remoteUrl: "u" }))).toBe(true);
    expect(isRemoteIdentity(createRepositoryIdentity({ root: "/r" }))).toBe(false);
  });
});

describe("isolation guarantee", () => {
  it("two repositories never share a storage identity", () => {
    const a = createRepositoryIdentity({ root: "/repos/alpha" });
    const b = createRepositoryIdentity({ root: "/repos/beta" });
    const sameAsB = createRepositoryIdentity({ root: "/repos/beta" });
    expect(a.id).not.toBe(b.id);
    expect(b.id).toBe(sameAsB.id);
  });
});