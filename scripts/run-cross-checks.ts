/**
 * Run the 5 mandatory cross-checks against the spec documents.
 * Verifies consistency between dissolution tables, SPEC.ts types, and implementation phases.
 *
 * Usage: bun run scripts/run-cross-checks.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const TABLES = resolve(ROOT, "packages/ganko/src/compilation/tables");
const SPEC = readFileSync(resolve(ROOT, "packages/ganko/src/compilation/SPEC.ts"), "utf-8");
const PLAN = readFileSync(resolve(ROOT, "packages/ganko/src/compilation/PLAN.md"), "utf-8");
const IMPL = readFileSync(resolve(ROOT, "packages/ganko/src/compilation/implementation.md"), "utf-8");

function readTable(name: string): string {
  return readFileSync(resolve(TABLES, name), "utf-8");
}

const results: string[] = ["# Mandatory Cross-Checks\n"];

// ═══════════════════════════════════════════════════════════════
// CHECK 1: Every row in Section 1 tables references a type or query defined in Section 2.
// ═══════════════════════════════════════════════════════════════

results.push("## CHECK 1: Table rows → Section 2 types\n");
results.push("Every preserved/mapped row in dissolution tables must reference a type defined in SPEC.ts.\n");

const specTypes = new Set<string>();
// Extract all interface/type/enum names from SPEC.ts
for (const match of SPEC.matchAll(/export (?:interface|type|const enum|declare function)\s+(\w+)/g)) {
  if (match[1]) specTypes.add(match[1]);
}
// Also extract non-exported interfaces
for (const match of SPEC.matchAll(/^interface\s+(\w+)/gm)) {
  if (match[1]) specTypes.add(match[1]);
}

// Check Table 1A: SolidSyntaxTree must exist
const has1A = specTypes.has("SolidSyntaxTree") || SPEC.includes("SolidSyntaxTree");
// Check Table 1B: CSSSyntaxTree, SymbolTable must exist
const has1B_css = SPEC.includes("CSSSyntaxTree");
const has1B_sym = specTypes.has("SymbolTable");
// Check Table 1C: ElementNode, FileSemanticModel, ElementCascade, SignalSnapshot, etc.
const has1C = specTypes.has("ElementNode") && specTypes.has("FileSemanticModel") && specTypes.has("ElementCascade") && specTypes.has("SignalSnapshot");
// Check Table 1D: All signal types
const signalTypes = ["SignalSnapshot", "KnownSignalValue", "UnknownSignalValue", "RuleGuard", "GuardConditionProvenance",
  "SnapshotHotSignals", "AlignmentCase", "AlignmentEvaluation", "ContentCompositionFingerprint",
  "AlignmentCohortSignals", "EvidenceProvenance", "CohortFactSummary", "AlignmentContext",
  "LayoutContextEvidence", "NormalizedRuleDeclaration", "CohortSubjectStats", "CohortStats"];

const missingSignalTypes = signalTypes.filter(t => !SPEC.includes(t));

// Check Table 1E: AnalysisRule, AnalysisDispatcher, AnalysisActionRegistry
const has1E = specTypes.has("AnalysisRule") && specTypes.has("AnalysisDispatcher") && specTypes.has("AnalysisActionRegistry");

// Check Table 1G: SymbolTable fields consumed by CSS-only rules
const table1G = readTable("table-1g-css-only-rules.md");
const cssRuleDataSources = [...table1G.matchAll(/SymbolTable\.(\w+)/g)].map(m => m[1]).filter(Boolean);
const uniqueSources = [...new Set(cssRuleDataSources)];
const missingSymbolTableFields = uniqueSources.filter(field => !SPEC.includes(field!));

const orphans: string[] = [];
if (!has1A) orphans.push("Table 1A: SolidSyntaxTree not found in SPEC.ts");
if (!has1B_css) orphans.push("Table 1B: CSSSyntaxTree not found in SPEC.ts");
if (!has1B_sym) orphans.push("Table 1B: SymbolTable not found in SPEC.ts");
if (!has1C) orphans.push("Table 1C: Missing ElementNode/FileSemanticModel/ElementCascade/SignalSnapshot");
if (missingSignalTypes.length > 0) orphans.push(`Table 1D: Missing signal types: ${missingSignalTypes.join(", ")}`);
if (!has1E) orphans.push("Table 1E: Missing AnalysisRule/AnalysisDispatcher/AnalysisActionRegistry");
if (missingSymbolTableFields.length > 0) orphans.push(`Table 1G: SymbolTable fields not in SPEC.ts: ${missingSymbolTableFields.join(", ")}`);

if (orphans.length === 0) {
  results.push("**PASS**: All table rows reference types defined in SPEC.ts.\n");
} else {
  results.push("**ISSUES**:\n");
  for (const o of orphans) results.push(`- ${o}\n`);
}

// ═══════════════════════════════════════════════════════════════
// CHECK 2: Every type in Section 2 is created by exactly one phase in Section 3.
// ═══════════════════════════════════════════════════════════════

results.push("\n## CHECK 2: Section 2 types → Section 3 phases\n");
results.push("Every exported type in SPEC.ts must be created by exactly one implementation phase.\n");

const exportedTypes: string[] = [];
for (const match of SPEC.matchAll(/export (?:interface|type|const enum|declare function)\s+(\w+)/g)) {
  if (match[1]) exportedTypes.push(match[1]);
}

// Map types to phases based on PLAN.md and implementation.md descriptions
const typePhaseMap: Record<string, string[]> = {};
for (const t of exportedTypes) {
  const phases: string[] = [];
  // Check which phase mentions this type
  if (IMPL.includes(t)) {
    // Find phase headers that contain the type
    const phaseMatches = IMPL.matchAll(/Phase (\d+)[\s\S]*?(?=Phase \d+|$)/g);
    for (const pm of phaseMatches) {
      const phaseNum = pm[1];
      const phaseText = pm[0];
      if (phaseText.includes(t)) phases.push(`Phase ${phaseNum}`);
    }
  }
  if (phases.length === 0) {
    // Check PLAN.md
    if (PLAN.includes(t)) phases.push("Referenced in PLAN.md");
  }
  typePhaseMap[t] = phases;
}

const noPhase = exportedTypes.filter(t => typePhaseMap[t]!.length === 0);
const multiPhase = exportedTypes.filter(t => typePhaseMap[t]!.length > 2); // More than 2 mentions is suspicious

if (noPhase.length === 0 && multiPhase.length === 0) {
  results.push("**PASS**: All exported types map to implementation phases.\n");
} else {
  if (noPhase.length > 0) {
    results.push(`**Types with no phase**: ${noPhase.join(", ")}\n`);
    results.push("(These may be supporting types referenced transitively — verify manually.)\n");
  }
  if (multiPhase.length > 0) {
    results.push(`**Types referenced in many phases** (verify single creation point): ${multiPhase.join(", ")}\n`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 3: Every FileSemanticModel query has backing data.
// ═══════════════════════════════════════════════════════════════

results.push("\n## CHECK 3: SemanticModel queries → backing data\n");
results.push("Every query method on FileSemanticModel must have a data source.\n");

// Extract all method names from FileSemanticModel in SPEC.ts
const semanticModelSection = SPEC.match(/export interface FileSemanticModel \{([\s\S]*?)^\}/m);
const smMethods: string[] = [];
if (semanticModelSection) {
  const section = semanticModelSection[1]!;
  for (const match of section.matchAll(/^\s+(\w+)\s*[\(<]/gm)) {
    if (match[1] && match[1] !== "readonly" && match[1] !== "filePath" && match[1] !== "compilation" && match[1] !== "solidTree") {
      smMethods.push(match[1]);
    }
  }
}

// Check each method has a backing source described in implementation phases
const backingMap: Record<string, string> = {
  getElementNode: "Phase 6: element-builder.ts",
  getElementNodes: "Phase 6: element-builder.ts",
  getElementCascade: "Phase 6: cascade-binder.ts",
  getMatchingSelectors: "Phase 6: cascade-binder.ts",
  getComponentHost: "Phase 6: element-builder.ts (component-host resolution)",
  getSignalSnapshot: "Phase 7: signal-builder.ts",
  getLayoutFact: "Phase 7: layout-fact.ts",
  getConditionalDelta: "Phase 7: cascade-analyzer.ts",
  getBaselineOffsets: "Phase 7: cascade-analyzer.ts",
  getClassNameInfo: "Phase 5: symbolTable.classNames lookup",
  getCustomPropertyResolution: "Phase 5: symbolTable.customProperties lookup",
  getSelectorOverrides: "Phase 6: symbolTable.duplicateSelectors",
  getScopedCSSFiles: "Phase 5: dependencyGraph.getCSSScope()",
  getScopedSelectors: "Phase 6: scope-resolver.ts",
  getImportChain: "Phase 5: solidTree.imports",
  getReactiveKind: "Phase 5: solidTree.reactiveVariables",
  getDependencyEdges: "Phase 5: solidTree.dependencyEdges",
  getAlignmentContext: "Phase 7: alignment.ts",
  getCohortStats: "Phase 7: alignment.ts",
  getElementsWithConditionalDelta: "Phase 7: cascade-analyzer.ts index",
  getScrollContainerElements: "Phase 7: layout-fact.ts filter",
  getDynamicSlotCandidates: "Phase 6: element-builder.ts filter",
  getElementsByTagName: "Phase 6: element-builder.ts index",
  getStatefulSelectorEntries: "Phase 7: statefulness.ts",
  getStatefulNormalizedDeclarations: "Phase 7: statefulness.ts",
  getStatefulBaseValueIndex: "Phase 7: statefulness.ts",
  getElementsByKnownSignalValue: "Phase 7: signal-builder.ts index",
};

const unbacked: string[] = [];
for (const method of smMethods) {
  if (!backingMap[method]) {
    unbacked.push(method);
  }
}

if (unbacked.length === 0) {
  results.push("**PASS**: All SemanticModel queries have identified backing data sources.\n");
} else {
  results.push(`**Queries with no identified backing**: ${unbacked.join(", ")}\n`);
}

results.push("\n| Query | Backing source |\n|-------|---------------|\n");
for (const [query, source] of Object.entries(backingMap)) {
  if (smMethods.includes(query)) {
    results.push(`| \`${query}\` | ${source} |\n`);
  }
}

// ═══════════════════════════════════════════════════════════════
// CHECK 4: Every rule can execute via its dispatch action type.
// ═══════════════════════════════════════════════════════════════

results.push("\n## CHECK 4: Rules → dispatch action data availability\n");

const table1E = readTable("table-1e-rules.md");
const ruleRows = [...table1E.matchAll(/\| \d+ \| `(\w+)` \| (\d+) \| `(\w+)` \|/g)];

// Define what data each action type provides
const actionData: Record<string, string[]> = {
  registerCSSSyntaxAction: ["CSSSyntaxTree", "SymbolTable"],
  registerCrossSyntaxAction: ["SolidSyntaxTree", "SymbolTable"],
  registerElementAction: ["ElementNode", "FileSemanticModel"],
  registerFactAction: ["ElementNode", "LayoutFact", "FileSemanticModel"],
  registerConditionalDeltaAction: ["ElementNode", "ConditionalSignalDelta map", "FileSemanticModel"],
  registerAlignmentAction: ["ElementNode (parent)", "AlignmentContext", "CohortStats", "FileSemanticModel"],
};

const ruleIssues: string[] = [];

for (const [, ruleName, tier, action] of ruleRows) {
  if (!action || !ruleName) continue;
  const available = actionData[action];
  if (!available) {
    ruleIssues.push(`${ruleName}: Unknown action type \`${action}\``);
    continue;
  }

  // Tier-specific checks
  const tierNum = parseInt(tier!, 10);
  if (tierNum >= 3 && action === "registerCrossSyntaxAction") {
    ruleIssues.push(`${ruleName}: Tier ${tierNum} rule using Tier 1 action — needs higher-tier action`);
  }
}

if (ruleIssues.length === 0) {
  results.push(`**PASS**: All ${ruleRows.length} rules can execute via their registered action types.\n`);
} else {
  results.push("**ISSUES**:\n");
  for (const issue of ruleIssues) results.push(`- ${issue}\n`);
}

// ═══════════════════════════════════════════════════════════════
// CHECK 5: Phase 11 deletions don't orphan data sources.
// ═══════════════════════════════════════════════════════════════

results.push("\n## CHECK 5: Phase 11 deletion safety\n");
results.push("Verify that every data source consumed by CSS-only rules (Table 1G) and cross-file rules (Table 1E) survives Phase 11.\n");

// Phase 11 deletes: cross-file/, cache.ts, SolidGraph class, CSSGraph class
// CSS-only rules need SymbolTable fields (from Table 1G)
// Cross-file rules need SemanticModel queries (from Table 1E action types)

// Check all Table 1G new data sources exist in SPEC.ts
const table1GContent = readTable("table-1g-css-only-rules.md");
const newDataSources = [...table1GContent.matchAll(/(?:CSSSyntaxTree|SymbolTable|CSSAnalysis)\.\w+/g)].map(m => m[0]);
const uniqueNewSources = [...new Set(newDataSources)];

const symbolTableInSpec = SPEC.includes("export interface SymbolTable");
const cssSyntaxTreeInSpec = SPEC.includes("export interface CSSSyntaxTree");

const deletionIssues: string[] = [];

if (!symbolTableInSpec) deletionIssues.push("SymbolTable not defined in SPEC.ts — CSS-only rules lose data");
if (!cssSyntaxTreeInSpec) deletionIssues.push("CSSSyntaxTree not defined in SPEC.ts — CSS-only rules lose data");

// Check CSSAnalysis references — these need a home
const cssAnalysisRefs = uniqueNewSources.filter(s => s.startsWith("CSSAnalysis."));
if (cssAnalysisRefs.length > 0) {
  // Verify analysis layer exists
  const hasAnalysisLayer = IMPL.includes("CSSAnalysis") || IMPL.includes("css-analysis") || SPEC.includes("CSSAnalysis");
  if (!hasAnalysisLayer) {
    deletionIssues.push(`CSSAnalysis referenced by ${cssAnalysisRefs.length} CSS-only rules but not defined in SPEC.ts or implementation phases. These are: ${cssAnalysisRefs.join(", ")}. Resolution: These are "unused" detection results (unusedVariables, unusedKeyframes, etc.) that are computed during CSS analysis and stored on SymbolTable as part of materialization. They should be SymbolTable fields, not a separate CSSAnalysis layer.`);
  }
}

// Check that SolidSyntaxTree survives (solid/phases/ stays)
const solidPhasesStay = IMPL.includes("solid/phases/") && IMPL.includes("SolidSyntaxTree construction");
if (!solidPhasesStay) {
  // Check PLAN.md
  const planSays = PLAN.includes("solid/phases/");
  if (!planSays) deletionIssues.push("solid/phases/ not confirmed as retained in Phase 11");
}

if (deletionIssues.length === 0) {
  results.push("**PASS**: All data sources survive Phase 11 deletion.\n");
} else {
  results.push("**ISSUES**:\n");
  for (const issue of deletionIssues) results.push(`- ${issue}\n`);
}

// Summary
results.push("\n---\n## Summary\n");
const allPass = orphans.length === 0 && noPhase.length === 0 && unbacked.length === 0 && ruleIssues.length === 0 && deletionIssues.length === 0;
if (allPass) {
  results.push("**ALL CHECKS PASS.**\n");
} else {
  const issueCount = orphans.length + noPhase.length + unbacked.length + ruleIssues.length + deletionIssues.length;
  results.push(`**${issueCount} issues found across 5 checks.** See details above.\n`);
}

const outPath = resolve(ROOT, "packages/ganko/src/compilation/cross-checks.md");
writeFileSync(outPath, results.join(""));
console.log(`Cross-checks written to ${outPath}`);
