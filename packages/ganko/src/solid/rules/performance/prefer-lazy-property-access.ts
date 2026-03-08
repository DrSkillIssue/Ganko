/**
 * Flags property access assigned to a variable at function start.
 * Only flags when the function has early returns AND the variable
 * is not read before or within the first early return context.
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
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
 * Extracts the property name from a variable's MemberExpression assignment.
 *
 * @param variable - The VariableEntity to extract from
 * @returns The property name as a string, or "property" if not extractable
 */
function getPropertyName(variable: VariableEntity): string {
  if (variable.assignments.length === 0) return "property"

  const first = variable.assignments[0]
  if (!first) return "property"

  const value = first.value
  if (value.type !== "MemberExpression") return "property"

  const property = value.property
  if (property.type === "Identifier") return property.name
  if (property.type === "Literal" && typeof property.value === "string") return property.value

  return "property"
}

function getContainingIfStatement(ret: T.ReturnStatement): T.IfStatement | null {
  const parent = ret.parent
  if (!parent) return null

  if (parent.type === "IfStatement" && parent.consequent === ret) {
    return parent
  }

  if (parent.type !== "BlockStatement") return null
  const maybeIf = parent.parent
  if (!maybeIf || maybeIf.type !== "IfStatement") return null
  if (maybeIf.consequent !== parent) return null
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
    if (ifStmt && ifStmt.range) {
      ifRanges.push(ifStmt.range)
      if (ifStmt.range[0] < earliest) earliest = ifStmt.range[0]
    } else {
      const range = ret.node.range
      if (range && range[0] < earliest) earliest = range[0]
    }
  }

  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i];
    if (!read) continue;
    const range = read.node.range
    if (!range) continue
    const pos = range[0]

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
  if (variable.assignments.length === 0) return false
  const first = variable.assignments[0]
  if (!first) return false
  const value = first.value
  return value.type === "MemberExpression" && value.object.type === "ThisExpression"
}

function getContainingFunctionForVariable(variable: VariableEntity, graph: SolidGraph): FunctionEntity | null {
  if (variable.assignments.length === 0) return null
  const first = variable.assignments[0]
  if (!first) return null
  return getContainingFunction(graph, first.node)
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
      if (variable.assignments.length === 0) continue

      const first = variable.assignments[0]
      if (!first) continue

      if (isThisMemberAccess(variable)) continue

      const fn = getContainingFunctionForVariable(variable, graph)
      if (!fn) continue

      const earlyReturns = getEarlyReturns(fn)
      if (earlyReturns.length === 0) continue

      const assignmentRange = first.node.range
      if (!assignmentRange) continue
      const assignmentPos = assignmentRange[0]

      let firstReturnPos = Infinity
      for (let i = 0, len = earlyReturns.length; i < len; i++) {
        const er = earlyReturns[i];
        if (!er) continue;
        const range = er.node.range
        if (range && range[0] < firstReturnPos) firstReturnPos = range[0]
      }
      if (firstReturnPos === Infinity) continue
      if (assignmentPos >= firstReturnPos) continue

      if (hasReadInEarlyReturnContext(variable, earlyReturns, assignmentPos)) continue

      const propertyName = getPropertyName(variable)

      emit(
        createDiagnostic(
          graph.file,
          first.node,
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
