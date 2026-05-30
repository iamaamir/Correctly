import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e-playwright",
  timeout: 120000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  reporter: "list",
});
