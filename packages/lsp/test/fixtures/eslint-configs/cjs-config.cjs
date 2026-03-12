/** CommonJS flat config — must be loadable via importFresh.
 * Tests that .cjs extension is preserved (not renamed to .mjs). */
module.exports = [
  {
    rules: {
      "solid/signal-call": "warn",
      "solid/no-banner-comments": "off",
    },
  },
];
