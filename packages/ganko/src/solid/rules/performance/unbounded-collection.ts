/**
 * Unbounded Collection Rule
 *
 * Detects module-scoped Map/Set/Array that only grow (additive methods)
 * without any removal or clearing. These leak memory over the application
 * lifetime since module-scope bindings are never garbage collected.
 *
 * BAD:
 *   const cache = new Map<string, Data>();
 *   export function get(key: string, data: Data) {
 *     cache.set(key, data); // only ever grows
 *   }
 *
 * GOOD:
 *   const cache = new Map<string, Data>();
 *   export function get(key: string, data: Data) {
 *     if (cache.size > 1000) cache.clear();
 *     cache.set(key, data);
 *   }
 */

import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"

const ADDITIVE_METHODS: ReadonlySet<string> = new Set([
  "set", "add", "push", "unshift",
])

const REMOVAL_METHODS: ReadonlySet<string> = new Set([
  "delete", "clear", "pop", "shift", "splice",
])

const messages = {
  unboundedCollection:
    "Module-scoped {{type}} '{{name}}' only uses additive methods ({{methods}}). Without removal or clearing, this grows unbounded. Consider WeakMap, LRU eviction, or periodic clear().",
} as const

const options = {}

export const unboundedCollection = defineSolidRule({
  id: "unbounded-collection",
  severity: "warn",
  messages,
  meta: {
    description: "Detect module-scoped Map/Set/Array that only grow without removal.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const variables = graph.variables

    for (let i = 0, len = variables.length; i < len; i++) {
      const variable = variables[i]
      if (!variable) continue;

      if (!variable.scope.isModuleScope) continue

      const collectionType = getCollectionType(variable)
      if (!collectionType) continue

      const methodsUsed = collectMethodCallsViaReads(variable)
      if (methodsUsed.additive.length === 0) continue
      if (methodsUsed.removal) continue

      // Static initialization at module scope (e.g., lookup tables) is not unbounded growth
      if (!methodsUsed.hasDynamicAdditive) continue

      // Reassignment acts as eviction: let cache = new Map(); cache = new Map();
      // Initial declaration counts as one write, so extra assignments indicate reassignment
      if (variable.assignments.length > variable.declarations.length) continue

      const diagNode = variable.declarations[0] ?? variable.reads[0]?.node ?? variable.assignments[0]?.node
      if (!diagNode) continue

      emit(
        createDiagnostic(
          graph.file,
          diagNode,
          "unbounded-collection",
          "unboundedCollection",
          resolveMessage(messages.unboundedCollection, {
            type: collectionType,
            name: variable.name,
            methods: methodsUsed.additive.join(", "),
          }),
          "warn",
        ),
      )
    }
  },
})

/**
 * Determine if a variable is initialized as a Map, Set, or Array.
 */
function getCollectionType(variable: VariableEntity): string | null {
  const declarations = variable.declarations
  for (let i = 0, len = declarations.length; i < len; i++) {
    // declarations[] contains Identifier nodes; the VariableDeclarator is the parent
    const decl = declarations[i]
    if (!decl) continue
    const declarator = decl.parent
    if (declarator?.type !== "VariableDeclarator") continue
    const init = declarator.init
    if (!init) continue

    if (init.type === "NewExpression" && init.callee.type === "Identifier") {
      const name = init.callee.name
      if (name === "Map" || name === "Set") return name
      if (name === "Array") return "Array"
    }

    if (init.type === "ArrayExpression") return "Array"

    // Map(), Set() called without new (less common but valid)
    if (init.type === "CallExpression" && init.callee.type === "Identifier") {
      const name = init.callee.name
      if (name === "Map" || name === "Set") return name
    }
  }

  // Check assignments too
  const assignments = variable.assignments
  for (let i = 0, len = assignments.length; i < len; i++) {
    const assignment = assignments[i]
    if (!assignment) continue
    const value = assignment.value
    if (value.type === "NewExpression" && value.callee.type === "Identifier") {
      const name = value.callee.name
      if (name === "Map" || name === "Set") return name
      if (name === "Array") return "Array"
    }
    if (value.type === "ArrayExpression") return "Array"
  }

  return null
}

interface MethodUsage {
  additive: string[]
  removal: boolean
  /** Whether any additive call is inside a function (dynamic growth vs static init) */
  hasDynamicAdditive: boolean
}

/**
 * Scan method calls and index assignments on a variable via its reads.
 * Uses the variable's read locations to find actual call sites, rather than
 * matching by name which would incorrectly attribute shadowed variables.
 */
function collectMethodCallsViaReads(variable: VariableEntity): MethodUsage {
  const additiveSet = new Set<string>()
  let removal = false
  let hasDynamicAdditive = false

  const reads = variable.reads
  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i]
    if (!read) continue;
    const readNode = read.node
    const parent = readNode.parent
    if (parent?.type !== "MemberExpression" || parent.object !== readNode) continue

    const prop = parent.property
    let method: string
    if (prop.type === "Identifier") {
      method = prop.name
    } else if (prop.type === "Literal" && typeof prop.value === "string") {
      method = prop.value
    } else {
      continue
    }

    const grandparent = parent.parent
    if (grandparent?.type !== "CallExpression" || grandparent.callee !== parent) continue

    if (REMOVAL_METHODS.has(method)) {
      removal = true
      return { additive: [...additiveSet], removal, hasDynamicAdditive }
    }

    if (ADDITIVE_METHODS.has(method)) {
      additiveSet.add(method)
      // If the additive call is inside a function scope (not at module top level),
      // it's dynamic growth rather than static initialization
      if (!read.scope.isModuleScope) {
        hasDynamicAdditive = true
      }
    }
  }

  return { additive: [...additiveSet], removal, hasDynamicAdditive }
}
