/**
 * Flags new Array(n) without fill which creates holey arrays in V8.
 *
 * Exempts two intentional patterns:
 * - Immediate sequential fill: `const a = new Array(n); for (...) a[i] = ...`
 * - Pre-allocated buffer: `const/let buf = new Array(256)` outside loops
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic"
import { isInLoop } from "../../util/expression"
import { findContainingVariableDeclarator } from "../../util/pattern-detection"

const SCREAMING_SNAKE = /^[A-Z][A-Z0-9_]*$/

const messages = {
  sparseArray: "new Array(n) creates a holey array. Use Array.from() or .fill() instead.",
} as const

const options = {}

export const avoidSparseArrays = defineSolidRule({
  id: "avoid-sparse-arrays",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow new Array(n) without fill (creates holey array).",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const constructors = graph.newExpressionsByCallee.get("Array")
    if (!constructors || constructors.length === 0) return

    for (let i = 0, len = constructors.length; i < len; i++) {
      const expr = constructors[i]
      if (!expr) continue;
      const args = expr.arguments
      if (!args || args.length !== 1) continue

      const arg = args[0]
      if (!arg) continue

      const numeric = ts.isNumericLiteral(arg)
      const variable = ts.isIdentifier(arg)
      if (!numeric && !variable) continue
      if (numeric && Number(arg.text) === 0) continue

      if (hasChainedFill(expr)) continue
      if (isFilledByNextForLoop(expr)) continue
      if (isFixedCapacityBuffer(expr, arg)) continue

      emit(
        createDiagnostic(graph.filePath, expr, graph.sourceFile, "avoid-sparse-arrays", "sparseArray", messages.sparseArray, "warn"),
      )
    }
  },
})

/** `new Array(n).fill(...)` — parent or grandparent is a .fill member/call. */
function hasChainedFill(expr: ts.NewExpression): boolean {
  const parent = expr.parent
  if (!parent) return false

  if (ts.isPropertyAccessExpression(parent) &&
      parent.expression === expr &&
      parent.name.text === "fill") {
    return true
  }

  if (ts.isCallExpression(parent) &&
      ts.isPropertyAccessExpression(parent.expression) &&
      parent.expression.name.text === "fill") {
    return true
  }

  return false
}

/**
 * `const r = new Array(n); for (...) r[i] = ...` — the very next sibling
 * statement is a for-loop that index-assigns into the same variable.
 */
function isFilledByNextForLoop(expr: ts.NewExpression): boolean {
  const declarator = findContainingVariableDeclarator(expr)
  if (!declarator) return false
  if (!ts.isIdentifier(declarator.name)) return false

  const decl = declarator.parent
  if (!decl || !ts.isVariableDeclarationList(decl)) return false

  const declStatement = decl.parent
  if (!declStatement || !ts.isVariableStatement(declStatement)) return false

  const block = declStatement.parent
  if (!block) return false
  if (!ts.isBlock(block) && !ts.isSourceFile(block)) return false

  const body = block.statements
  let idx = -1
  for (let j = 0; j < body.length; j++) {
    if (body[j] === declStatement) { idx = j; break }
  }
  if (idx < 0 || idx + 1 >= body.length) return false

  const next = body[idx + 1]
  if (!next) return false
  if (!ts.isForStatement(next)) return false

  return forBodyIndexAssigns(next.statement, declarator.name.text)
}

/** Scans a for-loop body for `name[expr] = expr`. */
function forBodyIndexAssigns(body: ts.Statement, name: string): boolean {
  if (ts.isExpressionStatement(body)) return isIndexAssignment(body.expression, name)

  if (ts.isBlock(body)) {
    const stmts = body.statements
    for (let i = 0, len = stmts.length; i < len; i++) {
      const s = stmts[i]
      if (!s) continue;
      if (ts.isExpressionStatement(s) && isIndexAssignment(s.expression, name)) {
        return true
      }
    }
  }

  return false
}

/** `name[expr] = expr` */
function isIndexAssignment(node: ts.Expression, name: string): boolean {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false
  const left = node.left
  return ts.isElementAccessExpression(left) &&
         ts.isIdentifier(left.expression) &&
         left.expression.text === name
}

/**
 * `const/let buf = new Array(256)` or `new Array(CAPACITY)` outside loops.
 *
 * A fixed-capacity buffer declared at function/module scope is intentional
 * pre-allocation with manual index management.
 */
function isFixedCapacityBuffer(expr: ts.NewExpression, arg: ts.Node): boolean {
  if (!isConstantSize(arg)) return false

  const declarator = findContainingVariableDeclarator(expr)
  if (!declarator) return false

  const decl = declarator.parent
  if (!decl || !ts.isVariableDeclarationList(decl)) return false

  const declStatement = decl.parent
  if (!declStatement || !ts.isVariableStatement(declStatement)) return false

  return !isInLoop(declStatement)
}

/** Numeric literal or SCREAMING_SNAKE_CASE identifier. */
function isConstantSize(node: ts.Node): boolean {
  if (ts.isNumericLiteral(node)) return true
  if (ts.isIdentifier(node) && SCREAMING_SNAKE.test(node.text)) return true
  return false
}
