/**
 * Signal Call Rule
 *
 * Detects signals that should be called as functions but aren't.
 *
 * Problem:
 * Signals (from createSignal, createMemo) must be called to get their value.
 * Using them without calling loses reactivity.
 *
 * Examples:
 * - BAD:  <div>{count}</div>      // signal not called
 * - GOOD: <div>{count()}</div>    // signal called
 */
import ts from "typescript"
import type { SolidSyntaxTree as SolidGraph } from "../../../compilation/core/solid-syntax-tree"
import type { TrackingContext } from "../../entities/scope"
import type { VariableEntity, ReadEntity } from "../../entities/variable"
import type { Diagnostic, Fix } from "../../../diagnostic"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { defineSolidRule } from "../../rule"
import { getAttributeName } from "../../util/jsx"
import { iterateSignalLikeReads } from "../../queries/iterate"
import { isInTrackedContext, isInUntrackedContext, getEffectiveTrackingContext } from "../../queries/scope"
import { COMPARISON_OPERATORS } from "../../util"
import { isPassthroughPosition, isJSXAccessorPassthrough } from "../../queries/trace"

const messages = {
  signalInJsxText:
    "Signal '{{name}}' in JSX text should be called: {{{name}}()}. Without (), you're rendering the function, not its value.",
  signalInJsxAttribute:
    "Signal '{{name}}' in JSX attribute should be called: {{attr}}={{{name}}()}. Without (), the attribute won't update reactively.",
  signalInTernary:
    "Signal '{{name}}' in ternary should be called: {{name}}() ? ... : .... The condition won't react to changes without ().",
  signalInLogical:
    "Signal '{{name}}' in logical expression should be called: {{name}}() && .... Without (), this always evaluates to truthy (functions are truthy).",
  signalInComparison:
    "Signal '{{name}}' in comparison should be called: {{name}}() === .... Comparing functions always returns false.",
  signalInArithmetic:
    "Signal '{{name}}' in arithmetic should be called: {{name}}() + .... Math on functions produces NaN.",
  signalInTemplate:
    "Signal '{{name}}' in template literal should be called: `...${{{name}}()}...`. Without (), you're embedding '[Function]'.",
  signalInTrackedScope:
    "Signal '{{name}}' in {{where}} should be called: {{name}}(). Without (), reactivity is lost.",
  badSignal:
    "The reactive variable '{{name}}' should be called as a function when used in {{where}}.",
} as const

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "%", "**"])

const options = {}

export const signalCall = defineSolidRule({
  id: "signal-call",
  severity: "error",
  messages,
  meta: {
    description: "Require signals to be called as functions when used in tracked contexts",
    fixable: true,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    iterateSignalLikeReads(graph, (variable, read) => {
      const issue = checkSignalRead(graph, variable, read)
      if (issue) {
        emit(issue)
      }
    })
  },
})

function checkSignalRead(
  graph: SolidGraph,
  variable: VariableEntity,
  read: ReadEntity,
): Diagnostic | null {
  if (read.isProperAccess) return null
  if (!isInTrackedContext(graph, read.scope) && !isInUntrackedContext(graph, read.scope)) return null
  
  const context = getEffectiveTrackingContext(graph, read.scope)
  if (isPassthroughPosition(graph, read.node)) return null
  if (isJSXAccessorPassthrough(graph, read.node)) return null
  const { messageId, data } = getSpecificMessage(variable.name, read.node, context)
  const fix = createSignalCallFix(read.node, variable.name, graph.sourceFile)
  return createDiagnostic(
    graph.filePath,
    read.node,
    graph.sourceFile,
    "signal-call",
    messageId,
    resolveMessage(messages[messageId as keyof typeof messages], data),
    "error",
    fix,
  )
}

function getSpecificMessage(
  name: string,
  node: ts.Node,
  context: TrackingContext,
): { messageId: string; data: Record<string, string> } {
  const parent = node.parent
  if (!parent) {
    return { messageId: "badSignal", data: { name, where: getContextDescription(context) } }
  }

  if (ts.isJsxExpression(parent)) {
    const grandparent = parent.parent
    if (grandparent && ts.isJsxAttribute(grandparent)) {
      return {
        messageId: "signalInJsxAttribute",
        data: { name, attr: getAttributeName(grandparent) },
      }
    }
    if (grandparent && (ts.isJsxElement(grandparent) || ts.isJsxSelfClosingElement(grandparent) || ts.isJsxFragment(grandparent))) {
      return { messageId: "signalInJsxText", data: { name } }
    }
  } else if (ts.isConditionalExpression(parent)) {
    if (parent.condition === node) {
      return { messageId: "signalInTernary", data: { name } }
    }
  } else if (ts.isBinaryExpression(parent)) {
    const op = ts.tokenToString(parent.operatorToken.kind) ?? ""
    if (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return { messageId: "signalInLogical", data: { name } }
    }
    if (COMPARISON_OPERATORS.has(op)) {
      return { messageId: "signalInComparison", data: { name } }
    }
    if (ARITHMETIC_OPS.has(op)) {
      return { messageId: "signalInArithmetic", data: { name } }
    }
  } else if (ts.isTemplateExpression(parent) || ts.isNoSubstitutionTemplateLiteral(parent)) {
    return { messageId: "signalInTemplate", data: { name } }
  }

  if (context.type === "tracked" && context.source) {
    return { messageId: "signalInTrackedScope", data: { name, where: context.source } }
  }

  return { messageId: "badSignal", data: { name, where: getContextDescription(context) } }
}

function getContextDescription(context: TrackingContext): string {
  switch (context.type) {
    case "tracked":
      return context.source ?? "a tracked scope"
    case "deferred":
      return context.source ?? "a deferred scope"
    case "jsx-expression":
      return "a JSX expression"
    case "component-body":
      return "a component body"
    case "unknown":
    case "untracked":
      return "an untracked scope"
  }
}

function createSignalCallFix(node: ts.Node, name: string, sourceFile: ts.SourceFile): Fix {
  const start = node.getStart(sourceFile)
  const end = node.end
  return [{ range: [start, end], text: `${name}()` }]
}
