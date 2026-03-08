import type { AtRuleEntity, RuleEntity } from "../../css/entities"

export function isPositive(value: number | null): boolean {
  return value !== null && value > 0
}

export function isRuleConditional(rule: RuleEntity): boolean {
  let current: RuleEntity | AtRuleEntity | null = rule.parent

  while (current) {
    if (current.kind === "rule") {
      current = current.parent
      continue
    }

    if (current.kind === "media" || current.kind === "supports" || current.kind === "container") {
      return true
    }
    current = current.parent
  }

  return false
}
