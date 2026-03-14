import type { AtRuleEntity, RuleEntity } from "../../css/entities"

export type LayoutGuardConditionKind = "media" | "supports" | "container"

export interface LayoutGuardConditionProvenance {
  readonly kind: LayoutGuardConditionKind
  readonly query: string | null
  readonly key: string
}

export type LayoutRuleGuard =
  | {
    readonly kind: "unconditional"
    readonly conditions: readonly LayoutGuardConditionProvenance[]
    readonly key: "always"
  }
  | {
    readonly kind: "conditional"
    readonly conditions: readonly LayoutGuardConditionProvenance[]
    readonly key: string
  }

const UNCONDITIONAL_GUARD: LayoutRuleGuard = {
  kind: "unconditional",
  conditions: [],
  key: "always",
}

const WHITESPACE_RE_GLOBAL = /\s+/g

export function resolveRuleGuard(rule: RuleEntity): LayoutRuleGuard {
  const conditions = collectRuleConditions(rule)
  if (conditions.length === 0) return UNCONDITIONAL_GUARD

  return {
    kind: "conditional",
    conditions,
    key: conditions.map((condition) => condition.key).join("&"),
  }
}

function collectRuleConditions(rule: RuleEntity): readonly LayoutGuardConditionProvenance[] {
  const out: LayoutGuardConditionProvenance[] = []
  const seenKeys = new Set<string>()

  function pushCondition(condition: LayoutGuardConditionProvenance): void {
    if (seenKeys.has(condition.key)) return
    seenKeys.add(condition.key)
    out.push(condition)
  }

  if (rule.containingMedia !== null) {
    const mediaCondition = toGuardCondition(rule.containingMedia)
    if (mediaCondition !== null) pushCondition(mediaCondition)
  }

  let current: RuleEntity["parent"] = rule.parent
  while (current !== null) {
    if (current.kind === "rule") {
      current = current.parent
      continue
    }

    const condition = toGuardCondition(current)
    if (condition !== null) pushCondition(condition)
    current = current.parent
  }

  if (out.length === 0) return []
  out.sort(compareGuardCondition)
  return out
}

function toGuardCondition(atRule: AtRuleEntity): LayoutGuardConditionProvenance | null {
  if (atRule.kind === "media") {
    return buildCondition("media", atRule.params)
  }
  if (atRule.kind === "supports") {
    return buildCondition("supports", atRule.params)
  }
  if (atRule.kind === "container") {
    return buildCondition("container", atRule.parsedParams.containerCondition ?? atRule.params)
  }
  return null
}

function buildCondition(kind: LayoutGuardConditionKind, query: string | null): LayoutGuardConditionProvenance {
  const normalized = normalizeQuery(query)
  const normalizedKey = normalized === null ? "*" : normalized

  return {
    kind,
    query,
    key: `${kind}:${normalizedKey}`,
  }
}

function normalizeQuery(query: string | null): string | null {
  if (query === null) return null
  const normalized = query.trim().toLowerCase().replace(WHITESPACE_RE_GLOBAL, " ")
  if (normalized.length === 0) return null
  return normalized
}

function compareGuardCondition(left: LayoutGuardConditionProvenance, right: LayoutGuardConditionProvenance): number {
  if (left.key < right.key) return -1
  if (left.key > right.key) return 1
  return 0
}
