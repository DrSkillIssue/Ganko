import type { AtRuleEntity } from "../../css/entities/at-rule"

export interface FontFaceSymbol {
  readonly symbolKind: "fontFace"
  readonly name: string
  readonly filePath: string | null
  readonly entity: AtRuleEntity
  readonly family: string
  readonly display: string | null
  readonly hasWebFontSource: boolean
  readonly hasEffectiveMetricOverrides: boolean
}

export function createFontFaceSymbol(
  entity: AtRuleEntity,
  family: string,
  filePath: string,
  display: string | null,
  hasWebFontSource: boolean,
  hasEffectiveMetricOverrides: boolean,
): FontFaceSymbol {
  return {
    symbolKind: "fontFace",
    name: family,
    filePath,
    entity,
    family,
    display,
    hasWebFontSource,
    hasEffectiveMetricOverrides,
  }
}
