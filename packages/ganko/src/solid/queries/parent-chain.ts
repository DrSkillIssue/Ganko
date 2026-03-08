/**
 * Unified Parent Chain Analysis
 *
 * Provides analysis of the parent chain from any AST node,
 * extracting all commonly-needed information in one walk.
 */

import type { TSESTree as T } from "@typescript-eslint/utils";
import { SYNC_CALLBACK_METHODS } from "../util/call";
import { isUpperAlpha } from "@drskillissue/ganko-shared";

/**
 * Information extracted from walking up the parent chain from a node.
 */
export interface ParentChainInfo {
  enclosingFunction: T.Node | null;
  functionName: string | null;
  componentName: string | null;
  isInJSXExpression: boolean;
  syncCallbackMethod: string | null;
  syncCallbackFunction: T.Node | null;
  syncCallbackCall: T.Node | null;
}

/** Cache for parent chain analysis results */
const parentChainCache = new WeakMap<T.Node, ParentChainInfo>();

/** Frozen empty info for reuse */
const EMPTY_PARENT_CHAIN_INFO: ParentChainInfo = Object.freeze({
  enclosingFunction: null,
  functionName: null,
  componentName: null,
  isInJSXExpression: false,
  syncCallbackMethod: null,
  syncCallbackFunction: null,
  syncCallbackCall: null,
});

/**
 * Analyze the parent chain of a node to extract contextual information.
 *
 * Walks up the AST from the given node to find:
 * - The enclosing function and its name
 * - Whether the node is in a component (PascalCase function)
 * - Whether the node is in a JSX expression
 * - Whether the node is in a sync callback (map, filter, etc.)
 *
 * Results are cached to avoid redundant analysis.
 *
 * @param node - The AST node to analyze
 * @returns ParentChainInfo with all extracted contextual information
 */
export function analyzeParentChain(node: T.Node): ParentChainInfo {
  const cached = parentChainCache.get(node);
  if (cached) return cached;

  const result = computeParentChainInfo(node);
  parentChainCache.set(node, result);
  return result;
}

/**
 * Extract the name of a function from its declaration or variable assignment.
 *
 * Handles:
 * - FunctionDeclaration: `function foo() { }`
 * - FunctionExpression with id: `const x = function foo() { }`
 * - FunctionExpression assigned to variable: `const foo = function() { }`
 * - ArrowFunctionExpression assigned to variable: `const foo = () => { }`
 *
 * @param fn - The function node
 * @returns The function name, or null if unnamed
 */
function extractFunctionName(fn: T.Node): string | null {
  switch (fn.type) {
    case "FunctionDeclaration":
      return fn.id?.name ?? null;

    case "FunctionExpression":
      if (fn.id) return fn.id.name;
      break;
  }

  const fnParent = fn.parent;
  if (fnParent?.type === "VariableDeclarator" && fnParent.id.type === "Identifier") {
    return fnParent.id.name;
  }

  return null;
}

/**
 * Check if a function is a callback in a sync array method.
 *
 * Detects patterns like:
 * - `arr.map(x => x * 2)` - callback to map
 * - `arr.filter(x => x > 0)` - callback to filter
 * - `arr.find(x => x.id === 5)` - callback to find
 *
 * @param fn - The function node to check
 * @returns The method name if this is a sync callback, or null
 */
function getSyncCallbackMethod(fn: T.Node): string | null {
  if (fn.type === "FunctionDeclaration") return null;

  const fnParent = fn.parent;
  if (fnParent?.type !== "CallExpression") return null;
  if (fnParent.callee === fn) return null;

  const callee = fnParent.callee;
  if (callee.type !== "MemberExpression") return null;
  if (callee.property.type !== "Identifier") return null;

  const methodName = callee.property.name;
  return SYNC_CALLBACK_METHODS.has(methodName) ? methodName : null;
}

/**
 * Core parent chain analysis logic.
 *
 * Walks up the AST from the given node, extracting all relevant contextual information.
 * Separated from analyzeParentChain() to enable caching.
 *
 * @param node - The AST node to analyze
 * @returns ParentChainInfo with all extracted information
 */
function computeParentChainInfo(node: T.Node): ParentChainInfo {
  let enclosingFunction: T.Node | null = null;
  let functionName: string | null = null;
  let componentName: string | null = null;
  let isInJSXExpression = false;
  let syncCallbackMethod: string | null = null;
  let syncCallbackFunction: T.Node | null = null;
  let syncCallbackCall: T.Node | null = null;

  let foundFirstFunction = false;
  let current: T.Node | undefined = node.parent;

  while (current) {
    const type = current.type;

    switch (type) {
      case "JSXExpressionContainer":
        if (!foundFirstFunction) {
          isInJSXExpression = true;
        }
        break;

      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (foundFirstFunction) {
          // Already found first function - stop walking
          return buildResult(
            enclosingFunction,
            functionName,
            componentName,
            isInJSXExpression,
            syncCallbackMethod,
            syncCallbackFunction,
            syncCallbackCall,
          );
        }

        foundFirstFunction = true;
        enclosingFunction = current;
        functionName = extractFunctionName(current);

        // Check if this is a component (PascalCase: first char is A-Z)
        if (functionName) {
          if (isUpperAlpha(functionName.charCodeAt(0))) {
            componentName = functionName;
          }
        }

        // Check if this function is a sync callback (map, filter, etc.)
        syncCallbackMethod = getSyncCallbackMethod(current);
        if (syncCallbackMethod) {
          syncCallbackFunction = current;
          syncCallbackCall = current.parent;
        }
        break;
    }

    current = current.parent;
  }

  return buildResult(
    enclosingFunction,
    functionName,
    componentName,
    isInJSXExpression,
    syncCallbackMethod,
    syncCallbackFunction,
    syncCallbackCall,
  );
}

/**
 * Build the result object, returning a frozen singleton for the empty case.
 *
 * Optimizes memory usage by reusing a single frozen empty object for nodes
 * that don't have any contextual information.
 *
 * @param enclosingFunction - The enclosing function node, if any
 * @param functionName - The name of the enclosing function, if any
 * @param componentName - The name of the enclosing component (PascalCase function), if any
 * @param isInJSXExpression - Whether the node is in a JSX expression
 * @param syncCallbackMethod - The method name if in a sync callback, if any
 * @param syncCallbackFunction - The sync callback function node, if any
 * @param syncCallbackCall - The call expression containing the sync callback, if any
 * @returns The built ParentChainInfo
 */
function buildResult(
  enclosingFunction: T.Node | null,
  functionName: string | null,
  componentName: string | null,
  isInJSXExpression: boolean,
  syncCallbackMethod: string | null,
  syncCallbackFunction: T.Node | null,
  syncCallbackCall: T.Node | null,
): ParentChainInfo {
  if (!enclosingFunction && !isInJSXExpression && !syncCallbackMethod) {
    return EMPTY_PARENT_CHAIN_INFO;
  }

  return {
    enclosingFunction,
    functionName,
    componentName,
    isInJSXExpression,
    syncCallbackMethod,
    syncCallbackFunction,
    syncCallbackCall,
  };
}

// Convenience Functions (thin wrappers around analyzeParentChain)

/**
 * Check if a node is inside a JSX expression container.
 *
 * JSX expressions are always tracked in Solid, so this is useful for determining
 * if a signal access should be treated as tracked.
 *
 * @param node - The AST node to check
 * @returns True if the node is inside a JSX expression
 */
export function isInsideJSXExpression(node: T.Node): boolean {
  return analyzeParentChain(node).isInJSXExpression;
}

/**
 * Find the closest enclosing function node.
 *
 * Useful for determining the scope context of a node or checking if a node
 * is at module level.
 *
 * @param node - The AST node to find the enclosing function for
 * @returns The enclosing function node, or null if at module scope
 */
export function findEnclosingFunction(node: T.Node): T.Node | null {
  return analyzeParentChain(node).enclosingFunction;
}

/**
 * Get the name of the enclosing function.
 *
 * Returns the declared or assigned name of the function that encloses this node.
 * Useful for matching against known function names or logging.
 *
 * @param node - The AST node to get the enclosing function name for
 * @returns The function name, or null if unnamed or at module scope
 */
export function getEnclosingFunctionName(node: T.Node): string | null {
  return analyzeParentChain(node).functionName;
}

/**
 * Get the sync callback method name if the node is inside one.
 *
 * Detects array methods like map, filter, find, forEach, etc.
 * Useful for checking if a signal access is inside a synchronous callback
 * that executes at component definition time.
 *
 * @param node - The AST node to check
 * @returns The method name (e.g., "map", "filter"), or null if not in a sync callback
 */
export function getEnclosingSyncCallbackMethod(node: T.Node): string | null {
  return analyzeParentChain(node).syncCallbackMethod;
}

/**
 * Get the name of the enclosing component (PascalCase function).
 *
 * Components are functions with PascalCase names. Useful for detecting
 * if a node is inside a component function vs a regular utility function.
 *
 * @param node - The AST node to check
 * @returns The component name, or null if not inside a component
 */
export function getEnclosingComponentName(node: T.Node): string | null {
  return analyzeParentChain(node).componentName;
}
