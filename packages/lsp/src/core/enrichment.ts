/**
 * Workspace Enrichment — Phase C of LSP initialization.
 *
 * Spawns a persistent WorkspaceEvaluator subprocess for project-context
 * module resolution. The evaluator stays alive so Tailwind's candidatesToCss
 * can batch-validate arbitrary value classes before rule execution.
 */
import { prepareTailwindEval, buildTailwindValidatorFromEval, scanDependencyCustomProperties } from "@drskillissue/ganko";
import type { TailwindValidator, BatchableTailwindValidator, CompilationTracker, StyleCompilation, TailwindEvalParams } from "@drskillissue/ganko";
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

  if (log.isLevelEnabled(Level.Trace)) log.trace(`enrichment.enter: rootPath=${rootPath}`);
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
 * Batch-validate Tailwind arbitrary classes from a compilation's solid trees.
 *
 * Collects class tokens from all solid trees that aren't in the CSS symbol
 * table or the static validator, sends them to the Tailwind design system
 * via candidatesToCss, and preloads results into the validator's batch cache.
 *
 * Call AFTER buildFullCompilation, BEFORE running analysis rules.
 * Used by CLI lint, daemon, and LSP enrichment.
 *
 * If `evaluator` is provided (LSP path), uses it directly — assumes tailwind
 * is already initialized. If null, spawns a temporary evaluator, inits
 * tailwind from `twParams`, validates, and disposes.
 */
export async function batchValidateTailwindClasses(
  compilation: StyleCompilation,
  validator: BatchableTailwindValidator,
  twParams: TailwindEvalParams,
  projectRoot: string,
  evaluator: WorkspaceEvaluator | null,
  log?: Logger,
): Promise<void> {
  const cssClassNames = compilation.symbolTable.classNames;
  const unknowns = new Set<string>();
  for (const [, solidTree] of compilation.solidTrees) {
    for (const [, idx] of solidTree.staticClassTokensByElementId) {
      for (let i = 0; i < idx.tokens.length; i++) {
        const t = idx.tokens[i];
        if (t && !cssClassNames.has(t) && !validator.has(t)) unknowns.add(t);
      }
    }
  }

  if (unknowns.size === 0) return;

  const classNames = Array.from(unknowns);
  if (log?.isLevelEnabled(Level.Debug)) log.debug(`tailwind batch: validating ${classNames.length} unknown class names`);

  const ownedEvaluator = evaluator === null;
  const eval_ = evaluator ?? spawnWorkspaceEvaluator(projectRoot, log);
  try {
    if (ownedEvaluator) {
      await eval_.request({
        id: 0,
        type: "tailwind-init",
        tailwindModulePath: twParams.modulePath,
        tailwindEntryCss: twParams.entryCss,
        tailwindEntryBase: twParams.entryBase,
      });
    }
    const result = await eval_.request({
      id: ownedEvaluator ? 1 : 0,
      type: "tailwind-validate",
      classNames,
    });
    if (result.validation !== undefined) {
      validator.preloadBatch(classNames, result.validation);
      if (log?.isLevelEnabled(Level.Info)) log.info(`tailwind batch: ${classNames.length} classes validated`);
    }
  } catch {
    if (log?.isLevelEnabled(Level.Warning)) log.warning("tailwind batch: validation failed, falling back to static set");
  } finally {
    if (ownedEvaluator) eval_.dispose();
  }
}
