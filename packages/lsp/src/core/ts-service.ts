/**
 * TypeScript Service — Unified interface over the three TypeScript tiers.
 *
 * Replaces manual tier selection in diagnostics-push.ts and routing/document.ts.
 * Consumers call getSourceFile() / getLanguageService() — routing to the
 * appropriate tier (Quick/Incremental/Full) is internal.
 *
 * Modeled after typescript-language-server's SyntaxRoutingTsServer which
 * routes commands to the appropriate server (syntax vs semantic) based on
 * command type, transparent to the consumer.
 *
 * Tier lifecycle:
 *   Quick (Tier 1) — Available immediately. Creates a per-file ts.Program
 *     with cached CompilerHost. Fast (~20-50ms) but no cross-module types.
 *   Incremental (Tier 2) — Available after watchProgramReady(). Full
 *     WatchProgram with project-wide type information.
 *   Full (Tier 3) — Same as Incremental in current implementation.
 *     Future: batch program for cross-file analysis.
 */

import ts from "typescript"
import { dirname } from "node:path"
import type { Diagnostic } from "@drskillissue/ganko"
import type { Project } from "./project"

export const enum TsServiceTier {
  /** Fast startup: per-file createProgram, no cross-module types. */
  Quick = 0,
  /** Incremental: WatchProgram with full project type info. */
  Incremental = 1,
}

export interface TsService {
  /** Current highest available tier. */
  readonly activeTier: TsServiceTier

  /** Upgrade to Incremental tier by setting the backing Project. */
  setProject(project: Project): void

  /** Get a SourceFile from the best available program. */
  getSourceFile(path: string): ts.SourceFile | null

  /** Get the LanguageService (only available at Incremental tier). */
  getLanguageService(): ts.LanguageService | null

  /** Get the current TypeScript program (only available at Incremental tier). */
  getProgram(): ts.Program | null

  /** Get compiler options from the project's tsconfig. */
  getCompilerOptions(): ts.CompilerOptions | null

  /**
   * Create a quick (Tier 1) program scoped to a single file.
   * Returns a ts.Program with full TypeChecker but no cross-module types.
   * Used during startup before the incremental program is ready.
   */
  createQuickProgram(path: string, content: string): ts.Program | null

  /** Update in-memory file content. Delegates to project when available. */
  updateFile(path: string, content: string): void

  /** Run diagnostics on files. Delegates to project. */
  run(files: readonly string[]): readonly Diagnostic[]

  /** Notify that a file's content changed. */
  notifyFileChange(path: string, content: string): void

  /** Dispose resources. */
  dispose(): void
}

export function createTsService(rootPath: string): TsService {
  let compilerOptions: ts.CompilerOptions | null = null
  let tier1Host: ts.CompilerHost | null = null
  let tier: TsServiceTier = TsServiceTier.Quick
  let project: Project | null = null

  // Lazily resolve tsconfig compiler options
  function ensureCompilerOptions(): ts.CompilerOptions | null {
    if (compilerOptions !== null) return compilerOptions
    const tsconfigPath = ts.findConfigFile(rootPath, ts.sys.fileExists, "tsconfig.json")
    if (!tsconfigPath) return null
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(tsconfigPath))
    compilerOptions = parsed.options
    return compilerOptions
  }

  // Lazily create and cache the Tier 1 CompilerHost
  function ensureTier1Host(): ts.CompilerHost | null {
    if (tier1Host !== null) return tier1Host
    const opts = ensureCompilerOptions()
    if (!opts) return null
    tier1Host = ts.createCompilerHost(opts)
    return tier1Host
  }

  return {
    get activeTier() { return tier },

    setProject(p) {
      project = p
      tier = TsServiceTier.Incremental
    },

    getSourceFile(path) {
      if (project !== null) return project.getSourceFile(path) ?? null
      return null
    },

    getLanguageService() {
      if (project !== null) return project.getLanguageService()
      return null
    },

    getProgram() {
      if (project !== null) return project.getProgram()
      return null
    },

    getCompilerOptions() {
      return ensureCompilerOptions()
    },

    createQuickProgram(path, content) {
      const opts = ensureCompilerOptions()
      const host = ensureTier1Host()
      if (!opts || !host) return null

      const originalGetSourceFile = host.getSourceFile.bind(host)
      const patchedHost: ts.CompilerHost = {
        ...host,
        getSourceFile(fileName, languageVersion, onError, shouldCreate) {
          if (fileName === path) {
            return ts.createSourceFile(fileName, content, languageVersion, true)
          }
          return originalGetSourceFile(fileName, languageVersion, onError, shouldCreate)
        },
      }

      return ts.createProgram([path], opts, patchedHost)
    },

    updateFile(path, content) {
      if (project !== null) project.updateFile(path, content)
    },

    run(files) {
      if (project !== null) return project.run(files)
      return []
    },

    notifyFileChange(_path, _content) {
      // At Quick tier, no state to invalidate — each createQuickProgram is fresh
    },

    dispose() {
      compilerOptions = null
      tier1Host = null
      tier = TsServiceTier.Quick
      project = null
    },
  }
}
