/**
 * Project - Plugin-agnostic project management for ganko
 *
 * Uses the runner architecture from ganko.
 * User configures which plugins to use.
 */
import { createRunner, type Runner, type Diagnostic, type Plugin } from "@drskillissue/ganko";
import type { RuleOverrides } from "@drskillissue/ganko-shared";
import type ts from "typescript";
import { createTypeScriptProjectService, type TypeScriptProjectService, type ProjectServiceOptions } from "./project-service";
import type { Logger } from "./logger";

/** Project configuration */
export interface ProjectConfig {
  /** Root directory containing tsconfig.json */
  readonly rootPath: string
  /** Plugins to run (user-configured) */
  readonly plugins: readonly Plugin<string>[]
  /** Rule severity overrides from user settings */
  readonly rules?: RuleOverrides
  /** Logger for diagnostics */
  readonly log?: Logger
}

/** Project state */
export interface Project {
  /** Run plugins on files and get diagnostics */
  run(files: readonly string[]): readonly Diagnostic[]

  /** Get TypeScript language service for cross-file features */
  getLanguageService(path: string): ts.LanguageService | null

  /** Get script version string for cache invalidation */
  getScriptVersion(path: string): string | null

  /** Update in-memory file content for unsaved buffers */
  updateFile(path: string, content: string): void

  /** Update plugins configuration */
  setPlugins(plugins: readonly Plugin<string>[]): void

  /** Update rule severity overrides. Takes effect on next run(). */
  setRuleOverrides(overrides: RuleOverrides): void

  /** Dispose resources */
  dispose(): void
}

/**
 * Create a project.
 */
export function createProject(config: ProjectConfig): Project {
  let runner: Runner = config.rules !== undefined
    ? createRunner({ plugins: config.plugins, rules: config.rules })
    : createRunner({ plugins: config.plugins });

  const tsOptions: ProjectServiceOptions = { tsconfigRootDir: config.rootPath };
  if (config.log !== undefined) tsOptions.log = config.log;
  const tsService: TypeScriptProjectService = createTypeScriptProjectService(tsOptions);

  return {
    run(files) {
      return runner.run(files);
    },

    getLanguageService(path) {
      return tsService.getLanguageServiceForFile(path);
    },

    getScriptVersion(path) {
      return tsService.getScriptVersionForFile(path);
    },

    updateFile(path, content) {
      tsService.updateFile(path, content);
    },

    setPlugins(plugins) {
      runner = createRunner({ plugins });
    },

    setRuleOverrides(overrides) {
      runner.setRuleOverrides(overrides);
    },

    dispose() {
      tsService.dispose();
    },
  };
}
