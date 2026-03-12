/** Config with a non-standard boolean rule value from another plugin.
 * This must NOT cause ganko rule overrides to be silently dropped. */
export default [
  {
    rules: {
      "some-plugin/weird-rule": true,
      "solid/signal-call": "warn",
    },
  },
];
