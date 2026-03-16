import { createHash } from "node:crypto";

/**
 * Compute a 16-hex-char (64-bit) content hash from file text.
 *
 * Used as the version key for SolidGraph caching. Two files with
 * identical text produce the same hash — collision probability is
 * negligible for ~10^3 files (birthday bound ~2^32).
 *
 * @param text - File content to hash
 * @returns 16-character hex string (first 64 bits of SHA-256)
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
