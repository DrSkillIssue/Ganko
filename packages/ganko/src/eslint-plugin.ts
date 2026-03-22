/**
 * ESLint Plugin
 *
 * Aggregates ganko rule engines (Solid, CSS) into a single ESLint plugin.
 */
import type { TSESLint } from "@typescript-eslint/utils"
import type { RuleModule } from "./eslint-adapter"
import { eslintRules as solidRules } from "./solid/eslint-plugin"
import { rules as solidRuleList } from "./solid/rules"
import { eslintRules as cssRules } from "./css/eslint-plugin"
import { rules as cssRuleList } from "./css/rules"
import { SOLID_EXTENSIONS, CSS_EXTENSIONS, extensionsToGlobs } from "@drskillissue/ganko-shared"

const allRules: Record<string, RuleModule> = {
  ...solidRules,
  ...cssRules,
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
]

export default plugin
