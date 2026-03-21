import { realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolved project root — a nominal wrapper that cannot be constructed
 * from a raw string without going through a factory function.
 *
 * The `path` field is the canonical (realpath-resolved, absolute) directory.
 * Use `.path` wherever a string is needed. The wrapper exists so that
 * "project root" is a distinct type from "arbitrary string" in every
 * function signature — you cannot accidentally pass a file path or URI.
 */
export class ProjectRoot {
  readonly path: string;

  /** @param canonical - Canonical absolute path */
  private constructor(canonical: string) {
    this.path = canonical;
  }

  /** String coercion returns the canonical path. */
  toString(): string {
    return this.path;
  }

  /** JSON serialization returns the canonical path. */
  toJSON(): string {
    return this.path;
  }

  /** @internal Factory — only used by the module-level factory functions below. */
  static _create(canonical: string): ProjectRoot {
    return new ProjectRoot(canonical);
  }
}

const PROJECT_MARKERS = ["tsconfig.json", "package.json"] as const;

function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function toCanonical(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}

/**
 * Resolve a project root from a starting directory.
 *
 * Walks up from `startDir` looking for `tsconfig.json` or `package.json`.
 * Returns the nearest directory containing either marker — the same strategy
 * TypeScript and oxlint use.
 *
 * Falls back to the starting directory if no marker is found.
 *
 * @param startDir - Directory to start searching from
 * @returns Resolved project root
 */
export function resolveProjectRoot(startDir: string): ProjectRoot {
  let dir = resolve(startDir);
  for (;;) {
    for (let i = 0; i < PROJECT_MARKERS.length; i++) {
      const marker = PROJECT_MARKERS[i];
      if (marker !== undefined && fileExists(join(dir, marker))) {
        return ProjectRoot._create(toCanonical(dir));
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return ProjectRoot._create(toCanonical(startDir));
    dir = parent;
  }
}

/**
 * Accept a pre-resolved path as a ProjectRoot.
 *
 * Used by the LSP where the editor provides the workspace folder URI.
 * Canonicalizes the path for stable keying.
 *
 * @param absolutePath - Absolute filesystem path
 * @returns Resolved project root
 */
export function acceptProjectRoot(absolutePath: string): ProjectRoot {
  return ProjectRoot._create(toCanonical(absolutePath));
}

/**
 * Accept a workspace folder URI as a ProjectRoot.
 *
 * @param uri - File URI or absolute path
 * @returns Resolved project root
 */
export function projectRootFromUri(uri: string): ProjectRoot {
  if (uri.startsWith("file:")) {
    return ProjectRoot._create(toCanonical(fileURLToPath(uri)));
  }
  return ProjectRoot._create(toCanonical(uri));
}
