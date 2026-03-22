/**
 * Tier resolver — inspects registered rules to determine maximum required computation tier.
 */
import type { AnalysisRule } from "./rule"
import { ComputationTier } from "./rule"
import type { CollectedActions } from "./registry"

export function resolveMaxTier(rules: readonly AnalysisRule[]): ComputationTier {
  let max: ComputationTier = ComputationTier.CSSSyntax

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (!rule) continue
    if (rule.severity === "off") continue
    if (rule.requirement.tier > max) max = rule.requirement.tier
  }

  return max
}

export function resolveRequiredTierFromActions(actions: CollectedActions): ComputationTier {
  if (actions.alignment.length > 0) return ComputationTier.AlignmentModel
  if (actions.cascade.length > 0 || actions.conditionalDelta.length > 0) return ComputationTier.FullCascade
  if (actions.factThunks.length > 0) return ComputationTier.SelectiveLayoutFacts
  if (actions.element.length > 0) return ComputationTier.ElementResolution
  if (actions.crossSyntax.length > 0 || actions.symbolThunks.length > 0) return ComputationTier.CrossSyntax
  if (actions.cssSyntax.length > 0) return ComputationTier.CSSSyntax
  return ComputationTier.CSSSyntax
}
