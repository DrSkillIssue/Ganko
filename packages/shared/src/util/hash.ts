/**
 * Hash Utilities
 *
 * String hashing functions for content comparison and indexing.
 */

/**
 * Create a content hash for change detection using djb2 variant.
 *
 * @param content - The string to hash
 * @returns Base-36 encoded hash string
 */
export function computeContentHash(content: string): string {
  let hash = 0;
  const len = content.length;
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Simple hash for string indexing/bucketing.
 * Uses djb2 algorithm with seed 5381.
 *
 * @param s - The string to hash
 * @returns Unsigned 32-bit hash value
 */
export function simpleHash(s: string): number {
  let hash = 5381;
  const len = s.length;
  for (let i = 0; i < len; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
  }
  return hash >>> 0;
}
