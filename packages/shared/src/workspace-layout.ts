import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProjectRoot } from "./project-root";
import type { Logger } from "./log";
import { Level } from "./log";

export interface WorkspacePackage {
  readonly path: string
  readonly name: string | null
  readonly dependencies: ReadonlySet<string>
  readonly packageJsonPath: string
}

export interface WorkspaceLayout {
  readonly root: ProjectRoot
  readonly packages: readonly WorkspacePackage[]
  readonly packagePaths: ReadonlySet<string>
  readonly allDependencyNames: ReadonlySet<string>
  readonly allPackageJsonPaths: readonly string[]
}

interface RawPackageJson {
  name?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}

function readPackageJson(path: string): RawPackageJson | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function collectDeps(pkg: RawPackageJson): Set<string> {
  const deps = new Set<string>();
  if (pkg.dependencies) {
    for (const name of Object.keys(pkg.dependencies)) deps.add(name);
  }
  if (pkg.peerDependencies) {
    for (const name of Object.keys(pkg.peerDependencies)) deps.add(name);
  }
  return deps;
}

function resolveRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function resolveWorkspaceGlobs(rootPath: string, patterns: string[], _log?: Logger): string[] {
  const dirs: string[] = [];

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    if (!pattern) continue;

    if (pattern.endsWith("/*")) {
      const parentDir = join(rootPath, pattern.slice(0, -2));
      let entries;
      try {
        entries = readdirSync(parentDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (let j = 0; j < entries.length; j++) {
        const entry = entries[j];
        if (!entry) continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(parentDir, entry.name);
        const real = resolveRealPath(fullPath);
        try {
          if (statSync(real).isDirectory()) dirs.push(real);
        } catch { /* skip */ }
      }
    } else {
      const dir = join(rootPath, pattern);
      const real = resolveRealPath(dir);
      try {
        if (statSync(real).isDirectory()) dirs.push(real);
      } catch { /* skip */ }
    }
  }

  return dirs;
}

/**
 * Build the workspace layout from a project root.
 *
 * Reads root package.json, resolves workspace globs, reads each workspace
 * package.json, and collects dependency names — all in one pass.
 *
 * @param root - Canonical project root path
 * @param log - Logger for debug output
 * @returns Resolved workspace layout
 */
export function buildWorkspaceLayout(root: ProjectRoot, log?: Logger): WorkspaceLayout {
  const rootPath = root.path;
  const rootPkgPath = join(rootPath, "package.json");
  const rootPkg = readPackageJson(rootPkgPath);

  const allPackageJsonPaths: string[] = [];
  const allDependencyNames = new Set<string>();
  const packages: WorkspacePackage[] = [];
  const packagePaths = new Set<string>();

  // Root package.json dependencies
  if (rootPkg !== null) {
    allPackageJsonPaths.push(rootPkgPath);
    const rootDeps = collectDeps(rootPkg);
    for (const d of rootDeps) allDependencyNames.add(d);
  }

  // Resolve workspace patterns
  if (rootPkg !== null) {
    const wsPatterns = Array.isArray(rootPkg.workspaces)
      ? rootPkg.workspaces
      : Array.isArray(rootPkg.workspaces?.packages)
        ? rootPkg.workspaces.packages
        : null;

    if (wsPatterns !== null) {
      const wsDirs = resolveWorkspaceGlobs(rootPath, wsPatterns, log);

      for (let i = 0; i < wsDirs.length; i++) {
        const wsDir = wsDirs[i];
        if (!wsDir) continue;
        const wsPkgPath = join(wsDir, "package.json");
        const wsPkg = readPackageJson(wsPkgPath);

        packagePaths.add(wsDir);

        if (wsPkg !== null) {
          allPackageJsonPaths.push(wsPkgPath);
          const wsDeps = collectDeps(wsPkg);
          for (const d of wsDeps) allDependencyNames.add(d);

          packages.push({
            path: wsDir,
            name: typeof wsPkg.name === "string" ? wsPkg.name : null,
            dependencies: wsDeps,
            packageJsonPath: wsPkgPath,
          });
        } else {
          packages.push({
            path: wsDir,
            name: null,
            dependencies: new Set(),
            packageJsonPath: wsPkgPath,
          });
        }
      }
    }
  }

  if (log?.isLevelEnabled(Level.Debug) && packages.length > 0) {
    log.debug(`workspaceLayout: ${packages.length} workspace packages, ${allDependencyNames.size} total dependencies`);
  }

  return { root, packages, packagePaths, allDependencyNames, allPackageJsonPaths };
}
