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

  /** Get the current TypeScript program for a file. */
  getProgram(path: string): ts.Program | null

  /** Warm the TypeScript program for the containing project. */
  warmProgram(path: string, content?: string): ts.Program | null

  /** Get TypeScript language service for cross-file features */
  getLanguageService(path: string): ts.LanguageService | null

  /** Get script version string for cache invalidation */
  getScriptVersion(path: string): string | null

  /** Update in-memory file content for unsaved buffers */
  updateFile(path: string, content: string): void

  /** Close a file in the TypeScript project service, releasing its resources. */
  closeFile(path: string): void

  /** Return the set of currently open file paths in the TypeScript project service. */
  openFiles(): ReadonlySet<string>

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
  const log = config.log;
  if (log?.enabled) log.debug(`createProject: ${config.plugins.length} plugins, root=${config.rootPath}${config.rules ? `, ${Object.keys(config.rules).length} rule overrides` : ""}`);

  let runner: Runner = config.rules !== undefined
    ? createRunner({ plugins: config.plugins, rules: config.rules })
    : createRunner({ plugins: config.plugins });

  const tsOptions: ProjectServiceOptions = { tsconfigRootDir: config.rootPath };
  if (log !== undefined) tsOptions.log = log;
  const tsService: TypeScriptProjectService = createTypeScriptProjectService(tsOptions);

  if (log?.enabled) log.trace(`createProject: plugins=[${config.plugins.map(p => p.kind).join(", ")}]`);

  return {
    run(files) {
      if (log?.enabled) log.trace(`project.run: ${files.length} files`);
      const result = runner.run(files);
      if (log?.enabled) log.trace(`project.run: ${result.length} diagnostics from ${files.length} files`);
      return result;
    },

    getProgram(path) {
      return tsService.getProgram(path);
    },

    warmProgram(path, content) {
      return tsService.warmProgram(path, content);
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

    closeFile(path) {
      tsService.closeFile(path);
    },

    openFiles() {
      return tsService.openFiles();
    },

    setPlugins(plugins) {
      if (log?.enabled) log.trace(`project.setPlugins: [${plugins.map(p => p.kind).join(", ")}]`);
      runner = createRunner({ plugins });
    },

    setRuleOverrides(overrides) {
      if (log?.enabled) log.trace(`project.setRuleOverrides: ${Object.keys(overrides).length} overrides`);
      runner.setRuleOverrides(overrides);
    },

    dispose() {
      tsService.dispose();
    },
  };
}
