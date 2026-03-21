/**
 * Workspace File Index
 *
 * Scans the workspace root for all Solid and CSS files at startup,
 * then maintains the index via didChangeWatchedFiles notifications.
 * Provides the full file set needed for cross-file analysis.
 *
 * Respects `.gitignore` files (root and nested) using the `ignore` package
 * which implements the full gitignore specification including negation,
 * directory-only patterns, anchoring, and escape sequences.
 */
import ignore, { type Ignore } from "ignore";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, matchesGlob } from "node:path";
import { canonicalPath, classifyFile, Level } from "@drskillissue/ganko-shared";
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

function classify(path: string, solidFiles: Set<string>, cssFiles: Set<string>, log?: Logger): void {
  const key = canonicalPath(path);
  const kind = classifyFile(key);
  if (kind === "solid") {
    solidFiles.add(key);
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: classified solid: ${key}`);
  } else if (kind === "css") {
    cssFiles.add(key);
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: classified css: ${key}`);
  }
}

/**
 * Resolve a symlink to its real path and stat it.
 *
 * @returns `{ realPath, isFile, isDir }` or null if the target is unresolvable
 */
function resolveSymlink(
  linkPath: string,
  log?: Logger,
): { realPath: string; isFile: boolean; isDir: boolean } | null {
  try {
    const realPath = realpathSync(linkPath);
    const st = statSync(realPath);
    return { realPath, isFile: st.isFile(), isDir: st.isDirectory() };
  } catch {
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: cannot resolve symlink ${linkPath}`);
    return null;
  }
}

/** An `Ignore` instance scoped to the directory containing its `.gitignore`. */
interface ScopedIgnore {
  readonly dir: string
  readonly ig: Ignore
}

/**
 * Try to read a `.gitignore` file and create a scoped `Ignore` instance.
 *
 * @returns A `ScopedIgnore` or null if no `.gitignore` exists
 */
function tryLoadGitignore(dir: string, log?: Logger): ScopedIgnore | null {
  const gitignorePath = join(dir, ".gitignore");
  let raw: string;
  try {
    raw = readFileSync(gitignorePath, "utf-8");
  } catch {
    return null;
  }
  const ig = ignore().add(raw);
  if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: loaded .gitignore from ${dir}`);
  return { dir, ig };
}

/**
 * Test whether a path is ignored by any `.gitignore` in the stack.
 *
 * Each `ScopedIgnore` is tested with a path relative to its own directory,
 * matching git's behavior where nested `.gitignore` patterns are relative
 * to the directory containing the `.gitignore` file.
 *
 * @param absolutePath - Absolute path to test
 * @param isDir - Whether the path is a directory (appends `/` for gitignore dir-only patterns)
 * @param gitignoreStack - Stack of scoped ignore instances (root first)
 * @returns `true` if any gitignore in the stack ignores this path
 */
function isGitignored(
  absolutePath: string,
  isDir: boolean,
  gitignoreStack: readonly ScopedIgnore[],
): boolean {
  for (let i = gitignoreStack.length - 1; i >= 0; i--) {
    const scoped = gitignoreStack[i];
    if (!scoped) continue;
    const rel = relative(scoped.dir, absolutePath);
    if (rel.startsWith("..")) continue;
    /* The `ignore` package distinguishes files from directories: `foo/` in
       gitignore only matches directories. Appending `/` tells the package
       this path is a directory. */
    const testPath = isDir ? rel + "/" : rel;
    const result = scoped.ig.test(testPath);
    if (result.ignored) return true;
    if (result.unignored) return false;
  }
  return false;
}

function scanDir(
  dir: string,
  rootPath: string,
  excludes: readonly string[],
  solidFiles: Set<string>,
  cssFiles: Set<string>,
  visited: Set<string>,
  gitignoreStack: ScopedIgnore[],
  log?: Logger,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: scanDir error reading ${dir}`);
    return;
  }

  /* Check for a nested .gitignore in this directory. */
  const nestedIgnore = tryLoadGitignore(dir, log);
  if (nestedIgnore !== null) {
    gitignoreStack.push(nestedIgnore);
  }

  const hasExcludes = excludes.length > 0;
  const hasGitignore = gitignoreStack.length > 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;

    if (entry.isSymbolicLink()) {
      const linkPath = join(dir, entry.name);
      const resolved = resolveSymlink(linkPath, log);
      if (resolved === null) continue;

      if (resolved.isDir) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        if (hasExcludes && isExcluded(relative(rootPath, linkPath), excludes)) continue;
        if (hasGitignore && isGitignored(linkPath, true, gitignoreStack)) continue;
        if (visited.has(resolved.realPath)) continue;
        visited.add(resolved.realPath);
        scanDir(resolved.realPath, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, log);
      } else if (resolved.isFile) {
        if (hasExcludes && isExcluded(relative(rootPath, linkPath), excludes)) continue;
        if (hasGitignore && isGitignored(linkPath, false, gitignoreStack)) continue;
        classify(linkPath, solidFiles, cssFiles, log);
      }
      continue;
    }

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        // Scan top-level entries inside node_modules for symlinked workspace
        // packages. Symlinks indicate workspace dependencies whose source files
        // (including co-located CSS) must be in the analysis set. Non-symlink
        // directories (actual node_modules dependencies) are not traversed.
        scanWorkspaceSymlinks(join(dir, entry.name), rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, log);
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) {
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: skip dir (built-in): ${join(dir, entry.name)}`);
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      const childDir = join(dir, entry.name);
      if (hasExcludes && isExcluded(relative(rootPath, childDir), excludes)) {
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: skip dir (excluded): ${childDir}`);
        continue;
      }
      if (hasGitignore && isGitignored(childDir, true, gitignoreStack)) {
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: skip dir (gitignored): ${childDir}`);
        continue;
      }
      scanDir(childDir, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, log);
      continue;
    }
    if (entry.isFile()) {
      const filePath = join(dir, entry.name);
      if (hasExcludes && isExcluded(relative(rootPath, filePath), excludes)) continue;
      if (hasGitignore && isGitignored(filePath, false, gitignoreStack)) continue;
      classify(filePath, solidFiles, cssFiles, log);
    }
  }

  /* Pop the nested gitignore when leaving this directory. */
  if (nestedIgnore !== null) {
    gitignoreStack.pop();
  }
}

/**
 * Scans a node_modules directory for symlinked workspace packages and
 * recursively indexes their contents. Only follows symlinked directories
 * (workspace packages) — non-symlink directories (installed dependencies)
 * are skipped. Handles scoped packages (@scope/name) by scanning one
 * level deeper for scope directories.
 */
function scanWorkspaceSymlinks(
  nodeModulesDir: string,
  rootPath: string,
  excludes: readonly string[],
  solidFiles: Set<string>,
  cssFiles: Set<string>,
  visited: Set<string>,
  gitignoreStack: ScopedIgnore[],
  log?: Logger,
): void {
  let entries;
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.name.startsWith(".")) continue;

    // Scoped packages: @scope directories contain the actual package symlinks
    if (entry.isDirectory() && entry.name.startsWith("@")) {
      const scopeDir = join(nodeModulesDir, entry.name);
      let scopeEntries;
      try {
        scopeEntries = readdirSync(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (let j = 0; j < scopeEntries.length; j++) {
        const scopeEntry = scopeEntries[j];
        if (!scopeEntry) continue;
        if (!scopeEntry.isSymbolicLink()) continue;
        const linkPath = join(scopeDir, scopeEntry.name);
        const resolved = resolveSymlink(linkPath, log);
        if (resolved === null || !resolved.isDir) continue;
        if (visited.has(resolved.realPath)) continue;
        visited.add(resolved.realPath);
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: workspace package (scoped): ${entry.name}/${scopeEntry.name} → ${resolved.realPath}`);
        scanDir(resolved.realPath, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, log);
      }
      continue;
    }

    // Unscoped packages: direct symlinks are workspace packages
    if (entry.isSymbolicLink()) {
      const linkPath = join(nodeModulesDir, entry.name);
      const resolved = resolveSymlink(linkPath, log);
      if (resolved === null || !resolved.isDir) continue;
      if (visited.has(resolved.realPath)) continue;
      visited.add(resolved.realPath);
      if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileIndex: workspace package: ${entry.name} → ${resolved.realPath}`);
      scanDir(resolved.realPath, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, log);
    }
  }
}

/**
 * Create a file index by scanning the project root.
 *
 * Respects `.gitignore` files at all directory levels using the `ignore`
 * package (full gitignore spec: negation, directory-only, anchoring, escapes).
 * Patterns from nested `.gitignore` files are scoped to their containing
 * directory, matching git's behavior.
 *
 * @param rootPath - Project root directory
 * @param excludes - Glob patterns matched against paths relative to rootPath
 */
export function createFileIndex(rootPath: string, excludes: readonly string[] = [], log?: Logger): FileIndex {
  const solidFiles = new Set<string>();
  const cssFiles = new Set<string>();

  const t0 = performance.now();
  const visited = new Set<string>();
  const gitignoreStack: ScopedIgnore[] = [];
  scanDir(rootPath, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, log);
  if (log?.isLevelEnabled(Level.Debug)) log.debug(`fileIndex: scanned ${rootPath} → ${solidFiles.size} solid, ${cssFiles.size} css in ${(performance.now() - t0).toFixed(1)}ms`);

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
      classify(path, solidFiles, cssFiles, log);
    },

    remove(path) {
      const key = canonicalPath(path);
      solidFiles.delete(key);
      cssFiles.delete(key);
    },
  };
}
