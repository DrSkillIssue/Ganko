/**
 * Self-Referencing Store Rule
 *
 * Detects setStore() calls where the value argument references the store
 * variable itself, creating a circular proxy reference that prevents GC
 * and can cause infinite loops in deep equality checks or serialization.
 *
 * BAD:
 *   const [store, setStore] = createStore({});
 *   setStore("self", store);          // store.self === store (circular)
 *   setStore("nested", { ref: store }); // indirect circular ref
 *
 * GOOD:
 *   setStore("data", someOtherValue);
 *   setStore("copy", { ...store });    // spread creates shallow copy (no proxy cycle)
 */

import ts from "typescript"
import type { VariableEntity } from "../../entities"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"
import { getCallsByPrimitive, getVariableByNameInScope } from "../../queries"

const messages = {
  selfReference:
    "setStore() value references the store variable '{{name}}', creating a circular proxy reference. This prevents garbage collection and can cause infinite loops.",
} as const

const options = {}

export const selfReferencingStore = defineSolidRule({
  id: "self-referencing-store",
  severity: "error",
  messages,
  meta: {
    description: "Detect setStore() where the value argument references the store itself.",
    fixable: false,
    category: "performance",
  },
  options,
  check(graph, emit) {
    const storeCalls = getCallsByPrimitive(graph, "createStore")
    if (storeCalls.length === 0) return

    // Extract store destructures: const [store, setStore] = createStore(...)
    const stores: StoreDestructure[] = []

    for (let i = 0, len = storeCalls.length; i < len; i++) {
      const call = storeCalls[i]
      if (!call) continue
      const parent = call.node.parent
      if (!parent || !ts.isVariableDeclaration(parent)) continue

      const pattern = parent.name
      if (!ts.isArrayBindingPattern(pattern)) continue

      const elements = pattern.elements
      if (elements.length < 2) continue

      const storeEl = elements[0]
      const setterEl = elements[1]

      if (!storeEl || !ts.isBindingElement(storeEl) || !ts.isIdentifier(storeEl.name)) continue
      if (!setterEl || !ts.isBindingElement(setterEl) || !ts.isIdentifier(setterEl.name)) continue

      const storeVar = getVariableByNameInScope(graph, storeEl.name.text, call.scope)
      if (!storeVar) continue

      const setterVar = getVariableByNameInScope(graph, setterEl.name.text, call.scope)
      if (!setterVar) continue

      stores.push({
        storeName: storeEl.name.text,
        setterName: setterEl.name.text,
        storeVar,
        setterVar,
      })
    }

    if (stores.length === 0) return

    // For each store, check setter calls for self-references
    for (let i = 0, len = stores.length; i < len; i++) {
      const s = stores[i]
      if (!s) continue

      // Collect alias names: const alias = store;
      const storeNames = collectAliasNames(s.storeVar, s.storeName)

      const reads = s.setterVar.reads

      for (let j = 0, rlen = reads.length; j < rlen; j++) {
        const read = reads[j]
        if (!read) continue
        if (!read.node.parent || !ts.isCallExpression(read.node.parent)) continue
        const callNode = read.node.parent

        // setStore takes variable path args + value as last arg
        // setStore(value), setStore("key", value), setStore("a", "b", value)
        const args = callNode.arguments
        if (args.length === 0) continue

        // The last argument is the value (unless it's a function updater)
        const lastArg = args[args.length - 1]
        if (!lastArg) continue

        // Check if the value references the store variable or any alias
        // For function updaters: setStore("key", (prev) => store)
        const nodeToCheck = getUpdaterBody(lastArg) ?? lastArg
        if (containsAnyIdentifier(nodeToCheck, storeNames)) {
          emit(
            createDiagnostic(
              graph.file,
              callNode,
              graph.sourceFile,
              "self-referencing-store",
              "selfReference",
              resolveMessage(messages.selfReference, { name: s.storeName }),
              "error",
            ),
          )
        }
      }
    }
  },
})

interface StoreDestructure {
  storeName: string
  setterName: string
  storeVar: VariableEntity
  setterVar: VariableEntity
}

/**
 * If a node is a function updater (arrow/function expression), return its body
 * for inspection. For expression bodies, returns the expression. For block
 * bodies, returns the last return statement's argument. Returns null if not
 * an updater pattern.
 */
function getUpdaterBody(node: ts.Node): ts.Node | null {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return null

  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
    return node.body
  }

  const body = ts.isArrowFunction(node) ? node.body : node.body
  if (ts.isBlock(body)) {
    const statements = body.statements
    for (let i = statements.length - 1; i >= 0; i--) {
      const stmt = statements[i]
      if (!stmt) continue
      if (ts.isReturnStatement(stmt)) {
        return stmt.expression ?? null
      }
    }
  }

  return null
}

/**
 * Collect aliases of a store variable by checking reads used as variable initializers.
 * Returns a Set containing the original name and any alias names.
 */
function collectAliasNames(storeVar: VariableEntity, storeName: string): Set<string> {
  const names = new Set([storeName])
  const reads = storeVar.reads

  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i]
    if (!read) continue
    const readNode = read.node
    const parent = readNode.parent
    // const alias = store;
    if (parent && ts.isVariableDeclaration(parent) && parent.initializer === readNode && ts.isIdentifier(parent.name)) {
      names.add(parent.name.text)
    }
  }

  return names
}

/**
 * Check if an expression contains a reference to any name in the set.
 */
function containsAnyIdentifier(node: ts.Node, names: Set<string>): boolean {
  if (ts.isIdentifier(node)) {
    return names.has(node.text)
  }

  if (ts.isObjectLiteralExpression(node)) {
    const props = node.properties
    for (let i = 0, len = props.length; i < len; i++) {
      const prop = props[i]
      if (!prop) continue
      if (ts.isPropertyAssignment(prop) && containsAnyIdentifier(prop.initializer, names)) {
        return true
      }
      if (ts.isSpreadAssignment(prop) && containsAnyIdentifier(prop.expression, names)) {
        return true
      }
    }
    return false
  }

  if (ts.isArrayLiteralExpression(node)) {
    const elements = node.elements
    for (let i = 0, len = elements.length; i < len; i++) {
      const el = elements[i]
      if (el && containsAnyIdentifier(el, names)) return true
    }
    return false
  }

  // MemberExpression like store.count accesses a property value, not the proxy itself.
  if (ts.isPropertyAccessExpression(node)) {
    return false
  }

  return false
}

