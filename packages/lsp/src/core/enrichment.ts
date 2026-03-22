/**
 * Workspace Enrichment — Phase C of LSP initialization.
 *
 * Spawns a persistent WorkspaceEvaluator subprocess for project-context
 * module resolution. The evaluator stays alive so Tailwind's candidatesToCss
 * can batch-validate arbitrary value classes before rule execution.
 */
import { prepareTailwindEval, buildTailwindValidatorFromEval, scanDependencyCustomProperties } from "@drskillissue/ganko";
import type { TailwindValidator, BatchableTailwindValidator, CompilationTracker } from "@drskillissue/ganko";
/** Minimal diagnostic eviction interface. */
export interface DiagnosticEviction {
  evict(path: string): void
  clear(): void
}
import { acceptProjectRoot, buildWorkspaceLayout, Level } from "@drskillissue/ganko-shared";
import type { Logger, WorkspaceLayout } from "@drskillissue/ganko-shared";
import { createFileRegistry, type FileRegistry } from "./file-registry";
import { createTailwindState, type TailwindState } from "./tailwind-state";
import { spawnWorkspaceEvaluator, type WorkspaceEvaluator } from "./workspace-eval";

export interface EnrichmentResult {
  readonly registry: FileRegistry
  readonly layout: WorkspaceLayout
  readonly tailwindValidator: TailwindValidator | null
  readonly batchableValidator: BatchableTailwindValidator | null
  readonly externalCustomProperties: ReadonlySet<string> | undefined
  readonly tailwindState: TailwindState
  readonly evaluator: WorkspaceEvaluator | null
}

export interface EnrichmentDeps {
  readonly graphCache: CompilationTracker
  readonly diagnosticEviction: DiagnosticEviction
  readonly log: Logger
}

/**
 * Run workspace enrichment.
 *
 * @param rootPath - Canonical project root path
 * @param excludes - Glob patterns to exclude from scanning
 * @param deps - Shared infrastructure references
 * @returns Enrichment result
 */
export async function runEnrichment(
  rootPath: string,
  excludes: readonly string[],
  deps: EnrichmentDeps,
): Promise<EnrichmentResult> {
  const { log } = deps;

  const root = acceptProjectRoot(rootPath);
  const layout = buildWorkspaceLayout(root, log);
  const registry = createFileRegistry(layout, excludes, log);
  if (log.isLevelEnabled(Level.Info)) log.info(`file registry: ${registry.solidFiles.size} solid, ${registry.cssFiles.size} css`);

  let tailwindValidator: TailwindValidator | null = null;
  let batchableValidator: BatchableTailwindValidator | null = null;
  let evaluator: WorkspaceEvaluator | null = null;

  if (registry.cssFiles.size > 0) {
    const cssFiles = registry.loadAllCSSContent();
    const wsPackagePaths = Array.from(layout.packagePaths);
    const twParams = prepareTailwindEval(cssFiles, rootPath, wsPackagePaths, log);

    if (twParams !== null) {
      evaluator = spawnWorkspaceEvaluator(rootPath, log);

      const initResponse = await evaluator.request({
        id: 0,
        type: "tailwind-init",
        tailwindModulePath: twParams.modulePath,
        tailwindEntryCss: twParams.entryCss,
        tailwindEntryBase: twParams.entryBase,
      }).catch((err) => {
        if (log.isLevelEnabled(Level.Warning)) log.warning(`tailwind init failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });

      if (initResponse !== null && initResponse.tailwind !== undefined) {
        batchableValidator = buildTailwindValidatorFromEval(
          initResponse.tailwind.utilities,
          initResponse.tailwind.variants,
          log,
        );
        tailwindValidator = batchableValidator;
      } else {
        evaluator.dispose();
        evaluator = null;
      }
    }

    if (log.isLevelEnabled(Level.Info)) log.info(`tailwind validator: ${tailwindValidator !== null ? "resolved" : "not found"}`);
  }

  const externalProps = scanDependencyCustomProperties(layout);
  let externalCustomProperties: ReadonlySet<string> | undefined;
  if (externalProps.size > 0) {
    externalCustomProperties = externalProps;
    if (log.isLevelEnabled(Level.Debug)) log.debug(`library analysis: ${externalProps.size} external custom properties`);
  }

  const twState = createTailwindState(tailwindValidator);

  return { registry, layout, tailwindValidator, batchableValidator, externalCustomProperties, tailwindState: twState, evaluator };
}

/**
 * Batch-validate Tailwind class names via the persistent evaluator.
 *
 * Collects all class names that miss the CSS classNameIndex, sends them
 * to the evaluator's candidatesToCss in one request, and preloads the
 * results into the BatchableTailwindValidator's cache.
 *
 * Call this AFTER building SolidSyntaxTrees and CSSGraph, BEFORE running cross-file rules.
 *
 * @param classNames - Class names to validate
 * @param validator - Batchable validator to preload
 * @param evaluator - Persistent workspace evaluator
 * @param log - Logger
 */
export async function preloadTailwindBatch(
  classNames: readonly string[],
  validator: BatchableTailwindValidator,
  evaluator: WorkspaceEvaluator,
  log?: Logger,
): Promise<void> {
  if (classNames.length === 0) return;

  const unknowns: string[] = [];
  for (let i = 0; i < classNames.length; i++) {
    const name = classNames[i];
    if (name !== undefined && !validator.has(name)) {
      unknowns.push(name);
    }
  }

  if (unknowns.length === 0) return;

  if (log?.isLevelEnabled(Level.Debug)) log.debug(`tailwind: batch validating ${unknowns.length} unknown class names`);

  const response = await evaluator.request({
    id: 0,
    type: "tailwind-validate",
    classNames: unknowns,
  }).catch(() => null);

  if (response !== null && response.validation !== undefined) {
    validator.preloadBatch(unknowns, response.validation);
  }
}
