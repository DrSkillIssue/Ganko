/**
 * Computation Entity
 *
 * Unified representation of a reactive computation node in the
 * dependency graph. Maps to Solid's runtime Computation interface:
 * createEffect, createMemo, createComputed, createRenderEffect,
 * createResource, and createRoot.
 *
 * A computation has:
 * - A backing CallEntity (the primitive invocation)
 * - A callback FunctionEntity (the tracked/deferred body)
 * - Dependencies: signals/memos/stores it reads (over-approximated statically)
 * - An owner: the parent computation or root that owns it for disposal
 */

import type { CallEntity } from "./call";
import type { FunctionEntity } from "./function";
import type { ScopeEntity } from "./scope";
import type { VariableEntity } from "./variable";

/**
 * Discriminates the scheduling behavior of a computation.
 *
 * - `"effect"` — createEffect: pure=false, user=true, deferred to Effects queue
 * - `"render-effect"` — createRenderEffect: pure=false, user=false, immediate
 * - `"computed"` — createComputed: pure=true, synchronous
 * - `"memo"` — createMemo: pure=true, dual node (also a signal source)
 * - `"resource"` — createResource: async, internally creates signals + computed
 * - `"root"` — createRoot: ownership boundary, no tracking
 * - `"reaction"` — createReaction: split tracking (track fn separate from effect fn)
 */
export type ComputationKind =
  | "effect"
  | "render-effect"
  | "computed"
  | "memo"
  | "resource"
  | "root"
  | "reaction";

/**
 * Represents a reactive computation in the SolidGraph.
 */
export interface ComputationEntity {
  readonly id: number;
  readonly kind: ComputationKind;
  /** The primitive call that created this computation. */
  readonly call: CallEntity;
  /** The callback function body (tracked or deferred). Null for createRoot with no-arg fn. */
  readonly callback: FunctionEntity | null;
  /** The scope this computation's callback runs in. */
  readonly scope: ScopeEntity;
  /** Variable this computation is assigned to (e.g. the memo accessor, resource tuple). */
  readonly variable: VariableEntity | null;
  /** Whether this computation is a signal source (readable by other computations). */
  readonly isSource: boolean;
  /** Whether this computation runs in a tracked context (Listener is set). */
  readonly isTracked: boolean;
}

/**
 * A dependency edge: computation reads a reactive source.
 *
 * Static over-approximation — any signal-like variable syntactically
 * reachable from the computation's callback body is included,
 * regardless of runtime control flow.
 */
export interface DependencyEdge {
  /** The computation that reads the source. */
  readonly consumer: ComputationEntity;
  /** The reactive variable being read. */
  readonly source: VariableEntity;
  /** Whether the read is a proper accessor call (e.g. `count()` vs bare `count`). */
  readonly isProperAccess: boolean;
  /** Whether the read is inside an untrack() call within the computation. */
  readonly isUntracked: boolean;
  /**
   * For store/props sources: the property access path (e.g. `["foo", "bar"]`
   * for `store.foo.bar`). Null for signal/memo reads or when the access
   * is dynamic and cannot be statically determined.
   */
  readonly propertyPath: readonly string[] | null;
}

/**
 * An ownership edge: parent computation owns a child computation.
 *
 * Models Solid's runtime Owner tree — when a parent is disposed,
 * all children are recursively disposed. This is structural
 * (lexical nesting at creation time), not behavioral.
 */
export interface OwnershipEdge {
  /** The parent owner (computation or root). */
  readonly owner: ComputationEntity;
  /** The child computation owned by the parent. */
  readonly child: ComputationEntity;
}

/** Maps primitive names to ComputationKind. */
const COMPUTATION_PRIMITIVES: Readonly<Record<string, ComputationKind>> = {
  createEffect: "effect",
  createRenderEffect: "render-effect",
  createComputed: "computed",
  createMemo: "memo",
  createResource: "resource",
  createRoot: "root",
  createReaction: "reaction",
};

/** Returns the ComputationKind for a primitive name, or null if not a computation. */
export function computationKindFor(name: string): ComputationKind | null {
  return COMPUTATION_PRIMITIVES[name] ?? null;
}
