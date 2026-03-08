/**
 * Library Analysis — Extracts CSS custom properties provided by installed dependencies.
 *
 * Scans dependency packages for CSS custom property definitions injected at runtime
 * via JavaScript (e.g., inline style attributes in JSX). This enables the resolution
 * engine to treat library-provided properties as defined rather than flagging them
 * as unresolved.
 *
 * Architecture:
 * 1. Read project package.json files to discover direct dependencies
 * 2. For each dependency, scan its dist/source files for CSS custom property patterns
 * 3. Return discovered properties as a synthetic CSS `:root` declaration block
 * 4. The caller feeds this into the normal CSS parsing pipeline as an additional file
 *
 * The scanner detects properties set via:
 * - JSX style object keys: `"--kb-accordion-content-height": value`
 * - style.setProperty calls: `style.setProperty("--kb-accordion-content-height", ...)`
 * - CSS-in-JS template literals with custom property definitions
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import type { Dirent } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { z } from "zod/v4"

const PackageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z.union([
    z.array(z.string()),
    z.object({ packages: z.array(z.string()).optional() }),
  ]).optional(),
})

/**
 * Pattern matching CSS custom property names in JavaScript/JSX source files.
 *
 * Matches double-quoted or single-quoted strings that start with `--` followed by
 * a lowercase letter and contain lowercase letters, digits, and hyphens.
 * These appear as:
 * - Object property keys in style attributes: `"--kb-accordion-content-height": ...`
 * - Arguments to style.setProperty: `style.setProperty("--kb-accordion-content-height", ...)`
 */
const CSS_CUSTOM_PROPERTY_IN_JS_RE = /["'](--[a-z][a-z0-9-]+)["']/g

/**
 * Maximum number of bytes to read from a single dist file.
 * Large bundles can be megabytes; we cap reads to avoid excessive memory usage.
 */
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024

/**
 * File extensions to scan in dependency packages.
 */
const SCANNABLE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"])

/** Strips trailing glob stars from workspace patterns: "packages/*" → "packages" */
const TRAILING_GLOB_RE = /\/?\*+$/

/**
 * Result of scanning a single dependency package.
 */
interface PackageScanResult {
  readonly packageName: string
  readonly properties: ReadonlySet<string>
}

/**
 * Scan installed dependencies for CSS custom properties they inject at runtime.
 *
 * Reads each direct dependency's package.json to find its dist directory,
 * then scans JavaScript/JSX files for CSS custom property name patterns.
 *
 * @param projectRoot - Absolute path to the project root (containing package.json)
 * @returns Set of CSS custom property names (e.g., "--kb-accordion-content-height")
 */
export function scanDependencyCustomProperties(projectRoot: string): ReadonlySet<string> {
  const allProperties = new Set<string>()

  const packageJsonPaths = findWorkspacePackageJsonPaths(projectRoot)
  const dependencyNames = collectDependencyNames(packageJsonPaths)

  for (const depName of dependencyNames) {
    const packageDir = findPackageDir(projectRoot, depName)
    if (packageDir === null) continue

    const result = scanPackage(depName, packageDir)
    for (const prop of result.properties) {
      allProperties.add(prop)
    }
  }

  return allProperties
}

/**
 * Generate a synthetic CSS file that declares all externally-provided custom properties
 * in a `:root` rule. This CSS is parsed through the normal pipeline, producing real
 * `VariableEntity` entries with `scope.type === "global"` that participate in
 * resolution, cascade, and all other analyses.
 *
 * @param properties - Set of CSS custom property names
 * @returns Synthetic CSS file content, or null if no properties
 */
export function generateExternalPropertiesCSS(properties: ReadonlySet<string>): string | null {
  if (properties.size === 0) return null

  const declarations: string[] = []
  for (const prop of properties) {
    // Use `initial` as the value — it's the CSS-spec defined initial value
    // for custom properties and signals "provided externally, type unknown"
    declarations.push(`  ${prop}: initial;`)
  }

  return `:root {\n${declarations.join("\n")}\n}\n`
}

/**
 * Find all package.json files in a workspace (monorepo or single-package).
 *
 * Checks for workspace definitions in the root package.json and collects
 * package.json paths from workspace packages.
 */
function findWorkspacePackageJsonPaths(projectRoot: string): readonly string[] {
  const rootPkgPath = join(projectRoot, "package.json")
  if (!existsSync(rootPkgPath)) return []

  const paths: string[] = [rootPkgPath]

  try {
    const parseResult = PackageJsonSchema.safeParse(JSON.parse(readFileSync(rootPkgPath, "utf-8")))
    if (!parseResult.success) return paths

    const workspaces = parseResult.data.workspaces
    if (workspaces === undefined) {
      // no workspaces defined
    } else if (Array.isArray(workspaces)) {
      for (const pattern of workspaces) {
        collectWorkspacePackageJsons(projectRoot, pattern, paths)
      }
    } else if (workspaces.packages) {
      for (const pattern of workspaces.packages) {
        collectWorkspacePackageJsons(projectRoot, pattern, paths)
      }
    }
  } catch {
    // If package.json is unreadable or malformed, return just the root
  }

  return paths
}

/**
 * Collect package.json files matching a workspace glob pattern.
 * Handles simple patterns like "packages/*" and "web/packages/*".
 */
function collectWorkspacePackageJsons(root: string, pattern: string, out: string[]): void {
  const baseDir = pattern.replace(TRAILING_GLOB_RE, "")
  const searchDir = join(root, baseDir)

  if (!existsSync(searchDir)) return

  try {
    const stat = statSync(searchDir)
    if (stat.isFile()) {
      // Direct reference to a package directory
      const pkgPath = join(searchDir, "package.json")
      if (existsSync(pkgPath)) out.push(pkgPath)
      return
    }

    if (!stat.isDirectory()) return

    // If pattern had a glob, enumerate subdirectories
    if (pattern.includes("*")) {
      const entries = readdirSync(searchDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const pkgPath = join(searchDir, entry.name, "package.json")
        if (existsSync(pkgPath)) out.push(pkgPath)
      }
    } else {
      // Exact directory reference
      const pkgPath = join(searchDir, "package.json")
      if (existsSync(pkgPath)) out.push(pkgPath)
    }
  } catch {
    // Skip inaccessible directories
  }
}

/**
 * Collect all unique dependency names from a set of package.json files.
 * Reads `dependencies`, `devDependencies`, and `peerDependencies`.
 */
function collectDependencyNames(packageJsonPaths: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>()

  for (const pkgPath of packageJsonPaths) {
    try {
      collectDepsFromPackageJson(readFileSync(pkgPath, "utf-8"), names)
    } catch {
      // Skip unreadable/malformed package.json files
    }
  }

  return names
}

function collectDepsFromPackageJson(content: string, out: Set<string>): void {
  const pkg = parsePackageJson(content)
  if (pkg === null) return

  collectDepsFromSection(pkg["dependencies"], out)
  collectDepsFromSection(pkg["peerDependencies"], out)
}

function collectDepsFromSection(value: Readonly<Record<string, string>> | undefined, out: Set<string>): void {
  if (value === undefined) return
  for (const name of Object.keys(value)) {
    out.add(name)
  }
}

type PackageJsonShape = z.infer<typeof PackageJsonSchema>

function parsePackageJson(text: string): PackageJsonShape | null {
  try {
    const result = PackageJsonSchema.safeParse(JSON.parse(text))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * Find the installed package directory in node_modules.
 * Walks up from the project root looking for node_modules/<name>.
 */
function findPackageDir(projectRoot: string, packageName: string): string | null {
  let current = resolve(projectRoot)

  while (true) {
    const candidate = join(current, "node_modules", packageName)
    if (existsSync(join(candidate, "package.json"))) return candidate

    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Scan a single package's source files for CSS custom property definitions.
 *
 * Reads the package's dist directory (determined by its package.json exports
 * or common conventions) and scans JavaScript/JSX files for patterns that
 * indicate CSS custom property injection at runtime.
 */
function scanPackage(packageName: string, packageDir: string): PackageScanResult {
  const properties = new Set<string>()

  // Determine which directories to scan
  const scanDirs = resolveScanDirectories(packageDir)

  for (const dir of scanDirs) {
    scanDirectory(dir, properties)
  }

  return { packageName, properties }
}

/**
 * Resolve directories to scan within a package.
 *
 * Prefers `dist/` (compiled output), falls back to `src/`, then the package root.
 * Reads the package.json `exports` field to find the actual output directory.
 */
function resolveScanDirectories(packageDir: string): readonly string[] {
  const dirs: string[] = []

  // Check common dist directories
  const distDir = join(packageDir, "dist")
  if (existsSync(distDir)) {
    dirs.push(distDir)
  }

  const srcDir = join(packageDir, "src")
  if (existsSync(srcDir) && dirs.length === 0) {
    dirs.push(srcDir)
  }

  // Fallback to package root if no dist/src found
  if (dirs.length === 0) {
    dirs.push(packageDir)
  }

  return dirs
}

/**
 * Recursively scan a directory for JavaScript/JSX files and extract
 * CSS custom property names from their content.
 */
function scanDirectory(dir: string, properties: Set<string>): void {
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      // Skip common non-source directories
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "__tests__") continue
      scanDirectory(fullPath, properties)
      continue
    }

    if (!entry.isFile()) continue

    // Check extension
    const dotIdx = entry.name.lastIndexOf(".")
    if (dotIdx < 0) continue
    const ext = entry.name.slice(dotIdx)
    if (!SCANNABLE_EXTENSIONS.has(ext)) continue

    extractPropertiesFromFile(fullPath, properties)
  }
}

/**
 * Extract CSS custom property names from a single JavaScript/JSX file.
 *
 * Reads the file content and applies regex matching to find CSS custom
 * property name patterns. The regex matches both style object keys and
 * style.setProperty arguments.
 */
function extractPropertiesFromFile(filePath: string, properties: Set<string>): void {
  let content: string
  try {
    const stat = statSync(filePath)
    if (stat.size > MAX_FILE_SIZE_BYTES) return
    content = readFileSync(filePath, "utf-8")
  } catch {
    return
  }

  // Reset regex state for each file
  CSS_CUSTOM_PROPERTY_IN_JS_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = CSS_CUSTOM_PROPERTY_IN_JS_RE.exec(content)) !== null) {
    const captured = match[1]
    if (captured !== undefined) properties.add(captured)
  }
}
