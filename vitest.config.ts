import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "services/**/*.test.ts",
      "app/**/*.test.ts",
      "extensions/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    // DB tests share one database; run files one at a time
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
