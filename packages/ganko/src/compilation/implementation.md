# Implementation Plan

## Execution Protocol

**BEFORE touching any code for Phase N:**
1. Read EVERY file listed in Phase N's "Read first" section
2. Read the dissolution table rows referenced in Phase N's "Table rows satisfied" section
3. Read the SPEC.ts types referenced in Phase N

**DURING Phase N:**
4. Create ONLY the files listed in "Create these exact files" — no more, no fewer, no renamed
5. Each file's exports must match what Phase N specifies — no extra exports, no missing exports
6. Import types from previous phases — never reinvent a type that exists. SPEC.ts is a reference document, NOT an importable module. Types live in the implementation files that own them.

**AFTER writing Phase N code:**
7. Run `npx tsc --noEmit` — zero errors in `compilation/` before proceeding
8. Create the test file listed in Phase N — exact path specified
9. Run tests — all pass before proceeding
10. Run Phase N's validation gate (specific checks listed per phase)

**GATE: Do NOT start Phase N+1 until Phase N's gate passes.**

> Every phase lists: files to read, files to create, what each file exports,
> table rows it satisfies, type-check gate, test gate, validation gate.
> Follow the sequence. Do not skip steps. Do not combine phases.

---

## Phase 1: Compilation Shell

### Step 1.1 — Read
- `SPEC.ts` sections 1 and 4 (SolidSyntaxTree, CSSSyntaxTree, StyleCompilation interfaces)
- `tables/table-1a-solid-graph.md` rows 1-128 (every SolidGraph field → SolidSyntaxTree mapping)
- `tables/table-1b-css-graph.md` rows marked "Per-file → CSSSyntaxTree"
- `packages/ganko/src/solid/impl.ts` (SolidGraph class — the shape to match)
- `packages/ganko/src/css/impl.ts` (CSSGraph class — understand per-file partitioning)
- `packages/ganko/src/css/entities/file.ts` (FileEntity.imports for CSS tree splitting)

### Step 1.2 — Create files
```
compilation/core/
├── compilation.ts        — StyleCompilation implementation
├── solid-syntax-tree.ts  — SolidSyntaxTree interface + solidGraphToSyntaxTree()
└── css-syntax-tree.ts    — CSSSyntaxTree interface + cssGraphToSyntaxTrees()
```

#### compilation/core/solid-syntax-tree.ts must export:
- `SolidSyntaxTree` interface — matching SPEC.ts section 1
- `solidGraphToSyntaxTree(graph: SolidGraph, version: string): SolidSyntaxTree`

Rules:
- Every Table 1A row with Status=Preserved → field on SolidSyntaxTree (same name unless noted)
- Table 1A row 2: `file` → renamed to `filePath`
- Table 1A row 48: `jsxAttrsByKind` key type = `JSXAttributeKind` (import from `solid/util/jsx`) — Constraint 9
- Table 1A rows with Status=Excluded → NOT on SolidSyntaxTree (id generators, add methods, WeakMap caches, logger, private helpers)
- Additional fields: `kind: "solid"`, `version: string`
- `findExpressionAtOffset` bound to graph instance
- Zero-copy: every field is the SAME array reference as SolidGraph (no copies)

#### compilation/core/css-syntax-tree.ts must export:
- `CSSSyntaxTree` interface — matching SPEC.ts section 1
- `cssGraphToSyntaxTrees(graph: CSSGraph): readonly CSSSyntaxTree[]`

Rules:
- Every Table 1B row with Per-file + CSSSyntaxTree → field on CSSSyntaxTree
- Per-file indexes (classNameIndex, selectorsBySubjectTag, etc.) REBUILT per file (not shared references)
- `sourceOrderBase` = `fileIndex * 10000`
- Additional fields: `kind: "css"`, `version: string`, `isScss: boolean`
- Partitions entities by checking `entity.file === file` (or equivalent file reference)

#### compilation/core/compilation.ts must export:
- `StyleCompilation` interface — matching SPEC.ts section 4
- `createStyleCompilation(): StyleCompilation`
- `createCompilationFromLegacy(solidTrees: readonly SolidSyntaxTree[], cssTrees: readonly CSSSyntaxTree[]): StyleCompilation`

Rules:
- Immutable — every with* method returns NEW instance
- Structural sharing — `withSolidTree(tree)` creates new solidTrees Map, reuses cssTrees reference
- `withoutFile(path)` returns `this` if path not in either map
- `withFile(path, tree)` dispatches on `tree.kind`
- `id` is monotonic module-level counter
- `symbolTable` → getter that throws "Not implemented: Phase 2"
- `dependencyGraph` → getter that throws "Not implemented: Phase 3"
- `getSemanticModel` → throws "Not implemented: Phase 5"
- Do NOT import from `cross-file/layout/`

### Step 1.3 — Type-check gate
```
npx tsc --noEmit 2>&1 | grep "compilation/core"
```
Must produce zero errors.

### Step 1.4 — Add test include
Add `"test/compilation/**/*.test.ts"` to `vitest.config.ts` unit test include array.

### Step 1.5 — Create test file
```
test/compilation/phase1.test.ts
```

### Step 1.6 — Test gate
```
npx vitest run test/compilation/phase1.test.ts
```
All tests must pass.

### Step 1.7 — Validation gate
These specific assertions must be in the test file and passing:

**Table 1A reference-equality checks** (for every Preserved row):
- `tree.scopes === graph.scopes`
- `tree.variables === graph.variables`
- `tree.functions === graph.functions`
- `tree.calls === graph.calls`
- `tree.jsxElements === graph.jsxElements`
- `tree.imports === graph.imports`
- `tree.exports === graph.exports`
- `tree.classes === graph.classes`
- `tree.variablesByName === graph.variablesByName`
- `tree.functionsByNode === graph.functionsByNode`
- `tree.callsByNode === graph.callsByNode`
- `tree.jsxByTag === graph.jsxByTag`
- `tree.jsxAttrsByKind === graph.jsxAttrsByKind`
- `tree.staticClassTokensByElementId === graph.staticClassTokensByElementId`
- `tree.importsBySource === graph.importsBySource`
- `tree.componentScopes === graph.componentScopes`
- `tree.reactiveVariables === graph.reactiveVariables`
- `tree.computationByCallId === graph.computationByCallId`
- `tree.sourceFile === graph.sourceFile`
- `tree.typeResolver === graph.typeResolver`
- `tree.fileEntity === graph.fileEntity`

**Structural sharing checks:**
- `comp.withSolidTree(tree).cssTrees === comp.cssTrees`
- `comp.withCSSTree(tree).solidTrees === comp.solidTrees`

**Removal checks:**
- `comp.withoutFile(path).getSolidTree(path) === undefined`
- `comp.withoutFile(unknownPath) === comp` (identity — same instance returned)

**CSS partitioning checks:**
- `cssGraphToSyntaxTrees(graph).length === graph.files.length`
- Each tree's selectors come only from that file
- Each tree's classNameIndex keys are a subset (not superset) of graph's
- Each tree has unique `sourceOrderBase`

**ID monotonicity:**
- Each `with*` call produces a `comp.id` strictly greater than the previous

**Round-trip:**
- `createCompilationFromLegacy` → `getSolidTree(path)` → every Preserved field is reference-equal to original SolidGraph

### Table rows satisfied
- Table 1A: All 128 rows (86 Preserved, 42 Excluded with reasons)
- Table 1B: All "Per-file → CSSSyntaxTree" rows

### GATE: Phase 1 complete only when Step 1.7 passes. Do not start Phase 2.

---

## Phase 2: Symbol Hierarchy

### Step 2.1 — Read
- `SPEC.ts` section 2 (all symbol types: StyleSymbol, ClassNameSymbol, CSSClassNameSource, TailwindClassNameSource, SelectorSymbol, DeclarationSymbol, CustomPropertySymbol, ComponentHostSymbol, KeyframesSymbol, FontFaceSymbol, LayerSymbol, ContainerSymbol, ThemeTokenSymbol)
- `SPEC.ts` DeclarationTable interface
- `SPEC.ts` SymbolTable interface (ALL fields including Constraint 10 workspace-wide indexes)
- `tables/table-1b-css-graph.md` — every row with "Workspace → SymbolTable"
- `tables/table-1g-css-only-rules.md` — every CSS-only rule's SymbolTable data source
- `tables/README.md` — Constraints 10, 13
- `compilation/core/css-syntax-tree.ts` — Phase 1 output (CSSSyntaxTree consumed here)
- `packages/ganko/src/css/impl.ts` — CSSGraph workspace-wide indexes (what SymbolTable must replicate)
- `packages/ganko/src/css/entities/` — ALL entity types (symbols wrap these)
- `packages/ganko/src/css/parser/specificity.ts` — Specificity type, used by SelectorSymbol
- `packages/ganko/src/cross-file/layout/selector-match.ts` — `CompiledSelectorMatcher` interface + `compileSelectorMatcher()` function
- `packages/ganko/src/cross-file/layout/selector-dispatch.ts` — dispatch key format (`id:X`, `class:X`, `attr:X`)

### Step 2.2 — Create files
```
compilation/symbols/
├── symbol-table.ts       — SymbolTable interface + buildSymbolTable()
├── declaration-table.ts  — DeclarationTable (two-forest incremental merge)
├── class-name.ts         — ClassNameSymbol, CSSClassNameSource, createClassNameSymbol()
├── selector.ts           — SelectorSymbol, createSelectorSymbol()
├── declaration.ts        — DeclarationSymbol, createDeclarationSymbol()
├── custom-property.ts    — CustomPropertySymbol, createCustomPropertySymbol()
├── component-host.ts     — ComponentHostSymbol (TYPE ONLY — no create function, creation is Phase 6)
├── keyframes.ts          — KeyframesSymbol, KeyframeLayoutMutation, createKeyframesSymbol()
├── font-face.ts          — FontFaceSymbol, createFontFaceSymbol()
├── layer.ts              — LayerSymbol, createLayerSymbol()
├── container.ts          — ContainerSymbol, createContainerSymbol()
└── theme-token.ts        — ThemeTokenSymbol, createThemeTokenSymbol()
```

Exactly 13 files. No `types.ts`. No `contribution.ts`. No `index.ts`.

#### Per-symbol file pattern (class-name.ts, selector.ts, declaration.ts, etc.)
Each file exports:
1. The symbol interface matching SPEC.ts section 2 exactly
2. A `create*Symbol(entity, metadata)` factory that takes an entity from `css/entities/` + computed metadata → returns the symbol
3. Symbols hold `readonly entity: EntityType` reference — they wrap, not copy

#### selector.ts specifics
- `SelectorSymbol.specificity` = `[entity.specificity[1], entity.specificity[2], entity.specificity[3]]` (drop inline component)
- `SelectorSymbol.dispatchKeys` = computed from selector's subject compound: `id:X`, `class:X`, `attr:X` format, sorted, deduped. Extract this from `cross-file/layout/selector-dispatch.ts` `buildDispatchKeys` function (or inline the 10-line algorithm).
- `SelectorSymbol.compiledMatcher` = `compileSelectorMatcher(entity)` from `cross-file/layout/selector-match.ts`. This is a read-only import — we are pre-computing matchers into symbols at build time.
- `createSelectorSymbol(entity: SelectorEntity, filePath: string): SelectorSymbol`

#### symbol-table.ts specifics
- `buildSymbolTable(trees: readonly CSSSyntaxTree[]): SymbolTable`
- Iterates trees, calls create* factories per entity, merges into workspace-wide indexes
- Class names merged across files: same name from 2 files → one ClassNameSymbol with selectors from both
- MUST build ALL Constraint 10 indexes from `tables/README.md`:
  `duplicateSelectors`, `multiDeclarationProperties`, `layoutPropertiesByClassToken`, `usedFontFamilies`, `usedFontFamiliesByRule`, `idSelectors`, `attributeSelectors`, `universalSelectors`, `selectorsTargetingCheckbox`, `selectorsTargetingTableCell`, `importantDeclarations`, `emptyRules`, `emptyKeyframes`, `deepNestedRules`, `overqualifiedSelectors`, `unresolvedAnimationRefs`, `unknownContainerQueries`, `unusedContainerNames`, `keyframeDeclarations`, `tokensByCategory`, `mixinsByName`, `functionsByName`, `placeholdersByName`, `unusedVariables`, `unusedKeyframes`, `unusedMixins`, `unusedFunctions`, `unusedPlaceholders`
- `declarationsForProperties(...properties)` method (Constraint 13) — same logic as CSSGraph.declarationsForProperties
- Query methods: `hasClassName`, `getClassName`, `getSelectorsByClassName`, `getCustomProperty`, `getKeyframes`, `getFontFaces`, `getLayerOrder`
- The build logic for each workspace-wide index must match CSSGraph's logic exactly — read `css/impl.ts` for how each index is built

#### declaration-table.ts specifics
- Two-forest pattern (Roslyn's DeclarationTable):
  - `_olderContributions: Map<string, PerFileContribution>` — cached from previous materializations
  - `_latestFilePath: string | null` — the most recently added/changed file
  - `_latestTree: CSSSyntaxTree | null` — the tree for the latest file
  - `_cachedTable: SymbolTable | null` — cached materialization result
- `withTree(tree)`: returns new DeclarationTable where latest = tree, previous latest moves to older
- `withoutTree(filePath)`: returns new DeclarationTable with that file removed
- `materialize()`: if _cachedTable is null, build it. If latest is non-null, extract latest's contribution, merge with older's cached result.
- The KEY property: adding tree 201 to a 200-tree table only extracts symbols from tree 201, then merges with the cached 200-tree result.

#### component-host.ts
- Exports ONLY the `ComponentHostSymbol` interface matching SPEC.ts
- NO `createComponentHostSymbol` function — component hosts are created during binding (Phase 6)
- This file exists for the type definition only

### Step 2.3 — Type-check gate
```
npx tsc --noEmit 2>&1 | grep "compilation/symbols"
```
Zero errors.

### Step 2.4 — Create test file
```
test/compilation/phase2.test.ts
```

### Step 2.5 — Test gate
```
npx vitest run test/compilation/phase2.test.ts
```
All tests pass.

### Step 2.6 — Validation gate

**Class name parity:**
- `new Set(symbolTable.classNames.keys())` deep-equals `new Set(oldCSSGraph.classNameIndex.keys())`

**Selector parity:**
- `symbolTable.selectors.size === oldCSSGraph.selectors.length`
- For every selector ID in old graph: `symbolTable.selectors.get(id)` exists
- For every selector: specificity triple matches `[old.specificity[1], old.specificity[2], old.specificity[3]]`

**Custom property parity:**
- `new Set(symbolTable.customProperties.keys())` equals `new Set([...oldCSSGraph.variablesByName.keys()].filter(k => k.startsWith("--")))`

**Keyframes parity:**
- `new Set(symbolTable.keyframes.keys())` equals `oldCSSGraph.knownKeyframeNames`

**CSS-only rule index parity (Constraint 10):**
- `symbolTable.idSelectors.length === oldCSSGraph.idSelectors.length`
- `symbolTable.attributeSelectors.length === oldCSSGraph.attributeSelectors.length`
- `symbolTable.universalSelectors.length === oldCSSGraph.universalSelectors.length`
- `symbolTable.importantDeclarations.length === oldCSSGraph.importantDeclarations.length`
- `symbolTable.emptyRules.length === oldCSSGraph.emptyRules.length`
- `symbolTable.emptyKeyframes.length === oldCSSGraph.emptyKeyframes.length`
- `symbolTable.deepNestedRules.length === oldCSSGraph.deepNestedRules.length`

**declarationsForProperties parity (Constraint 13):**
- `symbolTable.declarationsForProperties("color")` returns same entities as `oldCSSGraph.declarationsForProperties("color")`
- `symbolTable.declarationsForProperties("animation", "animation-name")` matches old graph

**DeclarationTable incremental test:**
- Build DeclarationTable from 10 trees
- Add 11th tree via `withTree(tree11)`
- `materialize()` must NOT re-extract symbols from the first 10 trees (verify via call count or timing)

### Table rows satisfied
- Table 1B: All "Workspace → SymbolTable" rows
- Table 1G: All CSS-only rules have data sources in SymbolTable

### GATE: Phase 2 complete only when Step 2.6 passes. Do not start Phase 3.

---

## Phase 3: Dependency Graph

### Step 3.1 — Read
- `SPEC.ts` section 5 (DependencyGraph, DependencyEdgeInfo, DependencyEdgeKind, ComponentImportEdge)
- `tables/table-1c-layout-graph.md` row for `cssScopeBySolidFile`
- `compilation/core/` — Phase 1 output (syntax trees with import data)
- `packages/ganko/src/cross-file/layout/scope.ts` — ENTIRE FILE. All 5 inclusion mechanisms.
- `packages/ganko/src/cross-file/layout/module-resolver.ts` — ENTIRE FILE. Module resolution algorithm to MOVE here.
- `packages/ganko/src/solid/entities/import.ts` — ImportEntity shape
- `packages/ganko/src/css/entities/file.ts` — FileEntity.imports

### Step 3.2 — Create files
```
compilation/incremental/
└── dependency-graph.ts
```

Exactly 1 file.

#### dependency-graph.ts must export:
- `DependencyGraph` interface matching SPEC.ts section 5
- `buildDependencyGraph(solidTrees: ReadonlyMap<string, SolidSyntaxTree>, cssTrees: ReadonlyMap<string, CSSSyntaxTree>): DependencyGraph`

Rules:
- Edge kinds: `"js-import"`, `"css-import"`, `"css-at-import"`, `"colocated"`, `"global-side-effect"`
- `getCSSScope(solidFilePath)` replicates ALL 5 mechanisms from scope.ts
- Module resolution logic from module-resolver.ts MOVED here (same algorithm, same function signatures)
- `getReverseDependencies(filePath)` — reverse edge index
- `getTransitivelyAffected(filePath)` — transitive closure of reverse deps

### Step 3.3 — Type-check gate
Zero errors in `compilation/incremental/`.

### Step 3.4 — Create test file
```
test/compilation/phase3.test.ts
```

### Step 3.5 — Test gate
All tests pass.

### Step 3.6 — Validation gate
- For EVERY Solid file in cross-file test fixtures: `getCSSScope()` as Set === `collectCSSScopeBySolidFile()` result as Set. ZERO differences.
- Reverse edges: CSS file X in scope for Solid file Y → Y in `getReverseDependencies(X)`
- Circular imports don't infinite-loop
- Missing import targets don't crash

### Table rows satisfied
- Table 1C: `cssScopeBySolidFile` row

### GATE: Phase 3 complete only when Step 3.6 passes. Do not start Phase 4.

---

## Phase 4: CSS Source Providers

### Step 4.1 — Read
- `SPEC.ts` section 8 (CSSSourceProvider, PlainCSSProvider, SCSSProvider, TailwindProvider)
- `SPEC.ts` section 2 (TailwindParsedCandidate, TailwindClassNameSource, TailwindCandidateDiagnostic)
- `tables/README.md` Constraints (TailwindCandidateDiagnostic kinds)
- `compilation/symbols/` — Phase 2 output
- `packages/ganko/src/css/phases/` — all 6 phase files
- `packages/ganko/src/css/impl.ts` — buildCSSGraph() orchestration
- `packages/ganko/src/css/tailwind.ts` — TailwindValidator
- `/home/skill/p/tailwindcss/packages/tailwindcss/src/candidate.ts` — v4 candidate parsing

### Step 4.2 — Create files
```
compilation/providers/
├── provider.ts     — CSSSourceProvider interface
├── plain-css.ts    — PlainCSSProvider
├── scss.ts         — SCSSProvider
└── tailwind.ts     — TailwindProvider
```

Exactly 4 files.

### Step 4.3 — Type-check gate
Zero errors in `compilation/providers/`.

### Step 4.4 — Create test file
```
test/compilation/phase4.test.ts
```

### Step 4.5 — Test gate
All tests pass.

### Step 4.6 — Validation gate
- `PlainCSSProvider.parse(path, content)` entities match old CSSGraph per-file data
- `tailwindProvider.has(name)` matches `oldTailwind.has(name)` for 500+ classes
- `tailwindProvider.parseCandidate("hover:bg-red-500/50")` produces correct structure
- Invalid classes produce typed diagnostics

### GATE: Phase 4 complete only when Step 4.6 passes. Do not start Phase 5.

---

## Phase 5: SemanticModel Core (Tier 0-1)

### Step 5.1 — Read
- `SPEC.ts` section 6 (FileSemanticModel — Tier 0-1 query methods only)
- `tables/table-1e-rules.md` — Tier 0-1 rules
- `packages/ganko/src/cross-file/queries.ts` — getUndefinedCSSClasses, getUnusedCSSClasses

### Step 5.2 — Create files
```
compilation/binding/
└── semantic-model.ts
```

Exactly 1 file. Implements ONLY Tier 0-1 queries. All Tier 2+ queries throw "Not implemented: Phase 6/7".

### Step 5.3 — Type-check gate
Zero errors in `compilation/binding/`.

### Step 5.4 — Create test file
```
test/compilation/phase5.test.ts
```

### Step 5.5 — Test gate
All tests pass.

### Step 5.6 — Validation gate
- `getClassNameInfo(name) !== null` matches `css.classNameIndex.has(name) || tailwind.has(name)` for all test classes
- Produces same undefined-class set as `getUndefinedCSSClasses()`

### GATE: Phase 5 complete only when Step 5.6 passes. Do not start Phase 6.

---

## Phase 6: Cascade Binder (Tier 2-3)

### Existing type-only files created by Phase 5
Phase 5 created these files with type definitions only (no implementation logic). Phase 6 ADDS implementation functions to them.

| File | Types already defined | Phase 6 adds |
|------|----------------------|--------------|
| `compilation/binding/element-builder.ts` | `ElementNode`, `TextualContentState` | `buildElementNodes()` function |
| `compilation/binding/cascade-binder.ts` | `ElementCascade`, `CascadedDeclaration`, `SelectorMatch`, `RuleGuard`, `GuardConditionProvenance`, `SignalSource`, `SignalGuardKind` | `bind()`, `bindFile()` functions |
| `compilation/binding/scope-resolver.ts` | `ScopedSelectorIndex` | `buildScopedSelectorIndex()` function |

### Step 6.1 — Read
- `compilation/binding/element-builder.ts` — existing `ElementNode` type to implement
- `compilation/binding/cascade-binder.ts` — existing `ElementCascade`, `CascadedDeclaration`, `SelectorMatch`, `RuleGuard` types
- `compilation/binding/scope-resolver.ts` — existing `ScopedSelectorIndex` type
- `compilation/binding/semantic-model.ts` — Phase 5 output (Tier 2-3 stubs to replace)
- `tables/table-1c-layout-graph.md` — ALL LayoutGraph fields mapped to binding layer
- `tables/README.md` — Constraints 7 (jsxEntity on ElementNode), 8 (childElementNodes)
- `packages/ganko/src/cross-file/layout/cascade-builder.ts` — MOVE cascade algorithm into cascade-binder.ts
- `packages/ganko/src/cross-file/layout/selector-match.ts` — MOVE selector matching into cascade-binder.ts
- `packages/ganko/src/cross-file/layout/selector-dispatch.ts` — MOVE dispatch bucketing into scope-resolver.ts
- `packages/ganko/src/cross-file/layout/element-record.ts` — MOVE element construction into element-builder.ts
- `packages/ganko/src/cross-file/layout/component-host.ts` — MOVE host resolution into element-builder.ts
- `packages/ganko/src/cross-file/layout/build.ts` steps 0-6

### Step 6.2 — Add implementation to existing files

**`compilation/binding/element-builder.ts`** — ADD:
- `buildElementNodes(solidTree: SolidSyntaxTree, compilation: StyleCompilation): ElementNode[]`
- Same logic as element-record.ts: tag resolution, transparent primitive detection, parent-child wiring, sibling indexing, class token extraction, inline style extraction, dispatch key computation
- Component host resolution via compilation's dependency graph
- ElementNode.jsxEntity = direct JSXElementEntity reference (Constraint 7)
- ElementNode.childElementNodes = direct children array (Constraint 8)

**`compilation/binding/cascade-binder.ts`** — ADD:
- `bind(element: ElementNode, scopedSelectors: ScopedSelectorIndex, symbolTable: SymbolTable): ElementCascade`
- Same cascade algorithm as cascade-builder.ts: monitored declaration collection, per-element cascade construction, variable substitution, Tailwind augmentation, importance/layer/specificity/sourceOrder sort
- `selectorMatchesElement(element: ElementNode, matcher: CompiledSelectorMatcher): boolean` — moved from selector-match.ts

**`compilation/binding/scope-resolver.ts`** — ADD:
- `buildScopedSelectorIndex(scopedCSSFiles: readonly string[], symbolTable: SymbolTable): ScopedSelectorIndex`
- Same dispatch bucketing as selector-dispatch.ts, operating on SelectorSymbol from the symbol table
- Compute `requirements.needsClassTokens` and `requirements.needsAttributes` from selectors in scope

**`compilation/binding/semantic-model.ts`** — REPLACE Phase 6 throw stubs with real implementations:
- `getElementNode`, `getElementNodes` — uses element-builder
- `getElementCascade` — uses cascade-binder
- `getMatchingSelectors` — from cascade binding
- `getComponentHost` — uses element-builder component host logic
- `getElementsByTagName` — filter from element nodes
- `getLayoutFact` — computed from cascade (reservedSpace, scrollContainer, flowParticipation, containingBlock)
- Also replace `getScopedSelectors` to use scope-resolver's `buildScopedSelectorIndex` (computing requirements)

### Step 6.3 — Type-check gate
Zero errors.

### Step 6.4 — Create test file
```
test/compilation/phase6.test.ts
```

### Step 6.5 — Test gate
All tests pass.

### Step 6.6 — Validation gate
- For 50+ elements: `getElementCascade(id).declarations` matches old `LayoutGraph.records.get(node).cascade`
- Edge counts match
- Component host resolution matches old system
- `getLayoutFact(id, "reservedSpace")` matches old records

### GATE: Phase 6 complete only when Step 6.6 passes. Do not start Phase 7.

---

## Phase 7: Signal + Fact Analyzers (Tier 4-5)

### Existing type-only files created by Phase 5
Phase 5 created these files with type definitions only. Phase 7 ADDS implementation functions to them.

| File | Types already defined | Phase 7 adds |
|------|----------------------|--------------|
| `compilation/binding/signal-builder.ts` | `SignalSnapshot`, `SignalValue`, `KnownSignalValue`, `UnknownSignalValue`, `LayoutSignalName`, `layoutSignalNames`, signal enums | `buildSignalSnapshot()` function |
| `compilation/analysis/cascade-analyzer.ts` | `ConditionalSignalDelta` | `computeConditionalDelta()` function |
| `compilation/analysis/layout-fact.ts` | `LayoutFactKind`, `LayoutFactMap`, `ReservedSpaceFact`, `ScrollContainerFact`, `FlowParticipationFact`, `ContainingBlockFact` | `computeReservedSpaceFact()`, `computeScrollContainerFact()`, `computeFlowParticipationFact()`, `computeContainingBlockFact()` |
| `compilation/analysis/alignment.ts` | `AlignmentContext` (all 16+ fields), `CohortStats`, `CohortSubjectStats`, `CohortProfile`, all evidence/cohort/hot-signal types | `createAlignmentContext()`, `buildCohortStats()`, Bayesian scoring functions |
| `compilation/analysis/statefulness.ts` | `StatefulSelectorEntry`, `NormalizedRuleDeclaration` | `buildStatefulRuleIndexes()` function |

### Step 7.1 — Read
- `compilation/binding/signal-builder.ts` — existing signal types to implement
- `compilation/analysis/cascade-analyzer.ts` — existing ConditionalSignalDelta type
- `compilation/analysis/layout-fact.ts` — existing fact types
- `compilation/analysis/alignment.ts` — existing alignment/cohort types
- `compilation/analysis/statefulness.ts` — existing stateful types
- `tables/table-1d-signal-model.md` — ALL signal types (zero field loss)
- `tables/README.md` — Constraints 1-6, 12
- `packages/ganko/src/cross-file/layout/signal-normalization.ts` — MOVE into signal-builder.ts
- `packages/ganko/src/cross-file/layout/signal-collection.ts` — MOVE into signal-builder.ts
- `packages/ganko/src/cross-file/layout/build.ts` steps 7-8
- `packages/ganko/src/cross-file/layout/rule-kit.ts` — MOVE into alignment.ts
- `packages/ganko/src/cross-file/layout/context-classification.ts` — MOVE into alignment.ts
- `packages/ganko/src/cross-file/layout/cohort-index.ts` — MOVE into alignment.ts
- `packages/ganko/src/cross-file/layout/offset-baseline.ts` — MOVE into alignment.ts
- `packages/ganko/src/cross-file/layout/stateful-rule-index.ts` — MOVE into statefulness.ts
- `packages/ganko/src/cross-file/layout/measurement-node.ts` — MOVE into alignment.ts

### Step 7.2 — Add implementation to existing files

**`compilation/binding/signal-builder.ts`** — ADD:
- `buildSignalSnapshot(elementId: number, cascade: ElementCascade, parentSnapshot: SignalSnapshot | null): SignalSnapshot`
- Same normalization + inheritance logic from signal-normalization.ts and signal-collection.ts

**`compilation/analysis/layout-fact.ts`** — ADD:
- `computeReservedSpaceFact(snapshot: SignalSnapshot): ReservedSpaceFact`
- `computeScrollContainerFact(snapshot: SignalSnapshot): ScrollContainerFact`
- `computeFlowParticipationFact(snapshot: SignalSnapshot): FlowParticipationFact`
- `computeContainingBlockFact(node: ElementNode, positionedAncestorByKey: Map<...>): ContainingBlockFact`
- Same algorithms from build.ts steps 6-7

**`compilation/analysis/cascade-analyzer.ts`** — ADD:
- `computeConditionalDelta(elements: readonly ElementNode[], cascades: ReadonlyMap<number, ElementCascade>, ...): Map<ElementNode, Map<LayoutSignalName, ConditionalSignalDelta>>`
- Same logic from build.ts step 7

**`compilation/analysis/alignment.ts`** — ADD:
- `createAlignmentContextForParent(...)` — from context-classification.ts
- `buildCohortIndex(...)` — from cohort-index.ts
- `collectAlignmentCases(...)`, `evaluateAlignmentCase(...)` — from rule-kit.ts
- Bayesian evidence scoring — from rule-kit.ts

**`compilation/analysis/statefulness.ts`** — ADD:
- `buildStatefulRuleIndexes(...)` — from stateful-rule-index.ts

**`compilation/binding/semantic-model.ts`** — REPLACE Phase 7 throw stubs with real implementations:
- `getSignalSnapshot` — uses signal-builder
- `getConditionalDelta` — uses cascade-analyzer
- `getBaselineOffsets` — uses cascade-analyzer
- `getAlignmentContext` — uses alignment
- `getCohortStats` — uses alignment
- `getElementsWithConditionalDelta` — uses cascade-analyzer index
- `getScrollContainerElements` — filter from layout facts
- `getDynamicSlotCandidates` — filter from element nodes
- `getElementsByKnownSignalValue` — cross-element index from signal-builder
- `getStatefulSelectorEntries` — uses statefulness
- `getStatefulNormalizedDeclarations` — uses statefulness
- `getStatefulBaseValueIndex` — uses statefulness

### Step 7.3 — Type-check gate
Zero errors.

### Step 7.4 — Create test file
```
test/compilation/phase7.test.ts
```

### Step 7.5 — Test gate
All tests pass.

### Step 7.6 — Validation gate
- Every element's signal snapshot matches old snapshot for all 55 signals
- All layout facts match old LayoutGraph records
- AlignmentContext has ALL 16+ fields
- CohortStats has factSummary, provenance, conditionalSignalCount, totalSignalCount
- CohortSubjectStats has contentComposition and signals

### GATE: Phase 7 complete only when Step 7.6 passes. Do not start Phase 8.

---

## Phase 8: Rule Dispatch Framework

### Dependencies: Phase 5 AND Phase 7 (all tiers must be available)

### Type imports for dispatch files
Dispatch files import types from:
- `compilation/binding/element-builder.ts` — `ElementNode`
- `compilation/binding/cascade-binder.ts` — `ElementCascade`
- `compilation/binding/signal-builder.ts` — `SignalSnapshot`, `LayoutSignalName`
- `compilation/binding/semantic-model.ts` — `FileSemanticModel`
- `compilation/analysis/layout-fact.ts` — `LayoutFactKind`, `LayoutFactMap`
- `compilation/analysis/cascade-analyzer.ts` — `ConditionalSignalDelta`
- `compilation/analysis/alignment.ts` — `AlignmentContext`, `CohortStats`
- `compilation/analysis/statefulness.ts` — `StatefulSelectorEntry`, `NormalizedRuleDeclaration`
- `compilation/core/css-syntax-tree.ts` — `CSSSyntaxTree`
- `compilation/core/solid-syntax-tree.ts` — `SolidSyntaxTree`
- `compilation/symbols/symbol-table.ts` — `SymbolTable`
- `compilation/symbols/class-name.ts` — `ClassNameSymbol`

### Step 8.1 — Read
- `SPEC.ts` section 10 (AnalysisDispatcher, AnalysisRule, AnalysisActionRegistry — reference only, implement from scratch)
- `tables/table-1e-rules.md` — all 31 rules
- `packages/ganko/src/cross-file/rule.ts` — CrossRule, CrossRuleContext
- The 3 Tier 0 rule files

### Step 8.2 — Create files
```
compilation/dispatch/
├── rule.ts             (NEW)
├── registry.ts         (NEW)
├── tier-resolver.ts    (NEW)
└── dispatcher.ts       (NEW)
```

### Step 8.3 — Type-check gate
Zero errors.

### Step 8.4 — Migrate 3 Tier 0 rules
Create new versions using `defineAnalysisRule()` with `registerCSSSyntaxAction`.

### Step 8.5 — Create test file
```
test/compilation/phase8.test.ts
```

### Step 8.6 — Test gate + Validation gate
Run BOTH old and new dispatchers on test suite → identical diagnostics. Same rule IDs, file paths, line/column, messages.

### GATE: Phase 8 complete only when Step 8.6 passes. Do not start Phase 9.

---

## Phase 9: Rule Migration

### No new files. Rules re-targeted in `cross-file/rules/` in place.

### Type imports for migrated rules
Rules import types from:
- Tier 0: `compilation/core/css-syntax-tree.ts` (`CSSSyntaxTree`), `compilation/symbols/symbol-table.ts` (`SymbolTable`)
- Tier 1: Above + `compilation/core/solid-syntax-tree.ts` (`SolidSyntaxTree`)
- Tier 2: Above + `compilation/binding/element-builder.ts` (`ElementNode`), `compilation/binding/semantic-model.ts` (`FileSemanticModel`)
- Tier 3: Above + `compilation/analysis/layout-fact.ts` (`LayoutFactMap`, `LayoutFactKind`)
- Tier 4: Above + `compilation/binding/signal-builder.ts` (`SignalSnapshot`), `compilation/analysis/cascade-analyzer.ts` (`ConditionalSignalDelta`), `compilation/binding/cascade-binder.ts` (`ElementCascade`)
- Tier 5: Above + `compilation/analysis/alignment.ts` (`AlignmentContext`, `CohortStats`)

### Step 9.1 — Migrate Tier 1 (11 rules)
jsxNoUndefinedCssClass, cssNoUnreferencedComponentClass, jsxClasslistBooleanValues, jsxClasslistNoAccessorReference, jsxClasslistNoConstantLiterals, jsxClasslistStaticKeys, jsxStyleKebabCaseKeys, jsxStyleNoFunctionValues, jsxStyleNoUnusedCustomProp, jsxLayoutClasslistGeometryToggle, jsxLayoutPictureSourceRatioConsistency

### Step 9.2 — Tier 1 validation gate
Run both dispatchers → zero diagnostic differences for Tier 1 rules.

### Step 9.3 — Migrate Tier 2 (2 rules)
jsxNoDuplicateClassTokenClassClasslist, jsxStylePolicy

### Step 9.4 — Tier 2 validation gate
Zero differences.

### Step 9.5 — Migrate Tier 3 (9 rules)
jsxLayoutFillImageParentMustBeSized, cssLayoutUnsizedReplacedElement, cssLayoutDynamicSlotNoReservedSpace, cssLayoutOverflowAnchorInstability, cssLayoutScrollbarGutterInstability, cssLayoutContentVisibilityNoIntrinsicSize, cssLayoutStatefulBoxModelShift, jsxLayoutUnstableStyleToggle, jsxLayoutPolicyTouchTarget

### Step 9.6 — Tier 3 validation gate
Zero differences.

### Step 9.7 — Migrate Tier 4 (5 rules)
cssLayoutConditionalDisplayCollapse, cssLayoutConditionalOffsetShift, cssLayoutConditionalWhiteSpaceWrapShift, cssLayoutOverflowModeToggleInstability, cssLayoutBoxSizingToggleWithChrome

### Step 9.8 — Tier 4 validation gate
Zero differences.

### Step 9.9 — Migrate Tier 5 (1 rule)
cssLayoutSiblingAlignmentOutlier

### Step 9.10 — Tier 5 validation gate
Zero differences.

### GATE: Phase 9 complete only when ALL 31 rules produce identical diagnostics through both systems. Do not start Phase 10.

---

## Phase 10: Incremental Updates

### Step 10.1 — Read
- `SPEC.ts` section 11 (CompilationTracker — reference only)
- `compilation/core/compilation.ts` — StyleCompilation (wire symbolTable + dependencyGraph getters)
- `compilation/symbols/declaration-table.ts` — DeclarationTable (two-forest pattern)
- `compilation/incremental/dependency-graph.ts` — DependencyGraph
- `packages/ganko/src/cache.ts` — GraphCache (what's being replaced)
- `packages/lsp/src/core/analyze.ts` — diagnostic pipeline

### Step 10.2 — Create files
```
compilation/incremental/
├── tracker.ts              (NEW)
└── change-propagation.ts   (NEW)
```

Also: UPDATE `compilation/core/compilation.ts` to wire symbolTable and dependencyGraph (replace Phase 1 throw stubs with real DeclarationTable + DependencyGraph integration).

### Step 10.3 — Type-check gate
Zero errors.

### Step 10.4 — Create test file
```
test/compilation/phase10.test.ts
```

### Step 10.5 — Test gate + Validation gate
- CSS change → only affected Solid files re-analyzed
- Solid change → only that file invalidated
- Full test suite → zero regressions
- Diagnostic caching works (Constraint 14)

### GATE: Phase 10 complete only when Step 10.5 passes. Do not start Phase 11.

---

## Phase 11: Cleanup

### Step 11.1 — Delete
- `packages/ganko/src/cross-file/` entirely
- `packages/ganko/src/cache.ts`
- SolidGraph class from `solid/impl.ts`
- CSSGraph class from `css/impl.ts`

### Step 11.2 — Retain (do NOT delete)
- `solid/phases/`, `solid/entities/`, `solid/queries/`
- `css/phases/`, `css/entities/`, `css/parser/`
- ALL files in `compilation/` (the new system)

### Step 11.3 — Update
- `packages/lsp/src/core/analyze.ts` → use AnalysisDispatcher exclusively

### Step 11.4 — Type-check gate
```
npx tsc --noEmit
```
Zero errors project-wide.

### Step 11.5 — Validation gate
- Full test suite passes
- `grep -r "cross-file" packages/ganko/src/ --include="*.ts"` returns zero results (no imports from deleted paths)
- Build succeeds
- LSP + CLI produce identical output to pre-cleanup baseline

### GATE: Phase 11 complete. Migration done.
