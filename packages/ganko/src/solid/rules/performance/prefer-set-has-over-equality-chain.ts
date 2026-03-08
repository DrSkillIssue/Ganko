/**
 * Flags functions with 4+ guard-style equality checks on the same variable
 * where every check leads to the same outcome (return true/false, continue, break).
 *
 * Only flags membership-test patterns like:
 *   if (x === "a") return true;
 *   if (x === "b") return true;
 *   if (x === "c") return true;
 *   if (x === "d") return true;
 *
 * Does NOT flag pattern-match/mapping patterns where each branch has different logic.
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getContainingFunction, iterateVariables } from "../../queries"

const messages = {
  equalityChain:
    "{{count}} equality checks against `{{name}}`. Extract literals to a Set and use .has() instead.",
} as const

const options = {}

const THRESHOLD = 4

/**
 * Describes the outcome of a guard-style if-statement body.
 * Used to determine if all equality checks lead to the same result.
 */
type GuardOutcome = string | null

/**
 * Checks if a read is part of a guard-style membership test:
 *   if (x === "literal") return <value>;
 *   if (x === "literal") continue;
 *   if (x === "literal") break;
 *
 * Returns a string key describing the outcome (e.g., "return:true", "continue")
 * or null if the pattern doesn't match.
 *
 * @param node - The read's identifier node
 * @returns The outcome key, or null if not a guard pattern
 */
function getGuardOutcome(node: T.Node): GuardOutcome {
  const parent = node.parent
  if (!parent) return null
  if (parent.type !== "BinaryExpression") return null
  if (parent.operator !== "===" && parent.operator !== "!==") return null

  const other = parent.left === node ? parent.right : parent.left
  if (other.type !== "Literal") return null
  if (typeof other.value !== "string") return null

  // Walk up to find the if-statement this check controls
  const ifStmt = findGuardIf(parent)
  if (!ifStmt) return null

  // The if body must be a single statement
  const body = ifStmt.consequent
  const stmt = body.type === "BlockStatement"
    ? (body.body.length === 1 ? body.body[0] : null)
    : body
  if (!stmt) return null

  // Classify the outcome
  if (stmt.type === "ReturnStatement") {
    const arg = stmt.argument
    if (!arg) return "return:void"
    if (arg.type === "Literal") return `return:${String(arg.value)}`
    return "return:expr"
  }
  if (stmt.type === "ContinueStatement") return "continue"
  if (stmt.type === "BreakStatement") return "break"

  return null
}

/**
 * Finds the nearest ancestor IfStatement where the BinaryExpression is the
 * direct test (or connected via LogicalExpression || chain with other checks
 * on the same variable — but we keep it strict: the BinaryExpression must
 * be the sole test of the if-statement).
 */
function findGuardIf(expr: T.BinaryExpression): T.IfStatement | null {
  const parent = expr.parent
  if (!parent) return null
  if (parent.type === "IfStatement" && parent.test === expr) return parent

  if (parent.type === "UnaryExpression" && parent.operator === "!") {
    const maybeIf = parent.parent
    if (maybeIf && maybeIf.type === "IfStatement" && isDirectUnaryTest(maybeIf.test, expr)) {
      return maybeIf
    }
  }

  return null
}

/**
 * Checks if the if-test is `!expr` where expr is our binary expression.
 */
function isDirectUnaryTest(test: T.Expression, expr: T.BinaryExpression): boolean {
  return test.type === "UnaryExpression" && test.operator === "!" && test.argument === expr
}

export const preferSetHasOverEqualityChain = defineSolidRule({
  id: "prefer-set-has-over-equality-chain",
  severity: "warn",
  messages,
  meta: {
    description: "Disallow 4+ guard-style equality checks against string literals on the same variable. Use a Set.",
    fixable: false,
    category: "performance",
  },
  options,

  check(graph, emit) {
    const reported = new Set<string>()

    for (const variable of iterateVariables(graph)) {
      const reads = variable.reads
      if (reads.length < THRESHOLD) continue

      // Group guard-pattern reads by enclosing function AND outcome
      const byFunction = new Map<string, Map<string, T.Node[]>>()

      for (let i = 0, len = reads.length; i < len; i++) {
        const read = reads[i]
        if (!read) continue
        const node = read.node
        const outcome = getGuardOutcome(node)
        if (!outcome) continue

        const fn = getContainingFunction(graph, node)
        if (!fn) continue
        const functionKey = `fn:${fn.id}`

        let byOutcome = byFunction.get(functionKey)
        if (!byOutcome) {
          byOutcome = new Map()
          byFunction.set(functionKey, byOutcome)
        }

        let nodes = byOutcome.get(outcome)
        if (!nodes) {
          nodes = []
          byOutcome.set(outcome, nodes)
        }
        nodes.push(node)
      }

      for (const [functionKey, byOutcome] of byFunction) {
        for (const [, nodes] of byOutcome) {
          if (nodes.length < THRESHOLD) continue

          const key = `${functionKey}:var:${variable.id}`
          if (reported.has(key)) continue
          reported.add(key)

          const firstNode = nodes[0]
          if (!firstNode) continue

          emit(
            createDiagnostic(
              graph.file,
              firstNode,
              "prefer-set-has-over-equality-chain",
              "equalityChain",
              resolveMessage(messages.equalityChain, {
                count: String(nodes.length),
                name: variable.name,
              }),
              "warn",
            ),
          )
        }
      }
    }
  },
})
