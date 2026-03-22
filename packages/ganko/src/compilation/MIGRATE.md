# MIGRATE: CSS Single-File Rules → compilation/dispatch/rules/

## Problem

34 CSS single-file rules live in `css/rules/`. They use the old `defineCSSRule` + `check(graph, emit)` pattern where `graph` is `CSSWorkspaceView`. They need to be migrated to `compilation/dispatch/rules/` using `defineAnalysisRule` + `registerCSSSyntaxAction` so the `AnalysisDispatcher` runs them alongside the 31 already-migrated cross-file rules.

## Pattern

Each CSS rule currently:
```typescript
import { defineCSSRule } from "../../rule"
export const ruleName = defineCSSRule({
  id: "rule-id",
  severity: "warn",
  messages: { ... },
  meta: { ... },
  check(graph, emit) {
    // reads graph.declarations, graph.selectors, graph.classNameIndex, etc.
  },
})
```

Migrated version:
```typescript
import { defineAnalysisRule, ComputationTier } from "../rule"
export const ruleName = defineAnalysisRule({
  id: "rule-id",
  severity: "warn",
  messages: { ... },
  meta: { ... },
  requirement: { tier: ComputationTier.CSSSyntax },
  register(registry) {
    registry.registerCSSSyntaxAction((tree, symbolTable, emit) => {
      // reads tree.declarations, tree.selectors, tree.classNameIndex, etc.
    })
  },
})
```

Key difference: `registerCSSSyntaxAction` receives a `CSSSyntaxTree` (per-file), not `CSSWorkspaceView` (all files). Rules that operate per-file work directly. Rules that need workspace-wide data (e.g., all selectors across files) use `registerCompilationAction` instead.

## Rules to Migrate (34)

### A11y (5 rules)
- [ ] `css-no-outline-none-without-focus-visible` (95 lines) — CSSSyntaxAction
- [ ] `css-policy-contrast` (146 lines) — CSSSyntaxAction
- [ ] `css-policy-spacing` (137 lines) — CSSSyntaxAction
- [ ] `css-policy-typography` (146 lines) — CSSSyntaxAction
- [ ] `css-require-reduced-motion-override` (227 lines) — CSSSyntaxAction

### Animation (6 rules)
- [ ] `css-no-discrete-transition` (53 lines) — CSSSyntaxAction
- [ ] `css-no-empty-keyframes` (36 lines) — CSSSyntaxAction
- [ ] `layout-animation-exempt` (209 lines) — helper, not a rule (used by transition/animation rules)
- [ ] `no-layout-property-animation` (99 lines) — CSSSyntaxAction
- [ ] `no-transition-all` (44 lines) — CSSSyntaxAction
- [ ] `no-unknown-animation-name` (38 lines) — CSSSyntaxAction
- [ ] `no-unused-keyframes` (35 lines) — CSSSyntaxAction

### Cascade (4 rules)
- [ ] `declaration-no-overridden-within-rule` (42 lines) — CSSSyntaxAction
- [ ] `media-query-overlap-conflict` (318 lines) — CSSSyntaxAction
- [ ] `no-descending-specificity-conflict` (182 lines) — CSSSyntaxAction or CompilationAction (needs all selectors)
- [ ] `no-layer-order-inversion` (72 lines) — CSSSyntaxAction
- [ ] `no-redundant-override-pairs` (72 lines) — CSSSyntaxAction

### Property (7 rules)
- [ ] `css-no-custom-property-cycle` (101 lines) — CSSSyntaxAction
- [ ] `css-no-hardcoded-z-index` (46 lines) — CSSSyntaxAction
- [ ] `css-no-legacy-vh-100` (43 lines) — CSSSyntaxAction
- [ ] `css-prefer-logical-properties` (50 lines) — CSSSyntaxAction
- [ ] `css-z-index-requires-positioned-context` (49 lines) — CSSSyntaxAction
- [ ] `no-important` (88 lines) — CSSSyntaxAction
- [ ] `no-unresolved-custom-properties` (39 lines) — CSSSyntaxAction
- [ ] `no-unused-custom-properties` (43 lines) — CSSSyntaxAction

### Selector (5 rules)
- [ ] `no-complex-selectors` (40 lines) — CSSSyntaxAction
- [ ] `no-duplicate-selectors` (38 lines) — CompilationAction (needs dedup across files)
- [ ] `no-id-selectors` (36 lines) — CSSSyntaxAction
- [ ] `selector-max-attribute-and-universal` (70 lines) — CSSSyntaxAction
- [ ] `selector-max-specificity` (45 lines) — CSSSyntaxAction

### Structure (3 rules)
- [ ] `css-no-empty-rule` (34 lines) — CSSSyntaxAction
- [ ] `css-no-unknown-container-name` (38 lines) — CSSSyntaxAction or CompilationAction
- [ ] `css-no-unused-container-name` (40 lines) — CSSSyntaxAction or CompilationAction
- [ ] `layer-requirement-for-component-rules` (40 lines) — CSSSyntaxAction

### Helper (not a rule, skip)
- `layout-animation-exempt` — exported helper used by animation rules, stays in css/rules/
- `util` — shared helper, stays in css/rules/

## Execution

1. Read each old rule file in `css/rules/`
2. Create new version in `compilation/dispatch/rules/` using `defineAnalysisRule`
3. Determine dispatch action:
   - Most rules: `registerCSSSyntaxAction` (per-file CSS tree)
   - Rules needing all-files data: `registerCompilationAction` (full compilation)
4. Add each new rule to `compilation/dispatch/rules/index.ts` barrel
5. After all migrated: delete old `css/rules/` files (keep helpers)
6. Update `css/plugin.ts` to not run old CSS rules (they run via dispatcher now)
7. Rebuild, test

## Adaptation Patterns

Old `graph.*` → New via `CSSSyntaxTree tree.*` or `SymbolTable symbolTable.*`:

- `graph.declarations` → `tree.declarations`
- `graph.selectors` → `tree.selectors`
- `graph.rules` → `tree.rules`
- `graph.variables` → `tree.variables`
- `graph.classNameIndex` → `tree.classNameIndex`
- `graph.declarationsByProperty` → `tree.declarationsByProperty`
- `graph.atRulesByKind` → `tree.atRulesByKind`
- `graph.selectorsByPseudoClass` → `tree.selectorsByPseudoClass`
- `graph.duplicateSelectors` → needs CompilationAction (workspace-wide)
- `graph.declarationsForProperties(...)` → iterate `tree.declarationsByProperty`
- `graph.knownKeyframeNames` → needs CompilationAction or symbolTable
- `graph.unresolvedAnimationRefs` → needs CompilationAction
- `graph.emptyRules` → compute from `tree.rules`
- `graph.emptyKeyframes` → compute from tree
- `graph.filesWithLayers` → needs CompilationAction
- `graph.idSelectors` → filter `tree.selectors`
- `graph.importantDeclarations` → filter `tree.declarations`

For workspace-wide fields not on CSSSyntaxTree, use `registerCompilationAction` which receives the full compilation + symbolTable.

## Total: 34 rules (~2800 lines)
