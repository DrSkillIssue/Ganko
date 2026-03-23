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
  runSolidRules,
  createOverrideEmit,
  createAnalysisDispatcher,
  allRules,
  scanDependencyCustomProperties,
  resolveTailwindValidatorSync,
  prepareTailwindEval,
  setActivePolicy,
} from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, buildWorkspaceLayout, acceptProjectRoot } from "@drskillissue/ganko-shared";
import { createProject } from "../core/project";
import { createFileRegistry } from "../core/file-registry";
import { buildFullCompilation, findProjectRoot as findProjectRootShared } from "../core/compilation-builder";
import { loadESLintConfig, EMPTY_ESLINT_RESULT } from "../core/eslint-config";
import { createEmit } from "../core/analyze";
import { batchResolveTailwindClasses } from "../core/enrichment";
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
  readonly accessibilityPolicy: string | undefined
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
  let accessibilityPolicy: string | undefined;
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
    if (arg === "--accessibility-policy") {
      accessibilityPolicy = args[i + 1];
      if (accessibilityPolicy === undefined) die("--accessibility-policy requires a value (wcag-aa, wcag-aaa).");
      i++; continue;
    }
    if (arg === "--exclude") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) die("--exclude requires a glob pattern argument.");
      exclude.push(next); i++; continue;
    }
    if (arg.startsWith("-")) die(`Unknown option: ${arg}`);
    files.push(arg);
  }

  return { files, exclude, format, crossFile, eslintConfig, noEslintConfig, maxWarnings, cwd, logLevel, logFile, noDaemon, accessibilityPolicy };
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
      for (let j = 0; j < matches.length; j++) { const m = matches[j]; if (m) addFileIfLintable(resolve(cwd, m), seen, result); }
      continue;
    }
    const absolute = resolve(cwd, pattern);
    let isDir = false;
    try { isDir = statSync(absolute).isDirectory(); } catch { /* doesn't exist */ }
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

const findProjectRoot = findProjectRootShared;

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
  options: LintOptions, projectRoot: string, filesToLint: readonly string[], log: Logger,
): Promise<readonly Diagnostic[] | null> {
  const socket = await ensureDaemon(projectRoot).catch((err) => {
    log.warning(`daemon: failed to connect: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });
  if (socket === null) return null;
  try {
    log.info("daemon: connected, sending lint request");
    const base = { projectRoot, files: filesToLint, exclude: options.exclude, crossFile: options.crossFile, noEslintConfig: options.noEslintConfig, logLevel: options.logLevel };
    const params: LintRequestParams = options.eslintConfig !== undefined ? { ...base, eslintConfigPath: options.eslintConfig } : base;
    const response = await requestLint(socket, params);
    if (response.kind === "lint-response") {
      log.info(`daemon: received ${response.diagnostics.length} diagnostics`);
      return response.diagnostics;
    }
    log.warning(`daemon: unexpected response kind: ${response.kind}`);
    return null;
  } catch (err) {
    log.warning(`daemon: request failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally { socket.destroy(); }
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

  const workspaceLayout = buildWorkspaceLayout(acceptProjectRoot(projectRoot), log);
  const fileRegistry = createFileRegistry(workspaceLayout, effectiveExclude, log);
  const filesToLint = resolvedTargets ?? [...fileRegistry.solidFiles, ...fileRegistry.cssFiles];

  if (!options.noDaemon) {
    const daemonResult = await tryDaemonLint(options, projectRoot, filesToLint, log);
    if (daemonResult !== null) {
      if (fileHandle !== undefined) await fileHandle.close();
      outputAndExit(daemonResult, options);
    }
  }

  if (options.accessibilityPolicy !== undefined) setActivePolicy(options.accessibilityPolicy);

  const project = createProject({ rootPath: projectRoot, plugins: [SolidPlugin], rules: eslintResult.overrides, log });
  let exitCode = 0;

  try {
    if (filesToLint.length === 0) {
      if (options.format === "json") console.log("[]");
      else console.log("No files to lint.");
      project.dispose();
      if (fileHandle !== undefined) await fileHandle.close();
      process.exit(0);
    }

    log.info(`project root: ${projectRoot}`);
    log.info(`files to lint: ${filesToLint.length}`);

    // Sync all discovered files into the TS project so the LanguageService
    // includes them in getScriptFileNames. Required for monorepo setups where
    // the root tsconfig has "files": [] and uses project references — the
    // parsed fileNames is empty but the FileRegistry discovered all workspace files.
    for (const solidPath of fileRegistry.solidFiles) {
      try { project.updateFile(solidPath, readFileSync(solidPath, "utf-8")); } catch { /* skip unreadable */ }
    }

    const program = project.getProgram();
    const allDiagnostics: Diagnostic[] = [];
    const t0 = performance.now();

    // ── Build compilation ONCE with all trees ─────────────────────────
    let tailwind = null;
    const cssContent = fileRegistry.loadAllCSSContent();
    const twParams = prepareTailwindEval(cssContent, projectRoot, Array.from(workspaceLayout.packagePaths), log);
    try {
      tailwind = resolveTailwindValidatorSync(cssContent, projectRoot);
      if (tailwind) log.info("tailwind: resolved");
      else log.info("tailwind: not found");
    } catch (err) {
      log.warning(`tailwind: resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const externalCustomProperties = scanDependencyCustomProperties(workspaceLayout);
    if (externalCustomProperties.size > 0) log.info(`library analysis: ${externalCustomProperties.size} external custom properties`);

    const { compilation } = buildFullCompilation({
      solidFiles: fileRegistry.solidFiles,
      cssFiles: fileRegistry.cssFiles,
      getProgram: () => program,
      tailwindValidator: tailwind,
      externalCustomProperties: externalCustomProperties.size > 0 ? externalCustomProperties : undefined,
      resolveContent: (p) => { try { return readFileSync(p, "utf-8"); } catch { return null; } },
      logger: log,
    });

    const tBuild = performance.now();
    log.info(`compilation: ${compilation.solidTrees.size} solid + ${compilation.cssTrees.size} css trees in ${(tBuild - t0).toFixed(0)}ms`);

    // ── Batch-resolve Tailwind classes — preload CSS into validator ────
    if (tailwind !== null && "preloadBatch" in tailwind && twParams !== null) {
      await batchResolveTailwindClasses(compilation, tailwind, twParams, projectRoot, null, log);
    }

    // ── Solid rules on targeted files (trees already in compilation) ──
    for (let i = 0; i < filesToLint.length; i++) {
      const path = filesToLint[i];
      if (!path) continue;
      if (classifyFile(path) === "css") continue;
      const tree = compilation.getSolidTree(path);
      if (!tree) continue;
      const { results, emit } = createEmit(eslintResult.overrides);
      runSolidRules(tree, tree.sourceFile, emit);
      for (let j = 0; j < results.length; j++) { const d = results[j]; if (d) allDiagnostics.push(d); }
    }

    const t1 = performance.now();
    log.info(`single-file: ${allDiagnostics.length} diagnostics in ${(t1 - tBuild).toFixed(0)}ms`);

    // ── Cross-file analysis ───────────────────────────────────────────
    if (options.crossFile) {
      const dispatcher = createAnalysisDispatcher();
      for (let i = 0; i < allRules.length; i++) { const rule = allRules[i]; if (rule) dispatcher.register(rule); }

      const crossResult = dispatcher.run(compilation);
      const hasOverrides = Object.keys(eslintResult.overrides).length > 0;
      const lintSet = hasExplicitTargets ? new Set(filesToLint) : null;
      const crossEmit = hasOverrides
        ? createOverrideEmit((d: Diagnostic) => { if (!lintSet || lintSet.has(d.file)) allDiagnostics.push(d); }, eslintResult.overrides)
        : (d: Diagnostic) => { if (!lintSet || lintSet.has(d.file)) allDiagnostics.push(d); };

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
