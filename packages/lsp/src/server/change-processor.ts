/**
 * Change Processor — Atomic file change propagation pipeline.
 *
 * Replaces the manual evictFileCache → rediagnoseAffected → rediagnoseAll
 * sequence in ServerContext with a single entry point that processes
 * file changes through the system in the correct order.
 *
 * Change propagation steps:
 * 1. Evict diagnostic and graph caches for changed files
 * 2. Compute cross-file-affected open files
 * 3. Re-diagnose changed + affected files
 *
 * No implicit ordering — the pipeline runs steps in sequence internally.
 * Callers never need to know the evict-before-rediagnose dependency.
 */

import type { GraphCache } from "@drskillissue/ganko"
import { canonicalPath, classifyFile, CROSS_FILE_DEPENDENTS, Level } from "@drskillissue/ganko-shared"
import type { FileKind } from "@drskillissue/ganko-shared"
import type { DiagnosticsManager } from "./diagnostics-manager"
import type { DocumentManager } from "./document-manager"
import type { Logger } from "../core/logger"

export interface FileChangeEvent {
  readonly path: string
  readonly kind: "created" | "changed" | "deleted"
}

export class ChangeProcessor {
  constructor(
    private readonly diagnostics: DiagnosticsManager,
    private readonly graphCache: GraphCache,
    private readonly documents: DocumentManager,
    private readonly log: Logger,
    private readonly rediagnoseFn: (path: string) => void,
    private readonly rediagnoseWithTsFn: (excludePaths: ReadonlySet<string>) => void,
  ) {}

  /**
   * Process a batch of file changes. Single entry point that replaces
   * the manual evictFileCache loop + rediagnoseAffected call.
   */
  processChanges(changes: readonly FileChangeEvent[], exclude?: ReadonlySet<string>): void {
    if (changes.length === 0) return

    // Step 1: Evict caches for changed files
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i]
      if (!change) continue
      const key = canonicalPath(change.path)
      if (this.log.isLevelEnabled(Level.Debug)) this.log.debug(`changeProcessor: evict ${key}`)
      this.diagnostics.evict(key)
      this.graphCache.invalidate(key)
    }

    // Step 2: Compute affected open files (cross-file dependents)
    const changedPaths = changes.map((c) => c.path)
    const affected = this.collectAffectedPaths(changedPaths, exclude)

    // Step 3: Re-diagnose affected files
    for (let i = 0; i < affected.length; i++) {
      const path = affected[i]
      if (path) this.rediagnoseFn(path)
    }
  }

  /**
   * Full workspace invalidation — config change, ESLint reload, etc.
   * Clears all caches and re-diagnoses every open file.
   */
  processWorkspaceChange(clearTsCache = false): void {
    this.graphCache.invalidateAll()
    const paths = this.documents.openPaths()
    if (this.log.isLevelEnabled(Level.Debug)) {
      this.log.debug(`changeProcessor: workspace change, re-diagnosing ${paths.length} open files`)
    }
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]
      if (!path) continue
      this.diagnostics.evict(path)
      this.rediagnoseFn(path)
    }
    this.rediagnoseWithTsFn(clearTsCache ? new Set() : new Set(paths))
  }

  private collectAffectedPaths(
    changed: readonly string[],
    exclude?: ReadonlySet<string>,
  ): string[] {
    const needed = new Set<FileKind>()
    for (let i = 0; i < changed.length; i++) {
      const path = changed[i]
      if (!path) continue
      const deps = CROSS_FILE_DEPENDENTS[classifyFile(path)]
      for (const dep of deps) needed.add(dep)
    }
    if (needed.size === 0) return []

    const open = this.documents.openPaths()
    const out: string[] = []
    for (let i = 0; i < open.length; i++) {
      const p = open[i]
      if (!p) continue
      if (exclude !== undefined && exclude.has(p)) continue
      if (needed.has(classifyFile(p))) out.push(p)
    }

    if (this.log.isLevelEnabled(Level.Trace)) {
      this.log.trace(`collectAffectedPaths: ${changed.length} changed → kinds=[${[...needed].join(",")}] → ${out.length} affected`)
    }
    return out
  }
}
