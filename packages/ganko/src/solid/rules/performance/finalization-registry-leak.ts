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

import type { TSESTree as T } from "@typescript-eslint/utils"
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
      if (call.callee.type !== "MemberExpression") continue
      const receiver = call.callee.object
      if (receiver.type === "Identifier") {
        if (!registryNames.has(receiver.name)) continue
      } else if (
        receiver.type === "MemberExpression" &&
        receiver.object.type === "ThisExpression" &&
        receiver.property.type === "Identifier"
      ) {
        // this.registry.register(...)
        if (!registryNames.has(receiver.property.name)) continue
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
 * Handles Identifiers and simple MemberExpressions (e.g., obj.ref).
 */
function extractReferenceName(node: T.Node): string | null {
  if (node.type === "Identifier") return node.name
  if (node.type === "MemberExpression") {
    const objName = extractReferenceName(node.object)
    if (!objName) return null
    if (node.property.type === "Identifier") return `${objName}.${node.property.name}`
    // Handle computed access with literal keys: items[0], items["key"]
    if (node.computed && node.property.type === "Literal") {
      return `${objName}[${String(node.property.value)}]`
    }
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
    if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
      names.add(parent.id.name)
      continue
    }
    // registry = new FinalizationRegistry(...)
    if (parent?.type === "AssignmentExpression" && parent.left.type === "Identifier") {
      names.add(parent.left.name)
      continue
    }
    // class Foo { registry = new FinalizationRegistry(...) }
    if (parent?.type === "PropertyDefinition" && parent.key.type === "Identifier") {
      names.add(parent.key.name)
    }
  }

  return names
}

/**
 * Check if an expression directly contains a reference to a named identifier.
 * Checks object properties, array elements, and common wrapper patterns.
 * Does NOT walk into nested functions (those create their own scope).
 */
function containsIdentifier(node: T.Node, name: string): boolean {
  if (node.type === "Identifier") {
    return node.name === name
  }

  if (node.type === "ObjectExpression") {
    const props = node.properties
    for (let i = 0, len = props.length; i < len; i++) {
      const prop = props[i]
      if (!prop) continue;
      if (prop.type === "Property" && containsIdentifier(prop.value, name)) {
        return true
      }
      if (prop.type === "SpreadElement" && containsIdentifier(prop.argument, name)) {
        return true
      }
    }
    return false
  }

  if (node.type === "ArrayExpression") {
    const elements = node.elements
    for (let i = 0, len = elements.length; i < len; i++) {
      const el = elements[i]
      if (el && containsIdentifier(el, name)) return true
    }
    return false
  }

  if (node.type === "MemberExpression") {
    return containsIdentifier(node.object, name)
  }

  // Conditional: cond ? target : alt
  if (node.type === "ConditionalExpression") {
    return containsIdentifier(node.consequent, name) || containsIdentifier(node.alternate, name)
  }

  // Call expression argument: wrap(target)
  if (node.type === "CallExpression") {
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
