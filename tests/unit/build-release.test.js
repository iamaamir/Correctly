import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

const TIMEOUT = 60_000;
const buildScript = "scripts/build-release.mjs";
const artifacts = ["correctly-chrome.zip", "correctly-firefox.xpi"];

afterAll(() => {
  rmSync("dist", { recursive: true, force: true });
  for (const f of artifacts) {
    if (existsSync(f)) rmSync(f);
  }
});

describe("build release", () => {
  it("builds chrome target", { timeout: TIMEOUT }, () => {
    execFileSync("node", [buildScript, "--target=chrome"], { stdio: "pipe" });
    expect(existsSync("dist/correctly/manifest.json")).toBe(true);
  });

  it("builds firefox target", { timeout: TIMEOUT }, () => {
    execFileSync("node", [buildScript, "--target=firefox"], { stdio: "pipe" });
    expect(existsSync("dist/correctly/manifest.json")).toBe(true);
  });
});
