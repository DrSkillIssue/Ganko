/**
 * Analyze — Shared diagnostic analysis pipeline
 *
 * Uses CompilationTracker + AnalysisDispatcher for cross-file analysis.
 */
import {
  createSolidInput,
  analyzeInput,
  buildSolidSyntaxTree,
  buildCSSResult,
  createOverrideEmit,
  createStyleCompilation,
  createAnalysisDispatcher,
  allRules,
} from "@drskillissue/ganko";
import type { Diagnostic, TailwindValidator, CSSInput, CompilationTracker, SolidSyntaxTree } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, contentHash, Level } from "@drskillissue/ganko-shared";
import type { Logger, RuleOverrides } from "@drskillissue/ganko-shared";
import type { Project } from "./project";
import type { FileRegistry } from "./file-registry";

export function createEmit(overrides?: RuleOverrides): { results: Diagnostic[]; emit: (d: Diagnostic) => void } {
  const results: Diagnostic[] = [];
  const raw = (d: Diagnostic) => results.push(d);
  const hasOverrides = overrides !== undefined && Object.keys(overrides).length > 0;
  const emit = hasOverrides ? createOverrideEmit(raw, overrides) : raw;
  return { results, emit };
}

export function buildSolidTreeForPath(project: Project, path: string, logger?: Logger): SolidSyntaxTree {
  const program = project.getProgram();
  const input = createSolidInput(path, program, logger);
  return buildSolidSyntaxTree(input, contentHash(program.getSourceFile(path)?.text ?? ""));
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
  let compilation = createStyleCompilation();

  const program = project.getProgram();
  for (const solidPath of fileIndex.solidFiles) {
    const sourceFile = program.getSourceFile(solidPath);
    if (!sourceFile) continue;
    const input = createSolidInput(solidPath, program, logger);
    const tree = buildSolidSyntaxTree(input, contentHash(sourceFile.text));
    compilation = compilation.withSolidTree(tree);
  }

  const cssFiles: { path: string; content: string }[] = [];
  for (const cssPath of fileIndex.cssFiles) {
    const content = resolveContent(cssPath);
    if (content !== null) cssFiles.push({ path: cssPath, content });
  }

  if (cssFiles.length > 0) {
    const cssInput: { -readonly [K in keyof CSSInput]: CSSInput[K] } = { files: cssFiles, logger };
    if (tailwind !== null) cssInput.tailwind = tailwind;
    if (externalCustomProperties !== undefined) cssInput.externalCustomProperties = externalCustomProperties;
    const { trees } = buildCSSResult(cssInput);
    compilation = compilation.withCSSTrees(trees);
  }

  const dispatcher = createAnalysisDispatcher();
  for (let i = 0; i < allRules.length; i++) {
    dispatcher.register(allRules[i]!);
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
  tracker: CompilationTracker,
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
