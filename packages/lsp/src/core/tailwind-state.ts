/**
 * Tailwind State — Mutable container for the current Tailwind validator.
 *
 * Updated by the change pipeline when CSS files change and the Tailwind
 * entry file is affected. Re-resolution uses the WorkspaceEvaluator
 * subprocess for project-context module resolution.
 */
import { prepareTailwindEval, buildTailwindValidatorFromEval } from "@drskillissue/ganko";
import type { TailwindValidator } from "@drskillissue/ganko";
import type { Logger, WorkspaceLayout } from "@drskillissue/ganko-shared";
import type { FileRegistry } from "./file-registry";
import { evaluateWorkspace } from "./workspace-eval";

export interface TailwindState {
  validator: TailwindValidator | null
  reResolve(registry: FileRegistry, layout: WorkspaceLayout, log?: Logger): Promise<void>
}

/**
 * Create a TailwindState with the initial validator.
 *
 * @param initial - Initial validator from enrichment (null if not resolved)
 * @returns Mutable tailwind state
 */
export function createTailwindState(initial: TailwindValidator | null): TailwindState {
  const state: TailwindState = {
    validator: initial,

    async reResolve(registry: FileRegistry, layout: WorkspaceLayout, log?: Logger): Promise<void> {
      const cssFiles = registry.loadAllCSSContent();
      const wsPackagePaths = Array.from(layout.packagePaths);
      const twParams = prepareTailwindEval(cssFiles, layout.root.path, wsPackagePaths, log);
      if (twParams === null) {
        state.validator = null;
        return;
      }

      const response = await evaluateWorkspace(layout.root.path, {
        type: "tailwind-init",
        tailwindModulePath: twParams.modulePath,
        tailwindEntryCss: twParams.entryCss,
        tailwindEntryBase: twParams.entryBase,
      }, log).catch(() => null);

      if (response !== null && response.tailwind !== undefined) {
        state.validator = buildTailwindValidatorFromEval(
          response.tailwind.utilities,
          response.tailwind.variants,
          log,
        );
      } else {
        state.validator = null;
      }
    },
  };
  return state;
}

const TAILWIND_IMPORT = /@import\s+["']tailwindcss/;
const TAILWIND_THEME = /@theme\s*\{/;

/**
 * Check if CSS content contains Tailwind entry markers.
 *
 * @param content - CSS file content
 * @returns true if the file is a Tailwind entry point
 */
export function isTailwindEntryContent(content: string): boolean {
  return TAILWIND_IMPORT.test(content) || TAILWIND_THEME.test(content);
}
