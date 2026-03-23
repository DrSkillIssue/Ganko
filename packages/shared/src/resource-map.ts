import { canonicalPath } from "./path";

/**
 * Type-safe map keyed by canonical file paths.
 *
 * Normalizes all keys through canonicalPath() on insert/lookup.
 * Eliminates the class of bugs where the same file has two entries
 * because one path went through canonicalPath() and the other didn't.
 */
export class ResourceMap<T> {
  private readonly _map = new Map<string, T>();

  get size(): number {
    return this._map.size;
  }

  has(path: string): boolean {
    return this._map.has(canonicalPath(path));
  }

  get(path: string): T | undefined {
    return this._map.get(canonicalPath(path));
  }

  set(path: string, value: T): void {
    this._map.set(canonicalPath(path), value);
  }

  delete(path: string): boolean {
    return this._map.delete(canonicalPath(path));
  }

  clear(): void {
    this._map.clear();
  }

  values(): IterableIterator<T> {
    return this._map.values();
  }

  entries(): IterableIterator<[string, T]> {
    return this._map.entries();
  }

  keys(): IterableIterator<string> {
    return this._map.keys();
  }

  forEach(fn: (value: T, key: string) => void): void {
    this._map.forEach(fn);
  }
}
