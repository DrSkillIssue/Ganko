/**
 * IncrementalAnalyzer — handles ONLY cross-file analysis.
 *
 * Single-file diagnostics (runSolidRules) run on SolidSyntaxTree WITHOUT
 * a compilation (5-20ms, works at Tier 1 / Quick program). Cross-file
 * rules run via AnalysisDispatcher which executes Tier 0-5 rules
 * (100-500ms, needs full compilation).
 *
 * The DiagnosticPipeline runs them as separate phases.
 */

import {
  createAnalysisDispatcher,
  createOverrideEmit,
  allRules,
} from "@drskillissue/ganko";
import type { Diagnostic, StyleCompilation } from "@drskillissue/ganko";
import type { RuleOverrides } from "@drskillissue/ganko-shared";

export interface IncrementalAnalyzer {
  /**
   * Run cross-file rules for a subset of affected files.
   * Uses AnalysisDispatcher.runSubset() to only dispatch to
   * files in the affected set.
   */
  analyzeAffected(
    paths: readonly string[],
    compilation: StyleCompilation,
    overrides: RuleOverrides,
  ): ReadonlyMap<string, readonly Diagnostic[]>

  /**
   * Run cross-file rules for ALL files in the compilation.
   * Used for full workspace analysis (initial build, config change).
   */
  analyzeAll(
    compilation: StyleCompilation,
    overrides: RuleOverrides,
  ): ReadonlyMap<string, readonly Diagnostic[]>
}

export function createIncrementalAnalyzer(): IncrementalAnalyzer {
  function runWithFilter(
    compilation: StyleCompilation,
    overrides: RuleOverrides,
    affectedFiles: ReadonlySet<string> | null,
  ): ReadonlyMap<string, readonly Diagnostic[]> {
    const dispatcher = createAnalysisDispatcher();
    for (let i = 0; i < allRules.length; i++) {
      dispatcher.register(allRules[i]!);
    }

    const result = affectedFiles !== null
      ? dispatcher.runSubset(compilation, affectedFiles)
      : dispatcher.run(compilation);

    const hasOverrides = Object.keys(overrides).length > 0;
    const byFile = new Map<string, Diagnostic[]>();

    const emit = hasOverrides
      ? createOverrideEmit((d: Diagnostic) => {
          let arr = byFile.get(d.file);
          if (!arr) { arr = []; byFile.set(d.file, arr); }
          arr.push(d);
        }, overrides)
      : (d: Diagnostic) => {
          let arr = byFile.get(d.file);
          if (!arr) { arr = []; byFile.set(d.file, arr); }
          arr.push(d);
        };

    for (let i = 0; i < result.diagnostics.length; i++) {
      const d = result.diagnostics[i];
      if (d) emit(d);
    }

    return byFile;
  }

  return {
    analyzeAffected(paths, compilation, overrides) {
      return runWithFilter(compilation, overrides, new Set(paths));
    },

    analyzeAll(compilation, overrides) {
      return runWithFilter(compilation, overrides, null);
    },
  };
}
