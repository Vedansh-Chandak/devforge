import { describe, expect, it } from "vitest";
import {
  ARTIFACT_KINDS,
  buildTaskArtifacts,
  environmentRedactor,
  FileArtifactStore,
  MemoryArtifactStore,
  truncate,
  type Artifact,
} from "../src/artifacts.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";
import type { AgentRunResult } from "../src/types.js";
import { makeTaskResult } from "./helpers.js";

function agent(): AgentRunResult {
  return {
    status: "success",
    plan: { summary: "fix the bug", steps: ["a", "b"], durationMs: 1 },
    steps: [
      { intent: "run tests", status: "success", message: "ok", commandsRun: ["npm test"], durationMs: 0 },
    ],
    filesWritten: { "src/sum.ts": "1" },
    patch: { changes: [{ path: "src/sum.ts", before: "0", after: "1" }] },
    telemetry: {},
  };
}

function timedOutResult() {
  return {
    ...makeTaskResult("t1", { status: "timeout" as never, score: 0 }),
    evidence: ["event one", "event two"],
    errors: ["exploded"],
  };
}

describe("truncate", () => {
  it("passes through content within the cap", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("appends a marker when truncating", () => {
    const output = truncate("abcdefghijklm", 5);
    expect(output).toContain("abcde");
    expect(output).toContain("[truncated]");
    expect(output).not.toContain("fgh");
  });

  it("is deterministic", () => {
    expect(truncate("0123456789x", 4)).toBe(truncate("0123456789x", 4));
  });
});

describe("MemoryArtifactStore", () => {
  it("round-trips artifacts", async () => {
    const store = new MemoryArtifactStore();
    const key = await store.save("run-1", "t1", { kind: "events", name: "events", content: "abc" });
    expect(key).not.toBeNull();
    expect(await store.read("run-1", "t1", "events-events")).toBe("abc");
    expect(await store.list("run-1")).toEqual(["run-1/t1/events-events"]);
  });

  it("lists per-task when filtered", async () => {
    const store = new MemoryArtifactStore();
    await store.save("run", "a", { kind: "events", name: "e", content: "1" });
    await store.save("run", "b", { kind: "events", name: "e", content: "2" });
    expect(await store.list("run", "b")).toEqual(["run/b/events-e"]);
  });

  it("respects disabled storage", async () => {
    const store = new MemoryArtifactStore({ enabled: false });
    expect(await store.save("run", "t", { kind: "events", name: "e", content: "x" })).toBeNull();
    expect(await store.list("run")).toEqual([]);
  });

  it("filters by include list", async () => {
    const store = new MemoryArtifactStore({ include: ["events"] });
    const kept = await store.save("run", "t", { kind: "events", name: "e", content: "x" });
    const skipped = await store.save("run", "t", { kind: "diff", name: "d", content: "y" });
    expect(kept).not.toBeNull();
    expect(skipped).toBeNull();
  });

  it("applies the redactor before persistence", async () => {
    const store = new MemoryArtifactStore({ redactor: (text) => text.replace("TOP", "[REDACTED]") });
    await store.save("run", "t", { kind: "events", name: "e", content: "TOP secret" });
    expect(await store.read("run", "t", "events-e")).toBe("[REDACTED] secret");
  });

  it("truncates according to maxBytes", async () => {
    const store = new MemoryArtifactStore({ maxBytes: 6 });
    await store.save("run", "t", { kind: "events", name: "e", content: "123456789" });
    const content = await store.read("run", "t", "events-e");
    expect(content).toContain("[truncated]");
  });
});

describe("FileArtifactStore", () => {
  it("persists and reloads from an injected filesystem", async () => {
    const io = InMemoryFileSystemIO.create();
    const store = new FileArtifactStore(io, "/artifacts");
    await store.save("run", "t", { kind: "events", name: "events", content: "payload" });
    expect(await store.read("run", "t", "events-events")).toBe("payload");
    expect((await store.list("run")).length).toBe(1);
  });

  it("stores under run/task directories", async () => {
    const io = InMemoryFileSystemIO.create();
    const store = new FileArtifactStore(io, "/artifacts");
    await store.save("run", "t", { kind: "events", name: "events", content: "x" });
    expect(io.paths()).toEqual(["/artifacts/run/t/events-events.txt"]);
  });

  it("returns null for missing reads", async () => {
    const store = new FileArtifactStore(InMemoryFileSystemIO.create(), "/artifacts");
    expect(await store.read("run", "t", "missing.txt")).toBeNull();
  });

  it("honors the enabled switch", async () => {
    const store = new FileArtifactStore(InMemoryFileSystemIO.create(), "/artifacts", { enabled: false });
    expect(await store.save("run", "t", { kind: "events", name: "e", content: "x" })).toBeNull();
  });
});

describe("buildTaskArtifacts", () => {
  it("emits verification and events artifacts", () => {
    const artifacts = buildTaskArtifacts(null, timedOutResult());
    const kinds = artifacts.map((artifact) => artifact.kind);
    expect(kinds).toContain("verification");
    expect(kinds).toContain("events");
    expect(kinds).toContain("failure");
  });

  it("emits agent, stdout, patch, and diff artifacts", () => {
    const artifacts = buildTaskArtifacts(agent(), makeTaskResult("t"));
    const kinds = artifacts.map((artifact) => artifact.kind);
    expect(kinds).toContain("agent");
    expect(kinds).toContain("stdout");
    expect(kinds).toContain("patch");
    expect(kinds).toContain("diff");
  });

  it("verification artifact includes grader reason and errors", () => {
    const artifacts = buildTaskArtifacts(null, timedOutResult());
    const verification = artifacts.find((artifact) => artifact.kind === "verification")!;
    expect(verification.content).toContain("exploded");
  });

  it("only uses supported artifact kinds", () => {
    const artifacts = buildTaskArtifacts(agent(), makeTaskResult("t"));
    for (const artifact of artifacts) {
      expect(ARTIFACT_KINDS).toContain(artifact.kind);
    }
  });

  it("skips empty events but always includes verification", () => {
    const artifacts = buildTaskArtifacts(null, makeTaskResult("t"));
    expect(artifacts.some((artifact) => artifact.kind === "events")).toBe(false);
    expect(artifacts.some((artifact) => artifact.kind === "verification")).toBe(true);
  });
});

describe("environmentRedactor", () => {
  it("redacts environment-derived secrets", () => {
    const redactor = environmentRedactor({
      get: (name) => (name === "GITHUB_TOKEN" ? "ghp_livekey_abc" : undefined),
    });
    expect(redactor("ghp_livekey_abc")).not.toContain("ghp_livekey_abc");
    expect(redactor("ghp_livekey_abc")).toContain("[REDACTED]");
  });

  it("leaves ordinary content alone", () => {
    const redactor = environmentRedactor({ get: () => undefined });
    expect(redactor("nothing secret")).toBe("nothing secret");
  });

  it("works without an environment", () => {
    const redactor = environmentRedactor(undefined);
    expect(redactor("plain text")).toBe("plain text");
  });
});