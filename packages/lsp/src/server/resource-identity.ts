/**
 * Resource Identity — Bidirectional URI ↔ canonical-path conversion.
 *
 * Single source of truth for all URI/path operations in the server.
 * Every handler, cache, and diagnostic publisher uses this interface
 * instead of calling uriToPath/pathToUri/canonicalPath directly.
 */

import { canonicalPath, uriToPath, pathToUri } from "@drskillissue/ganko-shared"

export interface ResourceIdentity {
  /** Convert a file:// URI to a canonical file path. */
  uriToPath(uri: string): string
  /** Convert a canonical file path to a file:// URI. */
  pathToUri(path: string): string
  /** Canonicalize a raw file path. */
  canonicalize(path: string): string
}

export function createResourceIdentity(): ResourceIdentity {
  return {
    uriToPath(uri: string): string {
      return uriToPath(uri)
    },
    pathToUri(path: string): string {
      return pathToUri(path)
    },
    canonicalize(path: string): string {
      return canonicalPath(path)
    },
  }
}
