import { canonicalPath } from "@drskillissue/ganko-shared"
import type { CSSGraph } from "../../css/impl"
import type { SolidGraph } from "../../solid/impl"
import { createLayoutModuleResolver } from "./module-resolver"
import type { LayoutModuleResolver } from "./module-resolver"

const CSS_COLOCATED_EXTENSIONS: readonly string[] = [".css"]

export function collectCSSScopeBySolidFile(
  solids: readonly SolidGraph[],
  css: CSSGraph,
  moduleResolver?: LayoutModuleResolver,
): ReadonlyMap<string, readonly string[]> {
  const resolver = moduleResolver ?? createLayoutModuleResolver(solids, css)
  const cssFilesByNormalizedPath = buildCSSFileIndex(css)
  const transitiveScopeByEntryPath = new Map<string, readonly string[]>()
  const localScopeBySolidFile = new Map<string, Set<string>>()
  const globalSideEffectScope = new Set<string>()

  for (let i = 0; i < solids.length; i++) {
    const solid = solids[i]
    if (!solid) continue
    const scope = new Set<string>()

    // Co-located CSS: if foo.tsx exists alongside foo.css, include foo.css
    // (and its transitive @import chain) in scope. This handles CSS aggregation
    // architectures where a central stylesheet @imports per-component CSS files
    // rather than each component importing its own CSS via JS.
    const colocatedCssPath = resolveColocatedCss(solid.file, cssFilesByNormalizedPath)
    if (colocatedCssPath !== null) {
      const colocatedScope = getOrCollectTransitiveScope(
        colocatedCssPath,
        resolver,
        cssFilesByNormalizedPath,
        transitiveScopeByEntryPath,
      )
      for (let k = 0; k < colocatedScope.length; k++) {
        const cs = colocatedScope[k]
        if (!cs) continue
        scope.add(cs)
      }
    }

    for (let j = 0; j < solid.imports.length; j++) {
      const imp = solid.imports[j]
      if (!imp) continue
      if (imp.isTypeOnly) continue

      const resolvedCssPath = resolver.resolveCss(solid.file, imp.source)
      if (resolvedCssPath !== null) {
        const transitiveScope = getOrCollectTransitiveScope(
          resolvedCssPath,
          resolver,
          cssFilesByNormalizedPath,
          transitiveScopeByEntryPath,
        )
        for (let k = 0; k < transitiveScope.length; k++) {
          const ts = transitiveScope[k]
          if (!ts) continue
          scope.add(ts)
        }

        if (imp.specifiers.length === 0) {
          for (let k = 0; k < transitiveScope.length; k++) {
            const ts = transitiveScope[k]
            if (!ts) continue
            globalSideEffectScope.add(ts)
          }
        }
      }

      // Cross-component CSS scope: when importing a component file, include
      // CSS co-located with that component. This ensures that CSS selectors
      // from component stylesheets (e.g., button.css alongside button.tsx)
      // are available in the cascade for call-site elements that resolve
      // through the component's host element.
      if (imp.specifiers.length !== 0) {
        const resolvedSolidPath = resolver.resolveSolid(solid.file, imp.source)
        if (resolvedSolidPath !== null) {
          const componentCssPath = resolveColocatedCss(resolvedSolidPath, cssFilesByNormalizedPath)
          if (componentCssPath !== null) {
            const componentCssScope = getOrCollectTransitiveScope(
              componentCssPath,
              resolver,
              cssFilesByNormalizedPath,
              transitiveScopeByEntryPath,
            )
            for (let k = 0; k < componentCssScope.length; k++) {
              const cs = componentCssScope[k]
              if (!cs) continue
              scope.add(cs)
            }
          }
        }
      }
    }

    localScopeBySolidFile.set(solid.file, scope)
  }

  const out = new Map<string, readonly string[]>()

  for (let i = 0; i < solids.length; i++) {
    const solid = solids[i]
    if (!solid) continue
    const local = localScopeBySolidFile.get(solid.file)
    if (!local) {
      out.set(solid.file, [])
      continue
    }

    for (const cssPath of globalSideEffectScope) {
      local.add(cssPath)
    }

    out.set(solid.file, [...local])
  }

  return out
}

/**
 * Resolve a co-located CSS file for a solid file.
 *
 * Given `/project/components/select.tsx`, checks if any of
 * `/project/components/select.css` exists in the CSS file index.
 * Returns the canonical path if found, null otherwise.
 */
function resolveColocatedCss(
  solidFilePath: string,
  cssFilesByNormalizedPath: ReadonlyMap<string, unknown>,
): string | null {
  const dotIndex = solidFilePath.lastIndexOf(".")
  if (dotIndex === -1) return null
  const stem = solidFilePath.slice(0, dotIndex)

  for (let i = 0; i < CSS_COLOCATED_EXTENSIONS.length; i++) {
    const ext = CSS_COLOCATED_EXTENSIONS[i]
    if (!ext) continue
    const candidate = canonicalPath(stem + ext)
    if (cssFilesByNormalizedPath.has(candidate)) return candidate
  }

  return null
}

function buildCSSFileIndex(
  css: CSSGraph,
): ReadonlyMap<string, CSSGraph["files"][number]> {
  const out = new Map<string, CSSGraph["files"][number]>()

  for (let i = 0; i < css.files.length; i++) {
    const file = css.files[i]
    if (!file) continue
    out.set(canonicalPath(file.path), file)
  }

  return out
}

function getOrCollectTransitiveScope(
  entryPath: string,
  resolver: ReturnType<typeof createLayoutModuleResolver>,
  cssFilesByNormalizedPath: ReadonlyMap<string, CSSGraph["files"][number]>,
  cache: Map<string, readonly string[]>,
): readonly string[] {
  const existing = cache.get(entryPath)
  if (existing) return existing

  const out = collectTransitiveCSSScope(entryPath, resolver, cssFilesByNormalizedPath)
  cache.set(entryPath, out)
  return out
}

function collectTransitiveCSSScope(
  entryPath: string,
  resolver: ReturnType<typeof createLayoutModuleResolver>,
  cssFilesByNormalizedPath: ReadonlyMap<string, CSSGraph["files"][number]>,
): readonly string[] {
  const out: string[] = []
  const queue = [entryPath]
  const seen = new Set<string>()

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]
    if (!current) continue
    if (seen.has(current)) continue
    seen.add(current)

    const file = cssFilesByNormalizedPath.get(current)
    if (!file) continue
    out.push(current)

    for (let j = 0; j < file.imports.length; j++) {
      const imp = file.imports[j]
      if (!imp) continue
      const importPath = resolver.resolveCss(file.path, imp.path)
      if (importPath === null) continue
      if (seen.has(importPath)) continue
      queue.push(importPath)
    }
  }

  return out
}
