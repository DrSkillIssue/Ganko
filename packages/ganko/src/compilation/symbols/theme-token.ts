import type { ThemeTokenEntity } from "../../css/entities/token"

export interface ThemeTokenSymbol {
  readonly symbolKind: "themeToken"
  readonly name: string
  readonly filePath: string | null
  readonly entity: ThemeTokenEntity
  readonly category: string
}

export function createThemeTokenSymbol(
  entity: ThemeTokenEntity,
  filePath: string,
): ThemeTokenSymbol {
  return {
    symbolKind: "themeToken",
    name: entity.name,
    filePath,
    entity,
    category: entity.category,
  }
}
