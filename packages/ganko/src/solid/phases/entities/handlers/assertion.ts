import ts from "typescript";
import type { VisitorContext } from "../context";
import type { NonNullAssertionEntity } from "../../../entities/non-null-assertion";
import type { TypeAssertionEntity, TypeAssertionKind, TypePredicateEntity, UnsafeGenericAssertionEntity, UnsafeTypeAnnotationEntity, UnsafeAnnotationKind, UnsafeAnnotationPosition } from "../../../entities/type-assertion";
import type { FunctionEntity } from "../../../entities/function";
import { getScopeFor } from "../../../queries/scope";
import { getFunctionName } from "../../../util/function";

export function handleNonNullAssertion(ctx: VisitorContext, node: ts.NonNullExpression): void {
  const entity: NonNullAssertionEntity = {
    id: ctx.graph.nextMiscId(),
    node,
    expression: node.expression,
  };
  ctx.graph.addNonNullAssertion(entity);
}

export function handleTypeAssertion(ctx: VisitorContext, node: ts.AsExpression | ts.TypeAssertion): void {
  const graph = ctx.graph;
  const scope = getScopeFor(graph, node as any);
  const kind = getTypeAssertionKind(ctx, node);
  const expr = node.expression;

  const onImport = ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "require";

  const innerAssertion = findInnerAssertion(ctx, expr);

  const entity: TypeAssertionEntity = {
    id: graph.nextMiscId(),
    node,
    expression: expr,
    typeAnnotation: node.type,
    kind,
    inLoop: ctx.loopDepth > 0,
    onImport,
    scope,
    innerAssertion,
    isUnnecessary: null,
    expressionType: null,
  };

  graph.addTypeAssertion(entity);

  if (ctx.functionStack.length === 0) return;
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (fn && kind !== "const-assertion") {
    checkUnsafeGenericAssertion(ctx, fn, node);
  }
}

export function getTypeAssertionKind(_ctx: VisitorContext, node: ts.AsExpression | ts.TypeAssertion): TypeAssertionKind {
  const typeAnnotation = node.type;

  if (ts.isTypeReferenceNode(typeAnnotation)) {
    const typeName = typeAnnotation.typeName;
    if (ts.isIdentifier(typeName)) {
      if (typeName.text === "const") return "const-assertion";
    }
  }

  if (typeAnnotation.kind === ts.SyntaxKind.AnyKeyword) return "cast-to-any";
  if (typeAnnotation.kind === ts.SyntaxKind.UnknownKeyword) return "cast-to-unknown";

  const inner = node.expression;
  if (ts.isAsExpression(inner) || ts.isTypeAssertionExpression(inner)) {
    return "double";
  }

  return "simple";
}

export function findInnerAssertion(ctx: VisitorContext, expr: ts.Expression): TypeAssertionEntity | null {
  if (!ts.isAsExpression(expr) && !ts.isTypeAssertionExpression(expr)) return null;

  const existing = ctx.graph.typeAssertions;
  if (existing.length === 0) return null;

  for (let i = existing.length - 1; i >= 0; i--) {
    const e = existing[i];
    if (!e) continue;
    if (e.node === expr) return e;
  }
  return null;
}

export function checkUnsafeGenericAssertion(ctx: VisitorContext,
  fn: FunctionEntity,
  assertion: ts.AsExpression | ts.TypeAssertion,
): void {
  const fnNode = fn.node;
  const typeParams = (fnNode as ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction).typeParameters;
  if (!typeParams || typeParams.length === 0) return;

  const targetType = assertion.type;
  if (!ts.isTypeReferenceNode(targetType)) return;

  const typeName = targetType.typeName;
  if (!ts.isIdentifier(typeName)) return;

  const typeParamName = typeName.text;
  let found = false;
  for (let i = 0, len = typeParams.length; i < len; i++) {
    const tp = typeParams[i];
    if (!tp) continue;
    if (tp.name.text === typeParamName) {
      found = true;
      break;
    }
  }
  if (!found) return;

  const entity: UnsafeGenericAssertionEntity = {
    id: ctx.graph.nextMiscId(),
    node: fnNode,
    typeParameterName: typeParamName,
    assertion,
  };
  ctx.graph.addUnsafeGenericAssertion(entity);
}

export function handleTypePredicate(ctx: VisitorContext,
  fnNode: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
  predicate: ts.TypePredicateNode,
): void {
  const paramName = predicate.parameterName;
  if (!ts.isIdentifier(paramName)) return;

  const typeAnnotation = predicate.type;
  if (!typeAnnotation) return;

  const entity: TypePredicateEntity = {
    id: ctx.graph.nextMiscId(),
    node: fnNode,
    parameterName: paramName.text,
    typeAnnotation,
  };
  ctx.graph.addTypePredicate(entity);
}

/**
 * Handle an unsafe type annotation (`any` or `unknown` keyword).
 *
 * Determines the positional context by walking the parent chain from the keyword node.
 * Only collects annotations in value-level positions (parameters, returns, variables, properties).
 *
 * Exemptions:
 * - Type alias bodies, interface members — type-level definitions
 * - Catch clause parameters (`catch (e: unknown)`) — recommended practice
 * - Type arguments in generic positions (`Record<string, unknown>`) — structural constraint
 * - Index signatures (`[key: string]: unknown`) — structural constraint
 * - Mapped types, conditional types — type-level
 */
export function handleUnsafeTypeAnnotation(ctx: VisitorContext, node: ts.KeywordTypeNode): void {
  const kind: UnsafeAnnotationKind = node.kind === ts.SyntaxKind.AnyKeyword ? "any" : "unknown"

  const resolved = resolveAnnotationPosition(node)
  if (!resolved) return

  const entity: UnsafeTypeAnnotationEntity = {
    id: ctx.graph.nextMiscId(),
    node,
    kind,
    position: resolved.position,
    name: resolved.name,
    functionName: resolved.functionName,
  }
  ctx.graph.addUnsafeTypeAnnotation(entity)
}

interface ResolvedPosition {
  position: UnsafeAnnotationPosition
  name: string | null
  functionName: string | null
}

/**
 * Resolve the positional context of a type keyword node.
 *
 * Walks the parent chain to determine whether this `any`/`unknown` appears in a
 * parameter, return type, variable declaration, property, or generic constraint.
 *
 * Returns null for positions that should be exempt (type-level, catch clauses,
 * generic type arguments, index signatures).
 */
function resolveAnnotationPosition(node: ts.KeywordTypeNode): ResolvedPosition | null {
  let current: ts.Node | undefined = node.parent
  let depth = 0

  while (current && depth < 20) {
    // Parameter node is the boundary between type-space and value-space
    if (ts.isParameter(current)) {
      return resolveFromParameter(current)
    }

    // Return type on a function
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      // If our node is in the return type position
      if (current.type && isDescendantOf(node, current.type)) {
        return {
          position: "return",
          name: getFunctionName(current),
          functionName: getFunctionName(current),
        }
      }
      return null
    }

    // Variable declaration with type annotation
    if (ts.isVariableDeclaration(current)) {
      if (current.type && isDescendantOf(node, current.type)) {
        const name = ts.isIdentifier(current.name) ? current.name.text : null
        return {
          position: "variable",
          name,
          functionName: null,
        }
      }
      return null
    }

    // Property declaration with type annotation
    if (ts.isPropertyDeclaration(current)) {
      if (current.type && isDescendantOf(node, current.type)) {
        const key = current.name
        return {
          position: "property",
          name: ts.isIdentifier(key) ? key.text : null,
          functionName: null,
        }
      }
      return null
    }

    // If we hit a type-level declaration, this is exempt
    if (isTypeLevelDeclaration(current)) return null

    // If we're inside a type argument list, exempt
    if (ts.isTypeReferenceNode(current) && current.typeArguments && isDescendantOfAny(node, current.typeArguments)) return null

    // If we're inside an index signature, exempt
    if (ts.isIndexSignatureDeclaration(current)) return null

    // If we're inside a mapped type, exempt
    if (ts.isMappedTypeNode(current)) return null

    // If we're inside a conditional type, exempt
    if (ts.isConditionalTypeNode(current)) return null

    // If we're inside an infer type, exempt
    if (ts.isInferTypeNode(current)) return null

    // Property signature in interface — exempt
    if (ts.isPropertySignature(current)) return null

    // Method signature — exempt
    if (ts.isMethodSignature(current)) return null

    current = current.parent
    depth++
  }

  return null
}

/**
 * Given a parameter node, determine the position.
 */
function resolveFromParameter(param: ts.ParameterDeclaration): ResolvedPosition | null {
  const parent = param.parent

  // Catch clause: `catch (e: unknown)` — exempt
  if (ts.isCatchClause(parent)) return null

  // Function parameter
  if (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) {
    // Promise .catch() callback exempt
    if (isCatchCallback(parent)) return null

    const paramName = ts.isIdentifier(param.name) ? param.name.text : null
    return {
      position: "parameter",
      name: paramName,
      functionName: getFunctionName(parent),
    }
  }

  // Constructor parameter
  if (ts.isConstructorDeclaration(parent)) {
    const paramName = ts.isIdentifier(param.name) ? param.name.text : null
    return {
      position: "parameter",
      name: paramName,
      functionName: "constructor",
    }
  }

  // Method parameter
  if (ts.isMethodDeclaration(parent)) {
    const paramName = ts.isIdentifier(param.name) ? param.name.text : null
    const methodName = ts.isIdentifier(parent.name) ? parent.name.text : null
    return {
      position: "parameter",
      name: paramName,
      functionName: methodName,
    }
  }

  return null
}

/**
 * Detect if a function node is the callback argument of a `.catch()` call.
 */
function isCatchCallback(fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction): boolean {
  const call = fn.parent
  if (!call || !ts.isCallExpression(call)) return false

  const callee = call.expression
  if (!ts.isPropertyAccessExpression(callee)) return false

  return callee.name.text === "catch"
}

function isTypeLevelDeclaration(node: ts.Node): boolean {
  return ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
}

function isDescendantOf(child: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = child
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

function isDescendantOfAny(child: ts.Node, nodes: ts.NodeArray<ts.Node>): boolean {
  for (const n of nodes) {
    if (isDescendantOf(child, n)) return true
  }
  return false
}
