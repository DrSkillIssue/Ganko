# Table 1G: CSS-Only Single-File Rules

Every CSS-only rule and the CSSGraph fields it consumes.

| # | Rule file | CSSGraph fields consumed | New data source |
|---|-----------|------------------------|-----------------|
| 1 | `cascade/declaration-no-overridden-within-rule` | `rules` | CSSSyntaxTree.rules |
| 2 | `cascade/media-query-overlap-conflict` | `multiDeclarationProperties` | SymbolTable.multiDeclarationProperties |
| 3 | `cascade/no-layer-order-inversion` | `layerOrder, multiDeclarationProperties` | SymbolTable (LayerSymbol.order); SymbolTable.multiDeclarationProperties |
| 4 | `cascade/no-descending-specificity-conflict` | `multiDeclarationProperties` | SymbolTable.multiDeclarationProperties |
| 5 | `cascade/no-redundant-override-pairs` | `declarations` | CSSSyntaxTree.declarations |
| 6 | `structure/css-no-empty-rule` | `emptyRules` | SymbolTable.emptyRules |
| 7 | `structure/layer-requirement-for-component-rules` | `filesWithLayers, rules` | SymbolTable (derivable from layers); CSSSyntaxTree.rules |
| 8 | `structure/css-no-unknown-container-name` | `unknownContainerQueries` | SymbolTable.unknownContainerQueries |
| 9 | `structure/css-no-unused-container-name` | `unusedContainerNames` | SymbolTable.unusedContainerNames |
| 10 | `animation/no-transition-all` | `declarationsForProperties` | SymbolTable.declarationsByProperty (method) |
| 11 | `animation/css-no-discrete-transition` | `declarationsForProperties` | SymbolTable.declarationsByProperty (method) |
| 12 | `animation/no-layout-property-animation` | `declarationsForProperties, keyframeDeclarations` | SymbolTable.declarationsByProperty (method); SymbolTable.keyframeDeclarations |
| 13 | `animation/no-unknown-animation-name` | `unresolvedAnimationRefs` | SymbolTable.unresolvedAnimationRefs |
| 14 | `animation/no-unused-keyframes` | `unusedKeyframes` | SymbolTable.unusedKeyframes |
| 15 | `animation/css-no-empty-keyframes` | `emptyKeyframes` | SymbolTable.emptyKeyframes |
| 16 | `a11y/css-no-outline-none-without-focus-visible` | `selectorsByPseudoClass` | CSSSyntaxTree.selectorsByPseudoClass (per-file) or SymbolTable (workspace) |
| 17 | `a11y/css-policy-typography` | `declarationsByProperty` | CSSSyntaxTree.declarationsByProperty (per-file) or SymbolTable (workspace) |
| 18 | `a11y/css-policy-spacing` | `declarationsByProperty, declarationsForProperties` | CSSSyntaxTree.declarationsByProperty (per-file) or SymbolTable (workspace); SymbolTable.declarationsByProperty (method) |
| 19 | `a11y/css-require-reduced-motion-override` | `declarationsForProperties` | SymbolTable.declarationsByProperty (method) |
| 20 | `a11y/css-policy-contrast` | `declarationsByProperty, rules` | CSSSyntaxTree.declarationsByProperty (per-file) or SymbolTable (workspace); CSSSyntaxTree.rules |
| 21 | `selector/no-complex-selectors` | `selectors` | CSSSyntaxTree.selectors |
| 22 | `selector/selector-max-attribute-and-universal` | `attributeSelectors, universalSelectors` | SymbolTable.attributeSelectors; SymbolTable.universalSelectors |
| 23 | `selector/no-duplicate-selectors` | `duplicateSelectors` | SymbolTable.duplicateSelectors |
| 24 | `selector/selector-max-specificity` | `selectors` | CSSSyntaxTree.selectors |
| 25 | `selector/no-id-selectors` | `idSelectors` | SymbolTable.idSelectors |
| 26 | `property/css-z-index-requires-positioned-context` | `declarationsByProperty` | CSSSyntaxTree.declarationsByProperty (per-file) or SymbolTable (workspace) |
| 27 | `property/css-prefer-logical-properties` | `declarationsForProperties` | SymbolTable.declarationsByProperty (method) |
| 28 | `property/css-no-custom-property-cycle` | `cssCustomProperties, variablesByName` | SymbolTable.customProperties (filtered); CSSSyntaxTree.variablesByName (per-file) or SymbolTable (workspace) |
| 29 | `property/no-unused-custom-properties` | `unusedVariables` | SymbolTable.unusedVariables |
| 30 | `property/css-no-hardcoded-z-index` | `declarationsByProperty` | CSSSyntaxTree.declarationsByProperty (per-file) or SymbolTable (workspace) |
| 31 | `property/css-no-legacy-vh-100` | `declarationsForProperties` | SymbolTable.declarationsByProperty (method) |
| 32 | `property/no-important` | `importantDeclarations` | SymbolTable.importantDeclarations |
| 33 | `property/no-unresolved-custom-properties` | `unresolvedRefs` | CSSSyntaxTree.unresolvedRefs |