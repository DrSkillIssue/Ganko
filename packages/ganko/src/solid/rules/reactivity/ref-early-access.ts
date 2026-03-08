/**
 * Ref Early Access Rule
 *
 * Detects accessing refs before they are assigned (before mount).
 *
 * Problem:
 * Refs are undefined until after the component mounts. Accessing them at
 * component top-level or in createMemo (which runs synchronously) will
 * return undefined.
 *
 * Examples:
 * - BAD:  const width = divRef?.clientWidth;  // At component top-level
 * - BAD:  const height = createMemo(() => divRef?.clientHeight);  // createMemo runs before mount
 * - GOOD: onMount(() => { inputRef?.focus(); });  // After mount
 * - GOOD: createEffect(() => { ... divRef?.clientWidth ... });  // Deferred execution
 * - GOOD: const fn = () => { if (!ref) return; ref.focus(); };  // Runtime guarded
 */

import type { ScopeEntity } from "../../entities/scope"
import type { VariableEntity } from "../../entities/variable"
import { getEffectiveTrackingContext, getEnclosingComponentScope, getScopeFor, getVariableByNameInScope, isInDeferredContext } from "../../queries/scope"
import { getJSXAttributesByKind, getJSXContext } from "../../queries/jsx"
import { defineSolidRule } from "../../rule"
import { createDiagnostic, resolveMessage } from "../../../diagnostic"

const messages = {
  refBeforeMount: "Ref '{{name}}' is accessed before component mounts. Refs are undefined until after mount. Access in onMount(), createEffect(), or event handlers.",
} as const

const options = {}

/**
 * Check if a scope is inside a nested function (function scope between read and component).
 *
 * Nested functions defined at component top-level (like event handlers, utility functions)
 * could be called at any time - from safe contexts (event handlers) or unsafe ones.
 * We skip these to avoid false positives since they're commonly used for event handlers
 * and typically have runtime null guards.
 *
 * @param readScope - The scope where the ref is read
 * @param componentScope - The component's scope
 * @returns True if there's a function scope between the read and component
 */
function isInNestedFunction(readScope: ScopeEntity, componentScope: ScopeEntity): boolean {
  let current: ScopeEntity | null = readScope;

  while (current && current !== componentScope) {
    if (current.kind === "function") {
      return true;
    }
    current = current.parent;
  }

  return false;
}

/**
 * ESLint rule for detecting premature ref access in Solid.js components.
 *
 * This rule identifies when template refs are accessed before the component
 * mounts. In Solid.js, refs remain undefined until after the component has
 * mounted, so accessing them at the top-level of a component or inside
 * createMemo (which runs synchronously during render) will return undefined.
 *
 * Safe contexts for ref access:
 * - onMount() and other deferred lifecycle callbacks
 * - createEffect() and createRenderEffect() (run after initial render)
 * - Event handlers (bound to DOM elements after mount)
 *
 * Unsafe contexts:
 * - Component top-level code (executes during render)
 * - createMemo() (executes synchronously during render)
 */
export const refEarlyAccess = defineSolidRule({
  id: "ref-early-access",
  severity: "error",
  messages,
  meta: {
    description: "Detect accessing refs before they are assigned (before mount)",
    fixable: false,
    category: "reactivity",
  },
  options,

   /**
    * Analyzes component code to detect refs accessed before mount.
    *
    * Algorithm:
    * 1. Index all JSX ref attributes from the component graph
    * 2. For each ref attribute, resolve the variable being assigned
    * 3. For each read of that variable, check if it occurs in a safe context
    * 4. Report diagnostics for reads occurring in unsafe contexts
    *
    * Context Analysis:
    * - Deferred contexts (onMount, event handlers): Always safe
    * - Tracked contexts (createEffect): Safe, createMemo is not
    * - Component/unknown context: Unsafe (executes during render)
    *
    * Implementation approach:
    * - Uses pre-indexed JSX attributes instead of tree traversal
    * - Scope-aware variable lookup for quick resolution
    * - Caches processed variables to handle multiple refs to same variable
    *
    * @param graph The program analysis graph containing scope and JSX information
    * @param emit Function to emit diagnostics
    */
  check(graph, emit) {
    // Get pre-indexed ref attributes
    const refAttrs = getJSXAttributesByKind(graph, "ref");
    const refAttrsLen = refAttrs.length;
    if (refAttrsLen === 0) {
      return;
    }

    // is used in multiple ref attributes (rare but possible)
    const processedVariables = new Set<VariableEntity>();

    // For each ref attribute, resolve the variable directly using scope-aware lookup
    for (let i = 0; i < refAttrsLen; i++) {
      const entry = refAttrs[i];
      if (!entry) continue;
      const { attr } = entry;
      const valueNode = attr.valueNode;

      // Skip non-identifier refs (e.g., ref={(el) => ...})
      if (!valueNode || valueNode.type !== "Identifier") {
        continue;
      }

      const refName = valueNode.name;

      // Get the scope where the ref attribute is used (inside JSX = inside component)
      const attrScope = getScopeFor(graph, valueNode);

      // Direct scope-aware variable lookup - walks up scope chain to find declaration
      const variable = getVariableByNameInScope(graph, refName, attrScope);
      if (!variable) {
        continue;
      }

      // Skip if already processed (handles multiple ref attrs using same variable)
      if (processedVariables.has(variable)) {
        continue;
      }
      processedVariables.add(variable);

      // Verify we're in a component context (refs in JSX should always be)
      const componentInfo = getEnclosingComponentScope(graph, attrScope);
      if (!componentInfo) {
        continue;
      }

      const reads = variable.reads;
      const readsLen = reads.length;
      for (let ri = 0; ri < readsLen; ri++) {
        const read = reads[ri];
        if (!read) continue;
        const readScope = read.scope;

        // Skip ref={varName} assignments using cached JSX context
        const jsxContext = getJSXContext(graph, read.node);
        if (jsxContext?.attribute?.kind === "ref") {
          continue;
        }

        // Deferred contexts (onMount, event handlers) are always safe
        if (isInDeferredContext(graph, readScope)) {
          continue;
        }

        const context = getEffectiveTrackingContext(graph, readScope);
        const contextType = context.type;

        // Tracked contexts: createEffect/createRenderEffect are safe, createMemo is not
        if (contextType === "tracked") {
          // createMemo runs synchronously during render - unsafe
          if (context.source === "createMemo") {
            emit(
              createDiagnostic(
                graph.file,
                read.node,
                "ref-early-access",
                "refBeforeMount",
                resolveMessage(messages.refBeforeMount, { name: variable.name }),
                "error",
              ),
            );
          }
          // createEffect, createRenderEffect run after render - safe
          continue;
        }

        // "component-body" or "unknown" context within a component = unsafe
        // (at component top-level, not in nested functions or safe contexts)
        // Skip refs in nested functions (like event handlers) which run after mount
        if (isInNestedFunction(readScope, componentInfo.scope)) {
          continue;
        }

        emit(
          createDiagnostic(
            graph.file,
            read.node,
            "ref-early-access",
            "refBeforeMount",
            resolveMessage(messages.refBeforeMount, { name: variable.name }),
            "error",
          ),
        );
      }
    }
  },
});
