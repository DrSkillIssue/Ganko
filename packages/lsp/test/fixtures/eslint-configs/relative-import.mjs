/** Config that uses a relative import — exercises importFresh path resolution.
 * If importFresh copies the file to a different directory (e.g. tmpdir),
 * this relative import fails and the entire config is silently dropped. */
import { extraRules } from "./relative-import-helper.mjs";

export default [
  {
    rules: {
      ...extraRules,
      "solid/no-banner-comments": "off",
    },
  },
];
