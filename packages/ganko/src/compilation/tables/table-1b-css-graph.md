# Table 1B: CSSGraph → CSSSyntaxTree (per-file) + SymbolTable (workspace-wide)

Every field on `CSSGraph` (css/impl.ts) mapped to its new home.

| # | CSSGraph field | Type | Per-file/Workspace | New home | New field | Status | Notes |
|---|---------------|------|-------------------|----------|-----------|--------|-------|
| 1 | `kind` | `"css" as const` | N/A | N/A | `—` | Excluded | Discriminant. CSSSyntaxTree has `kind: "css"`. |
| 2 | `options` | `CSSOptions` | N/A | N/A | `—` | Excluded | Build-time config. Passed via provider constructor. |
| 3 | `interner` | `StringInterner` | N/A | N/A | `—` | Excluded | Build-time string interner. Provider-internal. |
| 4 | `logger` | `Logger` | N/A | N/A | `—` | Excluded | Build-time logger. Passed via compilation options. |
| 5 | `sourceOrder` | `number` | N/A | N/A | `—` | Excluded | Mutable counter. Replaced by CSSSyntaxTree.sourceOrderBase. |
| 6 | `hasScssFiles` | `false` | N/A | N/A | `—` | Excluded | Derivable: check if any CSSSyntaxTree has isScss=true. |
| 7 | `files` | `FileEntity[]` | Per-file | CSSSyntaxTree | `files` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 8 | `rules` | `RuleEntity[]` | Per-file | CSSSyntaxTree | `rules` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 9 | `selectors` | `SelectorEntity[]` | Per-file | CSSSyntaxTree | `selectors` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 10 | `declarations` | `DeclarationEntity[]` | Per-file | CSSSyntaxTree | `declarations` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 11 | `variables` | `VariableEntity[]` | Per-file | CSSSyntaxTree | `variables` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 12 | `variableRefs` | `VariableReferenceEntity[]` | Per-file | CSSSyntaxTree | `variableRefs` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 13 | `atRules` | `AtRuleEntity[]` | Per-file | CSSSyntaxTree | `atRules` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 14 | `tokens` | `ThemeTokenEntity[]` | Per-file | CSSSyntaxTree | `tokens` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 15 | `mixins` | `MixinEntity[]` | Per-file | CSSSyntaxTree | `mixins` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 16 | `includes` | `MixinIncludeEntity[]` | Per-file | CSSSyntaxTree | `includes` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 17 | `functions` | `SCSSFunctionEntity[]` | Per-file | CSSSyntaxTree | `functions` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 18 | `functionCalls` | `FunctionCallEntity[]` | Per-file | CSSSyntaxTree | `functionCalls` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 19 | `placeholders` | `PlaceholderEntity[]` | Per-file | CSSSyntaxTree | `placeholders` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 20 | `extends` | `ExtendEntity[]` | Per-file | CSSSyntaxTree | `extends` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 21 | `filesByPath` | `Map<string, FileEntity>` | Per-file | CSSSyntaxTree | `filesByPath` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 22 | `variablesByName` | `Map<string, VariableEntity[]>` | Per-file | CSSSyntaxTree | `variablesByName` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 23 | `rulesBySelector` | `Map<string, RuleEntity[]>` | Per-file | CSSSyntaxTree | `rulesBySelector` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 24 | `_selectorDedupIndex` | `Map<string, RuleEntity[]>` | Workspace | SymbolTable | `—` | Internal | Internal dedup index. Built during SymbolTable construction. Not exposed. |
| 25 | `mixinsByName` | `Map<string, MixinEntity>` | Workspace | SymbolTable | `mixinsByName` | Preserved | SCSS resolution index. Built during materialization from per-file SCSS entities. |
| 26 | `functionsByName` | `Map<string, SCSSFunctionEntity>` | Workspace | SymbolTable | `functionsByName` | Preserved | SCSS resolution index. Built during materialization from per-file SCSS entities. |
| 27 | `placeholdersByName` | `Map<string, PlaceholderEntity>` | Workspace | SymbolTable | `placeholdersByName` | Preserved | SCSS resolution index. Built during materialization from per-file SCSS entities. |
| 28 | `layerOrder` | `Map<string, number>` | Workspace | SymbolTable | `Via LayerSymbol.order` | Preserved | Layer ordering stored on LayerSymbol. |
| 29 | `declarationsByProperty` | `Map<string, DeclarationEntity[]>` | Per-file | CSSSyntaxTree | `declarationsByProperty` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 30 | `atRulesByName` | `Map<string, AtRuleEntity[]>` | Per-file | CSSSyntaxTree | `atRulesByName` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 31 | `atRulesByKind` | `Map<AtRuleKind, AtRuleEntity[]>` | Per-file | CSSSyntaxTree | `atRulesByKind` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 32 | `atRulesByNode` | `Map<AtRule, AtRuleEntity>` | Per-file | CSSSyntaxTree | `atRulesByNode` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 33 | `rulesByNode` | `Map<Rule, RuleEntity>` | Per-file | CSSSyntaxTree | `rulesByNode` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 34 | `duplicateSelectors` | `Map<string, { selector: string; rules: RuleEntity[] }>` | Workspace | SymbolTable | `duplicateSelectors` | Preserved | Map<string, {selector, rules}>. Built during SymbolTable materialization. |
| 35 | `tokensByCategory` | `Map<TokenCategory, ThemeTokenEntity[]>` | Workspace | SymbolTable | `tokensByCategory` | Preserved | Map<TokenCategory, ThemeTokenEntity[]>. Built during materialization. |
| 36 | `importantDeclarations` | `DeclarationEntity[]` | Workspace | SymbolTable | `importantDeclarations` | Preserved | Filtered view of declarations where _flags & DECL_IS_IMPORTANT. Built during materialization. |
| 37 | `globalVariables` | `VariableEntity[]` | Workspace | SymbolTable | `Derivable` | Preserved | Filter customProperties where isGlobal=true. |
| 38 | `unusedVariables` | `VariableEntity[]` | Workspace | SymbolTable | `unusedVariables` | Preserved | Computed during SymbolTable materialization (cross-file reference analysis). |
| 39 | `scssVariables` | `VariableEntity[]` | Workspace | SymbolTable | `Derivable` | Preserved | Filter customProperties where isScss=true. |
| 40 | `cssCustomProperties` | `VariableEntity[]` | Workspace | SymbolTable | `Derivable` | Preserved | Filter customProperties where isScss=false. |
| 41 | `unresolvedRefs` | `VariableReferenceEntity[]` | Workspace | CSSSyntaxTree | `unresolvedRefs` | Preserved | Per-file: refs not resolved within that file. Cross-file resolution in SemanticModel. |
| 42 | `mediaQueries` | `AtRuleEntity[]` | Workspace | CSSSyntaxTree | `Derivable from atRulesByKind.get('media')` | Preserved |  |
| 43 | `keyframes` | `AtRuleEntity[]` | Workspace | CSSSyntaxTree | `Derivable from atRulesByKind.get('keyframes')` | Preserved |  |
| 44 | `layers` | `AtRuleEntity[]` | Workspace | CSSSyntaxTree | `Derivable from atRulesByKind.get('layer')` | Preserved |  |
| 45 | `fontFaces` | `AtRuleEntity[]` | Workspace | CSSSyntaxTree | `Derivable from atRulesByKind.get('font-face')` | Preserved |  |
| 46 | `supportsRules` | `AtRuleEntity[]` | Workspace | CSSSyntaxTree | `Derivable from atRulesByKind.get('supports')` | Preserved |  |
| 47 | `unusedKeyframes` | `AtRuleEntity[]` | Workspace | SymbolTable | `unusedKeyframes` | Preserved | Computed during SymbolTable materialization (animation name cross-reference). |
| 48 | `unusedMixins` | `MixinEntity[]` | Workspace | Analysis | `Computed by CSSAnalysis` | Preserved |  |
| 49 | `unresolvedMixinIncludes` | `MixinIncludeEntity[]` | Workspace | CSSSyntaxTree | `unresolvedMixinIncludes` | Preserved | Per-file unresolved includes. |
| 50 | `unusedFunctions` | `SCSSFunctionEntity[]` | Workspace | Analysis | `Computed by CSSAnalysis` | Preserved |  |
| 51 | `unusedPlaceholders` | `PlaceholderEntity[]` | Workspace | Analysis | `Computed by CSSAnalysis` | Preserved |  |
| 52 | `unresolvedExtends` | `ExtendEntity[]` | Workspace | CSSSyntaxTree | `unresolvedExtends` | Preserved | Per-file. |
| 53 | `parseErrors` | `CSSParseError[]` | Per-file | CSSSyntaxTree | `parseErrors` | Preserved | Partitioned: each CSSSyntaxTree holds this file's entities only. |
| 54 | `failedFilePaths` | `string[]` | N/A | N/A | `—` | Excluded | Parse errors. CSSSyntaxTree.parseErrors covers per-file. Compilation tracks which files failed to parse. |
| 55 | `tokenCategories` | `TokenCategory[]` | Workspace | SymbolTable | `tokenCategories` | Preserved | Array of category names. Derivable from themeTokens values. |
| 56 | `_filesWithLayers` | `Set<string> \| null` | N/A | N/A | `—` | Excluded | Private backing field for `filesWithLayers` lazy getter. Getter exposed via SymbolTable (derivable from layers). |
| 57 | `filesWithLayers` | `ReadonlySet<string>` | Workspace | SymbolTable | `Derivable from layers` | Preserved | Set of file paths containing @layer. Derivable from LayerSymbol.filePath. |
| 58 | `selectorsByPseudoClass` | `Map<string, SelectorEntity[]>` | Per-file | CSSSyntaxTree | `selectorsByPseudoClass` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 59 | `knownKeyframeNames` | `Set<string>` | Workspace | SymbolTable | `Derivable from symbolTable.keyframes.keys()` | Preserved |  |
| 60 | `unresolvedAnimationRefs` | `UnresolvedAnimationRef[]` | Workspace | SymbolTable | `unresolvedAnimationRefs` | Preserved | Computed during analysis from animation declarations vs keyframe symbols. |
| 61 | `declaredContainerNames` | `Map<string, DeclarationEntity[]>` | Workspace | SymbolTable | `Via ContainerSymbol.declarations` | Preserved | Container name declarations on ContainerSymbol. |
| 62 | `containerQueryNames` | `Map<string, AtRuleEntity[]>` | Workspace | SymbolTable | `Via ContainerSymbol.queries` | Preserved | Container queries on ContainerSymbol. |
| 63 | `unusedContainerNames` | `Map<string, DeclarationEntity[]>` | Workspace | SymbolTable | `unusedContainerNames` | Preserved | Map<string, DeclarationEntity[]>. Computed during analysis (unused detection). |
| 64 | `unknownContainerQueries` | `AtRuleEntity[]` | Workspace | SymbolTable | `unknownContainerQueries` | Preserved | AtRuleEntity[]. Computed during analysis (unknown container detection). |
| 65 | `multiDeclarationProperties` | `Map<string, readonly DeclarationEntity[]>` | Workspace | SymbolTable | `multiDeclarationProperties` | Preserved | Map<string, readonly DeclarationEntity[]>. Built during materialization from per-file declarationsByProperty. |
| 66 | `keyframeDeclarations` | `DeclarationEntity[]` | Workspace | SymbolTable | `keyframeDeclarations` | Preserved | Declarations inside @keyframes blocks. Built during materialization. |
| 67 | `_emptyRules` | `RuleEntity[] \| null` | N/A | N/A | `—` | Excluded | Private backing field for `emptyRules` lazy getter. Getter mapped to SymbolTable.emptyRules. |
| 68 | `emptyRules` | `readonly RuleEntity[]` | Workspace | SymbolTable | `emptyRules` | Preserved | Lazy getter. Rules with 0 declarations, 0 nested rules, 0 nested at-rules. Consumed by css-no-empty-rule. |
| 69 | `_emptyKeyframes` | `AtRuleEntity[] \| null` | N/A | N/A | `—` | Excluded | Private backing field for `emptyKeyframes` lazy getter. |
| 70 | `emptyKeyframes` | `readonly AtRuleEntity[]` | Workspace | SymbolTable | `emptyKeyframes` | Preserved | Lazy getter. @keyframes with no effective declarations. Consumed by css-no-empty-keyframes. |
| 71 | `_overqualifiedSelectors` | `SelectorEntity[] \| null` | N/A | N/A | `—` | Excluded | Private backing field for `overqualifiedSelectors` lazy getter. |
| 72 | `overqualifiedSelectors` | `readonly SelectorEntity[]` | Workspace | SymbolTable | `overqualifiedSelectors` | Preserved | Lazy getter. ID selectors with additional qualifiers. |
| 73 | `idSelectors` | `SelectorEntity[]` | Workspace | SymbolTable | `idSelectors` | Preserved | Filtered view of selectors where _flags & SEL_HAS_ID. Built during materialization. |
| 74 | `attributeSelectors` | `SelectorEntity[]` | Workspace | SymbolTable | `attributeSelectors` | Preserved | Filtered view where SEL_HAS_ATTRIBUTE. |
| 75 | `universalSelectors` | `SelectorEntity[]` | Workspace | SymbolTable | `universalSelectors` | Preserved | Filtered view where SEL_HAS_UNIVERSAL. |
| 76 | `classNameIndex` | `Map<string, SelectorEntity[]>` | Per-file | CSSSyntaxTree | `classNameIndex` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 77 | `selectorsBySubjectTag` | `Map<string, SelectorEntity[]>` | Per-file | CSSSyntaxTree | `selectorsBySubjectTag` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 78 | `selectorsWithoutSubjectTag` | `SelectorEntity[]` | Per-file | CSSSyntaxTree | `selectorsWithoutSubjectTag` | Preserved | Per-file index. Workspace-wide version built by SymbolTable merging all trees. |
| 79 | `selectorsTargetingCheckbox` | `SelectorEntity[]` | Workspace | SymbolTable | `selectorsTargetingCheckbox` | Preserved | Filtered view from SelectorAnchor.targetsCheckbox. |
| 80 | `selectorsTargetingTableCell` | `SelectorEntity[]` | Workspace | SymbolTable | `selectorsTargetingTableCell` | Preserved | Filtered view from SelectorAnchor.targetsTableCell. |
| 81 | `layoutPropertiesByClassToken` | `Map<string, readonly string[]>` | Workspace | SymbolTable | `layoutPropertiesByClassToken` | Preserved | Map<string, readonly string[]>. Built during materialization. Consumed by classlist-geometry-toggle rule. |
| 82 | `keyframeLayoutMutationsByName` | `Map<string, readonly KeyframeLayoutMutation[]>` | Workspace | SymbolTable | `Via KeyframesSymbol.layoutMutations` | Preserved | Stored on KeyframesSymbol, queryable via symbolTable.keyframes. |
| 83 | `fontFaceDescriptorsByFamily` | `Map<string, readonly FontFaceDescriptor[]>` | Workspace | SymbolTable | `Via FontFaceSymbol` | Preserved | Stored on FontFaceSymbol, queryable via symbolTable.fontFaces. |
| 84 | `usedFontFamiliesByRule` | `Map<number, readonly string[]>` | Workspace | SymbolTable | `usedFontFamiliesByRule` | Preserved | Map<number, readonly string[]>. Built during materialization. Consumed by font-swap-instability. |
| 85 | `usedFontFamilies` | `Set<string>` | Workspace | SymbolTable | `usedFontFamilies` | Preserved | Set<string>. Built during materialization. |
| 86 | `tailwind` | `TailwindValidator \| null` | N/A | N/A | `—` | Excluded | Replaced by TailwindProvider symbols in SymbolTable.classNames. |
| 87 | `_deepNestedRules` | `RuleEntity[] \| null` | N/A | N/A | `—` | Excluded | Private backing field for `deepNestedRules` lazy getter. |
| 88 | `deepNestedRules` | `readonly RuleEntity[]` | Workspace | SymbolTable | `deepNestedRules` | Preserved | Lazy getter. Rules with depth > 3. Consumed by CSS lint rules. |
| 89 | `intern` | `(s: string) => string` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 90 | `nextFileId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 91 | `nextRuleId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 92 | `nextSelectorId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 93 | `nextDeclarationId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 94 | `nextVariableId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 95 | `nextVariableRefId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 96 | `nextAtRuleId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 97 | `nextTokenId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 98 | `nextMixinId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 99 | `nextIncludeId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 100 | `nextFunctionId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 101 | `nextFunctionCallId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 102 | `nextPlaceholderId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 103 | `nextExtendId` | `() => number` | N/A | N/A | `—` | Excluded | Build-time ID counter. |
| 104 | `nextSourceOrder` | `() => number` | N/A | N/A | `—` | Excluded | Build-time mutable counter. Replaced by CSSSyntaxTree.sourceOrderBase per file. |
| 105 | `addFile` | `(file: FileEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 106 | `addRule` | `(rule: RuleEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 107 | `addSelector` | `(selector: SelectorEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 108 | `addDeclaration` | `(decl: DeclarationEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 109 | `addVariable` | `(variable: VariableEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 110 | `addVariableRef` | `(ref: VariableReferenceEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 111 | `addAtRule` | `(atRule: AtRuleEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 112 | `addToken` | `(token: ThemeTokenEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 113 | `addMixin` | `(mixin: MixinEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 114 | `addMixinInclude` | `(include: MixinIncludeEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 115 | `addFunction` | `(fn: SCSSFunctionEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 116 | `addFunctionCall` | `(call: FunctionCallEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 117 | `addPlaceholder` | `(placeholder: PlaceholderEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 118 | `addExtend` | `(ext: ExtendEntity) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 119 | `addParseError` | `(error: CSSParseError) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 120 | `addFailedFile` | `(path: string) => void` | N/A | N/A | `—` | Excluded | Mutable builder method. |
| 121 | `registerRuleBySelector` | `(selector: string, rule: RuleEntity) => void` | N/A | N/A | `—` | Excluded | Build-time index builder method. Per-file: CSSSyntaxTree.rulesBySelector populated during construction. Workspace: SymbolTable dedup index. |
| 122 | `registerLayerOrder` | `(name: string, order: number) => void` | N/A | N/A | `—` | Excluded | Build-time method. Layer ordering computed by SymbolTable during materialization from LayerSymbol instances. |
| 123 | `declarationsForProperties` | `(properties: string[]) => readonly DeclarationEntity[]` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 124 | `buildDerivedIndexes` | `() => void` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 125 | `buildContainingMediaStacks` | `() => void` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 126 | `buildKeyframeIndexes` | `() => void` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 127 | `buildContainerNameIndexes` | `() => void` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 128 | `buildMultiDeclarationProperties` | `() => void` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 129 | `buildLayoutPropertiesByClassToken` | `() => void` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 130 | `buildFontIndexes` | `() => void` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |
| 131 | `buildUnusedIndexes` | `() => void` | N/A | N/A | `—` | Excluded | Build-time helper. Logic moves into provider/analysis construction. |