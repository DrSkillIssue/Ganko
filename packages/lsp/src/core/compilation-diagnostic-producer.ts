/**
 * CompilationDiagnosticProducer — bridges compilation to per-file diagnostics.
 *
 * Wraps AnalysisDispatcher. Takes a compilation snapshot, runs registered
 * rules, returns diagnostics grouped by file path.
 *
 * runAll: runs all rules on entire compilation.
 * runSubset: runs only on affected files via dispatcher.runSubset().
 *
 * Used by LSP (DiagnosticPipeline) and daemon (handleLintRequest).
 */

import {
  createAnalysisDispatcher,
  createOverrideEmit,
  allRules,
} from "@drskillissue/ganko";
import type { Diagnostic, StyleCompilation } from "@drskillissue/ganko";
import type { RuleOverrides } from "@drskillissue/ganko-shared";

export interface CompilationDiagnosticProducer {
  runAll(
    compilation: StyleCompilation,
    overrides: RuleOverrides,
  ): ReadonlyMap<string, readonly Diagnostic[]>

  runSubset(
    paths: readonly string[],
    compilation: StyleCompilation,
    overrides: RuleOverrides,
  ): ReadonlyMap<string, readonly Diagnostic[]>
}

function collectByFile(
  diagnostics: readonly Diagnostic[],
  overrides: RuleOverrides,
): Map<string, Diagnostic[]> {
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

  for (let i = 0; i < diagnostics.length; i++) {
    const d = diagnostics[i];
    if (d) emit(d);
  }

  return byFile;
}

export function createCompilationDiagnosticProducer(): CompilationDiagnosticProducer {
  return {
    runAll(compilation, overrides) {
      const dispatcher = createAnalysisDispatcher();
      for (let i = 0; i < allRules.length; i++) {
        dispatcher.register(allRules[i]!);
      }
      const result = dispatcher.run(compilation);
      return collectByFile(result.diagnostics, overrides);
    },

    runSubset(paths, compilation, overrides) {
      const dispatcher = createAnalysisDispatcher();
      for (let i = 0; i < allRules.length; i++) {
        dispatcher.register(allRules[i]!);
      }
      const result = dispatcher.runSubset(compilation, new Set(paths));
      return collectByFile(result.diagnostics, overrides);
    },
  };
}
