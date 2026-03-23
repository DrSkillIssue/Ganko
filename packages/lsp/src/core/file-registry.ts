/**
 * File Registry
 *
 * Single owner of every known file's path, classification, and content.
 * Replaces the scattered FileIndex + readCSSFilesFromDisk + ad-hoc content reading.
 *
 * Scans the workspace using WorkspaceLayout for workspace-aware directory traversal.
 * Provides change events so consumers (Tailwind, CSS graph, diagnostics) react to mutations.
 */
import ignore, { type Ignore } from "ignore";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, matchesGlob } from "node:path";
import { canonicalPath, classifyFile, Level } from "@drskillissue/ganko-shared";
import type { Logger, WorkspaceLayout } from "@drskillissue/ganko-shared";
import { createCSSInput } from "@drskillissue/ganko";
import type { CSSInput, TailwindValidator } from "@drskillissue/ganko";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".output", "coverage"]);

export interface FileRegistryEvents {
  onFilesChanged(paths: readonly string[], changeType: "added" | "removed" | "changed"): void
  onCSSContentChanged(paths: readonly string[]): void
}

export interface FileRegistry {
  readonly solidFiles: ReadonlySet<string>
  readonly cssFiles: ReadonlySet<string>

  allFiles(): readonly string[]

  getCSSContent(path: string): string | null
  loadAllCSSContent(): readonly { path: string; content: string }[]

  addFile(path: string): void
  removeFile(path: string): void
  updateCSSContent(path: string, content: string): void

  cssContentVersion(): number

  /**
   * Build a CSSInput from the current registry state.
   *
   * Loads all CSS file content, attaches the tailwind validator and
   * external custom properties. This is the single construction point
   * for CSSInput — no consumer should assemble CSSInput manually.
   *
   * @param tailwind - Resolved Tailwind validator (null if unavailable)
   * @param externalCustomProperties - Library-provided CSS custom properties
   * @param logger - Logger for CSS parsing diagnostics
   * @returns CSSInput ready for buildCSSGraph
   */
  buildCSSInput(
    tailwind: TailwindValidator | null,
    externalCustomProperties: ReadonlySet<string> | undefined,
    logger?: Logger,
  ): CSSInput

  subscribe(listener: FileRegistryEvents): void
}

/** An `Ignore` instance scoped to the directory containing its `.gitignore`. */
interface ScopedIgnore {
  readonly dir: string
  readonly ig: Ignore
}

function tryLoadGitignore(dir: string, log?: Logger): ScopedIgnore | null {
  const gitignorePath = join(dir, ".gitignore");
  let raw: string;
  try {
    raw = readFileSync(gitignorePath, "utf-8");
  } catch {
    return null;
  }
  const ig = ignore().add(raw);
  if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: loaded .gitignore from ${dir}`);
  return { dir, ig };
}

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
    const testPath = isDir ? rel + "/" : rel;
    const result = scoped.ig.test(testPath);
    if (result.ignored) return true;
    if (result.unignored) return false;
  }
  return false;
}

function isExcluded(relativePath: string, excludes: readonly string[]): boolean {
  for (let i = 0, len = excludes.length; i < len; i++) {
    const pattern = excludes[i];
    if (!pattern) continue;
    if (matchesGlob(relativePath, pattern)) return true;
  }
  return false;
}

function resolveReal(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function classify(
  path: string,
  solidFiles: Set<string>,
  cssFiles: Set<string>,
  log?: Logger,
): void {
  const key = canonicalPath(path);
  const kind = classifyFile(key);
  if (kind === "solid") {
    solidFiles.add(key);
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: classified solid: ${key}`);
  } else if (kind === "css") {
    cssFiles.add(key);
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: classified css: ${key}`);
  }
}

function scanDir(
  dir: string,
  rootPath: string,
  excludes: readonly string[],
  solidFiles: Set<string>,
  cssFiles: Set<string>,
  visited: Set<string>,
  gitignoreStack: ScopedIgnore[],
  skipDirs: ReadonlySet<string>,
  log?: Logger,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: scanDir error reading ${dir}`);
    return;
  }

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
      let realPath: string;
      let isFile: boolean;
      let isDir: boolean;
      try {
        realPath = realpathSync(linkPath);
        const st = statSync(realPath);
        isFile = st.isFile();
        isDir = st.isDirectory();
      } catch {
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: cannot resolve symlink ${linkPath}`);
        continue;
      }

      if (isDir) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        if (hasExcludes && isExcluded(relative(rootPath, linkPath), excludes)) continue;
        if (hasGitignore && isGitignored(linkPath, true, gitignoreStack)) continue;
        if (visited.has(realPath)) continue;
        visited.add(realPath);
        scanDir(realPath, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, skipDirs, log);
      } else if (isFile) {
        if (hasExcludes && isExcluded(relative(rootPath, linkPath), excludes)) continue;
        if (hasGitignore && isGitignored(linkPath, false, gitignoreStack)) continue;
        classify(linkPath, solidFiles, cssFiles, log);
      }
      continue;
    }

    if (entry.isDirectory()) {
      const childDir = join(dir, entry.name);

      if (entry.name === "node_modules") continue;

      if (SKIP_DIRS.has(entry.name)) {
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: skip dir (built-in): ${childDir}`);
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      if (hasExcludes && isExcluded(relative(rootPath, childDir), excludes)) {
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: skip dir (excluded): ${childDir}`);
        continue;
      }
      if (hasGitignore && isGitignored(childDir, true, gitignoreStack)) {
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: skip dir (gitignored): ${childDir}`);
        continue;
      }

      const realChild = resolveReal(childDir);

      if (skipDirs.has(realChild)) {
        if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: skip dir (workspace root): ${childDir}`);
        continue;
      }

      if (visited.has(realChild)) continue;
      visited.add(realChild);
      scanDir(childDir, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, skipDirs, log);
      continue;
    }

    if (entry.isFile()) {
      const filePath = join(dir, entry.name);
      if (hasExcludes && isExcluded(relative(rootPath, filePath), excludes)) continue;
      if (hasGitignore && isGitignored(filePath, false, gitignoreStack)) continue;
      classify(filePath, solidFiles, cssFiles, log);
    }
  }

  if (nestedIgnore !== null) {
    gitignoreStack.pop();
  }
}

/**
 * Create a file registry by scanning the workspace.
 *
 * Architecture:
 * 1. Receive WorkspaceLayout with pre-resolved workspace package paths
 * 2. Scan the project root, skipping workspace root directories
 * 3. Scan each workspace root exactly once
 * 4. All scans share a single visited set keyed by realpath
 */
export function createFileRegistry(
  layout: WorkspaceLayout,
  excludes: readonly string[] = [],
  log?: Logger,
): FileRegistry {
  const solidFiles = new Set<string>();
  const cssFiles = new Set<string>();
  const cssContentCache = new Map<string, string>();
  const listeners: FileRegistryEvents[] = [];
  let _cssContentVersion = 0;

  const t0 = performance.now();
  const visited = new Set<string>();
  const gitignoreStack: ScopedIgnore[] = [];
  const rootPath = layout.root.path;

  // Build skipDirs from workspace package paths
  const skipDirs = new Set<string>();
  for (const wsPath of layout.packagePaths) {
    skipDirs.add(resolveReal(wsPath));
  }

  // Phase 1: Scan the project root, skipping workspace root directories
  const realRoot = resolveReal(rootPath);
  visited.add(realRoot);
  scanDir(rootPath, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, skipDirs, log);

  // Phase 2: Scan each workspace root exactly once
  for (const wsPath of layout.packagePaths) {
    const realWs = resolveReal(wsPath);
    if (visited.has(realWs)) continue;
    visited.add(realWs);
    if (log?.isLevelEnabled(Level.Trace)) log.trace(`fileRegistry: scanning workspace root: ${wsPath}`);
    scanDir(wsPath, rootPath, excludes, solidFiles, cssFiles, visited, gitignoreStack, skipDirs, log);
  }

  if (log?.isLevelEnabled(Level.Debug)) log.debug(`fileRegistry: scanned ${rootPath} → ${solidFiles.size} solid, ${cssFiles.size} css in ${(performance.now() - t0).toFixed(1)}ms`);

  function notifyFilesChanged(paths: readonly string[], changeType: "added" | "removed" | "changed"): void {
    for (let i = 0; i < listeners.length; i++) {
      const l = listeners[i];
      if (l) l.onFilesChanged(paths, changeType);
    }
  }

  function notifyCSSContentChanged(paths: readonly string[]): void {
    for (let i = 0; i < listeners.length; i++) {
      const l = listeners[i];
      if (l) l.onCSSContentChanged(paths);
    }
  }

  return {
    get solidFiles() { return solidFiles as ReadonlySet<string>; },
    get cssFiles() { return cssFiles as ReadonlySet<string>; },

    allFiles() {
      const out: string[] = new Array(solidFiles.size + cssFiles.size);
      let idx = 0;
      for (const f of solidFiles) out[idx++] = f;
      for (const f of cssFiles) out[idx++] = f;
      return out;
    },

    getCSSContent(path: string): string | null {
      const key = canonicalPath(path);
      const cached = cssContentCache.get(key);
      if (cached !== undefined) return cached;
      if (!cssFiles.has(key)) return null;
      try {
        const content = readFileSync(key, "utf-8");
        cssContentCache.set(key, content);
        return content;
      } catch {
        return null;
      }
    },

    loadAllCSSContent(): readonly { path: string; content: string }[] {
      const result: { path: string; content: string }[] = [];
      for (const cssPath of cssFiles) {
        const cached = cssContentCache.get(cssPath);
        if (cached !== undefined) {
          result.push({ path: cssPath, content: cached });
          continue;
        }
        try {
          const content = readFileSync(cssPath, "utf-8");
          cssContentCache.set(cssPath, content);
          result.push({ path: cssPath, content });
        } catch { /* skip unreadable */ }
      }
      return result;
    },

    addFile(path: string): void {
      const key = canonicalPath(path);
      const kind = classifyFile(key);
      if (kind === "solid") {
        solidFiles.add(key);
        notifyFilesChanged([key], "added");
      } else if (kind === "css") {
        cssFiles.add(key);
        _cssContentVersion++;
        notifyFilesChanged([key], "added");
      }
    },

    removeFile(path: string): void {
      const key = canonicalPath(path);
      const wasSolid = solidFiles.delete(key);
      const wasCSS = cssFiles.delete(key);
      if (wasCSS) {
        cssContentCache.delete(key);
        _cssContentVersion++;
      }
      if (wasSolid || wasCSS) {
        notifyFilesChanged([key], "removed");
      }
    },

    updateCSSContent(path: string, content: string): void {
      const key = canonicalPath(path);
      cssContentCache.set(key, content);
      _cssContentVersion++;
      notifyCSSContentChanged([key]);
    },

    cssContentVersion(): number {
      return _cssContentVersion;
    },

    buildCSSInput(
      tailwind: TailwindValidator | null,
      externalCustomProperties: ReadonlySet<string> | undefined,
      logger?: Logger,
    ): CSSInput {
      const input = createCSSInput(this.loadAllCSSContent());
      if (logger !== undefined) input.logger = logger;
      if (tailwind !== null) input.tailwind = tailwind;
      if (externalCustomProperties !== undefined) input.externalCustomProperties = externalCustomProperties;
      return input;
    },

    subscribe(listener: FileRegistryEvents): void {
      listeners.push(listener);
    },
  };
}

/**
 * Create a content resolver that checks open document buffers first,
 * then the registry's cached content, then reads from disk.
 *
 * @param registry - File registry for CSS content
 * @param getOpenDocContent - Returns open document content for a path, or null
 * @returns Content resolver function
 */
export function createContentResolver(
  registry: FileRegistry,
  getOpenDocContent: (path: string) => string | null,
): (path: string) => string | null {
  return (path: string): string | null => {
    const openContent = getOpenDocContent(path);
    if (openContent !== null) return openContent;
    return registry.getCSSContent(path);
  };
}
