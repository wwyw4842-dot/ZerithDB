import { defineConfig } from "vitest/config";
import { aliases, root } from "./aliases.mjs";

export default defineConfig({
  root,
  resolve: { alias: aliases },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "happy-dom",
    include: ["packages/auth/src/*.test.ts", "apps/web/src/components/social-recovery.test.ts"],
  },
});
