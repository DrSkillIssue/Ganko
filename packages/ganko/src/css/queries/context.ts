import type { RuleEntity, AtRuleEntity } from "../entities";
import type { AtRuleKind } from "../entities";

type CSSParentNode = RuleEntity | AtRuleEntity | null;

export function getContainingAtRule(rule: RuleEntity, kind: AtRuleKind): AtRuleEntity | null {
  let current: CSSParentNode = rule.parent;
  while (current) {
    if (current.kind === kind) return current;
    current = current.parent;
  }
  return null;
}

export function getAtRuleAncestry(rule: RuleEntity): readonly AtRuleEntity[] {
  const ancestry: AtRuleEntity[] = [];
  let current: CSSParentNode = rule.parent;
  while (current) {
    if (current.kind !== "rule") ancestry.push(current);
    current = current.parent;
  }
  return ancestry;
}
