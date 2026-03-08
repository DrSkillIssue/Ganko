/**
 * VS Code extension entry point.
 *
 * Pure orchestration — creates dependencies, wires modules, manages lifecycle.
 */
import { type ExtensionContext, workspace, window } from "vscode";
import { type LeveledLogger, createLogger } from "./log";
import { noopLogger, parseLogLevel } from "@drskillissue/ganko-shared";
import { createStatusBar } from "./status-bar";
import { getClient, startClient, stopClient, restartClient } from "./client";
import { registerConfigHandler } from "./config";
import { registerCommands } from "./commands";

/** Stored for use in deactivate() where no context is available. */
const module: { log: LeveledLogger | null } = { log: null };

export async function activate(context: ExtensionContext): Promise<void> {
  const outputChannel = window.createOutputChannel("Solid Language Server");
  context.subscriptions.push(outputChannel);

  const log = createLogger(outputChannel, parseLogLevel(
    workspace.getConfiguration("solid").get<string>("logLevel") ?? "info", "info",
  ));
  module.log = log;

  log.info("Activating Solid.js extension...");
  log.info(`Extension path: ${context.extensionPath}`);
  log.info(`Workspace folders: ${workspace.workspaceFolders?.map((f) => f.uri.fsPath).join(", ") ?? "none"}`);

  const statusBar = createStatusBar(context);

  const start = () => startClient(context, outputChannel, statusBar, log);
  const stop = () => stopClient(log);
  const restart = () => restartClient(context, outputChannel, statusBar, log);

  /* Register commands and config handler BEFORE the enable check.
     Without this, disabling the extension via solid.enable = false skips
     registration, making commands throw "not found" and preventing
     re-enable without restarting VS Code. */
  registerCommands(context, log, outputChannel, getClient, restart);
  registerConfigHandler(context, log, getClient, start, stop);

  context.subscriptions.push(
    workspace.onDidChangeWorkspaceFolders(async (e) => {
      log.info(`Workspace folders changed: +${e.added.length}, -${e.removed.length}`);
      if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
        log.info("No workspace folders remaining, stopping server...");
        await stop();
        return;
      }
      if (e.added.length > 0 || e.removed.length > 0) {
        log.info("Workspace folders changed, restarting server...");
        await restart();
      }
    }),
  );

  const config = workspace.getConfiguration("solid");
  if (!config.get<boolean>("enable", true)) {
    log.info("Extension is disabled via configuration");
    return;
  }

  await start();
  log.info("Extension activation complete");
}

export async function deactivate(): Promise<void> {
  const log = module.log ?? noopLogger;
  log.info("Deactivating Solid.js extension...");
  try {
    await stopClient(log);
  } catch (err) {
    log.error("Error during deactivation", err instanceof Error ? err : new Error(String(err)));
  }
  module.log = null;
}
