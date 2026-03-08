/**
 * CSS ESLint Plugin Adapter
 *
 * Bridges ganko's CSS rules into ESLint's plugin format.
 * The CSSGraph is built once per file and cached via WeakMap on SourceCode.
 */
import type { CSSInput } from "./input"
import { buildCSSGraph } from "./plugin"
import { rules } from "./rules"
import { createCachedPluginAdapter } from "../eslint-adapter"

/** All CSS rules as ESLint RuleModules, keyed by rule ID. */
export const { eslintRules } = createCachedPluginAdapter(rules, (context) => {
  const input: CSSInput = {
    files: [{ path: context.filename, content: context.sourceCode.getText() }],
  }
  return buildCSSGraph(input)
})

/** CSS rules array for config generation. */
export { rules }
