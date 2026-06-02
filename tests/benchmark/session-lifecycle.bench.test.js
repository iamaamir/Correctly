/**
 * Session lifecycle benchmark — measures Chrome Free AI session behavior
 * before and after the cancellation + base-session optimization.
 *
 * Usage:
 *   npm run bench:session           # run, compare against baseline if saved
 *   BENCH_SAVE_BASELINE=1 npm run bench:session  # save current as baseline
 *
 * Workflow:
 *   1. First run (before optimization):
 *        BENCH_SAVE_BASELINE=1 npm run bench:session
 *      This saves tests/benchmark/results/baseline.json
 *
 *   2. Implement optimization changes
 *
 *   3. Rerun (after optimization):
 *        npm run bench:session
 *      Automatically loads baseline and prints a Δ report comparing every metric.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { getSessionMetrics, installMockLanguageModel, resetMockState } from "../mocks/language-model.js";

let ChromeFreeAIProvider;
let uninstallMock;

const SAMPLE_TEXT = "Their going to theyre house after work.";
const RAPID_INTERVAL_MS = 200;
const RAPID_CHECK_COUNT = 5;

const RESULTS_DIR = join(import.meta.dirname, "results");
const BASELINE_FILE = join(RESULTS_DIR, "baseline.json");
const LAST_FILE = join(RESULTS_DIR, "last.json");

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
  const cascade = performance.getEntriesByType("measure").filter((m) => m.name.startsWith("correctly:cascade:"));
  const sessionCreate = performance.getEntriesByType("measure").filter((m) => m.name === "correctly:session:create");
  const sessionPrompt = performance.getEntriesByType("measure").filter((m) => m.name === "correctly:session:prompt");
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

function snapshotTable(label, data) {
  console.log(`\n  ── ${label} ──`);
  console.table(data);
}

// ── Delta helpers ──

function computeDelta(before, after) {
  const flat = {};
  for (const [scenario, currData] of Object.entries(after)) {
    const prevData = before[scenario] || {};
    flat[scenario] = {};
    for (const metrics of Object.values(currData)) {
      if (typeof metrics !== "object" || metrics === null) continue;
      for (const [key, curr] of Object.entries(metrics)) {
        if (typeof curr !== "number") continue;
        const prev = prevData[key] ?? prevData[key] ?? 0;
        flat[scenario][key] = {
          before: prev,
          after: curr,
          delta: curr - prev,
          pct: prev > 0 ? `${Math.round(((curr - prev) / prev) * 100)}%` : curr > 0 ? "new" : "0%",
        };
      }
    }
  }
  return flat;
}

function loadJSON(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function loadBaseline() {
  return loadJSON(BASELINE_FILE);
}

function metricsEqual(a, b) {
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.scenarios.length, b.scenarios.length); i++) {
    const sa = a.scenarios[i];
    const sb = b.scenarios[i];
    if (!sa || !sb) return false;
    for (const key of ["session", "cascade", "requests"]) {
      const va = JSON.stringify(sa[key]);
      const vb = JSON.stringify(sb[key]);
      if (va !== vb) return false;
    }
  }
  return true;
}

function saveBaseline(summary) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(BASELINE_FILE, JSON.stringify(summary, null, 2));
  console.log(`\n  ✓ Saved baseline to ${BASELINE_FILE}`);
}

function printDeltaReport(baseline, current) {
  const byScenario = {};
  for (const s of baseline.scenarios) byScenario[s.scenario] = s;
  for (const s of current.scenarios) byScenario[s.scenario] = byScenario[s.scenario] || {};

  const after = {};
  for (const s of current.scenarios) after[s.scenario] = s;

  const labelMap = {
    A: "A: single check",
    B: "B: rapid typing 5×",
    C: "C: 3 sequential",
  };

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║         BENCHMARK Δ REPORT                       ║");
  console.log(`║  Baseline: ${baseline.tag || baseline.timestamp}           `);
  console.log(`║  Current:  ${current.tag || current.timestamp}           `);
  console.log("╚══════════════════════════════════════════════════╝");

  for (const s of current.scenarios) {
    const prev = byScenario[s.scenario];
    const scenarioLabel = labelMap[s.scenario] || s.scenario;

    console.log(`\n  ${scenarioLabel}:`);

    const rows = [];
    const seen = new Set();

    const allKeys = new Set();
    const collectKeys = (obj) => {
      if (!obj || typeof obj !== "object") return;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "object" && !Array.isArray(v)) collectKeys(v);
        else if (typeof v === "number") allKeys.add(k);
      }
    };
    collectKeys(s);
    collectKeys(prev);

    const keyOrder = [
      "createCount",
      "cloneCount",
      "promptCount",
      "destroyCount",
      "alive",
      "totalSessions",
      "total",
      "completed",
      "aborted",
      "errors",
      "calls",
      "level1Attempts",
      "level1Successes",
      "level2Attempts",
      "level3Attempts",
      "cascadeAvgMs",
      "sessionCreateAvgMs",
      "sessionPromptAvgMs",
      "totalMs",
    ];

    for (const key of keyOrder) {
      if (!allKeys.has(key)) continue;
      const currV = findNested(s, key);
      const prevV = prev ? findNested(prev, key) : undefined;
      if (currV === undefined && prevV === undefined) continue;
      const b = typeof prevV === "number" ? prevV : 0;
      const a = typeof currV === "number" ? currV : 0;
      const delta = Number.isInteger(a) && Number.isInteger(b) ? a - b : Math.round((a - b) * 10) / 10;
      const deltaStr = delta > 0 ? `+${delta}` : String(delta);
      rows.push({ metric: key, before: b, after: a, Δ: deltaStr });
    }

    if (rows.length > 0) console.table(rows);
  }

  // Summary of key improvements
  const totalBefore = { create: 0, clone: 0, aborted: 0, completed: 0 };
  const totalAfter = { create: 0, clone: 0, aborted: 0, completed: 0 };

  for (const s of current.scenarios) {
    totalAfter.create += findNested(s, "createCount") || 0;
    totalAfter.clone += findNested(s, "cloneCount") || 0;
    totalAfter.aborted += findNested(s, "aborted") || 0;
    if (s.requests) totalAfter.completed += s.requests.aborted || 0;
  }
  for (const s of baseline.scenarios) {
    totalBefore.create += findNested(s, "createCount") || 0;
    totalBefore.clone += findNested(s, "cloneCount") || 0;
    totalBefore.aborted += findNested(s, "aborted") || 0;
    if (s.requests) totalBefore.completed += s.requests.aborted || 0;
  }

  console.log("\n  Key metrics (all scenarios combined):");
  const summaryRows = [];
  if (totalBefore.create || totalAfter.create) {
    const d = totalAfter.create - totalBefore.create;
    summaryRows.push({
      metric: "Session creates",
      before: totalBefore.create,
      after: totalAfter.create,
      Δ: d > 0 ? `+${d}` : String(d),
    });
  }
  if (totalBefore.clone || totalAfter.clone) {
    const d = totalAfter.clone - totalBefore.clone;
    summaryRows.push({
      metric: "Session clones",
      before: totalBefore.clone,
      after: totalAfter.clone,
      Δ: d > 0 ? `+${d}` : String(d),
    });
  }
  if (totalBefore.aborted || totalAfter.aborted) {
    const d = totalAfter.aborted - totalBefore.aborted;
    summaryRows.push({
      metric: "Cascade aborts",
      before: totalBefore.aborted,
      after: totalAfter.aborted,
      Δ: d > 0 ? `+${d}` : String(d),
    });
  }
  if (summaryRows.length > 0) console.table(summaryRows);
}

function findNested(obj, key) {
  for (const v of Object.values(obj)) {
    if (typeof v === "object" && v !== null && key in v) return v[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "object" && item !== null && key in item) return item[key];
      }
    }
  }
  return undefined;
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
  emitJSON("A-complete", {
    scenario: "A: single check",
    session: sessionData,
    cascade: cascadeData,
    timing: timingData,
  });

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
  emitJSON("B-complete", {
    scenario: "B: rapid typing",
    requests: requestData,
    session: sessionData,
    cascade: cascadeData,
  });

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
  emitJSON("C-complete", {
    scenario: "C: sequential reuse",
    session: sessionData,
    cascade: cascadeData,
    timing: timingData,
  });

  const mockCurrent = getSessionMetrics();
  expect(mockCurrent.totalCreated).toBe(mockCurrent.destroyed + mockCurrent.alive);
});

// ── Final summary with auto-compare ──

test.afterAll(() => {
  let tag = process.env.BENCH_TAG;
  if (!tag) {
    try {
      tag = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf-8",
        timeout: 3000,
        stdio: "pipe",
      }).trim();
    } catch {
      tag = "unknown";
    }
  }
  const saveBaselineFlag = process.env.BENCH_SAVE_BASELINE === "1" || process.env.BENCH_SAVE_BASELINE === "true";

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

  console.log(`BENCHJSON_SUMMARY ${JSON.stringify(summary)}`);

  // ── Load previous run before overwriting ──
  const prevRun = loadJSON(LAST_FILE);

  // ── Always persist latest run ──
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(LAST_FILE, JSON.stringify(summary, null, 2));

  // ── Check if metrics changed since last run ──
  const metricsChanged = !prevRun || !metricsEqual(summary, prevRun);

  if (!metricsChanged && !saveBaselineFlag) {
    console.log("\n  No metric changes from previous run — skipping report.\n");
    return;
  }

  // ── Compare against baseline ──

  const baseline = loadBaseline();

  if (saveBaselineFlag) {
    saveBaseline(summary);
    if (baseline) {
      console.log("\n  (Overwrote previous baseline — Δ report compares against old baseline)\n");
      printDeltaReport(baseline, summary);
    }
  } else if (baseline) {
    printDeltaReport(baseline, summary);
  } else {
    console.log("\n  No baseline found for comparison.");
    console.log("  Save this run as baseline before implementing changes:");
    console.log("    BENCH_SAVE_BASELINE=1 npm run bench:session\n");
  }

  // ── Generate HTML report ──
  try {
    const reportScript = join(import.meta.dirname, "generate-report.mjs");
    execSync(`node "${reportScript}" 2>/dev/null`, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    const htmlPath = join(RESULTS_DIR, "report.html");
    console.log(`\n  Report: file://${htmlPath}\n`);
  } catch {
    // Report generation requires baseline.json + last.json both exist.
    // First run has no baseline yet — that's fine.
  }
});
