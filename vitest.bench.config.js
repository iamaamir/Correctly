import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/benchmark/**"],
    exclude: ["**/*.json", "**/*.mjs", "**/results/**"],
  },
});
