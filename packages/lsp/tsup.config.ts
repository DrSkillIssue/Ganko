import { defineConfig } from "tsup";

const BUNDLED_DEPS = [
  "@drskillissue/ganko",
  "@drskillissue/ganko-shared",
  "vscode-languageserver",
  "vscode-languageserver-textdocument",
  "@typescript-eslint/parser",
  "@typescript-eslint/project-service",
  "@typescript-eslint/utils",
  "@typescript-eslint/typescript-estree",
  "@typescript-eslint/scope-manager",
  "@typescript-eslint/types",
  "@typescript-eslint/visitor-keys",
  "typescript",
  "eslint",
  "zod",
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
]);
