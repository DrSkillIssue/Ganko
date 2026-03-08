/** Config with scoped ignores (NOT global — has files key alongside ignores) */
export default [
  {
    files: ["src/**/*.ts"],
    ignores: ["src/generated/**"],
    rules: {
      "solid/signal-call": "warn",
    },
  },
];
