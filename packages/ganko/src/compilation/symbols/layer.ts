import type { AtRuleEntity } from "../../css/entities/at-rule"

export interface LayerSymbol {
  readonly symbolKind: "layer"
  readonly name: string
  readonly filePath: string | null
  readonly entity: AtRuleEntity
  readonly order: number
}

export function createLayerSymbol(
  entity: AtRuleEntity,
  name: string,
  filePath: string,
  order: number,
): LayerSymbol {
  return {
    symbolKind: "layer",
    name,
    filePath,
    entity,
    order,
  }
}
