# CSS Subsystem Architecture Overhaul

## Goal
Eliminate redundant parsing, deferred index building, trivial query indirection, and eager index materialization across the CSS analysis subsystem.

---

## Phase 1: Lazy-Compute Derived Indexes
Replace eager `buildDeclarationDerivedIndexes()`, `buildSelectorDerivedIndexes()`, and related methods with lazy getters that materialize on first access.

**Files**: `impl.ts`

- [ ] Identify all derived collections that are simple filter/map of source arrays
- [ ] Replace eager array population with lazy getter pattern (compute on first `.get()` call, cache result)
- [ ] Derived candidates: `colorDeclarations`, `calcDeclarations`, `varDeclarations`, `urlDeclarations`, `vendorPrefixedDeclarations`, `hardcodedColorDeclarations`, `overqualifiedSelectors`, `idSelectors`, `attributeSelectors`, `universalSelectors`, `selectorsTargetingCheckbox`, `selectorsTargetingTableCell`, `deepNestedRules`, `multiDeclarationProperties`, `emptyRules`, `emptyKeyframes`
- [ ] Remove corresponding `build*` methods
- [ ] Verify all rule consumers still work

---

## Phase 2: Single-Pass Selector Parsing
Eliminate the 3rd selector walk (`classifyRuleElementKinds`) by integrating element kind classification into `parseSelectorComplete`.

**Files**: `parser/selector.ts`, `phases/ast.ts`, `impl.ts`

- [ ] Move element kind extraction (tag targets, pseudo-element detection) into `parseSelectorComplete` return value
- [ ] Add `elementKinds` field to `SelectorEntity` populated during AST phase
- [ ] Remove `classifyRuleElementKinds()` from `buildDerivedIndexes()`
- [ ] Update consumers of element kind data

---

## Phase 3: Fold Index Building into AST Phase
Move index construction that iterates rules/selectors/declarations into the AST walk where the data is already being iterated.

**Files**: `phases/ast.ts`, `impl.ts`

- [ ] `declarationsByProperty` — populate during `processDeclaration()` in AST walk
- [ ] `classNameIndex` — populate during selector creation in AST walk
- [ ] `selectorsBySubjectTag` / `selectorsWithoutSubjectTag` — populate during selector creation
- [ ] `layoutPropertiesByClassToken` — populate during selector + declaration processing
- [ ] Remove corresponding `build*` methods from `buildDerivedIndexes()`
- [ ] Remove `buildRuleDeclarationIndexes()`, `buildSelectorDerivedIndexes()` as separate functions

---

## Phase 4: Cross-File Selector Reuse
Build `CompiledSelectorMatcher` from `SelectorEntity.parts`/`.anchor` instead of re-parsing the raw selector string.

**Files**: `cross-file/layout/selector-match.ts`, `cross-file/layout/selector-dispatch.ts`

- [ ] DEFERRED — `SelectorEntity.parts` is flat (no compound boundaries) and pseudo-class
      arguments aren't parsed. Eliminating the cross-file re-parse requires changing the
      CSS parser to output compound-grouped parts with parsed pseudo constraints — a
      separate project. The re-parse already runs once per selector and is cached in
      `selectorMetadataById`, so the performance impact is minimal.
- [ ] Future: Change `parseSelectorComplete()` to return `SelectorCompound[]` with compound boundaries
- [ ] Future: Parse pseudo-class arguments (nth-child, :is, :not) during CSS parsing
- [ ] Future: Store compound-grouped data on `SelectorEntity`, cross-file reads directly

---

## Phase 5: Remove Trivial Query Accessors
Delete `queries/get.ts` one-liner wrappers and update all consumers to access `CSSGraph` fields directly.

**Files**: `queries/get.ts`, all CSS rules, `index.ts`

- [ ] Identify all functions in `queries/get.ts` that are trivial wrappers (field access + empty fallback)
- [ ] Find all callers across rules and other modules
- [ ] Replace each call with direct graph field access
- [ ] Remove `queries/get.ts` or reduce to only non-trivial accessors
- [ ] Update barrel exports

---

## Phase 6: Intern String Consistency
Either commit to full property/value interning or remove the interning infrastructure.

**Files**: `intern.ts`, `phases/ast.ts`

- [x] ASSESSED — Current interning covers all high-value targets: CSS property names,
      variable names, at-rule names. These are the only strings that repeat frequently
      enough to benefit from interning. Selector text and declaration values are
      typically unique. V8 deduplicates short strings internally. No changes needed.

---

## Phase 7: Consolidate Remaining Deferred Index Methods
For index-building methods that can't fold into AST phase (require cross-entity relationships), merge into fewer passes.

**Files**: `impl.ts`, `phases/cascade.ts`

- [ ] Merge `buildKeyframeIndex()` + `buildKeyframeDeclarations()` + `buildKeyframeLayoutMutationsByName()` + `buildEmptyKeyframes()` into single keyframe pass
- [ ] Merge `buildContainerNameIndexes()` + container query detection into single container pass
- [ ] Merge `buildFontFaceDescriptorsByFamily()` + `buildFontFamilyUsageByRule()` into single font pass
- [ ] Reduce total post-phase index methods from 18 to ~6

---

## Verification Strategy
- Run full CSS test suite after each phase
- Run cross-file + integration tests after Phase 4
- Performance test budgets must hold
- No regressions in any rule behavior
