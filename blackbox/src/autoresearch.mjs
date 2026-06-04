#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = args.config || "blackbox/config.local.json";
  const cases = args.cases || "25";
  const runsDir = args.runsDir || "blackbox/runs";
  const fixturesOut = args.fixtures || "tests/fixtures/scoring-cases.generated.json";
  const reportOut = args.report || "blackbox/runs/latest-evaluation.json";
  const analysisOut = args.analysis || "blackbox/runs/latest-analysis.json";
  const analysisMarkdownOut = args.markdown || "blackbox/runs/latest-analysis.md";

  await run("node", ["blackbox/src/run.mjs", "--config", config, "--cases", cases]);
  const latestRun = await readLatestRunPath(runsDir);
  await run("node", ["blackbox/src/promote-fixtures.mjs", latestRun, "--out", fixturesOut]);
  await run("node", ["blackbox/src/evaluate-fixtures.mjs", fixturesOut, "--out", reportOut]);
  await run("node", [
    "blackbox/src/analyze-results.mjs",
    "--config",
    config,
    "--run",
    latestRun,
    "--evaluation",
    reportOut,
    "--out",
    analysisOut,
    "--markdown",
    analysisMarkdownOut,
  ]);

  const report = JSON.parse(await fs.readFile(reportOut, "utf8"));
  console.log(
    `Autoresearch complete: run=${latestRun}, fixtures=${fixturesOut}, passRate=${report.summary.passRate}, analysis=${analysisOut}`,
  );
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
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
