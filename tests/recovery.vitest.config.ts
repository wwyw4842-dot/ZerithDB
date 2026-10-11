import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "zerithdb-core": resolve(__dirname, "../packages/core/src/index.ts"),
      "zerithdb-errors": resolve(__dirname, "../packages/errors/src/index.ts"),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "happy-dom",
    include: ["packages/auth/src/*.test.ts", "apps/web/src/components/social-recovery.test.ts"],
  },
});
