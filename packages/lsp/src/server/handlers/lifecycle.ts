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

import { SolidPlugin, CSSPlugin, setActivePolicy, resolveTailwindValidator, scanDependencyCustomProperties } from "ganko";
import { canonicalPath, uriToPath, pathToUri, ServerSettingsSchema, type RuleOverrides, type ConfigurationChangePayload } from "@ganko/shared";
import { buildServerCapabilities } from "../capabilities";
import { createProject, type Project } from "../../core/project";
import { createFileIndex } from "../../core/file-index";
import { readCSSFilesFromDisk } from "../../core/analyze";
import { loadESLintConfig, mergeOverrides, EMPTY_ESLINT_RESULT } from "../../core/eslint-config";
import type { ServerContext } from "../connection";
import type { DocumentState } from "./document";
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

  if (options?.accessibilityPolicy) {
    setActivePolicy(options.accessibilityPolicy);
  }

  const capabilities = buildServerCapabilities();

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
 * Loads ESLint config (if enabled), merges overrides with VS Code settings,
 * creates the Project with SolidPlugin and CSSPlugin, and wires it into
 * the server context.
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
  if (state.rootPath && context) {
    const { log } = context;

    if (state.useESLintConfig) {
      const eslintResult = await loadESLintConfig(state.rootPath, state.eslintConfigPath)
        .catch((err: unknown) => {
          if (log.enabled) log.warning(`Failed to load ESLint config: ${err instanceof Error ? err.message : String(err)}`);
          return EMPTY_ESLINT_RESULT;
        });
      state.eslintOverrides = eslintResult.overrides;
      state.eslintIgnores = eslintResult.globalIgnores;
    }

    state.ruleOverrides = mergeOverrides(state.eslintOverrides, state.vscodeOverrides);

    const fileIndex = createFileIndex(state.rootPath, effectiveExclude(state));
    context.fileIndex = fileIndex;
    if (log.enabled) log.debug(`file index: ${fileIndex.solidFiles.size} solid, ${fileIndex.cssFiles.size} css`);

    /* Resolve Tailwind validator from CSS files (non-blocking — failure is fine). */
    if (fileIndex.cssFiles.size > 0) {
      const cssFiles = readCSSFilesFromDisk(fileIndex.cssFiles);
      context.tailwindValidator = await resolveTailwindValidator(cssFiles)
        .catch(() => null);
      if (log.enabled) log.debug(`tailwind validator: ${context.tailwindValidator !== null ? "resolved" : "not found"}`);
    }

    /* Library analysis: scan installed dependencies for CSS custom properties
       they inject at runtime (e.g., Kobalte's --kb-* properties set via inline
       style attributes in JSX). */
    const externalProps = scanDependencyCustomProperties(state.rootPath);
    if (externalProps.size > 0) {
      context.externalCustomProperties = externalProps;
      if (log.enabled) log.debug(`library analysis: ${externalProps.size} external custom properties`);
    }

    const project = createProject({
      rootPath: state.rootPath,
      plugins: [SolidPlugin, CSSPlugin],
      rules: state.ruleOverrides,
      log,
    });

    state.project = project;
    context.setProject(project);
    state.initialized = true;
    context.resolveReady();

    const eslintCount = Object.keys(state.eslintOverrides).length;
    const vscodeCount = Object.keys(state.vscodeOverrides).length;
    if (log.enabled) log.info(
      `Solid LSP ready (${eslintCount} ESLint overrides, ${vscodeCount} VS Code overrides, ${fileIndex.solidFiles.size} solid files, ${fileIndex.cssFiles.size} css files)`,
    );
  } else {
    state.initialized = true;
    context?.resolveReady();
    connection.console.log("Solid LSP ready (no workspace root)");
  }
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
 * Result of handleConfigurationChange indicating what action the caller
 * should take. `"none"` means nothing changed. `"rediagnose"` means
 * overrides changed synchronously. `"reload-eslint"` means the ESLint
 * config setting changed and must be re-read asynchronously before
 * re-diagnosing.
 */
export type ConfigChangeResult = "none" | "rediagnose" | "reload-eslint" | "rebuild-index";

export function handleConfigurationChange(
  payload: ConfigurationChangePayload,
  state: ServerState,
): ConfigChangeResult {
  const settings = payload?.settings?.solid;
  if (!settings) return "none";

  const eslintSettingChanged =
    settings.useESLintConfig !== state.useESLintConfig ||
    settings.eslintConfigPath !== state.eslintConfigPath;

  const excludeChanged = !arraysEqual(settings.exclude ?? [], state.exclude);

  state.vscodeOverrides = settings.rules;
  state.useESLintConfig = settings.useESLintConfig;
  state.eslintConfigPath = settings.eslintConfigPath;
  state.exclude = settings.exclude ?? [];
  setActivePolicy(settings.accessibilityPolicy);

  if (excludeChanged) return "rebuild-index";
  if (eslintSettingChanged) return "reload-eslint";

  const next = mergeOverrides(state.eslintOverrides, state.vscodeOverrides);
  return applyOverridesIfChanged(state, next) ? "rediagnose" : "none";
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

  const eslintResult = await loadESLintConfig(state.rootPath, state.eslintConfigPath)
    .catch((err: unknown) => {
      if (log.enabled) log.warning(`Failed to reload ESLint config: ${err instanceof Error ? err.message : String(err)}`);
      return EMPTY_ESLINT_RESULT;
    });

  const prevIgnores = state.eslintIgnores;
  state.eslintOverrides = eslintResult.overrides;
  state.eslintIgnores = eslintResult.globalIgnores;

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
