/**
 * Command registration.
 *
 * Each command is a one-liner delegating to the appropriate module.
 */
import { window, commands, type ExtensionContext, type LogOutputChannel } from "vscode";
import type { Logger } from "./log";
import type { LanguageClient } from "vscode-languageclient/node";
import { showReactiveGraph } from "./reactive-graph";
import type { MemoryUsageResult } from "./protocol";

/** Register all extension commands. */
export function registerCommands(
  context: ExtensionContext,
  log: Logger,
  outputChannel: LogOutputChannel,
  getClient: () => LanguageClient | null,
  restartClient: () => Promise<void>,
): void {
  context.subscriptions.push(
    commands.registerCommand("solid.restartServer", async () => {
      log.info("Restart server command invoked");
      await restartClient();
      if (getClient()) {
        window.showInformationMessage("Solid LSP: Server restarted");
      }
    }),
  );

  context.subscriptions.push(
    commands.registerCommand("solid.showReactiveGraph", async () => {
      log.info("Show reactive graph command invoked");
      await showReactiveGraph(context, getClient(), log);
    }),
  );

  context.subscriptions.push(
    commands.registerCommand("solid.showOutput", () => {
      outputChannel.show();
    }),
  );

  context.subscriptions.push(
    commands.registerCommand("solid.showMemoryUsage", async () => {
      const client = getClient();
      if (!client) {
        window.showWarningMessage("Solid LSP: Server is not running");
        return;
      }
      try {
        const result: MemoryUsageResult = await client.sendRequest("solid/memoryUsage");
        const objPart = result.objectCount >= 0 ? `\nObjects: ${result.objectCount}` : "";
        window.showInformationMessage(
          `Solid LSP Memory\nHeap: ${result.heapUsedMB}/${result.heapTotalMB} MB\nRSS: ${result.rssMB} MB\nExternal: ${result.externalMB} MB${objPart}\nUptime: ${result.uptimeMinutes} min`,
        );
      } catch (e) {
        log.error(`Failed to get memory usage: ${e instanceof Error ? e.message : String(e)}`);
        window.showErrorMessage("Solid LSP: Failed to get memory usage");
      }
    }),
  );
}
