/**
 * SessionMutator — Produces new ServerSession snapshots from server state.
 *
 * Like Roslyn's Workspace.ApplyDocumentTextChanged(): reads from mutable
 * infrastructure (CompilationTracker, TsService, FileRegistry) and
 * produces an immutable session snapshot.
 *
 * Decoupled from LSP-specific types via ServerInfrastructure interface.
 * Both LSP (ServerContext) and daemon (DaemonState) implement it.
 */

import { mergeOverrides } from "../core/eslint-config";
import type { ServerSession, FrozenServerConfig, TsProgramState, WorkspaceState } from "./session";
import type { ServerConfig } from "./handlers/lifecycle";
import type { ServerInfrastructure } from "./server-infrastructure";

let nextSessionId = 1;

/**
 * Build an immutable FrozenServerConfig from a mutable ServerConfig.
 * ruleOverrides is derived from eslintOverrides + vscodeOverrides.
 */
export function freezeConfig(config: ServerConfig): Readonly<FrozenServerConfig> {
  return Object.freeze({
    vscodeOverrides: config.vscodeOverrides,
    eslintOverrides: config.eslintOverrides,
    ruleOverrides: config.ruleOverrides,
    useESLintConfig: config.useESLintConfig,
    eslintConfigPath: config.eslintConfigPath,
    exclude: config.exclude,
    eslintIgnores: config.eslintIgnores,
    enableTsDiagnostics: config.enableTsDiagnostics,
    warningsAsErrors: config.warningsAsErrors,
    vscodePolicy: config.vscodePolicy,
  });
}

/**
 * Merge a partial config update into a frozen config.
 * ruleOverrides is ALWAYS recomputed from eslint + vscode overrides.
 */
export function mergeServerConfig(
  current: Readonly<FrozenServerConfig>,
  update: Partial<Omit<FrozenServerConfig, "ruleOverrides">>,
): Readonly<FrozenServerConfig> {
  const next = { ...current, ...update };
  next.ruleOverrides = mergeOverrides(next.eslintOverrides, next.vscodeOverrides);
  return Object.freeze(next);
}

export interface SessionChangeResult {
  readonly session: ServerSession
  readonly affectedPaths: readonly string[]
}

/**
 * SessionMutator — the spec's interface, taking ServerInfrastructure.
 */
export class SessionMutator {
  get nextId(): number { return nextSessionId; }

  buildSession(infra: ServerInfrastructure): ServerSession {
    const rootPath = infra.getRootPath();
    if (!rootPath) throw new Error("buildSession called before rootPath is set");

    const project = infra.getProject();
    let tsProgram: TsProgramState;
    if (project) {
      tsProgram = { tier: "incremental", project };
    } else {
      tsProgram = { tier: "quick", compilerOptions: infra.getTsCompilerOptions() };
    }

    const registry = infra.getFileRegistry();
    const layout = infra.getWorkspaceLayout();
    let workspace: WorkspaceState;
    if (registry && layout) {
      workspace = {
        enriched: true,
        solidFiles: new Set(registry.solidFiles),
        cssFiles: new Set(registry.cssFiles),
        layout,
        tailwindValidator: infra.getTailwindValidator(),
        batchableValidator: infra.getBatchableValidator(),
        externalCustomProperties: infra.getExternalCustomProperties(),
        evaluator: infra.getEvaluator(),
      };
    } else {
      workspace = { enriched: false };
    }

    return {
      id: nextSessionId++,
      rootPath,
      config: freezeConfig(infra.getConfig()),
      compilation: infra.tracker.currentCompilation,
      tsProgram,
      workspace,
    };
  }
}
