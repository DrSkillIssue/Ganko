/**
 * Solid ESLint Plugin Adapter
 *
 * Bridges ganko's Solid rules into ESLint's plugin format.
 * The SolidSyntaxTree is built once per file and cached via WeakMap on
 * SourceCode (unique per file per lint run).
 */
import { buildSolidSyntaxTree } from "./impl"
import { rules } from "./rules"
import { createCachedPluginAdapter, buildSolidInputFromContext } from "../eslint-adapter"

/** All Solid rules as ESLint RuleModules, keyed by rule ID. */
export const { eslintRules } = createCachedPluginAdapter(rules, (context) => {
  const input = buildSolidInputFromContext(context)
  return buildSolidSyntaxTree(input, "")
})
