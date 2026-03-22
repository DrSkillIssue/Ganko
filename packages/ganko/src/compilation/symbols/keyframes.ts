import type { AtRuleEntity } from "../../css/entities/at-rule"
import type { DeclarationEntity } from "../../css/entities/declaration"

export interface KeyframeLayoutMutation {
  readonly property: string
  readonly values: readonly string[]
  readonly declarations: readonly DeclarationEntity[]
}

export interface KeyframesSymbol {
  readonly symbolKind: "keyframes"
  readonly name: string
  readonly filePath: string | null
  readonly entity: AtRuleEntity
  readonly layoutMutations: readonly KeyframeLayoutMutation[]
}

export function createKeyframesSymbol(
  entity: AtRuleEntity,
  name: string,
  filePath: string,
  layoutMutations: readonly KeyframeLayoutMutation[],
): KeyframesSymbol {
  return {
    symbolKind: "keyframes",
    name,
    filePath,
    entity,
    layoutMutations,
  }
}
