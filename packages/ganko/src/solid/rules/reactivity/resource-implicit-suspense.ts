/**
 * Resource Implicit Suspense Rule
 *
 * Detects `createResource` calls without `initialValue` that implicitly trigger Suspense.
 *
 * In SolidJS, `createResource` without `initialValue` starts in an unresolved state,
 * which propagates up the component tree as a thrown Promise until it hits a `<Suspense>`
 * boundary. That boundary unmounts its entire children subtree and shows its fallback.
 *
 * This is dangerous when:
 * 1. The component has manual loading handling (`resource.loading` checks) alongside
 *    a bare `createResource` — the developer intended local loading UI, not Suspense.
 * 2. The component is mounted conditionally (inside Drawer, Dialog, Modal, Show, etc.)
 *    and the nearest Suspense boundary is a distant layout-level wrapper — triggering
 *    Suspense unmounts the entire page unexpectedly.
 *
 * WARN: createResource without initialValue AND the component reads resource.loading
 * ERROR: createResource without initialValue AND rendered inside a conditional mount point
 *        AND nearest Suspense boundary is more than 1 component level up
 */

import type { SolidGraph } from "../../impl";
import type { CallEntity } from "../../entities";
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

  // Find the options argument: the last argument if it's an object expression
  const lastArg = args[args.length - 1];
  if (!lastArg || lastArg.type !== "ObjectExpression") return false;

  // Check if the object has an `initialValue` property
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
 *
 * Searches the resource variable's reads for member expressions accessing `.loading`.
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
 * Find the nearest conditional mount point ancestor for a component.
 *
 * Walks up the JSX parent chain from the component's usage site to find
 * tags matching CONDITIONAL_MOUNT_TAGS.
 */
function findConditionalMountAncestor(
  graph: SolidGraph,
  componentName: string,
): { tag: string; suspenseDistance: number } | null {
  // Find JSX usages of this component
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
          // Found Suspense — if we already found a conditional mount point
          // and we're more than 1 component level away, it's an error
          if (conditionalTag !== null && componentLevels > 1) {
            return { tag: conditionalTag, suspenseDistance: componentLevels };
          }
          // Suspense is close enough — no issue
          return null;
        }

        if (conditionalTag === null && CONDITIONAL_MOUNT_TAGS.has(tag)) {
          conditionalTag = tag;
        }
      }
      current = current.parent;
    }

    // No Suspense found at all — if there's a conditional mount, flag it
    // (the Suspense boundary is infinitely far away, or at route/layout level)
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
  // The call's scope itself may be the component scope
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
    description: "Detect createResource without initialValue that implicitly triggers Suspense boundaries.",
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

      // Skip if initialValue is provided
      if (hasInitialValue(call)) continue;

      const resourceName = getResourceVariableName(call);
      if (!resourceName) continue;

      const resourceVariable = findResourceVariable(graph, resourceName);

      // Check WARN case: manual loading handling alongside bare createResource
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
        continue;
      }

      // Check ERROR case: conditional mount point with distant Suspense
      const componentName = getContainingComponentName(graph, call);
      if (!componentName) continue;

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
  },
});
