import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    exclude: ["**/node_modules/**", "**/.git/**", "tests/benchmark/**"],
    restoreMocks: false,
    clearMocks: true,
    mockReset: false,
  },
});
