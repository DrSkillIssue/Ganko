import ts from "typescript";
import type { VisitorContext } from "../context";
import type { ReturnStatementEntity } from "../../../entities/return-statement";
import type { PropertyAssignmentEntity } from "../../../entities/property-assignment";
import type { FunctionEntity } from "../../../entities/function";
import { getScopeFor } from "../../../queries/scope";

export function handleReturnStatement(ctx: VisitorContext, node: ts.ReturnStatement): void {
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (!fn) return;

  const hasArg = node.expression !== null && node.expression !== undefined;
  if (hasArg) {
    fn.hasNonVoidReturn = true;
  }

  const entity: ReturnStatementEntity = {
    id: ctx.graph.nextMiscId(),
    node,
    functionId: fn.id,
    hasArgument: hasArg,
    isEarly: isEarlyReturn(ctx, node, fn),
  };
  fn.returnStatements.push(entity);
}

export function isEarlyReturn(_ctx: VisitorContext, node: ts.ReturnStatement, fn: FunctionEntity): boolean {
  const body = fn.node.body;
  if (!body || !ts.isBlock(body)) return false;
  const statements = body.statements;
  if (statements.length === 0) return false;
  const last = statements[statements.length - 1];
  return last !== node;
}

export function handleThrowStatement(ctx: VisitorContext): void {
  if (ctx.functionStack.length === 0) return;
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (fn) fn.hasThrowStatement = true;
}

export function handleAwaitExpression(ctx: VisitorContext, node: ts.AwaitExpression): void {
  if (ctx.functionStack.length === 0) return;
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (fn) fn.awaitRanges.push([node.pos, node.end]);
}

export function handleNewExpression(ctx: VisitorContext, node: ts.NewExpression): void {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    ctx.graph.addNewExpressionByCallee(callee.text, node);
  } else if (ts.isPropertyAccessExpression(callee)) {
    ctx.graph.addNewExpressionByCallee(callee.name.text, node);
  }
}

export function handleMemberExpression(ctx: VisitorContext, node: ts.PropertyAccessExpression): void {
  if (ctx.functionStack.length === 0) return;
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (!fn) return;

  const obj = node.expression;
  if (!ts.isIdentifier(obj)) return;

  let cache = fn._memberAccessesByIdentifier;
  if (!cache) {
    cache = new Map();
    fn._memberAccessesByIdentifier = cache;
  }

  const name = obj.text;
  const existing = cache.get(name);
  if (existing) {
    existing.push(node);
  } else {
    cache.set(name, [node]);
  }
}

export function handleAssignmentExpression(ctx: VisitorContext, node: ts.BinaryExpression): void {
  const left = node.left;
  if (!ts.isPropertyAccessExpression(left) && !ts.isElementAccessExpression(left)) return;

  const graph = ctx.graph;
  const scope = getScopeFor(graph, node);
  const object = left.expression;
  const isComputed = ts.isElementAccessExpression(left);
  const property = ts.isElementAccessExpression(left)
    ? left.argumentExpression
    : left.name;

  const isArrayIndex = isComputed && isLikelyArrayIndex(ctx, property);
  const hasDynamicProperty = isComputed && !ts.isStringLiteral(property) && !ts.isNumericLiteral(property);
  const propertyExists = checkPropertyExistsOnType(ctx, object, property, isComputed);

  const entity: PropertyAssignmentEntity = {
    id: graph.nextMiscId(),
    node,
    target: left,
    object,
    property,
    computed: isComputed,
    value: node.right,
    operator: node.operatorToken.kind,
    scope,
    file: ctx.file,
    isInLoop: ctx.loopDepth > 0,
    isInConditional: ctx.conditionalDepth > 0,
    propertyExistsOnType: propertyExists,
    isArrayIndexAssignment: isArrayIndex,
    hasDynamicPropertyName: hasDynamicProperty,
  };

  graph.addPropertyAssignment(entity);
}

export function isLikelyArrayIndex(_ctx: VisitorContext, node: ts.Expression): boolean {
  if (ts.isNumericLiteral(node)) return true;
  if (ts.isIdentifier(node)) {
    const name = node.text;
    return name === "i" || name === "j" || name === "k" || name === "index" || name === "idx";
  }
  if (ts.isBinaryExpression(node)) return true;
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) return true;
  return false;
}

export function checkPropertyExistsOnType(ctx: VisitorContext,
  object: ts.Expression,
  property: ts.Expression | ts.Identifier,
  computed: boolean,
): boolean {
  const resolver = ctx.graph.typeResolver;
  if (!resolver.hasTypeInfo()) return true;

  let propName: string | null = null;
  if (!computed && ts.isIdentifier(property)) {
    propName = property.text;
  } else if (ts.isStringLiteral(property)) {
    propName = property.text;
  }

  if (!propName) return true;

  return resolver.hasPropertyOnType(object, propName);
}
