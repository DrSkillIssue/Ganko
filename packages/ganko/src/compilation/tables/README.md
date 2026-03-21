# Section 1: Exhaustive Dissolution Tables

These tables are the CONTRACT. Every field, index, query, and type in the existing system appears in exactly one row with an explicit new-system home. "MISSING" is a bug.

Generated from source code by `scripts/generate-dissolution-tables.ts`. To regenerate: `bun run scripts/generate-dissolution-tables.ts`

## Tables

| Table | File | Rows | What it maps |
|-------|------|------|-------------|
| 1A | [table-1a-solid-graph.md](table-1a-solid-graph.md) | 128 | Every SolidGraph field → SolidSyntaxTree |
| 1B | [table-1b-css-graph.md](table-1b-css-graph.md) | 122 | Every CSSGraph field → CSSSyntaxTree / SymbolTable / Analysis |
| 1C | [table-1c-layout-graph.md](table-1c-layout-graph.md) | 27+14+22 | Every LayoutGraph + LayoutElementRecord + LayoutElementNode field → SemanticModel / Analysis |
| 1D | [table-1d-signal-model.md](table-1d-signal-model.md) | 23 types + 12 enums | Every signal/guard/context/alignment type → new equivalent (full fidelity) |
| 1E | [table-1e-rules.md](table-1e-rules.md) | 31 rules | Every cross-file rule → tier + dispatch action |
| 1F | (inline below) | 3 | Additional inputs |
| 1G | [table-1g-css-only-rules.md](table-1g-css-only-rules.md) | 33 rules | Every CSS-only rule → CSSGraph fields consumed → new data source |

## Table 1F: Additional Inputs

| Input type | Where created | Where consumed | Phase |
|------------|--------------|----------------|-------|
| `TailwindConfigInput` | LSP server (after resolving Tailwind DesignSystem) | `StyleCompilation.tailwindConfig` → `TailwindProvider` → `SymbolTable.classNames` | Phase 4 |
| `PackageManifestInput` | LSP server (reads package.json) | `DependencyGraph` (package resolution for bare imports) | Phase 3 |
| `TSConfigInput` | LSP server (reads tsconfig.json) | `DependencyGraph` (path alias resolution) | Phase 3 |

## Constraints from these tables

These constraints are MANDATORY for the architecture (Section 2) and SPEC.ts:

1. **RuleGuard** must preserve `conditions: GuardConditionProvenance[]` and `key: string` — NOT collapse to `kind: number`. Conditional delta rules and stateful rules inspect guard provenance. (Table 1D)
2. **SignalValue** must be a discriminated union `KnownSignalValue | UnknownSignalValue` preserving `UnknownSignalValue.reason`. (Table 1D)
3. **LayoutSignalName** must be a 55-literal string union type, not `string`. (Table 1D)
4. **AlignmentContext** must have ALL 16+ fields from context-model.ts. (Table 1D)
5. **CohortStats** must include `factSummary`, `provenance`, `conditionalSignalCount`, `totalSignalCount`. (Table 1D)
6. **CohortSubjectStats** must include `contentComposition` and `signals`. (Table 1D)
7. **ElementNode** must carry `jsxEntity: JSXElementEntity` (direct reference, not just ID). (Table 1C)
8. **ElementNode** must carry `childElementNodes: readonly ElementNode[]`. (Table 1C)
9. **jsxAttrsByKind** must use `JSXAttributeKind` key type, not `string`. (Table 1A)
10. **SymbolTable** must include: `duplicateSelectors`, `multiDeclarationProperties`, `layoutPropertiesByClassToken`, `usedFontFamilies`, `usedFontFamiliesByRule`, `idSelectors`, `attributeSelectors`, `universalSelectors`, `selectorsTargetingCheckbox`, `selectorsTargetingTableCell`, `importantDeclarations`, `emptyRules`, `emptyKeyframes`, `deepNestedRules`, `overqualifiedSelectors`, `unresolvedAnimationRefs`, `unknownContainerQueries`, `unusedContainerNames`, `keyframeDeclarations`, `tokensByCategory`, `mixinsByName`, `functionsByName`, `placeholdersByName`. (Table 1B, verified by Table 1G)
11. **FileSemanticModel** must include: `getElementsByKnownSignalValue(signal, value)`, `getStatefulNormalizedDeclarations(ruleId)`, `getStatefulBaseValueIndex()`, `getBaselineOffsets(elementId)`. (Table 1C)
12. **SnapshotHotSignals** must exist as internal type for cohort analysis (not on SemanticModel API). (Table 1D)
13. **SymbolTable** must have a `declarationsForProperties(...properties: string[])` method. (Table 1G — 8 CSS-only rules use it)
14. **CompilationTracker** must support cross-file diagnostic caching (per-file diagnostic cache reused during typing). (Replaces GraphCache.crossFileDiagnostics)
15. Cross-file rule count is exactly **31** (not "33+"). Tier 3 has **9** rules (not 12). (Table 1E)
