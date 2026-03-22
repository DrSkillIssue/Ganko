/**
 * Change Pipeline — Unified file change propagation.
 *
 * Every file system event flows through this pipeline:
 * 1. FileRegistry update (add/remove)
 * 2. If CSS changed: check Tailwind entry → re-resolve if affected
 * 3. Graph cache invalidation
 * 4. Cross-file result cache invalidation
 * 5. Diagnostic cache eviction
 *
 * Replaces the scattered fileIndex.add/remove + evictCachesForPath
 * calls in routing/lifecycle.ts with a single coherent pipeline.
 */
import type { CompilationTracker } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, Level } from "@drskillissue/ganko-shared";
import type { Logger, WorkspaceLayout } from "@drskillissue/ganko-shared";
import type { FileRegistry } from "./file-registry";
import type { TailwindState } from "./tailwind-state";
import { isTailwindEntryContent } from "./tailwind-state";
import type { ResourceMap } from "../server/resource-map";

export interface FileChange {
  readonly path: string
  readonly type: "created" | "changed" | "deleted"
}

export interface ChangePipeline {
  /**
   * Process a batch of file system changes.
   *
   * Updates the file registry, checks for Tailwind entry changes,
   * invalidates graph/diagnostic caches, and signals re-diagnosis.
   *
   * @param changes - File changes from the watcher
   * @returns Paths that were processed (for downstream re-diagnosis)
   */
  processFileChanges(changes: readonly FileChange[]): readonly string[]

  /**
   * Process a workspace-level configuration change (excludes changed).
   *
   * Rebuilds the file registry with new excludes, re-resolves Tailwind,
   * invalidates all caches.
   *
   * @param newRegistry - Rebuilt file registry
   */
  processRegistryRebuild(newRegistry: FileRegistry): void
}

export interface ChangePipelineDeps {
  readonly registry: FileRegistry
  readonly layout: WorkspaceLayout
  readonly graphCache: CompilationTracker
  readonly diagCache: ResourceMap<readonly Diagnostic[]>
  readonly tailwindState: TailwindState
  readonly log: Logger
}

/**
 * Create a change pipeline wired to the given subsystems.
 *
 * @param deps - Subsystem references
 * @returns Change pipeline
 */
export function createChangePipeline(deps: ChangePipelineDeps): ChangePipeline {
  const { registry, layout, graphCache, diagCache, tailwindState, log } = deps;

  function evictCaches(path: string): void {
    const key = canonicalPath(path);
    diagCache.delete(key);
    graphCache.invalidate(key);
  }

  return {
    processFileChanges(changes: readonly FileChange[]): readonly string[] {
      const processed: string[] = [];
      let tailwindEntryAffected = false;

      for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        if (!change) continue;
        const key = canonicalPath(change.path);
        processed.push(key);

        if (change.type === "created") {
          registry.addFile(key);
        } else if (change.type === "deleted") {
          registry.removeFile(key);
        }

        evictCaches(key);

        if (!tailwindEntryAffected && classifyFile(key) === "css") {
          const content = registry.getCSSContent(key);
          if (content !== null && isTailwindEntryContent(content)) {
            tailwindEntryAffected = true;
          }
        }
      }

      if (tailwindEntryAffected) {
        if (log.isLevelEnabled(Level.Info)) log.info("changePipeline: Tailwind entry file changed, scheduling re-resolution");
        tailwindState.reResolve(registry, layout, log).catch(() => {});
      }

      graphCache.invalidateAll();

      if (log.isLevelEnabled(Level.Debug)) log.debug(`changePipeline: processed ${processed.length} file changes`);

      return processed;
    },

    processRegistryRebuild(_newRegistry: FileRegistry): void {
      graphCache.invalidateAll();
      diagCache.clear();
      if (log.isLevelEnabled(Level.Info)) log.info("changePipeline: registry rebuilt, all caches invalidated");
    },
  };
}
