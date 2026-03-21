/**
 * ═══════════════════════════════════════════════════════════════════════════
 * StyleCompilation — Unified Analysis Architecture Specification
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file contains ONLY type signatures — the complete API surface for the
 * compilation system that replaces SolidGraph[], CSSGraph, and LayoutGraph
 * with ONE immutable compilation.
 *
 * Nomenclature follows Roslyn's architecture:
 *   Compilation    → StyleCompilation (owns all inputs, all symbols)
 *   SyntaxTree     → SolidSyntaxTree, CSSSyntaxTree (per-file parse output)
 *   SemanticModel  → FileSemanticModel (per-file lazy binding view)
 *   Binder         → CascadeBinder (lazy cross-file resolution)
 *   GlobalNamespace → SymbolTable (unified class names, selectors, properties)
 *   CompilationTracker → CompilationTracker (incremental change propagation)
 *   AnalyzerDriver → AnalysisDispatcher (tiered rule execution)
 */

import type ts from "typescript";
import type { Root } from "postcss";
import type { Diagnostic, CommentEntry } from "../diagnostic";
import type { Logger } from "@drskillissue/ganko-shared";

// ═══════════════════════════════════════════════════════════════════════════
// 1. SYNTAX TREES — Parse output stored in the compilation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-file Solid.js syntax tree.
 *
 * Wraps everything currently classified as SYNTAX in SolidGraph:
 * scopes, variables, functions, calls, JSX elements, imports, exports,
 * classes, properties, spreads, assertions, computations, dependency edges,
 * and all syntax-level indexes.
 *
 * This is the ONLY data extracted from parsing a .tsx/.jsx file.
 * Binding (reactive kind resolution, component host resolution) happens
 * in the SemanticModel, not here.
 */
export interface SolidSyntaxTree {
  readonly kind: "solid";
  readonly filePath: string;
  readonly version: string;
  readonly sourceFile: ts.SourceFile;
  readonly comments: readonly CommentEntry[];

  // Entity collections (direct parse output)
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

  // Syntax-level indexes (built during parse, not during binding)
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
  readonly jsxAttrsByKind: ReadonlyMap<string, readonly JSXAttributeWithElement[]>;
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
  readonly unaryExpressionsByOperator: ReadonlyMap<ts.SyntaxKind, readonly ts.PrefixUnaryExpression[]>;
  readonly spreadElements: readonly (ts.SpreadElement | ts.SpreadAssignment)[];
  readonly newExpressionsByCallee: ReadonlyMap<string, readonly ts.NewExpression[]>;
  readonly deleteExpressions: readonly ts.DeleteExpression[];
  readonly identifiersByName: ReadonlyMap<string, readonly ts.Identifier[]>;

  // Reactive categorization indexes (built during reactivity phase — still syntax)
  readonly firstScope: ScopeEntity | null;
  readonly componentScopes: ReadonlyMap<ScopeEntity, { readonly scope: ScopeEntity; readonly name: string }>;
  readonly componentFunctions: readonly FunctionEntity[];
  readonly functionsWithReactiveCaptures: readonly FunctionEntity[];
  readonly reactiveVariables: readonly VariableEntity[];
  readonly propsVariables: readonly VariableEntity[];
  readonly storeVariables: readonly VariableEntity[];
  readonly resourceVariables: readonly VariableEntity[];
  readonly variablesWithPropertyAssignment: readonly VariableEntity[];
  readonly computationByCallId: ReadonlyMap<number, ComputationEntity>;

  // Type resolver (per-file, from TypeScript checker)
  readonly typeResolver: TypeResolver;

  // FileEntity for backward compatibility during migration
  readonly fileEntity: FileEntity;

  // O(1) line offset lookup
  readonly lineStartOffsets: readonly number[];

  findExpressionAtOffset(offset: number): ts.Node | null;
}

/**
 * Per-file CSS syntax tree.
 *
 * Wraps everything currently classified as SYNTAX in CSSGraph for ONE file:
 * rules, selectors, declarations, variables, variable references, at-rules,
 * tokens, mixins, functions, placeholders, and per-file parse indexes.
 *
 * The current CSSGraph is a monolith across all files. CSSSyntaxTree is
 * per-file. The compilation's symbol table merges data from all trees.
 */
export interface CSSSyntaxTree {
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
  readonly mixins: readonly CSSMixinEntity[];
  readonly includes: readonly CSSMixinIncludeEntity[];
  readonly functions: readonly CSSFunctionEntity[];
  readonly functionCalls: readonly CSSFunctionCallEntity[];
  readonly placeholders: readonly CSSPlaceholderEntity[];
  readonly extends: readonly CSSExtendEntity[];
  readonly parseErrors: readonly CSSParseError[];

  // Per-file indexes
  readonly rulesBySelector: ReadonlyMap<string, readonly CSSRuleEntity[]>;
  readonly rulesByNode: ReadonlyMap<import("postcss").Rule, CSSRuleEntity>;
  readonly variablesByName: ReadonlyMap<string, readonly CSSVariableEntity[]>;
  readonly declarationsByProperty: ReadonlyMap<string, readonly CSSDeclarationEntity[]>;
  readonly atRulesByName: ReadonlyMap<string, readonly CSSAtRuleEntity[]>;
  readonly atRulesByKind: ReadonlyMap<CSSAtRuleKind, readonly CSSAtRuleEntity[]>;
  readonly atRulesByNode: ReadonlyMap<import("postcss").AtRule, CSSAtRuleEntity>;
  readonly classNameIndex: ReadonlyMap<string, readonly CSSSelectorEntity[]>;
  readonly selectorsBySubjectTag: ReadonlyMap<string, readonly CSSSelectorEntity[]>;
  readonly selectorsByPseudoClass: ReadonlyMap<string, readonly CSSSelectorEntity[]>;
  readonly selectorsWithoutSubjectTag: readonly CSSSelectorEntity[];

  // Source order base for this file (set by compilation during tree insertion)
  readonly sourceOrderBase: number;
}

// Forward references to existing entity types (these stay as-is)
interface ScopeEntity { readonly id: number; /* ... existing fields from solid/entities/scope */ }
interface VariableEntity { readonly id: number; readonly name: string; readonly isReactive: boolean; readonly reactiveKind: string | null; /* ... */ }
interface FunctionEntity { readonly id: number; readonly name: string | null; readonly node: ts.Node; readonly declarationNode: ts.Node; /* ... */ }
interface CallEntity { readonly id: number; readonly node: ts.CallExpression | ts.NewExpression; readonly callee: ts.Expression; readonly primitive: { name: string } | null; readonly arguments: readonly ArgumentEntity[]; /* ... */ }
interface ArgumentEntity { readonly node: ts.Node; /* ... */ }
interface JSXElementEntity { readonly id: number; readonly node: ts.Node; readonly tag: string | null; readonly tagName: string | null; readonly isDomElement: boolean; readonly attributes: readonly JSXAttributeEntity[]; /* ... */ }
interface JSXAttributeEntity { readonly name: string | null; readonly kind: string | null; readonly valueNode: ts.Node | null; /* ... */ }
interface ImportEntity { readonly source: string; readonly specifiers: readonly { name: string }[]; readonly isTypeOnly: boolean; /* ... */ }
interface ExportEntity { readonly name: string; readonly entityId: number; /* ... */ }
interface ClassEntity { readonly name: string | null; readonly node: ts.ClassDeclaration | ts.ClassExpression; /* ... */ }
interface PropertyEntity { readonly id: number; /* ... */ }
interface PropertyAssignmentEntity { /* ... */ }
interface ConditionalSpreadEntity { readonly id: number; /* ... */ }
interface ObjectSpreadEntity { /* ... */ }
interface NonNullAssertionEntity { /* ... */ }
interface TypeAssertionEntity { /* ... */ }
interface TypePredicateEntity { /* ... */ }
interface UnsafeGenericAssertionEntity { /* ... */ }
interface UnsafeTypeAnnotationEntity { /* ... */ }
interface InlineImportEntity { /* ... */ }
interface ComputationEntity { readonly call: CallEntity; /* ... */ }
interface DependencyEdge { /* ... */ }
interface OwnershipEdge { /* ... */ }
interface TypeResolver { /* ... */ }
interface FileEntity { readonly path: string; /* ... */ }
interface JSXAttributeWithElement { readonly attr: JSXAttributeEntity; readonly element: JSXElementEntity; }
interface JSXStaticClassIndex { readonly hasDynamicClass: boolean; readonly tokens: readonly string[]; }
interface JSXStaticObjectKeyIndex { readonly hasDynamic: boolean; readonly keys: readonly string[]; }
interface JSXObjectPropertyWithElement { readonly property: ts.ObjectLiteralElementLike; readonly attr: JSXAttributeEntity; readonly element: JSXElementEntity; }

// Forward references to CSS entity types (these stay as-is)
interface CSSFileEntity { readonly path: string; readonly imports: readonly { path: string }[]; /* ... */ }
interface CSSRuleEntity { readonly id: number; readonly node: import("postcss").Rule; readonly selectorText: string; readonly file: CSSFileEntity; readonly parent: { kind: string; selectorText?: string; name?: string; params?: string; parent: unknown } | null; readonly declarations: readonly CSSDeclarationEntity[]; readonly nestedRules: readonly CSSRuleEntity[]; readonly nestedAtRules: readonly CSSAtRuleEntity[]; readonly declarationIndex: Map<string, CSSDeclarationEntity[]>; readonly depth: number; /* ... */ }
interface CSSSelectorEntity { readonly id: number; readonly rule: CSSRuleEntity; readonly compounds: readonly CSSSelectorCompound[]; readonly anchor: CSSSelectorAnchor; readonly complexity: CSSSelectorComplexity; /* ... */ }
interface CSSSelectorCompound { readonly classes: readonly string[]; readonly idValue: string | null; readonly tagName: string | null; readonly attributes: readonly string[]; /* ... */ }
interface CSSSelectorAnchor { readonly subjectTag: string | null; readonly targetsCheckbox: boolean; readonly targetsTableCell: boolean; }
interface CSSSelectorComplexity { readonly _flags: number; readonly pseudoClasses: readonly string[]; }
interface CSSDeclarationEntity { readonly id: number; readonly property: string; readonly value: string; readonly _flags: number; readonly file: CSSFileEntity; readonly rule: CSSRuleEntity | null; readonly startLine: number; readonly startColumn: number; readonly node: import("postcss").Declaration; /* ... */ }
interface CSSVariableEntity { readonly id: number; readonly name: string; readonly _flags: number; /* ... */ }
interface CSSVariableReferenceEntity { readonly id: number; readonly _flags: number; /* ... */ }
interface CSSAtRuleEntity { readonly id: number; readonly name: string; readonly kind: CSSAtRuleKind; readonly params: string; readonly node: import("postcss").AtRule; readonly file: CSSFileEntity; readonly rules: readonly CSSRuleEntity[]; readonly parsedParams: { animationName?: string }; readonly parent: { kind: string; name?: string; params?: string; parent: unknown } | null; /* ... */ }
interface CSSThemeTokenEntity { readonly id: number; readonly category: string; /* ... */ }
interface CSSMixinEntity { readonly name: string; readonly _flags: number; /* ... */ }
interface CSSMixinIncludeEntity { readonly _flags: number; /* ... */ }
interface CSSFunctionEntity { readonly name: string; readonly _flags: number; /* ... */ }
interface CSSFunctionCallEntity { /* ... */ }
interface CSSPlaceholderEntity { readonly name: string; readonly _flags: number; /* ... */ }
interface CSSExtendEntity { readonly _flags: number; /* ... */ }
interface CSSParseError { /* ... */ }
type CSSAtRuleKind = "media" | "keyframes" | "layer" | "font-face" | "supports" | "container" | "page" | "property" | "scope" | "starting-style" | "other";


// ═══════════════════════════════════════════════════════════════════════════
// 2. SYMBOLS — The unified symbol table
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base for all symbols in the compilation's symbol table.
 *
 * Like Roslyn's Symbol base class — every symbol has a name, a kind,
 * and a source location. Symbols from CSS files, Tailwind config, and
 * SCSS all implement this interface.
 */
export interface StyleSymbol {
  readonly symbolKind: StyleSymbolKind;
  readonly name: string;
  readonly filePath: string | null;  // null for Tailwind-generated symbols
}

export type StyleSymbolKind =
  | "className"
  | "selector"
  | "declaration"
  | "customProperty"
  | "componentHost"
  | "keyframes"
  | "fontFace"
  | "layer"
  | "container"
  | "themeToken";

/**
 * ClassNameSymbol — unifies CSS class selectors AND Tailwind utilities.
 *
 * Like Roslyn's NamedTypeSymbol where SourceNamedTypeSymbol (from .cs) and
 * PENamedTypeSymbol (from .dll) coexist as peers in GlobalNamespace.
 *
 * A CSS `.btn` class and a Tailwind `flex` utility both produce ClassNameSymbol
 * instances in the same table. Resolution doesn't care about the source.
 */
export interface ClassNameSymbol extends StyleSymbol {
  readonly symbolKind: "className";
  readonly name: string;
  readonly source: ClassNameSource;
}

export type ClassNameSource =
  | CSSClassNameSource
  | TailwindClassNameSource;

export interface CSSClassNameSource {
  readonly kind: "css";
  readonly selectors: readonly CSSSelectorEntity[];
  readonly filePaths: readonly string[];
}

export interface TailwindClassNameSource {
  readonly kind: "tailwind";
  readonly candidate: TailwindParsedCandidate;
  readonly resolvedCSS: string | null;
  readonly declarations: readonly TailwindResolvedDeclaration[];
  readonly diagnostics: readonly TailwindCandidateDiagnostic[];
}

/**
 * Parsed Tailwind candidate structure matching v4's exact algorithm.
 * Not a boolean "valid/invalid" — carries the full parse tree.
 */
export interface TailwindParsedCandidate {
  readonly raw: string;
  readonly variants: readonly TailwindParsedVariant[];
  readonly utility: string;
  readonly value: TailwindCandidateValue | null;
  readonly modifier: TailwindCandidateModifier | null;
  readonly important: boolean;
  readonly negative: boolean;
}

export interface TailwindParsedVariant {
  readonly name: string;
  readonly kind: "static" | "functional" | "compound" | "arbitrary";
  readonly value: string | null;
  readonly modifier: string | null;
}

export interface TailwindCandidateValue {
  readonly kind: "named" | "arbitrary" | "fraction";
  readonly value: string;
  readonly dashedIdent: string | null;
}

export interface TailwindCandidateModifier {
  readonly kind: "named" | "arbitrary";
  readonly value: string;
}

export interface TailwindResolvedDeclaration {
  readonly property: string;
  readonly value: string;
}

export type TailwindCandidateDiagnostic =
  | { readonly kind: "unknown-utility"; readonly utility: string }
  | { readonly kind: "invalid-variant"; readonly variant: string }
  | { readonly kind: "theme-token-not-found"; readonly token: string }
  | { readonly kind: "invalid-arbitrary-value"; readonly value: string };

/**
 * SelectorSymbol — wraps a CSSSelectorEntity with compilation-level identity.
 */
export interface SelectorSymbol extends StyleSymbol {
  readonly symbolKind: "selector";
  readonly entity: CSSSelectorEntity;
  readonly specificity: readonly [number, number, number];
  readonly dispatchKeys: readonly string[];
  readonly compiledMatcher: CompiledSelectorMatcher | null;
}

/**
 * DeclarationSymbol — a CSS declaration within a rule, with cascade metadata.
 */
export interface DeclarationSymbol extends StyleSymbol {
  readonly symbolKind: "declaration";
  readonly entity: CSSDeclarationEntity;
  readonly sourceOrder: number;
  readonly layerOrder: number;
}

/**
 * CustomPropertySymbol — a CSS custom property (--foo) or SCSS variable ($foo).
 */
export interface CustomPropertySymbol extends StyleSymbol {
  readonly symbolKind: "customProperty";
  readonly entity: CSSVariableEntity;
  readonly isGlobal: boolean;
  readonly isScss: boolean;
  readonly references: readonly CSSVariableReferenceEntity[];
  readonly resolvedValue: string | null;
}

/**
 * ComponentHostSymbol — a SolidJS component whose host element is resolved.
 *
 * Created during binding when an import reference resolves to a component
 * file whose default export returns a JSX element. The host element's tag
 * and CSS class tokens become available for cascade matching.
 */
export interface ComponentHostSymbol extends StyleSymbol {
  readonly symbolKind: "componentHost";
  readonly importSource: string;
  readonly exportName: string;
  readonly hostTag: string | null;
  readonly hostClassTokens: readonly string[];
  readonly hostAttributes: ReadonlyMap<string, string | null>;
  readonly resolvedFilePath: string;
}

/**
 * KeyframesSymbol — a @keyframes at-rule with its mutation analysis.
 */
export interface KeyframesSymbol extends StyleSymbol {
  readonly symbolKind: "keyframes";
  readonly entity: CSSAtRuleEntity;
  readonly layoutMutations: readonly KeyframeLayoutMutation[];
}

interface KeyframeLayoutMutation {
  readonly property: string;
  readonly values: readonly string[];
  readonly declarations: readonly CSSDeclarationEntity[];
}

/**
 * FontFaceSymbol — a @font-face at-rule with its descriptor analysis.
 */
export interface FontFaceSymbol extends StyleSymbol {
  readonly symbolKind: "fontFace";
  readonly entity: CSSAtRuleEntity;
  readonly family: string;
  readonly display: string | null;
  readonly hasWebFontSource: boolean;
  readonly hasEffectiveMetricOverrides: boolean;
}

/**
 * LayerSymbol — a @layer at-rule, carrying its resolved order.
 */
export interface LayerSymbol extends StyleSymbol {
  readonly symbolKind: "layer";
  readonly entity: CSSAtRuleEntity;
  readonly order: number;
}

/**
 * ContainerSymbol — a container-name declaration or @container query.
 */
export interface ContainerSymbol extends StyleSymbol {
  readonly symbolKind: "container";
  readonly declarations: readonly CSSDeclarationEntity[];
  readonly queries: readonly CSSAtRuleEntity[];
}

/**
 * ThemeTokenSymbol — a design token extracted from CSS or Tailwind theme.
 */
export interface ThemeTokenSymbol extends StyleSymbol {
  readonly symbolKind: "themeToken";
  readonly entity: CSSThemeTokenEntity;
  readonly category: string;
}

/**
 * The merged symbol table — the single authority for all symbols.
 *
 * Like Roslyn's GlobalNamespace where SourceNamedTypeSymbol and
 * PENamedTypeSymbol coexist. ClassNameSymbol from CSS and Tailwind
 * coexist as peers.
 */
export interface SymbolTable {
  // Primary indexes
  readonly classNames: ReadonlyMap<string, ClassNameSymbol>;
  readonly selectors: ReadonlyMap<number, SelectorSymbol>;
  readonly customProperties: ReadonlyMap<string, CustomPropertySymbol>;
  readonly componentHosts: ReadonlyMap<string, ComponentHostSymbol>;  // keyed by import specifier
  readonly keyframes: ReadonlyMap<string, KeyframesSymbol>;
  readonly fontFaces: ReadonlyMap<string, readonly FontFaceSymbol[]>;
  readonly layers: ReadonlyMap<string, LayerSymbol>;
  readonly containers: ReadonlyMap<string, ContainerSymbol>;
  readonly themeTokens: ReadonlyMap<string, ThemeTokenSymbol>;

  // Derived indexes built incrementally from syntax trees
  readonly selectorsByDispatchKey: ReadonlyMap<string, readonly SelectorSymbol[]>;
  readonly selectorsBySubjectTag: ReadonlyMap<string, readonly SelectorSymbol[]>;
  readonly selectorsWithoutSubjectTag: readonly SelectorSymbol[];
  readonly declarationsByProperty: ReadonlyMap<string, readonly DeclarationSymbol[]>;

  // Aggregate queries
  hasClassName(name: string): boolean;
  getClassName(name: string): ClassNameSymbol | null;
  getSelectorsByClassName(name: string): readonly SelectorSymbol[];
  getCustomProperty(name: string): CustomPropertySymbol | null;
  getKeyframes(name: string): KeyframesSymbol | null;
  getFontFaces(family: string): readonly FontFaceSymbol[];
  getLayerOrder(name: string): number;
}

/**
 * DeclarationTable — incremental symbol table builder.
 *
 * Like Roslyn's SyntaxAndDeclarationManager + DeclarationTable:
 * older symbol contributions are cached, only the latest tree's
 * contributions are lazily merged. Adding one file doesn't rebuild
 * the entire table.
 */
export interface DeclarationTable {
  readonly generation: number;

  /**
   * Return a new DeclarationTable with contributions from `tree` added.
   * Previous trees' contributions are cached and reused.
   */
  withTree(tree: CSSSyntaxTree): DeclarationTable;

  /**
   * Return a new DeclarationTable with contributions from `tree` removed.
   */
  withoutTree(filePath: string): DeclarationTable;

  /**
   * Return a new DeclarationTable with a TailwindProvider's symbols added.
   */
  withTailwindSymbols(symbols: TailwindSymbolContribution): DeclarationTable;

  /**
   * Materialize the merged SymbolTable. Lazy — only merges dirty
   * contributions since last materialization.
   */
  materialize(): SymbolTable;
}

interface TailwindSymbolContribution {
  readonly classNames: ReadonlyMap<string, TailwindClassNameSource>;
}


// ═══════════════════════════════════════════════════════════════════════════
// 3. ADDITIONAL INPUTS — Non-code compilation inputs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Like Roslyn's AdditionalText — non-code files that influence analysis.
 */
export interface AdditionalInput {
  readonly kind: AdditionalInputKind;
  readonly filePath: string;
  readonly version: string;
}

export type AdditionalInputKind = "tailwind-config" | "package-manifest" | "tsconfig";

export interface TailwindConfigInput extends AdditionalInput {
  readonly kind: "tailwind-config";
  readonly designSystem: TailwindDesignSystem;
}

export interface PackageManifestInput extends AdditionalInput {
  readonly kind: "package-manifest";
  readonly dependencies: ReadonlyMap<string, string>;
}

export interface TSConfigInput extends AdditionalInput {
  readonly kind: "tsconfig";
  readonly paths: ReadonlyMap<string, readonly string[]>;
  readonly baseUrl: string | null;
}

/**
 * Subset of Tailwind v4's DesignSystem used for candidate parsing.
 */
export interface TailwindDesignSystem {
  candidatesToCss(classes: string[]): (string | null)[];
  getClassList(): [string, { modifiers: string[] }][];
  getVariants(): { name: string; values: string[]; hasDash: boolean; isArbitrary: boolean }[];
}


// ═══════════════════════════════════════════════════════════════════════════
// 4. StyleCompilation — The single immutable object
// ═══════════════════════════════════════════════════════════════════════════

/**
 * StyleCompilation — replaces SolidGraph[], CSSGraph, and LayoutGraph.
 *
 * ONE immutable object owns ALL syntax trees, ALL symbols, ALL cross-reference
 * resolution authority. Like Roslyn's CSharpCompilation:
 *   - AddSyntaxTrees() → withSolidTree() / withCSSTree()
 *   - ReplaceSyntaxTree() → withSolidTree() replaces by path
 *   - WithReferences() → withTailwindConfig()
 *   - GlobalNamespace → symbolTable
 *
 * Mutation methods return NEW instances. The old instance remains valid.
 * Unchanged trees and symbol contributions are structurally shared.
 */
export interface StyleCompilation {
  readonly id: number;  // monotonic, for tracker identity

  // ── Syntax trees ──
  readonly solidTrees: ReadonlyMap<string, SolidSyntaxTree>;
  readonly cssTrees: ReadonlyMap<string, CSSSyntaxTree>;

  // ── Additional inputs ──
  readonly tailwindConfig: TailwindConfigInput | null;
  readonly packageManifest: PackageManifestInput | null;
  readonly tsConfig: TSConfigInput | null;

  // ── Symbol table (lazy, cached) ──
  readonly symbolTable: SymbolTable;

  // ── Dependency graph ──
  readonly dependencyGraph: DependencyGraph;

  // ── Mutation methods (return new immutable instances) ──

  withSolidTree(tree: SolidSyntaxTree): StyleCompilation;
  withCSSTrees(trees: readonly CSSSyntaxTree[]): StyleCompilation;
  withCSSTree(tree: CSSSyntaxTree): StyleCompilation;
  withoutFile(filePath: string): StyleCompilation;
  withTailwindConfig(config: TailwindConfigInput | null): StyleCompilation;
  withPackageManifest(manifest: PackageManifestInput | null): StyleCompilation;
  withTSConfig(config: TSConfigInput | null): StyleCompilation;

  /**
   * Replace a single file (Solid or CSS) and return a new compilation.
   * Determines file type from extension, delegates to withSolidTree or withCSSTree.
   */
  withFile(filePath: string, tree: SolidSyntaxTree | CSSSyntaxTree): StyleCompilation;

  // ── Queries ──

  getSolidTree(filePath: string): SolidSyntaxTree | null;
  getCSSTree(filePath: string): CSSSyntaxTree | null;

  /**
   * Create a per-file SemanticModel — the primary query interface.
   *
   * Like Roslyn's Compilation.GetSemanticModel(syntaxTree).
   * The SemanticModel is a lazy, cached VIEW into the compilation's
   * symbol table with cross-file resolution.
   */
  getSemanticModel(solidFilePath: string): FileSemanticModel;

  /**
   * Get all solid file paths in the compilation.
   */
  getSolidFilePaths(): readonly string[];

  /**
   * Get all CSS file paths in the compilation.
   */
  getCSSFilePaths(): readonly string[];
}

/**
 * Create a new empty StyleCompilation.
 */
export declare function createStyleCompilation(options?: StyleCompilationOptions): StyleCompilation;

export interface StyleCompilationOptions {
  readonly logger?: Logger;
}


// ═══════════════════════════════════════════════════════════════════════════
// 5. DEPENDENCY GRAPH — First-class import/scope tracking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DependencyGraph — replaces ad-hoc scope collection and cache invalidation.
 *
 * A first-class graph in the compilation:
 *   file A imports file B → edge(A, B)
 *   CSS @import chain → transitive CSS edges
 *   Co-location → implicit edge(foo.tsx, foo.css)
 *
 * CSS scope = transitive closure of CSS edges reachable from a Solid file.
 * Component host resolution follows import edges.
 * Change propagation follows reverse edges.
 */
export interface DependencyGraph {
  /**
   * All files that `filePath` directly depends on (imports, co-location).
   */
  getDirectDependencies(filePath: string): readonly DependencyEdgeInfo[];

  /**
   * All files that directly depend on `filePath` (reverse edges).
   * Used for change propagation: CSS file changed → which Solid files need rebinding?
   */
  getReverseDependencies(filePath: string): readonly string[];

  /**
   * CSS files in scope for a Solid file.
   *
   * Replaces collectCSSScopeBySolidFile. Computed as:
   *   1. Direct CSS imports from the Solid file (+ transitive @import chains)
   *   2. Co-located CSS (foo.tsx → foo.css, + its transitive @import chain)
   *   3. Cross-component CSS (imported component's co-located CSS)
   *   4. Global side-effect CSS (bare `import "./global.css"`)
   */
  getCSSScope(solidFilePath: string): readonly string[];

  /**
   * Solid files that import a component from `solidFilePath`.
   * Used for component host resolution propagation.
   */
  getComponentImporters(solidFilePath: string): readonly ComponentImportEdge[];

  /**
   * All files transitively affected by a change to `filePath`.
   * Returns in topological order (changed file first, dependents later).
   * Used by CompilationTracker for minimal rebinding.
   */
  getTransitivelyAffected(filePath: string): readonly string[];

  /**
   * Check if `solidFilePath` has `cssFilePath` in its CSS scope.
   */
  isInCSSScope(solidFilePath: string, cssFilePath: string): boolean;
}

export interface DependencyEdgeInfo {
  readonly target: string;
  readonly kind: DependencyEdgeKind;
}

export type DependencyEdgeKind =
  | "js-import"        // import from "./foo"
  | "css-import"       // import "./foo.css" or @import "./foo.css"
  | "css-at-import"    // CSS @import
  | "colocated"        // foo.tsx → foo.css
  | "global-side-effect";  // bare import "./global.css"

export interface ComponentImportEdge {
  readonly importerFile: string;
  readonly importedName: string;
}


// ═══════════════════════════════════════════════════════════════════════════
// 6. FileSemanticModel — Per-file lazy binding view
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FileSemanticModel — replaces the monolithic LayoutGraph.
 *
 * Like Roslyn's SemanticModel: a per-Solid-file VIEW into the compilation's
 * symbol table. All queries are lazy and cached. Cross-file resolution
 * DELEGATES to the compilation — no upfront "build LayoutGraph" step.
 *
 * Created via `compilation.getSemanticModel(solidFilePath)`.
 */
export interface FileSemanticModel {
  readonly filePath: string;
  readonly compilation: StyleCompilation;
  readonly solidTree: SolidSyntaxTree;

  // ── Element queries (replace LayoutGraph.records[]) ──

  /**
   * Get the element node for a JSX element by its ID.
   * Replaces LayoutGraph.elementBySolidFileAndId.
   */
  getElementNode(elementId: number): ElementNode | null;

  /**
   * Get all element nodes in this file.
   */
  getElementNodes(): readonly ElementNode[];

  /**
   * Get the cascade for an element — the resolved CSS declarations
   * after selector matching, specificity sort, and custom property resolution.
   *
   * This is the CASCADE BINDER — computed lazily like Roslyn's Binder:
   *   (a) get scoped CSS files from dependency graph
   *   (b) collect candidate selectors via dispatch index
   *   (c) match selectors against element
   *   (d) sort by cascade algorithm (specificity, source order, layers, !important)
   *   (e) resolve custom properties through symbol table
   *   (f) merge Tailwind utility declarations
   *   (g) cache result
   */
  getElementCascade(elementId: number): ElementCascade;

  /**
   * Get selectors matching an element.
   * Replaces LayoutGraph.selectorCandidatesByNode + applies.
   */
  getMatchingSelectors(elementId: number): readonly SelectorMatch[];

  /**
   * Get the component host for an import reference.
   * Replaces LayoutGraph.hostElementRefsByNode + component-host.ts.
   */
  getComponentHost(importSource: string, exportName: string): ComponentHostSymbol | null;

  /**
   * Get signal snapshot for an element.
   * Tier 3-4. Computed from cascade + signal normalization.
   * Replaces LayoutGraph.records[].snapshot.
   */
  getSignalSnapshot(elementId: number): SignalSnapshot;

  /**
   * Get a specific layout fact for an element.
   * Tier 3. Computed from signal snapshot.
   * Replaces LayoutGraph.records[].reservedSpace/scrollContainer/etc.
   */
  getLayoutFact<K extends LayoutFactKind>(elementId: number, factKind: K): LayoutFactMap[K];

  /**
   * Get conditional signal delta analysis for an element.
   * Tier 4. Replaces LayoutGraph.records[].conditionalDelta.
   */
  getConditionalDelta(elementId: number): ReadonlyMap<string, ConditionalSignalDelta> | null;

  /**
   * Get baseline offsets for an element.
   * Tier 4. Replaces LayoutGraph.records[].baselineOffsets.
   */
  getBaselineOffsets(elementId: number): ReadonlyMap<string, readonly number[]> | null;

  // ── Symbol queries ──

  /**
   * Get info about a CSS class name — whether it's defined in CSS, Tailwind, or unknown.
   * Replaces css.classNameIndex.has() + tailwind.has().
   */
  getClassNameInfo(name: string): ClassNameSymbol | null;

  /**
   * Resolve a CSS custom property reference.
   * Replaces CSSGraph's variablesByName lookup + reference resolution.
   */
  getCustomPropertyResolution(name: string): CustomPropertyResolution;

  /**
   * Get overriding selectors for a selector.
   * Replaces CSSGraph's duplicate selector detection.
   */
  getSelectorOverrides(selectorId: number): readonly SelectorSymbol[];

  // ── Scope queries ──

  /**
   * CSS files in scope for this Solid file.
   * Replaces LayoutGraph.cssScopeBySolidFile.
   */
  getScopedCSSFiles(): readonly string[];

  /**
   * All selectors from in-scope CSS files, indexed by dispatch key.
   * Replaces scopedSelectorsBySolidFile in selector-dispatch.ts.
   */
  getScopedSelectors(): ScopedSelectorIndex;

  /**
   * The import chain for this file.
   */
  getImportChain(): readonly ImportEntity[];

  // ── Reactive queries ──

  /**
   * Get the reactive kind of a variable.
   * Replaces SolidGraph.reactiveVariables categorization queried externally.
   */
  getReactiveKind(variable: VariableEntity): ReactiveKind | null;

  /**
   * Get dependency edges for a computation.
   * Replaces SolidGraph.dependencyEdges filtered by computation.
   */
  getDependencyEdges(computation: ComputationEntity): readonly DependencyEdge[];

  // ── Alignment queries (Tier 5) ──

  /**
   * Get alignment context for a parent element.
   * Replaces LayoutGraph.contextByParentNode.
   */
  getAlignmentContext(parentElementId: number): AlignmentContext | null;

  /**
   * Get cohort statistics for a parent element.
   * Replaces LayoutGraph.cohortStatsByParentNode.
   */
  getCohortStats(parentElementId: number): CohortStats | null;

  // ── Specialized indexes (computed lazily on first access) ──

  /**
   * Elements with conditional delta for a specific signal.
   * Replaces LayoutGraph.elementsWithConditionalDeltaBySignal.
   */
  getElementsWithConditionalDelta(signal: string): readonly ElementNode[];

  /**
   * Scroll container elements in this file.
   * Replaces LayoutGraph.scrollContainerElements filtered by file.
   */
  getScrollContainerElements(): readonly ElementNode[];

  /**
   * Dynamic slot candidate elements.
   * Replaces LayoutGraph.dynamicSlotCandidateElements filtered by file.
   */
  getDynamicSlotCandidates(): readonly ElementNode[];

  /**
   * Elements by tag name in this file.
   * Replaces LayoutGraph.elementsByTagName filtered by file.
   */
  getElementsByTagName(tag: string): readonly ElementNode[];

  /**
   * Stateful selector entries for a rule.
   * Replaces LayoutGraph.statefulSelectorEntriesByRuleId.
   */
  getStatefulSelectorEntries(ruleId: number): readonly StatefulSelectorEntry[];
}

// ── Element node and cascade types ──

/**
 * ElementNode — replaces LayoutElementNode.
 * Per-element resolved data computed during binding.
 */
export interface ElementNode {
  readonly key: string;
  readonly solidFile: string;
  readonly elementId: number;
  readonly tag: string | null;
  readonly tagName: string | null;
  readonly classTokens: readonly string[];
  readonly classTokenSet: ReadonlySet<string>;
  readonly inlineStyleKeys: readonly string[];
  readonly parentElementNode: ElementNode | null;
  readonly previousSiblingNode: ElementNode | null;
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly siblingTypeIndex: number;
  readonly siblingTypeCount: number;
  readonly selectorDispatchKeys: readonly string[];
  readonly attributes: ReadonlyMap<string, string | null>;
  readonly inlineStyleValues: ReadonlyMap<string, string>;
  readonly textualContent: TextualContentState;
  readonly isControl: boolean;
  readonly isReplaced: boolean;
}

export interface ElementCascade {
  readonly elementId: number;
  readonly declarations: ReadonlyMap<string, CascadedDeclaration>;
  readonly edges: readonly SelectorMatch[];
}

export interface CascadedDeclaration {
  readonly value: string;
  readonly source: SignalSource;
  readonly guardProvenance: RuleGuard;
}

export interface SelectorMatch {
  readonly selectorId: number;
  readonly specificityScore: number;
  readonly sourceOrder: number;
  readonly conditionalMatch: boolean;
}

export interface CustomPropertyResolution {
  readonly resolved: boolean;
  readonly symbol: CustomPropertySymbol | null;
  readonly value: string | null;
  readonly unresolvedReferences: readonly CSSVariableReferenceEntity[];
}

export interface ScopedSelectorIndex {
  readonly byDispatchKey: ReadonlyMap<string, readonly SelectorSymbol[]>;
  readonly byTagName: ReadonlyMap<string, readonly SelectorSymbol[]>;
  readonly requirements: {
    readonly needsClassTokens: boolean;
    readonly needsAttributes: boolean;
  };
}

export type ReactiveKind = "signal" | "props" | "store" | "resource" | "memo" | "derived";

// Forward references to signal/fact types (mirroring existing signal-model.ts)
export interface SignalSnapshot {
  readonly node: ElementNode;
  readonly signals: ReadonlyMap<string, SignalValue>;
  readonly knownSignalCount: number;
  readonly unknownSignalCount: number;
  readonly conditionalSignalCount: number;
}

export interface SignalValue {
  readonly kind: number;  // SignalValueKind
  readonly name: string;
  readonly normalized: string;
  readonly source: SignalSource;
  readonly guard: RuleGuard;
  readonly unit: number;  // SignalUnit
  readonly px: number | null;
  readonly quality: number;  // SignalQuality
}

export const enum SignalSource { Selector = 0, InlineStyle = 1 }

export interface RuleGuard {
  readonly kind: number;  // Guard kind enum
}

export type LayoutFactKind =
  | "reservedSpace"
  | "scrollContainer"
  | "flowParticipation"
  | "containingBlock";

export interface LayoutFactMap {
  reservedSpace: ReservedSpaceFact;
  scrollContainer: ScrollContainerFact;
  flowParticipation: FlowParticipationFact;
  containingBlock: ContainingBlockFact;
}

export interface ReservedSpaceFact {
  readonly hasReservedSpace: boolean;
  readonly reasons: readonly string[];
  readonly hasContainIntrinsicSize: boolean;
  readonly hasUsableAspectRatio: boolean;
  readonly hasDeclaredInlineDimension: boolean;
  readonly hasDeclaredBlockDimension: boolean;
}

export interface ScrollContainerFact {
  readonly isScrollContainer: boolean;
  readonly axis: number;
  readonly overflow: string | null;
  readonly overflowY: string | null;
  readonly hasConditionalScroll: boolean;
  readonly hasUnconditionalScroll: boolean;
}

export interface FlowParticipationFact {
  readonly inFlow: boolean;
  readonly position: string | null;
  readonly hasConditionalOutOfFlow: boolean;
  readonly hasUnconditionalOutOfFlow: boolean;
}

export interface ContainingBlockFact {
  readonly nearestPositionedAncestorKey: string | null;
  readonly nearestPositionedAncestorHasReservedSpace: boolean;
}

export interface ConditionalSignalDelta {
  readonly hasConditional: boolean;
  readonly hasDelta: boolean;
  readonly conditionalValues: readonly string[];
  readonly unconditionalValues: readonly string[];
  readonly hasConditionalScrollValue: boolean;
  readonly hasConditionalNonScrollValue: boolean;
  readonly hasUnconditionalScrollValue: boolean;
  readonly hasUnconditionalNonScrollValue: boolean;
}

export interface AlignmentContext {
  readonly kind: string;
  readonly certainty: string;
  readonly crossAxisIsBlockAxis: boolean;
  readonly baselineRelevance: string;
  readonly parentDisplay: string | null;
  readonly parentAlignItems: string | null;
}

export interface CohortStats {
  readonly profile: CohortProfile;
  readonly snapshots: readonly SignalSnapshot[];
  readonly subjectsByElementKey: ReadonlyMap<string, CohortSubjectStats>;
  readonly excludedElementKeys: ReadonlySet<string>;
}

export interface CohortProfile {
  readonly medianDeclaredOffsetPx: number | null;
  readonly declaredOffsetDispersionPx: number | null;
  readonly medianEffectiveOffsetPx: number | null;
  readonly effectiveOffsetDispersionPx: number | null;
  readonly medianLineHeightPx: number | null;
  readonly lineHeightDispersionPx: number | null;
  readonly dominantClusterSize: number;
  readonly dominantClusterShare: number;
  readonly unimodal: boolean;
}

export interface CohortSubjectStats {
  readonly element: { readonly solidFile: string; readonly elementKey: string; readonly elementId: number; readonly tag: string | null; readonly snapshot: SignalSnapshot };
  readonly declaredOffset: { value: number | null; kind: number };
  readonly effectiveOffset: { value: number | null; kind: number };
  readonly lineHeight: { value: number | null; kind: number };
  readonly baselineProfile: CohortProfile;
  readonly identifiability: { dominantShare: number; subjectMembership: number; ambiguous: boolean; kind: number };
}

export type TextualContentState = 0 | 1 | 2 | 3;  // Yes | No | Unknown | DynamicText

export interface StatefulSelectorEntry {
  readonly raw: string;
  readonly isStateful: boolean;
  readonly statePseudoClasses: readonly string[];
  readonly isDirectInteraction: boolean;
  readonly baseLookupKeys: readonly string[];
}

export interface CompiledSelectorMatcher {
  match(node: ElementNode): boolean;
}


// ═══════════════════════════════════════════════════════════════════════════
// 7. CASCADE BINDER — Lazy cross-file resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CascadeBinder — replaces cascade-builder.ts's imperative construction.
 *
 * Like Roslyn's Binder.LookupMembers — invoked lazily per element,
 * not upfront for all elements.
 *
 * getElementCascade(elementId) works as:
 *   1. Get scoped CSS files from compilation's dependency graph
 *   2. Collect candidate selectors via dispatch index (symbol table)
 *   3. Match selectors against element (compiled matchers)
 *   4. Sort by cascade algorithm (specificity, source order, layers, !important)
 *   5. Resolve custom properties through symbol table
 *   6. Merge Tailwind utility declarations (Tailwind symbols are peers)
 *   7. Cache result per (compilation.id, elementId)
 */
export interface CascadeBinder {
  readonly compilation: StyleCompilation;

  /**
   * Bind cascade for a single element. Lazy and cached.
   */
  bind(element: ElementNode, scopedSelectors: ScopedSelectorIndex): ElementCascade;

  /**
   * Bind cascade for all elements in a file. Returns a cached map.
   * Delegates to bind() per element.
   */
  bindFile(solidFilePath: string): ReadonlyMap<number, ElementCascade>;
}


// ═══════════════════════════════════════════════════════════════════════════
// 8. CSS SOURCE PROVIDERS — How different CSS sources produce symbols
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CSSSourceProvider — pluggable source abstraction.
 *
 * Like Roslyn's MetadataReference vs. SourceReference — different input
 * types produce the same symbol types. PlainCSS, SCSS, and Tailwind all
 * produce ClassNameSymbol, SelectorSymbol, DeclarationSymbol, etc.
 */
export interface CSSSourceProvider {
  readonly kind: CSSSourceProviderKind;

  /**
   * Parse a file and produce a CSSSyntaxTree.
   */
  parse(filePath: string, content: string, sourceOrderBase: number): CSSSyntaxTree;

  /**
   * Extract symbols from a syntax tree into the declaration table.
   */
  extractSymbols(tree: CSSSyntaxTree): CSSSymbolContribution;
}

export type CSSSourceProviderKind = "plain-css" | "scss" | "tailwind";

export interface CSSSymbolContribution {
  readonly classNames: ReadonlyMap<string, CSSClassNameSource>;
  readonly selectors: readonly SelectorSymbol[];
  readonly declarations: readonly DeclarationSymbol[];
  readonly customProperties: readonly CustomPropertySymbol[];
  readonly keyframes: readonly KeyframesSymbol[];
  readonly fontFaces: readonly FontFaceSymbol[];
  readonly layers: readonly LayerSymbol[];
  readonly containers: readonly ContainerSymbol[];
  readonly themeTokens: readonly ThemeTokenSymbol[];
}

/**
 * PlainCSSProvider — PostCSS parse → CSSSyntaxTree → symbols.
 */
export interface PlainCSSProvider extends CSSSourceProvider {
  readonly kind: "plain-css";
}

/**
 * SCSSProvider — PostCSS-SCSS → CSSSyntaxTree → symbols with mixin/function resolution.
 */
export interface SCSSProvider extends CSSSourceProvider {
  readonly kind: "scss";
}

/**
 * TailwindProvider — design system → utility/variant symbols.
 *
 * Replicates Tailwind v4's exact candidate parsing algorithm:
 *   1. Segment by colon → variant stack + utility root
 *   2. Permutation root matching against registered utilities
 *   3. Arbitrary value/modifier parsing with bracket balancing
 *   4. Variant registry lookup (static, functional, compound, arbitrary)
 *   5. Theme token resolution via CSS variable namespaces
 *
 * Produces ClassNameSymbol instances that carry:
 *   - Parsed candidate structure (variants, utility, value, modifier)
 *   - Resolved CSS declarations
 *   - Theme token references
 *   - Typed diagnostics ("unknown utility", "invalid variant", etc.)
 */
export interface TailwindProvider {
  readonly kind: "tailwind";
  readonly designSystem: TailwindDesignSystem;

  /**
   * Parse a candidate string and return a ClassNameSymbol if valid.
   * Not a boolean — returns the full parsed structure or diagnostic.
   */
  parseCandidate(candidate: string): TailwindCandidateResult;

  /**
   * Check if a class name is a valid Tailwind utility.
   * Fast path — avoids full resolution.
   */
  has(className: string): boolean;

  /**
   * Resolve a Tailwind utility to its CSS declarations.
   */
  resolve(className: string): TailwindResolution | null;

  /**
   * Get all registered utilities as symbols.
   */
  getUtilitySymbols(): TailwindSymbolContribution;

  /**
   * Get all registered variants.
   */
  getVariants(): readonly TailwindVariantInfo[];
}

export type TailwindCandidateResult =
  | { readonly valid: true; readonly candidate: TailwindParsedCandidate; readonly symbol: ClassNameSymbol }
  | { readonly valid: false; readonly diagnostics: readonly TailwindCandidateDiagnostic[] };

export interface TailwindResolution {
  readonly candidate: TailwindParsedCandidate;
  readonly css: string;
  readonly declarations: readonly TailwindResolvedDeclaration[];
}

export interface TailwindVariantInfo {
  readonly name: string;
  readonly kind: "static" | "functional" | "compound" | "arbitrary";
  readonly values: readonly string[];
  readonly hasDash: boolean;
  readonly isArbitrary: boolean;
  readonly order: number;
}

export declare function createPlainCSSProvider(): PlainCSSProvider;
export declare function createSCSSProvider(): SCSSProvider;
export declare function createTailwindProvider(designSystem: TailwindDesignSystem): TailwindProvider;


// ═══════════════════════════════════════════════════════════════════════════
// 9. TIERED COMPUTATION — Lazy analysis layers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ComputationTier — the 6 levels of analysis computation.
 *
 * Each tier is computed ONLY when queried by a rule that needs it.
 * If no Tier 4+ rules are active, cascade is never fully resolved.
 *
 * Tier 0: CSS syntax only (animation-layout-property, transition-layout-property, font-swap-instability)
 *         Queries: css syntax trees only. No cross-file binding.
 *
 * Tier 1: Solid + CSS syntax (undefined-css-class, unreferenced-class, classlist-*, style-*)
 *         Queries: solid + CSS syntax trees. Light symbol table lookups (className.has).
 *
 * Tier 2: Element resolution (duplicate-class-token, style-policy)
 *         Queries: element node resolution, component host resolution. No cascade.
 *
 * Tier 3: Selective layout facts (fill-image-parent, unsized-replaced-element, dynamic-slot, etc.)
 *         Queries: specific fact types (reservedSpace, scrollContainer, flowParticipation, containingBlock).
 *         Each rule needs 1-3 fact types, not all. Cascade computed for elements with matching selectors.
 *
 * Tier 4: Full cascade + signals (conditional-display-collapse, conditional-offset-shift, etc.)
 *         Queries: complete signal snapshots with conditional guards and delta analysis.
 *
 * Tier 5: Alignment model (sibling-alignment-outlier)
 *         Queries: Bayesian evidence scoring with cohort analysis, baseline offsets, composition fingerprinting.
 */
export const enum ComputationTier {
  /** CSS syntax only */
  CSSSyntax = 0,
  /** Solid + CSS syntax, light symbol lookups */
  CrossSyntax = 1,
  /** Element resolution + component hosts */
  ElementResolution = 2,
  /** Selective layout facts (reservedSpace, scrollContainer, etc.) */
  SelectiveLayoutFacts = 3,
  /** Full cascade + signal snapshots + conditional delta */
  FullCascade = 4,
  /** Alignment model with Bayesian evidence scoring */
  AlignmentModel = 5,
}

/**
 * TierRequirement — what a rule needs from the compilation.
 * The framework inspects all active rules' requirements to determine
 * the maximum tier to compute.
 */
export interface TierRequirement {
  readonly tier: ComputationTier;
  readonly factKinds?: readonly LayoutFactKind[];  // Tier 3: which facts
  readonly signals?: readonly string[];  // Tier 4: which signals
}


// ═══════════════════════════════════════════════════════════════════════════
// 10. ANALYZER DISPATCH — Rule subscription framework
// ═══════════════════════════════════════════════════════════════════════════

/**
 * AnalysisDispatcher — replaces CrossRuleContext god-object.
 *
 * Like Roslyn's CompilationWithAnalyzers + AnalyzerDriver:
 * rules register typed subscriptions, the framework inspects subscriptions
 * to determine the maximum required tier, computes only that tier,
 * and dispatches to subscribers.
 */
export interface AnalysisDispatcher {
  /**
   * Register a rule with its subscriptions.
   */
  register(rule: AnalysisRule): void;

  /**
   * Run all registered rules against a compilation.
   * Returns diagnostics bucketed by file.
   */
  run(compilation: StyleCompilation): AnalysisResult;

  /**
   * Run rules for a single file (incremental re-analysis).
   * Only re-runs rules whose subscriptions touch changed data.
   */
  runForFile(compilation: StyleCompilation, filePath: string): readonly Diagnostic[];
}

/**
 * AnalysisRule — replaces CrossRule + BaseRule<CrossRuleContext>.
 *
 * Instead of `check(context, emit)` where context is a god-object,
 * rules declare what they need via subscriptions and receive
 * typed, narrowed contexts.
 */
export interface AnalysisRule {
  readonly id: string;
  readonly severity: "error" | "warn" | "off";
  readonly messages: Record<string, string>;
  readonly meta: {
    readonly description: string;
    readonly fixable: boolean;
    readonly category: string;
  };

  /**
   * Declare what this rule needs.
   * The framework uses this to determine computation tier.
   */
  readonly requirement: TierRequirement;

  /**
   * Register actions on specific analysis events.
   * Called once during dispatcher setup.
   */
  register(registry: AnalysisActionRegistry): void;
}

/**
 * AnalysisActionRegistry — typed subscription API.
 *
 * Like Roslyn's AnalysisContext.Register* methods.
 * Rules subscribe to specific events; the framework dispatches.
 */
export interface AnalysisActionRegistry {
  /**
   * Tier 0: Subscribe to CSS syntax tree analysis.
   * Called once per CSS syntax tree.
   */
  registerCSSSyntaxAction(action: (tree: CSSSyntaxTree, symbolTable: SymbolTable, emit: Emit) => void): void;

  /**
   * Tier 1: Subscribe to Solid + CSS cross-syntax analysis.
   * Called once per Solid syntax tree with symbol table access.
   */
  registerCrossSyntaxAction(action: (solidTree: SolidSyntaxTree, symbolTable: SymbolTable, emit: Emit) => void): void;

  /**
   * Tier 1: Subscribe to specific symbol kinds.
   * Called once per symbol of the specified kind.
   */
  registerSymbolAction<K extends StyleSymbolKind>(
    kind: K,
    action: (symbol: StyleSymbolByKind[K], semanticModel: FileSemanticModel, emit: Emit) => void,
  ): void;

  /**
   * Tier 2: Subscribe to element resolution events.
   * Called once per element node in each file.
   */
  registerElementAction(action: (element: ElementNode, semanticModel: FileSemanticModel, emit: Emit) => void): void;

  /**
   * Tier 3: Subscribe to specific layout fact computations.
   * Called once per element that has the specified fact type.
   */
  registerFactAction<K extends LayoutFactKind>(
    factKind: K,
    action: (element: ElementNode, fact: LayoutFactMap[K], semanticModel: FileSemanticModel, emit: Emit) => void,
  ): void;

  /**
   * Tier 4: Subscribe to cascade + signal analysis.
   * Called once per element with resolved cascade and signals.
   */
  registerCascadeAction(action: (element: ElementNode, cascade: ElementCascade, snapshot: SignalSnapshot, semanticModel: FileSemanticModel, emit: Emit) => void): void;

  /**
   * Tier 4: Subscribe to conditional delta analysis.
   * Called once per element with conditional delta.
   */
  registerConditionalDeltaAction(action: (element: ElementNode, delta: ReadonlyMap<string, ConditionalSignalDelta>, semanticModel: FileSemanticModel, emit: Emit) => void): void;

  /**
   * Tier 5: Subscribe to alignment model analysis.
   * Called once per parent element with alignment context and cohort stats.
   */
  registerAlignmentAction(action: (parentElement: ElementNode, context: AlignmentContext, cohort: CohortStats, semanticModel: FileSemanticModel, emit: Emit) => void): void;
}

/**
 * Map from symbol kind to symbol type for typed dispatch.
 */
export interface StyleSymbolByKind {
  className: ClassNameSymbol;
  selector: SelectorSymbol;
  declaration: DeclarationSymbol;
  customProperty: CustomPropertySymbol;
  componentHost: ComponentHostSymbol;
  keyframes: KeyframesSymbol;
  fontFace: FontFaceSymbol;
  layer: LayerSymbol;
  container: ContainerSymbol;
  themeToken: ThemeTokenSymbol;
}

export type Emit = (diagnostic: Diagnostic) => void;

export interface AnalysisResult {
  readonly diagnosticsByFile: ReadonlyMap<string, readonly Diagnostic[]>;
  readonly allDiagnostics: readonly Diagnostic[];
  readonly maxTierComputed: ComputationTier;
  readonly perfStats: AnalysisPerfStats;
}

export interface AnalysisPerfStats {
  readonly totalMs: number;
  readonly tierMs: ReadonlyMap<ComputationTier, number>;
  readonly ruleMs: ReadonlyMap<string, number>;
  readonly elementsAnalyzed: number;
  readonly cascadesComputed: number;
  readonly signalSnapshotsBuilt: number;
}


// ═══════════════════════════════════════════════════════════════════════════
// 11. INCREMENTAL UPDATES — CompilationTracker
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CompilationTracker — replaces three-level GraphCache.
 *
 * Like Roslyn's CompilationTracker + SolutionCompilationState:
 * tracks which compilation state is current, which parts are stale,
 * and reuses unchanged parts when building new compilations.
 *
 * compilation.withFile(path, content) returns a new compilation that:
 *   - Reuses unchanged syntax trees (structural sharing)
 *   - Incrementally updates the declaration table (only new tree's contributions)
 *   - Invalidates dependent bindings via the dependency graph
 *   - Clears only affected SemanticModel caches
 */
export interface CompilationTracker {
  readonly currentCompilation: StyleCompilation;

  /**
   * Apply a file change and return the updated tracker.
   *
   * 1. Parse the new content into a syntax tree
   * 2. Create new compilation via withFile()
   * 3. Use dependency graph to identify affected files
   * 4. Invalidate SemanticModel caches for affected files only
   * 5. Return new tracker with new compilation
   *
   * CSS file changed → only Solid files importing it (transitively) need
   * SemanticModel rebinding → only elements matching changed selectors
   * need cascade recomputation.
   */
  applyChange(filePath: string, content: string, version: string): CompilationTracker;

  /**
   * Apply a file deletion.
   */
  applyDeletion(filePath: string): CompilationTracker;

  /**
   * Apply an additional input change (e.g. tailwind config changed).
   * Invalidates all SemanticModel caches since Tailwind symbols change.
   */
  applyInputChange(input: AdditionalInput): CompilationTracker;

  /**
   * Get the set of files whose SemanticModels are stale
   * (need rebinding due to dependency graph propagation).
   */
  getStaleFiles(): ReadonlySet<string>;

  /**
   * Get the set of files that were directly changed since the previous compilation.
   */
  getDirectlyChangedFiles(): ReadonlySet<string>;

  /**
   * Check if a specific file's SemanticModel is still valid.
   */
  isSemanticModelValid(filePath: string): boolean;

  /**
   * The previous compilation (for diffing).
   */
  readonly previousCompilation: StyleCompilation | null;
}

export declare function createCompilationTracker(
  compilation: StyleCompilation,
  options?: CompilationTrackerOptions,
): CompilationTracker;

export interface CompilationTrackerOptions {
  readonly cssProvider?: CSSSourceProvider;
  readonly scssProvider?: CSSSourceProvider;
  readonly tailwindProvider?: TailwindProvider;
  readonly logger?: Logger;
}


// ═══════════════════════════════════════════════════════════════════════════
// 12. DIRECTORY STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * packages/ganko/src/compilation/
 * ├── core/
 * │   ├── compilation.ts       — StyleCompilation implementation
 * │   ├── solid-syntax-tree.ts — SolidSyntaxTree construction (wraps existing solid phases)
 * │   ├── css-syntax-tree.ts   — CSSSyntaxTree construction (wraps existing css phases)
 * │   └── options.ts           — StyleCompilationOptions
 * │
 * ├── symbols/
 * │   ├── symbol-table.ts      — SymbolTable implementation
 * │   ├── declaration-table.ts — DeclarationTable (incremental builder)
 * │   ├── class-name.ts        — ClassNameSymbol
 * │   ├── selector.ts          — SelectorSymbol
 * │   ├── declaration.ts       — DeclarationSymbol
 * │   ├── custom-property.ts   — CustomPropertySymbol
 * │   ├── component-host.ts    — ComponentHostSymbol
 * │   ├── keyframes.ts         — KeyframesSymbol
 * │   ├── font-face.ts         — FontFaceSymbol
 * │   ├── layer.ts             — LayerSymbol
 * │   ├── container.ts         — ContainerSymbol
 * │   └── theme-token.ts       — ThemeTokenSymbol
 * │
 * ├── binding/
 * │   ├── semantic-model.ts    — FileSemanticModel implementation
 * │   ├── cascade-binder.ts    — CascadeBinder (lazy per-element cascade resolution)
 * │   ├── scope-resolver.ts    — CSS scope resolution via dependency graph
 * │   ├── element-builder.ts   — ElementNode construction from JSX elements
 * │   └── signal-builder.ts    — SignalSnapshot computation from cascade
 * │
 * ├── providers/
 * │   ├── provider.ts          — CSSSourceProvider interface
 * │   ├── plain-css.ts         — PlainCSSProvider (PostCSS parse)
 * │   ├── scss.ts              — SCSSProvider (PostCSS-SCSS + mixin/function resolution)
 * │   └── tailwind.ts          — TailwindProvider (v4 native candidate parsing)
 * │
 * ├── analysis/
 * │   ├── cascade-analyzer.ts  — Signal snapshot computation, conditional delta analysis
 * │   ├── layout-fact.ts       — Layout fact computation (reservedSpace, scrollContainer, etc.)
 * │   ├── alignment.ts         — Alignment model (Bayesian evidence scoring, cohort analysis)
 * │   └── statefulness.ts      — Stateful selector/declaration analysis
 * │
 * ├── dispatch/
 * │   ├── dispatcher.ts        — AnalysisDispatcher implementation
 * │   ├── registry.ts          — AnalysisActionRegistry implementation
 * │   ├── tier-resolver.ts     — Determines max computation tier from active rules
 * │   └── rule.ts              — AnalysisRule interface + defineAnalysisRule helper
 * │
 * └── incremental/
 *     ├── tracker.ts           — CompilationTracker implementation
 *     ├── dependency-graph.ts  — DependencyGraph (import/scope/co-location edges)
 *     └── change-propagation.ts — Transitive invalidation via reverse edges
 */


// ═══════════════════════════════════════════════════════════════════════════
// 13. COEXISTENCE WITH OLD SYSTEM DURING MIGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * During migration, both systems coexist:
 *
 * - Old system: cross-file/, solid/impl.ts (SolidGraph), css/impl.ts (CSSGraph)
 * - New system: compilation/
 *
 * The diagnostic pipeline (packages/lsp/src/core/analyze.ts) runs BOTH:
 *
 *   1. Build SolidGraphs and CSSGraph via old system (unchanged)
 *   2. Build StyleCompilation from the same parse data:
 *        - SolidSyntaxTree wraps SolidGraph's syntax fields (zero-copy)
 *        - CSSSyntaxTree wraps CSSGraph's per-file parse data (zero-copy)
 *   3. Run old CrossRules via old CrossRuleContext
 *   4. Run new AnalysisRules via AnalysisDispatcher
 *   5. Compare diagnostics: assert identical output
 *
 * This coexistence works because:
 *   - SolidSyntaxTree is a readonly view over SolidGraph's arrays
 *   - CSSSyntaxTree is a readonly view over CSSGraph's per-file arrays
 *   - No data is copied, no parse work is duplicated
 *   - The new system's binding produces the same results as the old system's
 *     LayoutGraph construction, verified by diff
 */

/**
 * Bridge: create a SolidSyntaxTree from an existing SolidGraph.
 * Zero-copy — the tree's fields point to the same arrays.
 */
export declare function solidGraphToSyntaxTree(graph: /* SolidGraph */ unknown, version: string): SolidSyntaxTree;

/**
 * Bridge: create CSSSyntaxTrees from an existing CSSGraph.
 * One tree per file. Zero-copy — entities reference the same objects.
 */
export declare function cssGraphToSyntaxTrees(graph: /* CSSGraph */ unknown): readonly CSSSyntaxTree[];

/**
 * Bridge: create a StyleCompilation from existing SolidGraph[] + CSSGraph.
 * Used during migration to run both systems on the same input.
 */
export declare function createCompilationFromLegacy(
  solids: readonly /* SolidGraph */ unknown[],
  css: /* CSSGraph */ unknown,
  versions: ReadonlyMap<string, string>,
): StyleCompilation;


// ═══════════════════════════════════════════════════════════════════════════
// 14. MIGRATION PATH — Phase by phase
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phase 1: Build compilation/core/
 *   - StyleCompilation shell (withFile, withSolidTree, withCSSTree, withoutFile)
 *   - SolidSyntaxTree wrapping SolidGraph syntax data (solidGraphToSyntaxTree bridge)
 *   - CSSSyntaxTree wrapping CSSGraph per-file parse data (cssGraphToSyntaxTrees bridge)
 *   - Compilation holds trees, returns them via getSolidTree/getCSSTree
 *   - DependencyGraph built from import/co-location edges in syntax trees
 *   Validate: compilation.getSolidTree(path) returns same entity arrays as old SolidGraph.
 *             compilation.dependencyGraph.getCSSScope(path) matches old collectCSSScopeBySolidFile.
 *
 * Phase 2: Build compilation/symbols/
 *   - SymbolTable and DeclarationTable
 *   - ClassNameSymbol, SelectorSymbol, DeclarationSymbol, CustomPropertySymbol
 *   - Populate from CSS syntax trees
 *   Validate: symbolTable.classNames contains same names as old CSSGraph.classNameIndex.
 *             symbolTable.selectors matches old CSSGraph.selectors.
 *             symbolTable.customProperties matches old CSSGraph.variablesByName.
 *
 * Phase 3: Build compilation/providers/
 *   - PlainCSSProvider and SCSSProvider (wrap existing parse phases)
 *   - TailwindProvider (wraps TailwindValidator, adds parsed candidate structure)
 *   Validate: providers produce same symbols as old CSSGraph + TailwindValidator.
 *             tailwindProvider.has(name) matches old tailwind.has(name).
 *             tailwindProvider.resolve(name) produces same CSS as old tailwind.resolve(name).
 *
 * Phase 4: Build compilation/binding/
 *   - FileSemanticModel with lazy cascade binding
 *   - CascadeBinder (replaces cascade-builder.ts)
 *   - Scope resolution (replaces scope.ts)
 *   - Element builder (replaces element-record.ts)
 *   - Component host resolution (replaces component-host.ts)
 *   Validate: semanticModel.getElementCascade(id).declarations matches
 *             old LayoutGraph.records.get(node).cascade for all elements.
 *             semanticModel.getMatchingSelectors(id) matches old LayoutGraph edges.
 *             semanticModel.getComponentHost() matches old component host resolution.
 *
 * Phase 5: Build compilation/analysis/
 *   - Signal builder (replaces signal-collection.ts)
 *   - Layout fact computation (replaces fact computation in build.ts)
 *   - Conditional delta analysis (replaces buildConditionalDeltaIndex)
 *   - Alignment model (replaces context-classification, cohort-index, rule-kit)
 *   Validate: semanticModel.getSignalSnapshot(id) matches old records[].snapshot.
 *             semanticModel.getLayoutFact(id, "reservedSpace") matches old records[].reservedSpace.
 *             semanticModel.getAlignmentContext(parentId) matches old contextByParentNode.
 *             semanticModel.getCohortStats(parentId) matches old cohortStatsByParentNode.
 *
 * Phase 6: Build compilation/dispatch/
 *   - AnalysisDispatcher and AnalysisActionRegistry
 *   - Migrate rules one tier at a time (Tier 0 first, Tier 5 last):
 *     * Tier 0 (3 rules): CSS-only rules that only need CSSSyntaxTree
 *     * Tier 1 (11 rules): Cross-syntax rules needing symbol table lookups
 *     * Tier 2 (2 rules): Element resolution rules
 *     * Tier 3 (12 rules): Layout fact rules
 *     * Tier 4 (5 rules): Full cascade + signal rules
 *     * Tier 5 (1 rule): Alignment model rule
 *   - Run both old and new systems, diff diagnostics per rule
 *   Validate: every migrated rule produces identical diagnostics on the full test suite.
 *
 * Phase 7: Delete old system
 *   - Delete cross-file/ directory
 *   - Remove SolidGraph class (keep parse phases as SolidSyntaxTree construction)
 *   - Remove CSSGraph class (keep parse phases as CSSSyntaxTree construction)
 *   - Delete cache.ts (replaced by CompilationTracker)
 *   - Update packages/lsp/src/core/analyze.ts to use AnalysisDispatcher
 */


// ═══════════════════════════════════════════════════════════════════════════
// 15. WHAT STAYS — Explicitly
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Solid parse phases (scopes, entities, context, wiring, reactivity, exports, dependencies)
 *   → become SolidSyntaxTree construction in compilation/core/solid-syntax-tree.ts
 *
 * CSS parse phases (parse, ast, references, tokens, cascade, scss)
 *   → become CSSSyntaxTree construction in compilation/core/css-syntax-tree.ts
 *
 * PostCSS/PostCSS-SCSS parsing
 *   → stays as PlainCSSProvider/SCSSProvider internals
 *
 * Selector specificity computation
 *   → stays (used by SelectorSymbol)
 *
 * Selector parser, CSS value parser, value tokenizer
 *   → stay as provider internals
 *
 * Dispatch key bucketing
 *   → moves into cascade binder (ScopedSelectorIndex construction)
 *
 * Signal normalization logic (isControlTag, isReplacedTag, buildSnapshotFromCascade)
 *   → moves into compilation/analysis/cascade-analyzer.ts
 *
 * Bayesian evidence scoring (LayoutDetector, evaluateAlignmentCase, rule-kit)
 *   → moves into compilation/analysis/alignment.ts
 *
 * Entity type definitions (ScopeEntity, VariableEntity, JSXElementEntity, SelectorEntity, etc.)
 *   → stay as syntax tree contents; symbols wrap/reference them
 *
 * All 33+ rule implementations
 *   → stay; re-targeted to AnalysisRule interface with typed subscriptions
 *     via registerCSSSyntaxAction/registerCrossSyntaxAction/registerElementAction/
 *     registerFactAction/registerCascadeAction/registerAlignmentAction
 */

export {};
