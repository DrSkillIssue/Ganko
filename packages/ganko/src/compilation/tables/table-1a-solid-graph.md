# Table 1A: SolidGraph → SolidSyntaxTree Field Mapping

Every field on `SolidGraph` (solid/impl.ts) mapped to its new home.

| # | SolidGraph field | Type | Kind | New home | New field | Status | Notes |
|---|-----------------|------|------|----------|-----------|--------|-------|
| 1 | `kind` | `"solid" as const` | readonly | SolidSyntaxTree | `kind` | Preserved | Literal type `"solid"`. |
| 2 | `file` | `string` | readonly | SolidSyntaxTree | `filePath` | Renamed | Renamed from `file` to `filePath` for clarity. Same type: `string`. |
| 3 | `logger` | `Logger` | readonly | N/A | `—` | Excluded | Build-time logger. Not part of immutable syntax tree. Logger passed via compilation options. |
| 4 | `sourceFile` | `ts.SourceFile` | readonly | SolidSyntaxTree | `sourceFile` | Preserved |  |
| 5 | `comments` | `readonly CommentEntry[]` | readonly | SolidSyntaxTree | `comments` | Preserved |  |
| 6 | `typeResolver` | `TypeResolver` | readonly | SolidSyntaxTree | `typeResolver` | Preserved |  |
| 7 | `fileEntity` | `FileEntity` | readonly | SolidSyntaxTree | `fileEntity` | Preserved |  |
| 8 | `_nextScopeId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 9 | `_nextVariableId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 10 | `_nextFunctionId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 11 | `_nextCallId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 12 | `_nextJsxId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 13 | `_nextImportId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 14 | `_nextExportId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 15 | `_nextClassId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 16 | `_nextPropertyId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 17 | `_nextConditionalSpreadId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 18 | `_nextMiscId` | `number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 19 | `scopes` | `ScopeEntity[]` | readonly | SolidSyntaxTree | `scopes` | Preserved | Type becomes `readonly ScopeEntity[]` in immutable syntax tree. |
| 20 | `variables` | `VariableEntity[]` | readonly | SolidSyntaxTree | `variables` | Preserved | Type becomes `readonly VariableEntity[]` in immutable syntax tree. |
| 21 | `functions` | `FunctionEntity[]` | readonly | SolidSyntaxTree | `functions` | Preserved | Type becomes `readonly FunctionEntity[]` in immutable syntax tree. |
| 22 | `calls` | `CallEntity[]` | readonly | SolidSyntaxTree | `calls` | Preserved | Type becomes `readonly CallEntity[]` in immutable syntax tree. |
| 23 | `jsxElements` | `JSXElementEntity[]` | readonly | SolidSyntaxTree | `jsxElements` | Preserved | Type becomes `readonly JSXElementEntity[]` in immutable syntax tree. |
| 24 | `imports` | `ImportEntity[]` | readonly | SolidSyntaxTree | `imports` | Preserved | Type becomes `readonly ImportEntity[]` in immutable syntax tree. |
| 25 | `exports` | `ExportEntity[]` | readonly | SolidSyntaxTree | `exports` | Preserved | Type becomes `readonly ExportEntity[]` in immutable syntax tree. |
| 26 | `classes` | `ClassEntity[]` | readonly | SolidSyntaxTree | `classes` | Preserved | Type becomes `readonly ClassEntity[]` in immutable syntax tree. |
| 27 | `properties` | `PropertyEntity[]` | readonly | SolidSyntaxTree | `properties` | Preserved | Type becomes `readonly PropertyEntity[]` in immutable syntax tree. |
| 28 | `propertyAssignments` | `PropertyAssignmentEntity[]` | readonly | SolidSyntaxTree | `propertyAssignments` | Preserved | Type becomes `readonly PropertyAssignmentEntity[]` in immutable syntax tree. |
| 29 | `conditionalSpreads` | `ConditionalSpreadEntity[]` | readonly | SolidSyntaxTree | `conditionalSpreads` | Preserved | Type becomes `readonly ConditionalSpreadEntity[]` in immutable syntax tree. |
| 30 | `objectSpreads` | `ObjectSpreadEntity[]` | readonly | SolidSyntaxTree | `objectSpreads` | Preserved | Type becomes `readonly ObjectSpreadEntity[]` in immutable syntax tree. |
| 31 | `nonNullAssertions` | `NonNullAssertionEntity[]` | readonly | SolidSyntaxTree | `nonNullAssertions` | Preserved | Type becomes `readonly NonNullAssertionEntity[]` in immutable syntax tree. |
| 32 | `typeAssertions` | `TypeAssertionEntity[]` | readonly | SolidSyntaxTree | `typeAssertions` | Preserved | Type becomes `readonly TypeAssertionEntity[]` in immutable syntax tree. |
| 33 | `typePredicates` | `TypePredicateEntity[]` | readonly | SolidSyntaxTree | `typePredicates` | Preserved | Type becomes `readonly TypePredicateEntity[]` in immutable syntax tree. |
| 34 | `unsafeGenericAssertions` | `UnsafeGenericAssertionEntity[]` | readonly | SolidSyntaxTree | `unsafeGenericAssertions` | Preserved | Type becomes `readonly UnsafeGenericAssertionEntity[]` in immutable syntax tree. |
| 35 | `unsafeTypeAnnotations` | `UnsafeTypeAnnotationEntity[]` | readonly | SolidSyntaxTree | `unsafeTypeAnnotations` | Preserved | Type becomes `readonly UnsafeTypeAnnotationEntity[]` in immutable syntax tree. |
| 36 | `inlineImports` | `InlineImportEntity[]` | readonly | SolidSyntaxTree | `inlineImports` | Preserved | Type becomes `readonly InlineImportEntity[]` in immutable syntax tree. |
| 37 | `variablesByName` | `Map<string, VariableEntity[]>` | readonly | SolidSyntaxTree | `variablesByName` | Preserved | Type becomes `ReadonlyMap<string, VariableEntity[]>` in immutable syntax tree. |
| 38 | `functionsByNode` | `Map<ts.Node, FunctionEntity>` | readonly | SolidSyntaxTree | `functionsByNode` | Preserved | Type becomes `ReadonlyMap<ts.Node, FunctionEntity>` in immutable syntax tree. |
| 39 | `functionsByDeclarationNode` | `Map<ts.Node, FunctionEntity>` | readonly | SolidSyntaxTree | `functionsByDeclarationNode` | Preserved | Type becomes `ReadonlyMap<ts.Node, FunctionEntity>` in immutable syntax tree. |
| 40 | `functionsByName` | `Map<string, FunctionEntity[]>` | readonly | SolidSyntaxTree | `functionsByName` | Preserved | Type becomes `ReadonlyMap<string, FunctionEntity[]>` in immutable syntax tree. |
| 41 | `callsByNode` | `Map<ts.CallExpression \| ts.NewExpression, CallEntity>` | readonly | SolidSyntaxTree | `callsByNode` | Preserved | Type becomes `ReadonlyMap<ts.CallExpression | ts.NewExpression, CallEntity>` in immutable syntax tree. |
| 42 | `callsByPrimitive` | `Map<string, CallEntity[]>` | readonly | SolidSyntaxTree | `callsByPrimitive` | Preserved | Type becomes `ReadonlyMap<string, CallEntity[]>` in immutable syntax tree. |
| 43 | `callsByMethodName` | `Map<string, CallEntity[]>` | readonly | SolidSyntaxTree | `callsByMethodName` | Preserved | Type becomes `ReadonlyMap<string, CallEntity[]>` in immutable syntax tree. |
| 44 | `callsByArgNode` | `Map<ts.Node, ArgumentEntity>` | readonly | SolidSyntaxTree | `callsByArgNode` | Preserved | Type becomes `ReadonlyMap<ts.Node, ArgumentEntity>` in immutable syntax tree. |
| 45 | `jsxByNode` | `Map<ts.Node, JSXElementEntity>` | readonly | SolidSyntaxTree | `jsxByNode` | Preserved | Type becomes `ReadonlyMap<ts.Node, JSXElementEntity>` in immutable syntax tree. |
| 46 | `jsxByTag` | `Map<string, JSXElementEntity[]>` | readonly | SolidSyntaxTree | `jsxByTag` | Preserved | Type becomes `ReadonlyMap<string, JSXElementEntity[]>` in immutable syntax tree. |
| 47 | `jsxAttributesByElementId` | `Map<number, ReadonlyMap<string, JSXAttributeEntity>` | readonly | SolidSyntaxTree | `jsxAttributesByElementId` | Preserved | Type becomes `ReadonlyMap<number, ReadonlyMap<string, JSXAttributeEntity>` in immutable syntax tree. |
| 48 | `jsxAttrsByKind` | `Map<JSXAttributeKind, JSXAttributeWithElement[]>` | readonly | SolidSyntaxTree | `jsxAttrsByKind` | Preserved | Key type preserved as `JSXAttributeKind` (NOT widened to `string`). |
| 49 | `jsxClassAttributes` | `JSXAttributeWithElement[]` | readonly | SolidSyntaxTree | `jsxClassAttributes` | Preserved | Type becomes `readonly JSXAttributeWithElement[]` in immutable syntax tree. |
| 50 | `jsxClassListAttributes` | `JSXAttributeWithElement[]` | readonly | SolidSyntaxTree | `jsxClassListAttributes` | Preserved | Type becomes `readonly JSXAttributeWithElement[]` in immutable syntax tree. |
| 51 | `jsxStyleAttributes` | `JSXAttributeWithElement[]` | readonly | SolidSyntaxTree | `jsxStyleAttributes` | Preserved | Type becomes `readonly JSXAttributeWithElement[]` in immutable syntax tree. |
| 52 | `fillImageElements` | `JSXElementEntity[]` | readonly | SolidSyntaxTree | `fillImageElements` | Preserved | Type becomes `readonly JSXElementEntity[]` in immutable syntax tree. |
| 53 | `staticClassTokensByElementId` | `Map<number, JSXStaticClassIndex>` | readonly | SolidSyntaxTree | `staticClassTokensByElementId` | Preserved | Type becomes `ReadonlyMap<number, JSXStaticClassIndex>` in immutable syntax tree. |
| 54 | `staticClassListKeysByElementId` | `Map<number, JSXStaticObjectKeyIndex>` | readonly | SolidSyntaxTree | `staticClassListKeysByElementId` | Preserved | Type becomes `ReadonlyMap<number, JSXStaticObjectKeyIndex>` in immutable syntax tree. |
| 55 | `staticStyleKeysByElementId` | `Map<number, JSXStaticObjectKeyIndex>` | readonly | SolidSyntaxTree | `staticStyleKeysByElementId` | Preserved | Type becomes `ReadonlyMap<number, JSXStaticObjectKeyIndex>` in immutable syntax tree. |
| 56 | `classListProperties` | `JSXObjectPropertyWithElement[]` | readonly | SolidSyntaxTree | `classListProperties` | Preserved | Type becomes `readonly JSXObjectPropertyWithElement[]` in immutable syntax tree. |
| 57 | `styleProperties` | `JSXObjectPropertyWithElement[]` | readonly | SolidSyntaxTree | `styleProperties` | Preserved | Type becomes `readonly JSXObjectPropertyWithElement[]` in immutable syntax tree. |
| 58 | `inlineStyleClassNames` | `Set<string>` | readonly | SolidSyntaxTree | `inlineStyleClassNames` | Preserved | Type becomes `ReadonlySet<string>` in immutable syntax tree. |
| 59 | `importsBySource` | `Map<string, ImportEntity[]>` | readonly | SolidSyntaxTree | `importsBySource` | Preserved | Type becomes `ReadonlyMap<string, ImportEntity[]>` in immutable syntax tree. |
| 60 | `exportsByName` | `Map<string, ExportEntity>` | readonly | SolidSyntaxTree | `exportsByName` | Preserved | Type becomes `ReadonlyMap<string, ExportEntity>` in immutable syntax tree. |
| 61 | `exportsByEntityId` | `Map<number, ExportEntity>` | readonly | SolidSyntaxTree | `exportsByEntityId` | Preserved | Type becomes `ReadonlyMap<number, ExportEntity>` in immutable syntax tree. |
| 62 | `classesByNode` | `Map<ts.ClassDeclaration \| ts.ClassExpression, ClassEntity>` | readonly | SolidSyntaxTree | `classesByNode` | Preserved | Type becomes `ReadonlyMap<ts.ClassDeclaration | ts.ClassExpression, ClassEntity>` in immutable syntax tree. |
| 63 | `classesByName` | `Map<string, ClassEntity[]>` | readonly | SolidSyntaxTree | `classesByName` | Preserved | Type becomes `ReadonlyMap<string, ClassEntity[]>` in immutable syntax tree. |
| 64 | `unaryExpressionsByOperator` | `Map<ts.SyntaxKind, ts.PrefixUnaryExpression[]>` | readonly | SolidSyntaxTree | `unaryExpressionsByOperator` | Preserved | Type becomes `ReadonlyMap<ts.SyntaxKind, ts.PrefixUnaryExpression[]>` in immutable syntax tree. |
| 65 | `spreadElements` | `(ts.SpreadElement \| ts.SpreadAssignment)[]` | readonly | SolidSyntaxTree | `spreadElements` | Preserved | Type becomes `readonly (ts.SpreadElement | ts.SpreadAssignment)[]` in immutable syntax tree. |
| 66 | `newExpressionsByCallee` | `Map<string, ts.NewExpression[]>` | readonly | SolidSyntaxTree | `newExpressionsByCallee` | Preserved | Type becomes `ReadonlyMap<string, ts.NewExpression[]>` in immutable syntax tree. |
| 67 | `deleteExpressions` | `ts.DeleteExpression[]` | readonly | SolidSyntaxTree | `deleteExpressions` | Preserved | Type becomes `readonly ts.DeleteExpression[]` in immutable syntax tree. |
| 68 | `identifiersByName` | `Map<string, ts.Identifier[]>` | readonly | SolidSyntaxTree | `identifiersByName` | Preserved | Type becomes `ReadonlyMap<string, ts.Identifier[]>` in immutable syntax tree. |
| 69 | `_lineStartOffsets` | `readonly number[] \| null` | private | N/A | `—` | Excluded | Lazy cache backing field. Exposed via `lineStartOffsets` getter → SolidSyntaxTree.lineStartOffsets. |
| 70 | `firstScope` | `ScopeEntity \| null` | property | SolidSyntaxTree | `firstScope` | Preserved |  |
| 71 | `componentScopes` | `Map<ScopeEntity, { scope: ScopeEntity; name: string }>` | readonly | SolidSyntaxTree | `componentScopes` | Preserved | Type becomes `ReadonlyMap<ScopeEntity, { scope: ScopeEntity; name: string }>` in immutable syntax tree. |
| 72 | `componentFunctions` | `FunctionEntity[]` | property | SolidSyntaxTree | `componentFunctions` | Preserved | Type becomes `readonly FunctionEntity[]` in immutable syntax tree. |
| 73 | `functionsWithReactiveCaptures` | `FunctionEntity[]` | property | SolidSyntaxTree | `functionsWithReactiveCaptures` | Preserved | Type becomes `readonly FunctionEntity[]` in immutable syntax tree. |
| 74 | `reactiveVariables` | `VariableEntity[]` | property | SolidSyntaxTree | `reactiveVariables` | Preserved | Type becomes `readonly VariableEntity[]` in immutable syntax tree. |
| 75 | `propsVariables` | `VariableEntity[]` | property | SolidSyntaxTree | `propsVariables` | Preserved | Type becomes `readonly VariableEntity[]` in immutable syntax tree. |
| 76 | `storeVariables` | `VariableEntity[]` | property | SolidSyntaxTree | `storeVariables` | Preserved | Type becomes `readonly VariableEntity[]` in immutable syntax tree. |
| 77 | `resourceVariables` | `VariableEntity[]` | property | SolidSyntaxTree | `resourceVariables` | Preserved | Type becomes `readonly VariableEntity[]` in immutable syntax tree. |
| 78 | `variablesWithPropertyAssignment` | `VariableEntity[]` | property | SolidSyntaxTree | `variablesWithPropertyAssignment` | Preserved | Type becomes `readonly VariableEntity[]` in immutable syntax tree. |
| 79 | `computations` | `ComputationEntity[]` | property | SolidSyntaxTree | `computations` | Preserved | Type becomes `readonly ComputationEntity[]` in immutable syntax tree. |
| 80 | `computationByCallId` | `Map<number, ComputationEntity>` | readonly | SolidSyntaxTree | `computationByCallId` | Preserved | Type becomes `ReadonlyMap<number, ComputationEntity>` in immutable syntax tree. |
| 81 | `dependencyEdges` | `DependencyEdge[]` | property | SolidSyntaxTree | `dependencyEdges` | Preserved | Type becomes `readonly DependencyEdge[]` in immutable syntax tree. |
| 82 | `ownershipEdges` | `OwnershipEdge[]` | property | SolidSyntaxTree | `ownershipEdges` | Preserved | Type becomes `readonly OwnershipEdge[]` in immutable syntax tree. |
| 83 | `jsxContextCache` | `WeakMap<ts.Node, JSXContext \| null>` | weakmap-cache | N/A | `—` | Excluded | Mutable query-time cache. Solid query functions (solid/queries/) create their own caches. |
| 84 | `scopeForCache` | `WeakMap<ts.Node, ScopeEntity>` | weakmap-cache | N/A | `—` | Excluded | Mutable query-time cache. Solid query functions (solid/queries/) create their own caches. |
| 85 | `onDepsCache` | `WeakMap<ts.Node, boolean>` | weakmap-cache | N/A | `—` | Excluded | Mutable query-time cache. Solid query functions (solid/queries/) create their own caches. |
| 86 | `passthroughCache` | `WeakMap<ts.Node, boolean>` | weakmap-cache | N/A | `—` | Excluded | Mutable query-time cache. Solid query functions (solid/queries/) create their own caches. |
| 87 | `nextScopeId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 88 | `nextVariableId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 89 | `nextFunctionId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 90 | `nextCallId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 91 | `nextJsxId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 92 | `nextImportId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 93 | `nextExportId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 94 | `nextClassId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 95 | `nextPropertyId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 96 | `nextConditionalSpreadId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 97 | `nextMiscId` | `() => number` | id-generator | N/A | `—` | Excluded | Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction. |
| 98 | `addScope` | `(scope: ScopeEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 99 | `addVariable` | `(variable: VariableEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 100 | `addFunction` | `(fn: FunctionEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 101 | `addCall` | `(call: CallEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 102 | `addJSXElement` | `(element: JSXElementEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 103 | `extractInlineStyleClassNames` | `(element: JSXElementEntity) => void` | private | N/A | `—` | Excluded | Private build-time helper method. |
| 104 | `indexObjectAttribute` | `(entry: JSXAttributeWithElement, element: JSXElementEntity, attr: JSXAttributeEntity, attrArray: JSXAttributeWithElement[], keyIndex: Map<number, JSXStaticObjectKeyIndex>, propertiesArray: JSXObjectPropertyWithElement[]) => void` | private | N/A | `—` | Excluded | Private build-time helper method. |
| 105 | `addImport` | `(imp: ImportEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 106 | `addExport` | `(exp: ExportEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 107 | `addClass` | `(cls: ClassEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 108 | `addProperty` | `(prop: PropertyEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 109 | `addPropertyAssignment` | `(pa: PropertyAssignmentEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 110 | `addConditionalSpread` | `(spread: ConditionalSpreadEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 111 | `addObjectSpread` | `(spread: ObjectSpreadEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 112 | `addNonNullAssertion` | `(assertion: NonNullAssertionEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 113 | `addTypeAssertion` | `(assertion: TypeAssertionEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 114 | `addTypePredicate` | `(predicate: TypePredicateEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 115 | `addUnsafeGenericAssertion` | `(assertion: UnsafeGenericAssertionEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 116 | `addUnsafeTypeAnnotation` | `(annotation: UnsafeTypeAnnotationEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 117 | `addInlineImport` | `(imp: InlineImportEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 118 | `addComputation` | `(computation: ComputationEntity) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 119 | `addDependencyEdge` | `(edge: DependencyEdge) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 120 | `addOwnershipEdge` | `(edge: OwnershipEdge) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 121 | `buildReactiveIndex` | `() => void` | build-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 122 | `addUnaryExpression` | `(node: ts.PrefixUnaryExpression) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 123 | `addDeleteExpression` | `(node: ts.DeleteExpression) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 124 | `addSpreadElement` | `(node: ts.SpreadElement \| ts.SpreadAssignment) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 125 | `addNewExpressionByCallee` | `(name: string, node: ts.NewExpression) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 126 | `addIdentifierReference` | `(node: ts.Identifier) => void` | add-method | N/A | `—` | Excluded | Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation. |
| 127 | `lineStartOffsets` | `readonly number[]` | getter | SolidSyntaxTree | `lineStartOffsets` | Preserved | Computed eagerly during construction (not lazy). Type: `readonly number[]`. |
| 128 | `findExpressionAtOffset` | `(offset: number) => ts.Node \| null` | method | SolidSyntaxTree | `findExpressionAtOffset` | Preserved | Method signature unchanged. |

**Summary**: 128 total members. 71 preserved in SolidSyntaxTree. 57 excluded (build-time mutation state).

**Additional SolidSyntaxTree fields not on SolidGraph**:
- `version: string` — content hash for cache identity
- `fileEntity: FileEntity` — backward compatibility during migration