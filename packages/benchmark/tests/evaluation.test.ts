import { describe, expect, it } from "vitest";
import {
  deriveSignals,
  evaluateExecution,
  statusFrom,
  type EvaluationInput,
} from "../src/evaluation.js";
import type { AgentRunResult, GraderResultSummary, VerificationOutputs } from "../src/types.js";
import { makeTask } from "./helpers.js";

function agent(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    status: "success",
    plan: { summary: "s", steps: [], durationMs: 0 },
    steps: [],
    filesWritten: {},
    telemetry: {},
    ...overrides,
  };
}

function outputs(overrides: Partial<VerificationOutputs> = {}): VerificationOutputs {
  return {
    commandResults: {},
    testSummary: null,
    buildStatus: null,
    presentFiles: [],
    contents: {},
    patch: null,
    ...overrides,
  };
}

function grader(overrides: Partial<GraderResultSummary> = {}): GraderResultSummary {
  return { kind: "tests", passed: true, score: 1, reason: "ok", evidence: [], ...overrides };
}

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    task: makeTask("t1"),
    fixture: {} as never,
    agent: agent(),
    outputs: outputs(),
    grader: grader(),
    timedOut: false,
    cancelled: false,
    ...overrides,
  };
}

describe("deriveSignals", () => {
  it("records verification success from the grader", () => {
    const signals = deriveSignals(input({ grader: grader({ passed: true }) }));
    expect(signals.verificationSucceeds).toBe(true);
  });

  it("records test signals from the parsed summary", () => {
    const signals = deriveSignals(
      input({
        task: makeTask("t", { kind: "tests", mustPass: ["a.js"] }),
        outputs: outputs({
          testSummary: {
            total: 1, passed: 1, failed: 0,
            byName: { "a.js": true }, failureNames: [],
          },
        }),
      }),
    );
    expect(signals.testsPass).toBe(true);
    expect(signals.expectedTestsPass).toBe(true);
    expect(signals.unexpectedTestsFail).toBe(false);
  });

  it("flags unexpected test failures", () => {
    const signals = deriveSignals(
      input({
        task: makeTask("t", { kind: "tests", mustPass: ["a.js"] }),
        outputs: outputs({
          testSummary: {
            total: 2, passed: 1, failed: 1,
            byName: { "a.js": true, "b.js": false }, failureNames: ["b.js"],
          },
        }),
      }),
    );
    expect(signals.unexpectedTestsFail).toBe(true);
  });

  it("derives filesChanged from filesWritten", () => {
    const signals = deriveSignals(
      input({ agent: agent({ filesWritten: { "a.ts": "1" } }) }),
    );
    expect(signals.filesChanged).toBe(true);
  });

  it("derives filesChanged from a patch", () => {
    const signals = deriveSignals(
      input({ outputs: outputs({ patch: { changes: [{ path: "a.ts", after: "1" }] } }) }),
    );
    expect(signals.filesChanged).toBe(true);
  });

  it("computes expectedFilesChanged for diff tasks", () => {
    const signals = deriveSignals(
      input({
        task: makeTask("t", { kind: "diff", expectedPaths: ["a.ts"] }),
        outputs: outputs({ patch: { changes: [{ path: "a.ts", after: "2" }] }, contents: { "a.ts": "1" } }),
      }),
    );
    expect(signals.expectedFilesChanged).toBe(true);
  });

  it("computes expectedFilesChanged for files tasks from writes", () => {
    const signals = deriveSignals(
      input({
        task: makeTask("t", { kind: "files", expected: ["README.md"] }),
        agent: agent({ filesWritten: { "README.md": "# x" } }),
      }),
    );
    expect(signals.expectedFilesChanged).toBe(true);
  });

  it("flags forbidden file changes", () => {
    const signals = deriveSignals(
      input({
        task: makeTask("t", { kind: "files", expected: ["a.md"], forbidden: ["secrets.md"] }),
        agent: agent({ filesWritten: { "secrets.md": "shh" } }),
      }),
    );
    expect(signals.forbiddenFilesChanged).toBe(true);
  });

  it("leaves patchApplies null without a patch", () => {
    expect(deriveSignals(input()).patchApplies).toBeNull();
  });

  it("reports clean patch application", () => {
    const signals = deriveSignals(
      input({
        outputs: outputs({
          contents: { "a.ts": "1" },
          patch: { changes: [{ path: "a.ts", before: "1", after: "2" }] },
        }),
      }),
    );
    expect(signals.patchApplies).toBe(true);
  });

  it("reports patch conflicts", () => {
    const signals = deriveSignals(
      input({
        outputs: outputs({
          contents: { "a.ts": "zzz" },
          patch: { changes: [{ path: "a.ts", before: "1", after: "2" }] },
        }),
      }),
    );
    expect(signals.patchApplies).toBe(false);
  });

  it("carries agent-reported success separately", () => {
    const signals = deriveSignals(
      input({ agent: agent({ status: "failed" }) }),
    );
    expect(signals.agentReportedSuccess).toBe(false);
    expect(signals.verificationSucceeds).toBe(true);
  });

  it("carries timeout and cancellation flags", () => {
    const timedOut = deriveSignals(input({ timedOut: true }));
    expect(timedOut.timedOut).toBe(true);
    const cancelled = deriveSignals(input({ cancelled: true }));
    expect(cancelled.cancelled).toBe(true);
  });
});

describe("statusFrom", () => {
  it("maps timeout before all other statuses", () => {
    const mapped = statusFrom(deriveSignals(input({ timedOut: true, cancelled: true })));
    expect(mapped.status).toBe("timeout");
  });

  it("maps cancellation", () => {
    const mapped = statusFrom(deriveSignals(input({ cancelled: true })));
    expect(mapped.status).toBe("cancelled");
  });

  it("maps passing verification to passed", () => {
    const mapped = statusFrom(deriveSignals(input()));
    expect(mapped.status).toBe("passed");
    expect(mapped.outcome).toBe("success");
  });

  it("maps failed verification", () => {
    const mapped = statusFrom(deriveSignals(input({ grader: grader({ passed: false }) })));
    expect(mapped.status).toBe("verification_failed");
  });
});

describe("evaluateExecution", () => {
  it("produces success reasons when passed", () => {
    const result = evaluateExecution(input());
    expect(result.status).toBe("passed");
    expect(result.reasons[0]).toContain("verification passed");
  });

  it("notes when the agent lied about success", () => {
    const result = evaluateExecution(
      input({ grader: grader({ passed: false }), agent: agent({ status: "success" }) }),
    );
    expect(result.status).toBe("verification_failed");
    expect(result.reasons.join(" ")).toContain("agent reported success but verification failed");
  });

  it("returns timeout reasons", () => {
    const result = evaluateExecution(input({ timedOut: true }));
    expect(result.status).toBe("timeout");
  });

  it("returns cancellation reasons", () => {
    const result = evaluateExecution(input({ cancelled: true }));
    expect(result.status).toBe("cancelled");
  });
});