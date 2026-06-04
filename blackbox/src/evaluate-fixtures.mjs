#!/usr/bin/env node

import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractDisplayChanges, scoreAcceptedCorrection } from "../../lib/score.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0] || "tests/fixtures/scoring-cases.json";
  const out = args.out || null;
  const failOnRegression = Boolean(args["fail-on-regression"]);
  const fixtures = await readJson(input);
  const results = fixtures.map(evaluateFixture);
  const summary = summarize(results);
  const report = {
    input,
    evaluatedAt: new Date().toISOString(),
    summary,
    results,
  };

  if (out) {
    await fs.mkdir(dirname(out), { recursive: true });
    await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  }

  printSummary(report);

  if (failOnRegression && summary.failed > 0) {
    process.exitCode = 1;
  }
}

export function evaluateFixture(fixture) {
  const issues = [];
  const original = fixture.original || "";
  const level = fixture.level || 1;
  const rawResponse = fixture.rawResponse;
  const expected = fixture.expected || {};

  if (!rawResponse) {
    return {
      id: fixture.id || "<missing-id>",
      passed: false,
      issues: ["missing rawResponse"],
      actual: null,
      expected,
    };
  }

  const acceptance = scoreAcceptedCorrection(rawResponse, original, level);
  const extraction = extractDisplayChanges(rawResponse, original);
  const actual = {
    accept: acceptance.accepted,
    acceptanceScore: acceptance.acceptanceScore,
    corrected: rawResponse.corrected,
    displayChanges: extraction.displayChanges.map(({ original: o, replacement }) => ({ original: o, replacement })),
    hiddenChangeCount: extraction.hiddenChanges.length,
    hiddenReasons: extraction.hiddenChanges.map((change) => change.reason),
  };

  if (typeof expected.accept === "boolean" && actual.accept !== expected.accept) {
    issues.push(`accept expected ${expected.accept}, got ${actual.accept}`);
  }

  if (typeof expected.corrected === "string" && actual.corrected !== expected.corrected) {
    issues.push("corrected text mismatch");
  }

  if (Array.isArray(expected.displayChanges)) {
    for (const expectedChange of expected.displayChanges) {
      const found = actual.displayChanges.some(
        (change) => change.original === expectedChange.original && change.replacement === expectedChange.replacement,
      );
      if (!found) {
        issues.push(`missing display change ${expectedChange.original} -> ${expectedChange.replacement}`);
      }
    }
  }

  if (typeof expected.hiddenChangeCount === "number" && actual.hiddenChangeCount !== expected.hiddenChangeCount) {
    issues.push(`hiddenChangeCount expected ${expected.hiddenChangeCount}, got ${actual.hiddenChangeCount}`);
  }

  if (typeof expected.minAcceptanceScore === "number" && actual.acceptanceScore < expected.minAcceptanceScore) {
    issues.push(`acceptanceScore expected >= ${expected.minAcceptanceScore}, got ${actual.acceptanceScore}`);
  }

  if (typeof expected.maxAcceptanceScore === "number" && actual.acceptanceScore > expected.maxAcceptanceScore) {
    issues.push(`acceptanceScore expected <= ${expected.maxAcceptanceScore}, got ${actual.acceptanceScore}`);
  }

  return {
    id: fixture.id || "<missing-id>",
    passed: issues.length === 0,
    issues,
    actual,
    expected,
    notes: fixture.notes || "",
  };
}

function summarize(results) {
  const failed = results.filter((result) => !result.passed);
  const acceptanceScores = results
    .map((result) => result.actual?.acceptanceScore)
    .filter((score) => typeof score === "number");
  const averageAcceptanceScore =
    acceptanceScores.length > 0
      ? Math.round(acceptanceScores.reduce((sum, score) => sum + score, 0) / acceptanceScores.length)
      : null;

  return {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    passRate: results.length > 0 ? Number(((results.length - failed.length) / results.length).toFixed(3)) : 0,
    averageAcceptanceScore,
  };
}

function printSummary(report) {
  const { summary } = report;
  console.log(
    `Fixture evaluation: ${summary.passed}/${summary.total} passed, passRate=${summary.passRate}, avgScore=${summary.averageAcceptanceScore}`,
  );
  for (const result of report.results.filter((item) => !item.passed)) {
    console.log(`FAIL ${result.id}: ${result.issues.join("; ")}`);
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
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

function dirname(filePath) {
  const index = filePath.lastIndexOf("/");
  return index === -1 ? "." : filePath.slice(0, index);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
