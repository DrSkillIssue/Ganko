/**
 * Factory for typed predicate-based query operations over a graph collection.
 *
 * Produces `countWhere`, `find`, `some`, `every`, and `filter` functions
 * bound to a specific collection accessor, eliminating the per-entity
 * boilerplate that was previously duplicated across query modules.
 */

export interface QueryOps<G, T> {
  readonly countWhere: (graph: G, predicate: (item: T) => boolean) => number
  readonly find: (graph: G, predicate: (item: T) => boolean) => T | null
  readonly some: (graph: G, predicate: (item: T) => boolean) => boolean
  readonly every: (graph: G, predicate: (item: T) => boolean) => boolean
  readonly filter: (graph: G, predicate: (item: T) => boolean) => IterableIterator<T>
}

export function queryOps<G, T>(accessor: (graph: G) => readonly T[]): QueryOps<G, T> {
  function countWhere(graph: G, predicate: (item: T) => boolean): number {
    let count = 0
    const items = accessor(graph)
    for (let i = 0, len = items.length; i < len; i++) {
      const item = items[i]
      if (item !== undefined && predicate(item)) count++
    }
    return count
  }

  function find(graph: G, predicate: (item: T) => boolean): T | null {
    const items = accessor(graph)
    for (let i = 0, len = items.length; i < len; i++) {
      const item = items[i]
      if (item !== undefined && predicate(item)) return item
    }
    return null
  }

  function some(graph: G, predicate: (item: T) => boolean): boolean {
    return find(graph, predicate) !== null
  }

  function every(graph: G, predicate: (item: T) => boolean): boolean {
    const items = accessor(graph)
    for (const item of items) {
      if (!predicate(item)) return false
    }
    return true
  }

  function* filter(graph: G, predicate: (item: T) => boolean): IterableIterator<T> {
    const items = accessor(graph)
    for (const item of items) {
      if (predicate(item)) yield item
    }
  }

  return { countWhere, find, some, every, filter }
}
