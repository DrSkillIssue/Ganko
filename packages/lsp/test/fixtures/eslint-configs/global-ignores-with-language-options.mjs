/** Config object with ignores AND languageOptions.
 * Per ESLint semantics this is NOT a global-ignores-only entry —
 * languageOptions makes it a scoped config. */
export default [
  {
    ignores: ["vendor/**"],
    languageOptions: { ecmaVersion: 2024 },
  },
  {
    rules: {
      "solid/signal-call": "warn",
    },
  },
];
