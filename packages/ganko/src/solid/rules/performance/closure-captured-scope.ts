/**
 * Closure Captured Scope Rule
 *
 * Detects functions that return closures while the enclosing scope contains
 * variables initialized to large data structures. V8 captures variables at
 * the scope level — even if the closure doesn't reference a variable, it
 * may be retained if another closure in the same scope references any variable.
 *
 * BAD:
 *   function process() {
 *     const huge = new Array(1_000_000).fill(0);
 *     const summary = computeSummary(huge);
 *     return () => summary; // 'huge' retained by V8 scope capture
 *   }
 *
 * GOOD:
 *   function process() {
 *     const summary = (() => {
 *       const huge = new Array(1_000_000).fill(0);
 *       return computeSummary(huge);
 *     })();
 *     return () => summary; // 'huge' in inner scope, not captured
 *   }
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../../impl"
import type { ScopeEntity, FunctionEntity, VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"

const messages = {
  capturedScope:
    "Returned closure shares scope with large allocation '{{name}}'. V8 may retain the allocation via scope capture even though the closure doesn't reference it. Move the allocation to an inner scope.",
} as const

const options = {}

const LARGE_CONSTRUCTORS = new Set([
  "Array", "Uint8Array", "Uint16Array", "Uint32Array",
  "Int8Array", "Int16Array", "Int32Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "ArrayBuffer", "SharedArrayBuffer", "Buffer",
])

export const closureCapturedScope = defineSolidRule({
  id: "closure-captured-scope",
  severity: "warn",
  messages,
  meta: {
    description: "Detect closures returned from scopes containing large allocations that may be retained.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const functions = graph.functions

    for (let fi = 0, flen = functions.length; fi < flen; fi++) {
      const fn = functions[fi]
      if (!fn) continue
      if (!fn.scope) continue

      const scope = fn.scope

      // Find variables in this scope that look like large allocations
      const largeVars = findLargeAllocations(scope)
      if (largeVars.length === 0) continue

      // Check for closures that escape via return or assignment to outer scope
      const returnedClosureRanges = findEscapingClosureRanges(fn, graph)
      if (returnedClosureRanges.length === 0) continue

      // For each large allocation, check if any returned closure references it
      for (let j = 0, jlen = largeVars.length; j < jlen; j++) {
        const v = largeVars[j]
        if (!v) continue

        let referencedByClosure = false
        for (let k = 0, klen = returnedClosureRanges.length; k < klen; k++) {
          const closureRange = returnedClosureRanges[k]
          if (!closureRange) continue
          if (variableReadInRange(v, closureRange)) {
            referencedByClosure = true
            break
          }
        }

        // Flag when closure does NOT reference the large var (V8 captures it
        // anyway via shared scope context as long as any other variable is captured)
        if (!referencedByClosure) {
          const reportNode = v.declarations[0] ?? v.reads[0]?.node ?? v.assignments[0]?.node
          if (!reportNode) continue
          emit(
            createDiagnostic(
              graph.file,
              reportNode,
              "closure-captured-scope",
              "capturedScope",
              resolveMessage(messages.capturedScope, { name: v.name }),
              "warn",
            ),
          )
        }
      }
    }
  },
})

/**
 * Find variables in a scope initialized to large data structures.
 */
function findLargeAllocations(scope: ScopeEntity): VariableEntity[] {
  const result: VariableEntity[] = []
  const vars = scope.variables

  for (let i = 0, len = vars.length; i < len; i++) {
    const v = vars[i]
    if (!v) continue
    if (isLargeAllocation(v)) {
      result.push(v)
    }
  }

  return result
}

function isLargeAllocation(variable: VariableEntity): boolean {
  const declarations = variable.declarations

  for (let i = 0, len = declarations.length; i < len; i++) {
    const decl = declarations[i]
    if (!decl) continue
    // declarations[] contains Identifier nodes; the VariableDeclarator is the parent
    const declarator = decl.parent
    if (declarator?.type !== "VariableDeclarator" || !declarator.init) continue
    if (isLargeAllocationExpression(declarator.init)) return true
  }

  return false
}

function isLargeAllocationExpression(node: T.Expression): boolean {
  // new Array(...), new Uint8Array(...), etc.
  if (node.type === "NewExpression" && node.callee.type === "Identifier") {
    if (LARGE_CONSTRUCTORS.has(node.callee.name)) return true
  }

  // Array.from(...), Buffer.alloc(...), Buffer.from(...)
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    if (
      node.callee.object.type === "Identifier" &&
      node.callee.property.type === "Identifier"
    ) {
      const obj = node.callee.object.name
      const method = node.callee.property.name
      if (obj === "Array" && method === "from") return true
      if (obj === "Buffer" && (method === "alloc" || method === "from")) return true
    }
  }

  // Array spread: [...data] creates a copy at least as large as the source
  if (node.type === "ArrayExpression" && node.elements.length > 0) {
    for (let i = 0, len = node.elements.length; i < len; i++) {
      if (node.elements[i]?.type === "SpreadElement") return true
    }
  }

  // Chained: new Array(...).fill(...).map(...)
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    if (node.callee.object.type === "CallExpression") {
      return isLargeAllocationExpression(node.callee.object)
    }
    if (node.callee.object.type === "NewExpression") {
      return isLargeAllocationExpression(node.callee.object)
    }
  }

  return false
}

/**
 * Find ranges of closures that escape the function's scope.
 * Detects:
 * - Returned closures (via return statements)
 * - Closures assigned to outer-scope variables
 */
function findEscapingClosureRanges(fn: FunctionEntity, graph: SolidGraph): readonly [number, number][] {
  const ranges: [number, number][] = []

  // 1. Returned closures
  const returns = fn.returnStatements
  for (let i = 0, len = returns.length; i < len; i++) {
    const ret = returns[i]
    if (!ret) continue
    const arg = ret.node.argument
    if (!arg) continue

    if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
      ranges.push(arg.range)
      continue
    }

    // Check for closures inside returned objects: return { method: () => ... }
    if (arg.type === "ObjectExpression") {
      extractClosureRangesFromObject(arg, ranges)
    }
  }

  // 2. Closures assigned to outer-scope variables or properties
  const fnRange = fn.node.range

  // Property assignments within this function (e.g., this.fn = () => ...)
  const assignments = graph.propertyAssignments
  for (let i = 0, len = assignments.length; i < len; i++) {
    const pa = assignments[i]
    if (!pa) continue
    if (pa.node.range[0] < fnRange[0] || pa.node.range[1] > fnRange[1]) continue
    const val = pa.value
    if (val.type === "ArrowFunctionExpression" || val.type === "FunctionExpression") {
      ranges.push(val.range)
    }
  }

  // Variable write assignments (e.g., handler = () => summary)
  // where the variable is from an outer scope
  if (fn.scope) {
    const allVars = graph.variables
    for (let vi = 0, vlen = allVars.length; vi < vlen; vi++) {
      const v = allVars[vi]
      if (!v) continue
      if (v.scope === fn.scope) continue
      const varAssigns = v.assignments
      for (let ai = 0, alen = varAssigns.length; ai < alen; ai++) {
        const assign = varAssigns[ai]
        if (!assign) continue
        const assignNode = assign.node
        // Must be inside the function body
        if (assignNode.range[0] < fnRange[0] || assignNode.range[1] > fnRange[1]) continue
        if (assignNode.parent?.type === "AssignmentExpression") {
          const rhs = assignNode.parent.right
          if (rhs.type === "ArrowFunctionExpression" || rhs.type === "FunctionExpression") {
            ranges.push(rhs.range)
          }
        }
      }
    }
  }

  return ranges
}

/**
 * Extract function ranges from object expression properties.
 */
function extractClosureRangesFromObject(obj: T.ObjectExpression, ranges: [number, number][]): void {
  const props = obj.properties
  for (let i = 0, len = props.length; i < len; i++) {
    const prop = props[i]
    if (!prop) continue
    if (prop.type !== "Property") continue

    const val = prop.value
    if (val.type === "ArrowFunctionExpression" || val.type === "FunctionExpression") {
      ranges.push(val.range)
    }
  }
}

/**
 * Check if a variable has any reads within a given range.
 */
function variableReadInRange(variable: VariableEntity, range: readonly [number, number]): boolean {
  const reads = variable.reads

  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i]
    if (!read) continue
    const readRange = read.node.range
    if (readRange[0] >= range[0] && readRange[1] <= range[1]) {
      return true
    }
  }

  return false
}
