/**
 * Detached DOM Reference Rule
 *
 * Detects DOM query results (document.querySelector, document.getElementById, etc.)
 * stored in module-scoped or outer-scope variables. These hold strong references
 * to DOM nodes that may be removed from the document, preventing garbage collection
 * of the detached subtree.
 *
 * BAD:
 *   let savedNode = document.querySelector("#content");
 *   const header = document.getElementById("header");
 *
 * GOOD:
 *   function Component() {
 *     const el = document.querySelector("#content"); // function-scoped, short-lived
 *     return <div>{el?.textContent}</div>;
 *   }
 *   // Or use WeakRef:
 *   const nodeRef = new WeakRef(document.querySelector("#content")!);
 */

import type { TSESTree as T } from "@typescript-eslint/utils"
import type { SolidGraph } from "../../impl"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByMethodName } from "../../queries"

const DOM_QUERY_METHODS = new Set([
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByClassName",
  "getElementsByTagName",
  "getElementsByName",
])

const messages = {
  detachedRef:
    "DOM query result from '{{method}}' stored in module-scoped variable '{{name}}'. If the DOM node is removed, this reference prevents garbage collection. Use a local variable or WeakRef instead.",
} as const

const options = {}

export const detachedDomReference = defineSolidRule({
  id: "detached-dom-reference",
  severity: "warn",
  messages,
  meta: {
    description: "Detect DOM query results stored in module-scoped variables that may hold detached nodes.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    for (const method of DOM_QUERY_METHODS) {
      const calls = getCallsByMethodName(graph, method)

      for (let i = 0, len = calls.length; i < len; i++) {
        const call = calls[i]
        if (!call) continue;

        // Verify this is document.method() or el.method()
        if (call.callee.type !== "MemberExpression") continue

        const parent = call.node.parent

        // Case 1: const el = document.querySelector(...)  — at module scope
        if (parent?.type === "VariableDeclarator") {
          const varId = parent.id
          if (varId.type === "Identifier" && call.scope.isModuleScope) {
            emit(
              createDiagnostic(
                graph.file,
                call.node,
                "detached-dom-reference",
                "detachedRef",
                resolveMessage(messages.detachedRef, { method, name: varId.name }),
                "warn",
              ),
            )
            continue
          }
        }

        // Case 2: cachedEl = document.querySelector(...)  — assigned to module-scope var
        if (parent?.type === "AssignmentExpression" && parent.left.type === "Identifier") {
          if (isModuleScopedVariable(graph, parent.left.name)) {
            emit(
              createDiagnostic(
                graph.file,
                call.node,
                "detached-dom-reference",
                "detachedRef",
                resolveMessage(messages.detachedRef, { method, name: parent.left.name }),
                "warn",
              ),
            )
            continue
          }
        }

        // Case 3: state.el = document.querySelector(...)  — property on module-scope object
        if (parent?.type === "AssignmentExpression" && parent.left.type === "MemberExpression") {
          const root = getRootObject(parent.left)
          if (root && isModuleScopedVariable(graph, root)) {
            const propName = root + "." + getMemberPath(parent.left)
            emit(
              createDiagnostic(
                graph.file,
                call.node,
                "detached-dom-reference",
                "detachedRef",
                resolveMessage(messages.detachedRef, { method, name: propName }),
                "warn",
              ),
            )
          }
        }
      }
    }
  },
})

function isModuleScopedVariable(graph: SolidGraph, name: string): boolean {
  const vars = graph.variablesByName.get(name)
  if (!vars) return false
  for (let i = 0, len = vars.length; i < len; i++) {
    const v = vars[i];
    if (!v) continue;
    if (v.scope.isModuleScope) return true
  }
  return false
}

/**
 * Get the root identifier name from a MemberExpression chain.
 * e.g., `state.el` -> "state", `a.b.c` -> "a"
 */
function getRootObject(node: T.MemberExpression): string | null {
  let current: T.Expression = node.object
  while (current.type === "MemberExpression") {
    current = current.object
  }
  if (current.type === "Identifier") return current.name
  return null
}

/**
 * Get the property path from a MemberExpression.
 * e.g., `state.el` -> "el", `state.nested.el` -> "nested.el"
 */
function getMemberPath(node: T.MemberExpression): string {
  const prop = node.property
  const name = prop.type === "Identifier" ? prop.name : "[computed]"
  if (node.object.type === "MemberExpression") {
    return getMemberPath(node.object) + "." + name
  }
  return name
}
