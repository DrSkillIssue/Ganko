/**
 * Project - Plugin-agnostic project management for ganko
 *
 * Uses the runner architecture from ganko.
 * User configures which plugins to use.
 */
import { createRunner, type Runner, type Diagnostic, type Plugin } from "@drskillissue/ganko";
import type { RuleOverrides } from "@drskillissue/ganko-shared";
import { Level } from "@drskillissue/ganko-shared";
import type ts from "typescript";
import { createIncrementalProgram, type IncrementalTypeScriptService } from "./incremental-program";
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

  /** Get the current TypeScript program. */
  getProgram(): ts.Program

  /** Get a TypeScript source file by path. */
  getSourceFile(path: string): ts.SourceFile | undefined

  /** Get TypeScript language service for cross-file features */
  getLanguageService(): ts.LanguageService

  /** Update in-memory file content for unsaved buffers */
  updateFile(path: string, content: string): void

  /** Update plugins configuration */
  setPlugins(plugins: readonly Plugin<string>[]): void

  /** Update rule severity overrides. Takes effect on next run(). */
  setRuleOverrides(overrides: RuleOverrides): void

  /** Resolves when the underlying TypeScript program's initial build completes.
   *  For IncrementalTypeScriptService (LSP), this defers the build by one
   *  event loop tick to allow Tier 1 single-file diagnostics to fire first. */
  watchProgramReady(): Promise<void>

  /** Dispose resources */
  dispose(): void
}

/**
 * Create a project.
 */
export function createProject(config: ProjectConfig): Project {
  const log = config.log;
  if (log?.isLevelEnabled(Level.Debug)) log.debug(`createProject: ${config.plugins.length} plugins, root=${config.rootPath}${config.rules ? `, ${Object.keys(config.rules).length} rule overrides` : ""}`);

  let runner: Runner = config.rules !== undefined
    ? createRunner({ plugins: config.plugins, rules: config.rules })
    : createRunner({ plugins: config.plugins });

  const tsService: IncrementalTypeScriptService = createIncrementalProgram(config.rootPath);

  if (log?.isLevelEnabled(Level.Trace)) log.trace(`createProject: plugins=[${config.plugins.map(p => p.kind).join(", ")}]`);

  return {
    run(files) {
      if (log?.isLevelEnabled(Level.Trace)) log.trace(`project.run: ${files.length} files`);
      const result = runner.run(files);
      if (log?.isLevelEnabled(Level.Trace)) log.trace(`project.run: ${result.length} diagnostics from ${files.length} files`);
      return result;
    },

    getProgram() {
      return tsService.getProgram();
    },

    getSourceFile(path) {
      return tsService.getProgram().getSourceFile(path);
    },

    getLanguageService() {
      return tsService.getLanguageService();
    },

    updateFile(path, content) {
      tsService.updateFile(path, content);
    },

    setPlugins(plugins) {
      if (log?.isLevelEnabled(Level.Trace)) log.trace(`project.setPlugins: [${plugins.map(p => p.kind).join(", ")}]`);
      runner = createRunner({ plugins });
    },

    setRuleOverrides(overrides) {
      if (log?.isLevelEnabled(Level.Trace)) log.trace(`project.setRuleOverrides: ${Object.keys(overrides).length} overrides`);
      runner.setRuleOverrides(overrides);
    },

    watchProgramReady() {
      return tsService.ready();
    },

    dispose() {
      tsService.dispose();
    },
  };
}
