// @ts-check
import path from "node:path";
// @ts-ignore
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import solid from "ganko/eslint-plugin";

const tsconfigPath = path.resolve("tsconfig.json");

export default [
  {
    ignores: [
      "**/dist/",
      "**/dist.*",
      "**/.tsup/",
      "**/.tmp/",
      "**/eslint.config.mjs",
      "**/eslint.config.js",
      "**/test/valid/",
      "**/test/fixtures/",
      "test-fixtures/",
      "test-*.mjs",
      "example/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.eslintRecommended,
  ...tseslint.configs.recommended,
  ...solid.configs.recommended,
  {
    plugins: {
      "@stylistic": stylistic,
    },
    languageOptions: {
      sourceType: "module",
      parser: tseslint.parser,
      parserOptions: {
        project: tsconfigPath,
      },
      globals: globals.node,
    },
    rules: {
      // Allow underscore prefix for intentionally unused variables
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow namespaces - they're useful for grouping related types/functions
      "@typescript-eslint/no-namespace": "off",

      // Stylistic formatting rules
      "@stylistic/semi": ["error", "always"],
      "@stylistic/quotes": ["error", "double"],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      "@stylistic/brace-style": [
        "error",
        "1tbs",
        { allowSingleLine: true },
      ],
      "@stylistic/space-before-blocks": ["error", "always"],
      "@stylistic/space-before-function-paren": [
        "error",
        { anonymous: "always", named: "never", asyncArrow: "always" },
      ],
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/keyword-spacing": ["error", { before: true, after: true }],
      "@stylistic/arrow-spacing": ["error", { before: true, after: true }],
      "@stylistic/space-infix-ops": "error",
      "@stylistic/no-trailing-spaces": "error",
    },
  },
  // Relax rules for test files
  {
    files: ["**/test/**/*.ts", "**/test/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@stylistic/comma-dangle": "off",
      "@stylistic/quotes": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "solid/avoid-non-null-assertions": "off",
      "solid/avoid-hidden-class-transition": "off",
      "solid/avoid-chained-array-methods": "off",
      "solid/jsx-uses-vars": "off",
    },
  },
  // Allow require() in view files (used for lazy loading to avoid circular dependencies)
  {
    files: ["**/graph/views/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // ganko has its own code style — disable base/stylistic rules, keep solid/ rules
  {
    files: ["packages/ganko/**/*.ts"],
    rules: {
      "@stylistic/semi": "off",
      "@stylistic/quotes": "off",
      "@stylistic/comma-dangle": "off",
      "@stylistic/brace-style": "off",
      "@stylistic/space-before-blocks": "off",
      "@stylistic/space-before-function-paren": "off",
      "@stylistic/object-curly-spacing": "off",
      "@stylistic/keyword-spacing": "off",
      "@stylistic/arrow-spacing": "off",
      "@stylistic/space-infix-ops": "off",
      "@stylistic/no-trailing-spaces": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Disable missing-jsdoc-comments for packages that haven't adopted JSDoc yet
  {
    files: ["packages/ganko/**/*.ts", "packages/lsp/**/*.ts", "packages/vscode/**/*.ts"],
    rules: {
      "solid/missing-jsdoc-comments": "off",
    },
  },
];
