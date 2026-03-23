/**
 * Generate Section 1 dissolution tables by reading the actual source AST.
 * Produces separate .md files for each table in packages/ganko/src/compilation/tables/
 *
 * Usage: bun run scripts/generate-dissolution-tables.ts
 */
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { resolve, basename } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "packages/ganko/src/compilation/tables");
mkdirSync(OUT, { recursive: true });

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

function parseFile(relPath: string): ts.SourceFile {
  const abs = resolve(ROOT, relPath);
  return ts.createSourceFile(abs, readFileSync(abs, "utf-8"), ts.ScriptTarget.Latest, true);
}

interface Member {
  name: string;
  type: string;
  kind: "property" | "readonly" | "method" | "getter" | "private" | "weakmap-cache" | "id-generator" | "add-method" | "build-method";
}

function extractClassMembers(relPath: string, className: string): Member[] {
  const src = readSource(relPath);
  const sf = ts.createSourceFile(resolve(ROOT, relPath), src, ts.ScriptTarget.Latest, true);
  const members: Member[] = [];

  function typeText(node: ts.TypeNode | undefined): string {
    if (!node) return "inferred";
    return src.slice(node.pos, node.end).trim();
  }

  ts.forEachChild(sf, node => {
    if (!ts.isClassDeclaration(node) || node.name?.text !== className) return;
    for (const m of node.members) {
      if (ts.isPropertyDeclaration(m)) {
        const name = m.name?.getText(sf) ?? "?";
        const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
        const isPrivate = mods.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword);
        const isReadonly = mods.some(mod => mod.kind === ts.SyntaxKind.ReadonlyKeyword);
        let type = m.type ? typeText(m.type) : "inferred";
        const init = m.initializer ? src.slice(m.initializer.pos, m.initializer.end).trim() : "";

        // Classify
        let kind: Member["kind"] = isReadonly ? "readonly" : "property";
        if (isPrivate) {
          if (name.startsWith("_next")) kind = "id-generator";
          else kind = "private";
        }
        if (init.startsWith("new WeakMap")) kind = "weakmap-cache";

        // Infer type from initializer if needed
        if (type === "inferred" && init) {
          if (init === "0" || init === "null" || init === "false" || init === "true") type = init === "0" ? "number" : init;
          else if (init === "[]") type = "unknown[]";
          else if (init.startsWith("new Map<")) {
            const match = init.match(/new Map<([^>]+)>/);
            type = match ? `Map<${match[1]}>` : "Map";
          } else if (init.startsWith("new Set<")) {
            const match = init.match(/new Set<([^>]+)>/);
            type = match ? `Set<${match[1]}>` : "Set";
          } else if (init.startsWith("new WeakMap<")) {
            const match = init.match(/new WeakMap<([^>]+)>/);
            type = match ? `WeakMap<${match[1]}>` : "WeakMap";
          } else {
            type = init.length > 60 ? init.slice(0, 57) + "..." : init;
          }
        }

        members.push({ name, type, kind });
      } else if (ts.isMethodDeclaration(m)) {
        const name = m.name?.getText(sf) ?? "?";
        const mods = ts.canHaveModifiers(m) ? (ts.getModifiers(m) ?? []) : [];
        const isPrivate = mods.some(mod => mod.kind === ts.SyntaxKind.PrivateKeyword);
        const retType = m.type ? typeText(m.type) : "void";
        const params = m.parameters.map(p => `${p.name.getText(sf)}: ${p.type ? typeText(p.type) : "?"}`).join(", ");

        let kind: Member["kind"] = "method";
        if (isPrivate) kind = "private";
        else if (name.startsWith("next") && name.endsWith("Id")) kind = "id-generator";
        else if (name.startsWith("add") || name === "addClass") kind = "add-method";
        else if (name.startsWith("build")) kind = "build-method";

        members.push({ name, type: `(${params}) => ${retType}`, kind });
      } else if (ts.isGetAccessorDeclaration(m)) {
        const name = m.name?.getText(sf) ?? "?";
        const retType = m.type ? typeText(m.type) : "unknown";
        members.push({ name, type: retType, kind: "getter" });
      }
    }
  });

  return members;
}

function extractInterfaceMembers(relPath: string, interfaceName: string): Member[] {
  const src = readSource(relPath);
  const sf = ts.createSourceFile(resolve(ROOT, relPath), src, ts.ScriptTarget.Latest, true);
  const members: Member[] = [];

  function typeText(node: ts.TypeNode | undefined): string {
    if (!node) return "unknown";
    return src.slice(node.pos, node.end).trim();
  }

  ts.forEachChild(sf, node => {
    if (!ts.isInterfaceDeclaration(node) || node.name?.text !== interfaceName) return;
    for (const m of node.members) {
      if (ts.isPropertySignature(m)) {
        const name = m.name?.getText(sf) ?? "?";
        const isReadonly = m.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false;
        members.push({ name, type: typeText(m.type), kind: isReadonly ? "readonly" : "property" });
      } else if (ts.isMethodSignature(m)) {
        const name = m.name?.getText(sf) ?? "?";
        const params = m.parameters.map(p => `${p.name.getText(sf)}: ${p.type ? typeText(p.type) : "?"}`).join(", ");
        const retType = m.type ? typeText(m.type) : "void";
        members.push({ name, type: `(${params}) => ${retType}`, kind: "method" });
      }
    }
  });

  return members;
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ═══════════════════════════════════════════════════════════════
// TABLE 1A: SolidGraph → SolidSyntaxTree
// ═══════════════════════════════════════════════════════════════

function generateTable1A(): string {
  const members = extractClassMembers("packages/ganko/src/solid/impl.ts", "SolidGraph");
  const lines: string[] = [
    "# Table 1A: SolidGraph → SolidSyntaxTree Field Mapping\n",
    "Every field on `SolidGraph` (solid/impl.ts) mapped to its new home.\n",
    "| # | SolidGraph field | Type | Kind | New home | New field | Status | Notes |",
    "|---|-----------------|------|------|----------|-----------|--------|-------|",
  ];

  let i = 1;
  for (const m of members) {
    let newHome = "";
    let newField = "";
    let status = "";
    let notes = "";

    if (m.kind === "id-generator") {
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Build-time mutable counter. SolidSyntaxTree is immutable — IDs are assigned during construction.";
    } else if (m.kind === "add-method" || m.kind === "build-method") {
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Mutable builder method. SolidSyntaxTree is constructed by parse phases, not mutated after creation.";
    } else if (m.kind === "private" && m.name.startsWith("_next")) {
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Private mutable ID counter.";
    } else if (m.kind === "private" && m.name === "_lineStartOffsets") {
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Lazy cache backing field. Exposed via `lineStartOffsets` getter → SolidSyntaxTree.lineStartOffsets.";
    } else if (m.kind === "weakmap-cache") {
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Mutable query-time cache. Solid query functions (solid/queries/) create their own caches.";
    } else if (m.name === "logger") {
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Build-time logger. Not part of immutable syntax tree. Logger passed via compilation options.";
    } else if (m.name === "extractInlineStyleClassNames" || m.name === "indexObjectAttribute") {
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Private build-time helper method.";
    } else if (m.kind === "getter" && m.name === "lineStartOffsets") {
      newHome = "SolidSyntaxTree";
      newField = "lineStartOffsets";
      status = "Preserved";
      notes = "Computed eagerly during construction (not lazy). Type: `readonly number[]`.";
    } else if (m.name === "findExpressionAtOffset") {
      newHome = "SolidSyntaxTree";
      newField = "findExpressionAtOffset";
      status = "Preserved";
      notes = "Method signature unchanged.";
    } else if (m.name === "kind") {
      newHome = "SolidSyntaxTree";
      newField = "kind";
      status = "Preserved";
      notes = "Literal type `\"solid\"`.";
    } else if (m.name === "file") {
      newHome = "SolidSyntaxTree";
      newField = "filePath";
      status = "Renamed";
      notes = "Renamed from `file` to `filePath` for clarity. Same type: `string`.";
    } else if (m.name === "addUnaryExpression" || m.name === "addDeleteExpression" || m.name === "addSpreadElement" || m.name === "addNewExpressionByCallee" || m.name === "addIdentifierReference") {
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Internal builder method. Index populated during entity phase construction.";
    } else {
      // All remaining readonly properties and mutable data fields → SolidSyntaxTree
      newHome = "SolidSyntaxTree";
      newField = m.name;
      status = "Preserved";

      // Type adjustments
      if (m.name === "jsxAttrsByKind") {
        notes = "Key type preserved as `JSXAttributeKind` (NOT widened to `string`).";
      } else if (m.type.startsWith("Map<") || m.type.startsWith("Set<")) {
        notes = `Type becomes \`Readonly${m.type}\` in immutable syntax tree.`;
      } else if (m.type.endsWith("[]") && !m.type.startsWith("readonly")) {
        notes = `Type becomes \`readonly ${m.type.slice(0, -2)}[]\` in immutable syntax tree.`;
      } else {
        notes = "";
      }
    }

    lines.push(`| ${i++} | \`${m.name}\` | \`${esc(m.type)}\` | ${m.kind} | ${newHome} | \`${newField}\` | ${status} | ${notes} |`);
  }

  // Summary
  const preserved = members.filter(m => !["id-generator", "add-method", "build-method", "private", "weakmap-cache"].includes(m.kind) && m.name !== "logger" && m.name !== "extractInlineStyleClassNames" && m.name !== "indexObjectAttribute" && !m.name.startsWith("addUnary") && !m.name.startsWith("addDelete") && !m.name.startsWith("addSpread") && !m.name.startsWith("addNew") && !m.name.startsWith("addIdentifier")).length;
  const excluded = members.length - preserved;
  lines.push("");
  lines.push(`**Summary**: ${members.length} total members. ${preserved} preserved in SolidSyntaxTree. ${excluded} excluded (build-time mutation state).`);
  lines.push("");
  lines.push("**Additional SolidSyntaxTree fields not on SolidGraph**:");
  lines.push("- `version: string` — content hash for cache identity");
  lines.push("- `fileEntity: FileEntity` — backward compatibility during migration");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// TABLE 1B: CSSGraph → CSSSyntaxTree + SymbolTable
// ═══════════════════════════════════════════════════════════════

function generateTable1B(): string {
  const members = extractClassMembers("packages/ganko/src/css/impl.ts", "CSSGraph");
  const lines: string[] = [
    "# Table 1B: CSSGraph → CSSSyntaxTree (per-file) + SymbolTable (workspace-wide)\n",
    "Every field on `CSSGraph` (css/impl.ts) mapped to its new home.\n",
    "| # | CSSGraph field | Type | Per-file/Workspace | New home | New field | Status | Notes |",
    "|---|---------------|------|-------------------|----------|-----------|--------|-------|",
  ];

  // Categorization rules
  const perFileData = new Set([
    "files", "rules", "selectors", "declarations", "variables", "variableRefs",
    "atRules", "tokens", "mixins", "includes", "functions", "functionCalls",
    "placeholders", "extends", "parseErrors",
  ]);

  const perFileIndexes = new Set([
    "filesByPath", "rulesBySelector", "rulesByNode", "variablesByName",
    "declarationsByProperty", "atRulesByName", "atRulesByKind", "atRulesByNode",
    "classNameIndex", "selectorsBySubjectTag", "selectorsByPseudoClass",
    "selectorsWithoutSubjectTag",
  ]);

  const workspaceIndexes = new Set([
    "duplicateSelectors", "_selectorDedupIndex", "multiDeclarationProperties",
    "layoutPropertiesByClassToken", "keyframeLayoutMutationsByName",
    "fontFaceDescriptorsByFamily", "usedFontFamiliesByRule", "usedFontFamilies",
    "layerOrder", "declaredContainerNames", "containerQueryNames",
    "unusedContainerNames", "unknownContainerQueries",
    "knownKeyframeNames", "unresolvedAnimationRefs",
  ]);

  const filteredViews = new Set([
    "importantDeclarations", "globalVariables", "unusedVariables",
    "scssVariables", "cssCustomProperties", "unresolvedRefs",
    "mediaQueries", "keyframes", "layers", "fontFaces", "supportsRules",
    "unusedKeyframes", "unusedMixins", "unresolvedMixinIncludes",
    "unusedFunctions", "unusedPlaceholders", "unresolvedExtends",
    "keyframeDeclarations", "tokenCategories",
    "idSelectors", "attributeSelectors", "universalSelectors",
    "selectorsTargetingCheckbox", "selectorsTargetingTableCell",
  ]);

  const lazyGetters = new Set([
    "emptyRules", "emptyKeyframes", "deepNestedRules", "overqualifiedSelectors",
    "filesWithLayers",
  ]);

  const buildTime = new Set([
    "options", "interner", "logger", "sourceOrder", "hasScssFiles", "tailwind",
    "failedFilePaths",
  ]);

  let i = 1;
  for (const m of members) {
    let scope = "";
    let newHome = "";
    let newField = "";
    let status = "";
    let notes = "";

    const isIdGen = m.kind === "id-generator" || (m.name.startsWith("next") && m.name.endsWith("Id"));
    const isAddMethod = m.kind === "add-method" || m.name.startsWith("add") && m.kind === "method";
    const isBuildMethod = m.name.startsWith("build") || m.name === "intern" || m.name === "classifyPart" || m.name === "declarationsForProperties";

    if (isIdGen) {
      scope = "N/A";
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Build-time ID counter.";
    } else if (isAddMethod) {
      scope = "N/A";
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Mutable builder method.";
    } else if (isBuildMethod || m.name === "intern") {
      scope = "N/A";
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Build-time helper. Logic moves into provider/analysis construction.";
    } else if (buildTime.has(m.name)) {
      scope = "N/A";
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      if (m.name === "tailwind") notes = "Replaced by TailwindProvider symbols in SymbolTable.classNames.";
      else if (m.name === "options") notes = "Build-time config. Passed via provider constructor.";
      else if (m.name === "interner") notes = "Build-time string interner. Provider-internal.";
      else if (m.name === "logger") notes = "Build-time logger. Passed via compilation options.";
      else if (m.name === "sourceOrder") notes = "Mutable counter. Replaced by CSSSyntaxTree.sourceOrderBase.";
      else if (m.name === "hasScssFiles") notes = "Derivable: check if any CSSSyntaxTree has isScss=true.";
      else if (m.name === "failedFilePaths") notes = "Parse errors. CSSSyntaxTree.parseErrors covers per-file. Compilation tracks which files failed to parse.";
      else notes = "Build-time state.";
    } else if (perFileData.has(m.name)) {
      scope = "Per-file";
      newHome = "CSSSyntaxTree";
      newField = m.name;
      status = "Preserved";
      notes = "Partitioned: each CSSSyntaxTree holds this file's entities only.";
    } else if (perFileIndexes.has(m.name)) {
      scope = "Per-file";
      newHome = "CSSSyntaxTree";
      newField = m.name;
      status = "Preserved";
      notes = "Per-file index. Workspace-wide version built by SymbolTable merging all trees.";
    } else if (workspaceIndexes.has(m.name)) {
      scope = "Workspace";
      newHome = "SymbolTable";

      if (m.name === "duplicateSelectors") { newField = "duplicateSelectors"; notes = "Map<string, {selector, rules}>. Built during SymbolTable materialization."; }
      else if (m.name === "_selectorDedupIndex") { newField = "—"; status = "Internal"; notes = "Internal dedup index. Built during SymbolTable construction. Not exposed."; }
      else if (m.name === "multiDeclarationProperties") { newField = "multiDeclarationProperties"; notes = "Map<string, readonly DeclarationEntity[]>. Built during materialization from per-file declarationsByProperty."; }
      else if (m.name === "layoutPropertiesByClassToken") { newField = "layoutPropertiesByClassToken"; notes = "Map<string, readonly string[]>. Built during materialization. Consumed by classlist-geometry-toggle rule."; }
      else if (m.name === "keyframeLayoutMutationsByName") { newField = "Via KeyframesSymbol.layoutMutations"; notes = "Stored on KeyframesSymbol, queryable via symbolTable.keyframes."; }
      else if (m.name === "fontFaceDescriptorsByFamily") { newField = "Via FontFaceSymbol"; notes = "Stored on FontFaceSymbol, queryable via symbolTable.fontFaces."; }
      else if (m.name === "usedFontFamiliesByRule") { newField = "usedFontFamiliesByRule"; notes = "Map<number, readonly string[]>. Built during materialization. Consumed by font-swap-instability."; }
      else if (m.name === "usedFontFamilies") { newField = "usedFontFamilies"; notes = "Set<string>. Built during materialization."; }
      else if (m.name === "layerOrder") { newField = "Via LayerSymbol.order"; notes = "Layer ordering stored on LayerSymbol."; }
      else if (m.name === "declaredContainerNames") { newField = "Via ContainerSymbol.declarations"; notes = "Container name declarations on ContainerSymbol."; }
      else if (m.name === "containerQueryNames") { newField = "Via ContainerSymbol.queries"; notes = "Container queries on ContainerSymbol."; }
      else if (m.name === "unusedContainerNames") { newField = "unusedContainerNames"; notes = "Map<string, DeclarationEntity[]>. Computed during analysis (unused detection)."; }
      else if (m.name === "unknownContainerQueries") { newField = "unknownContainerQueries"; notes = "AtRuleEntity[]. Computed during analysis (unknown container detection)."; }
      else if (m.name === "knownKeyframeNames") { newField = "Derivable from symbolTable.keyframes.keys()"; notes = ""; }
      else if (m.name === "unresolvedAnimationRefs") { newField = "unresolvedAnimationRefs"; notes = "Computed during analysis from animation declarations vs keyframe symbols."; }
      else { newField = m.name; notes = ""; }

      if (!status) status = "Preserved";
    } else if (filteredViews.has(m.name)) {
      scope = "Workspace";

      // These are filtered subsets of entity collections
      if (m.name === "importantDeclarations") { newHome = "SymbolTable"; newField = "importantDeclarations"; notes = "Filtered view of declarations where _flags & DECL_IS_IMPORTANT. Built during materialization."; }
      else if (m.name === "idSelectors") { newHome = "SymbolTable"; newField = "idSelectors"; notes = "Filtered view of selectors where _flags & SEL_HAS_ID. Built during materialization."; }
      else if (m.name === "attributeSelectors") { newHome = "SymbolTable"; newField = "attributeSelectors"; notes = "Filtered view where SEL_HAS_ATTRIBUTE."; }
      else if (m.name === "universalSelectors") { newHome = "SymbolTable"; newField = "universalSelectors"; notes = "Filtered view where SEL_HAS_UNIVERSAL."; }
      else if (m.name === "selectorsTargetingCheckbox") { newHome = "SymbolTable"; newField = "selectorsTargetingCheckbox"; notes = "Filtered view from SelectorAnchor.targetsCheckbox."; }
      else if (m.name === "selectorsTargetingTableCell") { newHome = "SymbolTable"; newField = "selectorsTargetingTableCell"; notes = "Filtered view from SelectorAnchor.targetsTableCell."; }
      else if (m.name === "globalVariables") { newHome = "SymbolTable"; newField = "Derivable"; notes = "Filter customProperties where isGlobal=true."; }
      else if (m.name === "scssVariables") { newHome = "SymbolTable"; newField = "Derivable"; notes = "Filter customProperties where isScss=true."; }
      else if (m.name === "cssCustomProperties") { newHome = "SymbolTable"; newField = "Derivable"; notes = "Filter customProperties where isScss=false."; }
      else if (m.name === "unusedVariables") { newHome = "Analysis"; newField = "Computed by CSSAnalysis"; notes = "Unused detection is analysis, not syntax."; }
      else if (m.name === "unresolvedRefs") { newHome = "CSSSyntaxTree"; newField = "unresolvedRefs"; notes = "Per-file: refs not resolved within that file. Cross-file resolution in SemanticModel."; }
      else if (m.name === "mediaQueries") { newHome = "CSSSyntaxTree"; newField = "Derivable from atRulesByKind.get('media')"; notes = ""; }
      else if (m.name === "keyframes") { newHome = "CSSSyntaxTree"; newField = "Derivable from atRulesByKind.get('keyframes')"; notes = ""; }
      else if (m.name === "layers") { newHome = "CSSSyntaxTree"; newField = "Derivable from atRulesByKind.get('layer')"; notes = ""; }
      else if (m.name === "fontFaces") { newHome = "CSSSyntaxTree"; newField = "Derivable from atRulesByKind.get('font-face')"; notes = ""; }
      else if (m.name === "supportsRules") { newHome = "CSSSyntaxTree"; newField = "Derivable from atRulesByKind.get('supports')"; notes = ""; }
      else if (m.name === "unusedKeyframes") { newHome = "Analysis"; newField = "Computed by CSSAnalysis"; notes = "Unused detection is analysis."; }
      else if (m.name === "unusedMixins") { newHome = "Analysis"; newField = "Computed by CSSAnalysis"; notes = ""; }
      else if (m.name === "unresolvedMixinIncludes") { newHome = "CSSSyntaxTree"; newField = "unresolvedMixinIncludes"; notes = "Per-file unresolved includes."; }
      else if (m.name === "unusedFunctions") { newHome = "Analysis"; newField = "Computed by CSSAnalysis"; notes = ""; }
      else if (m.name === "unusedPlaceholders") { newHome = "Analysis"; newField = "Computed by CSSAnalysis"; notes = ""; }
      else if (m.name === "unresolvedExtends") { newHome = "CSSSyntaxTree"; newField = "unresolvedExtends"; notes = "Per-file."; }
      else if (m.name === "keyframeDeclarations") { newHome = "SymbolTable"; newField = "keyframeDeclarations"; notes = "Declarations inside @keyframes blocks. Built during materialization."; }
      else if (m.name === "tokenCategories") { newHome = "SymbolTable"; newField = "tokenCategories"; notes = "Array of category names. Derivable from themeTokens values."; }
      else { newHome = "SymbolTable"; newField = m.name; notes = ""; }

      status = "Preserved";
    } else if (lazyGetters.has(m.name)) {
      scope = "Workspace";
      if (m.name === "emptyRules") { newHome = "SymbolTable"; newField = "emptyRules"; notes = "Lazy getter. Rules with 0 declarations, 0 nested rules, 0 nested at-rules. Consumed by css-no-empty-rule."; }
      else if (m.name === "emptyKeyframes") { newHome = "SymbolTable"; newField = "emptyKeyframes"; notes = "Lazy getter. @keyframes with no effective declarations. Consumed by css-no-empty-keyframes."; }
      else if (m.name === "deepNestedRules") { newHome = "SymbolTable"; newField = "deepNestedRules"; notes = "Lazy getter. Rules with depth > 3. Consumed by CSS lint rules."; }
      else if (m.name === "overqualifiedSelectors") { newHome = "SymbolTable"; newField = "overqualifiedSelectors"; notes = "Lazy getter. ID selectors with additional qualifiers."; }
      else if (m.name === "filesWithLayers") { newHome = "SymbolTable"; newField = "Derivable from layers"; notes = "Set of file paths containing @layer. Derivable from LayerSymbol.filePath."; }
      else { newHome = "SymbolTable"; newField = m.name; notes = ""; }
      status = "Preserved";
    } else if (m.name === "tokensByCategory") {
      scope = "Workspace";
      newHome = "SymbolTable";
      newField = "tokensByCategory";
      status = "Preserved";
      notes = "Map<TokenCategory, ThemeTokenEntity[]>. Built during materialization.";
    } else if (m.name === "mixinsByName" || m.name === "functionsByName" || m.name === "placeholdersByName") {
      scope = "Workspace";
      newHome = "SymbolTable";
      newField = m.name;
      status = "Preserved";
      notes = "SCSS resolution index. Built during materialization from per-file SCSS entities.";
    } else if (m.name === "kind") {
      scope = "N/A";
      newHome = "N/A";
      newField = "—";
      status = "Excluded";
      notes = "Discriminant. CSSSyntaxTree has `kind: \"css\"`.";
    } else {
      // Catch-all for anything not categorized
      scope = "?";
      newHome = "?";
      newField = m.name;
      status = "UNCLASSIFIED";
      notes = "NEEDS MANUAL REVIEW";
    }

    lines.push(`| ${i++} | \`${m.name}\` | \`${esc(m.type)}\` | ${scope} | ${newHome} | \`${esc(newField)}\` | ${status} | ${notes} |`);
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// TABLE 1C: LayoutGraph → SemanticModel + Analysis
// ═══════════════════════════════════════════════════════════════

function generateTable1C(): string {
  const layoutMembers = extractInterfaceMembers("packages/ganko/src/cross-file/layout/graph.ts", "LayoutGraph");
  const recordMembers = extractInterfaceMembers("packages/ganko/src/cross-file/layout/graph.ts", "LayoutElementRecord");
  const nodeMembers = extractInterfaceMembers("packages/ganko/src/cross-file/layout/graph.ts", "LayoutElementNode");

  const lines: string[] = [
    "# Table 1C: LayoutGraph → SemanticModel (binding) + Analysis (derived)\n",
    "Every field on `LayoutGraph`, `LayoutElementRecord`, and `LayoutElementNode` mapped to new home.\n",
    "## LayoutGraph fields\n",
    "| # | Field | Type | Layer | New query/computation | Return type | Notes |",
    "|---|-------|------|-------|----------------------|-------------|-------|",
  ];

  const layoutMap: Record<string, [string, string, string, string]> = {
    elements: ["Binding", "FileSemanticModel.getElementNodes()", "readonly ElementNode[]", ""],
    childrenByParentNode: ["Binding", "Implicit via ElementNode.parentElementNode + childElementNodes", "readonly ElementNode[]", "ElementNode carries both parent ref and children array"],
    elementBySolidFileAndId: ["Binding", "FileSemanticModel.getElementNode(elementId)", "ElementNode \\| null", ""],
    elementRefsBySolidFileAndId: ["Binding", "ElementNode.jsxEntity", "JSXElementEntity", "ElementNode carries direct JSXElementEntity reference (not just ID)"],
    elementsByTagName: ["Binding", "FileSemanticModel.getElementsByTagName(tag)", "readonly ElementNode[]", ""],
    measurementNodeByRootKey: ["Derived", "Internal to AlignmentAnalyzer.getMeasurementNode(rootKey)", "ElementNode \\| null", "Not exposed on SemanticModel — consumed only by alignment analysis"],
    hostElementRefsByNode: ["Binding", "FileSemanticModel.getComponentHost(importSource, exportName)", "ComponentHostSymbol \\| null", ""],
    styleRules: ["Binding", "Internal to CascadeBinder — SelectorSymbol[] from SymbolTable", "—", "LayoutStyleRuleNode dissolves: cssFile from SelectorSymbol.filePath, selectorId from SelectorSymbol.entity.id"],
    applies: ["Binding", "FileSemanticModel.getMatchingSelectors(elementId)", "readonly SelectorMatch[]", "Per-element, not workspace-wide flat list"],
    cssScopeBySolidFile: ["Binding", "FileSemanticModel.getScopedCSSFiles()", "readonly string[]", "Delegates to DependencyGraph.getCSSScope()"],
    selectorCandidatesByNode: ["Binding", "Internal to CascadeBinder dispatch index", "—", "Not exposed — internal optimization for cascade binding"],
    selectorsById: ["Binding", "SymbolTable.selectors", "ReadonlyMap<number, SelectorSymbol>", ""],
    records: ["Derived", "Decomposed into per-element queries on FileSemanticModel", "—", "No single monolithic records map. Each fact computed lazily per element."],
    cohortStatsByParentNode: ["Derived", "FileSemanticModel.getCohortStats(parentElementId)", "CohortStats \\| null", "Computed by AlignmentAnalyzer"],
    contextByParentNode: ["Derived", "FileSemanticModel.getAlignmentContext(parentElementId)", "AlignmentContext \\| null", "Computed by AlignmentAnalyzer"],
    elementsWithConditionalDeltaBySignal: ["Derived", "FileSemanticModel.getElementsWithConditionalDelta(signal)", "readonly ElementNode[]", ""],
    elementsWithConditionalOverflowDelta: ["Derived", "Derivable: union of getElementsWithConditionalDelta('overflow') and ('overflow-y')", "readonly ElementNode[]", "Convenience index. Rules compute inline."],
    elementsWithConditionalOffsetDelta: ["Derived", "Derivable: union of getElementsWithConditionalDelta for offset signals", "readonly ElementNode[]", "Uses layoutOffsetSignals list. Rules compute inline."],
    elementsByKnownSignalValue: ["Derived", "FileSemanticModel.getElementsByKnownSignalValue(signal, value)", "readonly ElementNode[]", "Cross-element index. Built lazily on first Tier 3+ query."],
    dynamicSlotCandidateElements: ["Derived", "FileSemanticModel.getDynamicSlotCandidates()", "readonly ElementNode[]", ""],
    scrollContainerElements: ["Derived", "FileSemanticModel.getScrollContainerElements()", "readonly ElementNode[]", ""],
    statefulSelectorEntriesByRuleId: ["Derived", "FileSemanticModel.getStatefulSelectorEntries(ruleId)", "readonly StatefulSelectorEntry[]", "Computed by StatefulnessAnalyzer"],
    statefulNormalizedDeclarationsByRuleId: ["Derived", "FileSemanticModel.getStatefulNormalizedDeclarations(ruleId)", "readonly NormalizedRuleDeclaration[]", "Computed by StatefulnessAnalyzer"],
    statefulBaseValueIndex: ["Derived", "FileSemanticModel.getStatefulBaseValueIndex()", "ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>", "Computed by StatefulnessAnalyzer"],
    perf: ["N/A", "AnalysisResult.perfStats", "AnalysisPerfStats", "Perf tracking moves to dispatch layer"],
  };

  let i = 1;
  for (const m of layoutMembers) {
    const mapping = layoutMap[m.name];
    if (mapping) {
      lines.push(`| ${i++} | \`${m.name}\` | \`${esc(m.type)}\` | ${mapping[0]} | \`${esc(mapping[1])}\` | \`${esc(mapping[2])}\` | ${mapping[3]} |`);
    } else {
      lines.push(`| ${i++} | \`${m.name}\` | \`${esc(m.type)}\` | ? | UNMAPPED | — | NEEDS REVIEW |`);
    }
  }

  // LayoutElementRecord
  lines.push("");
  lines.push("## LayoutElementRecord fields\n");
  lines.push("| # | Field | Type | Layer | New query/computation | Return type | Notes |");
  lines.push("|---|-------|------|-------|----------------------|-------------|-------|");

  const recordMap: Record<string, [string, string, string, string]> = {
    ref: ["Binding", "ElementNode.jsxEntity + solidTree reference", "JSXElementEntity", "Direct entity reference on ElementNode. SolidSyntaxTree accessible via compilation."],
    edges: ["Binding", "FileSemanticModel.getMatchingSelectors(elementId)", "readonly SelectorMatch[]", ""],
    cascade: ["Binding", "FileSemanticModel.getElementCascade(elementId).declarations", "ReadonlyMap<string, CascadedDeclaration>", "Lazy cascade binding"],
    snapshot: ["Derived", "FileSemanticModel.getSignalSnapshot(elementId)", "SignalSnapshot", "Computed from cascade by SignalBuilder"],
    hotSignals: ["Derived", "Internal to CohortIndexBuilder", "SnapshotHotSignals", "Not exposed on SemanticModel. Extracted from SignalSnapshot during cohort analysis."],
    reservedSpace: ["Derived", "FileSemanticModel.getLayoutFact(elementId, 'reservedSpace')", "ReservedSpaceFact", ""],
    scrollContainer: ["Derived", "FileSemanticModel.getLayoutFact(elementId, 'scrollContainer')", "ScrollContainerFact", ""],
    flowParticipation: ["Derived", "FileSemanticModel.getLayoutFact(elementId, 'flowParticipation')", "FlowParticipationFact", ""],
    containingBlock: ["Derived", "FileSemanticModel.getLayoutFact(elementId, 'containingBlock')", "ContainingBlockFact", ""],
    conditionalDelta: ["Derived", "FileSemanticModel.getConditionalDelta(elementId)", "ReadonlyMap<LayoutSignalName, ConditionalSignalDeltaFact> \\| null", ""],
    baselineOffsets: ["Derived", "FileSemanticModel.getBaselineOffsets(elementId)", "ReadonlyMap<LayoutSignalName, readonly number[]> \\| null", ""],
  };

  i = 1;
  for (const m of recordMembers) {
    const mapping = recordMap[m.name];
    if (mapping) {
      lines.push(`| ${i++} | \`${m.name}\` | \`${esc(m.type)}\` | ${mapping[0]} | \`${esc(mapping[1])}\` | \`${esc(mapping[2])}\` | ${mapping[3]} |`);
    } else {
      lines.push(`| ${i++} | \`${m.name}\` | \`${esc(m.type)}\` | ? | UNMAPPED | — | NEEDS REVIEW |`);
    }
  }

  // LayoutElementNode
  lines.push("");
  lines.push("## LayoutElementNode → ElementNode field mapping\n");
  lines.push("| # | LayoutElementNode field | Type | ElementNode field | Notes |");
  lines.push("|---|------------------------|------|-------------------|-------|");

  i = 1;
  for (const m of nodeMembers) {
    let newField = m.name;
    let notes = "Preserved";
    if (m.name === "solidFile") notes = "Same field. Also accessible via compilation.";
    lines.push(`| ${i++} | \`${m.name}\` | \`${esc(m.type)}\` | \`${newField}\` | ${notes} |`);
  }

  lines.push("");
  lines.push("**Additional ElementNode fields not on LayoutElementNode**:");
  lines.push("- `jsxEntity: JSXElementEntity` — direct reference to source entity (replaces LayoutElementRef indirection)");
  lines.push("- `childElementNodes: readonly ElementNode[]` — direct children (replaces childrenByParentNode map lookup)");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// TABLE 1E: Rule Accounting
// ═══════════════════════════════════════════════════════════════

function generateTable1E(): string {
  const src = readSource("packages/ganko/src/cross-file/rules/index.ts");
  // Extract rule variable names from the array
  const match = src.match(/export const rules = \[([\s\S]*?)\] as const/);
  if (!match || !match[1]) return "ERROR: Could not parse rules array";

  const ruleNames = match[1].split(",").map(s => s.trim()).filter(s => s.length > 0);

  // Map rule variable names to file names and tier assignments
  const tierMap: Record<string, { tier: number; action: string }> = {
    // Tier 0 — CSS syntax only
    cssLayoutAnimationLayoutProperty: { tier: 0, action: "registerCSSSyntaxAction" },
    cssLayoutTransitionLayoutProperty: { tier: 0, action: "registerCSSSyntaxAction" },
    cssLayoutFontSwapInstability: { tier: 0, action: "registerCSSSyntaxAction" },
    // Tier 1 — Solid + CSS syntax
    jsxNoUndefinedCssClass: { tier: 1, action: "registerCrossSyntaxAction" },
    cssNoUnreferencedComponentClass: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxClasslistStaticKeys: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxClasslistNoConstantLiterals: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxClasslistBooleanValues: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxClasslistNoAccessorReference: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxStyleKebabCaseKeys: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxStyleNoFunctionValues: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxStyleNoUnusedCustomProp: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxLayoutClasslistGeometryToggle: { tier: 1, action: "registerCrossSyntaxAction" },
    jsxLayoutPictureSourceRatioConsistency: { tier: 1, action: "registerCrossSyntaxAction" },
    // Tier 2 — Element resolution
    jsxNoDuplicateClassTokenClassClasslist: { tier: 2, action: "registerElementAction" },
    jsxStylePolicy: { tier: 2, action: "registerElementAction" },
    // Tier 3 — Selective layout facts
    jsxLayoutFillImageParentMustBeSized: { tier: 3, action: "registerFactAction" },
    cssLayoutUnsizedReplacedElement: { tier: 3, action: "registerFactAction" },
    cssLayoutDynamicSlotNoReservedSpace: { tier: 3, action: "registerFactAction" },
    cssLayoutOverflowAnchorInstability: { tier: 3, action: "registerFactAction" },
    cssLayoutScrollbarGutterInstability: { tier: 3, action: "registerFactAction" },
    cssLayoutContentVisibilityNoIntrinsicSize: { tier: 3, action: "registerFactAction" },
    cssLayoutStatefulBoxModelShift: { tier: 3, action: "registerFactAction" },
    jsxLayoutUnstableStyleToggle: { tier: 3, action: "registerFactAction" },
    jsxLayoutPolicyTouchTarget: { tier: 3, action: "registerFactAction" },
    // Tier 4 — Full cascade + signals
    cssLayoutConditionalDisplayCollapse: { tier: 4, action: "registerConditionalDeltaAction" },
    cssLayoutConditionalOffsetShift: { tier: 4, action: "registerConditionalDeltaAction" },
    cssLayoutConditionalWhiteSpaceWrapShift: { tier: 4, action: "registerConditionalDeltaAction" },
    cssLayoutOverflowModeToggleInstability: { tier: 4, action: "registerConditionalDeltaAction" },
    cssLayoutBoxSizingToggleWithChrome: { tier: 4, action: "registerConditionalDeltaAction" },
    // Tier 5 — Alignment model
    cssLayoutSiblingAlignmentOutlier: { tier: 5, action: "registerAlignmentAction" },
  };

  const lines: string[] = [
    "# Table 1E: Cross-File Rule Accounting\n",
    `**Total cross-file rules: ${ruleNames.length}**\n`,
    "| # | Rule variable | Tier | Dispatch action | Notes |",
    "|---|--------------|------|-----------------|-------|",
  ];

  const tierCounts = [0, 0, 0, 0, 0, 0];
  let i = 1;
  for (const name of ruleNames) {
    const info = tierMap[name];
    if (info) {
      tierCounts[info.tier]++;
      lines.push(`| ${i++} | \`${name}\` | ${info.tier} | \`${info.action}\` | |`);
    } else {
      lines.push(`| ${i++} | \`${name}\` | ? | ? | **UNCLASSIFIED** |`);
    }
  }

  lines.push("");
  lines.push("## Tier summary\n");
  lines.push("| Tier | Count | Description |");
  lines.push("|------|-------|-------------|");
  lines.push(`| 0 | ${tierCounts[0]} | CSS syntax only |`);
  lines.push(`| 1 | ${tierCounts[1]} | Solid + CSS syntax |`);
  lines.push(`| 2 | ${tierCounts[2]} | Element resolution |`);
  lines.push(`| 3 | ${tierCounts[3]} | Selective layout facts |`);
  lines.push(`| 4 | ${tierCounts[4]} | Full cascade + signals |`);
  lines.push(`| 5 | ${tierCounts[5]} | Alignment model |`);
  lines.push(`| **Total** | **${ruleNames.length}** | |`);

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// TABLE 1G: CSS-only single-file rules
// ═══════════════════════════════════════════════════════════════

function generateTable1G(): string {
  const ruleDir = resolve(ROOT, "packages/ganko/src/css/rules");
  const categories = readdirSync(ruleDir).filter(f => !f.endsWith(".ts"));

  const lines: string[] = [
    "# Table 1G: CSS-Only Single-File Rules\n",
    "Every CSS-only rule and the CSSGraph fields it consumes.\n",
    "| # | Rule file | CSSGraph fields consumed | New data source |",
    "|---|-----------|------------------------|-----------------|",
  ];

  let i = 1;
  for (const cat of categories) {
    const catDir = resolve(ruleDir, cat);
    if (!existsSync(catDir)) continue;
    const files = readdirSync(catDir).filter(f => f.endsWith(".ts") && f !== "index.ts");
    for (const file of files) {
      const src = readFileSync(resolve(catDir, file), "utf-8");
      const graphAccesses = [...new Set(
        [...src.matchAll(/graph\.(\w+)/g)].map(m => m[1]).filter(Boolean)
      )];

      if (graphAccesses.length === 0) continue;

      const newSources = graphAccesses.map(field => {
        if (!field) return "?";
        if (["rules", "selectors", "declarations", "variables", "variableRefs", "atRules", "tokens", "files"].includes(field)) return "CSSSyntaxTree." + field;
        if (["declarationsByProperty", "rulesBySelector", "variablesByName", "atRulesByKind", "classNameIndex", "selectorsByPseudoClass"].includes(field)) return "CSSSyntaxTree." + field + " (per-file) or SymbolTable (workspace)";
        if (["emptyRules", "emptyKeyframes", "deepNestedRules", "overqualifiedSelectors"].includes(field)) return "SymbolTable." + field;
        if (["duplicateSelectors", "multiDeclarationProperties", "layoutPropertiesByClassToken"].includes(field)) return "SymbolTable." + field;
        if (["importantDeclarations", "idSelectors", "attributeSelectors", "universalSelectors"].includes(field)) return "SymbolTable." + field;
        if (["unusedVariables", "unusedKeyframes", "unusedMixins", "unusedFunctions", "unusedPlaceholders"].includes(field)) return "CSSAnalysis." + field;
        if (["unresolvedRefs", "unresolvedMixinIncludes", "unresolvedExtends"].includes(field)) return "CSSSyntaxTree." + field;
        if (["unresolvedAnimationRefs", "unknownContainerQueries", "unusedContainerNames"].includes(field)) return "SymbolTable." + field;
        if (["keyframeDeclarations"].includes(field)) return "SymbolTable." + field;
        if (["cssCustomProperties"].includes(field)) return "SymbolTable.customProperties (filtered)";
        if (field === "declarationsForProperties") return "SymbolTable.declarationsByProperty (method)";
        if (field === "filesWithLayers") return "SymbolTable (derivable from layers)";
        if (field === "layerOrder") return "SymbolTable (LayerSymbol.order)";
        return "SymbolTable." + field;
      });

      lines.push(`| ${i++} | \`${cat}/${basename(file, ".ts")}\` | \`${graphAccesses.join(", ")}\` | ${newSources.join("; ")} |`);
    }
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// TABLE 1D: Signal model type fidelity
// ═══════════════════════════════════════════════════════════════

function generateTable1D(): string {
  const lines: string[] = [
    "# Table 1D: Signal Model Type Fidelity\n",
    "Every type in the signal/guard/context model mapped to its new-system equivalent.\n",
    "**Rule**: No field may be lost. Discriminated unions must be preserved. String literal unions must not widen to `string`.\n",
    "| # | Existing type | Key fields | New type | Fields preserved | Resolution |",
    "|---|--------------|------------|----------|-----------------|------------|",
  ];

  const rows: [string, string, string, string, string][] = [
    ["LayoutSignalSnapshot", "node, signals (Map<LayoutSignalName, LayoutSignalValue>), knownSignalCount, unknownSignalCount, conditionalSignalCount", "SignalSnapshot", "ALL preserved. `LayoutSignalName` stays as 55-literal string union (NOT `string`).", "Direct rename."],
    ["LayoutKnownSignalValue", "kind: Known, name, normalized, source, guard, unit, px, quality", "KnownSignalValue", "ALL preserved. Part of `SignalValue` discriminated union.", "Discriminated union preserved: `SignalValue = KnownSignalValue | UnknownSignalValue`."],
    ["LayoutUnknownSignalValue", "kind: Unknown, name, source, guard, reason", "UnknownSignalValue", "ALL preserved including `reason: string`.", "reason field is critical for diagnostic messages."],
    ["LayoutRuleGuard", "Discriminated: {kind: Unconditional, conditions: [], key} | {kind: Conditional, conditions: LayoutGuardConditionProvenance[], key}", "RuleGuard", "ALL preserved. `conditions` and `key` fields MUST be present.", "NOT collapsed to `kind: number`. Full guard provenance chain preserved."],
    ["LayoutGuardConditionProvenance", "kind: 'media'|'supports'|'container'|'dynamic-attribute', query, key", "GuardConditionProvenance", "ALL preserved.", "Used by conditional delta rules and stateful rules."],
    ["LayoutSnapshotHotSignals", "20 named signal evidence fields (lineHeight, verticalAlign, ...)", "SnapshotHotSignals", "ALL 20 fields preserved.", "Internal to cohort analysis. Not on SemanticModel API. Extracted from SignalSnapshot during CohortIndexBuilder."],
    ["HotEvidenceWitness<T>", "present, value: T|null, kind: EvidenceValueKind", "HotEvidenceWitness<T>", "ALL preserved.", "Generic witness type for hot signal extraction."],
    ["AlignmentContext", "ALL 16+ fields: kind, certainty, crossAxisIsBlockAxis, baselineRelevance, parentDisplay, parentAlignItems, parentSolidFile, parentElementId, parentElementKey, parentTag, axis, axisCertainty, inlineDirection, inlineDirectionCertainty, parentPlaceItems, hasPositionedOffset, crossAxisIsBlockAxisCertainty, evidence", "AlignmentContext", "ALL 16+ fields preserved. NOT truncated to 6.", "Previous SPEC had only 6 fields. Must have all."],
    ["AlignmentCase", "subject, cohort, cohortProfile, cohortSignals, subjectIdentifiability, factorCoverage, cohortSnapshots, cohortFactSummary, cohortProvenance, offsets, context, contentComposition, cohortContentCompositions", "AlignmentCase", "ALL preserved.", "Input to Bayesian evaluateAlignmentCase()."],
    ["AlignmentEvaluation", "severity, confidence, offsets, contextKind, contextCertainty, posterior, evidenceMass, topFactors, signalFindings", "AlignmentEvaluation", "ALL preserved.", "Output of evaluateAlignmentCase()."],
    ["ContentCompositionFingerprint", "hasTextContent, hasInlineReplaced, inlineReplacedKind, hasHeightContributingDescendant, wrappingContextMitigates, hasVerticalAlignMitigation, mixedContentDepth, classification, analyzableChildCount, totalChildCount, hasOnlyBlockChildren", "ContentCompositionFingerprint", "ALL preserved.", "On CohortSubjectStats.contentComposition."],
    ["AlignmentCohortSignals", "verticalAlign, alignSelf, placeSelf, hasControlOrReplacedPeer, textContrastWithPeers", "AlignmentCohortSignals", "ALL preserved.", "On CohortSubjectStats.signals."],
    ["LayoutCohortStats", "profile, snapshots, factSummary, provenance, conditionalSignalCount, totalSignalCount, subjectsByElementKey, excludedElementKeys", "CohortStats", "ALL preserved including factSummary, provenance, conditionalSignalCount, totalSignalCount.", "Previous SPEC was missing 4 fields."],
    ["LayoutCohortSubjectStats", "element, declaredOffset, effectiveOffset, lineHeight, baselineProfile, signals, identifiability, contentComposition", "CohortSubjectStats", "ALL preserved including signals (AlignmentCohortSignals) and contentComposition.", "Previous SPEC was missing signals and contentComposition."],
    ["EvidenceProvenance", "reason, guardKey, guards: LayoutGuardConditionProvenance[]", "EvidenceProvenance", "ALL preserved.", "On CohortStats.provenance."],
    ["AlignmentCohortFactSummary", "exact, interval, unknown, conditional, total, exactShare, intervalShare, unknownShare, conditionalShare", "AlignmentCohortFactSummary", "ALL preserved.", "On CohortStats.factSummary."],
    ["LayoutNormalizedRuleDeclaration", "declarationId, property, normalizedValue, filePath, startLine, startColumn, propertyLength", "NormalizedRuleDeclaration", "ALL preserved.", "Used by stateful rule analysis."],
    ["LayoutStatefulSelectorEntry", "raw, isStateful, statePseudoClasses, isDirectInteraction, baseLookupKeys", "StatefulSelectorEntry", "ALL preserved.", ""],
    ["SignalConflictEvidence", "value: SignalConflictValue, kind: EvidenceValueKind", "SignalConflictEvidence", "ALL preserved.", ""],
    ["CohortIdentifiability", "dominantShare, subjectExcludedDominantShare, subjectMembership, ambiguous, kind", "CohortIdentifiability", "ALL preserved.", ""],
    ["AlignmentCohortProfile", "medianDeclaredOffsetPx, declaredOffsetDispersionPx, medianEffectiveOffsetPx, effectiveOffsetDispersionPx, medianLineHeightPx, lineHeightDispersionPx, dominantClusterSize, dominantClusterShare, unimodal", "CohortProfile", "ALL preserved.", ""],
    ["EvidenceAtom", "factorId, valueKind, contribution: LogOddsInterval, provenance, relevanceWeight, coverage", "EvidenceAtom", "ALL preserved.", "Bayesian evidence atom."],
    ["AlignmentSignalFinding", "kind, message, fix, weight", "AlignmentSignalFinding", "ALL preserved.", ""],
  ];

  let i = 1;
  for (const [existing, fields, newType, preserved, resolution] of rows) {
    lines.push(`| ${i++} | \`${existing}\` | ${esc(fields)} | \`${newType}\` | ${esc(preserved)} | ${resolution} |`);
  }

  // Enums
  lines.push("");
  lines.push("## Enums (preserved as const enums)\n");
  lines.push("| Existing enum | Values | New enum | Status |");
  lines.push("|--------------|--------|----------|--------|");
  const enums: [string, string][] = [
    ["LayoutSignalSource", "Selector=0, InlineStyle=1"],
    ["LayoutSignalGuard", "Unconditional=0, Conditional=1"],
    ["LayoutSignalUnit", "Px=0, Unitless=1, Keyword=2, Unknown=3"],
    ["SignalValueKind", "Known=0, Unknown=1"],
    ["SignalQuality", "Exact=0, Estimated=1"],
    ["LayoutTextualContentState", "Yes=0, No=1, Unknown=2, DynamicText=3"],
    ["LayoutScrollAxis", "None=0, X=1, Y=2, Both=3"],
    ["EvidenceValueKind", "Exact=0, Interval=1, Conditional=2, Unknown=3"],
    ["AlignmentTextContrast", "Different=0, Same=1, Unknown=2"],
    ["SignalConflictValue", "Conflict=0, Aligned=1, Unknown=2"],
    ["CohortSubjectMembership", "Dominant=0, Nondominant=1, Ambiguous=2, Insufficient=3"],
    ["ContentCompositionClassification", "TextOnly=0, ReplacedOnly=1, MixedUnmitigated=2, MixedMitigated=3, BlockSegmented=4, Unknown=5"],
  ];
  for (const [name, values] of enums) {
    lines.push(`| \`${name}\` | ${values} | Same name, drop Layout prefix if present | Preserved |`);
  }

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Generate all tables
// ═══════════════════════════════════════════════════════════════

console.log("Generating Table 1A: SolidGraph...");
writeFileSync(resolve(OUT, "table-1a-solid-graph.md"), generateTable1A());

console.log("Generating Table 1B: CSSGraph...");
writeFileSync(resolve(OUT, "table-1b-css-graph.md"), generateTable1B());

console.log("Generating Table 1C: LayoutGraph...");
writeFileSync(resolve(OUT, "table-1c-layout-graph.md"), generateTable1C());

console.log("Generating Table 1D: Signal model...");
writeFileSync(resolve(OUT, "table-1d-signal-model.md"), generateTable1D());

console.log("Generating Table 1E: Rules...");
writeFileSync(resolve(OUT, "table-1e-rules.md"), generateTable1E());

console.log("Generating Table 1G: CSS-only rules...");
writeFileSync(resolve(OUT, "table-1g-css-only-rules.md"), generateTable1G());

console.log("Done. Files written to packages/ganko/src/compilation/tables/");
