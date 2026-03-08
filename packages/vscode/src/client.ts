/**
 * LanguageClient factory, lifecycle, and restart throttle.
 */
import { workspace, window, type ExtensionContext, type OutputChannel, type StatusBarItem } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
  State,
  type Message,
  ErrorAction,
  CloseAction,
  type ErrorHandlerResult,
  type CloseHandlerResult,
} from "vscode-languageclient/node";
import type { Logger } from "./log";
import { updateStatusBar } from "./status-bar";
import { getInitializationOptions } from "./config";
import { findServerModule } from "./server-path";
import { ALL_EXTENSIONS, extensionsToWatcherGlob } from "@drskillissue/ganko-shared";

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_COOLDOWN_MS = 5 * 60 * 1000;

interface ClientState {
  client: LanguageClient | null
  watcher: ReturnType<typeof workspace.createFileSystemWatcher> | null
  restartCount: number
  lastRestartTime: number
}

const state: ClientState = {
  client: null,
  watcher: null,
  restartCount: 0,
  lastRestartTime: 0,
};

/** Serializes lifecycle operations to prevent concurrent start/stop races. */
let lifecycleChain: Promise<void> = Promise.resolve();

function serializeLifecycle(fn: () => Promise<void>): Promise<void> {
  lifecycleChain = lifecycleChain.then(fn, fn);
  return lifecycleChain;
}

/** Get the current LanguageClient (or null if not running). */
export function getClient(): LanguageClient | null {
  return state.client;
}

/** Check if we should attempt a restart based on rate limiting. */
function shouldAttemptRestart(log: Logger): boolean {
  const now = Date.now();
  if (now - state.lastRestartTime > RESTART_COOLDOWN_MS) {
    state.restartCount = 0;
  }
  if (state.restartCount >= MAX_RESTART_ATTEMPTS) {
    log.error(`Maximum restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Please restart VS Code.`);
    return false;
  }
  return true;
}

/** Create a configured LanguageClient instance. */
function createClient(
  serverModule: string,
  outputChannel: OutputChannel,
  statusBar: StatusBarItem,
  log: Logger,
): LanguageClient {
  const config = workspace.getConfiguration("solid");
  const lspEnv = config.get<Record<string, string>>("lsp.env", {});

  const merged = { ...process.env, ...lspEnv };
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) env[key] = value;
  }

  const serverOptions: ServerOptions = {
    run: {
      command: "bun",
      args: ["run", serverModule],
      transport: TransportKind.stdio,
      options: { env },
    },
    debug: {
      command: "bun",
      args: ["run", "--inspect=6009", serverModule],
      transport: TransportKind.stdio,
      options: { env },
    },
  };

  const watcher = workspace.createFileSystemWatcher(extensionsToWatcherGlob(ALL_EXTENSIONS));
  state.watcher = watcher;

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "css" },
      { scheme: "file", language: "scss" },
      { scheme: "file", language: "sass" },
      { scheme: "file", language: "less" },
    ],
    synchronize: {
      fileEvents: watcher,
    },
    initializationOptions: getInitializationOptions(),
    outputChannel,
    traceOutputChannel: outputChannel,
    initializationFailedHandler: (error: Error): boolean => {
      log.error("Server initialization failed", error);
      updateStatusBar(statusBar, "error");
      window.showErrorMessage(`Solid LSP initialization failed: ${error.message}`);
      return false;
    },
    errorHandler: {
      error: (error: Error, _message: Message | undefined, count: number | undefined): ErrorHandlerResult => {
        log.error(`Client error (count: ${count ?? "unknown"})`, error);
        if (count !== undefined && count > 5) {
          return { action: ErrorAction.Shutdown };
        }
        return { action: ErrorAction.Continue };
      },
      closed: (): CloseHandlerResult => {
        log.warning("Server connection closed");
        updateStatusBar(statusBar, State.Stopped);
        if (shouldAttemptRestart(log)) {
          log.info("Attempting automatic restart...");
          state.restartCount++;
          state.lastRestartTime = Date.now();
          return { action: CloseAction.Restart };
        }
        return { action: CloseAction.DoNotRestart };
      },
    },
  };

  const client = new LanguageClient("solidLsp", "Solid Language Server", serverOptions, clientOptions);

  client.onDidChangeState((event) => {
    log.info(`Client state changed: ${State[event.oldState]} -> ${State[event.newState]}`);
    updateStatusBar(statusBar, event.newState);
    if (event.newState === State.Running) {
      state.restartCount = 0;
    }
  });

  return client;
}

/** Start the language client (internal — call via serialized wrapper). */
async function startClientInternal(
  context: ExtensionContext,
  outputChannel: OutputChannel,
  statusBar: StatusBarItem,
  log: Logger,
): Promise<void> {
  if (state.client) {
    log.warning("Client already exists, stopping first...");
    await stopClientInternal(log);
  }

  const serverModule = findServerModule(context.extensionPath);
  if (!serverModule) {
    log.error("Could not find ganko server. Make sure it's installed.");
    window.showErrorMessage("Solid LSP: Could not find ganko server. Make sure it's installed.");
    updateStatusBar(statusBar, "error");
    return;
  }

  log.info(`Found ganko at: ${serverModule}`);
  updateStatusBar(statusBar, "starting");

  try {
    state.client = createClient(serverModule, outputChannel, statusBar, log);
    log.info("Starting Solid LSP server...");
    await state.client.start();
    log.info("Solid LSP server started successfully");
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error("Failed to start server", error);
    updateStatusBar(statusBar, "error");
    window.showErrorMessage(`Solid LSP: Failed to start server - ${error.message}`);
    state.client = null;
  }
}

/** Start the language client (serialized). */
export function startClient(
  context: ExtensionContext,
  outputChannel: OutputChannel,
  statusBar: StatusBarItem,
  log: Logger,
): Promise<void> {
  return serializeLifecycle(() => startClientInternal(context, outputChannel, statusBar, log));
}

/** Stop the language client. */
async function stopClientInternal(log: Logger): Promise<void> {
  if (state.watcher) {
    state.watcher.dispose();
    state.watcher = null;
  }
  if (!state.client) return;
  log.info("Stopping Solid LSP server...");
  try {
    await state.client.stop();
    log.info("Server stopped");
  } catch (err) {
    log.error("Error stopping client", err instanceof Error ? err : new Error(String(err)));
  }
  state.client = null;
}

/** Stop the language client (serialized). */
export function stopClient(log: Logger): Promise<void> {
  return serializeLifecycle(() => stopClientInternal(log));
}

/** Restart the language client (resets throttle for manual restart, serialized). */
export function restartClient(
  context: ExtensionContext,
  outputChannel: OutputChannel,
  statusBar: StatusBarItem,
  log: Logger,
): Promise<void> {
  return serializeLifecycle(async () => {
    state.restartCount = 0;
    await stopClientInternal(log);
    await startClientInternal(context, outputChannel, statusBar, log);
  });
}
