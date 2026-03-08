import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function isAsciiLetter(charCode: number): boolean {
  return (charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122);
}

function normalizeWindowsDrive(path: string): string {
  const firstChar = path[0];
  if (path.length >= 2 && path[1] === ":" && firstChar && isAsciiLetter(firstChar.charCodeAt(0))) {
    return firstChar.toLowerCase() + path.slice(1);
  }

  const fifthChar = path[4];
  if (
    path.length >= 6
    && path.startsWith("\\\\?\\")
    && path[5] === ":"
    && fifthChar
    && isAsciiLetter(fifthChar.charCodeAt(0))
  ) {
    return `${path.slice(0, 4)}${fifthChar.toLowerCase()}${path.slice(5)}`;
  }

  return path;
}

/**
 * Cached canonical path lookups.
 *
 * Bounded to 10k entries — well above typical workspace sizes.
 * Entries are evicted in bulk (clear) when the limit is reached
 * since the cache is a hot-path optimization, not a source of truth.
 */
const canonicalPathCache = new Map<string, string>();
const CANONICAL_PATH_CACHE_LIMIT = 10_000;

/**
 * Resolve a file path to its canonical (symlink-resolved, absolute) form.
 *
 * Results are cached to avoid repeated `realpathSync.native` syscalls.
 * The cache is bounded to 10k entries and cleared on overflow.
 *
 * @param path - File system path to canonicalize
 * @returns Canonical absolute path for stable keying
 */
export function canonicalPath(path: string): string {
  const cached = canonicalPathCache.get(path);
  if (cached !== undefined) return cached;

  const resolved = resolve(path);
  let canonical = resolved;
  try {
    canonical = realpathSync.native(resolved);
  } catch {
    // Path does not exist or is inaccessible — use the absolute-resolved form.
  }
  if (process.platform === "win32") {
    canonical = normalizeWindowsDrive(canonical);
  }
  if (canonicalPathCache.size >= CANONICAL_PATH_CACHE_LIMIT) {
    canonicalPathCache.clear();
  }
  canonicalPathCache.set(path, canonical);
  return canonical;
}

/**
 * Convert file URI to file system path.
 *
 * Delegates to Node.js `node:url` for correct URI→path conversion,
 * handling percent-encoding, Windows drive letters, and UNC paths.
 * The result is canonicalized for stable map-key usage.
 *
 * @param uri - File URI (file://...)
 * @returns Canonical file system path
 */
export function uriToPath(uri: string): string {
  if (uri.startsWith("file:")) {
    return canonicalPath(fileURLToPath(uri));
  }
  return uri;
}

/**
 * Convert file system path to file URI.
 *
 * @param path - File system path
 * @returns File URI
 */
export function pathToUri(path: string): string {
  return pathToFileURL(path).href;
}
