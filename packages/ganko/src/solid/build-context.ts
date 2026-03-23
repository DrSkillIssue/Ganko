/**
 * SolidBuildContext — mutable accumulator for solid analysis phases.
 *
 * Replaces the SolidGraph class. Phases call add* methods to populate entities.
 * After all phases complete, the context is frozen into a SolidSyntaxTree.
 */
import ts from "typescript"
import type { CommentEntry } from "../diagnostic"
import { extractAllComments } from "../suppression"
import type { SolidInput } from "./input"
import type { ScopeEntity } from "./entities/scope"
import type { VariableEntity } from "./entities/variable"
import type { FunctionEntity } from "./entities/function"
import type { CallEntity, ArgumentEntity } from "./entities/call"
import type { JSXElementEntity, JSXAttributeEntity, JSXContext } from "./entities/jsx"
import type { ImportEntity } from "./entities/import"
import type { ExportEntity } from "./entities/export"
import type { ClassEntity } from "./entities/class"
import type { PropertyEntity } from "./entities/property"
import type { PropertyAssignmentEntity } from "./entities/property-assignment"
import type { ConditionalSpreadEntity, ObjectSpreadEntity } from "./entities/spread"
import type { NonNullAssertionEntity } from "./entities/non-null-assertion"
import type { TypeAssertionEntity, TypePredicateEntity, UnsafeGenericAssertionEntity, UnsafeTypeAnnotationEntity } from "./entities/type-assertion"
import type { InlineImportEntity } from "./entities/inline-import"
import type { ComputationEntity, DependencyEdge, OwnershipEdge } from "./entities/computation"
import type { FileEntity } from "./entities/file"
import { type TypeResolver, createTypeResolver } from "./typescript"
import type { JSXAttributeKind } from "./util/jsx"
import { getPropertyKeyName } from "./util/pattern-detection"
import { getStaticStringFromJSXValue } from "./util/static-value"
import { WHITESPACE_SPLIT, CHAR_NEWLINE } from "@drskillissue/ganko-shared"
import type { Logger } from "@drskillissue/ganko-shared"
import { noopLogger } from "@drskillissue/ganko-shared"

// ── Supporting types (shared with SolidSyntaxTree) ────────────────────────

export interface JSXAttributeWithElement {
  readonly attr: JSXAttributeEntity
  readonly element: JSXElementEntity
}

export interface JSXStaticClassIndex {
  readonly hasDynamicClass: boolean
  readonly tokens: readonly string[]
}

export interface JSXStaticObjectKeyIndex {
  readonly hasDynamic: boolean
  readonly keys: readonly string[]
}

export interface JSXObjectPropertyWithElement {
  readonly property: ts.ObjectLiteralElementLike
  readonly attr: JSXAttributeEntity
  readonly element: JSXElementEntity
}

// ── SolidBuildContext ──────────────────────────────────────────────────────

export interface SolidBuildContext {
  // SolidSyntaxTree structural compatibility
  readonly kind: "solid"
  readonly filePath: string
  readonly version: string

  // Identity
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly typeResolver: TypeResolver
  readonly logger: Logger
  readonly fileEntity: FileEntity
  readonly comments: readonly CommentEntry[]

  // Entity arrays
  readonly scopes: ScopeEntity[]
  readonly variables: VariableEntity[]
  readonly functions: FunctionEntity[]
  readonly calls: CallEntity[]
  readonly jsxElements: JSXElementEntity[]
  readonly imports: ImportEntity[]
  readonly exports: ExportEntity[]
  readonly classes: ClassEntity[]
  readonly properties: PropertyEntity[]
  readonly propertyAssignments: PropertyAssignmentEntity[]
  readonly conditionalSpreads: ConditionalSpreadEntity[]
  readonly objectSpreads: ObjectSpreadEntity[]
  readonly nonNullAssertions: NonNullAssertionEntity[]
  readonly typeAssertions: TypeAssertionEntity[]
  readonly typePredicates: TypePredicateEntity[]
  readonly unsafeGenericAssertions: UnsafeGenericAssertionEntity[]
  readonly unsafeTypeAnnotations: UnsafeTypeAnnotationEntity[]
  readonly inlineImports: InlineImportEntity[]

  // Index maps
  readonly variablesByName: Map<string, VariableEntity[]>
  readonly functionsByNode: Map<ts.Node, FunctionEntity>
  readonly functionsByDeclarationNode: Map<ts.Node, FunctionEntity>
  readonly functionsByName: Map<string, FunctionEntity[]>
  readonly callsByNode: Map<ts.CallExpression | ts.NewExpression, CallEntity>
  readonly callsByPrimitive: Map<string, CallEntity[]>
  readonly callsByMethodName: Map<string, CallEntity[]>
  readonly callsByArgNode: Map<ts.Node, ArgumentEntity>
  readonly jsxByNode: Map<ts.Node, JSXElementEntity>
  readonly jsxByTag: Map<string, JSXElementEntity[]>
  readonly jsxAttributesByElementId: Map<number, ReadonlyMap<string, JSXAttributeEntity>>
  readonly jsxAttrsByKind: Map<JSXAttributeKind, JSXAttributeWithElement[]>
  readonly jsxClassAttributes: JSXAttributeWithElement[]
  readonly jsxClassListAttributes: JSXAttributeWithElement[]
  readonly jsxStyleAttributes: JSXAttributeWithElement[]
  readonly fillImageElements: JSXElementEntity[]
  readonly staticClassTokensByElementId: Map<number, JSXStaticClassIndex>
  readonly staticClassListKeysByElementId: Map<number, JSXStaticObjectKeyIndex>
  readonly staticStyleKeysByElementId: Map<number, JSXStaticObjectKeyIndex>
  readonly classListProperties: JSXObjectPropertyWithElement[]
  readonly styleProperties: JSXObjectPropertyWithElement[]
  readonly inlineStyleClassNames: Set<string>
  readonly importsBySource: Map<string, ImportEntity[]>
  readonly exportsByName: Map<string, ExportEntity>
  readonly exportsByEntityId: Map<number, ExportEntity>
  readonly classesByNode: Map<ts.ClassDeclaration | ts.ClassExpression, ClassEntity>
  readonly classesByName: Map<string, ClassEntity[]>

  // AST node indexes
  readonly unaryExpressionsByOperator: Map<ts.SyntaxKind, ts.PrefixUnaryExpression[]>
  readonly spreadElements: (ts.SpreadElement | ts.SpreadAssignment)[]
  readonly newExpressionsByCallee: Map<string, ts.NewExpression[]>
  readonly deleteExpressions: ts.DeleteExpression[]
  readonly identifiersByName: Map<string, ts.Identifier[]>

  // Derived state (populated by phases)
  firstScope: ScopeEntity | null
  readonly componentScopes: Map<ScopeEntity, { scope: ScopeEntity; name: string }>
  componentFunctions: FunctionEntity[]
  compoundComponentParents: ReadonlyMap<number, number>
  functionsWithReactiveCaptures: FunctionEntity[]
  reactiveVariables: VariableEntity[]
  propsVariables: VariableEntity[]
  storeVariables: VariableEntity[]
  resourceVariables: VariableEntity[]
  variablesWithPropertyAssignment: VariableEntity[]

  // Computation graph
  computations: ComputationEntity[]
  readonly computationByCallId: Map<number, ComputationEntity>
  dependencyEdges: DependencyEdge[]
  ownershipEdges: OwnershipEdge[]

  // Caches
  readonly jsxContextCache: WeakMap<ts.Node, JSXContext | null>
  readonly scopeForCache: WeakMap<ts.Node, ScopeEntity>
  readonly onDepsCache: WeakMap<ts.Node, boolean>
  readonly passthroughCache: WeakMap<ts.Node, boolean>

  // ID generation
  nextScopeId(): number
  nextVariableId(): number
  nextFunctionId(): number
  nextCallId(): number
  nextJsxId(): number
  nextImportId(): number
  nextExportId(): number
  nextClassId(): number
  nextPropertyId(): number
  nextConditionalSpreadId(): number
  nextMiscId(): number

  // Mutation methods
  addScope(scope: ScopeEntity): void
  addVariable(variable: VariableEntity): void
  addFunction(fn: FunctionEntity): void
  addCall(call: CallEntity): void
  addJSXElement(element: JSXElementEntity): void
  addImport(imp: ImportEntity): void
  addExport(exp: ExportEntity): void
  addClass(cls: ClassEntity): void
  addProperty(prop: PropertyEntity): void
  addPropertyAssignment(pa: PropertyAssignmentEntity): void
  addConditionalSpread(spread: ConditionalSpreadEntity): void
  addObjectSpread(spread: ObjectSpreadEntity): void
  addNonNullAssertion(assertion: NonNullAssertionEntity): void
  addTypeAssertion(assertion: TypeAssertionEntity): void
  addTypePredicate(predicate: TypePredicateEntity): void
  addUnsafeGenericAssertion(assertion: UnsafeGenericAssertionEntity): void
  addUnsafeTypeAnnotation(annotation: UnsafeTypeAnnotationEntity): void
  addInlineImport(imp: InlineImportEntity): void
  addComputation(computation: ComputationEntity): void
  addDependencyEdge(edge: DependencyEdge): void
  addOwnershipEdge(edge: OwnershipEdge): void
  buildReactiveIndex(): void

  // AST node collection
  addUnaryExpression(node: ts.PrefixUnaryExpression): void
  addDeleteExpression(node: ts.DeleteExpression): void
  addSpreadElement(node: ts.SpreadElement | ts.SpreadAssignment): void
  addNewExpressionByCallee(name: string, node: ts.NewExpression): void
  addIdentifierReference(node: ts.Identifier): void

  // Lazy computed
  readonly lineStartOffsets: readonly number[]
  findExpressionAtOffset(offset: number): ts.Node | null
}

// ── Factory ───────────────────────────────────────────────────────────────

export function createSolidBuildContext(input: SolidInput): SolidBuildContext {
  const file = input.file
  const logger = input.logger ?? noopLogger
  const sourceFile = input.sourceFile
  const typeResolver = createTypeResolver(input.checker, logger)
  const comments = extractAllComments(sourceFile)

  const scopes: ScopeEntity[] = []
  const variables: VariableEntity[] = []
  const functions: FunctionEntity[] = []
  const calls: CallEntity[] = []
  const jsxElements: JSXElementEntity[] = []
  const imports: ImportEntity[] = []
  const exports: ExportEntity[] = []
  const classes: ClassEntity[] = []
  const properties: PropertyEntity[] = []
  const propertyAssignments: PropertyAssignmentEntity[] = []
  const conditionalSpreads: ConditionalSpreadEntity[] = []
  const objectSpreads: ObjectSpreadEntity[] = []
  const nonNullAssertions: NonNullAssertionEntity[] = []
  const typeAssertions: TypeAssertionEntity[] = []
  const typePredicates: TypePredicateEntity[] = []
  const unsafeGenericAssertions: UnsafeGenericAssertionEntity[] = []
  const unsafeTypeAnnotations: UnsafeTypeAnnotationEntity[] = []
  const inlineImports: InlineImportEntity[] = []

  const variablesByName = new Map<string, VariableEntity[]>()
  const functionsByNode = new Map<ts.Node, FunctionEntity>()
  const functionsByDeclarationNode = new Map<ts.Node, FunctionEntity>()
  const functionsByName = new Map<string, FunctionEntity[]>()
  const callsByNode = new Map<ts.CallExpression | ts.NewExpression, CallEntity>()
  const callsByPrimitive = new Map<string, CallEntity[]>()
  const callsByMethodName = new Map<string, CallEntity[]>()
  const callsByArgNode = new Map<ts.Node, ArgumentEntity>()
  const jsxByNode = new Map<ts.Node, JSXElementEntity>()
  const jsxByTag = new Map<string, JSXElementEntity[]>()
  const jsxAttributesByElementId = new Map<number, ReadonlyMap<string, JSXAttributeEntity>>()
  const jsxAttrsByKind = new Map<JSXAttributeKind, JSXAttributeWithElement[]>()
  const jsxClassAttributes: JSXAttributeWithElement[] = []
  const jsxClassListAttributes: JSXAttributeWithElement[] = []
  const jsxStyleAttributes: JSXAttributeWithElement[] = []
  const fillImageElements: JSXElementEntity[] = []
  const staticClassTokensByElementId = new Map<number, JSXStaticClassIndex>()
  const staticClassListKeysByElementId = new Map<number, JSXStaticObjectKeyIndex>()
  const staticStyleKeysByElementId = new Map<number, JSXStaticObjectKeyIndex>()
  const classListProperties: JSXObjectPropertyWithElement[] = []
  const styleProperties: JSXObjectPropertyWithElement[] = []
  const inlineStyleClassNames = new Set<string>()
  const importsBySource = new Map<string, ImportEntity[]>()
  const exportsByName = new Map<string, ExportEntity>()
  const exportsByEntityId = new Map<number, ExportEntity>()
  const classesByNode = new Map<ts.ClassDeclaration | ts.ClassExpression, ClassEntity>()
  const classesByName = new Map<string, ClassEntity[]>()

  const unaryExpressionsByOperator = new Map<ts.SyntaxKind, ts.PrefixUnaryExpression[]>()
  const spreadElements: (ts.SpreadElement | ts.SpreadAssignment)[] = []
  const newExpressionsByCallee = new Map<string, ts.NewExpression[]>()
  const deleteExpressions: ts.DeleteExpression[] = []
  const identifiersByName = new Map<string, ts.Identifier[]>()

  const componentScopes = new Map<ScopeEntity, { scope: ScopeEntity; name: string }>()
  const computationByCallId = new Map<number, ComputationEntity>()

  const fileEntity: FileEntity = {
    id: 0,
    path: file,
    sourceFile,
    functions,
    calls,
    variables,
    scopes,
    jsxElements,
    imports,
    conditionalSpreads,
  }

  let _nextScopeId = 0
  let _nextVariableId = 0
  let _nextFunctionId = 0
  let _nextCallId = 0
  let _nextJsxId = 0
  let _nextImportId = 0
  let _nextExportId = 0
  let _nextClassId = 0
  let _nextPropertyId = 0
  let _nextConditionalSpreadId = 0
  let _nextMiscId = 0
  let _lineStartOffsets: readonly number[] | null = null

  const ctx: SolidBuildContext = {
    kind: "solid",
    filePath: file,
    version: "",
    file,
    sourceFile,
    typeResolver,
    logger,
    fileEntity,
    comments,

    scopes, variables, functions, calls, jsxElements, imports, exports, classes,
    properties, propertyAssignments, conditionalSpreads, objectSpreads,
    nonNullAssertions, typeAssertions, typePredicates, unsafeGenericAssertions,
    unsafeTypeAnnotations, inlineImports,

    variablesByName, functionsByNode, functionsByDeclarationNode, functionsByName,
    callsByNode, callsByPrimitive, callsByMethodName, callsByArgNode,
    jsxByNode, jsxByTag, jsxAttributesByElementId, jsxAttrsByKind,
    jsxClassAttributes, jsxClassListAttributes, jsxStyleAttributes,
    fillImageElements, staticClassTokensByElementId, staticClassListKeysByElementId,
    staticStyleKeysByElementId, classListProperties, styleProperties, inlineStyleClassNames,
    importsBySource, exportsByName, exportsByEntityId, classesByNode, classesByName,

    unaryExpressionsByOperator, spreadElements, newExpressionsByCallee, deleteExpressions, identifiersByName,

    firstScope: null,
    componentScopes,
    componentFunctions: [],
    compoundComponentParents: new Map(),
    functionsWithReactiveCaptures: [],
    reactiveVariables: [],
    propsVariables: [],
    storeVariables: [],
    resourceVariables: [],
    variablesWithPropertyAssignment: [],

    computations: [],
    computationByCallId,
    dependencyEdges: [],
    ownershipEdges: [],

    jsxContextCache: new WeakMap(),
    scopeForCache: new WeakMap(),
    onDepsCache: new WeakMap(),
    passthroughCache: new WeakMap(),

    nextScopeId() { return _nextScopeId++ },
    nextVariableId() { return _nextVariableId++ },
    nextFunctionId() { return _nextFunctionId++ },
    nextCallId() { return _nextCallId++ },
    nextJsxId() { return _nextJsxId++ },
    nextImportId() { return _nextImportId++ },
    nextExportId() { return _nextExportId++ },
    nextClassId() { return _nextClassId++ },
    nextPropertyId() { return _nextPropertyId++ },
    nextConditionalSpreadId() { return _nextConditionalSpreadId++ },
    nextMiscId() { return _nextMiscId++ },

    addScope(scope) {
      scopes.push(scope)
      if (ctx.firstScope === null) ctx.firstScope = scope
    },

    addVariable(variable) {
      variables.push(variable)
      const existing = variablesByName.get(variable.name)
      if (existing) existing.push(variable)
      else variablesByName.set(variable.name, [variable])
    },

    addFunction(fn) {
      functions.push(fn)
      functionsByNode.set(fn.node, fn)
      functionsByDeclarationNode.set(fn.declarationNode, fn)
      if (fn.name) {
        const existing = functionsByName.get(fn.name)
        if (existing) existing.push(fn)
        else functionsByName.set(fn.name, [fn])
      }
    },

    addCall(call) {
      calls.push(call)
      callsByNode.set(call.node, call)
      const primitiveName = call.primitive?.name
      if (primitiveName) {
        const existing = callsByPrimitive.get(primitiveName)
        if (existing) existing.push(call)
        else callsByPrimitive.set(primitiveName, [call])
      }
      const methodName = getMethodName(call.callee)
      if (methodName) {
        const existing = callsByMethodName.get(methodName)
        if (existing) existing.push(call)
        else callsByMethodName.set(methodName, [call])
      }
      const args = call.arguments
      for (let i = 0, len = args.length; i < len; i++) {
        const arg = args[i]
        if (!arg) continue
        callsByArgNode.set(arg.node, arg)
      }
    },

    addJSXElement(element) {
      jsxElements.push(element)
      jsxByNode.set(element.node, element)
      if (element.tag) {
        const existing = jsxByTag.get(element.tag)
        if (existing) existing.push(element)
        else jsxByTag.set(element.tag, [element])
      }
      const attrs = element.attributes
      const attrsByName = new Map<string, JSXAttributeEntity>()
      for (let i = 0, len = attrs.length; i < len; i++) {
        const attr = attrs[i]
        if (!attr) continue
        if (attr.name) attrsByName.set(attr.name.toLowerCase(), attr)
        if (attr.kind) {
          const existing = jsxAttrsByKind.get(attr.kind)
          const entry: JSXAttributeWithElement = { attr, element }
          if (existing) existing.push(entry)
          else jsxAttrsByKind.set(attr.kind, [entry])

          if (attr.kind === "class") {
            jsxClassAttributes.push(entry)
            staticClassTokensByElementId.set(element.id, parseStaticClassTokens(attr.valueNode))
          }
          if (attr.kind === "classList") {
            indexObjectAttribute(entry, element, attr, jsxClassListAttributes, staticClassListKeysByElementId, classListProperties)
          }
          if (attr.kind === "style") {
            indexObjectAttribute(entry, element, attr, jsxStyleAttributes, staticStyleKeysByElementId, styleProperties)
          }
        }
      }
      jsxAttributesByElementId.set(element.id, attrsByName)
      if (isFillImageElement(element, attrsByName)) fillImageElements.push(element)
      if (element.tagName === "style") extractInlineStyleClassNames(element, inlineStyleClassNames)
    },

    addImport(imp) {
      imports.push(imp)
      const existing = importsBySource.get(imp.source)
      if (existing) existing.push(imp)
      else importsBySource.set(imp.source, [imp])
    },

    addExport(exp) {
      exports.push(exp)
      exportsByName.set(exp.name, exp)
      if (exp.entityId !== -1) exportsByEntityId.set(exp.entityId, exp)
    },

    addClass(cls) {
      classes.push(cls)
      classesByNode.set(cls.node, cls)
      if (cls.name) {
        const existing = classesByName.get(cls.name)
        if (existing) existing.push(cls)
        else classesByName.set(cls.name, [cls])
      }
    },

    addProperty(prop) { properties.push(prop) },
    addPropertyAssignment(pa) { propertyAssignments.push(pa) },
    addConditionalSpread(spread) { conditionalSpreads.push(spread) },
    addObjectSpread(spread) { objectSpreads.push(spread) },
    addNonNullAssertion(assertion) { nonNullAssertions.push(assertion) },
    addTypeAssertion(assertion) { typeAssertions.push(assertion) },
    addTypePredicate(predicate) { typePredicates.push(predicate) },
    addUnsafeGenericAssertion(assertion) { unsafeGenericAssertions.push(assertion) },
    addUnsafeTypeAnnotation(annotation) { unsafeTypeAnnotations.push(annotation) },
    addInlineImport(imp) { inlineImports.push(imp) },

    addComputation(computation) {
      ctx.computations.push(computation)
      computationByCallId.set(computation.call.id, computation)
    },

    addDependencyEdge(edge) { ctx.dependencyEdges.push(edge) },
    addOwnershipEdge(edge) { ctx.ownershipEdges.push(edge) },

    buildReactiveIndex() {
      const reactive: VariableEntity[] = []
      const props: VariableEntity[] = []
      const stores: VariableEntity[] = []
      const resources: VariableEntity[] = []
      const withPropertyAssignment: VariableEntity[] = []
      for (let i = 0, len = variables.length; i < len; i++) {
        const v = variables[i]
        if (!v) continue
        if (v.isReactive) {
          reactive.push(v)
          const kind = v.reactiveKind
          if (kind === "props") props.push(v)
          else if (kind === "store") stores.push(v)
          else if (kind === "resource") resources.push(v)
        }
        const init = v.initializer
        if (init && (ts.isPropertyAccessExpression(init) || ts.isElementAccessExpression(init))) {
          withPropertyAssignment.push(v)
        }
      }
      ctx.reactiveVariables = reactive
      ctx.propsVariables = props
      ctx.storeVariables = stores
      ctx.resourceVariables = resources
      ctx.variablesWithPropertyAssignment = withPropertyAssignment
    },

    addUnaryExpression(node) {
      const op = node.operator
      const existing = unaryExpressionsByOperator.get(op)
      if (existing) existing.push(node)
      else unaryExpressionsByOperator.set(op, [node])
    },
    addDeleteExpression(node) { deleteExpressions.push(node) },
    addSpreadElement(node) { spreadElements.push(node) },
    addNewExpressionByCallee(name, node) {
      const existing = newExpressionsByCallee.get(name)
      if (existing) existing.push(node)
      else newExpressionsByCallee.set(name, [node])
    },
    addIdentifierReference(node) {
      const name = node.text
      const existing = identifiersByName.get(name)
      if (existing) existing.push(node)
      else identifiersByName.set(name, [node])
    },

    get lineStartOffsets(): readonly number[] {
      if (_lineStartOffsets === null) _lineStartOffsets = computeLineStarts(sourceFile.text)
      return _lineStartOffsets
    },

    findExpressionAtOffset(offset: number): ts.Node | null {
      return findExpressionAtOffset(sourceFile, offset)
    },
  }

  return ctx
}


// ── Helpers (moved from SolidGraph class) ─────────────────────────────────

function getMethodName(callee: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name.text
  return null
}

function findExpressionAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node | null {
  if (offset < 0 || offset >= sourceFile.text.length) return null
  let deepestExpr: ts.Node | null = null
  function descend(node: ts.Node): void {
    if (ts.isExpression(node)) deepestExpr = node
    ts.forEachChild(node, (child) => {
      const childStart = child.getStart(sourceFile)
      const childEnd = child.end
      if (offset >= childStart && offset < childEnd) descend(child)
    })
  }
  descend(sourceFile)
  return deepestExpr
}

function computeLineStarts(text: string): number[] {
  const starts = [0]
  const len = text.length
  for (let i = 0; i < len; i++) {
    if (text.charCodeAt(i) === CHAR_NEWLINE) starts.push(i + 1)
  }
  return starts
}

const FILL_COMPONENT_NAMES = new Set(["image", "nextimage", "next.image"])

function parseStaticClassTokens(node: ts.Node | null): JSXStaticClassIndex {
  if (!node) return { hasDynamicClass: true, tokens: [] }
  const text = getStaticStringFromJSXValue(node)
  if (text === null) return { hasDynamicClass: true, tokens: [] }
  const tokens: string[] = []
  const parts = text.split(WHITESPACE_SPLIT)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (!part) continue
    const token = part.trim()
    if (token.length > 0) tokens.push(token)
  }
  return { hasDynamicClass: false, tokens }
}

function parseStaticObject(node: ts.Node | null): JSXStaticObjectKeyIndex & { properties: readonly ts.ObjectLiteralElementLike[] } {
  if (!node || !ts.isJsxExpression(node)) return { hasDynamic: true, keys: [], properties: [] }
  const expression = node.expression
  if (!expression || !ts.isObjectLiteralExpression(expression)) return { hasDynamic: true, keys: [], properties: [] }
  const keys: string[] = []
  const properties: ts.ObjectLiteralElementLike[] = []
  let hasDynamic = false
  for (let i = 0; i < expression.properties.length; i++) {
    const property = expression.properties[i]
    if (!property) continue
    properties.push(property)
    if (!ts.isPropertyAssignment(property)) { hasDynamic = true; continue }
    if (property.name && ts.isComputedPropertyName(property.name)) { hasDynamic = true; continue }
    const name = getPropertyKeyName(property.name)
    if (name !== null) { keys.push(name); continue }
    hasDynamic = true
  }
  if (hasDynamic) return { hasDynamic: true, keys, properties }
  return { hasDynamic: false, keys, properties }
}

function indexObjectAttribute(
  entry: JSXAttributeWithElement,
  element: JSXElementEntity,
  attr: JSXAttributeEntity,
  attrArray: JSXAttributeWithElement[],
  keyIndex: Map<number, JSXStaticObjectKeyIndex>,
  propertiesArray: JSXObjectPropertyWithElement[],
): void {
  attrArray.push(entry)
  const parsed = parseStaticObject(attr.valueNode)
  keyIndex.set(element.id, { hasDynamic: parsed.hasDynamic, keys: parsed.keys })
  for (let j = 0; j < parsed.properties.length; j++) {
    const property = parsed.properties[j]
    if (!property) continue
    propertiesArray.push({ property, attr, element })
  }
}

function extractInlineStyleClassNames(element: JSXElementEntity, classNames: Set<string>): void {
  const astNode = element.node
  if (!ts.isJsxElement(astNode)) return
  const astChildren = astNode.children
  for (let i = 0, len = astChildren.length; i < len; i++) {
    const child = astChildren[i]
    if (!child) continue
    let cssText: string | null = null
    if (ts.isJsxExpression(child)) {
      const expr = child.expression
      if (expr) {
        if (ts.isNoSubstitutionTemplateLiteral(expr)) cssText = expr.text
        else if (ts.isStringLiteral(expr)) cssText = expr.text
      }
    } else if (ts.isJsxText(child)) {
      cssText = child.text
    }
    if (cssText === null) continue
    const classPattern = /\.([a-zA-Z_][\w-]*)/g
    let match: RegExpExecArray | null
    while ((match = classPattern.exec(cssText)) !== null) {
      const className = match[1]
      if (className) classNames.add(className)
    }
  }
}

function isFillImageElement(element: JSXElementEntity, attrsByName: ReadonlyMap<string, JSXAttributeEntity>): boolean {
  if (!element.tagName) return false
  if (element.isDomElement) return false
  const normalizedTag = element.tagName.replaceAll("_", "")
  if (!FILL_COMPONENT_NAMES.has(normalizedTag) && !normalizedTag.endsWith(".image") && normalizedTag !== "image") return false
  const fillAttribute = attrsByName.get("fill")
  if (fillAttribute) return isTruthyFillAttribute(fillAttribute)
  const layoutAttribute = attrsByName.get("layout")
  if (!layoutAttribute || !layoutAttribute.valueNode) return false
  const value = getStaticStringFromJSXValue(layoutAttribute.valueNode)
  if (!value) return false
  return value.trim().toLowerCase() === "fill"
}

function isTruthyFillAttribute(attribute: JSXAttributeEntity): boolean {
  if (!attribute.valueNode) return true
  const value = getStaticStringFromJSXValue(attribute.valueNode)
  if (value === null) return true
  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) return true
  if (normalized === "true") return true
  if (normalized === "false") return false
  return true
}
