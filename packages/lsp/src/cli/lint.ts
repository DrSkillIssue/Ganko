/**
 * CLI Lint Command
 *
 * Headless lint runner that analyzes Solid.js projects from the command line.
 * Uses buildSolidSyntaxTree for single-file and AnalysisDispatcher for cross-file.
 */
import { resolve, dirname, sep } from "node:path";
import { readFileSync, statSync, globSync } from "node:fs";
import {
  SolidPlugin,
  buildSolidSyntaxTree,
  buildCSSResult,
  runSolidRules,
  createSolidInput,
  createOverrideEmit,
  createStyleCompilation,
  createAnalysisDispatcher,
  allRules,
  scanDependencyCustomProperties,
  resolveTailwindValidatorSync,
} from "@drskillissue/ganko";
import type { Diagnostic, CSSInput } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, contentHash, buildWorkspaceLayout, acceptProjectRoot } from "@drskillissue/ganko-shared";
import { createProject } from "../core/project";
import { createFileRegistry } from "../core/file-registry";
import { loadESLintConfig, EMPTY_ESLINT_RESULT } from "../core/eslint-config";
import { createEmit } from "../core/analyze";
import { formatText, formatJSON, countDiagnostics } from "./format";
import { createStderrWriter, createFileWriter, createCompositeWriter, noopLogger, type Logger } from "../core/logger";
import { createLogger, parseLogLevel, type LogLevel } from "@drskillissue/ganko-shared";
import { ensureDaemon, requestLint } from "./daemon-client";
import type { LintRequestParams } from "./daemon-protocol";

function die(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(2);
}

interface LintOptions {
  readonly files: readonly string[]
  readonly exclude: readonly string[]
  readonly format: "text" | "json"
  readonly crossFile: boolean
  readonly eslintConfig: string | undefined
  readonly noEslintConfig: boolean
  readonly maxWarnings: number
  readonly cwd: string
  readonly logLevel: LogLevel
  readonly logFile: string | undefined
  readonly noDaemon: boolean
}

function parseLintArgs(args: readonly string[]): LintOptions {
  const files: string[] = [];
  const exclude: string[] = [];
  let format: "text" | "json" = "text";
  let crossFile = true;
  let eslintConfig: string | undefined;
  let noEslintConfig = false;
  let maxWarnings = -1;
  let logLevel: LogLevel = "off";
  let logFile: string | undefined;
  let noDaemon = false;
  const cwd = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "--format" || arg === "-f") {
      const next = args[i + 1];
      if (next === "json") format = "json";
      else if (next === "text") format = "text";
      else die(`Unknown format: ${next ?? "(missing)"}. Use "text" or "json".`);
      i++; continue;
    }
    if (arg === "--no-cross-file") { crossFile = false; continue; }
    if (arg === "--eslint-config") {
      eslintConfig = args[i + 1];
      if (eslintConfig === undefined) die("--eslint-config requires a path argument.");
      i++; continue;
    }
    if (arg === "--no-eslint-config") { noEslintConfig = true; continue; }
    if (arg === "--verbose" || arg === "-v") { logLevel = "debug"; continue; }
    if (arg === "--log-level") {
      const next = args[i + 1];
      if (next === undefined) die("--log-level requires one of: trace, debug, info, warning, error, critical, off. Got: (missing)");
      const parsed = parseLogLevel(next, "off");
      if (parsed === "off" && next !== "off") die(`--log-level requires one of: trace, debug, info, warning, error, critical, off. Got: ${next}`);
      logLevel = parsed; i++; continue;
    }
    if (arg === "--log-file") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) die("--log-file requires a file path argument.");
      logFile = resolve(cwd, next); i++; continue;
    }
    if (arg === "--max-warnings") {
      const next = args[i + 1];
      const parsed = Number(next);
      if (Number.isNaN(parsed) || parsed < 0) die(`--max-warnings requires a non-negative integer. Got: ${next ?? "(missing)"}`);
      maxWarnings = parsed; i++; continue;
    }
    if (arg === "--no-daemon") { noDaemon = true; continue; }
    if (arg === "--exclude") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) die("--exclude requires a glob pattern argument.");
      exclude.push(next); i++; continue;
    }
    if (arg.startsWith("-")) die(`Unknown option: ${arg}`);
    files.push(arg);
  }

  return { files, exclude, format, crossFile, eslintConfig, noEslintConfig, maxWarnings, cwd, logLevel, logFile, noDaemon };
}

const GLOB_CHARS = /[*?{]/;

function addFileIfLintable(absolute: string, seen: Set<string>, result: string[]): void {
  const key = canonicalPath(absolute);
  if (seen.has(key)) return;
  if (classifyFile(key) === "unknown") return;
  seen.add(key);
  result.push(key);
}

function resolveFiles(patterns: readonly string[], cwd: string, exclude: readonly string[] = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    if (!pattern) continue;
    if (GLOB_CHARS.test(pattern)) {
      const matches = globSync(pattern, { cwd, exclude });
      for (let j = 0; j < matches.length; j++) { const m = matches[j]; if (m) addFileIfLintable(resolve(cwd, m), seen, result) }
      continue;
    }
    const absolute = resolve(cwd, pattern);
    let isDir = false;
    try { isDir = statSync(absolute).isDirectory() } catch { /* doesn't exist */ }
    if (isDir) {
      const registry = createFileRegistry(buildWorkspaceLayout(acceptProjectRoot(absolute)), exclude);
      for (const f of registry.solidFiles) addFileIfLintable(f, seen, result);
      for (const f of registry.cssFiles) addFileIfLintable(f, seen, result);
    } else {
      addFileIfLintable(absolute, seen, result);
    }
  }
  return result;
}

const PROJECT_MARKERS = ["tsconfig.json", "package.json"];

function findProjectRoot(from: string): string {
  let dir = from;
  for (;;) {
    for (let i = 0; i < PROJECT_MARKERS.length; i++) {
      const marker = PROJECT_MARKERS[i];
      if (!marker) continue;
      try { statSync(resolve(dir, marker)); return dir } catch { /* not found */ }
    }
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

function commonAncestor(files: readonly string[]): string {
  if (files.length === 0) return process.cwd();
  const first = files[0];
  if (!first) return process.cwd();
  if (files.length === 1) return dirname(first);
  let common = dirname(first);
  for (let i = 1; i < files.length; i++) {
    const f = files[i];
    if (!f) continue;
    const dir = dirname(f);
    while (common !== dir && !dir.startsWith(common + sep)) {
      const parent = dirname(common);
      if (parent === common) return common;
      common = parent;
    }
  }
  return common;
}

async function tryDaemonLint(
  options: LintOptions, projectRoot: string, filesToLint: readonly string[], _log: Logger,
): Promise<readonly Diagnostic[] | null> {
  const socket = await ensureDaemon(projectRoot).catch(() => null);
  if (socket === null) return null;
  try {
    const base = { projectRoot, files: filesToLint, exclude: options.exclude, crossFile: options.crossFile, noEslintConfig: options.noEslintConfig, logLevel: options.logLevel };
    const params: LintRequestParams = options.eslintConfig !== undefined ? { ...base, eslintConfigPath: options.eslintConfig } : base;
    const response = await requestLint(socket, params);
    if (response.kind === "lint-response") return response.diagnostics;
    return null;
  } catch { return null } finally { socket.destroy() }
}

export async function runLint(args: readonly string[]): Promise<void> {
  const options = parseLintArgs(args);
  const cwd = options.cwd;

  const fileHandle = options.logFile !== undefined && options.logLevel !== "off"
    ? createFileWriter(options.logFile) : undefined;

  let log: Logger;
  if (options.logLevel === "off") log = noopLogger;
  else if (fileHandle !== undefined) log = createLogger(createCompositeWriter(createStderrWriter(), fileHandle.writer), options.logLevel);
  else log = createLogger(createStderrWriter(), options.logLevel);

  const hasExplicitTargets = options.files.length > 0;
  let projectRoot: string;
  let resolvedTargets: readonly string[] | undefined;

  if (hasExplicitTargets) {
    resolvedTargets = resolveFiles(options.files, cwd, options.exclude);
    const ancestor = commonAncestor(resolvedTargets);
    projectRoot = findProjectRoot(ancestor);
  } else {
    projectRoot = findProjectRoot(cwd);
  }

  const eslintResult = options.noEslintConfig
    ? EMPTY_ESLINT_RESULT
    : await loadESLintConfig(projectRoot, options.eslintConfig, log).catch(() => EMPTY_ESLINT_RESULT);

  const effectiveExclude = eslintResult.globalIgnores.length > 0
    ? [...options.exclude, ...eslintResult.globalIgnores] : options.exclude;

  if (hasExplicitTargets && eslintResult.globalIgnores.length > 0) {
    resolvedTargets = resolveFiles(options.files, cwd, effectiveExclude);
  }

  const fileRegistry = createFileRegistry(buildWorkspaceLayout(acceptProjectRoot(projectRoot), log), effectiveExclude, log);
  const filesToLint = resolvedTargets ?? [...fileRegistry.solidFiles, ...fileRegistry.cssFiles];

  if (!options.noDaemon) {
    const daemonResult = await tryDaemonLint(options, projectRoot, filesToLint, log);
    if (daemonResult !== null) {
      if (fileHandle !== undefined) await fileHandle.close();
      outputAndExit(daemonResult, options);
    }
  }

  const project = createProject({ rootPath: projectRoot, plugins: [SolidPlugin], rules: eslintResult.overrides, log });
  let exitCode = 0;

  try {
    if (filesToLint.length === 0) {
      if (options.format === "json") console.log("[]");
      else console.log("No files to lint.");
      return process.exit(0);
    }

    const allDiagnostics: Diagnostic[] = [];
    const program = project.getProgram();
    const t0 = performance.now();

    // Single-file analysis
    for (let i = 0; i < filesToLint.length; i++) {
      const path = filesToLint[i];
      if (!path) continue;
      if (classifyFile(path) === "css") continue;

      const sourceFile = program.getSourceFile(canonicalPath(path));
      if (!sourceFile) continue;

      const input = createSolidInput(canonicalPath(path), program, log);
      const tree = buildSolidSyntaxTree(input, contentHash(sourceFile.text));

      const { results, emit } = createEmit(eslintResult.overrides);
      runSolidRules(tree, input.sourceFile, emit);
      for (let j = 0; j < results.length; j++) { const d = results[j]; if (d) allDiagnostics.push(d) }
    }

    const t1 = performance.now();
    log.info(`single-file: ${allDiagnostics.length} diagnostics in ${(t1 - t0).toFixed(0)}ms`);

    // Cross-file analysis via AnalysisDispatcher
    if (options.crossFile) {
      let compilation = createStyleCompilation();

      // Add solid trees
      for (const solidPath of fileRegistry.solidFiles) {
        const sourceFile = program.getSourceFile(solidPath);
        if (!sourceFile) continue;
        const input = createSolidInput(solidPath, program, log);
        const tree = buildSolidSyntaxTree(input, contentHash(sourceFile.text));
        compilation = compilation.withSolidTree(tree);
      }

      // Add CSS trees
      const cssFiles: { path: string; content: string }[] = [];
      for (const cssPath of fileRegistry.cssFiles) {
        try { cssFiles.push({ path: cssPath, content: readFileSync(cssPath, "utf-8") }) } catch { /* skip */ }
      }

      if (cssFiles.length > 0) {
        let tailwind = null;
        try { tailwind = resolveTailwindValidatorSync(cssFiles, projectRoot) } catch { /* no tailwind */ }
        const layout = buildWorkspaceLayout(acceptProjectRoot(projectRoot), log);
        const externalCustomProperties = scanDependencyCustomProperties(layout);
        const cssInput: { -readonly [K in keyof CSSInput]: CSSInput[K] } = { files: cssFiles, logger: log };
        if (tailwind !== null) cssInput.tailwind = tailwind;
        if (externalCustomProperties.size > 0) cssInput.externalCustomProperties = externalCustomProperties;
        const { trees } = buildCSSResult(cssInput);
        compilation = compilation.withCSSTrees(trees);
      }

      const dispatcher = createAnalysisDispatcher();
      for (let i = 0; i < allRules.length; i++) dispatcher.register(allRules[i]!);

      const crossResult = dispatcher.run(compilation);
      const hasOverrides = Object.keys(eslintResult.overrides).length > 0;
      const crossEmit = hasOverrides
        ? createOverrideEmit((d: Diagnostic) => allDiagnostics.push(d), eslintResult.overrides)
        : (d: Diagnostic) => allDiagnostics.push(d);

      for (let i = 0; i < crossResult.diagnostics.length; i++) {
        const d = crossResult.diagnostics[i];
        if (d) crossEmit(d);
      }

      const t2 = performance.now();
      log.info(`cross-file: ${crossResult.diagnostics.length} diagnostics in ${(t2 - t1).toFixed(0)}ms`);
    }

    allDiagnostics.sort(compareDiagnostics);

    if (options.format === "json") console.log(formatJSON(allDiagnostics));
    else if (allDiagnostics.length > 0) console.log(formatText(allDiagnostics, cwd));

    const counts = countDiagnostics(allDiagnostics);
    if (counts.errors > 0) exitCode = 1;
    else if (options.maxWarnings >= 0 && counts.warnings > options.maxWarnings) {
      if (options.format !== "json") process.stderr.write(`\nganko: too many warnings (${counts.warnings}). Max allowed: ${options.maxWarnings}.\n`);
      exitCode = 1;
    }
  } finally {
    project.dispose();
    if (fileHandle !== undefined) await fileHandle.close();
  }

  process.exit(exitCode);
}

function outputAndExit(diagnostics: readonly Diagnostic[], options: LintOptions): never {
  if (options.format === "json") console.log(formatJSON(diagnostics));
  else if (diagnostics.length > 0) console.log(formatText(diagnostics, options.cwd));
  const counts = countDiagnostics(diagnostics);
  let exitCode = 0;
  if (counts.errors > 0) exitCode = 1;
  else if (options.maxWarnings >= 0 && counts.warnings > options.maxWarnings) {
    if (options.format !== "json") process.stderr.write(`\nganko: too many warnings (${counts.warnings}). Max allowed: ${options.maxWarnings}.\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  if (a.file < b.file) return -1;
  if (a.file > b.file) return 1;
  const aStart = a.loc.start;
  const bStart = b.loc.start;
  if (aStart.line !== bStart.line) return aStart.line - bStart.line;
  if (aStart.column !== bStart.column) return aStart.column - bStart.column;
  if (a.rule < b.rule) return -1;
  if (a.rule > b.rule) return 1;
  return 0;
}
