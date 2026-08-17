import { describe, expect, it } from "vitest";
import { baselineFor, parseArgs } from "../src/cli.js";
import { createPassBaseline } from "../src/baselines.js";

describe("parseArgs", () => {
  it("uses defaults for no arguments", () => {
    const options = parseArgs([]);
    expect(options.dataset).toBe("dataset.json");
    expect(options.baseline).toBe("pass");
    expect(options.ab).toBe(false);
    expect(options.compare).toBeUndefined();
    expect(options.output).toBeUndefined();
    expect(options.thresholdSuccess).toBeUndefined();
  });

  it("parses flag/value pairs", () => {
    const options = parseArgs([
      "--dataset",
      "ds.json",
      "--baseline",
      "fail",
      "--output",
      "out.json",
    ]);
    expect(options.dataset).toBe("ds.json");
    expect(options.baseline).toBe("fail");
    expect(options.output).toBe("out.json");
  });

  it("parses boolean flags", () => {
    expect(parseArgs(["--ab"]).ab).toBe(true);
  });

  it("parses numeric threshold flags", () => {
    expect(parseArgs(["--threshold-success", "0.8"]).thresholdSuccess).toBe(0.8);
  });

  it("ignores unknown flags", () => {
    const options = parseArgs(["--mystery", "x"]);
    expect(options.dataset).toBe("dataset.json");
  });

  it("keeps default baseline when absent", () => {
    expect(parseArgs(["--dataset", "d.json"]).baseline).toBe("pass");
  });
});

describe("baselineFor", () => {
  it("maps fail to a failing baseline", async () => {
    const baseline = baselineFor("fail");
    expect(baseline.name).toBe("fail-baseline");
    const context = {
      clock: { now: () => 0 },
      cancellation: { cancelled: false, cancel: () => {}, check: () => {} },
      deadline: { remainingMs: () => 1000, expired: () => false, check: () => {} },
      attempt: 1,
      events: [],
    };
    const result = await baseline.run({
      task: { id: "t", title: "t", description: "d", repository: { id: "r" }, baseRevision: "main", setup: [], expectedBehavior: { summary: "s" }, verification: { kind: "tests", mustPass: [] }, timeoutMs: 1000, tags: [], difficulty: "EASY", category: "BUG_FIX" } as never,
      fixture: {} as never,
      context: context as never,
    });
    expect(result.status).toBe("failed");
  });

  it("maps pass to the passing baseline", () => {
    expect(baselineFor("pass")).toBeInstanceOf(createPassBaseline().constructor);
  });

  it("supports the scripted-rewrite baseline", () => {
    const baseline = baselineFor("scripted-rewrite") as { name: string };
    expect(baseline.name).toBe("scripted-rewrite");
  });
});