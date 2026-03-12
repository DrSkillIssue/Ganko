/** Config that exports a function instead of an array/object.
 * Webpack-style config factories are NOT valid ESLint flat config.
 * Zod validation must reject this gracefully (return EMPTY_ESLINT_RESULT). */
export default function createConfig() {
  return [
    {
      rules: {
        "solid/signal-call": "warn",
      },
    },
  ];
}
