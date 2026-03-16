/**
 * Spread-related query functions
 */
import ts from "typescript";
import type { SolidGraph } from "../impl";
import type { ObjectSpreadEntity, SpreadSourceReactivity } from "../entities/spread";
import { getScopeFor, getVariableByNameInScope } from "./scope";
import { getVariableReads, isSplitPropsVariable, isMergePropsVariable, getVariableSourceKind } from "./entity";

/**
 * Determine the reactivity classification of a spread's source.
 *
 * @param graph - The solid program graph
 * @param spread - The object spread entity
 * @returns The source reactivity classification
 */
export function getSpreadSourceReactivity(
  graph: SolidGraph,
  spread: ObjectSpreadEntity,
): SpreadSourceReactivity {
  // Literal spreads are always safe
  if (spread.sourceKind === "literal") {
    return "plainObject";
  }

  // No source name means we can't look it up
  if (!spread.sourceName) {
    return "unknown";
  }

  // For member expressions like "props.classList", get base name
  const parts = spread.sourceName.split(".");
  const baseName = parts[0];
  if (!baseName) return "unknown";

  const scope = getScopeFor(graph, spread.node);
  const variable = getVariableByNameInScope(graph, baseName, scope);

  if (!variable) {
    return "unknown";
  }

  // Use graph methods for splitProps/mergeProps detection
  if (isSplitPropsVariable(variable)) {
    return "splitPropsRest";
  }
  if (isMergePropsVariable(variable)) {
    return "mergePropsResult";
  }

  // Check reactive kind (set after wiring)
  if (variable.reactiveKind) {
    switch (variable.reactiveKind) {
      case "props": return "props";
      case "store": return "store";
      case "signal": return "signal";
      case "accessor":
      case "memo":
      case "resource":
        return "accessor";
    }
  }

  // Check if plain object initialization via source kind
  const sourceKind = getVariableSourceKind(variable);
  if (sourceKind === "literal") {
    return "plainObject";
  }

  return "unknown";
}

/**
 * Check if a spread is a pure props pass-through pattern.
 *
 * A pure pass-through is when props are spread to a child component
 * without any local property access - just forwarding everything.
 *
 * @param graph - The solid program graph
 * @param spread - The object spread entity
 * @returns True if this is pure forwarding without local access
 */
export function isPropsPassThrough(graph: SolidGraph, spread: ObjectSpreadEntity): boolean {
  // Only applies to JSX spreads
  if (spread.kind !== "jsx-spread") return false;

  // Must have a simple identifier as source (like "props", not "props.x")
  if (!spread.sourceName || spread.sourceName.includes(".")) return false;

  const scope = getScopeFor(graph, spread.node);
  const variable = getVariableByNameInScope(graph, spread.sourceName, scope);

  if (!variable) return false;

  // Get all reads of this variable
  const reads = getVariableReads(variable);

  // Check if the only read is this spread itself
  // Pure pass-through means no other accesses to the variable in the function
  const spreadNode = ts.isJsxSpreadAttribute(spread.node) ? spread.node.expression : null;
  if (!spreadNode) return false;

  // Count reads that aren't the spread itself
  let otherReadCount = 0;
  for (let i = 0, len = reads.length; i < len; i++) {
    const read = reads[i];
    if (!read) continue;
    if (read.node !== spreadNode) {
      otherReadCount++;
    }
  }

  // If there are no other reads, this is pure pass-through
  return otherReadCount === 0;
}
