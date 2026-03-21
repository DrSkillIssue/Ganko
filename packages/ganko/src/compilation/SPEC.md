# StyleCompilation Architecture Specification

## Part 1: Architecture

### 1. StyleCompilation

#### What it replaces

The current system maintains three separate graph objects: `SolidGraph` (one per `.tsx` file, holding all parsed entities and reactive indexes), `CSSGraph` (one workspace-wide monolith holding all CSS files' parsed entities and cross-file indexes), and `LayoutGraph` (a cross-file bridge computing selector matching, cascade, signal snapshots, layout facts, and alignment analysis from the other two). These three objects are constructed independently, stored in a three-level `GraphCache` with generation counters, and connected only when `buildLayoutGraph(solids, css)` imperatively fuses them.

This is architecturally wrong for the same reason Roslyn doesn't have a "SourceGraph" and a "MetadataGraph" that get merged. Roslyn has ONE `CSharpCompilation` that owns all syntax trees and all metadata references. Its `AddSyntaxTrees()`, `WithReferences()`, and `ReplaceSyntaxTree()` methods return new immutable instances that structurally share unchanged data. The compilation produces ONE symbol table (`GlobalNamespace`) where `SourceNamedTypeSymbol` and `PENamedTypeSymbol` coexist as peers.

`StyleCompilation` is the single immutable object that replaces all three graphs. It owns Solid syntax trees, CSS syntax trees, additional inputs (Tailwind config, package manifest, tsconfig), and the merged symbol table. Every mutation returns a new instance. The old instance stays valid. Unchanged trees and symbol contributions are structurally shared.

```typescript
interface StyleCompilation {
  readonly id: number;

  // Syntax trees — the compilation's inputs
  readonly solidTrees: ReadonlyMap<string, SolidSyntaxTree>;
  readonly cssTrees: ReadonlyMap<string, CSSSyntaxTree>;

  // Additional inputs (like Roslyn's AdditionalText)
  readonly tailwindConfig: TailwindConfigInput | null;
  readonly packageManifest: PackageManifestInput | null;
  readonly tsConfig: TSConfigInput | null;

  // Symbol table — lazy, cached (like Roslyn's GlobalNamespace)
  readonly symbolTable: SymbolTable;

  // Dependency graph — first-class
  readonly dependencyGraph: DependencyGraph;

  // Mutation methods — return NEW immutable instances
  withSolidTree(tree: SolidSyntaxTree): StyleCompilation;
  withCSSTree(tree: CSSSyntaxTree): StyleCompilation;
  withCSSTrees(trees: readonly CSSSyntaxTree[]): StyleCompilation;
  withoutFile(filePath: string): StyleCompilation;
  withFile(filePath: string, tree: SolidSyntaxTree | CSSSyntaxTree): StyleCompilation;
  withTailwindConfig(config: TailwindConfigInput | null): StyleCompilation;

  // Queries
  getSolidTree(filePath: string): SolidSyntaxTree | null;
  getCSSTree(filePath: string): CSSSyntaxTree | null;
  getSemanticModel(solidFilePath: string): FileSemanticModel;
}
```

#### Design decisions

The compilation's `id` is a monotonic integer used by the `CompilationTracker` to detect stale semantic models. The `symbolTable` property is lazy — materialized on first access by merging contributions from all CSS syntax trees and the Tailwind provider. Subsequent accesses return the cached result. When `withCSSTree()` creates a new compilation, the new instance's symbol table is a new lazy thunk that merges the previous table's cached contributions with only the new tree's contribution — Roslyn's `DeclarationTable` two-forest pattern.

`withFile` determines file type from the tree's `kind` discriminant, not from the path extension, because a future CSS-in-JS provider might produce a `CSSSyntaxTree` from a `.ts` file.

The `getSemanticModel(solidFilePath)` method creates (or returns cached) a `FileSemanticModel` that is a per-file VIEW into the compilation's symbol table. The compilation caches semantic models by file path. When `withFile` creates a new compilation, models for files not affected by the change (per the dependency graph) transfer to the new compilation unchanged.

---

### 2. Syntax Trees

#### What they replace

`SolidSyntaxTree` replaces the syntax-level data currently stored in `SolidGraph`: the 31 entity collections (scopes, variables, functions, calls, JSX elements, imports, exports, classes, properties, computations, dependency edges, ownership edges, etc.) and the 25+ syntax-level indexes (variablesByName, functionsByNode, jsxByTag, staticClassTokensByElementId, etc.). Everything that the 9 parse phases produce is syntax.

`CSSSyntaxTree` replaces the per-file portion of `CSSGraph`'s parse output. Currently `CSSGraph` is a monolith — one object across all CSS files. The new system is per-file: each CSS file produces one `CSSSyntaxTree` containing its rules, selectors, declarations, variables, variable references, at-rules, tokens, mixins, functions, placeholders, extends, and per-file indexes. The workspace-wide indexes (classNameIndex, selectorsBySubjectTag, declarationsByProperty) that currently live on `CSSGraph` move into the symbol table.

```typescript
interface SolidSyntaxTree {
  readonly kind: "solid";
  readonly filePath: string;
  readonly version: string;
  readonly sourceFile: ts.SourceFile;
  readonly comments: readonly CommentEntry[];
  readonly typeResolver: TypeResolver;
  readonly fileEntity: FileEntity;

  // All 31 entity collections — unchanged from SolidGraph
  readonly scopes: readonly ScopeEntity[];
  readonly variables: readonly VariableEntity[];
  readonly functions: readonly FunctionEntity[];
  readonly calls: readonly CallEntity[];
  readonly jsxElements: readonly JSXElementEntity[];
  readonly imports: readonly ImportEntity[];
  readonly exports: readonly ExportEntity[];
  readonly classes: readonly ClassEntity[];
  readonly properties: readonly PropertyEntity[];
  readonly propertyAssignments: readonly PropertyAssignmentEntity[];
  readonly conditionalSpreads: readonly ConditionalSpreadEntity[];
  readonly objectSpreads: readonly ObjectSpreadEntity[];
  readonly nonNullAssertions: readonly NonNullAssertionEntity[];
  readonly typeAssertions: readonly TypeAssertionEntity[];
  readonly typePredicates: readonly TypePredicateEntity[];
  readonly unsafeGenericAssertions: readonly UnsafeGenericAssertionEntity[];
  readonly unsafeTypeAnnotations: readonly UnsafeTypeAnnotationEntity[];
  readonly inlineImports: readonly InlineImportEntity[];
  readonly computations: readonly ComputationEntity[];
  readonly dependencyEdges: readonly DependencyEdge[];
  readonly ownershipEdges: readonly OwnershipEdge[];

  // All syntax-level indexes — unchanged from SolidGraph
  readonly variablesByName: ReadonlyMap<string, readonly VariableEntity[]>;
  readonly functionsByNode: ReadonlyMap<ts.Node, FunctionEntity>;
  readonly functionsByDeclarationNode: ReadonlyMap<ts.Node, FunctionEntity>;
  readonly functionsByName: ReadonlyMap<string, readonly FunctionEntity[]>;
  readonly callsByNode: ReadonlyMap<ts.CallExpression | ts.NewExpression, CallEntity>;
  readonly callsByPrimitive: ReadonlyMap<string, readonly CallEntity[]>;
  readonly callsByMethodName: ReadonlyMap<string, readonly CallEntity[]>;
  readonly callsByArgNode: ReadonlyMap<ts.Node, ArgumentEntity>;
  readonly jsxByNode: ReadonlyMap<ts.Node, JSXElementEntity>;
  readonly jsxByTag: ReadonlyMap<string, readonly JSXElementEntity[]>;
  readonly jsxAttributesByElementId: ReadonlyMap<number, ReadonlyMap<string, JSXAttributeEntity>>;
  readonly jsxAttrsByKind: ReadonlyMap<JSXAttributeKind, readonly JSXAttributeWithElement[]>;
  readonly jsxClassAttributes: readonly JSXAttributeWithElement[];
  readonly jsxClassListAttributes: readonly JSXAttributeWithElement[];
  readonly jsxStyleAttributes: readonly JSXAttributeWithElement[];
  readonly fillImageElements: readonly JSXElementEntity[];
  readonly staticClassTokensByElementId: ReadonlyMap<number, JSXStaticClassIndex>;
  readonly staticClassListKeysByElementId: ReadonlyMap<number, JSXStaticObjectKeyIndex>;
  readonly staticStyleKeysByElementId: ReadonlyMap<number, JSXStaticObjectKeyIndex>;
  readonly classListProperties: readonly JSXObjectPropertyWithElement[];
  readonly styleProperties: readonly JSXObjectPropertyWithElement[];
  readonly inlineStyleClassNames: ReadonlySet<string>;
  readonly importsBySource: ReadonlyMap<string, readonly ImportEntity[]>;
  readonly exportsByName: ReadonlyMap<string, ExportEntity>;
  readonly exportsByEntityId: ReadonlyMap<number, ExportEntity>;
  readonly classesByNode: ReadonlyMap<ts.ClassDeclaration | ts.ClassExpression, ClassEntity>;
  readonly classesByName: ReadonlyMap<string, readonly ClassEntity[]>;

  // Reactive categorization — still syntax (built by reactivity phase)
  readonly componentScopes: ReadonlyMap<ScopeEntity, { readonly scope: ScopeEntity; readonly name: string }>;
  readonly componentFunctions: readonly FunctionEntity[];
  readonly reactiveVariables: readonly VariableEntity[];
  readonly propsVariables: readonly VariableEntity[];
  readonly storeVariables: readonly VariableEntity[];
  readonly resourceVariables: readonly VariableEntity[];
  readonly computationByCallId: ReadonlyMap<number, ComputationEntity>;
}

interface CSSSyntaxTree {
  readonly kind: "css";
  readonly filePath: string;
  readonly version: string;
  readonly isScss: boolean;

  readonly file: CSSFileEntity;
  readonly rules: readonly CSSRuleEntity[];
  readonly selectors: readonly CSSSelectorEntity[];
  readonly declarations: readonly CSSDeclarationEntity[];
  readonly variables: readonly CSSVariableEntity[];
  readonly variableRefs: readonly CSSVariableReferenceEntity[];
  readonly atRules: readonly CSSAtRuleEntity[];
  readonly tokens: readonly CSSThemeTokenEntity[];

  // SCSS entities (empty arrays for plain CSS)
  readonly mixins: readonly CSSMixinEntity[];
  readonly includes: readonly CSSMixinIncludeEntity[];
  readonly functions: readonly CSSFunctionEntity[];
  readonly functionCalls: readonly CSSFunctionCallEntity[];
  readonly placeholders: readonly CSSPlaceholderEntity[];
  readonly extends: readonly CSSExtendEntity[];
  readonly parseErrors: readonly CSSParseError[];

  // Per-file indexes
  readonly rulesBySelector: ReadonlyMap<string, readonly CSSRuleEntity[]>;
  readonly rulesByNode: ReadonlyMap<PostCSSRule, CSSRuleEntity>;
  readonly variablesByName: ReadonlyMap<string, readonly CSSVariableEntity[]>;
  readonly declarationsByProperty: ReadonlyMap<string, readonly CSSDeclarationEntity[]>;
  readonly atRulesByKind: ReadonlyMap<CSSAtRuleKind, readonly CSSAtRuleEntity[]>;
  readonly classNameIndex: ReadonlyMap<string, readonly CSSSelectorEntity[]>;
  readonly selectorsBySubjectTag: ReadonlyMap<string, readonly CSSSelectorEntity[]>;
  readonly selectorsByPseudoClass: ReadonlyMap<string, readonly CSSSelectorEntity[]>;

  readonly sourceOrderBase: number;
}
```

#### Design decisions

`SolidSyntaxTree` is the exact same shape as `SolidGraph`'s readonly fields. During migration Phase 1, `solidGraphToSyntaxTree(graph)` wraps an existing `SolidGraph` as a zero-copy view — the interface fields point to the same underlying arrays. No data is copied, no parse work is duplicated. After migration, the `SolidGraph` class is deleted and the parse phases directly produce a `SolidSyntaxTree`.

`CSSSyntaxTree` is per-file, unlike the current monolithic `CSSGraph`. The workspace-wide indexes that `CSSGraph` currently maintains (classNameIndex across all files, declarationsByProperty across all files, duplicateSelectors across all files) are NOT on the syntax tree — they belong in the symbol table, which merges contributions from all trees.

`sourceOrderBase` is assigned by the compilation when a tree is inserted. It ensures that source order comparisons during cascade sort are stable across trees without requiring a global counter — tree A's base might be 0, tree B's base 1000. Each declaration's `sourceOrder` is `sourceOrderBase + localOrder`.

Adding a new CSS tree to the compilation does NOT reparse existing trees. The new compilation structurally shares the old compilation's `cssTrees` map with one entry replaced. The symbol table is a new lazy thunk.

---

### 3. Merged Symbol Table

#### What it replaces

Currently, class name lookup requires checking `CSSGraph.classNameIndex` (CSS selectors by class name) AND `CSSGraph.tailwind.has()` (Tailwind utility validation) as two separate code paths. Selector dispatch requires building `scopedSelectorsBySolidFile` from scratch in `buildScopedSelectorIndexBySolidFile`. Custom property resolution requires `CSSGraph.variablesByName`. All three graphs maintain separate, overlapping indexes.

The symbol table unifies all of these. Like Roslyn's `GlobalNamespace` where `SourceNamedTypeSymbol` (from `.cs` files) and `PENamedTypeSymbol` (from `.dll` metadata) coexist as peers, `ClassNameSymbol` from a CSS `.btn` selector and `ClassNameSymbol` from a Tailwind `flex` utility coexist as peers in one table. Code that checks "is this class name defined?" asks the symbol table once.

```typescript
interface SymbolTable {
  readonly classNames: ReadonlyMap<string, ClassNameSymbol>;
  readonly selectors: ReadonlyMap<number, SelectorSymbol>;
  readonly customProperties: ReadonlyMap<string, CustomPropertySymbol>;
  readonly keyframes: ReadonlyMap<string, KeyframesSymbol>;
  readonly fontFaces: ReadonlyMap<string, readonly FontFaceSymbol[]>;
  readonly layers: ReadonlyMap<string, LayerSymbol>;
  readonly containers: ReadonlyMap<string, ContainerSymbol>;

  // Dispatch indexes
  readonly selectorsByDispatchKey: ReadonlyMap<string, readonly SelectorSymbol[]>;
  readonly selectorsBySubjectTag: ReadonlyMap<string, readonly SelectorSymbol[]>;
  readonly selectorsWithoutSubjectTag: readonly SelectorSymbol[];
  readonly declarationsByProperty: ReadonlyMap<string, readonly DeclarationSymbol[]>;

  hasClassName(name: string): boolean;
  getClassName(name: string): ClassNameSymbol | null;
  getCustomProperty(name: string): CustomPropertySymbol | null;
}

interface ClassNameSymbol {
  readonly name: string;
  readonly source: CSSClassNameSource | TailwindClassNameSource;
}

interface CSSClassNameSource {
  readonly kind: "css";
  readonly selectors: readonly CSSSelectorEntity[];
  readonly filePaths: readonly string[];
}

interface TailwindClassNameSource {
  readonly kind: "tailwind";
  readonly candidate: TailwindParsedCandidate;
  readonly resolvedCSS: string | null;
  readonly declarations: readonly TailwindResolvedDeclaration[];
  readonly diagnostics: readonly TailwindCandidateDiagnostic[];
}

interface SelectorSymbol {
  readonly entity: CSSSelectorEntity;
  readonly specificity: readonly [number, number, number];
  readonly sourceOrder: number;
  readonly dispatchKeys: readonly string[];
  readonly compiledMatcher: CompiledSelectorMatcher | null;
}

interface CustomPropertySymbol {
  readonly name: string;
  readonly definitions: readonly CSSVariableEntity[];
  readonly isGlobal: boolean;
}

interface DeclarationTable {
  readonly generation: number;
  withTree(tree: CSSSyntaxTree): DeclarationTable;
  withoutTree(filePath: string): DeclarationTable;
  withTailwindSymbols(symbols: TailwindSymbolContribution): DeclarationTable;
  materialize(): SymbolTable;
}
```

#### Design decisions

The `DeclarationTable` implements Roslyn's two-forest merge pattern. It maintains two pools: "older" contributions (cached from previous materializations) and the "latest" contribution (from the most recently added/changed tree). `materialize()` merges only the latest into the cached older pool. This means adding one CSS file to a 200-file project does NOT re-process contributions from the other 199 files.

`ClassNameSymbol` uses a discriminated union for its source. When a rule asks `symbolTable.hasClassName("flex")`, it gets back a symbol. If the rule needs to know whether it came from CSS or Tailwind, it checks `symbol.source.kind`. Most rules don't care — they just need to know the name is defined.

`SelectorSymbol` wraps `CSSSelectorEntity` (which stays as-is) with compilation-level metadata: the pre-compiled matcher function and dispatch keys. These are computed once when the symbol is created and cached for the lifetime of the compilation.

The symbol table does NOT store component hosts. Component host resolution is a binding-layer operation that requires following import edges and parsing target files — it belongs in the `FileSemanticModel`, not in the syntax-derived symbol table.

---

### 4. CSS Source Providers

#### What they replace

Currently, CSS parsing is monolithic: `buildCSSGraph()` takes a flat array of `{ path, content }` pairs, runs PostCSS on all of them, and produces one `CSSGraph`. SCSS detection is a flag. Tailwind is a separate `TailwindValidator` bolted on as a nullable field. There's no abstraction for "different kinds of CSS inputs produce the same output."

Providers make this pluggable. Like Roslyn's distinction between source references (`.cs` files) and metadata references (`.dll` assemblies) that both produce symbols in the same namespace, providers let plain CSS, SCSS, and Tailwind all produce `CSSSyntaxTree` and symbol contributions through a uniform interface.

```typescript
interface CSSSourceProvider {
  readonly kind: string;
  parse(filePath: string, content: string, sourceOrderBase: number): CSSSyntaxTree;
  extractSymbols(tree: CSSSyntaxTree): CSSSymbolContribution;
}

interface CSSSymbolContribution {
  readonly classNames: ReadonlyMap<string, CSSClassNameSource>;
  readonly selectors: readonly SelectorSymbol[];
  readonly customProperties: readonly CustomPropertySymbol[];
  readonly keyframes: readonly KeyframesSymbol[];
  readonly fontFaces: readonly FontFaceSymbol[];
  readonly layers: readonly LayerSymbol[];
}

interface TailwindProvider {
  readonly kind: "tailwind";
  has(className: string): boolean;
  resolve(className: string): TailwindResolution | null;
  parseCandidate(candidate: string): TailwindCandidateResult;
  getSymbolContribution(): TailwindSymbolContribution;
}

interface TailwindParsedCandidate {
  readonly raw: string;
  readonly variants: readonly TailwindParsedVariant[];
  readonly utility: string;
  readonly value: TailwindCandidateValue | null;
  readonly modifier: TailwindCandidateModifier | null;
  readonly important: boolean;
  readonly negative: boolean;
}

interface TailwindResolution {
  readonly candidate: TailwindParsedCandidate;
  readonly css: string;
  readonly declarations: readonly TailwindResolvedDeclaration[];
}
```

#### Design decisions

`PlainCSSProvider` wraps the existing PostCSS parse pipeline — the 6 phases from `css/phases/` that produce per-file entities. The implementation doesn't change; only the output wrapper changes from "accumulate into monolithic CSSGraph" to "return a CSSSyntaxTree."

`SCSSProvider` wraps PostCSS-SCSS and additionally produces mixin/function/placeholder entities. It uses the same `CSSSourceProvider` interface — the syntax tree just has non-empty mixin/function/placeholder arrays.

`TailwindProvider` is not a `CSSSourceProvider` because it doesn't parse files — it produces symbols from a design system. It replicates Tailwind v4's exact candidate parsing algorithm: segment by colon to extract variants, permutation root matching against registered utilities, arbitrary value/modifier parsing with bracket balancing, variant registry lookup (static, functional, compound, arbitrary), and theme token resolution via CSS variable namespaces. The `TailwindParsedCandidate` structure carries the full parse tree, not a boolean.

Future providers (CSS-in-JS extractors, Lightning CSS) implement `CSSSourceProvider` and plug in without touching the compilation or symbol table.

---

### 5. Dependency Graph

#### What it replaces

Currently, CSS scope resolution happens in `cross-file/layout/scope.ts` via `collectCSSScopeBySolidFile()`. This function performs four operations imperatively each time the LayoutGraph is built: (1) find co-located CSS (foo.tsx → foo.css), (2) walk JS import chains to find CSS imports and their transitive @import chains, (3) walk component import chains to find component-colocated CSS, (4) collect global side-effect CSS. There is no persistent graph — this is recomputed from scratch.

Cache invalidation in `GraphCache` uses blunt generation counters: any CSS file change bumps `cssGeneration`, invalidating the entire CSSGraph and LayoutGraph. Any Solid file change bumps `solidGeneration`, invalidating only that file's SolidGraph but still invalidating the entire LayoutGraph.

The dependency graph replaces both. It is a first-class, incrementally maintained graph inside the compilation. Edges represent import relationships and co-location. CSS scope is the transitive closure of reachable CSS files. Change propagation follows reverse edges — when a CSS file changes, only Solid files that import it (transitively) need semantic model rebinding.

```typescript
interface DependencyGraph {
  getDirectDependencies(filePath: string): readonly DependencyEdge[];
  getReverseDependencies(filePath: string): readonly string[];
  getCSSScope(solidFilePath: string): readonly string[];
  getTransitivelyAffected(filePath: string): readonly string[];
  isInCSSScope(solidFilePath: string, cssFilePath: string): boolean;
}

interface DependencyEdge {
  readonly target: string;
  readonly kind: "js-import" | "css-import" | "css-at-import" | "colocated" | "global-side-effect";
}
```

#### Design decisions

The dependency graph is built from syntax trees' import declarations and co-location heuristics. It is immutable — when the compilation changes via `withFile()`, the new compilation gets a new dependency graph that shares unchanged edges.

`getCSSScope(solidFilePath)` replaces `collectCSSScopeBySolidFile` exactly. It computes the same result — transitive closure of CSS file reachability from a Solid file via import chains, co-location, and component imports. But unlike the old function which recomputes from scratch, the dependency graph caches scope results per compilation instance.

`getTransitivelyAffected(filePath)` is the key for incremental updates. When CSS file `X` changes, this returns all Solid files whose CSS scope includes `X`. Only those files need their semantic models invalidated. If `X` is imported by only 3 of 200 Solid files, only 3 models are invalidated instead of all 200.

The module resolver logic from `module-resolver.ts` (package.json exports resolution, Solid/CSS extension probing, partial file resolution) moves into the dependency graph builder unchanged.

---

### 6. SemanticModel

#### What it replaces

`FileSemanticModel` replaces the monolithic `LayoutGraph` for per-file queries. Currently, to get the cascade for an element, you index into `LayoutGraph.records.get(elementNode).cascade`. To check CSS scope, you index into `LayoutGraph.cssScopeBySolidFile.get(solidFile)`. To get alignment context, you index into `LayoutGraph.contextByParentNode.get(parentNode)`. All of these require the LayoutGraph to be fully built — even if you only need one element's cascade, all elements get computed.

`FileSemanticModel` is a lazy, per-file view. Like Roslyn's `SemanticModel` which delegates to the compilation's symbol table for cross-file resolution, `FileSemanticModel` delegates to the compilation's symbol table and dependency graph. Queries are computed on demand and cached.

```typescript
interface FileSemanticModel {
  readonly filePath: string;
  readonly compilation: StyleCompilation;
  readonly solidTree: SolidSyntaxTree;

  // Element queries (Tier 2-5) — replace LayoutGraph.records[]
  getElementNode(elementId: number): ElementNode | null;
  getElementNodes(): readonly ElementNode[];
  getElementCascade(elementId: number): ElementCascade;
  getMatchingSelectors(elementId: number): readonly SelectorMatch[];
  getComponentHost(importSource: string, exportName: string): ComponentHostDescriptor | null;
  getSignalSnapshot(elementId: number): SignalSnapshot;
  getLayoutFact<K extends LayoutFactKind>(elementId: number, factKind: K): LayoutFactMap[K];
  getConditionalDelta(elementId: number): ReadonlyMap<string, ConditionalSignalDelta> | null;

  // Symbol queries (Tier 1) — replace cross-file/queries.ts
  getClassNameInfo(name: string): ClassNameSymbol | null;
  getCustomPropertyResolution(name: string): CustomPropertyResolution;
  getSelectorOverrides(selectorId: number): readonly SelectorSymbol[];

  // Scope queries (Tier 1) — replace LayoutGraph.cssScopeBySolidFile
  getScopedCSSFiles(): readonly string[];
  getScopedSelectors(): ScopedSelectorIndex;

  // Reactive queries (Tier 0) — delegate to syntax tree
  getReactiveKind(variable: VariableEntity): ReactiveKind | null;
  getDependencyEdges(computation: ComputationEntity): readonly DependencyEdge[];

  // Alignment queries (Tier 5) — replace LayoutGraph.cohortStatsByParentNode
  getAlignmentContext(parentElementId: number): AlignmentContext | null;
  getCohortStats(parentElementId: number): CohortStats | null;

  // Specialized indexes — computed lazily on first access
  getElementsWithConditionalDelta(signal: string): readonly ElementNode[];
  getScrollContainerElements(): readonly ElementNode[];
  getDynamicSlotCandidates(): readonly ElementNode[];
  getElementsByTagName(tag: string): readonly ElementNode[];
}
```

#### Design decisions

The semantic model does NOT eagerly build all element nodes. `getElementNodes()` is lazy — first call builds the element tree (tag resolution, parent-child wiring, class token extraction, sibling indexing) from the `SolidSyntaxTree`'s JSX entities. Subsequent calls return the cached result. `getElementCascade(elementId)` triggers cascade binding only for that one element — it does NOT compute cascade for all elements.

This laziness is the core architectural win over the old system. The old `buildLayoutGraph` performs 9 sequential steps across ALL elements: selector compilation → scope collection → selector indexing → element collection → candidate assignment → cascade → signals → facts → alignment. If a rule only needs Tier 1 data (class name lookups), none of those 9 steps execute.

The semantic model internally tracks which computation tiers have been triggered, to avoid redundant work when multiple Tier 3 queries hit the same element.

---

### 7. Cascade Binding

#### What it replaces

`cascade-builder.ts` currently builds the cascade imperatively for ALL elements in a single pass through `buildCascadeMapForElement()`, called inside the `buildLayoutGraph` loop. For each element, it: collects selector candidate IDs from the dispatch index, matches each selector against the element, collects monitored declarations from matching selectors, sorts by cascade precedence (importance → layer → specificity → source order), applies inline style overrides, and optionally merges Tailwind utility declarations.

The cascade binder performs the identical operations but LAZILY — per element, on demand, cached.

```typescript
interface CascadeBinder {
  bind(element: ElementNode, scopedSelectors: ScopedSelectorIndex, symbolTable: SymbolTable): ElementCascade;
}

interface ElementCascade {
  readonly elementId: number;
  readonly declarations: ReadonlyMap<string, CascadedDeclaration>;
  readonly edges: readonly SelectorMatch[];
}

interface CascadedDeclaration {
  readonly value: string;
  readonly source: SignalSource;
  readonly guardProvenance: RuleGuard;
}

interface ScopedSelectorIndex {
  readonly byDispatchKey: ReadonlyMap<string, readonly SelectorSymbol[]>;
  readonly byTagName: ReadonlyMap<string, readonly SelectorSymbol[]>;
  readonly unconstrained: readonly SelectorSymbol[];
  readonly requirements: { readonly needsClassTokens: boolean; readonly needsAttributes: boolean };
}
```

#### Design decisions

`getElementCascade(elementId)` in the semantic model invokes the cascade binder with this sequence:

1. **Scope resolution**: `compilation.dependencyGraph.getCSSScope(filePath)` → CSS file paths in scope for this Solid file. Cached per semantic model instance.
2. **Scoped selector index**: Filter `symbolTable.selectorsByDispatchKey` to only selectors from in-scope CSS files. Cached per semantic model instance.
3. **Candidate collection**: For this element's dispatch keys (class tokens, tag name, attribute names), collect matching selector symbols from the scoped index. O(1) per dispatch key via the index.
4. **Selector matching**: For each candidate selector, run its `compiledMatcher` against the element node. The matcher is pre-compiled into the `SelectorSymbol` during symbol table construction.
5. **Cascade sort**: Sort matching selectors by cascade precedence: `!important` → layer order → specificity score → source order. Identical to the existing `compareLayoutEdge` sort.
6. **Custom property resolution**: For declarations containing `var()` references, resolve through `symbolTable.customProperties`. Replaces `CSSGraph.variablesByName` lookup.
7. **Tailwind merge**: For element class tokens that are Tailwind utilities (checked via `symbolTable.classNames`), merge their resolved declarations at lowest cascade priority. The Tailwind utility is a `ClassNameSymbol` with `TailwindClassNameSource` — its declarations are already resolved.
8. **Cache**: Store the result keyed by `(compilationId, elementId)`. Return on subsequent calls.

The cascade binder allocates nothing for elements that are never queried. In the current system, a workspace with 5000 JSX elements computes cascade for all 5000, even if active rules only need 200. With lazy binding, only the 200 are computed.

---

### 8. Tiered Computation

#### What it replaces

The current system always computes the maximum tier (Tier 5 — full alignment model) for ALL elements. If only `undefined-css-class` (Tier 1) and `animation-layout-property` (Tier 0) are active, the system still builds the complete LayoutGraph with cascade, signals, facts, and cohort analysis. This is wasted work.

The tiered model maps the 6 data tiers directly to lazy computation layers in the semantic model:

**Tier 0 — CSS syntax only** (3 rules: `animation-layout-property`, `transition-layout-property`, `font-swap-instability`). Queries touch only CSS syntax trees. No cross-file binding, no element resolution, no cascade. The semantic model's CSS-only queries delegate directly to the syntax tree's per-file indexes.

**Tier 1 — Solid + CSS syntax** (11 rules: `undefined-css-class`, `unreferenced-class`, `classlist-*`, `style-kebab-case`, `style-no-function-values`, `style-no-unused-custom-prop`, `classlist-geometry-toggle`, `picture-source-ratio`). Queries touch Solid and CSS syntax trees plus symbol table lookups (`hasClassName`, `getCustomProperty`). No cascade, no element tree construction.

**Tier 2 — Element resolution** (2 rules: `duplicate-class-token`, `style-policy`). Triggers `getElementNodes()` which builds the element tree from JSX syntax. Triggers `getComponentHost()` for import-through resolution. No cascade.

**Tier 3 — Selective layout facts** (12 rules: `fill-image-parent`, `unsized-replaced-element`, `dynamic-slot`, etc.). Triggers cascade binding for queried elements, then computes specific layout facts (reservedSpace, scrollContainer, flowParticipation, containingBlock). Each rule needs 1-3 fact types. Cascade is computed only for elements with matching selectors, not all elements.

**Tier 4 — Full cascade + signals** (5 rules: `conditional-display-collapse`, `conditional-offset-shift`, `conditional-white-space`, `overflow-mode-toggle`, `box-sizing-toggle`). Triggers complete signal snapshot computation with inheritance, conditional guard analysis, and delta detection.

**Tier 5 — Alignment model** (1 rule: `sibling-alignment-outlier`). Triggers full Bayesian evidence scoring with cohort analysis, baseline offsets, and composition fingerprinting.

Each tier is computed ONLY when a query at that tier is invoked. The semantic model tracks per-element which tiers have been computed via a bitmask:

```typescript
const enum ComputationTier {
  CSSSyntax = 0,
  CrossSyntax = 1,
  ElementResolution = 2,
  SelectiveLayoutFacts = 3,
  FullCascade = 4,
  AlignmentModel = 5,
}
```

#### Design decisions

Tiers are not rigid layers — they are lazy caches. Calling `getSignalSnapshot(elementId)` (Tier 4) implicitly triggers `getElementCascade(elementId)` (Tier 3) which implicitly triggers `getElementNode(elementId)` (Tier 2). The semantic model checks the element's computation bitmask and skips already-computed tiers.

Signal snapshot computation (Tier 4) requires a forward pass over elements — each element's snapshot inherits from its parent's snapshot (for properties like font-size, line-height, writing-mode). This means `getSignalSnapshot(childId)` may trigger `getSignalSnapshot(parentId)`. The semantic model handles this by computing snapshots in document order when a Tier 4 query first touches a file, then caching all results. This matches the current system's single forward pass but happens lazily — only when a Tier 4+ rule is active.

Conditional delta analysis (Tier 4) requires all selector matches to be finalized before computing deltas. The semantic model defers delta computation until explicitly queried via `getConditionalDelta(elementId)`, at which point all element cascades in the file are materialized.

---

### 9. Analyzer Dispatch

#### What it replaces

Currently, `CrossRule` receives a `CrossRuleContext` god-object containing `solids`, `css`, and `layout` — the entire world. Each rule's `check(context, emit)` method accesses whatever it needs. The framework has no knowledge of what data each rule needs, so it must build everything.

The new dispatch system mirrors Roslyn's `CompilationWithAnalyzers` where analyzers register subscriptions to specific events (`SyntaxTreeAnalysis`, `SymbolAction`, `SemanticModelAction`). The framework inspects subscriptions to determine the maximum required computation tier, computes only that tier, and dispatches.

```typescript
interface AnalysisRule {
  readonly id: string;
  readonly severity: "error" | "warn" | "off";
  readonly messages: Record<string, string>;
  readonly meta: { readonly description: string; readonly fixable: boolean; readonly category: string };
  readonly tier: ComputationTier;
  register(registry: AnalysisActionRegistry): void;
}

interface AnalysisActionRegistry {
  // Tier 0: CSS syntax tree actions
  registerCSSSyntaxAction(action: (tree: CSSSyntaxTree, symbols: SymbolTable, emit: Emit) => void): void;

  // Tier 1: Cross-syntax actions (Solid + CSS + symbols)
  registerCrossSyntaxAction(action: (solid: SolidSyntaxTree, symbols: SymbolTable, emit: Emit) => void): void;

  // Tier 2: Element resolution actions
  registerElementAction(action: (element: ElementNode, model: FileSemanticModel, emit: Emit) => void): void;

  // Tier 3: Layout fact actions
  registerFactAction<K extends LayoutFactKind>(
    factKind: K,
    action: (element: ElementNode, fact: LayoutFactMap[K], model: FileSemanticModel, emit: Emit) => void,
  ): void;

  // Tier 4: Cascade + signal actions
  registerCascadeAction(
    action: (element: ElementNode, cascade: ElementCascade, snapshot: SignalSnapshot, model: FileSemanticModel, emit: Emit) => void,
  ): void;

  // Tier 5: Alignment model actions
  registerAlignmentAction(
    action: (parent: ElementNode, context: AlignmentContext, cohort: CohortStats, model: FileSemanticModel, emit: Emit) => void,
  ): void;
}

interface AnalysisDispatcher {
  register(rule: AnalysisRule): void;
  run(compilation: StyleCompilation): AnalysisResult;
  runForFile(compilation: StyleCompilation, filePath: string): readonly Diagnostic[];
}

interface AnalysisResult {
  readonly diagnosticsByFile: ReadonlyMap<string, readonly Diagnostic[]>;
  readonly allDiagnostics: readonly Diagnostic[];
  readonly maxTierComputed: ComputationTier;
}
```

#### Design decisions

The dispatcher determines the maximum tier from registered rules' `tier` fields. If the highest tier among active rules is Tier 1, the dispatcher iterates CSS syntax trees for Tier 0 actions and Solid syntax trees for Tier 1 actions, never touching semantic models.

For Tier 2+, the dispatcher iterates Solid files, creates semantic models, and dispatches per-element actions. Tier 3 facts are requested individually — if a rule registers `registerFactAction("reservedSpace", ...)`, only `getLayoutFact(elementId, "reservedSpace")` is called, not all fact types.

`runForFile` enables incremental re-analysis: when one file changes, only rules that touch that file's data re-run. Tier 0 CSS rules run if a CSS file changed. Tier 1 cross-syntax rules run for Solid files whose CSS scope includes the changed CSS file. Tier 2+ rules run for Solid files affected per the dependency graph.

---

### 10. Incremental Updates

#### What it replaces

`GraphCache` maintains three levels: per-file `SolidGraph` keyed by `(path, version)`, one `CSSGraph` keyed by `cssGeneration`, and one `LayoutGraph` keyed by `(solidGeneration, cssGeneration)`. Any CSS change invalidates the entire CSSGraph and LayoutGraph. Any Solid change invalidates that file's SolidGraph and the entire LayoutGraph.

`CompilationTracker` replaces this with fine-grained, dependency-graph-driven invalidation.

```typescript
interface CompilationTracker {
  readonly currentCompilation: StyleCompilation;
  readonly previousCompilation: StyleCompilation | null;

  applyChange(filePath: string, content: string, version: string): CompilationTracker;
  applyDeletion(filePath: string): CompilationTracker;
  applyInputChange(input: AdditionalInput): CompilationTracker;

  getStaleFiles(): ReadonlySet<string>;
  getDirectlyChangedFiles(): ReadonlySet<string>;
  isSemanticModelValid(filePath: string): boolean;
}
```

#### Design decisions

`applyChange(filePath, content, version)` performs these steps:

1. Parse `content` into a syntax tree using the appropriate provider.
2. Create new compilation via `currentCompilation.withFile(filePath, tree)`. This returns a new compilation that structurally shares unchanged trees and incrementally updates the declaration table.
3. Use the new compilation's dependency graph to compute `getTransitivelyAffected(filePath)`.
4. Mark affected files' semantic models as stale.
5. Return new tracker with new compilation.

The critical win: if CSS file `button.css` changes and it's imported by only `Button.tsx` and `Dialog.tsx`, only those two files' semantic models are invalidated. The other 198 files' models (if cached from a previous analysis run) remain valid and are not recomputed.

For Solid file changes, the dependency graph's reverse edges determine which other Solid files might need component host re-resolution. If `Button.tsx` changes its default export's host element, files that import `Button` need their component host bindings invalidated.

The tracker also invalidates the symbol table's declaration table: when a CSS tree is replaced, only that tree's symbol contributions are recomputed. The other trees' cached contributions are reused.

---

### 11. Tailwind Native Integration

#### What it replaces

Currently, Tailwind integration is a boolean check: `TailwindValidator.has(className)` returns true/false, and `TailwindValidator.resolve(className)` returns raw CSS text or null. The `LiveValidator` wraps Tailwind v4's `DesignSystem.candidatesToCss()`. The `StaticValidator` strips variant prefixes recursively against known utility/variant sets.

The new `TailwindProvider` dissolves Tailwind INTO the compilation as a first-class symbol source. A Tailwind utility like `hover:bg-red-500/50` is not a black-box boolean — it's a `ClassNameSymbol` whose `TailwindClassNameSource` carries the full parse tree.

```typescript
interface TailwindParsedCandidate {
  readonly raw: string;
  readonly variants: readonly TailwindParsedVariant[];
  readonly utility: string;
  readonly value: TailwindCandidateValue | null;
  readonly modifier: TailwindCandidateModifier | null;
  readonly important: boolean;
  readonly negative: boolean;
}

interface TailwindParsedVariant {
  readonly name: string;
  readonly kind: "static" | "functional" | "compound" | "arbitrary";
  readonly value: string | null;
  readonly modifier: string | null;
}

type TailwindCandidateValue =
  | { readonly kind: "named"; readonly value: string; readonly fraction: string | null }
  | { readonly kind: "arbitrary"; readonly value: string; readonly dataType: string | null };

type TailwindCandidateDiagnostic =
  | { readonly kind: "unknown-utility"; readonly utility: string }
  | { readonly kind: "invalid-variant"; readonly variant: string }
  | { readonly kind: "theme-token-not-found"; readonly token: string }
  | { readonly kind: "invalid-arbitrary-value"; readonly value: string };
```

#### Design decisions

The candidate parsing algorithm replicates Tailwind v4's exact logic from `candidate.ts`:

1. **Segment by colon**: Split input by `:` to extract variant stack and base utility.
2. **Prefix handling**: If theme prefix is set, strip it from the first segment.
3. **Important flag**: Strip `!` suffix.
4. **Static utility match**: Check if base matches a registered static utility directly.
5. **Modifier segmentation**: Split base by `/` to separate utility from modifier.
6. **Arbitrary property**: If base starts with `[`, parse `[property:value]` format.
7. **Arbitrary value**: If base ends with `]`, find `-[` to extract root and value.
8. **CSS variable shorthand**: If base ends with `)`, parse `root-(--var)` format.
9. **Permutation root matching**: Generate all root/value pairs by iteratively removing after the last dash. Test each against registered functional utilities.

For each variant, the same permutation logic applies, with variant-specific handling for compound variants (recursive parsing) and arbitrary variants (selector validation).

The `TailwindProvider` wraps the existing `TailwindValidator` during migration. After migration, it replaces the validator entirely — `has()` becomes a fast-path check against the symbol table, and `resolve()` returns the full `TailwindResolution` with parsed candidate and declarations.

Arbitrary values validate correctly because the provider parses them with bracket balancing rather than regex approximation. Compound variants validate correctly because the provider recursively parses sub-variants. Theme token references are resolved through the design system's CSS variable namespace, producing typed diagnostics when tokens are missing.

---

## Part 2: Implementation Plan

### Phase 1: Compilation Shell

**Goal**: `StyleCompilation` holds syntax trees and returns them; `SolidSyntaxTree` and `CSSSyntaxTree` wrap existing parse output with zero-copy bridges.

**New files**:
- `compilation/core/compilation.ts` — StyleCompilation implementation
- `compilation/core/solid-syntax-tree.ts` — SolidSyntaxTree wrapper + `solidGraphToSyntaxTree` bridge
- `compilation/core/css-syntax-tree.ts` — CSSSyntaxTree wrapper + `cssGraphToSyntaxTrees` bridge

**Dependencies**: None.

**Old code still needed**: All of `solid/impl.ts` (SolidGraph), `css/impl.ts` (CSSGraph), all parse phases — these produce the data that the syntax trees wrap.

**Old code now replaceable**: Nothing yet — this phase only adds the new abstraction layer.

**Validation**: Unit tests asserting `compilation.getSolidTree(path)` returns same entity arrays as old `SolidGraph`. Assert `solidGraphToSyntaxTree(graph).scopes === graph.scopes` (reference equality). Assert `compilation.withSolidTree(tree).getSolidTree(path)` returns the tree. Assert `compilation.withoutFile(path).getSolidTree(path)` returns null. Assert structural sharing: `compilation.withSolidTree(treeA).cssTrees === compilation.cssTrees`.

**Estimated scope**: Small (3 files, ~400 LOC).

---

### Phase 2: Symbol Hierarchy

**Goal**: Symbol types exist and a merged symbol table is populated from CSS syntax trees. Symbol table contains the same class names, selectors, and custom properties as the old CSSGraph indexes.

**New files**:
- `compilation/symbols/symbol-table.ts` — SymbolTable implementation
- `compilation/symbols/declaration-table.ts` — DeclarationTable incremental builder
- `compilation/symbols/class-name.ts` — ClassNameSymbol
- `compilation/symbols/selector.ts` — SelectorSymbol (wraps existing SelectorEntity)
- `compilation/symbols/custom-property.ts` — CustomPropertySymbol
- `compilation/symbols/keyframes.ts` — KeyframesSymbol
- `compilation/symbols/font-face.ts` — FontFaceSymbol
- `compilation/symbols/layer.ts` — LayerSymbol

**Dependencies**: Phase 1 (CSSSyntaxTree must exist).

**Old code still needed**: `css/impl.ts` (CSSGraph) — the symbol table is validated against its indexes. `css/entities/` — entity types are referenced by symbols. `css/parser/specificity.ts` — specificity computation used by SelectorSymbol.

**Old code now replaceable**: Nothing yet. The symbol table is a parallel structure being validated against the old indexes.

**Validation**: For every CSS file in the test suite, assert `symbolTable.classNames` contains the same keys as `CSSGraph.classNameIndex`. Assert `symbolTable.customProperties` contains the same keys as `CSSGraph.variablesByName` (filtered to CSS custom properties). Assert selector count matches. Assert specificity scores match. Assert layer order matches.

**Estimated scope**: Medium (8 files, ~800 LOC).

---

### Phase 3: Dependency Graph

**Goal**: A first-class dependency graph produces the same CSS scope results as `collectCSSScopeBySolidFile`.

**New files**:
- `compilation/incremental/dependency-graph.ts` — DependencyGraph implementation

**Dependencies**: Phase 1 (syntax trees with import information).

**Old code still needed**: `cross-file/layout/scope.ts` — validated against. `cross-file/layout/module-resolver.ts` — module resolution logic moves here.

**Old code now replaceable**: `cross-file/layout/scope.ts` (functionally replaced, but not deleted until Phase 11).

**Validation**: For every Solid file in the test suite, assert `dependencyGraph.getCSSScope(solidFile)` returns the same set of CSS paths as `collectCSSScopeBySolidFile(solids, css).get(solidFile)`. Assert reverse dependency edges: when CSS file X is in scope for Solid file Y, then `dependencyGraph.getReverseDependencies(X)` includes Y.

**Estimated scope**: Medium (1 file, ~600 LOC — the module resolution logic is substantial).

---

### Phase 4: CSS Source Providers

**Goal**: `PlainCSSProvider` and `TailwindProvider` produce the same symbols as old `CSSGraph` + `TailwindValidator`.

**New files**:
- `compilation/providers/provider.ts` — CSSSourceProvider interface
- `compilation/providers/plain-css.ts` — PlainCSSProvider
- `compilation/providers/scss.ts` — SCSSProvider
- `compilation/providers/tailwind.ts` — TailwindProvider with native candidate parsing

**Dependencies**: Phase 2 (symbol types to produce).

**Old code still needed**: `css/phases/` — PlainCSSProvider wraps these. `css/tailwind.ts` — TailwindProvider wraps `LiveValidator` during migration.

**Old code now replaceable**: Nothing yet. Providers are validated against existing outputs.

**Validation**: Assert `PlainCSSProvider.parse(path, content).selectors` produces the same entity data as the corresponding file's data in old CSSGraph. Assert `tailwindProvider.has(name)` matches old `tailwind.has(name)` for the full Tailwind class list from the test suite. Assert `tailwindProvider.resolve(name).css` matches old `tailwind.resolve(name)`. Assert `tailwindProvider.parseCandidate("hover:bg-red-500/50")` produces the correct variant/utility/modifier structure.

**Estimated scope**: Large (4 files, ~1500 LOC — the Tailwind native parser is the bulk).

---

### Phase 5: SemanticModel Core

**Goal**: `FileSemanticModel` with Tier 0-1 queries (syntax + symbol lookup) produces the same results as old cross-file queries.

**New files**:
- `compilation/binding/semantic-model.ts` — FileSemanticModel implementation (Tier 0-1)

**Dependencies**: Phase 2 (symbol table), Phase 3 (dependency graph).

**Old code still needed**: `cross-file/queries.ts` — `getUndefinedCSSClasses`, `getUnusedCSSClasses`, `getUndefinedVariableUsagesInJSX` — validated against.

**Old code now replaceable**: `cross-file/queries.ts` (functionally replaced).

**Validation**: Assert `semanticModel.getClassNameInfo(name)` returns non-null for every class name that `css.classNameIndex.has(name) || tailwind.has(name)`. Assert `getUndefinedCSSClasses` from old queries.ts produces the same results as iterating Solid trees and checking `semanticModel.getClassNameInfo()` for each static class token.

**Estimated scope**: Medium (1 file, ~500 LOC).

---

### Phase 6: Cascade Binder

**Goal**: Lazy cascade binding in SemanticModel (Tier 2-3) produces the same cascade results as old LayoutGraph records.

**New files**:
- `compilation/binding/cascade-binder.ts` — CascadeBinder implementation
- `compilation/binding/element-builder.ts` — ElementNode construction from JSX
- `compilation/binding/scope-resolver.ts` — Scoped selector index construction

**Dependencies**: Phase 5 (semantic model shell), Phase 3 (dependency graph for CSS scope).

**Old code still needed**: `cross-file/layout/cascade-builder.ts` — cascade logic moves here. `cross-file/layout/selector-match.ts` — selector matching moves here. `cross-file/layout/selector-dispatch.ts` — dispatch key bucketing moves here. `cross-file/layout/element-record.ts` — element construction logic moves here. `cross-file/layout/component-host.ts` — component host resolution moves here. `cross-file/layout/guard-model.ts` — guard resolution moves here.

**Old code now replaceable**: The above files are functionally replaced but not deleted.

**Validation**: For 50+ test cases covering all element/selector/cascade patterns, assert `semanticModel.getElementCascade(elementId).declarations` matches old `LayoutGraph.records.get(elementNode).cascade` entry by entry. Assert edge counts match. Assert guard provenance matches.

**Estimated scope**: Large (3 files, ~2000 LOC — cascade binding is the largest single component).

---

### Phase 7: Signal + Fact Analyzers

**Goal**: Tier 4-5 computation produces the same signal snapshots, layout facts, and alignment data as old LayoutGraph derived data.

**New files**:
- `compilation/binding/signal-builder.ts` — SignalSnapshot computation from cascade
- `compilation/analysis/layout-fact.ts` — Layout fact computation
- `compilation/analysis/cascade-analyzer.ts` — Conditional delta analysis
- `compilation/analysis/alignment.ts` — Alignment model (Bayesian scoring, cohort)
- `compilation/analysis/statefulness.ts` — Stateful selector analysis

**Dependencies**: Phase 6 (cascade binder provides cascade data).

**Old code still needed**: `cross-file/layout/signal-collection.ts` — signal normalization logic moves here. `cross-file/layout/signal-normalization.ts` — tag classification moves here. `cross-file/layout/context-model.ts` — alignment types move here. `cross-file/layout/context-classification.ts` — context creation logic moves here. `cross-file/layout/cohort-index.ts` — cohort analysis moves here. `cross-file/layout/rule-kit.ts` — Bayesian scoring moves here. `cross-file/layout/offset-baseline.ts` — offset signals move here.

**Old code now replaceable**: All of the above files (functionally replaced).

**Validation**: For every element in the test suite, assert `semanticModel.getSignalSnapshot(elementId).signals` matches old `records.get(node).snapshot.signals` for all 55 signal names. Assert `getLayoutFact(elementId, "reservedSpace")` matches old `records.get(node).reservedSpace`. Assert alignment contexts and cohort stats match old values.

**Estimated scope**: Large (5 files, ~2500 LOC — signal normalization and alignment scoring are substantial).

---

### Phase 8: Rule Dispatch

**Goal**: Subscription framework exists and Tier 0 rules run through it, producing identical diagnostics.

**New files**:
- `compilation/dispatch/dispatcher.ts` — AnalysisDispatcher implementation
- `compilation/dispatch/registry.ts` — AnalysisActionRegistry implementation
- `compilation/dispatch/tier-resolver.ts` — Determines max tier from active rules
- `compilation/dispatch/rule.ts` — AnalysisRule interface + defineAnalysisRule helper

**Dependencies**: Phase 5 (semantic model).

**Old code still needed**: `cross-file/rule.ts` — old CrossRule interface, still used by unmigrated rules. All 33+ rule files in `cross-file/rules/` — still running through old system.

**Old code now replaceable**: Nothing yet — this phase builds the framework, doesn't migrate rules.

**Validation**: Migrate 3 Tier 0 rules (`animation-layout-property`, `transition-layout-property`, `font-swap-instability`) to `AnalysisRule`. Run both old and new dispatchers on the full test suite. Assert diagnostic output is identical — same rule IDs, same file paths, same line/column numbers, same messages.

**Estimated scope**: Medium (4 files, ~600 LOC).

---

### Phase 9: Rule Migration

**Goal**: All 33+ rules migrated to new AnalysisRule interface, running through AnalysisDispatcher. Both old and new systems produce identical diagnostics.

**New files**: None — rules are re-targeted in place.

**Dependencies**: Phase 8 (dispatch framework), Phase 7 (all computation tiers available).

**Old code still needed**: `cross-file/rules/` — each rule file is modified in place.

**Old code now replaceable**: `cross-file/rule.ts` (CrossRule interface), `cross-file/queries.ts` (replaced by semantic model queries).

**Validation**: After each tier's rules are migrated, run the full test suite through BOTH old and new dispatchers. Assert identical diagnostics. Tier migration order:
- Tier 1 (11 rules): `undefined-css-class`, `unreferenced-class`, `classlist-*` (4 rules), `style-*` (3 rules), `classlist-geometry-toggle`, `picture-source-ratio`
- Tier 2 (2 rules): `duplicate-class-token`, `style-policy`
- Tier 3 (12 rules): `fill-image-parent`, `unsized-replaced-element`, `dynamic-slot`, `overflow-anchor`, `scrollbar-gutter`, `content-visibility`, `stateful-box-model-shift`, `unstable-style-toggle`, and 4 others
- Tier 4 (5 rules): `conditional-display-collapse`, `conditional-offset-shift`, `conditional-white-space`, `overflow-mode-toggle`, `box-sizing-toggle`
- Tier 5 (1 rule): `sibling-alignment-outlier`

**Estimated scope**: Large (33+ files modified, ~3000 LOC of changes across all rules).

---

### Phase 10: Incremental Updates

**Goal**: CompilationTracker replaces GraphCache. LSP edit-diagnose cycle works with new system.

**New files**:
- `compilation/incremental/tracker.ts` — CompilationTracker implementation
- `compilation/incremental/change-propagation.ts` — Transitive invalidation logic

**Dependencies**: Phase 3 (dependency graph), Phase 9 (all rules migrated).

**Old code still needed**: `cache.ts` — validated against during transition.

**Old code now replaceable**: `cache.ts` (GraphCache).

**Validation**: Simulate LSP edit-diagnose cycles: change a CSS file, assert only affected Solid files get re-analyzed. Change a Solid file, assert only that file's semantic model is invalidated. Measure diagnostic latency — must be equal to or better than old system. Assert no diagnostic regressions by running the full test suite through the tracker-based pipeline.

**Estimated scope**: Medium (2 files, ~800 LOC).

---

### Phase 11: Cleanup

**Goal**: Old system deleted. All tests pass through new system exclusively.

**New files**: None.

**Dependencies**: All previous phases.

**Old code deleted**:
- `cross-file/` directory (entirely — layout/, rules/ migrated, queries.ts replaced)
- `cache.ts` (replaced by CompilationTracker)
- `SolidGraph` class from `solid/impl.ts` (parse phases now produce SolidSyntaxTree directly)
- `CSSGraph` class from `css/impl.ts` (parse phases now produce CSSSyntaxTree directly)

**Old code retained**:
- `solid/phases/` — become SolidSyntaxTree construction
- `solid/entities/` — entity type definitions used by SolidSyntaxTree
- `css/phases/` — become CSSSyntaxTree construction inside PlainCSSProvider/SCSSProvider
- `css/entities/` — entity type definitions used by CSSSyntaxTree

**Validation**: Full test suite passes. No imports from deleted paths. `cross-file/` directory does not exist. `cache.ts` does not exist. `SolidGraph` class does not exist. `CSSGraph` class does not exist. Diagnostic output matches old system's output exactly for the full test suite.

**Estimated scope**: Medium (deletion + import rewiring, ~500 LOC of changes).

---

## Part 3: What Stays Unchanged

### Parse phases that become syntax tree construction

| Current file | What changes | What does NOT change |
|---|---|---|
| `solid/phases/prepare.ts` | Output wrapper: returns `SolidSyntaxTree` instead of mutating `SolidGraph` | AST validation logic |
| `solid/phases/scopes.ts` | Writes to `SolidSyntaxTree` builder instead of `SolidGraph` | Scope creation, variable extraction, hoisting rules |
| `solid/phases/entities.ts` | Writes to builder | Function/call/JSX/class/import entity creation, AST traversal |
| `solid/phases/context.ts` | Reads from builder | Tracking context classification logic |
| `solid/phases/wiring.ts` | Reads/writes builder | JSX hierarchy wiring, call target resolution |
| `solid/phases/reactivity.ts` | Reads/writes builder | Reactive variable classification, primitive detection |
| `solid/phases/reachability.ts` | Reads/writes builder | Reachability flag computation |
| `solid/phases/exports.ts` | Reads/writes builder | Export extraction, kind classification |
| `solid/phases/dependencies.ts` | Reads/writes builder | Computation entity creation, dependency edge extraction |
| `css/phases/parse.ts` | Returns per-file `CSSSyntaxTree` instead of accumulating into `CSSGraph` | PostCSS parsing, line offset computation, import extraction |
| `css/phases/ast.ts` | Writes to per-file builder | Rule/selector/declaration/variable/at-rule entity creation |
| `css/phases/references.ts` | Reads/writes per-file builder | var() resolution, fallback chain walking |
| `css/phases/tokens.ts` | Reads/writes per-file builder | Theme token inference, category classification |
| `css/phases/cascade.ts` | Reads/writes per-file builder | Override/shadow relationship computation |
| `css/phases/scss.ts` | Reads/writes per-file builder | Mixin/function/placeholder resolution |

### Entity types that stay as syntax tree contents

| Current file | Change |
|---|---|
| `solid/entities/scope.ts` | No change. `ScopeEntity` used by `SolidSyntaxTree`. |
| `solid/entities/variable.ts` | No change. `VariableEntity` used by `SolidSyntaxTree`. |
| `solid/entities/function.ts` | No change. `FunctionEntity` used by `SolidSyntaxTree`. |
| `solid/entities/call.ts` | No change. `CallEntity`, `ArgumentEntity` used by `SolidSyntaxTree`. |
| `solid/entities/jsx.ts` | No change. `JSXElementEntity`, `JSXAttributeEntity` used by `SolidSyntaxTree`. |
| `solid/entities/import.ts` | No change. `ImportEntity` used by `SolidSyntaxTree` and dependency graph. |
| `solid/entities/export.ts` | No change. `ExportEntity` used by `SolidSyntaxTree`. |
| `solid/entities/class.ts` | No change. |
| `solid/entities/property.ts` | No change. |
| `solid/entities/property-assignment.ts` | No change. |
| `solid/entities/spread.ts` | No change. |
| `solid/entities/non-null-assertion.ts` | No change. |
| `solid/entities/type-assertion.ts` | No change. |
| `solid/entities/computation.ts` | No change. `ComputationEntity`, `DependencyEdge`, `OwnershipEdge` used by `SolidSyntaxTree`. |
| `css/entities/` (all files) | No change. `SelectorEntity`, `DeclarationEntity`, `VariableEntity`, `AtRuleEntity`, `RuleEntity`, `FileEntity`, etc. used by `CSSSyntaxTree`. Symbols wrap/reference them. |

### Algorithms that move unchanged into new locations

| Algorithm | Current location | New location | What moves | What does NOT change |
|---|---|---|---|---|
| Selector specificity | `css/parser/specificity.ts` | Stays in place. `SelectorSymbol` calls it. | Nothing | Specificity calculation, comparison, scoring |
| Selector parsing | `css/parser/selector.ts` | Stays in place. Used by parse phases. | Nothing | Selector tokenization, compound extraction |
| CSS value parsing | `css/parser/value.ts` | Stays in place. Used by parse phases. | Nothing | Value tokenization, var() extraction |
| CSS value tokenizer | `css/parser/value-tokenizer.ts` | Stays in place. | Nothing | Token splitting, comma/whitespace handling |
| Dispatch key bucketing | `cross-file/layout/selector-dispatch.ts` | `compilation/binding/scope-resolver.ts` | File location | Dispatch key computation algorithm |
| Selector matching | `cross-file/layout/selector-match.ts` | `compilation/binding/cascade-binder.ts` | File location | Compiled matcher creation, element matching logic |
| Signal normalization | `cross-file/layout/signal-normalization.ts` | `compilation/binding/signal-builder.ts` | File location | `isControlTag`, `isReplacedTag`, value normalization |
| Signal collection | `cross-file/layout/signal-collection.ts` | `compilation/binding/signal-builder.ts` | File location | `buildSnapshotFromCascade`, inheritance logic |
| Guard resolution | `cross-file/layout/guard-model.ts` | `compilation/binding/cascade-binder.ts` | File location | `resolveRuleGuard`, guard provenance computation |
| Element record construction | `cross-file/layout/element-record.ts` | `compilation/binding/element-builder.ts` | File location | `collectLayoutElementRecordsForSolid`, sibling resolution, inline style collection |
| Component host resolution | `cross-file/layout/component-host.ts` | `compilation/binding/semantic-model.ts` | File location | Host element identification, export analysis, JSX return extraction |
| Module resolution | `cross-file/layout/module-resolver.ts` | `compilation/incremental/dependency-graph.ts` | File location | Package.json exports resolution, extension probing, partial file resolution |
| Cascade sort | `cross-file/layout/cascade-builder.ts` | `compilation/binding/cascade-binder.ts` | File location | `compareLayoutEdge`, importance/layer/specificity/source-order sort |
| Monitored declaration collection | `cross-file/layout/cascade-builder.ts` | `compilation/binding/cascade-binder.ts` | File location | `collectMonitoredDeclarations`, declaration extraction from selectors |
| Context classification | `cross-file/layout/context-classification.ts` | `compilation/analysis/alignment.ts` | File location | `createAlignmentContextForParent`, display/flex-direction/align-items analysis |
| Cohort index | `cross-file/layout/cohort-index.ts` | `compilation/analysis/alignment.ts` | File location | Cohort analysis, cluster detection, unimodality testing |
| Bayesian scoring | `cross-file/layout/rule-kit.ts` | `compilation/analysis/alignment.ts` | File location | Evidence scoring, posterior interval computation, factor weighting |
| Offset baseline | `cross-file/layout/offset-baseline.ts` | `compilation/analysis/alignment.ts` | File location | Offset signal list, baseline computation |
| Stateful rule indexes | `cross-file/layout/stateful-rule-index.ts` | `compilation/analysis/statefulness.ts` | File location | State pseudo-class detection, base value indexing |
| Measurement node index | `cross-file/layout/measurement-node.ts` | `compilation/analysis/alignment.ts` | File location | Measurement target selection |

### Infrastructure that stays

| Component | Current location | Change |
|---|---|---|
| PostCSS parsing | `css/phases/parse.ts` internal | None — called by `PlainCSSProvider` |
| PostCSS-SCSS parsing | `css/phases/parse.ts` internal | None — called by `SCSSProvider` |
| CSS string interner | `css/intern.ts` | None |
| Layout taxonomy constants | `css/layout-taxonomy.ts` | None |
| Animation/transition keyword classification | `css/parser/animation-transition-keywords.ts` | None |
| Value utilities | `css/parser/value-util.ts` | None |
| Shared constants | `@drskillissue/ganko-shared` | None |
| Solid utilities | `solid/util/` (all files) | None |
| Solid queries | `solid/queries/` (all files) | None — these query SolidSyntaxTree, which has the same shape |
| TypeScript type resolver | `solid/typescript.ts` | None |
| Suppression/comment handling | `suppression.ts` | None |
| Diagnostic creation | `diagnostic.ts` | None |
| Rule runner infrastructure | `graph.ts` (`runRules`, `BaseRule`) | Modified to support both old `BaseRule<G>` and new `AnalysisRule` during migration |
