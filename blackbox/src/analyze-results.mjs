#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { safeJsonParseObject } from "./json.mjs";
import { OpenAICompatibleClient } from "./openai-compatible-client.mjs";
import { ANALYST_SYSTEM_PROMPT, analystUserPrompt } from "./prompts.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config || "blackbox/config.local.json";
  const runPath = args.run || (await readLatestRunPath(args.runsDir || "blackbox/runs"));
  const evaluationPath = args.evaluation || "blackbox/runs/latest-evaluation.json";
  const out = args.out || "blackbox/runs/latest-analysis.json";
  const markdownOut = args.markdown || out.replace(/\.json$/i, ".md");
  const config = await readJson(configPath);
  const records = await readJsonLines(runPath);
  const evaluation = await readJson(evaluationPath).catch(() => null);
  const analystConfig = config.analyst || config.judge || config.generator;
  const analyst = new OpenAICompatibleClient(analystConfig);

  const payload = {
    runSummary: summarizeRun(records),
    selectedRecords: selectEvidence(records),
    evaluation,
  };

  const { content } = await analyst.chat({
    system: ANALYST_SYSTEM_PROMPT,
    user: analystUserPrompt(payload),
    temperature: analyst.temperature ?? 0.1,
  });
  const analysis = safeJsonParseObject(content) || fallbackAnalysis(content, payload);

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(analysis, null, 2)}\n`);
  await fs.writeFile(markdownOut, renderMarkdown({ analysis, runPath, evaluationPath }));

  console.log(`Wrote analysis to ${out}`);
  console.log(`Wrote markdown report to ${markdownOut}`);
}

function summarizeRun(records) {
  const byVerdictRisk = {};
  const byCascadeLevel = {};
  let errors = 0;
  let fixtureWorthy = 0;

  for (const record of records) {
    if (record.error) errors++;
    if (record.judge?.fixtureWorthy) fixtureWorthy++;
    const key = `${record.judge?.verdict || "error"}/${record.judge?.risk || "unknown"}`;
    byVerdictRisk[key] = (byVerdictRisk[key] || 0) + 1;
    const level = record.correctlyResult?.cascadeLevel || "none";
    byCascadeLevel[level] = (byCascadeLevel[level] || 0) + 1;
  }

  return {
    total: records.length,
    errors,
    fixtureWorthy,
    byVerdictRisk,
    byCascadeLevel,
  };
}

function selectEvidence(records) {
  return records
    .filter(
      (record) =>
        record.error ||
        record.judge?.fixtureWorthy ||
        record.judge?.verdict !== "pass" ||
        record.judge?.risk !== "none",
    )
    .slice(0, 25)
    .map((record) => ({
      id: record.id,
      original: record.generated?.original || null,
      corrected: record.correctlyResult?.corrected || null,
      changes: record.correctlyResult?.changes || [],
      cascadeLevel: record.correctlyResult?.cascadeLevel || null,
      scoring: record.scoring
        ? {
            accepted: record.scoring.accepted,
            acceptanceScore: record.scoring.acceptanceScore,
            displayChanges: record.scoring.displayChanges,
            hiddenChanges: record.scoring.hiddenChanges,
          }
        : null,
      judge: record.judge,
      error: record.error ? { message: record.error.message } : null,
    }));
}

function fallbackAnalysis(content, payload) {
  return {
    summary: "Analyst model did not return valid JSON.",
    metrics: {
      mainRisks: Object.keys(payload.runSummary.byVerdictRisk),
      confidence: "low",
    },
    recommendations: [
      {
        priority: "P2",
        area: "fixture_quality",
        title: "Review analyst raw output",
        evidenceCaseIds: [],
        problem: "The analyst response was not valid JSON.",
        suggestedChange: content.slice(0, 1000),
        suggestedTests: ["Re-run analysis with a stronger or lower-temperature analyst model."],
      },
    ],
    fixtureReview: {
      promoteAsIs: [],
      promoteWithEdits: [],
      discard: [],
    },
  };
}

function renderMarkdown({ analysis, runPath, evaluationPath }) {
  const lines = [];
  lines.push("# Blackbox Analysis");
  lines.push("");
  lines.push(`Run: \`${runPath}\``);
  lines.push(`Evaluation: \`${evaluationPath}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(analysis.summary || "No summary.");
  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  for (const rec of analysis.recommendations || []) {
    lines.push(`### ${rec.priority || "P?"}: ${rec.title || "Untitled"}`);
    lines.push("");
    lines.push(`- Area: \`${rec.area || "unknown"}\``);
    lines.push(`- Evidence: ${(rec.evidenceCaseIds || []).map((id) => `\`${id}\``).join(", ") || "none"}`);
    lines.push(`- Problem: ${rec.problem || ""}`);
    lines.push(`- Suggested change: ${rec.suggestedChange || ""}`);
    lines.push(`- Suggested tests: ${(rec.suggestedTests || []).join("; ") || "none"}`);
    lines.push("");
  }
  lines.push("## Fixture Review");
  lines.push("");
  lines.push(
    `- Promote as-is: ${(analysis.fixtureReview?.promoteAsIs || []).map((id) => `\`${id}\``).join(", ") || "none"}`,
  );
  lines.push(
    `- Promote with edits: ${(analysis.fixtureReview?.promoteWithEdits || []).map((id) => `\`${id}\``).join(", ") || "none"}`,
  );
  lines.push(`- Discard: ${(analysis.fixtureReview?.discard || []).map((id) => `\`${id}\``).join(", ") || "none"}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readJsonLines(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readLatestRunPath(outputDir) {
  const latest = (await fs.readFile(path.join(outputDir, "latest.txt"), "utf8")).trim();
  return path.join(outputDir, latest);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
