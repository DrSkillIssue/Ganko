import type { CSSGraph } from "../../css/impl"
import type { TailwindValidator } from "../../css/tailwind"
import type { SelectorEntity, CascadePosition, RuleEntity } from "../../css/entities"
import { compareCascadePositions } from "../../css/analysis/cascade"
import { splitWhitespaceTokens } from "../../css/parser/value-tokenizer"
import { expandShorthand, getShorthandLonghandNames } from "./shorthand-expansion"
import { Level } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"

import type {
  LayoutCascadedDeclaration,
  LayoutConditionalSignalDeltaFact,
  LayoutElementNode,
  LayoutMatchEdge,
} from "./graph"
import type { LayoutPerfStatsMutable } from "./perf"
import { LayoutSignalGuard, LayoutSignalSource, type LayoutSignalName } from "./signal-model"
import { isMonitoredSignal, MONITORED_SIGNAL_NAME_MAP } from "./signal-normalization"
import { selectorMatchesLayoutElement, SelectorMatchResult, type FileElementIndex } from "./selector-match"
import type { LayoutRuleGuard, LayoutGuardConditionProvenance } from "./guard-model"
import type { SelectorBuildMetadata } from "./selector-dispatch"
import { layoutOffsetSignals, parseOffsetPx } from "./offset-baseline"

const DYNAMIC_ATTRIBUTE_GUARD: LayoutRuleGuard = {
  kind: LayoutSignalGuard.Conditional,
  conditions: [{ kind: "dynamic-attribute", query: null, key: "dynamic-attribute:*" } satisfies LayoutGuardConditionProvenance],
  key: "dynamic-attribute:*",
}

export interface MonitoredDeclaration {
  readonly property: LayoutSignalName
  readonly value: string
  readonly position: CascadePosition
  readonly guardProvenance: LayoutRuleGuard
}

export interface LayoutCascadeCandidate {
  readonly declaration: LayoutCascadedDeclaration
  readonly position: CascadePosition
}

export const SCROLLABLE_VALUES: ReadonlySet<string> = new Set(["auto", "scroll"])

export function collectMonitoredDeclarations(
  selector: SelectorEntity,
  layerOrder: number,
  guard: LayoutRuleGuard,
): readonly MonitoredDeclaration[] {
  const out: MonitoredDeclaration[] = []
  const declarations = selector.rule.declarations
  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i]
    if (!declaration) continue
    const property = declaration.property.toLowerCase()
    if (!isMonitoredSignal(property)) continue

    const position: CascadePosition = {
      layer: declaration.cascadePosition.layer,
      layerOrder,
      sourceOrder: declaration.sourceOrder,
      specificity: selector.specificity,
      specificityScore: selector.specificityScore,
      isImportant: declaration.cascadePosition.isImportant || declaration.node.important,
    }

    const directSignal = MONITORED_SIGNAL_NAME_MAP.get(property)
    if (directSignal !== undefined) {
      out.push({ property: directSignal, value: declaration.value, guardProvenance: guard, position })
      continue
    }

    const value = declaration.value.trim().toLowerCase()
    const expanded = expandShorthand(property, value)
    if (expanded === undefined) continue
    if (expanded === null) {
      const longhandNames = getShorthandLonghandNames(property)
      if (longhandNames === null) continue
      for (let j = 0; j < longhandNames.length; j++) {
        const longhand = longhandNames[j]
        if (!longhand) continue
        const signal = MONITORED_SIGNAL_NAME_MAP.get(longhand)
        if (signal === undefined) continue
        out.push({ property: signal, value: declaration.value, guardProvenance: guard, position })
      }
      continue
    }
    for (let j = 0; j < expanded.length; j++) {
      const entry = expanded[j]
      if (!entry) continue
      const signal = MONITORED_SIGNAL_NAME_MAP.get(entry.name)
      if (signal === undefined) continue
      out.push({ property: signal, value: entry.value, guardProvenance: guard, position })
    }
  }

  return out
}

export function expandMonitoredDeclarationForDelta(
  declaration: MonitoredDeclaration,
): readonly { name: LayoutSignalName; value: string }[] {
  return [{ name: declaration.property, value: declaration.value.trim().toLowerCase() }]
}

export interface SelectorMatchContext {
  readonly selectorMetadataById: ReadonlyMap<number, SelectorBuildMetadata>
  readonly selectorsById: ReadonlyMap<number, SelectorEntity>
  readonly rootElementsByFile: ReadonlyMap<string, readonly LayoutElementNode[]>
  readonly fileElementIndexByFile: ReadonlyMap<string, FileElementIndex>
  readonly perf: LayoutPerfStatsMutable
  readonly logger: Logger
}

export function appendMatchingEdgesFromSelectorIds(
  ctx: SelectorMatchContext,
  selectorIds: readonly number[],
  node: LayoutElementNode,
  applies: LayoutMatchEdge[],
  appliesByElementNodeMutable: Map<LayoutElementNode, LayoutMatchEdge[]>,
): void {
  const fileRoots = ctx.rootElementsByFile.get(node.solidFile) ?? null
  const fileElementIndex = ctx.fileElementIndexByFile.get(node.solidFile) ?? null
  for (let i = 0; i < selectorIds.length; i++) {
    const selectorId = selectorIds[i]
    if (selectorId === undefined) continue
    const metadata = ctx.selectorMetadataById.get(selectorId)
    if (!metadata || !metadata.matcher) {
      throw new Error(`missing compiled selector matcher for selector ${selectorId}`)
    }
    const selector = ctx.selectorsById.get(selectorId)
    if (!selector) {
      throw new Error(`missing selector ${selectorId}`)
    }

    const matchResult = selectorMatchesLayoutElement(metadata.matcher, node, ctx.perf, fileRoots, ctx.logger, fileElementIndex)
    if (matchResult === SelectorMatchResult.NoMatch) continue

    const edge: LayoutMatchEdge = {
      selectorId: selector.id,
      specificityScore: selector.specificityScore,
      sourceOrder: selector.rule.sourceOrder,
      conditionalMatch: matchResult === SelectorMatchResult.Conditional,
    }
    applies.push(edge)
    ctx.perf.matchEdgesCreated++

    if (ctx.logger.isLevelEnabled(Level.Trace)) {
      ctx.logger.trace(
        `[cascade] edge node=${node.key} selector=${selector.id} match=${matchResult}`
        + ` conditional=${edge.conditionalMatch} selector-raw=${selector.raw.slice(0, 80)}`,
      )
    }

    const existing = appliesByElementNodeMutable.get(node)
    if (existing) {
      existing.push(edge)
      continue
    }
    appliesByElementNodeMutable.set(node, [edge])
  }
}

/**
 * Regex for extracting CSS property-value pairs from Tailwind's `candidatesToCss` output.
 *
 * Matches lines like `  min-height: var(--spacing-height-lg);` inside a CSS rule block.
 * Captures: group 1 = property name, group 2 = value (without trailing semicolon).
 */
const TAILWIND_CSS_DECLARATION = /^\s+([\w-]+)\s*:\s*(.+?)\s*;?\s*$/gm

/**
 * Parses CSS property-value pairs from a Tailwind `candidatesToCss` output string.
 *
 * Input format: `.class-name {\n  property: value;\n}\n`
 * Returns an array of [property, value] tuples.
 */
function parseTailwindCssDeclarations(css: string): readonly [string, string][] {
  const result: [string, string][] = []
  TAILWIND_CSS_DECLARATION.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAILWIND_CSS_DECLARATION.exec(css)) !== null) {
    const prop = match[1]
    const val = match[2]
    if (prop === undefined || val === undefined) continue
    result.push([prop, val])
  }
  return result
}

/**
 * Augments a cascade map with CSS properties resolved from Tailwind utility classes.
 *
 * For each class token on the element, resolves it via the TailwindValidator to obtain
 * the generated CSS. Properties from Tailwind utilities are injected with the lowest
 * priority — they only appear in the cascade if no CSS selector match or inline style
 * already establishes the property.
 *
 * This is semantically correct because:
 * - Tailwind utilities in `@layer utilities` have lower priority than component styles
 *   and inline styles in the cascade
 * - The layout graph's primary purpose is detecting CLS risks, where knowing that an
 *   element HAS a height/position/overflow is the critical signal
 */
function augmentCascadeWithTailwind(
  cascade: Map<string, LayoutCascadedDeclaration>,
  node: LayoutElementNode,
  tailwind: TailwindValidator,
): void {
  const classTokens = node.classTokens
  if (classTokens.length === 0) return

  const guardProvenance: LayoutRuleGuard = {
    kind: LayoutSignalGuard.Unconditional,
    conditions: [],
    key: "always",
  }

  for (let i = 0; i < classTokens.length; i++) {
    const token = classTokens[i]
    if (token === undefined) continue
    const css = tailwind.resolve(token)
    if (css === null) continue

    const declarations = parseTailwindCssDeclarations(css)
    for (let j = 0; j < declarations.length; j++) {
      const entry = declarations[j]
      if (!entry) continue
      const [property, value] = entry
      /* Only inject if the cascade doesn't already have this property.
         Selector-matched declarations and inline styles take precedence. */
      if (cascade.has(property)) continue
      cascade.set(property, {
        value,
        source: LayoutSignalSource.Selector,
        guardProvenance,
      })
    }
  }
}

export function buildCascadeMapForElement(
  node: LayoutElementNode,
  edges: readonly LayoutMatchEdge[],
  monitoredDeclarationsBySelectorId: ReadonlyMap<number, readonly MonitoredDeclaration[]>,
  tailwind: TailwindValidator | null,
): ReadonlyMap<string, LayoutCascadedDeclaration> {
  const out = new Map<string, LayoutCascadedDeclaration>()
  const positions = new Map<string, CascadePosition>()

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    if (!edge) continue
    const declarations = monitoredDeclarationsBySelectorId.get(edge.selectorId)
    if (!declarations) continue

    for (let j = 0; j < declarations.length; j++) {
      const declaration = declarations[j]
      if (!declaration) continue
      const property = declaration.property
      // When the selector match is conditional (dynamic attribute values),
      // elevate the guard to Conditional even if the CSS rule itself is
      // unconditional. This ensures signals from partially-matched selectors
      // are weighted with reduced certainty in the scoring model.
      const guardProvenance = edge.conditionalMatch && declaration.guardProvenance.kind === LayoutSignalGuard.Unconditional
        ? DYNAMIC_ATTRIBUTE_GUARD
        : declaration.guardProvenance

      const newDeclaration: LayoutCascadedDeclaration = {
        value: declaration.value,
        source: LayoutSignalSource.Selector,
        guardProvenance,
      }

      const existingPosition = positions.get(property)
      if (existingPosition === undefined) {
        out.set(property, newDeclaration)
        positions.set(property, declaration.position)
        continue
      }

      const existingDeclaration = out.get(property)
      if (existingDeclaration === undefined) continue
      if (!doesCandidateOverride(
        { declaration: existingDeclaration, position: existingPosition },
        { declaration: newDeclaration, position: declaration.position },
      )) continue
      out.set(property, newDeclaration)
      positions.set(property, declaration.position)
    }
  }


  for (const [property, value] of node.inlineStyleValues) {
    const newDeclaration: LayoutCascadedDeclaration = {
      value,
      source: LayoutSignalSource.InlineStyle,
      guardProvenance: INLINE_GUARD_PROVENANCE,
    }

    const existingPosition = positions.get(property)
    if (existingPosition === undefined) {
      out.set(property, newDeclaration)
      positions.set(property, INLINE_CASCADE_POSITION)
      continue
    }

    const existingDeclaration = out.get(property)
    if (existingDeclaration === undefined) continue
    if (!doesCandidateOverride(
      { declaration: existingDeclaration, position: existingPosition },
      { declaration: newDeclaration, position: INLINE_CASCADE_POSITION },
    )) continue
    out.set(property, newDeclaration)
    positions.set(property, INLINE_CASCADE_POSITION)
  }

  /* Augment with Tailwind-resolved properties. Runs last because Tailwind
     utilities only fill gaps — they never override selector-matched or
     inline style declarations already present in the cascade. */
  if (tailwind !== null) {
    augmentCascadeWithTailwind(out, node, tailwind)
  }

  return out
}

export function compareLayoutEdge(a: LayoutMatchEdge, b: LayoutMatchEdge): number {
  if (a.specificityScore !== b.specificityScore) {
    return a.specificityScore - b.specificityScore
  }
  return a.sourceOrder - b.sourceOrder
}

function doesCandidateOverride(
  existing: LayoutCascadeCandidate,
  incoming: LayoutCascadeCandidate,
): boolean {
  const existingSource = existing.declaration.source
  const incomingSource = incoming.declaration.source

  if (existingSource !== incomingSource) {
    if (incomingSource === LayoutSignalSource.InlineStyle) {
      if (existing.position.isImportant && !incoming.position.isImportant) return false
      return true
    }

    if (existing.position.isImportant && !incoming.position.isImportant) return false
  }

  return compareCascadePositions(incoming.position, existing.position) > 0
}

const INLINE_CASCADE_POSITION: CascadePosition = Object.freeze({
  layer: null,
  layerOrder: Number.MAX_SAFE_INTEGER,
  sourceOrder: Number.MAX_SAFE_INTEGER,
  specificity: [1, 0, 0, 0] as const,
  specificityScore: Number.MAX_SAFE_INTEGER,
  isImportant: false,
})

const INLINE_GUARD_PROVENANCE: LayoutRuleGuard = Object.freeze({
  kind: LayoutSignalGuard.Unconditional,
  conditions: [],
  key: "always",
})

export function resolveRuleLayerOrder(rule: RuleEntity, css: CSSGraph): number {
  const layer = rule.containingLayer
  if (!layer) return 0

  const name = layer.parsedParams.layerName
  if (!name) return 0
  return css.layerOrder.get(name) ?? 0
}

export interface ConditionalDeltaIndex {
  readonly conditionalSignalDeltaFactsByNode: ReadonlyMap<LayoutElementNode, ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact>>
  readonly elementsWithConditionalDeltaBySignal: ReadonlyMap<LayoutSignalName, readonly LayoutElementNode[]>
  readonly baselineOffsetFactsByNode: ReadonlyMap<LayoutElementNode, ReadonlyMap<LayoutSignalName, readonly number[]>>
}

export function buildConditionalDeltaIndex(
  elements: readonly LayoutElementNode[],
  records: ReadonlyMap<LayoutElementNode, { readonly edges: readonly LayoutMatchEdge[] }>,
  monitoredDeclarationsBySelectorId: ReadonlyMap<number, readonly MonitoredDeclaration[]>,
  selectorsById: ReadonlyMap<number, SelectorEntity>,
): ConditionalDeltaIndex {
  const conditionalSignalDeltaFactsByNode = new Map<LayoutElementNode, ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact>>()
  const elementsWithConditionalDeltaBySignal = new Map<LayoutSignalName, LayoutElementNode[]>()
  const baselineOffsetFactsByNode = new Map<LayoutElementNode, ReadonlyMap<LayoutSignalName, readonly number[]>>()

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue

    const edges = records.get(node)?.edges
    let factByProperty: ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact> | null = null

    if (edges !== undefined && edges.length > 0) {
      const byProperty = new Map<LayoutSignalName, { conditional: Set<string>; unconditional: Set<string> }>()
      // Lazily allocated. Tracks which attribute dispatch group each conditional (property, value)
      // belongs to. Used to detect mutually exclusive attribute value selectors (e.g.
      // [data-sizing="intrinsic"] vs [data-sizing="flex"]) where only one can match at a time.
      let conditionalAttributeDispatch: Map<LayoutSignalName, Map<string, string>> | null = null

      for (let j = 0; j < edges.length; j++) {
        const currentEdge = edges[j]
        if (!currentEdge) continue
        const declarations = monitoredDeclarationsBySelectorId.get(currentEdge.selectorId)
        if (!declarations) continue

        // Identify the dynamic attribute causing conditionality for this edge.
        // A conditional match from a selector like [data-sizing="intrinsic"] on an element
        // with data-sizing=null (dynamic) means the conditionality comes from data-sizing.
        let conditionalAttributeName: string | null = null
        if (currentEdge.conditionalMatch) {
          conditionalAttributeName = identifyConditionalAttribute(currentEdge.selectorId, node, selectorsById)
        }

        for (let k = 0; k < declarations.length; k++) {
          const declaration = declarations[k]
          if (!declaration) continue
          const expanded = expandMonitoredDeclarationForDelta(declaration)
          for (let n = 0; n < expanded.length; n++) {
            const expandedEntry = expanded[n]
            if (!expandedEntry) continue
            const property = expandedEntry.name
            let bucket = byProperty.get(property)
            if (!bucket) {
              bucket = {
                conditional: new Set<string>(),
                unconditional: new Set<string>(),
              }
              byProperty.set(property, bucket)
            }

            if (declaration.guardProvenance.kind === LayoutSignalGuard.Conditional || currentEdge.conditionalMatch) {
              bucket.conditional.add(expandedEntry.value)
              // Track the attribute dispatch source for this conditional value
              if (conditionalAttributeName !== null && declaration.guardProvenance.kind !== LayoutSignalGuard.Conditional) {
                if (conditionalAttributeDispatch === null) conditionalAttributeDispatch = new Map()
                let dispatchMap = conditionalAttributeDispatch.get(property)
                if (!dispatchMap) {
                  dispatchMap = new Map()
                  conditionalAttributeDispatch.set(property, dispatchMap)
                }
                dispatchMap.set(expandedEntry.value, conditionalAttributeName)
              }
              continue
            }
            bucket.unconditional.add(expandedEntry.value)
          }
        }
      }

      if (byProperty.size > 0) {
        const facts = new Map<LayoutSignalName, LayoutConditionalSignalDeltaFact>()
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

          // Suppress delta when all conditional values come from mutually exclusive
          // attribute value selectors on the same attribute. E.g., [data-sizing="intrinsic"]
          // sets white-space:nowrap and [data-sizing="flex"] sets white-space:normal — these
          // are mutually exclusive on the same element, so the property never actually shifts.
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
          conditionalSignalDeltaFactsByNode.set(node, facts)

          for (const [signal, fact] of facts) {
            if (!fact.hasConditional) continue
            const existing = elementsWithConditionalDeltaBySignal.get(signal)
            if (existing) {
              existing.push(node)
              continue
            }
            elementsWithConditionalDeltaBySignal.set(signal, [node])
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
      baselineOffsetFactsByNode.set(node, baselineBySignal)
    }
  }

  return {
    conditionalSignalDeltaFactsByNode,
    elementsWithConditionalDeltaBySignal,
    baselineOffsetFactsByNode,
  }
}

const EMPTY_NODE_LIST: readonly LayoutElementNode[] = []

export function buildConditionalDeltaSignalGroupElements(
  elementsWithConditionalDeltaBySignal: ReadonlyMap<LayoutSignalName, readonly LayoutElementNode[]>,
  signalGroup: readonly LayoutSignalName[],
): readonly LayoutElementNode[] {
  if (signalGroup.length === 0) return EMPTY_NODE_LIST
  if (signalGroup.length === 1) {
    const firstSignal = signalGroup[0]
    if (!firstSignal) return EMPTY_NODE_LIST
    return elementsWithConditionalDeltaBySignal.get(firstSignal) ?? EMPTY_NODE_LIST
  }

  const seen = new Set<string>()
  const out: LayoutElementNode[] = []

  for (let i = 0; i < signalGroup.length; i++) {
    const signalName = signalGroup[i]
    if (!signalName) continue
    const nodes = elementsWithConditionalDeltaBySignal.get(signalName)
    if (!nodes || nodes.length === 0) continue

    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j]
      if (!node) continue
      if (seen.has(node.key)) continue
      seen.add(node.key)
      out.push(node)
    }
  }

  return out
}

/**
 * Identify the single dynamic attribute on the element that caused a conditional
 * selector match. Returns the attribute name if exactly one attribute constraint
 * in the selector's subject compound targets a dynamic attribute (value=null) on
 * the element with an `equals` operator. Returns null if the conditionality comes
 * from multiple attributes, non-equals operators, or non-attribute sources.
 */
function identifyConditionalAttribute(
  selectorId: number,
  node: LayoutElementNode,
  selectorsById: ReadonlyMap<number, SelectorEntity>,
): string | null {
  const selector = selectorsById.get(selectorId)
  if (!selector) return null

  const constraints = selector.anchor.attributes
  let dynamicAttributeName: string | null = null

  for (let i = 0; i < constraints.length; i++) {
    const constraint = constraints[i]
    if (!constraint) continue
    if (constraint.operator !== "equals") continue
    if (constraint.value === null) continue

    // Check if this attribute is dynamic on the element.
    // attributes.get returns undefined (absent), string (known), or null (dynamic).
    // Only null (dynamic value) is the conditionality source.
    const elementValue = node.attributes.get(constraint.name)
    if (elementValue !== null) continue
    if (dynamicAttributeName !== null && dynamicAttributeName !== constraint.name) {
      // Multiple different dynamic attributes — can't determine single dispatch source
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
