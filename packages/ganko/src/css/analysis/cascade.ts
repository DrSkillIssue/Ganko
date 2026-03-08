/**
 * Cascade Resolution Utilities
 *
 * Functions for resolving CSS cascade order and determining
 * which declarations win when multiple rules target the same element.
 *
 */

import type { DeclarationEntity, CascadePosition, Specificity } from "../entities";
import { hasFlag, DECL_IS_IMPORTANT } from "../entities";

/**
 * Cascade Comparison.
 *
 * @param a - First declaration
 * @param b - Second declaration
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
function compareCascadeInline(a: DeclarationEntity, b: DeclarationEntity): number {
  const posA = a.cascadePosition;
  const posB = b.cascadePosition;

  // 1. !important
  if (posA.isImportant !== posB.isImportant) {
    return posA.isImportant ? 1 : -1;
  }

  // 2. Layer order (reverse for !important)
  if (posA.layerOrder !== posB.layerOrder) {
    const diff = posA.layerOrder - posB.layerOrder;
    return posA.isImportant ? -diff : diff;
  }

  // 3. Specificity - single number comparison (vs 4 tuple comparisons)
  if (posA.specificityScore !== posB.specificityScore) {
    return posA.specificityScore - posB.specificityScore;
  }

  // 4. Source order
  return posA.sourceOrder - posB.sourceOrder;
}

/**
 * Compare two cascade positions directly.
 *
 * @param posA - First cascade position
 * @param posB - Second cascade position
 * @returns Negative if posA < posB, positive if posA > posB, 0 if equal
 */
export function compareCascadePositions(posA: CascadePosition, posB: CascadePosition): number {
  if (posA === posB) {
    return 0;
  }

  // 1. !important
  if (posA.isImportant !== posB.isImportant) {
    return posA.isImportant ? 1 : -1;
  }

  // 2. Layer order (reverse for !important)
  if (posA.layerOrder !== posB.layerOrder) {
    const diff = posA.layerOrder - posB.layerOrder;
    return posA.isImportant ? -diff : diff;
  }

  // 3. Specificity - use precomputed score (single comparison)
  if (posA.specificityScore !== posB.specificityScore) {
    return posA.specificityScore - posB.specificityScore;
  }

  // 4. Source order
  return posA.sourceOrder - posB.sourceOrder;
}

/**
 * Get the cascade position information for a declaration.
 *
 * @param decl - The declaration to analyze
 * @param layers - Ordered layer names (first = lowest priority)
 * @param layerMap - Optional Map for layer indices
 * @returns Cascade position info
 */
export function getCascadePosition(
  decl: DeclarationEntity,
  layers: readonly string[] = [],
  layerMap?: Map<string, number>,
): CascadePosition {
  if (layers.length === 0) {
    return decl.cascadePosition;
  }

  // Slow path: custom layers need layer order recalculation
  let layerOrder = 0;
  const rule = decl.rule;

  if (rule && rule.parent && rule.parent.kind !== "rule") {
    const atRule = rule.parent;
    if (atRule.kind === "layer" && atRule.params) {
      if (layerMap) {
        const idx = layerMap.get(atRule.params);
        if (idx !== undefined) {
          layerOrder = idx;
        }
      } else {
        const layerIndex = layers.indexOf(atRule.params);
        if (layerIndex !== -1) {
          layerOrder = layerIndex + 1;
        }
      }
    }
  }

  // Find highest specificity selector
  let specificity: Specificity = [0, 0, 0, 0];
  let specificityScore = 0;
  if (rule && rule.kind === "rule" && rule.selectors.length > 0) {
    for (let i = 0; i < rule.selectors.length; i++) {
      const sel = rule.selectors[i];
      if (!sel) continue;
      if (sel.specificityScore > specificityScore) {
        specificityScore = sel.specificityScore;
        specificity = sel.specificity;
      }
    }
  }

  return {
    layer: decl.cascadePosition.layer,
    layerOrder,
    sourceOrder: decl.id,
    specificity,
    specificityScore,
    isImportant: hasFlag(decl._flags, DECL_IS_IMPORTANT),
  };
}

/**
 * Compare two declarations for cascade order.
 *
 * @param a - First declaration
 * @param b - Second declaration
 * @param layers - Ordered layer names for @layer resolution
 * @returns Comparison result
 */
export function compareCascade(
  a: DeclarationEntity,
  b: DeclarationEntity,
  layers: readonly string[] = [],
): number {
  if (a === b) {
    return 0;
  }

  if (layers.length === 0) {
    return compareCascadeInline(a, b);
  }

  // Slow path: custom layers
  const layerMap = new Map(layers.map((name, i) => [name, i + 1]));
  const posA = getCascadePosition(a, layers, layerMap);
  const posB = getCascadePosition(b, layers, layerMap);
  return compareCascadePositions(posA, posB);
}

/**
 * Resolve which declaration wins in the cascade.
 *
 * @param declarations - Declarations to compare
 * @param layers - Ordered layer names for @layer resolution
 * @returns The winning declaration, or null if empty
 */
export function resolveCascade(
  declarations: readonly DeclarationEntity[],
  layers: readonly string[] = [],
): DeclarationEntity | null {
  const len = declarations.length;
  if (len === 0) {
    return null;
  }
  if (len === 1) {
    return declarations[0] ?? null;
  }

  if (layers.length === 0) {
    let winner = declarations[0];
    if (!winner) return null;
    for (let i = 1; i < len; i++) {
      const candidate = declarations[i];
      if (!candidate) continue;
      if (compareCascadeInline(candidate, winner) > 0) {
        winner = candidate;
      }
    }
    return winner;
  }

  // Slow path: custom layers
  const layerMap = new Map(layers.map((name, i) => [name, i + 1]));
  let winner = declarations[0];
  if (!winner) return null;
  let winnerPos = getCascadePosition(winner, layers, layerMap);

  for (let i = 1; i < len; i++) {
    const current = declarations[i];
    if (!current) continue;
    const currentPos = getCascadePosition(current, layers, layerMap);
    if (compareCascadePositions(currentPos, winnerPos) > 0) {
      winner = current;
      winnerPos = currentPos;
    }
  }

  return winner;
}

/**
 * Sort declarations by cascade order (winner last).
 *
 * @param declarations - Declarations to sort
 * @param layers - Ordered layer names for @layer resolution
 * @returns New array sorted by cascade order (ascending, winner last)
 */
export function sortByCascade(
  declarations: readonly DeclarationEntity[],
  layers: readonly string[] = [],
): readonly DeclarationEntity[] {
  const len = declarations.length;
  if (len <= 1) {
    return declarations;
  }

  if (layers.length === 0) {
    const result = declarations.slice();
    result.sort(compareCascadeInline);
    return result;
  }

  // Slow path: custom layers - decorate-sort-undecorate
  const layerMap = new Map(layers.map((name, i) => [name, i + 1]));
  const decorated: { decl: DeclarationEntity; pos: CascadePosition }[] = [];
  for (let i = 0; i < len; i++) {
    const decl = declarations[i];
    if (!decl) continue;
    decorated.push({ decl, pos: getCascadePosition(decl, layers, layerMap) });
  }

  decorated.sort((a, b) => compareCascadePositions(a.pos, b.pos));

  const result: DeclarationEntity[] = [];
  for (let i = 0; i < decorated.length; i++) {
    const entry = decorated[i];
    if (!entry) continue;
    result.push(entry.decl);
  }
  return result;
}

/**
 * Check if declaration A would override declaration B.
 *
 * @param a - Potentially overriding declaration
 * @param b - Potentially overridden declaration
 * @returns true if A would override B
 */
export function doesOverride(a: DeclarationEntity, b: DeclarationEntity): boolean {
  if (a === b) {
    return false;
  }
  return compareCascadeInline(a, b) > 0;
}
