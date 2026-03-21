# Extracted Type Information

## 1. SolidGraph

### SolidGraph (packages/ganko/src/solid/impl.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `kind` | readonly-property | `string` | readonly | `"solid" as const` | — |
| 2 | `file` | readonly-property | `string` | readonly | `—` | — |
| 3 | `logger` | readonly-property | `Logger` | readonly | `—` | — |
| 4 | `sourceFile` | readonly-property | `ts.SourceFile` | readonly | `—` | — |
| 5 | `comments` | readonly-property | `readonly CommentEntry[]` | readonly | `—` | — |
| 6 | `typeResolver` | readonly-property | `TypeResolver` | readonly | `—` | — |
| 7 | `fileEntity` | readonly-property | `FileEntity` | readonly | `—` | — |
| 8 | `_nextScopeId` | property | `number` | private | `0` | — |
| 9 | `_nextVariableId` | property | `number` | private | `0` | — |
| 10 | `_nextFunctionId` | property | `number` | private | `0` | — |
| 11 | `_nextCallId` | property | `number` | private | `0` | — |
| 12 | `_nextJsxId` | property | `number` | private | `0` | — |
| 13 | `_nextImportId` | property | `number` | private | `0` | — |
| 14 | `_nextExportId` | property | `number` | private | `0` | — |
| 15 | `_nextClassId` | property | `number` | private | `0` | — |
| 16 | `_nextPropertyId` | property | `number` | private | `0` | — |
| 17 | `_nextConditionalSpreadId` | property | `number` | private | `0` | — |
| 18 | `_nextMiscId` | property | `number` | private | `0` | — |
| 19 | `scopes` | readonly-property | `ScopeEntity[]` | readonly | `[]` | — |
| 20 | `variables` | readonly-property | `VariableEntity[]` | readonly | `[]` | — |
| 21 | `functions` | readonly-property | `FunctionEntity[]` | readonly | `[]` | — |
| 22 | `calls` | readonly-property | `CallEntity[]` | readonly | `[]` | — |
| 23 | `jsxElements` | readonly-property | `JSXElementEntity[]` | readonly | `[]` | — |
| 24 | `imports` | readonly-property | `ImportEntity[]` | readonly | `[]` | — |
| 25 | `exports` | readonly-property | `ExportEntity[]` | readonly | `[]` | — |
| 26 | `classes` | readonly-property | `ClassEntity[]` | readonly | `[]` | — |
| 27 | `properties` | readonly-property | `PropertyEntity[]` | readonly | `[]` | — |
| 28 | `propertyAssignments` | readonly-property | `PropertyAssignmentEntity[]` | readonly | `[]` | — |
| 29 | `conditionalSpreads` | readonly-property | `ConditionalSpreadEntity[]` | readonly | `[]` | — |
| 30 | `objectSpreads` | readonly-property | `ObjectSpreadEntity[]` | readonly | `[]` | — |
| 31 | `nonNullAssertions` | readonly-property | `NonNullAssertionEntity[]` | readonly | `[]` | — |
| 32 | `typeAssertions` | readonly-property | `TypeAssertionEntity[]` | readonly | `[]` | — |
| 33 | `typePredicates` | readonly-property | `TypePredicateEntity[]` | readonly | `[]` | — |
| 34 | `unsafeGenericAssertions` | readonly-property | `UnsafeGenericAssertionEntity[]` | readonly | `[]` | — |
| 35 | `unsafeTypeAnnotations` | readonly-property | `UnsafeTypeAnnotationEntity[]` | readonly | `[]` | — |
| 36 | `inlineImports` | readonly-property | `InlineImportEntity[]` | readonly | `[]` | — |
| 37 | `variablesByName` | readonly-property | `Map<string, VariableEntity[]>` | readonly | `new Map<string, VariableEntity[]>()` | — |
| 38 | `functionsByNode` | readonly-property | `Map<ts.Node, FunctionEntity>` | readonly | `new Map<ts.Node, FunctionEntity>()` | — |
| 39 | `functionsByDeclarationNode` | readonly-property | `Map<ts.Node, FunctionEntity>` | readonly | `new Map<ts.Node, FunctionEntity>()` | — |
| 40 | `functionsByName` | readonly-property | `Map<string, FunctionEntity[]>` | readonly | `new Map<string, FunctionEntity[]>()` | — |
| 41 | `callsByNode` | readonly-property | `Map<ts.CallExpression \| ts.NewExpression, CallEntity>` | readonly | `new Map<ts.CallExpression \| ts.NewExpression, CallEntity>()` | — |
| 42 | `callsByPrimitive` | readonly-property | `Map<string, CallEntity[]>` | readonly | `new Map<string, CallEntity[]>()` | — |
| 43 | `callsByMethodName` | readonly-property | `Map<string, CallEntity[]>` | readonly | `new Map<string, CallEntity[]>()` | — |
| 44 | `callsByArgNode` | readonly-property | `Map<ts.Node, ArgumentEntity>` | readonly | `new Map<ts.Node, ArgumentEntity>()` | — |
| 45 | `jsxByNode` | readonly-property | `Map<ts.Node, JSXElementEntity>` | readonly | `new Map<ts.Node, JSXElementEntity>()` | — |
| 46 | `jsxByTag` | readonly-property | `Map<string, JSXElementEntity[]>` | readonly | `new Map<string, JSXElementEntity[]>()` | — |
| 47 | `jsxAttributesByElementId` | readonly-property | `Map<number, ReadonlyMap<string, JSXAttributeEntity>` | readonly | `new Map<number, ReadonlyMap<string, JSXAttributeEntity>>()` | — |
| 48 | `jsxAttrsByKind` | readonly-property | `Map<JSXAttributeKind, JSXAttributeWithElement[]>` | readonly | `new Map<JSXAttributeKind, JSXAttributeWithElement[]>()` | — |
| 49 | `jsxClassAttributes` | readonly-property | `JSXAttributeWithElement[]` | readonly | `[]` | — |
| 50 | `jsxClassListAttributes` | readonly-property | `JSXAttributeWithElement[]` | readonly | `[]` | — |
| 51 | `jsxStyleAttributes` | readonly-property | `JSXAttributeWithElement[]` | readonly | `[]` | — |
| 52 | `fillImageElements` | readonly-property | `JSXElementEntity[]` | readonly | `[]` | — |
| 53 | `staticClassTokensByElementId` | readonly-property | `Map<number, JSXStaticClassIndex>` | readonly | `new Map<number, JSXStaticClassIndex>()` | — |
| 54 | `staticClassListKeysByElementId` | readonly-property | `Map<number, JSXStaticObjectKeyIndex>` | readonly | `new Map<number, JSXStaticObjectKeyIndex>()` | — |
| 55 | `staticStyleKeysByElementId` | readonly-property | `Map<number, JSXStaticObjectKeyIndex>` | readonly | `new Map<number, JSXStaticObjectKeyIndex>()` | — |
| 56 | `classListProperties` | readonly-property | `JSXObjectPropertyWithElement[]` | readonly | `[]` | — |
| 57 | `styleProperties` | readonly-property | `JSXObjectPropertyWithElement[]` | readonly | `[]` | — |
| 58 | `inlineStyleClassNames` | readonly-property | `Set<string>` | readonly | `new Set<string>()` | CSS class names defined in inline `<style>` elements within JSX (e.g., SVG icons with embedded CSS). |
| 59 | `importsBySource` | readonly-property | `Map<string, ImportEntity[]>` | readonly | `new Map<string, ImportEntity[]>()` | — |
| 60 | `exportsByName` | readonly-property | `Map<string, ExportEntity>` | readonly | `new Map<string, ExportEntity>()` | — |
| 61 | `exportsByEntityId` | readonly-property | `Map<number, ExportEntity>` | readonly | `new Map<number, ExportEntity>()` | — |
| 62 | `classesByNode` | readonly-property | `Map<ts.ClassDeclaration \| ts.ClassExpression, ClassEntity>` | readonly | `new Map<ts.ClassDeclaration \| ts.ClassExpression, ClassEntity>()` | — |
| 63 | `classesByName` | readonly-property | `Map<string, ClassEntity[]>` | readonly | `new Map<string, ClassEntity[]>()` | — |
| 64 | `unaryExpressionsByOperator` | readonly-property | `Map<ts.SyntaxKind, ts.PrefixUnaryExpression[]>` | readonly | `new Map<ts.SyntaxKind, ts.PrefixUnaryExpression[]>()` | — |
| 65 | `spreadElements` | readonly-property | `(ts.SpreadElement \| ts.SpreadAssignment)[]` | readonly | `[]` | — |
| 66 | `newExpressionsByCallee` | readonly-property | `Map<string, ts.NewExpression[]>` | readonly | `new Map<string, ts.NewExpression[]>()` | — |
| 67 | `deleteExpressions` | readonly-property | `ts.DeleteExpression[]` | readonly | `[]` | — |
| 68 | `identifiersByName` | readonly-property | `Map<string, ts.Identifier[]>` | readonly | `new Map<string, ts.Identifier[]>()` | — |
| 69 | `_lineStartOffsets` | property | `readonly number[] \| null` | private | `null` | — |
| 70 | `firstScope` | property | `ScopeEntity \| null` | — | `null` | — |
| 71 | `componentScopes` | readonly-property | `Map<ScopeEntity, { scope: ScopeEntity; name: string }>` | readonly | `new Map<ScopeEntity, { scope: ScopeEntity; name: string }>()` | — |
| 72 | `componentFunctions` | property | `FunctionEntity[]` | — | `[]` | — |
| 73 | `functionsWithReactiveCaptures` | property | `FunctionEntity[]` | — | `[]` | — |
| 74 | `reactiveVariables` | property | `VariableEntity[]` | — | `[]` | — |
| 75 | `propsVariables` | property | `VariableEntity[]` | — | `[]` | — |
| 76 | `storeVariables` | property | `VariableEntity[]` | — | `[]` | — |
| 77 | `resourceVariables` | property | `VariableEntity[]` | — | `[]` | — |
| 78 | `variablesWithPropertyAssignment` | property | `VariableEntity[]` | — | `[]` | — |
| 79 | `computations` | property | `ComputationEntity[]` | — | `[]` | Reactive computation nodes (effects, memos, computed, roots, resources). |
| 80 | `computationByCallId` | readonly-property | `Map<number, ComputationEntity>` | readonly | `new Map<number, ComputationEntity>()` | Computation lookup by CallEntity ID. |
| 81 | `dependencyEdges` | property | `DependencyEdge[]` | — | `[]` | Dependency edges: computation reads reactive source. |
| 82 | `ownershipEdges` | property | `OwnershipEdge[]` | — | `[]` | Ownership edges: parent owns child computation. |
| 83 | `jsxContextCache` | readonly-property | `WeakMap<ts.Node, JSXContext \| null>` | readonly | `new WeakMap<ts.Node, JSXContext \| null>()` | — |
| 84 | `scopeForCache` | readonly-property | `WeakMap<ts.Node, ScopeEntity>` | readonly | `new WeakMap<ts.Node, ScopeEntity>()` | — |
| 85 | `onDepsCache` | readonly-property | `WeakMap<ts.Node, boolean>` | readonly | `new WeakMap<ts.Node, boolean>()` | — |
| 86 | `passthroughCache` | readonly-property | `WeakMap<ts.Node, boolean>` | readonly | `new WeakMap<ts.Node, boolean>()` | — |
| 87 | `nextScopeId` | method | `() => number` | — | `—` | @internal Generate next scope ID |
| 88 | `nextVariableId` | method | `() => number` | — | `—` | @internal Generate next variable ID |
| 89 | `nextFunctionId` | method | `() => number` | — | `—` | @internal Generate next function ID |
| 90 | `nextCallId` | method | `() => number` | — | `—` | @internal Generate next call ID |
| 91 | `nextJsxId` | method | `() => number` | — | `—` | @internal Generate next JSX element ID |
| 92 | `nextImportId` | method | `() => number` | — | `—` | @internal Generate next import ID |
| 93 | `nextExportId` | method | `() => number` | — | `—` | @internal Generate next export ID |
| 94 | `nextClassId` | method | `() => number` | — | `—` | @internal Generate next class ID |
| 95 | `nextPropertyId` | method | `() => number` | — | `—` | @internal Generate next property ID |
| 96 | `nextConditionalSpreadId` | method | `() => number` | — | `—` | @internal Generate next conditional spread ID |
| 97 | `nextMiscId` | method | `() => number` | — | `—` | @internal Generate next misc entity ID |
| 98 | `addScope` | method | `(scope: ScopeEntity) => void` | — | `—` | @internal Add a scope entity to the graph. Called by scopesPhase. |
| 99 | `addVariable` | method | `(variable: VariableEntity) => void` | — | `—` | @internal Add a variable entity to the graph. Called by scopesPhase. |
| 100 | `addFunction` | method | `(fn: FunctionEntity) => void` | — | `—` | @internal Add a function entity to the graph. Called by entitiesPhase. |
| 101 | `addCall` | method | `(call: CallEntity) => void` | — | `—` | @internal Add a call entity to the graph. Called by entitiesPhase. |
| 102 | `addJSXElement` | method | `(element: JSXElementEntity) => void` | — | `—` | @internal Add a JSX element entity to the graph. Called by entitiesPhase. |
| 103 | `extractInlineStyleClassNames` | method | `(element: JSXElementEntity) => void` | private | `—` | Extract CSS class names from inline `<style>` JSX elements.  Handles patterns like `<style>{`.foo { ... }`}</style>` found in SVG icons. Scans template literal and literal string children for `.classN |
| 104 | `indexObjectAttribute` | method | `(entry: JSXAttributeWithElement, element: JSXElementEntity, attr: JSXAttributeEntity, attrArray: JSXAttributeWithElement[], keyIndex: Map<number, JSXStaticObjectKeyIndex>, propertiesArray: JSXObjectPropertyWithElement[]) => void` | private | `—` | — |
| 105 | `addImport` | method | `(imp: ImportEntity) => void` | — | `—` | @internal Add an import entity to the graph. Called by entitiesPhase. |
| 106 | `addExport` | method | `(exp: ExportEntity) => void` | — | `—` | @internal Add an export entity to the graph. Called by exportsPhase. |
| 107 | `addClass` | method | `(cls: ClassEntity) => void` | — | `—` | @internal Add a class entity to the graph. Called by entitiesPhase. |
| 108 | `addProperty` | method | `(prop: PropertyEntity) => void` | — | `—` | @internal Add a property entity to the graph. |
| 109 | `addPropertyAssignment` | method | `(pa: PropertyAssignmentEntity) => void` | — | `—` | @internal Add a property assignment entity to the graph. |
| 110 | `addConditionalSpread` | method | `(spread: ConditionalSpreadEntity) => void` | — | `—` | @internal Add a conditional spread entity to the graph. |
| 111 | `addObjectSpread` | method | `(spread: ObjectSpreadEntity) => void` | — | `—` | @internal Add an object spread entity to the graph. |
| 112 | `addNonNullAssertion` | method | `(assertion: NonNullAssertionEntity) => void` | — | `—` | @internal Add a non-null assertion entity to the graph. |
| 113 | `addTypeAssertion` | method | `(assertion: TypeAssertionEntity) => void` | — | `—` | @internal Add a type assertion entity to the graph. |
| 114 | `addTypePredicate` | method | `(predicate: TypePredicateEntity) => void` | — | `—` | @internal Add a type predicate entity to the graph. |
| 115 | `addUnsafeGenericAssertion` | method | `(assertion: UnsafeGenericAssertionEntity) => void` | — | `—` | @internal Add an unsafe generic assertion entity to the graph. |
| 116 | `addUnsafeTypeAnnotation` | method | `(annotation: UnsafeTypeAnnotationEntity) => void` | — | `—` | @internal Add an unsafe type annotation entity to the graph. |
| 117 | `addInlineImport` | method | `(imp: InlineImportEntity) => void` | — | `—` | @internal Add an inline import entity to the graph. |
| 118 | `addComputation` | method | `(computation: ComputationEntity) => void` | — | `—` | @internal Add a computation entity to the graph. Called by dependenciesPhase. |
| 119 | `addDependencyEdge` | method | `(edge: DependencyEdge) => void` | — | `—` | @internal Add a dependency edge to the graph. Called by dependenciesPhase. |
| 120 | `addOwnershipEdge` | method | `(edge: OwnershipEdge) => void` | — | `—` | @internal Add an ownership edge to the graph. Called by dependenciesPhase. |
| 121 | `buildReactiveIndex` | method | `() => void` | — | `—` | @internal Build reactive variable indexes. Called by reactivityPhase. |
| 122 | `addUnaryExpression` | method | `(node: ts.PrefixUnaryExpression) => void` | — | `—` | @internal |
| 123 | `addDeleteExpression` | method | `(node: ts.DeleteExpression) => void` | — | `—` | @internal |
| 124 | `addSpreadElement` | method | `(node: ts.SpreadElement \| ts.SpreadAssignment) => void` | — | `—` | @internal |
| 125 | `addNewExpressionByCallee` | method | `(name: string, node: ts.NewExpression) => void` | — | `—` | @internal |
| 126 | `addIdentifierReference` | method | `(node: ts.Identifier) => void` | — | `—` | @internal |
| 127 | `lineStartOffsets` | getter | `readonly number[]` | — | `—` | Line start offsets for position queries. Computed lazily — CLI lint never accesses this, so zero cost during analysis. |
| 128 | `findExpressionAtOffset` | method | `(offset: number) => ts.Node \| null` | — | `—` | Find the deepest expression at a character offset using the AST. O(log n) via TypeScript's getTokenAtPosition + parent walk. Zero pre-computation — no dense array, no per-node writes during analysis. |

## 2. CSSGraph

### CSSGraph (packages/ganko/src/css/impl.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `kind` | readonly-property | `string` | readonly | `"css" as const` | — |
| 2 | `options` | readonly-property | `CSSOptions` | readonly | `—` | — |
| 3 | `interner` | readonly-property | `StringInterner` | readonly | `—` | — |
| 4 | `logger` | readonly-property | `Logger` | readonly | `—` | — |
| 5 | `sourceOrder` | property | `number` | — | `0` | — |
| 6 | `hasScssFiles` | property | `boolean` | — | `false` | — |
| 7 | `files` | readonly-property | `FileEntity[]` | readonly | `[]` | — |
| 8 | `rules` | readonly-property | `RuleEntity[]` | readonly | `[]` | — |
| 9 | `selectors` | readonly-property | `SelectorEntity[]` | readonly | `[]` | — |
| 10 | `declarations` | readonly-property | `DeclarationEntity[]` | readonly | `[]` | — |
| 11 | `variables` | readonly-property | `VariableEntity[]` | readonly | `[]` | — |
| 12 | `variableRefs` | readonly-property | `VariableReferenceEntity[]` | readonly | `[]` | — |
| 13 | `atRules` | readonly-property | `AtRuleEntity[]` | readonly | `[]` | — |
| 14 | `tokens` | readonly-property | `ThemeTokenEntity[]` | readonly | `[]` | — |
| 15 | `mixins` | readonly-property | `MixinEntity[]` | readonly | `[]` | — |
| 16 | `includes` | readonly-property | `MixinIncludeEntity[]` | readonly | `[]` | — |
| 17 | `functions` | readonly-property | `SCSSFunctionEntity[]` | readonly | `[]` | — |
| 18 | `functionCalls` | readonly-property | `FunctionCallEntity[]` | readonly | `[]` | — |
| 19 | `placeholders` | readonly-property | `PlaceholderEntity[]` | readonly | `[]` | — |
| 20 | `extends` | readonly-property | `ExtendEntity[]` | readonly | `[]` | — |
| 21 | `filesByPath` | readonly-property | `Map<string, FileEntity>` | readonly | `new Map<string, FileEntity>()` | — |
| 22 | `variablesByName` | readonly-property | `Map<string, VariableEntity[]>` | readonly | `new Map<string, VariableEntity[]>()` | — |
| 23 | `rulesBySelector` | readonly-property | `Map<string, RuleEntity[]>` | readonly | `new Map<string, RuleEntity[]>()` | — |
| 24 | `_selectorDedupIndex` | readonly-property | `Map<string, RuleEntity[]>` | readonly | `new Map<string, RuleEntity[]>()` | @internal Dedup index keyed by file+parent+selector+media+layer for duplicate detection. |
| 25 | `mixinsByName` | readonly-property | `Map<string, MixinEntity>` | readonly | `new Map<string, MixinEntity>()` | — |
| 26 | `functionsByName` | readonly-property | `Map<string, SCSSFunctionEntity>` | readonly | `new Map<string, SCSSFunctionEntity>()` | — |
| 27 | `placeholdersByName` | readonly-property | `Map<string, PlaceholderEntity>` | readonly | `new Map<string, PlaceholderEntity>()` | — |
| 28 | `layerOrder` | readonly-property | `Map<string, number>` | readonly | `new Map<string, number>()` | — |
| 29 | `declarationsByProperty` | readonly-property | `Map<string, DeclarationEntity[]>` | readonly | `new Map<string, DeclarationEntity[]>()` | — |
| 30 | `atRulesByName` | readonly-property | `Map<string, AtRuleEntity[]>` | readonly | `new Map<string, AtRuleEntity[]>()` | — |
| 31 | `atRulesByKind` | readonly-property | `Map<AtRuleKind, AtRuleEntity[]>` | readonly | `new Map<AtRuleKind, AtRuleEntity[]>()` | — |
| 32 | `atRulesByNode` | readonly-property | `Map<AtRule, AtRuleEntity>` | readonly | `new Map<AtRule, AtRuleEntity>()` | — |
| 33 | `rulesByNode` | readonly-property | `Map<Rule, RuleEntity>` | readonly | `new Map<Rule, RuleEntity>()` | — |
| 34 | `duplicateSelectors` | readonly-property | `Map<string, { selector: string; rules: RuleEntity[] }>` | readonly | `new Map<string, { selector: string; rules: RuleEntity[] }>()` | — |
| 35 | `tokensByCategory` | readonly-property | `Map<TokenCategory, ThemeTokenEntity[]>` | readonly | `new Map<TokenCategory, ThemeTokenEntity[]>()` | — |
| 36 | `importantDeclarations` | readonly-property | `DeclarationEntity[]` | readonly | `[]` | — |
| 37 | `globalVariables` | readonly-property | `VariableEntity[]` | readonly | `[]` | — |
| 38 | `unusedVariables` | readonly-property | `VariableEntity[]` | readonly | `[]` | — |
| 39 | `scssVariables` | readonly-property | `VariableEntity[]` | readonly | `[]` | — |
| 40 | `cssCustomProperties` | readonly-property | `VariableEntity[]` | readonly | `[]` | — |
| 41 | `unresolvedRefs` | readonly-property | `VariableReferenceEntity[]` | readonly | `[]` | — |
| 42 | `mediaQueries` | readonly-property | `AtRuleEntity[]` | readonly | `[]` | — |
| 43 | `keyframes` | readonly-property | `AtRuleEntity[]` | readonly | `[]` | — |
| 44 | `layers` | readonly-property | `AtRuleEntity[]` | readonly | `[]` | — |
| 45 | `fontFaces` | readonly-property | `AtRuleEntity[]` | readonly | `[]` | — |
| 46 | `supportsRules` | readonly-property | `AtRuleEntity[]` | readonly | `[]` | — |
| 47 | `unusedKeyframes` | readonly-property | `AtRuleEntity[]` | readonly | `[]` | — |
| 48 | `unusedMixins` | readonly-property | `MixinEntity[]` | readonly | `[]` | — |
| 49 | `unresolvedMixinIncludes` | readonly-property | `MixinIncludeEntity[]` | readonly | `[]` | — |
| 50 | `unusedFunctions` | readonly-property | `SCSSFunctionEntity[]` | readonly | `[]` | — |
| 51 | `unusedPlaceholders` | readonly-property | `PlaceholderEntity[]` | readonly | `[]` | — |
| 52 | `unresolvedExtends` | readonly-property | `ExtendEntity[]` | readonly | `[]` | — |
| 53 | `parseErrors` | readonly-property | `CSSParseError[]` | readonly | `[]` | — |
| 54 | `failedFilePaths` | readonly-property | `string[]` | readonly | `[]` | — |
| 55 | `tokenCategories` | readonly-property | `TokenCategory[]` | readonly | `[]` | — |
| 56 | `_filesWithLayers` | property | `Set<string> \| null` | private | `null` | — |
| 57 | `filesWithLayers` | getter | `ReadonlySet<string>` | — | `—` | — |
| 58 | `selectorsByPseudoClass` | readonly-property | `Map<string, SelectorEntity[]>` | readonly | `new Map<string, SelectorEntity[]>()` | — |
| 59 | `knownKeyframeNames` | readonly-property | `Set<string>` | readonly | `new Set<string>()` | — |
| 60 | `unresolvedAnimationRefs` | readonly-property | `UnresolvedAnimationRef[]` | readonly | `[]` | — |
| 61 | `declaredContainerNames` | readonly-property | `Map<string, DeclarationEntity[]>` | readonly | `new Map<string, DeclarationEntity[]>()` | — |
| 62 | `containerQueryNames` | readonly-property | `Map<string, AtRuleEntity[]>` | readonly | `new Map<string, AtRuleEntity[]>()` | — |
| 63 | `unusedContainerNames` | readonly-property | `Map<string, DeclarationEntity[]>` | readonly | `new Map<string, DeclarationEntity[]>()` | — |
| 64 | `unknownContainerQueries` | readonly-property | `AtRuleEntity[]` | readonly | `[]` | — |
| 65 | `multiDeclarationProperties` | readonly-property | `Map<string, readonly DeclarationEntity[]>` | readonly | `new Map<string, readonly DeclarationEntity[]>()` | Properties with 2+ declarations, each value pre-sorted by sourceOrder. |
| 66 | `keyframeDeclarations` | readonly-property | `DeclarationEntity[]` | readonly | `[]` | Declarations whose parent rule is inside a @keyframes block. |
| 67 | `_emptyRules` | property | `RuleEntity[] \| null` | private | `null` | Rules with zero declarations, zero nested rules, and zero nested at-rules. |
| 68 | `emptyRules` | getter | `readonly RuleEntity[]` | — | `—` | — |
| 69 | `_emptyKeyframes` | property | `AtRuleEntity[] \| null` | private | `null` | @keyframes at-rules with no effective keyframe declarations. |
| 70 | `emptyKeyframes` | getter | `readonly AtRuleEntity[]` | — | `—` | — |
| 71 | `_overqualifiedSelectors` | property | `SelectorEntity[] \| null` | private | `null` | — |
| 72 | `overqualifiedSelectors` | getter | `readonly SelectorEntity[]` | — | `—` | — |
| 73 | `idSelectors` | readonly-property | `SelectorEntity[]` | readonly | `[]` | — |
| 74 | `attributeSelectors` | readonly-property | `SelectorEntity[]` | readonly | `[]` | — |
| 75 | `universalSelectors` | readonly-property | `SelectorEntity[]` | readonly | `[]` | — |
| 76 | `classNameIndex` | readonly-property | `Map<string, SelectorEntity[]>` | readonly | `new Map<string, SelectorEntity[]>()` | — |
| 77 | `selectorsBySubjectTag` | readonly-property | `Map<string, SelectorEntity[]>` | readonly | `new Map<string, SelectorEntity[]>()` | — |
| 78 | `selectorsWithoutSubjectTag` | readonly-property | `SelectorEntity[]` | readonly | `[]` | — |
| 79 | `selectorsTargetingCheckbox` | readonly-property | `SelectorEntity[]` | readonly | `[]` | — |
| 80 | `selectorsTargetingTableCell` | readonly-property | `SelectorEntity[]` | readonly | `[]` | — |
| 81 | `layoutPropertiesByClassToken` | readonly-property | `Map<string, readonly string[]>` | readonly | `new Map<string, readonly string[]>()` | — |
| 82 | `keyframeLayoutMutationsByName` | readonly-property | `Map<string, readonly KeyframeLayoutMutation[]>` | readonly | `new Map<string, readonly KeyframeLayoutMutation[]>()` | — |
| 83 | `fontFaceDescriptorsByFamily` | readonly-property | `Map<string, readonly FontFaceDescriptor[]>` | readonly | `new Map<string, readonly FontFaceDescriptor[]>()` | — |
| 84 | `usedFontFamiliesByRule` | readonly-property | `Map<number, readonly string[]>` | readonly | `new Map<number, readonly string[]>()` | — |
| 85 | `usedFontFamilies` | readonly-property | `Set<string>` | readonly | `new Set<string>()` | — |
| 86 | `tailwind` | readonly-property | `TailwindValidator \| null` | readonly | `—` | Tailwind validator for utility class lookup (null if not a Tailwind project). |
| 87 | `_deepNestedRules` | property | `RuleEntity[] \| null` | private | `null` | — |
| 88 | `deepNestedRules` | getter | `readonly RuleEntity[]` | — | `—` | — |
| 89 | `intern` | method | `(s: string) => string` | — | `—` | — |
| 90 | `nextFileId` | method | `() => number` | — | `—` | — |
| 91 | `nextRuleId` | method | `() => number` | — | `—` | — |
| 92 | `nextSelectorId` | method | `() => number` | — | `—` | — |
| 93 | `nextDeclarationId` | method | `() => number` | — | `—` | — |
| 94 | `nextVariableId` | method | `() => number` | — | `—` | — |
| 95 | `nextVariableRefId` | method | `() => number` | — | `—` | — |
| 96 | `nextAtRuleId` | method | `() => number` | — | `—` | — |
| 97 | `nextTokenId` | method | `() => number` | — | `—` | — |
| 98 | `nextMixinId` | method | `() => number` | — | `—` | — |
| 99 | `nextIncludeId` | method | `() => number` | — | `—` | — |
| 100 | `nextFunctionId` | method | `() => number` | — | `—` | — |
| 101 | `nextFunctionCallId` | method | `() => number` | — | `—` | — |
| 102 | `nextPlaceholderId` | method | `() => number` | — | `—` | — |
| 103 | `nextExtendId` | method | `() => number` | — | `—` | — |
| 104 | `nextSourceOrder` | method | `() => number` | — | `—` | — |
| 105 | `addFile` | method | `(file: FileEntity) => void` | — | `—` | — |
| 106 | `addRule` | method | `(rule: RuleEntity) => void` | — | `—` | — |
| 107 | `addSelector` | method | `(selector: SelectorEntity) => void` | — | `—` | — |
| 108 | `addDeclaration` | method | `(decl: DeclarationEntity) => void` | — | `—` | — |
| 109 | `addVariable` | method | `(variable: VariableEntity) => void` | — | `—` | — |
| 110 | `addVariableRef` | method | `(ref: VariableReferenceEntity) => void` | — | `—` | — |
| 111 | `addAtRule` | method | `(atRule: AtRuleEntity) => void` | — | `—` | — |
| 112 | `addToken` | method | `(token: ThemeTokenEntity) => void` | — | `—` | — |
| 113 | `addMixin` | method | `(mixin: MixinEntity) => void` | — | `—` | — |
| 114 | `addMixinInclude` | method | `(include: MixinIncludeEntity) => void` | — | `—` | — |
| 115 | `addFunction` | method | `(fn: SCSSFunctionEntity) => void` | — | `—` | — |
| 116 | `addFunctionCall` | method | `(call: FunctionCallEntity) => void` | — | `—` | — |
| 117 | `addPlaceholder` | method | `(placeholder: PlaceholderEntity) => void` | — | `—` | — |
| 118 | `addExtend` | method | `(ext: ExtendEntity) => void` | — | `—` | — |
| 119 | `addParseError` | method | `(error: CSSParseError) => void` | — | `—` | — |
| 120 | `addFailedFile` | method | `(path: string) => void` | — | `—` | — |
| 121 | `registerRuleBySelector` | method | `(selector: string, rule: RuleEntity) => void` | — | `—` | — |
| 122 | `registerLayerOrder` | method | `(name: string, order: number) => void` | — | `—` | — |
| 123 | `declarationsForProperties` | method | `(properties: string[]) => readonly DeclarationEntity[]` | — | `—` | Retrieve declarations matching any of the given property names. Uses the pre-built declarationsByProperty index for O(k) lookups. |
| 124 | `buildDerivedIndexes` | method | `() => void` | — | `—` | Build derived indexes that require all entities to be populated. Called after all phases complete. |
| 125 | `buildContainingMediaStacks` | method | `() => void` | private | `—` | — |
| 126 | `buildKeyframeIndexes` | method | `() => void` | private | `—` | — |
| 127 | `buildContainerNameIndexes` | method | `() => void` | private | `—` | — |
| 128 | `buildMultiDeclarationProperties` | method | `() => void` | private | `—` | Sort each declarationsByProperty list by sourceOrder and populate multiDeclarationProperties with only those having 2+ entries. |
| 129 | `buildLayoutPropertiesByClassToken` | method | `() => void` | private | `—` | — |
| 130 | `buildFontIndexes` | method | `() => void` | private | `—` | — |
| 131 | `buildUnusedIndexes` | method | `() => void` | — | `—` | — |

## 3. LayoutGraph

### LayoutCascadedDeclaration (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `value` | readonly-property | `string` | readonly | `—` | — |
| 2 | `source` | readonly-property | `LayoutSignalSource` | readonly | `—` | — |
| 3 | `guardProvenance` | readonly-property | `LayoutRuleGuard` | readonly | `—` | — |

### LayoutElementNode (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `key` | readonly-property | `string` | readonly | `—` | — |
| 2 | `solidFile` | readonly-property | `string` | readonly | `—` | — |
| 3 | `elementId` | readonly-property | `number` | readonly | `—` | — |
| 4 | `tag` | readonly-property | `string \| null` | readonly | `—` | — |
| 5 | `tagName` | readonly-property | `string \| null` | readonly | `—` | — |
| 6 | `classTokens` | readonly-property | `readonly string[]` | readonly | `—` | — |
| 7 | `classTokenSet` | readonly-property | `ReadonlySet<string>` | readonly | `—` | — |
| 8 | `inlineStyleKeys` | readonly-property | `readonly string[]` | readonly | `—` | — |
| 9 | `parentElementNode` | readonly-property | `LayoutElementNode \| null` | readonly | `—` | — |
| 10 | `previousSiblingNode` | readonly-property | `LayoutElementNode \| null` | readonly | `—` | — |
| 11 | `siblingIndex` | readonly-property | `number` | readonly | `—` | — |
| 12 | `siblingCount` | readonly-property | `number` | readonly | `—` | — |
| 13 | `siblingTypeIndex` | readonly-property | `number` | readonly | `—` | — |
| 14 | `siblingTypeCount` | readonly-property | `number` | readonly | `—` | — |
| 15 | `selectorDispatchKeys` | readonly-property | `readonly string[]` | readonly | `—` | — |
| 16 | `attributes` | readonly-property | `ReadonlyMap<string, string \| null>` | readonly | `—` | — |
| 17 | `inlineStyleValues` | readonly-property | `ReadonlyMap<string, string>` | readonly | `—` | — |
| 18 | `textualContent` | readonly-property | `LayoutTextualContentState` | readonly | `—` | — |
| 19 | `isControl` | readonly-property | `boolean` | readonly | `—` | — |
| 20 | `isReplaced` | readonly-property | `boolean` | readonly | `—` | — |

### LayoutStyleRuleNode (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `cssFile` | readonly-property | `string` | readonly | `—` | — |
| 2 | `ruleId` | readonly-property | `number` | readonly | `—` | — |
| 3 | `selectorId` | readonly-property | `number` | readonly | `—` | — |

### LayoutMatchEdge (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `selectorId` | readonly-property | `number` | readonly | `—` | — |
| 2 | `specificityScore` | readonly-property | `number` | readonly | `—` | — |
| 3 | `sourceOrder` | readonly-property | `number` | readonly | `—` | — |
| 4 | `conditionalMatch` | readonly-property | `boolean` | readonly | `—` | Whether the selector match is conditional due to dynamic attribute values. |

### LayoutElementRef (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `solid` | readonly-property | `SolidGraph` | readonly | `—` | — |
| 2 | `element` | readonly-property | `JSXElementEntity` | readonly | `—` | — |

### LayoutReservedSpaceFact (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `hasReservedSpace` | readonly-property | `boolean` | readonly | `—` | — |
| 2 | `reasons` | readonly-property | `readonly LayoutReservedSpaceReason[]` | readonly | `—` | — |
| 3 | `hasContainIntrinsicSize` | readonly-property | `boolean` | readonly | `—` | — |
| 4 | `hasUsableAspectRatio` | readonly-property | `boolean` | readonly | `—` | — |
| 5 | `hasDeclaredInlineDimension` | readonly-property | `boolean` | readonly | `—` | — |
| 6 | `hasDeclaredBlockDimension` | readonly-property | `boolean` | readonly | `—` | — |

### LayoutScrollContainerFact (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `isScrollContainer` | readonly-property | `boolean` | readonly | `—` | — |
| 2 | `axis` | readonly-property | `LayoutScrollAxis` | readonly | `—` | — |
| 3 | `overflow` | readonly-property | `string \| null` | readonly | `—` | — |
| 4 | `overflowY` | readonly-property | `string \| null` | readonly | `—` | — |
| 5 | `hasConditionalScroll` | readonly-property | `boolean` | readonly | `—` | — |
| 6 | `hasUnconditionalScroll` | readonly-property | `boolean` | readonly | `—` | — |

### LayoutFlowParticipationFact (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `inFlow` | readonly-property | `boolean` | readonly | `—` | — |
| 2 | `position` | readonly-property | `string \| null` | readonly | `—` | — |
| 3 | `hasConditionalOutOfFlow` | readonly-property | `boolean` | readonly | `—` | — |
| 4 | `hasUnconditionalOutOfFlow` | readonly-property | `boolean` | readonly | `—` | — |

### LayoutContainingBlockFact (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `nearestPositionedAncestorKey` | readonly-property | `string \| null` | readonly | `—` | — |
| 2 | `nearestPositionedAncestorHasReservedSpace` | readonly-property | `boolean` | readonly | `—` | — |

### LayoutConditionalSignalDeltaFact (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `hasConditional` | readonly-property | `boolean` | readonly | `—` | — |
| 2 | `hasDelta` | readonly-property | `boolean` | readonly | `—` | — |
| 3 | `conditionalValues` | readonly-property | `readonly string[]` | readonly | `—` | — |
| 4 | `unconditionalValues` | readonly-property | `readonly string[]` | readonly | `—` | — |
| 5 | `hasConditionalScrollValue` | readonly-property | `boolean` | readonly | `—` | — |
| 6 | `hasConditionalNonScrollValue` | readonly-property | `boolean` | readonly | `—` | — |
| 7 | `hasUnconditionalScrollValue` | readonly-property | `boolean` | readonly | `—` | — |
| 8 | `hasUnconditionalNonScrollValue` | readonly-property | `boolean` | readonly | `—` | — |

### LayoutStatefulSelectorEntry (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `raw` | readonly-property | `string` | readonly | `—` | — |
| 2 | `isStateful` | readonly-property | `boolean` | readonly | `—` | — |
| 3 | `statePseudoClasses` | readonly-property | `readonly string[]` | readonly | `—` | Pseudo-classes from STATE_PSEUDO_SET that caused this selector to be classified as stateful. |
| 4 | `isDirectInteraction` | readonly-property | `boolean` | readonly | `—` | True when ALL state pseudo-classes are "direct" interaction (hover, focus, active, etc.), meaning state changes only from the user physically interacting with the element itself. False when any pseudo |
| 5 | `baseLookupKeys` | readonly-property | `readonly string[]` | readonly | `—` | — |

### LayoutNormalizedRuleDeclaration (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `declarationId` | readonly-property | `number` | readonly | `—` | — |
| 2 | `property` | readonly-property | `string` | readonly | `—` | — |
| 3 | `normalizedValue` | readonly-property | `string` | readonly | `—` | — |
| 4 | `filePath` | readonly-property | `string` | readonly | `—` | — |
| 5 | `startLine` | readonly-property | `number` | readonly | `—` | — |
| 6 | `startColumn` | readonly-property | `number` | readonly | `—` | — |
| 7 | `propertyLength` | readonly-property | `number` | readonly | `—` | — |

### LayoutElementRecord (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `ref` | readonly-property | `LayoutElementRef \| null` | readonly | `—` | — |
| 2 | `edges` | readonly-property | `readonly LayoutMatchEdge[]` | readonly | `—` | — |
| 3 | `cascade` | readonly-property | `ReadonlyMap<string, LayoutCascadedDeclaration>` | readonly | `—` | — |
| 4 | `snapshot` | readonly-property | `LayoutSignalSnapshot` | readonly | `—` | — |
| 5 | `hotSignals` | readonly-property | `LayoutSnapshotHotSignals` | readonly | `—` | — |
| 6 | `reservedSpace` | readonly-property | `LayoutReservedSpaceFact` | readonly | `—` | — |
| 7 | `scrollContainer` | readonly-property | `LayoutScrollContainerFact` | readonly | `—` | — |
| 8 | `flowParticipation` | readonly-property | `LayoutFlowParticipationFact` | readonly | `—` | — |
| 9 | `containingBlock` | readonly-property | `LayoutContainingBlockFact` | readonly | `—` | — |
| 10 | `conditionalDelta` | readonly-property | `ReadonlyMap<LayoutSignalName, LayoutConditionalSignalDeltaFact> \| null` | readonly | `—` | — |
| 11 | `baselineOffsets` | readonly-property | `ReadonlyMap<LayoutSignalName, readonly number[]> \| null` | readonly | `—` | — |

### LayoutGraph (packages/ganko/src/cross-file/layout/graph.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `elements` | readonly-property | `readonly LayoutElementNode[]` | readonly | `—` | — |
| 2 | `childrenByParentNode` | readonly-property | `ReadonlyMap<LayoutElementNode, readonly LayoutElementNode[]>` | readonly | `—` | — |
| 3 | `elementBySolidFileAndId` | readonly-property | `ReadonlyMap<string, ReadonlyMap<number, LayoutElementNode>>` | readonly | `—` | — |
| 4 | `elementRefsBySolidFileAndId` | readonly-property | `ReadonlyMap<string, ReadonlyMap<number, LayoutElementRef>>` | readonly | `—` | — |
| 5 | `elementsByTagName` | readonly-property | `ReadonlyMap<string, readonly LayoutElementNode[]>` | readonly | `—` | — |
| 6 | `measurementNodeByRootKey` | readonly-property | `ReadonlyMap<string, LayoutElementNode>` | readonly | `—` | — |
| 7 | `hostElementRefsByNode` | readonly-property | `ReadonlyMap<LayoutElementNode, LayoutElementRef>` | readonly | `—` | — |
| 8 | `styleRules` | readonly-property | `readonly LayoutStyleRuleNode[]` | readonly | `—` | — |
| 9 | `applies` | readonly-property | `readonly LayoutMatchEdge[]` | readonly | `—` | — |
| 10 | `cssScopeBySolidFile` | readonly-property | `ReadonlyMap<string, readonly string[]>` | readonly | `—` | — |
| 11 | `selectorCandidatesByNode` | readonly-property | `ReadonlyMap<LayoutElementNode, readonly number[]>` | readonly | `—` | — |
| 12 | `selectorsById` | readonly-property | `ReadonlyMap<number, SelectorEntity>` | readonly | `—` | — |
| 13 | `records` | readonly-property | `ReadonlyMap<LayoutElementNode, LayoutElementRecord>` | readonly | `—` | — |
| 14 | `cohortStatsByParentNode` | readonly-property | `ReadonlyMap<LayoutElementNode, LayoutCohortStats>` | readonly | `—` | — |
| 15 | `contextByParentNode` | readonly-property | `ReadonlyMap<LayoutElementNode, AlignmentContext>` | readonly | `—` | — |
| 16 | `elementsWithConditionalDeltaBySignal` | readonly-property | `ReadonlyMap<LayoutSignalName, readonly LayoutElementNode[]>` | readonly | `—` | — |
| 17 | `elementsWithConditionalOverflowDelta` | readonly-property | `readonly LayoutElementNode[]` | readonly | `—` | — |
| 18 | `elementsWithConditionalOffsetDelta` | readonly-property | `readonly LayoutElementNode[]` | readonly | `—` | — |
| 19 | `elementsByKnownSignalValue` | readonly-property | `ReadonlyMap<LayoutSignalName, ReadonlyMap<string, readonly LayoutElementNode[]>>` | readonly | `—` | — |
| 20 | `dynamicSlotCandidateElements` | readonly-property | `readonly LayoutElementNode[]` | readonly | `—` | — |
| 21 | `scrollContainerElements` | readonly-property | `readonly LayoutElementNode[]` | readonly | `—` | — |
| 22 | `statefulSelectorEntriesByRuleId` | readonly-property | `ReadonlyMap<number, readonly LayoutStatefulSelectorEntry[]>` | readonly | `—` | — |
| 23 | `statefulNormalizedDeclarationsByRuleId` | readonly-property | `ReadonlyMap<number, readonly LayoutNormalizedRuleDeclaration[]>` | readonly | `—` | — |
| 24 | `statefulBaseValueIndex` | readonly-property | `ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>` | readonly | `—` | — |
| 25 | `perf` | readonly-property | `LayoutPerfStatsMutable` | readonly | `—` | — |

## 4. Signal Model

### LayoutKnownSignalValue (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `kind` | readonly-property | `SignalValueKind.Known` | readonly | `—` | — |
| 2 | `name` | readonly-property | `LayoutSignalName` | readonly | `—` | — |
| 3 | `normalized` | readonly-property | `string` | readonly | `—` | — |
| 4 | `source` | readonly-property | `LayoutSignalSource` | readonly | `—` | — |
| 5 | `guard` | readonly-property | `LayoutRuleGuard` | readonly | `—` | — |
| 6 | `unit` | readonly-property | `LayoutSignalUnit` | readonly | `—` | — |
| 7 | `px` | readonly-property | `number \| null` | readonly | `—` | — |
| 8 | `quality` | readonly-property | `SignalQuality` | readonly | `—` | — |

### LayoutUnknownSignalValue (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `kind` | readonly-property | `SignalValueKind.Unknown` | readonly | `—` | — |
| 2 | `name` | readonly-property | `LayoutSignalName` | readonly | `—` | — |
| 3 | `source` | readonly-property | `LayoutSignalSource \| null` | readonly | `—` | — |
| 4 | `guard` | readonly-property | `LayoutRuleGuard` | readonly | `—` | — |
| 5 | `reason` | readonly-property | `string` | readonly | `—` | — |

### LayoutSignalSnapshot (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `node` | readonly-property | `LayoutElementNode` | readonly | `—` | — |
| 2 | `signals` | readonly-property | `ReadonlyMap<LayoutSignalName, LayoutSignalValue>` | readonly | `—` | — |
| 3 | `knownSignalCount` | readonly-property | `number` | readonly | `—` | — |
| 4 | `unknownSignalCount` | readonly-property | `number` | readonly | `—` | — |
| 5 | `conditionalSignalCount` | readonly-property | `number` | readonly | `—` | — |

### AlignmentElementEvidence (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `solidFile` | readonly-property | `string` | readonly | `—` | — |
| 2 | `elementKey` | readonly-property | `string` | readonly | `—` | — |
| 3 | `elementId` | readonly-property | `number` | readonly | `—` | — |
| 4 | `tag` | readonly-property | `string \| null` | readonly | `—` | — |
| 5 | `snapshot` | readonly-property | `LayoutSignalSnapshot` | readonly | `—` | — |

### AlignmentCohort (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `parentElementKey` | readonly-property | `string` | readonly | `—` | — |
| 2 | `parentElementId` | readonly-property | `number` | readonly | `—` | — |
| 3 | `parentTag` | readonly-property | `string \| null` | readonly | `—` | — |
| 4 | `siblingCount` | readonly-property | `number` | readonly | `—` | — |

### SignalConflictEvidence (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `value` | readonly-property | `SignalConflictValue` | readonly | `—` | — |
| 2 | `kind` | readonly-property | `EvidenceValueKind` | readonly | `—` | — |

### AlignmentCohortSignals (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `verticalAlign` | readonly-property | `SignalConflictEvidence` | readonly | `—` | — |
| 2 | `alignSelf` | readonly-property | `SignalConflictEvidence` | readonly | `—` | — |
| 3 | `placeSelf` | readonly-property | `SignalConflictEvidence` | readonly | `—` | — |
| 4 | `hasControlOrReplacedPeer` | readonly-property | `boolean` | readonly | `—` | — |
| 5 | `textContrastWithPeers` | readonly-property | `AlignmentTextContrast` | readonly | `—` | — |

### CohortIdentifiability (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `dominantShare` | readonly-property | `number` | readonly | `—` | — |
| 2 | `subjectExcludedDominantShare` | readonly-property | `number` | readonly | `—` | — |
| 3 | `subjectMembership` | readonly-property | `CohortSubjectMembership` | readonly | `—` | — |
| 4 | `ambiguous` | readonly-property | `boolean` | readonly | `—` | — |
| 5 | `kind` | readonly-property | `EvidenceValueKind` | readonly | `—` | — |

### AlignmentCohortProfile (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `medianDeclaredOffsetPx` | readonly-property | `number \| null` | readonly | `—` | — |
| 2 | `declaredOffsetDispersionPx` | readonly-property | `number \| null` | readonly | `—` | — |
| 3 | `medianEffectiveOffsetPx` | readonly-property | `number \| null` | readonly | `—` | — |
| 4 | `effectiveOffsetDispersionPx` | readonly-property | `number \| null` | readonly | `—` | — |
| 5 | `medianLineHeightPx` | readonly-property | `number \| null` | readonly | `—` | — |
| 6 | `lineHeightDispersionPx` | readonly-property | `number \| null` | readonly | `—` | — |
| 7 | `dominantClusterSize` | readonly-property | `number` | readonly | `—` | — |
| 8 | `dominantClusterShare` | readonly-property | `number` | readonly | `—` | — |
| 9 | `unimodal` | readonly-property | `boolean` | readonly | `—` | — |

### AlignmentCohortFactSummary (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `exact` | readonly-property | `number` | readonly | `—` | — |
| 2 | `interval` | readonly-property | `number` | readonly | `—` | — |
| 3 | `unknown` | readonly-property | `number` | readonly | `—` | — |
| 4 | `conditional` | readonly-property | `number` | readonly | `—` | — |
| 5 | `total` | readonly-property | `number` | readonly | `—` | — |
| 6 | `exactShare` | readonly-property | `number` | readonly | `—` | — |
| 7 | `intervalShare` | readonly-property | `number` | readonly | `—` | — |
| 8 | `unknownShare` | readonly-property | `number` | readonly | `—` | — |
| 9 | `conditionalShare` | readonly-property | `number` | readonly | `—` | — |

### HotEvidenceWitness (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `present` | readonly-property | `boolean` | readonly | `—` | — |

### LayoutSnapshotHotSignals (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `lineHeight` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |
| 2 | `verticalAlign` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 3 | `alignSelf` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 4 | `placeSelf` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 5 | `flexDirection` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 6 | `gridAutoFlow` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 7 | `writingMode` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 8 | `direction` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 9 | `display` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 10 | `alignItems` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 11 | `placeItems` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 12 | `position` | readonly-property | `HotNormalizedSignalEvidence` | readonly | `—` | — |
| 13 | `insetBlockStart` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |
| 14 | `insetBlockEnd` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |
| 15 | `transform` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |
| 16 | `translate` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |
| 17 | `top` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |
| 18 | `bottom` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |
| 19 | `marginTop` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |
| 20 | `marginBottom` | readonly-property | `HotNumericSignalEvidence` | readonly | `—` | — |

### LayoutCohortSubjectStats (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `element` | readonly-property | `AlignmentElementEvidence` | readonly | `—` | — |
| 2 | `declaredOffset` | readonly-property | `NumericEvidenceValue` | readonly | `—` | — |
| 3 | `effectiveOffset` | readonly-property | `NumericEvidenceValue` | readonly | `—` | — |
| 4 | `lineHeight` | readonly-property | `NumericEvidenceValue` | readonly | `—` | — |
| 5 | `baselineProfile` | readonly-property | `AlignmentCohortProfile` | readonly | `—` | — |
| 6 | `signals` | readonly-property | `AlignmentCohortSignals` | readonly | `—` | — |
| 7 | `identifiability` | readonly-property | `CohortIdentifiability` | readonly | `—` | — |
| 8 | `contentComposition` | readonly-property | `ContentCompositionFingerprint` | readonly | `—` | — |

### LayoutCohortStats (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `profile` | readonly-property | `AlignmentCohortProfile` | readonly | `—` | — |
| 2 | `snapshots` | readonly-property | `readonly LayoutSignalSnapshot[]` | readonly | `—` | — |
| 3 | `factSummary` | readonly-property | `AlignmentCohortFactSummary` | readonly | `—` | — |
| 4 | `provenance` | readonly-property | `EvidenceProvenance` | readonly | `—` | — |
| 5 | `conditionalSignalCount` | readonly-property | `number` | readonly | `—` | — |
| 6 | `totalSignalCount` | readonly-property | `number` | readonly | `—` | — |
| 7 | `subjectsByElementKey` | readonly-property | `ReadonlyMap<string, LayoutCohortSubjectStats>` | readonly | `—` | — |
| 8 | `excludedElementKeys` | readonly-property | `ReadonlySet<string>` | readonly | `—` | Element keys excluded from cohort analysis (e.g. visually-hidden accessible elements). |

### AlignmentCase (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `subject` | readonly-property | `AlignmentElementEvidence` | readonly | `—` | — |
| 2 | `cohort` | readonly-property | `AlignmentCohort` | readonly | `—` | — |
| 3 | `cohortProfile` | readonly-property | `AlignmentCohortProfile` | readonly | `—` | — |
| 4 | `cohortSignals` | readonly-property | `AlignmentCohortSignals` | readonly | `—` | — |
| 5 | `subjectIdentifiability` | readonly-property | `CohortIdentifiability` | readonly | `—` | — |
| 6 | `factorCoverage` | readonly-property | `AlignmentFactorCoverage` | readonly | `—` | — |
| 7 | `cohortSnapshots` | readonly-property | `readonly LayoutSignalSnapshot[]` | readonly | `—` | — |
| 8 | `cohortFactSummary` | readonly-property | `AlignmentCohortFactSummary` | readonly | `—` | — |
| 9 | `cohortProvenance` | readonly-property | `EvidenceProvenance` | readonly | `—` | — |
| 10 | `subjectDeclaredOffsetDeviation` | readonly-property | `NumericEvidenceValue` | readonly | `—` | — |
| 11 | `subjectEffectiveOffsetDeviation` | readonly-property | `NumericEvidenceValue` | readonly | `—` | — |
| 12 | `subjectLineHeightDeviation` | readonly-property | `NumericEvidenceValue` | readonly | `—` | — |
| 13 | `context` | readonly-property | `AlignmentContext` | readonly | `—` | — |
| 14 | `subjectContentComposition` | readonly-property | `ContentCompositionFingerprint` | readonly | `—` | — |
| 15 | `cohortContentCompositions` | readonly-property | `readonly ContentCompositionFingerprint[]` | readonly | `—` | — |

### ContentCompositionFingerprint (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `hasTextContent` | readonly-property | `boolean` | readonly | `—` | — |
| 2 | `hasInlineReplaced` | readonly-property | `boolean` | readonly | `—` | — |
| 3 | `inlineReplacedKind` | readonly-property | `InlineReplacedKind \| null` | readonly | `—` | — |
| 4 | `hasHeightContributingDescendant` | readonly-property | `boolean` | readonly | `—` | — |
| 5 | `wrappingContextMitigates` | readonly-property | `boolean` | readonly | `—` | — |
| 6 | `hasVerticalAlignMitigation` | readonly-property | `boolean` | readonly | `—` | — |
| 7 | `mixedContentDepth` | readonly-property | `number` | readonly | `—` | — |
| 8 | `classification` | readonly-property | `ContentCompositionClassification` | readonly | `—` | — |
| 9 | `analyzableChildCount` | readonly-property | `number` | readonly | `—` | — |
| 10 | `totalChildCount` | readonly-property | `number` | readonly | `—` | — |
| 11 | `hasOnlyBlockChildren` | readonly-property | `boolean` | readonly | `—` | — |

### EvidenceWitness (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `value` | readonly-property | `T \| null` | readonly | `—` | — |
| 2 | `kind` | readonly-property | `EvidenceValueKind` | readonly | `—` | — |

### EvidenceProvenance (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `reason` | readonly-property | `string` | readonly | `—` | — |
| 2 | `guardKey` | readonly-property | `string` | readonly | `—` | — |
| 3 | `guards` | readonly-property | `readonly LayoutGuardConditionProvenance[]` | readonly | `—` | — |

### LogOddsInterval (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `min` | readonly-property | `number` | readonly | `—` | — |
| 2 | `max` | readonly-property | `number` | readonly | `—` | — |

### EvidenceAtom (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `factorId` | readonly-property | `AlignmentFactorId` | readonly | `—` | — |
| 2 | `valueKind` | readonly-property | `EvidenceValueKind` | readonly | `—` | — |
| 3 | `contribution` | readonly-property | `LogOddsInterval` | readonly | `—` | — |
| 4 | `provenance` | readonly-property | `EvidenceProvenance` | readonly | `—` | — |
| 5 | `relevanceWeight` | readonly-property | `number` | readonly | `—` | — |
| 6 | `coverage` | readonly-property | `number` | readonly | `—` | — |

### PosteriorInterval (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `lower` | readonly-property | `number` | readonly | `—` | — |
| 2 | `upper` | readonly-property | `number` | readonly | `—` | — |

### AlignmentSignalFinding (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `kind` | readonly-property | `AlignmentFindingKind` | readonly | `—` | — |
| 2 | `message` | readonly-property | `string` | readonly | `—` | — |
| 3 | `fix` | readonly-property | `string` | readonly | `—` | — |
| 4 | `weight` | readonly-property | `number` | readonly | `—` | — |

### AlignmentEvaluation (packages/ganko/src/cross-file/layout/signal-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `severity` | readonly-property | `number` | readonly | `—` | — |
| 2 | `confidence` | readonly-property | `number` | readonly | `—` | — |
| 3 | `declaredOffsetPx` | readonly-property | `number \| null` | readonly | `—` | — |
| 4 | `estimatedOffsetPx` | readonly-property | `number \| null` | readonly | `—` | — |
| 5 | `contextKind` | readonly-property | `AlignmentContextKind` | readonly | `—` | — |
| 6 | `contextCertainty` | readonly-property | `ContextCertainty` | readonly | `—` | — |
| 7 | `posterior` | readonly-property | `PosteriorInterval` | readonly | `—` | — |
| 8 | `evidenceMass` | readonly-property | `number` | readonly | `—` | — |
| 9 | `topFactors` | readonly-property | `readonly AlignmentFactorId[]` | readonly | `—` | — |
| 10 | `signalFindings` | readonly-property | `readonly AlignmentSignalFinding[]` | readonly | `—` | — |

### Signal Enums and Type Aliases

```typescript
export type LayoutSignalName = (typeof layoutSignalNames)[number]

export const enum LayoutSignalSource { Selector = 0, InlineStyle = 1 }

export const enum LayoutSignalGuard { Unconditional = 0, Conditional = 1 }

export const enum LayoutSignalUnit { Px = 0, Unitless = 1, Keyword = 2, Unknown = 3 }

export const enum SignalValueKind { Known = 0, Unknown = 1 }

export const enum SignalQuality { Exact = 0, Estimated = 1 }

export const enum LayoutTextualContentState { Yes = 0, No = 1, Unknown = 2, DynamicText = 3 }

export const enum AlignmentTextContrast { Different = 0, Same = 1, Unknown = 2 }

export const enum SignalConflictValue { Conflict = 0, Aligned = 1, Unknown = 2 }

export const enum CohortSubjectMembership { Dominant = 0, Nondominant = 1, Ambiguous = 2, Insufficient = 3 }

export type AlignmentFactorCoverage = Readonly<Record<AlignmentFactorId, number>>

export type HotNumericSignalEvidence = HotEvidenceWitness<number>

export type HotNormalizedSignalEvidence = HotEvidenceWitness<string>

export type AlignmentFindingKind =
  | "offset-delta"
  | "declared-offset-delta"
  | "baseline-conflict"
  | "context-conflict"
  | "replaced-control-risk"
  | "content-composition-conflict"

export type AlignmentFactorId =
  | "offset-delta"
  | "declared-offset-delta"
  | "baseline-conflict"
  | "context-conflict"
  | "replaced-control-risk"
  | "content-composition-conflict"
  | "context-certainty"

export const enum ContentCompositionClassification {
  TextOnly = 0, ReplacedOnly = 1, MixedUnmitigated = 2,
  MixedMitigated = 3, BlockSegmented = 4, Unknown = 5,
}

/**
 * Distinguishes intrinsically-replaced elements (img, svg, video, canvas) from
 * inline-block/inline-flex containers. Their baseline rules differ: an img uses
 * its bottom edge as the baseline, while an inline-block uses its last line of text.
 */
export type InlineReplacedKind = "intrinsic" | "container"

export const enum EvidenceValueKind { Exact = 0, Interval = 1, Conditional = 2, Unknown = 3 }

export type NumericEvidenceValue = EvidenceWitness<number>

```

## 5. Guard Model

### LayoutGuardConditionProvenance (packages/ganko/src/cross-file/layout/guard-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `kind` | readonly-property | `LayoutGuardConditionKind` | readonly | `—` | — |
| 2 | `query` | readonly-property | `string \| null` | readonly | `—` | — |
| 3 | `key` | readonly-property | `string` | readonly | `—` | — |

### Guard Enums

```typescript
export type LayoutRuleGuard =
  | {
    readonly kind: LayoutSignalGuard.Unconditional
    readonly conditions: readonly LayoutGuardConditionProvenance[]
    readonly key: "always"
  }
  | {
    readonly kind: LayoutSignalGuard.Conditional
    readonly conditions: readonly LayoutGuardConditionProvenance[]
    readonly key: string
  }

```

## 6. Context Model (AlignmentContext)

### AlignmentContext (packages/ganko/src/cross-file/layout/context-model.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `kind` | readonly-property | `AlignmentContextKind` | readonly | `—` | — |
| 2 | `certainty` | readonly-property | `ContextCertainty` | readonly | `—` | — |
| 3 | `parentSolidFile` | readonly-property | `string` | readonly | `—` | — |
| 4 | `parentElementId` | readonly-property | `number` | readonly | `—` | — |
| 5 | `parentElementKey` | readonly-property | `string` | readonly | `—` | — |
| 6 | `parentTag` | readonly-property | `string \| null` | readonly | `—` | — |
| 7 | `axis` | readonly-property | `LayoutAxisModel` | readonly | `—` | — |
| 8 | `axisCertainty` | readonly-property | `ContextCertainty` | readonly | `—` | — |
| 9 | `inlineDirection` | readonly-property | `InlineDirectionModel` | readonly | `—` | — |
| 10 | `inlineDirectionCertainty` | readonly-property | `ContextCertainty` | readonly | `—` | — |
| 11 | `parentDisplay` | readonly-property | `string \| null` | readonly | `—` | — |
| 12 | `parentAlignItems` | readonly-property | `string \| null` | readonly | `—` | — |
| 13 | `parentPlaceItems` | readonly-property | `string \| null` | readonly | `—` | — |
| 14 | `hasPositionedOffset` | readonly-property | `boolean` | readonly | `—` | — |
| 15 | `crossAxisIsBlockAxis` | readonly-property | `boolean` | readonly | `—` | Whether the layout container's cross axis aligns with the document's block axis. When `true`, vertical sibling offset differences represent genuine alignment issues. When `false`, the block axis is th |
| 16 | `crossAxisIsBlockAxisCertainty` | readonly-property | `ContextCertainty` | readonly | `—` | — |
| 17 | `baselineRelevance` | readonly-property | `BaselineRelevance` | readonly | `—` | — |
| 18 | `evidence` | readonly-property | `LayoutContextEvidence` | readonly | `—` | — |

### Context Enums

```typescript
export type AlignmentContextKind =
  | "inline-formatting"
  | "table-cell"
  | "flex-cross-axis"
  | "grid-cross-axis"
  | "block-flow"
  | "positioned-offset"

export const enum ContextCertainty { Resolved = 0, Conditional = 1, Unknown = 2 }

/**
 * Whether the CSS formatting context consults baselines for vertical positioning.
 *
 * - `"relevant"`: Baselines participate in alignment (e.g. flex `align-items: baseline`,
 *   table-cell `vertical-align: baseline`, inline formatting context).
 * - `"irrelevant"`: The alignment model is purely geometric; baselines are never
 *   consulted (e.g. flex `align-items: center`, table-cell `vertical-align: middle`
 *   with uniform cohort agreement).
 *
 * Computed once at context construction for flex/grid (parent-level data suffices).
 * For table-cell contexts, finalized after cohort aggregation when the cohort's
 * vertical-align consensus is known.
 *
 * CSS spec references:
 * - Flex: CSS Flexbox §8.3, §9.6 — `center` aligns by margin box center, not baselines.
 * - Grid: CSS Grid §10.6 — analogous to flex.
 * - Table: CSS2 §17.5.3 — `middle` centers cell content geometrically.
 */
export type BaselineRelevance = "relevant" | "irrelevant"

```

## 7. Layout Signal Names

```typescript
export const layoutSignalNames = [
  "line-height",
  "font-size",
  "width",
  "inline-size",
  "height",
  "block-size",
  "min-width",
  "min-block-size",
  "min-height",
  "max-width",
  "max-height",
  "aspect-ratio",
  "vertical-align",
  "display",
  "white-space",
  "object-fit",
  "overflow",
  "overflow-y",
  "overflow-anchor",
  "scrollbar-gutter",
  "scrollbar-width",
  "contain-intrinsic-size",
  "content-visibility",
  "align-items",
  "align-self",
  "justify-items",
  "place-items",
  "place-self",
  "flex-direction",
  "flex-basis",
  "grid-auto-flow",
  "appearance",
  "box-sizing",
  "padding-top",
  "padding-left",
  "padding-right",
  "padding-bottom",
  "border-top-width",
  "border-left-width",
  "border-right-width",
  "border-bottom-width",
  "position",
  "top",
  "bottom",
  "margin-top",
  "margin-bottom",
  "transform",
  "translate",
  "inset-block-start",
  "inset-block-end",
  "writing-mode",
  "direction",
  "contain",
] as const
```

## 8. Cross-File Rules

```typescript
import { jsxNoUndefinedCssClass } from "./undefined-css-class"
import { cssNoUnreferencedComponentClass } from "./unreferenced-css-class"
import { jsxNoDuplicateClassTokenClassClasslist } from "./jsx-no-duplicate-class-token-class-classlist"
import { jsxClasslistStaticKeys } from "./jsx-classlist-static-keys"
import { jsxClasslistNoConstantLiterals } from "./jsx-classlist-no-constant-literals"
import { jsxClasslistBooleanValues } from "./jsx-classlist-boolean-values"
import { jsxClasslistNoAccessorReference } from "./jsx-classlist-no-accessor-reference"
import { jsxStyleKebabCaseKeys } from "./jsx-style-kebab-case-keys"
import { jsxStyleNoFunctionValues } from "./jsx-style-no-function-values"
import { jsxStyleNoUnusedCustomProp } from "./jsx-style-no-unused-custom-prop"
import { jsxStylePolicy } from "./jsx-style-policy"
import { cssLayoutSiblingAlignmentOutlier } from "./css-layout-sibling-alignment-outlier"
import { cssLayoutTransitionLayoutProperty } from "./css-layout-transition-layout-property"
import { cssLayoutAnimationLayoutProperty } from "./css-layout-animation-layout-property"
import { cssLayoutStatefulBoxModelShift } from "./css-layout-stateful-box-model-shift"
import { cssLayoutUnsizedReplacedElement } from "./css-layout-unsized-replaced-element"
import { cssLayoutDynamicSlotNoReservedSpace } from "./css-layout-dynamic-slot-no-reserved-space"
import { cssLayoutScrollbarGutterInstability } from "./css-layout-scrollbar-gutter-instability"
import { cssLayoutOverflowAnchorInstability } from "./css-layout-overflow-anchor-instability"
import { cssLayoutFontSwapInstability } from "./css-layout-font-swap-instability"
import { cssLayoutConditionalDisplayCollapse } from "./css-layout-conditional-display-collapse"
import { cssLayoutConditionalWhiteSpaceWrapShift } from "./css-layout-conditional-white-space-wrap-shift"
import { cssLayoutOverflowModeToggleInstability } from "./css-layout-overflow-mode-toggle-instability"
import { cssLayoutBoxSizingToggleWithChrome } from "./css-layout-box-sizing-toggle-with-chrome"
import { cssLayoutContentVisibilityNoIntrinsicSize } from "./css-layout-content-visibility-no-intrinsic-size"
import { cssLayoutConditionalOffsetShift } from "./css-layout-conditional-offset-shift"
import { jsxLayoutUnstableStyleToggle } from "./jsx-layout-unstable-style-toggle"
import { jsxLayoutClasslistGeometryToggle } from "./jsx-layout-classlist-geometry-toggle"
import { jsxLayoutPictureSourceRatioConsistency } from "./jsx-layout-picture-source-ratio-consistency"
import { jsxLayoutFillImageParentMustBeSized } from "./jsx-layout-fill-image-parent-must-be-sized"
import { jsxLayoutPolicyTouchTarget } from "./jsx-layout-policy-touch-target"

export const rules = [
  jsxNoUndefinedCssClass,
  cssNoUnreferencedComponentClass,
  jsxNoDuplicateClassTokenClassClasslist,
  jsxClasslistStaticKeys,
  jsxClasslistNoConstantLiterals,
  jsxClasslistBooleanValues,
  jsxClasslistNoAccessorReference,
  jsxStyleKebabCaseKeys,
  jsxStyleNoFunctionValues,
  jsxStyleNoUnusedCustomProp,
  jsxStylePolicy,
  jsxLayoutUnstableStyleToggle,
  jsxLayoutClasslistGeometryToggle,
  jsxLayoutPictureSourceRatioConsistency,
  jsxLayoutFillImageParentMustBeSized,
  cssLayoutSiblingAlignmentOutlier,
  cssLayoutTransitionLayoutProperty,
  cssLayoutAnimationLayoutProperty,
  cssLayoutStatefulBoxModelShift,
  cssLayoutUnsizedReplacedElement,
  cssLayoutDynamicSlotNoReservedSpace,
  cssLayoutScrollbarGutterInstability,
  cssLayoutOverflowAnchorInstability,
  cssLayoutFontSwapInstability,
  cssLayoutConditionalDisplayCollapse,
  cssLayoutConditionalWhiteSpaceWrapShift,
  cssLayoutOverflowModeToggleInstability,
  cssLayoutBoxSizingToggleWithChrome,
  cssLayoutContentVisibilityNoIntrinsicSize,
  cssLayoutConditionalOffsetShift,
  jsxLayoutPolicyTouchTarget,
] as const

```

## 9. CrossRule Interface

```typescript
import type { BaseRule } from "../graph"
import type { SolidGraph } from "../solid/impl"
import type { CSSGraph } from "../css/impl"
import type { LayoutGraph } from "./layout"
import type { Logger } from "@drskillissue/ganko-shared"

export interface CrossRuleContext {
  readonly solids: readonly SolidGraph[]
  readonly css: CSSGraph
  readonly layout: LayoutGraph
  readonly logger: Logger
}

/**
 * A cross-file lint rule that requires both Solid and CSS graphs.
 */
export type CrossRule = BaseRule<CrossRuleContext>

/**
 * Define a cross-file lint rule.
 * @param def Rule definition
 * @returns The same rule definition
 */
export function defineCrossRule(def: CrossRule): CrossRule {
  return def
}

```

## 10. GraphCache

### GraphCache (packages/ganko/src/cache.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `log` | readonly-property | `Logger` | private, readonly | `—` | — |
| 2 | `solids` | readonly-property | `Map<string, CachedSolid>` | private, readonly | `new Map<string, CachedSolid>()` | — |
| 3 | `crossFileDiagnostics` | readonly-property | `Map<string, readonly Diagnostic[]>` | private, readonly | `new Map<string, readonly Diagnostic[]>()` | — |
| 4 | `crossFileResults` | property | `CachedCrossFileResults \| null` | private | `null` | — |
| 5 | `css` | property | `CachedCSS \| null` | private | `null` | — |
| 6 | `solidGeneration` | property | `number` | private | `0` | — |
| 7 | `cssGeneration` | property | `number` | private | `0` | — |
| 8 | `layout` | property | `CachedLayout \| null` | private | `null` | — |
| 9 | `hasSolidGraph` | method | `(path: string, version: string) => boolean` | — | `—` | Check if a SolidGraph is cached and current for a file path.  Allows callers to skip builder allocation when the cache is warm.  @param path Absolute file path @param version Script version string fro |
| 10 | `setSolidGraph` | method | `(path: string, version: string, graph: SolidGraph) => void` | — | `—` | Store a pre-built SolidGraph in the cache.  Used by the CLI lint command which builds graphs during single-file analysis and pre-populates the cache for cross-file reuse.  @param path Absolute file pa |
| 11 | `getCachedSolidGraph` | method | `(path: string, version: string) => SolidGraph \| null` | — | `—` | Get a cached SolidGraph without building on miss.  Returns the cached graph if the version matches, null otherwise. Use when the caller has already confirmed the entry exists via `hasSolidGraph` and w |
| 12 | `getSolidGraph` | method | `(path: string, version: string, build: () => SolidGraph) => SolidGraph` | — | `—` | Get or build a SolidGraph for a file path.  Returns the cached graph if the version matches. Otherwise invokes the builder, caches the result, and returns it.  @param path Absolute file path @param ve |
| 13 | `getCSSGraph` | method | `(build: () => CSSGraph) => CSSGraph` | — | `—` | Get the cached CSSGraph, or rebuild it.  Returns the cached graph if the generation matches the current CSS generation counter. Otherwise invokes the builder, caches the result at the current generati |
| 14 | `getLayoutGraph` | method | `(build: () => LayoutGraph) => LayoutGraph` | — | `—` | Get or build a LayoutGraph for current Solid/CSS cache state.  Returns cached LayoutGraph when both Solid signature (path+version) and CSS generation match. Otherwise invokes the builder.  @param buil |
| 15 | `invalidate` | method | `(path: string) => void` | — | `—` | Invalidate cached graphs affected by a file change.  Classifies the path and invalidates the appropriate cache: solid files evict their per-file SolidGraph, CSS files bump the CSSGraph generation coun |
| 16 | `invalidateAll` | method | `() => void` | — | `—` | Invalidate all cached graphs.  Called on workspace-level events like config changes. |
| 17 | `getAllSolidGraphs` | method | `() => readonly SolidGraph[]` | — | `—` | Get all cached SolidGraphs.  Returns a snapshot array of all currently-cached graphs. Used by cross-file analysis which needs all SolidGraphs. |
| 18 | `getCachedCSSGraph` | method | `() => CSSGraph \| null` | — | `—` | Get the cached CSSGraph, or null if not cached. |
| 19 | `getCachedLayoutGraph` | method | `() => LayoutGraph \| null` | — | `—` | Get the cached LayoutGraph, or null if not cached. |
| 20 | `getCachedCrossFileDiagnostics` | method | `(path: string) => readonly Diagnostic[]` | — | `—` | Get cached cross-file diagnostics for a file path.  Returns the previous cross-file results so single-file-only re-analysis (during typing) can merge them without re-running cross-file rules.  @param  |
| 21 | `setCachedCrossFileDiagnostics` | method | `(path: string, diagnostics: readonly Diagnostic[]) => void` | — | `—` | Store cross-file diagnostics for a file path.  @param path Absolute file path @param diagnostics Cross-file diagnostics for this path |
| 22 | `getCachedCrossFileResults` | method | `() => ReadonlyMap<string, readonly Diagnostic[]> \| null` | — | `—` | Get workspace-level cross-file results if the underlying graphs haven't changed.  Returns the full per-file map when the solid signature and CSS generation match, meaning no graphs were rebuilt since  |
| 23 | `setCachedCrossFileResults` | method | `(allDiagnostics: readonly Diagnostic[]) => void` | — | `—` | Store workspace-level cross-file results bucketed by file.  Called after `runCrossFileRules` completes. Captures the current solid signature and CSS generation so subsequent lookups are O(1) until a g |
| 24 | `solidCount` | getter | `number` | — | `—` | Number of cached SolidGraphs. |
| 25 | `logger` | getter | `Logger` | — | `—` | The logger instance used by this cache. |

## 11. JSXAttributeKind

```typescript
export type JSXAttributeKind =
  | "prop"
  | "event-handler"
  | "ref"
  | "directive"
  | "spread"
  | "style"
  | "class"
  | "classList";
```

## 12. Single-File Rules

```typescript
export interface BaseRule<G> {
  readonly id: string
  readonly severity: RuleSeverityOverride
  readonly messages: Record<string, string>
  readonly meta: RuleMeta
  readonly check: (graph: G, emit: Emit) => void
}
```

## 13. TailwindValidator

### TailwindValidator (packages/ganko/src/css/tailwind.ts)

| # | Name | Kind | Type | Modifiers | Initializer | JSDoc |
|---|------|------|------|-----------|-------------|-------|
| 1 | `has` | method | `(className: string) => boolean` | — | `—` | — |
| 2 | `resolve` | method | `(className: string) => string \| null` | — | `—` | Resolves a Tailwind utility class to its generated CSS string.  Returns the full CSS rule text (e.g. `.flex { display: flex; }`) or null if the class is not a valid Tailwind utility or resolution is n |

