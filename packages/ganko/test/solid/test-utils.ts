import { buildSolidGraph, analyzeInput } from "../../src/solid/plugin"
import { parseContent } from "../../src/solid/parse"
import type { Emit } from "../../src/graph"
import type { SolidGraph, SolidInput } from "../../src"
import type { Diagnostic, FixOperation } from "../../src/diagnostic"

/**
 * Parse code and create SolidInput.
 */
export function parseCode(code: string, filePath = "test.tsx"): SolidInput {
  return parseContent(filePath, code)
}

/**
 * Build a SolidGraph from code string.
 */
export function buildGraph(code: string, filePath = "test.tsx"): SolidGraph {
  const input = parseCode(code, filePath)
  return buildSolidGraph(input)
}

export interface RuleTestResult {
  diagnostics: readonly Diagnostic[]
  graph: SolidGraph
  code: string
}

/**
 * Run a single rule against code.
 */
export function checkRule(rule: { check: (graph: SolidGraph, emit: Emit) => void }, code: string): RuleTestResult {
  const graph = buildGraph(code)
  const diagnostics: Diagnostic[] = []
  rule.check(graph, (d) => diagnostics.push(d))
  return { diagnostics, graph, code }
}

/**
 * Run ALL rules against code.
 */
export function checkAll(code: string): RuleTestResult {
  const input = parseCode(code)
  const graph = buildSolidGraph(input)
  const diagnostics: Diagnostic[] = []
  analyzeInput(input, (d) => diagnostics.push(d))
  return { diagnostics, graph, code }
}

/**
 * Safely index into a readonly array, throwing if the element is missing.
 * Use in tests where the element is expected to exist.
 */
export function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index]
  if (value === undefined) throw new Error(`Expected element at index ${index}, but array length is ${arr.length}`)
  return value
}

/**
 * Apply all fixes to source code.
 */
export function applyAllFixes(code: string, diagnostics: readonly Diagnostic[]): string {
  const ops: FixOperation[] = []
  for (const d of diagnostics) {
    if (!d.fix) continue
    ops.push(...d.fix)
  }
  if (ops.length === 0) return code
  ops.sort((a, b) => b.range[0] - a.range[0])
  let result = code
  for (const op of ops) {
    result = result.slice(0, op.range[0]) + op.text + result.slice(op.range[1])
  }
  return result
}
