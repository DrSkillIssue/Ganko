/**
 * Resource Implicit Suspense Rule
 *
 * createResource interacts with Suspense through two independent propagation paths:
 *
 * 1. Loading path: Without initialValue, the resource starts unresolved. SolidJS treats
 *    this as a thrown Promise that propagates to the nearest Suspense boundary, which
 *    swaps its entire children subtree with its fallback.
 *
 * 2. Error path: When the fetcher throws (regardless of initialValue), SolidJS propagates
 *    the error to the nearest Suspense or ErrorBoundary. If only Suspense exists (no
 *    ErrorBoundary), the boundary absorbs the error and stays in its fallback state
 *    permanently. The original children are unmounted and never restored.
 *
 * initialValue only fixes path 1. Path 2 requires an ErrorBoundary wrapping the resource
 * consumer, or never throwing from the fetcher.
 *
 * WARN: createResource without initialValue AND the component reads resource.loading
 * ERROR (loading): createResource without initialValue AND rendered inside conditional
 *   mount point AND nearest Suspense boundary is more than 1 component level up
 * ERROR (error): createResource (with OR without initialValue) AND fetcher can throw
 *   AND no ErrorBoundary between the component and the nearest Suspense boundary
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../../impl";
import type { CallEntity } from "../../entities";
import type { FunctionEntity } from "../../entities/function";
import type { VariableEntity } from "../../entities/variable";
import type { JSXElementEntity } from "../../entities/jsx";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { getCallsByPrimitive } from "../../queries/get";
import { getEnclosingComponentScope } from "../../queries";

/** Tags that represent conditional/lazy mount points. */
const CONDITIONAL_MOUNT_TAGS = new Set([
  "Show", "Switch", "Match", "Dynamic", "Portal",
  "Drawer", "Dialog", "Modal", "Popover", "Menu",
  "DropdownMenu", "AlertDialog", "Sheet", "Tooltip",
  "Accordion", "Tabs", "TabPanel",
]);

const messages = {
  loadingMismatch:
    "createResource '{{name}}' has no initialValue but uses manual loading checks ({{name}}.loading). " +
    "Without initialValue, Suspense intercepts before your loading UI renders. " +
    "Add initialValue to the options: createResource(fetcher, { initialValue: ... })",
  conditionalSuspense:
    "createResource '{{name}}' has no initialValue and is rendered inside a conditional mount point ({{mountTag}}). " +
    "This will trigger a distant Suspense boundary and unmount the entire subtree. " +
    "Add initialValue to the options: createResource(fetcher, { initialValue: ... })",
  missingErrorBoundary:
    "createResource '{{name}}' has no <ErrorBoundary> between its component and the nearest <Suspense>. " +
    "When the fetcher throws (network error, 401/403/503, timeout), the error propagates to Suspense " +
    "which absorbs it and stays in its fallback state permanently. " +
    "Wrap the component in <ErrorBoundary fallback={...}> or catch errors inside the fetcher.",
} as const;

const options = {};

/**
 * Determine if a createResource call has an initialValue in its options argument.
 *
 * createResource has two overloads:
 * - createResource(fetcher, options?)
 * - createResource(source, fetcher, options?)
 *
 * The options argument (last one if it's an object literal) may contain `initialValue`.
 */
function hasInitialValue(call: CallEntity): boolean {
  const args = call.node.arguments;
  if (args.length === 0) return false;

  const lastArg = args[args.length - 1];
  if (!lastArg || lastArg.type !== "ObjectExpression") return false;

  const properties = lastArg.properties;
  for (let i = 0, len = properties.length; i < len; i++) {
    const prop = properties[i];
    if (!prop) continue;
    if (prop.type !== "Property") continue;
    if (prop.key.type === "Identifier" && prop.key.name === "initialValue") {
      return true;
    }
  }

  return false;
}

/**
 * Get the resource variable name from a createResource call's destructuring pattern.
 *
 * Pattern: `const [data, ...] = createResource(...)`
 * Returns the name of the first element (the resource accessor variable).
 */
function getResourceVariableName(call: CallEntity): string | null {
  const parent = call.node.parent;
  if (parent?.type !== "VariableDeclarator" || parent.init !== call.node) return null;

  const pattern = parent.id;
  if (pattern.type === "ArrayPattern") {
    const first = pattern.elements[0];
    if (first && first.type === "Identifier") return first.name;
    return null;
  }
  if (pattern.type === "Identifier") return pattern.name;
  return null;
}

/**
 * Check if resource.loading is read anywhere in the file for a given resource variable.
 */
function hasLoadingRead(resourceVariable: VariableEntity): boolean {
  const reads = resourceVariable.reads;
  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i];
    if (!read) continue;
    const parent = read.node.parent;
    if (
      parent?.type === "MemberExpression" &&
      parent.object === read.node &&
      !parent.computed &&
      parent.property.type === "Identifier" &&
      parent.property.name === "loading"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve the fetcher argument from a createResource call to its FunctionEntity.
 *
 * createResource overloads at the AST level:
 * - 1 arg: createResource(fetcher) → arg[0]
 * - 2 args, last is ObjectExpression: createResource(fetcher, options) → arg[0]
 * - 2 args, last is not ObjectExpression: createResource(source, fetcher) → arg[1]
 * - 3 args: createResource(source, fetcher, options) → arg[1]
 *
 * For inline functions, resolves via functionsByNode.
 * For identifier references, resolves via functionsByName.
 */
function resolveFetcherFunction(graph: SolidGraph, call: CallEntity): FunctionEntity | null {
  const args = call.node.arguments;
  if (args.length === 0) return null;

  let fetcherNode: T.Node | undefined;

  if (args.length === 1) {
    fetcherNode = args[0];
  } else if (args.length === 2) {
    const lastArg = args[1];
    fetcherNode = lastArg && lastArg.type === "ObjectExpression" ? args[0] : args[1];
  } else {
    fetcherNode = args[1];
  }

  if (!fetcherNode) return null;

  if (
    fetcherNode.type === "ArrowFunctionExpression" ||
    fetcherNode.type === "FunctionExpression"
  ) {
    return graph.functionsByNode.get(fetcherNode) ?? null;
  }

  if (fetcherNode.type === "Identifier") {
    const fns = graph.functionsByName.get(fetcherNode.name);
    if (fns && fns.length > 0) {
      const fn = fns[0];
      if (fn) return fn;
    }
  }

  return null;
}

/**
 * Determine if a fetcher function can produce unhandled errors.
 *
 * Uses graph-level properties only (no AST walking):
 * - async with await expressions → awaited promises can reject
 * - hasThrowStatement → explicit throws
 * - callSites with unresolved targets → external I/O (fetch, API wrappers)
 * - callSites with resolved targets that recursively can throw
 *
 * This intentionally does NOT try to detect try/catch containment (the graph
 * does not model that). The check errs toward flagging: if the fetcher does
 * anything that can produce errors and no ErrorBoundary exists, the structural
 * hazard exists regardless of internal error handling — ErrorBoundary is the
 * defense-in-depth the component tree requires.
 */
function fetcherCanThrow(
  graph: SolidGraph,
  fn: FunctionEntity,
  visited: Set<number>,
): boolean {
  if (visited.has(fn.id)) return false;
  visited.add(fn.id);

  if (fn.async && fn.awaitRanges.length > 0) return true;

  if (fn.hasThrowStatement) return true;

  const callSites = fn.callSites;
  for (let i = 0, len = callSites.length; i < len; i++) {
    const callSite = callSites[i];
    if (!callSite) continue;

    // Unresolved target → external function (fetch, axios, API wrapper) that can throw
    if (!callSite.resolvedTarget) return true;

    if (fetcherCanThrow(graph, callSite.resolvedTarget, visited)) return true;
  }

  return false;
}

/**
 * Check if a component lacks an ErrorBoundary between it and the nearest Suspense.
 *
 * Walks the JSX parent chain from each usage of the component. Returns true if
 * ANY usage site has a Suspense ancestor without an intervening ErrorBoundary,
 * or has no Suspense/ErrorBoundary at all (error propagates to route/layout level).
 */
function lacksErrorBoundaryBeforeSuspense(
  graph: SolidGraph,
  componentName: string,
): boolean {
  const usages = graph.jsxByTag.get(componentName) ?? [];
  if (usages.length === 0) return false;

  for (let i = 0, len = usages.length; i < len; i++) {
    const usage = usages[i];
    if (!usage) continue;

    let current: JSXElementEntity | null = usage.parent;
    let foundErrorBoundary = false;

    while (current) {
      const tag = current.tag;
      if (tag && !current.isDomElement) {
        if (tag === "ErrorBoundary") {
          foundErrorBoundary = true;
          break;
        }
        if (tag === "Suspense") {
          if (!foundErrorBoundary) return true;
          break;
        }
      }
      current = current.parent;
    }

    // No Suspense or ErrorBoundary found at all — error propagates uncaught
    if (!foundErrorBoundary) return true;
  }

  return false;
}

/**
 * Find the nearest conditional mount point ancestor for a component.
 *
 * Walks up the JSX parent chain from the component's usage site to find
 * tags matching CONDITIONAL_MOUNT_TAGS.
 */
function findConditionalMountAncestor(
  graph: SolidGraph,
  componentName: string,
): { tag: string; suspenseDistance: number } | null {
  const usages = graph.jsxByTag.get(componentName) ?? [];

  for (let i = 0, len = usages.length; i < len; i++) {
    const usage = usages[i];
    if (!usage) continue;

    let current: JSXElementEntity | null = usage.parent;
    let conditionalTag: string | null = null;
    let componentLevels = 0;

    while (current) {
      const tag = current.tag;
      if (tag && !current.isDomElement) {
        componentLevels++;

        if (tag === "Suspense") {
          if (conditionalTag !== null && componentLevels > 1) {
            return { tag: conditionalTag, suspenseDistance: componentLevels };
          }
          return null;
        }

        if (conditionalTag === null && CONDITIONAL_MOUNT_TAGS.has(tag)) {
          conditionalTag = tag;
        }
      }
      current = current.parent;
    }

    if (conditionalTag !== null) {
      return { tag: conditionalTag, suspenseDistance: componentLevels };
    }
  }

  return null;
}

/**
 * Get the component name that contains a createResource call.
 *
 * Checks both the call's own scope (if it is a component scope) and
 * the enclosing component scope via parent chain traversal.
 */
function getContainingComponentName(graph: SolidGraph, call: CallEntity): string | null {
  const selfComponent = graph.componentScopes.get(call.scope);
  if (selfComponent) return selfComponent.name;

  const component = getEnclosingComponentScope(graph, call.scope);
  return component?.name ?? null;
}

/**
 * Find the resource VariableEntity for a given resource name from the graph.
 */
function findResourceVariable(graph: SolidGraph, name: string): VariableEntity | null {
  const variables = graph.resourceVariables;
  for (let i = 0, len = variables.length; i < len; i++) {
    const v = variables[i];
    if (!v) continue;
    if (v.name === name) return v;
  }
  return null;
}

export const resourceImplicitSuspense = defineSolidRule({
  id: "resource-implicit-suspense",
  severity: "warn",
  messages,
  meta: {
    description: "Detect createResource that implicitly triggers or permanently breaks Suspense boundaries.",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const resourceCalls = getCallsByPrimitive(graph, "createResource");
    if (resourceCalls.length === 0) return;

    for (let i = 0, len = resourceCalls.length; i < len; i++) {
      const call = resourceCalls[i];
      if (!call) continue;

      const resourceName = getResourceVariableName(call);
      if (!resourceName) continue;

      const hasInitial = hasInitialValue(call);
      const componentName = getContainingComponentName(graph, call);

      // Loading path checks (only when no initialValue)
      if (!hasInitial) {
        const resourceVariable = findResourceVariable(graph, resourceName);

        // WARN: manual loading handling alongside bare createResource
        if (resourceVariable && hasLoadingRead(resourceVariable)) {
          emit(
            createDiagnostic(
              graph.file,
              call.node,
              "resource-implicit-suspense",
              "loadingMismatch",
              resolveMessage(messages.loadingMismatch, { name: resourceName }),
              "warn",
            ),
          );
        }

        // ERROR (loading path): conditional mount point with distant Suspense
        if (componentName) {
          const conditional = findConditionalMountAncestor(graph, componentName);
          if (conditional) {
            emit(
              createDiagnostic(
                graph.file,
                call.node,
                "resource-implicit-suspense",
                "conditionalSuspense",
                resolveMessage(messages.conditionalSuspense, {
                  name: resourceName,
                  mountTag: conditional.tag,
                }),
                "error",
              ),
            );
          }
        }
      }

      // Error path check (applies regardless of initialValue)
      if (componentName) {
        const fetcherFn = resolveFetcherFunction(graph, call);
        if (fetcherFn && fetcherCanThrow(graph, fetcherFn, new Set())) {
          if (lacksErrorBoundaryBeforeSuspense(graph, componentName)) {
            emit(
              createDiagnostic(
                graph.file,
                call.node,
                "resource-implicit-suspense",
                "missingErrorBoundary",
                resolveMessage(messages.missingErrorBoundary, { name: resourceName }),
                "error",
              ),
            );
          }
        }
      }
    }
  },
});
