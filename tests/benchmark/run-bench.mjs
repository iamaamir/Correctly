import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const resultsDir = resolve(import.meta.dirname, "results");
const baselinePath = resolve(resultsDir, "baseline.json");
const hasBaseline = existsSync(baselinePath);

const env = { ...process.env };
if (!hasBaseline) {
  env.BENCH_SAVE_BASELINE = "1";
  console.log("  No baseline found — saving this run as baseline.");
}

const vitestBin = resolve(import.meta.dirname, "..", "..", "node_modules", ".bin", "vitest");
const result = spawnSync(vitestBin, ["run", "--config", "vitest.bench.config.js", "--reporter=verbose"], {
  env,
  cwd: resolve(import.meta.dirname, "..", ".."),
  stdio: "inherit",
});

process.exit(result.status);
