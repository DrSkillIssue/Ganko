/**
 * CSS graph phases.
 */
import type { CSSGraph } from "../impl"
import type { CSSInput } from "../input"
type Phase = (graph: CSSGraph, input: CSSInput) => void

import { runParsePhase } from "./parse"
import { runAstPhase } from "./ast"
import { runReferencesPhase } from "./references"
import { runTokensPhase } from "./tokens"
import { runCascadePhase } from "./cascade"
import { runScssPhase } from "./scss"

const phases: readonly Phase[] = [
  runParsePhase,
  runAstPhase,
  runReferencesPhase,
  runTokensPhase,
  runCascadePhase,
  runScssPhase,
]
export function runPhases(graph: CSSGraph, input: CSSInput): void {
  for (const phase of phases) {
    phase(graph, input)
  }
  graph.buildDerivedIndexes()
}