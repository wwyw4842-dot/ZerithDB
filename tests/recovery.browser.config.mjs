import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export default {
  root: `${root}/apps/web`,
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "zerithdb-core": `${root}/packages/core/src/index.ts`,
      "zerithdb-errors": `${root}/packages/errors/src/index.ts`,
    },
  },
  server: { fs: { allow: [root] } },
};
