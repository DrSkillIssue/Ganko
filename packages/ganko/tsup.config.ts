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
    "postcss",
    "postcss-safe-parser",
    "postcss-scss",
    "postcss-value-parser",
    "typescript",
    "zod",
  ],
})
