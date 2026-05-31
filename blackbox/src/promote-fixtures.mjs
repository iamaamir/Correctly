#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toFixtureCandidate } from "./fixtures.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args._[0] || (await readLatestRunPath("blackbox/runs"));
  const out = args.out || "tests/fixtures/scoring-cases.generated.json";
  const limit = Number(args.limit || 50);
  const records = await readJsonLines(input);
  const candidates = records
    .filter((record) => record.judge?.fixtureWorthy || record.judge?.verdict !== "pass" || record.error)
    .slice(0, limit)
    .map(toFixtureCandidate);

  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(candidates, null, 2)}\n`);
  console.log(`Wrote ${candidates.length} fixture candidate(s) to ${out}`);
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
