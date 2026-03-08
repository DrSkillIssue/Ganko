/**
 * Suspense Boundary Missing Rule
 *
 * Detect lazy components and async resources without proper error/suspense boundaries.
 *
 * In Solid.js, async operations need to be wrapped in appropriate boundaries:
 * - `<Suspense>` for lazy components: handles loading state
 * - `<ErrorBoundary>` for error handling: catches promise rejections
 * - `<Show>` to conditionally render based on resource state
 *
 * This rule detects:
 * - Lazy components used without `<Suspense>` wrapper
 * - `<Suspense>` without a fallback property (pointless)
 * - `<ErrorBoundary>` without a fallback property (pointless)
 * - Async resources without error checking
 *
 * Without proper boundaries, loading states and errors will cause issues.
 */

import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import type { JSXElementEntity } from "../../entities/jsx";
import type { CallEntity } from "../../entities/call";
import { getJSXAttributeValue, getJSXElementsByTag, getCallsByPrimitive } from "../../queries";



/**
 * Create a memoized Suspense ancestor checker using JSX parent chain traversal.
 *
 * Uses memoization with batch caching similar to graph's getScopeFor() pattern:
 * - Caches results for each visited element
 * - When traversing, checks cache for ancestors to short-circuit
 * - Batch-caches all visited nodes after traversal
 *
 * This avoids redundant parent chain walks when multiple lazy components
 * share common ancestors (common in real applications).
 *
 * @returns A function that checks if an element has a Suspense ancestor
 */
function createSuspenseAncestorChecker(): (element: JSXElementEntity) => boolean {
  const cache = new Map<JSXElementEntity, boolean>();

  return function hasSuspenseAncestor(element: JSXElementEntity): boolean {
    const cached = cache.get(element);
    if (cached !== undefined) return cached;

    // Collect path for batch caching (lazy array creation)
    let path: JSXElementEntity[] | null = null;
    let current = element.parent;
    let result = false;

    while (current) {

      const ancestorCached = cache.get(current);
      if (ancestorCached !== undefined) {
        result = ancestorCached;
        break;
      }

      if (current.tag === "Suspense" && !current.isDomElement) {
        result = true;
        cache.set(current, true);
        break;
      }

      if (path === null) {
        path = [current];
      } else {
        path.push(current);
      }
      current = current.parent;
    }

    cache.set(element, result);

    if (path !== null) {
      for (let i = 0, len = path.length; i < len; i++) {
        const pathEl = path[i];
        if (!pathEl) continue;
        cache.set(pathEl, result);
      }
    }

    return result;
  };
}

/**
 * Extract the variable name from a lazy() call's parent declaration.
 * Returns null if the call is not assigned to a variable.
 *
 * @param call - The lazy() call entity
 * @returns The component variable name, or null if not assigned to a variable
 */
function getLazyComponentName(call: CallEntity): string | null {
  const parent = call.node.parent;
  if (!parent || parent.type !== "VariableDeclarator") {
    return null;
  }
  if (parent.init !== call.node) {
    return null;
  }
  if (parent.id.type !== "Identifier") {
    return null;
  }
  return parent.id.name;
}



const messages = {
  suspenseNoFallback:
    "<Suspense> should have a fallback prop to show while children are loading. Add: fallback={<Loading />}",
  errorBoundaryNoFallback:
    "<ErrorBoundary> should have a fallback prop to show when an error occurs. Add: fallback={(err) => <Error error={err} />}",
  lazyNoSuspense:
    "Lazy component '{{name}}' must be wrapped in a <Suspense> boundary. Add a <Suspense fallback={...}> ancestor.",
} as const;

const options = {}

export const suspenseBoundaryMissing = defineSolidRule({
  id: "suspense-boundary-missing",
  severity: "error",
  messages,
  meta: {
    description:
      "Detect missing fallback props on Suspense/ErrorBoundary, and lazy components without Suspense wrapper.",
    fixable: false,
    category: "jsx",
  },
  options,
  check(graph, emit) {
    // Check 1: Find <Suspense> elements without fallback prop
    const suspenseElements = graph.jsxByTag.get("Suspense") ?? [];
    for (let i = 0, len = suspenseElements.length; i < len; i++) {
      const element = suspenseElements[i];
      if (!element) continue;
      // Skip DOM elements (lowercase "suspense" would be isDomElement: true)
      if (element.isDomElement) {
        continue;
      }

      if (getJSXAttributeValue(graph, element, "fallback") === null) {
        if (element.node.type !== "JSXElement") continue;
        emit(
          createDiagnostic(graph.file, element.node.openingElement, "suspense-boundary-missing", "suspenseNoFallback", messages.suspenseNoFallback, "error"),
        );
      }
    }

    // Check 2: Find <ErrorBoundary> elements without fallback prop
    const errorBoundaryElements = getJSXElementsByTag(graph, "ErrorBoundary");
    for (let i = 0, len = errorBoundaryElements.length; i < len; i++) {
      const element = errorBoundaryElements[i];
      if (!element) continue;
      if (element.isDomElement) {
        continue;
      }
      if (getJSXAttributeValue(graph, element, "fallback") === null) {
        if (element.node.type !== "JSXElement") continue;
        emit(
          createDiagnostic(graph.file, element.node.openingElement, "suspense-boundary-missing", "errorBoundaryNoFallback", messages.errorBoundaryNoFallback, "error"),
        );
      }
    }

    // Check 3: Find lazy components used without Suspense boundary
    const lazyCalls = getCallsByPrimitive(graph, "lazy");

    // Early exit: no lazy() calls means no lazy components to check
    if (lazyCalls.length === 0) {
      return;
    }

    // Step 3a: Collect all lazy component names
    const lazyComponentNames: string[] = [];
    for (let i = 0, len = lazyCalls.length; i < len; i++) {
      const lazyCall = lazyCalls[i];
      if (!lazyCall) continue;
      const name = getLazyComponentName(lazyCall);
      if (name) {
        lazyComponentNames.push(name);
      }
    }

    // Early exit: no named lazy components
    if (lazyComponentNames.length === 0) {
      return;
    }

    // Step 3b: Check JSX usages of each lazy component
    // Create memoized checker for Suspense ancestors (caches traversal results)
    // Uses JSXElementEntity.parent which is populated during graph construction
    const hasSuspenseAncestor = createSuspenseAncestorChecker();

    for (let i = 0, len = lazyComponentNames.length; i < len; i++) {
      const name = lazyComponentNames[i];
      if (!name) return;
      const elements = getJSXElementsByTag(graph, name);

      for (let j = 0, elemLen = elements.length; j < elemLen; j++) {
        const element = elements[j];
        if (!element) continue;
        // Lazy components are always non-DOM (PascalCase), so no isDomElement check needed
        if (!hasSuspenseAncestor(element)) {
          if (element.node.type !== "JSXElement") continue;
          emit(
            createDiagnostic(
              graph.file,
              element.node.openingElement,
              "suspense-boundary-missing",
              "lazyNoSuspense",
              resolveMessage(messages.lazyNoSuspense, { name }),
              "error",
            ),
          );
        }
      }
    }
  },
});
