import { describe, expect, it } from "vitest";
import {
  FixtureCore,
  fixtureIdFor,
  InMemoryRepositoryFixtureFactory,
  RealCommandRunner,
  TmpRepositoryFixtureFactory,
} from "../src/repository-fixture.js";
import { FixtureError } from "../src/errors.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";
import { sha256 } from "@devforge/memory";
import { makeFixture, makeRepository, makeTask, ScriptedCommandRunner } from "./helpers.js";

describe("fixtureIdFor", () => {
  it("is deterministic for identical inputs", () => {
    const task = makeTask("t1");
    const repository = makeRepository("r");
    expect(fixtureIdFor(task, repository)).toBe(fixtureIdFor(task, repository));
  });

  it("differs across tasks", () => {
    const repository = makeRepository("r");
    expect(fixtureIdFor(makeTask("a"), repository)).not.toBe(
      fixtureIdFor(makeTask("b"), repository),
    );
  });

  it("differs across repositories", () => {
    const task = makeTask("t");
    expect(fixtureIdFor(task, makeRepository("r1"))).not.toBe(
      fixtureIdFor(task, makeRepository("r2")),
    );
  });

  it("differs across base revisions", () => {
    const repository = makeRepository("r");
    expect(
      fixtureIdFor(makeTask("t", { kind: "tests", mustPass: [] }, { baseRevision: "main" }), repository),
    ).not.toBe(
      fixtureIdFor(makeTask("t", { kind: "tests", mustPass: [] }, { baseRevision: "dev" }), repository),
    );
  });
});

describe("FixtureCore (in-memory)", () => {
  const repository = makeRepository("r", {
    "src/a.ts": "a",
    "src/nested/b.ts": "b",
    "top.txt": "t",
  });

  it("exposes identity fields", async () => {
    const task = makeTask("t1");
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), task, repository);
    expect(fixture.repositoryId).toBe("r");
    expect(fixture.baseRevision).toBe("main");
    expect(fixture.fixtureId).toBe(fixtureIdFor(task, repository));
    expect(fixture.isGit()).toBe(false);
  });

  it("initializes the repository files", async () => {
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), makeTask("t1"), repository);
    await fixture.initialize();
    expect(await fixture.readFile("src/a.ts")).toBe("a");
    expect(await fixture.readFile("src/nested/b.ts")).toBe("b");
  });

  it("initialize is idempotent", async () => {
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), makeTask("t1"), repository);
    await fixture.initialize();
    await fixture.initialize();
    expect(await fixture.readFile("top.txt")).toBe("t");
  });

  it("readFile returns null for missing files", async () => {
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), makeTask("t1"), repository);
    expect(await fixture.readFile("missing.ts")).toBeNull();
  });

  it("lists files recursively", async () => {
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), makeTask("t1"), repository);
    await fixture.initialize();
    expect(await fixture.listFiles()).toEqual([
      "src/a.ts",
      "src/nested/b.ts",
      "top.txt",
    ]);
  });

  it("supports write/delete/existence", async () => {
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), makeTask("t1"), repository);
    await fixture.initialize();
    await fixture.writeFile("new.txt", "hello");
    expect(await fixture.exists("new.txt")).toBe(true);
    await fixture.deleteFile("new.txt");
    expect(await fixture.exists("new.txt")).toBe(false);
  });

  it("runs commands through the injected runner", async () => {
    const runner = new ScriptedCommandRunner({ "echo hi": { stdout: "hi" } });
    const io = InMemoryFileSystemIO.create();
    const fixture = await makeFixture(io, runner, makeTask("t1"), repository);
    const result = await fixture.run("echo hi", { dir: "x" });
    expect(result.stdout).toBe("hi");
    expect(fixture.rootDir).toContain(fixture.fixtureId);
  });

  it("snapshotContents hashes file contents by relative path", async () => {
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), makeTask("t1"), repository);
    await fixture.initialize();
    const snapshot = await fixture.snapshotContents();
    expect(snapshot["src/a.ts"]).toBe(sha256("a"));
    expect(Object.keys(snapshot).sort()).toEqual(
      ["src/a.ts", "src/nested/b.ts", "top.txt"],
    );
  });

  it("rejects operations after cleanup", async () => {
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), makeTask("t1"), repository);
    await fixture.initialize();
    await fixture.cleanup();
    await expect(fixture.readFile("top.txt")).rejects.toThrow(FixtureError);
    await expect(fixture.run("x")).rejects.toThrow(FixtureError);
  });

  it("cleanup is idempotent", async () => {
    const fixture = await makeFixture(InMemoryFileSystemIO.create(), new ScriptedCommandRunner(), makeTask("t1"), repository);
    await fixture.initialize();
    await fixture.cleanup();
    await expect(fixture.cleanup()).resolves.toBeUndefined();
  });
});

describe("InMemoryRepositoryFixtureFactory", () => {
  it("creates fixtures under the configured base dir", async () => {
    const io = InMemoryFileSystemIO.create();
    const factory = new InMemoryRepositoryFixtureFactory({
      io,
      commandRunner: new ScriptedCommandRunner(),
      baseDir: "/fixtures-root",
    });
    const fixture = await factory.create(makeTask("t1"), makeRepository("r"));
    expect(fixture.rootDir.startsWith("/fixtures-root/")).toBe(true);
  });
});

describe("TmpRepositoryFixtureFactory", () => {
  it("works over an injected in-memory filesystem without git", async () => {
    const io = InMemoryFileSystemIO.create();
    const factory = new TmpRepositoryFixtureFactory({
      io,
      commandRunner: new ScriptedCommandRunner(),
      git: false,
    });
    const fixture = await factory.create(
      makeTask("t1"),
      makeRepository("r", { "a.ts": "1" }),
    );
    await fixture.initialize();
    expect(await fixture.readFile("a.ts")).toBe("1");
    await fixture.cleanup();
  });

  it("uses a temp prefix when provided", () => {
    const factory = new TmpRepositoryFixtureFactory({
      io: InMemoryFileSystemIO.create(),
      git: false,
      tempPrefix: "/custom/devforge-",
    });
    expect(factory.name).toBe("tmp");
  });
});

describe("RealCommandRunner", () => {
  it("executes shell commands and captures output", async () => {
    const runner = new RealCommandRunner();
    const result = await runner.run(process.cwd(), "printf hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.command).toBe("printf hello");
  });

  it("captures non-zero exit codes", async () => {
    const runner = new RealCommandRunner();
    const result = await runner.run(process.cwd(), "exit 7");
    expect(result.exitCode).toBe(7);
  });

  it("captures stderr", async () => {
    const runner = new RealCommandRunner();
    const result = await runner.run(process.cwd(), "printf oops >&2");
    expect(result.stderr).toContain("oops");
  });
});