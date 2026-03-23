/**
 * CSS rules are disabled — they've been migrated to compilation/dispatch/rules/
 * and run through the AnalysisDispatcher. This empty array prevents duplicate
 * diagnostics from the old CSSPlugin path. The old rule implementations in
 * subdirectories will be removed in a future refactor.
 */
export const rules = [] as const
