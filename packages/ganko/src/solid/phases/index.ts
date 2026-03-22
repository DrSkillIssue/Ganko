import type { SolidBuildContext } from "../build-context"
import type { SolidInput } from "../input"

// Phase type — just a function
type Phase = (graph: SolidBuildContext, input: SolidInput) => void

// Import phase implementations
import { runPreparePhase } from "./prepare"
import { runScopesPhase } from "./scopes"
import { runEntitiesPhase } from "./entities"
import { runContextPhase } from "./context"
import { runWiringPhase } from "./wiring"
import { runReactivityPhase } from "./reactivity"
import { runReachabilityPhase } from "./reachability"
import { runExportsPhase } from "./exports"
import { runDependenciesPhase } from "./dependencies"

const phases: readonly Phase[] = [
  // Phase 1: Validate AST parent links
  runPreparePhase,
  // Phase 2: Create scopes and variables
  runScopesPhase,
  // Phase 3: Create functions, calls, JSX, imports, classes
  runEntitiesPhase,
  // Phase 4: Set tracking contexts
  runContextPhase,
  // Phase 5: Wire JSX hierarchy, resolve call targets
  runWiringPhase,
  // Phase 6: Detect reactive variables
  runReactivityPhase,
  // Phase 7: Determine reachability
  runReachabilityPhase,
  // Phase 8: Extract exports
  runExportsPhase,
  // Phase 9: Build reactive dependency and ownership graphs
  runDependenciesPhase,
]

/**
 * Run all phases to build the graph.
 */
export function runPhases(graph: SolidBuildContext, input: SolidInput): void {
  for (const phase of phases) {
    phase(graph, input)
  }
}