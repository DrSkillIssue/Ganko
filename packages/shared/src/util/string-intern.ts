/**
 * String Interning Utilities
 *
 * String interning stores a single copy of each unique string value
 * and reuses that reference, reducing memory usage for frequently
 * repeated strings.
 */

/**
 * A string interner that stores canonical string references.
 *
 * When the same string value is encountered multiple times, the interner
 * returns the same reference, enabling reference equality comparisons
 * and reducing memory usage.
 *
 * @example
 * const interner = new StringInterner();
 * const a = interner.intern("hello");
 * const b = interner.intern("hello");
 * console.log(a === b); // true (same reference)
 */
export class StringInterner {
  private readonly table = new Map<string, string>();

  /**
   * Intern a string, returning a canonical reference.
   *
   * If the string has been seen before, returns the existing reference.
   * Otherwise, stores and returns the input string.
   *
   * @param s - The string to intern
   * @returns The canonical interned string
   */
  intern(s: string): string {
    const existing = this.table.get(s);
    if (existing !== undefined) return existing;
    this.table.set(s, s);
    return s;
  }

  /**
   * Check if a string has been interned.
   *
   * @param s - The string to check
   * @returns True if the string is already in the intern table
   */
  has(s: string): boolean {
    return this.table.has(s);
  }

  /**
   * Get the interned version of a string if it exists.
   *
   * @param s - The string to look up
   * @returns The interned string or undefined
   */
  get(s: string): string | undefined {
    return this.table.get(s);
  }

  /**
   * Clear all interned strings.
   */
  clear(): void {
    this.table.clear();
  }

  /**
   * Get the number of interned strings.
   *
   * @returns The number of strings in the intern table
   */
  get size(): number {
    return this.table.size;
  }

  /**
   * Pre-intern a set of strings.
   *
   * @param strings - Array of strings to intern
   */
  internAll(strings: readonly string[]): void {
    for (const s of strings) {
      this.intern(s);
    }
  }

  /**
   * Pre-intern strings from an object's values.
   *
   * @param obj - Object whose string values should be interned
   */
  internFromObject(obj: Record<string, string>): void {
    for (const value of Object.values(obj)) {
      this.intern(value);
    }
  }
}
