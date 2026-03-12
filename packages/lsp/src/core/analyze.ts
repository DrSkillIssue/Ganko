/**
 * Analyze — Shared diagnostic analysis pipeline
 *
 * Extracted from the LSP server so both the LSP connection and CLI lint
 * command can run single-file and cross-file diagnostics without duplication.
 */
import {
  parseContent,
  parseContentWithProgram,
  parseFile,
  analyzeInput,
  buildSolidGraph,
  buildCSSGraph,
  buildLayoutGraph,
  runCrossFileRules,
  GraphCache,
  createOverrideEmit,
} from "@drskillissue/ganko";
import type { CSSInput, Diagnostic, SolidGraph, SolidInput, TailwindValidator } from "@drskillissue/ganko";
import type ts from "typescript";
import { readFileSync } from "node:fs";
import { canonicalPath, classifyFile } from "@drskillissue/ganko-shared";
import type { Logger, RuleOverrides } from "@drskillissue/ganko-shared";
import type { Project } from "./project";
import type { FileIndex } from "./file-index";

/**
 * Read all CSS files from disk, skipping unreadable entries.
 *
 * @param cssFiles - Set of canonical CSS file paths
 * @returns Array of `{ path, content }` pairs
 */
export function readCSSFilesFromDisk(
  cssFiles: ReadonlySet<string>,
): { path: string; content: string }[] {
  const result: { path: string; content: string }[] = [];
  for (const cssPath of cssFiles) {
    try {
      result.push({ path: cssPath, content: readFileSync(cssPath, "utf-8") });
    } catch { /* skip unreadable */ }
  }
  return result;
}

/**
 * Parse file content, optionally enriching with TypeScript type info.
 *
 * @param path - Canonical file path
 * @param content - Source text
 * @param program - TypeScript program (null for type-free parse)
 * @param logger - Logger for debug output
 * @returns Parsed SolidInput ready for graph building or analysis
 */
export function parseWithOptionalProgram(
  path: string,
  content: string,
  program: ts.Program | null,
  logger?: Logger,
): SolidInput {
  if (logger?.enabled) logger.trace(`parseWithOptionalProgram: ${path} program=${program !== null ? "yes" : "NO"} content=${content.length} chars`);
  const t0 = performance.now();
  const result = program
    ? parseContentWithProgram(path, content, program, logger)
    : parseContent(path, content, logger);
  if (logger?.enabled) logger.trace(`parseWithOptionalProgram: ${path} parsed in ${(performance.now() - t0).toFixed(1)}ms`);
  return result;
}

export function createEmit(overrides?: RuleOverrides): { results: Diagnostic[]; emit: (d: Diagnostic) => void } {
  const results: Diagnostic[] = [];
  const raw = (d: Diagnostic) => results.push(d);
  const hasOverrides = overrides !== undefined && Object.keys(overrides).length > 0;
  const emit = hasOverrides ? createOverrideEmit(raw, overrides) : raw;
  return { results, emit };
}

/**
 * Build a SolidGraph for a file path using the project's TypeScript service.
 *
 * @param project - The ganko Project instance
 * @param path - Canonical file path
 * @returns Builder function that produces a SolidGraph
 */
export function buildSolidGraphForPath(project: Project, path: string, logger?: Logger): () => SolidGraph {
  return () => {
    const program = project.getLanguageService(path)?.getProgram() ?? null;
    const sf = program?.getSourceFile(path);
    if (sf) {
      return buildSolidGraph(parseWithOptionalProgram(path, sf.text, program, logger));
    }
    return buildSolidGraph(parseFile(path, logger));
  };
}

/**
 * Run single-file diagnostics.
 *
 * When content is provided (unsaved buffer), uses parseContent + analyzeInput
 * to analyze in-memory content rather than reading from disk.
 *
 * @param project - The ganko Project
 * @param path - File path to analyze
 * @param content - In-memory content for unsaved buffers
 * @param overrides - Rule severity overrides
 * @returns Diagnostics produced
 */
export function runSingleFileDiagnostics(
  project: Project,
  path: string,
  content?: string,
  overrides?: RuleOverrides,
  logger?: Logger,
): readonly Diagnostic[] {
  const key = canonicalPath(path);
  const kind = classifyFile(key);
  if (logger?.enabled) logger.trace(`runSingleFileDiagnostics ENTER: ${key} kind=${kind} content=${content !== undefined ? `${content.length} chars` : "from disk"}`);

  if (content === undefined) {
    const result = project.run([key]);
    if (logger?.enabled) logger.trace(`runSingleFileDiagnostics EXIT: ${key} ${result.length} diags (runner path)`);
    return result;
  }

  if (kind === "solid") {
    const { results, emit } = createEmit(overrides);
    const program = project.getLanguageService(key)?.getProgram() ?? null;
    if (logger?.enabled) logger.trace(`runSingleFileDiagnostics: ${key} program=${program !== null ? "yes" : "NO"}`);
    analyzeInput(parseWithOptionalProgram(key, content, program, logger), emit);
    if (logger?.enabled) logger.trace(`runSingleFileDiagnostics EXIT: ${key} ${results.length} diags (solid path)`);
    return results;
  }

  if (kind === "css") {
    if (logger?.enabled) logger.trace(`runSingleFileDiagnostics EXIT: ${key} 0 diags (css deferred to cross-file)`);
    return [];
  }

  const result = project.run([key]);
  if (logger?.enabled) logger.trace(`runSingleFileDiagnostics EXIT: ${key} ${result.length} diags (fallback runner path)`);
  return result;
}

/**
 * Run cross-file analysis using cached graphs.
 *
 * Builds/caches SolidGraphs for each solid file and a single CSSGraph
 * for all CSS files. Only graphs with stale versions are rebuilt.
 * Runs cross-file rules against the cached graphs.
 *
 * @param path - File path to collect diagnostics for
 * @param fileIndex - Workspace file index
 * @param project - Project instance
 * @param cache - Versioned graph cache
 * @param tailwind - Resolved Tailwind validator
 * @param resolveContent - Resolves current file content
 * @param overrides - Rule severity overrides
 * @returns Diagnostics attributed to the requested file
 */
export function runCrossFileDiagnostics(
  path: string,
  fileIndex: FileIndex,
  project: Project,
  cache: GraphCache,
  tailwind: TailwindValidator | null,
  resolveContent: (path: string) => string | null,
  overrides?: RuleOverrides,
  externalCustomProperties?: ReadonlySet<string>,
): readonly Diagnostic[] {
  const log = cache.logger;
  if (log.enabled) log.debug(`runCrossFileDiagnostics ENTER: path=${path} solids=${fileIndex.solidFiles.size} css=${fileIndex.cssFiles.size}`);

  if (fileIndex.solidFiles.size === 0 && fileIndex.cssFiles.size === 0) {
    log.debug("runCrossFileDiagnostics EXIT: no files to analyze");
    return [];
  }

  /* Fast path: if no graphs changed since the last workspace-level run,
     return the cached per-file slice directly — O(1) instead of re-running
     33 rules across all 230+ files. */
  const cached = cache.getCachedCrossFileResults();
  if (cached !== null) {
    const result = cached.get(path) ?? [];
    if (log.enabled) log.debug(`runCrossFileDiagnostics FAST PATH: ${result.length} diags for ${path}`);
    return result;
  }

  log.debug("runCrossFileDiagnostics SLOW PATH: rebuilding all graphs");

  const { results: allResults, emit } = createEmit(overrides);
  rebuildGraphsAndRunCrossFileRules(fileIndex, project, cache, tailwind, resolveContent, emit, externalCustomProperties);
  if (log.enabled) log.debug(`runCrossFileDiagnostics: ${allResults.length} diags`);

  /* Cache all results bucketed by file. Subsequent calls for other files
     hit the fast path above until a graph changes. */
  cache.setCachedCrossFileResults(allResults);

  const result = cache.getCachedCrossFileResults()?.get(path) ?? [];
  if (log.enabled) log.debug(`runCrossFileDiagnostics EXIT: ${result.length} diags for ${path}`);
  return result;
}

/**
 * Shared core: rebuild stale graphs and run all cross-file rules.
 *
 * Both `runCrossFileDiagnostics` (LSP, single-file result) and
 * `runAllCrossFileDiagnostics` (CLI, all results) delegate here
 * for the graph-rebuild + rule-execution pipeline.
 */
function rebuildGraphsAndRunCrossFileRules(
  fileIndex: FileIndex,
  project: Project,
  cache: GraphCache,
  tailwind: TailwindValidator | null,
  resolveContent: (path: string) => string | null,
  emit: (d: Diagnostic) => void,
  externalCustomProperties?: ReadonlySet<string>,
): void {
  const log = cache.logger;

  let rebuilt = 0;
  for (const solidPath of fileIndex.solidFiles) {
    const version = project.getScriptVersion(solidPath) ?? "0";
    if (!cache.hasSolidGraph(solidPath, version)) {
      if (log.enabled) log.trace(`crossFile: rebuilding SolidGraph for ${solidPath} (version=${version})`);
      cache.getSolidGraph(solidPath, version, buildSolidGraphForPath(project, solidPath, log));
      rebuilt++;
    }
  }
  if (log.enabled) log.debug(`crossFile: rebuilt ${rebuilt}/${fileIndex.solidFiles.size} SolidGraphs`);

  const cssGraph = cache.getCSSGraph(() => {
    const files: { path: string; content: string }[] = [];
    for (const cssPath of fileIndex.cssFiles) {
      const content = resolveContent(cssPath);
      if (content !== null) {
        files.push({ path: cssPath, content });
      } else if (log.enabled) {
        log.trace(`crossFile: CSS file unreadable: ${cssPath}`);
      }
    }
    if (log.enabled) log.trace(`crossFile: building CSSGraph from ${files.length} CSS files (tailwind=${tailwind !== null}, externalProps=${externalCustomProperties?.size ?? 0})`);
    const cssInput = buildCSSInput(files, log, tailwind, externalCustomProperties);
    return buildCSSGraph(cssInput);
  });

  const solidGraphs = cache.getAllSolidGraphs();
  if (log.enabled) log.debug(`crossFile: about to getLayoutGraph (${solidGraphs.length} solids)`);
  const layoutGraph = cache.getLayoutGraph(() => buildLayoutGraph(solidGraphs, cssGraph, log));

  const t0 = performance.now();
  runCrossFileRules(
    { solids: solidGraphs, css: cssGraph, layout: layoutGraph, logger: log },
    emit,
    log,
  );
  if (log.enabled) log.debug(`crossFile: runCrossFileRules took ${performance.now() - t0}ms`);
}

/**
 * Run cross-file analysis collecting diagnostics for ALL files (not filtered to one path).
 *
 * Used by the CLI lint command which needs cross-file diagnostics for every file
 * in the workspace, not just a single open file.
 *
 * @param fileIndex - Workspace file index
 * @param project - Project instance
 * @param cache - Versioned graph cache
 * @param tailwind - Resolved Tailwind validator
 * @param resolveContent - Resolves current file content
 * @param overrides - Rule severity overrides
 * @returns All cross-file diagnostics
 */
export function runAllCrossFileDiagnostics(
  fileIndex: FileIndex,
  project: Project,
  cache: GraphCache,
  tailwind: TailwindValidator | null,
  resolveContent: (path: string) => string | null,
  overrides?: RuleOverrides,
  externalCustomProperties?: ReadonlySet<string>,
): readonly Diagnostic[] {
  const log = cache.logger;
  if (log.enabled) log.debug(`runAllCrossFileDiagnostics ENTER: solids=${fileIndex.solidFiles.size} css=${fileIndex.cssFiles.size}`);

  if (fileIndex.solidFiles.size === 0 && fileIndex.cssFiles.size === 0) return [];

  const { results, emit } = createEmit(overrides);
  rebuildGraphsAndRunCrossFileRules(fileIndex, project, cache, tailwind, resolveContent, emit, externalCustomProperties);
  if (log.enabled) log.debug(`runAllCrossFileDiagnostics EXIT: ${results.length} diags`);

  return results;
}

/**
 * Build a CSSInput with a consistent object shape per code path.
 *
 * Branches ensure each returned literal includes all intended properties,
 * avoiding both conditional spreads and post-construction property additions.
 */
function buildCSSInput(
  files: { path: string; content: string }[],
  logger: Logger,
  tailwind: TailwindValidator | null,
  externalCustomProperties: ReadonlySet<string> | undefined,
): CSSInput {
  if (tailwind !== null && externalCustomProperties !== undefined) {
    return { files, logger, tailwind, externalCustomProperties };
  }
  if (tailwind !== null) {
    return { files, logger, tailwind };
  }
  if (externalCustomProperties !== undefined) {
    return { files, logger, externalCustomProperties };
  }
  return { files, logger };
}
