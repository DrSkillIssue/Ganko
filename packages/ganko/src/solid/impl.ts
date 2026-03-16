/**
 * SolidGraph Implementation
 */
import ts from "typescript";
import type { CommentEntry } from "../diagnostic";
import { extractAllComments } from "../suppression";
import type { SolidInput } from "./input";
import type { ScopeEntity } from "./entities/scope";
import type { VariableEntity } from "./entities/variable";
import type { FunctionEntity } from "./entities/function";
import type { CallEntity, ArgumentEntity } from "./entities/call";
import type { JSXElementEntity, JSXAttributeEntity, JSXContext } from "./entities/jsx";
export type { JSXElementEntity, JSXAttributeEntity } from "./entities/jsx";
import type { ImportEntity } from "./entities/import";
import type { ExportEntity } from "./entities/export";
import type { ClassEntity } from "./entities/class";
import type { PropertyEntity } from "./entities/property";
import type { PropertyAssignmentEntity } from "./entities/property-assignment";
import type { ConditionalSpreadEntity, ObjectSpreadEntity } from "./entities/spread";
import type { NonNullAssertionEntity } from "./entities/non-null-assertion";
import type { TypeAssertionEntity, TypePredicateEntity, UnsafeGenericAssertionEntity, UnsafeTypeAnnotationEntity } from "./entities/type-assertion";
import type { InlineImportEntity } from "./entities/inline-import";
import type { ComputationEntity, DependencyEdge, OwnershipEdge } from "./entities/computation";
import type { FileEntity } from "./entities/file";
import { TypeResolver, createTypeResolver } from "./typescript";
import type { JSXAttributeKind } from "./util/jsx";
import { getPropertyKeyName } from "./util/pattern-detection";
import { getStaticStringFromJSXValue } from "./util/static-value";
import { WHITESPACE_SPLIT, CHAR_NEWLINE } from "@drskillissue/ganko-shared";
import type { Logger } from "@drskillissue/ganko-shared";
import { noopLogger } from "@drskillissue/ganko-shared";

/** @internal */
interface JSXAttributeWithElement {
  readonly attr: JSXAttributeEntity;
  readonly element: JSXElementEntity;
}

interface JSXStaticClassIndex {
  readonly hasDynamicClass: boolean;
  readonly tokens: readonly string[];
}

interface JSXStaticObjectKeyIndex {
  readonly hasDynamic: boolean;
  readonly keys: readonly string[];
}

interface JSXObjectPropertyWithElement {
  readonly property: ts.ObjectLiteralElementLike;
  readonly attr: JSXAttributeEntity;
  readonly element: JSXElementEntity;
}

/**
 * The Solid.js program graph implementation.
 *
 * Contains all entities extracted from a Solid.js source file:
 * scopes, variables, functions, calls, JSX elements, imports, exports, etc.
 *
 */
export class SolidGraph {
  readonly kind = "solid" as const;
  readonly file: string;
  readonly logger: Logger;

  readonly sourceFile: ts.SourceFile;
  readonly comments: readonly CommentEntry[];
  readonly typeResolver: TypeResolver;
  readonly fileEntity: FileEntity;

  private _nextScopeId = 0;
  private _nextVariableId = 0;
  private _nextFunctionId = 0;
  private _nextCallId = 0;
  private _nextJsxId = 0;
  private _nextImportId = 0;
  private _nextExportId = 0;
  private _nextClassId = 0;
  private _nextPropertyId = 0;
  private _nextConditionalSpreadId = 0;
  private _nextMiscId = 0;

  readonly scopes: ScopeEntity[] = [];
  readonly variables: VariableEntity[] = [];
  readonly functions: FunctionEntity[] = [];
  readonly calls: CallEntity[] = [];
  readonly jsxElements: JSXElementEntity[] = [];
  readonly imports: ImportEntity[] = [];
  readonly exports: ExportEntity[] = [];
  readonly classes: ClassEntity[] = [];
  readonly properties: PropertyEntity[] = [];
  readonly propertyAssignments: PropertyAssignmentEntity[] = [];
  readonly conditionalSpreads: ConditionalSpreadEntity[] = [];
  readonly objectSpreads: ObjectSpreadEntity[] = [];
  readonly nonNullAssertions: NonNullAssertionEntity[] = [];
  readonly typeAssertions: TypeAssertionEntity[] = [];
  readonly typePredicates: TypePredicateEntity[] = [];
  readonly unsafeGenericAssertions: UnsafeGenericAssertionEntity[] = [];
  readonly unsafeTypeAnnotations: UnsafeTypeAnnotationEntity[] = [];
  readonly inlineImports: InlineImportEntity[] = [];

  readonly variablesByName = new Map<string, VariableEntity[]>();
  readonly functionsByNode = new Map<ts.Node, FunctionEntity>();
  readonly functionsByDeclarationNode = new Map<ts.Node, FunctionEntity>();
  readonly functionsByName = new Map<string, FunctionEntity[]>();
  readonly callsByNode = new Map<ts.CallExpression | ts.NewExpression, CallEntity>();
  readonly callsByPrimitive = new Map<string, CallEntity[]>();
  readonly callsByMethodName = new Map<string, CallEntity[]>();
  readonly callsByArgNode = new Map<ts.Node, ArgumentEntity>();
  readonly jsxByNode = new Map<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment, JSXElementEntity>();
  readonly jsxByTag = new Map<string, JSXElementEntity[]>();
  readonly jsxAttributesByElementId = new Map<number, ReadonlyMap<string, JSXAttributeEntity>>();
  readonly jsxAttrsByKind = new Map<JSXAttributeKind, JSXAttributeWithElement[]>();
  readonly jsxClassAttributes: JSXAttributeWithElement[] = [];
  readonly jsxClassListAttributes: JSXAttributeWithElement[] = [];
  readonly jsxStyleAttributes: JSXAttributeWithElement[] = [];
  readonly fillImageElements: JSXElementEntity[] = [];
  readonly staticClassTokensByElementId = new Map<number, JSXStaticClassIndex>();
  readonly staticClassListKeysByElementId = new Map<number, JSXStaticObjectKeyIndex>();
  readonly staticStyleKeysByElementId = new Map<number, JSXStaticObjectKeyIndex>();
  readonly classListProperties: JSXObjectPropertyWithElement[] = [];
  readonly styleProperties: JSXObjectPropertyWithElement[] = [];
  /** CSS class names defined in inline `<style>` elements within JSX (e.g., SVG icons with embedded CSS). */
  readonly inlineStyleClassNames = new Set<string>();
  readonly importsBySource = new Map<string, ImportEntity[]>();
  readonly exportsByName = new Map<string, ExportEntity>();
  readonly exportsByEntityId = new Map<number, ExportEntity>();
  readonly classesByNode = new Map<ts.ClassDeclaration | ts.ClassExpression, ClassEntity>();
  readonly classesByName = new Map<string, ClassEntity[]>();

  // AST node indexes (built by entities phase)
  readonly unaryExpressionsByOperator = new Map<ts.SyntaxKind, ts.PrefixUnaryExpression[]>();
  readonly spreadElements: (ts.SpreadElement | ts.SpreadAssignment)[] = [];
  readonly newExpressionsByCallee = new Map<string, ts.NewExpression[]>();
  readonly deleteExpressions: ts.DeleteExpression[] = [];
  readonly identifiersByName = new Map<string, ts.Identifier[]>();

  // Position index for O(1) node lookup (built by entities phase)
  readonly positionIndex: PositionIndex;

  firstScope: ScopeEntity | null = null;
  readonly componentScopes = new Map<ScopeEntity, { scope: ScopeEntity; name: string }>();
  componentFunctions: FunctionEntity[] = [];
  functionsWithReactiveCaptures: FunctionEntity[] = [];
  reactiveVariables: VariableEntity[] = [];
  propsVariables: VariableEntity[] = [];
  storeVariables: VariableEntity[] = [];
  resourceVariables: VariableEntity[] = [];
  variablesWithPropertyAssignment: VariableEntity[] = [];

  /** Reactive computation nodes (effects, memos, computed, roots, resources). */
  computations: ComputationEntity[] = [];
  /** Computation lookup by CallEntity ID. */
  readonly computationByCallId = new Map<number, ComputationEntity>();
  /** Dependency edges: computation reads reactive source. */
  dependencyEdges: DependencyEdge[] = [];
  /** Ownership edges: parent owns child computation. */
  ownershipEdges: OwnershipEdge[] = [];

  readonly jsxContextCache = new WeakMap<ts.Node, JSXContext | null>();
  readonly scopeForCache = new WeakMap<ts.Node, ScopeEntity>();
  readonly onDepsCache = new WeakMap<ts.Node, boolean>();
  readonly passthroughCache = new WeakMap<ts.Node, boolean>();

  /**
   * Creates a new SolidGraph instance.
   *
   * @param input - The graph input containing source code and parser services
   */
  constructor(input: SolidInput) {
    this.file = input.file;
    this.logger = input.logger ?? noopLogger;
    this.sourceFile = input.sourceFile;

    this.typeResolver = createTypeResolver(input.checker, this.logger);

    this.fileEntity = {
      id: 0,
      path: input.file,
      sourceFile: input.sourceFile,
      functions: this.functions,
      calls: this.calls,
      variables: this.variables,
      scopes: this.scopes,
      jsxElements: this.jsxElements,
      imports: this.imports,
      conditionalSpreads: this.conditionalSpreads,
    };

    const text = input.sourceFile.text;
    this.positionIndex = {
      nodeAtOffset: new Array<ts.Node | null>(text.length).fill(null),
      lineStartOffsets: computeLineStarts(text),
    };

    this.comments = extractAllComments(input.sourceFile);
  }

  /** @internal Generate next scope ID */
  nextScopeId(): number { return this._nextScopeId++; }
  /** @internal Generate next variable ID */
  nextVariableId(): number { return this._nextVariableId++; }
  /** @internal Generate next function ID */
  nextFunctionId(): number { return this._nextFunctionId++; }
  /** @internal Generate next call ID */
  nextCallId(): number { return this._nextCallId++; }
  /** @internal Generate next JSX element ID */
  nextJsxId(): number { return this._nextJsxId++; }
  /** @internal Generate next import ID */
  nextImportId(): number { return this._nextImportId++; }
  /** @internal Generate next export ID */
  nextExportId(): number { return this._nextExportId++; }
  /** @internal Generate next class ID */
  nextClassId(): number { return this._nextClassId++; }
  /** @internal Generate next property ID */
  nextPropertyId(): number { return this._nextPropertyId++; }
  /** @internal Generate next conditional spread ID */
  nextConditionalSpreadId(): number { return this._nextConditionalSpreadId++; }
  /** @internal Generate next misc entity ID */
  nextMiscId(): number { return this._nextMiscId++; }

  /**
   * @internal Add a scope entity to the graph. Called by scopesPhase.
   */
  addScope(scope: ScopeEntity): void {
    this.scopes.push(scope);
    if (this.firstScope === null) {
      this.firstScope = scope;
    }
  }

  /**
   * @internal Add a variable entity to the graph. Called by scopesPhase.
   */
  addVariable(variable: VariableEntity): void {
    this.variables.push(variable);
    const name = variable.name;
    const existing = this.variablesByName.get(name);
    if (existing) existing.push(variable);
    else this.variablesByName.set(name, [variable]);
  }

  /**
   * @internal Add a function entity to the graph. Called by entitiesPhase.
   */
  addFunction(fn: FunctionEntity): void {
    this.functions.push(fn);
    this.functionsByNode.set(fn.node, fn);
    this.functionsByDeclarationNode.set(fn.declarationNode, fn);
    if (fn.name) {
      const existing = this.functionsByName.get(fn.name);
      if (existing) existing.push(fn);
      else this.functionsByName.set(fn.name, [fn]);
    }
  }

  /**
   * @internal Add a call entity to the graph. Called by entitiesPhase.
   */
  addCall(call: CallEntity): void {
    this.calls.push(call);
    this.callsByNode.set(call.node, call);

    const primitiveName = call.primitive?.name;
    if (primitiveName) {
      const existing = this.callsByPrimitive.get(primitiveName);
      if (existing) existing.push(call);
      else this.callsByPrimitive.set(primitiveName, [call]);
    }

    const methodName = getMethodName(call.callee);
    if (methodName) {
      const existing = this.callsByMethodName.get(methodName);
      if (existing) existing.push(call);
      else this.callsByMethodName.set(methodName, [call]);
    }

    const args = call.arguments;
    for (let i = 0, len = args.length; i < len; i++) {
      const arg = args[i];
      if (!arg) continue;
      this.callsByArgNode.set(arg.node, arg);
    }
  }

  /**
   * @internal Add a JSX element entity to the graph. Called by entitiesPhase.
   */
  addJSXElement(element: JSXElementEntity): void {
    this.jsxElements.push(element);
    this.jsxByNode.set(element.node, element);
    if (element.tag) {
      const existing = this.jsxByTag.get(element.tag);
      if (existing) existing.push(element);
      else this.jsxByTag.set(element.tag, [element]);
    }
    const attrs = element.attributes;
    const attrsByName = new Map<string, JSXAttributeEntity>();
    for (let i = 0, len = attrs.length; i < len; i++) {
      const attr = attrs[i];
      if (!attr) continue;
      if (attr.name) attrsByName.set(attr.name.toLowerCase(), attr);
      if (attr.kind) {
        const existing = this.jsxAttrsByKind.get(attr.kind);
        const entry: JSXAttributeWithElement = { attr, element };
        if (existing) existing.push(entry);
        else this.jsxAttrsByKind.set(attr.kind, [entry]);

        if (attr.kind === "class") {
          this.jsxClassAttributes.push(entry);
          this.staticClassTokensByElementId.set(element.id, parseStaticClassTokens(attr.valueNode));
        }

        if (attr.kind === "classList") {
          this.indexObjectAttribute(entry, element, attr, this.jsxClassListAttributes, this.staticClassListKeysByElementId, this.classListProperties);
        }

        if (attr.kind === "style") {
          this.indexObjectAttribute(entry, element, attr, this.jsxStyleAttributes, this.staticStyleKeysByElementId, this.styleProperties);
        }
      }
    }

    this.jsxAttributesByElementId.set(element.id, attrsByName);
    if (isFillImageElement(element, attrsByName)) {
      this.fillImageElements.push(element);
    }

    // Extract CSS class names from inline <style> elements (e.g., SVG icons with embedded CSS)
    if (element.tagName === "style") {
      this.extractInlineStyleClassNames(element);
    }
  }

  /**
   * Extract CSS class names from inline `<style>` JSX elements.
   *
   * Handles patterns like `<style>{`.foo { ... }`}</style>` found in SVG icons.
   * Scans template literal and literal string children for `.className` patterns.
   */
  private extractInlineStyleClassNames(element: JSXElementEntity): void {
    const astNode = element.node;
    if (!ts.isJsxElement(astNode)) return;
    const astChildren = astNode.children;
    for (let i = 0, len = astChildren.length; i < len; i++) {
      const child = astChildren[i];
      if (!child) continue;
      let cssText: string | null = null;
      if (ts.isJsxExpression(child)) {
        const expr = child.expression;
        if (expr) {
          if (ts.isNoSubstitutionTemplateLiteral(expr)) {
            cssText = expr.text;
          } else if (ts.isTemplateExpression(expr)) {
            // Template expressions with substitutions are dynamic; skip
          } else if (ts.isStringLiteral(expr)) {
            cssText = expr.text;
          }
        }
      } else if (ts.isJsxText(child)) {
        cssText = child.text;
      }
      if (cssText === null) continue;
      // Extract class selectors: `.className` patterns
      const classPattern = /\.([a-zA-Z_][\w-]*)/g;
      let match: RegExpExecArray | null;
      while ((match = classPattern.exec(cssText)) !== null) {
        const className = match[1];
        if (className) {
          this.inlineStyleClassNames.add(className);
        }
      }
    }
  }

  private indexObjectAttribute(
    entry: JSXAttributeWithElement,
    element: JSXElementEntity,
    attr: JSXAttributeEntity,
    attrArray: JSXAttributeWithElement[],
    keyIndex: Map<number, JSXStaticObjectKeyIndex>,
    propertiesArray: JSXObjectPropertyWithElement[],
  ): void {
    attrArray.push(entry);
    const parsed = parseStaticObject(attr.valueNode);
    keyIndex.set(element.id, { hasDynamic: parsed.hasDynamic, keys: parsed.keys });
    for (let j = 0; j < parsed.properties.length; j++) {
      const property = parsed.properties[j];
      if (!property) continue;
      propertiesArray.push({ property, attr, element });
    }
  }

  /**
   * @internal Add an import entity to the graph. Called by entitiesPhase.
   */
  addImport(imp: ImportEntity): void {
    this.imports.push(imp);
    const existing = this.importsBySource.get(imp.source);
    if (existing) existing.push(imp);
    else this.importsBySource.set(imp.source, [imp]);
  }

  /**
   * @internal Add an export entity to the graph. Called by exportsPhase.
   */
  addExport(exp: ExportEntity): void {
    this.exports.push(exp);
    this.exportsByName.set(exp.name, exp);
    if (exp.entityId !== -1) {
      this.exportsByEntityId.set(exp.entityId, exp);
    }
  }

  /** @internal Add a class entity to the graph. Called by entitiesPhase. */
  addClass(cls: ClassEntity): void {
    this.classes.push(cls);
    this.classesByNode.set(cls.node, cls);
    if (cls.name) {
      const existing = this.classesByName.get(cls.name);
      if (existing) existing.push(cls);
      else this.classesByName.set(cls.name, [cls]);
    }
  }

  /** @internal Add a property entity to the graph. */
  addProperty(prop: PropertyEntity): void {
    this.properties.push(prop);
  }

  /** @internal Add a property assignment entity to the graph. */
  addPropertyAssignment(pa: PropertyAssignmentEntity): void {
    this.propertyAssignments.push(pa);
  }

  /** @internal Add a conditional spread entity to the graph. */
  addConditionalSpread(spread: ConditionalSpreadEntity): void {
    this.conditionalSpreads.push(spread);
  }

  /** @internal Add an object spread entity to the graph. */
  addObjectSpread(spread: ObjectSpreadEntity): void {
    this.objectSpreads.push(spread);
  }

  /** @internal Add a non-null assertion entity to the graph. */
  addNonNullAssertion(assertion: NonNullAssertionEntity): void {
    this.nonNullAssertions.push(assertion);
  }

  /** @internal Add a type assertion entity to the graph. */
  addTypeAssertion(assertion: TypeAssertionEntity): void {
    this.typeAssertions.push(assertion);
  }

  /** @internal Add a type predicate entity to the graph. */
  addTypePredicate(predicate: TypePredicateEntity): void {
    this.typePredicates.push(predicate);
  }

  /** @internal Add an unsafe generic assertion entity to the graph. */
  addUnsafeGenericAssertion(assertion: UnsafeGenericAssertionEntity): void {
    this.unsafeGenericAssertions.push(assertion);
  }

  /** @internal Add an unsafe type annotation entity to the graph. */
  addUnsafeTypeAnnotation(annotation: UnsafeTypeAnnotationEntity): void {
    this.unsafeTypeAnnotations.push(annotation);
  }

  /** @internal Add an inline import entity to the graph. */
  addInlineImport(imp: InlineImportEntity): void {
    this.inlineImports.push(imp);
  }

  /** @internal Add a computation entity to the graph. Called by dependenciesPhase. */
  addComputation(computation: ComputationEntity): void {
    this.computations.push(computation);
    this.computationByCallId.set(computation.call.id, computation);
  }

  /** @internal Add a dependency edge to the graph. Called by dependenciesPhase. */
  addDependencyEdge(edge: DependencyEdge): void {
    this.dependencyEdges.push(edge);
  }

  /** @internal Add an ownership edge to the graph. Called by dependenciesPhase. */
  addOwnershipEdge(edge: OwnershipEdge): void {
    this.ownershipEdges.push(edge);
  }

  /**
   * @internal Build reactive variable indexes. Called by reactivityPhase.
   */
  buildReactiveIndex(): void {
    const reactive: VariableEntity[] = [];
    const props: VariableEntity[] = [];
    const stores: VariableEntity[] = [];
    const resources: VariableEntity[] = [];
    const withPropertyAssignment: VariableEntity[] = [];

    const variables = this.variables;
    for (let i = 0, len = variables.length; i < len; i++) {
      const v = variables[i];
      if (!v) continue;

      // Reactive variable categorization
      if (v.isReactive) {
        reactive.push(v);
        const kind = v.reactiveKind;
        if (kind === "props") props.push(v);
        else if (kind === "store") stores.push(v);
        else if (kind === "resource") resources.push(v);
      }

      // Variables whose initializer is a property access (e.g., const x = obj.prop)
      const init = v.initializer;
      if (init && (ts.isPropertyAccessExpression(init) || ts.isElementAccessExpression(init))) {
        withPropertyAssignment.push(v);
      }
    }

    this.reactiveVariables = reactive;
    this.propsVariables = props;
    this.storeVariables = stores;
    this.resourceVariables = resources;
    this.variablesWithPropertyAssignment = withPropertyAssignment;
  }

  // Internal helpers for AST node collection
  /** @internal */
  addUnaryExpression(node: ts.PrefixUnaryExpression): void {
    const op = node.operator;
    const existing = this.unaryExpressionsByOperator.get(op);
    if (existing) existing.push(node);
    else this.unaryExpressionsByOperator.set(op, [node]);
  }

  /** @internal */
  addDeleteExpression(node: ts.DeleteExpression): void {
    this.deleteExpressions.push(node);
  }

  /** @internal */
  addSpreadElement(node: ts.SpreadElement | ts.SpreadAssignment): void {
    this.spreadElements.push(node);
  }

  /** @internal */
  addNewExpressionByCallee(name: string, node: ts.NewExpression): void {
    const existing = this.newExpressionsByCallee.get(name);
    if (existing) existing.push(node);
    else this.newExpressionsByCallee.set(name, [node]);
  }

  /** @internal */
  addIdentifierReference(node: ts.Identifier): void {
    const name = node.text;
    const existing = this.identifiersByName.get(name);
    if (existing) existing.push(node);
    else this.identifiersByName.set(name, [node]);
  }

  /** @internal Index node for O(1) position lookup. Children overwrite parents. */
  addToPositionIndex(node: ts.Node): void {
    const start = node.getStart(this.sourceFile);
    const end = node.end;
    const arr = this.positionIndex.nodeAtOffset;
    for (let i = start; i < end; i++) {
      arr[i] = node;
    }
  }
}

/**
 * Extracts method name from callee expression.
 */
function getMethodName(callee: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
    return callee.name.text;
  }
  return null;
}

/**
 * O(1) position lookup index.
 * - nodeAtOffset[i] = smallest node containing character offset i
 * - lineStartOffsets[i] = character offset where line (i+1) starts
 */
interface PositionIndex {
  readonly nodeAtOffset: Array<ts.Node | null>;
  readonly lineStartOffsets: readonly number[];
}

const FILL_COMPONENT_NAMES = new Set(["image", "nextimage", "next.image"]);

/**
 * Computes line start offsets for O(1) line-to-offset conversion.
 * Line 1 starts at offset 0. Each \n starts a new line.
 */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  const len = text.length;
  for (let i = 0; i < len; i++) {
    if (text.charCodeAt(i) === CHAR_NEWLINE) starts.push(i + 1);
  }
  return starts;
}

function parseStaticClassTokens(node: ts.Node | null): JSXStaticClassIndex {
  if (!node) return { hasDynamicClass: true, tokens: [] };

  const text = getStaticStringFromJSXValue(node);
  if (text === null) return { hasDynamicClass: true, tokens: [] };

  const tokens: string[] = [];
  const parts = text.split(WHITESPACE_SPLIT);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const token = part.trim();
    if (token.length > 0) tokens.push(token);
  }

  return { hasDynamicClass: false, tokens };
}

function parseStaticObject(node: ts.Node | null): JSXStaticObjectKeyIndex & { properties: readonly ts.ObjectLiteralElementLike[] } {
  if (!node || !ts.isJsxExpression(node)) {
    return { hasDynamic: true, keys: [], properties: [] };
  }

  const expression = node.expression;
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    return { hasDynamic: true, keys: [], properties: [] };
  }

  const keys: string[] = [];
  const properties: ts.ObjectLiteralElementLike[] = [];
  let hasDynamic = false;

  for (let i = 0; i < expression.properties.length; i++) {
    const property = expression.properties[i];
    if (!property) continue;
    properties.push(property);
    if (!ts.isPropertyAssignment(property)) {
      hasDynamic = true;
      continue;
    }
    if (property.name && ts.isComputedPropertyName(property.name)) {
      hasDynamic = true;
      continue;
    }

    const name = getPropertyKeyName(property.name);
    if (name !== null) {
      keys.push(name);
      continue;
    }

    hasDynamic = true;
  }

  if (hasDynamic) return { hasDynamic: true, keys, properties };
  return { hasDynamic: false, keys, properties };
}

function isFillImageElement(
  element: JSXElementEntity,
  attrsByName: ReadonlyMap<string, JSXAttributeEntity>,
): boolean {
  if (!element.tagName) return false;
  if (element.isDomElement) return false;

  const normalizedTag = element.tagName.replaceAll("_", "");
  if (!FILL_COMPONENT_NAMES.has(normalizedTag) && !normalizedTag.endsWith(".image") && normalizedTag !== "image") {
    return false;
  }

  const fillAttribute = attrsByName.get("fill");
  if (fillAttribute) return isTruthyFillAttribute(fillAttribute);

  const layoutAttribute = attrsByName.get("layout");
  if (!layoutAttribute || !layoutAttribute.valueNode) return false;
  const value = getStaticStringFromJSXValue(layoutAttribute.valueNode);
  if (!value) return false;
  return value.trim().toLowerCase() === "fill";
}

function isTruthyFillAttribute(attribute: JSXAttributeEntity): boolean {
  if (!attribute.valueNode) return true;

  const value = getStaticStringFromJSXValue(attribute.valueNode);
  if (value === null) return true;

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return true;
}
