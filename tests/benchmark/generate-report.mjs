#!/usr/bin/env node

/**
 * Generate an HTML benchmark comparison report from saved JSON runs.
 *
 * Usage:
 *   node tests/benchmark/generate-report.mjs
 *   node tests/benchmark/generate-report.mjs --before=baseline.json --after=last.json
 *
 * Opens the report in the default browser on macOS.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const DIR = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(DIR, "results");

// ── Parse args ──

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--(\w+)=(.+)/);
  if (m) args[m[1]] = m[2];
}

const beforeFile = join(RESULTS, args.before || "baseline.json");
const afterFile = join(RESULTS, args.after || "last.json");
const outFile = join(RESULTS, args.out || "report.html");

// ── Load data ──

function load(file, label) {
  if (!existsSync(file)) {
    console.error(`  ${label}: ${file} not found.`);
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(file, "utf-8"));
    console.error(`  ${label}: ${file} (${data.tag || "untagged"}, ${data.timestamp})`);
    return data;
  } catch (e) {
    console.error(`  ${label}: failed to parse ${file}: ${e.message}`);
    return null;
  }
}

const before = load(beforeFile, "Before (baseline)");
const after = load(afterFile, "After (current)");

if (!before || !after) {
  console.error("\nNeed both baseline.json (before) and last.json (after).");
  console.error("  Run BENCH_SAVE_BASELINE=1 npm run bench:session first.");
  process.exit(1);
}

// ── Compute deltas ──

const scenarioLabels = { A: "Single check", B: "Rapid typing 5\u00d7", C: "3 sequential checks" };

function keyOf(obj, key) {
  for (const v of Object.values(obj)) {
    if (typeof v === "object" && v !== null && key in v) return v[key];
  }
  return undefined;
}

function byScenario(data) {
  const map = {};
  for (const s of data.scenarios) map[s.scenario] = s;
  return map;
}

const beforeMap = byScenario(before);
const afterMap = byScenario(after);

const scenarios = [];
for (const [id, label] of Object.entries(scenarioLabels)) {
  const b = beforeMap[id];
  const aRun = afterMap[id];
  if (!b || !aRun) continue;

  const metrics = [];
  const seen = new Set();

  const both = [b, aRun];
  for (const obj of both) {
    for (const [group, vals] of Object.entries(obj)) {
      if (typeof vals !== "object" || vals === null) continue;
      for (const [k, v] of Object.entries(vals)) {
        if (typeof v !== "number" || seen.has(k)) continue;
        seen.add(k);
        const bv = keyOf(b, k) ?? 0;
        const av = keyOf(aRun, k) ?? 0;
        metrics.push({ key: k, before: bv, after: av, delta: Math.round((av - bv) * 10) / 10 });
      }
    }
  }

  metrics.sort((a, b) => {
    const order = [
      "createCount", "cloneCount", "promptCount", "destroyCount", "alive",
      "totalSessions", "total", "completed", "aborted", "errors",
      "calls", "level1Attempts", "level1Successes", "level2Attempts", "level3Attempts",
      "cascadeAvgMs", "sessionCreateAvgMs", "sessionPromptAvgMs", "totalMs",
    ];
    return order.indexOf(a.key) - order.indexOf(b.key);
  });

  scenarios.push({ id, label, metrics });
}

// ── Key metrics summary ──

const keyMetrics = ["createCount", "cloneCount", "aborted", "alive"];
const summary = [];
for (const k of keyMetrics) {
  let beforeTotal = 0;
  let afterTotal = 0;
  for (const s of scenarios) {
    const m = s.metrics.find((x) => x.key === k);
    if (m) {
      beforeTotal += m.before;
      afterTotal += m.after;
    }
  }
  summary.push({ key: k, before: beforeTotal, after: afterTotal, delta: afterTotal - beforeTotal });
}

// ── Generate HTML ──

function deltaHtml(delta) {
  if (delta === 0) return `<span class="delta-zero">→ 0</span>`;
  const sign = delta > 0 ? "+" : "";
  const cls = delta > 0 ? "delta-up" : "delta-down";
  const arrow = delta > 0 ? "↑" : "↓";
  return `<span class="${cls}">${arrow} ${sign}${delta}</span>`;
}

function metricRow(m) {
  return `<tr>
    <td class="metric-key">${m.key}</td>
    <td class="num">${m.before}</td>
    <td class="num">${m.after}</td>
    <td class="num">${deltaHtml(m.delta)}</td>
  </tr>`;
}

function metricRows(metrics) {
  return metrics.map(metricRow).join("\n");
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Correctly Benchmark Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f5f5f7;
    color: #1d1d1f;
    padding: 2rem;
    line-height: 1.5;
  }
  .container { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
  .subtitle { color: #6e6e73; font-size: 0.875rem; margin-bottom: 1.5rem; }
  .run-info {
    display: flex; gap: 2rem; margin-bottom: 2rem; flex-wrap: wrap;
  }
  .run-info > div {
    background: #fff; border-radius: 10px; padding: 1rem 1.25rem;
    flex: 1; min-width: 200px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }
  .run-info .tag { font-weight: 600; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .run-info .timestamp { font-size: 0.8125rem; color: #6e6e73; margin-top: 0.25rem; }
  h2 {
    font-size: 1.125rem; font-weight: 600; margin-bottom: 0.75rem;
    padding-bottom: 0.375rem; border-bottom: 1px solid #d2d2d7;
  }
  h3 {
    font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem;
  }
  table {
    width: 100%; border-collapse: collapse; background: #fff;
    border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    margin-bottom: 1.5rem;
  }
  th {
    text-align: left; padding: 0.625rem 0.875rem;
    font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.05em; color: #6e6e73;
    border-bottom: 1px solid #e8e8ed;
  }
  td { padding: 0.5rem 0.875rem; font-size: 0.875rem; border-bottom: 1px solid #f0f0f2; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #fafafa; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .metric-key { font-weight: 500; }
  .delta-zero { color: #8e8e93; }
  .delta-up { color: #30b158; font-weight: 600; }
  .delta-down { color: #ff9500; font-weight: 600; }


<h1>Correctly Session Benchmark</h1>
<p class="subtitle">Comparing performance before and after lifecycle optimization</p>

<div class="run-info">
  <div>
    <div class="tag">Before</div>
    <div>${before.tag || "baseline"}</div>
    <div class="timestamp">${before.timestamp}</div>
  </div>
  <div>
    <div class="tag">After</div>
    <div>${after.tag || "current"}</div>
    <div class="timestamp">${after.timestamp}</div>
  </div>
</div>

<h2>Key metrics (all scenarios combined)</h2>
<div class="summary-grid">
  ${summary.map((m) => {
    const dir = ["cloneCount", "aborted"].includes(m.key) ? -1 : 1;
    const diff = m.delta * dir;
    const cls = diff < 0 ? "bad" : diff > 0 ? "good" : "neutral";
    const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
    const labelMap = { createCount: "Session creates", cloneCount: "Session clones", aborted: "Cancellations", alive: "Leaked sessions" };
    return `<div class="summary-card">
      <div class="label">${labelMap[m.key] || m.key}</div>
      <div class="value">${m.after}</div>
      <div class="sub ${cls}">${arrow} ${m.delta > 0 ? "+" : ""}${m.delta} from ${m.before}</div>
    </div>`;
  }).join("\n  ")}
</div>

<h2>Per-scenario breakdown</h2>

${scenarios.map((s) => `
<h3>${s.id}: ${s.label}</h3>
<table>
  <thead><tr>
    <th>Metric</th>
    <th class="num">Before</th>
    <th class="num">After</th>
    <th class="num">Δ</th>
  </tr></thead>
  <tbody>
    ${metricRows(s.metrics)}
  </tbody>
</table>
`).join("\n")}

</div>
</body>
</html>`;

writeFileSync(outFile, html, "utf-8");
console.error(`\n  Report written to ${outFile}`);

// Try to open in browser on macOS
try {
  execSync(`open "${outFile}"`);
  console.error("  Opened in browser.\n");
} catch {
  console.error(`  Open manually: file://${outFile}\n`);
}
