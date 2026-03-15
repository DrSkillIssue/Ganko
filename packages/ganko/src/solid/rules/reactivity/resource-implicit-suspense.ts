/**
 * Resource Implicit Suspense Rule
 *
 * createResource interacts with Suspense through two independent propagation paths:
 *
 * 1. Loading path: Without initialValue, the resource starts in "unresolved" state and
 *    the accessor returns undefined. When read() is called inside a tracked context,
 *    it increments the nearest SuspenseContext's counter, which triggers the Suspense
 *    boundary to swap its entire children subtree with its fallback. With initialValue,
 *    the accessor returns a real value but loading is still true and the Suspense
 *    increment path can still fire — initialValue only prevents the accessor from
 *    returning undefined, it does NOT fully prevent Suspense activation.
 *
 * 2. Error path: When the fetcher's Promise rejects, completeLoad sets the error signal
 *    and decrements Suspense. Suspense then tries to re-render children, which calls
 *    read() again. read() throws the error (if err !== undefined && !pr). The error
 *    propagates via handleError through the ownership chain looking for an ERROR handler
 *    (installed by catchError/ErrorBoundary). Suspense has NO error handling mechanism.
 *    Without an ErrorBoundary, the error is unhandled — either crashing the app or
 *    leaving the Suspense boundary permanently broken.
 *
 * WARN: createResource without initialValue AND the component reads resource.loading
 * ERROR (suspense): createResource (with OR without initialValue) AND rendered inside
 *   conditional mount point AND nearest Suspense boundary is more than 1 component up
 * ERROR (error): createResource (with OR without initialValue) AND fetcher can throw
 *   AND no ErrorBoundary between the component and the nearest Suspense boundary
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import type { SolidGraph } from "../../impl";
import type { CallEntity } from "../../entities";
import type { FunctionEntity } from "../../entities/function";
import type { VariableEntity } from "../../entities/variable";
import type { JSXElementEntity } from "../../entities/jsx";
import type { FixOperation } from "../../../diagnostic";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { getCallsByPrimitive } from "../../queries/get";
import { getEnclosingComponentScope } from "../../queries";
import { buildSolidImportFix } from "../util";

/** Tags that represent conditional/lazy mount points. */
const CONDITIONAL_MOUNT_TAGS = new Set([
  "Show", "Switch", "Match", "Dynamic", "Portal",
  "Drawer", "Dialog", "Modal", "Popover", "Menu",
  "DropdownMenu", "AlertDialog", "Sheet", "Tooltip",
  "Accordion", "Tabs", "TabPanel",
]);

const messages = {
  loadingMismatch:
    "createResource '{{name}}' has no initialValue but uses {{name}}.loading for manual loading UI. " +
    "Suspense intercepts before your loading UI renders — the component is unmounted before the " +
    "<Show>/<Switch> evaluates. Replace createResource with onMount + createSignal to decouple " +
    "from Suspense entirely.",
  conditionalSuspense:
    "createResource '{{name}}' is inside a conditional mount point ({{mountTag}}) with a distant " +
    "Suspense boundary. The SuspenseContext increment fires when the fetcher's Promise is pending " +
    "and unmounts the entire page subtree — initialValue does NOT prevent this. Replace " +
    "createResource with onMount + createSignal to avoid Suspense interaction.",
  missingErrorBoundary:
    "createResource '{{name}}' has no <ErrorBoundary> between its component and the nearest " +
    "<Suspense>. When the fetcher throws (network error, 401/403/503, timeout), the error " +
    "propagates to Suspense which has no error handling — the boundary breaks permanently. " +
    "Wrap the component in <ErrorBoundary> or replace createResource with onMount + createSignal " +
    "and catch errors in the fetcher.",
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
 * Result of analyzing a component's JSX ancestry for boundary hazards.
 *
 * Collects all relevant information in a single parent chain walk per usage site:
 * conditional mount context, Suspense distance, and ErrorBoundary presence.
 */
interface ComponentBoundaryAnalysis {
  /** First conditional mount tag found before Suspense, or null if none. */
  conditionalMountTag: string | null;
  /** Number of component levels between usage and nearest Suspense. */
  suspenseDistance: number;
  /** True if any usage site has Suspense without an intervening ErrorBoundary. */
  lacksErrorBoundary: boolean;
  /** JSX usage nodes where the component lacks an ErrorBoundary before Suspense. */
  usagesLackingErrorBoundary: JSXElementEntity[];
}

/**
 * Analyze a component's JSX ancestry for Suspense/ErrorBoundary/conditional mount hazards.
 *
 * Single pass over the JSX parent chain per usage site, collecting all boundary
 * information needed by both the loading path and error path checks.
 */
function analyzeComponentBoundaries(
  graph: SolidGraph,
  componentName: string,
): ComponentBoundaryAnalysis {
  const result: ComponentBoundaryAnalysis = {
    conditionalMountTag: null,
    suspenseDistance: 0,
    lacksErrorBoundary: false,
    usagesLackingErrorBoundary: [],
  };

  const usages = graph.jsxByTag.get(componentName) ?? [];
  if (usages.length === 0) return result;

  for (let i = 0, len = usages.length; i < len; i++) {
    const usage = usages[i];
    if (!usage) continue;

    let current: JSXElementEntity | null = usage.parent;
    let conditionalTag: string | null = null;
    let componentLevels = 0;
    let foundErrorBoundary = false;
    let foundSuspense = false;

    while (current) {
      const tag = current.tag;
      if (tag && !current.isDomElement) {
        componentLevels++;

        if (tag === "ErrorBoundary") {
          foundErrorBoundary = true;
        } else if (tag === "Suspense") {
          foundSuspense = true;
          if (!foundErrorBoundary) {
            result.lacksErrorBoundary = true;
            result.usagesLackingErrorBoundary.push(usage);
          }
          if (conditionalTag !== null && componentLevels > 1) {
            result.conditionalMountTag = conditionalTag;
            result.suspenseDistance = componentLevels;
          }
          break;
        } else if (conditionalTag === null && CONDITIONAL_MOUNT_TAGS.has(tag)) {
          conditionalTag = tag;
        }
      }
      current = current.parent;
    }

    // No Suspense or ErrorBoundary found — error propagates to route/layout level
    if (!foundSuspense && !foundErrorBoundary) {
      result.lacksErrorBoundary = true;
      result.usagesLackingErrorBoundary.push(usage);
      if (conditionalTag !== null) {
        result.conditionalMountTag = conditionalTag;
        result.suspenseDistance = componentLevels;
      }
    }
  }

  return result;
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

/**
 * Build a fix to wrap a component's JSX usage in `<ErrorBoundary>`.
 *
 * Inserts `<ErrorBoundary fallback={...}>` before the opening tag and
 * `</ErrorBoundary>` after the closing tag of the JSX element.
 */
function buildErrorBoundaryFix(
  usages: readonly JSXElementEntity[],
  graph: SolidGraph,
): readonly FixOperation[] | null {
  if (usages.length === 0) return null;

  // Wrap the first usage site that lacks an ErrorBoundary
  const usage = usages[0];
  if (!usage) return null;

  const jsxNode = usage.node;
  const startPos = jsxNode.range[0];
  const endPos = jsxNode.range[1];

  const ops: FixOperation[] = [
    { range: [startPos, startPos], text: "<ErrorBoundary fallback={<div>Error</div>}>" },
    { range: [endPos, endPos], text: "</ErrorBoundary>" },
  ];

  const importFix = buildSolidImportFix(graph, "ErrorBoundary");
  if (importFix) ops.unshift(importFix);

  return ops;
}

export const resourceImplicitSuspense = defineSolidRule({
  id: "resource-implicit-suspense",
  severity: "warn",
  messages,
  meta: {
    description: "Detect createResource that implicitly triggers or permanently breaks Suspense boundaries.",
    fixable: true,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    const resourceCalls = getCallsByPrimitive(graph, "createResource");
    if (resourceCalls.length === 0) return;

    // Shared visited set for transitive throw detection across all calls
    const throwVisited = new Set<number>();

    // Cache boundary analysis per component name (multiple createResource
    // calls in the same component share the same JSX ancestry)
    const boundaryCache = new Map<string, ComponentBoundaryAnalysis>();

    for (let i = 0, len = resourceCalls.length; i < len; i++) {
      const call = resourceCalls[i];
      if (!call) continue;

      const resourceName = getResourceVariableName(call);
      if (!resourceName) continue;

      const hasInitial = hasInitialValue(call);
      const componentName = getContainingComponentName(graph, call);

      // Loading path: WARN on manual loading mismatch (no initialValue + .loading reads)
      if (!hasInitial) {
        const resourceVariable = findResourceVariable(graph, resourceName);

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
      }

      if (!componentName) continue;

      // Single JSX parent chain walk for both loading-path and error-path checks
      let analysis = boundaryCache.get(componentName);
      if (!analysis) {
        analysis = analyzeComponentBoundaries(graph, componentName);
        boundaryCache.set(componentName, analysis);
      }

      // Suspense path: ERROR on conditional mount with distant Suspense.
      // Applies regardless of initialValue — the SuspenseContext increment path
      // fires whenever the fetcher's Promise is pending (pr is set), even with
      // initialValue. initialValue only prevents the accessor from returning
      // undefined; it does NOT prevent Suspense activation.
      if (analysis.conditionalMountTag) {
        emit(
          createDiagnostic(
            graph.file,
            call.node,
            "resource-implicit-suspense",
            "conditionalSuspense",
            resolveMessage(messages.conditionalSuspense, {
              name: resourceName,
              mountTag: analysis.conditionalMountTag,
            }),
            "error",
          ),
        );
      }

      // Error path: ERROR on missing ErrorBoundary with throwing fetcher
      if (analysis.lacksErrorBoundary) {
        const fetcherFn = resolveFetcherFunction(graph, call);
        if (fetcherFn && fetcherCanThrow(graph, fetcherFn, throwVisited)) {
          const errorBoundaryFix = buildErrorBoundaryFix(
            analysis.usagesLackingErrorBoundary,
            graph,
          );

          emit(
            createDiagnostic(
              graph.file,
              call.node,
              "resource-implicit-suspense",
              "missingErrorBoundary",
              resolveMessage(messages.missingErrorBoundary, { name: resourceName }),
              "error",
              errorBoundaryFix ?? undefined,
            ),
          );
        }
      }
    }
  },
});
