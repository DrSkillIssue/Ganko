/**
 * String Concat In Loop Rule
 *
 * Flags string concatenation using `+=` inside loops.
 * Collect into an array and join at the end instead.
 */

import type { SolidGraph } from "../../impl"
import { defineSolidRule } from "../../rule"
import { createDiagnostic } from "../../../diagnostic";
import type { VariableEntity } from "../../entities/variable"
import { typeIncludesString, iterateVariables } from "../../queries"
import { isInLoop } from "../../util"

/**
 * Checks if a variable is a string type.
 *
 * @param variable - The variable entity to check
 * @param graph - The solid graph for type resolution
 * @returns True if the variable is a string type
 */
function isStringVariable(variable: VariableEntity, graph: SolidGraph): boolean {
  const declarations = variable.declarations

  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i]
    if (!decl) continue;
    if (decl.type !== "Identifier") continue
    if (decl.parent?.type !== "VariableDeclarator") continue

    const init = decl.parent.init
    if (!init) continue

    if (typeIncludesString(graph, init)) return true
    if (init.type === "Literal" && typeof init.value === "string") return true
    if (init.type === "TemplateLiteral") return true
  }
  return false
}

/**
 * Checks if a variable is declared outside any loop construct.
 *
 * @param variable - The variable entity to check
 * @returns True if declared outside loops
 */
function isDeclaredOutsideLoop(variable: VariableEntity): boolean {
  const declarations = variable.declarations
  if (declarations.length === 0) return false

  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i]
    if (!decl) continue;
    if (decl.type !== "Identifier") continue

    const declarator = decl.parent
    if (declarator?.type !== "VariableDeclarator") continue

    const varDecl = declarator.parent
    if (varDecl?.type !== "VariableDeclaration") continue

    return !isInLoop(varDecl)
  }
  return true
}

const messages = {
  stringConcatInLoop:
    "Avoid string concatenation with += inside loops. Use an array with .push() and .join() instead.",
} as const

const options = {}

export const stringConcatInLoop = defineSolidRule({
  id: "string-concat-in-loop",
  severity: "error",
  messages,
  meta: {
    description:
      "Disallow string concatenation with += inside loops. Use array.push() and .join() instead.",
    fixable: false,
    category: "correctness",
  },
  options,
  check(graph, emit) {
    for (const variable of iterateVariables(graph)) {
      if (!isStringVariable(variable, graph)) continue
      if (!isDeclaredOutsideLoop(variable)) continue

      const assignments = variable.assignments
      for (let i = 0; i < assignments.length; i++) {
        const assignment = assignments[i]
        if (!assignment) continue;
        if (assignment.operator !== "+=") continue
        if (!assignment.isInLoop) continue

        const parent = assignment.node.parent
        if (parent?.type === "AssignmentExpression") {
          emit(createDiagnostic(graph.file, parent, "string-concat-in-loop", "stringConcatInLoop", messages.stringConcatInLoop, "error"))
        }
      }
    }
  },
})
