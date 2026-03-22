/**
 * Scoped selector index type + construction (Phase 6 adds buildScopedSelectorIndex).
 */
import type { SelectorSymbol } from "../symbols/selector"
import type { SymbolTable } from "../symbols/symbol-table"

export interface ScopedSelectorIndex {
  readonly byDispatchKey: ReadonlyMap<string, readonly SelectorSymbol[]>
  readonly byTagName: ReadonlyMap<string, readonly SelectorSymbol[]>
  readonly requirements: {
    readonly needsClassTokens: boolean
    readonly needsAttributes: boolean
  }
}

export function buildScopedSelectorIndex(
  scopedCSSFiles: readonly string[],
  symbolTable: SymbolTable,
): ScopedSelectorIndex {
  if (scopedCSSFiles.length === 0) {
    return {
      byDispatchKey: new Map(),
      byTagName: new Map(),
      requirements: { needsClassTokens: false, needsAttributes: false },
    }
  }

  const scopedSet = new Set<string>(scopedCSSFiles)
  const byDispatchKeyMut = new Map<string, SelectorSymbol[]>()
  const byTagNameMut = new Map<string, SelectorSymbol[]>()
  let needsClassTokens = false
  let needsAttributes = false

  for (const [, symbol] of symbolTable.selectors) {
    if (symbol.filePath === null || !scopedSet.has(symbol.filePath)) continue

    const matcher = symbol.compiledMatcher
    if (matcher === null) continue

    if (matcher.requirements.needsClassTokens) needsClassTokens = true
    if (matcher.requirements.needsAttributes) needsAttributes = true

    const dispatchKeys = symbol.dispatchKeys
    for (let i = 0; i < dispatchKeys.length; i++) {
      const key = dispatchKeys[i]
      if (key === undefined) continue
      const existing = byDispatchKeyMut.get(key)
      if (existing !== undefined) {
        existing.push(symbol)
      } else {
        byDispatchKeyMut.set(key, [symbol])
      }
    }

    if (matcher.subjectTag !== null) {
      const tag = matcher.subjectTag
      const existing = byTagNameMut.get(tag)
      if (existing !== undefined) {
        existing.push(symbol)
      } else {
        byTagNameMut.set(tag, [symbol])
      }
    }
  }

  return {
    byDispatchKey: byDispatchKeyMut,
    byTagName: byTagNameMut,
    requirements: { needsClassTokens, needsAttributes },
  }
}
