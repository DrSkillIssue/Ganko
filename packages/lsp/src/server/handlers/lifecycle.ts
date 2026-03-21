/**
 * Lifecycle Handlers
 *
 * Handles LSP lifecycle events: initialize, initialized, shutdown, exit.
 * On initialized, creates the Project using ganko plugins and
 * wires it into the FeatureHandlerContext for all handlers.
 */

import type {
  Connection,
  InitializeParams,
  InitializeResult,
  InitializedParams,
} from "vscode-languageserver";

import { SolidPlugin, CSSPlugin, setActivePolicy } from "@drskillissue/ganko";
import { pathToUri, projectRootFromUri, acceptProjectRoot, ServerSettingsSchema, Level, type RuleOverrides, type ConfigurationChangePayload, type AccessibilityPolicy } from "@drskillissue/ganko-shared";
import { buildServerCapabilities } from "../capabilities";
import { createProject, type Project } from "../../core/project";
import { runEnrichment } from "../../core/enrichment";
import { loadESLintConfig, mergeOverrides, EMPTY_ESLINT_RESULT } from "../../core/eslint-config";
import type { ServerContext } from "../connection";
import type { PhaseEnriched } from "../server-state";
import { publishFileDiagnostics, propagateTsDiagnostics } from "../diagnostics-push";
import type { Logger } from "../../core/logger";


export interface ServerConfig {
  vscodeOverrides: RuleOverrides
  eslintOverrides: RuleOverrides
  ruleOverrides: RuleOverrides
  useESLintConfig: boolean
  eslintConfigPath: string | undefined
  exclude: readonly string[]
  eslintIgnores: readonly string[]
  enableTsDiagnostics: boolean
  warningsAsErrors: boolean
  vscodePolicy: AccessibilityPolicy
}

export interface ServerState {
  rootUri: string | null
  rootPath: string | null
  initialized: boolean
  shuttingDown: boolean
  clientCapabilities: InitializeParams["capabilities"] | null
  project: Project | null
  readonly config: ServerConfig
}

/**
 * Create initial server state.
 *
 * @returns Empty server state
 */
export function createServerConfig(): ServerConfig {
  return {
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

export function createServerState(config?: ServerConfig): ServerState {
  return {
    rootUri: null,
    rootPath: null,
    initialized: false,
    shuttingDown: false,
    clientCapabilities: null,
    project: null,
    config: config ?? createServerConfig(),
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
    state.rootPath = projectRootFromUri(workspaceFolder.uri).path;
  } else if (params.rootUri) {
    state.rootUri = params.rootUri;
    state.rootPath = projectRootFromUri(params.rootUri).path;
  } else if (params.rootPath) {
    state.rootPath = acceptProjectRoot(params.rootPath).path;
    state.rootUri = pathToUri(state.rootPath);
  }

  state.clientCapabilities = params.capabilities;

  const parsed = ServerSettingsSchema.safeParse(params.initializationOptions);
  if (!parsed.success) {
    log.warning(`Invalid initialization options: ${parsed.error.message}`);
  }
  const options = parsed.success ? parsed.data : undefined;
  state.config.vscodeOverrides = options?.rules ?? {};
  state.config.useESLintConfig = options?.useESLintConfig ?? true;
  state.config.eslintConfigPath = options?.eslintConfigPath;
  state.config.exclude = options?.exclude ?? [];
  state.config.enableTsDiagnostics = options?.enableTypeScriptDiagnostics ?? state.config.enableTsDiagnostics;

  state.config.vscodePolicy = options?.accessibilityPolicy ?? "wcag-aa";
  setActivePolicy(state.config.vscodePolicy);

  const capabilities = buildServerCapabilities(state.config.warningsAsErrors);

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

  if (state.config.useESLintConfig) {
    const eslintResult = await loadESLintConfig(rootPath, state.config.eslintConfigPath, log)
      .catch((err: unknown) => {
        if (log.isLevelEnabled(Level.Warning)) log.warning(`Failed to load ESLint config: ${err instanceof Error ? err.message : String(err)}`);
        return EMPTY_ESLINT_RESULT;
      });
    state.config.eslintOverrides = eslintResult.overrides;
    state.config.eslintIgnores = eslintResult.globalIgnores;
    state.config.ruleOverrides = mergeOverrides(state.config.eslintOverrides, state.config.vscodeOverrides);
  }

  const project = createProject({
    rootPath,
    plugins: [SolidPlugin, CSSPlugin],
    rules: state.config.ruleOverrides,
    log,
  });

  state.project = project;
  const handlerCtx = context.setProject(project);
  state.initialized = true;
  context.resolveReady();

  if (log.isLevelEnabled(Level.Info)) log.info("Phase A: project created, ready gate resolved (Tier 1 active)");

  /* ── Phase B: Full program build — re-diagnose with full TypeChecker ──
     The IncrementalTypeScriptService defers createProgram by one event loop
     tick via setImmediate. This allows any didOpen events queued during the
     initialization handshake to get Tier 1 treatment before the 3-8s
     synchronous program build blocks the event loop. */

  await project.watchProgramReady();
  context.phase = { tag: "running", project, handlerCtx };

  if (log.isLevelEnabled(Level.Info)) log.info("Phase B: full program ready (Tier 2 active)");

  /* Re-diagnose open files with full program (no cross-file yet — workspace
     enrichment hasn't run). */
  const openPaths = context.docManager.openPaths() as string[];
  for (let i = 0, len = openPaths.length; i < len; i++) {
    const p = openPaths[i];
    if (!p) continue;
    publishFileDiagnostics(context, project, p, undefined, false);
  }

  /* ── Phase C: Workspace enrichment (file index, Tailwind, cross-file) ── */

  const enrichment = await runEnrichment(rootPath, effectiveExclude(state), {
    graphCache: context.graphCache,
    diagCache: context.diagCache,
    log,
  });
  const enrichedPhase: PhaseEnriched = {
    tag: "enriched",
    project,
    handlerCtx,
    registry: enrichment.registry,
    layout: enrichment.layout,
    tailwindValidator: enrichment.tailwindValidator,
    externalCustomProperties: enrichment.externalCustomProperties,
    changePipeline: enrichment.changePipeline,
    tailwindState: enrichment.tailwindState,
    evaluator: enrichment.evaluator,
    batchableValidator: enrichment.batchableValidator,
  };
  context.phase = enrichedPhase;

  /* Invalidate any cross-file results that may have been cached during the
     enrichment window. Even though fileIndex is set atomically after tailwind
     resolves, belt-and-suspenders: force the re-diagnosis loop to rebuild
     cross-file results with the fully-enriched context. */
  context.graphCache.invalidateAll();

  if (log.isLevelEnabled(Level.Info)) log.info("Phase C: workspace enrichment complete (Tier 3 active)");

  /* Re-diagnose ALL currently open files with cross-file results.
     Recapture open paths — files may have been opened during Phase B→C
     (5-10s of async work). Using the stale Phase B snapshot would miss
     any file opened after line 218, leaving it with single-file-only
     diagnostics permanently. */
  const currentOpenPaths = context.docManager.openPaths() as string[];
  for (let i = 0, len = currentOpenPaths.length; i < len; i++) {
    const p = currentOpenPaths[i];
    if (!p) continue;
    publishFileDiagnostics(context, project, p);
  }

  propagateTsDiagnostics(context, project, new Set());
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
  log: Logger,
  context?: ServerContext,
): void {
  state.shuttingDown = true;

  if (context) {
    context.docManager.flush();
    context.tsPropagationCancel?.();
    context.tsPropagationCancel = null;
    context.phase = { tag: "shutdown" };
  }

  if (state.project) {
    state.project.dispose();
    state.project = null;
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
    settings.useESLintConfig !== state.config.useESLintConfig ||
    settings.eslintConfigPath !== state.config.eslintConfigPath;

  const excludeChanged = !arraysEqual(settings.exclude ?? [], state.config.exclude);
  const tsDiagsChanged = (settings.enableTypeScriptDiagnostics ?? false) !== state.config.enableTsDiagnostics;

  state.config.vscodeOverrides = settings.rules;
  state.config.useESLintConfig = settings.useESLintConfig;
  state.config.eslintConfigPath = settings.eslintConfigPath;
  state.config.exclude = settings.exclude ?? [];
  state.config.enableTsDiagnostics = settings.enableTypeScriptDiagnostics ?? false;
  state.config.vscodePolicy = settings.accessibilityPolicy;
  setActivePolicy(settings.accessibilityPolicy);

  const next = mergeOverrides(state.config.eslintOverrides, state.config.vscodeOverrides);
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
  if (!state.config.useESLintConfig || !state.rootPath) return noChange;

  const eslintResult = await loadESLintConfig(state.rootPath, state.config.eslintConfigPath, log)
    .catch((err: unknown) => {
      if (log.isLevelEnabled(Level.Warning)) log.warning(`Failed to reload ESLint config: ${err instanceof Error ? err.message : String(err)}`);
      return EMPTY_ESLINT_RESULT;
    });

  const prevIgnores = state.config.eslintIgnores;
  state.config.eslintOverrides = eslintResult.overrides;
  state.config.eslintIgnores = eslintResult.globalIgnores;
  setActivePolicy(state.config.vscodePolicy);

  const next = mergeOverrides(eslintResult.overrides, state.config.vscodeOverrides);
  const overridesChanged = applyOverridesIfChanged(state, next);
  const ignoresChanged = !arraysEqual(prevIgnores, eslintResult.globalIgnores);

  if (overridesChanged || ignoresChanged) {
    if (log.isLevelEnabled(Level.Info)) log.info(`Reloaded ESLint config (${Object.keys(eslintResult.overrides).length} overrides, ${eslintResult.globalIgnores.length} global ignores)`);
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
  const prev = state.config.ruleOverrides;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);

  if (prevKeys.length === nextKeys.length) {
    let same = true;
    for (const key of nextKeys) {
      if (prev[key] !== next[key]) { same = false; break; }
    }
    if (same) return false;
  }

  state.config.ruleOverrides = next;
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
  if (state.config.eslintIgnores.length === 0) return state.config.exclude;
  return [...state.config.exclude, ...state.config.eslintIgnores];
}
