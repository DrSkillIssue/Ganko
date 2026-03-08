/**
 * CSSGraphImpl - CSS Program Graph Implementation
 *
 */
import type { Rule, AtRule } from "postcss";
import type { CSSInput, CSSOptions } from "./input";
import type { TailwindValidator } from "./tailwind";
import type { Logger } from "@ganko/shared";
import { noopLogger } from "@ganko/shared";
import { extractKeyframeNames, CHAR_HYPHEN, CHAR_R, CHAR_H, HEADING_ELEMENTS } from "@ganko/shared";
import type { StringInterner } from "@ganko/shared";
import { createCSSInterner } from "./intern";
import {
  parseContainerNames,
  parseContainerNamesFromShorthand,
  parseContainerQueryName,
  normalizeAnimationName,
  splitComma,
  CSS_WIDE_KEYWORDS,
} from "./parser/value-util";
import { LAYOUT_ANIMATION_MUTATION_PROPERTIES, LAYOUT_CLASS_GEOMETRY_PROPERTIES } from "./layout-taxonomy";
import type {
  FileEntity,
  RuleEntity,
  RuleElementKind,
  SelectorEntity,
  DeclarationEntity,
  VariableEntity,
  VariableReferenceEntity,
  AtRuleEntity,
  ThemeTokenEntity,
  MixinEntity,
  MixinIncludeEntity,
  SCSSFunctionEntity,
  FunctionCallEntity,
  PlaceholderEntity,
  ExtendEntity,
  TokenCategory,
  CSSParseError,
  AtRuleKind,
  SelectorPart,
} from "./entities";
import {
  hasFlag,
  DECL_IS_IMPORTANT, VAR_IS_GLOBAL, VAR_IS_SCSS, VAR_IS_USED,
  REF_IS_RESOLVED, INCLUDE_IS_RESOLVED, EXTEND_IS_RESOLVED,
  MIXIN_IS_USED, SCSSFN_IS_USED, PLACEHOLDER_IS_USED,
  SEL_HAS_ID, SEL_HAS_ATTRIBUTE, SEL_HAS_UNIVERSAL,
} from "./entities";

const BUTTON_ELEMENTS = new Set(["button", "input[type=\"submit\"]", "input[type=\"button\"]", "input[type=\"reset\"]"]);
const INPUT_ELEMENTS = new Set(["input", "select", "textarea"]);
const CAPTION_ELEMENTS = new Set(["caption", "figcaption", "small"]);
const PARAGRAPH_ELEMENTS = new Set(["p", "article", "section", "blockquote", "li", "dd", "dt"]);
const INLINE_FORMATTING_ELEMENTS = new Set([
  "sub", "sup", "abbr", "mark", "code", "kbd", "samp", "var", "dfn",
  "cite", "q", "ruby", "bdi", "bdo", "wbr", "span", "em", "strong",
  "i", "b", "u", "s", "del", "ins", "time",
]);

const BUTTON_CLASSES = /\bbtn\b|\bbutton\b|\bcta\b/i;
const INPUT_CLASSES = /\b(input|field|select|form-control|text-?field)\b/i;
const CAPTION_CLASSES = /\b(caption|footnote|fine-?print|disclaimer|helper|hint|sub-?text|meta)\b/i;
const PARAGRAPH_CLASSES = /\b(paragraph|text-?block|prose|body-?text|content)\b/i;
const BUTTON_ROLE_ATTR = /role\s*=\s*["']?button/i;
const FONT_GENERIC_FAMILY_SET = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);
const FONT_LAYOUT_PROPERTIES = new Set(["font-family"]);
const WHITESPACE_RE = /\s+/;

/**
 * Classify a rule's semantic element kinds from its selectors' parts.
 * Populates the rule's elementKinds set.
 */
function classifyRuleElementKinds(rule: RuleEntity): void {
  const kinds = rule.elementKinds;
  for (let i = 0; i < rule.selectors.length; i++) {
    const sel = rule.selectors[i];
    if (!sel) continue;
    const parts = sel.parts;
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (!part) continue;
      classifyPart(part, kinds);
    }
  }
}

function classifyPart(part: SelectorPart, kinds: Set<RuleElementKind>): void {
  if (part.type === "element") {
    const lower = part.value.toLowerCase();
    if (HEADING_ELEMENTS.has(lower)) { kinds.add("heading"); return; }
    if (BUTTON_ELEMENTS.has(lower)) { kinds.add("button"); return; }
    if (INPUT_ELEMENTS.has(lower)) { kinds.add("input"); return; }
    if (CAPTION_ELEMENTS.has(lower)) { kinds.add("caption"); return; }
    if (PARAGRAPH_ELEMENTS.has(lower)) { kinds.add("paragraph"); return; }
    if (INLINE_FORMATTING_ELEMENTS.has(lower)) { kinds.add("inline-formatting"); return; }
    return;
  }
  if (part.type === "pseudo-element") {
    kinds.add("pseudo-element");
    return;
  }
  if (part.type === "class") {
    if (BUTTON_CLASSES.test(part.value)) { kinds.add("button"); return; }
    if (INPUT_CLASSES.test(part.value)) { kinds.add("input"); return; }
    if (CAPTION_CLASSES.test(part.value)) { kinds.add("caption"); return; }
    if (PARAGRAPH_CLASSES.test(part.value)) { kinds.add("paragraph"); return; }
    return;
  }
  if (part.type === "attribute" && BUTTON_ROLE_ATTR.test(part.raw)) {
    kinds.add("button");
  }
}

/**
 * A declaration referencing a keyframe name that has no matching @keyframes.
 */
export interface UnresolvedAnimationRef {
  readonly declaration: DeclarationEntity;
  readonly name: string;
}

export interface KeyframeLayoutMutation {
  readonly property: string;
  readonly values: readonly string[];
  readonly declarations: readonly DeclarationEntity[];
}

export interface FontFaceDescriptor {
  readonly fontFace: AtRuleEntity;
  readonly family: string;
  readonly displayDeclaration: DeclarationEntity | null;
  readonly srcDeclaration: DeclarationEntity | null;
  readonly display: string | null;
  readonly src: string | null;
  readonly hasWebFontSource: boolean;
  readonly hasEffectiveMetricOverrides: boolean;
}

/**
 * Build a dedup key for duplicate-selector detection that captures the full
 * nesting ancestry.  Two rules with selector `C` are only duplicates if they
 * share the same file, the same full chain of ancestor selectors/at-rules,
 * and the same media/layer context.
 */
function buildDedupKey(rule: RuleEntity, selector: string): string {
  /* Walk the parent chain bottom-up, collecting each ancestor's identity. */
  let ancestry = "";
  let current: RuleEntity["parent"] = rule.parent;
  while (current !== null) {
    if (current.kind === "rule") {
      ancestry = current.selectorText + "\0" + ancestry;
      current = current.parent;
    } else {
      /* AtRuleEntity — include its kind+params as context */
      ancestry = `@${current.name} ${current.params}\0` + ancestry;
      current = current.parent;
    }
  }
  return `${rule.file.path}\0${ancestry}${selector}`;
}

export class CSSGraph {
  readonly kind = "css" as const;

  readonly options: CSSOptions;
  readonly interner: StringInterner;
  readonly logger: Logger;

  sourceOrder = 0;
  hasScssFiles = false;

  readonly files: FileEntity[] = [];
  readonly rules: RuleEntity[] = [];
  readonly selectors: SelectorEntity[] = [];
  readonly declarations: DeclarationEntity[] = [];
  readonly variables: VariableEntity[] = [];
  readonly variableRefs: VariableReferenceEntity[] = [];
  readonly atRules: AtRuleEntity[] = [];
  readonly tokens: ThemeTokenEntity[] = [];
  readonly mixins: MixinEntity[] = [];
  readonly includes: MixinIncludeEntity[] = [];
  readonly functions: SCSSFunctionEntity[] = [];
  readonly functionCalls: FunctionCallEntity[] = [];
  readonly placeholders: PlaceholderEntity[] = [];
  readonly extends: ExtendEntity[] = [];

  readonly filesByPath = new Map<string, FileEntity>();
  readonly variablesByName = new Map<string, VariableEntity[]>();
  readonly rulesBySelector = new Map<string, RuleEntity[]>();
  /** @internal Dedup index keyed by file+parent+selector+media+layer for duplicate detection. */
  readonly _selectorDedupIndex = new Map<string, RuleEntity[]>();
  readonly mixinsByName = new Map<string, MixinEntity>();
  readonly functionsByName = new Map<string, SCSSFunctionEntity>();
  readonly placeholdersByName = new Map<string, PlaceholderEntity>();
  readonly layerOrder = new Map<string, number>();
  readonly declarationsByProperty = new Map<string, DeclarationEntity[]>();
  readonly atRulesByName = new Map<string, AtRuleEntity[]>();
  readonly atRulesByKind = new Map<AtRuleKind, AtRuleEntity[]>();
  readonly atRulesByNode = new Map<AtRule, AtRuleEntity>();
  readonly rulesByNode = new Map<Rule, RuleEntity>();
  readonly duplicateSelectors = new Map<string, { selector: string; rules: RuleEntity[] }>();
  readonly tokensByCategory = new Map<TokenCategory, ThemeTokenEntity[]>();

  readonly importantDeclarations: DeclarationEntity[] = [];
  readonly globalVariables: VariableEntity[] = [];
  readonly unusedVariables: VariableEntity[] = [];
  readonly scssVariables: VariableEntity[] = [];
  readonly cssCustomProperties: VariableEntity[] = [];
  readonly unresolvedRefs: VariableReferenceEntity[] = [];
  readonly mediaQueries: AtRuleEntity[] = [];
  readonly keyframes: AtRuleEntity[] = [];
  readonly layers: AtRuleEntity[] = [];
  readonly fontFaces: AtRuleEntity[] = [];
  readonly supportsRules: AtRuleEntity[] = [];
  readonly unusedKeyframes: AtRuleEntity[] = [];
  readonly unusedMixins: MixinEntity[] = [];
  readonly unresolvedMixinIncludes: MixinIncludeEntity[] = [];
  readonly unusedFunctions: SCSSFunctionEntity[] = [];
  readonly unusedPlaceholders: PlaceholderEntity[] = [];
  readonly unresolvedExtends: ExtendEntity[] = [];
  readonly parseErrors: CSSParseError[] = [];
  readonly failedFilePaths: string[] = [];
  readonly tokenCategories: TokenCategory[] = [];

  readonly filesWithLayers = new Set<string>();
  readonly selectorsByPseudoClass = new Map<string, SelectorEntity[]>();
  readonly knownKeyframeNames = new Set<string>();
  readonly unresolvedAnimationRefs: UnresolvedAnimationRef[] = [];
  readonly declaredContainerNames = new Map<string, DeclarationEntity[]>();
  readonly containerQueryNames = new Map<string, AtRuleEntity[]>();
  readonly unusedContainerNames = new Map<string, DeclarationEntity[]>();
  readonly unknownContainerQueries: AtRuleEntity[] = [];

  /** Properties with 2+ declarations, each value pre-sorted by sourceOrder. */
  readonly multiDeclarationProperties = new Map<string, readonly DeclarationEntity[]>();
  /** Declarations whose parent rule is inside a @keyframes block. */
  readonly keyframeDeclarations: DeclarationEntity[] = [];
  /** Rules with zero declarations and zero nested rules. */
  readonly emptyRules: RuleEntity[] = [];
  /** @keyframes at-rules with no effective keyframe declarations. */
  readonly emptyKeyframes: AtRuleEntity[] = [];

  readonly colorDeclarations: DeclarationEntity[] = [];
  readonly calcDeclarations: DeclarationEntity[] = [];
  readonly varDeclarations: DeclarationEntity[] = [];
  readonly urlDeclarations: DeclarationEntity[] = [];
  readonly vendorPrefixedDeclarations: DeclarationEntity[] = [];
  readonly hardcodedColorDeclarations: DeclarationEntity[] = [];

  readonly overqualifiedSelectors: SelectorEntity[] = [];
  readonly idSelectors: SelectorEntity[] = [];
  readonly attributeSelectors: SelectorEntity[] = [];
  readonly universalSelectors: SelectorEntity[] = [];
  readonly classNameIndex = new Map<string, SelectorEntity[]>();
  readonly selectorsBySubjectTag = new Map<string, SelectorEntity[]>();
  readonly selectorsWithoutSubjectTag: SelectorEntity[] = [];
  readonly selectorsTargetingCheckbox: SelectorEntity[] = [];
  readonly selectorsTargetingTableCell: SelectorEntity[] = [];
  readonly layoutPropertiesByClassToken = new Map<string, readonly string[]>();
  readonly keyframeLayoutMutationsByName = new Map<string, readonly KeyframeLayoutMutation[]>();
  readonly fontFaceDescriptorsByFamily = new Map<string, readonly FontFaceDescriptor[]>();
  readonly usedFontFamiliesByRule = new Map<number, readonly string[]>();
  readonly usedFontFamilies = new Set<string>();

  /** Tailwind validator for utility class lookup (null if not a Tailwind project). */
  readonly tailwind: TailwindValidator | null;

  readonly deepNestedRules: RuleEntity[] = [];

  constructor(input: CSSInput) {
    this.options = input.options ?? {};
    this.tailwind = input.tailwind ?? null;
    this.interner = createCSSInterner();
    this.logger = input.logger ?? noopLogger;
  }

  intern(s: string): string {
    return this.interner.intern(s);
  }

  nextFileId(): number { return this.files.length; }
  nextRuleId(): number { return this.rules.length; }
  nextSelectorId(): number { return this.selectors.length; }
  nextDeclarationId(): number { return this.declarations.length; }
  nextVariableId(): number { return this.variables.length; }
  nextVariableRefId(): number { return this.variableRefs.length; }
  nextAtRuleId(): number { return this.atRules.length; }
  nextTokenId(): number { return this.tokens.length; }
  nextMixinId(): number { return this.mixins.length; }
  nextIncludeId(): number { return this.includes.length; }
  nextFunctionId(): number { return this.functions.length; }
  nextFunctionCallId(): number { return this.functionCalls.length; }
  nextPlaceholderId(): number { return this.placeholders.length; }
  nextExtendId(): number { return this.extends.length; }
  nextSourceOrder(): number { return this.sourceOrder++; }

  addFile(file: FileEntity): void {
    this.files.push(file);
    this.filesByPath.set(file.path, file);
  }

  addRule(rule: RuleEntity): void {
    this.rules.push(rule);
    this.rulesByNode.set(rule.node, rule);
  }

  addSelector(selector: SelectorEntity): void {
    this.selectors.push(selector);
  }

  addDeclaration(decl: DeclarationEntity): void {
    this.declarations.push(decl);
    const existing = this.declarationsByProperty.get(decl.property);
    if (existing) existing.push(decl);
    else this.declarationsByProperty.set(decl.property, [decl]);
    if (hasFlag(decl._flags, DECL_IS_IMPORTANT) || decl.node.important) this.importantDeclarations.push(decl);
  }

  addVariable(variable: VariableEntity): void {
    this.variables.push(variable);
    const existing = this.variablesByName.get(variable.name);
    if (existing) existing.push(variable);
    else this.variablesByName.set(variable.name, [variable]);
    if (hasFlag(variable._flags, VAR_IS_GLOBAL)) this.globalVariables.push(variable);
    if (hasFlag(variable._flags, VAR_IS_SCSS)) this.scssVariables.push(variable);
    else this.cssCustomProperties.push(variable);
  }

  addVariableRef(ref: VariableReferenceEntity): void {
    this.variableRefs.push(ref);
    if (!hasFlag(ref._flags, REF_IS_RESOLVED)) this.unresolvedRefs.push(ref);
  }

  addAtRule(atRule: AtRuleEntity): void {
    this.atRules.push(atRule);
    this.atRulesByNode.set(atRule.node, atRule);
    const byName = this.atRulesByName.get(atRule.name);
    if (byName) byName.push(atRule);
    else this.atRulesByName.set(atRule.name, [atRule]);
    const byKind = this.atRulesByKind.get(atRule.kind);
    if (byKind) byKind.push(atRule);
    else this.atRulesByKind.set(atRule.kind, [atRule]);
    switch (atRule.kind) {
      case "media": this.mediaQueries.push(atRule); break;
      case "keyframes": this.keyframes.push(atRule); break;
      case "layer": this.layers.push(atRule); break;
      case "font-face": this.fontFaces.push(atRule); break;
      case "supports": this.supportsRules.push(atRule); break;
    }
  }

  addToken(token: ThemeTokenEntity): void {
    this.tokens.push(token);
    const existing = this.tokensByCategory.get(token.category);
    if (existing) existing.push(token);
    else {
      this.tokensByCategory.set(token.category, [token]);
      this.tokenCategories.push(token.category);
    }
  }

  addMixin(mixin: MixinEntity): void {
    this.mixins.push(mixin);
    this.mixinsByName.set(mixin.name, mixin);
  }

  addMixinInclude(include: MixinIncludeEntity): void {
    this.includes.push(include);
    if (!hasFlag(include._flags, INCLUDE_IS_RESOLVED)) this.unresolvedMixinIncludes.push(include);
  }

  addFunction(fn: SCSSFunctionEntity): void {
    this.functions.push(fn);
    this.functionsByName.set(fn.name, fn);
  }

  addFunctionCall(call: FunctionCallEntity): void {
    this.functionCalls.push(call);
  }

  addPlaceholder(placeholder: PlaceholderEntity): void {
    this.placeholders.push(placeholder);
    this.placeholdersByName.set(placeholder.name, placeholder);
  }

  addExtend(ext: ExtendEntity): void {
    this.extends.push(ext);
    if (!hasFlag(ext._flags, EXTEND_IS_RESOLVED)) this.unresolvedExtends.push(ext);
  }

  addParseError(error: CSSParseError): void {
    this.parseErrors.push(error);
  }

  addFailedFile(path: string): void {
    this.failedFilePaths.push(path);
  }

  registerRuleBySelector(selector: string, rule: RuleEntity): void {
    /* Keyframe selectors (from, to, 0%, 100%) are not style rules —
       every @keyframes block has them and they are never duplicates. */
    for (let p = rule.parent; p !== null; p = p.kind === "rule" ? p.parent : null) {
      if (p.kind === "keyframes") return;
    }

    /* rulesBySelector is a lookup index keyed by selector text.
       External consumers (queries/get.ts, phases/scss.ts) query it
       by plain selector string — the key must remain selector text. */
    const existing = this.rulesBySelector.get(selector);
    if (existing) existing.push(rule);
    else this.rulesBySelector.set(selector, [rule]);

    /* Duplicate detection uses a separate key that scopes to file,
       full parent selector ancestry, and at-rule context.  `.btn:hover`
       in button.css and `.btn:hover` in input.css are independent.
       A responsive `.btn` inside @media is not a duplicate of the base.
       Walking the full ancestry prevents false positives from nested CSS
       where different grandparent selectors produce the same immediate parent. */
    const dedupKey = buildDedupKey(rule, selector);

    const dedupExisting = this._selectorDedupIndex.get(dedupKey);
    if (dedupExisting) {
      dedupExisting.push(rule);
      const dups = this.duplicateSelectors.get(selector);
      if (dups) dups.rules.push(rule);
      else {
        const first = dedupExisting[0];
        if (first) this.duplicateSelectors.set(selector, { selector, rules: [first, rule] });
      }
    } else {
      this._selectorDedupIndex.set(dedupKey, [rule]);
    }
  }

  registerLayerOrder(name: string, order: number): void {
    this.layerOrder.set(name, order);
  }

  /**
   * Retrieve declarations matching any of the given property names.
   * Uses the pre-built declarationsByProperty index for O(k) lookups.
   */
  declarationsForProperties(...properties: string[]): readonly DeclarationEntity[] {
    if (properties.length === 1) {
      const prop = properties[0];
      if (!prop) return [];
      return this.declarationsByProperty.get(prop) ?? [];
    }
    const out: DeclarationEntity[] = [];
    for (let i = 0; i < properties.length; i++) {
      const prop = properties[i];
      if (!prop) continue;
      const list = this.declarationsByProperty.get(prop);
      if (list) {
        for (let j = 0; j < list.length; j++) {
          const item = list[j];
          if (!item) continue;
          out.push(item);
        }
      }
    }
    return out;
  }

  /**
   * Build derived indexes that require all entities to be populated.
   * Called after all phases complete.
   */
  buildDerivedIndexes(): void {
    this.buildRuleDeclarationIndexes();
    this.buildContainingMediaStacks();
    this.buildKeyframeIndex();
    this.buildContainerNameIndexes();
    this.buildElementKinds();
    this.buildFilesWithLayers();
    this.buildSelectorPseudoClassIndex();
    this.buildMultiDeclarationProperties();
    this.buildKeyframeDeclarations();
    this.buildKeyframeLayoutMutationsByName();
    this.buildEmptyRules();
    this.buildEmptyKeyframes();
    this.buildDeclarationDerivedIndexes();
    this.buildSelectorDerivedIndexes();
    this.buildLayoutPropertiesByClassToken();
    this.buildFontFamilyUsageByRule();
    this.buildFontFaceDescriptorsByFamily();
    this.buildRuleDerivedIndexes();
  }

  private buildRuleDeclarationIndexes(): void {
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if (!rule) continue;
      const index = rule.declarationIndex;
      for (let j = 0; j < rule.declarations.length; j++) {
        const d = rule.declarations[j];
        if (!d) continue;
        const p = d.property.toLowerCase();
        const existing = index.get(p);
        if (existing) existing.push(d);
        else index.set(p, [d]);
      }
    }
  }

  private buildContainingMediaStacks(): void {
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if (!rule) continue;
      const medias: AtRuleEntity[] = [];
      let current: RuleEntity["parent"] = rule.parent;
      while (current) {
        if (current.kind === "media") medias.push(current);
        current = current.parent;
      }
      rule.containingMediaStack = medias;
    }
  }

  private buildKeyframeIndex(): void {
    const IGNORED = new Set([...CSS_WIDE_KEYWORDS, "none"]);

    for (let i = 0; i < this.keyframes.length; i++) {
      const kf = this.keyframes[i];
      if (!kf) continue;
      const name = kf.parsedParams.animationName;
      if (name) this.knownKeyframeNames.add(name);
    }

    const animDecls = this.declarationsForProperties("animation", "animation-name");
    for (let i = 0; i < animDecls.length; i++) {
      const d = animDecls[i];
      if (!d) continue;
      const names = extractKeyframeNames(d.value, d.property.toLowerCase());
      for (let j = 0; j < names.length; j++) {
        const name = names[j];
        if (!name) continue;
        if (IGNORED.has(name)) continue;
        if (name.includes("(")) continue;
        if (this.knownKeyframeNames.has(name)) continue;
        this.unresolvedAnimationRefs.push({ declaration: d, name });
      }
    }
  }

  private buildContainerNameIndexes(): void {
    for (let i = 0; i < this.declarations.length; i++) {
      const d = this.declarations[i];
      if (!d) continue;
      const p = d.property.toLowerCase();
      let names: readonly string[] | null = null;
      if (p === "container-name") names = parseContainerNames(d.value);
      else if (p === "container") names = parseContainerNamesFromShorthand(d.value);
      if (!names) continue;
      for (let j = 0; j < names.length; j++) {
        const name = names[j];
        if (!name) continue;
        const existing = this.declaredContainerNames.get(name);
        if (existing) existing.push(d);
        else this.declaredContainerNames.set(name, [d]);
      }
    }

    for (let i = 0; i < this.atRules.length; i++) {
      const at = this.atRules[i];
      if (!at) continue;
      if (at.kind !== "container") continue;
      const name = at.parsedParams.containerName ?? parseContainerQueryName(at.params);
      if (!name) continue;
      const existing = this.containerQueryNames.get(name);
      if (existing) existing.push(at);
      else this.containerQueryNames.set(name, [at]);
    }

    for (const [name, decls] of this.declaredContainerNames) {
      if (!this.containerQueryNames.has(name)) {
        this.unusedContainerNames.set(name, decls);
      }
    }

    for (const [name, atRules] of this.containerQueryNames) {
      if (!this.declaredContainerNames.has(name)) {
        for (let i = 0; i < atRules.length; i++) {
          const atRule = atRules[i];
          if (!atRule) continue;
          this.unknownContainerQueries.push(atRule);
        }
      }
    }
  }

  private buildElementKinds(): void {
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if (!rule) continue;
      classifyRuleElementKinds(rule);
    }
  }

  private buildFilesWithLayers(): void {
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (!layer) continue;
      this.filesWithLayers.add(layer.file.path);
    }
  }

  private buildSelectorPseudoClassIndex(): void {
    for (let i = 0; i < this.selectors.length; i++) {
      const sel = this.selectors[i];
      if (!sel) continue;
      const pseudoClasses = sel.complexity.pseudoClasses;
      for (let j = 0; j < pseudoClasses.length; j++) {
        const pc = pseudoClasses[j];
        if (!pc) continue;
        const existing = this.selectorsByPseudoClass.get(pc);
        if (existing) existing.push(sel);
        else this.selectorsByPseudoClass.set(pc, [sel]);
      }
    }
  }

  /**
   * Sort each declarationsByProperty list by sourceOrder and populate
   * multiDeclarationProperties with only those having 2+ entries.
   */
  private buildMultiDeclarationProperties(): void {
    for (const [property, declarations] of this.declarationsByProperty) {
      declarations.sort((a, b) => a.sourceOrder - b.sourceOrder);
      if (declarations.length >= 2) {
        this.multiDeclarationProperties.set(property, declarations);
      }
    }
  }

  /**
   * Collect declarations whose parent rule is inside a @keyframes block.
   */
  private buildKeyframeDeclarations(): void {
    for (let i = 0; i < this.declarations.length; i++) {
      const d = this.declarations[i];
      if (!d) continue;
      const rule = d.rule;
      if (!rule) continue;
      const parent = rule.parent;
      if (!parent) continue;
      if (parent.kind === "rule") continue;
      if (parent.kind !== "keyframes") continue;
      this.keyframeDeclarations.push(d);
    }
  }

  private buildKeyframeLayoutMutationsByName(): void {
    const byAnimationByProperty = new Map<string, Map<string, { values: Set<string>; declarations: DeclarationEntity[] }>>();

    for (let i = 0; i < this.keyframeDeclarations.length; i++) {
      const declaration = this.keyframeDeclarations[i];
      if (!declaration) continue;
      const rule = declaration.rule;
      if (!rule || rule.parent === null || rule.parent.kind !== "keyframes") continue;

      const property = declaration.property.toLowerCase();
      if (!LAYOUT_ANIMATION_MUTATION_PROPERTIES.has(property)) continue;

      const animationName = normalizeAnimationName(rule.parent.params);
      if (!animationName) continue;

      let byProperty = byAnimationByProperty.get(animationName);
      if (!byProperty) {
        byProperty = new Map<string, { values: Set<string>; declarations: DeclarationEntity[] }>();
        byAnimationByProperty.set(animationName, byProperty);
      }

      let bucket = byProperty.get(property);
      if (!bucket) {
        bucket = { values: new Set<string>(), declarations: [] };
        byProperty.set(property, bucket);
      }

      bucket.values.add(normalizeCssValue(declaration.value));
      bucket.declarations.push(declaration);
    }

    for (const [animationName, byProperty] of byAnimationByProperty) {
      const mutations: KeyframeLayoutMutation[] = [];

      for (const [property, bucket] of byProperty) {
        if (bucket.values.size <= 1) continue;
        mutations.push({
          property,
          values: [...bucket.values],
          declarations: bucket.declarations,
        });
      }

      if (mutations.length === 0) continue;
      this.keyframeLayoutMutationsByName.set(animationName, mutations);
    }
  }

  /**
   * Collect rules with no declarations and no nested rules.
   */
  private buildEmptyRules(): void {
    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      if (!rule) continue;
      if (rule.declarations.length === 0 && rule.nestedRules.length === 0) {
        this.emptyRules.push(rule);
      }
    }
  }

  /**
   * Collect @keyframes with no effective keyframe declarations.
   */
  private buildEmptyKeyframes(): void {
    for (let i = 0; i < this.keyframes.length; i++) {
      const kf = this.keyframes[i];
      if (!kf) continue;
      if (!kf.parsedParams.animationName) continue;
      if (kf.rules.length === 0) {
        this.emptyKeyframes.push(kf);
        continue;
      }
      let hasDeclaration = false;
      for (let j = 0; j < kf.rules.length; j++) {
        const kfRule = kf.rules[j];
        if (!kfRule) continue;
        if (kfRule.declarations.length > 0) {
          hasDeclaration = true;
          break;
        }
      }
      if (!hasDeclaration) this.emptyKeyframes.push(kf);
    }
  }

  private buildDeclarationDerivedIndexes(): void {
    const HARDCODED_HEX = /^#[0-9a-f]{3,8}$/i;
    for (let i = 0, len = this.declarations.length; i < len; i++) {
      const d = this.declarations[i];
      if (!d) continue;
      const pv = d.parsedValue;
      if (pv.colors.length > 0) this.colorDeclarations.push(d);
      if (pv.hasCalc) this.calcDeclarations.push(d);
      if (pv.hasVar) this.varDeclarations.push(d);
      if (pv.hasUrl) this.urlDeclarations.push(d);
      if (d.property.charCodeAt(0) === CHAR_HYPHEN && d.property.charCodeAt(1) !== CHAR_HYPHEN) {
        this.vendorPrefixedDeclarations.push(d);
      }
      if (!pv.hasVar && pv.colors.length > 0) {
        for (let j = 0, clen = pv.colors.length; j < clen; j++) {
          const c = pv.colors[j];
          if (!c) continue;
          if (HARDCODED_HEX.test(c) || c.charCodeAt(0) === CHAR_R || c.charCodeAt(0) === CHAR_H) {
            this.hardcodedColorDeclarations.push(d);
            break;
          }
        }
      }
    }
  }

  private buildSelectorDerivedIndexes(): void {
    for (let i = 0, len = this.selectors.length; i < len; i++) {
      const sel = this.selectors[i];
      if (!sel) continue;
      const parts = sel.parts;
      const anchor = sel.anchor;

      if (anchor.subjectTag === null) {
        this.selectorsWithoutSubjectTag.push(sel);
      } else {
        const existingByTag = this.selectorsBySubjectTag.get(anchor.subjectTag);
        if (existingByTag) existingByTag.push(sel);
        else this.selectorsBySubjectTag.set(anchor.subjectTag, [sel]);
      }

      if (anchor.targetsCheckbox) this.selectorsTargetingCheckbox.push(sel);
      if (anchor.targetsTableCell) this.selectorsTargetingTableCell.push(sel);

      for (let j = 0, plen = parts.length; j < plen; j++) {
        const part = parts[j];
        if (!part) continue;
        if (part.type === "class") {
          const existing = this.classNameIndex.get(part.value);
          if (existing) existing.push(sel);
          else this.classNameIndex.set(part.value, [sel]);
        }
      }

      const flags = sel.complexity._flags;
      if (hasFlag(flags, SEL_HAS_ID)) {
        this.idSelectors.push(sel);
        for (let j = 0, plen = parts.length; j < plen; j++) {
          const p = parts[j];
          if (!p) continue;
          const t = p.type;
          if (t === "element" || t === "class" || t === "attribute") {
            this.overqualifiedSelectors.push(sel);
            break;
          }
        }
      }
      if (hasFlag(flags, SEL_HAS_ATTRIBUTE)) this.attributeSelectors.push(sel);
      if (hasFlag(flags, SEL_HAS_UNIVERSAL)) this.universalSelectors.push(sel);
    }
  }

  private buildLayoutPropertiesByClassToken(): void {
    const byClass = new Map<string, Set<string>>();

    for (let i = 0; i < this.selectors.length; i++) {
      const selector = this.selectors[i];
      if (!selector) continue;
      if (selector.anchor.classes.length === 0) continue;

      const properties = new Set<string>();
      for (let j = 0; j < selector.rule.declarations.length; j++) {
        const decl = selector.rule.declarations[j];
        if (!decl) continue;
        const property = decl.property.toLowerCase();
        if (!LAYOUT_CLASS_GEOMETRY_PROPERTIES.has(property)) continue;
        properties.add(property);
      }
      if (properties.size === 0) continue;

      for (let j = 0; j < selector.anchor.classes.length; j++) {
        const className = selector.anchor.classes[j];
        if (!className) continue;
        let existing = byClass.get(className);
        if (!existing) {
          existing = new Set<string>();
          byClass.set(className, existing);
        }
        for (const property of properties) existing.add(property);
      }
    }

    for (const [className, properties] of byClass) {
      this.layoutPropertiesByClassToken.set(className, [...properties]);
    }
  }

  private buildFontFamilyUsageByRule(): void {
    const declarations = this.declarationsForProperties(...FONT_LAYOUT_PROPERTIES);

    for (let i = 0; i < declarations.length; i++) {
      const declaration = declarations[i];
      if (!declaration) continue;
      const rule = declaration.rule;
      if (!rule) continue;

      const families = parseFontFamilyList(declaration.value);
      if (families.length === 0) continue;

      for (let j = 0; j < families.length; j++) {
        const family = families[j];
        if (!family) continue;
        this.usedFontFamilies.add(family);
      }

      const existing = this.usedFontFamiliesByRule.get(rule.id);
      if (!existing) {
        this.usedFontFamiliesByRule.set(rule.id, families);
        continue;
      }

      const merged = new Set(existing);
      for (let j = 0; j < families.length; j++) {
        const family = families[j];
        if (!family) continue;
        merged.add(family);
      }
      this.usedFontFamiliesByRule.set(rule.id, [...merged]);
    }
  }

  private buildFontFaceDescriptorsByFamily(): void {
    const byFamily = new Map<string, FontFaceDescriptor[]>();

    for (let i = 0; i < this.fontFaces.length; i++) {
      const fontFace = this.fontFaces[i];
      if (!fontFace) continue;
      const familyDeclaration = firstDeclaration(fontFace.declarations, "font-family");
      if (!familyDeclaration) continue;

      const family = normalizeFontFamily(familyDeclaration.value);
      if (!family) continue;

      const displayDeclaration = firstDeclaration(fontFace.declarations, "font-display");
      const srcDeclaration = firstDeclaration(fontFace.declarations, "src");
      const descriptor: FontFaceDescriptor = {
        fontFace,
        family,
        displayDeclaration,
        srcDeclaration,
        display: displayDeclaration ? firstToken(displayDeclaration.value) : null,
        src: srcDeclaration ? srcDeclaration.value : null,
        hasWebFontSource: srcDeclaration ? isWebFontSource(srcDeclaration.value) : false,
        hasEffectiveMetricOverrides: hasEffectiveMetricOverrides(fontFace.declarations),
      };

      const existing = byFamily.get(family);
      if (existing) {
        existing.push(descriptor);
      } else {
        byFamily.set(family, [descriptor]);
      }
    }

    for (const [family, descriptors] of byFamily) {
      this.fontFaceDescriptorsByFamily.set(family, descriptors);
    }
  }

  private buildRuleDerivedIndexes(): void {
    for (let i = 0, len = this.rules.length; i < len; i++) {
      const rule = this.rules[i];
      if (!rule) continue;
      if (rule.depth > 3) this.deepNestedRules.push(rule);
    }
  }

  buildUnusedIndexes(): void {
    for (const v of this.variables) {
      if (!hasFlag(v._flags, VAR_IS_USED)) this.unusedVariables.push(v);
    }
    for (const m of this.mixins) {
      if (!hasFlag(m._flags, MIXIN_IS_USED)) this.unusedMixins.push(m);
    }
    for (const f of this.functions) {
      if (!hasFlag(f._flags, SCSSFN_IS_USED)) this.unusedFunctions.push(f);
    }
    for (const p of this.placeholders) {
      if (!hasFlag(p._flags, PLACEHOLDER_IS_USED)) this.unusedPlaceholders.push(p);
    }
  }
}

function normalizeCssValue(value: string): string {
  return value.trim().toLowerCase();
}

function firstDeclaration<T extends { readonly property: string }>(
  declarations: readonly T[],
  property: string,
): T | null {
  const needle = property.toLowerCase();
  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i];
    if (!decl) continue;
    if (decl.property.toLowerCase() === needle) return decl;
  }
  return null;
}

function parseFontFamilyList(value: string): readonly string[] {
  const out: string[] = [];
  const tokens = splitComma(value);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const family = normalizeFontFamily(token);
    if (!family) continue;
    out.push(family);
  }

  return out;
}

function normalizeFontFamily(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const unquoted = stripQuotes(trimmed);
  if (unquoted.length === 0) return null;

  const normalized = collapseWhitespace(unquoted.toLowerCase());
  if (normalized.length === 0) return null;
  if (FONT_GENERIC_FAMILY_SET.has(normalized)) return null;
  return normalized;
}

function stripQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if (first !== last) return value;
  if (first !== "\"" && first !== "'") return value;
  return value.slice(1, -1).trim();
}

function collapseWhitespace(value: string): string {
  const parts = value.split(WHITESPACE_RE);
  const out: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part.length === 0) continue;
    out.push(part);
  }

  return out.join(" ");
}

function firstToken(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return "";
  const parts = normalized.split(WHITESPACE_RE);
  return parts[0] ?? "";
}

function isWebFontSource(value: string): boolean {
  return value.toLowerCase().includes("url(");
}

function hasEffectiveMetricOverrides(
  declarations: readonly { readonly property: string; readonly value: string }[],
): boolean {
  const sizeAdjust = firstDeclaration(declarations, "size-adjust");
  if (sizeAdjust && isEffectiveFontMetricValue(sizeAdjust.value)) return true;

  const ascentOverride = firstDeclaration(declarations, "ascent-override");
  const descentOverride = firstDeclaration(declarations, "descent-override");
  const lineGapOverride = firstDeclaration(declarations, "line-gap-override");
  if (!ascentOverride || !descentOverride || !lineGapOverride) return false;

  return isEffectiveFontMetricValue(ascentOverride.value)
    && isEffectiveFontMetricValue(descentOverride.value)
    && isEffectiveFontMetricValue(lineGapOverride.value);
}

function isEffectiveFontMetricValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (normalized === "normal") return false;
  if (CSS_WIDE_KEYWORDS.has(normalized)) return false;
  return true;
}
