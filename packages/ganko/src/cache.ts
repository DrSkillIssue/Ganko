/**
 * GraphCache — Versioned cache for SolidGraph, CSSGraph, and LayoutGraph instances.
 *
 * Eliminates redundant graph construction in the LSP server by caching
 * per-file SolidGraphs (keyed by path + script version), a single
 * CSSGraph invalidated via a monotonic generation counter, and a
 * LayoutGraph invalidated by Solid/CSS signatures.
 *
 * The cache does not perform I/O or parsing — callers supply builder
 * functions that are invoked only on cache miss.
 */
import { canonicalPath, classifyFile, noopLogger } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"
import type { Diagnostic } from "./diagnostic"
import type { SolidGraph } from "./solid/impl"
import type { CSSGraph } from "./css/impl"
import type { LayoutGraph } from "./cross-file/layout/graph"

interface CachedSolid {
  readonly version: string
  readonly graph: SolidGraph
}

interface CachedCSS {
  readonly generation: number
  readonly graph: CSSGraph
}

interface CachedLayout {
  readonly solidGeneration: number
  readonly cssGeneration: number
  readonly graph: LayoutGraph
}

interface CachedCrossFileResults {
  readonly solidGeneration: number
  readonly cssGeneration: number
  readonly byFile: ReadonlyMap<string, readonly Diagnostic[]>
}

/**
 * Versioned cache for SolidGraph, CSSGraph, and LayoutGraph instances.
 *
 * SolidGraphs are cached per file path with a version string.
 * The CSSGraph is a single instance covering all CSS files,
 * invalidated via a monotonic generation counter bumped by
 * `invalidate()` or `invalidateAll()`.
 */
export class GraphCache {
  private readonly log: Logger
  private readonly solids = new Map<string, CachedSolid>()
  private readonly crossFileDiagnostics = new Map<string, readonly Diagnostic[]>()
  private crossFileResults: CachedCrossFileResults | null = null
  private css: CachedCSS | null = null
  private solidGeneration = 0
  private cssGeneration = 0
  private layout: CachedLayout | null = null

  constructor(log?: Logger) {
    this.log = log ?? noopLogger
  }

  /**
   * Check if a SolidGraph is cached and current for a file path.
   *
   * Allows callers to skip builder allocation when the cache is warm.
   *
   * @param path Absolute file path
   * @param version Script version string from the TS project service
   */
  hasSolidGraph(path: string, version: string): boolean {
    const key = canonicalPath(path)
    const cached = this.solids.get(key)
    const hit = cached !== undefined && cached.version === version
    if (this.log.enabled) this.log.debug(`hasSolidGraph: ${key} v=${version} cached=${cached?.version ?? "none"} hit=${hit} (${this.solids.size} total)`)
    return hit
  }

  /**
   * Store a pre-built SolidGraph in the cache.
   *
   * Used by the CLI lint command which builds graphs during single-file
   * analysis and pre-populates the cache for cross-file reuse.
   *
   * @param path Absolute file path
   * @param version Script version string from the TS project service
   * @param graph Pre-built SolidGraph
   */
  setSolidGraph(path: string, version: string, graph: SolidGraph): void {
    const key = canonicalPath(path)
    this.solids.set(key, { version, graph })
    this.solidGeneration++
    if (this.log.enabled) this.log.debug(`setSolidGraph: ${key} v=${version} (${this.solids.size} total) solidGen=${this.solidGeneration}`)
  }

  /**
   * Get a cached SolidGraph without building on miss.
   *
   * Returns the cached graph if the version matches, null otherwise.
   * Use when the caller has already confirmed the entry exists via
   * `hasSolidGraph` and wants to avoid allocating a builder closure.
   *
   * @param path Absolute file path
   * @param version Script version string from the TS project service
   */
  getCachedSolidGraph(path: string, version: string): SolidGraph | null {
    const key = canonicalPath(path)
    const cached = this.solids.get(key)
    if (cached !== undefined && cached.version === version) {
      if (this.log.enabled) this.log.debug(`getCachedSolidGraph HIT: ${key} v=${version}`)
      return cached.graph
    }
    if (this.log.enabled) this.log.debug(`getCachedSolidGraph MISS: ${key} v=${version}`)
    return null
  }

  /**
   * Get or build a SolidGraph for a file path.
   *
   * Returns the cached graph if the version matches.
   * Otherwise invokes the builder, caches the result, and returns it.
   *
   * @param path Absolute file path
   * @param version Script version string from the TS project service
   * @param build Builder function invoked on cache miss
   */
  getSolidGraph(path: string, version: string, build: () => SolidGraph): SolidGraph {
    const key = canonicalPath(path)
    const cached = this.solids.get(key)
    if (cached !== undefined && cached.version === version) {
      if (this.log.enabled) this.log.debug(`getSolidGraph HIT: ${key} v=${version}`)
      return cached.graph
    }

    if (this.log.enabled) this.log.debug(`getSolidGraph MISS: ${key} v=${version} (was ${cached?.version ?? "uncached"})`)
    const t0 = performance.now()
    const graph = build()
    this.solids.set(key, { version, graph })
    this.solidGeneration++
    if (this.log.enabled) this.log.debug(`getSolidGraph BUILT: ${key} v=${version} in ${performance.now() - t0}ms (${this.solids.size} total) solidGen=${this.solidGeneration}`)
    return graph
  }

  /**
   * Get the cached CSSGraph, or rebuild it.
   *
   * Returns the cached graph if the generation matches the current
   * CSS generation counter. Otherwise invokes the builder, caches
   * the result at the current generation, and returns it.
   *
   * @param build Builder function invoked on cache miss
   */
  getCSSGraph(build: () => CSSGraph): CSSGraph {
    if (this.css !== null && this.css.generation === this.cssGeneration) {
      if (this.log.enabled) this.log.debug(`getCSSGraph HIT: gen=${this.cssGeneration}`)
      return this.css.graph
    }

    if (this.log.enabled) this.log.debug(`getCSSGraph MISS: currentGen=${this.cssGeneration} cachedGen=${this.css?.generation ?? "none"}`)
    const t0 = performance.now()
    const graph = build()
    this.css = { generation: this.cssGeneration, graph }
    if (this.log.enabled) this.log.debug(`getCSSGraph BUILT: gen=${this.cssGeneration} in ${performance.now() - t0}ms`)
    return graph
  }

  /**
   * Get or build a LayoutGraph for current Solid/CSS cache state.
   *
   * Returns cached LayoutGraph when both Solid signature (path+version)
   * and CSS generation match. Otherwise invokes the builder.
   *
   * @param build Builder function invoked on cache miss
   */
  getLayoutGraph(build: () => LayoutGraph): LayoutGraph {
    const solidGen = this.solidGeneration
    const cssGen = this.cssGeneration

    if (
      this.layout !== null
      && this.layout.solidGeneration === solidGen
      && this.layout.cssGeneration === cssGen
    ) {
      if (this.log.enabled) this.log.debug(`getLayoutGraph HIT: solidGen=${solidGen} cssGen=${cssGen}`)
      return this.layout.graph
    }

    if (this.log.enabled) this.log.debug(
      `getLayoutGraph MISS: solidGen=${solidGen} cssGen=${cssGen} `
      + `cached=${this.layout !== null}`,
    )

    const t0 = performance.now()
    const graph = build()
    this.layout = {
      solidGeneration: solidGen,
      cssGeneration: cssGen,
      graph,
    }
    if (this.log.enabled) this.log.debug(`getLayoutGraph BUILT: in ${performance.now() - t0}ms`)
    return graph
  }

  /**
   * Invalidate cached graphs affected by a file change.
   *
   * Classifies the path and invalidates the appropriate cache:
   * solid files evict their per-file SolidGraph, CSS files bump
   * the CSSGraph generation counter.
   *
   * @param path Absolute file path that changed
   */
  invalidate(path: string): void {
    const key = canonicalPath(path)
    const kind = classifyFile(key)
    if (this.log.enabled) this.log.debug(`invalidate: ${key} kind=${kind} solids=${this.solids.size} hasCrossFileResults=${this.crossFileResults !== null} hasLayout=${this.layout !== null}`)
    if (kind === "solid") {
      const had = this.solids.has(key)
      this.solids.delete(key)
      this.crossFileDiagnostics.delete(key)
      this.crossFileResults = null
      this.solidGeneration++
      this.layout = null
      if (this.log.enabled) this.log.debug(`invalidate SOLID: ${key} wasInCache=${had} solids=${this.solids.size} solidGen=${this.solidGeneration}`)
    }
    if (kind === "css") {
      this.crossFileDiagnostics.delete(key)
      this.crossFileResults = null
      this.cssGeneration++
      this.css = null
      this.layout = null
      if (this.log.enabled) this.log.debug(`invalidate CSS: ${key} newCssGen=${this.cssGeneration}`)
    }
  }

  /**
   * Invalidate all cached graphs.
   *
   * Called on workspace-level events like config changes.
   */
  invalidateAll(): void {
    if (this.log.enabled) this.log.debug(`invalidateAll: solids=${this.solids.size} solidGen=${this.solidGeneration} cssGen=${this.cssGeneration}`)
    this.solids.clear()
    this.crossFileDiagnostics.clear()
    this.crossFileResults = null
    this.solidGeneration++
    this.cssGeneration++
    this.css = null
    this.layout = null
  }

  /**
   * Get all cached SolidGraphs.
   *
   * Returns a snapshot array of all currently-cached graphs.
   * Used by cross-file analysis which needs all SolidGraphs.
   */
  getAllSolidGraphs(): readonly SolidGraph[] {
    if (this.log.enabled) this.log.debug(`getAllSolidGraphs: ${this.solids.size} graphs`)
    const out: SolidGraph[] = new Array(this.solids.size)
    let i = 0
    for (const entry of this.solids.values()) {
      out[i++] = entry.graph
    }
    return out
  }

  /**
   * Get the cached CSSGraph, or null if not cached.
   */
  getCachedCSSGraph(): CSSGraph | null {
    return this.css?.graph ?? null
  }

  /**
   * Get the cached LayoutGraph, or null if not cached.
   */
  getCachedLayoutGraph(): LayoutGraph | null {
    return this.layout?.graph ?? null
  }

  /**
   * Get cached cross-file diagnostics for a file path.
   *
   * Returns the previous cross-file results so single-file-only
   * re-analysis (during typing) can merge them without re-running
   * cross-file rules.
   *
   * @param path Absolute file path
   */
  getCachedCrossFileDiagnostics(path: string): readonly Diagnostic[] {
    return this.crossFileDiagnostics.get(canonicalPath(path)) ?? []
  }

  /**
   * Store cross-file diagnostics for a file path.
   *
   * @param path Absolute file path
   * @param diagnostics Cross-file diagnostics for this path
   */
  setCachedCrossFileDiagnostics(path: string, diagnostics: readonly Diagnostic[]): void {
    this.crossFileDiagnostics.set(canonicalPath(path), diagnostics)
  }

  /**
   * Get workspace-level cross-file results if the underlying graphs haven't changed.
   *
   * Returns the full per-file map when the solid signature and CSS generation
   * match, meaning no graphs were rebuilt since the last run. Returns null
   * when results are stale and `runCrossFileRules` must re-execute.
   */
  getCachedCrossFileResults(): ReadonlyMap<string, readonly Diagnostic[]> | null {
    if (this.crossFileResults === null) {
      this.log.debug("getCachedCrossFileResults: null (no cached results)")
      return null
    }
    const solidMatch = this.crossFileResults.solidGeneration === this.solidGeneration
    const cssMatch = this.crossFileResults.cssGeneration === this.cssGeneration
    if (solidMatch && cssMatch) {
      if (this.log.enabled) this.log.debug(`getCachedCrossFileResults HIT: ${this.crossFileResults?.byFile.size} files`)
      return this.crossFileResults.byFile
    }
    if (this.log.enabled) this.log.debug(
      `getCachedCrossFileResults MISS: solidMatch=${solidMatch} cssMatch=${cssMatch} `
      + `cachedSolidGen=${this.crossFileResults?.solidGeneration} currentSolidGen=${this.solidGeneration} `
      + `cachedCssGen=${this.crossFileResults?.cssGeneration} currentCssGen=${this.cssGeneration}`,
    )
    return null
  }

  /**
   * Store workspace-level cross-file results bucketed by file.
   *
   * Called after `runCrossFileRules` completes. Captures the current
   * solid signature and CSS generation so subsequent lookups are O(1)
   * until a graph changes.
   *
   * @param allDiagnostics All cross-file diagnostics from the workspace run
   */
  setCachedCrossFileResults(allDiagnostics: readonly Diagnostic[]): void {
    const byFile = new Map<string, Diagnostic[]>()
    for (let i = 0, len = allDiagnostics.length; i < len; i++) {
      const d = allDiagnostics[i]
      if (!d) continue
      let arr = byFile.get(d.file)
      if (!arr) {
        arr = []
        byFile.set(d.file, arr)
      }
      arr.push(d)
    }
    this.crossFileResults = {
      solidGeneration: this.solidGeneration,
      cssGeneration: this.cssGeneration,
      byFile,
    }
    if (this.log.enabled) this.log.debug(
      `setCachedCrossFileResults: ${allDiagnostics.length} diags across ${byFile.size} files `
      + `solidGen=${this.solidGeneration} cssGen=${this.cssGeneration}`,
    )
    /* Replace the per-file cache used during typing (when cross-file
       analysis is skipped and previous results are reused). Must clear
       first — files that previously had cross-file diagnostics but no
       longer do must not retain stale entries. */
    this.crossFileDiagnostics.clear()
    for (const [file, diagnostics] of byFile) {
      this.crossFileDiagnostics.set(file, diagnostics)
    }
  }

  /** Number of cached SolidGraphs. */
  get solidCount(): number {
    return this.solids.size
  }

  /** The logger instance used by this cache. */
  get logger(): Logger {
    return this.log
  }


}
