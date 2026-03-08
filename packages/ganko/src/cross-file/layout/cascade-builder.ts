import type { CSSGraph } from "../../css/impl"
import type { TailwindValidator } from "../../css/tailwind"
import type { SelectorEntity, CascadePosition, RuleEntity } from "../../css/entities"
import { compareCascadePositions } from "../../css/analysis/cascade"
import { splitWhitespaceTokens } from "../../css/parser/value-tokenizer"
import { expandShorthand } from "./shorthand-expansion"
import type { Logger } from "@drskillissue/ganko-shared"

import type {
  LayoutCascadedDeclaration,
  LayoutConditionalSignalDeltaFact,
  LayoutContainingBlockFact,
  LayoutElementNode,
  LayoutMatchEdge,
  LayoutReservedSpaceFact,
} from "./graph"
import type { LayoutPerfStatsMutable } from "./perf"
import type { LayoutGuardProvenance, LayoutSignalName, LayoutSignalGuard, LayoutSignalSnapshot } from "./signal-model"
import { isMonitoredSignal, MONITORED_SIGNAL_NAME_MAP } from "./signal-normalization"
import { selectorMatchesLayoutElement } from "./selector-match"
import type { LayoutRuleGuard } from "./guard-model"
import type { SelectorBuildMetadata } from "./selector-dispatch"
import { layoutOffsetSignals, parseOffsetPx } from "./offset-baseline"

export interface MonitoredDeclaration {
  readonly property: MonitoredSignalKey
  readonly value: string
  readonly position: CascadePosition
  readonly guard: LayoutSignalGuard
  readonly guardProvenance: LayoutGuardProvenance
}

export type MonitoredSignalKey =
  | LayoutSignalName
  | "padding"
  | "border-width"
  | "margin-block"
  | "padding-block"
  | "inset-block"

export interface LayoutCascadeCandidate {
  readonly declaration: LayoutCascadedDeclaration
  readonly position: CascadePosition
}

export const SCROLLABLE_VALUES: ReadonlySet<string> = new Set(["auto", "scroll"])
const EMPTY_EXPANSION_RESULT: readonly { name: LayoutSignalName; value: string }[] = []

export function collectMonitoredDeclarations(
  selector: SelectorEntity,
  layerOrder: number,
  guard: LayoutRuleGuard,
): readonly MonitoredDeclaration[] {
  const out: MonitoredDeclaration[] = []
  const declarations = selector.rule.declarations
  const signalGuard: LayoutSignalGuard = guard.kind === "conditional" ? "conditional" : "unconditional"
  const guardProvenance: LayoutGuardProvenance = {
    kind: signalGuard,
    conditions: guard.conditions,
    key: guard.key,
  }

  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i]
    if (!declaration) continue
    const property = declaration.property.toLowerCase()
    if (!isMonitoredSignal(property)) continue
    const monitored = toMonitoredSignalKey(property)
    if (!monitored) continue
    out.push({
      property: monitored,
      value: declaration.value,
      guard: signalGuard,
      guardProvenance,
      position: {
        layer: declaration.cascadePosition.layer,
        layerOrder,
        sourceOrder: declaration.sourceOrder,
        specificity: selector.specificity,
        specificityScore: selector.specificityScore,
        isImportant: declaration.cascadePosition.isImportant || declaration.node.important,
      },
    })
  }

  return out
}

function toMonitoredSignalKey(property: string): MonitoredSignalKey | null {
  const signal = MONITORED_SIGNAL_NAME_MAP.get(property)
  if (signal) return signal

  switch (property) {
    case "padding":
    case "border-width":
    case "margin-block":
    case "padding-block":
    case "inset-block":
      return property
    default:
      return null
  }
}

export function expandMonitoredDeclarationForDelta(
  declaration: MonitoredDeclaration,
): readonly { name: LayoutSignalName; value: string }[] {
  const value = declaration.value.trim().toLowerCase()
  const expanded = expandShorthand(declaration.property, value)
  if (expanded !== undefined) {
    if (expanded === null) return EMPTY_EXPANSION_RESULT
    const filtered: { name: LayoutSignalName; value: string }[] = []
    for (let i = 0; i < expanded.length; i++) {
      const entry = expanded[i]
      if (!entry) continue
      const signalName = MONITORED_SIGNAL_NAME_MAP.get(entry.name)
      if (signalName !== undefined) filtered.push({ name: signalName, value: entry.value })
    }
    return filtered
  }
  const signalName = MONITORED_SIGNAL_NAME_MAP.get(declaration.property)
  if (signalName === undefined) return EMPTY_EXPANSION_RESULT
  return [{ name: signalName, value }]
}

export function appendMatchingEdgesFromSelectorIds(
  selectorIds: readonly number[],
  node: LayoutElementNode,
  selectorMetadataById: ReadonlyMap<number, SelectorBuildMetadata>,
  selectorsById: ReadonlyMap<number, SelectorEntity>,
  applies: LayoutMatchEdge[],
  appliesByElementNodeMutable: Map<LayoutElementNode, LayoutMatchEdge[]>,
  perf: LayoutPerfStatsMutable,
  rootElementsByFile: ReadonlyMap<string, readonly LayoutElementNode[]>,
  logger: Logger,
): void {
  const fileRoots = rootElementsByFile.get(node.solidFile) ?? null
  for (let i = 0; i < selectorIds.length; i++) {
    const selectorId = selectorIds[i]
    if (selectorId === undefined) continue
    const metadata = selectorMetadataById.get(selectorId)
    if (!metadata || !metadata.matcher) {
      throw new Error(`missing compiled selector matcher for selector ${selectorId}`)
    }
    const selector = selectorsById.get(selectorId)
    if (!selector) {
      throw new Error(`missing selector ${selectorId}`)
    }

    if (!selectorMatchesLayoutElement(metadata.matcher, node, perf, fileRoots, logger)) continue

    const edge: LayoutMatchEdge = {
      solidFile: node.solidFile,
      elementId: node.elementId,
      elementKey: node.key,
      selectorId: selector.id,
      specificityScore: selector.specificityScore,
      sourceOrder: selector.rule.sourceOrder,
    }
    applies.push(edge)
    perf.matchEdgesCreated++

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

  const guardProvenance: LayoutGuardProvenance = {
    kind: "unconditional",
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
        source: "selector",
        guard: "unconditional",
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
      const newDeclaration: LayoutCascadedDeclaration = {
        value: declaration.value,
        source: "selector",
        guard: declaration.guard,
        guardProvenance: declaration.guardProvenance,
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

  const inlinePosition = createInlineCascadePosition()
  const inlineGuardProvenance: LayoutGuardProvenance = {
    kind: "unconditional",
    conditions: [],
    key: "always",
  }
  for (const [property, value] of node.inlineStyleValues) {
    const newDeclaration: LayoutCascadedDeclaration = {
      value,
      source: "inline-style",
      guard: "unconditional",
      guardProvenance: inlineGuardProvenance,
    }

    const existingPosition = positions.get(property)
    if (existingPosition === undefined) {
      out.set(property, newDeclaration)
      positions.set(property, inlinePosition)
      continue
    }

    const existingDeclaration = out.get(property)
    if (existingDeclaration === undefined) continue
    if (!doesCandidateOverride(
      { declaration: existingDeclaration, position: existingPosition },
      { declaration: newDeclaration, position: inlinePosition },
    )) continue
    out.set(property, newDeclaration)
    positions.set(property, inlinePosition)
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
    if (incomingSource === "inline-style") {
      if (existing.position.isImportant && !incoming.position.isImportant) return false
      return true
    }

    if (existing.position.isImportant && !incoming.position.isImportant) return false
  }

  return compareCascadePositions(incoming.position, existing.position) > 0
}

function createInlineCascadePosition(): CascadePosition {
  return {
    layer: null,
    layerOrder: Number.MAX_SAFE_INTEGER,
    sourceOrder: Number.MAX_SAFE_INTEGER,
    specificity: [1, 0, 0, 0],
    specificityScore: Number.MAX_SAFE_INTEGER,
    isImportant: false,
  }
}

export function resolveRuleLayerOrder(rule: RuleEntity, css: CSSGraph): number {
  const layer = rule.containingLayer
  if (!layer) return 0

  const name = layer.parsedParams.layerName
  if (!name) return 0
  return css.layerOrder.get(name) ?? 0
}

export function buildContainingBlockFactsByElementKey(
  elements: readonly LayoutElementNode[],
  snapshotByElementNode: WeakMap<LayoutElementNode, LayoutSignalSnapshot>,
  reservedSpaceFactsByElementKey: ReadonlyMap<string, LayoutReservedSpaceFact>,
): ReadonlyMap<string, LayoutContainingBlockFact> {
  const out = new Map<string, LayoutContainingBlockFact>()

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue
    let current = node.parentElementNode
    let positionedAncestorKey: string | null = null
    let positionedAncestorHasReservedSpace = false

    while (current) {
      const snapshot = snapshotByElementNode.get(current)
      if (!snapshot) {
        current = current.parentElementNode
        continue
      }

      const position = snapshot.signals.get("position")
      if (position && position.kind === "known" && position.normalized !== "static") {
        positionedAncestorKey = current.key
        const reserved = reservedSpaceFactsByElementKey.get(current.key)
        positionedAncestorHasReservedSpace = reserved?.hasReservedSpace ?? false
        break
      }

      current = current.parentElementNode
    }

    out.set(node.key, {
      nearestPositionedAncestorKey: positionedAncestorKey,
      nearestPositionedAncestorHasReservedSpace: positionedAncestorHasReservedSpace,
    })
  }

  return out
}

export interface ConditionalDeltaIndex {
  readonly conditionalSignalDeltaFactsByElementKey: ReadonlyMap<string, ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact>>
  readonly elementsWithConditionalDeltaBySignal: ReadonlyMap<LayoutSignalName, readonly LayoutElementNode[]>
  readonly baselineOffsetFactsByElementKey: ReadonlyMap<string, ReadonlyMap<LayoutSignalName, readonly number[]>>
}

export function buildConditionalDeltaIndex(
  elements: readonly LayoutElementNode[],
  appliesByElementKey: ReadonlyMap<string, readonly LayoutMatchEdge[]>,
  monitoredDeclarationsBySelectorId: ReadonlyMap<number, readonly MonitoredDeclaration[]>,
): ConditionalDeltaIndex {
  const conditionalSignalDeltaFactsByElementKey = new Map<string, ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact>>()
  const elementsWithConditionalDeltaBySignal = new Map<LayoutSignalName, LayoutElementNode[]>()
  const baselineOffsetFactsByElementKey = new Map<string, ReadonlyMap<LayoutSignalName, readonly number[]>>()

  for (let i = 0; i < elements.length; i++) {
    const node = elements[i]
    if (!node) continue

    const edges = appliesByElementKey.get(node.key)
    let factByProperty: ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact> | null = null

    if (edges !== undefined && edges.length > 0) {
      const byProperty = new Map<LayoutSignalName, { conditional: Set<string>; unconditional: Set<string> }>()

      for (let j = 0; j < edges.length; j++) {
        const currentEdge = edges[j]
        if (!currentEdge) continue
        const declarations = monitoredDeclarationsBySelectorId.get(currentEdge.selectorId)
        if (!declarations) continue

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

            if (declaration.guard === "conditional") {
              bucket.conditional.add(expandedEntry.value)
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
          conditionalSignalDeltaFactsByElementKey.set(node.key, facts)

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
      baselineOffsetFactsByElementKey.set(node.key, baselineBySignal)
    }
  }

  return {
    conditionalSignalDeltaFactsByElementKey,
    elementsWithConditionalDeltaBySignal,
    baselineOffsetFactsByElementKey,
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
