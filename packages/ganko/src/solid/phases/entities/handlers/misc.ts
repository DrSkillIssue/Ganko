import type { TSESTree as T } from "@typescript-eslint/utils";
import type { VisitorContext } from "../context";
import type { ReturnStatementEntity } from "../../../entities/return-statement";
import type { PropertyAssignmentEntity } from "../../../entities/property-assignment";
import type { FunctionEntity } from "../../../entities/function";
import { getScopeFor } from "../../../queries/scope";

export function handleReturnStatement(ctx: VisitorContext, node: T.ReturnStatement): void {
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (!fn) return;

  const hasArg = node.argument !== null;
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

export function isEarlyReturn(_ctx: VisitorContext, node: T.ReturnStatement, fn: FunctionEntity): boolean {
  const body = fn.node.body;
  if (body.type !== "BlockStatement") return false;
  const statements = body.body;
  if (statements.length === 0) return false;
  const last = statements[statements.length - 1];
  return last !== node;
}

export function handleThrowStatement(ctx: VisitorContext, ): void {
  if (ctx.functionStack.length === 0) return;
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (fn) fn.hasThrowStatement = true;
}

export function handleAwaitExpression(ctx: VisitorContext, node: T.AwaitExpression): void {
  if (ctx.functionStack.length === 0) return;
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (fn) fn.awaitRanges.push(node.range);
}

export function handleNewExpression(ctx: VisitorContext, node: T.NewExpression): void {
  const callee = node.callee;
  if (callee.type === "Identifier") {
    ctx.graph.addNewExpressionByCallee(callee.name, node);
  } else if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    ctx.graph.addNewExpressionByCallee(callee.property.name, node);
  }
}

export function handleMemberExpression(ctx: VisitorContext, node: T.MemberExpression): void {
  if (ctx.functionStack.length === 0) return;
  const fn = ctx.functionStack[ctx.functionStack.length - 1];
  if (!fn) return;

  const obj = node.object;
  if (obj.type !== "Identifier") return;

  let cache = fn._memberAccessesByIdentifier;
  if (!cache) {
    cache = new Map();
    fn._memberAccessesByIdentifier = cache;
  }

  const name = obj.name;
  const existing = cache.get(name);
  if (existing) {
    existing.push(node);
  } else {
    cache.set(name, [node]);
  }
}

export function handleAssignmentExpression(ctx: VisitorContext, node: T.AssignmentExpression): void {
  const left = node.left;
  if (left.type !== "MemberExpression") return;

  const graph = ctx.graph;
  const scope = getScopeFor(graph, node);
  const object = left.object;
  const property = left.property;

  const isArrayIndex = left.computed && isLikelyArrayIndex(ctx, property);
  const hasDynamicProperty = left.computed && property.type !== "Literal";
  const propertyExists = checkPropertyExistsOnType(ctx, object, property, left.computed);

  const entity: PropertyAssignmentEntity = {
    id: graph.nextMiscId(),
    node,
    target: left,
    object,
    property,
    computed: left.computed,
    value: node.right,
    operator: node.operator,
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

export function isLikelyArrayIndex(_ctx: VisitorContext, node: T.Expression | T.PrivateIdentifier): boolean {
  if (node.type === "Literal" && typeof node.value === "number") return true;
  if (node.type === "Identifier") {
    const name = node.name;
    return name === "i" || name === "j" || name === "k" || name === "index" || name === "idx";
  }
  if (node.type === "BinaryExpression") return true;
  if (node.type === "UpdateExpression") return true;
  return false;
}

export function checkPropertyExistsOnType(ctx: VisitorContext, 
  object: T.Expression,
  property: T.Expression | T.PrivateIdentifier,
  computed: boolean,
): boolean {
  const resolver = ctx.graph.typeResolver;
  if (!resolver.hasTypeInfo()) return true;

  let propName: string | null = null;
  if (!computed && property.type === "Identifier") {
    propName = property.name;
  } else if (property.type === "Literal" && typeof property.value === "string") {
    propName = property.value;
  }

  if (!propName) return true;

  return resolver.hasPropertyOnType(object, propName);
}
