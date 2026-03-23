/**
 * WorkspaceChangeHandler — processes didChangeWatchedFiles events.
 *
 * Replaces both ChangePipeline and the didChangeWatchedFiles handler
 * logic in routing/lifecycle.ts.
 *
 * Responsibilities:
 *   1. Update FileRegistry (addFile/removeFile)
 *   2. Detect Tailwind entry CSS changes → async re-resolve
 *   3. Invalidate tracker (applyChange/applyDeletion)
 *   4. Rebuild session with updated file set snapshots
 *   5. Re-diagnose affected open files
 *
 * ESLint config detection is handled by the caller (routing/lifecycle.ts)
 * BEFORE calling processFileEvents, same as the current architecture.
 */

import { canonicalPath, classifyFile, Level } from "@drskillissue/ganko-shared";
import type { WorkspaceLayout } from "@drskillissue/ganko-shared";
import type { FileRegistry } from "../core/file-registry";
import { isTailwindEntryContent } from "../core/tailwind-state";
import { buildEnrichedCompilationTracker } from "../core/enrichment";
import type { ServerContext } from "./server";
import { SessionMutator } from "./session-mutator";
import { runDiagnosticPipeline } from "./diagnostic-pipeline";
import { createCancellationSource } from "./cancellation";

export interface FileChangeEvent {
  readonly path: string
  readonly kind: "created" | "changed" | "deleted"
}

export interface WorkspaceChangeHandler {
  processFileEvents(
    context: ServerContext,
    events: readonly FileChangeEvent[],
  ): Promise<void>

  processRegistryRebuild(
    context: ServerContext,
    newRegistry: FileRegistry,
    newLayout: WorkspaceLayout,
  ): void
}

export function createWorkspaceChangeHandler(): WorkspaceChangeHandler {
  return {
    async processFileEvents(context, events) {
      if (events.length === 0) return;
      const phase = context.phase;
      const log = context.log;

      let tailwindEntryAffected = false;
      let registryChanged = false;

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (!event) continue;
        const key = canonicalPath(event.path);

        // Update FileRegistry if enriched
        if (phase.tag === "enriched") {
          if (event.kind === "created") {
            phase.registry.addFile(key);
            registryChanged = true;
          } else if (event.kind === "deleted") {
            phase.registry.removeFile(key);
            registryChanged = true;
          }

          // Detect Tailwind entry changes
          if (!tailwindEntryAffected && classifyFile(key) === "css") {
            const content = phase.registry.getCSSContent(key);
            if (content !== null && isTailwindEntryContent(content)) {
              tailwindEntryAffected = true;
            }
          }
        }

        // Invalidate tracker regardless of enrichment state
        if (event.kind === "deleted") {
          context.graphCache.invalidateCrossFileResults();
        } else {
          context.diagManager.evict(key);
          context.graphCache.invalidateCrossFileResults();
        }
      }

      // Tailwind re-resolution
      if (tailwindEntryAffected && phase.tag === "enriched" && phase.tailwindState) {
        if (log.isLevelEnabled(Level.Info)) log.info("workspaceChangeHandler: Tailwind entry file changed, re-resolving");
        await phase.tailwindState.reResolve(phase.registry, phase.layout, log);
      }

      if (phase.tag === "enriched") {
        const nextBatchable = phase.tailwindState.validator;
        const nextTailwind = nextBatchable;

        context.phase = {
          ...phase,
          tailwindValidator: nextTailwind,
          batchableValidator: nextBatchable,
        };

        if (registryChanged || tailwindEntryAffected) {
          context.graphCache = await buildEnrichedCompilationTracker({
            project: phase.project,
            registry: phase.registry,
            layout: phase.layout,
            tailwindValidator: nextTailwind,
            batchableValidator: nextBatchable,
            externalCustomProperties: phase.externalCustomProperties,
            evaluator: phase.evaluator,
            resolveContent: context.resolveContent,
            log,
          });
        }
      }

      // Rebuild session
      const mutator = new SessionMutator();
      context.session = mutator.buildSession(context);

      // Re-diagnose affected open files
      if (phase.tag === "running" || phase.tag === "enriched") {
        const project = phase.project;
        const openPaths = context.docManager.openPaths();
        const token = createCancellationSource().token;
        for (let i = 0; i < openPaths.length; i++) {
          const p = openPaths[i];
          if (!p) continue;
          runDiagnosticPipeline({ context, project, path: p, includeCrossFile: true, token });
        }
      }
    },

    processRegistryRebuild(context, _newRegistry, _newLayout) {
      context.graphCache.invalidateCrossFileResults();
      context.diagManager.clear();

      const mutator = new SessionMutator();
      context.session = mutator.buildSession(context);

      if (context.log.isLevelEnabled(Level.Info)) context.log.info("workspaceChangeHandler: registry rebuilt, all caches invalidated");
    },
  };
}
