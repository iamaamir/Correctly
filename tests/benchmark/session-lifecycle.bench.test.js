/**
 * Session lifecycle benchmark — measures Chrome Free AI session behavior
 * before and after the cancellation + base-session optimization.
 *
 * Usage:
 *   npm run bench:session
 *
 * Save results:
 *   npm run bench:session 2>&1 | tee bench-baseline.txt
 *   ... implement optimization ...
 *   npm run bench:session 2>&1 | tee bench-optimized.txt
 *
 * Compare:
 *   grep BENCHJSON bench-baseline.txt > baseline.json
 *   grep BENCHJSON bench-optimized.txt > optimized.json
 *   diff baseline.json optimized.json
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  installMockLanguageModel,
  resetMockState,
  getSessionMetrics,
} from "../mocks/language-model.js";

let ChromeFreeAIProvider;
let uninstallMock;

const SAMPLE_TEXT = "Their going to theyre house after work.";
const RAPID_INTERVAL_MS = 200;
const RAPID_CHECK_COUNT = 5;

// ── Results accumulator ──

const scenarioResults = [];

function recordResult(scenario, data) {
  scenarioResults.push({ scenario, ...data });
}

// ── Setup ──

beforeAll(async () => {
  uninstallMock = installMockLanguageModel();
  const mod = await import("../../providers/chrome-free-ai-provider.js");
  ChromeFreeAIProvider = mod.ChromeFreeAIProvider;
});

afterAll(() => {
  uninstallMock?.();
});

beforeEach(() => {
  resetMockState();
  performance.clearMarks();
  performance.clearMeasures();
});

function createProvider() {
  const p = new ChromeFreeAIProvider(null, "gemini-nano");
  p.resetSessionMetrics?.();
  p.resetCascadeMetrics?.();
  return p;
}

function invokeResolver(promise) {
  return promise.catch(() => {});
}

// ── Collectors ──

function collectMeasures() {
  const cascade = performance
    .getEntriesByType("measure")
    .filter((m) => m.name.startsWith("correctly:cascade:"));
  const sessionCreate = performance
    .getEntriesByType("measure")
    .filter((m) => m.name === "correctly:session:create");
  const sessionPrompt = performance
    .getEntriesByType("measure")
    .filter((m) => m.name === "correctly:session:prompt");
  return { cascade, sessionCreate, sessionPrompt };
}

function avgDuration(measures) {
  if (measures.length === 0) return 0;
  return measures.reduce((s, m) => s + m.duration, 0) / measures.length;
}

// ── Output helpers ──

function emitJSON(tag, data) {
  const line = JSON.stringify({ tag, ...data });
  console.log(`\nBENCHJSON ${line}\n`);
}

function snapshotTable(label, data, jsonKey) {
  console.log(`\n  ── ${label} ──`);
  console.table(data);
}

// ── Scenario A: Single check baseline ──

test("A: single check baseline", async () => {
  const provider = createProvider();
  const t0 = performance.now();
  const result = await provider.correctGrammar(SAMPLE_TEXT);
  const totalMs = Math.round((performance.now() - t0) * 10) / 10;

  expect(result).toBeDefined();
  expect(result.corrected).toBeTypeOf("string");

  const sessionMetrics = provider.getSessionMetrics();
  const cascadeMetrics = provider.getCascadeMetrics();
  const mockMetrics = getSessionMetrics();
  const measures = collectMeasures();

  const sessionData = {
    createCount: sessionMetrics.createCount,
    cloneCount: sessionMetrics.cloneCount,
    promptCount: sessionMetrics.promptCount,
    destroyCount: sessionMetrics.destroyCount,
    alive: mockMetrics.alive,
  };

  const cascadeData = {
    calls: cascadeMetrics.calls,
    level1Attempts: cascadeMetrics.levelAttempts[0],
    level1Successes: cascadeMetrics.levelSuccesses[0],
    aborted: cascadeMetrics.aborted,
  };

  const timingData = {
    cascadeAvgMs: Math.round(avgDuration(measures.cascade) * 10) / 10,
    sessionCreateAvgMs: Math.round(avgDuration(measures.sessionCreate) * 10) / 10,
    sessionPromptAvgMs: Math.round(avgDuration(measures.sessionPrompt) * 10) / 10,
    totalMs,
  };

  snapshotTable("Session lifecycle", sessionData);
  snapshotTable("Cascade metrics", cascadeData);
  snapshotTable("PerformanceMeasures", timingData);

  recordResult("A", { session: sessionData, cascade: cascadeData, timing: timingData });
  emitJSON("A-complete", { scenario: "A: single check", session: sessionData, cascade: cascadeData, timing: timingData });

  const mockCurrent = getSessionMetrics();
  expect(mockCurrent.destroyed).toBe(mockCurrent.totalCreated);
});

// ── Scenario B: Rapid typing (cancellation pressure) ──

test("B: rapid typing cancellation", async () => {
  const provider = createProvider();
  let currentController = null;
  const promises = [];

  for (let i = 0; i < RAPID_CHECK_COUNT; i++) {
    if (currentController) currentController.abort();
    currentController = new AbortController();
    const t0 = performance.now();
    const promise = provider
      .correctGrammar(`Check ${i} text with some issues.`, {
        signal: currentController.signal,
      })
      .then(() => {
        performance.measure(`check:B:${i}`, { start: t0, end: performance.now() });
        return { i, status: "completed" };
      })
      .catch((err) => {
        performance.measure(`check:B:${i}`, { start: t0, end: performance.now() });
        return { i, status: err.name === "AbortError" ? "aborted" : "error", error: err.message };
      });
    promises.push(promise);
    if (i < RAPID_CHECK_COUNT - 1) {
      await new Promise((r) => setTimeout(r, RAPID_INTERVAL_MS));
    }
  }

  const results = await Promise.all(promises.map(invokeResolver));
  await new Promise((r) => setTimeout(r, 100));

  const sessionMetrics = provider.getSessionMetrics();
  const cascadeMetrics = provider.getCascadeMetrics();
  const mockMetrics = getSessionMetrics();

  const completed = results.filter((r) => r.status === "completed").length;
  const aborted = results.filter((r) => r.status === "aborted").length;
  const errors = results.filter((r) => r.status === "error").length;

  const requestData = { total: RAPID_CHECK_COUNT, completed, aborted, errors };
  const sessionData = {
    createCount: sessionMetrics.createCount,
    cloneCount: sessionMetrics.cloneCount,
    promptCount: sessionMetrics.promptCount,
    destroyCount: sessionMetrics.destroyCount,
    alive: mockMetrics.alive,
  };
  const cascadeData = {
    calls: cascadeMetrics.calls,
    level1Attempts: cascadeMetrics.levelAttempts[0],
    level1Successes: cascadeMetrics.levelSuccesses[0],
    aborted: cascadeMetrics.aborted,
  };

  snapshotTable("Request outcomes", requestData);
  snapshotTable("Session lifecycle", sessionData);
  snapshotTable("Cascade metrics", cascadeData);

  recordResult("B", { requests: requestData, session: sessionData, cascade: cascadeData });
  emitJSON("B-complete", { scenario: "B: rapid typing", requests: requestData, session: sessionData, cascade: cascadeData });

  const mockCurrent = getSessionMetrics();
  expect(mockCurrent.totalCreated).toBe(mockCurrent.destroyed + mockCurrent.alive);
});

// ── Scenario C: Sequential reuse ──

test("C: sequential reuse (3 back-to-back)", async () => {
  const provider = createProvider();
  const checkTimings = [];

  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const result = await provider.correctGrammar(`${SAMPLE_TEXT} Attempt ${i}.`);
    checkTimings.push(Math.round((performance.now() - t0) * 10) / 10);
    expect(result).toBeDefined();
    expect(result.corrected).toBeTypeOf("string");
  }

  const sessionMetrics = provider.getSessionMetrics();
  const cascadeMetrics = provider.getCascadeMetrics();
  const mockMetrics = getSessionMetrics();
  const measures = collectMeasures();

  const sessionData = {
    createCount: sessionMetrics.createCount,
    cloneCount: sessionMetrics.cloneCount,
    promptCount: sessionMetrics.promptCount,
    destroyCount: sessionMetrics.destroyCount,
    alive: mockMetrics.alive,
    totalSessions: mockMetrics.totalCreated,
  };

  const cascadeData = {
    calls: cascadeMetrics.calls,
    level1Attempts: cascadeMetrics.levelAttempts[0],
    level1Successes: cascadeMetrics.levelSuccesses[0],
    aborted: cascadeMetrics.aborted,
  };

  const timingData = {
    cascadeAvgMs: Math.round(avgDuration(measures.cascade) * 10) / 10,
    sessionCreateAvgMs: Math.round(avgDuration(measures.sessionCreate) * 10) / 10,
    sessionPromptAvgMs: Math.round(avgDuration(measures.sessionPrompt) * 10) / 10,
    checkTimings,
  };

  snapshotTable("Session lifecycle (3 checks)", sessionData);
  snapshotTable("Cascade metrics", cascadeData);
  snapshotTable("PerformanceMeasures", timingData);

  recordResult("C", { session: sessionData, cascade: cascadeData, timing: timingData });
  emitJSON("C-complete", { scenario: "C: sequential reuse", session: sessionData, cascade: cascadeData, timing: timingData });

  const mockCurrent = getSessionMetrics();
  expect(mockCurrent.totalCreated).toBe(mockCurrent.destroyed + mockCurrent.alive);
});

// ── Final summary ──

test.afterAll(() => {
  const tag = process.env.BENCH_TAG || "unknown";

  const summary = {
    tag,
    timestamp: new Date().toISOString(),
    scenarios: scenarioResults,
  };

  console.log("\n══════════════════════════════════════");
  console.log("  BENCHMARK COMPLETE");
  console.log(`  Tag: ${tag}`);
  console.log(`  Results: ${scenarioResults.length} scenario(s)`);
  console.log("══════════════════════════════════════\n");

  // Single JSON blob with ALL results, easy to capture
  console.log(`BENCHJSON_SUMMARY ${JSON.stringify(summary)}`);
});
