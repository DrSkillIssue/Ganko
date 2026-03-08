/**
 * ESLint Plugin
 *
 * Aggregates all ganko rule engines (Solid, CSS, cross-file) into
 * a single ESLint plugin. Each plugin directory owns its own ESLint
 * adapter; this module merges their rules and builds configs.
 *
 * @example
 * ```js
 * // eslint.config.mjs
 * import solid from "ganko/eslint-plugin"
 *
 * export default [
 *   ...solid.configs.recommended,
 * ]
 * ```
 */
import type { TSESLint } from "@typescript-eslint/utils"
import type { RuleModule } from "./eslint-adapter"
import { eslintRules as solidRules, rules as solidRuleList } from "./solid/eslint-plugin"
import { eslintRules as cssRules, rules as cssRuleList } from "./css/eslint-plugin"
import { eslintRules as crossFileRules, rules as crossFileRuleList } from "./cross-file/eslint-plugin"
import { SOLID_EXTENSIONS, CSS_EXTENSIONS, extensionsToGlobs } from "@ganko/shared"

/** Merge all rule modules into a single record. */
const allRules: Record<string, RuleModule> = {
  ...solidRules,
  ...cssRules,
  ...crossFileRules,
}

interface SolidLintPlugin {
  readonly meta: { readonly name: string; readonly version: string }
  readonly rules: Record<string, RuleModule>
  readonly configs: Record<string, TSESLint.FlatConfig.ConfigArray>
}

const configs: Record<string, TSESLint.FlatConfig.ConfigArray> = {}

const plugin: SolidLintPlugin = {
  meta: {
    name: "eslint-plugin-ganko",
    version: "0.1.0",
  },
  rules: allRules,
  configs,
}

function buildRuleConfig(
  ruleList: readonly { readonly id: string; readonly severity: string }[],
): Partial<Record<string, TSESLint.SharedConfig.RuleEntry>> {
  const out: Partial<Record<string, TSESLint.SharedConfig.RuleEntry>> = {}
  for (let i = 0; i < ruleList.length; i++) {
    const r = ruleList[i]
    if (!r) continue
    out[`solid/${r.id}`] = r.severity === "off" ? "off" : r.severity === "warn" ? "warn" : "error"
  }
  return out
}

const solidOnlyRules = buildRuleConfig(solidRuleList)
const cssOnlyRules = buildRuleConfig(cssRuleList)
const crossFileOnlyRules = buildRuleConfig(crossFileRuleList)

const tsFiles = extensionsToGlobs(SOLID_EXTENSIONS)
const cssFiles = extensionsToGlobs(CSS_EXTENSIONS)

plugin.configs["recommended"] = [
  {
    plugins: { solid: plugin },
    files: tsFiles,
    rules: solidOnlyRules,
  },
  {
    plugins: { solid: plugin },
    files: cssFiles,
    rules: cssOnlyRules,
  },
  {
    plugins: { solid: plugin },
    files: [...tsFiles, ...cssFiles],
    rules: crossFileOnlyRules,
  },
]

export default plugin
