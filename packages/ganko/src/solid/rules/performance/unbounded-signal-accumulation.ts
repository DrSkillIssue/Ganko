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

import ts from "typescript"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByPrimitive } from "../../queries"
import { extractSignalDestructures, getFunctionBodyExpression } from "../util"

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
        if (!readNode.parent || !ts.isCallExpression(readNode.parent)) continue
        const callNode = readNode.parent

        // Must have exactly one argument (the updater callback)
        if (callNode.arguments.length !== 1) continue
        const arg = callNode.arguments[0]
        if (!arg) continue

        // Argument must be an arrow function or function expression
        if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue

        // Must have exactly one parameter (the prev value)
        if (arg.parameters.length !== 1) continue
        const param = arg.parameters[0]
        if (!param) continue
        if (!ts.isIdentifier(param.name)) continue
        const paramName = param.name.text

        // Get the body expression
        const body = getFunctionBodyExpression(arg)
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
            graph.filePath,
            callNode,
            graph.sourceFile,
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
function collectSetterReads(setter: VariableEntity): ts.Node[] {
  const nodes: ts.Node[] = []
  const reads = setter.reads

  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i]
    if (!read) continue
    const readNode = read.node
    const parent = readNode.parent

    // Check if this read is an alias assignment: const add = setItems
    if (parent && ts.isVariableDeclaration(parent) && parent.initializer === readNode && ts.isIdentifier(parent.name)) {
      // Find the alias variable's reads via its scope
      const scope = read.scope
      const vars = scope.variables
      for (let vi = 0, vlen = vars.length; vi < vlen; vi++) {
        const v = vars[vi]
        if (!v) continue
        if (v.name === parent.name.text) {
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
function hasSiblingTruncation(allReads: ts.Node[], excludeCall: ts.CallExpression): boolean {
  for (let i = 0, len = allReads.length; i < len; i++) {
    const readNode = allReads[i]
    if (!readNode) continue
    if (!readNode.parent || !ts.isCallExpression(readNode.parent)) continue

    const siblingCall = readNode.parent
    if (siblingCall === excludeCall) continue
    if (siblingCall.arguments.length !== 1) continue

    const arg = siblingCall.arguments[0]
    if (!arg) continue
    if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue
    if (arg.parameters.length !== 1) continue

    const param = arg.parameters[0]
    if (!param) continue
    if (!ts.isIdentifier(param.name)) continue

    if (updaterBodyHasTruncation(arg, param.name.text)) return true
  }

  return false
}

/**
 * Check if an updater function body contains any truncation method call
 * on the parameter. Walks through the body expression and all return
 * statements in block bodies.
 */
function updaterBodyHasTruncation(fn: ts.ArrowFunction | ts.FunctionExpression, paramName: string): boolean {
  // Expression body: prev => prev.filter(...)
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
    return expressionHasTruncation(fn.body, paramName)
  }

  // Block body: check all return statements
  const body = ts.isArrowFunction(fn) ? fn.body : fn.body
  if (ts.isBlock(body)) {
    return statementsHaveTruncationExpression(body.statements, paramName)
  }

  return false
}

/**
 * Check if an expression contains a truncation method call on a named identifier.
 * Handles direct calls (prev.filter(...)), chained results ([...prev].slice(-N)),
 * and ternary branches.
 */
function expressionHasTruncation(node: ts.Expression, paramName: string): boolean {
  if (hasMethodCallOnIdentifier(node, paramName)) return true

  // Array expression with truncated spread: [...prev.filter(...), x]
  if (ts.isArrayLiteralExpression(node)) {
    for (let i = 0, len = node.elements.length; i < len; i++) {
      const el = node.elements[i]
      if (el && ts.isSpreadElement(el) && hasMethodCallOnIdentifier(el.expression, paramName)) return true
    }
  }

  // Chained truncation: [...prev, x].slice(-N) or prev.concat(x).filter(...)
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const prop = node.expression.name
    if (ts.isIdentifier(prop) && TRUNCATION_METHODS.has(prop.text)) return true
  }

  // Ternary: condition ? prev.filter(...) : [...prev, x]
  if (ts.isConditionalExpression(node)) {
    if (expressionHasTruncation(node.whenTrue, paramName)) return true
    if (expressionHasTruncation(node.whenFalse, paramName)) return true
  }

  return false
}

/**
 * Walk statements (including if-branches) looking for return statements
 * whose argument contains a truncation expression.
 */
function statementsHaveTruncationExpression(statements: ts.NodeArray<ts.Statement> | readonly ts.Statement[], paramName: string): boolean {
  for (let i = 0, len = statements.length; i < len; i++) {
    const stmt = statements[i]
    if (!stmt) continue
    if (ts.isReturnStatement(stmt) && stmt.expression && expressionHasTruncation(stmt.expression, paramName)) {
      return true
    }
    if (ts.isIfStatement(stmt)) {
      if (ts.isBlock(stmt.thenStatement)) {
        if (statementsHaveTruncationExpression(stmt.thenStatement.statements, paramName)) return true
      }
      if (ts.isReturnStatement(stmt.thenStatement) && stmt.thenStatement.expression && expressionHasTruncation(stmt.thenStatement.expression, paramName)) {
        return true
      }
      if (stmt.elseStatement) {
        if (ts.isBlock(stmt.elseStatement)) {
          if (statementsHaveTruncationExpression(stmt.elseStatement.statements, paramName)) return true
        }
        if (ts.isReturnStatement(stmt.elseStatement) && stmt.elseStatement.expression && expressionHasTruncation(stmt.elseStatement.expression, paramName)) {
          return true
        }
      }
    }
    // Expression statement: prev.filter(...) used as statement (unlikely but thorough)
    if (ts.isExpressionStatement(stmt) && expressionHasTruncation(stmt.expression, paramName)) {
      return true
    }
  }
  return false
}

/**
 * Check if an expression is the spread+append pattern: [...prev, item]
 * The array must contain a SpreadElement referencing paramName,
 * followed by one or more additional elements.
 */
function isSpreadAppendPattern(node: ts.Expression, paramName: string): boolean {
  if (!ts.isArrayLiteralExpression(node)) return false

  const elements = node.elements
  if (elements.length < 2) return false

  // Look for a SpreadElement of the param name
  let hasSpreadOfParam = false
  let spreadIndex = -1

  for (let i = 0, len = elements.length; i < len; i++) {
    const el = elements[i]
    if (el && ts.isSpreadElement(el) && isIdentifierOrCall(el.expression, paramName)) {
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
function isIdentifierOrCall(node: ts.Expression, name: string): boolean {
  if (ts.isIdentifier(node) && node.text === name) return true
  return false
}

/**
 * Check if an expression is the concat pattern: prev.concat(x)
 */
function isConcatPattern(node: ts.Expression, paramName: string): boolean {
  if (!ts.isCallExpression(node)) return false
  if (!ts.isPropertyAccessExpression(node.expression)) return false

  const obj = node.expression.expression
  if (!ts.isIdentifier(obj) || obj.text !== paramName) return false

  const prop = node.expression.name
  if (!ts.isIdentifier(prop) || prop.text !== "concat") return false

  return node.arguments.length > 0
}

/**
 * Check if there is any truncation applied to either:
 * 1. The spread source: [...prev.slice(-100), x]
 * 2. The result: used in a chain like setItems(prev => [...prev, x].slice(-100))
 * 3. The call result is chained (parent is PropertyAccessExpression calling slice etc.)
 */
function hasTruncation(_callNode: ts.CallExpression, body: ts.Expression, paramName: string): boolean {
  // Check if any spread element in the array uses a method call on param
  // e.g. [...prev.slice(-100), x]
  if (ts.isArrayLiteralExpression(body)) {
    for (let i = 0, len = body.elements.length; i < len; i++) {
      const el = body.elements[i]
      if (el && ts.isSpreadElement(el) && hasMethodCallOnIdentifier(el.expression, paramName)) {
        return true
      }
    }
  }

  // Check if the array result is chained: [...prev, x].slice(-100)
  // The body itself would be a CallExpression with array as callee object
  if (ts.isCallExpression(body) && ts.isPropertyAccessExpression(body.expression)) {
    const prop = body.expression.name
    if (ts.isIdentifier(prop) && TRUNCATION_METHODS.has(prop.text)) {
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
  fn: ts.ArrowFunction | ts.FunctionExpression,
  paramName: string,
): boolean {
  const body = ts.isArrowFunction(fn) ? fn.body : fn.body
  if (!ts.isBlock(body)) return false
  return statementsHaveTruncationReturn(body.statements, paramName)
}

function statementsHaveTruncationReturn(statements: ts.NodeArray<ts.Statement> | readonly ts.Statement[], paramName: string): boolean {
  for (let i = 0, len = statements.length; i < len; i++) {
    const stmt = statements[i]
    if (!stmt) continue
    if (ts.isReturnStatement(stmt) && stmt.expression && returnHasTruncation(stmt.expression, paramName)) {
      return true
    }
    // Look inside if-statement branches
    if (ts.isIfStatement(stmt)) {
      if (ts.isBlock(stmt.thenStatement)) {
        if (statementsHaveTruncationReturn(stmt.thenStatement.statements, paramName)) return true
      }
      if (ts.isReturnStatement(stmt.thenStatement) && stmt.thenStatement.expression && returnHasTruncation(stmt.thenStatement.expression, paramName)) {
        return true
      }
      if (stmt.elseStatement) {
        if (ts.isBlock(stmt.elseStatement)) {
          if (statementsHaveTruncationReturn(stmt.elseStatement.statements, paramName)) return true
        }
        if (ts.isReturnStatement(stmt.elseStatement) && stmt.elseStatement.expression && returnHasTruncation(stmt.elseStatement.expression, paramName)) {
          return true
        }
      }
    }
  }
  return false
}

function returnHasTruncation(arg: ts.Expression, paramName: string): boolean {
  // Direct truncation: return prev.slice(-50)
  if (hasMethodCallOnIdentifier(arg, paramName)) return true
  // Array with truncation: return [...prev.slice(-50), x]
  if (ts.isArrayLiteralExpression(arg)) {
    for (let j = 0, elen = arg.elements.length; j < elen; j++) {
      const el = arg.elements[j]
      if (el && ts.isSpreadElement(el) && hasMethodCallOnIdentifier(el.expression, paramName)) {
        return true
      }
    }
  }
  // Chained truncation: return [...prev, x].slice(-50)
  if (ts.isCallExpression(arg) && ts.isPropertyAccessExpression(arg.expression)) {
    const prop = arg.expression.name
    if (ts.isIdentifier(prop) && TRUNCATION_METHODS.has(prop.text)) return true
  }
  return false
}

/**
 * Check if a node is a method call on a named identifier, e.g. prev.slice(-100).
 */
function hasMethodCallOnIdentifier(node: ts.Expression, name: string): boolean {
  if (!ts.isCallExpression(node)) return false
  if (!ts.isPropertyAccessExpression(node.expression)) return false

  const object = node.expression.expression
  if (!ts.isIdentifier(object) || object.text !== name) return false

  const prop = node.expression.name
  if (!ts.isIdentifier(prop)) return false

  return TRUNCATION_METHODS.has(prop.text)
}
