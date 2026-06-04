#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDisplayChanges, scoreAcceptedCorrection } from "../../lib/score.js";
import { createProvider } from "../../providers/provider-registry.js";
import { installChromeStub } from "./chrome-stub.mjs";
import { safeJsonParseObject } from "./json.mjs";
import { OpenAICompatibleClient } from "./openai-compatible-client.mjs";
import { GENERATOR_SYSTEM_PROMPT, generatorUserPrompt, JUDGE_SYSTEM_PROMPT, judgeUserPrompt } from "./prompts.mjs";

const DEFAULT_CASES = 10;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.config || "blackbox/config.local.json";
  const config = await readJson(configPath);
  const caseCount = Number(args.cases || config.caseCount || DEFAULT_CASES);
  const outputDir = args.outDir || config.outputDir || "blackbox/runs";
  const runId = `${timestamp()}-${slug(config.runName || "blackbox")}`;
  const outputPath = path.join(outputDir, `${runId}.jsonl`);

  installChromeStub();
  await fs.mkdir(outputDir, { recursive: true });

  const generator = new OpenAICompatibleClient(config.generator);
  const judge = new OpenAICompatibleClient(config.judge || config.generator);
  const fixerConfig = config.fixer || {};
  const provider = createProvider(
    fixerConfig.providerId || "ollama",
    fixerConfig.apiKey || "",
    fixerConfig.model,
    fixerConfig.baseUrl,
  );

  const summary = {
    total: 0,
    pass: 0,
    fail: 0,
    interesting: 0,
    errors: 0,
    fixtureWorthy: 0,
    outputPath,
  };

  for (let index = 1; index <= caseCount; index++) {
    const record = await runCase({ index, config, generator, provider, judge });
    summary.total++;
    if (record.error) summary.errors++;
    const verdict = record.judge?.verdict;
    if (verdict === "pass") summary.pass++;
    else if (verdict === "fail") summary.fail++;
    else if (verdict === "interesting") summary.interesting++;
    if (record.judge?.fixtureWorthy) summary.fixtureWorthy++;

    await appendJsonLine(outputPath, record);
    console.log(formatProgress(record));
  }

  await writeLatestPointer(outputDir, outputPath);
  console.log(JSON.stringify(summary, null, 2));
}

async function runCase({ index, config, generator, provider, judge }) {
  const startedAt = new Date().toISOString();
  const id = `${String(index).padStart(4, "0")}-${Date.now()}`;
  let generated = null;
  let correctlyResult = null;
  let scoring = null;
  let judgeResult = null;
  let error = null;

  try {
    generated = await generateCase(generator, { index, seed: config.seed });
    correctlyResult = await provider.correctGrammar(generated.original);
    scoring = scoreCorrectlyResult(correctlyResult, generated.original);
    judgeResult = await judgeCase(judge, { generated, correctlyResult, scoring });
  } catch (err) {
    error = {
      message: err.message || String(err),
      stack: err.stack || null,
    };
    if (generated) {
      judgeResult = await judgeCase(judge, { generated, correctlyResult, scoring, error }).catch((judgeErr) => ({
        verdict: "interesting",
        risk: "cascade_issue",
        shouldAccept: false,
        meaningPreserved: false,
        grammarImproved: false,
        visibleSuggestionsSafe: false,
        reason: `System errored and judge failed: ${judgeErr.message}`,
        fixtureWorthy: true,
      }));
    }
  }

  return {
    id,
    startedAt,
    provider: {
      id: provider.providerId,
      model: provider.model,
    },
    generated,
    correctlyResult,
    scoring,
    judge: judgeResult,
    error,
  };
}

async function generateCase(generator, { index, seed }) {
  const { content } = await generator.chat({
    system: GENERATOR_SYSTEM_PROMPT,
    user: generatorUserPrompt({ index, seed }),
    temperature: generator.temperature,
    responseFormatJson: true,
  });
  const parsed = safeJsonParseObject(content);
  if (!parsed?.original || typeof parsed.original !== "string") {
    throw new Error(`Generator returned invalid case: ${content.slice(0, 500)}`);
  }
  return {
    original: parsed.original,
    intendedMeaning: parsed.intendedMeaning || "",
    errorTags: Array.isArray(parsed.errorTags) ? parsed.errorTags : [],
    notes: parsed.notes || "",
  };
}

function scoreCorrectlyResult(result, original) {
  const normalized = {
    corrected: result.corrected,
    changes: Array.isArray(result.changes) ? result.changes : [],
    confidence: normalizeModelConfidence(result.confidence),
  };
  const level = result.cascadeLevel || 1;
  const acceptance = scoreAcceptedCorrection(normalized, original, level);
  const extraction = extractDisplayChanges(normalized, original);
  return {
    accepted: acceptance.accepted,
    acceptanceScore: acceptance.acceptanceScore,
    reasons: acceptance.reasons,
    displayChanges: extraction.displayChanges,
    hiddenChanges: extraction.hiddenChanges,
    cascadeLevel: result.cascadeLevel || null,
    displayConfidence: result.confidence ?? null,
  };
}

async function judgeCase(judge, payload) {
  const { content } = await judge.chat({
    system: JUDGE_SYSTEM_PROMPT,
    user: judgeUserPrompt(payload),
    temperature: judge.temperature,
    responseFormatJson: true,
  });
  const parsed = safeJsonParseObject(content);
  if (!parsed?.verdict) {
    return {
      verdict: "interesting",
      risk: "cascade_issue",
      shouldAccept: false,
      meaningPreserved: false,
      grammarImproved: false,
      visibleSuggestionsSafe: false,
      reason: `Judge returned invalid JSON: ${content.slice(0, 300)}`,
      fixtureWorthy: true,
    };
  }
  return {
    verdict: normalizeEnum(parsed.verdict, ["pass", "fail", "interesting"], "interesting"),
    risk: normalizeEnum(
      parsed.risk,
      ["none", "false_accept", "false_reject", "semantic_change", "bad_visibility", "weak_correction", "cascade_issue"],
      "none",
    ),
    shouldAccept: Boolean(parsed.shouldAccept),
    meaningPreserved: Boolean(parsed.meaningPreserved),
    grammarImproved: Boolean(parsed.grammarImproved),
    visibleSuggestionsSafe: Boolean(parsed.visibleSuggestionsSafe),
    reason: parsed.reason || "",
    fixtureWorthy: Boolean(parsed.fixtureWorthy),
  };
}

function normalizeModelConfidence(confidence) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return 5;
  if (confidence >= 1 && confidence <= 10) return confidence;
  return Math.max(1, Math.min(10, Math.round(confidence / 10)));
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function appendJsonLine(filePath, value) {
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`);
}

async function writeLatestPointer(outputDir, outputPath) {
  const relative = path.relative(outputDir, outputPath);
  await fs.writeFile(path.join(outputDir, "latest.txt"), `${relative}\n`);
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

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function slug(value) {
  return String(value || "run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function formatProgress(record) {
  const verdict = record.judge?.verdict || "error";
  const risk = record.judge?.risk || "unknown";
  const original = record.generated?.original || "<generation failed>";
  return `[${record.id}] ${verdict}/${risk}: ${original.slice(0, 100)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
