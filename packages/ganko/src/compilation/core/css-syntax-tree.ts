import type { Rule, AtRule } from "postcss";
import type { FileEntity } from "../../css/entities/file";
import type { RuleEntity } from "../../css/entities/rule";
import type { SelectorEntity } from "../../css/entities/selector";
import type { DeclarationEntity } from "../../css/entities/declaration";
import type { VariableEntity, VariableReferenceEntity } from "../../css/entities/variable";
import type { AtRuleEntity, AtRuleKind } from "../../css/entities/at-rule";
import type { ThemeTokenEntity } from "../../css/entities/token";
import type { MixinEntity, MixinIncludeEntity, SCSSFunctionEntity, FunctionCallEntity, PlaceholderEntity, ExtendEntity } from "../../css/entities/scss";
import type { CSSParseError } from "../../css/entities/parse-error";
import type { CSSGraph } from "../../css/impl";


export interface CSSSyntaxTree {
  readonly kind: "css";
  readonly filePath: string;
  readonly version: string;
  readonly isScss: boolean;

  readonly file: FileEntity;
  readonly rules: readonly RuleEntity[];
  readonly selectors: readonly SelectorEntity[];
  readonly declarations: readonly DeclarationEntity[];
  readonly variables: readonly VariableEntity[];
  readonly variableRefs: readonly VariableReferenceEntity[];
  readonly atRules: readonly AtRuleEntity[];
  readonly tokens: readonly ThemeTokenEntity[];
  readonly mixins: readonly MixinEntity[];
  readonly includes: readonly MixinIncludeEntity[];
  readonly functions: readonly SCSSFunctionEntity[];
  readonly functionCalls: readonly FunctionCallEntity[];
  readonly placeholders: readonly PlaceholderEntity[];
  readonly extends: readonly ExtendEntity[];
  readonly parseErrors: readonly CSSParseError[];

  readonly unresolvedRefs: readonly VariableReferenceEntity[];
  readonly unresolvedMixinIncludes: readonly MixinIncludeEntity[];
  readonly unresolvedExtends: readonly ExtendEntity[];

  readonly rulesBySelector: ReadonlyMap<string, readonly RuleEntity[]>;
  readonly rulesByNode: ReadonlyMap<Rule, RuleEntity>;
  readonly variablesByName: ReadonlyMap<string, readonly VariableEntity[]>;
  readonly declarationsByProperty: ReadonlyMap<string, readonly DeclarationEntity[]>;
  readonly atRulesByName: ReadonlyMap<string, readonly AtRuleEntity[]>;
  readonly atRulesByKind: ReadonlyMap<AtRuleKind, readonly AtRuleEntity[]>;
  readonly atRulesByNode: ReadonlyMap<AtRule, AtRuleEntity>;
  readonly classNameIndex: ReadonlyMap<string, readonly SelectorEntity[]>;
  readonly selectorsBySubjectTag: ReadonlyMap<string, readonly SelectorEntity[]>;
  readonly selectorsByPseudoClass: ReadonlyMap<string, readonly SelectorEntity[]>;
  readonly selectorsWithoutSubjectTag: readonly SelectorEntity[];

  readonly filesByPath: ReadonlyMap<string, FileEntity>;

  readonly sourceOrderBase: number;
}

function collectSelectorsFromRules(rules: readonly RuleEntity[]): SelectorEntity[] {
  const out: SelectorEntity[] = [];
  for (const rule of rules) {
    const sels = rule.selectors;
    for (const sel of sels) out.push(sel);
  }
  return out;
}

function collectDeclarationsFromRules(rules: readonly RuleEntity[]): DeclarationEntity[] {
  const out: DeclarationEntity[] = [];
  for (const rule of rules) {
    const decls = rule.declarations;
    for (const decl of decls) out.push(decl);
  }
  return out;
}

function pushToMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr !== undefined) arr.push(value);
  else map.set(key, [value]);
}

function buildTree(
  file: FileEntity,
  fileIndex: number,
  graph: CSSGraph,
): CSSSyntaxTree {
  const rules = file.rules;
  const atRules = file.atRules;
  const variables = file.variables;
  const selectors = collectSelectorsFromRules(rules);

  const ruleDeclarations = collectDeclarationsFromRules(rules);
  const standaloneDeclarations: DeclarationEntity[] = [];
  for (const d of graph.declarations) {
    if (d.file === file && d.rule === null) standaloneDeclarations.push(d);
  }
  let declarations: DeclarationEntity[];
  if (standaloneDeclarations.length === 0) {
    declarations = ruleDeclarations;
  } else {
    declarations = ruleDeclarations.concat(standaloneDeclarations);
  }

  const variableRefs: VariableReferenceEntity[] = [];
  for (const vr of graph.variableRefs) {
    if (vr.file === file) variableRefs.push(vr);
  }

  const tokens: ThemeTokenEntity[] = [];
  for (const t of graph.tokens) {
    if (t.file === file) tokens.push(t);
  }

  const mixins: MixinEntity[] = [];
  for (const m of graph.mixins) {
    if (m.file === file) mixins.push(m);
  }

  const includes: MixinIncludeEntity[] = [];
  for (const inc of graph.includes) {
    if (inc.file === file) includes.push(inc);
  }

  const functions: SCSSFunctionEntity[] = [];
  for (const fn of graph.functions) {
    if (fn.file === file) functions.push(fn);
  }

  const functionCalls: FunctionCallEntity[] = [];
  for (const fc of graph.functionCalls) {
    if (fc.file === file) functionCalls.push(fc);
  }

  const placeholders: PlaceholderEntity[] = [];
  for (const ph of graph.placeholders) {
    if (ph.file === file) placeholders.push(ph);
  }

  const extendsArr: ExtendEntity[] = [];
  for (const ext of graph.extends) {
    if (ext.file === file) extendsArr.push(ext);
  }

  const filePath = file.path;

  const parseErrors: CSSParseError[] = [];
  for (const pe of graph.parseErrors) {
    if (pe.file === filePath) parseErrors.push(pe);
  }

  const unresolvedRefsArr: VariableReferenceEntity[] = [];
  for (const ref of graph.unresolvedRefs) {
    if (ref.file === file) unresolvedRefsArr.push(ref);
  }

  const unresolvedMixinIncludesArr: MixinIncludeEntity[] = [];
  for (const inc of graph.unresolvedMixinIncludes) {
    if (inc.file === file) unresolvedMixinIncludesArr.push(inc);
  }

  const unresolvedExtendsArr: ExtendEntity[] = [];
  for (const ext of graph.unresolvedExtends) {
    if (ext.file === file) unresolvedExtendsArr.push(ext);
  }

  // --- Build per-file indexes ---

  const rulesBySelectorMap = new Map<string, RuleEntity[]>();
  const rulesByNodeMap = new Map<Rule, RuleEntity>();
  for (const r of rules) {
    pushToMapArray(rulesBySelectorMap, r.selectorText, r);
    rulesByNodeMap.set(r.node, r);
  }

  const variablesByNameMap = new Map<string, VariableEntity[]>();
  for (const v of variables) {
    pushToMapArray(variablesByNameMap, v.name, v);
  }

  const declarationsByPropertyMap = new Map<string, DeclarationEntity[]>();
  for (const d of declarations) {
    pushToMapArray(declarationsByPropertyMap, d.property, d);
  }

  const atRulesByNameMap = new Map<string, AtRuleEntity[]>();
  const atRulesByKindMap = new Map<AtRuleKind, AtRuleEntity[]>();
  const atRulesByNodeMap = new Map<AtRule, AtRuleEntity>();
  for (const ar of atRules) {
    pushToMapArray(atRulesByNameMap, ar.name, ar);
    pushToMapArray(atRulesByKindMap, ar.kind, ar);
    atRulesByNodeMap.set(ar.node, ar);
  }

  const classNameIndexMap = new Map<string, SelectorEntity[]>();
  const selectorsBySubjectTagMap = new Map<string, SelectorEntity[]>();
  const selectorsByPseudoClassMap = new Map<string, SelectorEntity[]>();
  const selectorsWithoutSubjectTagArr: SelectorEntity[] = [];

  for (const sel of selectors) {
    for (const compound of sel.compounds) {
      for (const cls of compound.classes) {
        pushToMapArray(classNameIndexMap, cls, sel);
      }
    }

    const subjectTag = sel.anchor.subjectTag;
    if (subjectTag !== null) {
      pushToMapArray(selectorsBySubjectTagMap, subjectTag, sel);
    } else {
      selectorsWithoutSubjectTagArr.push(sel);
    }

    for (const pc of sel.complexity.pseudoClasses) {
      pushToMapArray(selectorsByPseudoClassMap, pc, sel);
    }
  }

  return {
    kind: "css",
    filePath,
    version: String(file.id),
    isScss: file.syntax === "scss" || file.syntax === "sass",
    file,
    rules,
    selectors,
    declarations,
    variables,
    variableRefs,
    atRules,
    tokens,
    mixins,
    includes,
    functions,
    functionCalls,
    placeholders,
    extends: extendsArr,
    parseErrors,
    unresolvedRefs: unresolvedRefsArr,
    unresolvedMixinIncludes: unresolvedMixinIncludesArr,
    unresolvedExtends: unresolvedExtendsArr,
    rulesBySelector: rulesBySelectorMap,
    rulesByNode: rulesByNodeMap,
    variablesByName: variablesByNameMap,
    declarationsByProperty: declarationsByPropertyMap,
    atRulesByName: atRulesByNameMap,
    atRulesByKind: atRulesByKindMap,
    atRulesByNode: atRulesByNodeMap,
    classNameIndex: classNameIndexMap,
    selectorsBySubjectTag: selectorsBySubjectTagMap,
    selectorsByPseudoClass: selectorsByPseudoClassMap,
    selectorsWithoutSubjectTag: selectorsWithoutSubjectTagArr,
    filesByPath: new Map([[file.path, file]]),
    sourceOrderBase: fileIndex * 10000,
  };
}

export function cssGraphToSyntaxTrees(graph: CSSGraph): readonly CSSSyntaxTree[] {
  const files = graph.files;
  const trees: CSSSyntaxTree[] = [];
  for (let i = 0; i < files.length; i++) {
    trees.push(buildTree(files[i]!, i, graph));
  }
  return trees;
}
