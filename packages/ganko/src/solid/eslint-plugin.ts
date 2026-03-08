/**
 * Solid ESLint Plugin Adapter
 *
 * Bridges ganko's Solid rules into ESLint's plugin format.
 * The SolidGraph is built once per file and cached via WeakMap on
 * SourceCode (unique per file per lint run).
 */
import { SolidGraph } from "./impl"
import { runPhases } from "./phases"
import { rules } from "./rules"
import { createCachedPluginAdapter, buildSolidInputFromContext } from "../eslint-adapter"

/** All Solid rules as ESLint RuleModules, keyed by rule ID. */
export const { eslintRules } = createCachedPluginAdapter(rules, (context) => {
  const input = buildSolidInputFromContext(context)
  const graph = new SolidGraph(input)
  runPhases(graph, input)
  return graph
})

/** Solid rules array for config generation. */
export { rules }
