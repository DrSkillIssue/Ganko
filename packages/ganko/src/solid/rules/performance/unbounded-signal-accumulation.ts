/**
 * Unbounded Signal Accumulation Rule
 *
 * Detects signal setters called with a callback that spreads the previous
 * value and appends new items without any truncation or eviction.
 *
 * BAD:
 *   setItems(prev => [...prev, newItem]);
 *   setLogs(prev => [...prev, entry]);
 *
 * GOOD:
 *   setItems(prev => [...prev.slice(-100), newItem]);
 *   setItems(prev => [...prev, newItem].slice(-MAX));
 *   setItems([...items(), newItem]); // Not updater pattern (still risky but different)
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByPrimitive } from "../../queries"
import { extractSignalDestructures } from "../util"

const messages = {
  unbounded:
    "Signal setter '{{name}}' accumulates data without bounds. The array grows monotonically via spread+append. Add truncation (e.g. prev.slice(-limit)) to prevent unbounded growth.",
} as const

const options = {}

/** Method names that indicate bounded/truncating behavior on an array */
const TRUNCATION_METHODS = new Set([
  "slice", "filter", "splice", "pop", "shift",
])

export const unboundedSignalAccumulation = defineSolidRule({
  id: "unbounded-signal-accumulation",
  severity: "warn",
  messages,
  meta: {
    description: "Detect signal setters that accumulate data without truncation via spread+append pattern.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const signalCalls = getCallsByPrimitive(graph, "createSignal")
    if (signalCalls.length === 0) return

    const destructures = extractSignalDestructures(signalCalls, graph)
    if (destructures.length === 0) return

    for (let i = 0, len = destructures.length; i < len; i++) {
      const d = destructures[i]
      if (!d) continue

      // Collect all reads: direct reads + reads of aliases (const add = setItems)
      const allReads = collectSetterReads(d.setterVariable)

      for (let j = 0, rlen = allReads.length; j < rlen; j++) {
        const readNode = allReads[j]
        if (!readNode) continue

        // Setter must be called: setItems(...)
        if (readNode.parent?.type !== "CallExpression") continue
        const callNode = readNode.parent

        // Must have exactly one argument (the updater callback)
        if (callNode.arguments.length !== 1) continue
        const arg = callNode.arguments[0]
        if (!arg) continue

        // Argument must be an arrow function or function expression
        if (arg.type !== "ArrowFunctionExpression" && arg.type !== "FunctionExpression") continue

        // Must have exactly one parameter (the prev value)
        if (arg.params.length !== 1) continue
        const param = arg.params[0]
        if (!param) continue
        if (param.type !== "Identifier") continue
        const paramName = param.name

        // Get the body expression
        const body = getBodyExpression(arg)
        if (!body) continue

        // Body must be an unbounded accumulation pattern:
        // 1. [...prev, x] — spread+append
        // 2. prev.concat(x) — concat method
        if (!isSpreadAppendPattern(body, paramName) && !isConcatPattern(body, paramName)) continue

        // Check if there's any truncation applied
        if (hasTruncation(callNode, body, paramName)) continue

        // Check if any other return path in the function body has truncation
        if (hasAlternateReturnWithTruncation(arg, paramName)) continue

        // Check if any sibling call site of the same setter uses truncation
        if (hasSiblingTruncation(allReads, callNode)) continue

        emit(
          createDiagnostic(
            graph.file,
            callNode,
            "unbounded-signal-accumulation",
            "unbounded",
            resolveMessage(messages.unbounded, { name: d.setterName }),
            "warn",
          ),
        )
      }
    }
  },
})

/**
 * Collect all read nodes for a setter variable, including reads through aliases.
 * An alias is created when the setter is assigned to another variable: const add = setItems
 */
function collectSetterReads(setter: VariableEntity): T.Node[] {
  const nodes: T.Node[] = []
  const reads = setter.reads

  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i]
    if (!read) continue
    const readNode = read.node
    const parent = readNode.parent

    // Check if this read is an alias assignment: const add = setItems
    if (parent?.type === "VariableDeclarator" && parent.init === readNode && parent.id.type === "Identifier") {
      // Find the alias variable's reads via its scope
      const scope = read.scope
      const vars = scope.variables
      for (let vi = 0, vlen = vars.length; vi < vlen; vi++) {
        const v = vars[vi]
        if (!v) continue
        if (v.name === parent.id.name) {
          const aliasReads = v.reads
          for (let ri = 0, rlen = aliasReads.length; ri < rlen; ri++) {
            const aliasRead = aliasReads[ri]
            if (!aliasRead) continue
            nodes.push(aliasRead.node)
          }
          break
        }
      }
      continue
    }

    nodes.push(readNode)
  }

  return nodes
}

/**
 * Check if any sibling call site of the same setter uses an updater callback
 * that contains a truncation method on its parameter.
 *
 * This catches patterns where accumulation and removal are split across
 * separate call sites — e.g. toast queues, pending-operation trackers,
 * keyboard key tracking — where one call appends and another filters.
 *
 * Only updater callbacks (arrow/function with exactly one param) count.
 * Direct-value resets like `setter([])` do NOT suppress the warning
 * because they represent manual actions, not automatic bounding.
 */
function hasSiblingTruncation(allReads: T.Node[], excludeCall: T.CallExpression): boolean {
  for (let i = 0, len = allReads.length; i < len; i++) {
    const readNode = allReads[i]
    if (!readNode) continue
    if (readNode.parent?.type !== "CallExpression") continue

    const siblingCall = readNode.parent
    if (siblingCall === excludeCall) continue
    if (siblingCall.arguments.length !== 1) continue

    const arg = siblingCall.arguments[0]
    if (!arg) continue
    if (arg.type !== "ArrowFunctionExpression" && arg.type !== "FunctionExpression") continue
    if (arg.params.length !== 1) continue

    const param = arg.params[0]
    if (!param) continue
    if (param.type !== "Identifier") continue

    if (updaterBodyHasTruncation(arg, param.name)) return true
  }

  return false
}

/**
 * Check if an updater function body contains any truncation method call
 * on the parameter. Walks through the body expression and all return
 * statements in block bodies.
 */
function updaterBodyHasTruncation(fn: T.ArrowFunctionExpression | T.FunctionExpression, paramName: string): boolean {
  // Expression body: prev => prev.filter(...)
  if (fn.type === "ArrowFunctionExpression" && fn.expression && fn.body.type !== "BlockStatement") {
    return expressionHasTruncation(fn.body, paramName)
  }

  // Block body: check all return statements
  if (fn.body.type === "BlockStatement") {
    return statementsHaveTruncationExpression(fn.body.body, paramName)
  }

  return false
}

/**
 * Check if an expression contains a truncation method call on a named identifier.
 * Handles direct calls (prev.filter(...)), chained results ([...prev].slice(-N)),
 * and ternary branches.
 */
function expressionHasTruncation(node: T.Expression, paramName: string): boolean {
  if (hasMethodCallOnIdentifier(node, paramName)) return true

  // Array expression with truncated spread: [...prev.filter(...), x]
  if (node.type === "ArrayExpression") {
    for (let i = 0, len = node.elements.length; i < len; i++) {
      const el = node.elements[i]
      if (el?.type === "SpreadElement" && hasMethodCallOnIdentifier(el.argument, paramName)) return true
    }
  }

  // Chained truncation: [...prev, x].slice(-N) or prev.concat(x).filter(...)
  if (node.type === "CallExpression" && node.callee.type === "MemberExpression") {
    const prop = node.callee.property
    if (prop.type === "Identifier" && TRUNCATION_METHODS.has(prop.name)) return true
  }

  // Ternary: condition ? prev.filter(...) : [...prev, x]
  if (node.type === "ConditionalExpression") {
    if (expressionHasTruncation(node.consequent, paramName)) return true
    if (expressionHasTruncation(node.alternate, paramName)) return true
  }

  return false
}

/**
 * Walk statements (including if-branches) looking for return statements
 * whose argument contains a truncation expression.
 */
function statementsHaveTruncationExpression(statements: readonly T.Statement[], paramName: string): boolean {
  for (let i = 0, len = statements.length; i < len; i++) {
    const stmt = statements[i]
    if (!stmt) continue
    if (stmt.type === "ReturnStatement" && stmt.argument && expressionHasTruncation(stmt.argument, paramName)) {
      return true
    }
    if (stmt.type === "IfStatement") {
      if (stmt.consequent.type === "BlockStatement") {
        if (statementsHaveTruncationExpression(stmt.consequent.body, paramName)) return true
      }
      if (stmt.consequent.type === "ReturnStatement" && stmt.consequent.argument && expressionHasTruncation(stmt.consequent.argument, paramName)) {
        return true
      }
      if (stmt.alternate) {
        if (stmt.alternate.type === "BlockStatement") {
          if (statementsHaveTruncationExpression(stmt.alternate.body, paramName)) return true
        }
        if (stmt.alternate.type === "ReturnStatement" && stmt.alternate.argument && expressionHasTruncation(stmt.alternate.argument, paramName)) {
          return true
        }
      }
    }
    // Expression statement: prev.filter(...) used as statement (unlikely but thorough)
    if (stmt.type === "ExpressionStatement" && expressionHasTruncation(stmt.expression, paramName)) {
      return true
    }
  }
  return false
}

/**
 * Extract the expression body from a function.
 * For arrow functions with expression bodies, returns the expression directly.
 * For block bodies, finds the last return statement with an argument.
 */
function getBodyExpression(fn: T.ArrowFunctionExpression | T.FunctionExpression): T.Expression | null {
  if (fn.type === "ArrowFunctionExpression" && fn.expression && fn.body.type !== "BlockStatement") {
    return fn.body
  }

  if (fn.body.type === "BlockStatement") {
    const statements = fn.body.body
    // Find the last return statement (the final return value)
    for (let i = statements.length - 1; i >= 0; i--) {
      const stmt = statements[i]
      if (!stmt) continue
      if (stmt.type === "ReturnStatement" && stmt.argument) {
        return stmt.argument
      }
    }
  }

  return null
}

/**
 * Check if an expression is the spread+append pattern: [...prev, item]
 * The array must contain a SpreadElement referencing paramName,
 * followed by one or more additional elements.
 */
function isSpreadAppendPattern(node: T.Expression, paramName: string): boolean {
  if (node.type !== "ArrayExpression") return false

  const elements = node.elements
  if (elements.length < 2) return false

  // Look for a SpreadElement of the param name
  let hasSpreadOfParam = false
  let spreadIndex = -1

  for (let i = 0, len = elements.length; i < len; i++) {
    const el = elements[i]
    if (el?.type === "SpreadElement" && isIdentifierOrCall(el.argument, paramName)) {
      hasSpreadOfParam = true
      spreadIndex = i
      break
    }
  }

  if (!hasSpreadOfParam) return false

  // Must have at least one element after (or before) the spread that isn't a spread of param
  // Common: [...prev, newItem] or [newItem, ...prev]
  return elements.length > 1 && spreadIndex >= 0
}

/**
 * Check if a node is an identifier with the given name.
 * Only plain identifiers count for the unbounded spread check.
 */
function isIdentifierOrCall(node: T.Expression, name: string): boolean {
  if (node.type === "Identifier" && node.name === name) return true
  return false
}

/**
 * Check if an expression is the concat pattern: prev.concat(x)
 */
function isConcatPattern(node: T.Expression, paramName: string): boolean {
  if (node.type !== "CallExpression") return false
  if (node.callee.type !== "MemberExpression") return false

  const obj = node.callee.object
  if (obj.type !== "Identifier" || obj.name !== paramName) return false

  const prop = node.callee.property
  if (prop.type !== "Identifier" || prop.name !== "concat") return false

  return node.arguments.length > 0
}

/**
 * Check if there is any truncation applied to either:
 * 1. The spread source: [...prev.slice(-100), x]
 * 2. The result: used in a chain like setItems(prev => [...prev, x].slice(-100))
 * 3. The call result is chained (parent is MemberExpression calling slice etc.)
 */
function hasTruncation(_callNode: T.CallExpression, body: T.Expression, paramName: string): boolean {
  // Check if any spread element in the array uses a method call on param
  // e.g. [...prev.slice(-100), x]
  if (body.type === "ArrayExpression") {
    for (let i = 0, len = body.elements.length; i < len; i++) {
      const el = body.elements[i]
      if (el?.type === "SpreadElement" && hasMethodCallOnIdentifier(el.argument, paramName)) {
        return true
      }
    }
  }

  // Check if the array result is chained: [...prev, x].slice(-100)
  // The body itself would be a CallExpression with array as callee object
  if (body.type === "CallExpression" && body.callee.type === "MemberExpression") {
    const prop = body.callee.property
    if (prop.type === "Identifier" && TRUNCATION_METHODS.has(prop.name)) {
      return true
    }
  }

  return false
}

/**
 * Check if a block-bodied function has any return statement that contains a
 * truncation method call on the parameter. Looks inside if-statement branches
 * to catch multi-return patterns like:
 *   if (prev.length > 100) return prev.slice(-50);
 *   return [...prev, "new"];
 */
function hasAlternateReturnWithTruncation(
  fn: T.ArrowFunctionExpression | T.FunctionExpression,
  paramName: string,
): boolean {
  if (fn.body.type !== "BlockStatement") return false
  return statementsHaveTruncationReturn(fn.body.body, paramName)
}

function statementsHaveTruncationReturn(statements: readonly T.Statement[], paramName: string): boolean {
  for (let i = 0, len = statements.length; i < len; i++) {
    const stmt = statements[i]
    if (!stmt) continue
    if (stmt.type === "ReturnStatement" && stmt.argument && returnHasTruncation(stmt.argument, paramName)) {
      return true
    }
    // Look inside if-statement branches
    if (stmt.type === "IfStatement") {
      if (stmt.consequent.type === "BlockStatement") {
        if (statementsHaveTruncationReturn(stmt.consequent.body, paramName)) return true
      }
      if (stmt.consequent.type === "ReturnStatement" && stmt.consequent.argument && returnHasTruncation(stmt.consequent.argument, paramName)) {
        return true
      }
      if (stmt.alternate) {
        if (stmt.alternate.type === "BlockStatement") {
          if (statementsHaveTruncationReturn(stmt.alternate.body, paramName)) return true
        }
        if (stmt.alternate.type === "ReturnStatement" && stmt.alternate.argument && returnHasTruncation(stmt.alternate.argument, paramName)) {
          return true
        }
      }
    }
  }
  return false
}

function returnHasTruncation(arg: T.Expression, paramName: string): boolean {
  // Direct truncation: return prev.slice(-50)
  if (hasMethodCallOnIdentifier(arg, paramName)) return true
  // Array with truncation: return [...prev.slice(-50), x]
  if (arg.type === "ArrayExpression") {
    for (let j = 0, elen = arg.elements.length; j < elen; j++) {
      const el = arg.elements[j]
      if (el?.type === "SpreadElement" && hasMethodCallOnIdentifier(el.argument, paramName)) {
        return true
      }
    }
  }
  // Chained truncation: return [...prev, x].slice(-50)
  if (arg.type === "CallExpression" && arg.callee.type === "MemberExpression") {
    const prop = arg.callee.property
    if (prop.type === "Identifier" && TRUNCATION_METHODS.has(prop.name)) return true
  }
  return false
}

/**
 * Check if a node is a method call on a named identifier, e.g. prev.slice(-100).
 */
function hasMethodCallOnIdentifier(node: T.Expression, name: string): boolean {
  if (node.type !== "CallExpression") return false
  if (node.callee.type !== "MemberExpression") return false

  const object = node.callee.object
  if (object.type !== "Identifier" || object.name !== name) return false

  const prop = node.callee.property
  if (prop.type !== "Identifier") return false

  return TRUNCATION_METHODS.has(prop.name)
}
