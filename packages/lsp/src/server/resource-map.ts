/**
 * Resource Map — Type-safe file-path-to-value mapping.
 *
 * All keys are canonical file paths. Canonicalization is encapsulated so
 * consumers never touch raw strings or call canonicalPath() ad-hoc.
 * Handles case-insensitive file systems (Windows) transparently.
 *
 * Replaces raw Map<string, T> instances scattered across ServerContext,
 * DocumentState, diagCache, and tsDiagCache.
 */

import { canonicalPath } from "@drskillissue/ganko-shared";

export class ResourceMap<T> {
  private readonly map = new Map<string, T>();
  private readonly isCaseInsensitive: boolean;

  constructor(caseInsensitive = process.platform === "win32") {
    this.isCaseInsensitive = caseInsensitive;
  }

  private toKey(path: string): string {
    const canonical = canonicalPath(path);
    return this.isCaseInsensitive ? canonical.toLowerCase() : canonical;
  }

  has(path: string): boolean {
    return this.map.has(this.toKey(path));
  }

  get(path: string): T | undefined {
    return this.map.get(this.toKey(path));
  }

  set(path: string, value: T): void {
    this.map.set(this.toKey(path), value);
  }

  delete(path: string): boolean {
    return this.map.delete(this.toKey(path));
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  values(): IterableIterator<T> {
    return this.map.values();
  }

  entries(): IterableIterator<[string, T]> {
    return this.map.entries();
  }

  forEach(fn: (value: T, key: string) => void): void {
    this.map.forEach(fn);
  }
}
