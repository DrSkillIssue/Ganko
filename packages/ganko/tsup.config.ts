import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "rules-manifest": "src/rules-manifest.ts",
    "eslint-plugin": "src/eslint-plugin.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "@typescript-eslint/parser",
    "@typescript-eslint/typescript-estree",
    "@typescript-eslint/utils",
    "postcss",
    "postcss-safe-parser",
    "postcss-scss",
    "postcss-value-parser",
    "typescript",
    "zod",
  ],
})
