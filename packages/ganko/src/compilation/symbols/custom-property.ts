import type { VariableEntity, VariableReferenceEntity } from "../../css/entities/variable"
import { hasFlag, VAR_IS_GLOBAL, VAR_IS_SCSS } from "../../css/entities"

export interface CustomPropertySymbol {
  readonly symbolKind: "customProperty"
  readonly name: string
  readonly filePath: string | null
  readonly entity: VariableEntity
  readonly isGlobal: boolean
  readonly isScss: boolean
  readonly references: readonly VariableReferenceEntity[]
  readonly resolvedValue: string | null
}

export function createCustomPropertySymbol(
  entity: VariableEntity,
  filePath: string,
): CustomPropertySymbol {
  return {
    symbolKind: "customProperty",
    name: entity.name,
    filePath,
    entity,
    isGlobal: hasFlag(entity._flags, VAR_IS_GLOBAL),
    isScss: hasFlag(entity._flags, VAR_IS_SCSS),
    references: [], // Phase 5+: cross-file reference wiring happens during semantic model binding
    resolvedValue: entity.computedValue ?? null,
  }
}
