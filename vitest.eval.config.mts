import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live evals: call real models, so they're kept out of `pnpm test`.
// Run with `pnpm eval:specialists` (needs ANTHROPIC_API_KEY).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.eval.ts"],
    testTimeout: 300_000,
  },
});
