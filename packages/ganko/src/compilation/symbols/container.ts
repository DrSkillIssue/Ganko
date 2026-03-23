import type { DeclarationEntity } from "../../css/entities/declaration"
import type { AtRuleEntity } from "../../css/entities/at-rule"

export interface ContainerSymbol {
  readonly symbolKind: "container"
  readonly name: string
  readonly filePath: string | null
  readonly declarations: readonly DeclarationEntity[]
  readonly queries: readonly AtRuleEntity[]
}

export function createContainerSymbol(
  name: string,
  declarations: readonly DeclarationEntity[],
  queries: readonly AtRuleEntity[],
): ContainerSymbol {
  return {
    symbolKind: "container",
    name,
    filePath: null, // null because containers span multiple files (declarations and queries may be in different files)
    declarations,
    queries,
  }
}
