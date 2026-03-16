/**
 * String Concat In Loop Rule
 *
 * Flags string concatenation using `+=` inside loops.
 * Collect into an array and join at the end instead.
 */

import ts from "typescript"
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
    if (!ts.isIdentifier(decl)) continue
    if (!decl.parent || !ts.isVariableDeclaration(decl.parent)) continue

    const init = decl.parent.initializer
    if (!init) continue

    if (typeIncludesString(graph, init)) return true
    if (ts.isStringLiteral(init)) return true
    if (ts.isTemplateExpression(init) || ts.isNoSubstitutionTemplateLiteral(init)) return true
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
    if (!ts.isIdentifier(decl)) continue

    const declarator = decl.parent
    if (!declarator || !ts.isVariableDeclaration(declarator)) continue

    const varDeclList = declarator.parent
    if (!varDeclList || !ts.isVariableDeclarationList(varDeclList)) continue

    const varStatement = varDeclList.parent
    if (!varStatement || !ts.isVariableStatement(varStatement)) continue

    return !isInLoop(varStatement)
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
        if (assignment.operator !== ts.SyntaxKind.PlusEqualsToken) continue
        if (!assignment.isInLoop) continue

        const node = assignment.node
        if (ts.isBinaryExpression(node)) {
          emit(createDiagnostic(graph.file, node, graph.sourceFile, "string-concat-in-loop", "stringConcatInLoop", messages.stringConcatInLoop, "error"))
        }
      }
    }
  },
})
