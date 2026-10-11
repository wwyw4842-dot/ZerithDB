import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
const dependencies = [
  "vitest",
  "@noble/ed25519",
  "@noble/hashes/sha2.js",
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/server",
  "react-dom/client",
  "framer-motion",
  "lucide-react",
];
export const aliases = [
  { find: "zerithdb-core", replacement: `${root}/packages/core/src/index.ts` },
  { find: "zerithdb-errors", replacement: `${root}/packages/errors/src/index.ts` },
  ...dependencies.map((name) => ({
    find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: fileURLToPath(import.meta.resolve(name)),
  })),
];
