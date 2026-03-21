/**
 * Library Analysis — Extracts CSS custom properties provided by installed dependencies.
 *
 * Scans dependency packages for CSS custom property definitions injected at runtime
 * via JavaScript (e.g., inline style attributes in JSX). This enables the resolution
 * engine to treat library-provided properties as defined rather than flagging them
 * as unresolved.
 *
 * Architecture:
 * 1. Receive dependency names from WorkspaceLayout (single source of truth)
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
import type { WorkspaceLayout } from "@drskillissue/ganko-shared"

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
 * Receives dependency names from WorkspaceLayout instead of re-reading
 * package.json files. Uses layout.root for node_modules resolution.
 *
 * @param layout - Workspace layout with pre-resolved dependency names
 * @returns Set of CSS custom property names (e.g., "--kb-accordion-content-height")
 */
export function scanDependencyCustomProperties(layout: WorkspaceLayout): ReadonlySet<string> {
  const allProperties = new Set<string>()

  for (const depName of layout.allDependencyNames) {
    const packageDir = findPackageDir(layout.root.path, depName)
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
