import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { CSS_EXTENSIONS, SOLID_EXTENSIONS, canonicalPath, matchesExtension } from "@drskillissue/ganko-shared"
import { z } from "zod/v4"
import type { SolidSyntaxTree } from "../core/solid-syntax-tree"
import type { CSSSyntaxTree } from "../core/css-syntax-tree"

// ── Types ────────────────────────────────────────────────────────────────

export type DependencyEdgeKind =
  | "js-import"
  | "css-import"
  | "css-at-import"
  | "colocated"
  | "global-side-effect"

export interface DependencyEdgeInfo {
  readonly target: string
  readonly kind: DependencyEdgeKind
}

export interface ComponentImportEdge {
  readonly importerFile: string
  readonly importedName: string
}

export interface DependencyGraph {
  getDirectDependencies(filePath: string): readonly DependencyEdgeInfo[]
  getReverseDependencies(filePath: string): readonly string[]
  getCSSScope(solidFilePath: string): readonly string[]
  getComponentImporters(solidFilePath: string): readonly ComponentImportEdge[]
  getTransitivelyAffected(filePath: string): readonly string[]
  isInCSSScope(solidFilePath: string, cssFilePath: string): boolean
}

// ── Package resolution types ─────────────────────────────────────────────

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

export interface PackageIndexEntry {
  readonly rootPath: string
  readonly name: string
  readonly exportsValue: PackageExportNode | null
}

// ── Module resolution ────────────────────────────────────────────────────

const JSON_VALUE_SCHEMA = z.json()

const packageManifestSchema = z.object({
  name: z.string().min(1),
  exports: JSON_VALUE_SCHEMA.optional(),
})

const INTERNAL_CONDITIONS: readonly string[] = ["import", "default", "require"]

const CSS_COLOCATED_EXTENSIONS: readonly string[] = [".css"]

export function resolveImportPath(input: {
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

export function buildPackageIndex(
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

// ── Graph builder ────────────────────────────────────────────────────────

export function buildDependencyGraph(
  solidTrees: ReadonlyMap<string, SolidSyntaxTree>,
  cssTrees: ReadonlyMap<string, CSSSyntaxTree>,
): DependencyGraph {
  const solidPathSet = new Set<string>()
  for (const key of solidTrees.keys()) solidPathSet.add(resolve(key))

  const cssPathSet = new Set<string>()
  for (const key of cssTrees.keys()) cssPathSet.add(resolve(key))

  const packageEntries = buildPackageIndex(solidPathSet, cssPathSet)

  const resolveSolid = (importerFile: string, source: string): string | null =>
    resolveImportPath({
      importerFile,
      source,
      availablePaths: solidPathSet,
      extensions: SOLID_EXTENSIONS,
      packageEntries,
      allowPartialFiles: false,
    })

  const resolveCss = (importerFile: string, source: string): string | null =>
    resolveImportPath({
      importerFile,
      source,
      availablePaths: cssPathSet,
      extensions: CSS_EXTENSIONS,
      packageEntries,
      allowPartialFiles: true,
    })

  // Build CSS file index: canonical path → CSSSyntaxTree
  const cssTreeByCanonical = new Map<string, CSSSyntaxTree>()
  for (const [path, tree] of cssTrees) {
    cssTreeByCanonical.set(canonicalPath(path), tree)
  }

  // Forward edges: filePath → DependencyEdgeInfo[]
  const forwardEdges = new Map<string, DependencyEdgeInfo[]>()
  // Reverse edges: target → set of source file paths
  const reverseEdges = new Map<string, Set<string>>()
  // Component importers: solidFilePath → ComponentImportEdge[]
  const componentImporters = new Map<string, ComponentImportEdge[]>()

  const addEdge = (source: string, target: string, kind: DependencyEdgeKind): void => {
    let fwd = forwardEdges.get(source)
    if (fwd === undefined) {
      fwd = []
      forwardEdges.set(source, fwd)
    }
    fwd.push({ target, kind })

    let rev = reverseEdges.get(target)
    if (rev === undefined) {
      rev = new Set()
      reverseEdges.set(target, rev)
    }
    rev.add(source)
  }

  // Transitive @import scope cache
  const transitiveScopeCache = new Map<string, readonly string[]>()

  const getOrCollectTransitiveScope = (entryPath: string): readonly string[] => {
    const existing = transitiveScopeCache.get(entryPath)
    if (existing) return existing

    const out: string[] = []
    const queue = [entryPath]
    const seen = new Set<string>()

    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]
      if (!current) continue
      if (seen.has(current)) continue
      seen.add(current)

      const tree = cssTreeByCanonical.get(current)
      if (!tree) continue
      out.push(current)

      const imports = tree.file.imports
      for (let j = 0; j < imports.length; j++) {
        const imp = imports[j]
        if (!imp) continue
        const importPath = resolveCss(tree.file.path, imp.path)
        if (importPath === null) continue
        const canonical = canonicalPath(importPath)
        if (seen.has(canonical)) continue
        queue.push(canonical)
      }
    }

    transitiveScopeCache.set(entryPath, out)
    return out
  }

  const resolveColocatedCss = (solidFilePath: string): string | null => {
    const dotIndex = solidFilePath.lastIndexOf(".")
    if (dotIndex === -1) return null
    const stem = solidFilePath.slice(0, dotIndex)

    for (let i = 0; i < CSS_COLOCATED_EXTENSIONS.length; i++) {
      const ext = CSS_COLOCATED_EXTENSIONS[i]
      if (!ext) continue
      const candidate = canonicalPath(stem + ext)
      if (cssTreeByCanonical.has(candidate)) return candidate
    }

    return null
  }

  // ── Pass 1: Build edges and per-file local CSS scopes ──────────────────

  const localScopeBySolidFile = new Map<string, Set<string>>()
  const globalSideEffectScope = new Set<string>()

  for (const [solidPath, solidTree] of solidTrees) {
    const scope = new Set<string>()

    // 1. Co-located CSS
    const colocatedCssPath = resolveColocatedCss(solidPath)
    if (colocatedCssPath !== null) {
      addEdge(solidPath, colocatedCssPath, "colocated")
      const colocatedScope = getOrCollectTransitiveScope(colocatedCssPath)
      for (let k = 0; k < colocatedScope.length; k++) {
        const cs = colocatedScope[k]
        if (!cs) continue
        scope.add(cs)
      }
    }

    const imports = solidTree.imports
    for (let j = 0; j < imports.length; j++) {
      const imp = imports[j]
      if (!imp) continue
      if (imp.isTypeOnly) continue

      // 2. Direct CSS imports (+ transitive @import chains)
      const resolvedCssPath = resolveCss(solidPath, imp.source)
      if (resolvedCssPath !== null) {
        const canonicalCss = canonicalPath(resolvedCssPath)
        addEdge(solidPath, canonicalCss, "css-import")

        const transitiveScope = getOrCollectTransitiveScope(canonicalCss)
        for (let k = 0; k < transitiveScope.length; k++) {
          const ts = transitiveScope[k]
          if (!ts) continue
          scope.add(ts)
        }

        // 5. Global side-effect CSS: bare import without specifiers
        if (imp.specifiers.length === 0) {
          for (let k = 0; k < transitiveScope.length; k++) {
            const ts = transitiveScope[k]
            if (!ts) continue
            globalSideEffectScope.add(ts)
          }
        }
      }

      // 4. Cross-component CSS: when importing a component (has specifiers),
      // include CSS co-located with that component.
      if (imp.specifiers.length !== 0) {
        const resolvedSolidPath = resolveSolid(solidPath, imp.source)
        if (resolvedSolidPath !== null) {
          addEdge(solidPath, resolvedSolidPath, "js-import")

          // Track component importers
          let importerList = componentImporters.get(resolvedSolidPath)
          if (importerList === undefined) {
            importerList = []
            componentImporters.set(resolvedSolidPath, importerList)
          }
          for (let k = 0; k < imp.specifiers.length; k++) {
            const spec = imp.specifiers[k]
            if (!spec) continue
            importerList.push({
              importerFile: solidPath,
              importedName: spec.localName,
            })
          }

          const componentCssPath = resolveColocatedCss(resolvedSolidPath)
          if (componentCssPath !== null) {
            const componentCssScope = getOrCollectTransitiveScope(componentCssPath)
            for (let k = 0; k < componentCssScope.length; k++) {
              const cs = componentCssScope[k]
              if (!cs) continue
              scope.add(cs)
            }
          }
        }
      }
    }

    localScopeBySolidFile.set(solidPath, scope)
  }

  // Build CSS @import edges
  for (const [, cssTree] of cssTrees) {
    const imports = cssTree.file.imports
    for (let i = 0; i < imports.length; i++) {
      const imp = imports[i]
      if (!imp) continue
      const resolvedPath = resolveCss(cssTree.file.path, imp.path)
      if (resolvedPath === null) continue
      addEdge(canonicalPath(cssTree.file.path), canonicalPath(resolvedPath), "css-at-import")
    }
  }

  // ── Pass 2: Merge global side-effects into all solid file scopes ───────

  const cssScopeCache = new Map<string, readonly string[]>()

  for (const [solidPath, local] of localScopeBySolidFile) {
    for (const cssPath of globalSideEffectScope) {
      local.add(cssPath)
    }
    const frozen = [...local]
    cssScopeCache.set(solidPath, frozen)
  }

  // ── Precompute isInCSSScope sets for O(1) lookup ───────────────────────

  const cssScopeSets = new Map<string, ReadonlySet<string>>()
  for (const [solidPath, local] of localScopeBySolidFile) {
    cssScopeSets.set(solidPath, local)
  }

  return {
    getDirectDependencies(filePath: string): readonly DependencyEdgeInfo[] {
      return forwardEdges.get(filePath) ?? []
    },

    getReverseDependencies(filePath: string): readonly string[] {
      const rev = reverseEdges.get(filePath)
      if (rev === undefined) return []
      return [...rev]
    },

    getCSSScope(solidFilePath: string): readonly string[] {
      return cssScopeCache.get(solidFilePath) ?? []
    },

    getComponentImporters(solidFilePath: string): readonly ComponentImportEdge[] {
      return componentImporters.get(solidFilePath) ?? []
    },

    getTransitivelyAffected(filePath: string): readonly string[] {
      const out: string[] = [filePath]
      const seen = new Set<string>()
      seen.add(filePath)

      for (let i = 0; i < out.length; i++) {
        const current = out[i]!
        const rev = reverseEdges.get(current)
        if (rev === undefined) continue
        for (const dep of rev) {
          if (seen.has(dep)) continue
          seen.add(dep)
          out.push(dep)
        }
      }

      return out
    },

    isInCSSScope(solidFilePath: string, cssFilePath: string): boolean {
      const scopeSet = cssScopeSets.get(solidFilePath)
      if (scopeSet === undefined) return false
      return scopeSet.has(cssFilePath)
    },
  }
}
