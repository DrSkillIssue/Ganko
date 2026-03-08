/**
 * Custom LSP request/response types for ganko.
 */

/** Reactive graph node from the LSP server. */
export interface ReactiveGraphNode {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly line: number
}

/** Reactive graph edge from the LSP server. */
export interface ReactiveGraphEdge {
  readonly from: string
  readonly to: string
  readonly kind: string
  readonly label: string
}

/** Result of the solid/showReactiveGraph request. */
export interface ReactiveGraphResult {
  readonly mermaid: string
  readonly dot: string
  readonly nodes: readonly ReactiveGraphNode[]
  readonly edges: readonly ReactiveGraphEdge[]
}

/** Result of the solid/memoryUsage request. */
export interface MemoryUsageResult {
  readonly heapUsedMB: number
  readonly heapTotalMB: number
  readonly rssMB: number
  readonly externalMB: number
  readonly objectCount: number
  readonly uptimeMinutes: number
}
