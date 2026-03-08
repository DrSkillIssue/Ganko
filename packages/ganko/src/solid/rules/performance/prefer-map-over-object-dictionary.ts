/**
 * Flags dynamic key assignment on objects typed as dictionaries.
 *
 * Exempts the "build once in a loop" pattern where an empty object literal
 * is populated inside a loop and never dynamically mutated afterward.
 * V8 transitions keyed-store objects to dictionary mode after ~12 properties,
 * making this pattern architecturally equivalent to Map for one-time builds.
 */

import type { TypeInfo } from "../../typescript"
import type { PropertyAssignmentEntity } from "../../entities/property-assignment"
import { getPropertyAssignments, getVariablesByName } from "../../queries/get"
import { getTypeInfo } from "../../queries/type"
import type { SolidGraph } from "../../impl"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { isEmptyObjectLiteral } from "../../util"

const messages = {
  preferMap: "Dynamic key assignment on dictionary object causes hidden class transitions. Consider using Map.",
} as const

const options = {}

export const preferMapOverObjectDictionary = defineSolidRule({
  id: "prefer-map-over-object-dictionary",
  severity: "warn",
  messages,
  meta: {
    description: "Suggest Map for dictionary-like objects with dynamic keys.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const assignments = getPropertyAssignments(graph)
    if (assignments.length === 0) return

    for (let i = 0, len = assignments.length; i < len; i++) {
      const pa = assignments[i]
      if (!pa) continue;

      if (!pa.computed) continue

      const prop = pa.property
      if (prop.type === "Literal") {
        const val = prop.value
        if (typeof val === "string" || typeof val === "number") continue
      }

      const typeInfo = getTypeInfo(graph, pa.object)
      if (!isDictionaryType(typeInfo)) continue

      if (pa.isInLoop && isBuildOnceInLoop(graph, pa)) continue

      emit(
        createDiagnostic(
          graph.file,
          pa.node,
          "prefer-map-over-object-dictionary",
          "preferMap",
          messages.preferMap,
          "warn",
        ),
      )
    }
  },
})

/**
 * Check if a type represents a dictionary pattern.
 *
 * @param typeInfo - Type information for the object
 * @returns True if the type is Record<K,V> or has index signature
 */
function isDictionaryType(typeInfo: TypeInfo | null): boolean {
  if (!typeInfo) return false
  const raw = typeInfo.raw

  if (raw.startsWith("Record<")) return true

  const bracket = raw.indexOf("[")
  if (bracket !== -1 && raw.indexOf("]:", bracket) !== -1) return true

  return false
}

/**
 * Detects the "build once in a loop" pattern:
 * ```
 * const obj: Record<string, T> = {}
 * for (...) { obj[key] = value }
 * ```
 *
 * The object must be a simple identifier initialized as an empty `{}` literal.
 * V8 handles this gracefully — after ~12 keyed stores it transitions to dictionary
 * mode (Swiss table) where further additions are O(1) hash inserts with no hidden
 * class churn.
 */
function isBuildOnceInLoop(graph: SolidGraph, pa: PropertyAssignmentEntity): boolean {
  const obj = pa.object
  if (obj.type !== "Identifier") return false

  const vars = getVariablesByName(graph, obj.name)
  if (vars.length === 0) return false

  const variable = vars[0]
  if (!variable) return false
  const first = variable.assignments[0]
  if (!first) return false

  // Must be a declarator init (operator null), not a reassignment
  if (first.operator !== null) return false

  return isEmptyObjectLiteral(first.value)
}
