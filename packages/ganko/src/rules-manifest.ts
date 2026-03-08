/**
 * Standalone re-export of the generated rules manifest.
 *
 * Consumers that only need rule metadata (VS Code extension, docs, config
 * generators) can import from "@drskillissue/ganko/rules-manifest" to avoid pulling
 * in the full analysis engine and its heavy dependencies.
 */
export {
  RULES,
  RULES_BY_CATEGORY,
  RULE_CATEGORIES,
  getRule,
} from "./generated/rules-manifest"

export type { RuleEntry } from "./generated/rules-manifest"
