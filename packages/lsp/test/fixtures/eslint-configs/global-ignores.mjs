/** Config with global ignores and a user override */
export default [
  { ignores: ["backend/**", "scripts/**"] },
  {
    rules: {
      "solid/signal-call": "warn",
    },
  },
];
