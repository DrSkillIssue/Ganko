import { createDiagnosticFromLoc, resolveMessage } from "../../diagnostic"
import { normalizeAnimationName } from "../../css/parser/value-util"
import { splitTopLevelComma, splitTopLevelWhitespace } from "../../css/parser/value-tokenizer"
import { isAnimationKeywordToken } from "../../css/parser/animation-transition-keywords"
import { defineCrossRule } from "../rule"

const messages = {
  animationLayoutProperty:
    "Animation '{{animation}}' mutates layout-affecting '{{property}}', which can trigger CLS. Prefer transform/opacity or reserve geometry.",
} as const

export const cssLayoutAnimationLayoutProperty = defineCrossRule({
  id: "css-layout-animation-layout-property",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow keyframe animations that mutate layout-affecting properties and can trigger CLS.",
    fixable: false,
    category: "css-layout",
  },
  check(context, emit) {
    const riskyKeyframes = context.css.keyframeLayoutMutationsByName
    if (riskyKeyframes.size === 0) return

    const declarations = context.css.declarationsForProperties("animation", "animation-name")
    for (let i = 0; i < declarations.length; i++) {
      const declaration = declarations[i]
      if (!declaration) continue
      if (declaration.rule === null) continue

      const property = declaration.property.toLowerCase()
      const names = property === "animation"
        ? parseAnimationShorthandNames(declaration.value, riskyKeyframes)
        : parseAnimationNameList(declaration.value)
      if (names.length === 0) continue

      const match = firstRiskyAnimationName(names, riskyKeyframes)
      if (!match) continue

      emit(
        createDiagnosticFromLoc(
          declaration.file.path,
          {
            start: { line: declaration.startLine, column: declaration.startColumn },
            end: { line: declaration.startLine, column: declaration.startColumn + declaration.property.length },
          },
          cssLayoutAnimationLayoutProperty.id,
          "animationLayoutProperty",
          resolveMessage(messages.animationLayoutProperty, {
            animation: match.name,
            property: match.property,
          }),
          "warn",
        ),
      )
    }
  },
})

function parseAnimationNameList(raw: string): readonly string[] {
  const parts = splitTopLevelComma(raw)
  const out: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    const name = normalizeAnimationName(part)
    if (!name) continue
    if (name === "none") continue
    out.push(name)
  }

  return out
}

function parseAnimationShorthandNames(
  raw: string,
  riskyKeyframes: ReadonlyMap<string, readonly { readonly property: string }[]>,
): readonly string[] {
  const parts = splitTopLevelComma(raw)
  const out: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    const name = parseAnimationLayerName(part, riskyKeyframes)
    if (!name) continue
    out.push(name)
  }

  return out
}

function parseAnimationLayerName(
  layer: string,
  riskyKeyframes: ReadonlyMap<string, readonly { readonly property: string }[]>,
): string | null {
  const parts = splitTopLevelWhitespace(layer.trim().toLowerCase())
  const candidates: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    const token = normalizeAnimationName(part)
    if (!token) continue
    if (isAnimationKeyword(token)) continue

    if (riskyKeyframes.has(token)) return token
    candidates.push(token)
  }

  if (candidates.length === 1) return candidates[0] ?? null
  return null
}

function isAnimationKeyword(token: string): boolean {
  return isAnimationKeywordToken(token)
}

function firstRiskyAnimationName(
  names: readonly string[],
  riskyKeyframes: ReadonlyMap<string, readonly { readonly property: string }[]>,
): { name: string; property: string } | null {
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    if (!name) continue
    const mutations = riskyKeyframes.get(name)
    if (!mutations || mutations.length === 0) continue
    const firstMutation = mutations[0]
    if (!firstMutation) continue
    return {
      name,
      property: firstMutation.property,
    }
  }
  return null
}
