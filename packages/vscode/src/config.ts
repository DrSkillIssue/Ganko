/**
 * Configuration reading and change handling.
 */
import { workspace, window, type ExtensionContext } from "vscode";
import { State, type LanguageClient } from "vscode-languageclient/node";
import type { LeveledLogger } from "./log";
import { parseLogLevel } from "@drskillissue/ganko-shared";
import type { ServerSettings, RuleOverrides, RuleSeverityOverride, AccessibilityPolicy, LogLevel, TraceLevel } from "@drskillissue/ganko-shared";
import { SEVERITY_LOOKUP } from "@drskillissue/ganko-shared";
import { RULES } from "@drskillissue/ganko/rules-manifest";

/**
 * Collect rule severity overrides from solid.rules.<id> settings.
 * Only includes rules that the user has explicitly changed from "default".
 */
function collectRuleOverrides(config: ReturnType<typeof workspace.getConfiguration>): RuleOverrides {
  const overrides: Record<string, RuleSeverityOverride> = {};
  for (const rule of RULES) {
    const value = config.get<string>(`rules.${rule.id}`);
    if (value && value !== "default") {
      const severity = SEVERITY_LOOKUP[value];
      if (severity) {
        overrides[rule.id] = severity;
      }
    }
  }
  return overrides;
}

/** Read VS Code settings into LSP initialization options. */
export function getInitializationOptions(): ServerSettings {
  const config = workspace.getConfiguration("solid");

  const logLevel: LogLevel = parseLogLevel(config.get<string>("logLevel", "info") ?? "info", "info");

  const result: { -readonly [K in keyof ServerSettings]: ServerSettings[K] } = {
    trace: config.get<TraceLevel>("trace.server", "off") ?? "off",
    logLevel,
    rules: collectRuleOverrides(config),
    useESLintConfig: config.get<boolean>("eslintConfig.enable", true) ?? true,
    accessibilityPolicy: config.get<AccessibilityPolicy>("accessibilityPolicy", "wcag-aa") ?? "wcag-aa",
    exclude: config.get<string[]>("exclude", []) ?? [],
  };
  const eslintConfigPath = config.get<string>("eslintConfig.path");
  if (eslintConfigPath !== undefined) result.eslintConfigPath = eslintConfigPath;
  return result;
}

/**
 * Register configuration change handler.
 *
 * If `solid.enable` is toggled, starts/stops the client.
 * Otherwise forwards settings to the running server.
 */
export function registerConfigHandler(
  context: ExtensionContext,
  log: LeveledLogger,
  getClient: () => LanguageClient | null,
  startClient: () => Promise<void>,
  stopClient: () => Promise<void>,
): void {
  context.subscriptions.push(
    workspace.onDidChangeConfiguration(async (e) => {
      if (!e.affectsConfiguration("solid")) return;

      if (e.affectsConfiguration("solid.logLevel")) {
        log.setLevel(parseLogLevel(
          workspace.getConfiguration("solid").get<string>("logLevel", "info") ?? "info", "info",
        ));
      }

      log.info("Configuration changed");

      const config = workspace.getConfiguration("solid");
      const enabled = config.get<boolean>("enable", true);
      const client = getClient();

      if (!enabled && client) {
        log.info("Extension disabled, stopping server...");
        await stopClient();
        return;
      }

      if (enabled && !client) {
        log.info("Extension enabled, starting server...");
        await startClient();
        return;
      }

      if (client && client.state === State.Running) {
        const settings = getInitializationOptions();
        client.sendNotification("workspace/didChangeConfiguration", {
          settings: { solid: settings },
        });
        log.info("Sent configuration update to server");

        if (e.affectsConfiguration("solid.exclude")) {
          window.showInformationMessage("Solid LSP: Exclude patterns updated. File index will rebuild.");
        } else if (e.affectsConfiguration("solid.rules")) {
          window.showInformationMessage("Solid LSP: Editor rule overrides updated. These apply to the editor only. To change rules for CLI/CI, update eslint.config.mjs.");
        } else if (e.affectsConfiguration("solid.eslintConfig")) {
          window.showInformationMessage("Solid LSP: ESLint config settings updated. Diagnostics will refresh automatically.");
        }
      }
    }),
  );
}
