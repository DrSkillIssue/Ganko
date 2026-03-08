/**
 * TypeScript Project Service Wrapper
 *
 * Wraps @typescript-eslint/project-service to provide:
 * - On-demand file loading with TypeScript's internal caching
 * - Program access for type-aware parsing
 * - Language service access for cross-file features
 */

import { createProjectService } from "@typescript-eslint/project-service";
import type ts from "typescript";
import { canonicalPath } from "@drskillissue/ganko-shared";
import type { Logger } from "./logger";

/**
 * Wrapper around TypeScript's Project Service for LSP use.
 */
export interface TypeScriptProjectService {
  /** Open a file and get its TypeScript Program */
  getProgramForFile(filePath: string, content?: string): ts.Program | null;

  /** Get language service for cross-file features */
  getLanguageServiceForFile(filePath: string): ts.LanguageService | null;

  /** Get the script version string for cache invalidation */
  getScriptVersionForFile(filePath: string): string | null;

  /** Update file content (for unsaved changes) */
  updateFile(filePath: string, content: string): void;

  /** Close a file when no longer needed */
  closeFile(filePath: string): void;

  /** Dispose of all resources */
  dispose(): void;
}

/**
 * Options for creating a TypeScript Project Service.
 */
export interface ProjectServiceOptions {
  /** Root directory containing tsconfig.json */
  tsconfigRootDir: string;
  /** Globs of files to allow in default project (for files outside tsconfig) */
  allowDefaultProject?: string[];
  /** Logger instance for diagnostics */
  log?: Logger;
}

/**
 * Create a TypeScript Project Service wrapper.
 *
 * Uses @typescript-eslint/project-service which wraps TypeScript's
 * internal ts.server.ProjectService - the same API VS Code uses.
 *
 * @param options - Configuration options
 * @returns TypeScriptProjectService wrapper
 */
export function createTypeScriptProjectService(
  options: ProjectServiceOptions,
): TypeScriptProjectService {
  const log = options.log;

  log?.debug(`creating TS project service (root=${options.tsconfigRootDir})`);

  const { service } = createProjectService({
    tsconfigRootDir: options.tsconfigRootDir,
    options: {
      allowDefaultProject: options.allowDefaultProject ?? ["*.js", "*.mjs", "*.cjs"],
    },
  });

  log?.info(`TS project service created (root=${options.tsconfigRootDir})`);

  /* TS's ProjectService schedules deferred work (graph updates, open-file
     reassignment) via host.setTimeout with a 250ms throttle. These timers
     survive project/file closure and crash when they fire against torn-down
     state. We track all timer IDs so dispose() can cancel them. */
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const origSetTimeout = service.host.setTimeout.bind(service.host);
  const origClearTimeout = service.host.clearTimeout.bind(service.host);

  service.host.setTimeout = (cb: (...args: unknown[]) => void, ms: number) => {
    const id = origSetTimeout(cb, ms);
    pendingTimers.add(id);
    return id;
  };
  service.host.clearTimeout = (id: ReturnType<typeof setTimeout>) => {
    pendingTimers.delete(id);
    origClearTimeout(id);
  };

  return {
    getProgramForFile(filePath: string, content?: string): ts.Program | null {
      const key = canonicalPath(filePath);
      if (content !== undefined) {
        service.openClientFile(key, content);
      } else {
        service.openClientFile(key);
      }

      const scriptInfo = service.getScriptInfo(key);
      if (!scriptInfo) {
        log?.warning(`getProgramForFile: no scriptInfo for ${key}`);
        return null;
      }

      const project = service.getDefaultProjectForFile(scriptInfo.fileName, true);
      if (!project) {
        log?.warning(`getProgramForFile: no project for ${key}`);
        return null;
      }

      return project.getLanguageService(true).getProgram() ?? null;
    },

    getLanguageServiceForFile(filePath: string): ts.LanguageService | null {
      const key = canonicalPath(filePath);
      let scriptInfo = service.getScriptInfo(key);
      if (!scriptInfo) {
        service.openClientFile(key);
        scriptInfo = service.getScriptInfo(key);
        if (!scriptInfo) {
          log?.warning(`getLanguageServiceForFile: no scriptInfo for ${key}`);
          return null;
        }
      }

      const project = service.getDefaultProjectForFile(scriptInfo.fileName, true);
      if (!project) {
        log?.warning(`getLanguageServiceForFile: no project for ${key}`);
        return null;
      }

      return project.getLanguageService(true);
    },

    getScriptVersionForFile(filePath: string): string | null {
      const key = canonicalPath(filePath);
      const scriptInfo = service.getScriptInfo(key);
      if (!scriptInfo) return null;

      const project = service.getDefaultProjectForFile(scriptInfo.fileName, true);
      if (!project) return null;

      return project.getScriptVersion(key);
    },

    updateFile(filePath: string, content: string): void {
      const key = canonicalPath(filePath);
      const scriptInfo = service.getScriptInfo(key);
      if (scriptInfo) {
        const snapshot = scriptInfo.getSnapshot();
        scriptInfo.editContent(0, snapshot.getLength(), content);
        if (log?.enabled) log.trace(`updateFile: edited ${key} (${content.length} chars)`);
      } else {
        service.openClientFile(key, content);
        if (log?.enabled) log.trace(`updateFile: opened ${key} (${content.length} chars)`);
      }
    },

    closeFile(filePath: string): void {
      const key = canonicalPath(filePath);
      service.closeClientFile(key);
      if (log?.enabled) log.trace(`closeFile: ${key}`);
    },

    dispose(): void {
      for (const filePath of service.openFiles.keys()) {
        service.closeClientFile(filePath);
      }
      /* Cancel deferred TS timers BEFORE closing projects. Closing
         projects tears down resolutionCache etc., so any timer that
         fires after this point would hit undefined internal state. */
      for (const id of pendingTimers) {
        origClearTimeout(id);
      }
      pendingTimers.clear();
      for (const project of service.configuredProjects.values()) {
        project.close();
      }
      for (const project of service.inferredProjects) {
        project.close();
      }
      /* Close may schedule new timers — drain those too. */
      for (const id of pendingTimers) {
        origClearTimeout(id);
      }
      pendingTimers.clear();
      log?.debug("TS project service disposed");
    },
  };
}
