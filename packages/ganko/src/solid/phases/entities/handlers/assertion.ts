import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import type { NonNullAssertionEntity } from "../../../entities/non-null-assertion";
import type { TypeAssertionEntity, TypeAssertionKind, TypePredicateEntity, UnsafeGenericAssertionEntity, UnsafeTypeAnnotationEntity, UnsafeAnnotationKind, UnsafeAnnotationPosition } from "../../../entities/type-assertion";
import type { FunctionEntity } from "../../../entities/function";
import { getScopeFor } from "../../../queries/scope";
import { getFunctionName } from "../../../util/function";

export function handleNonNullAssertion(ctx: VisitorContext, node: T.TSNonNullExpression): void {
  const entity: NonNullAssertionEntity = {
    id: ctx.graph.nextMiscId(),
    node,
    expression: node.expression,
  };
  ctx.graph.addNonNullAssertion(entity);
}

export function handleTypeAssertion(ctx: VisitorContext, node: T.TSAsExpression | T.TSTypeAssertion): void {
  const graph = ctx.graph;
  const scope = getScopeFor(graph, node);
  const kind = getTypeAssertionKind(ctx, node);
  const expr = node.expression;

  const onImport = expr.type === "ImportExpression" ||
    (expr.type === "CallExpression" && expr.callee.type === "Identifier" && expr.callee.name === "require");

  const innerAssertion = findInnerAssertion(ctx, expr);

  const entity: TypeAssertionEntity = {
    id: graph.nextMiscId(),
    node,
    expression: expr,
    typeAnnotation: node.typeAnnotation,
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

export function getTypeAssertionKind(_ctx: VisitorContext, node: T.TSAsExpression | T.TSTypeAssertion): TypeAssertionKind {
  const typeAnnotation = node.typeAnnotation;

  if (typeAnnotation.type === "TSTypeReference") {
    const typeName = typeAnnotation.typeName;
    if (typeName.type === "Identifier") {
      if (typeName.name === "const") return "const-assertion";
    }
  }

  if (typeAnnotation.type === "TSAnyKeyword") return "cast-to-any";
  if (typeAnnotation.type === "TSUnknownKeyword") return "cast-to-unknown";

  const inner = node.expression;
  if (inner.type === "TSAsExpression" || inner.type === "TSTypeAssertion") {
    return "double";
  }

  return "simple";
}

export function findInnerAssertion(ctx: VisitorContext, expr: T.Expression): TypeAssertionEntity | null {
  if (expr.type !== "TSAsExpression" && expr.type !== "TSTypeAssertion") return null;

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
  assertion: T.TSAsExpression | T.TSTypeAssertion,
): void {
  const fnNode = fn.node;
  const typeParams = fnNode.typeParameters;
  if (!typeParams || typeParams.params.length === 0) return;

  const targetType = assertion.typeAnnotation;
  if (targetType.type !== "TSTypeReference") return;

  const typeName = targetType.typeName;
  if (typeName.type !== "Identifier") return;

  const typeParamName = typeName.name;
  let found = false;
  for (let i = 0, len = typeParams.params.length; i < len; i++) {
    const tp = typeParams.params[i];
    if (!tp) continue;
    if (tp.name.name === typeParamName) {
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
  fnNode: T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression,
  predicate: T.TSTypePredicate,
): void {
  const paramName = predicate.parameterName;
  if (paramName.type !== "Identifier") return;

  const typeAnnotation = predicate.typeAnnotation?.typeAnnotation;
  if (!typeAnnotation) return;

  const entity: TypePredicateEntity = {
    id: ctx.graph.nextMiscId(),
    node: fnNode,
    parameterName: paramName.name,
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
export function handleUnsafeTypeAnnotation(ctx: VisitorContext, node: T.TSAnyKeyword | T.TSUnknownKeyword): void {
  const kind: UnsafeAnnotationKind = node.type === "TSAnyKeyword" ? "any" : "unknown"

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
function resolveAnnotationPosition(node: T.TSAnyKeyword | T.TSUnknownKeyword): ResolvedPosition | null {
  // Walk up to find the TSTypeAnnotation wrapper
  // Typical chain: TSAnyKeyword → TSTypeAnnotation → <context node>
  // But could be deeper: TSAnyKeyword → TSArrayType → TSTypeAnnotation → <context node>
  // Or nested in union/intersection: TSAnyKeyword → TSUnionType → TSTypeAnnotation → <context node>

  let current: T.Node | undefined = node.parent
  let depth = 0

  while (current && depth < 20) {
    // TSTypeAnnotation is the boundary between type-space and value-space
    if (current.type === "TSTypeAnnotation") {
      return resolveFromTypeAnnotation(current)
    }

    // If we hit a type-level declaration, this is exempt
    if (isTypeLevelDeclaration(current)) return null

    // If we're inside a type argument list (e.g., `Record<string, unknown>`), exempt
    if (current.type === "TSTypeParameterInstantiation") return null

    // If we're inside an index signature, exempt
    if (current.type === "TSIndexSignature") return null

    // If we're inside a mapped type, exempt
    if (current.type === "TSMappedType") return null

    // If we're inside a conditional type, exempt
    if (current.type === "TSConditionalType") return null

    // If we're inside an infer type, exempt
    if (current.type === "TSInferType") return null

    current = current.parent
    depth++
  }

  return null
}

/**
 * Given a TSTypeAnnotation node, determine the position from its parent.
 */
function resolveFromTypeAnnotation(typeAnnotation: T.TSTypeAnnotation): ResolvedPosition | null {
  const parent = typeAnnotation.parent
  if (!parent) return null

  // Parameter: TSTypeAnnotation → Identifier (param) → FunctionDeclaration/Expression/Arrow
  if (parent.type === "Identifier") {
    const grandparent = parent.parent
    if (!grandparent) return null

    // Catch clause: `catch (e: unknown)` — exempt
    if (grandparent.type === "CatchClause") return null

    // Function parameter
    if (grandparent.type === "FunctionDeclaration" || grandparent.type === "FunctionExpression" || grandparent.type === "ArrowFunctionExpression") {
      // Promise .catch() callback: `promise.catch((err: unknown) => ...)`
      // The rejection reason is untyped by specification — same semantics as catch clause bindings
      if (isCatchCallback(grandparent)) return null

      return {
        position: "parameter",
        name: parent.name,
        functionName: getFunctionName(grandparent),
      }
    }

    // Variable declarator: `const x: any = ...`
    if (grandparent.type === "VariableDeclarator") {
      return {
        position: "variable",
        name: parent.name,
        functionName: null,
      }
    }

    // Rest/assignment parameter in function
    // TSTypeAnnotation → Identifier → RestElement → FunctionDeclaration
    // TSTypeAnnotation → Identifier → AssignmentPattern → FunctionDeclaration
    if (grandparent.type === "RestElement" || grandparent.type === "AssignmentPattern") {
      const fnNode = grandparent.parent
      if (fnNode && (fnNode.type === "FunctionDeclaration" || fnNode.type === "FunctionExpression" || fnNode.type === "ArrowFunctionExpression")) {
        return {
          position: "parameter",
          name: parent.name,
          functionName: getFunctionName(fnNode),
        }
      }
    }

    // TSParameterProperty: `constructor(public x: any)`
    if (grandparent.type === "TSParameterProperty") {
      const fnNode = grandparent.parent
      if (fnNode && (fnNode.type === "FunctionDeclaration" || fnNode.type === "FunctionExpression" || fnNode.type === "ArrowFunctionExpression")) {
        return {
          position: "parameter",
          name: parent.name,
          functionName: getFunctionName(fnNode),
        }
      }
    }
  }

  // Return type: TSTypeAnnotation → FunctionDeclaration/Expression/Arrow
  if (parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") {
    return {
      position: "return",
      name: getFunctionName(parent),
      functionName: getFunctionName(parent),
    }
  }

  // Object/array destructuring pattern with type annotation
  if (parent.type === "ObjectPattern" || parent.type === "ArrayPattern") {
    const patternParent = parent.parent
    if (patternParent?.type === "VariableDeclarator") {
      return {
        position: "variable",
        name: null,
        functionName: null,
      }
    }
    // Destructured parameter: ObjectPattern → FunctionDeclaration
    if (patternParent && (patternParent.type === "FunctionDeclaration" || patternParent.type === "FunctionExpression" || patternParent.type === "ArrowFunctionExpression")) {
      return {
        position: "parameter",
        name: null,
        functionName: getFunctionName(patternParent),
      }
    }
  }

  // Class property: TSTypeAnnotation → PropertyDefinition
  if (parent.type === "PropertyDefinition") {
    const key = parent.key
    return {
      position: "property",
      name: key.type === "Identifier" ? key.name : null,
      functionName: null,
    }
  }

  // TSPropertySignature inside type literal used in a value context
  // This is tricky — could be in an interface (exempt) or inline type annotation
  // We exempt these since they're structural
  if (parent.type === "TSPropertySignature") return null

  // Type-level method signatures — exempt
  if (parent.type === "TSMethodSignature") return null

  return null
}

/**
 * Detect if a function node is the callback argument of a `.catch()` call.
 *
 * Promise `.catch()` callbacks receive the rejection reason, which is `unknown`
 * by TypeScript specification — semantically identical to catch clause bindings.
 *
 * AST shape: FunctionExpression/ArrowFunctionExpression → CallExpression.arguments
 *            where CallExpression.callee is MemberExpression with property "catch"
 */
function isCatchCallback(fn: T.FunctionDeclaration | T.FunctionExpression | T.ArrowFunctionExpression): boolean {
  const call = fn.parent
  if (!call || call.type !== "CallExpression") return false

  const callee = call.callee
  if (callee.type !== "MemberExpression") return false

  const prop = callee.property
  return prop.type === "Identifier" && prop.name === "catch"
}

function isTypeLevelDeclaration(node: T.Node): boolean {
  return node.type === "TSTypeAliasDeclaration" ||
    node.type === "TSInterfaceDeclaration" ||
    node.type === "TSDeclareFunction" ||
    node.type === "TSEnumDeclaration" ||
    node.type === "TSModuleDeclaration"
}
