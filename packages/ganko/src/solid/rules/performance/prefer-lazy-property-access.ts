/**
 * Flags property access assigned to a variable at function start.
 * Only flags when the function has early returns AND the variable
 * is not read before or within the first early return context.
 */

import ts from "typescript"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import type { SolidGraph } from "../../impl"
import type { VariableEntity } from "../../entities/variable"
import type { FunctionEntity } from "../../entities/function"
import type { ReturnStatementEntity } from "../../entities/return-statement"
import { getContainingFunction, getEarlyReturns } from "../../queries/entity"
import { getVariablesWithPropertyAssignment } from "../../queries/get"

const messages = {
  preferLazyPropertyAccess:
    "Property '{{propertyName}}' assigned to '{{variableName}}' before early return but not used there. Move assignment after early returns.",
} as const;

const options = {};

/**
 * Extracts the property name from a variable's PropertyAccessExpression assignment.
 *
 * @param variable - The VariableEntity to extract from
 * @returns The property name as a string, or "property" if not extractable
 */
function getPropertyName(variable: VariableEntity): string {
  const value = variable.initializer
  if (!value || !ts.isPropertyAccessExpression(value)) return "property"

  const property = value.name
  if (ts.isIdentifier(property)) return property.text

  return "property"
}

function getContainingIfStatement(ret: ts.ReturnStatement): ts.IfStatement | null {
  const parent = ret.parent
  if (!parent) return null

  if (ts.isIfStatement(parent) && parent.thenStatement === ret) {
    return parent
  }

  if (!ts.isBlock(parent)) return null
  const maybeIf = parent.parent
  if (!maybeIf || !ts.isIfStatement(maybeIf)) return null
  if (maybeIf.thenStatement !== parent) return null
  return maybeIf
}

/**
 * Checks if any read of the variable occurs before the earliest early-return
 * context, or within any IfStatement that wraps an early return.
 *
 * A read inside `if (cond) { return expr_using_variable; }` has a position
 * after the IfStatement start but is semantically part of the early-return
 * path — the variable IS needed there.
 */
function hasReadInEarlyReturnContext(
  variable: VariableEntity,
  earlyReturns: readonly ReturnStatementEntity[],
  assignmentPos: number,
): boolean {
  const reads = variable.reads

  const ifRanges: Array<readonly [number, number]> = []
  let earliest = Infinity

  for (let i = 0, len = earlyReturns.length; i < len; i++) {
    const ret = earlyReturns[i];
    if (!ret) continue;
    const ifStmt = getContainingIfStatement(ret.node)
    if (ifStmt) {
      const range: readonly [number, number] = [ifStmt.pos, ifStmt.end]
      ifRanges.push(range)
      if (ifStmt.pos < earliest) earliest = ifStmt.pos
    } else {
      const pos = ret.node.pos
      if (pos < earliest) earliest = pos
    }
  }

  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i];
    if (!read) continue;
    const pos = read.node.pos

    if (pos > assignmentPos && pos < earliest) return true

    for (let j = 0, jlen = ifRanges.length; j < jlen; j++) {
      const ifRange = ifRanges[j];
      if (!ifRange) continue;
      if (pos >= ifRange[0] && pos <= ifRange[1]) return true
    }
  }

  return false
}

/**
 * Assignments capturing mutable `this` state (e.g., `this.lineno`) cannot
 * be relocated — intermediate code mutates the source before later use.
 */
function isThisMemberAccess(variable: VariableEntity): boolean {
  const value = variable.initializer
  return value !== null && ts.isPropertyAccessExpression(value) && value.expression.kind === ts.SyntaxKind.ThisKeyword
}

function getContainingFunctionForVariable(variable: VariableEntity, graph: SolidGraph): FunctionEntity | null {
  const decl = variable.declarations[0]
  if (!decl) return null
  return getContainingFunction(graph, decl)
}

export const preferLazyPropertyAccess = defineSolidRule({
  id: "prefer-lazy-property-access",
  severity: "warn",
  messages,
  meta: {
    description: "Suggests moving property access after early returns when not used immediately.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const candidates = getVariablesWithPropertyAssignment(graph)
    if (candidates.length === 0) return

    for (const variable of candidates) {
      if (variable.reads.length === 0) continue
      if (!variable.initializer) continue

      if (isThisMemberAccess(variable)) continue

      const fn = getContainingFunctionForVariable(variable, graph)
      if (!fn) continue

      const earlyReturns = getEarlyReturns(fn)
      if (earlyReturns.length === 0) continue

      const decl = variable.declarations[0]
      if (!decl) continue
      const assignmentPos = decl.pos
      if (assignmentPos === undefined) continue

      let firstReturnPos = Infinity
      for (let i = 0, len = earlyReturns.length; i < len; i++) {
        const er = earlyReturns[i];
        if (!er) continue;
        const pos = er.node.pos
        if (pos < firstReturnPos) firstReturnPos = pos
      }
      if (firstReturnPos === Infinity) continue
      if (assignmentPos >= firstReturnPos) continue

      if (hasReadInEarlyReturnContext(variable, earlyReturns, assignmentPos)) continue

      const propertyName = getPropertyName(variable)

      emit(
        createDiagnostic(
          graph.file,
          decl,
          graph.sourceFile,
          "prefer-lazy-property-access",
          "preferLazyPropertyAccess",
          resolveMessage(messages.preferLazyPropertyAccess, {
            variableName: variable.name,
            propertyName,
          }),
          "warn",
        ),
      )
    }
  },
})
