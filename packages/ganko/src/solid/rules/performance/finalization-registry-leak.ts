/**
 * Finalization Registry Leak Rule
 *
 * Detects FinalizationRegistry.register(target, heldValue) where the
 * heldValue holds a strong reference to the target, preventing the
 * very garbage collection the registry is meant to observe.
 *
 * BAD:
 *   registry.register(obj, { data: obj }); // heldValue references target
 *   registry.register(obj, obj);           // heldValue IS target
 *
 * GOOD:
 *   registry.register(obj, obj.id);        // heldValue is a primitive/different ref
 */

import ts from "typescript"
import type { SolidGraph } from "../../impl"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName, getNewExpressionsByCallee } from "../../queries"

const messages = {
  selfReference:
    "FinalizationRegistry.register() heldValue references the target '{{name}}'. This strong reference prevents the target from being garbage collected, defeating the purpose of the registry.",
} as const

const options = {}

export const finalizationRegistryLeak = defineSolidRule({
  id: "finalization-registry-leak",
  severity: "error",
  messages,
  meta: {
    description: "Detect FinalizationRegistry.register() where heldValue references the target.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    // Collect variable names initialized via new FinalizationRegistry(...)
    const registryNames = collectFinalizationRegistryNames(graph)
    if (registryNames.size === 0) return

    const registerCalls = getCallsByMethodName(graph, "register")

    for (let i = 0, len = registerCalls.length; i < len; i++) {
      const call = registerCalls[i]
      if (!call) continue;

      // Verify receiver is a known FinalizationRegistry instance
      if (!ts.isPropertyAccessExpression(call.callee)) continue
      const receiver = call.callee.expression
      if (ts.isIdentifier(receiver)) {
        if (!registryNames.has(receiver.text)) continue
      } else if (
        ts.isPropertyAccessExpression(receiver) &&
        receiver.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(receiver.name)
      ) {
        // this.registry.register(...)
        if (!registryNames.has(receiver.name.text)) continue
      } else {
        continue
      }

      // Must have at least 2 arguments: register(target, heldValue)
      if (call.arguments.length < 2) continue

      const firstArg = call.arguments[0];
      if (!firstArg) continue;
      const targetNode = firstArg.node
      const secondArg = call.arguments[1];
      if (!secondArg) continue;
      const heldNode = secondArg.node

      // Extract target name for matching
      const targetName = extractReferenceName(targetNode)
      if (!targetName) continue

      // Check if heldValue directly IS the target
      if (extractReferenceName(heldNode) === targetName) {
        emit(
          createDiagnostic(
            graph.file,
            call.node,
            graph.sourceFile,
            "finalization-registry-leak",
            "selfReference",
            resolveMessage(messages.selfReference, { name: targetName }),
            "error",
          ),
        )
        continue
      }

      // Check if heldValue is an object/array containing a reference to target
      if (containsIdentifier(heldNode, targetName)) {
        emit(
          createDiagnostic(
            graph.file,
            call.node,
            graph.sourceFile,
            "finalization-registry-leak",
            "selfReference",
            resolveMessage(messages.selfReference, { name: targetName }),
            "error",
          ),
        )
      }
    }
  },
})

/**
 * Extract a stable reference name from a node for comparison.
 * Handles Identifiers and simple PropertyAccessExpressions (e.g., obj.ref).
 */
function extractReferenceName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) {
    const objName = extractReferenceName(node.expression)
    if (!objName) return null
    if (ts.isIdentifier(node.name)) return `${objName}.${node.name.text}`
  }
  if (ts.isElementAccessExpression(node)) {
    const objName = extractReferenceName(node.expression)
    if (!objName) return null
    const arg = node.argumentExpression
    if (ts.isStringLiteral(arg)) return `${objName}[${arg.text}]`
    if (ts.isNumericLiteral(arg)) return `${objName}[${arg.text}]`
  }
  return null
}

/**
 * Collect variable names that are initialized via `new FinalizationRegistry(...)`.
 */
function collectFinalizationRegistryNames(graph: SolidGraph): Set<string> {
  const names = new Set<string>()
  const newExprs = getNewExpressionsByCallee(graph, "FinalizationRegistry")

  for (let i = 0, len = newExprs.length; i < len; i++) {
    const expr = newExprs[i];
    if (!expr) continue;
    const parent = expr.parent
    // const registry = new FinalizationRegistry(...)
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      names.add(parent.name.text)
      continue
    }
    // registry = new FinalizationRegistry(...)
    if (parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(parent.left)) {
      names.add(parent.left.text)
      continue
    }
    // class Foo { registry = new FinalizationRegistry(...) }
    if (parent && ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) {
      names.add(parent.name.text)
    }
  }

  return names
}

/**
 * Check if an expression directly contains a reference to a named identifier.
 * Checks object properties, array elements, and common wrapper patterns.
 * Does NOT walk into nested functions (those create their own scope).
 */
function containsIdentifier(node: ts.Node, name: string): boolean {
  if (ts.isIdentifier(node)) {
    return node.text === name
  }

  if (ts.isObjectLiteralExpression(node)) {
    const props = node.properties
    for (let i = 0, len = props.length; i < len; i++) {
      const prop = props[i]
      if (!prop) continue;
      if (ts.isPropertyAssignment(prop) && containsIdentifier(prop.initializer, name)) {
        return true
      }
      if (ts.isSpreadAssignment(prop) && containsIdentifier(prop.expression, name)) {
        return true
      }
    }
    return false
  }

  if (ts.isArrayLiteralExpression(node)) {
    const elements = node.elements
    for (let i = 0, len = elements.length; i < len; i++) {
      const el = elements[i]
      if (el && containsIdentifier(el, name)) return true
    }
    return false
  }

  if (ts.isPropertyAccessExpression(node)) {
    return containsIdentifier(node.expression, name)
  }

  // Conditional: cond ? target : alt
  if (ts.isConditionalExpression(node)) {
    return containsIdentifier(node.whenTrue, name) || containsIdentifier(node.whenFalse, name)
  }

  // Call expression argument: wrap(target)
  if (ts.isCallExpression(node)) {
    const args = node.arguments
    for (let i = 0, len = args.length; i < len; i++) {
      const arg = args[i];
      if (!arg) continue;
      if (containsIdentifier(arg, name)) return true
    }
    return false
  }

  return false
}
