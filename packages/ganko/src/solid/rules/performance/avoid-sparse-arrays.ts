/**
 * Flags new Array(n) without fill which creates holey arrays in V8.
 *
 * Exempts two intentional patterns:
 * - Immediate sequential fill: `const a = new Array(n); for (...) a[i] = ...`
 * - Pre-allocated buffer: `const/let buf = new Array(256)` outside loops
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
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
      if (args.length !== 1) continue

      const arg = args[0]
      if (!arg) continue

      const numeric = arg.type === "Literal" && typeof arg.value === "number"
      const variable = arg.type === "Identifier"
      if (!numeric && !variable) continue
      if (numeric && arg.value === 0) continue

      if (hasChainedFill(expr)) continue
      if (isFilledByNextForLoop(expr)) continue
      if (isFixedCapacityBuffer(expr, arg)) continue

      emit(
        createDiagnostic(graph.file, expr, "avoid-sparse-arrays", "sparseArray", messages.sparseArray, "warn"),
      )
    }
  },
})

/** `new Array(n).fill(...)` — parent or grandparent is a .fill member/call. */
function hasChainedFill(expr: T.NewExpression): boolean {
  const parent = expr.parent
  if (!parent) return false

  if (parent.type === "MemberExpression" &&
      parent.object === expr &&
      parent.property.type === "Identifier" &&
      parent.property.name === "fill") {
    return true
  }

  if (parent.type === "CallExpression" &&
      parent.callee.type === "MemberExpression" &&
      parent.callee.property.type === "Identifier" &&
      parent.callee.property.name === "fill") {
    return true
  }

  return false
}

/**
 * `const r = new Array(n); for (...) r[i] = ...` — the very next sibling
 * statement is a for-loop that index-assigns into the same variable.
 */
function isFilledByNextForLoop(expr: T.NewExpression): boolean {
  const declarator = findContainingVariableDeclarator(expr)
  if (!declarator) return false
  if (declarator.id.type !== "Identifier") return false

  const decl = declarator.parent
  if (!decl || decl.type !== "VariableDeclaration") return false

  const block = decl.parent
  if (!block) return false
  if (block.type !== "BlockStatement" && block.type !== "Program") return false

  const body = block.body
  const idx = body.indexOf(decl)
  if (idx < 0 || idx + 1 >= body.length) return false

  const next = body[idx + 1]
  if (!next) return false
  if (next.type !== "ForStatement") return false

  return forBodyIndexAssigns(next.body, declarator.id.name)
}

/** Scans a for-loop body for `name[expr] = expr`. */
function forBodyIndexAssigns(body: T.Statement, name: string): boolean {
  if (body.type === "ExpressionStatement") return isIndexAssignment(body.expression, name)

  if (body.type === "BlockStatement") {
    const stmts = body.body
    for (let i = 0, len = stmts.length; i < len; i++) {
      const s = stmts[i]
      if (!s) continue;
      if (s.type === "ExpressionStatement" && isIndexAssignment(s.expression, name)) {
        return true
      }
    }
  }

  return false
}

/** `name[expr] = expr` */
function isIndexAssignment(node: T.Expression, name: string): boolean {
  if (node.type !== "AssignmentExpression" || node.operator !== "=") return false
  const left = node.left
  return left.type === "MemberExpression" &&
         left.computed &&
         left.object.type === "Identifier" &&
         left.object.name === name
}

/**
 * `const/let buf = new Array(256)` or `new Array(CAPACITY)` outside loops.
 *
 * A fixed-capacity buffer declared at function/module scope is intentional
 * pre-allocation with manual index management.
 */
function isFixedCapacityBuffer(expr: T.NewExpression, arg: T.Node): boolean {
  if (!isConstantSize(arg)) return false

  const declarator = findContainingVariableDeclarator(expr)
  if (!declarator) return false

  const decl = declarator.parent
  if (!decl || decl.type !== "VariableDeclaration") return false

  return !isInLoop(decl)
}

/** Numeric literal or SCREAMING_SNAKE_CASE identifier. */
function isConstantSize(node: T.Node): boolean {
  if (node.type === "Literal" && typeof node.value === "number") return true
  if (node.type === "Identifier" && SCREAMING_SNAKE.test(node.name)) return true
  return false
}
