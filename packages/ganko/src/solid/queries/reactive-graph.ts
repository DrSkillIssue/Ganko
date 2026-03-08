/**
 * Reactive Graph Queries
 *
 * Query functions for traversing the reactive dependency and
 * ownership graphs built by the dependencies phase.
 */
import type { SolidGraph } from "../impl";
import type { ComputationEntity, ComputationKind, DependencyEdge } from "../entities/computation";
import type { VariableEntity } from "../entities/variable";

/** Get all computations in the graph. */
export function getComputations(graph: SolidGraph): readonly ComputationEntity[] {
  return graph.computations;
}

/** Get computations filtered by kind. */
export function getComputationsByKind(graph: SolidGraph, kind: ComputationKind): ComputationEntity[] {
  const result: ComputationEntity[] = [];
  const comps = graph.computations;
  for (let i = 0, len = comps.length; i < len; i++) {
    const c = comps[i];
    if (!c) continue;
    if (c.kind === kind) result.push(c);
  }
  return result;
}

/** Get the computation for a given call ID, or null. */
export function getComputationByCallId(graph: SolidGraph, callId: number): ComputationEntity | null {
  return graph.computationByCallId.get(callId) ?? null;
}

/** Get all dependency edges where a computation reads a given variable. */
export function getDependenciesOf(graph: SolidGraph, computation: ComputationEntity): DependencyEdge[] {
  const result: DependencyEdge[] = [];
  const edges = graph.dependencyEdges;
  for (let i = 0, len = edges.length; i < len; i++) {
    const e = edges[i];
    if (!e) continue;
    if (e.consumer === computation) result.push(e);
  }
  return result;
}

/** Get all dependency edges where a given variable is read by any computation. */
export function getConsumersOf(graph: SolidGraph, source: VariableEntity): DependencyEdge[] {
  const result: DependencyEdge[] = [];
  const edges = graph.dependencyEdges;
  for (let i = 0, len = edges.length; i < len; i++) {
    const e = edges[i];
    if (!e) continue;
    if (e.source === source) result.push(e);
  }
  return result;
}

/** Get the direct children owned by a computation. */
export function getOwnedChildren(graph: SolidGraph, owner: ComputationEntity): ComputationEntity[] {
  const result: ComputationEntity[] = [];
  const edges = graph.ownershipEdges;
  for (let i = 0, len = edges.length; i < len; i++) {
    const e = edges[i];
    if (!e) continue;
    if (e.owner === owner) result.push(e.child);
  }
  return result;
}

/** Get the owner of a computation, or null if it's a root. */
export function getOwnerOf(graph: SolidGraph, child: ComputationEntity): ComputationEntity | null {
  const edges = graph.ownershipEdges;
  for (let i = 0, len = edges.length; i < len; i++) {
    const e = edges[i];
    if (!e) continue;
    if (e.child === child) return e.owner;
  }
  return null;
}

/** Get all tracked (non-untracked) dependencies of a computation. */
export function getTrackedDependencies(graph: SolidGraph, computation: ComputationEntity): DependencyEdge[] {
  const result: DependencyEdge[] = [];
  const edges = graph.dependencyEdges;
  for (let i = 0, len = edges.length; i < len; i++) {
    const edge = edges[i];
    if (!edge) continue;
    if (edge.consumer === computation && !edge.isUntracked) result.push(edge);
  }
  return result;
}

/** Get all source computations (memos/resources) that a computation depends on. */
export function getSourceComputations(graph: SolidGraph, computation: ComputationEntity): ComputationEntity[] {
  const deps = getDependenciesOf(graph, computation);
  const result: ComputationEntity[] = [];
  const seen = new Set<number>();

  for (let i = 0, len = deps.length; i < len; i++) {
    const dep = deps[i];
    if (!dep) continue;
    const source = dep.source;
    // Find the computation that produces this variable (if it's a memo/resource)
    const comps = graph.computations;
    for (let j = 0, clen = comps.length; j < clen; j++) {
      const comp = comps[j];
      if (!comp) continue;
      if (comp.variable === source && comp.isSource && !seen.has(comp.id)) {
        seen.add(comp.id);
        result.push(comp);
      }
    }
  }
  return result;
}
