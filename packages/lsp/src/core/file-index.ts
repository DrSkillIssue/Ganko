/**
 * Workspace File Index
 *
 * Scans the workspace root for all Solid and CSS files at startup,
 * then maintains the index via didChangeWatchedFiles notifications.
 * Provides the full file set needed for cross-file analysis.
 */
import { readdirSync } from "node:fs";
import { join, relative, matchesGlob } from "node:path";
import { canonicalPath, classifyFile } from "@drskillissue/ganko-shared";
import type { Logger } from "@drskillissue/ganko-shared";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".output", "coverage"]);

export interface FileIndex {
  /** All tracked file paths */
  readonly solidFiles: ReadonlySet<string>
  readonly cssFiles: ReadonlySet<string>
  /** All files combined (for runner.run()) */
  allFiles(): readonly string[]
  /** Mutators for watcher events */
  add(path: string): void
  remove(path: string): void
}

/**
 * Test whether a path relative to the root matches any exclude pattern.
 *
 * @param relativePath - Forward-slash relative path from the project root
 * @param excludes - Glob patterns to test against
 * @returns `true` if the path should be excluded
 */
function isExcluded(relativePath: string, excludes: readonly string[]): boolean {
  for (let i = 0, len = excludes.length; i < len; i++) {
    const pattern = excludes[i];
    if (!pattern) continue;
    if (matchesGlob(relativePath, pattern)) return true;
  }
  return false;
}

function classify(path: string, solidFiles: Set<string>, cssFiles: Set<string>): void {
  const key = canonicalPath(path);
  const kind = classifyFile(key);
  if (kind === "solid") solidFiles.add(key);
  if (kind === "css") cssFiles.add(key);
}

function scanDir(
  dir: string,
  rootPath: string,
  excludes: readonly string[],
  solidFiles: Set<string>,
  cssFiles: Set<string>,
  log?: Logger,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    if (log?.enabled) log.trace(`fileIndex: scanDir error reading ${dir}`);
    return;
  }

  const hasExcludes = excludes.length > 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      const childDir = join(dir, entry.name);
      if (hasExcludes && isExcluded(relative(rootPath, childDir), excludes)) continue;
      scanDir(childDir, rootPath, excludes, solidFiles, cssFiles, log);
      continue;
    }
    if (entry.isFile()) {
      const filePath = join(dir, entry.name);
      if (hasExcludes && isExcluded(relative(rootPath, filePath), excludes)) continue;
      classify(filePath, solidFiles, cssFiles);
    }
  }
}

/**
 * Create a file index by scanning the project root.
 *
 * @param rootPath - Project root directory
 * @param excludes - Glob patterns matched against paths relative to rootPath
 */
export function createFileIndex(rootPath: string, excludes: readonly string[] = [], log?: Logger): FileIndex {
  const solidFiles = new Set<string>();
  const cssFiles = new Set<string>();

  const t0 = performance.now();
  scanDir(rootPath, rootPath, excludes, solidFiles, cssFiles, log);
  if (log?.enabled) log.debug(`fileIndex: scanned ${rootPath} → ${solidFiles.size} solid, ${cssFiles.size} css in ${(performance.now() - t0).toFixed(1)}ms`);

  return {
    get solidFiles() { return solidFiles; },
    get cssFiles() { return cssFiles; },

    allFiles() {
      const out: string[] = new Array(solidFiles.size + cssFiles.size);
      let idx = 0;
      for (const f of solidFiles) out[idx++] = f;
      for (const f of cssFiles) out[idx++] = f;
      return out;
    },

    add(path) {
      classify(path, solidFiles, cssFiles);
    },

    remove(path) {
      const key = canonicalPath(path);
      solidFiles.delete(key);
      cssFiles.delete(key);
    },
  };
}
