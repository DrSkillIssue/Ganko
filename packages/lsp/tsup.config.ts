import { defineConfig } from "tsup";

const BUNDLED_DEPS = [
  "@drskillissue/ganko",
  "@drskillissue/ganko-shared",
  "vscode-languageserver",
  "vscode-languageserver-textdocument",
  "typescript",
  "zod",
  "ignore",
] as const;

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    noExternal: [...BUNDLED_DEPS],
    external: ["jiti"],
  },
  {
    entry: ["src/cli/entry.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    noExternal: [...BUNDLED_DEPS],
    external: ["jiti"],
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: ["src/cli/lint-worker.ts"],
    format: ["cjs"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    noExternal: [...BUNDLED_DEPS],
    external: ["jiti"],
  },
]);
