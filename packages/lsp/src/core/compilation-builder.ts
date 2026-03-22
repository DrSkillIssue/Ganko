/**
 * CompilationBuilder — Single compilation construction path.
 *
 * Used by CLI, LSP, and daemon. No consumer assembles compilations
 * manually. Extracts the shared pattern:
 *   1. Create empty StyleCompilation
 *   2. For each solid file: createSolidInput → buildSolidSyntaxTree → withSolidTree
 *   3. For each CSS file: collect content → buildCSSResult → withCSSTrees
 *
 * Dispatching (createAnalysisDispatcher + run) is NOT part of the builder —
 * that's the IncrementalAnalyzer / CompilationDiagnosticProducer concern.
 */

import {
  createSolidInput,
  buildSolidSyntaxTree,
  buildCSSResult,
  createStyleCompilation,
} from "@drskillissue/ganko";
import type { StyleCompilation, TailwindValidator, CSSInput, SolidSyntaxTree } from "@drskillissue/ganko";
import { canonicalPath, contentHash } from "@drskillissue/ganko-shared";
import type { Logger } from "@drskillissue/ganko-shared";
import type ts from "typescript";

// ── Full build ──────────────────────────────────────────────────────

export interface FullBuildOptions {
  readonly solidFiles: ReadonlySet<string>
  readonly cssFiles: ReadonlySet<string>
  readonly getProgram: () => ts.Program
  readonly tailwindValidator: TailwindValidator | null
  readonly externalCustomProperties: ReadonlySet<string> | undefined
  readonly resolveContent: (path: string) => string | null
  readonly logger?: Logger | undefined
}

export interface CompilationBuildResult {
  readonly compilation: StyleCompilation
  /** Solid trees built during full build — caller may cache these. */
  readonly solidTrees: ReadonlyMap<string, SolidSyntaxTree>
}

/**
 * Build a full compilation from file sets.
 * Used by CLI and daemon initial build.
 */
export function buildFullCompilation(options: FullBuildOptions): CompilationBuildResult {
  const { solidFiles, cssFiles, getProgram, tailwindValidator, externalCustomProperties, resolveContent, logger } = options;

  let compilation = createStyleCompilation();
  const solidTreeMap = new Map<string, SolidSyntaxTree>();

  // Solid trees
  if (solidFiles.size > 0) {
    const program = getProgram();
    for (const solidPath of solidFiles) {
      const sourceFile = program.getSourceFile(solidPath);
      if (!sourceFile) continue;
      const input = createSolidInput(solidPath, program, logger);
      const tree = buildSolidSyntaxTree(input, contentHash(sourceFile.text));
      compilation = compilation.withSolidTree(tree);
      solidTreeMap.set(solidPath, tree);
    }
  }

  // CSS trees
  if (cssFiles.size > 0) {
    const cssFileContents: { path: string; content: string }[] = [];
    for (const cssPath of cssFiles) {
      const content = resolveContent(cssPath);
      if (content !== null) cssFileContents.push({ path: cssPath, content });
    }

    if (cssFileContents.length > 0) {
      const cssInput: { -readonly [K in keyof CSSInput]: CSSInput[K] } = { files: cssFileContents };
      if (logger !== undefined) cssInput.logger = logger;
      if (tailwindValidator !== null) cssInput.tailwind = tailwindValidator;
      if (externalCustomProperties !== undefined) cssInput.externalCustomProperties = externalCustomProperties;
      const { trees } = buildCSSResult(cssInput);
      compilation = compilation.withCSSTrees(trees);
    }
  }

  return { compilation, solidTrees: solidTreeMap };
}

// ── Single solid tree ───────────────────────────────────────────────

/**
 * Build a SolidSyntaxTree for a single file.
 *
 * Takes deferred getProgram because after IncrementalTypeScriptService.updateFile(),
 * the LanguageService lazily rebuilds on next getProgram() call. Deferring
 * ensures the builder gets the post-update program.
 */
export function buildSolidTreeForFile(
  path: string,
  getProgram: () => ts.Program,
  logger?: Logger,
): SolidSyntaxTree | null {
  const key = canonicalPath(path);
  const program = getProgram();
  const sourceFile = program.getSourceFile(key);
  if (!sourceFile) return null;
  const input = createSolidInput(key, program, logger);
  return buildSolidSyntaxTree(input, contentHash(sourceFile.text));
}

// ── Incremental single-file change ──────────────────────────────────

export interface CompilationChangeResult {
  readonly compilation: StyleCompilation
  readonly tree: SolidSyntaxTree | null
}

/**
 * Apply a single file change to an existing compilation.
 * Used by LSP and daemon incremental updates.
 *
 * For solid files: builds SolidSyntaxTree via deferred getProgram,
 *   replaces tree in compilation via withSolidTree.
 * For CSS files: re-parses single CSS file via buildCSSResult,
 *   replaces tree in compilation via withoutFile + withCSSTree.
 *
 * Takes getProgram (deferred) because after IncrementalTypeScriptService.updateFile(),
 * the LanguageService lazily rebuilds on next getProgram() call.
 */
export function applyFileChange(
  compilation: StyleCompilation,
  path: string,
  content: string,
  getProgram: () => ts.Program,
  tailwindValidator?: TailwindValidator | null,
  externalCustomProperties?: ReadonlySet<string>,
  logger?: Logger | undefined,
): CompilationChangeResult {
  const key = canonicalPath(path);
  const isSolid = key.endsWith(".tsx") || key.endsWith(".jsx") || key.endsWith(".ts") || key.endsWith(".js");

  if (isSolid) {
    const tree = buildSolidTreeForFile(key, getProgram, logger);
    if (tree === null) return { compilation, tree: null };
    return { compilation: compilation.withSolidTree(tree), tree };
  }

  // CSS file — re-parse and replace
  let next = compilation.withoutFile(key);
  const cssInput: { -readonly [K in keyof CSSInput]: CSSInput[K] } = {
    files: [{ path: key, content }],
  };
  if (logger !== undefined) cssInput.logger = logger;
  if (tailwindValidator != null) cssInput.tailwind = tailwindValidator;
  if (externalCustomProperties !== undefined) cssInput.externalCustomProperties = externalCustomProperties;
  const { trees } = buildCSSResult(cssInput);
  next = next.withCSSTrees(trees);
  return { compilation: next, tree: null };
}

// ── Project root discovery + ProjectFactory ─────────────────────────

import { createProject, type ProjectConfig, type Project } from "./project";
import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";

const PROJECT_MARKERS = ["tsconfig.json", "package.json"];

/**
 * Find the project root by walking up from a starting path.
 * Looks for tsconfig.json or package.json.
 *
 * Consolidates CLI's findProjectRoot with the same algorithm.
 */
export function findProjectRoot(from: string): string {
  let dir = from;
  for (;;) {
    for (let i = 0; i < PROJECT_MARKERS.length; i++) {
      const marker = PROJECT_MARKERS[i];
      if (!marker) continue;
      try { statSync(resolve(dir, marker)); return dir; } catch { /* not found */ }
    }
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

// ── ProjectFactory ──────────────────────────────────────────────────

/**
 * ProjectFactory — single entry point for project root discovery + creation.
 *
 * Consolidates CLI's findProjectRoot + createProject, daemon's createProject,
 * LSP's createProject in handleInitialized.
 *
 * Consumers import findProjectRoot from this file and createProject
 * from core/project.ts directly. This interface exists for consumers
 * that need both as a single dependency (e.g. daemon).
 */
export interface ProjectFactory {
  findRoot(from: string): string
  create(options: ProjectConfig): Project
}

export const projectFactory: ProjectFactory = {
  findRoot: findProjectRoot,
  create: createProject,
};
