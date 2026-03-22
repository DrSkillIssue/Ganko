/**
 * Analyze — Shared diagnostic analysis pipeline
 *
 * Uses CompilationTracker + AnalysisDispatcher for cross-file analysis.
 */
import {
  createSolidInput,
  analyzeInput,
  createOverrideEmit,
  createAnalysisDispatcher,
  allRules,
} from "@drskillissue/ganko";
import type { Diagnostic, TailwindValidator, CompilationTracker } from "@drskillissue/ganko";
import { canonicalPath, classifyFile } from "@drskillissue/ganko-shared";
import type { Logger, RuleOverrides } from "@drskillissue/ganko-shared";
import type { Project } from "./project";
import type { FileRegistry } from "./file-registry";
import { buildFullCompilation } from "./compilation-builder";

export function createEmit(overrides?: RuleOverrides): { results: Diagnostic[]; emit: (d: Diagnostic) => void } {
  const results: Diagnostic[] = [];
  const raw = (d: Diagnostic) => results.push(d);
  const hasOverrides = overrides !== undefined && Object.keys(overrides).length > 0;
  const emit = hasOverrides ? createOverrideEmit(raw, overrides) : raw;
  return { results, emit };
}

export function runSingleFileDiagnostics(
  project: Project,
  path: string,
  content?: string,
  overrides?: RuleOverrides,
  logger?: Logger,
): readonly Diagnostic[] {
  const key = canonicalPath(path);
  const kind = classifyFile(key);

  if (content === undefined) return project.run([key]);

  if (kind === "solid") {
    const { results, emit } = createEmit(overrides);
    const program = project.getProgram();
    const input = createSolidInput(key, program, logger);
    analyzeInput(input, emit);
    return results;
  }

  if (kind === "css") return [];

  return project.run([key]);
}

export function runCrossFileDiagnostics(
  path: string,
  fileIndex: FileRegistry,
  project: Project,
  tracker: CompilationTracker,
  tailwind: TailwindValidator | null,
  resolveContent: (path: string) => string | null,
  overrides?: RuleOverrides,
  externalCustomProperties?: ReadonlySet<string>,
  logger?: Logger,
): readonly Diagnostic[] {
  if (fileIndex.solidFiles.size === 0 && fileIndex.cssFiles.size === 0) return [];

  const cached = tracker.getCachedCrossFileResults();
  if (cached !== null) return cached.get(path) ?? [];

  const { results: allResults, emit } = createEmit(overrides);
  rebuildAndRunDispatcher(fileIndex, project, tailwind, resolveContent, emit, externalCustomProperties, logger);

  tracker.setCachedCrossFileResults(allResults);
  return tracker.getCachedCrossFileResults()?.get(path) ?? [];
}

function rebuildAndRunDispatcher(
  fileIndex: FileRegistry,
  project: Project,
  tailwind: TailwindValidator | null,
  resolveContent: (path: string) => string | null,
  emit: (d: Diagnostic) => void,
  externalCustomProperties?: ReadonlySet<string>,
  logger?: Logger,
): void {
  const { compilation } = buildFullCompilation({
    solidFiles: fileIndex.solidFiles,
    cssFiles: fileIndex.cssFiles,
    getProgram: () => project.getProgram(),
    tailwindValidator: tailwind,
    externalCustomProperties,
    resolveContent,
    logger,
  });

  const dispatcher = createAnalysisDispatcher();
  for (let i = 0; i < allRules.length; i++) {
    dispatcher.register(allRules[i]);
  }

  const result = dispatcher.run(compilation);
  for (let i = 0; i < result.diagnostics.length; i++) {
    const d = result.diagnostics[i];
    if (d) emit(d);
  }
}

export function runAllCrossFileDiagnostics(
  fileIndex: FileRegistry,
  project: Project,
  _tracker: CompilationTracker,
  tailwind: TailwindValidator | null,
  resolveContent: (path: string) => string | null,
  overrides?: RuleOverrides,
  externalCustomProperties?: ReadonlySet<string>,
  logger?: Logger,
): readonly Diagnostic[] {
  if (fileIndex.solidFiles.size === 0 && fileIndex.cssFiles.size === 0) return [];

  const { results, emit } = createEmit(overrides);
  rebuildAndRunDispatcher(fileIndex, project, tailwind, resolveContent, emit, externalCustomProperties, logger);
  return results;
}
