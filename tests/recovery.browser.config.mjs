import { aliases, root } from "./recovery-harness/aliases.mjs";
export default {
  root: `${root}/apps/web`,
  esbuild: { jsx: "automatic" },
  resolve: { alias: aliases },
  server: { fs: { allow: [root] } },
};
