/**
 * Lifecycle Handlers
 *
 * Handles LSP lifecycle events: initialize, initialized, shutdown, exit.
 * On initialized, creates the Project using ganko plugins and
 * wires it into the HandlerContext for all handlers.
 */

import type {
  Connection,
  InitializeParams,
  InitializeResult,
  InitializedParams,
} from "vscode-languageserver";

import { SolidPlugin, CSSPlugin, setActivePolicy, resolveTailwindValidator, scanDependencyCustomProperties } from "@drskillissue/ganko";
import { canonicalPath, uriToPath, pathToUri, ServerSettingsSchema, type RuleOverrides, type ConfigurationChangePayload, type AccessibilityPolicy } from "@drskillissue/ganko-shared";
import { buildServerCapabilities } from "../capabilities";
import { createProject, type Project } from "../../core/project";
import { createFileIndex } from "../../core/file-index";
import { readCSSFilesFromDisk } from "../../core/analyze";
import { loadESLintConfig, mergeOverrides, EMPTY_ESLINT_RESULT } from "../../core/eslint-config";
import type { ServerContext } from "../connection";
import { publishFileDiagnostics, propagateTsDiagnostics } from "../diagnostics-push";
import { type DocumentState, getOpenDocumentPaths } from "./document";
import type { Logger } from "../../core/logger";


/**
 * Server state tracked during lifecycle.
 */
export interface ServerState {
  /** Root URI of the workspace */
  rootUri: string | null
  /** Root path of the workspace */
  rootPath: string | null
  /** Whether server is fully ready */
  initialized: boolean
  /** Whether server is shutting down */
  shuttingDown: boolean
  /** Capabilities negotiated with client */
  clientCapabilities: InitializeParams["capabilities"] | null
  /** Active Project instance */
  project: Project | null
  /** Rule severity overrides from VS Code settings */
  vscodeOverrides: RuleOverrides
  /** Rule severity overrides from ESLint config file */
  eslintOverrides: RuleOverrides
  /** Merged overrides (VS Code wins over ESLint config) applied to the runner */
  ruleOverrides: RuleOverrides
  /** Whether to read rules from ESLint config */
  useESLintConfig: boolean
  /** User-specified ESLint config path */
  eslintConfigPath: string | undefined
  /** Glob patterns to exclude from file indexing and analysis */
  exclude: readonly string[]
  /** Global ignore patterns extracted from ESLint config file */
  eslintIgnores: readonly string[]
  /** Whether TypeScript diagnostics are enabled */
  enableTsDiagnostics: boolean
  /** Promote all warning-severity diagnostics to errors in LSP output */
  warningsAsErrors: boolean
  /** Accessibility policy from VS Code settings (wins over ESLint config) */
  vscodePolicy: AccessibilityPolicy
}

/**
 * Create initial server state.
 *
 * @returns Empty server state
 */
export function createServerState(): ServerState {
  return {
    rootUri: null,
    rootPath: null,
    initialized: false,
    shuttingDown: false,
    clientCapabilities: null,
    project: null,
    vscodeOverrides: {},
    eslintOverrides: {},
    ruleOverrides: {},
    useESLintConfig: true,
    eslintConfigPath: undefined,
    exclude: [],
    eslintIgnores: [],
    enableTsDiagnostics: false,
    warningsAsErrors: false,
    vscodePolicy: "wcag-aa",
  };
}

/**
 * Handle onInitialize request.
 *
 * Validates initialization options via Zod schema, extracts workspace
 * root from the first workspace folder / rootUri / rootPath, and
 * returns negotiated capabilities.
 *
 * @param params - Initialize params from client
 * @param state - Server state to update
 * @param log - Logger for validation warnings
 * @returns Result with server capabilities
 */
export function handleInitialize(
  params: InitializeParams,
  state: ServerState,
  log: Logger,
): InitializeResult {
  const workspaceFolder = params.workspaceFolders?.[0];
  if (workspaceFolder) {
    state.rootUri = workspaceFolder.uri;
    state.rootPath = uriToPath(workspaceFolder.uri);
  } else if (params.rootUri) {
    state.rootUri = params.rootUri;
    state.rootPath = uriToPath(params.rootUri);
  } else if (params.rootPath) {
    state.rootPath = canonicalPath(params.rootPath);
    state.rootUri = pathToUri(state.rootPath);
  }

  state.clientCapabilities = params.capabilities;

  const parsed = ServerSettingsSchema.safeParse(params.initializationOptions);
  if (!parsed.success) {
    log.warning(`Invalid initialization options: ${parsed.error.message}`);
  }
  const options = parsed.success ? parsed.data : undefined;
  state.vscodeOverrides = options?.rules ?? {};
  state.useESLintConfig = options?.useESLintConfig ?? true;
  state.eslintConfigPath = options?.eslintConfigPath;
  state.exclude = options?.exclude ?? [];
  state.enableTsDiagnostics = options?.enableTypeScriptDiagnostics ?? state.enableTsDiagnostics;

  state.vscodePolicy = options?.accessibilityPolicy ?? "wcag-aa";
  setActivePolicy(state.vscodePolicy);

  const capabilities = buildServerCapabilities(state.warningsAsErrors);

  return {
    capabilities,
    serverInfo: {
      name: "ganko",
      version: "0.1.0",
    },
  };
}

/**
 * Handle initialized notification from client.
 *
 * Three-phase startup for progressive diagnostic delivery:
 *
 * Phase A (<200ms): Load ESLint config, create Project, resolve readiness gate.
 *   Tier 1 single-file diagnostics become available immediately via didOpen.
 *
 * Phase B (3-8s): Wait for the full TypeScript program build to complete.
 *   Re-diagnose all open files with the full TypeChecker (Tier 2).
 *
 * Phase C (5-10s): Workspace enrichment — file index, Tailwind, library
 *   analysis, cross-file diagnostics. Re-diagnose with Tier 3.
 *
 * @param _params - Initialized params (unused)
 * @param state - Server state to update
 * @param connection - LSP connection for logging
 * @param context - Server context for project wiring
 */
export async function handleInitialized(
  _params: InitializedParams,
  state: ServerState,
  connection: Connection,
  context?: ServerContext,
): Promise<void> {
  if (!state.rootPath || !context) {
    state.initialized = true;
    context?.resolveReady();
    connection.console.log("Solid LSP ready (no workspace root)");
    return;
  }

  const { log } = context;
  const rootPath = state.rootPath;

  /* ── Phase A: Fast startup — ESLint config, create project, resolve ready ──
     ESLint config is loaded BEFORE resolveReady so Tier 1 diagnostics have
     rule overrides applied. Without this, Tier 1 diagnostics would run
     without overrides, then flicker when Tier 3 applies them. */

  if (state.useESLintConfig) {
    const eslintResult = await loadESLintConfig(rootPath, state.eslintConfigPath, log)
      .catch((err: unknown) => {
        if (log.enabled) log.warning(`Failed to load ESLint config: ${err instanceof Error ? err.message : String(err)}`);
        return EMPTY_ESLINT_RESULT;
      });
    state.eslintOverrides = eslintResult.overrides;
    state.eslintIgnores = eslintResult.globalIgnores;
    state.ruleOverrides = mergeOverrides(state.eslintOverrides, state.vscodeOverrides);
  }

  const project = createProject({
    rootPath,
    plugins: [SolidPlugin, CSSPlugin],
    rules: state.ruleOverrides,
    log,
  });

  state.project = project;
  context.setProject(project);
  state.initialized = true;
  context.resolveReady();

  if (log.enabled) log.info("Phase A: project created, ready gate resolved (Tier 1 active)");

  /* ── Phase B: Full program build — re-diagnose with full TypeChecker ──
     The IncrementalTypeScriptService defers createProgram by one event loop
     tick via setImmediate. This allows any didOpen events queued during the
     initialization handshake to get Tier 1 treatment before the 3-8s
     synchronous program build blocks the event loop. */

  await project.watchProgramReady();
  context.watchProgramReady = true;

  if (log.enabled) log.info("Phase B: full program ready (Tier 2 active)");

  /* Re-diagnose open files with full program (no cross-file yet — workspace
     enrichment hasn't run). */
  const openPaths = getOpenDocumentPaths(context.documentState);
  for (let i = 0, len = openPaths.length; i < len; i++) {
    const p = openPaths[i];
    if (!p) continue;
    publishFileDiagnostics(context, project, p, undefined, false);
  }

  /* ── Phase C: Workspace enrichment (file index, Tailwind, cross-file) ── */

  await enrichWorkspace(rootPath, state, context);
  context.workspaceReady = true;

  /* Invalidate any cross-file results that may have been cached during the
     enrichment window. Even though fileIndex is set atomically after tailwind
     resolves, belt-and-suspenders: force the re-diagnosis loop to rebuild
     cross-file results with the fully-enriched context. */
  context.graphCache.invalidateAll();

  if (log.enabled) log.info("Phase C: workspace enrichment complete (Tier 3 active)");

  /* Re-diagnose ALL currently open files with cross-file results.
     Recapture open paths — files may have been opened during Phase B→C
     (5-10s of async work). Using the stale Phase B snapshot would miss
     any file opened after line 218, leaving it with single-file-only
     diagnostics permanently. */
  const currentOpenPaths = getOpenDocumentPaths(context.documentState);
  for (let i = 0, len = currentOpenPaths.length; i < len; i++) {
    const p = currentOpenPaths[i];
    if (!p) continue;
    publishFileDiagnostics(context, project, p);
  }

  propagateTsDiagnostics(context, project, new Set());
}

/**
 * Workspace enrichment: file index, Tailwind validator, library analysis.
 *
 * Runs as Phase C of handleInitialized, after the full TypeScript program
 * is available. These operations are needed for cross-file diagnostics
 * but not for single-file Tier 1/2 analysis.
 */
async function enrichWorkspace(
  rootPath: string,
  state: ServerState,
  context: ServerContext,
): Promise<void> {
  const { log } = context;

  /* File index — uses ESLint ignores loaded in Phase A.
     Built first but NOT exposed on context until all enrichment (Tailwind,
     external props) is complete. Otherwise a didOpen event firing between
     fileIndex assignment and tailwind resolution runs cross-file analysis
     with a null tailwind validator, caches the wrong results, and the stale
     cache persists even after tailwind resolves. */
  const fileIndex = createFileIndex(rootPath, effectiveExclude(state), log);
  if (log.enabled) log.info(`file index: ${fileIndex.solidFiles.size} solid, ${fileIndex.cssFiles.size} css`);

  /* Resolve Tailwind validator from CSS files (non-blocking — failure is fine). */
  if (fileIndex.cssFiles.size > 0) {
    const cssFiles = readCSSFilesFromDisk(fileIndex.cssFiles);
    context.tailwindValidator = await resolveTailwindValidator(cssFiles)
      .catch(() => null);
    if (log.enabled) log.info(`tailwind validator: ${context.tailwindValidator !== null ? "resolved" : "not found"}`);
  }

  /* Library analysis: scan installed dependencies for CSS custom properties
     they inject at runtime (e.g., Kobalte's --kb-* properties set via inline
     style attributes in JSX). */
  const externalProps = scanDependencyCustomProperties(rootPath);
  if (externalProps.size > 0) {
    context.externalCustomProperties = externalProps;
    if (log.enabled) log.debug(`library analysis: ${externalProps.size} external custom properties`);
  }

  /* NOW expose the file index — all enrichment is complete, so any cross-file
     analysis triggered by concurrent didOpen events will see both the file
     index AND the resolved tailwind validator atomically. */
  context.fileIndex = fileIndex;
}

/**
 * Handle shutdown request.
 *
 * @param state - Server state to update
 * @param documentState - Document state (to clear pending timers)
 * @param log - Logger instance
 */
export function handleShutdown(
  state: ServerState,
  documentState: DocumentState,
  log: Logger,
  context?: ServerContext,
): void {
  state.shuttingDown = true;

  if (documentState.debounceTimer !== null) {
    clearTimeout(documentState.debounceTimer);
    documentState.debounceTimer = null;
  }

  if (state.project) {
    state.project.dispose();
    state.project = null;
  }

  /* Null out context references so that any in-flight debounce callback
     (setTimeout that fired before clearTimeout ran) finds a null project
     and exits harmlessly. */
  if (context) {
    context.tsPropagationCancel?.();
    context.tsPropagationCancel = null;
    context.project = null;
    context.handlerCtx = null;
  }

  log.info("Solid LSP shutting down");
}

/**
 * Handle exit notification.
 *
 * @param state - Server state to check
 * @returns Exit code (0 for clean shutdown, 1 otherwise)
 */
export function handleExit(state: ServerState): number {
  return state.shuttingDown ? 0 : 1;
}

/**
 * Handle workspace/didChangeConfiguration notification.
 *
 * Extracts rule overrides from the typed settings payload and pushes
 * them to the active project. Returns true if overrides changed
 * (caller should re-diagnose open files).
 *
 * @param payload - Typed configuration change payload from client
 * @param state - Server state
 * @returns Whether rule overrides changed
 */
/**
 * Structured result from handleConfigurationChange. Each flag is independent —
 * multiple actions can be required by a single settings update. The caller
 * evaluates all flags without early returns.
 */
export interface ConfigChangeResult {
  readonly rebuildIndex: boolean
  readonly reloadEslint: boolean
  readonly rediagnose: boolean
}

const NO_CHANGE: ConfigChangeResult = { rebuildIndex: false, reloadEslint: false, rediagnose: false };

export function handleConfigurationChange(
  payload: ConfigurationChangePayload,
  state: ServerState,
): ConfigChangeResult {
  const settings = payload?.settings?.solid;
  if (!settings) return NO_CHANGE;

  const eslintSettingChanged =
    settings.useESLintConfig !== state.useESLintConfig ||
    settings.eslintConfigPath !== state.eslintConfigPath;

  const excludeChanged = !arraysEqual(settings.exclude ?? [], state.exclude);
  const tsDiagsChanged = (settings.enableTypeScriptDiagnostics ?? false) !== state.enableTsDiagnostics;

  state.vscodeOverrides = settings.rules;
  state.useESLintConfig = settings.useESLintConfig;
  state.eslintConfigPath = settings.eslintConfigPath;
  state.exclude = settings.exclude ?? [];
  state.enableTsDiagnostics = settings.enableTypeScriptDiagnostics ?? false;
  state.vscodePolicy = settings.accessibilityPolicy;
  setActivePolicy(settings.accessibilityPolicy);

  const next = mergeOverrides(state.eslintOverrides, state.vscodeOverrides);
  const overridesChanged = applyOverridesIfChanged(state, next);

  return {
    rebuildIndex: excludeChanged,
    reloadEslint: eslintSettingChanged,
    rediagnose: overridesChanged || tsDiagsChanged,
  };
}

/**
 * Shallow equality check for string arrays.
 */
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0, len = a.length; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Outcome of reloading ESLint config — signals what changed for the caller. */
export interface ESLintReloadOutcome {
  readonly overridesChanged: boolean
  readonly ignoresChanged: boolean
}

/**
 * Reload ESLint config and update rule overrides and global ignores.
 *
 * Called when ESLint config file changes on disk. Re-reads the config,
 * re-merges with VS Code overrides, pushes to the runner, and detects
 * whether global ignore patterns changed (caller must rebuild file index).
 *
 * @param state - Server state
 * @param log - Logger instance
 * @returns What changed — caller should rebuild file index if ignores changed, re-diagnose if either changed
 */
export async function reloadESLintConfig(
  state: ServerState,
  log: Logger,
): Promise<ESLintReloadOutcome> {
  const noChange: ESLintReloadOutcome = { overridesChanged: false, ignoresChanged: false };
  if (!state.useESLintConfig || !state.rootPath) return noChange;

  const eslintResult = await loadESLintConfig(state.rootPath, state.eslintConfigPath, log)
    .catch((err: unknown) => {
      if (log.enabled) log.warning(`Failed to reload ESLint config: ${err instanceof Error ? err.message : String(err)}`);
      return EMPTY_ESLINT_RESULT;
    });

  const prevIgnores = state.eslintIgnores;
  state.eslintOverrides = eslintResult.overrides;
  state.eslintIgnores = eslintResult.globalIgnores;
  setActivePolicy(state.vscodePolicy);

  const next = mergeOverrides(eslintResult.overrides, state.vscodeOverrides);
  const overridesChanged = applyOverridesIfChanged(state, next);
  const ignoresChanged = !arraysEqual(prevIgnores, eslintResult.globalIgnores);

  if (overridesChanged || ignoresChanged) {
    if (log.enabled) log.info(`Reloaded ESLint config (${Object.keys(eslintResult.overrides).length} overrides, ${eslintResult.globalIgnores.length} global ignores)`);
  }

  return { overridesChanged, ignoresChanged };
}

/**
 * Apply new merged overrides if they differ from current.
 *
 * Performs a shallow key-count + value equality check. If changed,
 * updates `state.ruleOverrides` and pushes to the active project.
 *
 * @param state - Server state to update
 * @param next - New merged overrides
 * @returns Whether overrides actually changed
 */
function applyOverridesIfChanged(state: ServerState, next: RuleOverrides): boolean {
  const prev = state.ruleOverrides;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  if (prevKeys.length === nextKeys.length) {
    let same = true;
    for (const key of nextKeys) {
      if (prev[key] !== next[key]) { same = false; break; }
    }
    if (same) return false;
  }

  state.ruleOverrides = next;
  state.project?.setRuleOverrides(next);
  return true;
}

/**
 * Check if server is ready to handle requests.
 *
 * @param state - Server state
 * @returns True if ready
 */
export function isServerReady(state: ServerState): boolean {
  return state.initialized && !state.shuttingDown;
}

/**
 * Compute the effective exclude list by merging user-configured excludes
 * with ESLint global ignore patterns.
 *
 * @param state - Server state containing both exclude sources
 * @returns Combined exclude patterns (user excludes + eslint ignores)
 */
export function effectiveExclude(state: ServerState): readonly string[] {
  if (state.eslintIgnores.length === 0) return state.exclude;
  return [...state.exclude, ...state.eslintIgnores];
}
