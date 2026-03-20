# CSS Selector Compound Grouping

## Goal
Replace the flat `SelectorEntity.parts: SelectorPart[]` with compound-grouped output from the CSS parser. This eliminates cross-file's redundant selector re-parse (~900 lines in `selector-match.ts`) and the regex-based compound splitting in `no-descending-specificity-conflict.ts`.

---

## Background

The CSS parser (`parseSelectorComplete`) already detects compound boundaries during parsing (via the `inCompound` flag and combinator detection at lines 556-590 of `parser/selector.ts`) but discards this structural information, flattening all parts into a single array. Downstream consumers that need compound-level data must re-parse from the raw selector string.

### Current re-parse sites
1. `cross-file/layout/selector-match.ts:514` — `parseSelectorPattern()` re-parses raw string into `compounds: string[]`, then `compileCompound()` re-parses each compound string (~900 lines total)
2. `css/rules/cascade/no-descending-specificity-conflict.ts:66` — `splitIntoCompounds()` regex-splits raw string into compound segments
3. `css/phases/ast.ts:875` — `buildSelectorAnchor()` calls `extractSubjectCompound()` to re-parse the rightmost compound from the raw string

### Current consumers of `SelectorEntity.parts` (flat)
1. `css/impl.ts:292` — `overqualifiedSelectors` getter: linear scan for ID + qualifier patterns
2. `css/impl.ts:384` — `addSelector()`: linear scan for class names → `classNameIndex`
3. `css/queries/semantic.ts:18` — utility class detection: linear scan for class parts
4. `css/rules/cascade/no-descending-specificity-conflict.ts:29` — validates part types before regex compound split

---

## New Type: `SelectorCompound`

```typescript
export interface SelectorCompound {
  readonly parts: readonly SelectorPart[]
  readonly tagName: string | null
  readonly idValue: string | null
  readonly classes: readonly string[]
  readonly attributes: readonly SelectorAttributeConstraint[]
  readonly pseudoClasses: readonly ParsedPseudoConstraint[]
}

export interface ParsedPseudoConstraint {
  readonly name: string
  readonly raw: string
  readonly kind: PseudoConstraintKind
  readonly nthPattern: NthPattern | null
  readonly nestedCompounds: readonly SelectorCompound[][] | null
}

export const enum PseudoConstraintKind {
  Simple = 0,       // :hover, :focus, :checked, etc.
  FirstChild = 1,
  LastChild = 2,
  OnlyChild = 3,
  NthChild = 4,     // :nth-child(An+B)
  NthLastChild = 5,
  NthOfType = 6,
  NthLastOfType = 7,
  MatchesAny = 8,   // :is(), :where()
  NoneOf = 9,       // :not()
}

export interface NthPattern {
  readonly step: number
  readonly offset: number
}
```

---

## Phase 1: Change CSS Parser Output
Modify `parseSelectorComplete()` to return `SelectorCompound[]` instead of flat `SelectorPart[]`.

**Files**: `parser/selector.ts`, `entities/selector.ts`

- [ ] Add `SelectorCompound`, `ParsedPseudoConstraint`, `PseudoConstraintKind`, `NthPattern` to `entities/selector.ts`
- [ ] In `parseSelectorComplete()`: instead of pushing to flat `parts[]`, accumulate parts per-compound. When a combinator is detected (existing `inCompound` logic), finalize the current compound and start a new one
- [ ] Extract `tagName`, `idValue`, `classes`, `attributes` from each compound's parts during accumulation (same logic as current `compileCompound` in selector-match.ts)
- [ ] Parse pseudo-class arguments during accumulation: `:nth-child(An+B)` → `NthPattern`, `:is()`/`:not()` → recursively parsed nested compounds
- [ ] Change return type: `{ compounds: readonly SelectorCompound[], combinators: readonly CombinatorType[], specificity, complexity }`
- [ ] Keep `parts` as a derived flat view for backwards compatibility during migration (computed from compounds)

---

## Phase 2: Update `SelectorEntity`
Replace flat parts with compound-grouped data.

**Files**: `entities/selector.ts`, `phases/ast.ts`

- [ ] Change `SelectorEntity.parts` to `SelectorEntity.compounds: readonly SelectorCompound[]`
- [ ] Add `SelectorEntity.combinators: readonly CombinatorType[]` (move from complexity)
- [ ] Remove `SelectorComplexity.combinators` (now on entity directly)
- [ ] Update `createSelectorEntity()` in `phases/ast.ts` to use new parser output
- [ ] Derive `SelectorEntity.anchor` directly from `compounds[compounds.length - 1]` (subject compound) — eliminate `buildSelectorAnchor()` and `extractSubjectCompound()`
- [ ] Add `idValue` to `SelectorAnchor` (currently missing, needed by cross-file)

---

## Phase 3: Update Flat-Parts Consumers
Migrate consumers from `selector.parts` (flat) to `selector.compounds` (grouped).

**Files**: `impl.ts`, `queries/semantic.ts`, `rules/cascade/no-descending-specificity-conflict.ts`

### `impl.ts` — `addSelector()` class name indexing
```
// Before: iterate flat parts for classes
for (const part of selector.parts) { if (part.type === "class") ... }

// After: iterate compounds, each has .classes
for (const compound of selector.compounds) {
  for (const cls of compound.classes) { ... }
}
```

### `impl.ts` — `overqualifiedSelectors` getter
```
// Before: linear scan of flat parts
// After: check subject compound for id + qualifier
```

### `queries/semantic.ts` — utility class detection
```
// Before: iterate flat parts for class type
// After: iterate compounds, each has .classes
```

### `no-descending-specificity-conflict.ts` — compound splitting
```
// Before: regex split raw string into compound segments
// After: use selector.compounds directly — no regex, no re-parse
```

---

## Phase 4: Rewrite Cross-File Selector Matcher
Build `CompiledSelectorMatcher` directly from `SelectorEntity.compounds` instead of re-parsing the raw string.

**Files**: `cross-file/layout/selector-match.ts`

- [ ] Rewrite `compileSelectorMatcher(selector)`:
  ```
  // Before:
  const parsed = parseSelectorPattern(selector.raw)  // ~80 lines of re-parsing
  for (compound of parsed.compounds) {
    compileCompound(compound)                         // ~130 lines per compound
  }

  // After:
  for (compound of selector.compounds) {
    buildCompiledCompound(compound)                   // Direct field mapping
  }
  ```
- [ ] `buildCompiledCompound(compound: SelectorCompound) → CompiledSelectorCompound`:
  - `tagName` ← `compound.tagName`
  - `idValue` ← `compound.idValue`
  - `classes` ← `compound.classes`
  - `attributes` ← `compound.attributes`
  - `pseudo` ← map `compound.pseudoClasses` → `CompoundPseudoConstraints`
- [ ] Map `ParsedPseudoConstraint` → `CompoundPseudoConstraints`:
  - `PseudoConstraintKind.FirstChild` → `pseudo.firstChild = true`
  - `PseudoConstraintKind.NthChild` → `pseudo.nthChild = constraint.nthPattern`
  - `PseudoConstraintKind.MatchesAny` → `pseudo.anyOfGroups` (recursively build from `nestedCompounds`)
  - `PseudoConstraintKind.NoneOf` → `pseudo.noneOfGroups`
- [ ] Delete `parseSelectorPattern()`, `compileCompound()`, `parseCompoundParts()`, `parsePseudoConstraint()`, `compileFunctionalPseudoArguments()`, and all supporting functions (~900 lines)
- [ ] `combinatorsRightToLeft` ← `selector.combinators.toReversed()`

---

## Phase 5: Eliminate `buildSelectorAnchor()`
Subject compound data is now directly available from `selector.compounds`.

**Files**: `phases/ast.ts`

- [ ] Replace `buildSelectorAnchor(raw, parts, combinators)` with direct read from subject compound:
  ```
  const subject = compounds[compounds.length - 1]
  anchor = {
    subjectTag: subject.tagName,
    idValue: subject.idValue,    // NEW field
    classes: subject.classes,
    attributes: subject.attributes,
    includesDescendantCombinator: combinators.includes("descendant"),
    ...
  }
  ```
- [ ] Delete `buildSelectorAnchor()`, `extractSubjectCompound()`, `extractSubjectCompoundParts()` (~70 lines)

---

## Phase 6: Cleanup
Remove dead code and update exports.

**Files**: `selector-match.ts`, `entities/selector.ts`, `entities/index.ts`, barrel exports

- [ ] Remove `SelectorComplexity.combinators` field (moved to entity level)
- [ ] Remove backwards-compatibility flat `parts` if all consumers migrated
- [ ] Export new types from barrel: `SelectorCompound`, `ParsedPseudoConstraint`, `PseudoConstraintKind`, `NthPattern`
- [ ] Update cross-file barrel exports

---

## Verification Strategy
- Run full CSS test suite after Phase 1-2 (parser change + entity change)
- Run cross-file + integration tests after Phase 3-4 (consumer migration + matcher rewrite)
- Run `layout-selector-dispatch-parity.test.ts` specifically — it verifies selector matching produces identical results between the dispatch path and brute-force path
- Performance test budgets must hold

## Risk Assessment
- **Phase 1** (parser change): MEDIUM risk — well-contained but complex parsing logic
- **Phase 2** (entity change): LOW risk — type-level change with compiler enforcement
- **Phase 3** (flat consumer migration): LOW risk — mechanical, compiler-guided
- **Phase 4** (matcher rewrite): HIGH risk — the selector matcher is the most complex single module. Existing `layout-selector-dispatch-parity.test.ts` provides safety net
- **Phase 5** (anchor elimination): LOW risk — straightforward after Phase 2

## Estimated Impact
- ~900 lines deleted from `selector-match.ts` (the entire internal re-parsing pipeline)
- ~70 lines deleted from `phases/ast.ts` (anchor extraction)
- ~20 lines deleted from `no-descending-specificity-conflict.ts` (regex compound splitting)
- One fewer full selector parse per build (~N selectors × parse time eliminated)
- Compound-grouped data available to all future consumers without re-parsing
