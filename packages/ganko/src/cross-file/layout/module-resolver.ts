import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { CSS_EXTENSIONS, SOLID_EXTENSIONS, matchesExtension } from "@drskillissue/ganko-shared"
import { z } from "zod/v4"
import type { CSSGraph } from "../../css/impl"
import type { SolidGraph } from "../../solid/impl"

interface PackageExportPath {
  readonly kind: "path"
  readonly value: string
}

interface PackageExportArray {
  readonly kind: "array"
  readonly values: readonly PackageExportNode[]
}

interface PackageExportMap {
  readonly kind: "map"
  readonly fields: ReadonlyMap<string, PackageExportNode>
}

type PackageExportNode = PackageExportPath | PackageExportArray | PackageExportMap

interface PackageIndexEntry {
  readonly rootPath: string
  readonly name: string
  readonly exportsValue: PackageExportNode | null
}

export interface LayoutModuleResolver {
  resolveSolid(importerFile: string, source: string): string | null
  resolveCss(importerFile: string, source: string): string | null
}

const JSON_VALUE_SCHEMA = z.json()

const packageManifestSchema = z.object({
  name: z.string().min(1),
  exports: JSON_VALUE_SCHEMA.optional(),
})

export function createLayoutModuleResolver(
  solids: readonly SolidGraph[],
  css: CSSGraph,
): LayoutModuleResolver {
  const solidPathSet = collectSolidPaths(solids)
  const cssPathSet = collectCssPaths(css)
  const packageEntries = buildPackageIndex(solidPathSet, cssPathSet)

  return {
    resolveSolid(importerFile, source) {
      return resolveImportPath({
        importerFile,
        source,
        availablePaths: solidPathSet,
        extensions: SOLID_EXTENSIONS,
        packageEntries,
        allowPartialFiles: false,
      })
    },
    resolveCss(importerFile, source) {
      return resolveImportPath({
        importerFile,
        source,
        availablePaths: cssPathSet,
        extensions: CSS_EXTENSIONS,
        packageEntries,
        allowPartialFiles: true,
      })
    },
  }
}

function collectSolidPaths(solids: readonly SolidGraph[]): ReadonlySet<string> {
  const out = new Set<string>()

  for (let i = 0; i < solids.length; i++) {
    const solid = solids[i]
    if (!solid) continue
    out.add(resolve(solid.file))
  }

  return out
}

function collectCssPaths(css: CSSGraph): ReadonlySet<string> {
  const out = new Set<string>()

  for (let i = 0; i < css.files.length; i++) {
    const file = css.files[i]
    if (!file) continue
    out.add(resolve(file.path))
  }

  return out
}

function resolveImportPath(input: {
  readonly importerFile: string
  readonly source: string
  readonly availablePaths: ReadonlySet<string>
  readonly extensions: readonly string[]
  readonly packageEntries: readonly PackageIndexEntry[]
  readonly allowPartialFiles: boolean
}): string | null {
  if (input.source.length === 0) return null
  if (input.source.startsWith("http://")) return null
  if (input.source.startsWith("https://")) return null
  if (input.source.startsWith("data:")) return null

  if (input.source.startsWith(".") || input.source.startsWith("/")) {
    const basePath = input.source.startsWith("/")
      ? resolve(input.source)
      : resolve(dirname(resolve(input.importerFile)), input.source)

    return resolveFromBasePath({
      basePath,
      availablePaths: input.availablePaths,
      extensions: input.extensions,
      allowPartialFiles: input.allowPartialFiles,
    })
  }

  return resolvePackageImport({
    source: input.source,
    availablePaths: input.availablePaths,
    extensions: input.extensions,
    packageEntries: input.packageEntries,
    allowPartialFiles: input.allowPartialFiles,
  })
}

function resolvePackageImport(input: {
  readonly source: string
  readonly availablePaths: ReadonlySet<string>
  readonly extensions: readonly string[]
  readonly packageEntries: readonly PackageIndexEntry[]
  readonly allowPartialFiles: boolean
}): string | null {
  const pkg = findBestMatchingPackageEntry(input.source, input.packageEntries)
  if (pkg === null) return null

  const subpath = input.source === pkg.name
    ? "."
    : `.${input.source.slice(pkg.name.length)}`

  const exported = resolveExportTarget(pkg.exportsValue, subpath)
  if (exported !== null) {
    const fromExports = resolveFromBasePath({
      basePath: resolve(pkg.rootPath, exported),
      availablePaths: input.availablePaths,
      extensions: input.extensions,
      allowPartialFiles: input.allowPartialFiles,
    })
    if (fromExports !== null) return fromExports
  }

  const remainder = input.source.slice(pkg.name.length)
  const trimmed = remainder.startsWith("/") ? remainder.slice(1) : remainder

  if (trimmed.length === 0) {
    const fromRoot = resolveFromBasePath({
      basePath: pkg.rootPath,
      availablePaths: input.availablePaths,
      extensions: input.extensions,
      allowPartialFiles: input.allowPartialFiles,
    })
    if (fromRoot !== null) return fromRoot

    return resolveFromBasePath({
      basePath: resolve(pkg.rootPath, "src/index"),
      availablePaths: input.availablePaths,
      extensions: input.extensions,
      allowPartialFiles: input.allowPartialFiles,
    })
  }

  const direct = resolveFromBasePath({
    basePath: resolve(pkg.rootPath, trimmed),
    availablePaths: input.availablePaths,
    extensions: input.extensions,
    allowPartialFiles: input.allowPartialFiles,
  })
  if (direct !== null) return direct

  return resolveFromBasePath({
    basePath: resolve(pkg.rootPath, "src", trimmed),
    availablePaths: input.availablePaths,
    extensions: input.extensions,
    allowPartialFiles: input.allowPartialFiles,
  })
}

function resolveFromBasePath(input: {
  readonly basePath: string
  readonly availablePaths: ReadonlySet<string>
  readonly extensions: readonly string[]
  readonly allowPartialFiles: boolean
}): string | null {
  const candidates = collectResolutionCandidates(
    input.basePath,
    input.extensions,
    input.allowPartialFiles,
  )

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (!candidate) continue
    if (!input.availablePaths.has(candidate)) continue
    return candidate
  }

  return null
}

function collectResolutionCandidates(
  basePath: string,
  extensions: readonly string[],
  allowPartialFiles: boolean,
): readonly string[] {
  const normalizedBase = resolve(basePath)
  const out: string[] = [normalizedBase]
  const hasSupportedExtension = matchesExtension(normalizedBase, extensions)

  if (!hasSupportedExtension) {
    for (let i = 0; i < extensions.length; i++) {
      out.push(normalizedBase + extensions[i])
    }

    for (let i = 0; i < extensions.length; i++) {
      out.push(join(normalizedBase, `index${extensions[i]}`))
    }
  }

  if (!allowPartialFiles) return out

  const partialBase = toPartialPath(normalizedBase)
  if (partialBase === null) return out
  out.push(partialBase)

  if (!hasSupportedExtension) {
    for (let i = 0; i < extensions.length; i++) {
      out.push(partialBase + extensions[i])
    }
  }

  return out
}

function toPartialPath(path: string): string | null {
  const name = basename(path)
  if (name.length === 0) return null
  if (name.startsWith("_")) return null
  return resolve(dirname(path), `_${name}`)
}

function findBestMatchingPackageEntry(
  source: string,
  packageEntries: readonly PackageIndexEntry[],
): PackageIndexEntry | null {
  let best: PackageIndexEntry | null = null

  for (let i = 0; i < packageEntries.length; i++) {
    const entry = packageEntries[i]
    if (!entry) continue
    const isExact = source === entry.name
    const isSubpath = source.startsWith(`${entry.name}/`)
    if (!isExact && !isSubpath) continue
    if (best === null || entry.name.length > best.name.length) best = entry
  }

  return best
}

const INTERNAL_CONDITIONS: readonly string[] = ["import", "default", "require"]
const EXTERNAL_CONDITIONS: readonly string[] = ["solid", "import", "default"]

function resolveExportTarget(
  exportsValue: PackageExportNode | null,
  subpath: string,
  conditions: readonly string[] = INTERNAL_CONDITIONS,
): string | null {
  if (exportsValue === null) return null
  if (exportsValue.kind === "path") return exportsValue.value

  if (exportsValue.kind === "array") {
    for (let i = 0; i < exportsValue.values.length; i++) {
      const val = exportsValue.values[i]
      if (!val) continue
      const resolved = resolveExportTarget(val, subpath, conditions)
      if (resolved !== null) return resolved
    }
    return null
  }

  const exact = exportsValue.fields.get(subpath)
  const exactResolved = resolveExportConditionTarget(exact, conditions)
  if (exactResolved !== null) return exactResolved

  const wildcard = resolveWildcardExportTarget(exportsValue.fields, subpath, conditions)
  if (wildcard !== null) return wildcard

  if (subpath === ".") {
    const root = exportsValue.fields.get(".")
    const rootResolved = resolveExportConditionTarget(root, conditions)
    if (rootResolved !== null) return rootResolved
  }

  return resolveExportConditionTarget(exportsValue, conditions)
}

function resolveWildcardExportTarget(
  fields: ReadonlyMap<string, PackageExportNode>,
  subpath: string,
  conditions: readonly string[],
): string | null {
  for (const [key, value] of fields) {
    const star = key.indexOf("*")
    if (star < 0) continue

    const prefix = key.slice(0, star)
    const suffix = key.slice(star + 1)
    if (!subpath.startsWith(prefix)) continue
    if (!subpath.endsWith(suffix)) continue

    const captured = subpath.slice(prefix.length, subpath.length - suffix.length)
    const target = resolveExportConditionTarget(value, conditions)
    if (target === null) continue
    if (!target.includes("*")) return target
    return target.replaceAll("*", captured)
  }

  return null
}

function resolveExportConditionTarget(
  value: PackageExportNode | undefined,
  conditions: readonly string[],
): string | null {
  if (value === undefined) return null
  if (value.kind === "path") return value.value

  if (value.kind === "array") {
    for (let i = 0; i < value.values.length; i++) {
      const val = value.values[i]
      if (!val) continue
      const resolved = resolveExportConditionTarget(val, conditions)
      if (resolved !== null) return resolved
    }
    return null
  }

  for (let i = 0; i < conditions.length; i++) {
    const cond = conditions[i]
    if (!cond) continue
    const conditionTarget = resolveExportConditionTarget(value.fields.get(cond), conditions)
    if (conditionTarget !== null) return conditionTarget
  }

  for (const next of value.fields.values()) {
    const resolved = resolveExportConditionTarget(next, conditions)
    if (resolved !== null) return resolved
  }

  return null
}

function buildPackageIndex(
  solidPaths: ReadonlySet<string>,
  cssPaths: ReadonlySet<string>,
): readonly PackageIndexEntry[] {
  const packageJsonByPath = new Map<string, PackageIndexEntry>()
  const packageJsonPathByDirectory = new Map<string, string | null>()

  const indexPath = (filePath: string): void => {
    const packageJsonPath = findNearestPackageJsonPath(filePath, packageJsonPathByDirectory)
    if (packageJsonPath === null) return
    if (packageJsonByPath.has(packageJsonPath)) return

    const packageEntry = readPackageEntry(packageJsonPath)
    if (packageEntry === null) return
    packageJsonByPath.set(packageJsonPath, packageEntry)
  }

  for (const path of solidPaths) indexPath(path)
  for (const path of cssPaths) indexPath(path)

  return [...packageJsonByPath.values()]
}

function findNearestPackageJsonPath(
  filePath: string,
  cache: Map<string, string | null>,
): string | null {
  let current = dirname(resolve(filePath))
  const traversed: string[] = []

  while (true) {
    const cached = cache.get(current)
    if (cached !== undefined) {
      for (let i = 0; i < traversed.length; i++) {
        const dir = traversed[i]
        if (!dir) continue
        cache.set(dir, cached)
      }
      return cached
    }

    traversed.push(current)
    const candidate = join(current, "package.json")
    if (existsSync(candidate)) {
      for (let i = 0; i < traversed.length; i++) {
        const dir = traversed[i]
        if (!dir) continue
        cache.set(dir, candidate)
      }
      return candidate
    }

    const parent = dirname(current)
    if (parent === current) {
      for (let i = 0; i < traversed.length; i++) {
        const dir = traversed[i]
        if (!dir) continue
        cache.set(dir, null)
      }
      return null
    }
    current = parent
  }
}

function readPackageEntry(packageJsonPath: string): PackageIndexEntry | null {
  try {
    const parsed = packageManifestSchema.safeParse(JSON.parse(readFileSync(packageJsonPath, "utf-8")))
    if (!parsed.success) return null

    return {
      rootPath: dirname(packageJsonPath),
      name: parsed.data.name,
      exportsValue: parsePackageExportNode(parsed.data.exports),
    }
  } catch {
    return null
  }
}

function parsePackageExportNode(value: z.infer<typeof JSON_VALUE_SCHEMA> | undefined): PackageExportNode | null {
  if (value === undefined) return null
  if (typeof value === "string") {
    return {
      kind: "path",
      value,
    }
  }

  if (Array.isArray(value)) {
    const values: PackageExportNode[] = []

    for (let i = 0; i < value.length; i++) {
      const parsed = parsePackageExportNode(value[i])
      if (parsed === null) continue
      values.push(parsed)
    }

    return {
      kind: "array",
      values,
    }
  }

  if (typeof value !== "object") return null
  if (value === null) return null

  const fields = new Map<string, PackageExportNode>()

  for (const [key, nested] of Object.entries(value)) {
    const parsed = parsePackageExportNode(nested)
    if (parsed === null) continue
    fields.set(key, parsed)
  }

  return {
    kind: "map",
    fields,
  }
}



/**
 * Resolve an import source to a file path on disk, including node_modules.
 *
 * Unlike the internal resolver which is restricted to files in the analysis
 * set, this performs full disk-based resolution for following component host
 * chains through external packages. Prefers the `solid` export condition
 * for preserved-JSX output that can be parsed for JSX host analysis.
 *
 * Supports both relative imports (resolved against importerFile's directory)
 * and bare/scoped package specifiers resolved through node_modules.
 *
 * @param importerFile - Absolute path of the file containing the import
 * @param source - The import specifier to resolve
 * @returns Absolute path to the resolved file, or null if unresolvable
 */
export function resolveExternalModule(importerFile: string, source: string): string | null {
  if (source.length === 0) return null
  if (source.startsWith("http://")) return null
  if (source.startsWith("https://")) return null
  if (source.startsWith("data:")) return null

  if (source.startsWith(".") || source.startsWith("/")) {
    return resolveExternalRelative(importerFile, source)
  }

  return resolveExternalPackage(importerFile, source)
}

function resolveExternalRelative(importerFile: string, source: string): string | null {
  const basePath = source.startsWith("/")
    ? resolve(source)
    : resolve(dirname(resolve(importerFile)), source)

  return resolveExternalFromBasePath(basePath)
}

function resolveExternalFromBasePath(basePath: string): string | null {
  const candidates = collectResolutionCandidates(basePath, SOLID_EXTENSIONS, false)

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (!candidate) continue
    if (existsSync(candidate)) return candidate
  }

  return null
}

function resolveExternalPackage(importerFile: string, source: string): string | null {
  const { packageName, subpath } = parsePackageSpecifier(source)
  if (packageName === null) return null

  const packageDir = findNodeModulesPackage(importerFile, packageName)
  if (packageDir === null) return null

  const packageJsonPath = join(packageDir, "package.json")
  const entry = readPackageEntry(packageJsonPath)
  if (entry === null) return null

  const exportSubpath = subpath === null ? "." : `./${subpath}`
  const exported = resolveExportTarget(entry.exportsValue, exportSubpath, EXTERNAL_CONDITIONS)
  if (exported !== null) {
    const resolved = resolveExternalFromBasePath(resolve(packageDir, exported))
    if (resolved !== null) return resolved
  }

  // Fallback: direct path resolution within the package
  if (subpath !== null) {
    const direct = resolveExternalFromBasePath(resolve(packageDir, subpath))
    if (direct !== null) return direct

    const fromSrc = resolveExternalFromBasePath(resolve(packageDir, "src", subpath))
    if (fromSrc !== null) return fromSrc
  } else {
    const fromRoot = resolveExternalFromBasePath(resolve(packageDir, "index"))
    if (fromRoot !== null) return fromRoot

    const fromSrc = resolveExternalFromBasePath(resolve(packageDir, "src/index"))
    if (fromSrc !== null) return fromSrc
  }

  return null
}

/**
 * Parse a bare or scoped package specifier into package name and subpath.
 *
 * Examples:
 * - `"@kobalte/core/button"` → `{ packageName: "@kobalte/core", subpath: "button" }`
 * - `"solid-js"` → `{ packageName: "solid-js", subpath: null }`
 * - `"solid-js/web"` → `{ packageName: "solid-js", subpath: "web" }`
 */
function parsePackageSpecifier(source: string): { packageName: string | null; subpath: string | null } {
  if (source.startsWith("@")) {
    const firstSlash = source.indexOf("/")
    if (firstSlash < 0) return { packageName: null, subpath: null }
    const secondSlash = source.indexOf("/", firstSlash + 1)
    if (secondSlash < 0) return { packageName: source, subpath: null }
    return { packageName: source.slice(0, secondSlash), subpath: source.slice(secondSlash + 1) }
  }

  const firstSlash = source.indexOf("/")
  if (firstSlash < 0) return { packageName: source, subpath: null }
  return { packageName: source.slice(0, firstSlash), subpath: source.slice(firstSlash + 1) }
}

/**
 * Walk up from the importer's directory to find the package in node_modules.
 *
 * Searches each ancestor directory for `node_modules/<packageName>/package.json`.
 */
function findNodeModulesPackage(importerFile: string, packageName: string): string | null {
  let current = dirname(resolve(importerFile))

  while (true) {
    const candidate = join(current, "node_modules", packageName)
    if (existsSync(join(candidate, "package.json"))) return candidate

    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}
