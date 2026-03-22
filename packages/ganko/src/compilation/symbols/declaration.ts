import type { DeclarationEntity } from "../../css/entities/declaration"

export interface DeclarationSymbol {
  readonly symbolKind: "declaration"
  readonly name: string
  readonly filePath: string | null
  readonly entity: DeclarationEntity
  readonly sourceOrder: number
  readonly layerOrder: number
}

export function createDeclarationSymbol(
  entity: DeclarationEntity,
  filePath: string,
  sourceOrder: number,
  layerOrder: number,
): DeclarationSymbol {
  return {
    symbolKind: "declaration",
    name: entity.property,
    filePath,
    entity,
    sourceOrder,
    layerOrder,
  }
}
