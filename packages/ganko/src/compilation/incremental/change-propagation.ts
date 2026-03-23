/**
 * Change propagation — transitive invalidation via reverse dependency edges.
 *
 * Given a changed file, determines which other files' SemanticModels
 * are stale and need rebinding. Uses the DependencyGraph's reverse edges
 * to propagate invalidation from CSS changes to Solid files that import them.
 */
import type { DependencyGraph } from "./dependency-graph"
import type { StyleCompilation } from "../core/compilation"

export interface ChangePropagationResult {
  readonly directlyChanged: ReadonlySet<string>
  readonly transitivelyAffected: ReadonlySet<string>
  readonly allStale: ReadonlySet<string>
}

/**
 * Compute the full set of stale files given a set of directly changed file paths.
 *
 * CSS change → transitively affected Solid files (via reverse import edges)
 * Solid change → only that Solid file
 * Both → union
 */
export function propagateChanges(
  changedFiles: ReadonlySet<string>,
  dependencyGraph: DependencyGraph,
  _compilation: StyleCompilation,
): ChangePropagationResult {
  const directlyChanged = new Set(changedFiles)
  const transitivelyAffected = new Set<string>()

  for (const filePath of changedFiles) {
    const affected = dependencyGraph.getTransitivelyAffected(filePath)
    for (let i = 0; i < affected.length; i++) {
      const dep = affected[i]
      if (!dep) continue
      if (directlyChanged.has(dep)) continue
      transitivelyAffected.add(dep)
    }
  }

  const allStale = new Set<string>()
  for (const f of directlyChanged) allStale.add(f)
  for (const f of transitivelyAffected) allStale.add(f)

  return { directlyChanged, transitivelyAffected, allStale }
}

/**
 * Determine which Solid files need SemanticModel rebinding
 * given a set of stale file paths. Only Solid files that exist
 * in the compilation's solidTrees are returned.
 */
export function filterStaleSolidFiles(
  staleFiles: ReadonlySet<string>,
  compilation: StyleCompilation,
): ReadonlySet<string> {
  const out = new Set<string>()
  for (const filePath of staleFiles) {
    if (compilation.solidTrees.has(filePath)) out.add(filePath)
  }
  return out
}
