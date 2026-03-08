/**
 * Simulates solid.configs.recommended spread plus a user override.
 *
 * signal-call and no-banner-comments are set to their manifest default ("error")
 * and should be filtered out of overrides. derived-signal is set to "warn"
 * (differs from default "error") and should be kept. missing-jsdoc-comments
 * is set to "off" (differs from default "error") and should be kept.
 */
export default [
  {
    plugins: { solid: {} },
    files: ["**/*.tsx"],
    rules: {
      "solid/signal-call": "error",
      "solid/no-banner-comments": "error",
      "solid/derived-signal": "warn",
    },
  },
  {
    rules: {
      "solid/missing-jsdoc-comments": "off",
    },
  },
];
