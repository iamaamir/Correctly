import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e-playwright",
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
});
