/**
 * Resource Access Unchecked Rule
 *
 * Detect access to resources without checking their loading/error states.
 *
 * Solid's `createResource()` is async. Before accessing the data, you must check:
 * - `.loading` - is the resource still loading?
 * - `.error` - did an error occur?
 *
 * Accessing the resource value without checking causes:
 * - `undefined` values when loading
 * - Error values instead of data
 * - Incorrect rendering and logic bugs
 *
 * Problem:
 * ```
 * const [data] = createResource(fetchData);
 * <div>{data().name}</div>  // Could be undefined or an error!
 * ```
 *
 * Correct:
 * ```
 * const [data] = createResource(fetchData);
 * <Show when={data() && !data.error} fallback={<Loading />}>
 *   <div>{data().name}</div>
 * </Show>
 * ```
 *
 * Or use `<Suspense>` boundaries to handle async properly.
 */

import ts from "typescript";
import type { SolidGraph } from "../../impl";
import type { VariableEntity, ScopeEntity, JSXElementEntity } from "../../entities";
import { defineSolidRule } from "../../rule";
import { createDiagnostic, resolveMessage } from "../../../diagnostic";
import { getJSXContext, getEnclosingComponentScope } from "../../queries";

const messages = {
  resourceUnchecked: "Accessing resource '{{name}}' without checking loading/error state may return undefined. Wrap in <Show when={!{{name}}.loading}> or <Suspense>.",
} as const;

const options = {};

/** Property names on resource objects that access metadata, not reactive data. */
const RESOURCE_METADATA_PROPS = new Set(["loading", "error", "state", "latest", "refetch", "mutate"]);

/**
 * Build set of component tags rendered inside Suspense boundaries.
 *
 * Inverts the lookup: walk down from Suspense elements once to build
 * a Set of wrapped components, then check membership per read.
 *
 * @param graph - The program graph containing JSX elements
 * @returns Set of component tag names that are wrapped in Suspense
 */
function buildSuspenseWrappedComponents(graph: SolidGraph): Set<string> {
  const suspenseElements = graph.jsxByTag.get("Suspense") ?? [];
  if (suspenseElements.length === 0) {
    return new Set();
  }

  const wrapped = new Set<string>();

  for (let i = 0, len = suspenseElements.length; i < len; i++) {
    const el = suspenseElements[i];
    if (!el) continue;
    collectChildComponentTags(el, wrapped);
  }

  return wrapped;
}

/**
 * Collect non-DOM element tags from JSX children.
 *
 * Walks the JSX tree to find all component (non-DOM) element tags.
 * DOM elements are skipped. Mutates the result set by adding found tags.
 *
 * @param element - The JSX element to collect children from
 * @param result - Set to add found component tags to (mutated)
 */
function collectChildComponentTags(
  element: JSXElementEntity,
  result: Set<string>,
): void {
  const children = element.childElements;
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i];
    if (!child) continue;
    // Non-DOM elements with tags are components
    if (!child.isDomElement && child.tag) {
      result.add(child.tag);
    }
    // Recurse into children (both DOM and component elements can have children)
    collectChildComponentTags(child, result);
  }
}

/**
 * Create a Suspense checker using the component set.
 *
 * Returns a function that checks if a scope is inside a Suspense-wrapped component.
 * Caches results by scope for repeated queries.
 *
 * @param graph - The program graph for scope analysis
 * @param suspenseWrappedComponents - Set of component tags wrapped in Suspense
 * @returns Function that checks if a scope has a Suspense ancestor
 */
function createSuspenseChecker(
  graph: SolidGraph,
  suspenseWrappedComponents: Set<string>,
): (scope: ScopeEntity) => boolean {
  // No Suspense boundaries in file - return constant false
  if (suspenseWrappedComponents.size === 0) {
    return () => false;
  }

  const cache = new Map<ScopeEntity, boolean>();

  return function hasSuspenseAncestor(scope: ScopeEntity): boolean {
    const cached = cache.get(scope);
    if (cached !== undefined) return cached;

    // Get enclosing component (cached on scope entity)
    const component = getEnclosingComponentScope(graph, scope);
    if (!component) {
      cache.set(scope, false);
      return false;
    }

    const isWrapped = suspenseWrappedComponents.has(component.name);
    cache.set(scope, isWrapped);
    return isWrapped;
  };
}

/**
 * Build a map of Show elements to the resource names they guard.
 *
 * Determines which Show components check which resources upfront,
 * enabling constant-time lookup during read checking.
 *
 * @param graph - The program graph containing JSX elements
 * @param resourceNames - Set of all resource variable names in the file
 * @returns Map from Show elements to the resource names they guard
 */
function buildShowGuardedResources(
  graph: SolidGraph,
  resourceNames: Set<string>,
): Map<JSXElementEntity, Set<string>> {
  const showElements = graph.jsxByTag.get("Show") ?? [];
  if (showElements.length === 0) {
    return new Map();
  }

  const result = new Map<JSXElementEntity, Set<string>>();

  for (let i = 0, len = showElements.length; i < len; i++) {
    const show = showElements[i];
    if (!show) continue;
    // Skip DOM elements (unlikely but possible if user defines <show>)
    if (show.isDomElement) continue;

    const attrs = show.attributes;
    for (let j = 0, attrLen = attrs.length; j < attrLen; j++) {
      const attr = attrs[j];
      if (!attr) continue;
      if (attr.name === "when" && attr.valueNode) {
        const guardedNames = extractGuardedResourceNames(attr.valueNode, resourceNames);
        if (guardedNames.size > 0) {
          result.set(show, guardedNames);
        }
        break; // Found the when attribute, no need to continue
      }
    }
  }

  return result;
}

/**
 * Extract resource names that appear in guard conditions.
 *
 * Looks for patterns like:
 *   - !resource.loading
 *   - resource.loading
 *   - resource.error
 *   - resource()
 *
 * @param node - The AST node to analyze (typically a condition expression)
 * @param resourceNames - Set of known resource variable names
 * @returns Set of resource names found in the condition
 */
function extractGuardedResourceNames(
  node: ts.Node,
  resourceNames: Set<string>,
): Set<string> {
  const result = new Set<string>();
  extractResourceNamesFromCondition(node, resourceNames, result);
  return result;
}

/**
 * Extract resource names from a condition expression.
 *
 * Analyzes expressions to find resource checks. Handles patterns like
 * member access (resource.loading), unary expressions (!resource.error), logical
 * expressions (resource.loading && !resource.error), and call expressions (resource()).
 *
 * @param node - The AST node to analyze
 * @param resourceNames - Set of known resource variable names
 * @param result - Set to add found resource names to (mutated)
 */
function extractResourceNamesFromCondition(
  node: ts.Node,
  resourceNames: Set<string>,
  result: Set<string>,
): void {
  // resource.loading, resource.error
  if (ts.isPropertyAccessExpression(node)) {
    const obj = node.expression;
    if (ts.isIdentifier(obj) && resourceNames.has(obj.text)) {
      if (ts.isIdentifier(node.name)) {
        const propName = node.name.text;
        if (propName === "loading" || propName === "error") {
          result.add(obj.text);
        }
      }
    }
  }
  // !resource.loading, !resource.error, !resource()
  else if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    extractResourceNamesFromCondition(node.operand, resourceNames, result);
  }
  // resource.loading && !resource.error (LogicalExpression → BinaryExpression in TS)
  else if (ts.isBinaryExpression(node)) {
    extractResourceNamesFromCondition(node.left, resourceNames, result);
    extractResourceNamesFromCondition(node.right, resourceNames, result);
  }
  // resource() - truthy check
  else if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression) && resourceNames.has(node.expression.text)) {
      result.add(node.expression.text);
    }
  }
  // resource()?.prop - optional chaining (TS doesn't have ChainExpression; optional chaining is on the node itself)
  else if (ts.isNonNullExpression(node)) {
    extractResourceNamesFromCondition(node.expression, resourceNames, result);
  }
}

/**
 * Check if a node is inside a Show with a condition that guards the resource.
 *
 * Walks up the JSX element tree from the read node to check if any ancestor
 * Show element guards the resource. Uses the Show guards map for lookup.
 *
 * @param graph - The program graph for JSX context lookup
 * @param readNode - The AST node of the resource read
 * @param resourceName - The name of the resource variable
 * @param showGuards - Map of Show elements to guarded resource names
 * @returns True if the read is inside a Show that guards this resource
 */
function isInsideShowGuard(
  graph: SolidGraph,
  readNode: ts.Node,
  resourceName: string,
  showGuards: Map<JSXElementEntity, Set<string>>,
): boolean {

  if (showGuards.size === 0) return false;

  const jsxContext = getJSXContext(graph, readNode);
  if (!jsxContext) return false;

  let element: JSXElementEntity | null = jsxContext.element;
  while (element) {
    const guards = showGuards.get(element);
    if (guards && guards.has(resourceName)) {
      return true;
    }
    element = element.parent;
  }

  return false;
}

/**
 * Check if a read of the resource is an unchecked accessor call.
 *
 * Detects patterns that access resource data without proper checks:
 * - Flags: resource().name, resource().data, resource()[0]
 * - Allows: resource.loading, resource.error, resource()?.prop, resource()!
 *
 * The read node is the Identifier for the resource variable.
 *
 * @param readNode - The AST node of the resource variable read
 * @returns True if this is an unsafe resource data access
 */
function isUncheckedResourceCall(readNode: ts.Node): boolean {
  const parent = readNode.parent;
  if (!parent) return false;

  // resource() - calling the accessor
  if (ts.isCallExpression(parent) && parent.expression === readNode) {
    // Check if this is just a truthy check (no property access after)
    const grandparent = parent.parent;

    // resource() in a Show when condition is not an error
    if (grandparent && ts.isJsxExpression(grandparent)) {
      const greatGrandparent = grandparent.parent;
      if (greatGrandparent && ts.isJsxAttribute(greatGrandparent)) {
        return false; // Allow in JSX attribute expressions
      }
    }

    // resource()! - non-null assertion indicates developer awareness
    if (grandparent && ts.isNonNullExpression(grandparent)) {
      return false;
    }

    // resource()?.prop - optional chaining is safe
    if (grandparent && ts.isPropertyAccessExpression(grandparent) && grandparent.questionDotToken) {
      return false;
    }

    // resource().prop - direct property access without check is unsafe
    if (grandparent && ts.isPropertyAccessExpression(grandparent) && !grandparent.questionDotToken) {
      return true;
    }

    // resource()[index] - array access is unsafe without check
    if (grandparent && ts.isElementAccessExpression(grandparent)) {
      return true;
    }

    return false;
  }

  // resource.loading, resource.error - accessing metadata is fine
  if (ts.isPropertyAccessExpression(parent) && parent.expression === readNode) {
    if (ts.isIdentifier(parent.name)) {
      const propName = parent.name.text;

      if (RESOURCE_METADATA_PROPS.has(propName)) {
        return false;
      }
    }
  }

  return false;
}

/**
 * Cache for loading/error check results by block and resource name.
 *
 * Structure: Map<BlockNode, Map<resourceName, guardEndPosition>>
 * If a read's position is after guardEndPosition, it's guarded.
 */
type BlockGuardCache = Map<ts.Node, Map<string, number>>;

/**
 * Build a cache of guard positions for resource variables.
 *
 * For each block that contains an if statement checking resource.loading/error
 * with an early return, stores the end position of that if statement. This allows
 * checking whether a resource read is after a guard check.
 *
 * @param resourceVariables - All resource variables in the file
 * @returns Map from block nodes to resource guard end positions
 */
function buildBlockGuardCache(
  resourceVariables: readonly VariableEntity[],
): BlockGuardCache {
  const cache: BlockGuardCache = new Map();

  for (let i = 0, len = resourceVariables.length; i < len; i++) {
    const variable = resourceVariables[i];
    if (!variable) continue;
    const resourceName = variable.name;
    // Look for reads of resource.loading or resource.error in if conditions
    const reads = variable.reads;
    for (let j = 0, rlen = reads.length; j < rlen; j++) {
      const read = reads[j];
      if (!read) continue;
      const readNode = read.node;

      const guardInfo = findGuardPatternFromRead(readNode);
      if (!guardInfo) continue;

      let blockMap = cache.get(guardInfo.block);
      if (!blockMap) {
        blockMap = new Map();
        cache.set(guardInfo.block, blockMap);
      }

      const existing = blockMap.get(resourceName);
      // Keep the maximum guard position (later guard overrides earlier)
      if (existing === undefined || guardInfo.guardEndPosition > existing) {
        blockMap.set(resourceName, guardInfo.guardEndPosition);
      }
    }
  }

  return cache;
}

/**
 * Check if a read is part of a guard pattern (if statement with early return).
 *
 * Detects patterns like:
 * ```
 * if (resource.loading) return <Loading />;
 * ```
 *
 * @param readNode - The resource variable read node
 * @returns Object with block and guard end position, or null if not a guard
 */
function findGuardPatternFromRead(
  readNode: ts.Node,
): { block: ts.Node; guardEndPosition: number } | null {
  // Check if this is a resource.loading or resource.error access
  const parent = readNode.parent;
  if (!parent || !ts.isPropertyAccessExpression(parent) || parent.expression !== readNode) {
    return null;
  }

  if (!ts.isIdentifier(parent.name)) {
    return null;
  }

  const propName = parent.name.text;
  if (propName !== "loading" && propName !== "error") {
    return null;
  }

  let current: ts.Node | undefined = parent;
  let ifStatement: ts.IfStatement | null = null;

  while (current) {
    if (ts.isIfStatement(current)) {
      // Check if we were in the test (condition) part
      if (isDescendantOf(parent, current.expression)) {
        ifStatement = current;
      }
      break;
    }
    current = current.parent;
  }

  if (!ifStatement) return null;

  if (!hasEarlyExit(ifStatement.thenStatement)) {
    return null;
  }

  let block: ts.Node | undefined = ifStatement.parent;
  while (block && !ts.isBlock(block) && !ts.isSourceFile(block)) {
    block = block.parent;
  }

  if (!block) return null;

  return {
    block,
    guardEndPosition: ifStatement.end,
  };
}

/**
 * Check if child is a descendant of ancestor.
 *
 * Walks up the parent chain from child to see if it reaches ancestor.
 *
 * @param child - The potential descendant node
 * @param ancestor - The potential ancestor node
 * @returns True if child is a descendant of ancestor
 */
function isDescendantOf(child: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = child;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

/**
 * Check if there's a loading/error check before this read in the same scope.
 *
 * Finds the enclosing block statement and checks if there's a guard for this
 * resource that ends before the read position. Uses the block guard cache for lookup.
 *
 * @param readNode - The resource read node to check
 * @param resourceName - The name of the resource variable
 * @param guardCache - Cache of guard positions per block
 * @returns True if there's a guard check before this read
 */
function hasLoadingErrorCheckBefore(
  readNode: ts.Node,
  resourceName: string,
  guardCache: BlockGuardCache,
): boolean {

  let block: ts.Node | undefined = readNode.parent;
  while (block && !ts.isBlock(block) && !ts.isSourceFile(block)) {
    if (ts.isArrowFunction(block) && !ts.isBlock(block.body)) {
      // Arrow function with expression body - no statements to check
      return false;
    }
    block = block.parent;
  }

  if (!block) return false;

  // Check if there's a guard for this resource in this block
  const blockMap = guardCache.get(block);
  if (!blockMap) return false;

  const guardEndPosition = blockMap.get(resourceName);
  if (guardEndPosition === undefined) return false;

  const readPosition = readNode.pos;
  return readPosition > guardEndPosition;
}

/**
 * Check if a statement block has an early exit (return or throw).
 *
 * Searches for return or throw statements in the given statement
 * or block. Used to identify guard patterns with early returns.
 *
 * @param node - The statement to check
 * @returns True if the statement contains a return or throw
 */
function hasEarlyExit(node: ts.Statement): boolean {
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
    return true;
  }
  if (ts.isBlock(node)) {
    const body = node.statements;
    for (let i = 0, len = body.length; i < len; i++) {
      const stmt = body[i];
      if (!stmt) continue;
      if (hasEarlyExit(stmt)) return true;
    }
  }
  return false;
}

export const resourceAccessUnchecked = defineSolidRule({
  id: "resource-access-unchecked",
  severity: "error",
  messages,
  meta: {
    description: "Detect accessing resource data without checking loading/error state.",
    fixable: false,
    category: "reactivity",
  },
  options,
  check(graph, emit) {
    // Get resource variables directly from the graph (marked during graph building)
    const resourceVariables = graph.resourceVariables;
    if (resourceVariables.length === 0) {
      return;
    }

    // Build Suspense-wrapped components set once, then lookup per read
    const suspenseWrappedComponents = buildSuspenseWrappedComponents(graph);
    const hasSuspenseAncestor = createSuspenseChecker(graph, suspenseWrappedComponents);

    const resourceNames = new Set<string>();
    for (let i = 0, len = resourceVariables.length; i < len; i++) {
      const rv = resourceVariables[i];
      if (!rv) continue;
      resourceNames.add(rv.name);
    }

    const showGuards = buildShowGuardedResources(graph, resourceNames);

    // Build block guard cache for loading/error checks
    const guardCache = buildBlockGuardCache(resourceVariables);

    for (let i = 0, len = resourceVariables.length; i < len; i++) {
      const variable = resourceVariables[i];
      if (!variable) continue;
      const name = variable.name;
      const reads = variable.reads;

      for (let j = 0, rlen = reads.length; j < rlen; j++) {
        const read = reads[j];
        if (!read) continue;
        const readNode = read.node;

        if (!isUncheckedResourceCall(readNode)) {
          continue;
        }

        if (hasSuspenseAncestor(read.scope)) {
          continue;
        }

        if (isInsideShowGuard(graph, readNode, name, showGuards)) {
          continue;
        }

        // Skip if there's a loading/error check before this read
        if (hasLoadingErrorCheckBefore(readNode, name, guardCache)) {
          continue;
        }

        // Report on the call expression, not just the identifier
        const parent = readNode.parent;
        const reportNode = parent && ts.isCallExpression(parent) ? parent : readNode;

        emit(
          createDiagnostic(
            graph.file,
            reportNode,
            graph.sourceFile,
            "resource-access-unchecked",
            "resourceUnchecked",
            resolveMessage(messages.resourceUnchecked, { name }),
            "error",
          ),
        );
      }
    }
  },
});
