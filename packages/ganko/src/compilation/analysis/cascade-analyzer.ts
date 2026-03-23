/**
 * Conditional delta types + computation.
 *
 * Moved from cross-file/layout/cascade-builder.ts buildConditionalDeltaIndex.
 */
import { splitWhitespaceTokens } from "../../css/parser/value-tokenizer"
import type { ElementNode } from "../binding/element-builder"
import type { ElementCascade, MonitoredDeclaration } from "../binding/cascade-binder"
import { SignalGuardKind } from "../binding/cascade-binder"
import type { LayoutSignalName } from "../binding/signal-builder"
import { layoutOffsetSignals, parseOffsetPx } from "./alignment"
import type { SymbolTable } from "../symbols/symbol-table"

export interface ConditionalSignalDelta {
  readonly hasConditional: boolean
  readonly hasDelta: boolean
  readonly conditionalValues: readonly string[]
  readonly unconditionalValues: readonly string[]
  readonly hasConditionalScrollValue: boolean
  readonly hasConditionalNonScrollValue: boolean
  readonly hasUnconditionalScrollValue: boolean
  readonly hasUnconditionalNonScrollValue: boolean
}

export interface ConditionalDeltaIndex {
  readonly deltaByElementId: ReadonlyMap<number, ReadonlyMap<LayoutSignalName, ConditionalSignalDelta>>
  readonly elementsWithDeltaBySignal: ReadonlyMap<LayoutSignalName, readonly ElementNode[]>
  readonly baselineOffsetsByElementId: ReadonlyMap<number, ReadonlyMap<LayoutSignalName, readonly number[]>>
}

const SCROLLABLE_VALUES: ReadonlySet<string> = new Set(["auto", "scroll"])

export function computeConditionalDelta(
  elements: readonly ElementNode[],
  cascadeByElementId: ReadonlyMap<number, ElementCascade>,
  monitoredDeclarationsBySelectorId: ReadonlyMap<number, readonly MonitoredDeclaration[]>,
  symbolTable: SymbolTable,
): ConditionalDeltaIndex {
  const deltaByElementId = new Map<number, ReadonlyMap<LayoutSignalName, ConditionalSignalDelta>>()
  const elementsWithDeltaBySignal = new Map<LayoutSignalName, ElementNode[]>()
  const baselineOffsetsByElementId = new Map<number, ReadonlyMap<LayoutSignalName, readonly number[]>>()

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue

    const cascade = cascadeByElementId.get(node.elementId)
    const edges = cascade?.edges
    let factByProperty: ReadonlyMap<LayoutSignalName, ConditionalSignalDelta> | null = null

    if (edges !== undefined && edges.length > 0) {
      const byProperty = new Map<LayoutSignalName, { conditional: Set<string>; unconditional: Set<string> }>()
      let conditionalAttributeDispatch: Map<LayoutSignalName, Map<string, string>> | null = null

      for (let j = 0; j < edges.length; j++) {
        const currentEdge = edges[j]
        if (!currentEdge) continue
        const declarations = monitoredDeclarationsBySelectorId.get(currentEdge.selectorId)
        if (!declarations) continue

        let conditionalAttributeName: string | null = null
        if (currentEdge.conditionalMatch) {
          conditionalAttributeName = identifyConditionalAttribute(currentEdge.selectorId, node, symbolTable)
        }

        for (let k = 0; k < declarations.length; k++) {
          const declaration = declarations[k]
          if (!declaration) continue
          const property = declaration.property
          const value = declaration.value.trim().toLowerCase()

          let bucket = byProperty.get(property)
          if (!bucket) {
            bucket = { conditional: new Set<string>(), unconditional: new Set<string>() }
            byProperty.set(property, bucket)
          }

          if (declaration.guardProvenance.kind === SignalGuardKind.Conditional || currentEdge.conditionalMatch) {
            bucket.conditional.add(value)
            if (conditionalAttributeName !== null && declaration.guardProvenance.kind !== SignalGuardKind.Conditional) {
              if (conditionalAttributeDispatch === null) conditionalAttributeDispatch = new Map()
              let dispatchMap = conditionalAttributeDispatch.get(property)
              if (!dispatchMap) {
                dispatchMap = new Map()
                conditionalAttributeDispatch.set(property, dispatchMap)
              }
              dispatchMap.set(value, conditionalAttributeName)
            }
            continue
          }
          bucket.unconditional.add(value)
        }
      }

      if (byProperty.size > 0) {
        const facts = new Map<LayoutSignalName, ConditionalSignalDelta>()
        for (const [property, bucket] of byProperty) {
          const unconditionalValues = [...bucket.unconditional]
          const conditionalValues = [...bucket.conditional]
          const hasConditional = conditionalValues.length > 0
          if (!hasConditional) continue

          let hasDelta = unconditionalValues.length === 0
          if (!hasDelta) {
            for (let k = 0; k < conditionalValues.length; k++) {
              const condVal = conditionalValues[k]
              if (condVal === undefined) continue
              if (!bucket.unconditional.has(condVal)) {
                hasDelta = true
                break
              }
            }
          }

          if (hasDelta && conditionalAttributeDispatch !== null) {
            const dispatchMap = conditionalAttributeDispatch.get(property)
            if (dispatchMap !== undefined && dispatchMap.size === conditionalValues.length) {
              let singleAttribute: string | null = null
              let allSameAttribute = true
              for (const attrName of dispatchMap.values()) {
                if (singleAttribute === null) {
                  singleAttribute = attrName
                } else if (singleAttribute !== attrName) {
                  allSameAttribute = false
                  break
                }
              }
              if (allSameAttribute && singleAttribute !== null) {
                hasDelta = false
              }
            }
          }

          const scrollProfile = buildScrollValueProfile(property, conditionalValues, unconditionalValues)

          facts.set(property, {
            hasConditional,
            hasDelta,
            conditionalValues,
            unconditionalValues,
            hasConditionalScrollValue: scrollProfile.hasConditionalScrollValue,
            hasConditionalNonScrollValue: scrollProfile.hasConditionalNonScrollValue,
            hasUnconditionalScrollValue: scrollProfile.hasUnconditionalScrollValue,
            hasUnconditionalNonScrollValue: scrollProfile.hasUnconditionalNonScrollValue,
          })
        }

        if (facts.size > 0) {
          factByProperty = facts
          deltaByElementId.set(node.elementId, facts)

          for (const [signal, fact] of facts) {
            if (!fact.hasConditional) continue
            const existing = elementsWithDeltaBySignal.get(signal)
            if (existing) {
              existing.push(node)
              continue
            }
            elementsWithDeltaBySignal.set(signal, [node])
          }
        }
      }
    }

    const baselineBySignal = new Map<LayoutSignalName, readonly number[]>()
    for (let j = 0; j < layoutOffsetSignals.length; j++) {
      const signal = layoutOffsetSignals[j]
      if (!signal) continue
      const values = new Set<number>()
      const conditionalFact = factByProperty?.get(signal)

      if (conditionalFact) {
        for (let k = 0; k < conditionalFact.unconditionalValues.length; k++) {
          const uncondVal = conditionalFact.unconditionalValues[k]
          if (uncondVal === undefined) continue
          const px = parseOffsetPx(signal, uncondVal)
          if (px === null) continue
          values.add(px)
        }
      }

      const inlineValue = node.inlineStyleValues.get(signal)
      if (inlineValue) {
        const inlinePx = parseOffsetPx(signal, inlineValue)
        if (inlinePx !== null) values.add(inlinePx)
      }

      if (values.size === 0) continue
      baselineBySignal.set(signal, [...values])
    }

    if (baselineBySignal.size > 0) {
      baselineOffsetsByElementId.set(node.elementId, baselineBySignal)
    }
  }

  return {
    deltaByElementId,
    elementsWithDeltaBySignal,
    baselineOffsetsByElementId,
  }
}

function identifyConditionalAttribute(
  selectorId: number,
  node: ElementNode,
  symbolTable: SymbolTable,
): string | null {
  const symbol = symbolTable.selectors.get(selectorId)
  if (!symbol) return null

  const selector = symbol.entity
  const constraints = selector.anchor.attributes
  let dynamicAttributeName: string | null = null

  for (let i = 0; i < constraints.length; i++) {
    const constraint = constraints[i]
    if (!constraint) continue
    if (constraint.operator !== "equals") continue
    if (constraint.value === null) continue

    const elementValue = node.attributes.get(constraint.name)
    if (elementValue !== null) continue
    if (dynamicAttributeName !== null && dynamicAttributeName !== constraint.name) {
      return null
    }
    dynamicAttributeName = constraint.name
  }

  return dynamicAttributeName
}

function buildScrollValueProfile(
  property: LayoutSignalName,
  conditionalValues: readonly string[],
  unconditionalValues: readonly string[],
): {
  hasConditionalScrollValue: boolean
  hasConditionalNonScrollValue: boolean
  hasUnconditionalScrollValue: boolean
  hasUnconditionalNonScrollValue: boolean
} {
  if (property !== "overflow" && property !== "overflow-y") {
    return {
      hasConditionalScrollValue: false,
      hasConditionalNonScrollValue: false,
      hasUnconditionalScrollValue: false,
      hasUnconditionalNonScrollValue: false,
    }
  }

  let hasConditionalScrollValue = false
  let hasConditionalNonScrollValue = false
  let hasUnconditionalScrollValue = false
  let hasUnconditionalNonScrollValue = false

  for (let i = 0; i < conditionalValues.length; i++) {
    const condVal = conditionalValues[i]
    if (condVal === undefined) continue
    if (containsScrollToken(condVal)) {
      hasConditionalScrollValue = true
      continue
    }
    hasConditionalNonScrollValue = true
  }

  for (let i = 0; i < unconditionalValues.length; i++) {
    const uncondVal = unconditionalValues[i]
    if (uncondVal === undefined) continue
    if (containsScrollToken(uncondVal)) {
      hasUnconditionalScrollValue = true
      continue
    }
    hasUnconditionalNonScrollValue = true
  }

  return {
    hasConditionalScrollValue,
    hasConditionalNonScrollValue,
    hasUnconditionalScrollValue,
    hasUnconditionalNonScrollValue,
  }
}

function containsScrollToken(value: string): boolean {
  const tokens = splitWhitespaceTokens(value)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === undefined) continue
    if (SCROLLABLE_VALUES.has(token)) return true
  }
  return false
}
