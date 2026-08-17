import { describe, expect, it } from "vitest";
import {
  InMemoryFileSystemIO,
  normalizePath,
  realFileSystemIO,
} from "../src/file-system.js";

describe("normalizePath", () => {
  it("normalizes POSIX separators", () => {
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
  });

  it("strips trailing slashes", () => {
    expect(normalizePath("/fixtures/deep/")).toBe("/fixtures/deep");
  });

  it("returns / for the root", () => {
    expect(normalizePath("//")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  it("leaves clean absolute paths unchanged", () => {
    expect(normalizePath("/a/b/c")).toBe("/a/b/c");
  });
});

describe("InMemoryFileSystemIO", () => {
  it("write then read round-trips content", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/tmp/a.txt", "hello");
    expect(await io.readFile("/tmp/a.txt")).toBe("hello");
  });

  it("exists reports presence", async () => {
    const io = InMemoryFileSystemIO.create();
    expect(await io.exists("/tmp/a.txt")).toBe(false);
    await io.writeFile("/tmp/a.txt", "x");
    expect(await io.exists("/tmp/a.txt")).toBe(true);
  });

  it("readFile throws for missing files", async () => {
    const io = InMemoryFileSystemIO.create();
    await expect(io.readFile("/tmp/missing.txt")).rejects.toThrow(/ENOENT/);
  });

  it("deleteFile removes entries", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/tmp/a.txt", "x");
    await io.deleteFile("/tmp/a.txt");
    expect(await io.exists("/tmp/a.txt")).toBe(false);
  });

  it("deleteFile is idempotent", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.deleteFile("/tmp/never.txt");
    expect(await io.exists("/tmp/never.txt")).toBe(false);
  });

  it("rename moves content and fails on missing source", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/tmp/a.txt", "payload");
    await io.rename("/tmp/a.txt", "/tmp/b.txt");
    expect(await io.readFile("/tmp/b.txt")).toBe("payload");
    expect(await io.exists("/tmp/a.txt")).toBe(false);
    await expect(io.rename("/tmp/missing", "/tmp/out")).rejects.toThrow(/ENOENT/);
  });

  it("listFiles returns immediate children sorted", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/root/src/sum.ts", "a");
    await io.writeFile("/root/test/sum.test.js", "b");
    await io.writeFile("/root/README.md", "c");
    expect(await io.listFiles("/root")).toEqual(["README.md", "src", "test"]);
  });

  it("listFiles on / lists top-level path segments", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/a/b.txt", "x");
    await io.writeFile("/c.txt", "y");
    expect(await io.listFiles("/")).toEqual(["a", "c.txt"]);
  });

  it("listFiles returns [] for empty prefixes", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/other/f.txt", "x");
    expect(await io.listFiles("/nothing")).toEqual([]);
  });

  it("has detects a child entry by name", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/root/src/sum.ts", "a");
    expect(await io.has("/root", "src")).toBe(true);
    expect(await io.has("/root", "nope")).toBe(false);
  });

  it("mkdir is a no-op and safe to call", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.mkdir("/whatever/deep");
    expect(await io.exists("/whatever/deep")).toBe(false);
  });

  it("makeTempDir creates a unique path and records it", async () => {
    const io = InMemoryFileSystemIO.create();
    const first = await io.makeTempDir("/tmp/devforge-");
    const second = await io.makeTempDir("/tmp/devforge-");
    expect(first).not.toBe(second);
    expect(first.startsWith("/tmp/devforge-")).toBe(true);
  });

  it("paths returns a sorted snapshot", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/b.txt", "1");
    await io.writeFile("/a/c.txt", "2");
    expect(io.paths()).toEqual(["/a/c.txt", "/b.txt"]);
  });
});

describe("realFileSystemIO", () => {
  it("exposes the full injectable surface", () => {
    expect(typeof realFileSystemIO.readFile).toBe("function");
    expect(typeof realFileSystemIO.writeFile).toBe("function");
    expect(typeof realFileSystemIO.deleteFile).toBe("function");
    expect(typeof realFileSystemIO.listFiles).toBe("function");
    expect(typeof realFileSystemIO.makeTempDir).toBe("function");
  });
});