/**
 * CLI Lint Command
 *
 * Headless lint runner that analyzes Solid.js projects from the command line.
 * Reuses the same analysis pipeline as the LSP server: createProject,
 * createFileIndex, and the shared analyze module.
 *
 * Usage:
 *   ganko lint                     # Lint entire project
 *   ganko lint src/App.tsx         # Lint specific files
 *   ganko lint --format json       # JSON output for CI
 *   ganko lint --no-cross-file     # Skip cross-file analysis
 */
import { resolve, dirname, sep } from "node:path";
import { readFileSync, statSync, globSync } from "node:fs";
import { SolidPlugin, GraphCache, buildSolidGraph, runSolidRules, resolveTailwindValidator, scanDependencyCustomProperties } from "@drskillissue/ganko";
import type { Diagnostic } from "@drskillissue/ganko";
import { canonicalPath, classifyFile } from "@drskillissue/ganko-shared";
import { createProject } from "../core/project";
import { createFileIndex } from "../core/file-index";
import { loadESLintConfig, EMPTY_ESLINT_RESULT } from "../core/eslint-config";
import { createEmit, parseWithOptionalProgram, readCSSFilesFromDisk, runAllCrossFileDiagnostics } from "../core/analyze";
import { formatText, formatJSON, countDiagnostics } from "./format";
import { createStderrWriter, createFileWriter, createCompositeWriter, noopLogger, type Logger } from "../core/logger";
import { createLogger, parseLogLevel, type LogLevel } from "@drskillissue/ganko-shared";
import { ensureDaemon, requestLint } from "./daemon-client";
import type { LintRequestParams } from "./daemon-protocol";

function die(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(2);
}

/** Parsed CLI arguments for the lint command. */
interface LintOptions {
  /** File paths or glob patterns to lint (empty = entire project) */
  readonly files: readonly string[]
  /** Glob patterns to exclude from linting (matched relative to project root) */
  readonly exclude: readonly string[]
  /** Output format */
  readonly format: "text" | "json"
  /** Whether to run cross-file analysis */
  readonly crossFile: boolean
  /** Explicit ESLint config path */
  readonly eslintConfig: string | undefined
  /** Whether to skip reading ESLint config */
  readonly noEslintConfig: boolean
  /** Whether to treat warnings as errors */
  readonly maxWarnings: number
  /** Project root directory */
  readonly cwd: string
  /** Log level for stderr output */
  readonly logLevel: LogLevel
  /** Path to log file (writes to both stderr and file when set) */
  readonly logFile: string | undefined
  /** Skip the daemon and run analysis in-process */
  readonly noDaemon: boolean
}

/**
 * Parse lint command arguments.
 *
 * @param args - CLI arguments after "lint"
 * @returns Parsed options
 */
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
      if (next === "json") {
        format = "json";
      } else if (next === "text") {
        format = "text";
      } else {
        die(`Unknown format: ${next ?? "(missing)"}. Use "text" or "json".`);
      }
      i++;
      continue;
    }

    if (arg === "--no-cross-file") {
      crossFile = false;
      continue;
    }

    if (arg === "--eslint-config") {
      eslintConfig = args[i + 1];
      if (eslintConfig === undefined) {
        die("--eslint-config requires a path argument.");
      }
      i++;
      continue;
    }

    if (arg === "--no-eslint-config") {
      noEslintConfig = true;
      continue;
    }

    if (arg === "--verbose" || arg === "-v") {
      logLevel = "debug";
      continue;
    }

    if (arg === "--log-level") {
      const next = args[i + 1];
      if (next === undefined) {
        die("--log-level requires one of: trace, debug, info, warning, error, critical, off. Got: (missing)");
      }
      const parsed = parseLogLevel(next, "off");
      if (parsed === "off" && next !== "off") {
        die(`--log-level requires one of: trace, debug, info, warning, error, critical, off. Got: ${next}`);
      }
      logLevel = parsed;
      i++;
      continue;
    }

    if (arg === "--log-file") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) {
        die("--log-file requires a file path argument.");
      }
      logFile = resolve(cwd, next);
      i++;
      continue;
    }

    if (arg === "--max-warnings") {
      const next = args[i + 1];
      const parsed = Number(next);
      if (Number.isNaN(parsed) || parsed < 0) {
        die(`--max-warnings requires a non-negative integer. Got: ${next ?? "(missing)"}`);
      }
      maxWarnings = parsed;
      i++;
      continue;
    }

    if (arg === "--no-daemon") {
      noDaemon = true;
      continue;
    }

    if (arg === "--exclude") {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("-")) {
        die("--exclude requires a glob pattern argument.");
      }
      exclude.push(next);
      i++;
      continue;
    }

    if (!arg) continue;
    if (arg.startsWith("-")) {
      die(`Unknown option: ${arg}`);
    }

    files.push(arg);
  }

  return { files, exclude, format, crossFile, eslintConfig, noEslintConfig, maxWarnings, cwd, logLevel, logFile, noDaemon };
}

/** Glob metacharacters — presence means the arg is a pattern, not a literal path. */
const GLOB_CHARS = /[*?{]/;

/**
 * Add a single file path to the result set if ganko recognizes its extension.
 *
 * @param absolute - Resolved absolute path
 * @param seen - Dedup set
 * @param result - Output array
 */
function addFileIfLintable(absolute: string, seen: Set<string>, result: string[]): void {
  const key = canonicalPath(absolute);
  if (seen.has(key)) return;
  if (classifyFile(key) === "unknown") return;
  seen.add(key);
  result.push(key);
}

/**
 * Resolve file arguments to canonical paths.
 *
 * Handles three kinds of arguments:
 * - Glob patterns (e.g. `src/` with wildcards) — expanded via `globSync`
 * - Directories (`src/components`) — recursively scanned via `createFileIndex`
 * - Plain file paths (`src/App.tsx`) — resolved directly
 *
 * All results are filtered to file kinds ganko understands and deduped.
 *
 * @param patterns - User-supplied file paths, directories, or globs
 * @param cwd - Working directory
 * @param exclude - Glob patterns to exclude (passed to createFileIndex for directory targets)
 * @returns Resolved canonical paths
 */
function resolveFiles(patterns: readonly string[], cwd: string, exclude: readonly string[] = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (let i = 0, len = patterns.length; i < len; i++) {
    const pattern = patterns[i];
    if (!pattern) continue;

    if (GLOB_CHARS.test(pattern)) {
      const matches = globSync(pattern, { cwd, exclude });
      for (let j = 0, mLen = matches.length; j < mLen; j++) {
        const m = matches[j];
        if (!m) continue;
        addFileIfLintable(resolve(cwd, m), seen, result);
      }
      continue;
    }

    const absolute = resolve(cwd, pattern);

    let isDir = false;
    try {
      isDir = statSync(absolute).isDirectory();
    } catch {
      /* path doesn't exist — addFileIfLintable will filter it via classifyFile */
    }

    if (isDir) {
      const index = createFileIndex(absolute, exclude);
      const files = index.allFiles();
      for (let j = 0, fLen = files.length; j < fLen; j++) {
        const f = files[j];
        if (!f) continue;
        addFileIfLintable(f, seen, result);
      }
    } else {
      addFileIfLintable(absolute, seen, result);
    }
  }

  return result;
}

/** Markers that identify a project root (nearest-first, like TypeScript). */
const PROJECT_MARKERS = ["tsconfig.json", "package.json"];

/**
 * Find the project root by walking up from a starting directory.
 *
 * Stops at the **nearest** `tsconfig.json` or `package.json` — the same
 * strategy TypeScript and oxlint use. In a monorepo this finds the
 * sub-package root, not the workspace/lockfile root. The CLI lint scope
 * should match the package being linted, not the entire monorepo.
 *
 * Falls back to the starting directory if no marker is found.
 *
 * @param from - Directory to start searching from
 * @returns Project root directory
 */
function findProjectRoot(from: string): string {
  let dir = from;
  for (;;) {
    for (let i = 0, len = PROJECT_MARKERS.length; i < len; i++) {
      const marker = PROJECT_MARKERS[i];
      if (!marker) continue;
      try {
        statSync(resolve(dir, marker));
        return dir;
      } catch { /* not found */ }
    }
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}

/**
 * Determine the common ancestor directory of a set of file paths.
 *
 * @param files - Resolved absolute file paths
 * @returns Lowest common ancestor directory
 */
function commonAncestor(files: readonly string[]): string {
  if (files.length === 0) return process.cwd();
  const first = files[0];
  if (!first) return process.cwd();
  if (files.length === 1) return dirname(first);

  let common = dirname(first);
  for (let i = 1, len = files.length; i < len; i++) {
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

/**
 * Attempt to lint via the daemon. Returns diagnostics on success, null if
 * the daemon is unavailable or the request fails.
 */
async function tryDaemonLint(
  options: LintOptions,
  projectRoot: string,
  filesToLint: readonly string[],
  log: Logger,
): Promise<readonly Diagnostic[] | null> {
  const socket = await ensureDaemon(projectRoot).catch(() => null);
  if (socket === null) return null;

  try {
    const base = {
      projectRoot,
      files: filesToLint,
      exclude: options.exclude,
      crossFile: options.crossFile,
      noEslintConfig: options.noEslintConfig,
      logLevel: options.logLevel,
    };
    const params: LintRequestParams = options.eslintConfig !== undefined
      ? { ...base, eslintConfigPath: options.eslintConfig }
      : base;

    const response = await requestLint(socket, params);
    if (response.kind === "lint-response") {
      if (log.enabled) log.info(`daemon returned ${response.diagnostics.length} diagnostics`);
      return response.diagnostics;
    }
    if (response.kind === "error-response") {
      if (log.enabled) log.warning(`daemon error: ${response.message}`);
      return null;
    }
    return null;
  } catch (err: unknown) {
    if (log.enabled) log.warning(`daemon request failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    socket.destroy();
  }
}

/**
 * Format diagnostics, print output, and exit with appropriate code.
 * Shared by both daemon and in-process paths.
 */
function outputAndExit(
  allDiagnostics: readonly Diagnostic[],
  options: LintOptions,
): never {
  if (options.format === "json") {
    console.log(formatJSON(allDiagnostics));
  } else if (allDiagnostics.length > 0) {
    console.log(formatText(allDiagnostics, options.cwd));
  }

  const counts = countDiagnostics(allDiagnostics);
  let exitCode = 0;
  if (counts.errors > 0) {
    exitCode = 1;
  } else if (options.maxWarnings >= 0 && counts.warnings > options.maxWarnings) {
    if (options.format !== "json") {
      process.stderr.write(`\nganko: too many warnings (${counts.warnings}). Max allowed: ${options.maxWarnings}.\n`);
    }
    exitCode = 1;
  }
  process.exit(exitCode);
}

/**
 * Run the lint command.
 *
 * The project root is the nearest directory containing `tsconfig.json` or
 * `package.json`, following the same nearest-first strategy as TypeScript
 * and oxlint. In a monorepo this scopes to the sub-package, not the
 * workspace root. File discovery, TypeScript project service, ESLint
 * config, and cross-file analysis all operate within this boundary.
 *
 * @param args - CLI arguments after "lint"
 */
export async function runLint(args: readonly string[]): Promise<void> {
  const options = parseLintArgs(args);
  const cwd = options.cwd;

  const fileHandle = options.logFile !== undefined && options.logLevel !== "off"
    ? createFileWriter(options.logFile)
    : undefined;

  let log: Logger;
  if (options.logLevel === "off") {
    log = noopLogger;
  } else if (fileHandle !== undefined) {
    log = createLogger(createCompositeWriter(createStderrWriter(), fileHandle.writer), options.logLevel);
  } else {
    log = createLogger(createStderrWriter(), options.logLevel);
  }

  if (log.enabled) log.info(`cwd: ${cwd}`);
  if (log.enabled) log.info(`args: ${JSON.stringify(options)}`);

  const hasExplicitTargets = options.files.length > 0;

  let projectRoot: string;
  let resolvedTargets: readonly string[] | undefined;

  if (hasExplicitTargets) {
    resolvedTargets = resolveFiles(options.files, cwd, options.exclude);
    if (log.enabled) log.debug(`resolveFiles: ${options.files.length} patterns → ${resolvedTargets.length} files`);
    const ancestor = commonAncestor(resolvedTargets);
    projectRoot = findProjectRoot(ancestor);
    if (log.enabled) log.debug(`findProjectRoot: ancestor=${ancestor} → root=${projectRoot}`);
  } else {
    projectRoot = findProjectRoot(cwd);
    if (log.enabled) log.debug(`findProjectRoot: cwd=${cwd} → root=${projectRoot}`);
  }

  if (log.enabled) log.info(`project root: ${projectRoot}`);

  const eslintResult = options.noEslintConfig
    ? EMPTY_ESLINT_RESULT
    : await loadESLintConfig(projectRoot, options.eslintConfig, log).catch(() => EMPTY_ESLINT_RESULT);

  if (log.enabled) log.info(`eslint overrides: ${Object.keys(eslintResult.overrides).length} rules, ${eslintResult.globalIgnores.length} global ignores`);

  const effectiveExclude = eslintResult.globalIgnores.length > 0
    ? [...options.exclude, ...eslintResult.globalIgnores]
    : options.exclude;

  if (hasExplicitTargets && eslintResult.globalIgnores.length > 0) {
    resolvedTargets = resolveFiles(options.files, cwd, effectiveExclude);
  }

  const fileIndex = createFileIndex(projectRoot, effectiveExclude, log);
  if (log.enabled) log.info(`file index: ${fileIndex.solidFiles.size} solid, ${fileIndex.cssFiles.size} css`);

  const filesToLint = resolvedTargets ?? fileIndex.allFiles();

  if (log.enabled) log.info(`resolved ${filesToLint.length} files to lint`);

  if (!options.noDaemon) {
    const daemonResult = await tryDaemonLint(options, projectRoot, filesToLint, log);
    if (daemonResult !== null) {
      if (fileHandle !== undefined) await fileHandle.close();
      outputAndExit(daemonResult, options);
    }
    if (log.enabled) log.info("daemon unavailable, falling back to in-process analysis");
  }

  /* FIX #5: CLI never uses Runner/project.run() — only SolidPlugin is needed
     for the TypeScript project service, not for plugin dispatch. */
  const project = createProject({
    rootPath: projectRoot,
    plugins: [SolidPlugin],
    rules: eslintResult.overrides,
    log,
  });

  let exitCode = 0;
  try {

    if (filesToLint.length === 0) {
      if (options.format === "json") {
        console.log("[]");
      } else {
        console.log("No files to lint.");
      }
      return process.exit(0);
    }

    const allDiagnostics: Diagnostic[] = [];

    /* FIX #3: Read CSS files once, build a content map for cross-file reuse. */
    const allCSSFiles = readCSSFilesFromDisk(fileIndex.cssFiles);
    const cssContentMap = new Map<string, string>();
    for (let i = 0, len = allCSSFiles.length; i < len; i++) {
      const cssFile = allCSSFiles[i];
      if (!cssFile) continue;
      cssContentMap.set(cssFile.path, cssFile.content);
    }

    const tailwind = await resolveTailwindValidator(allCSSFiles).catch(() => null);
    if (log.enabled) log.info(`tailwind: ${tailwind !== null ? "resolved" : "not found"}`);

    const tLib = performance.now();
    const externalCustomProperties = scanDependencyCustomProperties(projectRoot);
    if (log.enabled) log.info(`library analysis: ${externalCustomProperties.size} external custom properties in ${(performance.now() - tLib).toFixed(0)}ms`);

    /* FIX #1: Build SolidGraph once per file, run single-file rules, then cache
       the graph for cross-file reuse — eliminates double parse + double graph build. */
    const cache = new GraphCache(log);
    const t0 = performance.now();

    for (let i = 0, len = filesToLint.length; i < len; i++) {
      const path = filesToLint[i];
      if (!path) continue;
      if (classifyFile(path) === "css") continue;
      let content: string;
      try {
        content = readFileSync(path, "utf-8");
      } catch {
        if (log.enabled) log.trace(`lint: skipping unreadable file ${path}`);
        continue;
      }

      const key = canonicalPath(path);
      project.updateFile(key, content);
      const program = project.getLanguageService(key)?.getProgram() ?? null;
      const input = parseWithOptionalProgram(key, content, program, log);
      const graph = buildSolidGraph(input);

      /* Pre-populate cache so cross-file phase gets O(1) hits. */
      const version = project.getScriptVersion(key) ?? "0";
      cache.setSolidGraph(key, version, graph);

      /* Run single-file rules on the already-built graph. */
      const { results, emit } = createEmit(eslintResult.overrides);
      runSolidRules(graph, input.sourceCode, emit);
      for (let j = 0, dLen = results.length; j < dLen; j++) {
        const result = results[j];
        if (!result) continue;
        allDiagnostics.push(result);
      }
    }

    const t1 = performance.now();
    if (log.enabled) log.info(`single-file analysis: ${allDiagnostics.length} diagnostics in ${(t1 - t0).toFixed(0)}ms`);

    if (options.crossFile) {
      /* FIX #3 (cont.): Serve CSS content from the pre-read map instead of re-reading from disk. */
      const readContent = (path: string): string | null => {
        const cached = cssContentMap.get(path);
        if (cached !== undefined) return cached;
        try {
          return readFileSync(path, "utf-8");
        } catch {
          return null;
        }
      };

      const crossDiagnostics = runAllCrossFileDiagnostics(
        fileIndex,
        project,
        cache,
        tailwind,
        readContent,
        eslintResult.overrides,
        externalCustomProperties,
      );

      if (hasExplicitTargets) {
        const lintSet = new Set(filesToLint);
        let crossCount = 0;
        for (let i = 0, len = crossDiagnostics.length; i < len; i++) {
          const d = crossDiagnostics[i];
          if (!d) continue;
          if (lintSet.has(d.file)) {
            allDiagnostics.push(d);
            crossCount++;
          }
        }
        if (log.enabled) {
          const t2 = performance.now();
          log.info(`cross-file analysis: ${crossCount} diagnostics in ${(t2 - t1).toFixed(0)}ms`);
        }
      } else {
        for (let i = 0, len = crossDiagnostics.length; i < len; i++) {
          const cd = crossDiagnostics[i];
          if (!cd) continue;
          allDiagnostics.push(cd);
        }
        if (log.enabled) {
          const t2 = performance.now();
          log.info(`cross-file analysis: ${crossDiagnostics.length} diagnostics in ${(t2 - t1).toFixed(0)}ms`);
        }
      }
    }

    if (options.format === "json") {
      console.log(formatJSON(allDiagnostics));
    } else if (allDiagnostics.length > 0) {
      console.log(formatText(allDiagnostics, cwd));
    }

    const counts = countDiagnostics(allDiagnostics);
    if (log.enabled) log.info(`total: ${allDiagnostics.length} diagnostics (${counts.errors} errors, ${counts.warnings} warnings) in ${(performance.now() - t0).toFixed(0)}ms`);

    if (counts.errors > 0) {
      exitCode = 1;
    } else if (options.maxWarnings >= 0 && counts.warnings > options.maxWarnings) {
      if (options.format !== "json") {
        process.stderr.write(`\nganko: too many warnings (${counts.warnings}). Max allowed: ${options.maxWarnings}.\n`);
      }
      exitCode = 1;
    }

  } finally {
    project.dispose();
    if (fileHandle !== undefined) await fileHandle.close();
  }

  process.exit(exitCode);
}
