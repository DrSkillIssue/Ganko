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
import ts from "typescript";
import { buildSolidGraph, runSolidRules, createSolidInput, resolveTailwindValidator, scanDependencyCustomProperties, buildCSSGraph, buildLayoutGraph, runCrossFileRules, createOverrideEmit, setActivePolicy } from "@drskillissue/ganko";
import type { Diagnostic, SolidGraph, CSSInput, TailwindValidator } from "@drskillissue/ganko";
import { canonicalPath, classifyFile, ACCESSIBILITY_POLICIES, type AccessibilityPolicy } from "@drskillissue/ganko-shared";
import { createBatchProgram } from "../core/batch-program";
import { createFileIndex } from "../core/file-index";
import { loadESLintConfig, EMPTY_ESLINT_RESULT } from "../core/eslint-config";
import { readCSSFilesFromDisk } from "../core/analyze";
import { formatText, formatJSON, countDiagnostics } from "./format";
import { createStderrWriter, createFileWriter, createCompositeWriter, noopLogger, type Logger } from "../core/logger";
import { createLogger, parseLogLevel, Level, type LogLevel, type RuleOverrides } from "@drskillissue/ganko-shared";
import { ensureDaemon, requestLint } from "./daemon-client";
import type { LintRequestParams } from "./daemon-protocol";
import { createWorkerPool, defaultWorkerCount } from "./worker-pool";

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
  /** Maximum number of parallel workers (0 = auto, 1 = serial) */
  readonly maxWorkers: number
  /** Accessibility policy to enforce (undefined = no policy, rule is silent) */
  readonly accessibilityPolicy: AccessibilityPolicy | undefined
}

const ACCESSIBILITY_POLICY_MAP = new Map<string, AccessibilityPolicy>(
  ACCESSIBILITY_POLICIES.map((p): [string, AccessibilityPolicy] => [p, p]),
);

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
  let maxWorkers = 0;
  let accessibilityPolicy: AccessibilityPolicy | undefined;
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

    if (arg === "--max-workers") {
      const next = args[i + 1];
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 1) {
        die(`--max-workers requires a positive integer. Got: ${next ?? "(missing)"}`);
      }
      maxWorkers = parsed;
      i++;
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

    if (arg === "--accessibility-policy") {
      const next = args[i + 1];
      if (next === undefined) {
        die(`--accessibility-policy requires a policy name. Valid values: ${ACCESSIBILITY_POLICIES.join(", ")}.`);
      }
      const found = ACCESSIBILITY_POLICY_MAP.get(next);
      if (found === undefined) {
        die(`Unknown accessibility policy: ${next}. Valid values: ${ACCESSIBILITY_POLICIES.join(", ")}.`);
      }
      accessibilityPolicy = found;
      i++;
      continue;
    }

    if (!arg) continue;
    if (arg.startsWith("-")) {
      die(`Unknown option: ${arg}`);
    }

    files.push(arg);
  }

  return { files, exclude, format, crossFile, eslintConfig, noEslintConfig, maxWarnings, cwd, logLevel, logFile, noDaemon, maxWorkers, accessibilityPolicy };
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
  for (; ;) {
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
    const extra: { eslintConfigPath?: string; accessibilityPolicy?: AccessibilityPolicy } = {};
    if (options.eslintConfig !== undefined) extra.eslintConfigPath = options.eslintConfig;
    if (options.accessibilityPolicy !== undefined) extra.accessibilityPolicy = options.accessibilityPolicy;
    const params: LintRequestParams = { ...base, ...extra };

    const response = await requestLint(socket, params);
    if (response.kind === "lint-response") {
      if (log.isLevelEnabled(Level.Info)) log.info(`daemon returned ${response.diagnostics.length} diagnostics`);
      return response.diagnostics;
    }
    if (response.kind === "error-response") {
      if (log.isLevelEnabled(Level.Warning)) log.warning(`daemon error: ${response.message}`);
      return null;
    }
    return null;
  } catch (err: unknown) {
    if (log.isLevelEnabled(Level.Warning)) log.warning(`daemon request failed: ${err instanceof Error ? err.message : String(err)}`);
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

  if (log.isLevelEnabled(Level.Info)) log.info(`cwd: ${cwd}`);
  if (log.isLevelEnabled(Level.Info)) log.info(`args: ${JSON.stringify(options)}`);

  const hasExplicitTargets = options.files.length > 0;

  let projectRoot: string;
  let resolvedTargets: readonly string[] | undefined;

  if (hasExplicitTargets) {
    resolvedTargets = resolveFiles(options.files, cwd, options.exclude);
    if (log.isLevelEnabled(Level.Debug)) log.debug(`resolveFiles: ${options.files.length} patterns → ${resolvedTargets.length} files`);
    const ancestor = commonAncestor(resolvedTargets);
    projectRoot = findProjectRoot(ancestor);
    if (log.isLevelEnabled(Level.Debug)) log.debug(`findProjectRoot: ancestor=${ancestor} → root=${projectRoot}`);
  } else {
    projectRoot = findProjectRoot(cwd);
    if (log.isLevelEnabled(Level.Debug)) log.debug(`findProjectRoot: cwd=${cwd} → root=${projectRoot}`);
  }

  if (log.isLevelEnabled(Level.Info)) log.info(`project root: ${projectRoot}`);

  const eslintResult = options.noEslintConfig
    ? EMPTY_ESLINT_RESULT
    : await loadESLintConfig(projectRoot, options.eslintConfig, log).catch(() => EMPTY_ESLINT_RESULT);

  if (options.accessibilityPolicy !== undefined) {
    setActivePolicy(options.accessibilityPolicy);
  }
  if (log.isLevelEnabled(Level.Info)) log.info(`eslint overrides: ${Object.keys(eslintResult.overrides).length} rules, ${eslintResult.globalIgnores.length} global ignores, policy: ${options.accessibilityPolicy ?? "none"}`);

  const effectiveExclude = eslintResult.globalIgnores.length > 0
    ? [...options.exclude, ...eslintResult.globalIgnores]
    : options.exclude;

  if (hasExplicitTargets && eslintResult.globalIgnores.length > 0) {
    resolvedTargets = resolveFiles(options.files, cwd, effectiveExclude);
  }

  const fileIndex = createFileIndex(projectRoot, effectiveExclude, log);
  if (log.isLevelEnabled(Level.Info)) log.info(`file index: ${fileIndex.solidFiles.size} solid, ${fileIndex.cssFiles.size} css`);

  const filesToLint = resolvedTargets ?? fileIndex.allFiles();

  if (log.isLevelEnabled(Level.Info)) log.info(`resolved ${filesToLint.length} files to lint`);

  if (!options.noDaemon) {
    const daemonResult = await tryDaemonLint(options, projectRoot, filesToLint, log);
    if (daemonResult !== null) {
      if (fileHandle !== undefined) await fileHandle.close();
      outputAndExit(daemonResult, options);
    }
    if (log.isLevelEnabled(Level.Info)) log.info("daemon unavailable, falling back to in-process analysis");
  }

  if (filesToLint.length === 0) {
    if (options.format === "json") {
      console.log("[]");
    } else {
      console.log("No files to lint.");
    }
    if (fileHandle !== undefined) await fileHandle.close();
    return process.exit(0);
  }

  const allDiagnostics: Diagnostic[] = [];

  /* Read CSS files once, build a content map for cross-file reuse. */
  const allCSSFiles = readCSSFilesFromDisk(fileIndex.cssFiles);
  const cssContentMap = new Map<string, string>();
  for (let i = 0, len = allCSSFiles.length; i < len; i++) {
    const cssFile = allCSSFiles[i];
    if (!cssFile) continue;
    cssContentMap.set(cssFile.path, cssFile.content);
  }

  if (log.isLevelEnabled(Level.Trace)) log.trace(`lint: read ${allCSSFiles.length} CSS files from disk, ${cssContentMap.size} in content map`);

  const tailwind = await resolveTailwindValidator(allCSSFiles).catch(() => null);
  if (log.isLevelEnabled(Level.Info)) log.info(`tailwind: ${tailwind !== null ? "resolved" : "not found"}`);

  const tLib = performance.now();
  const externalCustomProperties = scanDependencyCustomProperties(projectRoot);
  if (log.isLevelEnabled(Level.Info)) log.info(`library analysis: ${externalCustomProperties.size} external custom properties in ${(performance.now() - tLib).toFixed(0)}ms`);

  const tsconfigPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  if (!tsconfigPath) die(`No tsconfig.json found in ${projectRoot}`);

  /* Filter solid files (skip CSS — handled separately in cross-file). */
  const solidFilesToLint: string[] = [];
  for (let i = 0, len = filesToLint.length; i < len; i++) {
    const f = filesToLint[i];
    if (!f) continue;
    if (classifyFile(f) !== "css") solidFilesToLint.push(f);
  }

  /* All solid files in the project — used as rootNames for ts.createProgram
     when tsconfig doesn't include them (e.g. monorepo with `files: []`). */
  const allSolidFiles = Array.from(fileIndex.solidFiles);

  const WORKER_THRESHOLD = 20;
  const workerCount = options.maxWorkers > 0
    ? options.maxWorkers
    : defaultWorkerCount();
  const useWorkers = solidFilesToLint.length > WORKER_THRESHOLD && workerCount > 1;

  const t0 = performance.now();
  let serialBatch: ReturnType<typeof createBatchProgram> | undefined;
  /* Collected during serial analysis for cross-file reuse — avoids double graph build.
     Empty after parallel path (workers can't share ts.Node references across threads). */
  const solidGraphsForCrossFile: SolidGraph[] = [];

  if (useWorkers) {
    /* ── Parallel path: dispatch file chunks to worker threads ── */
    const chunks = partitionFiles(solidFilesToLint, workerCount);
    if (log.isLevelEnabled(Level.Info)) log.info(`dispatching ${solidFilesToLint.length} files to ${chunks.length} workers`);

    const pool = createWorkerPool(chunks.length);
    try {
      const tasks = chunks.map((files) => ({
        tsconfigPath,
        files,
        rootPath: projectRoot,
        overrides: eslintResult.overrides,
        accessibilityPolicy: options.accessibilityPolicy ?? null,
      }));

      /* Start building main-thread program concurrently while workers run.
         Workers are in separate threads so this synchronous call doesn't block them. */
      const workerPromise = pool.dispatch(tasks);

      if (options.crossFile) {
        serialBatch = createBatchProgram(projectRoot, allSolidFiles);
      }

      const workerResults = await workerPromise;

      for (let i = 0, len = workerResults.length; i < len; i++) {
        const wr = workerResults[i];
        if (!wr) continue;
        for (let j = 0, dLen = wr.diagnostics.length; j < dLen; j++) {
          const d = wr.diagnostics[j];
          if (!d) continue;
          allDiagnostics.push(d);
        }
      }
    } catch (err: unknown) {
      if (log.isLevelEnabled(Level.Warning)) log.warning(`worker error: ${err instanceof Error ? err.message : String(err)}, falling back to serial`);
      allDiagnostics.length = 0;
      serialBatch ??= createBatchProgram(projectRoot, allSolidFiles);
      runSerialAnalysis(serialBatch.program, solidFilesToLint, eslintResult.overrides, allDiagnostics, solidGraphsForCrossFile, log);
    } finally {
      await pool.terminate();
    }
  } else {
    /* ── Serial path: few files, no worker overhead ── */
    if (log.isLevelEnabled(Level.Info)) log.info(`serial analysis: ${solidFilesToLint.length} files`);
    serialBatch = createBatchProgram(projectRoot, allSolidFiles);
    runSerialAnalysis(serialBatch.program, solidFilesToLint, eslintResult.overrides, allDiagnostics, solidGraphsForCrossFile, log);
  }

  const t1 = performance.now();
  if (log.isLevelEnabled(Level.Info)) log.info(`single-file analysis: ${allDiagnostics.length} diagnostics in ${(t1 - t0).toFixed(0)}ms`);

  let exitCode = 0;
  try {
    if (options.crossFile) {
      /* Cross-file analysis builds all three graphs (Solid, CSS, Layout) on the
         main thread and calls runCrossFileRules directly — no intermediary Project
         or GraphCache version negotiation. The CLI owns the full pipeline. */
      const batch = serialBatch ?? createBatchProgram(projectRoot, allSolidFiles);
      const ownsBatch = serialBatch === undefined;
      const program = batch.program;

      /* 1. Collect SolidGraphs — reuse from serial path or rebuild after parallel path. */
      let solidGraphs: SolidGraph[];
      let solidGraphRebuilt = 0;
      if (solidGraphsForCrossFile.length > 0) {
        solidGraphs = solidGraphsForCrossFile;
      } else {
        solidGraphs = [];
        solidGraphRebuilt = allSolidFiles.length;
        if (log.isLevelEnabled(Level.Trace)) log.trace(`lint: building ${allSolidFiles.length} SolidGraphs for cross-file analysis`);
        for (let i = 0, len = allSolidFiles.length; i < len; i++) {
          const path = allSolidFiles[i];
          if (!path) continue;
          const key = canonicalPath(path);
          if (program.getSourceFile(key) === undefined) continue;
          const input = createSolidInput(key, program, log);
          solidGraphs.push(buildSolidGraph(input));
        }
      }
      if (log.isLevelEnabled(Level.Info)) log.info(`crossFile: rebuilt ${solidGraphRebuilt}/${solidGraphs.length} SolidGraphs`);

      /* 2. Build CSSGraph from pre-read CSS content map. */
      const cssFiles: { path: string; content: string }[] = [];
      for (const cssPath of fileIndex.cssFiles) {
        const content = cssContentMap.get(cssPath);
        if (content !== undefined) {
          cssFiles.push({ path: cssPath, content });
        } else {
          try {
            cssFiles.push({ path: cssPath, content: readFileSync(cssPath, "utf-8") });
          } catch { /* skip unreadable */ }
        }
      }
      const cssInput: CSSInput = buildCSSInputForLint(cssFiles, log, tailwind, externalCustomProperties);
      const cssGraph = buildCSSGraph(cssInput);

      /* 3. Build LayoutGraph from Solid + CSS graphs. */
      const layoutGraph = buildLayoutGraph(solidGraphs, cssGraph, log);

      /* 4. Run cross-file rules with override-aware emit. */
      const crossDiagnostics: Diagnostic[] = [];
      const crossRawEmit = (d: Diagnostic) => crossDiagnostics.push(d);
      const crossHasOverrides = Object.keys(eslintResult.overrides).length > 0;
      const crossEmit = crossHasOverrides ? createOverrideEmit(crossRawEmit, eslintResult.overrides) : crossRawEmit;
      runCrossFileRules(
        { solids: solidGraphs, css: cssGraph, layout: layoutGraph, logger: log },
        crossEmit,
        log,
      );

      /* 5. Collect cross-file diagnostics — filter to explicit targets if specified. */
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
        if (log.isLevelEnabled(Level.Info)) {
          const t2 = performance.now();
          log.info(`cross-file analysis: ${crossCount} diagnostics in ${(t2 - t1).toFixed(0)}ms`);
        }
      } else {
        for (let i = 0, len = crossDiagnostics.length; i < len; i++) {
          const cd = crossDiagnostics[i];
          if (!cd) continue;
          allDiagnostics.push(cd);
        }
        if (log.isLevelEnabled(Level.Info)) {
          const t2 = performance.now();
          log.info(`cross-file analysis: ${crossDiagnostics.length} diagnostics in ${(t2 - t1).toFixed(0)}ms`);
        }
      }

      /* Save .tsbuildinfo for future warm starts. The main thread is the
         sole writer — workers read but never write to avoid corruption. */
      batch.saveBuildInfo();
      if (ownsBatch) batch.dispose();
    }

    /* Sort diagnostics for deterministic output regardless of parallel execution order. */
    allDiagnostics.sort(compareDiagnostics);

    if (options.format === "json") {
      console.log(formatJSON(allDiagnostics));
    } else if (allDiagnostics.length > 0) {
      console.log(formatText(allDiagnostics, cwd));
    }

    const counts = countDiagnostics(allDiagnostics);
    if (log.isLevelEnabled(Level.Info)) log.info(`total: ${allDiagnostics.length} diagnostics (${counts.errors} errors, ${counts.warnings} warnings) in ${(performance.now() - t0).toFixed(0)}ms`);

    if (counts.errors > 0) {
      exitCode = 1;
    } else if (options.maxWarnings >= 0 && counts.warnings > options.maxWarnings) {
      if (options.format !== "json") {
        process.stderr.write(`\nganko: too many warnings (${counts.warnings}). Max allowed: ${options.maxWarnings}.\n`);
      }
      exitCode = 1;
    }

  } finally {
    /* Save .tsbuildinfo from the serial batch if cross-file didn't already
       save it (cross-file creates its own batch when parallel path was used). */
    if (serialBatch) {
      if (!options.crossFile) serialBatch.saveBuildInfo();
      serialBatch.dispose();
    }
    if (fileHandle !== undefined) await fileHandle.close();
  }

  process.exit(exitCode);
}

/* ── Helpers ── */

/**
 * Round-robin partition files into N chunks.
 * File analysis cost is dominated by graph building (~5-13ms per file),
 * which is roughly constant — round-robin gives even distribution.
 */
function partitionFiles(files: readonly string[], count: number): string[][] {
  const chunks: string[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f) continue;
    const chunk = chunks[i % count];
    if (!chunk) continue;
    chunk.push(f);
  }
  return chunks.filter((c) => c.length > 0);
}

/**
 * Serial single-file analysis. Builds SolidGraph per file, runs rules,
 * collects diagnostics, and accumulates graphs for cross-file reuse.
 */
function runSerialAnalysis(
  program: ts.Program,
  files: readonly string[],
  overrides: RuleOverrides,
  allDiagnostics: Diagnostic[],
  solidGraphsOut: SolidGraph[],
  log: Logger,
): void {
  const hasOverrides = Object.keys(overrides).length > 0;
  const fileDiags: Diagnostic[] = [];
  const rawEmit = (d: Diagnostic) => fileDiags.push(d);
  const emit = hasOverrides ? createOverrideEmit(rawEmit, overrides) : rawEmit;

  for (let i = 0, len = files.length; i < len; i++) {
    const path = files[i];
    if (!path) continue;
    const key = canonicalPath(path);

    const sourceFile = program.getSourceFile(key);
    if (!sourceFile) {
      if (log.isLevelEnabled(Level.Trace)) log.trace(`lint: skipping ${key} (not in program)`);
      continue;
    }

    if (log.isLevelEnabled(Level.Trace)) log.trace(`lint: analyzing file ${i + 1}/${files.length}: ${key}`);
    const input = createSolidInput(key, program, log);
    const graph = buildSolidGraph(input);
    solidGraphsOut.push(graph);

    fileDiags.length = 0;
    runSolidRules(graph, input.sourceFile, emit);
    if (log.isLevelEnabled(Level.Trace)) log.trace(`lint: ${key} → ${fileDiags.length} single-file diags`);
    for (let j = 0, dLen = fileDiags.length; j < dLen; j++) {
      const d = fileDiags[j];
      if (!d) continue;
      allDiagnostics.push(d);
    }
  }
}

/**
 * Build a CSSInput for the lint pipeline from pre-read CSS files.
 * Includes tailwind validator and external custom properties when available.
 */
function buildCSSInputForLint(
  cssFiles: readonly { path: string; content: string }[],
  log: Logger,
  tailwind: TailwindValidator | null,
  externalCustomProperties: ReadonlySet<string>,
): CSSInput {
  const input: { -readonly [K in keyof CSSInput]: CSSInput[K] } = { files: cssFiles, logger: log };
  if (tailwind !== null) input.tailwind = tailwind;
  if (externalCustomProperties.size > 0) input.externalCustomProperties = externalCustomProperties;
  return input;
}

/** Sort diagnostics by file, line, column, rule for deterministic output. */
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
